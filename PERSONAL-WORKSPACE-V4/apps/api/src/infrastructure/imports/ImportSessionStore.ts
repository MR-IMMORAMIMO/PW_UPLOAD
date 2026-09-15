import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, type AppUser, type ImportRowStatus } from '@scli/domain';
import {
  importReconciliationSchema,
  importResultIdentitySchema,
  importRowActionSchema,
  type CreateImportSessionInput,
  type ImportHistoryPage,
  type ImportHistoryQuery,
  type ImportRowRead,
  type ImportRowsPage,
  type ImportRowsQuery,
  type ImportSessionRead,
  type ImportSourceTableRead,
  type ImportReconciliation,
  type ImportResultIdentity,
  type ImportRowAction,
  type UpdateImportTableInput,
} from '@scli/contracts';

type Row = Readonly<Record<string, unknown>>;
export interface ImportRowPersistence {
  importRowId: string;
  sourceRowNumber: number;
  sourceRowKey: string;
  sourceRowFingerprint: string;
  rawCells: unknown[];
  mappedCandidate: Record<string, unknown>;
  normalizationEvidence: unknown[];
  validationReasons: unknown[];
  rowStatus: 'READY' | 'NEEDS_REVIEW' | 'BLOCKED';
}

export interface ImportTablePersistence {
  sourceTableId: string;
  tableKey: string;
  tableName: string;
  sourceOrdinal: number;
  visibilityState: 'VISIBLE' | 'HIDDEN' | 'VERY_HIDDEN';
  detectedRegion: Record<string, unknown>;
  headerRow: number | null;
  selected: boolean;
  headerSignature: string;
  mapping: unknown[];
  mappingFingerprint: string;
  rows: ImportRowPersistence[];
}

export interface ImportInspectionPersistence {
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sourceExtension: '.csv' | '.tsv' | '.xlsx';
  detectedAdapterId: string;
  detectedAdapterVersion: string;
  detection: Record<string, unknown>;
  destinationFingerprint: string;
  previewFingerprint: string;
  status: 'READY_FOR_REVIEW' | 'NEEDS_REVIEW' | 'BLOCKED';
  tables: ImportTablePersistence[];
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function strictJson<T>(value: unknown, schema: { parse(input: unknown): T }): T | null {
  if (value === null || typeof value !== 'string') return null;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new DomainError('CONFLICT', 'Persisted Smart Import authority is invalid.', 409);
  }
}

function planSummary(database: DatabaseSync, id: string): ImportSessionRead['applyPlan'] {
  const summary = {
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
  };
  const rows = database
    .prepare(
      `SELECT row_status, intended_action FROM import_rows
     WHERE import_session_id = ? AND apply_state <> 'APPLIED'`,
    )
    .all(id) as Row[];
  for (const row of rows) {
    const action =
      row.intended_action === null ? null : json<ImportRowAction | null>(row.intended_action, null);
    if (!action) {
      if (row.row_status === 'BLOCKED') summary.blocked += 1;
      else if (row.row_status !== 'SKIPPED') summary.unresolved += 1;
    } else if (action.type === 'PROJECT_CREATE_ONLY') summary.createProjectOnly += 1;
    else if (action.type === 'PROJECT_ADD_FROM_LIBRARY') summary.addFromLibrary += 1;
    else if (action.type === 'PROJECT_UPDATE_EXISTING' && action.targetKind === 'LIBRARY_LINKED')
      summary.updateLinkedProjectFields += 1;
    else if (action.type === 'PROJECT_UPDATE_EXISTING') summary.updateProjectOnly += 1;
    else if (action.type === 'LIBRARY_CREATE_DRAFT') summary.createLibraryDraft += 1;
    else if (action.type === 'LIBRARY_USE_EXISTING') summary.useExistingLibrary += 1;
    else if (action.type === 'LIBRARY_REVIEW_EXISTING') summary.reviewExistingLibrary += 1;
    else summary.skip += 1;
  }
  summary.readyMutations =
    summary.createProjectOnly +
    summary.updateProjectOnly +
    summary.updateLinkedProjectFields +
    summary.addFromLibrary +
    summary.createLibraryDraft;
  return summary;
}

function sessionRead(database: DatabaseSync, row: Row): ImportSessionRead {
  return {
    importSessionId: String(row.import_session_id),
    sourceFileName: row.source_file_name === null ? null : String(row.source_file_name),
    sourceSha256: row.source_sha256 === null ? null : String(row.source_sha256),
    sourceSizeBytes: row.source_size_bytes === null ? null : Number(row.source_size_bytes),
    sourceExtension:
      row.source_extension === null
        ? null
        : (row.source_extension as ImportSessionRead['sourceExtension']),
    detectedAdapterId:
      row.detected_adapter_id === null
        ? null
        : (row.detected_adapter_id as ImportSessionRead['detectedAdapterId']),
    detectedAdapterVersion:
      row.detected_adapter_version === null ? null : String(row.detected_adapter_version),
    destinationMode: row.destination_mode as ImportSessionRead['destinationMode'],
    projectId: row.project_id === null ? null : String(row.project_id),
    sessionStatus: row.session_status as ImportSessionRead['sessionStatus'],
    sessionRevision: Number(row.session_revision),
    detection: json(row.detection_json, {}),
    destinationFingerprint:
      row.destination_fingerprint === null ? null : String(row.destination_fingerprint),
    previewFingerprint: row.preview_fingerprint === null ? null : String(row.preview_fingerprint),
    applyPlanFingerprint:
      row.apply_plan_fingerprint == null ? null : String(row.apply_plan_fingerprint),
    applyPlan: planSummary(database, String(row.import_session_id)),
    actorId: String(row.actor_id),
    actorName: String(row.actor_name),
    counts: {
      total: Number(row.total_count),
      ready: Number(row.ready_count),
      review: Number(row.review_count),
      blocked: Number(row.blocked_count),
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    previousSessionId: row.previous_session_id === null ? null : String(row.previous_session_id),
  };
}

function tableRead(row: Row): ImportSourceTableRead {
  return {
    sourceTableId: String(row.source_table_id),
    importSessionId: String(row.import_session_id),
    tableKey: String(row.table_key),
    tableName: String(row.table_name),
    sourceOrdinal: Number(row.source_ordinal),
    visibilityState: row.visibility_state as ImportSourceTableRead['visibilityState'],
    detectedRegion: json(row.detected_region_json, {}),
    headerRow: row.header_row === null ? null : Number(row.header_row),
    selected: Number(row.selected) === 1,
    headerSignature: String(row.header_signature),
    mapping: json(row.mapping_json, []),
    mappingFingerprint: String(row.mapping_fingerprint),
    rowVersion: Number(row.row_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowRead(row: Row): ImportRowRead {
  return {
    importRowId: String(row.import_row_id),
    importSessionId: String(row.import_session_id),
    sourceTableId: String(row.source_table_id),
    sourceRowNumber: Number(row.source_row_number),
    sourceRowKey: String(row.source_row_key),
    sourceRowFingerprint: String(row.source_row_fingerprint),
    rawCells: json(row.raw_cells_json, []),
    mappedCandidate: json(row.mapped_candidate_json, {}),
    normalizationEvidence: json(row.normalization_evidence_json, []),
    validationReasons: json(row.validation_reasons_json, []),
    rowStatus: row.row_status as ImportRowStatus,
    reconciliation: strictJson<ImportReconciliation>(
      row.reconciliation_json,
      importReconciliationSchema,
    ),
    intendedAction: strictJson<ImportRowAction>(row.intended_action, importRowActionSchema),
    applyState: row.apply_state as ImportRowRead['applyState'],
    resultIdentity: strictJson<ImportResultIdentity>(
      row.result_identity_json,
      importResultIdentitySchema,
    ),
    rowVersion: Number(row.row_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ImportSessionStore {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getDatabase(): DatabaseSync {
    return this.database;
  }

  public transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  public create(input: CreateImportSessionInput, actor: AppUser): ImportSessionRead {
    const id = randomUUID();
    const now = this.clock().toISOString();
    this.database
      .prepare(
        `INSERT INTO import_sessions
      (import_session_id, destination_mode, project_id, session_status, actor_id, actor_name, created_at, updated_at, previous_session_id)
      VALUES (?, ?, ?, 'INSPECTING', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.destinationMode,
        input.projectId ?? null,
        actor.id,
        actor.displayName,
        now,
        now,
        input.previousSessionId ?? null,
      );
    return this.get(id);
  }

  public get(id: string): ImportSessionRead {
    const row = this.database
      .prepare('SELECT * FROM import_sessions WHERE import_session_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Import Session not found.', 404);
    return sessionRead(this.database, row);
  }

  /** Retain the audit record, but never abandon an inspected or applying session. */
  public cancelEmptySelection(id: string): ImportSessionRead {
    const changed = this.database
      .prepare(
        `UPDATE import_sessions SET session_status = 'ABANDONED', updated_at = ?
      WHERE import_session_id = ? AND source_sha256 IS NULL AND session_status IN ('INSPECTING', 'ABANDONED')
      AND NOT EXISTS (SELECT 1 FROM import_rows WHERE import_session_id = ?)`,
      )
      .run(this.clock().toISOString(), id, id);
    if (!changed.changes)
      throw new DomainError('CONFLICT', 'Only an empty source selection can be cancelled.', 409);
    return this.get(id);
  }

  public list(actorId: string, query: ImportHistoryQuery): ImportHistoryPage {
    const total = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM import_sessions WHERE actor_id = ? AND NOT (session_status = 'ABANDONED' AND source_sha256 IS NULL)",
      )
      .get(actorId) as { count: number };
    const rows = this.database
      .prepare(
        `SELECT * FROM import_sessions WHERE actor_id = ? AND NOT (session_status = 'ABANDONED' AND source_sha256 IS NULL) ORDER BY created_at DESC, import_session_id LIMIT ? OFFSET ?`,
      )
      .all(actorId, query.limit, query.page * query.limit) as Row[];
    return {
      items: rows.map((row) => sessionRead(this.database, row)),
      page: query.page,
      pageSize: query.limit,
      totalCount: total.count,
    };
  }

  public persistInspection(id: string, inspection: ImportInspectionPersistence): ImportSessionRead {
    this.assertReviewMutable(id);
    const now = this.clock().toISOString();
    let ready = 0;
    let review = 0;
    let blocked = 0;
    for (const table of inspection.tables)
      for (const row of table.rows) {
        if (!table.selected) continue;
        if (row.rowStatus === 'READY') ready += 1;
        else if (row.rowStatus === 'NEEDS_REVIEW') review += 1;
        else blocked += 1;
      }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM import_rows WHERE import_session_id = ?').run(id);
      this.database.prepare('DELETE FROM import_source_tables WHERE import_session_id = ?').run(id);
      const insertTable = this.database.prepare(`INSERT INTO import_source_tables
        (source_table_id, import_session_id, table_key, table_name, source_ordinal, visibility_state, detected_region_json,
         header_row, selected, header_signature, mapping_json, mapping_fingerprint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertRow = this.database.prepare(`INSERT INTO import_rows
        (import_row_id, import_session_id, source_table_id, source_row_number, source_row_key, source_row_fingerprint,
         raw_cells_json, mapped_candidate_json, normalization_evidence_json, validation_reasons_json, row_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const table of inspection.tables) {
        insertTable.run(
          table.sourceTableId,
          id,
          table.tableKey,
          table.tableName,
          table.sourceOrdinal,
          table.visibilityState,
          JSON.stringify(table.detectedRegion),
          table.headerRow,
          table.selected ? 1 : 0,
          table.headerSignature,
          JSON.stringify(table.mapping),
          table.mappingFingerprint,
          now,
          now,
        );
        for (const row of table.rows)
          insertRow.run(
            row.importRowId,
            id,
            table.sourceTableId,
            row.sourceRowNumber,
            row.sourceRowKey,
            row.sourceRowFingerprint,
            JSON.stringify(row.rawCells),
            JSON.stringify(row.mappedCandidate),
            JSON.stringify(row.normalizationEvidence),
            JSON.stringify(row.validationReasons),
            row.rowStatus,
            now,
            now,
          );
      }
      this.database
        .prepare(
          `UPDATE import_sessions SET source_file_name = ?, source_sha256 = ?, source_size_bytes = ?, source_extension = ?,
        detected_adapter_id = ?, detected_adapter_version = ?, session_status = ?, session_revision = session_revision + 1, detection_json = ?,
        destination_fingerprint = ?, preview_fingerprint = ?, total_count = ?, ready_count = ?, review_count = ?, blocked_count = ?, updated_at = ?
        WHERE import_session_id = ?`,
        )
        .run(
          inspection.sourceFileName,
          inspection.sourceSha256,
          inspection.sourceSizeBytes,
          inspection.sourceExtension,
          inspection.detectedAdapterId,
          inspection.detectedAdapterVersion,
          inspection.status,
          JSON.stringify(inspection.detection),
          inspection.destinationFingerprint,
          inspection.previewFingerprint,
          ready + review + blocked,
          ready,
          review,
          blocked,
          now,
          id,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.get(id);
  }

  public tables(id: string): ImportSourceTableRead[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM import_source_tables WHERE import_session_id = ? ORDER BY source_ordinal, source_table_id',
        )
        .all(id) as Row[]
    ).map(tableRead);
  }

  public updateTable(
    id: string,
    tableId: string,
    input: UpdateImportTableInput,
    mappingFingerprint: string,
    headerSignature?: string,
  ): ImportSourceTableRead {
    this.assertReviewMutable(id);
    const session = this.get(id);
    if (session.sessionRevision !== input.expectedSessionRevision)
      throw new DomainError(
        'CONFLICT',
        'Import Session changed. Refresh before editing mapping.',
        409,
        { latestSessionRevision: session.sessionRevision },
      );
    const currentRow = this.database
      .prepare(
        'SELECT * FROM import_source_tables WHERE source_table_id = ? AND import_session_id = ?',
      )
      .get(tableId, id) as Row | undefined;
    if (!currentRow) throw new DomainError('NOT_FOUND', 'Import source table not found.', 404);
    const current = tableRead(currentRow);
    if (current.rowVersion !== input.expectedRowVersion)
      throw new DomainError(
        'CONFLICT',
        'Source table mapping changed. Refresh before editing.',
        409,
        { latestRowVersion: current.rowVersion },
      );
    const now = this.clock().toISOString();
    this.database
      .prepare(
        `UPDATE import_source_tables SET selected = ?, header_row = ?, header_signature = ?, mapping_json = ?, mapping_fingerprint = ?, row_version = row_version + 1, updated_at = ?
      WHERE source_table_id = ? AND import_session_id = ?`,
      )
      .run(
        input.selected === undefined ? (current.selected ? 1 : 0) : input.selected ? 1 : 0,
        input.headerRow ?? current.headerRow,
        headerSignature ?? current.headerSignature,
        JSON.stringify(input.mapping ?? current.mapping),
        mappingFingerprint,
        now,
        tableId,
        id,
      );
    const hasApplyPlan = (
      this.database.prepare('PRAGMA table_info(import_sessions)').all() as Array<{ name: string }>
    ).some((column) => column.name === 'apply_plan_fingerprint');
    this.database
      .prepare(
        hasApplyPlan
          ? `UPDATE import_sessions SET session_status = 'INSPECTING', session_revision = session_revision + 1,
           apply_plan_fingerprint = NULL, updated_at = ? WHERE import_session_id = ?`
          : `UPDATE import_sessions SET session_status = 'INSPECTING', session_revision = session_revision + 1,
           updated_at = ? WHERE import_session_id = ?`,
      )
      .run(now, id);
    return tableRead(
      this.database
        .prepare('SELECT * FROM import_source_tables WHERE source_table_id = ?')
        .get(tableId) as Row,
    );
  }

  public replaceReviewRows(
    id: string,
    tables: ImportTablePersistence[],
    previewFingerprint: string,
    status: 'READY_FOR_REVIEW' | 'NEEDS_REVIEW' | 'BLOCKED',
  ): ImportSessionRead {
    this.assertReviewMutable(id);
    const now = this.clock().toISOString();
    let ready = 0;
    let review = 0;
    let blocked = 0;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const table of tables) {
        const current = this.database
          .prepare(
            'SELECT selected FROM import_source_tables WHERE source_table_id = ? AND import_session_id = ?',
          )
          .get(table.sourceTableId, id) as { selected: number } | undefined;
        if (!current) continue;
        this.database
          .prepare('DELETE FROM import_rows WHERE import_session_id = ? AND source_table_id = ?')
          .run(id, table.sourceTableId);
        const insert = this.database.prepare(`INSERT INTO import_rows
          (import_row_id, import_session_id, source_table_id, source_row_number, source_row_key,
           source_row_fingerprint, raw_cells_json, mapped_candidate_json, normalization_evidence_json,
           validation_reasons_json, row_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const row of table.rows) {
          insert.run(
            row.importRowId,
            id,
            table.sourceTableId,
            row.sourceRowNumber,
            row.sourceRowKey,
            row.sourceRowFingerprint,
            JSON.stringify(row.rawCells),
            JSON.stringify(row.mappedCandidate),
            JSON.stringify(row.normalizationEvidence),
            JSON.stringify(row.validationReasons),
            row.rowStatus,
            now,
            now,
          );
          if (current.selected === 1) {
            if (row.rowStatus === 'READY') ready += 1;
            else if (row.rowStatus === 'NEEDS_REVIEW') review += 1;
            else blocked += 1;
          }
        }
      }
      this.database
        .prepare(
          `UPDATE import_sessions SET session_status = ?, session_revision = session_revision + 1, preview_fingerprint = ?, total_count = ?, ready_count = ?, review_count = ?, blocked_count = ?, updated_at = ? WHERE import_session_id = ?`,
        )
        .run(status, previewFingerprint, ready + review + blocked, ready, review, blocked, now, id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.get(id);
  }

  private assertReviewMutable(id: string): void {
    const attempt = this.database
      .prepare('SELECT 1 FROM import_apply_attempts WHERE import_session_id = ? LIMIT 1')
      .get(id);
    const applied = this.database
      .prepare(
        "SELECT 1 FROM import_rows WHERE import_session_id = ? AND apply_state = 'APPLIED' LIMIT 1",
      )
      .get(id);
    if (attempt || applied)
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Source tables and mappings are immutable after Project Apply begins. Start a new Import Session.',
        409,
      );
  }

  public rows(id: string, query: ImportRowsQuery): ImportRowsPage {
    const clauses = ['import_session_id = ?'];
    const params: Array<string | number | null> = [id];
    if (query.matchQuality) {
      clauses.push(`(CASE WHEN json_extract(reconciliation_json, '$.exactLibraryMatch.variantId') IS NOT NULL OR json_extract(reconciliation_json, '$.variant.exactMatch.variantId') IS NOT NULL THEN 'EXACT'
        WHEN COALESCE(json_array_length(reconciliation_json, '$.possibleLibraryMatches'), 0) > 0 OR COALESCE(json_array_length(reconciliation_json, '$.variant.possibleMatches'), 0) > 0 THEN 'CANDIDATE'
        ELSE 'UNRESOLVED' END) = ?`);
      params.push(query.matchQuality);
    }
    if (query.sourceTableId) {
      clauses.push('source_table_id = ?');
      params.push(query.sourceTableId);
    }
    if (query.search) {
      clauses.push(
        '(instr(lower(raw_cells_json), lower(?)) > 0 OR instr(lower(mapped_candidate_json), lower(?)) > 0)',
      );
      params.push(query.search, query.search);
    }
    if (
      query.filter === 'READY' ||
      query.filter === 'NEEDS_REVIEW' ||
      query.filter === 'BLOCKED' ||
      query.filter === 'FAILED'
    ) {
      clauses.push('row_status = ?');
      params.push(query.filter);
    }
    if (query.filter === 'UNMAPPED')
      clauses.push('mapped_candidate_json LIKE \'%"confidence":"UNMAPPED"%\'');
    if (query.filter === 'MAPPING_CONFLICT')
      clauses.push('mapped_candidate_json LIKE \'%"confidence":"CONFLICT"%\'');
    const where = clauses.join(' AND ');
    const total = this.database
      .prepare(`SELECT COUNT(*) AS count FROM import_rows WHERE ${where}`)
      .get(...params) as { count: number };
    const rows = this.database
      .prepare(
        `SELECT * FROM import_rows WHERE ${where} ORDER BY source_row_number, import_row_id LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.page * query.limit) as Row[];
    const counts = this.database
      .prepare(
        `SELECT COUNT(*) AS all_count,
      SUM(CASE WHEN row_status = 'READY' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN row_status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) AS review_count,
      SUM(CASE WHEN row_status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked_count,
      SUM(CASE WHEN row_status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN mapped_candidate_json LIKE '%"confidence":"UNMAPPED"%' THEN 1 ELSE 0 END) AS unmapped_count,
      SUM(CASE WHEN mapped_candidate_json LIKE '%"confidence":"CONFLICT"%' THEN 1 ELSE 0 END) AS conflict_count,
      SUM(CASE WHEN mapped_candidate_json LIKE '%"confidence":"CONFLICT"%' OR mapped_candidate_json LIKE '%"confidence":"UNMAPPED"%' THEN 1 ELSE 0 END) AS mapping_count
      FROM import_rows WHERE import_session_id = ?`,
      )
      .get(id) as Row;
    return {
      items: rows.map(rowRead),
      page: query.page,
      pageSize: query.limit,
      totalCount: total.count,
      counts: {
        all: Number(counts.all_count ?? 0),
        ready: Number(counts.ready_count ?? 0),
        needsReview: Number(counts.review_count ?? 0),
        blocked: Number(counts.blocked_count ?? 0),
        failed: Number(counts.failed_count ?? 0),
        unmapped: Number(counts.unmapped_count ?? 0),
        mappingConflict: Number(counts.conflict_count ?? 0),
        needsMapping: Number(counts.mapping_count ?? 0),
      },
    };
  }

  public row(id: string, rowId: string): ImportRowRead {
    const row = this.database
      .prepare('SELECT * FROM import_rows WHERE import_session_id = ? AND import_row_id = ?')
      .get(id, rowId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Import row not found.', 404);
    return rowRead(row);
  }

  public allRowsForTable(id: string, tableId: string): ImportRowRead[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM import_rows WHERE import_session_id = ? AND source_table_id = ? ORDER BY source_row_number, import_row_id`,
        )
        .all(id, tableId) as Row[]
    ).map(rowRead);
  }
}
