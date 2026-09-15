import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { MigrationContext } from '../types';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_V10_MIGRATION_ID,
} from './production-migration-registry';

function createV9Database(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE project_review_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, reference TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, area TEXT NOT NULL,
      luminaire_tag TEXT NOT NULL, drawing_reference TEXT NOT NULL,
      source_type TEXT NOT NULL, source_id TEXT, status TEXT NOT NULL,
      response TEXT NOT NULL, revision_id TEXT, received_at TEXT NOT NULL,
      due_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE project_documents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
      document_number TEXT NOT NULL, title TEXT NOT NULL, revision TEXT NOT NULL,
      status TEXT NOT NULL, file_path TEXT NOT NULL, issued_to TEXT NOT NULL,
      issue_date TEXT, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE unrelated (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO project_review_items VALUES
      ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
       'C-01', 'Legacy', 'Description', 'Area', 'Dl01', 'L-101', 'Email', NULL,
       'Accepted', 'Historical response', '30000000-0000-4000-8000-000000000001',
       '2026-08-01', '2026-08-02', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    INSERT INTO unrelated VALUES ('keep', 'unchanged');
    PRAGMA user_version = 9;
  `);
  return database;
}

describe('production v9 to v10 Comments thread migration', () => {
  it('is additive, restart-safe, and preserves legacy Review authority without fabricated backfill', () => {
    const database = createV9Database();
    const migration = PRODUCTION_MIGRATIONS.find(
      (item) => item.id === PRODUCTION_V10_MIGRATION_ID,
    )!;
    const context: MigrationContext = {
      database,
      migrationId: migration.id,
      fromVersion: 9,
      toVersion: 10,
      clock: { now: () => new Date('2026-08-16T00:00:00.000Z') },
    };
    migration.up(context);
    migration.validate?.(context);
    migration.up(context);
    migration.validate?.(context);

    const row = database.prepare('SELECT * FROM project_review_items').get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      source_type: 'Email',
      status: 'Accepted',
      response: 'Historical response',
      revision_id: '30000000-0000-4000-8000-000000000001',
      luminaire_tag: 'Dl01',
      received_at: '2026-08-01',
      due_date: '2026-08-02',
      origin: null,
      author_id: null,
      author_name_snapshot: null,
      author_role_snapshot: null,
      luminaire_id: null,
    });
    expect(database.prepare('SELECT value FROM unrelated WHERE id = ?').get('keep')).toEqual({
      value: 'unchanged',
    });
    const attachmentSql = (
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_review_attachments'",
        )
        .get() as { sql: string }
    ).sql;
    expect(attachmentSql).toContain('CHECK((review_item_id IS NOT NULL AND reply_id IS NULL)');
    expect(PRODUCTION_SCHEMA_TARGET_VERSION).toBe(30);
    expect(migration).toMatchObject({ fromVersion: 9, toVersion: 10 });
    database.close();
  });
});
