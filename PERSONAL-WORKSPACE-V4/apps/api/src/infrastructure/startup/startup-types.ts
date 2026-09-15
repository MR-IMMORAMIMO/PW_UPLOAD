/**
 * Shared public types for the standalone startup-safety core (P1.8B).
 *
 * The startup core owns two responsibilities:
 *
 * 1. A database-scoped cross-process startup lock (DatabaseStartupLock) that protects one
 *    canonical standalone database identity while migration, recovery, and provider opening run.
 * 2. A WorkspaceStartupCoordinator that holds that lock, runs the pending-restore and
 *    interrupted-attempt gates, runs the schema migration runner, and then opens the runtime
 *    provider and personal store through injected factories.
 *
 * Every public result and error in this module is path-free, privacy-safe, and free of SQL,
 * Error objects, stack traces, and project data. The lock lease exposes only a stable identity
 * hash and a controlled release method.
 */

import type { MigrationRunResult } from '../migration/types';
import type {
  AttemptResolutionInspection,
  AttemptSummary,
} from '../migration/journal/journal-types';
export type {
  AttemptResolutionInspection,
  AttemptSummary,
} from '../migration/journal/journal-types';

// ---------------------------------------------------------------------------
// Database startup lock
// ---------------------------------------------------------------------------

/**
 * A live database startup lease. The lease is deeply immutable except for the controlled
 * `release()` method. It never exposes the database path, lock path, PID, SQL, SQLite handle,
 * or any Error object.
 */
export interface DatabaseStartupLease {
  /** Stable SHA-256 identity of the canonical database path. Never contains the raw path. */
  readonly databaseIdentityHash: string;
  /**
   * Releases the OS/SQLite-held lock. Idempotent after a successful release. A failed release
   * throws DatabaseStartupLockError with code LOCK_RELEASE_FAILED and remains visible.
   */
  release(): void;
}

/** Port implemented by DatabaseStartupLock and consumed by the coordinator. */
export interface DatabaseStartupLockPort {
  /**
   * Acquires the startup lock for one canonical database identity. Synchronous because the
   * underlying SQLite handle and transaction are synchronous; the lease stays valid across
   * asynchronous coordinator work.
   */
  acquire(databasePath: string): DatabaseStartupLease;
}

/** Stable machine-readable error codes used by DatabaseStartupLockError. */
export type DatabaseStartupLockErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_DATABASE_PATH'
  | 'UNSAFE_DATABASE_PATH'
  | 'LOCK_DATABASE_UNSAFE'
  | 'LOCK_ALREADY_HELD'
  | 'LOCK_ACQUISITION_FAILED'
  | 'LOCK_RELEASE_FAILED';

/**
 * Typed error thrown by DatabaseStartupLock. Messages are sanitized and never include absolute
 * paths, machine names, or secrets.
 */
export class DatabaseStartupLockError extends Error {
  public readonly code: DatabaseStartupLockErrorCode;

  public constructor(
    code: DatabaseStartupLockErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DatabaseStartupLockError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Pending-restore gate
// ---------------------------------------------------------------------------

/** Outcome of the narrow pre-migration recovery port. */
export type PendingRestoreOutcome = 'NO_PENDING_RESTORE' | 'RESTORED';

/**
 * Narrow pre-migration recovery port. P1.8B only runs it while the startup lock is held and
 * before migration and provider factories; it never implements restore-pending marker parsing,
 * copy behavior, backup selection, or production wiring.
 */
export interface PendingRestoreGate {
  run(): Promise<PendingRestoreOutcome>;
}

/**
 * Bounded restore failure marker. The coordinator maps this to STARTUP_BLOCKED with reason
 * RESTORE_FAILED; unknown errors are never silently converted into a blocked result.
 */
export class PendingRestoreGateError extends Error {
  public readonly code: 'RESTORE_FAILED';

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PendingRestoreGateError';
    this.code = 'RESTORE_FAILED';
  }
}

// ---------------------------------------------------------------------------
// Interrupted-attempt startup gate
// ---------------------------------------------------------------------------

/** Result of the read-only interrupted-attempt startup gate. */
export type MigrationStartupGateResult =
  | { readonly status: 'ALLOWED' }
  | {
      readonly status: 'RECOVERY_REQUIRED';
      readonly reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT' | 'RECOVERY_REQUIRED';
    };

/** Port implemented by MigrationStartupGate and consumed by the coordinator. */
export interface MigrationStartupGatePort {
  /** Read-only inspection. Never applies reconciliation and never writes a sidecar. */
  inspect(): Promise<MigrationStartupGateResult>;
}

/**
 * Narrow read-only journal inspection surface used by MigrationStartupGate. The real
 * PersistentMigrationJournal satisfies this structurally; the gate never writes to it.
 */
export interface MigrationJournalInspectionPort {
  listNonTerminalAttempts(): Promise<readonly AttemptSummary[]>;
  inspectAttemptResolution(attemptId: string): Promise<AttemptResolutionInspection>;
}

// ---------------------------------------------------------------------------
// Migration runner port
// ---------------------------------------------------------------------------

/**
 * Narrow migration runner port. The real SchemaMigrationRunner satisfies this structurally; the
 * coordinator never constructs it directly and never duplicates its checksum, journal, or
 * resolution-freshness logic.
 */
export interface MigrationRunnerPort {
  run(databasePath: string): Promise<MigrationRunResult>;
}

// ---------------------------------------------------------------------------
// Runtime resource factories and ownership
// ---------------------------------------------------------------------------

/** Minimal close contract shared by the standalone provider and personal store. */
export interface RuntimeResource {
  close(): void;
}

/** The standalone data provider runtime resource. */
export type RuntimeProvider = RuntimeResource;

/** The personal workspace store runtime resource. */
export type PersonalWorkspaceStore = RuntimeResource;

/** Factory for the standalone provider. Called only after every startup gate passes. */
export interface RuntimeProviderFactory {
  create(): RuntimeProvider;
}

/** Factory for the personal store. Called only after the provider opens successfully. */
export interface PersonalStoreFactory {
  create(): PersonalWorkspaceStore;
}

/**
 * Bounded provider-creation failure marker. The coordinator maps this to STARTUP_BLOCKED with
 * reason RUNTIME_PROVIDER_FAILED; unknown errors are never silently converted.
 */
export class RuntimeProviderError extends Error {
  public readonly code: 'RUNTIME_PROVIDER_FAILED';

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RuntimeProviderError';
    this.code = 'RUNTIME_PROVIDER_FAILED';
  }
}

/**
 * Bounded store-creation failure marker. The coordinator maps this to STARTUP_BLOCKED with
 * reason RUNTIME_STORE_FAILED; unknown errors are never silently converted.
 */
export class RuntimeStoreError extends Error {
  public readonly code: 'RUNTIME_STORE_FAILED';

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RuntimeStoreError';
    this.code = 'RUNTIME_STORE_FAILED';
  }
}

// ---------------------------------------------------------------------------
// Workspace startup results
// ---------------------------------------------------------------------------

/** The only supported startup outcomes. */
export type WorkspaceStartupOutcome =
  'READY' | 'READY_AFTER_MIGRATION' | 'STARTUP_BLOCKED' | 'RECOVERY_REQUIRED';

/** Bounded, actionable reason codes for blocked or recovery-required results. */
export type WorkspaceStartupBlockReason =
  | 'DATABASE_LOCKED'
  | 'LOCK_FAILED'
  | 'RESTORE_FAILED'
  | 'UNRESOLVED_MIGRATION_ATTEMPT'
  | 'RECOVERY_REQUIRED'
  | 'MIGRATION_FAILED'
  | 'RUNTIME_PROVIDER_FAILED'
  | 'RUNTIME_STORE_FAILED';

/**
 * Immutable, path-free, privacy-safe startup result. Never contains SQL, Error objects, stack
 * traces, or project data. `databaseIdentityHash` is present whenever the lock was acquired.
 */
export interface WorkspaceStartupResult {
  readonly outcome: WorkspaceStartupOutcome;
  readonly reasonCode?: WorkspaceStartupBlockReason;
  readonly manualActionRequired: boolean;
  readonly migrated: boolean;
  readonly fromVersion?: number;
  readonly toVersion?: number;
  readonly appliedMigrationIds: readonly string[];
  readonly databaseIdentityHash?: string;
}

// ---------------------------------------------------------------------------
// Coordinator errors
// ---------------------------------------------------------------------------

/** Stable machine-readable error codes used by WorkspaceStartupCoordinatorError. */
export type WorkspaceStartupCoordinatorErrorCode = 'ALREADY_SHUTDOWN' | 'SHUTDOWN_FAILED';

/**
 * Typed error thrown by WorkspaceStartupCoordinator for invalid coordinator state or a shutdown
 * that could not complete every cleanup step. Messages never include paths or secrets.
 */
export class WorkspaceStartupCoordinatorError extends Error {
  public readonly code: WorkspaceStartupCoordinatorErrorCode;

  public constructor(
    code: WorkspaceStartupCoordinatorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WorkspaceStartupCoordinatorError';
    this.code = code;
  }
}
