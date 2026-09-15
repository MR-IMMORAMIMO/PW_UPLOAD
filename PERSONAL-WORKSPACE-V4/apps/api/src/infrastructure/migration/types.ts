/**
 * Public types for the isolated schema migration runner.
 *
 * These types are intentionally narrow: they expose only what migrations and the runner need and
 * deliberately provide no filesystem, network, Electron, Fastify, Teams, or UI capability.
 * Migrations must be deterministic database-only operations (see MigrationDefinition docs).
 */

import type { DatabaseSync } from 'node:sqlite';
import type { PathResolverService } from '../path/PathResolverService';

/** Clock port for deterministic timestamps inside migrations and history records. */
export interface MigrationClock {
  now(): Date;
}

/** Context handed to a single migration's up()/validate() callbacks. */
export interface MigrationContext {
  /** The read/write DatabaseSync handle for the current migration transaction. */
  readonly database: DatabaseSync;
  /** Stable identifier of the migration being applied. */
  readonly migrationId: string;
  /** Schema version before this migration runs. */
  readonly fromVersion: number;
  /** Schema version after this migration commits. */
  readonly toVersion: number;
  /** Injected clock for deterministic timestamps. */
  readonly clock: MigrationClock;
}

/**
 * A single schema migration. Migrations must be deterministic database-only operations: they may
 * modify SQLite schema and data only, must not touch the filesystem, and must not depend on
 * Date.now(), randomness, UI state, or machine-specific paths.
 */
export interface MigrationDefinition {
  /** Stable, unique, non-empty identifier with no NUL characters. */
  readonly id: string;
  /** Schema version before this migration. Non-negative integer. */
  readonly fromVersion: number;
  /** Schema version after this migration. Must equal fromVersion + 1. */
  readonly toVersion: number;
  /** Immutable SHA-256 checksum (exactly 64 lowercase hexadecimal characters). */
  readonly checksum: string;
  /** Short, non-empty human-readable description. */
  readonly description: string;
  /**
   * Explicit opt-in for a table-rebuild migration that must temporarily disable SQLite foreign
   * key enforcement. The runner still performs the migration under BEGIN IMMEDIATE and restores
   * enforcement plus a full foreign_key_check before continuing.
   */
  readonly foreignKeyMode?: 'DISABLED_DURING_MIGRATION';
  /** Applies the migration against the context database. */
  readonly up: (context: MigrationContext) => void;
  /** Optional in-transaction validation that must not throw for the migration to commit. */
  readonly validate?: (context: MigrationContext) => void;
  /**
   * Optional read-only validation for a database already at this migration's toVersion. The
   * runner invokes it before returning up-to-date and during final post-commit validation.
   */
  readonly validateCurrent?: (database: DatabaseSync) => void;
}

/** Opens short-lived DatabaseSync connections owned and closed by the runner. */
export interface MigrationDatabaseFactory {
  openReadWrite(databasePath: string): DatabaseSync;
  openReadOnly(databasePath: string): DatabaseSync;
}

/** Request to create a verified backup before an upgrade run. */
export interface MigrationBackupRequest {
  reason: string;
  migrationId: string;
}

/** Result of creating a verified backup. */
export interface MigrationBackupResult {
  backupId: string;
}

/** Narrow backup port the runner depends on (decoupled from the full BackupManager). */
export interface MigrationBackupPort {
  createVerifiedBackup(request: MigrationBackupRequest): Promise<MigrationBackupResult>;
  verifyBackup(backupId: string): Promise<unknown>;
}

/** Input for creating a MigrationBackupPort bound to the runner's open source handle. */
export interface MigrationBackupFactoryInput {
  sourceDb: DatabaseSync;
  sourceDatabasePath: string;
  /** Detected source schema version, so integration can apply source-version-aware verification. */
  sourceVersion: number;
}

/** Factory for the per-run backup port. */
export interface MigrationBackupFactory {
  create(input: MigrationBackupFactoryInput): MigrationBackupPort;
}

/** Lifecycle states recorded by the external migration journal. */
export type MigrationJournalState =
  | 'CREATED'
  | 'PREFLIGHT_VALIDATED'
  | 'BACKUP_VERIFIED'
  | 'TRANSACTION_STARTED'
  | 'COMMITTED'
  | 'POST_VALIDATION_PASSED'
  | 'SUCCEEDED'
  | 'FAILED';

/** Input used to create a journal attempt. Contains no absolute paths or secrets. */
export interface MigrationJournalAttemptInput {
  fromVersion: number;
  targetVersion: number;
}

/** Optional details attached to a journal state transition. Contains no absolute paths. */
export interface MigrationJournalDetails {
  migrationId?: string | undefined;
  fromVersion?: number | undefined;
  toVersion?: number | undefined;
  backupId?: string | undefined;
  durationMs?: number | undefined;
}

/** Concise sanitized failure record. Contains no absolute paths, stack traces, or secrets. */
export interface MigrationJournalFailure {
  code: string;
  message: string;
}

/** External journal port. Records attempt lifecycle even when the SQLite transaction rolls back. */
export interface MigrationJournalPort {
  createAttempt(input: MigrationJournalAttemptInput): Promise<{ attemptId: string }>;
  transition(
    attemptId: string,
    state: MigrationJournalState,
    details?: MigrationJournalDetails,
  ): Promise<void>;
  markFailed(attemptId: string, failure: MigrationJournalFailure): Promise<void>;
}

/** Result of a migration run. */
export interface MigrationRunResult {
  status: 'up-to-date' | 'migrated';
  fromVersion: number;
  toVersion: number;
  appliedMigrationIds: string[];
  backupId?: string | undefined;
  attemptId?: string | undefined;
}

/**
 * Statuses returned by the legacy migration admission port. These structurally match the
 * LegacyDetector statuses so a LegacyDetector instance satisfies the port without modification.
 */
export type LegacyMigrationAdmissionStatus =
  | 'LEGACY_V3_2_2'
  | 'CURRENT_SELF_MANAGED_UNVERSIONED'
  | 'EMPTY_DATABASE'
  | 'PARTIAL_LEGACY_SCHEMA'
  | 'NOT_APPLICABLE'
  | 'BLOCKED';

/**
 * Read-only legacy admission result. Exposes only the fields the SchemaMigrationRunner needs to
 * authorize a version-zero populated database for migration. Never contains a path, SQL, or
 * error object.
 */
export interface LegacyMigrationAdmissionResult {
  readonly status: LegacyMigrationAdmissionStatus;
  readonly observedUserVersion: number;
  readonly historyTableExists: boolean;
  readonly migrationCandidate: boolean;
  readonly manualActionRequired: boolean;
  readonly safeReasonCode: string;
  readonly observedTableCount: number;
  readonly observedOwnedIndexCount: number;
  readonly observedStructuralFingerprint: string | null;
}

/**
 * Narrow synchronous legacy admission port consumed by the SchemaMigrationRunner. The runner owns
 * every admission call and always performs fresh detection itself; callers cannot supply a
 * previous result, fingerprint, or authorization flag.
 */
export interface LegacyMigrationAdmission {
  inspect(databasePath: string): LegacyMigrationAdmissionResult;
}

/** Dependencies required to construct a SchemaMigrationRunner. */
export interface SchemaMigrationRunnerDeps {
  migrations: readonly MigrationDefinition[];
  targetVersion: number;
  appVersion: string;
  databaseFactory: MigrationDatabaseFactory;
  backupFactory: MigrationBackupFactory;
  journal: MigrationJournalPort;
  clock: MigrationClock;
  pathResolver: PathResolverService;
  busyTimeoutMs: number;
  legacyAdmission: LegacyMigrationAdmission;
}

/** Stable machine-readable error codes used by SchemaMigrationError. */
export type SchemaMigrationErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_DATABASE_PATH'
  | 'SOURCE_DATABASE_UNAVAILABLE'
  | 'INVALID_MIGRATION_REGISTRY'
  | 'UNVERSIONED_DATABASE_REQUIRES_LEGACY_DETECTION'
  | 'FUTURE_SCHEMA_VERSION'
  | 'MIGRATION_HISTORY_MISMATCH'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'BACKUP_FAILED'
  | 'JOURNAL_WRITE_FAILED'
  | 'STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT'
  | 'MIGRATION_LOCK_FAILED'
  | 'MIGRATION_EXECUTION_FAILED'
  | 'MIGRATION_VALIDATION_FAILED'
  | 'MIGRATION_COMMIT_FAILED'
  | 'POST_MIGRATION_VALIDATION_FAILED'
  | 'LEGACY_ADMISSION_REJECTED'
  | 'LEGACY_STATE_CHANGED_AFTER_BACKUP'
  | 'LEGACY_DETECTOR_UNAVAILABLE';

/**
 * Typed error thrown by the schema migration runner. Carries a stable machine-readable code and
 * preserves the original cause via Error.cause. Messages and details are sanitized and never
 * include absolute database paths, machine names, or secrets.
 */
export class SchemaMigrationError extends Error {
  public readonly code: SchemaMigrationErrorCode;
  public readonly attemptId?: string;
  public readonly backupId?: string;

  public constructor(
    code: SchemaMigrationErrorCode,
    message: string,
    options?: { cause?: unknown; attemptId?: string | undefined; backupId?: string | undefined },
  ) {
    super(message, options);
    this.name = 'SchemaMigrationError';
    this.code = code;
    if (options?.attemptId !== undefined) this.attemptId = options.attemptId;
    if (options?.backupId !== undefined) this.backupId = options.backupId;
  }
}
