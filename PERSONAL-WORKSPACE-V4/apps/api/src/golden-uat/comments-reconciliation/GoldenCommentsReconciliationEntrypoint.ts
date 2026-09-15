import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackupManager, type BackupFunction } from '../../infrastructure/backup/BackupManager';
import { PathResolverService } from '../../infrastructure/path/PathResolverService';
import { ExactLiveDatabasePathGuard } from '../../infrastructure/migration/live-v9-v10/LiveV9V10MigrationEntrypoint';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_V10_MIGRATION_ID,
} from '../../infrastructure/migration/registry/production-migration-registry';
import { MigrationStateInspector } from '../../infrastructure/migration/MigrationStateInspector';
import { DatabaseStartupLock } from '../../infrastructure/startup/DatabaseStartupLock';
import { PRODUCTION_APP_VERSION } from '../../infrastructure/startup/createPersonalProductionStartup';
import type { DatabaseStartupLockPort } from '../../infrastructure/startup/startup-types';
import {
  GOLDEN_COMMENT_IDS,
  buildGoldenCommentsGraph,
  goldenCommentActorSeeds,
} from '../golden-comments-graph-builder';
import { GOLDEN_UAT_DEFAULT_ANCHOR_DATE, buildAnchorContract } from '../golden-uat-types';
import {
  CONTROLLED_GOLDEN_PROJECT_ID,
  CONTROLLED_LEGACY_REVIEW_IDS,
} from '../../infrastructure/migration/live-v9-v10/LiveV9V10PreservationManifest';
import {
  CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS,
  GOLDEN_COMMENTS_BACKUP_REASON,
  GOLDEN_COMMENTS_RECONCILIATION_ID,
  GOLDEN_COMMENTS_TARGETS,
  assertExactTargetDeterministicOccurrences,
  assertExactTargetCommentsManifest,
  buildGoldenCommentsManifest,
  buildPreservedDomainManifest,
  hasAnyDeterministicFixtureIdentityInDatabase,
  isExactGoldenIdentity,
  isExactLegacyCommentsBaseline,
  isExactTargetCommentsManifest,
  manifestsEqual,
  readGoldenIdentity,
  type GoldenCommentsManifest,
  type PreservedDomainManifest,
} from './golden-comments-reconciliation-manifest';
import { GoldenCommentsTransactionWriter } from './GoldenCommentsTransactionWriter';

export type GoldenCommentsReconciliationMode = 'PLAN' | 'APPLY';

export type GoldenCommentsReconciliationStatus =
  | 'PLAN_READY'
  | 'PLAN_BLOCKED'
  | 'APPLY_BLOCKED'
  | 'RECONCILIATION_APPLIED_AND_VERIFIED'
  | 'ALREADY_RECONCILED'
  | 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
  | 'BACKUP_FAILED'
  | 'SOURCE_CHANGED_AFTER_BACKUP'
  | 'RECONCILIATION_FAILED_ROLLED_BACK'
  | 'RECONCILIATION_STATE_AMBIGUOUS'
  | 'POST_RECONCILIATION_VERIFICATION_FAILED'
  | 'LOCK_UNAVAILABLE';

export type GoldenCommentsReconciliationReasonCode =
  | 'READY'
  | 'INVALID_DATABASE_PATH'
  | 'SOURCE_DATABASE_UNAVAILABLE'
  | 'WRONG_SCHEMA'
  | 'MIGRATION_HISTORY_MISMATCH'
  | 'INTEGRITY_CHECK_FAILED'
  | 'FOREIGN_KEY_CHECK_FAILED'
  | 'GOLDEN_IDENTITY_MISMATCH'
  | 'COMMENTS_BASELINE_MISMATCH'
  | 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
  | 'REQUIRED_TARGET_MISMATCH'
  | 'BACKUP_FAILED'
  | 'SOURCE_CHANGED_AFTER_BACKUP'
  | 'RECONCILIATION_FAILED'
  | 'RECONCILIATION_STATE_AMBIGUOUS'
  | 'POST_RECONCILIATION_VERIFICATION_FAILED'
  | 'LOCK_UNAVAILABLE';

type Row = Record<string, unknown>;

interface ResolvedTargets {
  readonly revision: Row & { readonly id: string };
  readonly downlight: Row & { readonly id: string; readonly tag: string };
  readonly wallWasher: Row & { readonly id: string; readonly tag: string };
  readonly drawing: Row & {
    readonly id: string;
    readonly projectId: string;
    readonly documentNumber: string;
  };
  readonly minutes: Row & {
    readonly id: string;
    readonly projectId: string;
    readonly documentNumber: string;
  };
}

export interface GoldenCommentsReconciliationReadiness {
  readonly databasePath: string;
  readonly schemaVersion: typeof PRODUCTION_SCHEMA_TARGET_VERSION;
  readonly migrationId: typeof PRODUCTION_V10_MIGRATION_ID;
  readonly goldenProjectId: typeof CONTROLLED_GOLDEN_PROJECT_ID;
  readonly projectCount: 4;
  readonly currentRootIds: readonly string[];
  readonly currentActivityIds: readonly string[];
  readonly replyCount: number;
  readonly attachmentCount: number;
  readonly fixtureIdentitiesPresent: boolean;
  readonly expectedDeleteRootIds: readonly string[];
  readonly expectedDeleteActivityIds: readonly string[];
  readonly expectedTarget: {
    readonly roots: 4;
    readonly replies: 6;
    readonly attachments: 2;
    readonly activities: 12;
  };
  readonly targets: ResolvedTargets;
  readonly commentsManifest: GoldenCommentsManifest;
  readonly preservedManifest: PreservedDomainManifest;
}

export interface GoldenCommentsReconciliationResult {
  readonly mode: GoldenCommentsReconciliationMode;
  readonly status: GoldenCommentsReconciliationStatus;
  readonly reasonCode: GoldenCommentsReconciliationReasonCode;
  readonly message: string;
  readonly readiness?: GoldenCommentsReconciliationReadiness | undefined;
  readonly backupId?: string | undefined;
}

interface FactoryOptions {
  readonly databasePath: string;
  readonly expectedDatabasePath: string;
  readonly lock?: DatabaseStartupLockPort | undefined;
  readonly clock?: { now(): Date } | undefined;
  readonly backupIdGenerator?: { generate(): string } | undefined;
  readonly backupFunction?: BackupFunction | undefined;
  readonly afterBackupVerifiedForTest?: ((database: DatabaseSync) => void) | undefined;
  readonly beforeFixtureWriteForTest?: ((database: DatabaseSync) => void) | undefined;
  readonly afterCommitForTest?: ((databasePath: string) => void) | undefined;
}

class GuardError extends Error {
  public constructor(
    public readonly reasonCode: GoldenCommentsReconciliationReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

function guard(
  condition: unknown,
  reasonCode: GoldenCommentsReconciliationReasonCode,
  message: string,
): asserts condition {
  if (!condition) throw new GuardError(reasonCode, message);
}

function openReadOnly(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA query_only = ON');
  return db;
}

function stringIds(rows: readonly Row[]): readonly string[] {
  return Object.freeze(rows.map((row) => String(row.id ?? '')).sort());
}

function exactlyOne<T extends Row>(
  rows: readonly T[],
  expectedId: string,
  label: string,
): T & { readonly id: string } {
  guard(
    rows.length === 1 && rows[0]?.id === expectedId,
    'REQUIRED_TARGET_MISMATCH',
    `${label} must resolve to exactly the controlled ID.`,
  );
  return rows[0] as T & { readonly id: string };
}

function resolveTargets(db: DatabaseSync): ResolvedTargets {
  const revision = exactlyOne(
    db
      .prepare('SELECT * FROM project_revisions WHERE project_id = ? AND revision_number = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID, GOLDEN_COMMENTS_TARGETS.revision.revisionNumber) as Row[],
    GOLDEN_COMMENTS_TARGETS.revision.id,
    'REV02',
  );
  const downlight = exactlyOne(
    db
      .prepare('SELECT * FROM project_luminaires WHERE project_id = ? AND tag = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID, GOLDEN_COMMENTS_TARGETS.downlight.tag) as Row[],
    GOLDEN_COMMENTS_TARGETS.downlight.id,
    'DL01',
  );
  const wallWasher = exactlyOne(
    db
      .prepare('SELECT * FROM project_luminaires WHERE project_id = ? AND tag = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID, GOLDEN_COMMENTS_TARGETS.wallWasher.tag) as Row[],
    GOLDEN_COMMENTS_TARGETS.wallWasher.id,
    'WL01',
  );
  const drawing = exactlyOne(
    db
      .prepare('SELECT * FROM project_documents WHERE project_id = ? AND document_number = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID, GOLDEN_COMMENTS_TARGETS.drawing.documentNumber) as Row[],
    GOLDEN_COMMENTS_TARGETS.drawing.id,
    'L-101',
  );
  const minutes = exactlyOne(
    db
      .prepare('SELECT * FROM project_documents WHERE project_id = ? AND document_number = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID, GOLDEN_COMMENTS_TARGETS.minutes.documentNumber) as Row[],
    GOLDEN_COMMENTS_TARGETS.minutes.id,
    'MM-01',
  );
  return Object.freeze({
    revision,
    downlight: { ...downlight, id: String(downlight.id), tag: String(downlight.tag) },
    wallWasher: { ...wallWasher, id: String(wallWasher.id), tag: String(wallWasher.tag) },
    drawing: {
      ...drawing,
      id: String(drawing.id),
      projectId: String(drawing.project_id),
      documentNumber: String(drawing.document_number),
    },
    minutes: {
      ...minutes,
      id: String(minutes.id),
      projectId: String(minutes.project_id),
      documentNumber: String(minutes.document_number),
    },
  });
}

function inspectControlledSource(
  db: DatabaseSync,
  databasePath: string,
): GoldenCommentsReconciliationReadiness {
  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check: string;
  }>;
  guard(
    integrity.length === 1 && integrity[0]?.integrity_check === 'ok',
    'INTEGRITY_CHECK_FAILED',
    'PRAGMA integrity_check did not return exactly ok.',
  );
  guard(
    db.prepare('PRAGMA foreign_key_check').all().length === 0,
    'FOREIGN_KEY_CHECK_FAILED',
    'PRAGMA foreign_key_check returned violations.',
  );
  const migrationState = new MigrationStateInspector(
    PRODUCTION_MIGRATIONS,
    PRODUCTION_SCHEMA_TARGET_VERSION,
  ).inspect(db);
  const v10Migration = PRODUCTION_MIGRATIONS.find(
    (migration) => migration.id === PRODUCTION_V10_MIGRATION_ID,
  );
  // The current migration is the last committed migration in the chain (V4-ISSUE-A0
  // moved the target from v11 to v12; never hardcode a specific version here).
  const currentMigration = PRODUCTION_MIGRATIONS.at(-1);
  const v10Rows = migrationState.historyRows.filter(
    (row) => row.migration_id === PRODUCTION_V10_MIGRATION_ID,
  );
  const latestMigration = migrationState.historyRows.at(-1);
  const committedV10Rows = db
    .prepare(
      `SELECT migration_id, from_version, to_version, checksum, validation_result
       FROM schema_migrations WHERE migration_id = ?`,
    )
    .all(PRODUCTION_V10_MIGRATION_ID) as Row[];
  guard(
    migrationState.currentVersion === PRODUCTION_SCHEMA_TARGET_VERSION && migrationState.atTarget,
    'WRONG_SCHEMA',
    `The source schema must be exactly v${PRODUCTION_SCHEMA_TARGET_VERSION}.`,
  );
  guard(
    migrationState.historyTableExists &&
      migrationState.historyTableValid &&
      migrationState.historyValid &&
      migrationState.pendingMigrations.length === 0 &&
      v10Rows.length === 1 &&
      latestMigration?.migration_id === currentMigration?.id &&
      latestMigration?.from_version === currentMigration?.fromVersion &&
      latestMigration?.to_version === PRODUCTION_SCHEMA_TARGET_VERSION &&
      latestMigration?.checksum === currentMigration?.checksum &&
      committedV10Rows.length === 1 &&
      committedV10Rows[0]?.validation_result === 'passed',
    'MIGRATION_HISTORY_MISMATCH',
    'The complete committed production migration history is not exact.',
  );
  try {
    v10Migration?.validate?.({
      database: db,
      migrationId: v10Migration.id,
      fromVersion: v10Migration.fromVersion,
      toVersion: v10Migration.toVersion,
      clock: { now: () => new Date(0) },
    });
  } catch (error) {
    throw new GuardError(
      'WRONG_SCHEMA',
      error instanceof Error ? error.message : 'The required v10 Comments structure is invalid.',
    );
  }
  const identity = readGoldenIdentity(db);
  guard(
    isExactGoldenIdentity(identity),
    'GOLDEN_IDENTITY_MISMATCH',
    'The controlled Golden identity or project count is not exact.',
  );
  const targets = resolveTargets(db);
  const commentsManifest = buildGoldenCommentsManifest(db);
  const fixtureIdentitiesPresent = hasAnyDeterministicFixtureIdentityInDatabase(db);
  if (isExactTargetCommentsManifest(commentsManifest)) {
    try {
      assertExactTargetDeterministicOccurrences(db);
    } catch (error) {
      throw new GuardError(
        'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
        error instanceof Error
          ? error.message
          : 'The global deterministic Golden Comments identity occurrences are not exact.',
      );
    }
  } else {
    guard(
      !fixtureIdentitiesPresent,
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
      'A partial deterministic Golden Comments fixture identity is present.',
    );
    guard(
      isExactLegacyCommentsBaseline(commentsManifest),
      'COMMENTS_BASELINE_MISMATCH',
      'The Golden Comments graph is not the exact controlled legacy baseline.',
    );
  }
  const preservedManifest = buildPreservedDomainManifest(db);
  return Object.freeze({
    databasePath,
    schemaVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    migrationId: PRODUCTION_V10_MIGRATION_ID,
    goldenProjectId: CONTROLLED_GOLDEN_PROJECT_ID,
    projectCount: 4,
    currentRootIds: stringIds(commentsManifest.roots),
    currentActivityIds: stringIds(commentsManifest.activities),
    replyCount: commentsManifest.replies.length,
    attachmentCount: commentsManifest.attachments.length,
    fixtureIdentitiesPresent,
    expectedDeleteRootIds: CONTROLLED_LEGACY_REVIEW_IDS,
    expectedDeleteActivityIds: CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS,
    expectedTarget: Object.freeze({ roots: 4, replies: 6, attachments: 2, activities: 12 }),
    targets,
    commentsManifest,
    preservedManifest,
  });
}

function result(
  mode: GoldenCommentsReconciliationMode,
  status: GoldenCommentsReconciliationStatus,
  reasonCode: GoldenCommentsReconciliationReasonCode,
  message: string,
  details?: Pick<GoldenCommentsReconciliationResult, 'readiness' | 'backupId'>,
): GoldenCommentsReconciliationResult {
  return Object.freeze({ mode, status, reasonCode, message, ...details });
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

export class GoldenCommentsReconciliationEntrypoint {
  private readonly pathGuard: ExactLiveDatabasePathGuard;
  private readonly lock: DatabaseStartupLockPort;
  private readonly dataRoot: string;
  private readonly backupRoot: string;
  private readonly clock: { now(): Date };

  public constructor(private readonly options: FactoryOptions) {
    this.pathGuard = new ExactLiveDatabasePathGuard(options.expectedDatabasePath);
    this.lock = options.lock ?? new DatabaseStartupLock({ busyTimeoutMs: 1000 });
    this.dataRoot = path.dirname(path.resolve(options.databasePath));
    this.backupRoot = path.join(this.dataRoot, 'backups');
    this.clock = options.clock ?? { now: () => new Date() };
  }

  public async run(
    mode: GoldenCommentsReconciliationMode,
  ): Promise<GoldenCommentsReconciliationResult> {
    return mode === 'PLAN' ? this.plan() : this.apply();
  }

  private validatePath(): string {
    try {
      return this.pathGuard.validate(this.options.databasePath);
    } catch (error) {
      throw new GuardError(
        'INVALID_DATABASE_PATH',
        error instanceof Error ? error.message : 'The database path is invalid.',
      );
    }
  }

  private inspectSource(): GoldenCommentsReconciliationReadiness {
    const canonicalPath = this.validatePath();
    let db: DatabaseSync | undefined;
    try {
      db = openReadOnly(canonicalPath);
      return inspectControlledSource(db, canonicalPath);
    } catch (error) {
      if (error instanceof GuardError) throw error;
      throw new GuardError(
        'SOURCE_DATABASE_UNAVAILABLE',
        error instanceof Error ? error.message : 'The source database could not be inspected.',
      );
    } finally {
      db?.close();
    }
  }

  private async plan(): Promise<GoldenCommentsReconciliationResult> {
    try {
      const readiness = this.inspectSource();
      if (isExactTargetCommentsManifest(readiness.commentsManifest)) {
        return result(
          'PLAN',
          'ALREADY_RECONCILED',
          'READY',
          'The exact deterministic Golden Comments graph is already present.',
          { readiness },
        );
      }
      return result(
        'PLAN',
        'PLAN_READY',
        'READY',
        'All read-only Golden Comments reconciliation guards passed.',
        { readiness },
      );
    } catch (error) {
      if (error instanceof GuardError) {
        return result(
          'PLAN',
          error.reasonCode === 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
            ? 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
            : 'PLAN_BLOCKED',
          error.reasonCode,
          error.message,
        );
      }
      return result(
        'PLAN',
        'PLAN_BLOCKED',
        'SOURCE_DATABASE_UNAVAILABLE',
        error instanceof Error ? error.message : 'The source database could not be inspected.',
      );
    }
  }

  private async apply(): Promise<GoldenCommentsReconciliationResult> {
    let canonicalPath: string;
    let lease: ReturnType<DatabaseStartupLockPort['acquire']>;
    try {
      canonicalPath = this.validatePath();
    } catch (error) {
      return result(
        'APPLY',
        'APPLY_BLOCKED',
        error instanceof GuardError ? error.reasonCode : 'INVALID_DATABASE_PATH',
        error instanceof Error ? error.message : 'The database path is invalid.',
      );
    }
    try {
      lease = this.lock.acquire(canonicalPath);
    } catch (error) {
      return result(
        'APPLY',
        'LOCK_UNAVAILABLE',
        'LOCK_UNAVAILABLE',
        error instanceof Error ? error.message : 'The database startup lock is unavailable.',
      );
    }

    let applyResult: GoldenCommentsReconciliationResult;
    let releaseFailed = false;
    let sourceDb: DatabaseSync | undefined;
    let backupId: string | undefined;
    let before: GoldenCommentsReconciliationReadiness | undefined;
    try {
      before = this.inspectSource();
      if (isExactTargetCommentsManifest(before.commentsManifest)) {
        applyResult = result(
          'APPLY',
          'ALREADY_RECONCILED',
          'READY',
          'The exact deterministic Golden Comments graph is already present.',
          { readiness: before },
        );
      } else {
        sourceDb = new DatabaseSync(canonicalPath);
        sourceDb.exec('PRAGMA foreign_keys = ON');
        sourceDb.exec('PRAGMA busy_timeout = 5000');
        const backupManager = new BackupManager({
          sourceDb,
          sourceDatabasePath: canonicalPath,
          backupRoot: this.backupRoot,
          pathResolver: new PathResolverService(this.dataRoot),
          clock: this.clock,
          idGenerator: this.options.backupIdGenerator ?? { generate: () => randomUUID() },
          appVersion: PRODUCTION_APP_VERSION,
          verificationPolicy: {
            requiredTables: [
              'app_state',
              'schema_migrations',
              'project_review_items',
              'project_review_replies',
              'project_review_attachments',
              'workspace_activity',
              'project_revisions',
              'project_luminaires',
              'project_documents',
            ],
            validateDatabase: (backupDb) => {
              const backupState = inspectControlledSource(backupDb, canonicalPath);
              if (
                !isExactLegacyCommentsBaseline(backupState.commentsManifest) ||
                !manifestsEqual(before!.commentsManifest, backupState.commentsManifest) ||
                !manifestsEqual(before!.preservedManifest, backupState.preservedManifest)
              ) {
                throw new Error('The verified backup manifest differs from the source manifest.');
              }
            },
          },
          ...(this.options.backupFunction ? { backupFunction: this.options.backupFunction } : {}),
        });
        const backup = await backupManager.createVerifiedBackup({
          reason: GOLDEN_COMMENTS_BACKUP_REASON,
          migrationId: GOLDEN_COMMENTS_RECONCILIATION_ID,
        });
        backupId = backup.backupId;
        const verification = await backupManager.verifyBackup(backup.backupId);
        const metadata = await backupManager.inspectBackup(backup.backupId);
        guard(
          verification.verified &&
            verification.schemaVersion === PRODUCTION_SCHEMA_TARGET_VERSION &&
            verification.customPolicyChecked &&
            metadata.reason === GOLDEN_COMMENTS_BACKUP_REASON &&
            metadata.migrationId === GOLDEN_COMMENTS_RECONCILIATION_ID,
          'BACKUP_FAILED',
          'The pre-reconciliation backup verification is not exact.',
        );
        this.options.afterBackupVerifiedForTest?.(sourceDb);
        const afterBackup = inspectControlledSource(sourceDb, canonicalPath);
        guard(
          manifestsEqual(before.commentsManifest, afterBackup.commentsManifest) &&
            manifestsEqual(before.preservedManifest, afterBackup.preservedManifest),
          'SOURCE_CHANGED_AFTER_BACKUP',
          'The source changed after backup verification.',
        );
        applyResult = this.reconcileAtomically(sourceDb, before, backupId);
        sourceDb.close();
        sourceDb = undefined;
        if (applyResult.status === 'RECONCILIATION_APPLIED_AND_VERIFIED') {
          this.options.afterCommitForTest?.(canonicalPath);
          let verificationDb: DatabaseSync | undefined;
          try {
            verificationDb = openReadOnly(canonicalPath);
            const post = inspectControlledSource(verificationDb, canonicalPath);
            assertExactTargetCommentsManifest(post.commentsManifest);
            guard(
              manifestsEqual(before.preservedManifest, post.preservedManifest),
              'POST_RECONCILIATION_VERIFICATION_FAILED',
              'A preserved domain changed after reconciliation.',
            );
            applyResult = result(
              'APPLY',
              'RECONCILIATION_APPLIED_AND_VERIFIED',
              'READY',
              'The Golden Comments graph was reconciled and freshly verified.',
              { readiness: post, backupId },
            );
          } catch (error) {
            applyResult = result(
              'APPLY',
              'POST_RECONCILIATION_VERIFICATION_FAILED',
              'POST_RECONCILIATION_VERIFICATION_FAILED',
              error instanceof Error
                ? error.message
                : 'Fresh post-reconciliation verification failed.',
              { backupId },
            );
          } finally {
            verificationDb?.close();
          }
        }
      }
    } catch (error) {
      sourceDb?.close();
      sourceDb = undefined;
      if (error instanceof GuardError) {
        const status: GoldenCommentsReconciliationStatus =
          error.reasonCode === 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
            ? 'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE'
            : error.reasonCode === 'BACKUP_FAILED'
              ? 'BACKUP_FAILED'
              : error.reasonCode === 'SOURCE_CHANGED_AFTER_BACKUP'
                ? 'SOURCE_CHANGED_AFTER_BACKUP'
                : 'APPLY_BLOCKED';
        applyResult = result('APPLY', status, error.reasonCode, error.message, { backupId });
      } else {
        applyResult = result(
          'APPLY',
          'BACKUP_FAILED',
          'BACKUP_FAILED',
          'Backup creation or verification failed before reconciliation.',
          { backupId },
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
        'RECONCILIATION_STATE_AMBIGUOUS',
        'RECONCILIATION_STATE_AMBIGUOUS',
        'The startup lock could not be released cleanly.',
        { backupId },
      );
    }
    return applyResult;
  }

  private reconcileAtomically(
    db: DatabaseSync,
    before: GoldenCommentsReconciliationReadiness,
    backupId: string,
  ): GoldenCommentsReconciliationResult {
    let transactionStarted = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const transactionState = inspectControlledSource(db, before.databasePath);
      guard(
        manifestsEqual(before.commentsManifest, transactionState.commentsManifest) &&
          manifestsEqual(before.preservedManifest, transactionState.preservedManifest),
        'SOURCE_CHANGED_AFTER_BACKUP',
        'The source changed before the reconciliation transaction acquired its write lock.',
      );
      const activityDelete = db
        .prepare(
          `DELETE FROM workspace_activity
            WHERE project_id = ? AND id IN (${placeholders(CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS)})`,
        )
        .run(CONTROLLED_GOLDEN_PROJECT_ID, ...CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS);
      db.prepare(
        `DELETE FROM project_review_attachments
          WHERE project_id = ? AND id IN (${placeholders(GOLDEN_COMMENT_IDS.attachments)})`,
      ).run(CONTROLLED_GOLDEN_PROJECT_ID, ...GOLDEN_COMMENT_IDS.attachments);
      db.prepare(
        `DELETE FROM project_review_replies
          WHERE project_id = ? AND id IN (${placeholders(GOLDEN_COMMENT_IDS.replies)})`,
      ).run(CONTROLLED_GOLDEN_PROJECT_ID, ...GOLDEN_COMMENT_IDS.replies);
      const rootDelete = db
        .prepare(
          `DELETE FROM project_review_items
            WHERE project_id = ? AND id IN (${placeholders(CONTROLLED_LEGACY_REVIEW_IDS)})`,
        )
        .run(CONTROLLED_GOLDEN_PROJECT_ID, ...CONTROLLED_LEGACY_REVIEW_IDS);
      guard(
        activityDelete.changes === 3 && rootDelete.changes === 3,
        'RECONCILIATION_FAILED',
        'The controlled legacy deletion count was not exact.',
      );
      this.options.beforeFixtureWriteForTest?.(db);
      const operations = new GoldenCommentsTransactionWriter(db);
      const contract = buildAnchorContract(GOLDEN_UAT_DEFAULT_ANCHOR_DATE);
      buildGoldenCommentsGraph({
        projectId: CONTROLLED_GOLDEN_PROJECT_ID,
        contract,
        operations,
        readReviewItems: () => [],
        revision: transactionState.targets.revision,
        downlight: transactionState.targets.downlight,
        wallWasher: transactionState.targets.wallWasher,
        drawing: transactionState.targets.drawing,
        minutes: transactionState.targets.minutes,
        actors: goldenCommentActorSeeds(contract),
      });
      const target = buildGoldenCommentsManifest(db);
      assertExactTargetCommentsManifest(target);
      assertExactTargetDeterministicOccurrences(db);
      const preserved = buildPreservedDomainManifest(db);
      guard(
        manifestsEqual(before.preservedManifest, preserved),
        'RECONCILIATION_FAILED',
        'A preserved domain changed inside the reconciliation transaction.',
      );
      db.exec('COMMIT');
      transactionStarted = false;
      return result(
        'APPLY',
        'RECONCILIATION_APPLIED_AND_VERIFIED',
        'READY',
        'The atomic Golden Comments reconciliation committed.',
        { backupId },
      );
    } catch (error) {
      let rollbackSucceeded = false;
      if (transactionStarted) {
        try {
          db.exec('ROLLBACK');
          rollbackSucceeded = true;
        } catch {
          rollbackSucceeded = false;
        }
      }
      if (
        error instanceof GuardError &&
        error.reasonCode === 'SOURCE_CHANGED_AFTER_BACKUP' &&
        rollbackSucceeded
      ) {
        return result('APPLY', 'SOURCE_CHANGED_AFTER_BACKUP', error.reasonCode, error.message, {
          backupId,
        });
      }
      const rolledBack =
        rollbackSucceeded &&
        this.proveLegacyRollback(before.commentsManifest, before.preservedManifest);
      return result(
        'APPLY',
        rolledBack ? 'RECONCILIATION_FAILED_ROLLED_BACK' : 'RECONCILIATION_STATE_AMBIGUOUS',
        rolledBack ? 'RECONCILIATION_FAILED' : 'RECONCILIATION_STATE_AMBIGUOUS',
        rolledBack
          ? 'Reconciliation failed and the complete controlled legacy state was restored.'
          : 'Reconciliation state could not be proven after failure.',
        { backupId },
      );
    }
  }

  private proveLegacyRollback(
    commentsBefore: GoldenCommentsManifest,
    preservedBefore: PreservedDomainManifest,
  ): boolean {
    let db: DatabaseSync | undefined;
    try {
      db = openReadOnly(this.options.databasePath);
      const comments = buildGoldenCommentsManifest(db);
      const preserved = buildPreservedDomainManifest(db);
      return (
        isExactLegacyCommentsBaseline(comments) &&
        manifestsEqual(commentsBefore, comments) &&
        manifestsEqual(preservedBefore, preserved)
      );
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }
}

export function createGoldenCommentsReconciliationEntrypoint(
  options: FactoryOptions,
): GoldenCommentsReconciliationEntrypoint {
  return new GoldenCommentsReconciliationEntrypoint(options);
}
