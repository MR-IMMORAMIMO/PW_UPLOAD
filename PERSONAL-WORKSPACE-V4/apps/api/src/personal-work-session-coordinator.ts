import { randomUUID } from 'node:crypto';
import { DomainError, type Project, type WorkSession } from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

export interface PersonalWorkSessionStartInput {
  attribution?: { actorId: string; actorName: string };
  projectId: string;
  now: string;
  idempotencyKey: string;
}

export interface PersonalWorkSessionStopInput {
  now: string;
  idempotencyKey: string;
}

export interface PersonalWorkSessionPauseInput {
  now: string;
  idempotencyKey: string;
}

export interface PersonalWorkSessionResumeInput {
  now: string;
  idempotencyKey: string;
}

export interface PersonalWorkSessionSwitchInput {
  attribution?: { actorId: string; actorName: string };
  targetProjectId: string;
  now: string;
  idempotencyKey: string;
}

/** Authoritative active-session information returned on a start conflict. */
export interface WorkSessionConflict {
  activeSession: WorkSession;
  activeProjectId: string;
  projectDisplayName: string | null;
  startedAt: string;
}

export interface WorkSessionStartResult {
  session: WorkSession;
  /** True when an existing active session for the same project was replayed. */
  replayed: boolean;
}

export interface WorkSessionStopResult {
  session: WorkSession;
  /** True when the session was already ended (idempotent repeated stop). */
  replayed: boolean;
}

export interface WorkSessionSwitchResult {
  closed: WorkSession;
  active: WorkSession;
}

/**
 * P2.8A — Personal-only atomic WorkSession coordinator.
 *
 * Owns the ONE durable SQLite transaction that atomically persists Personal
 * work-session lifecycle operations (start / stop / switch) against the
 * work_sessions table. It is a separate durable structured-row model and is
 * deliberately NOT the Team TimeTrackingService: it never changes
 * project.status, never creates workflow transitions or revision cycles, and
 * never appends ordinary ProjectActivity rows.
 *
 * Transaction-neutrality contract: the store write primitives never
 * BEGIN/COMMIT/ROLLBACK themselves; this coordinator calls them from inside a
 * single synchronous `runInTransaction` (BEGIN IMMEDIATE ... COMMIT). The
 * whole body is synchronous and non-yielding, so no unrelated work on the
 * shared connection can interleave. On any failure the transaction ROLLBACKs.
 *
 * The global one-active invariant (AT MOST ONE active WorkSession across all
 * projects) is enforced BOTH by the service-level check here AND by the
 * database-level partial UNIQUE index on the constant active_key.
 *
 * Persistence authority is the database row: an active session survives web
 * refresh, API restart, Electron restart, and database close/reopen. This
 * coordinator never auto-closes on shutdown and never auto-starts on restart.
 */
export class PersonalWorkSessionCoordinator {
  public constructor(
    private readonly provider: StandaloneDataProvider,
    private readonly store: PersonalWorkspaceStore,
  ) {
    // The shared-connection invariant is validated at commit time (not at
    // construction) so that createApp can build this coordinator for any
    // StandaloneDataProvider without failing test assemblies that never issue
    // a Personal work-session operation. Only an actual atomic commit requires it.
    this.usable = provider.getSharedDatabase() === store.getSharedDatabase();
  }

  private readonly usable: boolean;

  private assertUsable(): void {
    if (!this.usable) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Personal work-session coordinator requires the provider and store to share one connection.',
        500,
      );
    }
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.provider.getProject(projectId);
    if (!project) {
      throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    }
    return project;
  }

  private conflictFor(active: WorkSession, project: Project | null): WorkSessionConflict {
    return {
      activeSession: active,
      activeProjectId: active.projectId,
      projectDisplayName: project?.projectName ?? null,
      startedAt: active.startedAt,
    };
  }

  /**
   * Starts a Personal work session for a project. Atomicity is required:
   * duplicate start for the SAME project replays the existing active session;
   * starting while ANOTHER project is active returns a deterministic conflict
   * and does NOT silently stop the other session.
   */
  public async start(input: PersonalWorkSessionStartInput): Promise<WorkSessionStartResult> {
    this.assertUsable();
    const project = await this.requireProject(input.projectId);

    const active = this.store.getActiveWorkSession();
    if (active) {
      if (active.projectId === input.projectId) {
        // Idempotent replay: the same project is already active.
        return { session: active, replayed: true };
      }
      const activeProject = await this.provider.getProject(active.projectId);
      throw new DomainError(
        'CONFLICT',
        'Another project already has an active work session. Stop it or switch explicitly.',
        409,
        this.conflictFor(active, activeProject) as unknown as Record<string, unknown>,
      );
    }

    const session: WorkSession = {
      ...(input.attribution ? { attribution: input.attribution } : {}),
      id: randomUUID(),
      projectId: project.id,
      startedAt: input.now,
      endedAt: null,
      pausedAt: null,
      accumulatedPausedMs: 0,
      createdAt: input.now,
    };

    try {
      this.store.runInTransaction(() => {
        // Re-check inside the transaction: the database backstop also guards this.
        const insideActive = this.store.getActiveWorkSession();
        if (insideActive) {
          throw new DomainError(
            'CONFLICT',
            'Another project already has an active work session.',
            409,
          );
        }
        this.store.insertActiveWorkSession(session);
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CONFLICT') {
        const current = this.store.getActiveWorkSession();
        if (current && current.projectId === input.projectId) {
          return { session: current, replayed: true };
        }
      }
      throw error;
    }
    return { session, replayed: false };
  }

  /**
   * Stops the active Personal work session. Atomicity is required. A repeated
   * stop is deterministic and safe: if the session is already ended, the
   * existing endedAt is preserved and no second end is fabricated.
   *
   * P2.8C: closing the session and incrementing Project.actualHours by the
   * completed duration happen in ONE transaction. If any step fails the whole
   * transaction (and the provider's in-memory project state) rolls back.
   */
  public async stop(input: PersonalWorkSessionStopInput): Promise<WorkSessionStopResult> {
    this.assertUsable();
    const active = this.store.getActiveWorkSession();
    if (!active) {
      throw new DomainError('NOT_FOUND', 'No active work session to stop.', 404);
    }

    // Capture pre-transaction provider memory for rollback.
    const preState = this.provider.captureWorkflowState();

    let result: WorkSession;
    let replayed = false;
    try {
      this.store.runInTransaction(() => {
        const insideActive = this.store.getActiveWorkSession();
        if (!insideActive) {
          throw new DomainError('NOT_FOUND', 'No active work session to stop.', 404);
        }
        result = this.store.closeActiveWorkSession(insideActive.id, input.now);
        replayed = insideActive.endedAt !== null;
        if (!replayed) {
          const delta = sessionDurationHours(insideActive, input.now);
          this.provider.applySessionActualHoursDelta(insideActive.projectId, delta, input.now);
        }
      });
    } catch (error) {
      this.provider.restoreWorkflowState(preState);
      throw error;
    }
    return { session: result!, replayed };
  }

  /**
   * Atomically switches from the active session (Project A) to a target
   * project (Project B) in ONE transaction: validate A, validate B, close A,
   * increment A's actualHours by A's completed duration, release the active
   * key, create B active, commit ALL together. If any step fails the whole
   * transaction (and the provider's in-memory project state) ROLLBACKs, so it
   * never leaves A stopped but B not started, nor A active + B active, nor A
   * ended with actualHours unchanged. Project B's actualHours is never touched
   * merely because B starts.
   */
  public async switchTo(input: PersonalWorkSessionSwitchInput): Promise<WorkSessionSwitchResult> {
    this.assertUsable();
    const target = await this.requireProject(input.targetProjectId);

    const active = this.store.getActiveWorkSession();
    if (!active) {
      throw new DomainError('NOT_FOUND', 'No active work session to switch from.', 404);
    }
    if (active.projectId === input.targetProjectId) {
      // Idempotent replay: already active on the target project.
      return { closed: active, active };
    }

    // Capture pre-transaction provider memory for rollback.
    const preState = this.provider.captureWorkflowState();

    const newSession: WorkSession = {
      ...(input.attribution ? { attribution: input.attribution } : {}),
      id: randomUUID(),
      projectId: target.id,
      startedAt: input.now,
      endedAt: null,
      pausedAt: null,
      accumulatedPausedMs: 0,
      createdAt: input.now,
    };

    let closed: WorkSession;
    let activeSession: WorkSession;
    try {
      this.store.runInTransaction(() => {
        const insideActive = this.store.getActiveWorkSession();
        if (!insideActive) {
          throw new DomainError('NOT_FOUND', 'No active work session to switch from.', 404);
        }
        if (insideActive.projectId === input.targetProjectId) {
          throw new DomainError(
            'CONFLICT',
            'The target project already has the active work session.',
            409,
          );
        }
        closed = this.store.closeActiveWorkSession(insideActive.id, input.now);
        const delta = sessionDurationHours(insideActive, input.now);
        this.provider.applySessionActualHoursDelta(insideActive.projectId, delta, input.now);
        this.store.insertActiveWorkSession(newSession);
        activeSession = newSession;
      });
    } catch (error) {
      this.provider.restoreWorkflowState(preState);
      throw error;
    }
    return { closed: closed!, active: activeSession! };
  }

  /**
   * Pauses the active Personal work session (RUNNING -> PAUSED) inside one
   * authoritative transaction. Requires a current session; a session that is
   * already PAUSED throws a typed 409 INVALID_STATE for a NEW command. The
   * same WorkSession UUID is preserved.
   */
  public async pause(input: PersonalWorkSessionPauseInput): Promise<WorkSessionStartResult> {
    this.assertUsable();
    const active = this.store.getActiveWorkSession();
    if (!active) {
      throw new DomainError('NOT_FOUND', 'No active work session to pause.', 404);
    }
    if (active.pausedAt !== null) {
      throw new DomainError('CONFLICT', 'Work session is already paused.', 409);
    }
    let session: WorkSession;
    this.store.runInTransaction(() => {
      const insideActive = this.store.getActiveWorkSession();
      if (!insideActive) {
        throw new DomainError('NOT_FOUND', 'No active work session to pause.', 404);
      }
      if (insideActive.pausedAt !== null) {
        throw new DomainError('CONFLICT', 'Work session is already paused.', 409);
      }
      session = this.store.pauseActiveWorkSession(insideActive.id, input.now);
    });
    return { session: session!, replayed: false };
  }

  /**
   * Resumes a PAUSED Personal work session (PAUSED -> RUNNING) inside one
   * authoritative transaction. Requires a current PAUSED session; a session
   * that is RUNNING throws a typed 409 INVALID_STATE for a NEW command. The
   * same WorkSession UUID is preserved.
   */
  public async resume(input: PersonalWorkSessionResumeInput): Promise<WorkSessionStartResult> {
    this.assertUsable();
    const active = this.store.getActiveWorkSession();
    if (!active) {
      throw new DomainError('NOT_FOUND', 'No active work session to resume.', 404);
    }
    if (active.pausedAt === null) {
      throw new DomainError('CONFLICT', 'Work session is not paused.', 409);
    }
    let session: WorkSession;
    this.store.runInTransaction(() => {
      const insideActive = this.store.getActiveWorkSession();
      if (!insideActive) {
        throw new DomainError('NOT_FOUND', 'No active work session to resume.', 404);
      }
      if (insideActive.pausedAt === null) {
        throw new DomainError('CONFLICT', 'Work session is not paused.', 409);
      }
      session = this.store.resumeActiveWorkSession(insideActive.id, input.now);
    });
    return { session: session!, replayed: false };
  }

  /** Returns the authoritative active WorkSession, or null when none is active. */
  public getActive(): WorkSession | null {
    return this.store.getActiveWorkSession();
  }

  /** Returns a project's WorkSessions, newest first. Reads never mutate state. */
  public listForProject(projectId: string): WorkSession[] {
    return this.store.listWorkSessions(projectId);
  }
}

/**
 * Converts a WorkSession's persisted timestamps to a hours delta for the
 * actualHours compatibility aggregate. The delta is derived ONLY from the same
 * startedAt/endedAt/pausedAt/accumulatedPausedMs that are persisted on the
 * WorkSession row — never from a second clock read. It subtracts both the
 * accumulated paused time from prior cycles AND any still-open paused interval
 * (pausedAt set, e.g. stopping while paused). Uses the repository's canonical
 * 2-decimal hours precision (matching the Team TimeTrackingService
 * convention). A valid very short session never produces negative or
 * forced-minimum time; it simply adds its real (possibly tiny) duration.
 */
function sessionDurationHours(session: WorkSession, endedAt: string): number {
  const endMs = Date.parse(endedAt);
  let activeMs = endMs - Date.parse(session.startedAt);
  activeMs -= session.accumulatedPausedMs;
  if (session.pausedAt !== null) {
    // Stop-while-paused: the final open paused interval [pausedAt, endedAt]
    // must not count as active work. The store's closeActiveWorkSession
    // accumulates it into the persisted row in the same transaction.
    activeMs -= Math.max(0, endMs - Date.parse(session.pausedAt));
  }
  const durationMs = Math.max(0, activeMs);
  return Math.round((durationMs / 3_600_000) * 100) / 100;
}
