/**
 * BackupManager: verified SQLite backups for the SCLI workspace.
 *
 * Uses Node's built-in `node:sqlite` online backup API (`backup()`), which safely copies an open
 * WAL database to a new file without raw filesystem copying, VACUUM INTO, or copying -wal/-shm
 * companions. Backups are staged in an exclusive `.partial-<backupId>` directory and promoted by
 * a same-volume directory rename only after mandatory SQLite integrity verification passes.
 *
 * Containment and link safety: backupRoot must be inside the configured data root; staging/final
 * paths must stay inside backupRoot. Existing destination paths are checked with `lstatSync`
 * (never followed) and symlinks are rejected. Residual limitation: `lstatSync` reliably detects
 * symbolic links and Windows junctions (Node reports junctions as symlinks) but cannot detect
 * every reparse-point variant or eliminate TOCTOU races between the check and a later operation;
 * callers must not place backupRoot under untrusted writable directories.
 *
 * The service is infrastructure-only: it depends on `node:sqlite`, `node:crypto`, `node:fs`,
 * `node:path`, `zod`, and the workspace PathResolverService. It has no dependency on UI, Teams,
 * domain entities, Electron, the API, or any existing data provider.
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { win32 as winPath } from 'node:path';
import { z } from 'zod';
import { PathResolverService } from '../path/PathResolverService';
import {
  createManagedAssetSnapshot,
  verifyManagedAssetSnapshot,
  type ManagedAssetManifest,
  type ManagedAssetRoot,
} from './ManagedAssetSnapshot';

// Keep the specifier dynamic so the bundler does not rewrite `node:sqlite` to `sqlite`
// (matches the pattern used by standalone-data-provider.ts).
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { backup, DatabaseSync } = (await import(
  nodeSqliteSpecifier
)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

/** Progress reported during a backup. Values are monotonic from the caller's perspective. */
export interface BackupProgress {
  totalPages: number;
  remainingPages: number;
  completedPages: number;
  percentage: number;
}

/** Request to create a verified backup. */
export interface BackupRequest {
  reason: string;
  migrationId?: string | undefined;
  onProgress?: ((progress: BackupProgress) => void) | undefined;
}

/** A function compatible with `node:sqlite`'s module-level `backup()`. */
export type BackupFunction = (
  sourceDb: DatabaseSyncInstance,
  destinationPath: string,
  options?: {
    source?: string | undefined;
    target?: string | undefined;
    rate?: number | undefined;
    progress?: ((info: { totalPages: number; remainingPages: number }) => void) | undefined;
  },
) => Promise<number>;

/** Clock port for deterministic timestamps. */
export interface Clock {
  now(): Date;
}

/** Identifier generator port for deterministic backup IDs. */
export interface IdGenerator {
  generate(): string;
}

/** Verification policy describing what a valid backup must contain. */
export interface VerificationPolicy {
  readonly requiredTables: readonly string[];
  validateDatabase?: ((database: DatabaseSyncInstance) => void) | undefined;
}

/** Dependencies required to construct a BackupManager. */
export interface BackupManagerDeps {
  sourceDb: DatabaseSyncInstance;
  sourceDatabasePath: string;
  backupRoot: string;
  pathResolver: PathResolverService;
  clock: Clock;
  idGenerator: IdGenerator;
  appVersion: string;
  verificationPolicy: VerificationPolicy;
  backupFunction?: BackupFunction | undefined;
  /** Managed file roots copied and verified in the same promoted backup artifact. */
  managedAssetRoots?: readonly ManagedAssetRoot[] | undefined;
}

/** Stable machine-readable error codes used by BackupManagerError. */
export type BackupManagerErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_BACKUP_REQUEST'
  | 'INVALID_BACKUP_ID'
  | 'BACKUP_ROOT_OUTSIDE_DATA_ROOT'
  | 'SOURCE_DATABASE_UNAVAILABLE'
  | 'BACKUP_COLLISION'
  | 'BACKUP_EXECUTION_FAILED'
  | 'BACKUP_NOT_FOUND'
  | 'METADATA_NOT_FOUND'
  | 'METADATA_INVALID'
  | 'BACKUP_FILE_MISSING'
  | 'BACKUP_FILE_EMPTY'
  | 'INTEGRITY_CHECK_FAILED'
  | 'REQUIRED_TABLE_MISSING'
  | 'CUSTOM_VERIFICATION_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'MANAGED_ASSET_SNAPSHOT_FAILED'
  | 'MANAGED_ASSET_VERIFICATION_FAILED'
  | 'PROMOTION_FAILED'
  | 'CLEANUP_FAILED';

/**
 * Typed error thrown by BackupManager. Carries a stable machine-readable `code` and preserves the
 * original cause via `Error.cause` where applicable.
 */
export class BackupManagerError extends Error {
  public readonly code: BackupManagerErrorCode;

  public constructor(code: BackupManagerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackupManagerError';
    this.code = code;
  }
}

function fail(code: BackupManagerErrorCode, message: string, cause?: unknown): BackupManagerError {
  return new BackupManagerError(code, message, cause !== undefined ? { cause } : undefined);
}

/** Versioned, portable backup metadata. Never stores an absolute source path. */
export type BackupMetadata = z.infer<typeof metadataSchema>;

const sourceDatabaseSchema = z
  .strictObject({
    filename: z.string().min(1),
    location: z.enum(['managed', 'external']),
    relativePath: z.string().optional(),
    mainFileSizeBytes: z.number().int().nonnegative().finite(),
  })
  .refine(
    (s) => {
      if (s.location === 'external') return s.relativePath === undefined;
      return (
        typeof s.relativePath === 'string' &&
        !s.relativePath.includes('\\') &&
        !s.relativePath.startsWith('/') &&
        !s.relativePath.includes(':')
      );
    },
    {
      message:
        'relativePath is only allowed for managed sources and must be a relative forward-slash path',
    },
  )
  .refine(
    (s) => !s.filename.includes('/') && !s.filename.includes('\\') && !s.filename.includes(':'),
    { message: 'filename must be a single path segment' },
  );

const metadataSchema = z.strictObject({
  backupFormatVersion: z.literal(1),
  backupId: z.string().min(1),
  status: z.literal('verified'),
  createdAt: z.string().datetime(),
  appVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  schemaVersion: z.number().int().nonnegative().finite(),
  reason: z.string().min(1).max(500),
  migrationId: z.string().min(1).max(200).optional(),
  mechanism: z.literal('node:sqlite-backup'),
  pagesBackedUp: z.number().int().nonnegative().finite(),
  durationMs: z.number().int().nonnegative().finite(),
  sourceDatabase: sourceDatabaseSchema,
  backupDatabase: z.strictObject({
    filename: z.literal('database.sqlite'),
    sizeBytes: z.number().int().nonnegative().finite(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  verification: z.strictObject({
    integrityCheck: z.literal('ok'),
    requiredTablesChecked: z
      .array(z.string().min(1))
      .refine((arr) => new Set(arr).size === arr.length, {
        message: 'requiredTablesChecked must be unique',
      }),
    customPolicyChecked: z.boolean(),
  }),
  managedAssets: z
    .strictObject({
      directory: z.literal('managed-assets'),
      manifestFilename: z.literal('managed-assets-manifest.json'),
      manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
      fileCount: z.number().int().nonnegative(),
      totalSizeBytes: z.number().int().nonnegative(),
    })
    .optional(),
});

/** Result of a successful verified backup. */
export interface BackupResult {
  backupId: string;
  backupDirectory: string;
  metadata: BackupMetadata;
}

/** Result of verifying an existing backup. */
export interface BackupVerification {
  backupId: string;
  verified: true;
  integrityCheck: 'ok';
  schemaVersion: number;
  sizeBytes: number;
  sha256: string;
  requiredTablesChecked: readonly string[];
  customPolicyChecked: boolean;
  managedAssets?: {
    metadata: NonNullable<BackupMetadata['managedAssets']>;
    manifest: ManagedAssetManifest;
  };
}

const BACKUP_DB_FILENAME = 'database.sqlite';
const META_FILENAME = 'metadata.json';
const PARTIAL_PREFIX = '.partial-';
const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])(\.|$)/i;
const REASON_MAX_LENGTH = 500;
const MIGRATION_ID_MAX_LENGTH = 200;
const MAX_BACKUP_ID_LENGTH = 255;

function containsUnsafeBackupIdChar(id: string): boolean {
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code < 0x20) return true;
    if (
      code === 0x22 ||
      code === 0x2a ||
      code === 0x2f ||
      code === 0x3a ||
      code === 0x3c ||
      code === 0x3e ||
      code === 0x5c ||
      code === 0x7c ||
      code === 0x3f
    )
      return true;
  }
  return false;
}

/** Validate that a backup ID is a single Windows-safe path segment. */
function validateBackupId(id: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID must be a non-empty string.');
  }
  if (id.includes('\0')) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID must not contain NUL characters.');
  }
  if (id.startsWith(PARTIAL_PREFIX)) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID must not reference a partial staging directory.');
  }
  if (containsUnsafeBackupIdChar(id) || id === '.' || id === '..') {
    throw fail('INVALID_BACKUP_ID', 'Backup ID contains unsafe path characters.');
  }
  if (RESERVED_WINDOWS_NAMES.test(id)) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID uses a reserved Windows filename.');
  }
  if (/(^[ .]|[ .]$)/.test(id)) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID must not begin or end with a space or dot.');
  }
  if (id.length > MAX_BACKUP_ID_LENGTH) {
    throw fail('INVALID_BACKUP_ID', 'Backup ID is too long for a Windows path segment.');
  }
}

function validateRequest(request: BackupRequest): void {
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0) {
    throw fail('INVALID_BACKUP_REQUEST', 'Reason must be a non-empty string after trimming.');
  }
  if (request.reason.includes('\0')) {
    throw fail('INVALID_BACKUP_REQUEST', 'Reason must not contain NUL characters.');
  }
  if (request.reason.length > REASON_MAX_LENGTH) {
    throw fail('INVALID_BACKUP_REQUEST', `Reason must not exceed ${REASON_MAX_LENGTH} characters.`);
  }
  if (request.migrationId !== undefined) {
    if (request.migrationId.trim().length === 0) {
      throw fail('INVALID_BACKUP_REQUEST', 'Migration ID must be non-empty when provided.');
    }
    if (request.migrationId.includes('\0')) {
      throw fail('INVALID_BACKUP_REQUEST', 'Migration ID must not contain NUL characters.');
    }
    if (request.migrationId.length > MIGRATION_ID_MAX_LENGTH) {
      throw fail(
        'INVALID_BACKUP_REQUEST',
        `Migration ID must not exceed ${MIGRATION_ID_MAX_LENGTH} characters.`,
      );
    }
  }
}

/** Compute the SHA-256 of a file using a streaming read so large databases do not load fully. */
async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

interface PathInfo {
  exists: boolean;
  symlink: boolean;
  directory: boolean;
  file: boolean;
}

/** Inspect a path without following symlinks. */
function inspectPath(target: string): PathInfo {
  try {
    const stats = lstatSync(target);
    return {
      exists: true,
      symlink: stats.isSymbolicLink(),
      directory: stats.isDirectory(),
      file: stats.isFile(),
    };
  } catch {
    return { exists: false, symlink: false, directory: false, file: false };
  }
}

/** Remove a staging directory's known contents, then the directory itself. */
function removeStagingDirectory(stagingDir: string): void {
  rmSync(winPath.join(stagingDir, 'managed-assets'), { recursive: true, force: true });
  for (const name of [
    BACKUP_DB_FILENAME,
    `${BACKUP_DB_FILENAME}-wal`,
    `${BACKUP_DB_FILENAME}-shm`,
    META_FILENAME,
    'managed-assets-manifest.json',
  ]) {
    try {
      unlinkSync(winPath.join(stagingDir, name));
    } catch {
      // Ignore missing known files; unexpected entries intentionally make rmdir fail closed.
    }
  }
  rmdirSync(stagingDir);
}

export class BackupManager {
  private readonly sourceDb: DatabaseSyncInstance;
  private readonly sourceDatabasePath: string;
  private readonly backupRoot: string;
  private readonly pathResolver: PathResolverService;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly appVersion: string;
  private readonly validateDatabase: ((database: DatabaseSyncInstance) => void) | undefined;
  private readonly requiredTables: readonly string[];
  private readonly backupFunction: BackupFunction;
  private readonly backupRootResolver: PathResolverService;
  private readonly managedAssetRoots: readonly ManagedAssetRoot[];

  public constructor(deps: BackupManagerDeps) {
    this.sourceDb = deps.sourceDb;
    this.sourceDatabasePath = deps.sourceDatabasePath;
    this.backupRoot = deps.backupRoot;
    this.pathResolver = deps.pathResolver;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.appVersion = deps.appVersion;
    this.validateDatabase = deps.verificationPolicy.validateDatabase;
    this.backupFunction = deps.backupFunction ?? backup;
    this.managedAssetRoots = deps.managedAssetRoots ?? [];

    if (typeof this.appVersion !== 'string' || this.appVersion.length === 0) {
      throw fail('INVALID_CONFIGURATION', 'appVersion must be a non-empty string.');
    }
    if (this.sourceDatabasePath === ':memory:') {
      throw fail('INVALID_CONFIGURATION', 'sourceDatabasePath must not be :memory:.');
    }
    if (this.sourceDatabasePath.includes('\0')) {
      throw fail('INVALID_CONFIGURATION', 'sourceDatabasePath must not contain NUL characters.');
    }
    if (!winPath.isAbsolute(this.sourceDatabasePath)) {
      throw fail('INVALID_CONFIGURATION', 'sourceDatabasePath must be an absolute path.');
    }
    if (this.backupRoot.includes('\0')) {
      throw fail('INVALID_CONFIGURATION', 'backupRoot must not contain NUL characters.');
    }
    if (!winPath.isAbsolute(this.backupRoot)) {
      throw fail('INVALID_CONFIGURATION', 'backupRoot must be an absolute path.');
    }

    const dedupedTables: string[] = [];
    for (const table of deps.verificationPolicy.requiredTables) {
      if (typeof table !== 'string' || table.length === 0) {
        throw fail(
          'INVALID_CONFIGURATION',
          'verificationPolicy.requiredTables must be non-empty strings.',
        );
      }
      if (!dedupedTables.includes(table)) dedupedTables.push(table);
    }
    this.requiredTables = dedupedTables;

    if (!this.pathResolver.isWithinDataRoot(this.backupRoot)) {
      throw fail(
        'BACKUP_ROOT_OUTSIDE_DATA_ROOT',
        'backupRoot must be inside the configured data root.',
      );
    }
    this.backupRootResolver = new PathResolverService(this.backupRoot);

    const rootInfo = inspectPath(this.backupRoot);
    if (rootInfo.exists) {
      if (rootInfo.symlink) {
        throw fail('INVALID_CONFIGURATION', 'backupRoot must not be a symlink.');
      }
      if (rootInfo.file) {
        throw fail('INVALID_CONFIGURATION', 'backupRoot must be a directory, not a file.');
      }
    }
    if (
      this.pathResolver.canonicalizeForComparison(this.backupRoot) ===
      this.pathResolver.canonicalizeForComparison(this.sourceDatabasePath)
    ) {
      throw fail('INVALID_CONFIGURATION', 'backupRoot must not be the source database file.');
    }
    if (this.backupRootResolver.isWithinDataRoot(this.sourceDatabasePath)) {
      throw fail('INVALID_CONFIGURATION', 'sourceDatabasePath must not be inside backupRoot.');
    }
    const rootKeys = new Set<string>();
    for (const root of this.managedAssetRoots) {
      if (rootKeys.has(root.key)) {
        throw fail('INVALID_CONFIGURATION', 'Managed asset root keys must be unique.');
      }
      rootKeys.add(root.key);
      if (!this.pathResolver.isWithinDataRoot(root.absolutePath)) {
        throw fail('INVALID_CONFIGURATION', 'Managed asset roots must be inside the data root.');
      }
      if (this.backupRootResolver.isWithinDataRoot(root.absolutePath)) {
        throw fail('INVALID_CONFIGURATION', 'Managed asset roots must not be inside backupRoot.');
      }
    }
  }

  /** Verify the source handle's main database matches the configured sourceDatabasePath. */
  private verifySourceHandlePath(): void {
    let rows: { name: string; file: string }[];
    try {
      rows = this.sourceDb.prepare('PRAGMA database_list').all() as {
        name: string;
        file: string;
      }[];
    } catch (error) {
      throw fail(
        'SOURCE_DATABASE_UNAVAILABLE',
        'Could not read PRAGMA database_list from the source database.',
        error,
      );
    }
    let main: { name: string; file: string } | undefined;
    for (const row of rows) {
      if (row.name === 'main') {
        main = row;
        break;
      }
    }
    if (!main) {
      throw fail('SOURCE_DATABASE_UNAVAILABLE', 'The source database has no main database.');
    }
    if (!main.file || main.file === ':memory:') {
      throw fail('SOURCE_DATABASE_UNAVAILABLE', 'The source main database is not file-backed.');
    }
    const mainCanonical = this.pathResolver.canonicalizeForComparison(main.file);
    const configuredCanonical = this.pathResolver.canonicalizeForComparison(
      this.sourceDatabasePath,
    );
    if (mainCanonical !== configuredCanonical) {
      throw fail(
        'INVALID_CONFIGURATION',
        'sourceDatabasePath does not match the source database handle main path.',
      );
    }
  }

  /**
   * Create a verified backup. Stages in `.partial-<backupId>/`, runs the online backup, verifies
   * SQLite integrity, writes metadata, and promotes by same-volume rename. On failure the staging
   * directory is removed; if cleanup also fails a CLEANUP_FAILED error preserves the original cause.
   */
  public async createVerifiedBackup(request: BackupRequest): Promise<BackupResult> {
    validateRequest(request);
    this.verifySourceHandlePath();

    const backupId = this.idGenerator.generate();
    validateBackupId(backupId);

    const finalDir = winPath.join(this.backupRoot, backupId);
    const stagingDir = winPath.join(this.backupRoot, PARTIAL_PREFIX + backupId);
    if (!this.backupRootResolver.isWithinDataRoot(stagingDir)) {
      throw fail('INVALID_BACKUP_ID', 'Resolved staging path escapes backupRoot.');
    }
    if (!this.backupRootResolver.isWithinDataRoot(finalDir)) {
      throw fail('INVALID_BACKUP_ID', 'Resolved final path escapes backupRoot.');
    }
    if (inspectPath(finalDir).exists) {
      throw fail('BACKUP_COLLISION', 'A final backup directory with this ID already exists.');
    }

    mkdirSync(this.backupRoot, { recursive: true });
    if (inspectPath(stagingDir).exists) {
      throw fail('BACKUP_COLLISION', 'A staging directory with this ID already exists.');
    }
    try {
      mkdirSync(stagingDir);
    } catch (error) {
      const thrown = error as { code?: string };
      if (thrown.code === 'EEXIST') {
        throw fail('BACKUP_COLLISION', 'A staging directory with this ID already exists.', error);
      }
      throw fail('BACKUP_EXECUTION_FAILED', 'Could not create the staging directory.', error);
    }

    const stagingDb = winPath.join(stagingDir, BACKUP_DB_FILENAME);
    const stagingMeta = winPath.join(stagingDir, META_FILENAME);
    const startedAt = Date.now();

    try {
      let lastTotalPages = 0;
      let lastCompleted = 0;
      let lastPercentage = 0;
      const reportProgress = (info: { totalPages: number; remainingPages: number }): void => {
        const sanitize = (n: number, fallback: number): number =>
          Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
        const totalPages = Math.max(lastTotalPages, sanitize(info.totalPages, lastTotalPages));
        lastTotalPages = totalPages;
        const remaining = sanitize(info.remainingPages, 0);
        const completed = Math.max(lastCompleted, totalPages - remaining);
        lastCompleted = completed;
        let pct = totalPages > 0 ? Math.floor((completed / totalPages) * 100) : 0;
        if (pct > 99) pct = 99;
        if (pct < lastPercentage) pct = lastPercentage;
        lastPercentage = pct;
        try {
          request.onProgress?.({
            totalPages,
            remainingPages: remaining,
            completedPages: completed,
            percentage: pct,
          });
        } catch {
          // A caller progress callback must not abort the backup.
        }
      };

      let pagesBackedUp: number;
      try {
        pagesBackedUp = await this.backupFunction(this.sourceDb, stagingDb, {
          progress: reportProgress,
        });
      } catch (error) {
        throw fail('BACKUP_EXECUTION_FAILED', 'The node:sqlite backup() call failed.', error);
      }

      // Mandatory verification of the staged database.
      let schemaVersion = 0;
      let verificationDb: DatabaseSyncInstance | undefined;
      try {
        if (statSync(stagingDb).size === 0) {
          throw fail('BACKUP_FILE_EMPTY', 'The staged database file is empty.');
        }
        verificationDb = new DatabaseSync(stagingDb, { readOnly: true });
        this.runMandatoryDatabaseChecks(verificationDb, (version) => {
          schemaVersion = version;
        });
      } catch (error) {
        if (error instanceof BackupManagerError) throw error;
        throw fail('INTEGRITY_CHECK_FAILED', 'The staged database could not be verified.', error);
      } finally {
        if (verificationDb) {
          try {
            verificationDb.close();
          } catch {
            // Closing a read-only connection failure is non-fatal for verification.
          }
        }
      }

      let managedAssets: BackupMetadata['managedAssets'];
      if (this.managedAssetRoots.length > 0) {
        try {
          managedAssets = createManagedAssetSnapshot(stagingDir, this.managedAssetRoots);
        } catch (error) {
          throw fail(
            'MANAGED_ASSET_SNAPSHOT_FAILED',
            'Managed Library assets could not be included in the verified backup.',
            error,
          );
        }
      }

      const sha256 = await sha256OfFile(stagingDb);
      const sizeBytes = statSync(stagingDb).size;
      const durationMs = Date.now() - startedAt;
      const managed = this.pathResolver.isWithinDataRoot(this.sourceDatabasePath);
      const sourceStored = managed ? this.pathResolver.toStoredPath(this.sourceDatabasePath) : null;
      let sourceMainSize = 0;
      try {
        sourceMainSize = statSync(this.sourceDatabasePath).size;
      } catch (error) {
        throw fail(
          'SOURCE_DATABASE_UNAVAILABLE',
          'Could not stat the source database file.',
          error,
        );
      }
      const sourceDatabase: BackupMetadata['sourceDatabase'] = managed
        ? {
            filename: winPath.basename(this.sourceDatabasePath),
            location: 'managed',
            relativePath: sourceStored?.kind === 'relative' ? sourceStored.value : '',
            mainFileSizeBytes: sourceMainSize,
          }
        : {
            filename: winPath.basename(this.sourceDatabasePath),
            location: 'external',
            mainFileSizeBytes: sourceMainSize,
          };

      const metadata: BackupMetadata = {
        backupFormatVersion: 1,
        backupId,
        status: 'verified',
        createdAt: this.clock.now().toISOString(),
        appVersion: this.appVersion,
        nodeVersion: process.versions.node,
        schemaVersion,
        reason: request.reason,
        mechanism: 'node:sqlite-backup',
        pagesBackedUp,
        durationMs,
        sourceDatabase,
        backupDatabase: { filename: BACKUP_DB_FILENAME, sizeBytes, sha256 },
        verification: {
          integrityCheck: 'ok',
          requiredTablesChecked: [...this.requiredTables],
          customPolicyChecked: this.validateDatabase !== undefined,
        },
        ...(managedAssets ? { managedAssets } : {}),
      };
      if (request.migrationId !== undefined) {
        metadata.migrationId = request.migrationId;
      }

      try {
        writeFileSync(stagingMeta, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
      } catch (error) {
        throw fail('METADATA_INVALID', 'Could not write backup metadata exclusively.', error);
      }

      try {
        renameSync(stagingDir, finalDir);
      } catch (error) {
        throw fail(
          'PROMOTION_FAILED',
          'Could not promote the staging directory to a final backup.',
          error,
        );
      }

      try {
        request.onProgress?.({
          totalPages: lastTotalPages,
          remainingPages: 0,
          completedPages: lastTotalPages,
          percentage: 100,
        });
      } catch {
        // A caller progress callback must not affect the returned result.
      }

      return { backupId, backupDirectory: finalDir, metadata };
    } catch (originalError) {
      if (inspectPath(stagingDir).exists) {
        try {
          removeStagingDirectory(stagingDir);
        } catch (cleanupError) {
          throw fail(
            'CLEANUP_FAILED',
            `Backup failed and staging cleanup also failed: ${(cleanupError as Error).message}`,
            originalError,
          );
        }
      }
      throw originalError;
    }
  }

  /** Run integrity_check, user_version, required-table, and custom policy checks on a read-only DB. */
  private runMandatoryDatabaseChecks(
    db: DatabaseSyncInstance,
    recordVersion: (version: number) => void,
  ): void {
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as {
      integrity_check: string;
    }[];
    if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
      throw fail('INTEGRITY_CHECK_FAILED', 'PRAGMA integrity_check did not return exactly ok.');
    }
    const versionRow = db.prepare('PRAGMA user_version').get() as
      { user_version: number } | undefined;
    if (!versionRow) {
      throw fail('INTEGRITY_CHECK_FAILED', 'PRAGMA user_version could not be read.');
    }
    recordVersion(versionRow.user_version);
    for (const table of this.requiredTables) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name: string } | undefined;
      if (!row) {
        throw fail(
          'REQUIRED_TABLE_MISSING',
          `Required table is missing from the backup: ${table}.`,
        );
      }
    }
    try {
      this.validateDatabase?.(db);
    } catch (error) {
      throw fail(
        'CUSTOM_VERIFICATION_FAILED',
        'Custom verification policy rejected the backup.',
        error,
      );
    }
  }

  /**
   * Read and structurally validate a backup's metadata without opening the SQLite database. Does
   * not claim the backup is currently valid.
   */
  public async inspectBackup(backupId: string): Promise<BackupMetadata> {
    validateBackupId(backupId);
    const finalDir = winPath.join(this.backupRoot, backupId);
    if (!this.backupRootResolver.isWithinDataRoot(finalDir)) {
      throw fail('INVALID_BACKUP_ID', 'Resolved backup path escapes backupRoot.');
    }
    const finalInfo = inspectPath(finalDir);
    if (!finalInfo.exists || finalInfo.symlink || !finalInfo.directory) {
      throw fail('BACKUP_NOT_FOUND', `No backup directory exists for ID: ${backupId}.`);
    }
    const metaPath = winPath.join(finalDir, META_FILENAME);
    const metaInfo = inspectPath(metaPath);
    if (!metaInfo.exists) {
      throw fail('METADATA_NOT_FOUND', 'metadata.json is missing for this backup.');
    }
    if (metaInfo.symlink || !metaInfo.file) {
      throw fail('METADATA_INVALID', 'metadata.json must be a regular file.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch (error) {
      throw fail('METADATA_INVALID', 'metadata.json is not valid JSON.', error);
    }
    const result = metadataSchema.safeParse(parsed);
    if (!result.success) {
      throw fail('METADATA_INVALID', 'metadata.json failed structural validation.');
    }
    const metadata = result.data;
    if (metadata.backupId !== backupId) {
      throw fail('METADATA_INVALID', 'metadata.backupId does not match the requested backup ID.');
    }
    return metadata;
  }

  /**
   * Verify an existing backup: inspect metadata, open the database read-only, run all mandatory
   * checks, and recompute size/SHA-256/schema version for comparison. Never modifies files.
   */
  public async verifyBackup(backupId: string): Promise<BackupVerification> {
    const metadata = await this.inspectBackup(backupId);
    const finalDir = winPath.join(this.backupRoot, backupId);
    const dbPath = winPath.join(finalDir, BACKUP_DB_FILENAME);
    const dbInfo = inspectPath(dbPath);
    if (!dbInfo.exists) {
      throw fail('BACKUP_FILE_MISSING', 'database.sqlite is missing for this backup.');
    }
    if (dbInfo.symlink || !dbInfo.file) {
      throw fail('INTEGRITY_CHECK_FAILED', 'database.sqlite must be a regular file.');
    }
    let schemaVersion = 0;
    let verificationDb: DatabaseSyncInstance | undefined;
    try {
      if (statSync(dbPath).size === 0) {
        throw fail('BACKUP_FILE_EMPTY', 'The backup database file is empty.');
      }
      verificationDb = new DatabaseSync(dbPath, { readOnly: true });
      this.runMandatoryDatabaseChecks(verificationDb, (version) => {
        schemaVersion = version;
      });
    } catch (error) {
      if (error instanceof BackupManagerError) throw error;
      throw fail('INTEGRITY_CHECK_FAILED', 'The backup database could not be verified.', error);
    } finally {
      if (verificationDb) {
        try {
          verificationDb.close();
        } catch {
          // Non-fatal.
        }
      }
    }

    const sizeBytes = statSync(dbPath).size;
    const sha256 = await sha256OfFile(dbPath);
    if (sizeBytes !== metadata.backupDatabase.sizeBytes) {
      throw fail('SIZE_MISMATCH', 'Backup file size does not match metadata.');
    }
    if (sha256 !== metadata.backupDatabase.sha256) {
      throw fail('CHECKSUM_MISMATCH', 'Backup file SHA-256 does not match metadata.');
    }
    if (schemaVersion !== metadata.schemaVersion) {
      throw fail('SCHEMA_VERSION_MISMATCH', 'Backup schema version does not match metadata.');
    }
    let managedAssets: BackupVerification['managedAssets'];
    if (metadata.managedAssets) {
      try {
        managedAssets = {
          metadata: metadata.managedAssets,
          manifest: verifyManagedAssetSnapshot(finalDir, metadata.managedAssets),
        };
      } catch (error) {
        throw fail(
          'MANAGED_ASSET_VERIFICATION_FAILED',
          'Managed Library assets failed backup verification.',
          error,
        );
      }
    }
    return {
      backupId,
      verified: true,
      integrityCheck: 'ok',
      schemaVersion,
      sizeBytes,
      sha256,
      requiredTablesChecked: metadata.verification.requiredTablesChecked,
      customPolicyChecked: metadata.verification.customPolicyChecked,
      ...(managedAssets ? { managedAssets } : {}),
    };
  }
}
