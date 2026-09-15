import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BackupManager,
  BackupManagerError,
  type BackupFunction,
  type BackupManagerDeps,
  type BackupMetadata,
  type BackupProgress,
  type Clock,
  type IdGenerator,
} from './BackupManager';
import { PathResolverService } from '../path/PathResolverService';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync, backup: realBackup } = (await import(
  nodeSqliteSpecifier
)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

function isPlatformLinkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && ['EPERM', 'EACCES', 'ENOSYS'].includes(code);
}

/** Attempt to create a throwaway file symlink first; skip only on recognized OS permission errors. */
function ensureFileSymlinkCapability(ctx: { skip: (note?: string) => never }): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-probe-'));
  try {
    const target = path.join(dir, 'target.txt');
    const link = path.join(dir, 'link.txt');
    writeFileSync(target, 'x');
    symlinkSync(target, link);
    return true;
  } catch (error) {
    if (isPlatformLinkError(error)) {
      ctx.skip('symlink creation denied by the operating system');
    }
    throw error;
  } finally {
    try {
      removeTree(dir);
    } catch {
      // Best-effort cleanup of the probe directory.
    }
  }
}

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');
const FIXED_ISO = FIXED_DATE.toISOString();

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function corruptDatabase(filePath: string): void {
  const buffer = readFileSync(filePath);
  for (let i = 0; i < 16 && i < buffer.length; i++) buffer[i] = 0;
  writeFileSync(filePath, buffer);
}

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

function createSourceDb(
  dbPath: string,
  options: { userVersion?: number | undefined; extraDdl?: string[] | undefined } = {},
): DatabaseSyncInstance {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA user_version = ${options.userVersion ?? 7}`);
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)',
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS local_accounts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL)',
  );
  db.prepare('INSERT OR REPLACE INTO app_state (state_key, json_value) VALUES (?, ?)').run(
    'primary',
    '{"v":1}',
  );
  db.prepare('INSERT OR REPLACE INTO local_accounts (user_id, email) VALUES (?, ?)').run(
    'admin',
    'admin@local.test',
  );
  for (const ddl of options.extraDdl ?? []) db.exec(ddl);
  return db;
}

function createMemorySourceDb(userVersion: number): DatabaseSyncInstance {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = ' + userVersion);
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)',
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS local_accounts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL)',
  );
  return db;
}

interface SetupOptions {
  externalSource?: boolean;
  userVersion?: number | undefined;
  extraDdl?: string[] | undefined;
  requiredTables?: string[] | undefined;
  validateDatabase?: ((db: DatabaseSyncInstance) => void) | undefined;
  backupFunction?: BackupFunction | undefined;
  appVersion?: string;
  idPrefix?: string;
  nestedManagedSource?: boolean;
  idOverride?: string;
  memorySource?: boolean;
  sourceDatabasePathOverride?: string;
  backupRootOverride?: string;
  preManagerHook?:
    ((ctx: { dataRoot: string; backupRoot: string; sourceDbPath: string }) => void) | undefined;
}

interface SetupResult {
  tempRoot: string;
  dataRoot: string;
  backupRoot: string;
  sourceDb: DatabaseSyncInstance;
  sourceDbPath: string;
  manager: BackupManager;
  pathResolver: PathResolverService;
  clock: Clock;
  idGenerator: IdGenerator;
}

const openDbs: DatabaseSyncInstance[] = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (openDbs.length) {
    try {
      openDbs.pop()?.close();
    } catch {
      // Ignore close errors during cleanup.
    }
  }
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function setup(options: SetupOptions = {}): SetupResult {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'scli-bk-'));
  tempRoots.push(tempRoot);
  const dataRoot = path.join(tempRoot, 'data');
  const backupRoot = options.backupRootOverride ?? path.join(dataRoot, 'backups');
  mkdirSync(dataRoot, { recursive: true });
  const actualDbPath = options.externalSource
    ? path.join(tempRoot, 'external', 'scli.sqlite')
    : options.nestedManagedSource
      ? path.join(dataRoot, 'db', 'scli.sqlite')
      : path.join(dataRoot, 'scli.sqlite');
  const sourceDbPath = options.sourceDatabasePathOverride ?? actualDbPath;
  const sourceDb = options.memorySource
    ? createMemorySourceDb(options.userVersion ?? 7)
    : createSourceDb(actualDbPath, {
        userVersion: options.userVersion,
        extraDdl: options.extraDdl,
      });
  openDbs.push(sourceDb);
  const pathResolver = new PathResolverService(dataRoot);
  const clock: Clock = { now: () => FIXED_DATE };
  let counter = 0;
  const prefix = options.idPrefix ?? 'bk';
  const idGenerator: IdGenerator = {
    generate: () => options.idOverride ?? `${prefix}-${String(++counter).padStart(4, '0')}`,
  };
  const deps: BackupManagerDeps = {
    sourceDb,
    sourceDatabasePath: sourceDbPath,
    backupRoot,
    pathResolver,
    clock,
    idGenerator,
    appVersion: options.appVersion ?? '3.3.0',
    verificationPolicy: {
      requiredTables: options.requiredTables ?? ['app_state', 'local_accounts'],
      validateDatabase: options.validateDatabase,
    },
    backupFunction: options.backupFunction,
  };
  options.preManagerHook?.({ dataRoot, backupRoot, sourceDbPath });
  const manager = new BackupManager(deps);
  return {
    tempRoot,
    dataRoot,
    backupRoot,
    sourceDb,
    sourceDbPath,
    manager,
    pathResolver,
    clock,
    idGenerator,
  };
}

function metadataPathFor(backupRoot: string, backupId: string): string {
  return path.join(backupRoot, backupId, 'metadata.json');
}

function dbPathFor(backupRoot: string, backupId: string): string {
  return path.join(backupRoot, backupId, 'database.sqlite');
}

async function expectReject(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected BackupManagerError to be thrown');
  } catch (error) {
    if (!(error instanceof BackupManagerError)) throw error;
    expect(error.code).toBe(code);
  }
}

function expectSyncError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected BackupManagerError to be thrown');
  } catch (error) {
    if (!(error instanceof BackupManagerError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe('BackupManager', () => {
  it('creates a successful verified backup', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'pre-migration' });
    expect(result.backupId).toBe('bk-0001');
    expect(existsSync(path.join(backupRoot, result.backupId, 'database.sqlite'))).toBe(true);
    expect(existsSync(metadataPathFor(backupRoot, result.backupId))).toBe(true);
    expect(result.metadata.status).toBe('verified');
  });

  it('keeps the source connection open and usable after backup', async () => {
    const { manager, sourceDb } = setup();
    await manager.createVerifiedBackup({ reason: 'manual' });
    expect(sourceDb.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
  });

  it('includes committed WAL data without raw file copying', async () => {
    const { manager, sourceDb, backupRoot } = setup();
    sourceDb.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    sourceDb.prepare('INSERT INTO notes (id, body) VALUES (?, ?)').run(1, 'uncheckpointed-wal-row');
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const backupDb = new DatabaseSync(dbPathFor(backupRoot, result.backupId), { readOnly: true });
    try {
      const row = backupDb.prepare('SELECT body FROM notes WHERE id = ?').get(1) as {
        body: string;
      };
      expect(row.body).toBe('uncheckpointed-wal-row');
    } finally {
      backupDb.close();
    }
  });

  it('reports monotonic progress and ends at 100 percent', async () => {
    const { manager, sourceDb } = setup();
    sourceDb.exec('CREATE TABLE IF NOT EXISTS big (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const stmt = sourceDb.prepare('INSERT INTO big (id, payload) VALUES (?, ?)');
    for (let i = 0; i < 200; i++) stmt.run(i, 'x'.repeat(200));
    const seen: number[] = [];
    await manager.createVerifiedBackup({
      reason: 'manual',
      onProgress: (p) => seen.push(p.percentage),
    });
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it('uses a deterministic metadata timestamp from the injected clock', async () => {
    const { manager } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.createdAt).toBe(FIXED_ISO);
  });

  it('uses the injected backup ID', async () => {
    const { manager } = setup({ idPrefix: 'fixed' });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.backupId).toBe('fixed-0001');
    expect(result.metadata.backupId).toBe('fixed-0001');
  });

  it('records application version and Node version in metadata', async () => {
    const { manager } = setup({ appVersion: '3.3.0' });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.appVersion).toBe('3.3.0');
    expect(result.metadata.nodeVersion).toBe(process.versions.node);
  });

  it('stores a managed source path as a forward-slash relative path', async () => {
    const { manager } = setup({ nestedManagedSource: true });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.sourceDatabase.location).toBe('managed');
    expect(result.metadata.sourceDatabase.relativePath).toBe('db/scli.sqlite');
  });

  it('stores no absolute path for an external source', async () => {
    const { manager, tempRoot, sourceDbPath } = setup({ externalSource: true });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.sourceDatabase.location).toBe('external');
    expect(result.metadata.sourceDatabase.relativePath).toBeUndefined();
    const json = JSON.stringify(result.metadata);
    expect(json).not.toContain(sourceDbPath);
    expect(json).not.toContain(tempRoot);
  });

  it('does not leak username, temp root, or absolute data-root path into metadata', async () => {
    const { manager, dataRoot, tempRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const json = JSON.stringify(result.metadata);
    expect(json).not.toContain(dataRoot);
    expect(json).not.toContain(tempRoot);
    expect(json).not.toContain(tmpdir());
  });

  it('records a SHA-256 that matches the final database file', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.backupDatabase.sha256).toBe(
      sha256File(dbPathFor(backupRoot, result.backupId)),
    );
  });

  it('records a size that matches the final database file', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.backupDatabase.sizeBytes).toBe(
      statSync(dbPathFor(backupRoot, result.backupId)).size,
    );
  });

  it('passes PRAGMA integrity_check on the staged backup', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const backupDb = new DatabaseSync(dbPathFor(backupRoot, result.backupId), { readOnly: true });
    try {
      const row = backupDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      expect(row.integrity_check).toBe('ok');
    } finally {
      backupDb.close();
    }
  });

  it('records and verifies PRAGMA user_version', async () => {
    const { manager } = setup({ userVersion: 42 });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.schemaVersion).toBe(42);
    const verification = await manager.verifyBackup(result.backupId);
    expect(verification.schemaVersion).toBe(42);
  });

  it('verifies all required tables are present', async () => {
    const { manager } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.verification.requiredTablesChecked).toEqual([
      'app_state',
      'local_accounts',
    ]);
    const verification = await manager.verifyBackup(result.backupId);
    expect(verification.requiredTablesChecked).toEqual(['app_state', 'local_accounts']);
  });

  it('runs a custom verification policy that succeeds', async () => {
    const { manager } = setup({
      validateDatabase: (db) => {
        const row = db.prepare('SELECT COUNT(*) AS count FROM local_accounts').get() as {
          count: number;
        };
        if (row.count !== 1) throw new Error('unexpected account count');
      },
    });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.verification.customPolicyChecked).toBe(true);
    await manager.verifyBackup(result.backupId);
  });

  it('returns the exact typed error when a custom verification policy fails', async () => {
    const { manager } = setup({
      validateDatabase: () => {
        throw new Error('policy rejection');
      },
    });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'CUSTOM_VERIFICATION_FAILED',
    );
  });

  it('returns the exact typed error when a required table is missing', async () => {
    const { manager } = setup({ requiredTables: ['app_state', 'nonexistent_table'] });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'REQUIRED_TABLE_MISSING',
    );
  });

  it('rejects an empty reason', async () => {
    const { manager } = setup();
    await expectReject(
      () => manager.createVerifiedBackup({ reason: '   ' }),
      'INVALID_BACKUP_REQUEST',
    );
  });

  it('rejects a NUL character in reason', async () => {
    const { manager } = setup();
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'bad\0reason' }),
      'INVALID_BACKUP_REQUEST',
    );
  });

  it('rejects an invalid backup ID on inspect', async () => {
    const { manager } = setup();
    await expectReject(() => manager.inspectBackup('bad/id'), 'INVALID_BACKUP_ID');
    await expectReject(() => manager.inspectBackup('.partial-xyz'), 'INVALID_BACKUP_ID');
  });

  it('does not overwrite existing data on a final-directory collision', async () => {
    const { manager, backupRoot } = setup({ idPrefix: 'collide' });
    const finalDir = path.join(backupRoot, 'collide-0001');
    mkdirSync(finalDir, { recursive: true });
    writeFileSync(path.join(finalDir, 'sentinel.txt'), 'keep-me');
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'BACKUP_COLLISION',
    );
    expect(readFileSync(path.join(finalDir, 'sentinel.txt'), 'utf8')).toBe('keep-me');
  });

  it('does not overwrite existing data on a staging-directory collision', async () => {
    const { manager, backupRoot } = setup({ idPrefix: 'collide' });
    const stagingDir = path.join(backupRoot, '.partial-collide-0001');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(path.join(stagingDir, 'sentinel.txt'), 'keep-me');
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'BACKUP_COLLISION',
    );
    expect(readFileSync(path.join(stagingDir, 'sentinel.txt'), 'utf8')).toBe('keep-me');
  });

  it('removes only the current staging directory when backupFunction fails', async () => {
    const { manager, backupRoot } = setup({
      backupFunction: async () => {
        throw new Error('backup boom');
      },
    });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'BACKUP_EXECUTION_FAILED',
    );
    expect(existsSync(path.join(backupRoot, '.partial-bk-0001'))).toBe(false);
  });

  it('preserves the source database when backupFunction fails', async () => {
    const { manager, sourceDb } = setup({
      backupFunction: async () => {
        throw new Error('backup boom');
      },
    });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'BACKUP_EXECUTION_FAILED',
    );
    expect(sourceDb.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
  });

  it('preserves both original and cleanup error information when cleanup fails', async () => {
    const { manager, backupRoot } = setup({
      backupFunction: async (_src, destPath) => {
        writeFileSync(path.join(path.dirname(destPath), 'leftover.txt'), 'stray');
        throw new Error('backup boom');
      },
    });
    let caught: BackupManagerError | undefined;
    try {
      await manager.createVerifiedBackup({ reason: 'manual' });
    } catch (error) {
      if (error instanceof BackupManagerError) caught = error;
    }
    expect(caught?.code).toBe('CLEANUP_FAILED');
    expect(caught?.cause).toBeInstanceOf(BackupManagerError);
    expect((caught?.cause as BackupManagerError).code).toBe('BACKUP_EXECUTION_FAILED');
    expect(existsSync(path.join(backupRoot, '.partial-bk-0001', 'leftover.txt'))).toBe(true);
  });

  it('rejects a corrupted database', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const dbFile = dbPathFor(backupRoot, result.backupId);
    corruptDatabase(dbFile);
    await expectReject(() => manager.verifyBackup(result.backupId), 'INTEGRITY_CHECK_FAILED');
  });

  it('detects metadata SHA-256 tampering', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as BackupMetadata;
    meta.backupDatabase.sha256 = '0'.repeat(64);
    writeFileSync(metaFile, JSON.stringify(meta));
    await expectReject(() => manager.verifyBackup(result.backupId), 'CHECKSUM_MISMATCH');
  });

  it('detects metadata size tampering', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as BackupMetadata;
    meta.backupDatabase.sizeBytes = meta.backupDatabase.sizeBytes + 1;
    writeFileSync(metaFile, JSON.stringify(meta));
    await expectReject(() => manager.verifyBackup(result.backupId), 'SIZE_MISMATCH');
  });

  it('detects metadata schema-version tampering', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as BackupMetadata;
    meta.schemaVersion = 999;
    writeFileSync(metaFile, JSON.stringify(meta));
    await expectReject(() => manager.verifyBackup(result.backupId), 'SCHEMA_VERSION_MISMATCH');
  });

  it('rejects invalid metadata JSON', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    writeFileSync(metadataPathFor(backupRoot, result.backupId), '{ not valid json');
    await expectReject(() => manager.verifyBackup(result.backupId), 'METADATA_INVALID');
  });

  it('rejects an unknown backupFormatVersion', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as BackupMetadata;
    (meta as { backupFormatVersion: number }).backupFormatVersion = 2;
    writeFileSync(metaFile, JSON.stringify(meta));
    await expectReject(() => manager.verifyBackup(result.backupId), 'METADATA_INVALID');
  });

  it('rejects missing metadata', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    unlinkSync(metadataPathFor(backupRoot, result.backupId));
    await expectReject(() => manager.verifyBackup(result.backupId), 'METADATA_NOT_FOUND');
  });

  it('rejects a missing database.sqlite', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    unlinkSync(dbPathFor(backupRoot, result.backupId));
    await expectReject(() => manager.verifyBackup(result.backupId), 'BACKUP_FILE_MISSING');
  });

  it('does not perform database verification in inspectBackup', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const dbFile = dbPathFor(backupRoot, result.backupId);
    corruptDatabase(dbFile);
    const meta = await manager.inspectBackup(result.backupId);
    expect(meta.backupId).toBe(result.backupId);
  });

  it('does not modify files during verifyBackup', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const dbFile = dbPathFor(backupRoot, result.backupId);
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const dbSize = statSync(dbFile).size;
    const dbHash = sha256File(dbFile);
    const metaContent = readFileSync(metaFile, 'utf8');
    await manager.verifyBackup(result.backupId);
    expect(statSync(dbFile).size).toBe(dbSize);
    expect(sha256File(dbFile)).toBe(dbHash);
    expect(readFileSync(metaFile, 'utf8')).toBe(metaContent);
  });

  it('keeps two backups with different generated IDs independent', async () => {
    const { manager, backupRoot } = setup();
    const a = await manager.createVerifiedBackup({ reason: 'first' });
    const b = await manager.createVerifiedBackup({ reason: 'second' });
    expect(a.backupId).not.toBe(b.backupId);
    expect(existsSync(path.join(backupRoot, a.backupId, 'database.sqlite'))).toBe(true);
    expect(existsSync(path.join(backupRoot, b.backupId, 'database.sqlite'))).toBe(true);
  });

  it('never produces unsafe filename characters in generated paths', async () => {
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.backupId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(result.backupDirectory).toBe(path.join(backupRoot, result.backupId));
  });

  it('does not accept .partial-* directories as final backups', async () => {
    const { manager, backupRoot } = setup();
    const stagingDir = path.join(backupRoot, '.partial-stray');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(path.join(stagingDir, 'database.sqlite'), 'junk');
    await expectReject(() => manager.inspectBackup('.partial-stray'), 'INVALID_BACKUP_ID');
    await expectReject(() => manager.inspectBackup('stray'), 'BACKUP_NOT_FOUND');
  });

  it('does not create, modify, or delete files outside backupRoot', async () => {
    const { manager, backupRoot, sourceDbPath } = setup();
    const sourceHashBefore = sha256File(sourceDbPath);
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.backupDirectory.startsWith(backupRoot)).toBe(true);
    expect(sha256File(sourceDbPath)).toBe(sourceHashBefore);
    expect(existsSync(path.join(backupRoot, result.backupId, 'database.sqlite'))).toBe(true);
  });

  it('rejects a sourceDatabasePath that does not match the handle main path', async () => {
    const { manager } = setup({
      sourceDatabasePathOverride: path.join(tmpdir(), 'mismatch.sqlite'),
    });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'INVALID_CONFIGURATION',
    );
  });

  it('rejects an in-memory source database handle', async () => {
    const { manager } = setup({ memorySource: true });
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual' }),
      'SOURCE_DATABASE_UNAVAILABLE',
    );
  });

  it('rejects Windows reserved backup IDs', async () => {
    for (const badId of ['CON', 'PRN', 'CON.sqlite', 'LPT1.backup', 'CLOCK$', 'COM1']) {
      const { manager } = setup({ idOverride: badId });
      await expectReject(
        () => manager.createVerifiedBackup({ reason: 'manual' }),
        'INVALID_BACKUP_ID',
      );
    }
  });

  it('rejects backup IDs with leading or trailing spaces or dots', async () => {
    for (const badId of [' lead', 'trail ', 'dot.', '.lead']) {
      const { manager } = setup({ idOverride: badId });
      await expectReject(
        () => manager.createVerifiedBackup({ reason: 'manual' }),
        'INVALID_BACKUP_ID',
      );
    }
  });

  it('rejects a backupRoot that is a file', () => {
    expectSyncError(
      () => setup({ preManagerHook: ({ backupRoot }) => writeFileSync(backupRoot, 'x') }),
      'INVALID_CONFIGURATION',
    );
  });

  it('rejects a source database path inside backupRoot (self-backup)', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'scli-self-'));
    tempRoots.push(tempRoot);
    const dataRoot = path.join(tempRoot, 'data');
    mkdirSync(dataRoot, { recursive: true });
    const sourceDbPath = path.join(dataRoot, 'scli.sqlite');
    const sourceDb = createSourceDb(sourceDbPath);
    openDbs.push(sourceDb);
    const pathResolver = new PathResolverService(dataRoot);
    expectSyncError(
      () =>
        new BackupManager({
          sourceDb,
          sourceDatabasePath: sourceDbPath,
          backupRoot: dataRoot,
          pathResolver,
          clock: { now: () => FIXED_DATE },
          idGenerator: { generate: () => 'bk-0001' },
          appVersion: '3.3.0',
          verificationPolicy: { requiredTables: ['app_state', 'local_accounts'] },
        }),
      'INVALID_CONFIGURATION',
    );
  });

  it('rejects a backupRoot that is a junction or symlink', () => {
    expectSyncError(
      () =>
        setup({
          preManagerHook: ({ dataRoot, backupRoot }) =>
            symlinkSync(dataRoot, backupRoot, 'junction'),
        }),
      'INVALID_CONFIGURATION',
    );
  });

  it('rejects a symlinked database.sqlite during verify', async (ctx) => {
    ensureFileSymlinkCapability(ctx);
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const dbFile = dbPathFor(backupRoot, result.backupId);
    const real = path.join(backupRoot, result.backupId, 'real.sqlite');
    unlinkSync(dbFile);
    writeFileSync(real, 'not a database');
    symlinkSync(real, dbFile);
    await expectReject(() => manager.verifyBackup(result.backupId), 'INTEGRITY_CHECK_FAILED');
  });

  it('rejects a symlinked metadata.json during inspect', async (ctx) => {
    ensureFileSymlinkCapability(ctx);
    const { manager, backupRoot } = setup();
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    const metaFile = metadataPathFor(backupRoot, result.backupId);
    const real = path.join(backupRoot, result.backupId, 'realmeta.json');
    unlinkSync(metaFile);
    writeFileSync(real, '{}');
    symlinkSync(real, metaFile);
    await expectReject(() => manager.inspectBackup(result.backupId), 'METADATA_INVALID');
  });

  it('normalizes duplicate required tables', async () => {
    const { manager } = setup({ requiredTables: ['app_state', 'app_state', 'local_accounts'] });
    const result = await manager.createVerifiedBackup({ reason: 'manual' });
    expect(result.metadata.verification.requiredTablesChecked).toEqual([
      'app_state',
      'local_accounts',
    ]);
  });

  it('rejects an empty required table name', () => {
    expectSyncError(() => setup({ requiredTables: ['app_state', ''] }), 'INVALID_CONFIGURATION');
  });

  it('rejects a reason longer than 500 characters', async () => {
    const { manager } = setup();
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'x'.repeat(501) }),
      'INVALID_BACKUP_REQUEST',
    );
  });

  it('rejects a migrationId longer than 200 characters', async () => {
    const { manager } = setup();
    await expectReject(
      () => manager.createVerifiedBackup({ reason: 'manual', migrationId: 'm'.repeat(201) }),
      'INVALID_BACKUP_REQUEST',
    );
  });

  it('does not leak malformed or decreasing progress from the backup function', async () => {
    const calls: BackupProgress[] = [];
    const { manager, sourceDb } = setup({
      backupFunction: async (src, destPath, options) => {
        await realBackup(src, destPath);
        options?.progress?.({ totalPages: 50, remainingPages: 40 });
        options?.progress?.({ totalPages: 50, remainingPages: 60 });
        options?.progress?.({ totalPages: Number.NaN, remainingPages: -1 });
        return 50;
      },
    });
    sourceDb.exec('CREATE TABLE IF NOT EXISTS big (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const stmt = sourceDb.prepare('INSERT INTO big (id, payload) VALUES (?, ?)');
    for (let i = 0; i < 50; i++) stmt.run(i, 'x'.repeat(200));
    await manager.createVerifiedBackup({
      reason: 'manual',
      onProgress: (p) => calls.push(p),
    });
    for (const p of calls) {
      expect(Number.isFinite(p.percentage)).toBe(true);
      expect(p.percentage).toBeGreaterThanOrEqual(0);
      expect(p.percentage).toBeLessThanOrEqual(100);
      expect(Number.isFinite(p.completedPages)).toBe(true);
      expect(p.completedPages).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.percentage).toBeGreaterThanOrEqual(calls[i - 1]!.percentage);
    }
  });

  it('tolerates a throwing caller progress callback', async () => {
    const { manager, sourceDb } = setup();
    sourceDb.exec('CREATE TABLE IF NOT EXISTS big (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    const stmt = sourceDb.prepare('INSERT INTO big (id, payload) VALUES (?, ?)');
    for (let i = 0; i < 200; i++) stmt.run(i, 'x'.repeat(200));
    const result = await manager.createVerifiedBackup({
      reason: 'manual',
      onProgress: () => {
        throw new Error('caller boom');
      },
    });
    expect(result.metadata.status).toBe('verified');
  });
});
