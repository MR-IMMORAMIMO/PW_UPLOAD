import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV25SmartImportProjectApply,
  validateV25SmartImportProjectApply,
} from './production-v25-smart-import-project-apply';

function migrateThrough(target: 24 | 25): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
    });
    database.exec('COMMIT');
  }
  return database;
}

describe('production v25 Smart Import Project Apply migration', () => {
  it('upgrades exact v24 authority with row versions, apply-plan evidence, and one active attempt', () => {
    const database = migrateThrough(24);
    validateProductionSchemaVersion(database, 24);
    applyV25SmartImportProjectApply(database);
    validateV25SmartImportProjectApply(database);
    validateProductionSchemaVersion(database, 25);

    const columns = database.prepare('PRAGMA table_info(project_luminaires)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('row_version');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('makes fresh and upgraded paths converge and does not replay on restart', () => {
    const upgraded = migrateThrough(24);
    applyV25SmartImportProjectApply(upgraded);
    const fresh = migrateThrough(25);
    expect(computeProductionSchemaFingerprint(upgraded)).toBe(
      computeProductionSchemaFingerprint(fresh),
    );
    const before = computeProductionSchemaFingerprint(fresh);
    applyV25SmartImportProjectApply(fresh);
    expect(computeProductionSchemaFingerprint(fresh)).toBe(before);
  });

  it('rejects a partial v25 schema', () => {
    const database = migrateThrough(24);
    database.exec(
      'ALTER TABLE project_luminaires ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1',
    );
    expect(() => applyV25SmartImportProjectApply(database)).toThrow(/partial Smart Import/i);
  });

  it('enforces one active Apply Attempt per Import Session', () => {
    const database = migrateThrough(25);
    const now = '2026-08-27T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO import_sessions
         (import_session_id, destination_mode, project_id, session_status, actor_id, actor_name, created_at, updated_at)
         VALUES (?, 'PROJECT', ?, 'READY_FOR_REVIEW', ?, 'Owner', ?, ?)`,
      )
      .run(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        now,
        now,
      );
    const insert = database.prepare(
      `INSERT INTO import_apply_attempts
       (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
        preview_fingerprint, state, started_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    );
    insert.run(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
      'attempt-one',
      'a'.repeat(64),
      'PENDING',
      now,
      now,
    );
    expect(() =>
      insert.run(
        '55555555-5555-4555-8555-555555555555',
        '11111111-1111-4111-8111-111111111111',
        'attempt-two',
        'a'.repeat(64),
        'IN_PROGRESS',
        now,
        now,
      ),
    ).toThrow();
  });
});
