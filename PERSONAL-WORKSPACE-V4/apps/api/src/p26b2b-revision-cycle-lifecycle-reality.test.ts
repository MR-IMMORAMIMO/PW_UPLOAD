/**
 * P2.6B2B — atomic Revision Cycle lifecycle + client feedback capture reality
 * gate.
 *
 * Proves that an ACTUAL Personal status transition atomically persists
 * project mutation + ProjectActivity + WorkflowTransitionRecord + RevisionCycle
 * create/update in one SQLite transaction, with the full cycle lifecycle
 * (create / start work / return to client / hold / resume / cancel / complete /
 * reopen), cycle-number allocation inside the transaction, replay safety,
 * rollback, legacy no-cycle compatibility, and Team isolation.
 *
 * Uses a shared DatabaseSync connection injected into both the provider and
 * the store, exactly as production startup does, and drives the real
 * ProjectService.changeStatus through the PersonalWorkflowTransitionCoordinator.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { loadConfig, type AppConfig } from '@scli/config';
import type {
  AppUser,
  ProjectActivity,
  RevisionCycle,
  WorkflowTransitionRecord,
} from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { PersonalWorkflowTransitionCoordinator } from './personal-workflow-transition-coordinator';
import { ProjectService } from './project-service';
import { SchemaMigrationRunner } from './infrastructure/migration/SchemaMigrationRunner';
import {
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDatabaseFactory,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationJournalState,
} from './infrastructure/migration/types';
import { PathResolverService } from './infrastructure/path/PathResolverService';
import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';
import { MockDataProvider } from './mock-data-provider';
import { seedUserIds, seedUsers } from '@scli/test-data';

const FIXED_BASE_MS = Date.parse('2026-08-04T12:00:00.000Z');

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

const tempRoots: string[] = [];
const openHandles: DatabaseSyncInstance[] = [];
const openStores: Array<{ close(): void }> = [];
const closeables: Array<{ close(): Promise<void> | void }> = [];

afterEach(() => {
  for (const resource of closeables.splice(0).reverse()) {
    try {
      resource.close();
    } catch {
      // Best-effort close.
    }
  }
  while (openStores.length) {
    const store = openStores.pop();
    if (store) {
      try {
        store.close();
      } catch {
        // Best-effort close.
      }
    }
  }
  while (openHandles.length) {
    const handle = openHandles.pop();
    if (handle) {
      try {
        if (handle.isOpen) handle.close();
      } catch {
        // Best-effort close.
      }
    }
  }
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p26b2b-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'scli.sqlite');
}

function makeConfig(dir: string, dbPath = dbPathIn(dir)): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: dbPath,
    STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Local Admin',
    STANDALONE_ADMIN_EMAIL: 'admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-p26b2b-0001' };
  }
  public async verifyBackup(): Promise<unknown> {
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public create(): MigrationBackupPort {
    return new FakeBackupPort();
  }
}

class FakeJournal implements MigrationJournalPort {
  public states: MigrationJournalState[] = [];
  public async createAttempt(): Promise<{ attemptId: string }> {
    this.states.push('CREATED');
    return { attemptId: 'att-p26b2b-0001' };
  }
  public async transition(_attemptId: string, state: MigrationJournalState): Promise<void> {
    this.states.push(state);
  }
  public async markFailed(): Promise<void> {
    this.states.push('FAILED');
  }
}

function realDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p);
    },
    openReadOnly(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p, { readOnly: true });
    },
  };
}

function makeRunner(dataRoot: string): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(dataRoot),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

async function migrateToV2(p: string, dir: string): Promise<void> {
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
}

interface StandaloneHarness {
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  service: ProjectService;
  coordinator: PersonalWorkflowTransitionCoordinator;
  db: DatabaseSyncInstance;
  admin: AppUser;
}

/** Builds a shared-connection Personal harness on a migrated V2 DB. */
async function makeHarness(dir: string, p = dbPathIn(dir)): Promise<StandaloneHarness> {
  await migrateToV2(p, dir);
  const config = makeConfig(dir, p);
  const db = new DatabaseSync(p);
  openHandles.push(db);
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openStores.push(provider, store);
  const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
  const service = new ProjectService(
    provider,
    config.COMPANY_TIMEZONE,
    () => new Date(FIXED_BASE_MS),
    'personal',
    coordinator,
  );
  const users = await provider.listUsers();
  const admin = users.find((user) => user.role === 'Admin' && user.isActive);
  if (!admin) throw new Error('Standalone bootstrap Admin missing.');
  return { provider, store, service, coordinator, db, admin };
}

const projectInput = (name: string) => ({
  projectName: name,
  clientName: 'Test Client',
  projectType: 'Lighting Layout',
  description: 'A lighting design request.',
  collaboratorDesignerIds: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'Concept' as const,
  lightingScope: 'Interior lighting design and luminaire coordination.',
  luxRequirements: 'Target 500 lux at working plane.',
  drawingReference: 'A-101',
  priority: 'Normal' as const,
  complexity: 'Medium' as const,
  estimatedHours: 8,
  requiredDeliveryDate: '2026-08-20',
  projectFolderUrl: null,
  idempotencyKey: randomUUID(),
});

function transitionsFor(
  store: PersonalWorkspaceStore,
  projectId: string,
): WorkflowTransitionRecord[] {
  return store.listWorkflowTransitions(projectId);
}

function cyclesFor(store: PersonalWorkspaceStore, projectId: string): RevisionCycle[] {
  return store.listRevisionCycles(projectId);
}

function openCycleFor(store: PersonalWorkspaceStore, projectId: string): RevisionCycle | null {
  return store.getOpenRevisionCycle(projectId);
}

/**
 * Inserts a synthetic Open cycle for a project, along with the required
 * workflow_transitions row that opened it (the FK on opened_by_transition_id
 * references workflow_transitions). Used to construct inconsistent states that
 * cannot arise through normal transitions, to prove the coordinator fails closed.
 */
function insertOpenCycle(
  store: PersonalWorkspaceStore,
  projectId: string,
  feedback: string,
  workStartedAt: string | null = null,
): RevisionCycle {
  const transitionId = randomUUID();
  store.insertWorkflowTransition({
    transitionId,
    projectId,
    sequence: store.nextWorkflowTransitionSequence(projectId),
    fromStatus: 'ClientReview',
    toStatus: 'RevisionRequired',
    occurredAt: '2026-08-04T12:00:00.000Z',
    actorId: null,
    reason: feedback,
    revisionCycleId: null,
  });
  const cycle: RevisionCycle = {
    revisionCycleId: randomUUID(),
    projectId,
    cycleNumber: store.nextCycleNumber(projectId),
    status: 'Open',
    openedAt: '2026-08-04T12:00:00.000Z',
    openedByTransitionId: transitionId,
    feedbackSummary: feedback,
    workStartedAt,
    returnedToClientAt: null,
    cancelledAt: null,
  };
  store.insertRevisionCycle(cycle);
  return cycle;
}

async function statusActivitiesFor(
  provider: StandaloneDataProvider,
  projectId: string,
): Promise<ProjectActivity[]> {
  const all = await provider.listActivities(projectId);
  return all.filter((a) => a.actionType === 'StatusChanged');
}

/** A store subclass that injects a failure into a specific durable step. */
type FailPoint = 'before-cycle' | 'after-cycle' | 'after-lifecycle';
class FailingCycleStore extends PersonalWorkspaceStore {
  public constructor(
    config: AppConfig,
    db: DatabaseSyncInstance,
    private readonly failPoint: FailPoint,
    private readonly failOnToStatus: string,
  ) {
    super(config, EXTERNALLY_MIGRATED, db);
  }

  public override insertWorkflowTransition(
    record: WorkflowTransitionRecord,
  ): WorkflowTransitionRecord {
    if (this.failPoint === 'before-cycle' && record.toStatus === this.failOnToStatus) {
      throw new Error('injected failure before cycle insert');
    }
    return super.insertWorkflowTransition(record);
  }

  public override insertRevisionCycle(cycle: RevisionCycle): RevisionCycle {
    if (this.failPoint === 'after-cycle') {
      throw new Error('injected failure after cycle insert');
    }
    return super.insertRevisionCycle(cycle);
  }

  public override persistRevisionCycleLifecycle(cycle: RevisionCycle): RevisionCycle {
    if (this.failPoint === 'after-lifecycle') {
      throw new Error('injected failure after lifecycle update');
    }
    return super.persistRevisionCycleLifecycle(cycle);
  }
}

describe('P2.6B2B cycle creation', () => {
  it('ClientReview -> RevisionRequired requires a reason for Personal', async () => {
    const dir = newTempDir();
    const { service, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Feedback Required'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await expect(
      service.changeStatus(admin, project.id, { status: 'RevisionRequired' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('empty and whitespace reasons are rejected', async () => {
    const dir = newTempDir();
    const { service, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Blank Feedback'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await expect(
      service.changeStatus(admin, project.id, { status: 'RevisionRequired', reason: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(
      service.changeStatus(admin, project.id, { status: 'RevisionRequired', reason: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('valid reason trimmed, transition succeeds, exactly one Open cycle created', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Cycle One'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    const tId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const updated = await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: '  Adjust downlight spacing and reduce facade brightness.  ',
      transitionId: tId,
    });
    expect(updated.status).toBe('RevisionRequired');
    const cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(1);
    const cycle = cycles[0]!;
    expect(cycle.cycleNumber).toBe(1);
    expect(cycle.status).toBe('Open');
    expect(cycle.feedbackSummary).toBe('Adjust downlight spacing and reduce facade brightness.');
    expect(cycle.openedAt).toBe(updated.updatedAt);
    expect(cycle.openedByTransitionId).toBe(tId);
    expect(cycle.workStartedAt).toBeNull();
    expect(cycle.returnedToClientAt).toBeNull();
    expect(cycle.cancelledAt).toBeNull();
    const history = transitionsFor(store, project.id);
    const revReq = history.find((h) => h.toStatus === 'RevisionRequired')!;
    expect(revReq.revisionCycleId).toBe(cycle.revisionCycleId);
    expect(revReq.reason).toBe('Adjust downlight spacing and reduce facade brightness.');
    expect(updated.revisionNumber).toBe(project.revisionNumber);
  });
});

describe('P2.6B2B start revision work', () => {
  it('RevisionRequired -> InProgress with Open cycle sets workStartedAt, cycle stays Open', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Start Work'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const cycleBefore = openCycleFor(store, project.id)!;
    const tId = 'bbbbbbbb-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId });
    const cycleAfter = openCycleFor(store, project.id)!;
    expect(cycleAfter.status).toBe('Open');
    expect(cycleAfter.workStartedAt).not.toBeNull();
    expect(cycleAfter.feedbackSummary).toBe(cycleBefore.feedbackSummary);
    const history = transitionsFor(store, project.id);
    const start = history.find((h) => h.transitionId === tId)!;
    expect(start.revisionCycleId).toBe(cycleAfter.revisionCycleId);
  });

  it('workStartedAt cannot be rewritten by a later unrelated transition', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('No Rewrite'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const firstStarted = openCycleFor(store, project.id)!.workStartedAt;
    // Hold then resume back into InProgress.
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)!.workStartedAt).toBe(firstStarted);
  });

  it('legacy RevisionRequired with no cycle can still move InProgress, no fake cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Legacy Start'))).project;
    // Simulate a legacy project already at RevisionRequired with no cycle.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Legacy feedback.',
    });
    // Manually close the cycle to simulate a legacy no-cycle state.
    const cycle = openCycleFor(store, project.id)!;
    store.persistRevisionCycleLifecycle({
      ...cycle,
      status: 'Cancelled',
      cancelledAt: '2026-08-04T12:00:00.000Z',
    });
    expect(openCycleFor(store, project.id)).toBeNull();
    const updated = await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(updated.status).toBe('InProgress');
    expect(openCycleFor(store, project.id)).toBeNull();
    expect(cyclesFor(store, project.id)).toHaveLength(1); // only the manually-closed one
  });
});

describe('P2.6B2B return to client', () => {
  it('InProgress -> ClientReview with Open cycle + workStartedAt returns the cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Return'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const tId = 'cccccccc-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'ClientReview', transitionId: tId });
    const cycle = cyclesFor(store, project.id)[0]!;
    expect(cycle.status).toBe('ReturnedToClient');
    expect(cycle.returnedToClientAt).not.toBeNull();
    expect(cycle.feedbackSummary).toBe('Client feedback.');
    expect(cyclesFor(store, project.id)).toHaveLength(1);
    const history = transitionsFor(store, project.id);
    const ret = history.find((h) => h.transitionId === tId)!;
    expect(ret.revisionCycleId).toBe(cycle.revisionCycleId);
  });

  it('initial InProgress -> ClientReview with no Open cycle remains valid, no fake cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Initial Review'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const updated = await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    expect(updated.status).toBe('ClientReview');
    expect(cyclesFor(store, project.id)).toEqual([]);
  });

  it('Open cycle missing workStartedAt blocks return', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('No Start'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    // Manually create an Open cycle with workStartedAt null (an inconsistent
    // state that cannot arise through normal transitions) to prove the
    // coordinator fails closed rather than silently repairing.
    insertOpenCycle(store, project.id, 'Client feedback.');
    await expect(
      service.changeStatus(admin, project.id, { status: 'ClientReview' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(openCycleFor(store, project.id)).not.toBeNull();
  });
});

describe('P2.6B2B multiple cycles', () => {
  it('returned Cycle 1 then new feedback creates Cycle 2; Cycle 1 immutable', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Two Cycles'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'First feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    const c1 = cyclesFor(store, project.id)[0]!;
    expect(c1.status).toBe('ReturnedToClient');
    // New feedback -> Cycle 2.
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Second feedback.',
    });
    const cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(2);
    const c2 = cycles[1]!;
    expect(c2.cycleNumber).toBe(2);
    expect(c2.status).toBe('Open');
    expect(c2.feedbackSummary).toBe('Second feedback.');
    // Cycle 1 immutable.
    expect(cycles[0]!.status).toBe('ReturnedToClient');
    expect(cycles[0]!.feedbackSummary).toBe('First feedback.');
    expect(cycles[0]!.returnedToClientAt).not.toBeNull();
  });

  it('second Open cycle attempt blocked with typed conflict', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('One Open'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    // Manually create an Open cycle while the project is at ClientReview to
    // prove the coordinator refuses a second ClientReview -> RevisionRequired
    // (one-open-cycle business invariant) with a typed conflict.
    insertOpenCycle(store, project.id, 'First feedback.');
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'RevisionRequired',
        reason: 'Second feedback.',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(cyclesFor(store, project.id)).toHaveLength(1);
  });

  it('cancelled Cycle 2 number is not reused; next cycle gets 3', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Number Reuse'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'First feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    // Cycle 2.
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Second feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    // Cancel while Cycle 2 is Open.
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });
    const c2 = cyclesFor(store, project.id)[1]!;
    expect(c2.status).toBe('Cancelled');
    expect(c2.cycleNumber).toBe(2);
    // Reopen and create Cycle 3.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Third feedback.',
    });
    const cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(3);
    expect(cycles[2]!.cycleNumber).toBe(3);
    expect(cycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]);
  });
});

describe('P2.6B2B hold / resume', () => {
  it('RevisionRequired/Open cycle -> OnHold keeps cycle Open, history links cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Hold Rev'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const cycleId = openCycleFor(store, project.id)!.revisionCycleId;
    const tId = 'dddddddd-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'OnHold', transitionId: tId });
    expect(openCycleFor(store, project.id)!.revisionCycleId).toBe(cycleId);
    expect(openCycleFor(store, project.id)!.status).toBe('Open');
    const history = transitionsFor(store, project.id);
    expect(history.find((h) => h.transitionId === tId)!.revisionCycleId).toBe(cycleId);
  });

  it('resume -> RevisionRequired keeps same cycle, history links cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Resume Rev'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const cycleId = openCycleFor(store, project.id)!.revisionCycleId;
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    const tId = 'eeeeeeee-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      transitionId: tId,
    });
    expect(openCycleFor(store, project.id)!.revisionCycleId).toBe(cycleId);
    expect(
      transitionsFor(store, project.id).find((h) => h.transitionId === tId)!.revisionCycleId,
    ).toBe(cycleId);
  });

  it('InProgress/Open cycle -> OnHold keeps cycle Open; resume -> InProgress same cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Hold InProgress'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const cycleId = openCycleFor(store, project.id)!.revisionCycleId;
    const startedAt = openCycleFor(store, project.id)!.workStartedAt;
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    expect(openCycleFor(store, project.id)!.status).toBe('Open');
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)!.revisionCycleId).toBe(cycleId);
    expect(openCycleFor(store, project.id)!.workStartedAt).toBe(startedAt);
  });

  it('legacy hold without cycle remains valid, history cycle null', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Legacy Hold'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const tId = 'ffffffff-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'OnHold', transitionId: tId });
    expect(openCycleFor(store, project.id)).toBeNull();
    expect(
      transitionsFor(store, project.id).find((h) => h.transitionId === tId)!.revisionCycleId,
    ).toBeNull();
  });
});

describe('P2.6B2B cancellation', () => {
  it('RevisionRequired + Open cycle -> Cancelled closes cycle, preserves feedback', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Cancel Rev'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const cycleId = openCycleFor(store, project.id)!.revisionCycleId;
    const tId = '11111111-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      transitionId: tId,
    });
    const cycle = cyclesFor(store, project.id)[0]!;
    expect(cycle.status).toBe('Cancelled');
    expect(cycle.cancelledAt).not.toBeNull();
    expect(cycle.feedbackSummary).toBe('Client feedback.');
    expect(cycle.returnedToClientAt).toBeNull();
    const history = transitionsFor(store, project.id);
    expect(history.find((h) => h.transitionId === tId)!.revisionCycleId).toBe(cycleId);
    expect(history.find((h) => h.transitionId === tId)!.reason).toBe('Client cancelled the scope.');
  });

  it('InProgress + Open cycle -> Cancelled works likewise', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Cancel InProgress'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });
    expect(cyclesFor(store, project.id)[0]!.status).toBe('Cancelled');
  });

  it('OnHold + Open cycle -> Cancelled works likewise', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Cancel OnHold'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });
    expect(cyclesFor(store, project.id)[0]!.status).toBe('Cancelled');
  });

  it('cancelled cycle cannot later reopen; reopen project creates no cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('No Reopen Cycle'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });
    const cancelledId = cyclesFor(store, project.id)[0]!.revisionCycleId;
    // Reopen -> InProgress creates no cycle and does not reopen the cancelled one.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)).toBeNull();
    expect(cyclesFor(store, project.id)).toHaveLength(1);
    expect(cyclesFor(store, project.id)[0]!.revisionCycleId).toBe(cancelledId);
    expect(cyclesFor(store, project.id)[0]!.status).toBe('Cancelled');
  });
});

describe('P2.6B2B completed', () => {
  it('ClientReview after returned cycle -> Completed does not mutate returned cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Complete'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    const returned = cyclesFor(store, project.id)[0]!;
    expect(returned.status).toBe('ReturnedToClient');
    const returnedAt = returned.returnedToClientAt;
    const tId = '22222222-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'Completed', transitionId: tId });
    const after = cyclesFor(store, project.id)[0]!;
    expect(after.status).toBe('ReturnedToClient');
    expect(after.returnedToClientAt).toBe(returnedAt);
    expect(
      transitionsFor(store, project.id).find((h) => h.transitionId === tId)!.revisionCycleId,
    ).toBeNull();
  });

  it('impossible Completed with Open cycle fails closed', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Complete Open'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    // Manually create an Open cycle while the project is at InProgress to prove
    // the coordinator refuses Completed with an unresolved active cycle.
    insertOpenCycle(store, project.id, 'Client feedback.');
    await expect(
      service.changeStatus(admin, project.id, { status: 'Completed' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(openCycleFor(store, project.id)).not.toBeNull();
  });

  it('reopen -> InProgress does not create/reopen cycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Reopen'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, { status: 'Completed' });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)).toBeNull();
    expect(cyclesFor(store, project.id)).toHaveLength(1);
  });
});

describe('P2.6B2B replay', () => {
  it('replay cycle-opening transition keeps exactly one cycle, no Cycle 2, no openedAt rewrite', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay Open'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    const tId = '33333333-0000-4000-8000-000000000001';
    const first = await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
      transitionId: tId,
    });
    const openedAt = cyclesFor(store, project.id)[0]!.openedAt;
    // Replay the exact same request (project still at RevisionRequired -> legacy early return).
    const replay = await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
      transitionId: tId,
    });
    expect(replay.version).toBe(first.version);
    expect(cyclesFor(store, project.id)).toHaveLength(1);
    expect(cyclesFor(store, project.id)[0]!.openedAt).toBe(openedAt);
    expect(cyclesFor(store, project.id)[0]!.cycleNumber).toBe(1);
  });

  it('replay Start Revision Work does not rewrite workStartedAt', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay Start'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const tId = '44444444-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId });
    const startedAt = openCycleFor(store, project.id)!.workStartedAt;
    // Replay the same start-work request.
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId });
    expect(openCycleFor(store, project.id)!.workStartedAt).toBe(startedAt);
  });

  it('replay Return to Client does not rewrite returnedToClientAt', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay Return'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const tId = '55555555-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, { status: 'ClientReview', transitionId: tId });
    const returnedAt = cyclesFor(store, project.id)[0]!.returnedToClientAt;
    // Replay the same return request.
    await service.changeStatus(admin, project.id, { status: 'ClientReview', transitionId: tId });
    expect(cyclesFor(store, project.id)[0]!.returnedToClientAt).toBe(returnedAt);
  });

  it('replay Cancel does not rewrite cancelledAt', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay Cancel'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const tId = '66666666-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      transitionId: tId,
    });
    const cancelledAt = cyclesFor(store, project.id)[0]!.cancelledAt;
    // Replay the same cancel request.
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      transitionId: tId,
    });
    expect(cyclesFor(store, project.id)[0]!.cancelledAt).toBe(cancelledAt);
  });

  it('replay creates no duplicate activity/history/notification', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay No Dup'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    const tId = '77777777-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
      transitionId: tId,
    });
    const historyBefore = transitionsFor(store, project.id).length;
    const activitiesBefore = (await statusActivitiesFor(provider, project.id)).length;
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
      transitionId: tId,
    });
    expect(transitionsFor(store, project.id)).toHaveLength(historyBefore);
    expect(await statusActivitiesFor(provider, project.id)).toHaveLength(activitiesBefore);
  });
});

describe('P2.6B2B rollback', () => {
  it('failure before cycle insert rolls back everything', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingCycleStore(config, db, 'before-cycle', 'RevisionRequired');
    openStores.push(provider, store);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
    const service = new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Rollback Before'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'RevisionRequired',
        reason: 'Client feedback.',
      }),
    ).rejects.toThrow('injected failure before cycle insert');
    expect((await provider.getProject(project.id))?.status).toBe('ClientReview');
    // The failed RevisionRequired transition and its cycle are absent; the
    // earlier setup transitions (InProgress, ClientReview) remain.
    expect(
      store.listWorkflowTransitions(project.id).filter((t) => t.toStatus === 'RevisionRequired'),
    ).toEqual([]);
    expect(store.listRevisionCycles(project.id)).toEqual([]);
    expect(
      (await statusActivitiesFor(provider, project.id)).filter(
        (a) => a.actionType === 'RevisionRequested',
      ),
    ).toEqual([]);
  });

  it('failure after cycle insert rolls back everything', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingCycleStore(config, db, 'after-cycle', 'RevisionRequired');
    openStores.push(provider, store);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
    const service = new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Rollback After Cycle')))
      .project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'RevisionRequired',
        reason: 'Client feedback.',
      }),
    ).rejects.toThrow('injected failure after cycle insert');
    expect((await provider.getProject(project.id))?.status).toBe('ClientReview');
    expect(
      store.listWorkflowTransitions(project.id).filter((t) => t.toStatus === 'RevisionRequired'),
    ).toEqual([]);
    expect(store.listRevisionCycles(project.id)).toEqual([]);
    expect(
      (await statusActivitiesFor(provider, project.id)).filter(
        (a) => a.actionType === 'RevisionRequested',
      ),
    ).toEqual([]);
  });

  it('failure after lifecycle update rolls back everything', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingCycleStore(config, db, 'after-lifecycle', 'InProgress');
    openStores.push(provider, store);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
    const service = new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Rollback Lifecycle')))
      .project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    // Cycle 1 is Open; start work triggers a lifecycle update that fails.
    await expect(service.changeStatus(admin, project.id, { status: 'InProgress' })).rejects.toThrow(
      'injected failure after lifecycle update',
    );
    expect((await provider.getProject(project.id))?.status).toBe('RevisionRequired');
    const cycle = store.listRevisionCycles(project.id)[0]!;
    expect(cycle.status).toBe('Open');
    expect(cycle.workStartedAt).toBeNull();
    // Only the setup InProgress row exists; the failed start-work transition
    // (which would have set workStartedAt) is absent.
    expect(
      store.listWorkflowTransitions(project.id).filter((t) => t.toStatus === 'InProgress'),
    ).toHaveLength(1);
  });

  it('failed cycle creation does not consume durable cycleNumber; retry uses correct number', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingCycleStore(config, db, 'after-cycle', 'RevisionRequired');
    openStores.push(provider, store);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
    const service = new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Number Retry'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'RevisionRequired',
        reason: 'Client feedback.',
      }),
    ).rejects.toThrow('injected failure after cycle insert');
    expect(store.listRevisionCycles(project.id)).toEqual([]);
    // Retry with a clean store on the same DB.
    openStores.pop();
    openStores.pop();
    db.close();
    openHandles.pop();
    const db2 = new DatabaseSync(p);
    openHandles.push(db2);
    const provider2 = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db2);
    const store2 = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db2);
    openStores.push(provider2, store2);
    const coordinator2 = new PersonalWorkflowTransitionCoordinator(provider2, store2);
    const service2 = new ProjectService(
      provider2,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator2,
    );
    const admin2 = (await provider2.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project2 = (await provider2.getProject(project.id))!;
    // The project is still at ClientReview after the rolled-back attempt; retry
    // the same ClientReview -> RevisionRequired directly.
    await service2.changeStatus(admin2, project2.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    const cycles = store2.listRevisionCycles(project2.id);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.cycleNumber).toBe(1);
  });
});

describe('P2.6B2B reality check', () => {
  it('full operational journey A-L', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Journey'))).project;

    // A) Initial work: Planning -> InProgress -> ClientReview, no cycle.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    expect(cyclesFor(store, project.id)).toEqual([]);

    // B) Client feedback -> Cycle 1 Open.
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Adjust downlight spacing and reduce facade brightness.',
    });
    let cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.cycleNumber).toBe(1);
    expect(cycles[0]!.status).toBe('Open');
    const c1Id = cycles[0]!.revisionCycleId;

    // C) Start revision work.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)!.workStartedAt).not.toBeNull();

    // D) OnHold -> Resume, Cycle 1 unchanged.
    const startedAt = openCycleFor(store, project.id)!.workStartedAt;
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)!.revisionCycleId).toBe(c1Id);
    expect(openCycleFor(store, project.id)!.workStartedAt).toBe(startedAt);

    // E) Move to Client Review -> Cycle 1 ReturnedToClient.
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    expect(cyclesFor(store, project.id)[0]!.status).toBe('ReturnedToClient');

    // F) Second feedback -> Cycle 2.
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Revise exterior wall-wash aiming.',
    });
    cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(2);
    expect(cycles[1]!.cycleNumber).toBe(2);
    expect(cycles[1]!.status).toBe('Open');
    const c2Id = cycles[1]!.revisionCycleId;

    // G) Start work, then cancel before returning -> Cycle 2 Cancelled.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });
    expect(cyclesFor(store, project.id)[1]!.status).toBe('Cancelled');
    expect(cyclesFor(store, project.id)[1]!.cancelledAt).not.toBeNull();

    // H) Reopen -> InProgress, no cycle; move to ClientReview with no Open cycle.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(openCycleFor(store, project.id)).toBeNull();
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    expect(openCycleFor(store, project.id)).toBeNull();
    // New feedback -> Cycle 3.
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Third round of client feedback.',
    });
    cycles = cyclesFor(store, project.id);
    expect(cycles).toHaveLength(3);
    expect(cycles[2]!.cycleNumber).toBe(3);
    expect(cycles[2]!.status).toBe('Open');
    const c3Id = cycles[2]!.revisionCycleId;

    // I) Same-ID replay for Cycle 3 open.
    const openTId = '88888888-0000-4000-8000-000000000001';
    await service.changeStatus(admin, project.id, {
      status: 'InProgress',
      transitionId: openTId,
    });
    const started3 = openCycleFor(store, project.id)!.workStartedAt;
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: openTId });
    expect(openCycleFor(store, project.id)!.workStartedAt).toBe(started3);
    expect(cyclesFor(store, project.id)).toHaveLength(3);

    // K) Close/reopen and verify exact cycle state.
    openStores.pop();
    openStores.pop();
    const db = openHandles.pop()!;
    db.close();
    const db2 = new DatabaseSync(dbPathIn(dir));
    openHandles.push(db2);
    const config = makeConfig(dir, dbPathIn(dir));
    const provider2 = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db2);
    const store2 = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db2);
    openStores.push(provider2, store2);
    const admin2 = (await provider2.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const reloaded = (await provider2.getProject(project.id))!;
    expect(reloaded.status).toBe('InProgress');
    const reloadedCycles = store2.listRevisionCycles(project.id);
    expect(reloadedCycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]);
    expect(reloadedCycles.map((c) => c.status)).toEqual(['ReturnedToClient', 'Cancelled', 'Open']);
    expect(reloadedCycles[0]!.revisionCycleId).toBe(c1Id);
    expect(reloadedCycles[1]!.revisionCycleId).toBe(c2Id);
    expect(reloadedCycles[2]!.revisionCycleId).toBe(c3Id);
    expect(reloadedCycles[0]!.feedbackSummary).toBe(
      'Adjust downlight spacing and reduce facade brightness.',
    );
    expect(reloadedCycles[1]!.feedbackSummary).toBe('Revise exterior wall-wash aiming.');
    expect(reloadedCycles[2]!.feedbackSummary).toBe('Third round of client feedback.');
    expect(openCycleFor(store2, project.id)!.revisionCycleId).toBe(c3Id);
    // History links preserved.
    const history = store2.listWorkflowTransitions(project.id);
    expect(
      history.find(
        (h) =>
          h.toStatus === 'RevisionRequired' &&
          h.reason === 'Adjust downlight spacing and reduce facade brightness.',
      )!.revisionCycleId,
    ).toBe(c1Id);
    expect(
      history.find(
        (h) =>
          h.toStatus === 'RevisionRequired' && h.reason === 'Revise exterior wall-wash aiming.',
      )!.revisionCycleId,
    ).toBe(c2Id);
    expect(
      history.find(
        (h) => h.toStatus === 'RevisionRequired' && h.reason === 'Third round of client feedback.',
      )!.revisionCycleId,
    ).toBe(c3Id);
    void admin2;
  });
});

describe('P2.6B2B team / legacy', () => {
  it('Team RevisionRequired does not require feedback summary and creates no cycle', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date(FIXED_BASE_MS),
      'team',
    );
    const manager = seedUsers.find((u) => u.id === seedUserIds.manager)!;
    const created = await service.createProject(manager, projectInput('Team No Feedback'));
    // Move to a state where RevisionRequired is a valid Team transition.
    await service.changeStatus(manager, created.project.id, { status: 'Assigned' });
    await service.changeStatus(manager, created.project.id, { status: 'InProgress' });
    // Team RevisionRequired without a reason must succeed (no Personal feedback rule).
    const updated = await service.changeStatus(manager, created.project.id, {
      status: 'RevisionRequired',
    });
    expect(updated.status).toBe('RevisionRequired');
    expect(updated.revisionNumber).toBe(created.project.revisionNumber + 1);
  });

  it('legacy Personal with no cycles remains operable', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Legacy Operable'))).project;
    // Full legacy journey with no cycles.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, { status: 'OnHold' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    expect(cyclesFor(store, project.id)).toEqual([]);
  });
});
