import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V24_MIGRATION_ID =
  'production-23-24-smart-import-persistent-inspection-foundation';
export const PRODUCTION_V24_MIGRATION_DESCRIPTION =
  'Add persistent Smart Import sessions, source tables, raw review rows, and reserved apply-attempt lineage.';

export const PRODUCTION_V24_TABLE_NAMES = Object.freeze([
  'import_sessions',
  'import_source_tables',
  'import_rows',
  'import_apply_attempts',
] as const);

export const PRODUCTION_V24_INDEX_NAMES = Object.freeze([
  'ix_import_sessions_source_destination',
  'ix_import_sessions_history',
  'ux_import_source_tables_session_key',
  'ix_import_source_tables_session_ordinal',
  'ux_import_rows_source_ordinal',
  'ix_import_rows_session_status',
  'ix_import_rows_session_apply_state',
  'ux_import_apply_attempts_idempotency_key',
  'ix_import_apply_attempts_session_started',
] as const);

const V24_DDL = Object.freeze([
  `CREATE TABLE import_sessions (
    import_session_id TEXT PRIMARY KEY,
    source_file_name TEXT,
    source_sha256 TEXT CHECK(source_sha256 IS NULL OR (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
    source_size_bytes INTEGER CHECK(source_size_bytes IS NULL OR source_size_bytes >= 0),
    source_extension TEXT CHECK(source_extension IS NULL OR source_extension IN ('.csv', '.tsv', '.xlsx')),
    detected_adapter_id TEXT CHECK(detected_adapter_id IS NULL OR detected_adapter_id IN ('WORKSPACE_TEMPLATE_XLSX', 'DIALUX_NATIVE_CSV', 'WORKSPACE_OUTPUT_XLSX', 'GENERIC_XLSX', 'GENERIC_CSV')),
    detected_adapter_version TEXT,
    destination_mode TEXT NOT NULL CHECK(destination_mode IN ('PROJECT', 'MASTER_LIBRARY')),
    project_id TEXT,
    session_status TEXT NOT NULL CHECK(session_status IN ('INSPECTING', 'READY_FOR_REVIEW', 'NEEDS_REVIEW', 'BLOCKED', 'COMPLETED', 'ABANDONED', 'FAILED')),
    session_revision INTEGER NOT NULL DEFAULT 1 CHECK(session_revision >= 1),
    detection_json TEXT NOT NULL DEFAULT '{}',
    destination_fingerprint TEXT,
    preview_fingerprint TEXT,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
    ready_count INTEGER NOT NULL DEFAULT 0 CHECK(ready_count >= 0),
    review_count INTEGER NOT NULL DEFAULT 0 CHECK(review_count >= 0),
    blocked_count INTEGER NOT NULL DEFAULT 0 CHECK(blocked_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    previous_session_id TEXT,
    FOREIGN KEY(previous_session_id) REFERENCES import_sessions(import_session_id)
      ON UPDATE RESTRICT ON DELETE SET NULL,
    CHECK((destination_mode = 'PROJECT' AND project_id IS NOT NULL) OR
          (destination_mode = 'MASTER_LIBRARY' AND project_id IS NULL)),
    CHECK(total_count = ready_count + review_count + blocked_count)
  )`,
  `CREATE TABLE import_source_tables (
    source_table_id TEXT PRIMARY KEY,
    import_session_id TEXT NOT NULL,
    table_key TEXT NOT NULL,
    table_name TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL CHECK(source_ordinal >= 0),
    visibility_state TEXT NOT NULL CHECK(visibility_state IN ('VISIBLE', 'HIDDEN', 'VERY_HIDDEN')),
    detected_region_json TEXT NOT NULL,
    header_row INTEGER CHECK(header_row IS NULL OR header_row >= 1),
    selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0, 1)),
    header_signature TEXT NOT NULL,
    mapping_json TEXT NOT NULL DEFAULT '[]',
    mapping_fingerprint TEXT NOT NULL,
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(import_session_id) REFERENCES import_sessions(import_session_id)
      ON UPDATE RESTRICT ON DELETE CASCADE
  )`,
  `CREATE TABLE import_rows (
    import_row_id TEXT PRIMARY KEY,
    import_session_id TEXT NOT NULL,
    source_table_id TEXT NOT NULL,
    source_row_number INTEGER NOT NULL CHECK(source_row_number >= 1),
    source_row_key TEXT NOT NULL,
    source_row_fingerprint TEXT NOT NULL,
    raw_cells_json TEXT NOT NULL,
    mapped_candidate_json TEXT NOT NULL DEFAULT '{}',
    normalization_evidence_json TEXT NOT NULL DEFAULT '[]',
    validation_reasons_json TEXT NOT NULL DEFAULT '[]',
    row_status TEXT NOT NULL CHECK(row_status IN ('READY', 'NEEDS_REVIEW', 'BLOCKED', 'SKIPPED', 'APPLIED', 'FAILED')),
    reconciliation_json TEXT,
    intended_action TEXT,
    apply_state TEXT NOT NULL DEFAULT 'NOT_APPLIED' CHECK(apply_state IN ('NOT_APPLIED', 'PENDING', 'APPLIED', 'FAILED')),
    result_identity_json TEXT,
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(import_session_id) REFERENCES import_sessions(import_session_id)
      ON UPDATE RESTRICT ON DELETE CASCADE,
    FOREIGN KEY(source_table_id) REFERENCES import_source_tables(source_table_id)
      ON UPDATE RESTRICT ON DELETE CASCADE
  )`,
  `CREATE TABLE import_apply_attempts (
    apply_attempt_id TEXT PRIMARY KEY,
    import_session_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    expected_session_revision INTEGER NOT NULL CHECK(expected_session_revision >= 1),
    preview_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'PARTIALLY_APPLIED', 'FAILED', 'ABANDONED')),
    total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
    applied_count INTEGER NOT NULL DEFAULT 0 CHECK(applied_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
    error_summary TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(import_session_id) REFERENCES import_sessions(import_session_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK(applied_count + failed_count <= total_count)
  )`,
  `CREATE INDEX ix_import_sessions_source_destination
     ON import_sessions(source_sha256, destination_mode, project_id)`,
  `CREATE INDEX ix_import_sessions_history
     ON import_sessions(created_at DESC, import_session_id)`,
  `CREATE UNIQUE INDEX ux_import_source_tables_session_key
     ON import_source_tables(import_session_id, table_key)`,
  `CREATE INDEX ix_import_source_tables_session_ordinal
     ON import_source_tables(import_session_id, source_ordinal, source_table_id)`,
  `CREATE UNIQUE INDEX ux_import_rows_source_ordinal
     ON import_rows(import_session_id, source_table_id, source_row_number)`,
  `CREATE INDEX ix_import_rows_session_status
     ON import_rows(import_session_id, row_status, source_row_number, import_row_id)`,
  `CREATE INDEX ix_import_rows_session_apply_state
     ON import_rows(import_session_id, apply_state, source_row_number, import_row_id)`,
  `CREATE UNIQUE INDEX ux_import_apply_attempts_idempotency_key
     ON import_apply_attempts(idempotency_key)`,
  `CREATE INDEX ix_import_apply_attempts_session_started
     ON import_apply_attempts(import_session_id, started_at DESC, apply_attempt_id)`,
] as const);

function existingObjects(database: DatabaseSync): Set<string> {
  return new Set(
    (
      database
        .prepare(
          `SELECT name FROM sqlite_schema
         WHERE name IN (${[...PRODUCTION_V24_TABLE_NAMES, ...PRODUCTION_V24_INDEX_NAMES]
           .map(() => '?')
           .join(', ')})`,
        )
        .all(...PRODUCTION_V24_TABLE_NAMES, ...PRODUCTION_V24_INDEX_NAMES) as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

export function applyV24SmartImportInspection(database: DatabaseSync): void {
  const expectedCount = PRODUCTION_V24_TABLE_NAMES.length + PRODUCTION_V24_INDEX_NAMES.length;
  const present = existingObjects(database);
  if (present.size === expectedCount) return;
  if (present.size !== 0) {
    throw new Error('Version-24 migration found a partial Smart Import inspection schema.');
  }
  for (const ddl of V24_DDL) database.exec(ddl);
}

export function validateV24SmartImportInspection(database: DatabaseSync): void {
  const present = existingObjects(database);
  for (const name of [...PRODUCTION_V24_TABLE_NAMES, ...PRODUCTION_V24_INDEX_NAMES]) {
    if (!present.has(name)) throw new Error(`Version-24 migration is missing ${name}.`);
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error('Version-24 migration has foreign-key violations.');
  }
}

export function rollbackV24SmartImportInspection(database: DatabaseSync): void {
  database.exec('DROP TABLE IF EXISTS import_apply_attempts');
  database.exec('DROP TABLE IF EXISTS import_rows');
  database.exec('DROP TABLE IF EXISTS import_source_tables');
  database.exec('DROP TABLE IF EXISTS import_sessions');
}

export function computeV24MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V24_MIGRATION_ID,
        description: PRODUCTION_V24_MIGRATION_DESCRIPTION,
        ddl: V24_DDL,
      }),
      'utf8',
    )
    .digest('hex');
}
