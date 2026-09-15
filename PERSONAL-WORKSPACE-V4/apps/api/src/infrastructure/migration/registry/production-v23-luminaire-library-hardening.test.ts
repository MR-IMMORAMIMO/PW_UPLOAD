import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  applyV23LuminaireLibraryHardening,
  validateV23LuminaireLibraryHardening,
} from './production-v23-luminaire-library-hardening';
import { computeProductionSchemaFingerprint } from './production-schema-validator';

function migratedDatabase(targetVersion: 22 | 23): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL CHECK(validation_result = 'passed'),
      UNIQUE(from_version), UNIQUE(to_version), CHECK(duration_ms >= 0)
    )`);
  const clock = { now: () => new Date('2026-08-26T00:00:00.000Z') };
  for (const migration of PRODUCTION_MIGRATIONS.filter(
    (candidate) => candidate.toVersion <= targetVersion,
  )) {
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

function seedHistoricalLibrary(database: DatabaseSync): void {
  const audit = [
    'owner-id',
    'Owner',
    '2026-08-26T00:00:00.000Z',
    'owner-id',
    'Owner',
    '2026-08-26T00:00:00.000Z',
  ] as const;
  for (const [manufacturerId, normalizedName] of [
    ['manufacturer-a', 'manufacturer a'],
    ['manufacturer-b', 'manufacturer b'],
  ] as const) {
    database
      .prepare(
        `INSERT INTO luminaire_manufacturers
         (manufacturer_id, name, normalized_name, status, created_by_id, created_by_name,
          created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
      )
      .run(manufacturerId, manufacturerId, normalizedName, ...audit);
  }
  for (const [productId, manufacturerId] of [
    ['product-a', 'manufacturer-a'],
    ['product-b', 'manufacturer-b'],
  ] as const) {
    database
      .prepare(
        `INSERT INTO luminaire_library_products
         (product_id, manufacturer_id, name, normalized_name, product_type, description, status,
          created_by_id, created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, 'Downlight', '', 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
      )
      .run(productId, manufacturerId, productId, productId, ...audit);
  }
  for (const [variantId, productId, label] of [
    ['variant-a', 'product-a', 'Primary'],
    ['variant-b', 'product-b', 'Secondary'],
  ] as const) {
    database
      .prepare(
        `INSERT INTO luminaire_library_variants
         (variant_id, product_id, variant_label, normalized_label, ordering_code, wattage, lumens,
          light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control, emergency,
          dimensions, body_color_finish, status, created_by_id, created_by_name, created_at,
          updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, ' code  1 ', '10 W', '1000 lm', '3000 K', 'CRI 90', '36 deg',
          'IP 44', 'Recessed', '', '', 'DALI', 'No', '', 'White', 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
      )
      .run(variantId, productId, label, label.toLocaleLowerCase('en'), ...audit);
  }
  database
    .prepare(
      `INSERT INTO luminaire_library_versions
       (version_id, manufacturer_id, product_id, variant_id, version_sequence, snapshot_json,
        content_hash, search_text, product_type, light_color, beam_angle, published_by_id,
        published_by_name, published_at)
       VALUES ('version-a', 'manufacturer-a', 'product-a', 'variant-a', 1, '{}', ?, '',
        'Downlight', '3000 K', '36 deg', 'owner-id', 'Owner', '2026-08-26T00:00:00.000Z')`,
    )
    .run('a'.repeat(64));
  database
    .prepare(
      `UPDATE luminaire_library_variants
       SET latest_published_version_id = 'version-a'
       WHERE variant_id = 'variant-a'`,
    )
    .run();
}

function historicalProjection(database: DatabaseSync): unknown[] {
  return database
    .prepare(
      `SELECT variant_id, product_id, variant_label, normalized_label, ordering_code, wattage,
              lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
              emergency, dimensions, body_color_finish, status, row_version,
              latest_published_version_id, created_by_id, created_by_name, created_at,
              updated_by_id, updated_by_name, updated_at
       FROM luminaire_library_variants ORDER BY variant_id`,
    )
    .all();
}

describe('production v23 Master Luminaire Library hardening migration', () => {
  it('preserves populated historical v22 rows while backfilling normalized authority', () => {
    const database = migratedDatabase(22);
    seedHistoricalLibrary(database);
    const before = historicalProjection(database);
    const versionBefore = database.prepare('SELECT * FROM luminaire_library_versions').all();

    database.exec('BEGIN IMMEDIATE');
    applyV23LuminaireLibraryHardening(database);
    validateV23LuminaireLibraryHardening(database);
    database.exec('COMMIT');

    expect(historicalProjection(database)).toEqual(before);
    expect(database.prepare('SELECT * FROM luminaire_library_versions').all()).toEqual(
      versionBefore,
    );
    expect(
      database
        .prepare(
          `SELECT manufacturer_id, normalized_ordering_code, wattage_value, wattage_basis,
                  lumens_value, lumens_basis, cct_kelvin, cri_value, beam_degrees, beam_facet,
                  ip_facet, control_facet
           FROM luminaire_library_variants WHERE variant_id = 'variant-a'`,
        )
        .get(),
    ).toEqual({
      manufacturer_id: 'manufacturer-a',
      normalized_ordering_code: 'CODE 1',
      wattage_value: 10,
      wattage_basis: 'W',
      lumens_value: 1000,
      lumens_basis: 'LM',
      cct_kelvin: 3000,
      cri_value: 90,
      beam_degrees: 36,
      beam_facet: '36°',
      ip_facet: 'ip 44',
      control_facet: 'dali',
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    applyV23LuminaireLibraryHardening(database);
    validateV23LuminaireLibraryHardening(database);
    expect(historicalProjection(database)).toEqual(before);
    database.close();
  });

  it('makes fresh and historical v22 databases converge on identical v23 authority', () => {
    const historical = migratedDatabase(22);
    applyV23LuminaireLibraryHardening(historical);
    validateV23LuminaireLibraryHardening(historical);
    const fresh = migratedDatabase(23);
    expect(computeProductionSchemaFingerprint(historical)).toBe(
      computeProductionSchemaFingerprint(fresh),
    );
    expect(computeProductionSchemaFingerprint(fresh)).toBe(
      '3961a181f44278582eb86d12eda88629713994024b5efb2d43855d89ce30d3a2',
    );
    historical.close();
    fresh.close();
  });
});
