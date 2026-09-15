import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV26DocumentIntelligence,
  PRODUCTION_V26_INDEX_NAMES,
  PRODUCTION_V26_TABLE_NAMES,
  rollbackV26DocumentIntelligence,
  validateV26DocumentIntelligence,
} from './production-v26-document-intelligence';

function migrateThrough(target: 25 | 26): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
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

describe('production v26 Document Intelligence migration', () => {
  it('upgrades exact v25 authority with normalized tables, indexes, constraints, and foreign keys', () => {
    const database = migrateThrough(25);
    validateProductionSchemaVersion(database, 25);
    applyV26DocumentIntelligence(database);
    validateV26DocumentIntelligence(database);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const names = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','index')")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    for (const name of [...PRODUCTION_V26_TABLE_NAMES, ...PRODUCTION_V26_INDEX_NAMES])
      expect(names.has(name)).toBe(true);
  });
  it('converges, is idempotent, and matches locked v26 structural authority', () => {
    const upgraded = migrateThrough(25);
    applyV26DocumentIntelligence(upgraded);
    const fresh = migrateThrough(26);
    const fingerprint = computeProductionSchemaFingerprint(fresh);
    expect(computeProductionSchemaFingerprint(upgraded)).toBe(fingerprint);
    applyV26DocumentIntelligence(fresh);
    expect(computeProductionSchemaFingerprint(fresh)).toBe(fingerprint);
    expect(fingerprint).toBe('385be58520c1a7a73f055fee3e5272347ad2ee0856196cfec00763d865004203');
    validateProductionSchemaVersion(fresh, 26);
  });
  it('rolls back an empty pre-release schema with foreign keys enabled and refuses populated data', () => {
    const database = migrateThrough(26);
    rollbackV26DocumentIntelligence(database);
    validateProductionSchemaVersion(database, 25);
    const populated = migrateThrough(26);
    populated
      .prepare(
        `INSERT INTO document_sources (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,size_bytes,media_type,original_file_name,admission_mechanism,admitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        '11111111-1111-4111-8111-111111111111',
        'DOCUMENT_STORE',
        'AVAILABLE',
        'objects/aa/hash.pdf',
        null,
        'a'.repeat(64),
        10,
        'application/pdf',
        'Rollback.pdf',
        'GLOBAL_SELECT',
        '2026-08-27T00:00:00.000Z',
      );
    expect(() => rollbackV26DocumentIntelligence(populated)).toThrow(
      /blocked while Document Intelligence records exist/,
    );
    expect(populated.prepare('SELECT COUNT(*) count FROM document_sources').get()).toEqual({
      count: 1,
    });
    validateProductionSchemaVersion(populated, 26);
  });
  it('rejects partial schema and structurally invalid source rows', () => {
    const partial = migrateThrough(25);
    partial.exec('CREATE TABLE document_sources(source_id TEXT PRIMARY KEY)');
    expect(() => applyV26DocumentIntelligence(partial)).toThrow(/partial Document Intelligence/i);
    const database = migrateThrough(26);
    expect(() =>
      database
        .prepare(
          `INSERT INTO document_sources (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,size_bytes,media_type,original_file_name,admission_mechanism,admitted_at) VALUES ('s','DOCUMENT_STORE','AVAILABLE',NULL,NULL,?,1,'application/pdf','a.pdf','GLOBAL_SELECT',?)`,
        )
        .run('a'.repeat(64), new Date().toISOString()),
    ).toThrow();
  });
});
