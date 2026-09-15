import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** 1.0.0: additive fields required by the approved Contacts and Actions surfaces. */
export const PRODUCTION_V29_MIGRATION_ID = 'production-28-29-final-ui-relations-1.0.0';
export const PRODUCTION_V29_MIGRATION_DESCRIPTION =
  'Persist contact phone/primary flags and project-scoped Action context without changing existing identities.';
const columns = [
  ['project_contacts', 'phone', "TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 64)"],
  ['project_contacts', 'is_primary', 'INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1))'],
  ['project_actions', 'area', "TEXT NOT NULL DEFAULT '' CHECK(length(area) <= 500)"],
  ['project_actions', 'luminaire_id', 'TEXT'],
  ['project_actions', 'review_item_id', 'TEXT'],
] as const;
const ddl = columns.map(
  ([table, column, definition]) => `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
);
function hasColumn(database: DatabaseSync, table: string, column: string) {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  );
}
export function applyV29FinalUiRelations(database: DatabaseSync): void {
  const present = columns.map(([table, column]) => hasColumn(database, table, column));
  if (present.every(Boolean)) {
    validateV29FinalUiRelations(database);
    return;
  }
  if (present.some(Boolean))
    throw new Error('Version-29 migration found a partial Final UI schema.');
  for (const statement of ddl) database.exec(statement);
}
export function validateV29FinalUiRelations(database: DatabaseSync): void {
  for (const [table, column] of columns) {
    if (!hasColumn(database, table, column))
      throw new Error(`Version-29 schema missing ${table}.${column}.`);
  }
  const invalid = database
    .prepare(
      'SELECT COUNT(*) AS count FROM project_contacts WHERE phone IS NULL OR length(phone)>64 OR is_primary NOT IN (0,1)',
    )
    .get() as { count: number };
  if (invalid.count) throw new Error('Version-29 contact data is invalid.');
}
/** Explicit rollback refuses to discard values written after the upgrade. */
export function rollbackV29FinalUiRelations(database: DatabaseSync): void {
  const present = columns.map(([table, column]) => hasColumn(database, table, column));
  if (present.every((value) => !value)) return;
  if (!present.every(Boolean))
    throw new Error('Version-29 rollback found a partial Final UI schema.');
  const contacts = database
    .prepare("SELECT COUNT(*) AS count FROM project_contacts WHERE phone<>'' OR is_primary<>0")
    .get() as { count: number };
  const actions = database
    .prepare(
      "SELECT COUNT(*) AS count FROM project_actions WHERE area<>'' OR luminaire_id IS NOT NULL OR review_item_id IS NOT NULL",
    )
    .get() as { count: number };
  if (contacts.count || actions.count)
    throw new Error('Version-29 rollback is blocked while Final UI data exists.');
  for (const [table, column] of [...columns].reverse())
    database.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}
export function computeV29MigrationChecksum(): string {
  return createHash('sha256')
    .update([PRODUCTION_V29_MIGRATION_ID, ...ddl].join('\n'))
    .digest('hex');
}
