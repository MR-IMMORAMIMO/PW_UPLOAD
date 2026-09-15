import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SchemaMigrationError,
  type LegacyMigrationAdmission,
  type LegacyMigrationAdmissionResult,
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDatabaseFactory,
  type MigrationDefinition,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationJournalState,
  type SchemaMigrationRunnerDeps,
} from './types';
import { SchemaMigrationRunner } from './SchemaMigrationRunner';
import { MigrationStateInspector } from './MigrationStateInspector';
import { PersistentMigrationJournal } from './journal/PersistentMigrationJournal';
import { PersistentMigrationJournalError } from './journal/journal-types';
import { InterruptedMigrationReconciler } from './reconciliation/InterruptedMigrationReconciler';
import { PathResolverService } from '../path/PathResolverService';
import { LegacyDetector, LegacyDetectorError } from './legacy/LegacyDetector';
import { CurrentSelfManagedUnversionedFixtureBuilder } from './testing/CurrentSelfManagedUnversionedFixtureBuilder';
import { LegacyV322FixtureBuilder } from './testing/LegacyV322FixtureBuilder';
import { CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT } from './testing/current-self-managed-unversioned-schema';
import { BackupManager } from '../backup/BackupManager';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;
type Stmt = ReturnType<DatabaseSyncInstance['prepare']>;

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);
const BAD_CHECKSUM = 'z'.repeat(64);
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

function makeClock() {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

function makeMigration(input: {
  id: string;
  from: number;
  to: number;
  checksum: string;
  description: string;
  up: (ctx: { database: DatabaseSyncInstance }) => void;
  validate?: (ctx: { database: DatabaseSyncInstance }) => void;
  validateCurrent?: (database: DatabaseSyncInstance) => void;
}): MigrationDefinition {
  const base = {
    id: input.id,
    fromVersion: input.from,
    toVersion: input.to,
    checksum: input.checksum,
    description: input.description,
    up: input.up as MigrationDefinition['up'],
  };
  return {
    ...base,
    ...(input.validate
      ? { validate: input.validate as NonNullable<MigrationDefinition['validate']> }
      : {}),
    ...(input.validateCurrent
      ? {
          validateCurrent: input.validateCurrent as NonNullable<
            MigrationDefinition['validateCurrent']
          >,
        }
      : {}),
  };
}

const baseMigrations = [
  makeMigration({
    id: 'm-0-1',
    from: 0,
    to: 1,
    checksum: CHECKSUM_A,
    description: 'create base table',
    up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY, name TEXT)'),
    validate: (ctx) => {
      const row = ctx.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'base'")
        .get() as { name: string } | undefined;
      if (!row) throw new Error('base table missing');
    },
  }),
  makeMigration({
    id: 'm-1-2',
    from: 1,
    to: 2,
    checksum: CHECKSUM_B,
    description: 'add extra table',
    up: (ctx) => ctx.database.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)'),
  }),
  makeMigration({
    id: 'm-2-3',
    from: 2,
    to: 3,
    checksum: CHECKSUM_C,
    description: 'add notes table',
    up: (ctx) => ctx.database.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)'),
  }),
];

class FakeBackupPort implements MigrationBackupPort {
  public created = false;
  public verified = false;
  public receivedReason = '';
  public receivedMigrationId = '';
  public failCreate = false;
  public failVerify = false;
  public async createVerifiedBackup(request: {
    reason: string;
    migrationId: string;
  }): Promise<{ backupId: string }> {
    this.receivedReason = request.reason;
    this.receivedMigrationId = request.migrationId;
    if (this.failCreate) throw new Error('backup create failed');
    this.created = true;
    return { backupId: 'bk-0001' };
  }
  public async verifyBackup(): Promise<unknown> {
    if (this.failVerify) throw new Error('backup verify failed');
    this.verified = true;
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public port = new FakeBackupPort();
  public receivedSourceDb: DatabaseSyncInstance | undefined;
  public receivedPath = '';
  public receivedSourceVersion: number | undefined;
  public create(input: {
    sourceDb: DatabaseSyncInstance;
    sourceDatabasePath: string;
    sourceVersion: number;
  }): MigrationBackupPort {
    this.receivedSourceDb = input.sourceDb;
    this.receivedPath = input.sourceDatabasePath;
    this.receivedSourceVersion = input.sourceVersion;
    return this.port;
  }
}

interface JournalEntry {
  state: MigrationJournalState;
  details?: unknown;
}

class FakeJournal implements MigrationJournalPort {
  public states: JournalEntry[] = [];
  public attemptId = 'att-0001';
  public createAttemptInput: { fromVersion: number; targetVersion: number } | undefined;
  public failTransitionAt: MigrationJournalState | null = null;
  public failMarkFailed = false;
  public failCreateAttempt = false;
  public lastFailure: { code: string; message: string } | undefined;
  public createAttemptError: Error | PersistentMigrationJournalError | null = null;
  public async createAttempt(input: {
    fromVersion: number;
    targetVersion: number;
  }): Promise<{ attemptId: string }> {
    if (this.createAttemptError) throw this.createAttemptError;
    if (this.failCreateAttempt) throw new Error('journal createAttempt failed');
    this.createAttemptInput = input;
    this.states.push({ state: 'CREATED' });
    return { attemptId: this.attemptId };
  }
  public async transition(
    attemptId: string,
    state: MigrationJournalState,
    details?: unknown,
  ): Promise<void> {
    void attemptId;
    if (this.failTransitionAt === state) throw new Error(`journal transition ${state} failed`);
    this.states.push({ state, details });
  }
  public async markFailed(
    attemptId: string,
    failure: { code: string; message: string },
  ): Promise<void> {
    void attemptId;
    this.lastFailure = failure;
    if (this.failMarkFailed) throw new Error('journal markFailed failed');
    this.states.push({ state: 'FAILED', details: failure });
  }
}

const EXPECTED_LEGACY_FINGERPRINT =
  '2cb33227fcc587a1e46f6b00556d8f5f0f532f604bc8a888b24db6f5480715d2';

function exactLegacyResult(): LegacyMigrationAdmissionResult {
  return {
    status: 'LEGACY_V3_2_2',
    observedUserVersion: 0,
    historyTableExists: false,
    migrationCandidate: true,
    manualActionRequired: false,
    safeReasonCode: 'EXACT_LEGACY_V3_2_2_SCHEMA',
    observedTableCount: 24,
    observedOwnedIndexCount: 8,
    observedStructuralFingerprint: EXPECTED_LEGACY_FINGERPRINT,
  };
}

function exactCurrentSelfManagedResult(): LegacyMigrationAdmissionResult {
  return {
    status: 'CURRENT_SELF_MANAGED_UNVERSIONED',
    observedUserVersion: 0,
    historyTableExists: false,
    migrationCandidate: true,
    manualActionRequired: false,
    safeReasonCode: 'EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA',
    observedTableCount: 24,
    observedOwnedIndexCount: 8,
    observedStructuralFingerprint: CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT,
  };
}

function blockedLegacyResult(): LegacyMigrationAdmissionResult {
  return {
    status: 'BLOCKED',
    observedUserVersion: 0,
    historyTableExists: false,
    migrationCandidate: false,
    manualActionRequired: true,
    safeReasonCode: 'UNKNOWN_UNVERSIONED_SCHEMA',
    observedTableCount: 0,
    observedOwnedIndexCount: 0,
    observedStructuralFingerprint: null,
  };
}

class FakeLegacyAdmission implements LegacyMigrationAdmission {
  public calls: string[] = [];
  public result: LegacyMigrationAdmissionResult = blockedLegacyResult();
  public resultsByCall: LegacyMigrationAdmissionResult[] = [];
  public failWith: Error | null = null;

  public inspect(databasePath: string): LegacyMigrationAdmissionResult {
    this.calls.push(databasePath);
    if (this.failWith) throw this.failWith;
    if (this.resultsByCall.length > 0) return this.resultsByCall.shift()!;
    return this.result;
  }
}

function realLegacyAdmission(): LegacyMigrationAdmission {
  return new LegacyDetector();
}

function buildLegacyFixture(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
  return p;
}

function buildCurrentSelfManagedFixture(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  CurrentSelfManagedUnversionedFixtureBuilder.build({ outputPath: p });
  return p;
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

function realDatabaseFactory(): MigrationDatabaseFactory & {
  openedReadWrite?: DatabaseSyncInstance | undefined;
  openedReadOnly?: DatabaseSyncInstance | undefined;
} {
  const f = {
    openedReadWrite: undefined as DatabaseSyncInstance | undefined,
    openedReadOnly: undefined as DatabaseSyncInstance | undefined,
    openReadWrite(p: string): DatabaseSyncInstance {
      const db = new DatabaseSync(p);
      f.openedReadWrite = db;
      return db;
    },
    openReadOnly(p: string): DatabaseSyncInstance {
      const db = new DatabaseSync(p, { readOnly: true });
      f.openedReadOnly = db;
      return db;
    },
  };
  return f;
}

interface WrapDbOptions {
  failCommit?: boolean;
  integrityRows?: { integrity_check: string }[];
  userVersion?: number;
  closeTracker?: { closed: boolean };
  dataVersionAfterBeginImmediate?: number;
}

function wrapDb(real: DatabaseSyncInstance, opts: WrapDbOptions = {}): DatabaseSyncInstance {
  const stubAll = (rows: unknown[]): Stmt =>
    ({ all: () => rows, get: () => undefined, run: () => undefined }) as unknown as Stmt;
  const stubGet = (value: unknown): Stmt =>
    ({ all: () => [], get: () => value, run: () => undefined }) as unknown as Stmt;
  let beganImmediate = false;
  return {
    exec: (sql: string) => {
      if (sql === 'BEGIN IMMEDIATE') beganImmediate = true;
      if (opts.failCommit && sql === 'COMMIT') throw new Error('commit failed');
      return real.exec(sql);
    },
    prepare: (sql: string) => {
      if (
        opts.dataVersionAfterBeginImmediate !== undefined &&
        sql === 'PRAGMA data_version' &&
        beganImmediate
      )
        return stubGet({ data_version: opts.dataVersionAfterBeginImmediate });
      if (opts.integrityRows !== undefined && sql === 'PRAGMA integrity_check')
        return stubAll(opts.integrityRows);
      if (opts.userVersion !== undefined && sql === 'PRAGMA user_version')
        return stubGet({ user_version: opts.userVersion });
      return real.prepare(sql);
    },
    close: () => {
      if (opts.closeTracker) opts.closeTracker.closed = true;
      return real.close();
    },
  } as unknown as DatabaseSyncInstance;
}

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-mig-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'app.sqlite');
}

function populateDb(dir: string, fn: (db: DatabaseSyncInstance) => void): string {
  const p = dbPathIn(dir);
  const db = new DatabaseSync(p);
  try {
    fn(db);
  } finally {
    db.close();
  }
  return p;
}

function emptyDb(): string {
  const dir = newTempDir();
  return populateDb(dir, () => {
    /* empty */
  });
}

function populateVersionZeroDb(): string {
  const dir = newTempDir();
  return populateDb(dir, (db) => {
    db.exec('CREATE TABLE project_workspaces (id TEXT PRIMARY KEY)');
  });
}

function ensureHistoryTable(db: DatabaseSyncInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      description TEXT NOT NULL,
      app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      validation_result TEXT NOT NULL
    );
  `);
}

function historyRow(
  db: DatabaseSyncInstance,
  row: {
    migration_id: string;
    from_version: number;
    to_version: number;
    checksum: string;
    description?: string;
  },
): void {
  db.prepare(
    `INSERT INTO schema_migrations
        (migration_id, from_version, to_version, checksum, description, app_version, backup_id,
         started_at, completed_at, duration_ms, validation_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')`,
  ).run(
    row.migration_id,
    row.from_version,
    row.to_version,
    row.checksum,
    row.description ?? 'desc',
    '3.3.0',
    'bk-preexisting',
    '2026-08-04T12:00:00.000Z',
    '2026-08-04T12:00:01.000Z',
    1000,
  );
}

interface MakeRunnerOptions {
  migrations?: MigrationDefinition[];
  targetVersion?: number;
  journal?: FakeJournal;
  backupFactory?: FakeBackupFactory | MigrationBackupFactory;
  databaseFactory?: MigrationDatabaseFactory;
  busyTimeoutMs?: number;
  appVersion?: string;
  pathResolver?: PathResolverService;
  clock?: MigrationClock;
  legacyAdmission?: LegacyMigrationAdmission;
}

function makeRunner(opts: MakeRunnerOptions = {}): {
  runner: SchemaMigrationRunner;
  journal: FakeJournal;
  backupFactory: FakeBackupFactory;
  databaseFactory: ReturnType<typeof realDatabaseFactory>;
  pathResolver: PathResolverService;
} {
  const dir = newTempDir();
  const pathResolver = opts.pathResolver ?? new PathResolverService(dir);
  const journal = opts.journal ?? new FakeJournal();
  const backupFactory = opts.backupFactory ?? new FakeBackupFactory();
  const databaseFactory = opts.databaseFactory ?? realDatabaseFactory();
  const migrations = opts.migrations ?? [baseMigrations[0]!, baseMigrations[1]!];
  const targetVersion = opts.targetVersion ?? 2;
  const legacyAdmission = opts.legacyAdmission ?? new FakeLegacyAdmission();
  const deps: SchemaMigrationRunnerDeps = {
    migrations,
    targetVersion,
    appVersion: opts.appVersion ?? '3.3.0',
    databaseFactory,
    backupFactory,
    journal,
    clock: opts.clock ?? makeClock(),
    pathResolver,
    busyTimeoutMs: opts.busyTimeoutMs ?? 5000,
    legacyAdmission,
  };
  return {
    runner: new SchemaMigrationRunner(deps),
    journal,
    backupFactory: backupFactory as FakeBackupFactory,
    databaseFactory,
    pathResolver,
  };
}

function expectSyncError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected SchemaMigrationError to be thrown');
  } catch (error) {
    if (!(error instanceof SchemaMigrationError)) throw error;
    expect(error.code).toBe(code);
  }
}

async function expectReject(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected SchemaMigrationError to be thrown');
  } catch (error) {
    if (!(error instanceof SchemaMigrationError)) throw error;
    expect(error.code).toBe(code);
  }
}

function openReadOnlyUserVersion(p: string): number {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    db.close();
  }
}

function historyCount(p: string): number {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name: string } | undefined;
    if (!table) return 0;
    const row = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

describe('SchemaMigrationRunner registry validation', () => {
  it('rejects a duplicate migration ID', () => {
    const migrations = [
      makeMigration({
        id: 'dup',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'dup',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 2 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects a duplicate fromVersion', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'y',
        from: 0,
        to: 1,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 1 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects a duplicate toVersion', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'y',
        from: 1,
        to: 1,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 1 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects a version gap', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'y',
        from: 2,
        to: 3,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 3 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects a branching registry', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'y',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
      }),
      makeMigration({
        id: 'z',
        from: 1,
        to: 2,
        checksum: CHECKSUM_C,
        description: 'c',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 2 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects a non-incrementing version', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 2,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 2 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects an invalid checksum', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: 'not-a-checksum',
        description: 'a',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 1 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('rejects an empty description', () => {
    const migrations = [
      makeMigration({
        id: 'x',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: '',
        up: () => undefined,
      }),
    ];
    expectSyncError(
      () => makeRunner({ migrations, targetVersion: 1 }),
      'INVALID_MIGRATION_REGISTRY',
    );
  });

  it('array order does not control execution order', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const reversed = [baseMigrations[1]!, baseMigrations[0]!];
    const { runner } = makeRunner({ migrations: reversed, targetVersion: 2 });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(result.appliedMigrationIds).toEqual(['m-0-1', 'm-1-2']);
  });

  it('registry mutation after construction cannot alter execution', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const migrations = [baseMigrations[0]!, baseMigrations[1]!];
    const { runner } = makeRunner({ migrations, targetVersion: 2 });
    (migrations as MigrationDefinition[]).push(
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: BAD_CHECKSUM,
        description: 'bad',
        up: () => undefined,
      }),
    );
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
  });
});

describe('SchemaMigrationRunner configuration and path', () => {
  it('rejects a relative database path', async () => {
    const { runner } = makeRunner();
    await expectReject(() => runner.run('relative/path.sqlite'), 'INVALID_DATABASE_PATH');
  });

  it('rejects :memory:', async () => {
    const { runner } = makeRunner();
    await expectReject(() => runner.run(':memory:'), 'INVALID_DATABASE_PATH');
  });

  it('rejects a NUL character in the path', async () => {
    const { runner } = makeRunner();
    const p = path.join(newTempDir(), 'a\0b.sqlite');
    await expectReject(() => runner.run(p), 'INVALID_DATABASE_PATH');
  });

  it('verifies main database path correspondence', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { runner } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
  });

  it('validates appVersion', () => {
    expectSyncError(() => makeRunner({ appVersion: '' }), 'INVALID_CONFIGURATION');
  });

  it('validates busyTimeout', () => {
    expectSyncError(() => makeRunner({ busyTimeoutMs: 0 }), 'INVALID_CONFIGURATION');
  });

  it('validates targetVersion', () => {
    expectSyncError(() => makeRunner({ targetVersion: -1 }), 'INVALID_CONFIGURATION');
  });
});

describe('SchemaMigrationRunner fresh and legacy safety', () => {
  it('runs an empty version-zero database from 0 to target', async () => {
    const p = emptyDb();
    const { runner } = makeRunner({ migrations: baseMigrations, targetVersion: 3 });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(result.toVersion).toBe(3);
    expect(openReadOnlyUserVersion(p)).toBe(3);
  });

  it('rejects a populated version-zero database before journal and backup', async () => {
    const p = populateVersionZeroDb();
    const { runner, journal, backupFactory } = makeRunner();
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
    expect(backupFactory.port.created).toBe(false);
  });

  it('rejects a version-zero database with an ambiguous history table', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => ensureHistoryTable(db));
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'UNVERSIONED_DATABASE_REQUIRES_LEGACY_DETECTION');
  });

  it('does not attempt v3.2.2 inference', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('CREATE TABLE project_workspaces (id TEXT PRIMARY KEY)');
      db.exec('CREATE TABLE personal_settings (id INTEGER PRIMARY KEY)');
    });
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
  });
});

describe('SchemaMigrationRunner no-op behavior', () => {
  function seedCurrent(p: string): void {
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec('PRAGMA user_version = 2');
      db.exec('CREATE TABLE base (id INTEGER PRIMARY KEY, name TEXT)');
      db.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)');
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
      });
      historyRow(db, {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
      });
    } finally {
      db.close();
    }
  }

  it('performs no backup on an already-current database', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    const { runner, backupFactory } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('up-to-date');
    expect(backupFactory.port.created).toBe(false);
  });

  it('creates no journal attempt on an already-current database', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    const { runner, journal } = makeRunner();
    await runner.run(p);
    expect(journal.createAttemptInput).toBeUndefined();
  });

  it('executes no migration on an already-current database', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    let upCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          upCalled = true;
        },
      }),
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => {
          upCalled = true;
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 2 });
    await runner.run(p);
    expect(upCalled).toBe(false);
  });

  it('remains a no-op when reopened', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    const { runner } = makeRunner();
    const first = await runner.run(p);
    const second = await runner.run(p);
    expect(first.status).toBe('up-to-date');
    expect(second.status).toBe('up-to-date');
  });

  it('runs the target migration current-state validator before returning up-to-date', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    let validationCount = 0;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
        validateCurrent: (database) => {
          validationCount += 1;
          const table = database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'extra'")
            .get();
          if (!table) throw new Error('extra table missing');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 2 });
    await expect(runner.run(p)).resolves.toMatchObject({ status: 'up-to-date' });
    expect(validationCount).toBe(1);
  });

  it('fails an invalid already-current database without creating a backup or journal attempt', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => undefined,
      }),
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => undefined,
        validateCurrent: () => {
          throw new Error('current structure malformed');
        },
      }),
    ];
    const { runner, backupFactory, journal } = makeRunner({ migrations, targetVersion: 2 });
    await expectReject(() => runner.run(p), 'POST_MIGRATION_VALIDATION_FAILED');
    expect(backupFactory.port.created).toBe(false);
    expect(journal.createAttemptInput).toBeUndefined();
  });
});

describe('SchemaMigrationRunner backup gating', () => {
  it('creates a backup before any schema mutation', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(backupFactory.port.created).toBe(true);
    expect(backupFactory.port.verified).toBe(true);
    expect(backupFactory.port.receivedReason).toBe('SCHEMA_UPGRADE_0_TO_2');
    expect(backupFactory.port.receivedMigrationId).toBe('UPGRADE_0_TO_2');
  });

  it('passes the same open DatabaseSync handle to the backup factory', async () => {
    const p = emptyDb();
    const { runner, backupFactory, databaseFactory } = makeRunner();
    await runner.run(p);
    expect(backupFactory.receivedSourceDb).toBe(databaseFactory.openedReadWrite);
  });

  it('passes the canonical source path to the backup factory', async () => {
    const p = emptyDb();
    const { runner, backupFactory, pathResolver } = makeRunner();
    await runner.run(p);
    expect(backupFactory.receivedPath).toBe(pathResolver.normalizeAbsolutePath(p));
  });

  it('prevents the transaction when backup creation fails', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner();
    backupFactory.port.failCreate = true;
    await expectReject(() => runner.run(p), 'BACKUP_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
    expect(historyCount(p)).toBe(0);
  });

  it('prevents the transaction when backup verification fails', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner();
    backupFactory.port.failVerify = true;
    await expectReject(() => runner.run(p), 'BACKUP_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('creates exactly one backup for a multi-step upgrade', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner({ migrations: baseMigrations, targetVersion: 3 });
    await runner.run(p);
    expect(backupFactory.port.created).toBe(true);
  });

  it('uses a deterministic backup reason and migration identifier for a single migration', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner({
      migrations: [baseMigrations[0]!],
      targetVersion: 1,
    });
    await runner.run(p);
    expect(backupFactory.port.receivedReason).toBe('SCHEMA_UPGRADE_0_TO_1');
    expect(backupFactory.port.receivedMigrationId).toBe('m-0-1');
  });
});

describe('SchemaMigrationRunner transactions', () => {
  it('executes multi-step migrations in version order', async () => {
    const p = emptyDb();
    const { runner } = makeRunner({ migrations: baseMigrations, targetVersion: 3 });
    const result = await runner.run(p);
    expect(result.appliedMigrationIds).toEqual(['m-0-1', 'm-1-2', 'm-2-3']);
  });

  it('advances user_version on a successful migration', async () => {
    const p = emptyDb();
    const { runner } = makeRunner();
    await runner.run(p);
    expect(openReadOnlyUserVersion(p)).toBe(2);
  });

  it('commits the history row atomically with user_version', async () => {
    const p = emptyDb();
    const { runner } = makeRunner();
    await runner.run(p);
    expect(historyCount(p)).toBe(2);
  });

  it('rolls back data and schema when migration.up fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('up failed');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('leaves user_version unchanged when migration.up fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => {
          ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)');
          throw new Error('up failed');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('inserts no history row when migration.up fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('up failed');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(historyCount(p)).toBe(0);
  });

  it('rolls back when validate fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)'),
        validate: () => {
          throw new Error('validate failed');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_VALIDATION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('rolls back on a foreign-key failure', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => {
          ctx.database.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
          ctx.database.exec(
            'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))',
          );
        },
      }),
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: (ctx) =>
          ctx.database.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(1, 999),
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 2 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
  });

  it('rolls back when history insertion fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => {
          ctx.database
            .prepare(
              `INSERT INTO schema_migrations
                (migration_id, from_version, to_version, checksum, description, app_version, backup_id,
                 started_at, completed_at, duration_ms, validation_result)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')`,
            )
            .run('m-0-1', 0, 1, CHECKSUM_A, 'a', '3.3.0', 'bk', 't', 't', 0);
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('maps lock contention to MIGRATION_LOCK_FAILED', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const holder = new DatabaseSync(p);
    holder.exec('BEGIN IMMEDIATE');
    try {
      const { runner } = makeRunner({ busyTimeoutMs: 1 });
      await expectReject(() => runner.run(p), 'MIGRATION_LOCK_FAILED');
    } finally {
      try {
        holder.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      holder.close();
    }
  });

  it('does not run the next migration after a failed step', async () => {
    const p = emptyDb();
    let secondCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
      makeMigration({
        id: 'm-1-2',
        from: 1,
        to: 2,
        checksum: CHECKSUM_B,
        description: 'b',
        up: () => {
          secondCalled = true;
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 2 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(secondCalled).toBe(false);
  });

  it('rolls back schema_migrations creation when the first migration fails', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get() as { name: string } | undefined;
      expect(row).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('SchemaMigrationRunner history validation', () => {
  function seed(
    p: string,
    version: number,
    rows: {
      migration_id: string;
      from_version: number;
      to_version: number;
      checksum: string;
      description?: string;
    }[],
  ): void {
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec(`PRAGMA user_version = ${version}`);
      for (const r of rows) historyRow(db, r);
    } finally {
      db.close();
    }
  }

  it('rejects an unknown history migration', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 2, [
      { migration_id: 'unknown', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
      { migration_id: 'm-1-2', from_version: 1, to_version: 2, checksum: CHECKSUM_B },
    ]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects a missing history migration', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 2, [{ migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: CHECKSUM_A }]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects a checksum mismatch', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 2, [
      { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: BAD_CHECKSUM },
      { migration_id: 'm-1-2', from_version: 1, to_version: 2, checksum: CHECKSUM_B },
    ]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_CHECKSUM_MISMATCH');
  });

  it('rejects a history version disagreement', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 2, [
      { migration_id: 'm-0-1', from_version: 5, to_version: 1, checksum: CHECKSUM_A },
      { migration_id: 'm-1-2', from_version: 1, to_version: 2, checksum: CHECKSUM_B },
    ]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects history beyond user_version', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 1, [
      { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
      { migration_id: 'm-1-2', from_version: 1, to_version: 2, checksum: CHECKSUM_B },
    ]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects a future user_version', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 3, [
      { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
      { migration_id: 'm-1-2', from_version: 1, to_version: 2, checksum: CHECKSUM_B },
    ]);
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'FUTURE_SCHEMA_VERSION');
  });

  it('leaves existing valid history unchanged', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seed(p, 2, [
      {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
        description: 'keep',
      },
      {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
        description: 'keep2',
      },
    ]);
    const { runner } = makeRunner();
    await runner.run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT description FROM schema_migrations WHERE migration_id = 'm-0-1'")
        .get() as { description: string };
      expect(row.description).toBe('keep');
    } finally {
      db.close();
    }
  });
});

describe('SchemaMigrationRunner P1.5B1-C delegation and precedence', () => {
  // These tests pin the observable error-code mapping after the MigrationStateInspector
  // extraction. The runner must validate history shape/content before detecting a future
  // schema version (pre-extraction order), so a future-version database with invalid history
  // is reported with the history error code, not FUTURE_SCHEMA_VERSION. Extra additive
  // schema_migrations columns remain accepted.

  it('rejects a future version with no history table as a history mismatch', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      db.exec('PRAGMA user_version = 3');
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects a future version with a malformed history table as a history mismatch', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      db.exec(
        'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL)',
      );
      db.exec('PRAGMA user_version = 3');
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('rejects a future version with a checksum mismatch as a checksum mismatch', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec('PRAGMA user_version = 3');
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: BAD_CHECKSUM,
      });
      historyRow(db, {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
      });
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'MIGRATION_CHECKSUM_MISMATCH');
  });

  it('still rejects a future version with valid history as a future schema version', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec('PRAGMA user_version = 3');
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
      });
      historyRow(db, {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
      });
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'FUTURE_SCHEMA_VERSION');
  });

  it('accepts a schema_migrations table with extra additive columns and reports up-to-date', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      db.exec(
        'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL, extra_column TEXT)',
      );
      db.exec('PRAGMA user_version = 2');
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
      });
      historyRow(db, {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
      });
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('up-to-date');
    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(2);
  });

  it('rejects a version-zero database with user tables and a history table as ambiguous', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      db.exec('CREATE TABLE user_data (id INTEGER PRIMARY KEY)');
      ensureHistoryTable(db);
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'UNVERSIONED_DATABASE_REQUIRES_LEGACY_DETECTION');
  });
});

describe('SchemaMigrationRunner journal', () => {
  it('records the correct state order on success', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner({ migrations: [baseMigrations[0]!], targetVersion: 1 });
    await runner.run(p);
    expect(journal.states.map((s) => s.state)).toEqual([
      'CREATED',
      'PREFLIGHT_VALIDATED',
      'BACKUP_VERIFIED',
      'TRANSACTION_STARTED',
      'COMMITTED',
      'POST_VALIDATION_PASSED',
      'SUCCEEDED',
    ]);
  });

  it('prevents mutation when a journal write fails before the transaction', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner();
    journal.failTransitionAt = 'PREFLIGHT_VALIDATED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('rolls back before up() when TRANSACTION_STARTED journal write fails', async () => {
    const p = emptyDb();
    let upCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          upCalled = true;
        },
      }),
    ];
    const { runner, journal } = makeRunner({ migrations, targetVersion: 1 });
    journal.failTransitionAt = 'TRANSACTION_STARTED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(upCalled).toBe(false);
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('attempts markFailed on a migration failure', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
    ];
    const { runner, journal } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(journal.lastFailure?.code).toBe('MIGRATION_EXECUTION_FAILED');
  });

  it('preserves both errors when the journal fails while recording failure', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('up failed');
        },
      }),
    ];
    const { runner, journal } = makeRunner({ migrations, targetVersion: 1 });
    journal.failMarkFailed = true;
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.code).toBe('MIGRATION_EXECUTION_FAILED');
    expect(caught?.cause).toBeInstanceOf(Error);
    expect(caught?.message).toContain('markFailed');
  });

  it('never includes an absolute database path in journal payloads', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { runner, journal } = makeRunner();
    await runner.run(p);
    const blob = JSON.stringify({
      states: journal.states,
      createAttemptInput: journal.createAttemptInput,
      lastFailure: journal.lastFailure,
    });
    expect(blob).not.toContain(dir);
    expect(blob).not.toContain(p);
  });
});

describe('SchemaMigrationRunner post-validation', () => {
  it('closes the read/write handle before opening the read-only validation handle', async () => {
    const p = emptyDb();
    const rwTracker = { closed: false };
    let rwClosedBeforeRoOpened = false;
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => wrapDb(real.openReadWrite(q), { closeTracker: rwTracker }),
      openReadOnly: (q) => {
        rwClosedBeforeRoOpened = rwTracker.closed;
        return real.openReadOnly(q);
      },
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await runner.run(p);
    expect(rwClosedBeforeRoOpened).toBe(true);
  });

  it('closes the read-only handle on success', async () => {
    const p = emptyDb();
    const roTracker = { closed: false };
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => real.openReadWrite(q),
      openReadOnly: (q) => wrapDb(real.openReadOnly(q), { closeTracker: roTracker }),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await runner.run(p);
    expect(roTracker.closed).toBe(true);
  });

  it('blocks success when integrity_check fails', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => real.openReadWrite(q),
      openReadOnly: (q) =>
        wrapDb(real.openReadOnly(q), { integrityRows: [{ integrity_check: 'error: corruption' }] }),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await expectReject(() => runner.run(p), 'POST_MIGRATION_VALIDATION_FAILED');
  });

  it('blocks success when the final user_version does not match', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => real.openReadWrite(q),
      openReadOnly: (q) => wrapDb(real.openReadOnly(q), { userVersion: 99 }),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await expectReject(() => runner.run(p), 'POST_MIGRATION_VALIDATION_FAILED');
  });

  it('marks the journal FAILED on post-validation failure', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const journal = new FakeJournal();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => real.openReadWrite(q),
      openReadOnly: (q) =>
        wrapDb(real.openReadOnly(q), { integrityRows: [{ integrity_check: 'bad' }] }),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver, journal });
    await expectReject(() => runner.run(p), 'POST_MIGRATION_VALIDATION_FAILED');
    expect(journal.lastFailure?.code).toBe('POST_MIGRATION_VALIDATION_FAILED');
  });

  it('does not perform automatic restore or down migration on failure', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });
});

describe('SchemaMigrationRunner resource safety', () => {
  it('closes the read/write handle after a preflight failure', async () => {
    const p = populateVersionZeroDb();
    const tracker = { closed: false };
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => wrapDb(real.openReadWrite(q), { closeTracker: tracker }),
      openReadOnly: (q) => real.openReadOnly(q),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(tracker.closed).toBe(true);
  });

  it('closes the read/write handle after a backup failure', async () => {
    const p = emptyDb();
    const tracker = { closed: false };
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => wrapDb(real.openReadWrite(q), { closeTracker: tracker }),
      openReadOnly: (q) => real.openReadOnly(q),
    };
    const { runner, backupFactory } = makeRunner({ databaseFactory, pathResolver });
    backupFactory.port.failCreate = true;
    await expectReject(() => runner.run(p), 'BACKUP_FAILED');
    expect(tracker.closed).toBe(true);
  });

  it('closes the read/write handle after a transaction failure', async () => {
    const p = emptyDb();
    const tracker = { closed: false };
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => wrapDb(real.openReadWrite(q), { closeTracker: tracker }),
      openReadOnly: (q) => real.openReadOnly(q),
    };
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1, databaseFactory, pathResolver });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(tracker.closed).toBe(true);
  });

  it('maps a commit failure to MIGRATION_COMMIT_FAILED', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) => wrapDb(real.openReadWrite(q), { failCommit: true }),
      openReadOnly: (q) => real.openReadOnly(q),
    };
    const { runner } = makeRunner({ databaseFactory, pathResolver });
    await expectReject(() => runner.run(p), 'MIGRATION_COMMIT_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('does not write files outside its temporary directory', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const { runner, pathResolver } = makeRunner({ migrations: baseMigrations, targetVersion: 3 });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(pathResolver.normalizeAbsolutePath(p)).toContain(path.basename(dir));
    const entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
    expect(entries.some((n) => n.endsWith('.sqlite'))).toBe(true);
  });
});

function backwardClock(): MigrationClock {
  let t = 100;
  return { now: () => new Date(FIXED_BASE_MS + (t -= 10)) };
}

function closeCountFactory(real: MigrationDatabaseFactory): {
  factory: MigrationDatabaseFactory;
  rwCloseCount: () => number;
} {
  let rwCloseCount = 0;
  const factory: MigrationDatabaseFactory = {
    openReadWrite: (q) => {
      const r = real.openReadWrite(q);
      return {
        exec: (sql: string) => r.exec(sql),
        prepare: (sql: string) => r.prepare(sql),
        close: () => {
          rwCloseCount++;
          return r.close();
        },
      } as unknown as DatabaseSyncInstance;
    },
    openReadOnly: (q) => real.openReadOnly(q),
  };
  return { factory, rwCloseCount: () => rwCloseCount };
}

function noWriteRoFactory(real: MigrationDatabaseFactory): {
  factory: MigrationDatabaseFactory;
  writeAttempted: () => boolean;
} {
  let writeAttempted = false;
  const wrapStmt = (s: Stmt): Stmt =>
    ({
      all: (...a: unknown[]) => s.all(...(a as never[])),
      get: (...a: unknown[]) => s.get(...(a as never[])),
      run: (...a: unknown[]) => {
        writeAttempted = true;
        return s.run(...(a as never[]));
      },
    }) as unknown as Stmt;
  const factory: MigrationDatabaseFactory = {
    openReadWrite: (q) => real.openReadWrite(q),
    openReadOnly: (q) => {
      const r = real.openReadOnly(q);
      return {
        exec: (sql: string) => {
          writeAttempted = true;
          return r.exec(sql);
        },
        prepare: (sql: string) => wrapStmt(r.prepare(sql)),
        close: () => r.close(),
      } as unknown as DatabaseSyncInstance;
    },
  };
  return { factory, writeAttempted: () => writeAttempted };
}

describe('SchemaMigrationRunner P1.3C hardening', () => {
  it('is unaffected by object-level mutation of a migration after construction', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const m0 = makeMigration({
      id: 'm-0-1',
      from: 0,
      to: 1,
      checksum: CHECKSUM_A,
      description: 'a',
      up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)'),
    });
    const m1 = makeMigration({
      id: 'm-1-2',
      from: 1,
      to: 2,
      checksum: CHECKSUM_B,
      description: 'b',
      up: (ctx) => ctx.database.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)'),
    });
    const { runner } = makeRunner({ migrations: [m0, m1], targetVersion: 2 });
    (m0 as unknown as { up: (ctx: { database: DatabaseSyncInstance }) => void }).up = () => {
      throw new Error('mutated up called');
    };
    (m0 as unknown as { id: string }).id = 'mutated';
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(result.appliedMigrationIds).toEqual(['m-0-1', 'm-1-2']);
  });

  it('treats a version-zero database with only SQLite internal objects as empty', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)');
      db.exec('DROP TABLE t');
    });
    const { runner } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
  });

  it('rejects a version-zero database containing only a user view', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('CREATE VIEW v AS SELECT 1');
    });
    const { runner } = makeRunner();
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
  });

  it('rejects a malformed schema_migrations table shape', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('PRAGMA user_version = 1');
      db.exec(
        'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER)',
      );
    });
    const { runner } = makeRunner({ migrations: [baseMigrations[0]!], targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_HISTORY_MISMATCH');
  });

  it('passes the detected source version to the backup factory', async () => {
    const p = emptyDb();
    const { runner, backupFactory } = makeRunner();
    await runner.run(p);
    expect(backupFactory.receivedSourceVersion).toBe(0);
  });

  it('maps a failed createAttempt to JOURNAL_WRITE_FAILED without a backup', async () => {
    const p = emptyDb();
    const { runner, journal, backupFactory } = makeRunner();
    journal.failCreateAttempt = true;
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(backupFactory.port.created).toBe(false);
  });

  it('maps a BACKUP_VERIFIED journal failure to JOURNAL_WRITE_FAILED', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner();
    journal.failTransitionAt = 'BACKUP_VERIFIED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('maps a COMMITTED journal failure after commit to JOURNAL_WRITE_FAILED and keeps the step', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner({ migrations: [baseMigrations[0]!], targetVersion: 1 });
    journal.failTransitionAt = 'COMMITTED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
  });

  it('maps a POST_VALIDATION_PASSED journal failure to JOURNAL_WRITE_FAILED', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner({ migrations: [baseMigrations[0]!], targetVersion: 1 });
    journal.failTransitionAt = 'POST_VALIDATION_PASSED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
  });

  it('maps a SUCCEEDED journal failure to JOURNAL_WRITE_FAILED', async () => {
    const p = emptyDb();
    const { runner, journal } = makeRunner({ migrations: [baseMigrations[0]!], targetVersion: 1 });
    journal.failTransitionAt = 'SUCCEEDED';
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
  });

  it('maps a deferred foreign-key failure at COMMIT to MIGRATION_COMMIT_FAILED', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => {
          ctx.database.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
          ctx.database.exec(
            'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)',
          );
          ctx.database.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(1, 999);
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1 });
    await expectReject(() => runner.run(p), 'MIGRATION_COMMIT_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('keeps a committed first step when the second step fails and can resume (step atomicity)', async () => {
    const p = emptyDb();
    const m0 = makeMigration({
      id: 'm-0-1',
      from: 0,
      to: 1,
      checksum: CHECKSUM_A,
      description: 'a',
      up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)'),
    });
    const m1Bad = makeMigration({
      id: 'm-1-2',
      from: 1,
      to: 2,
      checksum: CHECKSUM_B,
      description: 'b',
      up: () => {
        throw new Error('second step fails');
      },
    });
    const { runner: runner1 } = makeRunner({ migrations: [m0, m1Bad], targetVersion: 2 });
    await expectReject(() => runner1.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
    const m1Good = makeMigration({
      id: 'm-1-2',
      from: 1,
      to: 2,
      checksum: CHECKSUM_B,
      description: 'b',
      up: (ctx) => ctx.database.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)'),
    });
    const { runner: runner2 } = makeRunner({ migrations: [m0, m1Good], targetVersion: 2 });
    const result = await runner2.run(p);
    expect(result.status).toBe('migrated');
    expect(result.toVersion).toBe(2);
    expect(result.appliedMigrationIds).toEqual(['m-1-2']);
  });

  it('rejects a backward-moving clock with MIGRATION_EXECUTION_FAILED', async () => {
    const p = emptyDb();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY)'),
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1, clock: backwardClock() });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('performs no writes through the post-validation read-only handle', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const ro = noWriteRoFactory(real);
    const { runner } = makeRunner({ databaseFactory: ro.factory, pathResolver });
    await runner.run(p);
    expect(ro.writeAttempted()).toBe(false);
  });

  it('closes the read/write handle exactly once on success', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const cc = closeCountFactory(real);
    const { runner } = makeRunner({ databaseFactory: cc.factory, pathResolver });
    await runner.run(p);
    expect(cc.rwCloseCount()).toBe(1);
  });

  it('accepts existing history with different description and app_version', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec('PRAGMA user_version = 2');
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
        description: 'different description',
      });
      historyRow(db, {
        migration_id: 'm-1-2',
        from_version: 1,
        to_version: 2,
        checksum: CHECKSUM_B,
        description: 'other description',
      });
    } finally {
      db.close();
    }
    const { runner } = makeRunner();
    const result = await runner.run(p);
    expect(result.status).toBe('up-to-date');
  });
});

describe('SchemaMigrationRunner P1.5B2B2 journal error mapping', () => {
  it('maps ACTIVE_ATTEMPT_EXISTS to STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT', async () => {
    const p = emptyDb();
    const journal = new FakeJournal();
    journal.createAttemptError = new PersistentMigrationJournalError(
      'ACTIVE_ATTEMPT_EXISTS',
      'An active attempt exists.',
    );
    const { runner, backupFactory } = makeRunner({ journal });
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.code).toBe('STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT');
    expect(caught?.cause).toBeInstanceOf(PersistentMigrationJournalError);
    expect(caught?.message).toBe('An active attempt exists.');
    expect(backupFactory.port.created).toBe(false);
  });

  it('maps ATTEMPT_CORRUPT to STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT', async () => {
    const p = emptyDb();
    const journal = new FakeJournal();
    journal.createAttemptError = new PersistentMigrationJournalError(
      'ATTEMPT_CORRUPT',
      'A corrupt attempt exists.',
    );
    const { runner, backupFactory } = makeRunner({ journal });
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.code).toBe('STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT');
    expect(caught?.cause).toBeInstanceOf(PersistentMigrationJournalError);
    expect(backupFactory.port.created).toBe(false);
  });

  it('maps a generic journal write failure to JOURNAL_WRITE_FAILED', async () => {
    const p = emptyDb();
    const journal = new FakeJournal();
    journal.failCreateAttempt = true;
    const { runner, backupFactory } = makeRunner({ journal });
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.code).toBe('JOURNAL_WRITE_FAILED');
    expect(caught?.cause).toBeInstanceOf(Error);
    expect(backupFactory.port.created).toBe(false);
  });

  it('preserves the original journal error as cause', async () => {
    const p = emptyDb();
    const journal = new FakeJournal();
    const original = new PersistentMigrationJournalError(
      'ACTIVE_ATTEMPT_EXISTS',
      'Original cause.',
    );
    journal.createAttemptError = original;
    const { runner } = makeRunner({ journal });
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.cause).toBe(original);
  });

  it('error message contains no absolute path', async () => {
    const p = emptyDb();
    const dir = newTempDir();
    const journal = new FakeJournal();
    journal.createAttemptError = new PersistentMigrationJournalError(
      'ACTIVE_ATTEMPT_EXISTS',
      'An active attempt exists.',
    );
    const { runner } = makeRunner({ journal, pathResolver: new PathResolverService(dir) });
    let caught: SchemaMigrationError | undefined;
    try {
      await runner.run(p);
    } catch (error) {
      if (error instanceof SchemaMigrationError) caught = error;
    }
    expect(caught?.message).not.toContain(dir);
    expect(caught?.message).not.toContain(p);
  });

  it('backup, transaction and migration callbacks never begin after the journal blocks', async () => {
    const p = emptyDb();
    const journal = new FakeJournal();
    journal.createAttemptError = new PersistentMigrationJournalError(
      'ACTIVE_ATTEMPT_EXISTS',
      'An active attempt exists.',
    );
    let upCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          upCalled = true;
        },
      }),
    ];
    const { runner, backupFactory } = makeRunner({ migrations, targetVersion: 1, journal });
    await expectReject(() => runner.run(p), 'STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT');
    expect(backupFactory.port.created).toBe(false);
    expect(backupFactory.port.verified).toBe(false);
    expect(upCalled).toBe(false);
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });
});

describe('SchemaMigrationRunner legacy admission', () => {
  function seedVersioned(
    p: string,
    version: number,
    rows: { id: string; from: number; to: number; checksum: string }[],
  ): void {
    const dir = path.dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(p);
    try {
      ensureHistoryTable(db);
      db.exec(`PRAGMA user_version = ${version}`);
      for (const r of rows) {
        historyRow(db, {
          migration_id: r.id,
          from_version: r.from,
          to_version: r.to,
          checksum: r.checksum,
        });
      }
    } finally {
      db.close();
    }
  }

  function seedCurrent(p: string): void {
    seedVersioned(p, 2, [
      { id: 'm-0-1', from: 0, to: 1, checksum: CHECKSUM_A },
      { id: 'm-1-2', from: 1, to: 2, checksum: CHECKSUM_B },
    ]);
  }

  class OrderTrackingBackupPort implements MigrationBackupPort {
    public constructor(public readonly events: string[]) {}
    public async createVerifiedBackup(): Promise<{ backupId: string }> {
      this.events.push('backup');
      return { backupId: 'bk-order' };
    }
    public async verifyBackup(): Promise<unknown> {
      this.events.push('verify');
      return { ok: true };
    }
  }

  it('admits an exact legacy v3.2.2 database and migrates 0 to 1', async () => {
    const p = buildLegacyFixture();
    const migrations = [baseMigrations[0]!];
    const { runner, journal } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(result.toVersion).toBe(1);
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
    expect(journal.states.map((s) => s.state)).toEqual([
      'CREATED',
      'PREFLIGHT_VALIDATED',
      'BACKUP_VERIFIED',
      'TRANSACTION_STARTED',
      'COMMITTED',
      'POST_VALIDATION_PASSED',
      'SUCCEEDED',
    ]);
  });

  it('admits the exact current self-managed unversioned identity and migrates normally', async () => {
    const p = buildCurrentSelfManagedFixture();
    const migrations = [baseMigrations[0]!];
    const { runner, journal, backupFactory } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
    expect(backupFactory.port.created).toBe(true);
    expect(backupFactory.port.verified).toBe(true);
    expect(journal.states.map((state) => state.state)).toContain('BACKUP_VERIFIED');
  });

  it('requires the exact safe reason code for current self-managed admission', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = {
      ...exactCurrentSelfManagedResult(),
      safeReasonCode: 'EXACT_LEGACY_V3_2_2_SCHEMA',
    };
    const { runner, journal, backupFactory } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
    expect(backupFactory.port.created).toBe(false);
  });

  it('rejects a partial legacy schema before attempt and backup', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'PARTIAL_STANDALONE_ONLY' });
    const { runner, journal, backupFactory } = makeRunner({
      legacyAdmission: realLegacyAdmission(),
    });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
    expect(backupFactory.port.created).toBe(false);
  });

  it('rejects an unknown version-zero schema', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)');
    });
    const { runner, journal, backupFactory } = makeRunner({
      legacyAdmission: realLegacyAdmission(),
    });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
    expect(backupFactory.port.created).toBe(false);
  });

  it('rejects a non-empty WAL', async () => {
    const src = buildLegacyFixture();
    const writer = new DatabaseSync(src);
    writer.exec('CREATE TABLE extra_probe (id INTEGER PRIMARY KEY)');
    const dir = newTempDir();
    const p = dbPathIn(dir);
    copyFileSync(src, p);
    copyFileSync(src + '-wal', p + '-wal');
    copyFileSync(src + '-shm', p + '-shm');
    writer.close();
    const { runner, journal, backupFactory } = makeRunner({
      legacyAdmission: realLegacyAdmission(),
    });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
    expect(backupFactory.port.created).toBe(false);
  });

  it('malformed migration history never enters admission', async () => {
    const dir = newTempDir();
    const p = populateDb(dir, (db) => {
      db.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY)');
    });
    const admission = new FakeLegacyAdmission();
    const { runner } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'UNVERSIONED_DATABASE_REQUIRES_LEGACY_DETECTION');
    expect(admission.calls).toEqual([]);
  });

  it('versioned database does not call admission', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedVersioned(p, 1, [{ id: 'm-0-1', from: 0, to: 1, checksum: CHECKSUM_A }]);
    const admission = new FakeLegacyAdmission();
    const { runner } = makeRunner({ legacyAdmission: admission });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(admission.calls).toEqual([]);
  });

  it('empty database does not call admission', async () => {
    const p = emptyDb();
    const admission = new FakeLegacyAdmission();
    const { runner } = makeRunner({ legacyAdmission: admission });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(admission.calls).toEqual([]);
  });

  it('up-to-date database does not call admission', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    seedCurrent(p);
    const admission = new FakeLegacyAdmission();
    const { runner } = makeRunner({ legacyAdmission: admission });
    const result = await runner.run(p);
    expect(result.status).toBe('up-to-date');
    expect(admission.calls).toEqual([]);
  });

  it('admission is called before backup', async () => {
    const p = populateVersionZeroDb();
    const events: string[] = [];
    const admission = new FakeLegacyAdmission();
    admission.result = exactLegacyResult();
    const originalInspect = admission.inspect.bind(admission);
    admission.inspect = (dbPath) => {
      events.push('admission');
      return originalInspect(dbPath);
    };
    const port = new OrderTrackingBackupPort(events);
    const backupFactory: MigrationBackupFactory = { create: () => port };
    const { runner } = makeRunner({ legacyAdmission: admission, backupFactory });
    await runner.run(p);
    expect(events[0]).toBe('admission');
    expect(events).toContain('backup');
  });

  it('admission is called again after backup', async () => {
    const p = populateVersionZeroDb();
    const events: string[] = [];
    const admission = new FakeLegacyAdmission();
    admission.result = exactLegacyResult();
    const originalInspect = admission.inspect.bind(admission);
    admission.inspect = (dbPath) => {
      events.push('admission');
      return originalInspect(dbPath);
    };
    const port = new OrderTrackingBackupPort(events);
    const backupFactory: MigrationBackupFactory = { create: () => port };
    const { runner } = makeRunner({ legacyAdmission: admission, backupFactory });
    await runner.run(p);
    expect(admission.calls.length).toBe(2);
    const firstAdmission = events.indexOf('admission');
    const backupIndex = events.indexOf('backup');
    const secondAdmission = events.lastIndexOf('admission');
    expect(firstAdmission).toBeLessThan(backupIndex);
    expect(backupIndex).toBeLessThan(secondAdmission);
  });

  it('complete admission evidence is compared', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [exactLegacyResult(), exactLegacyResult()];
    const { runner } = makeRunner({ legacyAdmission: admission });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
  });

  it('structural fingerprint mismatch after backup blocks', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [
      exactLegacyResult(),
      { ...exactLegacyResult(), observedStructuralFingerprint: 'a'.repeat(64) },
    ];
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('table and index count mismatch after backup blocks', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [
      exactLegacyResult(),
      { ...exactLegacyResult(), observedTableCount: 23, observedOwnedIndexCount: 7 },
    ];
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('user-version or history mismatch after backup blocks', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [
      exactLegacyResult(),
      { ...exactLegacyResult(), observedUserVersion: 1, historyTableExists: true },
    ];
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('legacy backup occurs before any database mutation', async () => {
    const p = buildLegacyFixture();
    let backupCreatedAtUp = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          backupCreatedAtUp = backupFactory.port.created;
        },
      }),
    ];
    const { runner, backupFactory } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    await runner.run(p);
    expect(backupFactory.port.created).toBe(true);
    expect(backupFactory.port.verified).toBe(true);
    expect(backupCreatedAtUp).toBe(true);
  });

  it('real BackupManager does not change legacy data_version', async () => {
    const dir = newTempDir();
    const dataRoot = path.join(dir, 'data');
    mkdirSync(dataRoot, { recursive: true });
    const p = path.join(dataRoot, 'legacy.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const migrations = [baseMigrations[0]!];
    const { runner } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
      backupFactory: realBackupFactory(dataRoot),
      pathResolver: new PathResolverService(dir),
    });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(openReadOnlyUserVersion(p)).toBe(1);
  });

  it('row-only change after backup is caught through data_version', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = exactLegacyResult();
    const port = new FakeBackupPort();
    port.verifyBackup = async () => {
      const other = new DatabaseSync(p);
      other.exec("INSERT INTO project_workspaces (id) VALUES ('row-change')");
      other.close();
      return { ok: true };
    };
    const backupFactory: MigrationBackupFactory = { create: () => port };
    const { runner, journal } = makeRunner({ legacyAdmission: admission, backupFactory });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('changed state causes LEGACY_STATE_CHANGED_AFTER_BACKUP', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [exactLegacyResult(), blockedLegacyResult()];
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('failed initial admission creates no attempt', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = blockedLegacyResult();
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states).toEqual([]);
  });

  it('failed initial admission creates no backup', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = blockedLegacyResult();
    const { runner, backupFactory } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(backupFactory.port.created).toBe(false);
  });

  it('failed initial admission starts no transaction', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = blockedLegacyResult();
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(journal.states.map((s) => s.state)).not.toContain('TRANSACTION_STARTED');
  });

  it('failed initial admission executes no migration callback', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = blockedLegacyResult();
    let upCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          upCalled = true;
        },
      }),
    ];
    const { runner } = makeRunner({ migrations, targetVersion: 1, legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_ADMISSION_REJECTED');
    expect(upCalled).toBe(false);
  });

  it('failed post-backup admission marks attempt FAILED', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [exactLegacyResult(), blockedLegacyResult()];
    const { runner, journal } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('failed post-backup admission preserves the verified backup', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.resultsByCall = [exactLegacyResult(), blockedLegacyResult()];
    const { runner, backupFactory } = makeRunner({ legacyAdmission: admission });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(backupFactory.port.created).toBe(true);
    expect(backupFactory.port.verified).toBe(true);
  });

  it('locked data-version mismatch rolls back before TRANSACTION_STARTED', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.result = exactLegacyResult();
    const dir = newTempDir();
    const pathResolver = new PathResolverService(dir);
    const real = realDatabaseFactory();
    const databaseFactory: MigrationDatabaseFactory = {
      openReadWrite: (q) =>
        wrapDb(real.openReadWrite(q), { dataVersionAfterBeginImmediate: 999999 }),
      openReadOnly: (q) => real.openReadOnly(q),
    };
    let upCalled = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          upCalled = true;
        },
      }),
    ];
    const { runner, journal } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: admission,
      databaseFactory,
      pathResolver,
    });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(upCalled).toBe(false);
    const states = journal.states.map((s) => s.state);
    expect(states).not.toContain('TRANSACTION_STARTED');
    expect(states[states.length - 1]).toBe('FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
  });

  it('exact legacy 0 to 1 migration writes exactly one real history row', async () => {
    const p = buildLegacyFixture();
    const migrations = [baseMigrations[0]!];
    const { runner } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db
      .prepare(
        'SELECT migration_id, from_version, to_version, checksum, validation_result FROM schema_migrations',
      )
      .get() as Record<string, unknown>;
    expect(row['migration_id']).toBe('m-0-1');
    expect(row['from_version']).toBe(0);
    expect(row['to_version']).toBe(1);
    expect(row['checksum']).toBe(CHECKSUM_A);
    expect(row['validation_result']).toBe('passed');
    db.close();
  });

  it('no fake baseline history row exists', async () => {
    const p = buildLegacyFixture();
    const migrations = [baseMigrations[0]!];
    const { runner } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    await runner.run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    const rows = db
      .prepare('SELECT migration_id, from_version, to_version FROM schema_migrations')
      .all() as { migration_id: string; from_version: number; to_version: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.migration_id).toBe('m-0-1');
    expect(rows[0]!.from_version).toBe(0);
    expect(rows[0]!.to_version).toBe(1);
    db.close();
  });

  it('rollback leaves user_version at 0 and removes the transaction-created history table', async () => {
    const p = buildLegacyFixture();
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          throw new Error('fail');
        },
      }),
    ];
    const { runner } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(0);
    const db = new DatabaseSync(p, { readOnly: true });
    const sm = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    expect(sm).toBeUndefined();
    db.close();
  });

  it('typed detector unavailable error maps path-free', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    admission.failWith = new LegacyDetectorError(
      'DATABASE_UNAVAILABLE',
      'The database could not be opened for read-only inspection.',
    );
    const { runner } = makeRunner({ legacyAdmission: admission });
    try {
      await runner.run(p);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaMigrationError);
      expect((error as SchemaMigrationError).code).toBe('LEGACY_DETECTOR_UNAVAILABLE');
      expect((error as Error).message).not.toContain(':\\');
    }
  });

  it('unknown detector programming error still throws', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    const boom = new Error('boom');
    admission.failWith = boom;
    const { runner } = makeRunner({ legacyAdmission: admission });
    await expect(runner.run(p)).rejects.toBe(boom);
  });

  it('up-to-date version-zero populated database does not call admission', async () => {
    const p = populateVersionZeroDb();
    const admission = new FakeLegacyAdmission();
    const { runner } = makeRunner({ migrations: [], targetVersion: 0, legacyAdmission: admission });
    const result = await runner.run(p);
    expect(result.status).toBe('up-to-date');
    expect(admission.calls).toEqual([]);
  });

  it('schema change through another connection after backup is detected', async () => {
    const p = buildLegacyFixture();
    const port = new FakeBackupPort();
    port.verifyBackup = async () => {
      const other = new DatabaseSync(p);
      other.exec('CREATE TABLE concurrent_schema (id INTEGER PRIMARY KEY)');
      other.close();
      return { ok: true };
    };
    const backupFactory: MigrationBackupFactory = { create: () => port };
    const { runner, journal } = makeRunner({
      legacyAdmission: realLegacyAdmission(),
      backupFactory,
    });
    await expectReject(() => runner.run(p), 'LEGACY_STATE_CHANGED_AFTER_BACKUP');
    expect(journal.states[journal.states.length - 1]?.state).toBe('FAILED');
  });

  it('BEGIN IMMEDIATE prevents another writer from committing before the migration completes', async () => {
    const p = buildLegacyFixture();
    let concurrentWriteBlocked = false;
    const migrations = [
      makeMigration({
        id: 'm-0-1',
        from: 0,
        to: 1,
        checksum: CHECKSUM_A,
        description: 'a',
        up: () => {
          const other = new DatabaseSync(p);
          other.exec('PRAGMA busy_timeout = 50');
          try {
            other.exec('CREATE TABLE concurrent_probe (id INTEGER PRIMARY KEY)');
          } catch {
            concurrentWriteBlocked = true;
          }
          other.close();
        },
      }),
    ];
    const { runner } = makeRunner({
      migrations,
      targetVersion: 1,
      legacyAdmission: realLegacyAdmission(),
    });
    const result = await runner.run(p);
    expect(result.status).toBe('migrated');
    expect(concurrentWriteBlocked).toBe(true);
  });

  it('existing Reconciler can classify the committed-but-journal-interrupted first legacy migration', async () => {
    const dataRoot = newTempDir();
    const journalRoot = path.join(dataRoot, 'journals');
    const dbDir = path.join(dataRoot, 'data');
    mkdirSync(dbDir, { recursive: true });
    const p = path.join(dbDir, 'legacy.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const pathResolver = new PathResolverService(dataRoot);
    let appendCount = 0;
    let attemptCounter = 0;
    const journal = new PersistentMigrationJournal({
      journalRoot,
      databasePath: p,
      pathResolver,
      clock: makeClock(),
      idGenerator: { generate: () => 'att-' + String(++attemptCounter).padStart(4, '0') },
      appVersion: '3.3.0',
      journalFormatVersion: 1 as const,
      writeHooks: {
        beforeAppend: async () => {
          appendCount++;
          if (appendCount === 5) {
            throw new Error('simulated journal interruption before POST_VALIDATION_PASSED');
          }
        },
      },
    });
    const migrations = [baseMigrations[0]!];
    const runner = new SchemaMigrationRunner({
      migrations,
      targetVersion: 1,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal,
      clock: makeClock(),
      pathResolver,
      busyTimeoutMs: 5000,
      legacyAdmission: realLegacyAdmission(),
    });
    await expectReject(() => runner.run(p), 'JOURNAL_WRITE_FAILED');
    expect(openReadOnlyUserVersion(p)).toBe(1);
    expect(historyCount(p)).toBe(1);

    const inspector = new MigrationStateInspector(migrations, 1);
    const reconciler = new InterruptedMigrationReconciler({
      journal,
      inspector,
      databaseOpener: { open: () => new DatabaseSync(p, { readOnly: true }) },
      backupVerifier: { verifyBackupEvidence: async () => true },
    });
    const attempts = await journal.listAttempts();
    expect(attempts.length).toBe(1);
    const result = await reconciler.inspect(attempts[0]!.attemptId);
    expect(result.status).toBe('SAFE_PLAN');
    if (result.status === 'SAFE_PLAN') {
      expect(result.plan.disposition).toBe('RESOLVED_SUCCESS');
    }
  });
});
