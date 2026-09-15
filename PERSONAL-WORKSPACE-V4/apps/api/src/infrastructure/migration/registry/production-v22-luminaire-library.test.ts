import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  applyV22LuminaireLibrarySchema,
  computeV22MigrationChecksum,
  rollbackV22LuminaireLibrarySchema,
  validateV22LuminaireLibrarySchema,
} from './production-v22-luminaire-library';
import { computeProductionSchemaFingerprint } from './production-schema-validator';

function v21(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL CHECK(validation_result = 'passed'),
      UNIQUE(from_version), UNIQUE(to_version), CHECK(duration_ms >= 0)
    )`);
  const clock = { now: () => new Date('2026-08-25T00:00:00.000Z') };
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= 21)) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const context = {
        database,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock,
      };
      migration.up(context);
      migration.validate?.(context);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return database;
}

describe('production v22 Master Luminaire Library migration', () => {
  it('retains the exact immutable checksum applied to the normal Personal profile', () => {
    expect(computeV22MigrationChecksum()).toBe(
      '4b2191b37a5f7e9591a352ee2b05ea88345d7ba100bbfe5ebdb1cc49f251cae0',
    );
  });

  it('preserves populated Project rows and creates no automatic Library authority', () => {
    const database = v21();
    const luminaireId = '40000000-0000-4000-8000-000000000001';
    database
      .prepare(
        `INSERT INTO project_luminaires
       (id, project_id, tag, category, image_path, description, manufacturer, model,
        wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver,
        control, emergency, datasheet_path, location, unit, quantity, notes, source_name,
        dimensions, body_color_finish, created_at, updated_at)
       VALUES (?, ?, 'L1', 'Downlight', '', 'Existing', 'Existing Maker', 'Existing Model',
        '10 W', '1000 lm', '3000 K', '90', '36 deg', 'IP20', 'Recessed', '', '', 'DALI',
        'No', '', 'Zone', 'No.', 2, '', 'Existing Project', '', 'White', ?, ?)`,
      )
      .run(
        luminaireId,
        '10000000-0000-4000-8000-000000000001',
        '2026-08-25T00:00:00.000Z',
        '2026-08-25T00:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at)
       VALUES (?, ?, ?, 'Datasheet', 1, 'existing.pdf', 'existing.pdf', 'application/pdf',
        8, ?, 0, ?)`,
      )
      .run(
        '50000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        luminaireId,
        'a'.repeat(64),
        '2026-08-25T00:00:00.000Z',
      );

    applyV22LuminaireLibrarySchema(database);
    validateV22LuminaireLibrarySchema(database);
    applyV22LuminaireLibrarySchema(database);

    const row = database
      .prepare('SELECT * FROM project_luminaires WHERE id = ?')
      .get(luminaireId) as Record<string, unknown>;
    expect(row.tag).toBe('L1');
    expect(row.product_type).toBe('');
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_asset_versions').get(),
    ).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM luminaire_manufacturers').get()).toEqual(
      { count: 0 },
    );
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM project_luminaire_library_bindings').get(),
    ).toEqual({ count: 0 });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const fingerprint = computeProductionSchemaFingerprint(database);
    expect(fingerprint).toBe('c06aaa8657af538b74a8bd3f5eebbdd14754c4ace310580aa3cd3c4f18be61ce');
    database.close();
  });

  it('supports a bounded rollback only while no Project binding exists', () => {
    const database = v21();
    applyV22LuminaireLibrarySchema(database);
    rollbackV22LuminaireLibrarySchema(database);
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'luminaire_library_versions'")
        .get(),
    ).toBeUndefined();
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });
});
