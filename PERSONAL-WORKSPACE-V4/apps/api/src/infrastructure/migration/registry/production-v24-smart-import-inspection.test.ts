import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV24SmartImportInspection,
  PRODUCTION_V24_INDEX_NAMES,
  PRODUCTION_V24_TABLE_NAMES,
  rollbackV24SmartImportInspection,
  validateV24SmartImportInspection,
} from './production-v24-smart-import-inspection';

function migrateThrough(target: 23 | 24): DatabaseSync {
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

function schemaNames(database: DatabaseSync): string[] {
  return (
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type IN ('table', 'index') AND name LIKE '%import%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

describe('production v24 Smart Import persistent inspection migration', () => {
  it('migrates exact v23 authority once and validates all tables, indexes, constraints, and FKs', () => {
    const database = migrateThrough(23);
    validateProductionSchemaVersion(database, 23);
    database.exec('BEGIN IMMEDIATE');
    applyV24SmartImportInspection(database);
    database.exec('COMMIT');
    validateV24SmartImportInspection(database);
    validateProductionSchemaVersion(database, 24);
    expect(schemaNames(database)).toEqual(
      [...PRODUCTION_V24_INDEX_NAMES, ...PRODUCTION_V24_TABLE_NAMES].sort(),
    );
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() =>
      database
        .prepare(
          `INSERT INTO import_sessions
           (import_session_id, destination_mode, project_id, session_status, actor_id, actor_name, created_at, updated_at)
           VALUES (?, 'PROJECT', NULL, 'INSPECTING', ?, 'Owner', ?, ?)`,
        )
        .run(
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '2026-08-27T00:00:00.000Z',
          '2026-08-27T00:00:00.000Z',
        ),
    ).toThrow();
  });

  it('makes fresh and historical v23 paths converge on the same v24 fingerprint', () => {
    const historical = migrateThrough(23);
    applyV24SmartImportInspection(historical);
    const fresh = migrateThrough(24);
    expect(computeProductionSchemaFingerprint(historical)).toBe(
      computeProductionSchemaFingerprint(fresh),
    );
  });

  it('is restart-safe and rejects a partial schema instead of replaying it', () => {
    const current = migrateThrough(24);
    const before = computeProductionSchemaFingerprint(current);
    applyV24SmartImportInspection(current);
    expect(computeProductionSchemaFingerprint(current)).toBe(before);

    const partial = migrateThrough(23);
    partial.exec('CREATE TABLE import_sessions (import_session_id TEXT PRIMARY KEY)');
    expect(() => applyV24SmartImportInspection(partial)).toThrow(/partial Smart Import/i);
  });

  it('provides a bounded practical rollback for pre-release recovery', () => {
    const database = migrateThrough(24);
    rollbackV24SmartImportInspection(database);
    expect(schemaNames(database)).toEqual([]);
    validateProductionSchemaVersion(database, 23);
  });
});
