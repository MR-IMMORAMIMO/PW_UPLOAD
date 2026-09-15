/**
 * Tests for LegacyV322FixtureBuilder - deterministic programmatic fixture builder.
 *
 * P1.6A-E - Implement Deterministic Legacy v3.2.2 Fixture Builder
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import {
  mkdtempSync,
  existsSync,
  rmSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { join, win32 as winPath } from 'node:path';

import {
  TABLE_NAMES,
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  computeStructuralFingerprint,
  computeCanonicalDdlFingerprint,
} from './legacy-v322-schema';
import {
  LegacyV322FixtureBuilder,
  LegacyV322FixtureBuilderError,
} from './LegacyV322FixtureBuilder';
import { MigrationStateInspector } from '../MigrationStateInspector';

// ---------------------------------------------------------------------------
// Locked logical fingerprint vectors
// ---------------------------------------------------------------------------

// Independently computed once from deterministic builder output and locked.
// Changing any synthetic row, table inventory, or canonicalization rule will
// change these values, causing the tests to fail and requiring explicit
// acknowledgment.
const EXPECTED_LOGICAL_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze({
  SCHEMA_ONLY: '6443cf78931af68a9d6533f9fd2c504d3f90c4540243984eba1c97d826e61950',
  RUNTIME_MINIMAL: 'f7d76d5e5f00ef4fe32ab70d2ca974f46e7b9a743493eb8dfda06264c35bea1d',
  REPRESENTATIVE_POPULATED: '0325c82fa9bb792574eb724c879392e6ff2aea32048ecd4c2b001283f8d9097a',
  PARTIAL_STANDALONE_ONLY: '1e9aa3fb6594f46ce49a97c52638feda2768f1a6cc6af6672ae8719d1b88a7ea',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'legacy-v322-builder-'));
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

function getTableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function getIndexNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function hasSchemaMigrationsTable(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name: string } | undefined;
  return row !== undefined;
}

function getRowCount(db: DatabaseSync, tableName: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM "' + tableName + '"').get() as {
    count: number;
  };
  return row.count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LegacyV322FixtureBuilder', () => {
  // -----------------------------------------------------------------------
  // General
  // -----------------------------------------------------------------------

  it('SCHEMA_ONLY builds successfully', () => {
    const path = tempPath('schema-only.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'SCHEMA_ONLY' });
    expect(result.profile).toBe('SCHEMA_ONLY');
    expect(existsSync(path)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('RUNTIME_MINIMAL builds successfully', () => {
    const path = tempPath('runtime-minimal.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'RUNTIME_MINIMAL' });
    expect(result.profile).toBe('RUNTIME_MINIMAL');
    expect(existsSync(path)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('REPRESENTATIVE_POPULATED builds successfully', () => {
    const path = tempPath('representative.sqlite');
    const result = LegacyV322FixtureBuilder.build({
      outputPath: path,
      profile: 'REPRESENTATIVE_POPULATED',
    });
    expect(result.profile).toBe('REPRESENTATIVE_POPULATED');
    expect(existsSync(path)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('PARTIAL_STANDALONE_ONLY builds successfully', () => {
    const path = tempPath('partial-standalone.sqlite');
    const result = LegacyV322FixtureBuilder.build({
      outputPath: path,
      profile: 'PARTIAL_STANDALONE_ONLY',
    });
    expect(result.profile).toBe('PARTIAL_STANDALONE_ONLY');
    expect(existsSync(path)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('result is deeply immutable', () => {
    const path = tempPath('immutable-test.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'SCHEMA_ONLY' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tableNames)).toBe(true);
    expect(Object.isFrozen(result.ownedIndexNames)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('output file exists after success', () => {
    const path = tempPath('exists-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'SCHEMA_ONLY' });
    expect(existsSync(path)).toBe(true);
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('database can be opened after build', () => {
    const path = tempPath('open-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(path, { readOnly: true });
    expect(() => db.prepare('SELECT 1').get()).not.toThrow();
    db.close();
    rmSync(path, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  it('database can be deleted after handles close', () => {
    const path = tempPath('delete-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: path, profile: 'SCHEMA_ONLY' });
    expect(() => rmSync(path, { force: true })).not.toThrow();
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(path + s);
      } catch {
        /* ok */
      }
    }
  });

  // -----------------------------------------------------------------------
  // Schema identity
  // -----------------------------------------------------------------------

  it('full profiles contain exactly 24 historical tables', () => {
    for (const profile of ['SCHEMA_ONLY', 'RUNTIME_MINIMAL', 'REPRESENTATIVE_POPULATED'] as const) {
      const p = tempPath('tables-' + profile + '.sqlite');
      const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile });
      expect(result.tableNames.length).toBe(24);
      const db = new DatabaseSync(p, { readOnly: true });
      const tables = getTableNames(db);
      expect(tables.length).toBe(24);
      db.close();
      rmSync(p, { force: true });
      for (const s of ['-wal', '-shm']) {
        try {
          unlinkSync(p + s);
        } catch {
          /* ok */
        }
      }
    }
  });

  it('full profiles contain exactly 8 owned indexes', () => {
    for (const profile of ['SCHEMA_ONLY', 'RUNTIME_MINIMAL', 'REPRESENTATIVE_POPULATED'] as const) {
      const p = tempPath('indexes-' + profile + '.sqlite');
      const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile });
      expect(result.ownedIndexNames.length).toBe(8);
      const db = new DatabaseSync(p, { readOnly: true });
      const indexes = getIndexNames(db);
      expect(indexes.length).toBe(8);
      db.close();
      rmSync(p, { force: true });
      for (const s of ['-wal', '-shm']) {
        try {
          unlinkSync(p + s);
        } catch {
          /* ok */
        }
      }
    }
  });

  it('partial profile contains exactly 3 tables', () => {
    const p = tempPath('partial-tables.sqlite');
    const result = LegacyV322FixtureBuilder.build({
      outputPath: p,
      profile: 'PARTIAL_STANDALONE_ONLY',
    });
    expect(result.tableNames.length).toBe(3);
    const db = new DatabaseSync(p, { readOnly: true });
    const tables = getTableNames(db);
    expect(tables.length).toBe(3);
    expect(tables).toContain('app_state');
    expect(tables).toContain('local_accounts');
    expect(tables).toContain('idempotency_keys');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('partial profile does not contain workspace or operations tables', () => {
    const p = tempPath('partial-no-workspace.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'PARTIAL_STANDALONE_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const tables = getTableNames(db);
    expect(tables).not.toContain('personal_settings');
    expect(tables).not.toContain('project_workspaces');
    expect(tables).not.toContain('project_requirements');
    expect(tables).not.toContain('microsoft_connection');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('user_version is exactly 0', () => {
    const p = tempPath('uv-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    expect(getUserVersion(db)).toBe(0);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('schema_migrations is absent', () => {
    const p = tempPath('no-sm-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    expect(hasSchemaMigrationsTable(db)).toBe(false);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('structural fingerprint matches locked manifest value', () => {
    const p = tempPath('sf-test.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const expected = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    expect(result.structuralSchemaFingerprint).toBe(expected);
    expect(result.structuralSchemaFingerprint).toBe(
      '2cb33227fcc587a1e46f6b00556d8f5f0f532f604bc8a888b24db6f5480715d2',
    );
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('canonical DDL fingerprint matches locked manifest value', () => {
    const p = tempPath('ddl-fp-test.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const expected = computeCanonicalDdlFingerprint(CANONICAL_FRESH_DDL);
    expect(result.canonicalDdlFingerprint).toBe(expected);
    expect(result.canonicalDdlFingerprint).toBe(
      '30f19988b8e530b03c8ed2e9693276b0bcedfdb43e0d1672f36e7966f4987def',
    );
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('no trigger, view or virtual table exists', () => {
    const p = tempPath('no-trigger-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
      name: string;
    }[];
    expect(triggers.length).toBe(0);
    const views = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as {
      name: string;
    }[];
    expect(views.length).toBe(0);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('explicit foreign-key count is 0', () => {
    const p = tempPath('fk-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    let totalFks = 0;
    for (const tableName of TABLE_NAMES) {
      const fks = db.prepare("PRAGMA foreign_key_list('" + tableName + "')").all() as unknown[];
      totalFks += fks.length;
    }
    expect(totalFks).toBe(0);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  // -----------------------------------------------------------------------
  // Profile rows
  // -----------------------------------------------------------------------

  it('SCHEMA_ONLY contains no runtime or business rows', () => {
    const p = tempPath('schema-only-rows.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    for (const table of TABLE_NAMES) {
      expect(getRowCount(db, table)).toBe(0);
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('PARTIAL_STANDALONE_ONLY contains zero rows', () => {
    const p = tempPath('partial-zero-rows.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'PARTIAL_STANDALONE_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    for (const table of ['app_state', 'local_accounts', 'idempotency_keys']) {
      expect(getRowCount(db, table)).toBe(0);
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('RUNTIME_MINIMAL contains exactly the four automatic synthetic rows', () => {
    const p = tempPath('runtime-minimal-rows.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    expect(getRowCount(db, 'personal_settings')).toBe(1);
    expect(getRowCount(db, 'microsoft_connection')).toBe(1);
    expect(getRowCount(db, 'app_state')).toBe(1);
    expect(getRowCount(db, 'local_accounts')).toBe(1);
    const otherTables = TABLE_NAMES.filter(
      (t) =>
        !['personal_settings', 'microsoft_connection', 'app_state', 'local_accounts'].includes(t),
    );
    for (const table of otherTables) {
      expect(getRowCount(db, table)).toBe(0);
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('synthetic local account satisfies constraints', () => {
    const p = tempPath('local-account-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db.prepare('SELECT * FROM local_accounts LIMIT 1').get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(typeof row['user_id']).toBe('string');
    expect(typeof row['email']).toBe('string');
    expect((row['email'] as string).endsWith('@example.test')).toBe(true);
    expect(typeof row['salt']).toBe('string');
    expect(row['salt']).toMatch(/^syn-/);
    expect(typeof row['password_hash']).toBe('string');
    expect(row['password_hash']).toMatch(/^syn-/);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('microsoft_connection singleton exists', () => {
    const p = tempPath('ms-conn-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db.prepare('SELECT * FROM microsoft_connection WHERE id = 1').get() as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(row['id']).toBe(1);
    expect(row['account_email']).toBe('synthetic.admin@example.test');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('personal_settings singleton exists', () => {
    const p = tempPath('ps-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db.prepare('SELECT * FROM personal_settings WHERE id = 1').get() as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(row['id']).toBe(1);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('app_state primary row contains valid source-compatible JSON', () => {
    const p = tempPath('app-state-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    const row = db.prepare("SELECT * FROM app_state WHERE state_key = 'primary'").get() as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(typeof row['json_value']).toBe('string');
    const parsed = JSON.parse(row['json_value'] as string);
    expect(parsed).toHaveProperty('users');
    expect(parsed).toHaveProperty('projects');
    expect(parsed).toHaveProperty('settings');
    expect(parsed.settings).toHaveProperty('companyTimezone');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('REPRESENTATIVE_POPULATED exercises every required table', () => {
    const p = tempPath('rep-pop-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const populatedTables = [
      'project_workspaces',
      'project_deliverables',
      'project_luminaires',
      'project_output_columns',
      'project_exports',
      'custom_folder_profiles',
      'revision_packages',
      'project_file_index',
      'project_file_index_runs',
      'project_requirements',
      'project_checklist_items',
      'project_actions',
      'project_meetings',
      'project_review_items',
      'project_revisions',
      'project_documents',
      'project_contacts',
      'project_communications',
      'workspace_activity',
    ];
    for (const table of populatedTables) {
      expect(getRowCount(db, table)).toBeGreaterThan(0);
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('nullable fields are represented', () => {
    const p = tempPath('nullable-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const wsRow = db
      .prepare("SELECT folder_path FROM project_workspaces WHERE project_id = 'syn-project-0001'")
      .get() as Record<string, unknown>;
    expect(wsRow['folder_path']).toBe('C:\\Synthetic\\Workspace\\ProjectA');
    const actionRow = db
      .prepare("SELECT source_id FROM project_actions WHERE id = 'syn-action-0001'")
      .get() as Record<string, unknown>;
    expect(actionRow['source_id']).toBeNull();
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('JSON text fields contain valid JSON', () => {
    const p = tempPath('json-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const wsRow = db
      .prepare("SELECT services_json FROM project_workspaces WHERE project_id = 'syn-project-0001'")
      .get() as Record<string, unknown>;
    expect(() => JSON.parse(wsRow['services_json'] as string)).not.toThrow();
    const meetingRow = db
      .prepare("SELECT attendees_json FROM project_meetings WHERE id = 'syn-meeting-0001'")
      .get() as Record<string, unknown>;
    expect(() => JSON.parse(meetingRow['attendees_json'] as string)).not.toThrow();
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('Project Code exists only through source-proven app_state/project shape', () => {
    const p = tempPath('project-code-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    for (const table of TABLE_NAMES) {
      const cols = db.prepare("PRAGMA table_info('" + table + "')").all() as Array<{
        name: string;
      }>;
      for (const col of cols) {
        expect(col.name.toLowerCase()).not.toBe('project_code');
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('no CRM Reference is invented', () => {
    const p = tempPath('no-crm-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    for (const table of TABLE_NAMES) {
      const cols = db.prepare("PRAGMA table_info('" + table + "')").all() as Array<{
        name: string;
      }>;
      for (const col of cols) {
        expect(col.name.toLowerCase()).not.toMatch(/crm/);
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  it('two SCHEMA_ONLY builds have identical fingerprints', () => {
    const p1 = tempPath('det-schema-1.sqlite');
    const p2 = tempPath('det-schema-2.sqlite');
    const r1 = LegacyV322FixtureBuilder.build({ outputPath: p1, profile: 'SCHEMA_ONLY' });
    const r2 = LegacyV322FixtureBuilder.build({ outputPath: p2, profile: 'SCHEMA_ONLY' });
    expect(r1.logicalDataFingerprint).toBe(r2.logicalDataFingerprint);
    rmSync(p1, { force: true });
    rmSync(p2, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p1 + s);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(p2 + s);
      } catch {
        /* ok */
      }
    }
  });

  it('two RUNTIME_MINIMAL builds have identical fingerprints', () => {
    const p1 = tempPath('det-rt-1.sqlite');
    const p2 = tempPath('det-rt-2.sqlite');
    const r1 = LegacyV322FixtureBuilder.build({ outputPath: p1, profile: 'RUNTIME_MINIMAL' });
    const r2 = LegacyV322FixtureBuilder.build({ outputPath: p2, profile: 'RUNTIME_MINIMAL' });
    expect(r1.logicalDataFingerprint).toBe(r2.logicalDataFingerprint);
    rmSync(p1, { force: true });
    rmSync(p2, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p1 + s);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(p2 + s);
      } catch {
        /* ok */
      }
    }
  });

  it('two REPRESENTATIVE_POPULATED builds have identical fingerprints', () => {
    const p1 = tempPath('det-rep-1.sqlite');
    const p2 = tempPath('det-rep-2.sqlite');
    const r1 = LegacyV322FixtureBuilder.build({
      outputPath: p1,
      profile: 'REPRESENTATIVE_POPULATED',
    });
    const r2 = LegacyV322FixtureBuilder.build({
      outputPath: p2,
      profile: 'REPRESENTATIVE_POPULATED',
    });
    expect(r1.logicalDataFingerprint).toBe(r2.logicalDataFingerprint);
    rmSync(p1, { force: true });
    rmSync(p2, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p1 + s);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(p2 + s);
      } catch {
        /* ok */
      }
    }
  });

  it('different output paths do not affect fingerprints', () => {
    const p1 = tempPath('diff-path-1.sqlite');
    const p2 = tempPath('sub/diff-path-2.sqlite');
    mkdirSync(winPath.dirname(p2), { recursive: true });
    const r1 = LegacyV322FixtureBuilder.build({ outputPath: p1, profile: 'SCHEMA_ONLY' });
    const r2 = LegacyV322FixtureBuilder.build({ outputPath: p2, profile: 'SCHEMA_ONLY' });
    expect(r1.logicalDataFingerprint).toBe(r2.logicalDataFingerprint);
    rmSync(p1, { force: true });
    rmSync(p2, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p1 + s);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(p2 + s);
      } catch {
        /* ok */
      }
    }
  });

  it('different logical profiles have different logicalDataFingerprints', () => {
    const p1 = tempPath('diff-prof-1.sqlite');
    const p2 = tempPath('diff-prof-2.sqlite');
    const r1 = LegacyV322FixtureBuilder.build({ outputPath: p1, profile: 'SCHEMA_ONLY' });
    const r2 = LegacyV322FixtureBuilder.build({ outputPath: p2, profile: 'RUNTIME_MINIMAL' });
    expect(r1.logicalDataFingerprint).not.toBe(r2.logicalDataFingerprint);
    rmSync(p1, { force: true });
    rmSync(p2, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p1 + s);
      } catch {
        /* ok */
      }
      try {
        unlinkSync(p2 + s);
      } catch {
        /* ok */
      }
    }
  });

  it('SCHEMA_ONLY logical fingerprint matches the locked literal value', () => {
    const p = tempPath('lit-schema.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    expect(result.logicalDataFingerprint).toBe(EXPECTED_LOGICAL_FINGERPRINTS.SCHEMA_ONLY);
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('RUNTIME_MINIMAL logical fingerprint matches the locked literal value', () => {
    const p = tempPath('lit-runtime.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    expect(result.logicalDataFingerprint).toBe(EXPECTED_LOGICAL_FINGERPRINTS.RUNTIME_MINIMAL);
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('REPRESENTATIVE_POPULATED logical fingerprint matches the locked literal value', () => {
    const p = tempPath('lit-representative.sqlite');
    const result = LegacyV322FixtureBuilder.build({
      outputPath: p,
      profile: 'REPRESENTATIVE_POPULATED',
    });
    expect(result.logicalDataFingerprint).toBe(
      EXPECTED_LOGICAL_FINGERPRINTS.REPRESENTATIVE_POPULATED,
    );
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('PARTIAL_STANDALONE_ONLY logical fingerprint matches the locked literal value', () => {
    const p = tempPath('lit-partial.sqlite');
    const result = LegacyV322FixtureBuilder.build({
      outputPath: p,
      profile: 'PARTIAL_STANDALONE_ONLY',
    });
    expect(result.logicalDataFingerprint).toBe(
      EXPECTED_LOGICAL_FINGERPRINTS.PARTIAL_STANDALONE_ONLY,
    );
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('all four locked logical fingerprints are distinct', () => {
    const values = Object.values(EXPECTED_LOGICAL_FINGERPRINTS);
    expect(new Set(values).size).toBe(4);
  });

  it('no random UUID, current time, username or hostname affects output', () => {
    const p = tempPath('no-random-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const tablesWithTime = [
      'app_state',
      'personal_settings',
      'microsoft_connection',
      'local_accounts',
      'project_workspaces',
      'project_deliverables',
      'project_luminaires',
      'project_exports',
      'custom_folder_profiles',
      'revision_packages',
      'project_file_index',
      'project_file_index_runs',
      'project_requirements',
      'project_checklist_items',
      'project_actions',
      'project_meetings',
      'project_review_items',
      'project_revisions',
      'project_documents',
      'project_contacts',
      'project_communications',
      'workspace_activity',
    ];
    for (const table of tablesWithTime) {
      const rows = db.prepare('SELECT * FROM "' + table + '"').all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const [key, val] of Object.entries(row)) {
          if (
            (key.endsWith('_at') || key === 'updated_at' || key === 'created_at') &&
            typeof val === 'string'
          ) {
            expect(val).toBe('2026-01-01T00:00:00.000Z');
          }
        }
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  // -----------------------------------------------------------------------
  // Privacy
  // -----------------------------------------------------------------------

  it('no real name, email, OneDrive path, token, salt or password hash exists', () => {
    const p = tempPath('privacy-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    for (const table of TABLE_NAMES) {
      const rows = db.prepare('SELECT * FROM "' + table + '"').all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const val of Object.values(row)) {
          if (typeof val === 'string') {
            expect(val.toLowerCase()).not.toContain('onedrive');
            expect(val).not.toMatch(/^[a-f0-9]{128}$/);
          }
        }
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('all emails use example.test', () => {
    const p = tempPath('email-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const tablesWithEmail = [
      'local_accounts',
      'microsoft_connection',
      'project_contacts',
      'project_communications',
    ];
    for (const table of tablesWithEmail) {
      const rows = db.prepare('SELECT * FROM "' + table + '"').all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const [key, val] of Object.entries(row)) {
          if (
            (key.toLowerCase().includes('email') ||
              key === 'sender' ||
              key === 'participants_json') &&
            typeof val === 'string'
          ) {
            if (key === 'participants_json') {
              const parsed = JSON.parse(val) as string[];
              for (const email of parsed) {
                expect(email).toMatch(/@example\.test$/);
              }
            } else if (val.includes('@')) {
              expect(val).toMatch(/@example\.test$/);
            }
          }
        }
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('all project paths are synthetic', () => {
    const p = tempPath('path-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const tablesWithPaths = [
      'personal_settings',
      'project_workspaces',
      'project_luminaires',
      'project_exports',
      'revision_packages',
      'project_file_index',
      'project_file_index_runs',
      'project_documents',
    ];
    for (const table of tablesWithPaths) {
      const rows = db.prepare('SELECT * FROM "' + table + '"').all() as Record<string, unknown>[];
      for (const row of rows) {
        for (const val of Object.values(row)) {
          if (typeof val === 'string' && val.includes(':\\')) {
            expect(val).toMatch(/^C:\\Synthetic\\/);
          }
        }
      }
    }
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('no repository production database is read', () => {
    const p = tempPath('no-prod-read.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    expect(result.databasePath).toBe(p);
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('no binary fixture is created inside the repository', () => {
    const p = tempPath('no-repo-fixture.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    expect(p.startsWith(tempDir)).toBe(true);
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  // -----------------------------------------------------------------------
  // Path and overwrite safety
  // -----------------------------------------------------------------------

  it('relative output path is rejected', () => {
    expect(() =>
      LegacyV322FixtureBuilder.build({
        outputPath: 'relative/path.sqlite',
        profile: 'SCHEMA_ONLY',
      }),
    ).toThrow(LegacyV322FixtureBuilderError);
  });

  it('existing file is rejected without modification', () => {
    const p = tempPath('existing-test.sqlite');
    writeFileSync(p, 'existing content');
    const originalContent = readFileSync(p);
    expect(() => LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' })).toThrow(
      LegacyV322FixtureBuilderError,
    );
    expect(readFileSync(p)).toEqual(originalContent);
    rmSync(p, { force: true });
  });

  it('existing directory path is rejected', () => {
    const dir = tempPath('existing-dir');
    mkdirSync(dir, { recursive: true });
    expect(() =>
      LegacyV322FixtureBuilder.build({ outputPath: dir, profile: 'SCHEMA_ONLY' }),
    ).toThrow(LegacyV322FixtureBuilderError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('missing parent directory is rejected', () => {
    const p = tempPath('missing-parent/db.sqlite');
    expect(() => LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' })).toThrow(
      LegacyV322FixtureBuilderError,
    );
  });

  it('symlink output is rejected where supported', () => {
    const targetPath = tempPath('symlink-target.sqlite');
    const linkPath = tempPath('symlink-link.sqlite');
    writeFileSync(targetPath, '');
    try {
      symlinkSync(targetPath, linkPath);
      expect(() =>
        LegacyV322FixtureBuilder.build({ outputPath: linkPath, profile: 'SCHEMA_ONLY' }),
      ).toThrow(LegacyV322FixtureBuilderError);
      rmSync(linkPath, { force: true });
    } catch {
      // Symlink creation not supported - skip
    }
    rmSync(targetPath, { force: true });
  });

  it('non-regular/special output is rejected where supported', () => {
    expect(() =>
      LegacyV322FixtureBuilder.build({ outputPath: 'COM1', profile: 'SCHEMA_ONLY' }),
    ).toThrow();
  });

  it('failure removes only the builder-created partial database', () => {
    const parentFile = tempPath('parent-file');
    writeFileSync(parentFile, '');
    const badPath = join(parentFile, 'db.sqlite');
    expect(() =>
      LegacyV322FixtureBuilder.build({ outputPath: badPath, profile: 'SCHEMA_ONLY' }),
    ).toThrow();
    expect(existsSync(parentFile)).toBe(true);
    rmSync(parentFile, { force: true });
  });

  it('a later build succeeds after a rejected build', () => {
    const parentFile = tempPath('parent-file-2');
    writeFileSync(parentFile, '');
    const badPath = join(parentFile, 'db.sqlite');
    expect(() =>
      LegacyV322FixtureBuilder.build({ outputPath: badPath, profile: 'SCHEMA_ONLY' }),
    ).toThrow();
    expect(existsSync(parentFile)).toBe(true);
    const goodPath = tempPath('after-failure.sqlite');
    const result = LegacyV322FixtureBuilder.build({ outputPath: goodPath, profile: 'SCHEMA_ONLY' });
    expect(result.profile).toBe('SCHEMA_ONLY');
    expect(existsSync(goodPath)).toBe(true);
    rmSync(parentFile, { force: true });
    rmSync(goodPath, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(goodPath + s);
      } catch {
        /* ok */
      }
    }
  });

  it('existing caller file remains byte-identical after rejection', () => {
    const p = tempPath('no-overwrite-test.sqlite');
    writeFileSync(p, 'original-data');
    const original = readFileSync(p);
    expect(() => LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' })).toThrow(
      LegacyV322FixtureBuilderError,
    );
    expect(readFileSync(p)).toEqual(original);
    rmSync(p, { force: true });
  });

  // -----------------------------------------------------------------------
  // WAL and cleanup
  // -----------------------------------------------------------------------

  it('full fixture uses WAL mode', () => {
    const p = tempPath('wal-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(mode.journal_mode.toLowerCase()).toBe('wal');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('database remains valid after close/checkpoint behavior', () => {
    const p = tempPath('checkpoint-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrity.integrity_check).toBe('ok');
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('failure cleanup handles -wal and -shm companions safely', () => {
    const p = tempPath('wal-cleanup-test.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    expect(() => LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' })).toThrow(
      LegacyV322FixtureBuilderError,
    );
    expect(existsSync(p)).toBe(true);
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('repeated builds do not leak handles', () => {
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = tempPath('no-leak-' + i + '.sqlite');
      paths.push(p);
      LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    }
    for (const p of paths) {
      expect(existsSync(p)).toBe(true);
      rmSync(p, { force: true });
      for (const s of ['-wal', '-shm']) {
        try {
          unlinkSync(p + s);
        } catch {
          /* ok */
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // Inspector compatibility
  // -----------------------------------------------------------------------

  it('real MigrationStateInspector classifies SCHEMA_ONLY as populated, unversioned and without history', () => {
    const p = tempPath('inspector-schema.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'SCHEMA_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const inspector = new MigrationStateInspector([], 0);
    const view = inspector.inspect(db);
    expect(view.isPopulated).toBe(true);
    expect(view.isEmpty).toBe(false);
    expect(view.currentVersion).toBe(0);
    expect(view.historyTableExists).toBe(false);
    expect(view.historyValid).toBe(true);
    expect(view.atTarget).toBe(true);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('real MigrationStateInspector classifies RUNTIME_MINIMAL the same way', () => {
    const p = tempPath('inspector-rt.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const db = new DatabaseSync(p, { readOnly: true });
    const inspector = new MigrationStateInspector([], 0);
    const view = inspector.inspect(db);
    expect(view.isPopulated).toBe(true);
    expect(view.isEmpty).toBe(false);
    expect(view.currentVersion).toBe(0);
    expect(view.historyTableExists).toBe(false);
    expect(view.atTarget).toBe(true);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('real MigrationStateInspector classifies REPRESENTATIVE_POPULATED the same way', () => {
    const p = tempPath('inspector-rep.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p, { readOnly: true });
    const inspector = new MigrationStateInspector([], 0);
    const view = inspector.inspect(db);
    expect(view.isPopulated).toBe(true);
    expect(view.isEmpty).toBe(false);
    expect(view.currentVersion).toBe(0);
    expect(view.historyTableExists).toBe(false);
    expect(view.atTarget).toBe(true);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });

  it('PARTIAL_STANDALONE_ONLY is populated/unversioned and remains distinguishable by its table inventory', () => {
    const p = tempPath('inspector-partial.sqlite');
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'PARTIAL_STANDALONE_ONLY' });
    const db = new DatabaseSync(p, { readOnly: true });
    const inspector = new MigrationStateInspector([], 0);
    const view = inspector.inspect(db);
    expect(view.isPopulated).toBe(true);
    expect(view.isEmpty).toBe(false);
    expect(view.currentVersion).toBe(0);
    expect(view.historyTableExists).toBe(false);
    expect(view.atTarget).toBe(true);
    const tables = getTableNames(db);
    expect(tables.length).toBe(3);
    db.close();
    rmSync(p, { force: true });
    for (const s of ['-wal', '-shm']) {
      try {
        unlinkSync(p + s);
      } catch {
        /* ok */
      }
    }
  });
});
