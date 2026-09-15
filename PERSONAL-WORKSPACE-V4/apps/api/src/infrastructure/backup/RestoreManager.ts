/**
 * RestoreManager: fail-closed verified SQLite restore from an existing BackupManager backup.
 *
 * Restore infrastructure only. It never integrates startup behavior, never implements automatic
 * restore policy, never executes migrations, never resolves journal attempts, and never claims
 * cross-process locking. It accepts only an existing BackupManager backup artifact, reverifies
 * that backup immediately before any mutation, restores through a same-directory staging file,
 * preserves the original target until the restored database is verified, and rolls back to the
 * original target when replacement or verification fails.
 *
 * Application startup integration must ensure the target database is closed before restore; the
 * RestoreManager fails closed when an open handle prevents exclusive replacement, but it cannot
 * detect every open handle in advance.
 *
 * P1.7A - Implement Fail-Closed Verified SQLite Restore Manager
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  lstatSync,
  openSync,
  fsyncSync,
  closeSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { win32 as winPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PathResolverService } from '../path/PathResolverService';
import { BackupManagerError, type BackupVerification } from './BackupManager';
import {
  prepareManagedAssetRestore,
  type ManagedAssetRoot,
  type PreparedManagedAssetRestore,
} from './ManagedAssetSnapshot';

// Keep the specifier dynamic so the bundler does not rewrite `node:sqlite` to `sqlite`.
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RestoreStatus = 'RESTORED';

export interface VerifiedRestoreRequest {
  readonly targetDatabasePath: string;
  readonly backupId: string;
}

export interface VerifiedRestoreResult {
  readonly status: 'RESTORED';
  readonly backupId: string;
  readonly restoredDatabaseSha256: string;
  readonly rollbackPerformed: false;
  readonly verificationPassed: true;
}

export type RestoreManagerErrorCode =
  | 'INVALID_TARGET_PATH'
  | 'UNSAFE_TARGET_PATH'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_IS_DIRECTORY'
  | 'TARGET_IS_SYMLINK'
  | 'TARGET_IS_SPECIAL'
  | 'TARGET_PARENT_MISSING'
  | 'TARGET_PARENT_NOT_DIRECTORY'
  | 'TARGET_EQUALS_BACKUP'
  | 'TARGET_INSIDE_BACKUP_STAGING'
  | 'INVALID_BACKUP_ID'
  | 'BACKUP_NOT_FOUND'
  | 'BACKUP_IS_DIRECTORY'
  | 'BACKUP_IS_SYMLINK'
  | 'BACKUP_IS_SPECIAL'
  | 'BACKUP_OUTSIDE_ROOT'
  | 'BACKUP_VERIFICATION_FAILED'
  | 'TARGET_WAL_UNSAFE'
  | 'TARGET_SHM_UNSAFE'
  | 'STAGING_COLLISION'
  | 'STAGING_COPY_FAILED'
  | 'STAGING_FSYNC_FAILED'
  | 'STAGING_VERIFICATION_FAILED'
  | 'ROLLBACK_PATH_EXISTS'
  | 'RENAME_ORIGINAL_FAILED'
  | 'RENAME_STAGING_FAILED'
  | 'REPLACEMENT_VERIFICATION_FAILED'
  | 'MANAGED_ASSET_RESTORE_FAILED'
  | 'ROLLBACK_FAILED'
  | 'ROLLBACK_CLEANUP_FAILED';

export class RestoreManagerError extends Error {
  public readonly code: RestoreManagerErrorCode;

  public constructor(
    code: RestoreManagerErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RestoreManagerError';
    this.code = code;
  }
}

/**
 * Narrow backup-verification boundary. The production wiring supplies a BackupManager instance
 * (or an adapter bound to the same backup root); the RestoreManager never trusts an old
 * verification result and always invokes this port immediately before mutation.
 */
export interface BackupVerificationPort {
  verifyBackup(backupId: string): Promise<BackupVerification>;
}

/** Test-only instrumentation hooks. Never called in production wiring. */
export interface RestoreManagerHooks {
  beforeStagingCopy?: (stagingPath: string) => void;
  beforeStagingFsync?: (stagingPath: string) => void;
  beforeStagingVerification?: (stagingPath: string) => void;
  beforeRenameOriginal?: (rollbackPath: string) => void;
  beforeRenameStaging?: (stagingPath: string, targetPath: string) => void;
  beforeReplacementVerification?: (targetPath: string) => void;
  beforeRollback?: (rollbackPath: string, targetPath: string) => void;
}

export interface RestoreManagerDeps {
  readonly backupRoot: string;
  readonly pathResolver: PathResolverService;
  readonly verifier: BackupVerificationPort;
  readonly stagingNameGenerator?: { generate(): string };
  readonly hooks?: RestoreManagerHooks;
  readonly managedAssetRoots?: readonly ManagedAssetRoot[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface PathInfo {
  exists: boolean;
  symlink: boolean;
  directory: boolean;
  file: boolean;
  size: number;
}

function inspectPath(target: string): PathInfo {
  try {
    const stats = lstatSync(target);
    return {
      exists: true,
      symlink: stats.isSymbolicLink(),
      directory: stats.isDirectory(),
      file: stats.isFile(),
      size: stats.size,
    };
  } catch {
    return { exists: false, symlink: false, directory: false, file: false, size: 0 };
  }
}

function isEexist(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'
  );
}

function isEbusy(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EBUSY'
  );
}

function isPathInside(candidate: string, directory: string): boolean {
  const rel = winPath.relative(directory, candidate);
  if (rel === '') return true;
  if (rel === '..') return false;
  if (rel.startsWith('..' + winPath.sep)) return false;
  if (winPath.isAbsolute(rel)) return false;
  return true;
}

function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// RestoreManager
// ---------------------------------------------------------------------------

export class RestoreManager {
  private readonly backupRoot: string;
  private readonly pathResolver: PathResolverService;
  private readonly verifier: BackupVerificationPort;
  private readonly stagingNameGenerator: { generate(): string };
  private readonly hooks: RestoreManagerHooks;
  private readonly managedAssetRoots: readonly ManagedAssetRoot[];
  private readonly queues = new Map<string, Promise<unknown>>();

  public constructor(deps: RestoreManagerDeps) {
    if (typeof deps.backupRoot !== 'string' || deps.backupRoot.length === 0) {
      throw new RestoreManagerError('INVALID_BACKUP_ID', 'backupRoot must be a non-empty string.');
    }
    if (deps.backupRoot.includes('\0')) {
      throw new RestoreManagerError(
        'INVALID_BACKUP_ID',
        'backupRoot must not contain NUL characters.',
      );
    }
    if (!winPath.isAbsolute(deps.backupRoot)) {
      throw new RestoreManagerError('INVALID_BACKUP_ID', 'backupRoot must be an absolute path.');
    }
    if (!deps.pathResolver) {
      throw new RestoreManagerError('INVALID_TARGET_PATH', 'A path resolver is required.');
    }
    if (!deps.verifier || typeof deps.verifier.verifyBackup !== 'function') {
      throw new RestoreManagerError('BACKUP_VERIFICATION_FAILED', 'A backup verifier is required.');
    }
    this.backupRoot = deps.backupRoot;
    this.pathResolver = deps.pathResolver;
    this.verifier = deps.verifier;
    this.stagingNameGenerator = deps.stagingNameGenerator ?? { generate: () => randomUUID() };
    this.hooks = deps.hooks ?? {};
    this.managedAssetRoots = deps.managedAssetRoots ?? [];
  }

  public restore(request: VerifiedRestoreRequest): Promise<VerifiedRestoreResult> {
    const targetKey = this.validateRequest(request);
    return this.enqueue(targetKey, () => this.restoreImpl(request));
  }

  // -----------------------------------------------------------------------
  // Same-instance serialization by resolved target identity
  // -----------------------------------------------------------------------

  private enqueue(
    targetKey: string,
    fn: () => Promise<VerifiedRestoreResult>,
  ): Promise<VerifiedRestoreResult> {
    const prev = this.queues.get(targetKey) ?? Promise.resolve();
    const next = prev.then(
      () => fn(),
      () => fn(), // A previous rejection does not poison the queue.
    );
    this.queues.set(targetKey, next);
    const release = (): void => {
      if (this.queues.get(targetKey) === next) {
        this.queues.delete(targetKey);
      }
    };
    // Remove the queue entry only when this invocation settles so later same-target
    // calls chain onto it. Both handlers return undefined, so the derived promise
    // resolves and a rejected restore never becomes an unhandled rejection here.
    next.then(release, release);
    return next;
  }

  // -----------------------------------------------------------------------
  // Request validation
  // -----------------------------------------------------------------------

  private validateRequest(request: VerifiedRestoreRequest): string {
    if (typeof request !== 'object' || request === null) {
      throw new RestoreManagerError('INVALID_TARGET_PATH', 'A restore request is required.');
    }
    const targetPath = request.targetDatabasePath;
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
      throw new RestoreManagerError(
        'INVALID_TARGET_PATH',
        'targetDatabasePath must be a non-empty string.',
      );
    }
    if (targetPath.includes('\0')) {
      throw new RestoreManagerError(
        'INVALID_TARGET_PATH',
        'targetDatabasePath must not contain NUL characters.',
      );
    }
    if (!winPath.isAbsolute(targetPath)) {
      throw new RestoreManagerError(
        'INVALID_TARGET_PATH',
        'targetDatabasePath must be an absolute path.',
      );
    }
    const backupId = request.backupId;
    if (typeof backupId !== 'string' || backupId.length === 0) {
      throw new RestoreManagerError('INVALID_BACKUP_ID', 'backupId must be a non-empty string.');
    }
    if (backupId.includes('\0')) {
      throw new RestoreManagerError(
        'INVALID_BACKUP_ID',
        'backupId must not contain NUL characters.',
      );
    }
    if (
      backupId === '.' ||
      backupId === '..' ||
      backupId.includes('/') ||
      backupId.includes('\\')
    ) {
      throw new RestoreManagerError('INVALID_BACKUP_ID', 'backupId must be a single path segment.');
    }
    return this.targetQueueKey(targetPath);
  }

  /**
   * Queue key based on the physical target identity. realpathSync resolves junction and
   * 8.3-name aliases so different spellings of the same file share one queue slot. When
   * the target cannot be resolved (for example it does not exist yet), the restore fails
   * closed before any mutation, so the lexical canonical form is a safe fallback.
   */
  private targetQueueKey(targetPath: string): string {
    try {
      return realpathSync(targetPath).toLowerCase();
    } catch {
      return this.pathResolver.canonicalizeForComparison(targetPath);
    }
  }

  // -----------------------------------------------------------------------
  // Backup verification and path resolution
  // -----------------------------------------------------------------------

  private async verifyBackup(backupId: string): Promise<BackupVerification> {
    let verification: BackupVerification;
    try {
      verification = await this.verifier.verifyBackup(backupId);
    } catch (error) {
      if (error instanceof BackupManagerError) {
        throw new RestoreManagerError(
          'BACKUP_VERIFICATION_FAILED',
          'The backup could not be verified.',
          {
            cause: error,
          },
        );
      }
      throw error;
    }
    if (verification.backupId !== backupId || verification.verified !== true) {
      throw new RestoreManagerError(
        'BACKUP_VERIFICATION_FAILED',
        'The backup verification did not confirm the requested artifact.',
      );
    }
    return verification;
  }

  private resolveBackupDatabasePath(backupId: string): string {
    const backupDir = winPath.join(this.backupRoot, backupId);
    if (!isPathInside(backupDir, this.backupRoot)) {
      throw new RestoreManagerError(
        'BACKUP_OUTSIDE_ROOT',
        'The backup path escapes the backup root.',
      );
    }
    return winPath.join(backupDir, 'database.sqlite');
  }

  private validateBackupPath(backupPath: string): void {
    if (!this.pathResolver.isWithinDataRoot(backupPath)) {
      throw new RestoreManagerError(
        'BACKUP_OUTSIDE_ROOT',
        'The backup path is outside the data root.',
      );
    }
    const info = inspectPath(backupPath);
    if (!info.exists) {
      throw new RestoreManagerError('BACKUP_NOT_FOUND', 'The backup database file does not exist.');
    }
    if (info.symlink) {
      throw new RestoreManagerError(
        'BACKUP_IS_SYMLINK',
        'The backup database file must not be a symlink or junction.',
      );
    }
    if (info.directory) {
      throw new RestoreManagerError(
        'BACKUP_IS_DIRECTORY',
        'The backup database file must not be a directory.',
      );
    }
    if (!info.file) {
      throw new RestoreManagerError(
        'BACKUP_IS_SPECIAL',
        'The backup database file must be a regular file.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Target and sidecar safety
  // -----------------------------------------------------------------------

  private validateTargetPath(targetPath: string, backupPath: string): void {
    const parentDir = winPath.dirname(targetPath);
    const parentInfo = inspectPath(parentDir);
    if (!parentInfo.exists) {
      throw new RestoreManagerError(
        'TARGET_PARENT_MISSING',
        'The target parent directory does not exist.',
      );
    }
    if (parentInfo.symlink) {
      throw new RestoreManagerError(
        'UNSAFE_TARGET_PATH',
        'The target parent directory must not be a symlink or junction.',
      );
    }
    if (!parentInfo.directory) {
      throw new RestoreManagerError(
        'TARGET_PARENT_NOT_DIRECTORY',
        'The target parent must be a directory.',
      );
    }

    const info = inspectPath(targetPath);
    if (!info.exists) {
      throw new RestoreManagerError('TARGET_NOT_FOUND', 'The target database does not exist.');
    }
    if (info.symlink) {
      throw new RestoreManagerError(
        'TARGET_IS_SYMLINK',
        'The target database must not be a symlink or junction.',
      );
    }
    if (info.directory) {
      throw new RestoreManagerError(
        'TARGET_IS_DIRECTORY',
        'The target database must not be a directory.',
      );
    }
    if (!info.file) {
      throw new RestoreManagerError(
        'TARGET_IS_SPECIAL',
        'The target database must be a regular file.',
      );
    }

    if (
      this.pathResolver.canonicalizeForComparison(targetPath) ===
        this.pathResolver.canonicalizeForComparison(backupPath) ||
      this.samePhysicalFile(targetPath, backupPath)
    ) {
      throw new RestoreManagerError(
        'TARGET_EQUALS_BACKUP',
        'The target must not be the backup file.',
      );
    }

    const backupStagingDir = winPath.join(
      this.backupRoot,
      '.partial-' + winPath.basename(winPath.dirname(backupPath)),
    );
    if (isPathInside(targetPath, backupStagingDir)) {
      throw new RestoreManagerError(
        'TARGET_INSIDE_BACKUP_STAGING',
        'The target must not be inside the backup staging path.',
      );
    }
  }

  private assertSafeSidecarState(targetPath: string): void {
    const walPath = targetPath + '-wal';
    const shmPath = targetPath + '-shm';

    const walInfo = inspectPath(walPath);
    if (walInfo.exists) {
      if (walInfo.symlink || !walInfo.file) {
        throw new RestoreManagerError('TARGET_WAL_UNSAFE', 'The target WAL file is unsafe.');
      }
      if (walInfo.size > 0) {
        throw new RestoreManagerError('TARGET_WAL_UNSAFE', 'The target has an uncheckpointed WAL.');
      }
    }

    const shmInfo = inspectPath(shmPath);
    if (shmInfo.exists && (shmInfo.symlink || !shmInfo.file || shmInfo.size > 0)) {
      throw new RestoreManagerError('TARGET_SHM_UNSAFE', 'The target SHM file is unsafe.');
    }
  }

  /**
   * Physical identity check: realpathSync resolves junction and 8.3-name aliases so a
   * target that is the backup file under a different spelling is still rejected. Both
   * paths were already validated as non-symlink regular files, so following them is
   * safe; a resolution failure falls through to the later fail-closed filesystem step.
   */
  private samePhysicalFile(a: string, b: string): boolean {
    try {
      return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Staging, replacement, verification and rollback
  // -----------------------------------------------------------------------

  private fsyncFile(filePath: string): void {
    let fd: number | undefined;
    try {
      fd = openSync(filePath, 'r+');
      fsyncSync(fd);
    } catch (error) {
      throw new RestoreManagerError(
        'STAGING_FSYNC_FAILED',
        'The staging file could not be synced.',
        {
          cause: error,
        },
      );
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // Best-effort close.
        }
      }
    }
  }

  private async verifyDatabaseFile(
    filePath: string,
    verification: BackupVerification,
    code: RestoreManagerErrorCode,
  ): Promise<string> {
    let db: DatabaseSyncInstance | undefined;
    try {
      try {
        // immutable read-only open: the verified main file is a complete snapshot, and no
        // -wal/-shm sidecar is created or modified next to the staging or target file.
        const uri = pathToFileURL(filePath).href + '?immutable=1';
        db = new DatabaseSync(uri, { readOnly: true });
        db.exec('PRAGMA query_only = ON');
        const integrity = db.prepare('PRAGMA integrity_check').all() as {
          integrity_check: string;
        }[];
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
          throw new RestoreManagerError(code, 'SQLite integrity verification failed.');
        }
        for (const table of verification.requiredTablesChecked) {
          const row = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(table) as { name: string } | undefined;
          if (!row) {
            throw new RestoreManagerError(code, 'A required table is missing from the database.');
          }
        }
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            // Best-effort close.
          }
        }
      }

      const sha256 = await sha256File(filePath);
      if (sha256 !== verification.sha256) {
        throw new RestoreManagerError(
          code,
          'The database hash does not match the verified backup.',
        );
      }
      return sha256;
    } catch (error) {
      if (error instanceof RestoreManagerError) throw error;
      throw new RestoreManagerError(code, 'The database could not be verified.', { cause: error });
    }
  }

  private performRollback(
    targetPath: string,
    rollbackPath: string,
    stagingPath: string,
    replacementMoved: boolean,
  ): void {
    this.hooks.beforeRollback?.(rollbackPath, targetPath);

    // Remove only files created by this invocation: the failed replacement target and any
    // remaining staging file. The preserved rollback copy is never deleted here.
    if (replacementMoved && inspectPath(targetPath).exists) {
      try {
        unlinkSync(targetPath);
      } catch {
        // Best-effort; the rollback rename below will fail closed if the file remains.
      }
    }
    if (inspectPath(stagingPath).exists) {
      try {
        unlinkSync(stagingPath);
      } catch {
        // Best-effort; the rollback rename below will fail closed if the file remains.
      }
    }

    try {
      renameSync(rollbackPath, targetPath);
    } catch (error) {
      throw new RestoreManagerError(
        'ROLLBACK_FAILED',
        'The original target could not be restored.',
        {
          cause: error,
        },
      );
    }
    if (!inspectPath(targetPath).exists) {
      throw new RestoreManagerError(
        'ROLLBACK_FAILED',
        'The original target is missing after rollback.',
      );
    }
  }

  private async restoreImpl(request: VerifiedRestoreRequest): Promise<VerifiedRestoreResult> {
    const targetPath = request.targetDatabasePath;
    const backupId = request.backupId;

    // 1. Resolve and validate the exact backup artifact.
    const backupPath = this.resolveBackupDatabasePath(backupId);
    this.validateBackupPath(backupPath);

    // 2. Reverify the backup immediately before any mutation.
    const verification = await this.verifyBackup(backupId);

    // 3. Validate the target and its WAL/SHM sidecars.
    this.validateTargetPath(targetPath, backupPath);
    this.assertSafeSidecarState(targetPath);

    // 4. Same-directory staging and rollback paths owned by this invocation.
    const parentDir = winPath.dirname(targetPath);
    const stagingPath = winPath.join(
      parentDir,
      '.restore-' + this.stagingNameGenerator.generate() + '.sqlite',
    );
    const rollbackPath = winPath.join(
      parentDir,
      '.restore-' + this.stagingNameGenerator.generate() + '.rollback.sqlite',
    );

    let stagingCreated = false;
    let originalMoved = false;
    let replacementMoved = false;
    let managedAssetRestore: PreparedManagedAssetRestore | undefined;

    if (verification.managedAssets) {
      if (this.managedAssetRoots.length === 0) {
        throw new RestoreManagerError(
          'MANAGED_ASSET_RESTORE_FAILED',
          'The backup contains managed Library assets but no restore roots are configured.',
        );
      }
      try {
        managedAssetRestore = prepareManagedAssetRestore({
          backupDirectory: winPath.dirname(backupPath),
          metadata: verification.managedAssets.metadata,
          roots: this.managedAssetRoots,
          restoreId: this.stagingNameGenerator.generate(),
        });
      } catch (error) {
        throw new RestoreManagerError(
          'MANAGED_ASSET_RESTORE_FAILED',
          'Managed Library assets could not be staged and verified for restore.',
          { cause: error },
        );
      }
    }

    try {
      // 5. Exclusive staging copy from the verified backup.
      this.hooks.beforeStagingCopy?.(stagingPath);
      try {
        copyFileSync(backupPath, stagingPath, fsConstants.COPYFILE_EXCL);
        stagingCreated = true;
      } catch (error) {
        if (isEexist(error)) {
          throw new RestoreManagerError('STAGING_COLLISION', 'A staging file already exists.', {
            cause: error,
          });
        }
        throw new RestoreManagerError(
          'STAGING_COPY_FAILED',
          'The staging copy could not be created.',
          {
            cause: error,
          },
        );
      }

      // 6. Fsync the staging file.
      this.hooks.beforeStagingFsync?.(stagingPath);
      this.fsyncFile(stagingPath);

      // 7. Verify the staging file before touching the target.
      this.hooks.beforeStagingVerification?.(stagingPath);
      await this.verifyDatabaseFile(stagingPath, verification, 'STAGING_VERIFICATION_FAILED');

      // 8. Reconfirm target and sidecar safety immediately before replacement.
      this.validateTargetPath(targetPath, backupPath);
      this.assertSafeSidecarState(targetPath);

      // 9. Preserve the original target at the rollback path (no overwrite).
      if (inspectPath(rollbackPath).exists) {
        throw new RestoreManagerError('ROLLBACK_PATH_EXISTS', 'The rollback path already exists.');
      }
      this.hooks.beforeRenameOriginal?.(rollbackPath);
      try {
        renameSync(targetPath, rollbackPath);
        originalMoved = true;
      } catch (error) {
        if (isEbusy(error)) {
          throw new RestoreManagerError(
            'RENAME_ORIGINAL_FAILED',
            'The target database is in use.',
            {
              cause: error,
            },
          );
        }
        throw new RestoreManagerError(
          'RENAME_ORIGINAL_FAILED',
          'The original target could not be preserved.',
          {
            cause: error,
          },
        );
      }

      // 10. Place the verified staging file at the target path (no overwrite).
      if (inspectPath(targetPath).exists) {
        throw new RestoreManagerError(
          'RENAME_STAGING_FAILED',
          'The target path unexpectedly exists.',
        );
      }
      this.hooks.beforeRenameStaging?.(stagingPath, targetPath);
      try {
        renameSync(stagingPath, targetPath);
        replacementMoved = true;
      } catch (error) {
        throw new RestoreManagerError(
          'RENAME_STAGING_FAILED',
          'The restored database could not be placed.',
          {
            cause: error,
          },
        );
      }

      // 11. Verify the new target read-only before claiming success.
      this.hooks.beforeReplacementVerification?.(targetPath);
      const targetSha256 = await this.verifyDatabaseFile(
        targetPath,
        verification,
        'REPLACEMENT_VERIFICATION_FAILED',
      );

      // 12. Confirm the source backup remains byte-identical.
      const backupSha256 = await sha256File(backupPath);
      if (backupSha256 !== verification.sha256) {
        throw new RestoreManagerError(
          'REPLACEMENT_VERIFICATION_FAILED',
          'The source backup changed during restore.',
        );
      }

      // 13. Confirm no staging file remains.
      if (inspectPath(stagingPath).exists) {
        throw new RestoreManagerError(
          'REPLACEMENT_VERIFICATION_FAILED',
          'The staging file was not removed.',
        );
      }

      // 14. Promote all verified managed roots while the original database is still preserved.
      try {
        managedAssetRestore?.commit();
      } catch (error) {
        throw new RestoreManagerError(
          'MANAGED_ASSET_RESTORE_FAILED',
          'Managed Library assets could not be promoted during restore.',
          { cause: error },
        );
      }

      // 15. Remove the preserved database rollback only after DB and managed roots succeeded.
      try {
        unlinkSync(rollbackPath);
      } catch (error) {
        throw new RestoreManagerError(
          'ROLLBACK_CLEANUP_FAILED',
          'The preserved original could not be removed after verification.',
          { cause: error },
        );
      }

      try {
        managedAssetRestore?.cleanup();
      } catch {
        // The restored DB and managed roots are already verified and authoritative.
        // A retained rollback directory is reconciliation debt, not partial restore success.
      }

      return Object.freeze<VerifiedRestoreResult>({
        status: 'RESTORED',
        backupId,
        restoredDatabaseSha256: targetSha256,
        rollbackPerformed: false,
        verificationPassed: true,
      });
    } catch (error) {
      let managedRollbackError: unknown;
      try {
        managedAssetRestore?.rollback();
      } catch (rollbackError) {
        managedRollbackError = rollbackError;
      }
      if (originalMoved) {
        this.performRollback(targetPath, rollbackPath, stagingPath, replacementMoved);
      } else if (stagingCreated) {
        try {
          unlinkSync(stagingPath);
        } catch {
          // Best-effort cleanup of the exact staging file created by this invocation.
        }
      }
      if (managedRollbackError) {
        throw new RestoreManagerError(
          'MANAGED_ASSET_RESTORE_FAILED',
          'Restore failed and the managed Library asset rollback also failed.',
          { cause: managedRollbackError },
        );
      }
      throw error;
    }
  }
}
