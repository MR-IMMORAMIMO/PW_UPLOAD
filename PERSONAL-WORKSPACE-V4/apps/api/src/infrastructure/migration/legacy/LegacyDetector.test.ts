/**
 * Tests for LegacyDetector - strictly read-only legacy v3.2.2 detection.
 *
 * P1.6B-A - Implement Read-Only Legacy v3.2.2 Detector
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { join, win32 as winPath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LegacyV322FixtureBuilder } from '../testing/LegacyV322FixtureBuilder';
import { CurrentSelfManagedUnversionedFixtureBuilder } from '../testing/CurrentSelfManagedUnversionedFixtureBuilder';
import { CANONICAL_FRESH_DDL, type LegacyV322FixtureProfile } from '../testing/legacy-v322-schema';
import { CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT } from '../testing/current-self-managed-unversioned-schema';
import {
  PRODUCTION_CANONICAL_DDL,
  PRODUCTION_COMPATIBILITY_COLUMNS,
} from '../registry/production-migration-registry';
import { LegacyDetector, LegacyDetectorError } from './LegacyDetector';

// ---------------------------------------------------------------------------
// Locked fingerprint vectors
// ---------------------------------------------------------------------------

const EXPECTED_STRUCTURAL_FINGERPRINT =
  '2cb33227fcc587a1e46f6b00556d8f5f0f532f604bc8a888b24db6f5480715d2';

const EXPECTED_PARTIAL_FINGERPRINT =
  'c2837bfc8e897045314e8d27f637fac807347f2f6eedaff5482b3d1b5448a609';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'legacy-detector-'));
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function tempPath(name: string): string {
  return join(tempDir, name);
}

function buildFixture(profile: LegacyV322FixtureProfile, name: string): string {
  const p = tempPath(name);
  LegacyV322FixtureBuilder.build({ outputPath: p, profile });
  return p;
}

function buildCurrentFixture(name: string): string {
  const p = tempPath(name);
  CurrentSelfManagedUnversionedFixtureBuilder.build({ outputPath: p });
  return p;
}

function buildDbFromDdl(name: string, ddl: readonly string[]): string {
  const p = tempPath(name);
  const db = new DatabaseSync(p);
  for (const stmt of ddl) {
    db.exec(stmt);
  }
  db.close();
  return p;
}

function buildCurrentSchemaVariant(
  name: string,
  options: {
    transformBaseDdl?: (ddl: string) => string;
    transformCompatibilityDefinition?: (
      table: string,
      column: string,
      definition: string,
    ) => string;
  },
): string {
  const p = tempPath(name);
  const db = new DatabaseSync(p);
  for (const ddl of PRODUCTION_CANONICAL_DDL) {
    db.exec(options.transformBaseDdl?.(ddl) ?? ddl);
  }
  for (const operation of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (operation.alreadyInBaseCreate) continue;
    const definition =
      options.transformCompatibilityDefinition?.(
        operation.table,
        operation.column,
        operation.definition,
      ) ?? operation.definition;
    db.exec(`ALTER TABLE ${operation.table} ADD COLUMN ${operation.column} ${definition}`);
  }
  db.close();
  return p;
}

const detector = new LegacyDetector();

// ---------------------------------------------------------------------------
// Core classifications
// ---------------------------------------------------------------------------

describe('LegacyDetector', () => {
  it('SCHEMA_ONLY fixture is classified as LEGACY_V3_2_2', () => {
    const p = buildFixture('SCHEMA_ONLY', 'schema-only.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.migrationCandidate).toBe(true);
    expect(result.manualActionRequired).toBe(false);
    expect(result.observedUserVersion).toBe(0);
    expect(result.historyTableExists).toBe(false);
    expect(result.observedTableCount).toBe(24);
    expect(result.observedOwnedIndexCount).toBe(8);
  });

  it('RUNTIME_MINIMAL fixture is classified as LEGACY_V3_2_2', () => {
    const p = buildFixture('RUNTIME_MINIMAL', 'runtime-minimal.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.migrationCandidate).toBe(true);
    expect(result.manualActionRequired).toBe(false);
  });

  it('REPRESENTATIVE_POPULATED fixture is classified as LEGACY_V3_2_2', () => {
    const p = buildFixture('REPRESENTATIVE_POPULATED', 'representative.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.migrationCandidate).toBe(true);
    expect(result.manualActionRequired).toBe(false);
  });

  it('exact populated current self-managed fixture has its own migration classification', () => {
    const p = buildCurrentFixture('current-self-managed.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('CURRENT_SELF_MANAGED_UNVERSIONED');
    expect(result.safeReasonCode).toBe('EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA');
    expect(result.migrationCandidate).toBe(true);
    expect(result.manualActionRequired).toBe(false);
    expect(result.observedUserVersion).toBe(0);
    expect(result.historyTableExists).toBe(false);
    expect(result.observedTableCount).toBe(24);
    expect(result.observedOwnedIndexCount).toBe(8);
    expect(result.observedStructuralFingerprint).toBe(
      CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT,
    );
  });

  it('PARTIAL_STANDALONE_ONLY fixture is classified as PARTIAL_LEGACY_SCHEMA', () => {
    const p = buildFixture('PARTIAL_STANDALONE_ONLY', 'partial.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('PARTIAL_LEGACY_SCHEMA');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
    expect(result.observedTableCount).toBe(3);
    expect(result.observedOwnedIndexCount).toBe(0);
    expect(result.observedStructuralFingerprint).toBe(EXPECTED_PARTIAL_FINGERPRINT);
  });

  it('truly empty database is classified as EMPTY_DATABASE', () => {
    const p = tempPath('empty.sqlite');
    const db = new DatabaseSync(p);
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('EMPTY_DATABASE');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(false);
    expect(result.observedUserVersion).toBe(0);
    expect(result.historyTableExists).toBe(false);
    expect(result.observedTableCount).toBe(0);
    expect(result.observedOwnedIndexCount).toBe(0);
  });

  it('versioned database is classified as NOT_APPLICABLE', () => {
    const p = buildFixture('SCHEMA_ONLY', 'versioned.sqlite');
    const db = new DatabaseSync(p);
    db.exec('PRAGMA user_version = 1');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.observedUserVersion).toBe(1);
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(false);
  });

  it('database with migration history is classified as NOT_APPLICABLE', () => {
    const p = buildFixture('SCHEMA_ONLY', 'history.sqlite');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
    );
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.historyTableExists).toBe(true);
    expect(result.migrationCandidate).toBe(false);
  });

  it('malformed migration history is BLOCKED, not NOT_APPLICABLE', () => {
    const p = buildFixture('SCHEMA_ONLY', 'malformed-history.sqlite');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY)');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('MALFORMED_MIGRATION_HISTORY');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
  });

  it('history rows that cannot be validated are BLOCKED, not NOT_APPLICABLE', () => {
    const p = buildFixture('SCHEMA_ONLY', 'inconsistent-history.sqlite');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
    );
    db.exec(
      "INSERT INTO schema_migrations VALUES ('m1', 0, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'd', 'v', 'b', 's', 'c', 1, 'passed')",
    );
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('MALFORMED_MIGRATION_HISTORY');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Exact identity
  // -----------------------------------------------------------------------

  it('exact 24-table schema is accepted', () => {
    const p = buildFixture('SCHEMA_ONLY', 'exact-24.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.observedTableCount).toBe(24);
  });

  it('exact 8 owned indexes are accepted', () => {
    const p = buildFixture('SCHEMA_ONLY', 'exact-8.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.observedOwnedIndexCount).toBe(8);
  });

  it('locked structural fingerprint is returned', () => {
    const p = buildFixture('SCHEMA_ONLY', 'locked-fp.sqlite');
    const result = detector.inspect(p);
    expect(result.observedStructuralFingerprint).toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
  });

  it('current self-managed identity is strict and does not alter the frozen fingerprint', () => {
    const legacyPath = buildFixture('SCHEMA_ONLY', 'frozen-fingerprint-unchanged.sqlite');
    const currentPath = buildCurrentFixture('current-fingerprint-distinct.sqlite');
    const legacy = detector.inspect(legacyPath);
    const current = detector.inspect(currentPath);
    expect(legacy.status).toBe('LEGACY_V3_2_2');
    expect(legacy.observedStructuralFingerprint).toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
    expect(current.status).toBe('CURRENT_SELF_MANAGED_UNVERSIONED');
    expect(current.observedStructuralFingerprint).not.toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
  });

  it('non-zero current self-managed user_version is not admitted', () => {
    const p = buildCurrentFixture('current-nonzero-version.sqlite');
    const db = new DatabaseSync(p);
    db.exec('PRAGMA user_version = 99');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.observedUserVersion).toBe(99);
    expect(result.migrationCandidate).toBe(false);
  });

  it('current self-managed schema with malformed history is BLOCKED', () => {
    const p = buildCurrentFixture('current-malformed-history.sqlite');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY)');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('MALFORMED_MIGRATION_HISTORY');
    expect(result.migrationCandidate).toBe(false);
  });

  it('user_version must be 0 for legacy classification', () => {
    const p = buildFixture('RUNTIME_MINIMAL', 'uv-required.sqlite');
    const db = new DatabaseSync(p);
    db.exec('PRAGMA user_version = 2');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.observedUserVersion).toBe(2);
  });

  it('schema_migrations absence is required', () => {
    const p = buildFixture('RUNTIME_MINIMAL', 'no-sm.sqlite');
    const db = new DatabaseSync(p);
    db.exec(
      'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
    );
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.historyTableExists).toBe(true);
  });

  it('row content differences do not change structural classification', () => {
    const p1 = buildFixture('SCHEMA_ONLY', 'rows-1.sqlite');
    const p2 = buildFixture('RUNTIME_MINIMAL', 'rows-2.sqlite');
    const p3 = buildFixture('REPRESENTATIVE_POPULATED', 'rows-3.sqlite');
    const r1 = detector.inspect(p1);
    const r2 = detector.inspect(p2);
    const r3 = detector.inspect(p3);
    expect(r1.status).toBe('LEGACY_V3_2_2');
    expect(r2.status).toBe('LEGACY_V3_2_2');
    expect(r3.status).toBe('LEGACY_V3_2_2');
    expect(r1.observedStructuralFingerprint).toBe(r2.observedStructuralFingerprint);
    expect(r2.observedStructuralFingerprint).toBe(r3.observedStructuralFingerprint);
  });

  it('output path and filename do not change classification', () => {
    const p1 = buildFixture('SCHEMA_ONLY', 'path-a.sqlite');
    const p2 = tempPath('sub/path-b.sqlite');
    mkdirSync(winPath.dirname(p2), { recursive: true });
    LegacyV322FixtureBuilder.build({ outputPath: p2, profile: 'SCHEMA_ONLY' });
    const r1 = detector.inspect(p1);
    const r2 = detector.inspect(p2);
    expect(r1.status).toBe(r2.status);
    expect(r1.observedStructuralFingerprint).toBe(r2.observedStructuralFingerprint);
  });

  it('special-character file paths are handled safely', () => {
    const names = [
      'space name.sqlite',
      'uni-\u00e9\u4e2d\u6587.sqlite',
      'hash#name.sqlite',
      'percent%20name.sqlite',
      'parens(name).sqlite',
      "apostrophe'name.sqlite",
      'deep/nested/path/here.sqlite',
    ];
    for (const name of names) {
      const p = tempPath(name);
      if (name.includes('/')) {
        mkdirSync(winPath.dirname(p), { recursive: true });
      }
      LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
      const result = detector.inspect(p);
      expect(result.status).toBe('LEGACY_V3_2_2');
      expect(result.observedStructuralFingerprint).toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
      expect(JSON.stringify(result)).not.toContain(':\\');
    }
  });

  it('URI construction encodes query-significant characters', () => {
    const uri = pathToFileURL('C:\\tmp\\a?b#c.sqlite').href;
    expect(uri).toContain('%3F');
    expect(uri).toContain('%23');
    expect(uri).not.toContain('?b#c');
  });

  // -----------------------------------------------------------------------
  // Altered schema blockers
  // -----------------------------------------------------------------------

  it('missing required table is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.filter(
      (s) => !s.includes('CREATE TABLE IF NOT EXISTS app_state'),
    );
    const p = buildDbFromDdl('missing-table.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
  });

  it('extra table is BLOCKED', () => {
    const ddl = [
      ...CANONICAL_FRESH_DDL,
      'CREATE TABLE IF NOT EXISTS extra_table (id INTEGER PRIMARY KEY)',
    ];
    const p = buildDbFromDdl('extra-table.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('missing column is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS app_state')
        ? 'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value TEXT NOT NULL\n)'
        : s,
    );
    const p = buildDbFromDdl('missing-column.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('extra column is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS app_state')
        ? 'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  extra_column TEXT\n)'
        : s,
    );
    const p = buildDbFromDdl('extra-column.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed column type is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS app_state')
        ? 'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value BLOB NOT NULL,\n  updated_at TEXT NOT NULL\n)'
        : s,
    );
    const p = buildDbFromDdl('changed-type.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed default is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes("DEFAULT 'Draft'") ? s.replace("DEFAULT 'Draft'", "DEFAULT 'Final'") : s,
    );
    const p = buildDbFromDdl('changed-default.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed NOT NULL is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS app_state')
        ? 'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value TEXT NOT NULL,\n  updated_at TEXT\n)'
        : s,
    );
    const p = buildDbFromDdl('changed-notnull.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed primary key is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS app_state')
        ? 'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT,\n  json_value TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)'
        : s,
    );
    const p = buildDbFromDdl('changed-pk.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed UNIQUE constraint is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('email TEXT NOT NULL UNIQUE COLLATE NOCASE')
        ? s.replace(
            'email TEXT NOT NULL UNIQUE COLLATE NOCASE',
            'email TEXT NOT NULL COLLATE NOCASE',
          )
        : s,
    );
    const p = buildDbFromDdl('changed-unique.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed CHECK constraint is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CHECK (id = 1)') ? s.replace('CHECK (id = 1)', 'CHECK (id = 2)') : s,
    );
    const p = buildDbFromDdl('changed-check.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('added explicit foreign key is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS project_workspaces')
        ? 'CREATE TABLE IF NOT EXISTS project_workspaces (\n  project_id TEXT PRIMARY KEY,\n  folder_path TEXT,\n  folder_profile TEXT NOT NULL,\n  services_json TEXT NOT NULL,\n  input_mode TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  FOREIGN KEY (project_id) REFERENCES app_state(state_key)\n)'
        : s,
    );
    const p = buildDbFromDdl('added-fk.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('missing index is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.filter((s) => !s.includes('ix_project_actions_due'));
    const p = buildDbFromDdl('missing-index.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('extra owned user index is BLOCKED', () => {
    const ddl = [
      ...CANONICAL_FRESH_DDL,
      'CREATE INDEX IF NOT EXISTS extra_idx ON app_state(state_key)',
    ];
    const p = buildDbFromDdl('extra-index.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('changed index direction is BLOCKED', () => {
    const ddl = CANONICAL_FRESH_DDL.map((s) =>
      s.includes('ix_workspace_activity_project')
        ? s.replace('created_at DESC', 'created_at ASC')
        : s,
    );
    const p = buildDbFromDdl('changed-direction.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('added trigger is BLOCKED', () => {
    const ddl = [
      ...CANONICAL_FRESH_DDL,
      'CREATE TRIGGER IF NOT EXISTS trg_after_insert AFTER INSERT ON app_state BEGIN SELECT 1; END',
    ];
    const p = buildDbFromDdl('added-trigger.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('added view is BLOCKED', () => {
    const ddl = [...CANONICAL_FRESH_DDL, 'CREATE VIEW IF NOT EXISTS v_extra AS SELECT 1'];
    const p = buildDbFromDdl('added-view.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('added virtual table is BLOCKED', () => {
    const ddl = [...CANONICAL_FRESH_DDL, 'CREATE VIRTUAL TABLE vt_extra USING fts5(content)'];
    const p = buildDbFromDdl('added-virtual.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('populated unknown version-zero schema is BLOCKED', () => {
    const ddl = ['CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'];
    const p = buildDbFromDdl('unknown-schema.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
  });

  it('current near-match with an unknown extra table is BLOCKED', () => {
    const p = buildCurrentFixture('current-extra-table.sqlite');
    const db = new DatabaseSync(p);
    db.exec('CREATE TABLE unknown_user_table (id TEXT PRIMARY KEY)');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('current near-match with an unknown extra column is BLOCKED', () => {
    const p = buildCurrentFixture('current-extra-column.sqlite');
    const db = new DatabaseSync(p);
    db.exec("ALTER TABLE project_workspaces ADD COLUMN unknown_value TEXT NOT NULL DEFAULT ''");
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('current near-match missing a required compatibility column is BLOCKED', () => {
    const p = buildCurrentFixture('current-missing-column.sqlite');
    const db = new DatabaseSync(p);
    db.exec('ALTER TABLE project_workspaces DROP COLUMN pdf_paper_size');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it.each([
    ['type', 'TEXT NOT NULL DEFAULT 140'],
    ['default', 'INTEGER NOT NULL DEFAULT 999'],
    ['nullability', 'INTEGER DEFAULT 140'],
  ])('current near-match with changed compatibility-column %s is BLOCKED', (_kind, definition) => {
    const p = buildCurrentSchemaVariant(`current-changed-${_kind}.sqlite`, {
      transformCompatibilityDefinition: (table, column, original) =>
        table === 'project_output_columns' && column === 'width' ? definition : original,
    });
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('current near-match with changed primary-key semantics is BLOCKED', () => {
    const p = buildCurrentSchemaVariant('current-changed-primary-key.sqlite', {
      transformBaseDdl: (ddl) =>
        ddl.includes('CREATE TABLE IF NOT EXISTS app_state')
          ? ddl.replace('state_key TEXT PRIMARY KEY', 'state_key TEXT')
          : ddl,
    });
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it('current near-match with an unknown owned index is BLOCKED', () => {
    const p = buildCurrentFixture('current-extra-index.sqlite');
    const db = new DatabaseSync(p);
    db.exec('CREATE INDEX current_unknown_index ON project_workspaces(project_id)');
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  it.each([
    ['trigger', 'CREATE TRIGGER current_probe AFTER INSERT ON app_state BEGIN SELECT 1; END'],
    ['view', 'CREATE VIEW current_probe AS SELECT 1 AS value'],
    ['virtual table', 'CREATE VIRTUAL TABLE current_probe USING fts5(content)'],
  ])('current near-match with an unexpected %s is BLOCKED', (_kind, sql) => {
    const p = buildCurrentFixture(`current-extra-${String(_kind).replace(' ', '-')}.sqlite`);
    const db = new DatabaseSync(p);
    db.exec(sql);
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('UNKNOWN_UNVERSIONED_SCHEMA');
  });

  // -----------------------------------------------------------------------
  // Safety
  // -----------------------------------------------------------------------

  it('relative path is rejected', () => {
    expect(() => detector.inspect('relative/path.sqlite')).toThrow(LegacyDetectorError);
  });

  it('missing file is rejected without creating it', () => {
    const p = tempPath('missing.sqlite');
    expect(() => detector.inspect(p)).toThrow(LegacyDetectorError);
    expect(existsSync(p)).toBe(false);
  });

  it('directory is rejected', () => {
    const dir = tempPath('dir-target');
    mkdirSync(dir, { recursive: true });
    expect(() => detector.inspect(dir)).toThrow(LegacyDetectorError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('symlink or junction is rejected where supported', () => {
    const target = buildFixture('SCHEMA_ONLY', 'symlink-target.sqlite');
    const link = tempPath('symlink-link.sqlite');
    try {
      symlinkSync(target, link);
      expect(() => detector.inspect(link)).toThrow(LegacyDetectorError);
      rmSync(link, { force: true });
    } catch {
      // Symlink creation not supported - skip
    }
  });

  it('non-regular entry is rejected where supported', () => {
    expect(() => detector.inspect('\\\\.\\COM1')).toThrow();
  });

  it('read-only inspection leaves the main database byte-identical', () => {
    const p = buildFixture('SCHEMA_ONLY', 'bytes.sqlite');
    const before = readFileSync(p);
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    const after = readFileSync(p);
    expect(Buffer.compare(before, after)).toBe(0);
    expect(existsSync(p + '-wal')).toBe(false);
    expect(existsSync(p + '-shm')).toBe(false);
  });

  it('uncheckpointed WAL never yields a stale legacy approval', () => {
    const src = buildFixture('SCHEMA_ONLY', 'wal-stale-src.sqlite');
    const writer = new DatabaseSync(src);
    writer.exec('CREATE TABLE extra_probe (id INTEGER PRIMARY KEY)');
    const copy = tempPath('wal-stale-copy.sqlite');
    copyFileSync(src, copy);
    copyFileSync(src + '-wal', copy + '-wal');
    copyFileSync(src + '-shm', copy + '-shm');
    writer.close();
    const mainBefore = readFileSync(copy);
    const walBefore = readFileSync(copy + '-wal');
    const shmBefore = readFileSync(copy + '-shm');
    const result = detector.inspect(copy);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('WAL_STATE_NOT_FULLY_VISIBLE');
    expect(result.migrationCandidate).toBe(false);
    expect(result.manualActionRequired).toBe(true);
    expect(Buffer.compare(mainBefore, readFileSync(copy))).toBe(0);
    expect(Buffer.compare(walBefore, readFileSync(copy + '-wal'))).toBe(0);
    expect(Buffer.compare(shmBefore, readFileSync(copy + '-shm'))).toBe(0);
  });

  it('active writer is BLOCKED, not classified from stale state', () => {
    const p = buildFixture('SCHEMA_ONLY', 'wal-active.sqlite');
    const writer = new DatabaseSync(p);
    writer.exec('CREATE TABLE extra_probe (id INTEGER PRIMARY KEY)');
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('WAL_STATE_NOT_FULLY_VISIBLE');
    expect(result.migrationCandidate).toBe(false);
    writer.close();
  });

  it('current self-managed fixture with uncheckpointed WAL state is BLOCKED', () => {
    const p = buildCurrentFixture('current-wal-active.sqlite');
    const writer = new DatabaseSync(p);
    writer.exec('CREATE TABLE current_wal_probe (id INTEGER PRIMARY KEY)');
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.safeReasonCode).toBe('WAL_STATE_NOT_FULLY_VISIBLE');
    expect(result.migrationCandidate).toBe(false);
    writer.close();
  });

  it('empty WAL is not treated as uncheckpointed state', () => {
    const p = buildFixture('SCHEMA_ONLY', 'wal-empty.sqlite');
    writeFileSync(p + '-wal', Buffer.alloc(0));
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(existsSync(p + '-wal')).toBe(true);
    expect(readFileSync(p + '-wal').length).toBe(0);
  });

  it('database handle closes on success', () => {
    const p = buildFixture('SCHEMA_ONLY', 'close-success.sqlite');
    detector.inspect(p);
    expect(() => rmSync(p, { force: true })).not.toThrow();
  });

  it('database handle closes on failure', () => {
    const p = tempPath('close-failure.sqlite');
    writeFileSync(p, Buffer.from('this is not a sqlite database at all, definitely corrupt'));
    expect(() => detector.inspect(p)).toThrow();
    expect(() => rmSync(p, { force: true })).not.toThrow();
  });

  it('unknown inspector error throws', () => {
    const p = tempPath('inspector-error.sqlite');
    writeFileSync(p, Buffer.from('this is not a sqlite database at all, definitely corrupt'));
    expect(() => detector.inspect(p)).toThrow();
  });

  it('unknown SQLite or filesystem error throws', () => {
    const p = tempPath('sqlite-error.sqlite');
    writeFileSync(p, Buffer.from('this is not a sqlite database at all, definitely corrupt'));
    expect(() => detector.inspect(p)).toThrow();
  });

  it('no BackupManager call exists', () => {
    const source = readFileSync(join(__dirname, 'LegacyDetector.ts'), 'utf-8');
    expect(source).not.toContain('BackupManager');
    expect(source).not.toContain('createVerifiedBackup');
  });

  it('no migration callback exists', () => {
    const source = readFileSync(join(__dirname, 'LegacyDetector.ts'), 'utf-8');
    expect(source).not.toContain('SchemaMigrationRunner');
    expect(source).not.toContain('MigrationDefinition');
    expect(source).not.toContain('.up(');
  });

  it('no attempt journal write exists', () => {
    const source = readFileSync(join(__dirname, 'LegacyDetector.ts'), 'utf-8');
    expect(source).not.toContain('createAttempt');
    expect(source).not.toContain('markFailed');
    expect(source).not.toContain('transition(');
  });

  it('no resolution sidecar write exists', () => {
    const source = readFileSync(join(__dirname, 'LegacyDetector.ts'), 'utf-8');
    expect(source).not.toContain('appendResolution');
    expect(source).not.toContain('ResolutionSidecar');
  });

  it('no production store constructor is used', () => {
    const source = readFileSync(join(__dirname, 'LegacyDetector.ts'), 'utf-8');
    expect(source).not.toContain('new StandaloneDataProvider');
    expect(source).not.toContain('new PersonalWorkspaceStore');
    expect(source).not.toContain('new PersonalOperationsStore');
    expect(source).not.toContain('standalone-data-provider');
    expect(source).not.toContain('personal-workspace-store');
    expect(source).not.toContain('personal-operations-store');
  });

  // -----------------------------------------------------------------------
  // Result model
  // -----------------------------------------------------------------------

  it('results are deeply immutable', () => {
    const p = buildFixture('SCHEMA_ONLY', 'immutable.sqlite');
    const result = detector.inspect(p);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('repeated inspection is deterministic', () => {
    const p = buildFixture('SCHEMA_ONLY', 'deterministic.sqlite');
    const r1 = detector.inspect(p);
    const r2 = detector.inspect(p);
    expect(r1).toEqual(r2);
  });

  it('no path appears in the result', () => {
    const p = buildFixture('SCHEMA_ONLY', 'no-path.sqlite');
    const result = detector.inspect(p);
    const json = JSON.stringify(result);
    expect(json).not.toContain(':\\');
    expect(json).not.toContain('legacy-detector-');
  });

  it('no SQL, stack or Error object appears in the result', () => {
    const p = buildFixture('SCHEMA_ONLY', 'no-sql.sqlite');
    const result = detector.inspect(p);
    const json = JSON.stringify(result);
    expect(json).not.toContain('CREATE');
    expect(json).not.toContain('SELECT');
    expect(json).not.toContain('Error');
    expect(json).not.toContain(' at ');
  });

  it('BLOCKED has migrationCandidate=false', () => {
    const ddl = ['CREATE TABLE foo (id INTEGER PRIMARY KEY)'];
    const p = buildDbFromDdl('blocked-candidate.sqlite', ddl);
    const result = detector.inspect(p);
    expect(result.status).toBe('BLOCKED');
    expect(result.migrationCandidate).toBe(false);
  });

  it('LEGACY_V3_2_2 has migrationCandidate=true', () => {
    const p = buildFixture('SCHEMA_ONLY', 'legacy-candidate.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('LEGACY_V3_2_2');
    expect(result.migrationCandidate).toBe(true);
  });

  it('EMPTY_DATABASE does not authorize migration', () => {
    const p = tempPath('empty-no-migration.sqlite');
    const db = new DatabaseSync(p);
    db.close();
    const result = detector.inspect(p);
    expect(result.status).toBe('EMPTY_DATABASE');
    expect(result.migrationCandidate).toBe(false);
  });

  it('PARTIAL_LEGACY_SCHEMA requires manual action', () => {
    const p = buildFixture('PARTIAL_STANDALONE_ONLY', 'partial-manual.sqlite');
    const result = detector.inspect(p);
    expect(result.status).toBe('PARTIAL_LEGACY_SCHEMA');
    expect(result.manualActionRequired).toBe(true);
  });
});
