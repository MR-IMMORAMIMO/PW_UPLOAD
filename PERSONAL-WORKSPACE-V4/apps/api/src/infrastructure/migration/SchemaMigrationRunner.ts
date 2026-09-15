/**
 * SchemaMigrationRunner: an isolated, deterministic schema migration coordinator.
 *
 * The runner owns its short-lived DatabaseSync connections (opened through MigrationDatabaseFactory),
 * creates exactly one verified backup per upgrade run before any mutation, applies each pending
 * migration in its own BEGIN IMMEDIATE transaction, commits PRAGMA user_version and the
 * schema_migrations history row atomically, and performs final post-commit validation on a
 * separate read-only connection. It never integrates with providers, servers, Electron, Teams,
 * UI, or the filesystem, and performs no automatic restore or down migration.
 *
 * Migrations are database-only operations; the MigrationContext exposes no path, filesystem, or
 * application-side-effect capability.
 *
 * Integration limitation: this runner MUST NOT be wired into application startup until the external
 * MigrationJournal persistence and interrupted-run reconciliation are implemented. Without that, a
 * crashed upgrade cannot be safely discovered or resumed, and an already-committed intermediate step
 * (step atomicity) may be left behind. Re-run safety relies on PRAGMA user_version + schema_migrations
 * history, which is enough for idempotent retry but not for detecting an interrupted attempt.
 */

import { win32 as winPath } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { PathResolverService } from '../path/PathResolverService';
import {
  SchemaMigrationError,
  type LegacyMigrationAdmission,
  type LegacyMigrationAdmissionResult,
  type LegacyMigrationAdmissionStatus,
  type MigrationBackupFactory,
  type MigrationContext,
  type MigrationDatabaseFactory,
  type MigrationDefinition,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationRunResult,
  type SchemaMigrationErrorCode,
  type SchemaMigrationRunnerDeps,
} from './types';
import { MigrationStateInspector } from './MigrationStateInspector';
import { PersistentMigrationJournalError } from './journal/journal-types';
import { LegacyDetectorError } from './legacy/LegacyDetector';

const SCHEMA_MIGRATIONS_TABLE_SQL = `
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
    validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
    UNIQUE(from_version),
    UNIQUE(to_version),
    CHECK (duration_ms >= 0)
  );
`;

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

function fail(
  code: SchemaMigrationErrorCode,
  message: string,
  options?: { cause?: unknown; attemptId?: string | undefined; backupId?: string | undefined },
): SchemaMigrationError {
  return new SchemaMigrationError(code, message, options);
}

/** Deeply immutable defensive snapshot of exact unversioned-schema admission evidence. */
interface UnversionedAdmissionEvidence {
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

const LEGACY_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function isExactUnversionedAdmission(result: LegacyMigrationAdmissionResult): boolean {
  const recognizedIdentity =
    (result.status === 'LEGACY_V3_2_2' && result.safeReasonCode === 'EXACT_LEGACY_V3_2_2_SCHEMA') ||
    (result.status === 'CURRENT_SELF_MANAGED_UNVERSIONED' &&
      result.safeReasonCode === 'EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA');
  return (
    recognizedIdentity &&
    result.migrationCandidate === true &&
    result.manualActionRequired === false &&
    result.observedUserVersion === 0 &&
    result.historyTableExists === false &&
    typeof result.observedStructuralFingerprint === 'string' &&
    LEGACY_FINGERPRINT_PATTERN.test(result.observedStructuralFingerprint) &&
    Number.isInteger(result.observedTableCount) &&
    result.observedTableCount >= 0 &&
    Number.isInteger(result.observedOwnedIndexCount) &&
    result.observedOwnedIndexCount >= 0
  );
}

function freezeAdmissionEvidence(
  result: LegacyMigrationAdmissionResult,
): UnversionedAdmissionEvidence {
  return Object.freeze({
    status: result.status,
    observedUserVersion: result.observedUserVersion,
    historyTableExists: result.historyTableExists,
    migrationCandidate: result.migrationCandidate,
    manualActionRequired: result.manualActionRequired,
    safeReasonCode: result.safeReasonCode,
    observedTableCount: result.observedTableCount,
    observedOwnedIndexCount: result.observedOwnedIndexCount,
    observedStructuralFingerprint: result.observedStructuralFingerprint,
  });
}

function admissionEvidenceEqual(
  a: UnversionedAdmissionEvidence,
  b: UnversionedAdmissionEvidence,
): boolean {
  return (
    a.status === b.status &&
    a.observedUserVersion === b.observedUserVersion &&
    a.historyTableExists === b.historyTableExists &&
    a.migrationCandidate === b.migrationCandidate &&
    a.manualActionRequired === b.manualActionRequired &&
    a.safeReasonCode === b.safeReasonCode &&
    a.observedTableCount === b.observedTableCount &&
    a.observedOwnedIndexCount === b.observedOwnedIndexCount &&
    a.observedStructuralFingerprint === b.observedStructuralFingerprint
  );
}

/** Validate the migration registry without executing any migration code. */
function validateRegistry(migrations: readonly MigrationDefinition[], targetVersion: number): void {
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw fail('INVALID_CONFIGURATION', 'targetVersion must be a non-negative integer.');
  }
  if (migrations.length === 0) {
    if (targetVersion !== 0) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        'A non-zero targetVersion requires at least one migration.',
      );
    }
    return;
  }
  const ids = new Set<string>();
  const fromVersions = new Set<number>();
  const toVersions = new Set<number>();
  for (const migration of migrations) {
    if (
      typeof migration.id !== 'string' ||
      migration.id.length === 0 ||
      migration.id.includes('\0')
    ) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        'Migration ID must be a non-empty string without NUL.',
      );
    }
    if (ids.has(migration.id)) {
      throw fail('INVALID_MIGRATION_REGISTRY', `Duplicate migration ID: ${migration.id}.`);
    }
    ids.add(migration.id);
    if (typeof migration.description !== 'string' || migration.description.length === 0) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} must have a non-empty description.`,
      );
    }
    if (
      migration.foreignKeyMode !== undefined &&
      migration.foreignKeyMode !== 'DISABLED_DURING_MIGRATION'
    ) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} has an invalid foreignKeyMode.`,
      );
    }
    if (!Number.isInteger(migration.fromVersion) || migration.fromVersion < 0) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} has an invalid fromVersion.`,
      );
    }
    if (!Number.isInteger(migration.toVersion) || migration.toVersion < 0) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} has an invalid toVersion.`,
      );
    }
    if (migration.toVersion !== migration.fromVersion + 1) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} must advance exactly one version.`,
      );
    }
    if (!CHECKSUM_PATTERN.test(migration.checksum)) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} has an invalid checksum.`,
      );
    }
    if (typeof migration.up !== 'function') {
      throw fail('INVALID_MIGRATION_REGISTRY', `Migration ${migration.id} up must be a function.`);
    }
    if (migration.validate !== undefined && typeof migration.validate !== 'function') {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} validate must be a function when provided.`,
      );
    }
    if (
      migration.validateCurrent !== undefined &&
      typeof migration.validateCurrent !== 'function'
    ) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        `Migration ${migration.id} validateCurrent must be a function when provided.`,
      );
    }
    if (fromVersions.has(migration.fromVersion)) {
      throw fail('INVALID_MIGRATION_REGISTRY', `Duplicate fromVersion: ${migration.fromVersion}.`);
    }
    if (toVersions.has(migration.toVersion)) {
      throw fail('INVALID_MIGRATION_REGISTRY', `Duplicate toVersion: ${migration.toVersion}.`);
    }
    fromVersions.add(migration.fromVersion);
    toVersions.add(migration.toVersion);
    if (migration.toVersion > targetVersion) {
      throw fail('INVALID_MIGRATION_REGISTRY', `Migration ${migration.id} exceeds targetVersion.`);
    }
  }
  const sorted = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);
  const first = sorted[0];
  if (!first || first.fromVersion !== 0) {
    throw fail('INVALID_MIGRATION_REGISTRY', 'The migration chain must start at version 0.');
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.fromVersion !== sorted[i - 1]!.toVersion) {
      throw fail(
        'INVALID_MIGRATION_REGISTRY',
        'The migration chain must be contiguous with no gaps or branches.',
      );
    }
  }
  const last = sorted[sorted.length - 1];
  if (!last || last.toVersion !== targetVersion) {
    throw fail('INVALID_MIGRATION_REGISTRY', 'The migration chain must reach targetVersion.');
  }
}

export class SchemaMigrationRunner {
  private readonly migrations: readonly MigrationDefinition[];
  private readonly targetVersion: number;
  private readonly appVersion: string;
  private readonly databaseFactory: MigrationDatabaseFactory;
  private readonly backupFactory: MigrationBackupFactory;
  private readonly journal: MigrationJournalPort;
  private readonly clock: MigrationClock;
  private readonly pathResolver: PathResolverService;
  private readonly busyTimeoutMs: number;
  private readonly migrationsById: ReadonlyMap<string, MigrationDefinition>;
  private readonly inspector: MigrationStateInspector;
  private readonly legacyAdmission: LegacyMigrationAdmission;

  public constructor(deps: SchemaMigrationRunnerDeps) {
    if (typeof deps.appVersion !== 'string' || deps.appVersion.length === 0) {
      throw fail('INVALID_CONFIGURATION', 'appVersion must be a non-empty string.');
    }
    if (!Number.isInteger(deps.targetVersion) || deps.targetVersion < 0) {
      throw fail('INVALID_CONFIGURATION', 'targetVersion must be a non-negative integer.');
    }
    if (!Number.isInteger(deps.busyTimeoutMs) || deps.busyTimeoutMs <= 0) {
      throw fail('INVALID_CONFIGURATION', 'busyTimeoutMs must be a positive integer.');
    }
    validateRegistry(deps.migrations, deps.targetVersion);

    this.migrations = Object.freeze(deps.migrations.map((m) => Object.freeze({ ...m })));
    this.migrationsById = new Map(this.migrations.map((m) => [m.id, m] as const));

    this.targetVersion = deps.targetVersion;
    this.appVersion = deps.appVersion;
    this.databaseFactory = deps.databaseFactory;
    this.backupFactory = deps.backupFactory;
    this.journal = deps.journal;
    this.clock = deps.clock;
    this.pathResolver = deps.pathResolver;
    this.busyTimeoutMs = deps.busyTimeoutMs;
    this.inspector = new MigrationStateInspector(this.migrations, this.targetVersion);
    this.legacyAdmission = deps.legacyAdmission;
  }

  /**
   * Run migrations against the database at `databasePath`. Owns and closes its temporary
   * read/write and read-only connections in every success and failure path. Returns only after
   * all temporary connections are closed.
   */
  public async run(databasePath: string): Promise<MigrationRunResult> {
    this.validateDatabasePath(databasePath);

    let rw: DatabaseSync | undefined;
    let attemptId: string | undefined;
    let backupId: string | undefined;
    let admissionEvidence: UnversionedAdmissionEvidence | undefined;
    let admissionDataVersionBaseline: number | undefined;
    try {
      rw = this.databaseFactory.openReadWrite(databasePath);
      this.applyPragmas(rw);
      this.verifyMainDatabase(rw, databasePath);

      // The inspector is the single source of truth for read-only state interpretation. The
      // preflight decision tree below mirrors the pre-extraction order exactly so that the
      // observable error code for any combined invalid state is unchanged: for a version-zero
      // database the history-table ambiguity is checked before the populated-user-objects check;
      // for a versioned database history shape/content is validated before future-version
      // detection. The inspector performs all reads; the runner only maps issues to typed errors.
      const state = this.inspector.inspect(rw);
      const currentVersion = state.currentVersion;
      const pending = state.pendingMigrations;

      if (currentVersion === 0) {
        if (state.historyTableExists) {
          throw fail(
            'UNVERSIONED_DATABASE_REQUIRES_LEGACY_DETECTION',
            'A version-zero database with an existing history table is ambiguous and requires legacy detection.',
          );
        }
        if (state.isPopulated && pending.length > 0) {
          // The runner owns fresh admission: only an exact allowlisted unversioned identity may
          // continue. The data_version baseline is captured on the runner-owned connection so
          // row-level changes made through another connection are detectable after backup.
          admissionEvidence = this.admitUnversionedDatabase(databasePath);
          admissionDataVersionBaseline = this.readDataVersion(rw);
        }
      } else {
        if (!state.historyTableExists) {
          throw fail(
            'MIGRATION_HISTORY_MISMATCH',
            'A versioned database requires a schema_migrations table.',
          );
        }
        if (!state.historyTableValid) {
          throw fail(
            'MIGRATION_HISTORY_MISMATCH',
            'schema_migrations table has an unexpected shape.',
          );
        }
        if (!state.historyValid) {
          if (state.checksumMismatches.length > 0) {
            throw fail(
              'MIGRATION_CHECKSUM_MISMATCH',
              state.historyIssue ?? 'Checksum mismatch in migration history.',
            );
          }
          throw fail(
            'MIGRATION_HISTORY_MISMATCH',
            state.historyIssue ?? 'Migration history is inconsistent.',
          );
        }
        if (state.futureSchemaVersion) {
          throw fail(
            'FUTURE_SCHEMA_VERSION',
            'The database schema version is newer than the runner target version.',
          );
        }
      }

      if (pending.length === 0) {
        this.validateCurrentTarget(rw, currentVersion);
        return {
          status: 'up-to-date',
          fromVersion: currentVersion,
          toVersion: currentVersion,
          appliedMigrationIds: [],
        };
      }

      try {
        const created = await this.journal.createAttempt({
          fromVersion: currentVersion,
          targetVersion: this.targetVersion,
        });
        attemptId = created.attemptId;
      } catch (error) {
        if (
          error instanceof PersistentMigrationJournalError &&
          (error.code === 'ACTIVE_ATTEMPT_EXISTS' || error.code === 'ATTEMPT_CORRUPT')
        ) {
          throw fail('STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT', error.message, { cause: error });
        }
        throw fail('JOURNAL_WRITE_FAILED', 'Could not create a journal attempt.', { cause: error });
      }
      try {
        await this.journal.transition(attemptId, 'PREFLIGHT_VALIDATED');
      } catch (error) {
        await this.safeMarkFailed(attemptId, 'JOURNAL_WRITE_FAILED', error, backupId);
        throw fail('JOURNAL_WRITE_FAILED', 'Could not record PREFLIGHT_VALIDATED.', {
          cause: error,
          attemptId,
          backupId,
        });
      }

      const canonicalPath = this.pathResolver.normalizeAbsolutePath(databasePath);
      const backupPort = this.backupFactory.create({
        sourceDb: rw,
        sourceDatabasePath: canonicalPath,
        sourceVersion: currentVersion,
      });
      const reason = `SCHEMA_UPGRADE_${currentVersion}_TO_${this.targetVersion}`;
      const migrationId =
        pending.length === 1
          ? pending[0]!.id
          : `UPGRADE_${currentVersion}_TO_${this.targetVersion}`;
      try {
        const backupResult = await backupPort.createVerifiedBackup({ reason, migrationId });
        backupId = backupResult.backupId;
        await backupPort.verifyBackup(backupId);
      } catch (error) {
        await this.safeMarkFailed(attemptId, 'BACKUP_FAILED', error, backupId);
        throw fail('BACKUP_FAILED', 'Verified backup creation or verification failed.', {
          cause: error,
          attemptId,
          backupId,
        });
      }
      try {
        await this.journal.transition(attemptId, 'BACKUP_VERIFIED', { backupId });
      } catch (error) {
        await this.safeMarkFailed(attemptId, 'JOURNAL_WRITE_FAILED', error, backupId);
        throw fail('JOURNAL_WRITE_FAILED', 'Could not record BACKUP_VERIFIED.', {
          cause: error,
          attemptId,
          backupId,
        });
      }

      if (admissionEvidence !== undefined) {
        try {
          this.revalidateAdmissionAfterBackup(
            databasePath,
            rw,
            admissionEvidence,
            admissionDataVersionBaseline!,
          );
        } catch (error) {
          if (
            error instanceof SchemaMigrationError &&
            (error.code === 'LEGACY_STATE_CHANGED_AFTER_BACKUP' ||
              error.code === 'LEGACY_DETECTOR_UNAVAILABLE')
          ) {
            await this.safeMarkFailed(attemptId, error.code, error, backupId);
          }
          throw error;
        }
      }

      const applied: string[] = [];
      // The inspector returns callback-free identity records for the pending chain. The runner
      // maps each identity back to its own frozen execution registry to access up()/validate()
      // and descriptive metadata. Identity ids always exist in the registry because the inspector
      // derived the pending chain from this same registry, so the lookup is guaranteed.
      for (const identity of pending) {
        const migration = this.migrationsById.get(identity.id)!;
        const startedAt = this.clock.now();
        const startedMs = startedAt.getTime();
        const rebuildsReferencedTable = migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION';
        try {
          if (rebuildsReferencedTable) {
            rw.exec('PRAGMA foreign_keys = OFF');
            const disabled = rw.prepare('PRAGMA foreign_keys').get() as
              { foreign_keys?: number } | undefined;
            if (disabled?.foreign_keys !== 0) {
              throw fail(
                'MIGRATION_EXECUTION_FAILED',
                `Migration ${migration.id} could not enter its declared foreign-key rebuild mode.`,
                { attemptId, backupId },
              );
            }
          }
          try {
            rw.exec('BEGIN IMMEDIATE');
          } catch (error) {
            throw fail('MIGRATION_LOCK_FAILED', 'Could not acquire the migration write lock.', {
              cause: error,
              attemptId,
              backupId,
            });
          }
          if (admissionEvidence !== undefined && applied.length === 0) {
            // Final locked data-version gate: with the write lock held, confirm no other
            // connection changed the database since the verified backup. A difference rolls
            // back before TRANSACTION_STARTED and before any migration callback.
            const lockedDataVersion = this.readDataVersion(rw);
            if (lockedDataVersion !== admissionDataVersionBaseline) {
              throw fail(
                'LEGACY_STATE_CHANGED_AFTER_BACKUP',
                'The database changed after the verified backup.',
                {
                  attemptId,
                  backupId,
                },
              );
            }
          }
          try {
            await this.journal.transition(attemptId, 'TRANSACTION_STARTED', {
              migrationId: migration.id,
              fromVersion: migration.fromVersion,
              toVersion: migration.toVersion,
            });
          } catch (error) {
            throw fail('JOURNAL_WRITE_FAILED', 'Could not record TRANSACTION_STARTED.', {
              cause: error,
              attemptId,
              backupId,
            });
          }
          this.ensureHistoryTable(rw);
          const inTxVersion = this.readUserVersion(rw);
          if (inTxVersion !== migration.fromVersion) {
            throw fail(
              'MIGRATION_HISTORY_MISMATCH',
              'In-transaction user_version does not match the migration fromVersion.',
              {
                attemptId,
                backupId,
              },
            );
          }
          const context: MigrationContext = {
            database: rw,
            migrationId: migration.id,
            fromVersion: migration.fromVersion,
            toVersion: migration.toVersion,
            clock: this.clock,
          };
          try {
            migration.up(context);
          } catch (error) {
            throw fail('MIGRATION_EXECUTION_FAILED', `Migration ${migration.id} up() failed.`, {
              cause: error,
              attemptId,
              backupId,
            });
          }
          try {
            migration.validate?.(context);
          } catch (error) {
            throw fail(
              'MIGRATION_VALIDATION_FAILED',
              `Migration ${migration.id} validate() failed.`,
              {
                cause: error,
                attemptId,
                backupId,
              },
            );
          }
          const completedAt = this.clock.now();
          const completedMs = completedAt.getTime();
          if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) {
            throw fail(
              'MIGRATION_EXECUTION_FAILED',
              'Migration ' + migration.id + ' produced an invalid timestamp.',
            );
          }
          const durationMs = completedMs - startedMs;
          if (durationMs < 0) {
            throw fail(
              'MIGRATION_EXECUTION_FAILED',
              'Migration ' + migration.id + ' produced a negative duration (clock moved backward).',
            );
          }
          try {
            this.insertHistoryRow(rw, migration, backupId, startedAt, completedAt, durationMs);
          } catch (error) {
            throw fail(
              'MIGRATION_EXECUTION_FAILED',
              `History insertion failed for ${migration.id}.`,
              {
                cause: error,
                attemptId,
                backupId,
              },
            );
          }
          try {
            // SQLite does not support binding PRAGMA values, so the validated integer is used directly.
            rw.exec(`PRAGMA user_version = ${migration.toVersion}`);
          } catch (error) {
            throw fail(
              'MIGRATION_EXECUTION_FAILED',
              `user_version update failed for ${migration.id}.`,
              {
                cause: error,
                attemptId,
                backupId,
              },
            );
          }
          const confirmed = this.readUserVersion(rw);
          if (confirmed !== migration.toVersion) {
            throw fail(
              'MIGRATION_HISTORY_MISMATCH',
              'user_version was not updated to the expected value.',
              {
                attemptId,
                backupId,
              },
            );
          }
          try {
            rw.exec('COMMIT');
          } catch (commitError) {
            try {
              rw.exec('ROLLBACK');
            } catch {
              // Best-effort rollback; the original commit failure is preserved below.
            }
            throw fail('MIGRATION_COMMIT_FAILED', `Commit failed for ${migration.id}.`, {
              cause: commitError,
              attemptId,
              backupId,
            });
          }
          if (rebuildsReferencedTable) {
            rw.exec('PRAGMA foreign_keys = ON');
            const violations = rw.prepare('PRAGMA foreign_key_check').all();
            if (violations.length > 0) {
              throw fail(
                'MIGRATION_VALIDATION_FAILED',
                `Migration ${migration.id} left foreign-key violations after table rebuild.`,
                { attemptId, backupId },
              );
            }
          }
          try {
            await this.journal.transition(attemptId, 'COMMITTED', {
              migrationId: migration.id,
              fromVersion: migration.fromVersion,
              toVersion: migration.toVersion,
              durationMs,
            });
          } catch (error) {
            throw fail('JOURNAL_WRITE_FAILED', `Could not record COMMITTED for ${migration.id}.`, {
              cause: error,
              attemptId,
              backupId,
            });
          }
          applied.push(migration.id);
        } catch (stepError) {
          try {
            rw.exec('ROLLBACK');
          } catch {
            // No active transaction, or already committed/rolled back.
          }
          if (rebuildsReferencedTable) {
            try {
              rw.exec('PRAGMA foreign_keys = ON');
            } catch {
              // The connection is closed by the outer finally; preserve the original failure.
            }
          }
          const code =
            stepError instanceof SchemaMigrationError
              ? stepError.code
              : 'MIGRATION_EXECUTION_FAILED';
          await this.safeMarkFailed(attemptId, code, stepError, backupId);
          throw stepError;
        }
      }

      // Close the read/write connection before opening the read-only validation connection.
      try {
        rw.close();
      } catch {
        // Best-effort close.
      }
      rw = undefined;

      let ro: DatabaseSync | undefined;
      try {
        ro = this.databaseFactory.openReadOnly(databasePath);
        this.validatePostCommit(ro, attemptId, backupId);
      } catch (error) {
        if (attemptId) {
          await this.safeMarkFailed(attemptId, 'POST_MIGRATION_VALIDATION_FAILED', error, backupId);
        }
        throw error;
      } finally {
        if (ro) {
          try {
            ro.close();
          } catch {
            // Best-effort close.
          }
        }
      }

      try {
        await this.journal.transition(attemptId, 'POST_VALIDATION_PASSED');
      } catch (error) {
        await this.safeMarkFailed(attemptId, 'JOURNAL_WRITE_FAILED', error, backupId);
        throw fail('JOURNAL_WRITE_FAILED', 'Could not record POST_VALIDATION_PASSED.', {
          cause: error,
          attemptId,
          backupId,
        });
      }
      try {
        await this.journal.transition(attemptId, 'SUCCEEDED');
      } catch (error) {
        await this.safeMarkFailed(attemptId, 'JOURNAL_WRITE_FAILED', error, backupId);
        throw fail('JOURNAL_WRITE_FAILED', 'Could not record SUCCEEDED.', {
          cause: error,
          attemptId,
          backupId,
        });
      }

      return {
        status: 'migrated',
        fromVersion: currentVersion,
        toVersion: this.targetVersion,
        appliedMigrationIds: applied,
        backupId,
        attemptId,
      };
    } finally {
      if (rw) {
        try {
          rw.close();
        } catch {
          // Best-effort close on any failure path.
        }
      }
    }
  }

  private validateDatabasePath(databasePath: string): void {
    if (typeof databasePath !== 'string' || databasePath.length === 0) {
      throw fail('INVALID_DATABASE_PATH', 'Database path must be a non-empty string.');
    }
    if (databasePath.includes('\0')) {
      throw fail('INVALID_DATABASE_PATH', 'Database path must not contain NUL characters.');
    }
    if (databasePath === ':memory:') {
      throw fail(
        'INVALID_DATABASE_PATH',
        'In-memory databases are not supported by the migration runner.',
      );
    }
    if (!winPath.isAbsolute(databasePath)) {
      throw fail('INVALID_DATABASE_PATH', 'Database path must be absolute.');
    }
  }

  private applyPragmas(db: DatabaseSync): void {
    db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    db.exec('PRAGMA foreign_keys = ON');
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined;
    if (!row || row.foreign_keys !== 1) {
      throw fail('SOURCE_DATABASE_UNAVAILABLE', 'Foreign-key enforcement could not be enabled.');
    }
  }

  private verifyMainDatabase(db: DatabaseSync, databasePath: string): void {
    let rows: { name: string; file: string }[];
    try {
      rows = db.prepare('PRAGMA database_list').all() as { name: string; file: string }[];
    } catch (error) {
      throw fail('SOURCE_DATABASE_UNAVAILABLE', 'Could not read PRAGMA database_list.', {
        cause: error,
      });
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
    if (
      this.pathResolver.canonicalizeForComparison(main.file) !==
      this.pathResolver.canonicalizeForComparison(databasePath)
    ) {
      throw fail(
        'SOURCE_DATABASE_UNAVAILABLE',
        'The source main database path does not match the configured path.',
      );
    }
  }

  private readUserVersion(db: DatabaseSync): number {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  }

  private readDataVersion(db: DatabaseSync): number {
    const row = db.prepare('PRAGMA data_version').get() as { data_version?: number } | undefined;
    const value = row?.data_version;
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw fail('SOURCE_DATABASE_UNAVAILABLE', 'Could not read a valid data_version.');
    }
    return value as number;
  }

  private runLegacyAdmission(databasePath: string): LegacyMigrationAdmissionResult {
    try {
      return this.legacyAdmission.inspect(databasePath);
    } catch (error) {
      if (error instanceof LegacyDetectorError) {
        throw fail('LEGACY_DETECTOR_UNAVAILABLE', 'Legacy detection is unavailable.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  private admitUnversionedDatabase(databasePath: string): UnversionedAdmissionEvidence {
    const result = this.runLegacyAdmission(databasePath);
    if (!isExactUnversionedAdmission(result)) {
      throw fail(
        'LEGACY_ADMISSION_REJECTED',
        'The version-zero database is not an exact recognized unversioned product schema: ' +
          result.safeReasonCode,
      );
    }
    return freezeAdmissionEvidence(result);
  }

  private revalidateAdmissionAfterBackup(
    databasePath: string,
    rw: DatabaseSync,
    expected: UnversionedAdmissionEvidence,
    dataVersionBaseline: number,
  ): void {
    const state = this.inspector.inspect(rw);
    if (state.currentVersion !== 0 || state.isEmpty || state.historyTableExists) {
      throw fail(
        'LEGACY_STATE_CHANGED_AFTER_BACKUP',
        'The database is no longer an unversioned populated admitted database.',
      );
    }
    const freshResult = this.runLegacyAdmission(databasePath);
    const fresh = freezeAdmissionEvidence(freshResult);
    if (!isExactUnversionedAdmission(freshResult) || !admissionEvidenceEqual(expected, fresh)) {
      throw fail(
        'LEGACY_STATE_CHANGED_AFTER_BACKUP',
        'Legacy admission evidence changed after the verified backup.',
      );
    }
    const dataVersion = this.readDataVersion(rw);
    if (dataVersion !== dataVersionBaseline) {
      throw fail(
        'LEGACY_STATE_CHANGED_AFTER_BACKUP',
        'The database changed after the verified backup.',
      );
    }
  }

  private ensureHistoryTable(db: DatabaseSync): void {
    db.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
  }

  private insertHistoryRow(
    db: DatabaseSync,
    migration: MigrationDefinition,
    backupId: string,
    startedAt: Date,
    completedAt: Date,
    durationMs: number,
  ): void {
    db.prepare(
      `INSERT INTO schema_migrations
          (migration_id, from_version, to_version, checksum, description, app_version, backup_id,
           started_at, completed_at, duration_ms, validation_result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')`,
    ).run(
      migration.id,
      migration.fromVersion,
      migration.toVersion,
      migration.checksum,
      migration.description,
      this.appVersion,
      backupId,
      startedAt.toISOString(),
      completedAt.toISOString(),
      durationMs,
    );
  }

  private validatePostCommit(ro: DatabaseSync, attemptId: string, backupId: string): void {
    const integrity = ro.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw fail(
        'POST_MIGRATION_VALIDATION_FAILED',
        'Post-commit integrity_check did not return ok.',
        {
          attemptId,
          backupId,
        },
      );
    }

    const view = this.inspector.inspect(ro);

    if (!view.atTarget) {
      throw fail(
        'POST_MIGRATION_VALIDATION_FAILED',
        'Post-commit user_version does not match targetVersion.',
        {
          attemptId,
          backupId,
        },
      );
    }

    if (!view.historyValid) {
      throw fail(
        'POST_MIGRATION_VALIDATION_FAILED',
        view.historyIssue ?? 'Post-commit history validation failed.',
        {
          attemptId,
          backupId,
        },
      );
    }

    this.validateCurrentTarget(ro, view.currentVersion, { attemptId, backupId });
  }

  private validateCurrentTarget(
    database: DatabaseSync,
    currentVersion: number,
    runIdentity?: { attemptId: string; backupId: string },
  ): void {
    if (currentVersion !== this.targetVersion) return;
    const targetMigration = this.migrations.find(
      (migration) => migration.toVersion === this.targetVersion,
    );
    if (!targetMigration?.validateCurrent) return;
    try {
      targetMigration.validateCurrent(database);
    } catch (error) {
      throw fail('POST_MIGRATION_VALIDATION_FAILED', 'Current target schema validation failed.', {
        cause: error,
        attemptId: runIdentity?.attemptId,
        backupId: runIdentity?.backupId,
      });
    }
  }

  /** Mark the attempt failed, preserving the original error; if the journal also fails, preserve both. */
  private async safeMarkFailed(
    attemptId: string,
    code: SchemaMigrationErrorCode,
    originalError: unknown,
    backupId: string | undefined,
  ): Promise<void> {
    try {
      await this.journal.markFailed(attemptId, {
        code,
        message: originalError instanceof Error ? originalError.message : String(originalError),
      });
    } catch (journalError) {
      const baseMessage =
        originalError instanceof Error ? originalError.message : String(originalError);
      const journalMessage =
        journalError instanceof Error ? journalError.message : String(journalError);
      throw fail(code, `${baseMessage} (journal markFailed also failed: ${journalMessage})`, {
        cause: originalError,
        attemptId,
        backupId,
      });
    }
  }
}
