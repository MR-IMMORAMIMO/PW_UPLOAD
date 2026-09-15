import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV30OptionalContactEmail,
  rollbackV30OptionalContactEmail,
} from './production-v30-optional-contact-email';
function previousSchema() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= 29)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION')
      db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database: db,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date('2026-09-11T00:00:00Z') },
    });
    db.exec('COMMIT; PRAGMA foreign_keys=ON');
  }
  return db;
}
describe('Optional contact email migration 1.0.0', () => {
  it('preserves identities, rejects duplicate real emails, is idempotent, and rolls back without data loss', () => {
    const db = previousSchema();
    try {
      const insert =
        "INSERT INTO project_contacts (id,project_id,name,email,company,role,created_at,updated_at) VALUES (?, 'p1', 'Person', ?, '', '', '2026-09-11', '2026-09-11')";
      db.prepare(insert).run('a', 'first@example.test');
      const before = computeProductionSchemaFingerprint(db);
      applyV30OptionalContactEmail(db);
      validateProductionSchemaVersion(db, 30);
      const after = computeProductionSchemaFingerprint(db);
      applyV30OptionalContactEmail(db);
      expect(computeProductionSchemaFingerprint(db)).toBe(after);
      expect(() => db.prepare(insert).run('b', 'FIRST@example.test')).toThrow();
      db.prepare(insert).run('b', '');
      db.prepare(insert).run('c', '');
      expect(() => rollbackV30OptionalContactEmail(db)).toThrow('Rollback blocked');
      expect(db.prepare('SELECT count(*) AS n FROM project_contacts').get()).toMatchObject({
        n: 3,
      });
      db.prepare("UPDATE project_contacts SET email='third@example.test' WHERE id='c'").run();
      rollbackV30OptionalContactEmail(db);
      expect(computeProductionSchemaFingerprint(db)).toBe(before);
      rollbackV30OptionalContactEmail(db);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
