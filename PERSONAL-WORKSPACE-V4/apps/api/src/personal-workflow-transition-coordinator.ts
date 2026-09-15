import { randomUUID } from 'node:crypto';
import {
  DomainError,
  type AppUser,
  type Project,
  type ProjectActivity,
  type RevisionCycle,
  type WorkflowTransitionRecord,
} from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

export interface PersonalTransitionCommitInput {
  project: Project;
  actor: AppUser;
  target: Project['status'];
  now: string;
  patch: Partial<Project>;
  action: ProjectActivity['actionType'];
  activityMessage: string;
  reason: string | null;
  transitionId?: string | undefined;
}

export interface PersonalTransitionCommitResult {
  updated: Project;
  committed: boolean;
  /** True when an existing persisted transitionId record was replayed idempotently. */
  replayed: boolean;
  transitionId: string;
}

/** The cycle side effect computed for one actual transition, applied inside the transaction. */
interface CycleSideEffect {
  /** A brand-new Open cycle to insert (ClientReview -> RevisionRequired). */
  insert: RevisionCycle | null;
  /** An existing Open cycle whose lifecycle fields must be updated. */
  update: RevisionCycle | null;
  /** The revisionCycleId to stamp on the WorkflowTransitionRecord. */
  revisionCycleId: string | null;
}

/**
 * P2.6B2B — Personal-only atomic workflow transition coordinator.
 *
 * Owns the ONE durable SQLite transaction that atomically persists:
 *   - project mutation (project.status + activity + history) via app_state
 *   - ProjectActivity
 *   - WorkflowTransitionRecord
 *   - RevisionCycle create/update when applicable
 * for an ACTUAL Personal status transition.
 *
 * Transaction-neutrality contract: the store and provider write primitives never
 * BEGIN/COMMIT/ROLLBACK themselves; this coordinator calls them from inside a
 * single synchronous `runInTransaction` (BEGIN IMMEDIATE ... COMMIT). The whole
 * body is synchronous and non-yielding, so no unrelated work on the shared
 * connection can interleave. On any failure the transaction ROLLBACKs and the
 * provider's in-memory state is restored from the captured pre-transition state.
 *
 * This is NOT a current-status authority: project.status remains the sole
 * authority. ProjectService.changeStatus remains the UI/service choke point and
 * delegates durable application here for Personal.
 */
export class PersonalWorkflowTransitionCoordinator {
  public constructor(
    private readonly provider: StandaloneDataProvider,
    private readonly store: PersonalWorkspaceStore,
  ) {
    // The shared-connection invariant is validated at commit time (not at
    // construction) so that createApp can build this coordinator for any
    // StandaloneDataProvider without failing test assemblies that never issue
    // a Personal status transition. Only an actual atomic commit requires it.
    this.usable = provider.getSharedDatabase() === store.getSharedDatabase();
  }

  private readonly usable: boolean;

  private assertUsable(): void {
    if (!this.usable) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Personal workflow coordinator requires the provider and store to share one connection.',
        500,
      );
    }
  }

  /**
   * Applies an ACTUAL Personal status transition atomically. Returns the updated
   * project and durable transition identity. Throws on any failure after full
   * rollback (DB and provider memory both restored to pre-transition state).
   */
  public commitTransition(input: PersonalTransitionCommitInput): PersonalTransitionCommitResult {
    const project = input.project;
    const provider = this.provider;
    const store = this.store;

    // Capture pre-transition provider memory for rollback.
    this.assertUsable();
    const preState = provider.captureWorkflowState();

    const transitionId = input.transitionId ?? randomUUID();
    const reason = input.reason?.trim() || null;

    try {
      // The transaction body is fully synchronous: no await, no yield.
      const result = store.runInTransaction(() => {
        // 1) Sequence allocated INSIDE the transaction.
        const sequence = store.nextWorkflowTransitionSequence(project.id);

        // 2) Determine the current Open RevisionCycle inside the transaction.
        const openCycle = store.getOpenRevisionCycle(project.id);

        // 3) Determine the cycle side effect (may allocate cycleNumber inside
        //    the transaction when opening a new cycle).
        const sideEffect = this.resolveCycleSideEffect(
          project,
          input.target,
          input.now,
          reason,
          transitionId,
          openCycle,
        );

        const record: WorkflowTransitionRecord = {
          transitionId,
          projectId: project.id,
          sequence,
          fromStatus: project.status,
          toStatus: input.target,
          occurredAt: input.now,
          actorId: input.actor.id || null,
          reason,
          revisionCycleId: sideEffect.revisionCycleId,
        };

        // 4) Project mutation (status/activity in app_state, atomically with the
        //    same `now`).
        const updated = provider.applyWorkflowProjectMutation(project.id, input.patch);

        // 5) ProjectActivity.
        const activity: ProjectActivity = {
          id: randomUUID(),
          projectId: project.id,
          actionType: input.action,
          fieldName: 'status',
          oldValue: project.status,
          newValue: input.target,
          message: input.activityMessage,
          changedById: input.actor.id,
          changedByNameSnapshot: input.actor.displayName,
          createdAt: input.now,
        };
        provider.appendWorkflowActivity(activity);

        // 6) WorkflowTransitionRecord (insert-only; duplicates fail and roll back).
        store.insertWorkflowTransition(record);

        // 7) RevisionCycle insert/update when applicable.
        if (sideEffect.insert) {
          store.insertRevisionCycle(sideEffect.insert);
        }
        if (sideEffect.update) {
          store.persistRevisionCycleLifecycle(sideEffect.update);
        }

        // Note: notifications are intentionally NOT part of this transaction.
        // ProjectService emits them after COMMIT.
        return { updated, replayed: false, transitionId };
      });
      return { ...result, committed: true };
    } catch (error) {
      // Transaction ROLLBACK already happened in runInTransaction; restore the
      // provider's in-memory state so it matches the durable DB state.
      provider.restoreWorkflowState(preState);
      throw error;
    }
  }

  /**
   * Computes the RevisionCycle side effect for one actual transition, based only
   * on the actual Open cycle inside the transaction (never "latest cycle"
   * heuristics). Throws a typed 409 conflict for impossible cycle states.
   */
  private resolveCycleSideEffect(
    project: Project,
    target: Project['status'],
    now: string,
    reason: string | null,
    transitionId: string,
    openCycle: RevisionCycle | null,
  ): CycleSideEffect {
    const from = project.status;
    const conflict = (message: string): never => {
      throw new DomainError('CONFLICT', message, 409);
    };

    // ClientReview -> RevisionRequired: CREATE a new Open cycle.
    if (from === 'ClientReview' && target === 'RevisionRequired') {
      if (openCycle) {
        conflict(
          'A revision cycle is already open for this project. Resolve it before requesting new client feedback.',
        );
      }
      if (!reason) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A feedback summary is required when requesting client changes.',
          400,
        );
      }
      const cycle: RevisionCycle = {
        revisionCycleId: randomUUID(),
        projectId: project.id,
        cycleNumber: this.store.nextCycleNumber(project.id),
        status: 'Open',
        openedAt: now,
        openedByTransitionId: transitionId,
        feedbackSummary: reason,
        workStartedAt: null,
        returnedToClientAt: null,
        cancelledAt: null,
      };
      return { insert: cycle, update: null, revisionCycleId: cycle.revisionCycleId };
    }

    // RevisionRequired -> InProgress: START revision work on the Open cycle.
    if (from === 'RevisionRequired' && target === 'InProgress') {
      if (!openCycle) {
        // Legacy project with no structured cycle: allow, no cycle.
        return { insert: null, update: null, revisionCycleId: null };
      }
      // A genuinely new operation must not silently rewrite an already-started
      // cycle. If workStartedAt is already set, this is a continuation (e.g.
      // after hold/resume) — leave it unchanged rather than rewriting history.
      const update: RevisionCycle = {
        ...openCycle,
        workStartedAt: openCycle.workStartedAt ?? now,
      };
      return { insert: null, update, revisionCycleId: openCycle.revisionCycleId };
    }

    // InProgress -> ClientReview: RETURN work to the client.
    if (from === 'InProgress' && target === 'ClientReview') {
      if (!openCycle) {
        // Initial design work or a reopened project: allow, no cycle.
        return { insert: null, update: null, revisionCycleId: null };
      }
      if (!openCycle.workStartedAt) {
        conflict(
          'This revision cycle has not started work yet. Start revision work before returning to the client.',
        );
      }
      const update: RevisionCycle = {
        ...openCycle,
        status: 'ReturnedToClient',
        returnedToClientAt: now,
      };
      return { insert: null, update, revisionCycleId: openCycle.revisionCycleId };
    }

    // OnHold (from InProgress or RevisionRequired): cycle stays Open, unchanged.
    if (target === 'OnHold') {
      if (!openCycle) return { insert: null, update: null, revisionCycleId: null };
      return { insert: null, update: null, revisionCycleId: openCycle.revisionCycleId };
    }

    // Resume (OnHold -> InProgress or RevisionRequired): same Open cycle.
    if (from === 'OnHold' && (target === 'InProgress' || target === 'RevisionRequired')) {
      if (!openCycle) return { insert: null, update: null, revisionCycleId: null };
      return { insert: null, update: null, revisionCycleId: openCycle.revisionCycleId };
    }

    // Cancelled (from any): close the Open cycle.
    if (target === 'Cancelled') {
      if (!openCycle) return { insert: null, update: null, revisionCycleId: null };
      if (openCycle.returnedToClientAt) {
        conflict('This revision cycle was already returned to the client and cannot be cancelled.');
      }
      const update: RevisionCycle = {
        ...openCycle,
        status: 'Cancelled',
        cancelledAt: now,
      };
      return { insert: null, update, revisionCycleId: openCycle.revisionCycleId };
    }

    // Completed: must not complete with an unresolved Open cycle.
    if (target === 'Completed') {
      if (openCycle) {
        conflict(
          'This project has an open revision cycle. Resolve it before completing the project.',
        );
      }
      return { insert: null, update: null, revisionCycleId: null };
    }

    // Reopen (Completed/Cancelled -> InProgress): never create/reopen a cycle.
    if (from === 'Completed' || from === 'Cancelled') {
      if (openCycle) {
        conflict('An open revision cycle cannot be reopened from a terminal project state.');
      }
      return { insert: null, update: null, revisionCycleId: null };
    }

    // Any other transition: no cycle side effect.
    return { insert: null, update: null, revisionCycleId: null };
  }

  /**
   * Same-ID idempotent replay detection. When the caller supplies a
   * transitionId that already exists, verify the payload matches; return the
   * current project as a no-op replay, or throw 409 CONFLICT on mismatch.
   */
  public resolveReplay(
    project: Project,
    target: Project['status'],
    reason: string | null,
    transitionId: string,
  ): { replayed: boolean; existing?: WorkflowTransitionRecord } {
    this.assertUsable();
    const existing = this.store.getWorkflowTransition(transitionId);
    if (!existing) return { replayed: false };

    const normalizedReason = reason?.trim() || null;
    const conflict = (message: string): never => {
      throw new DomainError('CONFLICT', message, 409);
    };

    if (existing.projectId !== project.id) {
      conflict('This transitionId belongs to a different project.');
    }
    if (existing.toStatus !== target) {
      conflict('This transitionId is already bound to a different target status.');
    }
    // Bind the transitionId to its ORIGINAL source intent. A same-ID replay is
    // only valid when the project is currently at the record's fromStatus (the
    // operation is being retried from its start) or at the record's toStatus
    // (the operation already completed). Any other current status means this
    // transitionId is being reused for a DIFFERENT from->to operation, which
    // must conflict rather than be silently accepted as a replay.
    if (project.status !== existing.fromStatus && project.status !== existing.toStatus) {
      conflict('This transitionId is already bound to a different source status.');
    }
    if ((existing.reason ?? null) !== normalizedReason) {
      conflict('This transitionId is already bound to a different reason.');
    }
    return { replayed: true, existing };
  }
}
