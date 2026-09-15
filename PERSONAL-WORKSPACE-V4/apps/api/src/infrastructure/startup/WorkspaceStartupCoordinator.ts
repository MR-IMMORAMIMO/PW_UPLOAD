/**
 * WorkspaceStartupCoordinator: the standalone startup-safety core (P1.8B).
 *
 * The coordinator owns one workspace database identity and serializes startup for it:
 *
 * 1. Acquire the database-scoped startup lock.
 * 2. Run the injected pending-restore gate while the lock is held.
 * 3. Inspect interrupted migration/reconciliation state (read-only; never applies
 *    reconciliation and never writes a resolution sidecar).
 * 4. Run the schema migration runner.
 * 5. Confirm the runner result is safe.
 * 6. Open the standalone provider through its injected factory.
 * 7. Open the personal store through its injected factory.
 * 8. Return READY or READY_AFTER_MIGRATION and keep the lock and resources owned until
 *    shutdown().
 *
 * The coordinator never constructs production classes directly: the lock, restore gate,
 * migration gate, migration runner, and runtime factories are all injected. Unknown
 * programming errors always propagate; only bounded typed failures become blocked results.
 */

import {
  PersistentMigrationJournalError,
  type AttemptResolutionInspection,
} from '../migration/journal/journal-types';
import { SchemaMigrationError, type MigrationRunResult } from '../migration/types';
import {
  DatabaseStartupLockError,
  PendingRestoreGateError,
  RuntimeProviderError,
  RuntimeStoreError,
  WorkspaceStartupCoordinatorError,
  type DatabaseStartupLease,
  type DatabaseStartupLockPort,
  type MigrationJournalInspectionPort,
  type MigrationRunnerPort,
  type MigrationStartupGatePort,
  type MigrationStartupGateResult,
  type PendingRestoreGate,
  type PersonalStoreFactory,
  type PersonalWorkspaceStore,
  type RuntimeProvider,
  type RuntimeProviderFactory,
  type WorkspaceStartupBlockReason,
  type WorkspaceStartupResult,
} from './startup-types';

// ---------------------------------------------------------------------------
// Interrupted-attempt startup gate
// ---------------------------------------------------------------------------

/**
 * Read-only interrupted-attempt startup gate.
 *
 * Uses the existing journal public APIs (listNonTerminalAttempts and
 * inspectAttemptResolution) and never calls InterruptedMigrationReconciler.apply(), never
 * writes a resolution sidecar, and never mutates the database. Startup proceeds only when
 * every non-terminal attempt has an effective resolution that explicitly allows startup
 * without manual action; every other state fails closed to RECOVERY_REQUIRED.
 */
export class MigrationStartupGate implements MigrationStartupGatePort {
  private readonly journal: MigrationJournalInspectionPort;

  public constructor(journal: MigrationJournalInspectionPort) {
    this.journal = journal;
  }

  public async inspect(): Promise<MigrationStartupGateResult> {
    const attempts = await this.journal.listNonTerminalAttempts();
    if (attempts.length === 0) {
      return { status: 'ALLOWED' };
    }
    for (const attempt of attempts) {
      let resolution: AttemptResolutionInspection;
      try {
        resolution = await this.journal.inspectAttemptResolution(attempt.attemptId);
      } catch (error) {
        if (error instanceof PersistentMigrationJournalError) {
          // A journal that cannot be inspected cannot prove startup is safe.
          return { status: 'RECOVERY_REQUIRED', reasonCode: 'RECOVERY_REQUIRED' };
        }
        throw error;
      }
      if (
        resolution.effectiveResolutionStatus === 'EFFECTIVE' &&
        resolution.startupAllowed === true &&
        resolution.manualActionRequired === false
      ) {
        continue;
      }
      return { status: 'RECOVERY_REQUIRED', reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT' };
    }
    return { status: 'ALLOWED' };
  }
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

/** Dependencies required to construct a WorkspaceStartupCoordinator. */
export interface WorkspaceStartupCoordinatorDeps {
  /** Absolute path of the workspace database this coordinator protects. */
  readonly databasePath: string;
  readonly lock: DatabaseStartupLockPort;
  readonly pendingRestoreGate: PendingRestoreGate;
  readonly migrationGate: MigrationStartupGatePort;
  readonly migrationRunner: MigrationRunnerPort;
  readonly providerFactory: RuntimeProviderFactory;
  readonly storeFactory: PersonalStoreFactory;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

function isSafeMigrationResult(result: MigrationRunResult): boolean {
  return (
    (result.status === 'up-to-date' || result.status === 'migrated') &&
    Number.isInteger(result.fromVersion) &&
    result.fromVersion >= 0 &&
    Number.isInteger(result.toVersion) &&
    result.toVersion >= 0 &&
    Array.isArray(result.appliedMigrationIds) &&
    result.appliedMigrationIds.every((id) => typeof id === 'string' && id.length > 0)
  );
}

/**
 * Standalone startup coordinator. One instance serializes startup for one database identity;
 * there is no global queue and no global singleton.
 */
export class WorkspaceStartupCoordinator {
  private readonly databasePath: string;
  private readonly lock: DatabaseStartupLockPort;
  private readonly pendingRestoreGate: PendingRestoreGate;
  private readonly migrationGate: MigrationStartupGatePort;
  private readonly migrationRunner: MigrationRunnerPort;
  private readonly providerFactory: RuntimeProviderFactory;
  private readonly storeFactory: PersonalStoreFactory;

  private state: 'idle' | 'starting' | 'ready' | 'stopped' = 'idle';
  private inFlight: Promise<WorkspaceStartupResult> | null = null;
  private readyResult: WorkspaceStartupResult | null = null;
  private lease: DatabaseStartupLease | null = null;
  private provider: RuntimeProvider | null = null;
  private store: PersonalWorkspaceStore | null = null;

  public constructor(deps: WorkspaceStartupCoordinatorDeps) {
    this.databasePath = deps.databasePath;
    this.lock = deps.lock;
    this.pendingRestoreGate = deps.pendingRestoreGate;
    this.migrationGate = deps.migrationGate;
    this.migrationRunner = deps.migrationRunner;
    this.providerFactory = deps.providerFactory;
    this.storeFactory = deps.storeFactory;
  }

  /**
   * Starts the workspace. Concurrent start() calls serialize on one in-flight run and observe
   * the same final outcome. A start after READY returns the cached result without reopening
   * resources. A failed start leaves the coordinator idle so a later retry is safe.
   */
  public async start(): Promise<WorkspaceStartupResult> {
    if (this.state === 'ready' && this.readyResult !== null) {
      return this.readyResult;
    }
    if (this.state === 'stopped') {
      throw new WorkspaceStartupCoordinatorError(
        'ALREADY_SHUTDOWN',
        'The workspace coordinator has already been shut down.',
      );
    }
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    const run = this.startOnce();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * Shuts the workspace down: closes the personal store, closes the provider, releases the
   * startup lock, and attempts every cleanup step even if an earlier step fails. Idempotent.
   * If startup is in progress, shutdown waits deterministically for it to settle first.
   */
  public async shutdown(): Promise<void> {
    if (this.state === 'stopped') return;
    if (this.inFlight !== null) {
      try {
        await this.inFlight;
      } catch {
        // A failed startup has no resources to close; continue with cleanup.
      }
    }
    const errors: unknown[] = [];
    if (this.store !== null) {
      try {
        this.store.close();
      } catch (error) {
        errors.push(error);
      }
      this.store = null;
    }
    if (this.provider !== null) {
      try {
        this.provider.close();
      } catch (error) {
        errors.push(error);
      }
      this.provider = null;
    }
    if (this.lease !== null) {
      try {
        this.lease.release();
      } catch (error) {
        errors.push(error);
      }
      this.lease = null;
    }
    this.state = 'stopped';
    this.readyResult = null;
    if (errors.length > 0) {
      throw new WorkspaceStartupCoordinatorError(
        'SHUTDOWN_FAILED',
        'Workspace shutdown did not complete every cleanup step.',
        { cause: errors.length === 1 ? errors[0] : new AggregateError(errors) },
      );
    }
  }

  private async startOnce(): Promise<WorkspaceStartupResult> {
    this.state = 'starting';
    let lease: DatabaseStartupLease | null = null;
    let provider: RuntimeProvider | null = null;
    let store: PersonalWorkspaceStore | null = null;
    try {
      // 1. Acquire the database startup lock.
      try {
        lease = this.lock.acquire(this.databasePath);
      } catch (error) {
        if (error instanceof DatabaseStartupLockError) {
          return this.blockedResult(
            error.code === 'LOCK_ALREADY_HELD' ? 'DATABASE_LOCKED' : 'LOCK_FAILED',
          );
        }
        throw error;
      }

      // 2. Pending-restore gate (runs while the lock is held, before migration).
      try {
        await this.pendingRestoreGate.run();
      } catch (error) {
        if (error instanceof PendingRestoreGateError) {
          return this.releaseAndBlock(lease, 'RESTORE_FAILED');
        }
        throw error;
      }

      // 3. Interrupted-attempt gate (read-only; never applies reconciliation).
      let gate: MigrationStartupGateResult;
      try {
        gate = await this.migrationGate.inspect();
      } catch (error) {
        if (error instanceof PersistentMigrationJournalError) {
          return this.releaseAndRecover(lease, 'RECOVERY_REQUIRED');
        }
        throw error;
      }
      if (gate.status === 'RECOVERY_REQUIRED') {
        return this.releaseAndRecover(lease, gate.reasonCode);
      }

      // 4. Migration runner.
      let migration: MigrationRunResult;
      try {
        migration = await this.migrationRunner.run(this.databasePath);
      } catch (error) {
        if (error instanceof SchemaMigrationError) {
          if (error.code === 'STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT') {
            return this.releaseAndRecover(lease, 'UNRESOLVED_MIGRATION_ATTEMPT');
          }
          return this.releaseAndBlock(lease, 'MIGRATION_FAILED');
        }
        throw error;
      }

      // 5. Confirm the runner's trusted result is safe before opening providers.
      if (!isSafeMigrationResult(migration)) {
        return this.releaseAndBlock(lease, 'MIGRATION_FAILED');
      }

      // 6. Open the standalone provider (exactly once, after every gate passes).
      try {
        provider = this.providerFactory.create();
      } catch (error) {
        if (error instanceof RuntimeProviderError) {
          return this.releaseAndBlock(lease, 'RUNTIME_PROVIDER_FAILED');
        }
        throw error;
      }

      // 7. Open the personal store (exactly once, after the provider).
      try {
        store = this.storeFactory.create();
      } catch (error) {
        this.closeBestEffort(provider);
        provider = null;
        if (error instanceof RuntimeStoreError) {
          return this.releaseAndBlock(lease, 'RUNTIME_STORE_FAILED');
        }
        throw error;
      }

      // 8. Success: keep the lock and resources owned until shutdown().
      this.lease = lease;
      this.provider = provider;
      this.store = store;
      const result = this.readyResultFrom(lease, migration);
      this.state = 'ready';
      this.readyResult = result;
      return result;
    } catch (error) {
      // Unknown programming error: release the lock and any opened resources, then rethrow.
      this.closeBestEffort(store);
      this.closeBestEffort(provider);
      if (lease !== null) {
        // Retain the lease so shutdown() can retry a failed release; the original
        // programming error is still rethrown below.
        this.lease = lease;
        try {
          lease.release();
        } catch {
          // Preserve the original programming error.
        }
      }
      this.state = 'idle';
      throw error;
    }
  }

  private readyResultFrom(
    lease: DatabaseStartupLease,
    migration: MigrationRunResult,
  ): WorkspaceStartupResult {
    const migrated = migration.status === 'migrated';
    return deepFreeze<WorkspaceStartupResult>({
      outcome: migrated ? 'READY_AFTER_MIGRATION' : 'READY',
      manualActionRequired: false,
      migrated,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      appliedMigrationIds: [...migration.appliedMigrationIds],
      databaseIdentityHash: lease.databaseIdentityHash,
    });
  }

  private blockedResult(reason: WorkspaceStartupBlockReason): WorkspaceStartupResult {
    return deepFreeze<WorkspaceStartupResult>({
      outcome: 'STARTUP_BLOCKED',
      reasonCode: reason,
      manualActionRequired: false,
      migrated: false,
      appliedMigrationIds: [],
    });
  }

  private releaseAndBlock(
    lease: DatabaseStartupLease,
    reason: WorkspaceStartupBlockReason,
  ): WorkspaceStartupResult {
    // Retain the lease so shutdown() can retry a failed release; the bounded startup
    // outcome is still returned below.
    this.lease = lease;
    this.releaseBestEffort(lease);
    this.state = 'idle';
    return this.blockedResult(reason);
  }

  private releaseAndRecover(
    lease: DatabaseStartupLease,
    reason: 'UNRESOLVED_MIGRATION_ATTEMPT' | 'RECOVERY_REQUIRED',
  ): WorkspaceStartupResult {
    // Retain the lease so shutdown() can retry a failed release; the recovery-required
    // outcome is still returned below.
    this.lease = lease;
    this.releaseBestEffort(lease);
    this.state = 'idle';
    return deepFreeze<WorkspaceStartupResult>({
      outcome: 'RECOVERY_REQUIRED',
      reasonCode: reason,
      manualActionRequired: true,
      migrated: false,
      appliedMigrationIds: [],
      databaseIdentityHash: lease.databaseIdentityHash,
    });
  }

  private releaseBestEffort(lease: DatabaseStartupLease): void {
    try {
      lease.release();
    } catch {
      // A failed release on a bounded startup path must not mask the startup outcome; the
      // coordinator still reports the bounded result and shutdown() will retry the lease.
    }
  }

  private closeBestEffort(resource: RuntimeProvider | PersonalWorkspaceStore | null): void {
    if (resource === null) return;
    try {
      resource.close();
    } catch {
      // Best-effort close on failure paths; shutdown() retries owned resources.
    }
  }
}
