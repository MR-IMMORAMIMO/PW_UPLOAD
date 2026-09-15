/**
 * P2.8A — Durable Work Session Foundation + Atomic Timer Service reality gate.
 *
 * Proves the real production-style Personal work-session path on a real
 * DatabaseSync connection with the real migration, store, provider, and
 * coordinator:
 *   1. schema 2 -> 3 migration succeeds
 *   2. empty/current database reaches target V3
 *   3. legacy project loads with no fabricated sessions
 *   4. start A creates one active session
 *   5. duplicate start A does not create a second active session
 *   6. start B while A active conflicts and does not mutate A
 *   7. explicit switch A -> B atomically (A ended, B active)
 *   8. one-active database invariant holds globally across projects
 *   9. failed switch rolls back (A remains active, no B session created)
 *  10. stop B closes the session
 *  11. repeated stop is deterministic/idempotent
 *  12. cross-project histories remain isolated
 *  13. close database/startup and reopen: active session survives as active
 *  14. read operations do not mutate state
 *  15. project UUID relation is preserved
 *  16. workflow status remains unchanged
 *  17. actualHours remains unchanged
 *  18. externally migrated/readiness V3 fails closed if required table/index missing
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
  SchemaManagementError,
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p28a-'));
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
    return { backupId: 'bk-p28a-0001' };
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
    return { attemptId: 'att-p28a-0001' };
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

async function migrateToCurrentTarget(p: string, dir: string): Promise<void> {
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
}

function userVersion(db: DatabaseSyncInstance): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function tableNames(db: DatabaseSyncInstance): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function indexNames(db: DatabaseSyncInstance): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function expectSchemaManagementError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected SchemaManagementError to be thrown');
  } catch (error) {
    if (!(error instanceof SchemaManagementError)) throw error;
    expect(error.code).toBe(code);
  }
}

interface StandaloneHarness {
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  coordinator: PersonalWorkSessionCoordinator;
  service: ProjectService;
  db: DatabaseSyncInstance;
  admin: AppUser;
}

/** Builds a shared-connection Personal harness on a migrated V3 DB. */
async function makeHarness(dir: string, p = dbPathIn(dir)): Promise<StandaloneHarness> {
  await migrateToCurrentTarget(p, dir);
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

describe('P2.8A durable work session reality', () => {
  it('1) schema 2 migration reaches the current target and includes work sessions', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    // Build a real Version-2 database by running only the 0 -> 1 -> 2 chain.
    const empty = new DatabaseSync(p);
    empty.close();
    const v2Runner = new SchemaMigrationRunner({
      migrations: PRODUCTION_MIGRATIONS.slice(0, 2),
      targetVersion: 2,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await v2Runner.run(p);
    const v2 = new DatabaseSync(p);
    expect(userVersion(v2)).toBe(2);
    expect(tableNames(v2)).not.toContain('work_sessions');
    v2.close();

    // Migrate Version 2 through the current target (including the 2 -> 3 WorkSession step).
    const result = await makeRunner(dir).run(p);
    expect(result.status).toBe('migrated');
    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    const after = new DatabaseSync(p);
    expect(userVersion(after)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(tableNames(after)).toContain('work_sessions');
    expect(indexNames(after)).toContain('ix_work_sessions_project');
    expect(indexNames(after)).toContain('ux_work_sessions_one_active');
    after.close();

    // Fresh empty database reaches the current production target.
    const freshDir = newTempDir();
    const freshPath = dbPathIn(freshDir);
    const fresh = new DatabaseSync(freshPath);
    fresh.close();
    const freshResult = await makeRunner(freshDir).run(freshPath);
    expect(freshResult.status).toBe('migrated');
    expect(freshResult.toVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    const freshDb = new DatabaseSync(freshPath);
    expect(userVersion(freshDb)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    freshDb.close();
  });

  it('3) legacy project loads with no fabricated sessions and preserves actualHours', async () => {
    const dir = newTempDir();
    const { service, store, admin } = await makeHarness(dir);
    const project = await createProject(service, admin, 'Legacy Load');
    // No sessions exist for a freshly created project.
    expect(store.listWorkSessions(project.id)).toEqual([]);
    expect(store.getActiveWorkSession()).toBeNull();
    // actualHours is preserved exactly as-is (no session lifecycle touched it).
    expect(project.actualHours).toBe(0);
  });

  it('4) start A creates one active session; 5) duplicate start A does not create a second', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Start A');
    const first = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(first.replayed).toBe(false);
    expect(first.session.projectId).toBe(a.id);
    expect(first.session.endedAt).toBeNull();
    expect(store.getActiveWorkSession()?.id).toBe(first.session.id);
    expect(store.listWorkSessions(a.id)).toHaveLength(1);

    // Duplicate start for the SAME project replays, no second row.
    const dup = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:01.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(dup.replayed).toBe(true);
    expect(dup.session.id).toBe(first.session.id);
    expect(store.listWorkSessions(a.id)).toHaveLength(1);
  });

  it('6) start B while A active conflicts and does not mutate A', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Conflict A');
    const b = await createProject(service, admin, 'Conflict B');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await expect(
      coordinator.start({
        projectId: b.id,
        now: '2026-08-04T12:00:01.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    // A remains active, B has no session.
    expect(store.getActiveWorkSession()?.id).toBe(started.session.id);
    expect(store.listWorkSessions(b.id)).toEqual([]);
  });

  it('7) explicit switch A -> B atomically closes A and activates B', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Switch A');
    const b = await createProject(service, admin, 'Switch B');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const switched = await coordinator.switchTo({
      targetProjectId: b.id,
      now: '2026-08-04T12:30:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(switched.closed.id).toBe(started.session.id);
    expect(switched.closed.endedAt).toBe('2026-08-04T12:30:00.000Z');
    expect(switched.active.projectId).toBe(b.id);
    expect(switched.active.endedAt).toBeNull();
    // A ended, B active, exactly one active globally.
    expect(store.getActiveWorkSession()?.id).toBe(switched.active.id);
    expect(store.listWorkSessions(a.id)[0]!.endedAt).toBe('2026-08-04T12:30:00.000Z');
    expect(store.listWorkSessions(b.id)).toHaveLength(1);
  });

  it('8) one-active database invariant holds globally across projects', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Invariant A');
    const b = await createProject(service, admin, 'Invariant B');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    // Direct DB insert of a second active row across a different project must fail.
    const active = store.getActiveWorkSession()!;
    expect(() =>
      store
        .getSharedDatabase()
        .prepare(
          `INSERT INTO work_sessions (id, project_id, started_at, ended_at, active_key, created_at)
           VALUES (?, ?, ?, NULL, 1, ?)`,
        )
        .run(
          'ffffffff-0000-4000-8000-0000000000ff',
          b.id,
          '2026-08-04T12:00:00.000Z',
          '2026-08-04T12:00:00.000Z',
        ),
    ).toThrow();
    expect(store.getActiveWorkSession()?.id).toBe(active.id);
  });

  it('9) failed switch rolls back: A remains active, no B session created', async () => {
    const dir = newTempDir();
    const { coordinator, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Rollback A');
    const b = await createProject(service, admin, 'Rollback B');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    // Force a failure inside the switch transaction by injecting a failure via
    // a store subclass that throws after closing A but before inserting B.
    const FailingStore = class extends PersonalWorkspaceStore {
      public override closeActiveWorkSession(id: string, endedAt: string): WorkSession {
        // Close A succeeds, then fail before B is inserted, proving rollback.
        super.closeActiveWorkSession(id, endedAt);
        throw new Error('injected switch failure after close, before insert');
      }
    };
    const config = makeConfig(dir);
    const db = new DatabaseSync(dbPathIn(dir));
    openHandles.push(db);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const failing = new FailingStore(config, EXTERNALLY_MIGRATED, db);
    openStores.push(provider, failing);
    const failingCoordinator = new PersonalWorkSessionCoordinator(provider, failing);
    // Re-open the same DB: A is still active from the earlier start.
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    await expect(
      failingCoordinator.switchTo({
        targetProjectId: b.id,
        now: '2026-08-04T12:30:00.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('injected switch failure after close, before insert');
    // A remains active, no B session created.
    expect(failing.getActiveWorkSession()?.id).toBe(started.session.id);
    expect(failing.listWorkSessions(b.id)).toEqual([]);
  });

  it('10) stop B closes the session; 11) repeated stop is deterministic/idempotent', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const b = await createProject(service, admin, 'Stop B');
    const started = await coordinator.start({
      projectId: b.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const stopped = await coordinator.stop({
      now: '2026-08-04T13:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(stopped.replayed).toBe(false);
    expect(stopped.session.id).toBe(started.session.id);
    expect(stopped.session.endedAt).toBe('2026-08-04T13:00:00.000Z');
    expect(store.getActiveWorkSession()).toBeNull();

    // Repeated stop: no active session -> deterministic NOT_FOUND.
    await expect(
      coordinator.stop({ now: '2026-08-04T13:01:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    // The completed session's endedAt is unchanged.
    expect(store.listWorkSessions(b.id)[0]!.endedAt).toBe('2026-08-04T13:00:00.000Z');
  });

  it('12) cross-project histories remain isolated', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Isolated A');
    const b = await createProject(service, admin, 'Isolated B');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    await coordinator.start({
      projectId: b.id,
      now: '2026-08-04T13:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T13:30:00.000Z', idempotencyKey: randomUUID() });
    expect(store.listWorkSessions(a.id)).toHaveLength(1);
    expect(store.listWorkSessions(b.id)).toHaveLength(1);
    expect(store.listWorkSessions(a.id)[0]!.projectId).toBe(a.id);
    expect(store.listWorkSessions(b.id)[0]!.projectId).toBe(b.id);
  });

  it('13) close database/startup and reopen: active session survives as active', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Restart A');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    // Close the shared connection and reopen. The store/provider do not own the
    // shared handle, so close the underlying DatabaseSync directly.
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
    const coordinator2 = new PersonalWorkSessionCoordinator(provider2, store2);
    // The active session survives as active (no auto-close, no auto-start).
    const active = coordinator2.getActive();
    expect(active?.id).toBe(started.session.id);
    expect(active?.endedAt).toBeNull();
    expect(active?.projectId).toBe(a.id);
  });

  it('14) read operations do not mutate state', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Read Only');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const before = store.listWorkSessions(a.id).length;
    const activeBefore = store.getActiveWorkSession();
    // Reads return the same data and do not change row count or active state.
    expect(coordinator.getActive()?.id).toBe(activeBefore?.id);
    expect(coordinator.listForProject(a.id)).toHaveLength(before);
    expect(store.listWorkSessions(a.id)).toHaveLength(before);
    expect(store.getActiveWorkSession()?.id).toBe(activeBefore?.id);
  });

  it('15) project UUID relation is preserved', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'UUID Relation');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(started.session.projectId).toBe(a.id);
    expect(store.listWorkSessions(a.id)[0]!.projectId).toBe(a.id);
    // The stored project_id is a UUID.
    expect(started.session.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('16) workflow status remains unchanged; P2.8C stop increments actualHours (was unchanged in P2.8A)', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'No Status Change');
    const statusBefore = a.status;
    const actualHoursBefore = a.actualHours;
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.stop({ now: '2026-08-04T12:30:00.000Z', idempotencyKey: randomUUID() });
    const after = await service.getProject(admin, a.id);
    // Workflow status is never changed by a timer lifecycle.
    expect(after.status).toBe(statusBefore);
    // P2.8C: closing a 30-minute session increments actualHours by 0.5 as the
    // compatibility aggregate. (P2.8A asserted actualHours stayed unchanged;
    // that boundary was intentionally closed by P2.8C.)
    expect(after.actualHours).toBe(actualHoursBefore + 0.5);
    // No workflow transitions or revision cycles were created.
    expect(store.listWorkflowTransitions(a.id)).toEqual([]);
    expect(store.listRevisionCycles(a.id)).toEqual([]);
  });

  it('18) externally migrated/readiness V3 fails closed if required table/index missing', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    // Drop the work_sessions table to simulate a partial/invalid V3 database.
    const corrupt = new DatabaseSync(p);
    corrupt.exec('DROP TABLE work_sessions');
    corrupt.close();
    expectSchemaManagementError(
      () => new PersonalWorkspaceStore(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'REQUIRED_TABLE_MISSING',
    );
  });

  it('19) database CHECK + UNIQUE own the global one-active invariant (direct SQL)', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    const raw = new DatabaseSync(p);
    openHandles.push(raw);
    const insert = raw.prepare(
      `INSERT INTO work_sessions (id, project_id, started_at, ended_at, active_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = '2026-08-04T12:00:00.000Z';

    // 1) Canonical active row (ended_at NULL, active_key 1) is accepted.
    insert.run(
      'aaaaaaaa-0000-4000-8000-0000000000a1',
      'bbbbbbbb-0000-4000-8000-0000000000b1',
      now,
      null,
      1,
      now,
    );

    // 2) A second canonical active row is rejected by the global UNIQUE backstop.
    expect(() =>
      insert.run(
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'bbbbbbbb-0000-4000-8000-0000000000b2',
        now,
        null,
        1,
        now,
      ),
    ).toThrow();

    // 3) Malformed active row (ended_at NULL, active_key NULL) is rejected by CHECK.
    expect(() =>
      insert.run(
        'aaaaaaaa-0000-4000-8000-0000000000a3',
        'bbbbbbbb-0000-4000-8000-0000000000b3',
        now,
        null,
        null,
        now,
      ),
    ).toThrow();

    // 4) Ended row (ended_at NOT NULL, active_key NULL) is accepted.
    insert.run(
      'aaaaaaaa-0000-4000-8000-0000000000a4',
      'bbbbbbbb-0000-4000-8000-0000000000b4',
      now,
      '2026-08-04T13:00:00.000Z',
      null,
      now,
    );

    // 5) Malformed ended row (ended_at NOT NULL, active_key 1) is rejected by CHECK.
    expect(() =>
      insert.run(
        'aaaaaaaa-0000-4000-8000-0000000000a5',
        'bbbbbbbb-0000-4000-8000-0000000000b5',
        now,
        '2026-08-04T13:00:00.000Z',
        1,
        now,
      ),
    ).toThrow();

    // The database itself owns the invariant: only the canonical active row and
    // the canonical ended row exist.
    const rows = raw
      .prepare('SELECT id, ended_at, active_key FROM work_sessions ORDER BY id')
      .all() as Array<{ id: string; ended_at: string | null; active_key: number | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ended_at).toBeNull();
    expect(rows[0]!.active_key).toBe(1);
    expect(rows[1]!.ended_at).not.toBeNull();
    expect(rows[1]!.active_key).toBeNull();
  });
});
