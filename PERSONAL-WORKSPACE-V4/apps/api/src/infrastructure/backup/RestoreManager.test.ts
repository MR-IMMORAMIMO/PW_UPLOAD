/**
 * Tests for RestoreManager - fail-closed verified SQLite restore.
 *
 * P1.7A - Implement Fail-Closed Verified SQLite Restore Manager
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackupManager, BackupManagerError } from './BackupManager';
import { PathResolverService } from '../path/PathResolverService';
import {
  RestoreManager,
  RestoreManagerError,
  type BackupVerificationPort,
  type RestoreManagerHooks,
} from './RestoreManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');

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

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-restore-'));
  tempRoots.push(dir);
  return dir;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createSourceDb(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA user_version = 7');
  db.exec('CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)');
  db.exec('CREATE TABLE local_accounts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL)');
  db.exec('CREATE TABLE project_workspaces (project_id TEXT PRIMARY KEY, folder_path TEXT)');
  db.prepare('INSERT OR REPLACE INTO app_state (state_key, json_value) VALUES (?, ?)').run(
    'primary',
    '{"v":1}',
  );
  db.prepare('INSERT OR REPLACE INTO local_accounts (user_id, email) VALUES (?, ?)').run(
    'admin',
    'admin@local.test',
  );
  db.prepare(
    'INSERT OR REPLACE INTO project_workspaces (project_id, folder_path) VALUES (?, ?)',
  ).run('p1', 'C:\\Synthetic\\P1');
  return db;
}

function createTarget(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE old_data (id INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO old_data VALUES (?)').run(1);
  db.close();
}

interface Fixture {
  tempRoot: string;
  dataRoot: string;
  backupRoot: string;
  backupId: string;
  backupDbPath: string;
  targetPath: string;
  restoreManager: RestoreManager;
  manager: BackupManager;
  pathResolver: PathResolverService;
}

async function setup(
  overrides: {
    hooks?: RestoreManagerHooks;
    verifier?: BackupVerificationPort;
    nameGenerator?: { generate(): string };
  } = {},
): Promise<Fixture> {
  const tempRoot = newTempDir();
  const dataRoot = path.join(tempRoot, 'data');
  const backupRoot = path.join(dataRoot, 'backups');
  mkdirSync(dataRoot, { recursive: true });
  const sourceDbPath = path.join(dataRoot, 'source.sqlite');
  const sourceDb = createSourceDb(sourceDbPath);
  const pathResolver = new PathResolverService(dataRoot);
  let counter = 0;
  const manager = new BackupManager({
    sourceDb,
    sourceDatabasePath: sourceDbPath,
    backupRoot,
    pathResolver,
    clock: { now: () => FIXED_DATE },
    idGenerator: { generate: () => 'bk-' + String(++counter).padStart(4, '0') },
    appVersion: '3.3.0',
    verificationPolicy: {
      requiredTables: ['app_state', 'local_accounts', 'project_workspaces'],
    },
  });
  const backupResult = await manager.createVerifiedBackup({ reason: 'TEST' });
  await manager.verifyBackup(backupResult.backupId);
  sourceDb.close();
  const backupDbPath = path.join(backupRoot, backupResult.backupId, 'database.sqlite');
  const targetPath = path.join(dataRoot, 'target.sqlite');
  createTarget(targetPath);
  let nameCounter = 0;
  const restoreManager = new RestoreManager({
    backupRoot,
    pathResolver,
    verifier: overrides.verifier ?? manager,
    stagingNameGenerator: overrides.nameGenerator ?? {
      generate: () => 'n' + String(++nameCounter),
    },
    ...(overrides.hooks !== undefined ? { hooks: overrides.hooks } : {}),
  });
  return {
    tempRoot,
    dataRoot,
    backupRoot,
    backupId: backupResult.backupId,
    backupDbPath,
    targetPath,
    restoreManager,
    manager,
    pathResolver,
  };
}

function stagingPathFor(fx: Fixture, name: string): string {
  return path.join(path.dirname(fx.targetPath), '.restore-' + name + '.sqlite');
}

function rollbackPathFor(fx: Fixture, name: string): string {
  return path.join(path.dirname(fx.targetPath), '.restore-' + name + '.rollback.sqlite');
}

async function expectRestoreError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<RestoreManagerError> {
  try {
    await fn();
    throw new Error('expected RestoreManagerError to be thrown');
  } catch (error) {
    if (!(error instanceof RestoreManagerError)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RestoreManager', () => {
  // -----------------------------------------------------------------------
  // Successful restore
  // -----------------------------------------------------------------------

  it('restores a verified backup successfully', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(result.status).toBe('RESTORED');
    expect(result.backupId).toBe(fx.backupId);
    expect(result.rollbackPerformed).toBe(false);
    expect(result.verificationPassed).toBe(true);
  });

  it('restored target bytes match verified backup bytes', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('restored target SHA-256 matches result', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(result.restoredDatabaseSha256).toBe(sha256File(fx.targetPath));
    expect(result.restoredDatabaseSha256).toBe(sha256File(fx.backupDbPath));
  });

  it('backup bytes remain unchanged', async () => {
    const fx = await setup();
    const before = readFileSync(fx.backupDbPath);
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(readFileSync(fx.backupDbPath)).toEqual(before);
  });

  it('backup file remains present', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(existsSync(fx.backupDbPath)).toBe(true);
  });

  it('post-restore integrity passes', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const db = new DatabaseSync(fx.targetPath, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrity.integrity_check).toBe('ok');
    db.close();
  });

  it('required tables are present after restore', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const db = new DatabaseSync(fx.targetPath, { readOnly: true });
    for (const table of ['app_state', 'local_accounts', 'project_workspaces']) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name: string } | undefined;
      expect(row).toBeDefined();
    }
    db.close();
  });

  it('result is deeply immutable', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('no path appears in the result', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain(':\\');
    expect(json).not.toContain('scli-restore-');
  });

  // -----------------------------------------------------------------------
  // Pre-mutation rejection
  // -----------------------------------------------------------------------

  it('invalid target path is rejected', async () => {
    const fx = await setup();
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: '', backupId: fx.backupId }),
      'INVALID_TARGET_PATH',
    );
  });

  it('relative target is rejected', async () => {
    const fx = await setup();
    await expectRestoreError(
      () =>
        fx.restoreManager.restore({
          targetDatabasePath: 'relative/path.sqlite',
          backupId: fx.backupId,
        }),
      'INVALID_TARGET_PATH',
    );
  });

  it('missing target is rejected', async () => {
    const fx = await setup();
    const missing = path.join(fx.dataRoot, 'missing.sqlite');
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: missing, backupId: fx.backupId }),
      'TARGET_NOT_FOUND',
    );
  });

  it('target directory is rejected', async () => {
    const fx = await setup();
    const dir = path.join(fx.dataRoot, 'dir-target');
    mkdirSync(dir, { recursive: true });
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: dir, backupId: fx.backupId }),
      'TARGET_IS_DIRECTORY',
    );
  });

  it('target symlink or junction is rejected where supported', async () => {
    const fx = await setup();
    const link = path.join(fx.dataRoot, 'target-link.sqlite');
    try {
      symlinkSync(fx.targetPath, link);
      await expectRestoreError(
        () => fx.restoreManager.restore({ targetDatabasePath: link, backupId: fx.backupId }),
        'TARGET_IS_SYMLINK',
      );
      unlinkSync(link);
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES'
      ) {
        // Symlink creation not supported - skip
      } else {
        throw error;
      }
    }
  });

  it('backup symlink is rejected where supported', async () => {
    const fx = await setup();
    const real = path.join(fx.dataRoot, 'real-backup.sqlite');
    copyFileSync(fx.backupDbPath, real);
    const link = path.join(fx.backupRoot, fx.backupId, 'database-link.sqlite');
    try {
      symlinkSync(real, link);
      unlinkSync(fx.backupDbPath);
      renameSync(link, fx.backupDbPath);
      await expectRestoreError(
        () =>
          fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
        'BACKUP_IS_SYMLINK',
      );
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES'
      ) {
        // Symlink creation not supported - skip
      } else {
        throw error;
      }
    }
  });

  it('target and backup same file is rejected', async () => {
    const fx = await setup();
    await expectRestoreError(
      () =>
        fx.restoreManager.restore({ targetDatabasePath: fx.backupDbPath, backupId: fx.backupId }),
      'TARGET_EQUALS_BACKUP',
    );
  });

  it('junction alias of the backup file is rejected as the target', async () => {
    const fx = await setup();
    const link = path.join(fx.tempRoot, 'backup-alias');
    try {
      symlinkSync(fx.backupRoot, link, 'junction');
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES' ||
        (error as { code?: string }).code === 'ENOTSUP'
      ) {
        return; // Junction creation not supported - skip
      }
      throw error;
    }
    const backupBefore = readFileSync(fx.backupDbPath);
    const aliasBackup = path.join(link, fx.backupId, 'database.sqlite');
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: aliasBackup, backupId: fx.backupId }),
      'TARGET_EQUALS_BACKUP',
    );
    expect(readFileSync(fx.backupDbPath)).toEqual(backupBefore);
  });

  it('missing backup is rejected', async () => {
    const fx = await setup();
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: 'nope' }),
      'BACKUP_NOT_FOUND',
    );
  });

  it('unverified backup is rejected', async () => {
    const fx = await setup();
    const verifier: BackupVerificationPort = {
      verifyBackup: async () => {
        throw new BackupManagerError('INTEGRITY_CHECK_FAILED', 'Backup integrity failed.');
      },
    };
    const restoreManager = new RestoreManager({
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      verifier,
    });
    await expectRestoreError(
      () => restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
  });

  it('modified backup is rejected', async () => {
    const fx = await setup();
    const original = readFileSync(fx.backupDbPath);
    writeFileSync(fx.backupDbPath, Buffer.concat([original, Buffer.from('tampered')]));
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
  });

  it('corrupt backup is rejected', async () => {
    const fx = await setup();
    const buffer = readFileSync(fx.backupDbPath);
    for (let i = 0; i < 16 && i < buffer.length; i++) buffer[i] = 0;
    writeFileSync(fx.backupDbPath, buffer);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
  });

  it('missing required backup table is rejected', async () => {
    const fx = await setup();
    const db = new DatabaseSync(fx.backupDbPath);
    db.exec('DROP TABLE project_workspaces');
    db.close();
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
  });

  it('failure before mutation leaves target byte-identical', async () => {
    const fx = await setup();
    const before = readFileSync(fx.targetPath);
    const buffer = readFileSync(fx.backupDbPath);
    for (let i = 0; i < 16 && i < buffer.length; i++) buffer[i] = 0;
    writeFileSync(fx.backupDbPath, buffer);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });
  // -----------------------------------------------------------------------
  // WAL and handle safety
  // -----------------------------------------------------------------------

  it('non-empty WAL blocks restore', async () => {
    const fx = await setup();
    writeFileSync(fx.targetPath + '-wal', Buffer.alloc(100, 1));
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'TARGET_WAL_UNSAFE',
    );
  });

  it('unsafe WAL entry blocks restore', async () => {
    const fx = await setup();
    const walTarget = path.join(fx.dataRoot, 'wal-target');
    writeFileSync(walTarget, 'x');
    try {
      symlinkSync(walTarget, fx.targetPath + '-wal');
      await expectRestoreError(
        () =>
          fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
        'TARGET_WAL_UNSAFE',
      );
      unlinkSync(fx.targetPath + '-wal');
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES'
      ) {
        // Symlink creation not supported - skip
      } else {
        throw error;
      }
    }
  });

  it('unsafe SHM state blocks restore', async () => {
    const fx = await setup();
    const shmTarget = path.join(fx.dataRoot, 'shm-target');
    writeFileSync(shmTarget, 'x');
    try {
      symlinkSync(shmTarget, fx.targetPath + '-shm');
      await expectRestoreError(
        () =>
          fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
        'TARGET_SHM_UNSAFE',
      );
      unlinkSync(fx.targetPath + '-shm');
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES'
      ) {
        // Symlink creation not supported - skip
      } else {
        throw error;
      }
    }
  });

  it('non-empty SHM blocks restore', async () => {
    const fx = await setup();
    writeFileSync(fx.targetPath + '-shm', Buffer.alloc(32768, 0));
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'TARGET_SHM_UNSAFE',
    );
  });

  it('active or open target that prevents replacement fails closed', async () => {
    const fx = await setup();
    const before = readFileSync(fx.targetPath);
    const open = new DatabaseSync(fx.targetPath);
    try {
      await expectRestoreError(
        () =>
          fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
        'RENAME_ORIGINAL_FAILED',
      );
    } finally {
      open.close();
    }
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('restore does not checkpoint or change WAL/SHM', async () => {
    const fx = await setup();
    writeFileSync(fx.targetPath + '-wal', Buffer.alloc(0));
    writeFileSync(fx.targetPath + '-shm', Buffer.alloc(0));
    const walBefore = readFileSync(fx.targetPath + '-wal');
    const shmBefore = readFileSync(fx.targetPath + '-shm');
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(readFileSync(fx.targetPath + '-wal')).toEqual(walBefore);
    expect(readFileSync(fx.targetPath + '-shm')).toEqual(shmBefore);
  });

  it('database handles close on success', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(() => unlinkSync(fx.targetPath)).not.toThrow();
  });

  it('database handles close on failure', async () => {
    const fx = await setup();
    writeFileSync(fx.targetPath + '-wal', Buffer.alloc(100, 1));
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'TARGET_WAL_UNSAFE',
    );
    expect(() => unlinkSync(fx.targetPath)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Staging and replacement
  // -----------------------------------------------------------------------

  it('staging is created in the target directory', async () => {
    let captured = '';
    const fx = await setup({
      hooks: {
        beforeRenameStaging: (stagingPath) => {
          captured = stagingPath;
        },
      },
    });
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(path.dirname(captured)).toBe(path.dirname(fx.targetPath));
  });

  it('pre-existing staging collision is not overwritten', async () => {
    const fx = await setup();
    const collision = stagingPathFor(fx, 'n1');
    writeFileSync(collision, 'caller-owned');
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'STAGING_COLLISION',
    );
    expect(readFileSync(collision, 'utf8')).toBe('caller-owned');
  });

  it('original target remains until staging verification passes', async () => {
    let originalTargetBytes: Buffer = Buffer.alloc(0);
    const fx = await setup({
      hooks: {
        beforeStagingVerification: () => {
          expect(readFileSync(fx.targetPath)).toEqual(originalTargetBytes);
        },
      },
    });
    originalTargetBytes = readFileSync(fx.targetPath);
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
  });

  it('failure during staging copy leaves target unchanged', async () => {
    const fx = await setup({
      hooks: {
        beforeStagingCopy: () => {
          throw new Error('copy failed');
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('copy failed');
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('failure during staging fsync leaves target unchanged', async () => {
    const fx = await setup({
      hooks: {
        beforeStagingFsync: () => {
          throw new Error('fsync failed');
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('fsync failed');
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('failure during staging verification leaves target unchanged', async () => {
    const fx = await setup({
      hooks: {
        beforeStagingVerification: (stagingPath) => {
          writeFileSync(stagingPath, Buffer.from('not a database'));
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'STAGING_VERIFICATION_FAILED',
    );
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('rename original failure leaves target recoverable', async () => {
    const fx = await setup({
      hooks: {
        beforeRenameOriginal: () => {
          throw new Error('rename original failed');
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('rename original failed');
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('rename staging failure restores original target', async () => {
    const fx = await setup({
      hooks: {
        beforeRenameStaging: () => {
          throw new Error('rename staging failed');
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('rename staging failed');
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('post-replacement verification failure restores original target', async () => {
    const fx = await setup({
      hooks: {
        beforeReplacementVerification: (targetPath) => {
          writeFileSync(targetPath, Buffer.from('not a database'));
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'REPLACEMENT_VERIFICATION_FAILED',
    );
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('restored original bytes exactly match pre-restore bytes', async () => {
    const fx = await setup({
      hooks: {
        beforeRenameStaging: () => {
          throw new Error('rename staging failed');
        },
      },
    });
    const before = readFileSync(fx.targetPath);
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('rename staging failed');
    expect(readFileSync(fx.targetPath)).toEqual(before);
  });

  it('backup remains untouched after rollback', async () => {
    const fx = await setup({
      hooks: {
        beforeReplacementVerification: (targetPath) => {
          writeFileSync(targetPath, Buffer.from('not a database'));
        },
      },
    });
    const backupBefore = readFileSync(fx.backupDbPath);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'REPLACEMENT_VERIFICATION_FAILED',
    );
    expect(readFileSync(fx.backupDbPath)).toEqual(backupBefore);
  });

  it('no wildcard or unrelated deletion occurs', async () => {
    const fx = await setup({
      hooks: {
        beforeStagingVerification: (stagingPath) => {
          writeFileSync(stagingPath, Buffer.from('not a database'));
        },
      },
    });
    const sentinel = path.join(path.dirname(fx.targetPath), 'sentinel.txt');
    writeFileSync(sentinel, 'keep-me');
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'STAGING_VERIFICATION_FAILED',
    );
    expect(readFileSync(sentinel, 'utf8')).toBe('keep-me');
  });
  // -----------------------------------------------------------------------
  // Post-restore verification
  // -----------------------------------------------------------------------

  it('RESTORED is not returned before final verification', async () => {
    const fx = await setup({
      hooks: {
        beforeReplacementVerification: () => {
          throw new Error('final verification failed');
        },
      },
    });
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('final verification failed');
  });

  it('target hash is independently reread after replacement', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(result.restoredDatabaseSha256).toBe(sha256File(fx.targetPath));
  });

  it('failed final hash verification never returns RESTORED', async () => {
    const fx = await setup({
      hooks: {
        beforeReplacementVerification: (targetPath) => {
          const data = readFileSync(targetPath);
          writeFileSync(targetPath, Buffer.concat([data, Buffer.from('x')]));
        },
      },
    });
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'REPLACEMENT_VERIFICATION_FAILED',
    );
  });

  it('failed final integrity verification never returns RESTORED', async () => {
    const fx = await setup({
      hooks: {
        beforeReplacementVerification: (targetPath) => {
          const buffer = readFileSync(targetPath);
          for (let i = 0; i < 16 && i < buffer.length; i++) buffer[i] = 0;
          writeFileSync(targetPath, buffer);
        },
      },
    });
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'REPLACEMENT_VERIFICATION_FAILED',
    );
  });

  it('rollback copy is removed only after successful verification', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(existsSync(rollbackPathFor(fx, 'n2'))).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Concurrency
  // -----------------------------------------------------------------------

  it('two concurrent same-target restores cannot both mutate', async () => {
    const fx = await setup();
    const [r1, r2] = await Promise.all([
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ]);
    expect(r1.status).toBe('RESTORED');
    expect(r2.status).toBe('RESTORED');
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('same-target restores are serialized', async () => {
    const fx = await setup();
    let firstVerify = true;
    let secondVerifyCalled = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier: BackupVerificationPort = {
      verifyBackup: async (backupId) => {
        if (firstVerify) {
          firstVerify = false;
          await gate;
        } else {
          secondVerifyCalled = true;
        }
        return fx.manager.verifyBackup(backupId);
      },
    };
    const restoreManager = new RestoreManager({
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      verifier,
    });
    const p1 = restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const p2 = restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondVerifyCalled).toBe(false);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('RESTORED');
    expect(r2.status).toBe('RESTORED');
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('a failed restore does not poison a queued same-target restore', async () => {
    const fx = await setup();
    let verificationCalls = 0;
    const restoreManager = new RestoreManager({
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      verifier: fx.manager,
      hooks: {
        beforeReplacementVerification: (targetPath) => {
          verificationCalls += 1;
          if (verificationCalls === 1) {
            writeFileSync(targetPath, Buffer.from('not a database'));
          }
        },
      },
    });
    const p1 = restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const p2 = restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    await expect(p1).rejects.toMatchObject({ code: 'REPLACEMENT_VERIFICATION_FAILED' });
    const r2 = await p2;
    expect(r2.status).toBe('RESTORED');
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('junction aliases of the same target share one queue slot', async () => {
    const fx = await setup();
    const sub = path.join(fx.dataRoot, 'sub');
    mkdirSync(sub, { recursive: true });
    const realTarget = path.join(sub, 'target.sqlite');
    createTarget(realTarget);
    const link = path.join(fx.tempRoot, 'data-alias');
    try {
      symlinkSync(fx.dataRoot, link, 'junction');
    } catch (error) {
      if (
        (error as { code?: string }).code === 'EPERM' ||
        (error as { code?: string }).code === 'EACCES' ||
        (error as { code?: string }).code === 'ENOTSUP'
      ) {
        return; // Junction creation not supported - skip
      }
      throw error;
    }
    const aliasTarget = path.join(link, 'sub', 'target.sqlite');
    let firstVerify = true;
    let secondVerifyCalled = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier: BackupVerificationPort = {
      verifyBackup: async (backupId) => {
        if (firstVerify) {
          firstVerify = false;
          await gate;
        } else {
          secondVerifyCalled = true;
        }
        return fx.manager.verifyBackup(backupId);
      },
    };
    const restoreManager = new RestoreManager({
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      verifier,
    });
    const p1 = restoreManager.restore({
      targetDatabasePath: realTarget,
      backupId: fx.backupId,
    });
    const p2 = restoreManager.restore({
      targetDatabasePath: aliasTarget,
      backupId: fx.backupId,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondVerifyCalled).toBe(false);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('RESTORED');
    expect(r2.status).toBe('RESTORED');
    expect(readFileSync(realTarget)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('different target restores remain independent', async () => {
    const fx = await setup();
    const target2 = path.join(fx.dataRoot, 'target2.sqlite');
    createTarget(target2);
    const [r1, r2] = await Promise.all([
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      fx.restoreManager.restore({ targetDatabasePath: target2, backupId: fx.backupId }),
    ]);
    expect(r1.status).toBe('RESTORED');
    expect(r2.status).toBe('RESTORED');
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
    expect(readFileSync(target2)).toEqual(readFileSync(fx.backupDbPath));
  });

  it('failed restore does not poison later restore', async () => {
    const fx = await setup();
    const buffer = readFileSync(fx.backupDbPath);
    for (let i = 0; i < 16 && i < buffer.length; i++) buffer[i] = 0;
    writeFileSync(fx.backupDbPath, buffer);
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'BACKUP_VERIFICATION_FAILED',
    );
    const sourceDb = createSourceDb(path.join(fx.dataRoot, 'source2.sqlite'));
    let counter = 0;
    const manager2 = new BackupManager({
      sourceDb,
      sourceDatabasePath: path.join(fx.dataRoot, 'source2.sqlite'),
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      clock: { now: () => FIXED_DATE },
      idGenerator: { generate: () => 'bk2-' + String(++counter).padStart(4, '0') },
      appVersion: '3.3.0',
      verificationPolicy: {
        requiredTables: ['app_state', 'local_accounts', 'project_workspaces'],
      },
    });
    const backup2 = await manager2.createVerifiedBackup({ reason: 'TEST' });
    sourceDb.close();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: backup2.backupId,
    });
    expect(result.status).toBe('RESTORED');
  });

  it('queue entries are released', async () => {
    const fx = await setup();
    await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    expect(result.status).toBe('RESTORED');
  });

  // -----------------------------------------------------------------------
  // Error and privacy
  // -----------------------------------------------------------------------

  it('typed errors use stable codes', async () => {
    const fx = await setup();
    const error = await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: '', backupId: fx.backupId }),
      'INVALID_TARGET_PATH',
    );
    expect(error).toBeInstanceOf(RestoreManagerError);
  });

  it('public error messages contain no target or backup path', async () => {
    const fx = await setup();
    const error = await expectRestoreError(
      () =>
        fx.restoreManager.restore({
          targetDatabasePath: path.join(fx.dataRoot, 'missing.sqlite'),
          backupId: fx.backupId,
        }),
      'TARGET_NOT_FOUND',
    );
    expect(error.message).not.toContain(':\\');
    expect(error.message).not.toContain('scli-restore-');
  });

  it('public results contain no SQL, stack or Error objects', async () => {
    const fx = await setup();
    const result = await fx.restoreManager.restore({
      targetDatabasePath: fx.targetPath,
      backupId: fx.backupId,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('CREATE');
    expect(json).not.toContain('SELECT');
    expect(json).not.toContain('Error');
    expect(json).not.toContain(' at ');
  });

  it('unknown verifier error throws', async () => {
    const fx = await setup();
    const boom = new Error('verifier boom');
    const verifier: BackupVerificationPort = {
      verifyBackup: async () => {
        throw boom;
      },
    };
    const restoreManager = new RestoreManager({
      backupRoot: fx.backupRoot,
      pathResolver: fx.pathResolver,
      verifier,
    });
    await expect(
      restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toBe(boom);
  });

  it('unknown filesystem error throws', async () => {
    const fx = await setup({
      hooks: {
        beforeStagingCopy: () => {
          throw new Error('filesystem boom');
        },
      },
    });
    await expect(
      fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
    ).rejects.toThrow('filesystem boom');
  });

  it('rollback failure is not hidden', async () => {
    const fx = await setup({
      hooks: {
        beforeRenameStaging: () => {
          throw new Error('rename staging failed');
        },
        beforeRollback: () => {
          throw new RestoreManagerError(
            'ROLLBACK_FAILED',
            'The original target could not be restored.',
          );
        },
      },
    });
    await expectRestoreError(
      () => fx.restoreManager.restore({ targetDatabasePath: fx.targetPath, backupId: fx.backupId }),
      'ROLLBACK_FAILED',
    );
  });
});
