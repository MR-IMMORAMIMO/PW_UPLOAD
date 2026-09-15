/**
 * Shared types for the persistent external migration journal.
 *
 * These types are intentionally narrow: they expose only what the journal needs and deliberately
 * provide no filesystem, network, Electron, Fastify, Teams, or UI capability. The journal records
 * migration attempt lifecycle in an append-only JSONL file that survives SQLite transaction
 * rollback and process termination.
 *
 * Recovery states (INTERRUPTED, RECOVERED, RECONCILIATION_REQUIRED, ABANDONED) are deferred to
 * P1.5. This module defines only the types needed by the P1.4B PersistentMigrationJournal.
 */

import type { MigrationJournalState } from '../types';

// ---------------------------------------------------------------------------
// Database identity
// ---------------------------------------------------------------------------

/**
 * A stable, path-free identity for the database the journal is bound to.
 *
 * Managed databases (inside the configured data root) are identified by a relative path so the
 * identity survives moving the data root. External databases (outside the data root) are
 * identified by a normalized absolute path. Two external databases with the same filename but
 * different directories produce different identity hashes.
 */
export interface DatabaseRef {
  /** Stable hash derived from the database path. Never contains the raw absolute path. */
  readonly identityHash: string;
  /** Whether the database lives inside the configured data root. */
  readonly managed: boolean;
}

// ---------------------------------------------------------------------------
// Journal record format
// ---------------------------------------------------------------------------

/** The single supported journal format version. */
export const JOURNAL_FORMAT_VERSION = 1 as const;

/** Shape of the `format` object inside every journal record. */
export interface JournalRecordFormat {
  readonly version: typeof JOURNAL_FORMAT_VERSION;
  readonly appVersion: string;
}

/** Shape of the `database` object inside every journal record. */
export interface JournalRecordDatabase {
  readonly identityHash: string;
  readonly managed: boolean;
}

/** Shape of the `attempt` object inside every journal record. */
export interface JournalRecordAttempt {
  readonly attemptId: string;
  readonly fromVersion: number;
  readonly targetVersion: number;
}

/** Optional step details attached to TRANSACTION_STARTED and COMMITTED records. */
export interface JournalRecordStep {
  readonly migrationId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
}

/** Optional backup details attached to BACKUP_VERIFIED records. */
export interface JournalRecordBackup {
  readonly backupId: string;
}

/** Optional duration attached to COMMITTED records. */
export interface JournalRecordDuration {
  readonly durationMs: number;
}

/** Failure details attached to FAILED records. */
export interface JournalRecordFailure {
  readonly code: string;
  readonly safeMessage: string;
}

/**
 * A single append-only JSONL record in the journal.
 *
 * Every record carries a monotonically increasing sequence number, a checksum of the canonical
 * JSON of the previous record (null for the header), and a checksum of its own canonical JSON.
 * This chain detects accidental corruption: modified, reordered, deleted, inserted, or
 * duplicate records. It is not authentication and does not prevent deliberate local editing.
 */
export interface JournalRecord {
  readonly sequence: number;
  readonly previousChecksum: string | null;
  readonly checksum: string;
  readonly timestamp: string;
  readonly state: MigrationJournalState;
  readonly format: JournalRecordFormat;
  readonly database: JournalRecordDatabase;
  readonly attempt: JournalRecordAttempt;
  readonly step?: JournalRecordStep | undefined;
  readonly backup?: JournalRecordBackup | undefined;
  readonly duration?: JournalRecordDuration | undefined;
  readonly failure?: JournalRecordFailure | undefined;
}

// ---------------------------------------------------------------------------
// Inspection and scanning types
// ---------------------------------------------------------------------------

/** Summary of a single attempt file, returned by listAttempts. */
export interface AttemptSummary {
  /** Derived recovery classification (additive, not on the journal port). */
  readonly classification: AttemptClassification;
  readonly attemptId: string;
  readonly identityHash: string;
  readonly latestState: MigrationJournalState | null;
  readonly terminal: boolean;
  readonly corrupt: boolean;
  readonly issue?: string | undefined;
}

/** Full inspection result for a single attempt. */
export interface AttemptInspection {
  readonly attemptId: string;
  readonly identityHash: string;
  readonly records: readonly JournalRecord[];
  readonly latestState: MigrationJournalState | null;
  readonly terminal: boolean;
  readonly completedMigrationIds: readonly string[];
  readonly currentMigrationId: string | null;
  readonly currentCommittedVersion: number | null;
  readonly backupId: string | null;
  readonly corrupt: boolean;
  readonly issues: readonly string[];
  readonly trailingPartialRecord: boolean;
  readonly recoveryClassification: AttemptClassification;
}

/** Derived classification for an attempt. */
export type AttemptClassification =
  'non-terminal' | 'terminal-success' | 'terminal-failure' | 'corrupt' | 'reconciliation-required';

// ---------------------------------------------------------------------------
// Write hooks for deterministic failure testing
// ---------------------------------------------------------------------------

/**
 * Narrow write hooks injected for deterministic failure testing.
 *
 * Each hook is called at a specific point in the write workflow. If a hook throws, the journal
 * treats the operation as failed and does not claim success. Hooks are never called in production.
 */
export interface JournalWriteHooks {
  /** Called after the file is opened but before the first byte is written. */
  readonly beforeFirstWrite?: ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called after the record is written but before fsync. */
  readonly afterWriteBeforeSync?: ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called after fsync but before the handle is closed. */
  readonly afterSyncBeforeClose?: ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called during transition/markFailed after inspection but before append. */
  readonly beforeAppend?: ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called before the resolution sidecar file is exclusively created. */
  readonly beforeResolutionFirstWrite?: ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called after the resolution record is written but before fsync. */
  readonly afterResolutionWriteBeforeSync?:
    ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called after the resolution record is synced but before the handle is closed. */
  readonly afterResolutionSyncBeforeClose?:
    ((attemptId: string) => void | Promise<void>) | undefined;
  /** Called after the resolution handle is closed but before read-back verification. */
  readonly afterResolutionCloseBeforeVerify?:
    ((attemptId: string) => void | Promise<void>) | undefined;
}

// ---------------------------------------------------------------------------
// Resolution sidecar (P1.5B2A)
// ---------------------------------------------------------------------------

/** The single supported resolution sidecar format version. */
export const RESOLUTION_FORMAT_VERSION = 1 as const;

/** The record type discriminator for resolution sidecar records. */
export const RESOLUTION_RECORD_TYPE = 'migration-resolution' as const;

/**
 * Disposition of a resolved migration attempt. P1.5B2A supports only safe, unambiguous
 * dispositions; restore, UI, LegacyDetector, future-schema acceptance, and corrupt-journal
 * acceptance are intentionally excluded.
 */
export type ResolutionDisposition =
  | 'SAFE_PRE_TRANSACTION_RETRY'
  | 'TRANSACTION_ROLLED_BACK'
  | 'COMMIT_CONFIRMED_FROM_DATABASE'
  | 'VALID_INTERMEDIATE_VERSION'
  | 'RESOLVED_SUCCESS';

/**
 * Strict caller-supplied input for appending a resolution sidecar. The timestamp is supplied
 * internally from the injected clock and is never accepted from the caller. All string
 * identifiers are non-empty, NUL-free, single-line, path-free, and bounded. Fingerprints and
 * checksums are exactly 64 lowercase hexadecimal characters. Versions are finite non-negative
 * integers.
 */
export interface MigrationResolutionInput {
  readonly disposition: ResolutionDisposition;
  readonly planFingerprint: string;
  readonly attemptLatestChecksum: string;
  readonly observedUserVersion: number;
  readonly observedHistoryFingerprint: string;
  readonly observedCompletedMigrationIds: readonly string[];
  readonly observedCurrentMigrationId?: string | undefined;
  readonly backupId?: string | undefined;
  readonly backupVerified: boolean;
  readonly startupAllowed: boolean;
  readonly newAttemptAllowed: boolean;
  readonly manualActionRequired: boolean;
  readonly safeReasonCode: string;
}

/**
 * A single immutable resolution sidecar record. Exactly one record is supported per attempt.
 * The record carries sequence 0, a null previousChecksum, and a SHA-256 checksum over its own
 * canonical JSON (excluding the checksum field). No absolute path, username, machine name, SQL,
 * stack trace, or business data is persisted.
 */
export interface MigrationResolutionRecord {
  readonly resolutionFormatVersion: typeof RESOLUTION_FORMAT_VERSION;
  readonly recordType: typeof RESOLUTION_RECORD_TYPE;
  readonly attemptId: string;
  readonly sequence: number;
  readonly previousChecksum: null;
  readonly timestamp: string;
  readonly disposition: ResolutionDisposition;
  readonly planFingerprint: string;
  readonly attemptLatestChecksum: string;
  readonly observedUserVersion: number;
  readonly observedHistoryFingerprint: string;
  readonly observedCompletedMigrationIds: readonly string[];
  readonly observedCurrentMigrationId?: string | undefined;
  readonly backupId?: string | undefined;
  readonly backupVerified: boolean;
  readonly startupAllowed: boolean;
  readonly newAttemptAllowed: boolean;
  readonly manualActionRequired: boolean;
  readonly safeReasonCode: string;
  readonly checksum: string;
}

/** Deeply immutable inspection result returned by inspectResolution. */
export type MigrationResolutionInspection = MigrationResolutionRecord;
// ---------------------------------------------------------------------------
// Effective resolution classification (P1.5B2B1)
// ---------------------------------------------------------------------------

/** Status of an effective resolution sidecar. */
export type EffectiveResolutionStatus = 'ABSENT' | 'EFFECTIVE' | 'STALE' | 'CORRUPT';

/**
 * Immutable inspection/classification result for an attempt's resolution sidecar.
 *
 * Retry permission is request-aware and deferred to P1.5B2B2. The newAttemptAllowed value
 * applies to the resolved attempt and its plan only; it does not mean the database can never
 * receive a future higher-target migration.
 */
export interface AttemptResolutionInspection {
  readonly attemptId: string;
  /** Existing journal-only attempt classification. */
  readonly classification: AttemptClassification;
  /** Effective resolution status. */
  readonly effectiveResolutionStatus: EffectiveResolutionStatus;
  /** Resolution disposition, present only when status is EFFECTIVE. */
  readonly effectiveDisposition?: ResolutionDisposition | undefined;
  /** Whether a new attempt is allowed based on the resolution. */
  readonly newAttemptAllowed: boolean;
  /** Whether startup is allowed based on the resolution. */
  readonly startupAllowed: boolean;
  /** Whether manual action is required. */
  readonly manualActionRequired: boolean;
  /** Current attempt latest valid checksum, present when available. */
  readonly attemptLatestChecksum?: string | undefined;
  /** Resolution sidecar checksum, present when available. */
  readonly resolutionChecksum?: string | undefined;
}

// ---------------------------------------------------------------------------
// Constructor dependencies
// ---------------------------------------------------------------------------

/** Dependencies required to construct a PersistentMigrationJournal. */
export interface PersistentMigrationJournalDeps {
  readonly journalRoot: string;
  readonly databasePath: string;
  readonly pathResolver: import('../../path/PathResolverService').PathResolverService;
  readonly clock: import('../types').MigrationClock;
  readonly idGenerator: { generate(): string };
  readonly appVersion: string;
  readonly journalFormatVersion: typeof JOURNAL_FORMAT_VERSION;
  readonly writeHooks?: JournalWriteHooks | undefined;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/** Stable machine-readable error codes used by PersistentMigrationJournalError. */
export type PersistentMigrationJournalErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_DATABASE_REFERENCE'
  | 'JOURNAL_ROOT_OUTSIDE_DATA_ROOT'
  | 'UNSAFE_FILESYSTEM_ENTRY'
  | 'INVALID_ATTEMPT_ID'
  | 'ATTEMPT_COLLISION'
  | 'ACTIVE_ATTEMPT_EXISTS'
  | 'ATTEMPT_NOT_FOUND'
  | 'ATTEMPT_CORRUPT'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_STATE_TRANSITION'
  | 'TERMINAL_ATTEMPT'
  | 'WRITE_FAILED'
  | 'SYNC_FAILED'
  | 'READ_VERIFICATION_FAILED'
  | 'INVALID_RESOLUTION'
  | 'STALE_RESOLUTION_PLAN'
  | 'RESOLUTION_ALREADY_EXISTS'
  | 'RESOLUTION_CORRUPT'
  | 'RESOLUTION_WRITE_FAILED'
  | 'RESOLUTION_SYNC_FAILED'
  | 'RESOLUTION_READ_VERIFICATION_FAILED';

/**
 * Typed error thrown by PersistentMigrationJournal. Carries a stable machine-readable code and
 * preserves the original cause via Error.cause. Public messages never include absolute paths,
 * stack traces, or secrets.
 */
export class PersistentMigrationJournalError extends Error {
  public readonly code: PersistentMigrationJournalErrorCode;

  public constructor(
    code: PersistentMigrationJournalErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PersistentMigrationJournalError';
    this.code = code;
  }
}
