import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** 1.0.0: blank email is absent data, not a shared contact identity. */
export const PRODUCTION_V30_MIGRATION_ID = 'production-29-30-optional-contact-email-1.0.0';
const indexSql =
  "CREATE UNIQUE INDEX ux_project_contacts_nonempty_email ON project_contacts(project_id,email COLLATE NOCASE) WHERE email<>''";
const unique = /UNIQUE\s*\(\s*project_id\s*,\s*email\s*\)/i;
const optional = 'CHECK(length(email)<=320)';
function schema(database: DatabaseSync): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='project_contacts'")
    .get() as { sql: string } | undefined;
  if (!row) throw new Error('Contact table is missing.');
  return row.sql;
}
function rebuild(database: DatabaseSync, sql: string) {
  const columns = (
    database.prepare('PRAGMA table_info(project_contacts)').all() as { name: string }[]
  )
    .map((row) => '"' + row.name.replaceAll('"', '""') + '"')
    .join(',');
  database.exec('SAVEPOINT optional_contact_email');
  try {
    database.exec(
      sql.replace(
        /(CREATE TABLE\s+)(?:"project_contacts"|project_contacts)/i,
        '$1project_contacts_email_upgrade',
      ),
    );
    database.exec(
      `INSERT INTO project_contacts_email_upgrade (${columns}) SELECT ${columns} FROM project_contacts`,
    );
    database.exec(
      'DROP TABLE project_contacts; ALTER TABLE project_contacts_email_upgrade RENAME TO project_contacts',
    );
    database.exec('RELEASE optional_contact_email');
  } catch (error) {
    database.exec('ROLLBACK TO optional_contact_email; RELEASE optional_contact_email');
    throw error;
  }
}
export function applyV30OptionalContactEmail(database: DatabaseSync): void {
  const sql = schema(database);
  if (!unique.test(sql)) {
    validateV30OptionalContactEmail(database);
    return;
  }
  database.exec('SAVEPOINT apply_optional_contact_email');
  try {
    rebuild(database, sql.replace(unique, optional));
    database.exec(indexSql);
    validateV30OptionalContactEmail(database);
    database.exec('RELEASE apply_optional_contact_email');
  } catch (error) {
    database.exec('ROLLBACK TO apply_optional_contact_email; RELEASE apply_optional_contact_email');
    throw error;
  }
}
export function validateV30OptionalContactEmail(database: DatabaseSync): void {
  if (unique.test(schema(database)) || !schema(database).includes(optional))
    throw new Error('Optional contact email constraint is missing.');
  const index = database
    .prepare("SELECT sql FROM sqlite_schema WHERE name='ux_project_contacts_nonempty_email'")
    .get() as { sql: string } | undefined;
  if (index?.sql !== indexSql) throw new Error('Nonempty contact email uniqueness is missing.');
}
/** No record is deleted to satisfy an older constraint. */
export function rollbackV30OptionalContactEmail(database: DatabaseSync): void {
  const sql = schema(database);
  if (unique.test(sql)) return;
  validateV30OptionalContactEmail(database);
  if (
    database
      .prepare(
        "SELECT project_id FROM project_contacts WHERE email='' GROUP BY project_id HAVING count(*)>1 LIMIT 1",
      )
      .get()
  )
    throw new Error(
      'Rollback blocked: multiple contacts without email must be resolved before downgrade.',
    );
  rebuild(database, sql.replace(optional, 'UNIQUE(project_id, email)'));
}
export const computeV30MigrationChecksum = () =>
  createHash('sha256')
    .update([PRODUCTION_V30_MIGRATION_ID, optional, indexSql].join('\n'))
    .digest('hex');
