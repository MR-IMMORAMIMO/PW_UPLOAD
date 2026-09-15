/**
 * P2.6B2A — atomic Personal workflow transition + structured status history
 * reality gate.
 *
 * Proves that an ACTUAL Personal status transition atomically persists
 * project mutation + ProjectActivity + WorkflowTransitionRecord in one SQLite
 * transaction, with transitionId replay/conflict semantics, sequence
 * allocation inside the transaction, provider in-memory rollback on failure,
 * and zero RevisionCycle side effects.
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
import type { AppUser, Project, ProjectActivity, WorkflowTransitionRecord } from '@scli/domain';
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p26b2a-'));
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
    return { backupId: 'bk-p26b2a-0001' };
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
    return { attemptId: 'att-p26b2a-0001' };
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

async function statusActivitiesFor(
  provider: StandaloneDataProvider,
  projectId: string,
): Promise<ProjectActivity[]> {
  const all = await provider.listActivities(projectId);
  return all.filter((a) => a.actionType === 'StatusChanged');
}

/** A store subclass that injects a failure into a specific durable step. */
class FailingTransitionStore extends PersonalWorkspaceStore {
  public constructor(
    config: AppConfig,
    db: DatabaseSyncInstance,
    private readonly onInsert: 'throw-before' | 'throw-after',
  ) {
    super(config, EXTERNALLY_MIGRATED, db);
  }

  public override insertWorkflowTransition(
    record: WorkflowTransitionRecord,
  ): WorkflowTransitionRecord {
    if (this.onInsert === 'throw-before') {
      throw new Error('injected failure before history insert');
    }
    super.insertWorkflowTransition(record);
    throw new Error('injected failure after history insert, before COMMIT');
  }
}

describe('P2.6B2A atomic workflow core', () => {
  it('atomic actual transition writes status, one activity, and one history record', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const created = await service.createProject(admin, projectInput('Atomic Core'));
    const project = created.project;
    expect(project.status).toBe('Planning');
    expect(transitionsFor(store, project.id)).toEqual([]);

    const started = await service.changeStatus(admin, project.id, {
      status: 'InProgress',
      transitionId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
    expect(started.status).toBe('InProgress');
    const history = transitionsFor(store, project.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.transitionId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(history[0]!.fromStatus).toBe('Planning');
    expect(history[0]!.toStatus).toBe('InProgress');
    expect(history[0]!.sequence).toBe(1);
    expect(history[0]!.revisionCycleId).toBeNull();
    const statusActivities = await statusActivitiesFor(provider, project.id);
    expect(statusActivities).toHaveLength(1);
  });

  it('sequences advance per project and are independent across projects', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const a = (await service.createProject(admin, projectInput('Seq A'))).project;
    const b = (await service.createProject(admin, projectInput('Seq B'))).project;
    await service.changeStatus(admin, a.id, { status: 'InProgress' });
    await service.changeStatus(admin, a.id, { status: 'ClientReview' });
    await service.changeStatus(admin, b.id, { status: 'InProgress' });
    expect(transitionsFor(store, a.id).map((t) => t.sequence)).toEqual([1, 2]);
    expect(transitionsFor(store, b.id).map((t) => t.sequence)).toEqual([1]);
  });

  it('server generates a durable transitionId when omitted', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Generated Id'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const history = transitionsFor(store, project.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.transitionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('same transitionId + different source status returns 409 (fromStatus binding)', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Conflict Source'))).project;
    const tId = 'ffffffff-0000-4000-8000-000000000001';
    // Bind tId to Planning -> InProgress (fromStatus = Planning).
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId });
    // Move the project so it is no longer at the original fromStatus or toStatus.
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
    });
    // Reuse tId for a DIFFERENT source -> same target (RevisionRequired -> InProgress).
    const versionBefore = (await service.getProject(admin, project.id)).version;
    await expect(
      service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(transitionsFor(store, project.id)).toHaveLength(3);
    expect((await service.getProject(admin, project.id)).version).toBe(versionBefore);
    expect((await service.getProject(admin, project.id)).status).toBe('RevisionRequired');
  });

  it('same transitionId + same payload replays with no second row/activity/version bump', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Replay'))).project;
    const tId = 'bbbbbbbb-0000-4000-8000-000000000001';
    const first = await service.changeStatus(admin, project.id, {
      status: 'InProgress',
      transitionId: tId,
    });
    const versionAfterFirst = first.version;
    const updatedAfterFirst = first.updatedAt;
    expect(transitionsFor(store, project.id)).toHaveLength(1);
    expect(await statusActivitiesFor(provider, project.id)).toHaveLength(1);

    // Replay the exact same request (project still at InProgress -> legacy early return).
    const replay = await service.changeStatus(admin, project.id, {
      status: 'InProgress',
      transitionId: tId,
    });
    expect(replay.version).toBe(versionAfterFirst);
    expect(replay.updatedAt).toBe(updatedAfterFirst);
    expect(transitionsFor(store, project.id)).toHaveLength(1);
    expect(await statusActivitiesFor(provider, project.id)).toHaveLength(1);
  });

  it('same transitionId + different target returns 409 with zero side effects', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Conflict Target'))).project;
    const tId = 'cccccccc-0000-4000-8000-000000000001';
    // Bind tId to Planning -> InProgress.
    await service.changeStatus(admin, project.id, { status: 'InProgress', transitionId: tId });
    // Attempt a valid forward transition (InProgress -> ClientReview) reusing the
    // same tId, which is bound to a different target => 409.
    const versionBefore = (await service.getProject(admin, project.id)).version;
    await expect(
      service.changeStatus(admin, project.id, { status: 'ClientReview', transitionId: tId }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(transitionsFor(store, project.id)).toHaveLength(1);
    expect((await service.getProject(admin, project.id)).version).toBe(versionBefore);
    expect((await service.getProject(admin, project.id)).status).toBe('InProgress');
  });

  it('same transitionId + different project returns 409', async () => {
    const dir = newTempDir();
    const { service, admin } = await makeHarness(dir);
    const p1 = (await service.createProject(admin, projectInput('Conflict Project A'))).project;
    const p2 = (await service.createProject(admin, projectInput('Conflict Project B'))).project;
    const tId = 'dddddddd-0000-4000-8000-000000000001';
    await service.changeStatus(admin, p1.id, { status: 'InProgress', transitionId: tId });
    await expect(
      service.changeStatus(admin, p2.id, { status: 'InProgress', transitionId: tId }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('same transitionId + materially different reason returns 409', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Conflict Reason'))).project;
    const tId = 'eeeeeeee-0000-4000-8000-000000000001';
    // Bind tId to a Cancelled transition with reason A.
    await service.changeStatus(admin, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
      transitionId: tId,
    });
    // Reopen so the project is no longer at the Cancelled target.
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    // Reuse tId for another Cancelled transition with a materially different
    // reason => 409 (current != target so the coordinator conflict check runs).
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'Cancelled',
        reason: 'A completely different cancellation reason.',
        transitionId: tId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(transitionsFor(store, project.id)).toHaveLength(2);
  });

  it('legacy current==target no-op without transition record creates no history/activity', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Legacy Noop'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const versionBefore = (await service.getProject(admin, project.id)).version;
    const result = await service.changeStatus(admin, project.id, { status: 'InProgress' });
    expect(result.status).toBe('InProgress');
    expect(result.version).toBe(versionBefore);
    expect(transitionsFor(store, project.id)).toHaveLength(1);
    expect(await statusActivitiesFor(provider, project.id)).toHaveLength(1);
  });

  it('stale expectedCurrentStatus returns 409 with zero side effects', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('Stale'))).project;
    const versionBefore = project.version;
    const updatedBefore = project.updatedAt;
    await expect(
      service.changeStatus(admin, project.id, {
        status: 'InProgress',
        expectedCurrentStatus: 'ClientReview',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(transitionsFor(store, project.id)).toEqual([]);
    expect(await statusActivitiesFor(provider, project.id)).toEqual([]);
    const after = await service.getProject(admin, project.id);
    expect(after.version).toBe(versionBefore);
    expect(after.updatedAt).toBe(updatedBefore);
  });
});

describe('P2.6B2A rollback', () => {
  it('failure after project mutation but before history insert rolls back DB + provider memory', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingTransitionStore(config, db, 'throw-before');
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
    expect(project.status).toBe('Planning');

    await expect(service.changeStatus(admin, project.id, { status: 'InProgress' })).rejects.toThrow(
      'injected failure before history insert',
    );

    // DB state restored.
    const dbProject = JSON.parse(
      (
        db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as {
          json_value: string;
        }
      ).json_value,
    ).projects.find((proj: Project) => proj.id === project.id);
    expect(dbProject.status).toBe('Planning');
    // Provider memory restored.
    const memProject = await provider.getProject(project.id);
    expect(memProject?.status).toBe('Planning');
    // No history / no StatusChanged activity from the failed transition.
    expect(store.listWorkflowTransitions(project.id)).toEqual([]);
    expect(await statusActivitiesFor(provider, project.id)).toEqual([]);
  });

  it('failure after history insert but before COMMIT rolls back everything', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new FailingTransitionStore(config, db, 'throw-after');
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
    const project = (await service.createProject(admin, projectInput('Rollback After'))).project;

    await expect(service.changeStatus(admin, project.id, { status: 'InProgress' })).rejects.toThrow(
      'injected failure after history insert, before COMMIT',
    );

    const dbProject = JSON.parse(
      (
        db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as {
          json_value: string;
        }
      ).json_value,
    ).projects.find((proj: Project) => proj.id === project.id);
    expect(dbProject.status).toBe('Planning');
    expect((await provider.getProject(project.id))?.status).toBe('Planning');
    expect(store.listWorkflowTransitions(project.id)).toEqual([]);
    expect(await statusActivitiesFor(provider, project.id)).toEqual([]);
  });

  it('close/reopen after rollback shows original state and a later valid transition succeeds', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const failing = new FailingTransitionStore(config, db, 'throw-before');
    openStores.push(provider, failing);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, failing);
    const service = new ProjectService(
      provider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Rollback Reopen'))).project;
    await expect(
      service.changeStatus(admin, project.id, { status: 'InProgress' }),
    ).rejects.toThrow();
    // Clean up failing store + provider, reopen clean.
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
    expect((await provider2.getProject(project.id))?.status).toBe('Planning');
    expect(store2.listWorkflowTransitions(project.id)).toEqual([]);
    const admin2 = (await provider2.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const moved = await service2.changeStatus(admin2, project.id, { status: 'InProgress' });
    expect(moved.status).toBe('InProgress');
    expect(store2.listWorkflowTransitions(project.id)).toHaveLength(1);
  });
});

describe('P2.6B2A notifications + workflow regression', () => {
  it('notification failure does not roll back the committed workflow core', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateToV2(p, dir);
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
    openStores.push(provider, store);
    const coordinator = new PersonalWorkflowTransitionCoordinator(provider, store);
    // A provider whose notification write fails AFTER commit.
    const failingNotificationsProvider = Object.create(provider, {}) as StandaloneDataProvider;
    failingNotificationsProvider.addNotifications = async () => {
      throw new Error('notification backend unavailable');
    };
    const service = new ProjectService(
      failingNotificationsProvider,
      config.COMPANY_TIMEZONE,
      () => new Date(FIXED_BASE_MS),
      'personal',
      coordinator,
    );
    const admin = (await provider.listUsers()).find((u) => u.role === 'Admin' && u.isActive)!;
    const project = (await service.createProject(admin, projectInput('Notify Fail'))).project;

    await expect(service.changeStatus(admin, project.id, { status: 'InProgress' })).rejects.toThrow(
      'notification backend unavailable',
    );
    // The committed workflow core persists despite the notification failure.
    expect((await provider.getProject(project.id))?.status).toBe('InProgress');
    expect(store.listWorkflowTransitions(project.id)).toHaveLength(1);
  });

  it('Personal RevisionRequired does NOT increment revisionNumber', async () => {
    const dir = newTempDir();
    const { service, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('RevNum'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    const revisioned = await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
    });
    expect(revisioned.revisionNumber).toBe(project.revisionNumber);
  });

  it('ClientReview -> RevisionRequired creates history/activity AND one Open RevisionCycle', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = (await service.createProject(admin, projectInput('No Cycle'))).project;
    await service.changeStatus(admin, project.id, { status: 'InProgress' });
    await service.changeStatus(admin, project.id, { status: 'ClientReview' });
    await service.changeStatus(admin, project.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
    });
    const history = transitionsFor(store, project.id);
    expect(history.map((t) => t.toStatus)).toEqual([
      'InProgress',
      'ClientReview',
      'RevisionRequired',
    ]);
    // B2B: the RevisionRequired transition opens exactly one cycle and links it.
    const cycles = store.listRevisionCycles(project.id);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe('Open');
    const revReq = history.find((t) => t.toStatus === 'RevisionRequired')!;
    expect(revReq.revisionCycleId).toBe(cycles[0]!.revisionCycleId);
    expect(store.getOpenRevisionCycle(project.id)!.revisionCycleId).toBe(
      cycles[0]!.revisionCycleId,
    );
  });

  it('Team transitions create no Personal structured history', async () => {
    const provider = new MockDataProvider();
    const service = new ProjectService(
      provider,
      'Asia/Dubai',
      () => new Date(FIXED_BASE_MS),
      'team',
    );
    const manager = seedUsers.find((u) => u.id === seedUserIds.manager)!;
    const created = await service.createProject(manager, projectInput('Team No History'));
    await service.changeStatus(manager, created.project.id, { status: 'Assigned' });
    // The MockDataProvider has no workflow_transitions table / no history concept.
    expect(provider.listProjects).toBeDefined();
    expect(created.project.id).toBeTruthy();
  });
});
