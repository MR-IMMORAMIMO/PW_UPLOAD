import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV29FinalUiRelations,
  rollbackV29FinalUiRelations,
  validateV29FinalUiRelations,
} from './production-v29-final-ui-relations';

function previousSchema() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= 28)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION')
      database.exec('PRAGMA foreign_keys=OFF');
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date('2026-09-09T00:00:00Z') },
    });
    database.exec('COMMIT; PRAGMA foreign_keys=ON');
  }
  validateProductionSchemaVersion(database, 28);
  database.exec(
    "INSERT INTO project_contacts VALUES ('contact-1','project-1','Actual name','contact@example.test','Company','Role','2026-09-01','2026-09-01')",
  );
  return database;
}
describe('Final UI relations migration 1.0.0', () => {
  it('preserves existing contacts with truthful empty defaults and supports an idempotent exact-schema rollback', () => {
    const database = previousSchema();
    try {
      const before = computeProductionSchemaFingerprint(database);
      applyV29FinalUiRelations(database);
      validateV29FinalUiRelations(database);
      expect(
        database.prepare('SELECT name,phone,is_primary FROM project_contacts').get(),
      ).toMatchObject({ name: 'Actual name', phone: '', is_primary: 0 });
      const after = computeProductionSchemaFingerprint(database);
      validateProductionSchemaVersion(database, 29);
      applyV29FinalUiRelations(database);
      expect(computeProductionSchemaFingerprint(database)).toBe(after);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      rollbackV29FinalUiRelations(database);
      expect(computeProductionSchemaFingerprint(database)).toBe(before);
      expect(database.prepare('SELECT name FROM project_contacts').get()).toMatchObject({
        name: 'Actual name',
      });
      rollbackV29FinalUiRelations(database);
    } finally {
      database.close();
    }
  });
  it('blocks rollback once user values exist and rejects partial migrations without further writes', () => {
    const database = previousSchema();
    try {
      applyV29FinalUiRelations(database);
      database.exec("UPDATE project_contacts SET phone='+971 50 1234567',is_primary=1");
      expect(() => rollbackV29FinalUiRelations(database)).toThrow('blocked');
      expect(database.prepare('SELECT phone FROM project_contacts').get()).toMatchObject({
        phone: '+971 50 1234567',
      });
    } finally {
      database.close();
    }
    const partial = previousSchema();
    try {
      partial.exec("ALTER TABLE project_contacts ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
      const before = computeProductionSchemaFingerprint(partial);
      expect(() => applyV29FinalUiRelations(partial)).toThrow('partial');
      expect(computeProductionSchemaFingerprint(partial)).toBe(before);
    } finally {
      partial.close();
    }
  });
});
