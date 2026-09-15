/**
 * P2.6B0 storage/migration reality gate.
 *
 * Proves the shared SQLite connection and the production migration 1 -> 2:
 * - existing V1 -> V2 preserves app_state/project/activity data
 * - fresh 0 -> 1 -> 2 chain
 * - rollback 2 -> 1 removes only V2 tables/indexes
 * - invalid/partial V2 fails closed in EXTERNALLY_MIGRATED readiness
 * - one-open-cycle partial unique index
 * - project sequence uniqueness
 * - production-style construction shares exactly one runtime connection
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { loadConfig, type AppConfig } from '@scli/config';
import { StandaloneDataProvider, openStandaloneDatabase } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
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
  PRODUCTION_V2_INDEX_NAMES,
  PRODUCTION_V2_TABLE_NAMES,
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p26b0-'));
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
    return { backupId: 'bk-p26b0-0001' };
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
    return { attemptId: 'att-p26b0-0001' };
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

function openDb(p: string): DatabaseSyncInstance {
  const db = new DatabaseSync(p);
  openHandles.push(db);
  return db;
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

function appStateJson(db: DatabaseSyncInstance): string | null {
  const row = db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as
    { json_value: string } | undefined;
  return row?.json_value ?? null;
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

describe('P2.6B0 storage + migration reality', () => {
  it('A) existing V1 -> V2 preserves app_state, project status, and ProjectActivity', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    // Build a real Version-1 database by running the 0 -> 1 migration, then seed
    // representative app_state project/activity data.
    const empty = new DatabaseSync(p);
    empty.close();
    const v1Runner = new SchemaMigrationRunner({
      migrations: [PRODUCTION_MIGRATIONS[0]!],
      targetVersion: 1,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await v1Runner.run(p);
    const seed = openDb(p);
    const state = {
      users: [],
      projects: [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          projectCode: '001_SCLI260801_TEST',
          projectName: 'V1 Project',
          status: 'InProgress',
          revisionNumber: 0,
          version: 3,
        },
      ],
      activities: [
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000001',
          projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
          actionType: 'StatusChanged',
          message: 'Status changed from Planning to InProgress.',
          createdAt: '2026-08-01T08:00:00.000Z',
        },
      ],
      comments: [],
      notifications: [],
      settings: { companyTimezone: 'Asia/Dubai', projectTypes: [] },
      lastSequence: 1,
    };
    seed
      .prepare('INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)')
      .run('primary', JSON.stringify(state), '2026-08-04T12:00:00.000Z');
    seed.close();

    await makeRunner(dir).run(p);

    const after = openDb(p);
    expect(userVersion(after)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(tableNames(after)).toContain('workflow_transitions');
    expect(tableNames(after)).toContain('revision_cycles');
    expect(tableNames(after)).toContain('work_sessions');
    expect(indexNames(after)).toContain('ix_workflow_transitions_project');
    expect(indexNames(after)).toContain('ux_revision_cycles_one_open');
    expect(indexNames(after)).toContain('ix_work_sessions_project');
    expect(indexNames(after)).toContain('ux_work_sessions_one_active');
    const preserved = JSON.parse(appStateJson(after)!) as {
      projects: Array<{ id: string; status: string; version: number }>;
      activities: Array<{ id: string; actionType: string }>;
    };
    expect(preserved.projects[0]!.id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(preserved.projects[0]!.status).toBe('InProgress');
    expect(preserved.projects[0]!.version).toBe(3);
    expect(preserved.activities[0]!.actionType).toBe('StatusChanged');
    expect(preserved.activities[0]!.id).toBe('bbbbbbbb-0000-4000-8000-000000000001');
  });

  it('B) fresh migration chain reaches the current production target', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    const result = await makeRunner(dir).run(p);
    expect(result.status).toBe('migrated');
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(result.appliedMigrationIds).toHaveLength(PRODUCTION_MIGRATIONS.length);
    const after = openDb(p);
    expect(userVersion(after)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    for (const table of PRODUCTION_V2_TABLE_NAMES) expect(tableNames(after)).toContain(table);
    for (const index of PRODUCTION_V2_INDEX_NAMES) expect(indexNames(after)).toContain(index);
    expect(tableNames(after)).toContain('work_sessions');
    expect(indexNames(after)).toContain('ix_work_sessions_project');
    expect(indexNames(after)).toContain('ux_work_sessions_one_active');
  });

  it('C) rollback 2 -> 1 removes only V2 tables/indexes and preserves V1 data', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    // Build a real Version-1 database with representative app_state data.
    const empty = new DatabaseSync(p);
    empty.close();
    const v1Runner = new SchemaMigrationRunner({
      migrations: [PRODUCTION_MIGRATIONS[0]!],
      targetVersion: 1,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await v1Runner.run(p);
    const seed = openDb(p);
    seed.prepare('INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)').run(
      'primary',
      JSON.stringify({
        projects: [{ id: 'p1', status: 'Planning' }],
        activities: [],
        lastSequence: 0,
      }),
      '2026-08-04T12:00:00.000Z',
    );
    seed.close();

    // Simulate a failed 1 -> 2 migration: the V2 up() throws after creating a table.
    const v2 = PRODUCTION_MIGRATIONS[1]!;
    const broken = {
      ...v2,
      up: (context: { database: DatabaseSyncInstance }) => {
        context.database.exec(
          'CREATE TABLE workflow_transitions (transition_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sequence INTEGER NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, occurred_at TEXT NOT NULL, actor_id TEXT, reason TEXT, revision_cycle_id TEXT, UNIQUE(project_id, sequence))',
        );
        throw new Error('simulated V2 failure after partial work');
      },
    };
    const runner = new SchemaMigrationRunner({
      migrations: [PRODUCTION_MIGRATIONS[0]!, broken],
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
    await expect(runner.run(p)).rejects.toMatchObject({ code: 'MIGRATION_EXECUTION_FAILED' });

    const after = openDb(p);
    expect(userVersion(after)).toBe(1);
    expect(tableNames(after)).not.toContain('workflow_transitions');
    expect(tableNames(after)).not.toContain('revision_cycles');
    expect(appStateJson(after)).toBeTruthy();
  });

  it('D) invalid/partial V2 fails closed in EXTERNALLY_MIGRATED readiness', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    // Drop a V2 table to simulate a partial/invalid V2 database.
    const corrupt = openDb(p);
    corrupt.exec('DROP TABLE workflow_transitions');
    corrupt.close();
    expectSchemaManagementError(
      () => new PersonalWorkspaceStore(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'REQUIRED_TABLE_MISSING',
    );
  });

  it('E) one-open-cycle partial unique index enforces at most one Open cycle per project', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    const db2 = openDb(p);
    db2.exec('PRAGMA foreign_keys = ON');
    const insertTransition = db2.prepare(`
      INSERT INTO workflow_transitions
      (transition_id, project_id, sequence, from_status, to_status, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertTransition.run(
      't1',
      'project-p',
      1,
      'ClientReview',
      'RevisionRequired',
      '2026-08-01T08:00:00.000Z',
    );
    insertTransition.run(
      't2',
      'project-p',
      2,
      'RevisionRequired',
      'InProgress',
      '2026-08-01T09:00:00.000Z',
    );
    insertTransition.run(
      't3',
      'project-q',
      1,
      'ClientReview',
      'RevisionRequired',
      '2026-08-01T08:00:00.000Z',
    );
    insertTransition.run(
      't4',
      'project-p',
      3,
      'InProgress',
      'ClientReview',
      '2026-08-01T10:00:00.000Z',
    );
    const insertCycle = db2.prepare(`
      INSERT INTO revision_cycles
      (revision_cycle_id, project_id, cycle_number, status, opened_at, opened_by_transition_id, feedback_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCycle.run('c1', 'project-p', 1, 'Open', '2026-08-01T08:00:00.000Z', 't1', 'feedback one');
    // Second Open cycle for the same project must fail.
    expect(() =>
      insertCycle.run(
        'c2',
        'project-p',
        2,
        'Open',
        '2026-08-01T09:00:00.000Z',
        't2',
        'feedback two',
      ),
    ).toThrow();
    // A different project may have an Open cycle.
    insertCycle.run('c3', 'project-q', 1, 'Open', '2026-08-01T08:00:00.000Z', 't3', 'feedback q');
    // A ReturnedToClient cycle for the same project is allowed alongside the Open one.
    insertCycle.run(
      'c4',
      'project-p',
      3,
      'ReturnedToClient',
      '2026-08-01T10:00:00.000Z',
      't4',
      'returned',
    );
  });

  it('F) project sequence uniqueness blocks same project + same sequence', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    const db2 = openDb(p);
    const insert = db2.prepare(`
      INSERT INTO workflow_transitions
      (transition_id, project_id, sequence, from_status, to_status, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run('t1', 'project-a', 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z');
    // Same project + same sequence must fail.
    expect(() =>
      insert.run('t2', 'project-a', 1, 'InProgress', 'ClientReview', '2026-08-01T09:00:00.000Z'),
    ).toThrow();
    // Different project + same sequence is allowed.
    insert.run('t3', 'project-b', 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z');
  });

  it('production-style construction shares exactly one runtime connection', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    db.close();
    await makeRunner(dir).run(p);
    const config = makeConfig(dir, p);
    const shared = openStandaloneDatabase(config);
    openHandles.push(shared);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, shared);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, shared);
    openStores.push(provider);
    openStores.push(store);
    // Both operate successfully through the shared handle.
    expect(provider.mode).toBe('standalone');
    expect(store.getSettings().companyName).toBe('SCIENTECHNIC');
    // Neither injected consumer closes the shared connection.
    provider.close();
    store.close();
    expect(shared.isOpen).toBe(true);
    // The owner closes exactly once.
    shared.close();
    expect(shared.isOpen).toBe(false);
  });
});
