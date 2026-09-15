import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackupManager, type BackupFunction } from '../../backup/BackupManager';
import { PathResolverService } from '../../path/PathResolverService';
import { DatabaseStartupLock } from '../../startup/DatabaseStartupLock';
import {
  PRODUCTION_LEGACY_PENDING_RESTORE_FILE,
  PRODUCTION_PENDING_RESTORE_REQUEST_FILE,
  PRODUCTION_APP_VERSION,
} from '../../startup/createPersonalProductionStartup';
import { inspectProductionPendingRestore } from '../../startup/ProductionPendingRestoreGate';
import { ProductionMigrationStartupGate } from '../../startup/ProductionMigrationStartupGate';
import type {
  DatabaseStartupLockPort,
  MigrationRunnerPort,
  MigrationStartupGatePort,
} from '../../startup/startup-types';
import { SchemaMigrationRunner } from '../SchemaMigrationRunner';
import { MigrationStateInspector } from '../MigrationStateInspector';
import { LegacyDetector } from '../legacy/LegacyDetector';
import { PersistentMigrationJournal } from '../journal/PersistentMigrationJournal';
import { JOURNAL_FORMAT_VERSION } from '../journal/journal-types';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_V9_MIGRATION_ID,
  PRODUCTION_V10_MIGRATION_ID,
} from '../registry/production-migration-registry';

const LIVE_V9_V10_TARGET_VERSION = 10 as const;
import {
  SchemaMigrationError,
  type MigrationBackupFactory,
  type MigrationClock,
  type MigrationDatabaseFactory,
  type MigrationDefinition,
} from '../types';
import {
  CONTROLLED_LEGACY_REVIEW_IDS,
  assertControlledPreMigrationManifest,
  buildLiveV9V10PreservationManifest,
  preservationManifestsEqual,
  type LiveV9V10PreservationManifest,
} from './LiveV9V10PreservationManifest';

export type LiveV9V10Mode = 'PLAN' | 'APPLY';

export type LiveV9V10ResultStatus =
  | 'PLAN_READY'
  | 'PLAN_BLOCKED'
  | 'APPLY_BLOCKED'
  | 'MIGRATION_APPLIED_AND_VERIFIED'
  | 'ALREADY_MIGRATED'
  | 'ALREADY_V10_STATE_MISMATCH'
  | 'BACKUP_FAILED'
  | 'SOURCE_CHANGED_AFTER_BACKUP'
  | 'MIGRATION_FAILED_ROLLED_BACK'
  | 'MIGRATION_STATE_AMBIGUOUS'
  | 'POST_MIGRATION_VERIFICATION_FAILED'
  | 'LOCK_UNAVAILABLE'
  | 'JOURNAL_BLOCKED'
  | 'RESTORE_PENDING';

export type LiveV9V10ReasonCode =
  | 'READY'
  | 'INVALID_DATABASE_PATH'
  | 'SOURCE_DATABASE_UNAVAILABLE'
  | 'INTEGRITY_CHECK_FAILED'
  | 'FOREIGN_KEY_CHECK_FAILED'
  | 'WRONG_SOURCE_VERSION'
  | 'ALREADY_MIGRATED'
  | 'ALREADY_V10_STATE_MISMATCH'
  | 'MIGRATION_HISTORY_MISMATCH'
  | 'PENDING_MIGRATION_MISMATCH'
  | 'PARTIAL_V10_SCHEMA_STATE'
  | 'GOLDEN_IDENTITY_MISMATCH'
  | 'PROJECT_COUNT_MISMATCH'
  | 'PRESERVATION_MANIFEST_MISMATCH'
  | 'PENDING_RESTORE'
  | 'UNRESOLVED_MIGRATION_ATTEMPT'
  | 'LOCK_UNAVAILABLE'
  | 'BACKUP_FAILED'
  | 'SOURCE_CHANGED_AFTER_BACKUP'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_STATE_AMBIGUOUS'
  | 'POST_MIGRATION_VERIFICATION_FAILED';

export interface LiveV9V10Readiness {
  readonly databasePath: string;
  readonly currentVersion: number;
  readonly targetVersion: 10;
  readonly migrationId: typeof PRODUCTION_V10_MIGRATION_ID;
  readonly integrityCheck: 'ok';
  readonly foreignKeyViolations: 0;
  readonly latestMigrationId: typeof PRODUCTION_V9_MIGRATION_ID;
  readonly pendingMigrationIds: readonly string[];
  readonly projectCount: number;
  readonly goldenReviewRootIds: readonly string[];
  readonly expectedBackupRoot: string;
  readonly backupReason: 'SCHEMA_UPGRADE_9_TO_10';
  readonly operatorWriterPrecondition: string;
  readonly manifest: LiveV9V10PreservationManifest;
}

export interface LiveV9V10Result {
  readonly mode: LiveV9V10Mode;
  readonly status: LiveV9V10ResultStatus;
  readonly reasonCode: LiveV9V10ReasonCode;
  readonly message: string;
  readonly readiness?: LiveV9V10Readiness | undefined;
  readonly backupId?: string | undefined;
  readonly attemptId?: string | undefined;
}

interface ExactPathGuard {
  validate(databasePath: string): string;
}

interface LiveV9V10EntrypointDeps {
  readonly databasePath: string;
  readonly backupRoot: string;
  readonly pathGuard: ExactPathGuard;
  readonly lock: DatabaseStartupLockPort;
  readonly inspectPendingRestore: () => 'NO_PENDING_RESTORE' | 'PENDING_RESTORE';
  readonly migrationGate: MigrationStartupGatePort;
  readonly migrations: readonly MigrationDefinition[];
  readonly createRunner: (manifest: LiveV9V10PreservationManifest) => MigrationRunnerPort;
  readonly openReadOnly: (databasePath: string) => DatabaseSync;
  readonly afterMigrationFailureForTest?: ((databasePath: string) => void) | undefined;
}

export interface LiveV9V10FactoryOptions {
  readonly databasePath: string;
  readonly expectedDatabasePath: string;
  readonly clock?: MigrationClock | undefined;
  readonly backupIdGenerator?: { generate(): string } | undefined;
  readonly journalIdGenerator?: { generate(): string } | undefined;
  readonly backupFunction?: BackupFunction | undefined;
  readonly lock?: DatabaseStartupLockPort | undefined;
  /** Test-only seam for transaction-failure coverage. Production callers must omit it. */
  readonly migrations?: readonly MigrationDefinition[] | undefined;
  /** Test-only non-cooperating-writer seam. Production callers must omit it. */
  readonly afterBackupVerifiedForTest?: ((database: DatabaseSync) => void) | undefined;
  /** Test-only contradictory post-failure-state seam. Production callers must omit it. */
  readonly afterMigrationFailureForTest?: ((databasePath: string) => void) | undefined;
}

class GuardBlockedError extends Error {
  public constructor(
    public readonly reasonCode: LiveV9V10ReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'GuardBlockedError';
  }
}

class SourceChangedAfterBackupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SourceChangedAfterBackupError';
  }
}

function blocked(reasonCode: LiveV9V10ReasonCode, message: string): never {
  throw new GuardBlockedError(reasonCode, message);
}

export class ExactLiveDatabasePathGuard implements ExactPathGuard {
  private readonly expectedPath: string;

  public constructor(expectedDatabasePath: string) {
    if (!path.isAbsolute(expectedDatabasePath)) {
      throw new Error('The expected database path must be absolute.');
    }
    this.expectedPath = path.resolve(expectedDatabasePath);
  }

  public validate(databasePath: string): string {
    if (!path.isAbsolute(databasePath)) {
      blocked('INVALID_DATABASE_PATH', 'An explicit absolute database path is required.');
    }
    const supplied = path.resolve(databasePath);
    if (supplied.toLowerCase() !== this.expectedPath.toLowerCase()) {
      blocked('INVALID_DATABASE_PATH', 'The database path is not the approved exact target.');
    }
    if (!existsSync(supplied)) {
      blocked('SOURCE_DATABASE_UNAVAILABLE', 'The approved database file does not exist.');
    }
    const fileStat = lstatSync(supplied);
    const parentStat = lstatSync(path.dirname(supplied));
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || parentStat.isSymbolicLink()) {
      blocked('INVALID_DATABASE_PATH', 'The database path contains an unsafe filesystem alias.');
    }
    const suppliedReal = realpathSync.native(supplied);
    const expectedReal = realpathSync.native(this.expectedPath);
    if (suppliedReal.toLowerCase() !== expectedReal.toLowerCase()) {
      blocked('INVALID_DATABASE_PATH', 'The canonical database path does not match the target.');
    }
    return suppliedReal;
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
}

function verifyIntegrityAndForeignKeys(db: DatabaseSync): void {
  const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    blocked('INTEGRITY_CHECK_FAILED', 'PRAGMA integrity_check did not return exactly ok.');
  }
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length !== 0) {
    blocked('FOREIGN_KEY_CHECK_FAILED', 'PRAGMA foreign_key_check found violations.');
  }
}

const V10_COLUMNS = Object.freeze([
  'origin',
  'author_id',
  'author_name_snapshot',
  'author_role_snapshot',
  'luminaire_id',
]);
const V10_TABLES = Object.freeze(['project_review_replies', 'project_review_attachments']);

function assertExpectedV9Structure(db: DatabaseSync): void {
  const columns = tableColumns(db, 'project_review_items');
  const presentColumns = V10_COLUMNS.filter((column) => columns.has(column));
  const presentTables = V10_TABLES.filter((table) => tableExists(db, table));
  if (presentColumns.length !== 0 || presentTables.length !== 0) {
    blocked(
      'PARTIAL_V10_SCHEMA_STATE',
      'Version 9 contains partial or complete version 10 schema authority.',
    );
  }
}

function assertExpectedV10Structure(db: DatabaseSync): void {
  const columns = tableColumns(db, 'project_review_items');
  if (!V10_COLUMNS.every((column) => columns.has(column))) {
    blocked('ALREADY_V10_STATE_MISMATCH', 'One or more required v10 Review columns are missing.');
  }
  if (!V10_TABLES.every((table) => tableExists(db, table))) {
    blocked('ALREADY_V10_STATE_MISMATCH', 'One or more required v10 Comments tables are missing.');
  }
}

function assertLegacyEnrichmentNull(db: DatabaseSync, projectId: string): void {
  const enrichmentRows = db
    .prepare(
      `SELECT id, origin, author_id, author_name_snapshot, author_role_snapshot, luminaire_id
         FROM project_review_items
        WHERE project_id = ?
        ORDER BY id`,
    )
    .all(projectId) as Array<Record<string, string | null>>;
  if (
    enrichmentRows.length !== CONTROLLED_LEGACY_REVIEW_IDS.length ||
    enrichmentRows.some((row, index) => {
      return (
        row.id !== CONTROLLED_LEGACY_REVIEW_IDS[index] ||
        row.origin !== null ||
        row.author_id !== null ||
        row.author_name_snapshot !== null ||
        row.author_role_snapshot !== null ||
        row.luminaire_id !== null
      );
    })
  ) {
    blocked(
      'ALREADY_V10_STATE_MISMATCH',
      'Legacy Review identity or enrichment authority does not match the controlled baseline.',
    );
  }
}

function inspectControlledV10State(
  db: DatabaseSync,
  migrations: readonly MigrationDefinition[],
): LiveV9V10PreservationManifest {
  verifyIntegrityAndForeignKeys(db);
  const state = new MigrationStateInspector(migrations, LIVE_V9_V10_TARGET_VERSION).inspect(db);
  const v10Rows = state.historyRows.filter(
    (row) => row.migration_id === PRODUCTION_V10_MIGRATION_ID,
  );
  const latest = state.historyRows.at(-1);
  if (
    state.currentVersion !== 10 ||
    !state.atTarget ||
    !state.historyTableExists ||
    !state.historyTableValid ||
    !state.historyValid ||
    state.pendingMigrations.length !== 0 ||
    v10Rows.length !== 1 ||
    latest?.migration_id !== PRODUCTION_V10_MIGRATION_ID ||
    latest.to_version !== 10
  ) {
    blocked(
      'ALREADY_V10_STATE_MISMATCH',
      'Schema version 10 migration history is incomplete or contradictory.',
    );
  }
  assertExpectedV10Structure(db);

  let manifest: LiveV9V10PreservationManifest;
  try {
    manifest = buildLiveV9V10PreservationManifest(db);
    assertControlledPreMigrationManifest(manifest);
  } catch (error) {
    blocked(
      'ALREADY_V10_STATE_MISMATCH',
      error instanceof Error ? error.message : 'The controlled v10 business baseline is invalid.',
    );
  }
  assertLegacyEnrichmentNull(db, manifest.goldenProject.id);
  return manifest;
}

function inspectV9Source(
  db: DatabaseSync,
  databasePath: string,
  backupRoot: string,
  migrations: readonly MigrationDefinition[],
): LiveV9V10Readiness {
  verifyIntegrityAndForeignKeys(db);
  const inspector = new MigrationStateInspector(migrations, LIVE_V9_V10_TARGET_VERSION);
  const state = inspector.inspect(db);
  if (state.currentVersion !== 9) {
    blocked('WRONG_SOURCE_VERSION', 'The controlled migration requires source schema version 9.');
  }
  if (!state.historyTableExists || !state.historyTableValid || !state.historyValid) {
    blocked('MIGRATION_HISTORY_MISMATCH', 'The migration history does not match schema version 9.');
  }
  const latest = state.historyRows.at(-1);
  if (latest?.migration_id !== PRODUCTION_V9_MIGRATION_ID) {
    blocked('MIGRATION_HISTORY_MISMATCH', 'The latest applied migration is not the v9 authority.');
  }
  if (state.historyRows.some((row) => row.migration_id === PRODUCTION_V10_MIGRATION_ID)) {
    blocked('MIGRATION_HISTORY_MISMATCH', 'The v10 migration is already recorded unexpectedly.');
  }
  if (
    state.pendingMigrations.length !== 1 ||
    state.pendingMigrations[0]?.id !== PRODUCTION_V10_MIGRATION_ID ||
    state.pendingMigrations[0]?.fromVersion !== 9 ||
    state.pendingMigrations[0]?.toVersion !== 10
  ) {
    blocked('PENDING_MIGRATION_MISMATCH', 'The registry does not expose exactly the 9 to 10 path.');
  }
  assertExpectedV9Structure(db);

  let manifest: LiveV9V10PreservationManifest;
  try {
    manifest = buildLiveV9V10PreservationManifest(db);
    assertControlledPreMigrationManifest(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The preservation manifest failed.';
    if (message.includes('project-count')) blocked('PROJECT_COUNT_MISMATCH', message);
    blocked('GOLDEN_IDENTITY_MISMATCH', message);
  }

  return Object.freeze({
    databasePath,
    currentVersion: 9,
    targetVersion: LIVE_V9_V10_TARGET_VERSION,
    migrationId: PRODUCTION_V10_MIGRATION_ID,
    integrityCheck: 'ok',
    foreignKeyViolations: 0,
    latestMigrationId: PRODUCTION_V9_MIGRATION_ID,
    pendingMigrationIds: Object.freeze(state.pendingMigrations.map((migration) => migration.id)),
    projectCount: manifest.projectCount,
    goldenReviewRootIds: Object.freeze(manifest.reviews.map((review) => review.id)),
    expectedBackupRoot: backupRoot,
    backupReason: 'SCHEMA_UPGRADE_9_TO_10',
    operatorWriterPrecondition:
      'All non-cooperating SQLite writers must be closed by the operator before APPLY.',
    manifest,
  });
}

function inspectControlledSource(
  db: DatabaseSync,
  databasePath: string,
  backupRoot: string,
  migrations: readonly MigrationDefinition[],
): LiveV9V10Readiness {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  if (version === 10) {
    try {
      inspectControlledV10State(db, migrations);
    } catch (error) {
      blocked(
        'ALREADY_V10_STATE_MISMATCH',
        error instanceof Error
          ? error.message
          : 'The existing schema-v10 state does not match the controlled target.',
      );
    }
    blocked('ALREADY_MIGRATED', 'The complete controlled schema-v10 state is already applied.');
  }
  return inspectV9Source(db, databasePath, backupRoot, migrations);
}

function assertPostMigration(
  db: DatabaseSync,
  migrations: readonly MigrationDefinition[],
  before: LiveV9V10PreservationManifest,
): void {
  let after: LiveV9V10PreservationManifest;
  try {
    after = inspectControlledV10State(db, migrations);
  } catch (error) {
    throw new GuardBlockedError(
      'POST_MIGRATION_VERIFICATION_FAILED',
      error instanceof Error ? error.message : 'The post-migration manifest could not be built.',
    );
  }
  if (!preservationManifestsEqual(before, after)) {
    blocked(
      'POST_MIGRATION_VERIFICATION_FAILED',
      'The post-migration business manifest differs from the pre-migration manifest.',
    );
  }
}

function openReadOnly(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA query_only = ON');
  return db;
}

function databaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(databasePath: string): DatabaseSync {
      return new DatabaseSync(databasePath);
    },
    openReadOnly,
  };
}

function result(
  mode: LiveV9V10Mode,
  status: LiveV9V10ResultStatus,
  reasonCode: LiveV9V10ReasonCode,
  message: string,
  details?: Pick<LiveV9V10Result, 'readiness' | 'backupId' | 'attemptId'>,
): LiveV9V10Result {
  return Object.freeze({ mode, status, reasonCode, message, ...details });
}

export class LiveV9V10MigrationEntrypoint {
  public constructor(private readonly deps: LiveV9V10EntrypointDeps) {}

  public async run(mode: LiveV9V10Mode): Promise<LiveV9V10Result> {
    return mode === 'PLAN' ? this.plan() : this.apply();
  }

  private inspectRestoreAndJournal(mode: LiveV9V10Mode): Promise<LiveV9V10Result | null> {
    if (this.deps.inspectPendingRestore() !== 'NO_PENDING_RESTORE') {
      return Promise.resolve(
        result(mode, 'RESTORE_PENDING', 'PENDING_RESTORE', 'A pending restore blocks migration.'),
      );
    }
    return this.deps.migrationGate
      .inspect()
      .then((gate) =>
        gate.status === 'ALLOWED'
          ? null
          : result(
              mode,
              'JOURNAL_BLOCKED',
              'UNRESOLVED_MIGRATION_ATTEMPT',
              'Migration journal reconciliation is required.',
            ),
      );
  }

  private inspectSource(): LiveV9V10Readiness {
    const canonicalPath = this.deps.pathGuard.validate(this.deps.databasePath);
    const db = this.deps.openReadOnly(canonicalPath);
    try {
      return inspectControlledSource(db, canonicalPath, this.deps.backupRoot, this.deps.migrations);
    } finally {
      db.close();
    }
  }

  private async plan(): Promise<LiveV9V10Result> {
    try {
      this.deps.pathGuard.validate(this.deps.databasePath);
      const gateResult = await this.inspectRestoreAndJournal('PLAN');
      if (gateResult) return gateResult;
      const readiness = this.inspectSource();
      return result('PLAN', 'PLAN_READY', 'READY', 'All read-only migration guards passed.', {
        readiness,
      });
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        if (error.reasonCode === 'ALREADY_MIGRATED') {
          return result('PLAN', 'ALREADY_MIGRATED', error.reasonCode, error.message);
        }
        if (error.reasonCode === 'ALREADY_V10_STATE_MISMATCH') {
          return result('PLAN', 'ALREADY_V10_STATE_MISMATCH', error.reasonCode, error.message);
        }
        return result('PLAN', 'PLAN_BLOCKED', error.reasonCode, error.message);
      }
      return result(
        'PLAN',
        'PLAN_BLOCKED',
        'SOURCE_DATABASE_UNAVAILABLE',
        error instanceof Error ? error.message : 'The source database could not be inspected.',
      );
    }
  }

  private async apply(): Promise<LiveV9V10Result> {
    let lease;
    try {
      const canonicalPath = this.deps.pathGuard.validate(this.deps.databasePath);
      lease = this.deps.lock.acquire(canonicalPath);
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        return result('APPLY', 'APPLY_BLOCKED', error.reasonCode, error.message);
      }
      return result(
        'APPLY',
        'LOCK_UNAVAILABLE',
        'LOCK_UNAVAILABLE',
        'The startup lock is unavailable.',
      );
    }

    let applyResult: LiveV9V10Result;
    let releaseFailed = false;
    let completedBackupId: string | undefined;
    let completedAttemptId: string | undefined;
    let preMigrationManifest: LiveV9V10PreservationManifest | undefined;
    let runnerInvoked = false;
    try {
      const gateResult = await this.inspectRestoreAndJournal('APPLY');
      if (gateResult) {
        applyResult = gateResult;
      } else {
        const readiness = this.inspectSource();
        preMigrationManifest = readiness.manifest;
        const runner = this.deps.createRunner(readiness.manifest);
        runnerInvoked = true;
        const migration = await runner.run(readiness.databasePath);
        completedBackupId = migration.backupId;
        completedAttemptId = migration.attemptId;
        if (
          migration.status !== 'migrated' ||
          migration.fromVersion !== 9 ||
          migration.toVersion !== 10 ||
          migration.appliedMigrationIds.length !== 1 ||
          migration.appliedMigrationIds[0] !== PRODUCTION_V10_MIGRATION_ID
        ) {
          applyResult = result(
            'APPLY',
            'POST_MIGRATION_VERIFICATION_FAILED',
            'POST_MIGRATION_VERIFICATION_FAILED',
            'The migration runner returned an unexpected result.',
            { backupId: migration.backupId, attemptId: migration.attemptId },
          );
        } else {
          const verificationDb = this.deps.openReadOnly(readiness.databasePath);
          try {
            try {
              assertPostMigration(verificationDb, this.deps.migrations, readiness.manifest);
            } catch (error) {
              throw new GuardBlockedError(
                'POST_MIGRATION_VERIFICATION_FAILED',
                error instanceof Error
                  ? error.message
                  : 'Post-migration verification could not be completed.',
              );
            }
          } finally {
            verificationDb.close();
          }
          applyResult = result(
            'APPLY',
            'MIGRATION_APPLIED_AND_VERIFIED',
            'READY',
            'The v9 to v10 migration was applied and verified without starting the runtime.',
            {
              readiness,
              backupId: migration.backupId,
              attemptId: migration.attemptId,
            },
          );
        }
      }
    } catch (error) {
      if (error instanceof GuardBlockedError) {
        if (error.reasonCode === 'ALREADY_MIGRATED') {
          applyResult = result('APPLY', 'ALREADY_MIGRATED', error.reasonCode, error.message);
        } else if (error.reasonCode === 'ALREADY_V10_STATE_MISMATCH') {
          applyResult = result(
            'APPLY',
            'ALREADY_V10_STATE_MISMATCH',
            error.reasonCode,
            error.message,
          );
        } else if (error.reasonCode === 'POST_MIGRATION_VERIFICATION_FAILED') {
          applyResult = result(
            'APPLY',
            'POST_MIGRATION_VERIFICATION_FAILED',
            error.reasonCode,
            error.message,
            { backupId: completedBackupId, attemptId: completedAttemptId },
          );
        } else {
          applyResult = result('APPLY', 'APPLY_BLOCKED', error.reasonCode, error.message);
        }
      } else if (error instanceof SchemaMigrationError && error.code === 'BACKUP_FAILED') {
        if (error.cause instanceof SourceChangedAfterBackupError) {
          applyResult = result(
            'APPLY',
            'SOURCE_CHANGED_AFTER_BACKUP',
            'SOURCE_CHANGED_AFTER_BACKUP',
            error.cause.message,
            { backupId: error.backupId, attemptId: error.attemptId },
          );
        } else {
          applyResult = result(
            'APPLY',
            'BACKUP_FAILED',
            'BACKUP_FAILED',
            'Backup creation or verification failed before migration.',
            { backupId: error.backupId, attemptId: error.attemptId },
          );
        }
      } else {
        if (runnerInvoked) {
          this.deps.afterMigrationFailureForTest?.(this.deps.databasePath);
        }
        const rolledBack =
          runnerInvoked &&
          preMigrationManifest !== undefined &&
          this.proveControlledV9Rollback(preMigrationManifest);
        applyResult = result(
          'APPLY',
          rolledBack ? 'MIGRATION_FAILED_ROLLED_BACK' : 'MIGRATION_STATE_AMBIGUOUS',
          rolledBack ? 'MIGRATION_FAILED' : 'MIGRATION_STATE_AMBIGUOUS',
          rolledBack
            ? 'Migration failed and a complete controlled schema-v9 rollback was verified.'
            : 'Migration state could not be proven after failure; recovery investigation is required.',
          error instanceof SchemaMigrationError
            ? { backupId: error.backupId, attemptId: error.attemptId }
            : undefined,
        );
      }
    } finally {
      try {
        lease.release();
      } catch {
        releaseFailed = true;
      }
    }
    if (releaseFailed) {
      return result(
        'APPLY',
        'LOCK_UNAVAILABLE',
        'LOCK_UNAVAILABLE',
        'The startup lock could not be released cleanly; operator investigation is required.',
        {
          backupId: applyResult.backupId,
          attemptId: applyResult.attemptId,
        },
      );
    }
    return applyResult;
  }

  private proveControlledV9Rollback(before: LiveV9V10PreservationManifest): boolean {
    try {
      const canonicalPath = this.deps.pathGuard.validate(this.deps.databasePath);
      const db = this.deps.openReadOnly(canonicalPath);
      try {
        const readiness = inspectV9Source(
          db,
          canonicalPath,
          this.deps.backupRoot,
          this.deps.migrations,
        );
        return preservationManifestsEqual(before, readiness.manifest);
      } finally {
        db.close();
      }
    } catch {
      return false;
    }
  }
}

export function createLiveV9V10MigrationEntrypoint(
  options: LiveV9V10FactoryOptions,
): LiveV9V10MigrationEntrypoint {
  const databasePath = path.resolve(options.databasePath);
  const dataRoot = path.dirname(databasePath);
  const backupRoot = path.join(dataRoot, 'backups');
  const journalRoot = path.join(dataRoot, 'journal');
  const pathResolver = new PathResolverService(dataRoot);
  const clock = options.clock ?? { now: () => new Date() };
  const migrations = Object.freeze([
    ...(options.migrations ?? PRODUCTION_MIGRATIONS).filter(
      (migration) => migration.toVersion <= LIVE_V9_V10_TARGET_VERSION,
    ),
  ]);
  const journal = new PersistentMigrationJournal({
    journalRoot,
    databasePath,
    pathResolver,
    clock,
    idGenerator: options.journalIdGenerator ?? { generate: () => randomUUID() },
    appVersion: PRODUCTION_APP_VERSION,
    journalFormatVersion: JOURNAL_FORMAT_VERSION,
  });
  const migrationGate = new ProductionMigrationStartupGate(journal);
  const pathGuard = new ExactLiveDatabasePathGuard(options.expectedDatabasePath);
  const requiredTables = Object.freeze([
    'app_state',
    'schema_migrations',
    'project_review_items',
    'workspace_activity',
    'project_meetings',
    'project_actions',
    'project_revisions',
    'project_luminaires',
    'project_documents',
    'project_contacts',
  ]);

  const createRunner = (manifest: LiveV9V10PreservationManifest): SchemaMigrationRunner => {
    const backupFactory: MigrationBackupFactory = {
      create(input) {
        if (input.sourceVersion !== 9) {
          throw new Error('The controlled backup requires source schema version 9.');
        }
        const validateBackupDatabase = (database: DatabaseSync): void => {
          const readiness = inspectV9Source(database, databasePath, backupRoot, migrations);
          if (!preservationManifestsEqual(manifest, readiness.manifest)) {
            throw new Error('The backup preservation manifest differs from the source manifest.');
          }
        };
        const manager = new BackupManager({
          sourceDb: input.sourceDb,
          sourceDatabasePath: input.sourceDatabasePath,
          backupRoot,
          pathResolver,
          clock,
          idGenerator: options.backupIdGenerator ?? { generate: () => randomUUID() },
          appVersion: PRODUCTION_APP_VERSION,
          verificationPolicy: {
            requiredTables,
            validateDatabase: validateBackupDatabase,
          },
          ...(options.backupFunction ? { backupFunction: options.backupFunction } : {}),
        });
        return {
          createVerifiedBackup(request) {
            if (
              request.reason !== 'SCHEMA_UPGRADE_9_TO_10' ||
              request.migrationId !== PRODUCTION_V10_MIGRATION_ID
            ) {
              throw new Error('The backup request does not identify the controlled migration.');
            }
            return manager.createVerifiedBackup(request);
          },
          async verifyBackup(backupId) {
            const verification = await manager.verifyBackup(backupId);
            const metadata = await manager.inspectBackup(backupId);
            if (verification.schemaVersion !== 9 || verification.customPolicyChecked !== true) {
              throw new Error('The verified backup is not the controlled schema-v9 snapshot.');
            }
            if (
              metadata.reason !== 'SCHEMA_UPGRADE_9_TO_10' ||
              metadata.migrationId !== PRODUCTION_V10_MIGRATION_ID ||
              metadata.schemaVersion !== 9
            ) {
              throw new Error(
                'The verified backup metadata does not match the controlled upgrade.',
              );
            }
            options.afterBackupVerifiedForTest?.(input.sourceDb);
            let current: LiveV9V10Readiness;
            try {
              current = inspectV9Source(input.sourceDb, databasePath, backupRoot, migrations);
            } catch (error) {
              throw new SourceChangedAfterBackupError(
                error instanceof Error
                  ? `The source changed after backup verification: ${error.message}`
                  : 'The source changed after backup verification.',
              );
            }
            if (!preservationManifestsEqual(manifest, current.manifest)) {
              throw new SourceChangedAfterBackupError(
                'The source changed after backup verification and before migration.',
              );
            }
            return verification;
          },
        };
      },
    };
    return new SchemaMigrationRunner({
      migrations,
      targetVersion: LIVE_V9_V10_TARGET_VERSION,
      appVersion: PRODUCTION_APP_VERSION,
      databaseFactory: databaseFactory(),
      backupFactory,
      journal,
      clock,
      pathResolver,
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
  };

  return new LiveV9V10MigrationEntrypoint({
    databasePath,
    backupRoot,
    pathGuard,
    lock: options.lock ?? new DatabaseStartupLock({ busyTimeoutMs: 1000 }),
    inspectPendingRestore: () =>
      inspectProductionPendingRestore(
        path.join(dataRoot, PRODUCTION_PENDING_RESTORE_REQUEST_FILE),
        path.join(dataRoot, PRODUCTION_LEGACY_PENDING_RESTORE_FILE),
      ) === 'NO_PENDING_RESTORE'
        ? 'NO_PENDING_RESTORE'
        : 'PENDING_RESTORE',
    migrationGate,
    migrations,
    createRunner,
    openReadOnly,
    afterMigrationFailureForTest: options.afterMigrationFailureForTest,
  });
}
