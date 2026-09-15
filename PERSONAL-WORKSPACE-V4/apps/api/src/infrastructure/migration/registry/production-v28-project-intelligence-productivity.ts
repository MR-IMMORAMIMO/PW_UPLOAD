import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * V28 — Project Intelligence & Productivity (P5D)
 *
 * Adds the minimum normalized authority for the Phase 5D scope:
 *
 *   A. project_source_files                — controlled Project source references
 *                                           (explicit owner admission, server fingerprints)
 *   B. revision_source_file_baselines      — immutable per-Revision baseline evidence
 *   C. project_actions CAS / issue-blocking — blocks_issue flag, row_version (optimistic
 *                                           concurrency), and actor snapshots on the
 *                                           existing project_actions authority.
 *
 * Revision Comparison needs NO new schema: it reads the immutable
 * canonical_revisions.luminaire_snapshot_json via the existing registry.
 * Readiness aggregates existing authorities (workspace health checks, Phase 4
 * package checks, storage health, P5C verification rows, actions, sources).
 *
 * Migration is additive only: two new tables + additive columns on
 * project_actions + one new index. No destructive column rewrite.
 */
export const PRODUCTION_V28_MIGRATION_ID = 'production-27-28-project-intelligence-productivity';
export const PRODUCTION_V28_MIGRATION_DESCRIPTION =
  'Add Project source references, Revision source baselines, and Action issue-blocking / CAS authority.';

export const PRODUCTION_V28_TABLE_NAMES = Object.freeze([
  'project_source_files',
  'revision_source_file_baselines',
] as const);

export const PRODUCTION_V28_INDEX_NAMES = Object.freeze([
  'ix_project_source_files_project',
  'ux_project_source_files_locator',
  'ix_revision_source_file_baselines_revision',
  'ix_revision_source_file_baselines_source',
  'ix_project_actions_issue_blocking',
] as const);

/** Additive CAS / issue-blocking columns applied to the existing Action authority. */
export const PRODUCTION_V28_ACTION_COLUMN_NAMES = Object.freeze([
  'blocks_issue',
  'row_version',
  'created_by_id',
  'created_by_name',
  'updated_by_id',
  'updated_by_name',
] as const);

const SOURCE_FILE_TABLE_DDL = `CREATE TABLE project_source_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('AUTOCAD','DIALUX','EXCEL','OTHER')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 260),
  original_relative_locator TEXT NOT NULL
    CHECK (length(trim(original_relative_locator)) BETWEEN 1 AND 4096
      AND trim(original_relative_locator) NOT LIKE '/%'
      AND trim(original_relative_locator) NOT LIKE '\\\\%'
      AND trim(original_relative_locator) NOT LIKE '%:%'),
  latest_hash TEXT NOT NULL
    CHECK (length(latest_hash) = 64 AND latest_hash NOT GLOB '*[^0-9a-f]*'),
  latest_size INTEGER NOT NULL
    CHECK (latest_size >= 0 AND latest_size <= 209715200),
  latest_modified_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const SOURCE_FILE_INDEXES = Object.freeze([
  `CREATE INDEX ix_project_source_files_project
    ON project_source_files(project_id, updated_at DESC)`,
  `CREATE UNIQUE INDEX ux_project_source_files_locator
    ON project_source_files(project_id, original_relative_locator)`,
] as const);

const BASELINE_TABLE_DDL = `CREATE TABLE revision_source_file_baselines (
  baseline_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL
    REFERENCES project_source_files(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  sha256 TEXT NOT NULL
    CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL
    CHECK (size_bytes >= 0 AND size_bytes <= 209715200),
  captured_at TEXT NOT NULL,
  captured_by_id TEXT NOT NULL CHECK (length(trim(captured_by_id)) > 0),
  captured_by_name TEXT NOT NULL CHECK (length(trim(captured_by_name)) > 0),
  created_at TEXT NOT NULL
)`;

const BASELINE_INDEXES = Object.freeze([
  `CREATE INDEX ix_revision_source_file_baselines_revision
    ON revision_source_file_baselines(revision_id, captured_at DESC)`,
  `CREATE INDEX ix_revision_source_file_baselines_source
    ON revision_source_file_baselines(source_file_id, revision_id, captured_at DESC)`,
] as const);

const ACTION_COLUMN_DDL = Object.freeze([
  `ALTER TABLE project_actions
    ADD COLUMN blocks_issue INTEGER NOT NULL DEFAULT 0 CHECK (blocks_issue IN (0, 1))`,
  `ALTER TABLE project_actions
    ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1)`,
  `ALTER TABLE project_actions ADD COLUMN created_by_id TEXT`,
  `ALTER TABLE project_actions ADD COLUMN created_by_name TEXT`,
  `ALTER TABLE project_actions ADD COLUMN updated_by_id TEXT`,
  `ALTER TABLE project_actions ADD COLUMN updated_by_name TEXT`,
  `CREATE INDEX ix_project_actions_issue_blocking
    ON project_actions(project_id, status, blocks_issue)`,
] as const);

function objectNames(database: DatabaseSync, type: 'table' | 'index'): Set<string> {
  return new Set(
    (
      database.prepare('SELECT name FROM sqlite_schema WHERE type = ?').all(type) as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  );
}

function actionColumnsComplete(database: DatabaseSync): boolean {
  return PRODUCTION_V28_ACTION_COLUMN_NAMES.every((name) =>
    hasColumn(database, 'project_actions', name),
  );
}

export function applyV28ProjectIntelligenceProductivity(database: DatabaseSync): void {
  const tables = objectNames(database, 'table');
  const indexes = objectNames(database, 'index');
  const complete =
    PRODUCTION_V28_TABLE_NAMES.every((name) => tables.has(name)) &&
    PRODUCTION_V28_INDEX_NAMES.every((name) => indexes.has(name)) &&
    actionColumnsComplete(database);
  if (complete) return;
  const partial =
    PRODUCTION_V28_TABLE_NAMES.some((name) => tables.has(name)) ||
    PRODUCTION_V28_INDEX_NAMES.some((name) => indexes.has(name)) ||
    PRODUCTION_V28_ACTION_COLUMN_NAMES.some((name) => hasColumn(database, 'project_actions', name));
  if (partial) throw new Error('Version-28 migration found a partial Project Intelligence schema.');

  database.exec(SOURCE_FILE_TABLE_DDL);
  for (const ddl of SOURCE_FILE_INDEXES) database.exec(ddl);
  database.exec(BASELINE_TABLE_DDL);
  for (const ddl of BASELINE_INDEXES) database.exec(ddl);
  for (const ddl of ACTION_COLUMN_DDL) database.exec(ddl);
}

/**
 * Full rollback: drops the two new tables and removes the additive Action
 * columns by rebuilding project_actions under FK-rebuild mode (same pattern as
 * the v27 document-source rebuild), preserving every pre-v28 column (including
 * the v7 action_categories.category_id and v8 owner_role/notes columns).
 * New data blocks the rollback.
 */
export function rollbackV28ProjectIntelligenceProductivity(database: DatabaseSync): void {
  const sourceCount = database
    .prepare('SELECT COUNT(*) AS count FROM project_source_files')
    .get() as { count: number };
  const baselineCount = database
    .prepare('SELECT COUNT(*) AS count FROM revision_source_file_baselines')
    .get() as { count: number };
  const actionEvidence = database
    .prepare(
      `SELECT COUNT(*) AS count FROM project_actions
       WHERE blocks_issue = 1 OR row_version > 1
          OR created_by_id IS NOT NULL OR created_by_name IS NOT NULL
          OR updated_by_id IS NOT NULL OR updated_by_name IS NOT NULL`,
    )
    .get() as { count: number };
  if (sourceCount.count > 0 || baselineCount.count > 0 || actionEvidence.count > 0) {
    throw new Error('Version-28 rollback is blocked while Project Intelligence authority exists.');
  }
  database.exec('PRAGMA foreign_keys = OFF; PRAGMA defer_foreign_keys = ON');
  try {
    database.exec('DROP TABLE revision_source_file_baselines');
    database.exec('DROP TABLE project_source_files');
    database.exec('DROP INDEX IF EXISTS ix_project_actions_issue_blocking');

    const columnSet = new Set<string>(
      (
        database.prepare('PRAGMA table_info(project_actions)').all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    if (PRODUCTION_V28_ACTION_COLUMN_NAMES.some((name) => columnSet.has(name))) {
      // Exact pre-v28 column contract: v1 base + v7 category relation + v8
      // owner role / notes. Deterministic; never derived from live rows.
      // The rebuild reproduces the ORIGINAL v27 stored SQL (base CREATE +
      // ALTER TABLE ADD COLUMN) so the structural fingerprint matches v27.
      // The table is created directly under its final name (NOT via RENAME,
      // which would quote the identifier and change the stored SQL).
      const baseColumns = [
        'id',
        'project_id',
        'title',
        'details',
        'owner',
        'due_date',
        'status',
        'priority',
        'source_type',
        'source_id',
        'revision_id',
        'completed_at',
        'created_at',
        'updated_at',
      ];
      // Stage the data in a temp table first (the original table is dropped
      // before the exact-DDL rebuild).
      database.exec(
        `CREATE TABLE project_actions__v27 (
          ${baseColumns
            .map((name) => {
              const info = (
                database.prepare(`PRAGMA table_info(project_actions)`).all() as Array<{
                  name: string;
                  type: string;
                  notnull: number;
                  dflt_value: string | null;
                }>
              ).find((column) => column.name === name);
              const type = info?.type ?? 'TEXT';
              const notNull = info?.notnull === 1 ? ' NOT NULL' : '';
              const defaultSql =
                info?.dflt_value !== null && info?.dflt_value !== undefined
                  ? ` DEFAULT ${info.dflt_value}`
                  : '';
              const primaryKey = name === 'id' ? ' PRIMARY KEY' : '';
              return `${name} ${type}${notNull}${defaultSql}${primaryKey}`;
            })
            .join(', ')}
        )`,
      );
      const preserved = [...baseColumns, 'category_id', 'owner_role', 'notes'];
      const preservedSql = preserved.join(', ');
      // The staging table mirrors the v27 column set (base + v7 category +
      // v8 owner role/notes) so the data copy is complete.
      database.exec(
        'ALTER TABLE project_actions__v27 ADD COLUMN category_id TEXT REFERENCES action_categories(id) ON UPDATE RESTRICT ON DELETE SET NULL',
      );
      database.exec(
        "ALTER TABLE project_actions__v27 ADD COLUMN owner_role TEXT NOT NULL DEFAULT ''",
      );
      database.exec("ALTER TABLE project_actions__v27 ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
      database.exec(
        `INSERT INTO project_actions__v27 (${preservedSql})
         SELECT ${preservedSql} FROM project_actions`,
      );
      database.exec('DROP TABLE project_actions');
      // Rebuild under the exact final name with the exact v27 stored SQL.
      database.exec(
        `CREATE TABLE project_actions (
          ${baseColumns
            .map((name) => {
              const info = (
                database.prepare(`PRAGMA table_info(project_actions__v27)`).all() as Array<{
                  name: string;
                  type: string;
                  notnull: number;
                  dflt_value: string | null;
                }>
              ).find((column) => column.name === name);
              const type = info?.type ?? 'TEXT';
              const notNull = info?.notnull === 1 ? ' NOT NULL' : '';
              const defaultSql =
                info?.dflt_value !== null && info?.dflt_value !== undefined
                  ? ` DEFAULT ${info.dflt_value}`
                  : '';
              const primaryKey = name === 'id' ? ' PRIMARY KEY' : '';
              return `${name} ${type}${notNull}${defaultSql}${primaryKey}`;
            })
            .join(', ')}
        )`,
      );
      // v7 category relation + v8 owner role / notes — reproduced as ALTER
      // TABLE ADD COLUMN exactly as the original migrations did.
      database.exec(
        'ALTER TABLE project_actions ADD COLUMN category_id TEXT REFERENCES action_categories(id) ON UPDATE RESTRICT ON DELETE SET NULL',
      );
      database.exec("ALTER TABLE project_actions ADD COLUMN owner_role TEXT NOT NULL DEFAULT ''");
      database.exec("ALTER TABLE project_actions ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
      database.exec(
        `INSERT INTO project_actions (${preservedSql})
         SELECT ${preservedSql} FROM project_actions__v27`,
      );
      database.exec('DROP TABLE project_actions__v27');
      database.exec(
        `CREATE INDEX IF NOT EXISTS ix_project_actions_due
          ON project_actions(project_id, status, due_date)`,
      );
      if (columnSet.has('category_id')) {
        database.exec('CREATE INDEX ix_project_actions_category ON project_actions(category_id)');
      }
    }
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

export function validateV28ProjectIntelligenceProductivity(database: DatabaseSync): void {
  const tables = objectNames(database, 'table');
  const indexes = objectNames(database, 'index');
  for (const name of PRODUCTION_V28_TABLE_NAMES)
    if (!tables.has(name)) throw new Error(`Version-28 migration is missing table ${name}.`);
  for (const name of PRODUCTION_V28_INDEX_NAMES)
    if (!indexes.has(name)) throw new Error(`Version-28 migration is missing index ${name}.`);
  if (!actionColumnsComplete(database)) {
    throw new Error('Version-28 migration is missing the Action issue-blocking / CAS columns.');
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('Version-28 Project Intelligence schema has foreign-key violations.');
  }
}

export function computeV28MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V28_MIGRATION_ID,
        description: PRODUCTION_V28_MIGRATION_DESCRIPTION,
        sourceFileTable: SOURCE_FILE_TABLE_DDL,
        sourceFileIndexes: SOURCE_FILE_INDEXES,
        baselineTable: BASELINE_TABLE_DDL,
        baselineIndexes: BASELINE_INDEXES,
        actionColumns: ACTION_COLUMN_DDL,
      }),
      'utf8',
    )
    .digest('hex');
}
