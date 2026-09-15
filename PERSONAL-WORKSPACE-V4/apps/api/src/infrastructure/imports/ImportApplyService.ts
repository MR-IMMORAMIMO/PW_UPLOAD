import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ApplyImportSessionInput,
  ImportApplyAttemptRead,
  ImportApplyPlanSummary,
  ImportProjectResultIdentity,
  ImportProjectRowAction,
  ImportResultIdentity,
  ImportRowAction,
} from '@scli/contracts';
import { importResultIdentitySchema, luminaireRecordSchema } from '@scli/contracts';
import {
  DomainError,
  effectiveProjectLuminaireDescription,
  normalizeLuminaireTag,
  type AppUser,
} from '@scli/domain';
import type { WorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService.js';
import { LuminaireLibraryService } from '../luminaire-library/LuminaireLibraryService.js';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore.js';
import { ImportSessionStore } from './ImportSessionStore.js';
import { LibraryDraftImportApplyStrategy } from './LibraryDraftImportApplyStrategy.js';
import {
  SqliteLuminaireLibraryDraftWritePort,
  type LuminaireLibraryDraftWritePort,
} from './LuminaireLibraryDraftWritePort.js';

type Row = Readonly<Record<string, unknown>>;

const EMPTY_COUNTS: ImportApplyPlanSummary = Object.freeze({
  createProjectOnly: 0,
  updateProjectOnly: 0,
  updateLinkedProjectFields: 0,
  addFromLibrary: 0,
  createLibraryDraft: 0,
  useExistingLibrary: 0,
  reviewExistingLibrary: 0,
  skip: 0,
  blocked: 0,
  unresolved: 0,
  readyMutations: 0,
});

const EMPTY_RESULT_COUNTS = Object.freeze({
  created: 0,
  updatedProjectOnlyResult: 0,
  updatedLinkedProjectFieldsResult: 0,
  addedFromLibrary: 0,
  uniqueManufacturersCreated: 0,
  uniqueProductsCreated: 0,
  variantDraftsCreated: 0,
  existingVariantsUsed: 0,
  publishedVersionsCreated: 0 as const,
  skippedResult: 0,
  remainingBlocked: 0,
  remainingUnresolved: 0,
});

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function attempt(row: Row): ImportApplyAttemptRead {
  const storedCounts = json<Partial<ImportApplyAttemptRead['counts']>>(row.counts_json, {});
  return {
    applyAttemptId: String(row.apply_attempt_id),
    importSessionId: String(row.import_session_id),
    idempotencyKey: String(row.idempotency_key),
    state: String(row.state) as ImportApplyAttemptRead['state'],
    applyPlanFingerprint: String(row.apply_plan_fingerprint),
    destinationFingerprint: String(row.destination_fingerprint),
    backupId: row.backup_id == null ? null : String(row.backup_id),
    counts: {
      ...EMPTY_COUNTS,
      ...EMPTY_RESULT_COUNTS,
      applied: 0,
      failed: 0,
      ...storedCounts,
    },
    errorSummary: row.error_summary == null ? null : String(row.error_summary),
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

export class ImportApplyService {
  private readonly database: DatabaseSync;
  private readonly writes: ProjectLuminaireWriteStore;
  private readonly libraryApply: LibraryDraftImportApplyStrategy;

  public constructor(
    private readonly store: ImportSessionStore,
    private readonly library: LuminaireLibraryService,
    private readonly backups: WorkspaceBackupService,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
    libraryDrafts: LuminaireLibraryDraftWritePort = new SqliteLuminaireLibraryDraftWritePort(
      store.getDatabase(),
      clock,
      uuid,
    ),
  ) {
    this.database = store.getDatabase();
    this.writes = new ProjectLuminaireWriteStore(this.database, clock, uuid);
    this.libraryApply = new LibraryDraftImportApplyStrategy(store, libraryDrafts, clock);
    this.recoverInterruptedAttempts();
  }

  private recoverInterruptedAttempts(): void {
    const active = this.database
      .prepare(
        "SELECT DISTINCT import_session_id FROM import_apply_attempts WHERE state IN ('PENDING', 'IN_PROGRESS')",
      )
      .all() as Array<{ import_session_id: string }>;
    if (active.length === 0) return;
    this.store.transaction(() => {
      const now = this.clock().toISOString();
      this.database
        .prepare(
          `UPDATE import_apply_attempts SET state = 'ABANDONED',
           error_summary = 'Apply was interrupted before a terminal result was recorded.',
           updated_at = ?, completed_at = ? WHERE state IN ('PENDING', 'IN_PROGRESS')`,
        )
        .run(now, now);
      this.database
        .prepare(
          `UPDATE import_sessions SET session_status = 'NEEDS_REVIEW', updated_at = ?
         WHERE import_session_id IN (${active.map(() => '?').join(', ')})`,
        )
        .run(now, ...active.map((item) => item.import_session_id));
    });
  }

  public getAttempt(sessionId: string, attemptId: string): ImportApplyAttemptRead {
    const row = this.database
      .prepare(
        'SELECT * FROM import_apply_attempts WHERE import_session_id = ? AND apply_attempt_id = ?',
      )
      .get(sessionId, attemptId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Import Apply Attempt not found.', 404);
    return attempt(row);
  }

  public listAttempts(sessionId: string): ImportApplyAttemptRead[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM import_apply_attempts WHERE import_session_id = ? ORDER BY started_at DESC, apply_attempt_id',
        )
        .all(sessionId) as Row[]
    ).map(attempt);
  }

  public async apply(
    sessionId: string,
    input: ApplyImportSessionInput,
    actor: AppUser,
  ): Promise<ImportApplyAttemptRead> {
    const replayRow = this.database
      .prepare('SELECT * FROM import_apply_attempts WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as Row | undefined;
    if (replayRow) {
      if (String(replayRow.import_session_id) !== sessionId)
        throw new DomainError(
          'CONFLICT',
          'The idempotency key belongs to another Import Session.',
          409,
        );
      if (String(replayRow.state) === 'ABANDONED')
        return this.resumeAbandonedAttempt(sessionId, input, actor, replayRow);
      return attempt(replayRow);
    }
    const session = this.store.get(sessionId);
    this.assertSession(session, input);
    const rows = this.plannedRows(sessionId);
    const counts = this.planCounts(sessionId, rows);
    if (rows.length === 0) return this.createNoopAttempt(sessionId, input, counts);
    if ((counts.blocked > 0 || counts.unresolved > 0) && input.mode === 'ALL')
      throw new DomainError(
        'IMPORT_PARTIAL_CONFIRMATION_REQUIRED',
        'Blocked or unresolved rows prevent full Apply.',
        409,
      );
    if (
      (counts.blocked > 0 || counts.unresolved > 0) &&
      (input.mode !== 'READY_ONLY' || !input.confirmPartial)
    )
      throw new DomainError(
        'IMPORT_PARTIAL_CONFIRMATION_REQUIRED',
        'Confirm Apply Ready Rows Only.',
        409,
      );
    if (session.destinationMode === 'MASTER_LIBRARY')
      return this.applyLibrarySession(sessionId, input, rows, counts, actor);
    this.validateRows(session.projectId!, rows);
    const attemptId = this.createAttempt(sessionId, input, counts);
    let backupId: string;
    try {
      ({ backupId } = await this.backups.createVerifiedBackup(`P5B_PROJECT_APPLY:${sessionId}`));
    } catch {
      this.finishAttempt(attemptId, 'FAILED', counts, 0, 0, 'Verified backup failed.');
      this.database
        .prepare(
          "UPDATE import_rows SET apply_state = 'NOT_APPLIED' WHERE import_session_id = ? AND apply_state = 'PENDING'",
        )
        .run(sessionId);
      throw new DomainError(
        'IMPORT_BACKUP_FAILED',
        'A verified backup could not be created. No Project rows changed.',
        409,
      );
    }
    this.database
      .prepare(
        `UPDATE import_apply_attempts SET backup_id = ?, updated_at = ? WHERE apply_attempt_id = ? AND state = 'PENDING'`,
      )
      .run(backupId, this.clock().toISOString(), attemptId);
    this.assertSession(this.store.get(sessionId), input);
    this.validateRows(session.projectId!, rows);
    this.database
      .prepare(
        `UPDATE import_apply_attempts SET state = 'IN_PROGRESS', updated_at = ?
       WHERE apply_attempt_id = ? AND state = 'PENDING'`,
      )
      .run(this.clock().toISOString(), attemptId);

    let applied = 0;
    let failed = 0;
    let fatalSummary: string | null = null;
    for (let offset = 0; offset < rows.length; offset += 100) {
      const chunk = rows.slice(offset, offset + 100);
      const projectRows = chunk.filter(
        (row) =>
          json<ImportRowAction | null>(row.intended_action, null)?.type !==
          'PROJECT_ADD_FROM_LIBRARY',
      );
      const libraryRows = chunk.filter(
        (row) =>
          json<ImportRowAction | null>(row.intended_action, null)?.type ===
          'PROJECT_ADD_FROM_LIBRARY',
      );
      let committedInChunk = 0;
      let failedInChunk = 0;
      try {
        this.store.transaction(() => {
          for (const row of projectRows) {
            const action = json<ImportProjectRowAction | null>(row.intended_action, null);
            if (!action || action.type === 'PROJECT_ADD_FROM_LIBRARY')
              throw new Error('Project Apply chunk contained an invalid persisted action.');
            this.database.exec('SAVEPOINT import_apply_row');
            try {
              this.applyProjectRow(session.projectId!, sessionId, attemptId, row, action, actor);
              this.database.exec('RELEASE SAVEPOINT import_apply_row');
              committedInChunk += 1;
            } catch (error) {
              this.database.exec('ROLLBACK TO SAVEPOINT import_apply_row');
              this.database.exec('RELEASE SAVEPOINT import_apply_row');
              if (!(error instanceof DomainError)) throw error;
              this.recordFailure(sessionId, attemptId, row, error);
              failedInChunk += 1;
            }
          }
        });
        applied += committedInChunk;
        failed += failedInChunk;
        this.updateProgress(attemptId, counts, applied, failed);
      } catch (error) {
        for (const row of projectRows) this.recordFailure(sessionId, attemptId, row, error);
        failed += projectRows.length;
        fatalSummary = 'An unrecoverable Project Apply chunk failed and was rolled back.';
        this.updateProgress(attemptId, counts, applied, failed);
        break;
      }
      for (const row of libraryRows) {
        try {
          await this.applyRow(
            session.projectId!,
            sessionId,
            attemptId,
            row,
            input.applyPlanFingerprint,
            actor,
          );
          applied += 1;
        } catch (error) {
          failed += 1;
          this.recordFailure(sessionId, attemptId, row, error);
        }
        this.updateProgress(attemptId, counts, applied, failed);
      }
    }
    const state = failed === 0 ? 'SUCCEEDED' : applied > 0 ? 'PARTIALLY_APPLIED' : 'FAILED';
    this.finishAttempt(
      attemptId,
      state,
      counts,
      applied,
      failed,
      fatalSummary ?? (failed ? `${failed} row(s) failed.` : null),
    );
    const remaining = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM import_rows WHERE import_session_id = ?
       AND apply_state <> 'APPLIED' AND row_status <> 'SKIPPED'`,
      )
      .get(sessionId) as { count: number };
    this.database
      .prepare(
        `UPDATE import_sessions SET session_status = ?, completed_at = ?, updated_at = ? WHERE import_session_id = ?`,
      )
      .run(
        remaining.count === 0 && failed === 0 ? 'COMPLETED' : 'NEEDS_REVIEW',
        remaining.count === 0 && failed === 0 ? this.clock().toISOString() : null,
        this.clock().toISOString(),
        sessionId,
      );
    return this.getAttempt(sessionId, attemptId);
  }

  private async resumeAbandonedAttempt(
    sessionId: string,
    input: ApplyImportSessionInput,
    actor: AppUser,
    replayRow: Row,
  ): Promise<ImportApplyAttemptRead> {
    const stored = attempt(replayRow);
    if (
      stored.applyPlanFingerprint !== input.applyPlanFingerprint ||
      stored.destinationFingerprint !== input.destinationFingerprint ||
      Number(replayRow.expected_session_revision) !== input.expectedSessionRevision ||
      String(replayRow.preview_fingerprint) !== input.previewFingerprint
    )
      throw new DomainError(
        'IMPORT_PLAN_STALE',
        'The replay request does not match the abandoned Apply authority.',
        409,
      );
    const session = this.store.get(sessionId);
    this.assertSession(session, input);
    const rows = this.plannedRows(sessionId);
    this.validateRows(session.projectId!, rows, true);
    let backupId = stored.backupId;
    if (!backupId) {
      try {
        ({ backupId } = await this.backups.createVerifiedBackup(
          `P5B_PROJECT_APPLY_RESUME:${sessionId}`,
        ));
      } catch {
        this.finishAttempt(
          stored.applyAttemptId,
          'FAILED',
          stored.counts,
          0,
          0,
          'Verified backup failed during resume.',
        );
        throw new DomainError(
          'IMPORT_BACKUP_FAILED',
          'A verified backup could not be created. No new Project rows changed.',
          409,
        );
      }
    }
    const claimed = this.database
      .prepare(
        `UPDATE import_apply_attempts SET state = 'IN_PROGRESS', backup_id = ?, updated_at = ?, completed_at = NULL
       WHERE apply_attempt_id = ? AND state = 'ABANDONED'`,
      )
      .run(backupId, this.clock().toISOString(), stored.applyAttemptId);
    if (claimed.changes !== 1)
      throw new DomainError(
        'IMPORT_APPLY_ALREADY_RUNNING',
        'Another Apply replay already resumed this attempt.',
        409,
      );
    let applied = Number(replayRow.applied_count ?? 0);
    let failed = Number(replayRow.failed_count ?? 0);
    for (let offset = 0; offset < rows.length; offset += 100) {
      for (const row of rows.slice(offset, offset + 100)) {
        try {
          await this.applyRow(
            session.projectId!,
            sessionId,
            stored.applyAttemptId,
            row,
            input.applyPlanFingerprint,
            actor,
          );
          applied += 1;
        } catch (error) {
          failed += 1;
          this.recordFailure(sessionId, stored.applyAttemptId, row, error);
        }
        this.updateProgress(stored.applyAttemptId, stored.counts, applied, failed);
      }
    }
    const state = failed === 0 ? 'SUCCEEDED' : applied > 0 ? 'PARTIALLY_APPLIED' : 'FAILED';
    this.finishAttempt(
      stored.applyAttemptId,
      state,
      stored.counts,
      applied,
      failed,
      failed ? `${failed} row(s) failed.` : null,
    );
    return this.getAttempt(sessionId, stored.applyAttemptId);
  }

  private plannedRows(sessionId: string): Row[] {
    return (
      this.database
        .prepare(
          `SELECT ir.*, ist.mapping_fingerprint AS current_mapping_fingerprint
         FROM import_rows ir JOIN import_source_tables ist ON ist.source_table_id = ir.source_table_id
         WHERE ir.import_session_id = ? AND ir.intended_action IS NOT NULL
           AND ir.apply_state <> 'APPLIED' ORDER BY ir.source_row_number, ir.import_row_id`,
        )
        .all(sessionId) as Row[]
    ).filter(
      (row) =>
        json<ImportRowAction | null>(row.intended_action, null)?.type !== 'LIBRARY_REVIEW_EXISTING',
    );
  }

  private async applyLibrarySession(
    sessionId: string,
    input: ApplyImportSessionInput,
    rows: Row[],
    counts: ImportApplyPlanSummary,
    actor: AppUser,
  ): Promise<ImportApplyAttemptRead> {
    this.libraryApply.validate(rows);
    const attemptId = this.createAttempt(sessionId, input, counts);
    let backupId: string | null = null;
    if (counts.createLibraryDraft > 0) {
      try {
        ({ backupId } = await this.backups.createVerifiedBackup(
          `P5B_LIBRARY_DRAFT_APPLY:${sessionId}`,
        ));
      } catch {
        this.finishAttempt(attemptId, 'FAILED', counts, 0, 0, 'Verified backup failed.');
        this.database
          .prepare(
            "UPDATE import_rows SET apply_state = 'NOT_APPLIED' WHERE import_session_id = ? AND apply_state = 'PENDING'",
          )
          .run(sessionId);
        throw new DomainError(
          'IMPORT_BACKUP_FAILED',
          'A verified backup could not be created. No Library Drafts changed.',
          409,
        );
      }
    }
    this.assertSession(this.store.get(sessionId), input);
    this.libraryApply.validate(rows);
    this.database
      .prepare(
        `UPDATE import_apply_attempts SET state = 'IN_PROGRESS', backup_id = ?, updated_at = ?
         WHERE apply_attempt_id = ? AND state = 'PENDING'`,
      )
      .run(backupId, this.clock().toISOString(), attemptId);
    const result = this.libraryApply.execute(sessionId, attemptId, rows, actor);
    this.updateProgress(attemptId, counts, result.applied, result.failed);
    const state =
      result.failed === 0 ? 'SUCCEEDED' : result.applied > 0 ? 'PARTIALLY_APPLIED' : 'FAILED';
    this.finishAttempt(
      attemptId,
      state,
      counts,
      result.applied,
      result.failed,
      result.errorSummary,
    );
    return this.getAttempt(sessionId, attemptId);
  }

  private assertSession(
    session: ReturnType<ImportSessionStore['get']>,
    input: ApplyImportSessionInput,
  ): void {
    if (
      (session.destinationMode === 'PROJECT' && !session.projectId) ||
      (session.destinationMode === 'MASTER_LIBRARY' && session.projectId)
    )
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Apply is unavailable for this destination.',
        409,
      );
    if (
      session.sessionRevision !== input.expectedSessionRevision ||
      session.previewFingerprint !== input.previewFingerprint
    )
      throw new DomainError('IMPORT_PREVIEW_STALE', 'The Import review changed before Apply.', 409);
    if (session.destinationFingerprint !== input.destinationFingerprint)
      throw new DomainError(
        'IMPORT_DESTINATION_CHANGED',
        'The Import destination changed before Apply.',
        409,
      );
    if (session.applyPlanFingerprint !== input.applyPlanFingerprint)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Apply plan changed before Apply.', 409);
  }

  private planCounts(sessionId: string, rows: Row[]): ImportApplyPlanSummary {
    const counts = { ...EMPTY_COUNTS };
    for (const row of rows) {
      const action = json<ImportRowAction | null>(row.intended_action, null);
      if (!action) continue;
      if (action.type === 'PROJECT_CREATE_ONLY') counts.createProjectOnly += 1;
      else if (action.type === 'PROJECT_ADD_FROM_LIBRARY') counts.addFromLibrary += 1;
      else if (action.type === 'PROJECT_UPDATE_EXISTING' && action.targetKind === 'LIBRARY_LINKED')
        counts.updateLinkedProjectFields += 1;
      else if (action.type === 'PROJECT_UPDATE_EXISTING') counts.updateProjectOnly += 1;
      else if (action.type === 'LIBRARY_CREATE_DRAFT') counts.createLibraryDraft += 1;
      else if (action.type === 'LIBRARY_USE_EXISTING') counts.useExistingLibrary += 1;
      else if (action.type === 'LIBRARY_REVIEW_EXISTING') counts.reviewExistingLibrary += 1;
      else counts.skip += 1;
    }
    counts.readyMutations =
      counts.createProjectOnly +
      counts.updateProjectOnly +
      counts.updateLinkedProjectFields +
      counts.addFromLibrary +
      counts.createLibraryDraft;
    const unplanned = this.database
      .prepare(
        `SELECT row_status, COUNT(*) AS count FROM import_rows WHERE import_session_id = ?
       AND apply_state <> 'APPLIED' AND intended_action IS NULL GROUP BY row_status`,
      )
      .all(sessionId) as Array<{ row_status: string; count: number }>;
    counts.blocked = unplanned
      .filter((row) => row.row_status === 'BLOCKED')
      .reduce((sum, row) => sum + row.count, 0);
    counts.unresolved = unplanned
      .filter((row) => row.row_status !== 'BLOCKED' && row.row_status !== 'SKIPPED')
      .reduce((sum, row) => sum + row.count, 0);
    counts.unresolved += counts.reviewExistingLibrary;
    return counts;
  }

  private validateRows(projectId: string, rows: Row[], allowLibraryReplay = false): void {
    for (const row of rows) {
      const action = json<ImportRowAction | null>(row.intended_action, null);
      if (!action || action.type === 'SKIP') continue;
      if (
        action.basis.sourceRowFingerprint !== String(row.source_row_fingerprint) ||
        action.basis.mappingFingerprint !== String(row.current_mapping_fingerprint) ||
        action.basis.reconciliationFingerprint !==
          json<{ reconciliationFingerprint?: string }>(row.reconciliation_json, {})
            .reconciliationFingerprint
      )
        throw new DomainError(
          'IMPORT_PLAN_STALE',
          'Persisted row authority changed after planning.',
          409,
        );
      if (
        action.type === 'PROJECT_CREATE_ONLY' ||
        (action.type === 'PROJECT_ADD_FROM_LIBRARY' && !allowLibraryReplay)
      ) {
        if (
          (this.writes
            .canonicalMatches(projectId, [action.canonicalTag])
            .get(normalizeLuminaireTag(action.canonicalTag))?.length ?? 0) !== 0
        )
          throw new DomainError(
            'IMPORT_DESTINATION_CHANGED',
            'A planned Project Tag is no longer available.',
            409,
          );
      }
      if (action.type === 'PROJECT_UPDATE_EXISTING') {
        const current = this.writes.get(projectId, action.projectLuminaireId);
        if (
          current.rowVersion !== action.expectedProjectRowVersion ||
          normalizeLuminaireTag(current.tag) !== normalizeLuminaireTag(action.expectedCanonicalTag)
        )
          throw new DomainError(
            'IMPORT_TARGET_CHANGED',
            'A planned Project Luminaire changed.',
            409,
          );
        if (action.targetKind === 'LIBRARY_LINKED') {
          const binding = this.database
            .prepare(
              'SELECT row_version FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
            )
            .get(projectId, action.projectLuminaireId) as { row_version: number } | undefined;
          if (!binding || binding.row_version !== action.expectedBindingRowVersion)
            throw new DomainError(
              'IMPORT_TARGET_CHANGED',
              'The Project Library binding changed.',
              409,
            );
        }
      }
      if (action.type === 'PROJECT_ADD_FROM_LIBRARY') {
        const available = this.database
          .prepare(
            `SELECT m.row_version AS manufacturer_version, p.row_version AS product_version,
                  v.row_version AS variant_version, m.status AS manufacturer_status,
                  p.status AS product_status, v.status AS variant_status
             FROM luminaire_library_versions lv
             JOIN luminaire_library_variants v ON v.variant_id = lv.variant_id
             JOIN luminaire_library_products p ON p.product_id = v.product_id
             JOIN luminaire_manufacturers m ON m.manufacturer_id = p.manufacturer_id
            WHERE lv.version_id = ? AND m.manufacturer_id = ? AND p.product_id = ? AND v.variant_id = ?`,
          )
          .get(action.versionId, action.manufacturerId, action.productId, action.variantId) as
          Row | undefined;
        if (
          !available ||
          ['manufacturer_status', 'product_status', 'variant_status'].some(
            (key) => available[key] !== 'ACTIVE',
          ) ||
          Number(available.manufacturer_version) !== action.expectedManufacturerRowVersion ||
          Number(available.product_version) !== action.expectedProductRowVersion ||
          Number(available.variant_version) !== action.expectedVariantRowVersion
        )
          throw new DomainError(
            'IMPORT_LIBRARY_VERSION_UNAVAILABLE',
            'The selected Published Version is no longer eligible.',
            409,
          );
      }
    }
  }

  private createAttempt(
    sessionId: string,
    input: ApplyImportSessionInput,
    counts: ImportApplyPlanSummary,
  ): string {
    const id = this.uuid();
    const now = this.clock().toISOString();
    try {
      this.store.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO import_apply_attempts
           (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
            preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, state,
            total_count, counts_json, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          )
          .run(
            id,
            sessionId,
            input.idempotencyKey,
            input.expectedSessionRevision,
            input.previewFingerprint,
            input.applyPlanFingerprint,
            input.destinationFingerprint,
            counts.readyMutations + counts.useExistingLibrary + counts.skip,
            JSON.stringify({ ...counts, ...EMPTY_RESULT_COUNTS, applied: 0, failed: 0 }),
            now,
            now,
          );
        this.database
          .prepare(
            `UPDATE import_rows SET apply_state = 'PENDING', updated_at = ?
           WHERE import_session_id = ? AND intended_action IS NOT NULL
             AND row_status IN ('READY', 'SKIPPED') AND apply_state <> 'APPLIED'`,
          )
          .run(now, sessionId);
      });
    } catch {
      const existing = this.database
        .prepare(
          `SELECT * FROM import_apply_attempts WHERE import_session_id = ? AND state IN ('PENDING','IN_PROGRESS')`,
        )
        .get(sessionId) as Row | undefined;
      if (existing)
        throw new DomainError(
          'IMPORT_APPLY_ALREADY_RUNNING',
          'An Apply Attempt is already running.',
          409,
        );
      throw new DomainError('CONFLICT', 'The Apply Attempt could not be started.', 409);
    }
    return id;
  }

  private createNoopAttempt(
    sessionId: string,
    input: ApplyImportSessionInput,
    counts: ImportApplyPlanSummary,
  ): ImportApplyAttemptRead {
    const id = this.uuid();
    const now = this.clock().toISOString();
    this.database
      .prepare(
        `INSERT INTO import_apply_attempts
       (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
        preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, state,
        total_count, counts_json, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        input.idempotencyKey,
        input.expectedSessionRevision,
        input.previewFingerprint,
        input.applyPlanFingerprint,
        input.destinationFingerprint,
        JSON.stringify({ ...counts, ...EMPTY_RESULT_COUNTS, applied: 0, failed: 0 }),
        now,
        now,
        now,
      );
    return this.getAttempt(sessionId, id);
  }

  private async applyRow(
    projectId: string,
    sessionId: string,
    attemptId: string,
    row: Row,
    planFingerprint: string,
    actor: AppUser,
  ): Promise<void> {
    const action = json<ImportProjectRowAction | null>(row.intended_action, null);
    if (!action)
      throw new DomainError('IMPORT_ACTION_INVALID', 'The row has no Owner action.', 409);
    if (action.type === 'PROJECT_ADD_FROM_LIBRARY') {
      const result = await this.library.addProjectLuminaire(
        projectId,
        {
          versionId: action.versionId,
          tag: action.canonicalTag,
          category: action.project.category,
          location: action.project.location,
          unit: action.project.unit,
          quantity: action.project.quantity,
          notes: action.project.notes,
          descriptionOverride: action.project.descriptionOverride || null,
          idempotencyKey: `import:${sessionId}:${String(row.import_row_id)}:${planFingerprint}`,
        },
        actor,
      );
      this.store.transaction(() =>
        this.markApplied(sessionId, attemptId, row, {
          outcome: 'LIBRARY_ADDED',
          mutationOccurred: true,
          projectLuminaireId: result.luminaireId,
          libraryVersionId: action.versionId,
        }),
      );
      return;
    }
    this.store.transaction(() =>
      this.applyProjectRow(projectId, sessionId, attemptId, row, action, actor),
    );
  }

  private applyProjectRow(
    projectId: string,
    sessionId: string,
    attemptId: string,
    row: Row,
    action: Exclude<ImportProjectRowAction, { type: 'PROJECT_ADD_FROM_LIBRARY' }>,
    actor: AppUser,
  ): void {
    if (action.type === 'SKIP') {
      this.markApplied(sessionId, attemptId, row, {
        outcome: 'SKIPPED',
        mutationOccurred: false,
        projectLuminaireId: null,
        libraryVersionId: null,
      });
    } else if (action.type === 'PROJECT_CREATE_ONLY') {
      const created = this.writes.create(
        projectId,
        luminaireRecordSchema.parse({
          ...action.payload,
          imagePath: '',
          datasheetPath: '',
          sourceName: 'Smart Import',
        }),
      );
      this.markApplied(sessionId, attemptId, row, {
        outcome: 'CREATED',
        mutationOccurred: true,
        projectLuminaireId: created.id,
        libraryVersionId: null,
      });
    } else {
      const linked = action.targetKind === 'LIBRARY_LINKED';
      const updated = this.writes.patch(
        projectId,
        action.projectLuminaireId,
        action.expectedProjectRowVersion,
        action.expectedCanonicalTag,
        action.changes,
        linked,
      );
      const projectFieldsChanged = updated.rowVersion !== action.expectedProjectRowVersion;
      if (linked && action.descriptionOverride) {
        const binding = this.database
          .prepare(
            'SELECT selected_version_id FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ? AND row_version = ?',
          )
          .get(projectId, action.projectLuminaireId, action.expectedBindingRowVersion) as
          { selected_version_id: string } | undefined;
        if (!binding)
          throw new DomainError(
            'IMPORT_TARGET_CHANGED',
            'The Project Library binding changed.',
            409,
          );
        const version = this.database
          .prepare('SELECT snapshot_json FROM luminaire_library_versions WHERE version_id = ?')
          .get(binding.selected_version_id) as { snapshot_json: string };
        const snapshot = json<{ technicalDescription?: string }>(version.snapshot_json, {});
        const now = this.clock().toISOString();
        this.database
          .prepare(
            `UPDATE project_luminaire_library_bindings SET description_override = ?, row_version = row_version + 1,
             updated_by_id = ?, updated_by_name = ?, updated_at = ?
             WHERE project_id = ? AND luminaire_id = ? AND row_version = ?`,
          )
          .run(
            action.descriptionOverride.after,
            actor.id,
            actor.displayName,
            now,
            projectId,
            action.projectLuminaireId,
            action.expectedBindingRowVersion,
          );
        this.database
          .prepare(
            projectFieldsChanged
              ? `UPDATE project_luminaires SET description = ?, updated_at = ? WHERE project_id = ? AND id = ?`
              : `UPDATE project_luminaires SET description = ?, row_version = row_version + 1, updated_at = ? WHERE project_id = ? AND id = ?`,
          )
          .run(
            effectiveProjectLuminaireDescription(
              snapshot.technicalDescription ?? '',
              action.descriptionOverride.after,
            ),
            now,
            projectId,
            action.projectLuminaireId,
          );
      }
      this.markApplied(sessionId, attemptId, row, {
        outcome: 'UPDATED',
        mutationOccurred: projectFieldsChanged || action.descriptionOverride !== null,
        projectLuminaireId: action.projectLuminaireId,
        libraryVersionId: null,
      });
    }
  }

  private markApplied(
    sessionId: string,
    attemptId: string,
    row: Row,
    value: Pick<
      ImportProjectResultIdentity,
      'outcome' | 'mutationOccurred' | 'projectLuminaireId' | 'libraryVersionId'
    >,
  ): void {
    const result = importResultIdentitySchema.parse({
      schemaVersion: 1,
      ...value,
      applyAttemptId: attemptId,
      appliedAt: this.clock().toISOString(),
      failureCode: null,
      retryEligible: false,
    });
    const changed = this.database
      .prepare(
        `UPDATE import_rows SET apply_state = 'APPLIED', row_status = ?, result_identity_json = ?,
       row_version = row_version + 1, updated_at = ?
       WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      )
      .run(
        value.outcome === 'SKIPPED' ? 'SKIPPED' : 'APPLIED',
        JSON.stringify(result),
        this.clock().toISOString(),
        sessionId,
        String(row.import_row_id),
      );
    if (changed.changes !== 1)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Import row was already applied.', 409);
  }

  private recordFailure(sessionId: string, attemptId: string, row: Row, error: unknown): void {
    const code = error instanceof DomainError ? error.code : 'IMPORT_APPLY_FAILED';
    const result = importResultIdentitySchema.parse({
      schemaVersion: 1,
      outcome: 'FAILED',
      mutationOccurred: false,
      projectLuminaireId: null,
      libraryVersionId: null,
      applyAttemptId: attemptId,
      appliedAt: this.clock().toISOString(),
      failureCode: code,
      retryEligible: true,
    });
    this.database
      .prepare(
        `UPDATE import_rows SET apply_state = 'FAILED', row_status = 'FAILED', result_identity_json = ?,
       row_version = row_version + 1, updated_at = ? WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      )
      .run(
        JSON.stringify(result),
        this.clock().toISOString(),
        sessionId,
        String(row.import_row_id),
      );
  }

  private updateProgress(
    attemptId: string,
    counts: ImportApplyPlanSummary,
    applied: number,
    failed: number,
  ): void {
    this.database
      .prepare(
        `UPDATE import_apply_attempts SET applied_count = ?, failed_count = ?, counts_json = ?, updated_at = ? WHERE apply_attempt_id = ?`,
      )
      .run(
        applied,
        failed,
        JSON.stringify({ ...counts, ...EMPTY_RESULT_COUNTS, applied, failed }),
        this.clock().toISOString(),
        attemptId,
      );
  }

  private terminalResultCounts(
    attemptId: string,
    counts: ImportApplyPlanSummary,
  ): ImportApplyAttemptRead['counts'] {
    const attemptRow = this.database
      .prepare('SELECT import_session_id FROM import_apply_attempts WHERE apply_attempt_id = ?')
      .get(attemptId) as { import_session_id: string } | undefined;
    if (!attemptRow) throw new DomainError('NOT_FOUND', 'Import Apply Attempt not found.', 404);
    const rows = this.database
      .prepare(
        `SELECT intended_action, result_identity_json, row_status, apply_state
           FROM import_rows WHERE import_session_id = ?`,
      )
      .all(attemptRow.import_session_id) as Row[];
    const result: ImportApplyAttemptRead['counts'] = {
      ...counts,
      ...EMPTY_RESULT_COUNTS,
      applied: 0,
      failed: 0,
    };
    for (const row of rows) {
      const identity = json<ImportResultIdentity | null>(row.result_identity_json, null);
      if (identity?.applyAttemptId === attemptId) {
        if (identity.schemaVersion === 2) {
          if (identity.outcome === 'DRAFT_CREATED') result.variantDraftsCreated += 1;
          else if (identity.outcome === 'USED_EXISTING') result.existingVariantsUsed += 1;
          else if (identity.outcome === 'SKIPPED') result.skippedResult += 1;
          else result.failed += 1;
          if (identity.manufacturerCreated) result.uniqueManufacturersCreated += 1;
          if (identity.productCreated) result.uniqueProductsCreated += 1;
          if (identity.outcome !== 'FAILED') result.applied += 1;
          continue;
        }
        if (identity.outcome === 'CREATED') result.created += 1;
        else if (identity.outcome === 'LIBRARY_ADDED') result.addedFromLibrary += 1;
        else if (identity.outcome === 'SKIPPED') result.skippedResult += 1;
        else if (identity.outcome === 'FAILED') result.failed += 1;
        else {
          const action = json<ImportRowAction | null>(row.intended_action, null);
          if (action?.type === 'PROJECT_UPDATE_EXISTING' && action.targetKind === 'LIBRARY_LINKED')
            result.updatedLinkedProjectFieldsResult += 1;
          else result.updatedProjectOnlyResult += 1;
        }
        if (identity.outcome !== 'FAILED') result.applied += 1;
        continue;
      }
      if (row.apply_state === 'APPLIED' || row.row_status === 'SKIPPED') continue;
      if (row.row_status === 'BLOCKED') result.remainingBlocked += 1;
      else result.remainingUnresolved += 1;
    }
    return result;
  }

  private finishAttempt(
    attemptId: string,
    state: ImportApplyAttemptRead['state'],
    counts: ImportApplyPlanSummary,
    _applied: number,
    _failed: number,
    errorSummary: string | null,
  ): void {
    const now = this.clock().toISOString();
    const resultCounts = this.terminalResultCounts(attemptId, counts);
    this.database
      .prepare(
        `UPDATE import_apply_attempts SET state = ?, applied_count = ?, failed_count = ?, counts_json = ?,
       error_summary = ?, updated_at = ?, completed_at = ? WHERE apply_attempt_id = ?`,
      )
      .run(
        state,
        resultCounts.applied,
        resultCounts.failed,
        JSON.stringify(resultCounts),
        errorSummary,
        now,
        now,
        attemptId,
      );
    // Library Apply also owns session completion; an attempt can succeed while
    // ready-only review still has unresolved rows, so derive this from saved results.
    const complete =
      state === 'SUCCEEDED' &&
      resultCounts.failed === 0 &&
      resultCounts.remainingBlocked === 0 &&
      resultCounts.remainingUnresolved === 0;
    this.database
      .prepare(
        `UPDATE import_sessions SET session_status = ?, completed_at = ?, updated_at = ?
      WHERE destination_mode = 'MASTER_LIBRARY' AND import_session_id =
        (SELECT import_session_id FROM import_apply_attempts WHERE apply_attempt_id = ?)`,
      )
      .run(complete ? 'COMPLETED' : 'NEEDS_REVIEW', complete ? now : null, now, attemptId);
  }
}
