import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';
import {
  applyV28ProjectIntelligenceProductivity,
  PRODUCTION_V28_ACTION_COLUMN_NAMES,
  PRODUCTION_V28_INDEX_NAMES,
  PRODUCTION_V28_TABLE_NAMES,
  rollbackV28ProjectIntelligenceProductivity,
  validateV28ProjectIntelligenceProductivity,
} from './production-v28-project-intelligence-productivity';

const NOW = '2026-08-29T00:00:00.000Z';
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const REVISION_ID = '20000000-0000-4000-8000-000000000001';
const SOURCE_ID = '30000000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);

function migrateThrough(target: 27 | 28): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION') {
      database.exec('PRAGMA foreign_keys=OFF');
    }
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date(NOW) },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys=ON');
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  }
  return database;
}

function seedAction(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO project_actions
       (id,project_id,title,details,owner,due_date,status,priority,source_type,source_id,
        revision_id,completed_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      PROJECT_ID,
      'Open blocking action',
      'details',
      'owner',
      null,
      'Open',
      'High',
      'MANUAL',
      null,
      null,
      null,
      NOW,
      NOW,
    );
}

describe('production v28 Project Intelligence migration', () => {
  it('adds the two source tables, their indexes, and the Action CAS/issue-blocking columns', () => {
    const database = migrateThrough(27);
    validateProductionSchemaVersion(database, 27);
    applyV28ProjectIntelligenceProductivity(database);
    validateV28ProjectIntelligenceProductivity(database);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const tables = new Set(
      (
        database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    for (const name of PRODUCTION_V28_TABLE_NAMES) expect(tables.has(name)).toBe(true);

    const indexes = new Set(
      (
        database.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    for (const name of PRODUCTION_V28_INDEX_NAMES) expect(indexes.has(name)).toBe(true);

    const actionColumns = new Set(
      (database.prepare('PRAGMA table_info(project_actions)').all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    for (const name of PRODUCTION_V28_ACTION_COLUMN_NAMES)
      expect(actionColumns.has(name)).toBe(true);
  });

  it('enforces the source locator uniqueness, size bound, and baseline FK', () => {
    const database = migrateThrough(28);
    database
      .prepare(
        `INSERT INTO project_source_files
         (id,project_id,source_type,display_name,original_relative_locator,latest_hash,
          latest_size,latest_modified_at,last_checked_at,row_version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
      )
      .run(SOURCE_ID, PROJECT_ID, 'AUTOCAD', 'plan.dwg', 'plan.dwg', SHA, 1024, NOW, NOW, NOW, NOW);
    // Duplicate locator for the same project is rejected.
    expect(() =>
      database
        .prepare(
          `INSERT INTO project_source_files
           (id,project_id,source_type,display_name,original_relative_locator,latest_hash,
            latest_size,latest_modified_at,last_checked_at,row_version,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .run(
          '30000000-0000-4000-8000-000000000002',
          PROJECT_ID,
          'EXCEL',
          'plan.dwg',
          'plan.dwg',
          SHA,
          1024,
          NOW,
          NOW,
          NOW,
          NOW,
        ),
    ).toThrow();
    // Oversized source is rejected by the CHECK bound.
    expect(() =>
      database
        .prepare(
          `INSERT INTO project_source_files
           (id,project_id,source_type,display_name,original_relative_locator,latest_hash,
            latest_size,latest_modified_at,last_checked_at,row_version,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .run(
          '30000000-0000-4000-8000-000000000003',
          PROJECT_ID,
          'DIALUX',
          'big.evo',
          'big.evo',
          SHA,
          209715201,
          NOW,
          NOW,
          NOW,
          NOW,
        ),
    ).toThrow();
    // Baseline FK to a missing source is rejected.
    expect(() =>
      database
        .prepare(
          `INSERT INTO revision_source_file_baselines
           (baseline_id,project_id,revision_id,source_file_id,sha256,size_bytes,captured_at,
            captured_by_id,captured_by_name,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          '40000000-0000-4000-8000-000000000001',
          PROJECT_ID,
          REVISION_ID,
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          SHA,
          1024,
          NOW,
          'actor',
          'Actor',
          NOW,
        ),
    ).toThrow();
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('is idempotent, structurally deterministic, and rolls back only when v28 authority is empty', () => {
    const upgraded = migrateThrough(27);
    applyV28ProjectIntelligenceProductivity(upgraded);
    const fresh = migrateThrough(28);
    const fingerprint = computeProductionSchemaFingerprint(fresh);
    expect(computeProductionSchemaFingerprint(upgraded)).toBe(fingerprint);
    applyV28ProjectIntelligenceProductivity(fresh);
    expect(computeProductionSchemaFingerprint(fresh)).toBe(fingerprint);
    fresh.exec('PRAGMA foreign_keys=OFF');
    rollbackV28ProjectIntelligenceProductivity(fresh);
    fresh.exec('PRAGMA foreign_keys=ON');
    validateProductionSchemaVersion(fresh, 27);

    const populated = migrateThrough(28);
    seedAction(populated, '50000000-0000-4000-8000-000000000001');
    populated
      .prepare(`UPDATE project_actions SET blocks_issue=1, row_version=2 WHERE id=?`)
      .run('50000000-0000-4000-8000-000000000001');
    expect(() => rollbackV28ProjectIntelligenceProductivity(populated)).toThrow(
      /blocked while Project Intelligence authority exists/,
    );
  });
});
