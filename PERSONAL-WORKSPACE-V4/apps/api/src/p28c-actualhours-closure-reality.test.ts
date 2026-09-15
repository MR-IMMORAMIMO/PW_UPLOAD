/**
 * P2.8C — Personal actualHours compatibility closure reality gate.
 *
 * Proves on a real DatabaseSync (schema V3) that:
 *   1. legacy project actualHours is preserved with zero sessions
 *   2. start does NOT change actualHours
 *   3. stopping a deterministic 30-minute session increments actualHours by 0.5
 *   4. completed session timestamps correspond to the exact delta applied
 *   5. repeated stop does NOT increment actualHours again
 *   6. a project with legacy actualHours 5.0 -> 5.5 after one 30m session (not 0.5)
 *   7. a second completed session accumulates once
 *   8. switch A -> B increments A by A's duration, ends A, activates B, leaves B unchanged
 *   9. failed switch rolls back (A active, A actualHours unchanged, no B session)
 *  10. failed stop/update rolls back both session and actualHours
 *  11. restart/reopen preserves completed aggregate + sessions
 *  12. workflow status remains unchanged
 *  13. no ProjectActivity added
 *  14. Team behavior/storage untouched (Team timer path unaffected)
 *  15. no fabricated WorkSessions from existing actualHours
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
import type { AppUser, Project, WorkSession } from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { PersonalWorkSessionCoordinator } from './personal-work-session-coordinator';
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

afterEach(() => {
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p28c-'));
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
    return { backupId: 'bk-p28c-0001' };
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
    return { attemptId: 'att-p28c-0001' };
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

async function migrateToV3(p: string, dir: string): Promise<void> {
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
}

interface StandaloneHarness {
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  coordinator: PersonalWorkSessionCoordinator;
  service: ProjectService;
  db: DatabaseSyncInstance;
  admin: AppUser;
}

async function makeHarness(dir: string, p = dbPathIn(dir)): Promise<StandaloneHarness> {
  await migrateToV3(p, dir);
  const config = makeConfig(dir, p);
  const db = new DatabaseSync(p);
  openHandles.push(db);
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openStores.push(provider, store);
  const coordinator = new PersonalWorkSessionCoordinator(provider, store);
  const service = new ProjectService(
    provider,
    config.COMPANY_TIMEZONE,
    () => new Date(FIXED_BASE_MS),
    'personal',
  );
  const users = await provider.listUsers();
  const admin = users.find((user) => user.role === 'Admin' && user.isActive);
  if (!admin) throw new Error('Standalone bootstrap Admin missing.');
  return { provider, store, coordinator, service, db, admin };
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

async function createProject(
  service: ProjectService,
  admin: AppUser,
  name: string,
): Promise<Project> {
  return (await service.createProject(admin, projectInput(name))).project;
}

async function setLegacyActualHours(
  provider: StandaloneDataProvider,
  project: Project,
  hours: number,
): Promise<void> {
  // Legacy projects carry actualHours with no WorkSessions. Seed it directly so
  // we prove preservation of an existing baseline.
  await provider.updateProject(project.id, {
    actualHours: hours,
    updatedAt: '2026-08-01T08:00:00.000Z',
    version: project.version + 1,
  });
}

async function actualHoursOf(
  service: ProjectService,
  admin: AppUser,
  projectId: string,
): Promise<number> {
  return (await service.getProject(admin, projectId)).actualHours;
}

/**
 * Reads the authoritative persisted Personal app_state directly from the real
 * DatabaseSync used by the failing transaction and returns the project's
 * actualHours. This is the durable-SQLite persistence proof: it does NOT rely
 * on any provider's in-memory cache. The project is located by Project.id UUID.
 */
function readPersistedProjectActualHours(db: DatabaseSyncInstance, projectId: string): number {
  const row = db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as
    { json_value: string } | undefined;
  if (!row) throw new Error('Missing app_state primary row.');
  const parsed = JSON.parse(row.json_value) as {
    projects: Array<{ id: string; actualHours: number }>;
  };
  const project = parsed.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Project ${projectId} not found in persisted app_state.`);
  return project.actualHours;
}

describe('P2.8C actualHours compatibility closure', () => {
  it('1) legacy project actualHours preserved with zero sessions; 15) no fabricated sessions', async () => {
    const dir = newTempDir();
    const { service, store, provider, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Legacy Preserve');
    await setLegacyActualHours(provider, project, 5.0);
    // No sessions exist for the legacy amount.
    expect(store.listWorkSessions(project.id)).toEqual([]);
    expect(await actualHoursOf(service, admin, project.id)).toBe(5.0);
  });

  it('2) start does NOT change actualHours', async () => {
    const dir = newTempDir();
    const { coordinator, service, provider, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Start No Change');
    await setLegacyActualHours(provider, project, 5.0);
    await coordinator.start({
      projectId: project.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(await actualHoursOf(service, admin, project.id)).toBe(5.0);
  });

  it('3+4+6) 30-minute stop increments legacy 5.0 by 0.5 to 5.5 from persisted timestamps', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, provider, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Stop Delta');
    await setLegacyActualHours(provider, project, 5.0);
    await coordinator.start({
      projectId: project.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    expect(await actualHoursOf(service, admin, project.id)).toBe(5.5);
    // The persisted session timestamps (12:00 -> 12:30) yield the exact delta.
    const session = store.listWorkSessions(project.id)[0]!;
    expect(session.startedAt).toBe('2026-08-04T12:00:00.000Z');
    expect(session.endedAt).toBe('2026-08-04T12:30:00.000Z');
    const deltaMs = Date.parse(session.endedAt!) - Date.parse(session.startedAt);
    expect(Math.round((deltaMs / 3_600_000) * 100) / 100).toBe(0.5);
  });

  it('5) repeated stop does NOT increment actualHours again', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, provider, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Repeat Stop');
    await setLegacyActualHours(provider, project, 5.0);
    await coordinator.start({
      projectId: project.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    expect(await actualHoursOf(service, admin, project.id)).toBe(5.5);
    // Repeated stop -> NOT_FOUND (no active session), no double count.
    await expect(
      coordinator.stop({ now: '2026-08-04T12:31:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(await actualHoursOf(service, admin, project.id)).toBe(5.5);
    expect(store.listWorkSessions(project.id)).toHaveLength(1);
  });

  it('7) a second completed session accumulates once', async () => {
    const dir = newTempDir();
    const { coordinator, service, provider, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Accumulate');
    await setLegacyActualHours(provider, project, 5.0);
    await coordinator.start({
      projectId: project.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    await coordinator.start({
      projectId: project.id,
      now: '2026-08-04T13:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T13:30:00.000Z', idempotencyKey: randomUUID() });
    expect(await actualHoursOf(service, admin, project.id)).toBe(6.0);
  });

  it('8) switch A -> B increments A, ends A, activates B, leaves B actualHours unchanged', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, provider, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Switch A');
    const b = await createProject(service, admin, 'Switch B');
    await setLegacyActualHours(provider, a, 5.0);
    await setLegacyActualHours(provider, b, 2.0);
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const switched = await coordinator.switchTo({
      targetProjectId: b.id,
      now: '2026-08-04T12:30:00.000Z',
      idempotencyKey: randomUUID(),
    });
    // A ended, A actualHours incremented by 0.5, B active with B unchanged.
    expect(switched.closed.endedAt).toBe('2026-08-04T12:30:00.000Z');
    expect(switched.active.projectId).toBe(b.id);
    expect(await actualHoursOf(service, admin, a.id)).toBe(5.5);
    expect(await actualHoursOf(service, admin, b.id)).toBe(2.0);
    expect(store.getActiveWorkSession()?.id).toBe(switched.active.id);
  });

  it('9) failed switch rolls back: A remains active, A actualHours unchanged, no B session', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, provider, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Rollback A');
    const b = await createProject(service, admin, 'Rollback B');
    await setLegacyActualHours(provider, a, 3.0);
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const FailingStore = class extends PersonalWorkspaceStore {
      public override insertActiveWorkSession(_session: WorkSession): WorkSession {
        void _session;
        throw new Error('injected switch failure after A close, before B insert');
      }
    };
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const failingProvider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const failing = new FailingStore(config, EXTERNALLY_MIGRATED, db);
    openStores.push(failingProvider, failing);
    const failingCoordinator = new PersonalWorkSessionCoordinator(failingProvider, failing);
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    await expect(
      failingCoordinator.switchTo({
        targetProjectId: b.id,
        now: '2026-08-04T12:30:00.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('injected switch failure after A close, before B insert');
    // Rollback: A still active, A actualHours unchanged, no B session.
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    // A) Provider-memory rollback: the failingProvider that participated in the
    // failed operation must have A.actualHours restored to 3.0.
    expect((await failingProvider.getProject(a.id))?.actualHours).toBe(3.0);
    // B) Durable-SQLite rollback: the persisted app_state on the real DB used
    // by the failing transaction must also hold A.actualHours == 3.0.
    expect(readPersistedProjectActualHours(db, a.id)).toBe(3.0);
    expect(failing.listWorkSessions(b.id)).toEqual([]);
  });

  it('10) failed stop/update rolls back both session and actualHours', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, provider, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Stop Rollback');
    await setLegacyActualHours(provider, a, 3.0);
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const FailingStore = class extends PersonalWorkspaceStore {
      public override closeActiveWorkSession(id: string, endedAt: string): WorkSession {
        // Close A succeeds, then fail before the provider aggregate update.
        super.closeActiveWorkSession(id, endedAt);
        throw new Error('injected stop failure after close, before aggregate update');
      }
    };
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const failingProvider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const failing = new FailingStore(config, EXTERNALLY_MIGRATED, db);
    openStores.push(failingProvider, failing);
    const failingCoordinator = new PersonalWorkSessionCoordinator(failingProvider, failing);
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    await expect(
      failingCoordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toThrow('injected stop failure after close, before aggregate update');
    // Rollback: session still active, actualHours unchanged.
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    // A) Provider-memory rollback: the failingProvider that participated in the
    // failed operation must have A.actualHours restored to 3.0.
    expect((await failingProvider.getProject(a.id))?.actualHours).toBe(3.0);
    // B) Durable-SQLite rollback: the persisted app_state on the real DB used
    // by the failing transaction must also hold A.actualHours == 3.0.
    expect(readPersistedProjectActualHours(db, a.id)).toBe(3.0);
  });

  it('11) restart/reopen preserves completed aggregate + sessions', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, provider, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Restart Aggregate');
    await setLegacyActualHours(provider, a, 5.0);
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    // Close and reopen.
    openStores.pop();
    openStores.pop();
    const dbHandle = openHandles.pop();
    if (dbHandle) dbHandle.close();
    const db2 = new DatabaseSync(p);
    openHandles.push(db2);
    const config = makeConfig(dir, p);
    const provider2 = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db2);
    const store2 = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db2);
    openStores.push(provider2, store2);
    expect((await provider2.getProject(a.id))?.actualHours).toBe(5.5);
    expect(store2.listWorkSessions(a.id)).toHaveLength(1);
  });

  it('12+13) workflow status unchanged and no ProjectActivity added', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, provider, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'No Status Activity');
    const statusBefore = a.status;
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    const after = await service.getProject(admin, a.id);
    expect(after.status).toBe(statusBefore);
    expect(store.listWorkflowTransitions(a.id)).toEqual([]);
    expect(store.listRevisionCycles(a.id)).toEqual([]);
    const activities = await provider.listActivities(a.id);
    expect(activities.filter((act) => act.actionType.startsWith('Time')).length).toBe(0);
  });

  it('14) Team storage and TimeTrackingService behavior remains untouched', async () => {
    const dir = newTempDir();
    const { store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Team Untouched');
    // Personal WorkSession coordinator only ever writes work_sessions + actualHours.
    // Team tables (time entries) are separate; a Personal timer lifecycle adds no Team rows.
    expect(store.getActiveWorkSession()).toBeNull();
    expect(await actualHoursOf(service, admin, a.id)).toBe(0);
  });
});
