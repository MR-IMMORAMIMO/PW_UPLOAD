/**
 * Focused tests for the transitional external schema-management mode (P1.8F).
 *
 * External-mode constructors must perform zero schema mutation, zero legacy backup creation,
 * zero ensureColumn, and zero compatibility UPDATE, while still inserting the four runtime
 * default rows after a fail-closed post-migration readiness assertion.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { loadConfig, type AppConfig } from '@scli/config';
import { StandaloneDataProvider } from '../../../standalone-data-provider';
import { PersonalWorkspaceStore } from '../../../personal-workspace-store';
import { PersonalOperationsStore } from '../../../personal-operations-store';
import { SchemaMigrationRunner } from '../SchemaMigrationRunner';
import {
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDatabaseFactory,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationJournalState,
} from '../types';
import { PathResolverService } from '../../path/PathResolverService';
import { LegacyDetector } from '../legacy/LegacyDetector';
import { LegacyV322FixtureBuilder } from '../testing/LegacyV322FixtureBuilder';
import { INDEX_NAMES, TABLE_NAMES } from '../testing/legacy-v322-schema';
import { BackupManager } from '../../backup/BackupManager';
import {
  DEFAULT_SCHEMA_MANAGEMENT_MODE,
  EXTERNALLY_MIGRATED,
  LEGACY_SELF_MANAGED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  SchemaManagementError,
} from './production-migration-registry';

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
        // Best-effort close; the original test outcome is preserved.
      }
    }
  }
  while (openHandles.length) {
    const handle = openHandles.pop();
    if (handle) {
      try {
        if (handle.isOpen) handle.close();
      } catch {
        // Best-effort close; the original test outcome is preserved.
      }
    }
  }
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-store-mode-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'scli.sqlite');
}

function makeConfig(dir: string, dbPath = dbPathIn(dir)): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'team',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: dbPath,
    STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Local Admin',
    STANDALONE_ADMIN_EMAIL: 'admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
  });
}

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-store-0001' };
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
    return { attemptId: 'att-store-0001' };
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

function openDb(p: string): DatabaseSyncInstance {
  const db = new DatabaseSync(p);
  openHandles.push(db);
  return db;
}

function makeRunner(
  dataRoot: string,
  backupFactory: MigrationBackupFactory,
): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory,
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(dataRoot),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

async function migrateEmpty(p: string, dataRoot: string): Promise<void> {
  const db = new DatabaseSync(p);
  db.close();
  await makeRunner(dataRoot, new FakeBackupFactory()).run(p);
}

function realBackupFactory(dataRoot: string): MigrationBackupFactory {
  const backupRoot = path.join(dataRoot, 'backups');
  mkdirSync(backupRoot, { recursive: true });
  let counter = 0;
  return {
    create(input: {
      sourceDb: DatabaseSyncInstance;
      sourceDatabasePath: string;
      sourceVersion: number;
    }): MigrationBackupPort {
      return new BackupManager({
        sourceDb: input.sourceDb,
        sourceDatabasePath: input.sourceDatabasePath,
        backupRoot,
        pathResolver: new PathResolverService(dataRoot),
        clock: { now: () => new Date(FIXED_BASE_MS) },
        idGenerator: { generate: () => 'bk-' + String(++counter).padStart(4, '0') },
        appVersion: '3.3.0',
        verificationPolicy: {
          requiredTables: ['app_state', 'local_accounts', 'project_workspaces'],
        },
      });
    },
  };
}

function schemaFingerprint(db: DatabaseSyncInstance): string {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as Array<{ type: string; name: string; sql: string | null }>;
  return JSON.stringify(rows);
}

function userVersion(db: DatabaseSyncInstance): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function historyCount(db: DatabaseSyncInstance): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name?: string } | undefined;
  if (!table) return 0;
  const row = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
    count: number;
  };
  return row.count;
}

function rowCount(db: DatabaseSyncInstance, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number };
  return row.count;
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

describe('transitional schema-management mode', () => {
  it('current default remains LEGACY_SELF_MANAGED', () => {
    expect(LEGACY_SELF_MANAGED).toBe('LEGACY_SELF_MANAGED');
    expect(EXTERNALLY_MIGRATED).toBe('EXTERNALLY_MIGRATED');
    expect(DEFAULT_SCHEMA_MANAGEMENT_MODE).toBe(LEGACY_SELF_MANAGED);
  });

  it('existing fresh-constructor behavior remains functional in legacy mode', () => {
    const dir = newTempDir();
    const config = makeConfig(dir);
    const provider = new StandaloneDataProvider(config);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(config);
    openStores.push(store);
    const db = openDb(dbPathIn(dir));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const names = tables.map((r) => r.name);
    for (const expected of TABLE_NAMES) expect(names).toContain(expected);
    expect(rowCount(db, 'app_state')).toBe(1);
    expect(rowCount(db, 'local_accounts')).toBe(1);
    expect(rowCount(db, 'personal_settings')).toBe(1);
    expect(rowCount(db, 'microsoft_connection')).toBe(1);
  });

  it('external StandaloneDataProvider performs no schema mutation', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const before = openDb(p);
    const beforeFingerprint = schemaFingerprint(before);
    const beforeVersion = userVersion(before);
    const beforeHistory = historyCount(before);
    before.close();
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const after = openDb(p);
    expect(schemaFingerprint(after)).toBe(beforeFingerprint);
    expect(userVersion(after)).toBe(beforeVersion);
    expect(historyCount(after)).toBe(beforeHistory);
  });

  it('external PersonalWorkspaceStore performs no schema mutation', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const before = openDb(p);
    const beforeFingerprint = schemaFingerprint(before);
    before.close();
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const after = openDb(p);
    expect(schemaFingerprint(after)).toBe(beforeFingerprint);
  });

  it('external PersonalOperationsStore performs no schema mutation', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    const beforeFingerprint = schemaFingerprint(db);
    const operations = new PersonalOperationsStore(db, 'Asia/Dubai', EXTERNALLY_MIGRATED);
    void operations;
    expect(schemaFingerprint(db)).toBe(beforeFingerprint);
  });

  it('external mode creates no VACUUM backup', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith('SCLI_PRE_'))).toBe(false);
    expect(files).not.toContain('restore-pending.sqlite');
    expect(existsSync(path.join(dir, 'backups'))).toBe(false);
  });

  it('external mode performs no ensureColumn', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const before = openDb(p);
    const columnsBefore = allColumnNames(before);
    before.close();
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const after = openDb(p);
    expect(allColumnNames(after)).toEqual(columnsBefore);
  });

  it('external mode performs no compatibility UPDATE', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.prepare(
      `INSERT INTO project_checklist_items
       (id, project_id, category, title, service_code, required, completed, waived,
        waiver_reason, sort_order, created_at, updated_at)
       VALUES ('ext-techboq', 'ext-project', 'BOQ QA',
               'Units and quantities are reviewed without price fields', 'TechnicalBoq',
               1, 0, 0, '', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const operations = new PersonalOperationsStore(db, 'Asia/Dubai', EXTERNALLY_MIGRATED);
    void operations;
    const row = db
      .prepare("SELECT title FROM project_checklist_items WHERE id = 'ext-techboq'")
      .get() as { title: string };
    expect(row.title).toBe('Units and quantities are reviewed without price fields');
  });

  it('external mode inserts app_state primary after readiness', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const db = openDb(p);
    const row = db.prepare("SELECT state_key FROM app_state WHERE state_key = 'primary'").get();
    expect(row).toBeDefined();
    expect(rowCount(db, 'app_state')).toBe(1);
  });

  it('external mode inserts one synthetic bootstrap account after readiness', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const db = openDb(p);
    expect(rowCount(db, 'local_accounts')).toBe(1);
    const row = db.prepare('SELECT email FROM local_accounts ORDER BY user_id').get() as {
      email: string;
    };
    expect(row.email).toBe('admin@local.test');
  });

  it('external mode inserts personal_settings id=1', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const db = openDb(p);
    const row = db.prepare('SELECT id FROM personal_settings WHERE id = 1').get();
    expect(row).toBeDefined();
    expect(rowCount(db, 'personal_settings')).toBe(1);
  });

  it('external mode inserts microsoft_connection id=1', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    const operations = new PersonalOperationsStore(db, 'Asia/Dubai', EXTERNALLY_MIGRATED);
    void operations;
    const row = db.prepare('SELECT id FROM microsoft_connection WHERE id = 1').get();
    expect(row).toBeDefined();
    expect(rowCount(db, 'microsoft_connection')).toBe(1);
  });

  it('reopening external mode is idempotent', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const firstProvider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    const firstStore = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    const before = openDb(p);
    const beforeFingerprint = schemaFingerprint(before);
    before.close();
    firstProvider.close();
    firstStore.close();
    const secondProvider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    const secondStore = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(secondProvider);
    openStores.push(secondStore);
    const db = openDb(p);
    expect(schemaFingerprint(db)).toBe(beforeFingerprint);
    expect(rowCount(db, 'app_state')).toBe(1);
    expect(rowCount(db, 'local_accounts')).toBe(1);
    expect(rowCount(db, 'personal_settings')).toBe(1);
    expect(rowCount(db, 'microsoft_connection')).toBe(1);
  });

  it('external mode rejects user_version=0', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.exec('PRAGMA user_version = 0');
    db.close();
    expectSchemaManagementError(
      () => new StandaloneDataProvider(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'USER_VERSION_MISMATCH',
    );
    const check = openDb(p);
    expect(rowCount(check, 'app_state')).toBe(0);
    expect(rowCount(check, 'local_accounts')).toBe(0);
    expect(rowCount(check, 'personal_settings')).toBe(0);
    expect(rowCount(check, 'microsoft_connection')).toBe(0);
  });

  it('external mode rejects missing schema_migrations', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.exec('DROP TABLE schema_migrations');
    db.close();
    expectSchemaManagementError(
      () => new StandaloneDataProvider(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'MIGRATION_HISTORY_MISSING',
    );
    const check = openDb(p);
    expect(rowCount(check, 'app_state')).toBe(0);
    expect(rowCount(check, 'local_accounts')).toBe(0);
  });

  it('external mode rejects missing required table', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.exec('DROP TABLE app_state');
    db.close();
    expectSchemaManagementError(
      () => new StandaloneDataProvider(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'REQUIRED_TABLE_MISSING',
    );
    const check = openDb(p);
    expect(rowCount(check, 'local_accounts')).toBe(0);
    expect(rowCount(check, 'personal_settings')).toBe(0);
  });

  it('external mode rejects missing required index', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.exec('DROP INDEX ix_project_actions_due');
    expectSchemaManagementError(
      () => new PersonalOperationsStore(db, 'Asia/Dubai', EXTERNALLY_MIGRATED),
      'REQUIRED_INDEX_MISSING',
    );
  });

  it('failed readiness inserts no default rows', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const db = openDb(p);
    db.exec('PRAGMA user_version = 0');
    db.exec('DROP TABLE schema_migrations');
    db.close();
    expectSchemaManagementError(
      () => new StandaloneDataProvider(makeConfig(dir, p), EXTERNALLY_MIGRATED),
      'USER_VERSION_MISMATCH',
    );
    const check = openDb(p);
    expect(rowCount(check, 'app_state')).toBe(0);
    expect(rowCount(check, 'local_accounts')).toBe(0);
    expect(rowCount(check, 'personal_settings')).toBe(0);
    expect(rowCount(check, 'microsoft_connection')).toBe(0);
  });

  it('constructor schema fingerprint is byte/logically unchanged', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const before = openDb(p);
    const beforeFingerprint = schemaFingerprint(before);
    before.close();
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const after = openDb(p);
    expect(schemaFingerprint(after)).toBe(beforeFingerprint);
  });

  it('constructor opening does not create a second backup', async () => {
    const root = newTempDir();
    const dataDir = path.join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const p = path.join(dataDir, 'legacy.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    await makeRunner(root, realBackupFactory(root)).run(p);
    const backupRoot = path.join(root, 'backups');
    const backupsAfterMigration = readdirSync(backupRoot).filter(
      (name) => !name.startsWith('PARTIAL_'),
    );
    expect(backupsAfterMigration.length).toBe(1);
    const config = makeConfig(root, p);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const backupsAfterConstructors = readdirSync(backupRoot).filter(
      (name) => !name.startsWith('PARTIAL_'),
    );
    expect(backupsAfterConstructors).toEqual(backupsAfterMigration);
    expect(backupsAfterConstructors.length).toBe(1);
  });

  it('all DatabaseSync handles close after tests', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
    provider.close();
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    store.close();
    const db = openDb(p);
    db.close();
    expect(() => rmSync(dir, { recursive: true, force: true })).not.toThrow();
  });

  it('legacy constructor product schema is structurally identical to the migrated target', async () => {
    const migratedDir = newTempDir();
    const migratedPath = dbPathIn(migratedDir);
    await migrateEmpty(migratedPath, migratedDir);
    const targetDb = openDb(migratedPath);
    const targetFp = completeProductFingerprintDb(targetDb);
    const legacyDir = newTempDir();
    const legacyConfig = makeConfig(legacyDir);
    const provider = new StandaloneDataProvider(legacyConfig);
    openStores.push(provider);
    const store = new PersonalWorkspaceStore(legacyConfig);
    openStores.push(store);
    const legacyDb = openDb(dbPathIn(legacyDir));
    expect(completeProductFingerprintDb(legacyDb)).toBe(targetFp);
  });

  it('external mode runtime personal_settings time_zone defaults to Asia/Dubai', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const config = makeConfig(dir, p);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const db = openDb(p);
    const row = db.prepare('SELECT time_zone FROM personal_settings WHERE id = 1').get() as {
      time_zone: string;
    };
    expect(row.time_zone).toBe('Asia/Dubai');
    expect(rowCount(db, 'personal_settings')).toBe(1);
  });

  it('external mode preserves an existing personal_settings time_zone value', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    await migrateEmpty(p, dir);
    const seed = openDb(p);
    seed
      .prepare(
        `INSERT INTO personal_settings
         (id, project_root, default_folder_profile, default_input_mode, auto_open_project_folder,
          updated_at, time_zone)
         VALUES (1, 'C:\\Test\\Projects', 'Full Lighting Design', 'Later', 1,
                 '2026-01-01T00:00:00.000Z', 'Europe/London')`,
      )
      .run();
    const config = makeConfig(dir, p);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
    openStores.push(store);
    const db = openDb(p);
    const row = db.prepare('SELECT time_zone FROM personal_settings WHERE id = 1').get() as {
      time_zone: string;
    };
    expect(row.time_zone).toBe('Europe/London');
    expect(rowCount(db, 'personal_settings')).toBe(1);
  });
});

function allColumnNames(db: DatabaseSyncInstance): string[] {
  const names: string[] = [];
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    for (const column of columns) {
      names.push(
        `${table.name}.${column.name}:${column.type}:${column.notnull}:${column.dflt_value ?? '-'}:${column.pk}`,
      );
    }
  }
  return names;
}

function completeProductFingerprintDb(db: DatabaseSyncInstance): string {
  const normalizeSql = (sql: string) => sql.trim().replace(/\s+/g, ' ');
  const parts: string[] = [];
  for (const table of [...TABLE_NAMES].sort()) {
    const sqlRow = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    parts.push(`TABLE ${table} ${normalizeSql(sqlRow?.sql ?? '')}`);
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    for (const c of cols) {
      parts.push(
        `  COL ${c.name}|${c.type}|nn=${c.notnull}|dflt=${c.dflt_value ?? '<null>'}|pk=${c.pk}`,
      );
    }
  }
  for (const index of [...INDEX_NAMES].sort()) {
    const sqlRow = db
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?")
      .get(index) as { sql: string } | undefined;
    parts.push(`INDEX ${index} ${normalizeSql(sqlRow?.sql ?? '')}`);
  }
  return createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
}
