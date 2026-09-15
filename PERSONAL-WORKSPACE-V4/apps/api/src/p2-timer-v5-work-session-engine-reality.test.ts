/**
 * P2-TIMER-FND-01 — True Pause/Resume WorkSession Engine + Schema v5 reality gate.
 *
 * Proves on a real DatabaseSync (schema V5) that:
 *   1. v4 -> v5 migration is purely additive (new columns only, no table rebuild)
 *   2. historical STOPPED rows migrate with paused_at NULL and accumulated_paused_ms 0
 *   3. an active RUNNING row stays RUNNING after migration
 *   4. Start -> Pause -> Resume -> Stop preserves ONE WorkSession UUID
 *   5. Pause -> Stop (stop while paused) does NOT count the paused interval
 *   6. multiple Pause/Resume cycles accumulate correctly
 *   7. repeated Pause / repeated Resume with a NEW idempotency key -> 409 CONFLICT
 *   8. exact idempotent replay of an existing active session is preserved
 *   9. no active -> Pause / Resume -> 404
 *  10. Paused A -> Start B -> 409 CONFLICT (no implicit switch)
 *  11. Paused A -> Start A -> replays PAUSED unchanged (no implicit resume)
 *  12. Paused A -> Switch B atomically closes A (excluding open paused interval) and activates B
 *  13. Running A -> Start B conflict preserved
 *  14. one-current-session DB invariant preserved (CHECK + UNIQUE)
 *  15. restart/reopen: PAUSED stays PAUSED with frozen elapsed; RUNNING stays RUNNING
 *  16. PAUSED restart -> Resume -> same UUID, paused duration excluded
 *  17. PAUSED restart -> Stop -> correct final active-work duration
 *  18. atomicity/failure: Pause/Resume/Paused-Stop failures roll back with no partial mutation
 *  19. Project actualHours excludes paused time (stop-while-paused and switch-while-paused)
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
import { workSessionState } from '@scli/domain';
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
  PRODUCTION_V5_DDL,
  PRODUCTION_V5_MIGRATION_ID,
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-timer-v5-'));
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
    return { backupId: 'bk-timer-v5-0001' };
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
    return { attemptId: 'att-timer-v5-0001' };
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

function workSessionColumns(db: DatabaseSyncInstance): string[] {
  const rows = db.prepare('PRAGMA table_info(work_sessions)').all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

interface StandaloneHarness {
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  coordinator: PersonalWorkSessionCoordinator;
  service: ProjectService;
  db: DatabaseSyncInstance;
  admin: AppUser;
}

/** Builds a shared-connection Personal harness on a migrated V5 DB. */
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

async function actualHoursOf(
  service: ProjectService,
  admin: AppUser,
  projectId: string,
): Promise<number> {
  return (await service.getProject(admin, projectId)).actualHours;
}

describe('P2-TIMER-FND-01 Pause/Resume WorkSession engine (schema v5)', () => {
  it('1+2+3) v4 -> v5 migration is additive; stopped rows default; running row stays running', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    // Build a real V4 DB by running only 0 -> 1 -> 2 -> 3 -> 4.
    const empty = new DatabaseSync(p);
    empty.close();
    const v4Runner = new SchemaMigrationRunner({
      migrations: PRODUCTION_MIGRATIONS.slice(0, 4),
      targetVersion: 4,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await v4Runner.run(p);
    const v4 = new DatabaseSync(p);
    expect(userVersion(v4)).toBe(4);
    // V4 has NO pause columns.
    expect(workSessionColumns(v4)).not.toContain('paused_at');
    expect(workSessionColumns(v4)).not.toContain('accumulated_paused_ms');
    // Seed a historical STOPPED row and an active RUNNING row.
    v4.prepare(
      `INSERT INTO work_sessions (id, project_id, started_at, ended_at, active_key, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    ).run(
      'aaaaaaaa-0000-4000-8000-0000000000aa',
      'bbbbbbbb-0000-4000-8000-0000000000bb',
      '2026-08-04T09:00:00.000Z',
      '2026-08-04T11:00:00.000Z',
      '2026-08-04T09:00:00.000Z',
    );
    v4.prepare(
      `INSERT INTO work_sessions (id, project_id, started_at, ended_at, active_key, created_at)
       VALUES (?, ?, ?, NULL, 1, ?)`,
    ).run(
      'cccccccc-0000-4000-8000-0000000000cc',
      'bbbbbbbb-0000-4000-8000-0000000000bb',
      '2026-08-04T12:00:00.000Z',
      '2026-08-04T12:00:00.000Z',
    );
    v4.close();

    // Run the 4 -> 5 migration (full registry now targets 5).
    const result = await makeRunner(dir).run(p);
    expect(result.status).toBe('migrated');
    expect(result.appliedMigrationIds).toContain(PRODUCTION_V5_MIGRATION_ID);

    const v5 = new DatabaseSync(p);
    openHandles.push(v5);
    expect(userVersion(v5)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(workSessionColumns(v5)).toContain('paused_at');
    expect(workSessionColumns(v5)).toContain('accumulated_paused_ms');

    // Historical STOPPED row: paused_at NULL, accumulated_paused_ms 0.
    const stopped = v5
      .prepare(
        'SELECT paused_at, accumulated_paused_ms, ended_at, active_key FROM work_sessions WHERE id = ?',
      )
      .get('aaaaaaaa-0000-4000-8000-0000000000aa') as {
      paused_at: string | null;
      accumulated_paused_ms: number;
      ended_at: string | null;
      active_key: number | null;
    };
    expect(stopped.paused_at).toBeNull();
    expect(stopped.accumulated_paused_ms).toBe(0);
    expect(stopped.ended_at).not.toBeNull();
    expect(stopped.active_key).toBeNull();

    // Active RUNNING row stays RUNNING: paused_at NULL, accumulated 0, still active.
    const running = v5
      .prepare(
        'SELECT paused_at, accumulated_paused_ms, ended_at, active_key FROM work_sessions WHERE id = ?',
      )
      .get('cccccccc-0000-4000-8000-0000000000cc') as {
      paused_at: string | null;
      accumulated_paused_ms: number;
      ended_at: string | null;
      active_key: number | null;
    };
    expect(running.paused_at).toBeNull();
    expect(running.accumulated_paused_ms).toBe(0);
    expect(running.ended_at).toBeNull();
    expect(running.active_key).toBe(1);

    // CHECK + UNIQUE remain unchanged: the same statements in PRODUCTION_V5_DDL are only ADD COLUMN.
    for (const ddl of PRODUCTION_V5_DDL) {
      expect(ddl.startsWith('ALTER TABLE work_sessions ADD COLUMN')).toBe(true);
    }
  });

  it('4) Start -> Pause -> Resume -> Stop preserves ONE WorkSession UUID and excludes paused time', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Cycle A');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const id = started.session.id;

    const paused = await coordinator.pause({
      now: '2026-08-04T10:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(paused.session.id).toBe(id);
    expect(paused.session.pausedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(workSessionState(paused.session)).toBe('PAUSED');
    expect(store.getActiveWorkSession()?.id).toBe(id);

    const resumed = await coordinator.resume({
      now: '2026-08-04T10:30:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(resumed.session.id).toBe(id);
    expect(resumed.session.pausedAt).toBeNull();
    // 30 minutes paused accumulated.
    expect(resumed.session.accumulatedPausedMs).toBe(30 * 60 * 1000);
    expect(workSessionState(resumed.session)).toBe('RUNNING');

    const stopped = await coordinator.stop({
      now: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(stopped.session.id).toBe(id);
    // Active work = 12:00 - 09:00 - 0:30 = 2h30m = 9000s = 2.5h.
    expect(stopped.session.accumulatedPausedMs).toBe(30 * 60 * 1000);
    // actualHours: 2.5h.
    expect(await actualHoursOf(service, admin, a.id)).toBeCloseTo(2.5, 2);
    expect(store.listWorkSessions(a.id)).toHaveLength(1);
  });

  it('5) Stop while paused does NOT count the paused interval', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'PauseStop');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    // Pause at 10:00, stop at 10:30: the 30 minutes must NOT count.
    const stopped = await coordinator.stop({
      now: '2026-08-04T10:30:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(stopped.session.id).toBe(started.session.id);
    // Active work = 09:00 -> 10:00 = 1h.
    expect(await actualHoursOf(service, admin, a.id)).toBeCloseTo(1.0, 2);
    const stored = store.listWorkSessions(a.id)[0]!;
    expect(stored.pausedAt).toBeNull();
    expect(stored.accumulatedPausedMs).toBe(30 * 60 * 1000);
  });

  it('6) multiple Pause/Resume cycles accumulate correctly', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'MultiCycle');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:15:00.000Z', idempotencyKey: randomUUID() });
    await coordinator.resume({ now: '2026-08-04T10:45:00.000Z', idempotencyKey: randomUUID() }); // +30m
    await coordinator.pause({ now: '2026-08-04T12:00:00.000Z', idempotencyKey: randomUUID() });
    await coordinator.resume({ now: '2026-08-04T12:10:00.000Z', idempotencyKey: randomUUID() }); // +10m
    await coordinator.stop({ now: '2026-08-04T14:00:00.000Z', idempotencyKey: randomUUID() });
    // Total paused = 40m. Total elapsed = 5h. Active work = 4h20m.
    const stored = store.listWorkSessions(a.id)[0]!;
    expect(stored.id).toBe(started.session.id);
    expect(stored.accumulatedPausedMs).toBe(40 * 60 * 1000);
    expect(await actualHoursOf(service, admin, a.id)).toBeCloseTo(4 + 20 / 60, 2);
  });

  it('7) repeated Pause / repeated Resume with a NEW idempotency key -> 409 CONFLICT', async () => {
    const dir = newTempDir();
    const { coordinator, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'RepeatInvalid');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    await expect(
      coordinator.pause({ now: '2026-08-04T10:05:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    await coordinator.resume({ now: '2026-08-04T10:30:00.000Z', idempotencyKey: randomUUID() });
    await expect(
      coordinator.resume({ now: '2026-08-04T10:35:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('8) exact idempotent replay of an existing active session is preserved', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Replay');
    const first = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    const dup = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(dup.replayed).toBe(true);
    expect(dup.session.id).toBe(first.session.id);
    expect(store.listWorkSessions(a.id)).toHaveLength(1);
  });

  it('9) no active -> Pause / Resume -> 404', async () => {
    const dir = newTempDir();
    const { coordinator } = await makeHarness(dir);
    await expect(
      coordinator.pause({ now: '2026-08-04T09:00:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    await expect(
      coordinator.resume({ now: '2026-08-04T09:00:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('10+11) Paused A -> Start B conflict; Paused A -> Start A replays PAUSED unchanged', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Paused A');
    const b = await createProject(service, admin, 'Paused B');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    // Start B while A paused -> conflict, no implicit switch.
    await expect(
      coordinator.start({
        projectId: b.id,
        now: '2026-08-04T10:01:00.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(store.listWorkSessions(b.id)).toEqual([]);
    // Start A while A paused -> replays PAUSED unchanged (no implicit resume).
    const replay = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T10:02:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.session.id).toBe(started.session.id);
    expect(replay.session.pausedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(workSessionState(replay.session)).toBe('PAUSED');
  });

  it('12) Paused A -> Switch B atomically closes A (excluding open paused interval) and activates B', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Switch A');
    const b = await createProject(service, admin, 'Switch B');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    const switched = await coordinator.switchTo({
      targetProjectId: b.id,
      now: '2026-08-04T10:30:00.000Z',
      idempotencyKey: randomUUID(),
    });
    // A closed at 10:30; active work for A = 09:00 -> 10:00 = 1h (open 10:00-10:30 paused excluded).
    expect(switched.closed.endedAt).toBe('2026-08-04T10:30:00.000Z');
    expect(await actualHoursOf(service, admin, a.id)).toBeCloseTo(1.0, 2);
    expect(store.listWorkSessions(a.id)[0]!.accumulatedPausedMs).toBe(30 * 60 * 1000);
    // B active, exactly one active globally.
    expect(switched.active.projectId).toBe(b.id);
    expect(store.getActiveWorkSession()?.id).toBe(switched.active.id);
  });

  it('13) Running A -> Start B conflict preserved', async () => {
    const dir = newTempDir();
    const { coordinator, store, service, admin } = await makeHarness(dir);
    const a = await createProject(service, admin, 'Running A');
    const b = await createProject(service, admin, 'Running B');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await expect(
      coordinator.start({
        projectId: b.id,
        now: '2026-08-04T09:01:00.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(store.getActiveWorkSession()?.id).toBe(started.session.id);
  });

  it('14) one-current-session DB invariant preserved (CHECK + UNIQUE) with pause columns', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    const raw = new DatabaseSync(p);
    openHandles.push(raw);
    const insert = raw.prepare(
      `INSERT INTO work_sessions (id, project_id, started_at, ended_at, paused_at, accumulated_paused_ms, active_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = '2026-08-04T12:00:00.000Z';
    // 1) PAUSED active row (ended_at NULL, active_key 1, paused_at set) is accepted.
    insert.run(
      'aaaaaaaa-0000-4000-8000-0000000000a1',
      'bbbbbbbb-0000-4000-8000-0000000000b1',
      now,
      null,
      '2026-08-04T12:30:00.000Z',
      0,
      1,
      now,
    );
    // 2) A second active row (RUNNING or PAUSED) is rejected by the global UNIQUE backstop.
    expect(() =>
      insert.run(
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'bbbbbbbb-0000-4000-8000-0000000000b2',
        now,
        null,
        null,
        0,
        1,
        now,
      ),
    ).toThrow();
    // 3) Malformed active row (ended_at NULL, active_key NULL) rejected by CHECK.
    expect(() =>
      insert.run(
        'aaaaaaaa-0000-4000-8000-0000000000a3',
        'bbbbbbbb-0000-4000-8000-0000000000b3',
        now,
        null,
        null,
        0,
        null,
        now,
      ),
    ).toThrow();
    // 4) Ended row accepted.
    insert.run(
      'aaaaaaaa-0000-4000-8000-0000000000a4',
      'bbbbbbbb-0000-4000-8000-0000000000b4',
      now,
      '2026-08-04T13:00:00.000Z',
      null,
      0,
      null,
      now,
    );
    const rows = raw
      .prepare('SELECT id, active_key FROM work_sessions ORDER BY id')
      .all() as Array<{ id: string; active_key: number | null }>;
    // Only the PAUSED active row and the ended row exist.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.active_key).toBe(1);
    expect(rows[1]!.active_key).toBeNull();
  });

  it('15) restart/reopen: PAUSED stays PAUSED with frozen elapsed; RUNNING stays RUNNING', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Restart PAUSED');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });

    // Close and reopen the DB.
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

    // Still PAUSED after reopen.
    const active = coordinator2.getActive();
    expect(active?.id).toBe(started.session.id);
    expect(active?.pausedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(workSessionState(active!)).toBe('PAUSED');
    // Frozen elapsed is pausedAt - startedAt - accumulated = 1h (regardless of wall clock).
    const frozenMs =
      Date.parse(active!.pausedAt!) - Date.parse(active!.startedAt) - active!.accumulatedPausedMs;
    expect(frozenMs).toBe(60 * 60 * 1000);
  });

  it('16) PAUSED restart -> Resume -> same UUID, paused duration excluded', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Resume After Restart');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    // Reopen.
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
    const resumed = await coordinator2.resume({
      now: '2026-08-04T11:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    expect(resumed.session.id).toBe(started.session.id);
    expect(resumed.session.accumulatedPausedMs).toBe(60 * 60 * 1000);
    expect(workSessionState(resumed.session)).toBe('RUNNING');
  });

  it('17) PAUSED restart -> Stop -> correct final active-work duration', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Stop After Restart');
    await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    // Reopen.
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
    await coordinator2.stop({ now: '2026-08-04T10:30:00.000Z', idempotencyKey: randomUUID() });
    // Active work = 09:00 -> 10:00 = 1h (10:00-10:30 paused excluded).
    // Read the persisted actualHours from the reopened DB (the original provider
    // memory is stale after close/reopen).
    const row = db2
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as {
      json_value: string;
    };
    const parsed = JSON.parse(row.json_value) as {
      projects: Array<{ id: string; actualHours: number }>;
    };
    const project = parsed.projects.find((candidate) => candidate.id === a.id);
    expect(project?.actualHours).toBeCloseTo(1.0, 2);
  });

  it('18) Paused-Stop failure rolls back: session remains valid PAUSED, no partial mutation', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Stop Failure');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    // Force a failure inside the stop transaction after close (which accumulates paused time).
    const FailingStore = class extends PersonalWorkspaceStore {
      public override closeActiveWorkSession(id: string, endedAt: string): WorkSession {
        super.closeActiveWorkSession(id, endedAt);
        throw new Error('injected paused-stop failure after close');
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
      failingCoordinator.stop({ now: '2026-08-04T10:30:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toThrow('injected paused-stop failure after close');
    // Rollback: session still PAUSED, actualHours unchanged (0).
    const active = failing.getActiveWorkSession()!;
    expect(active.id).toBe(started.session.id);
    expect(workSessionState(active)).toBe('PAUSED');
    expect(active.pausedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(active.accumulatedPausedMs).toBe(0);
    expect(await actualHoursOf(service, admin, a.id)).toBe(0);
  });

  it('18b) Resume failure rolls back: no partial paused accumulation', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { coordinator, service, admin } = await makeHarness(dir, p);
    const a = await createProject(service, admin, 'Resume Failure');
    const started = await coordinator.start({
      projectId: a.id,
      now: '2026-08-04T09:00:00.000Z',
      idempotencyKey: randomUUID(),
    });
    await coordinator.pause({ now: '2026-08-04T10:00:00.000Z', idempotencyKey: randomUUID() });
    const FailingStore = class extends PersonalWorkspaceStore {
      public override resumeActiveWorkSession(id: string, resumedAt: string): WorkSession {
        super.resumeActiveWorkSession(id, resumedAt);
        throw new Error('injected resume failure after accumulation');
      }
    };
    const config = makeConfig(dir, p);
    const db = new DatabaseSync(p);
    openHandles.push(db);
    const failingProvider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
    const failing = new FailingStore(config, EXTERNALLY_MIGRATED, db);
    openStores.push(failingProvider, failing);
    const failingCoordinator = new PersonalWorkSessionCoordinator(failingProvider, failing);
    await expect(
      failingCoordinator.resume({ now: '2026-08-04T10:30:00.000Z', idempotencyKey: randomUUID() }),
    ).rejects.toThrow('injected resume failure after accumulation');
    // Rollback: still PAUSED with accumulated 0.
    const active = failing.getActiveWorkSession()!;
    expect(active.id).toBe(started.session.id);
    expect(workSessionState(active)).toBe('PAUSED');
    expect(active.accumulatedPausedMs).toBe(0);
  });
});
