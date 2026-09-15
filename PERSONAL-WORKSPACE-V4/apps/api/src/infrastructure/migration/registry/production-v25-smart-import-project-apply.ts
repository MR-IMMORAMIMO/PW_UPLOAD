import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V25_MIGRATION_ID = 'production-24-25-smart-import-project-apply-authority';
export const PRODUCTION_V25_MIGRATION_DESCRIPTION =
  'Add Project Luminaire optimistic concurrency and hardened Smart Import apply-plan authority.';

export const PRODUCTION_V25_INDEX_NAMES = Object.freeze([
  'ix_project_luminaires_project_canonical_tag',
  'ux_import_apply_attempts_one_active',
] as const);

const REQUIRED_COLUMNS = Object.freeze({
  project_luminaires: ['row_version'],
  import_sessions: ['apply_plan_fingerprint'],
  import_apply_attempts: [
    'apply_plan_fingerprint',
    'destination_fingerprint',
    'backup_id',
    'counts_json',
    'updated_at',
  ],
} as const);

const V25_DDL = Object.freeze([
  `ALTER TABLE project_luminaires
     ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)`,
  `ALTER TABLE import_sessions ADD COLUMN apply_plan_fingerprint TEXT`,
  `ALTER TABLE import_apply_attempts ADD COLUMN apply_plan_fingerprint TEXT`,
  `ALTER TABLE import_apply_attempts ADD COLUMN destination_fingerprint TEXT`,
  `ALTER TABLE import_apply_attempts ADD COLUMN backup_id TEXT`,
  `ALTER TABLE import_apply_attempts ADD COLUMN counts_json TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE import_apply_attempts ADD COLUMN updated_at TEXT`,
  `UPDATE import_apply_attempts SET updated_at = started_at WHERE updated_at IS NULL`,
  `CREATE INDEX ix_project_luminaires_project_canonical_tag
     ON project_luminaires(project_id, LOWER(TRIM(tag)))`,
  `CREATE UNIQUE INDEX ux_import_apply_attempts_one_active
     ON import_apply_attempts(import_session_id)
     WHERE state IN ('PENDING', 'IN_PROGRESS')`,
] as const);

function columns(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
}

function currentState(database: DatabaseSync): { present: number; total: number } {
  let present = 0;
  let total = 0;
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = columns(database, table);
    for (const column of expected) {
      total += 1;
      if (actual.has(column)) present += 1;
    }
  }
  total += PRODUCTION_V25_INDEX_NAMES.length;
  const indexes = new Set(
    (
      database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  for (const index of PRODUCTION_V25_INDEX_NAMES) if (indexes.has(index)) present += 1;
  return { present, total };
}

export function applyV25SmartImportProjectApply(database: DatabaseSync): void {
  const state = currentState(database);
  if (state.present === state.total) return;
  if (state.present !== 0) {
    throw new Error('Version-25 migration found a partial Smart Import Project Apply schema.');
  }
  for (const ddl of V25_DDL) database.exec(ddl);
}

export function validateV25SmartImportProjectApply(database: DatabaseSync): void {
  const state = currentState(database);
  if (state.present !== state.total) {
    throw new Error('Version-25 Smart Import Project Apply schema is incomplete.');
  }
  const invalidVersions = database
    .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE row_version < 1')
    .get() as { count: number };
  if (invalidVersions.count > 0) {
    throw new Error('Version-25 Project Luminaire row-version authority is invalid.');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('Version-25 migration has foreign-key violations.');
  }
}

export function computeV25MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V25_MIGRATION_ID,
        description: PRODUCTION_V25_MIGRATION_DESCRIPTION,
        ddl: V25_DDL,
      }),
      'utf8',
    )
    .digest('hex');
}
