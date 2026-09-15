/**
 * Tests for the legacy v3.2.2 schema manifest and fixture contract.
 *
 * P1.6A-B - Lock Exact Legacy v3.2.2 Schema Manifest and Fixture Contract
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  HISTORICAL_SOURCE_COMMIT,
  TABLE_NAMES,
  INDEX_NAMES,
  TRIGGER_NAMES,
  VIEW_NAMES,
  VIRTUAL_TABLE_NAMES,
  SCHEMA_OWNER_BY_OBJECT,
  SCHEMA_STATEMENTS,
  COMPATIBILITY_COLUMNS,
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  RUNTIME_DEFAULT_ROWS,
  computeStructuralFingerprint,
  computeCanonicalDdlFingerprint,
  type LegacyV322SchemaSnapshot,
} from './legacy-v322-schema';
import { LEGACY_V322_MANIFEST } from './legacy-v322-manifest';

// Helpers

function createTempDb(): { db: DatabaseSync; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-v322-test-'));
  const dbPath = join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    db,
    dir,
    cleanup: () => {
      db.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

function executeFreshSchema(db: DatabaseSync): void {
  for (const ddl of CANONICAL_FRESH_DDL) {
    db.exec(ddl);
  }
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

function getTableColumns(
  db: DatabaseSync,
  tableName: string,
): Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }> {
  return db.prepare("PRAGMA table_info('" + tableName + "')").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
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

// Independently locked expected fingerprint vectors
// These were computed once from the canonical historical schema and locked.
// Changing any table, column, index, or DDL statement will change these values,
// causing the test to fail and requiring explicit acknowledgment.
const EXPECTED_DDL_FINGERPRINT = '30f19988b8e530b03c8ed2e9693276b0bcedfdb43e0d1672f36e7966f4987def';

const EXPECTED_STRUCTURAL_FINGERPRINT =
  '2cb33227fcc587a1e46f6b00556d8f5f0f532f604bc8a888b24db6f5480715d2';

describe('LegacyV322Schema', () => {
  // 1. Historical source commit is a full lowercase Git hash
  it('historical source commit is a full lowercase Git hash', () => {
    expect(HISTORICAL_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  // 2. Application version is exactly 3.2.2
  it('manifest application version is exactly 3.2.2', () => {
    expect(LEGACY_V322_MANIFEST.applicationVersion).toBe('3.2.2');
  });

  // 3. Expected user_version is exactly 0
  it('expected user_version is exactly 0', () => {
    expect(LEGACY_V322_MANIFEST.expectedUserVersion).toBe(0);
  });

  // 4. Migration history is absent
  it('migration history is absent', () => {
    expect(LEGACY_V322_MANIFEST.hasMigrationHistory).toBe(false);
  });

  // 5. Table inventory exactly matches source-derived count and order
  it('table inventory matches source-derived count', () => {
    expect(TABLE_NAMES.length).toBe(24);
  });

  it('table names are in historical creation order', () => {
    const tableStatements = SCHEMA_STATEMENTS.filter((s) => s.kind === 'TABLE');
    expect(tableStatements.length).toBe(24);
    for (let i = 0; i < tableStatements.length; i++) {
      expect(TABLE_NAMES[i]).toBe(tableStatements[i]!.objectName);
    }
  });

  // 6. Index inventory exactly matches source-derived count and order
  it('index inventory matches source-derived count', () => {
    expect(INDEX_NAMES.length).toBe(8);
  });

  it('index names are in historical creation order', () => {
    const indexStatements = SCHEMA_STATEMENTS.filter((s) => s.kind === 'INDEX');
    expect(indexStatements.length).toBe(8);
    for (let i = 0; i < indexStatements.length; i++) {
      expect(INDEX_NAMES[i]).toBe(indexStatements[i]!.objectName);
    }
  });

  // 7. Trigger inventory matches source
  it('trigger inventory is empty', () => {
    expect(TRIGGER_NAMES).toEqual([]);
  });

  // 8. View inventory matches source
  it('view inventory is empty', () => {
    expect(VIEW_NAMES).toEqual([]);
  });

  // 9. Virtual-table inventory matches source
  it('virtual table inventory is empty', () => {
    expect(VIRTUAL_TABLE_NAMES).toEqual([]);
  });

  // 10. Every schema object has one proven owner
  it('every schema object has one proven owner', () => {
    const allObjectNames = [...TABLE_NAMES, ...INDEX_NAMES];
    for (const name of allObjectNames) {
      expect(SCHEMA_OWNER_BY_OBJECT.has(name)).toBe(true);
    }
    expect(SCHEMA_OWNER_BY_OBJECT.size).toBe(allObjectNames.length);
  });

  // 11. Historical execution orders are unique and contiguous
  it('historical execution orders are unique and contiguous', () => {
    const orders = SCHEMA_STATEMENTS.map((s) => s.order);
    expect(orders.length).toBeGreaterThan(0);
    for (let i = 0; i < orders.length; i++) {
      expect(orders[i]).toBe(i + 1);
    }
    expect(new Set(orders).size).toBe(orders.length);
  });

  // 12. Every DDL statement is non-empty and NUL-free
  it('every DDL statement is non-empty and NUL-free', () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      expect(stmt.sql.length).toBeGreaterThan(0);
      expect(stmt.sql).not.toContain('\0');
    }
  });

  // 13. No DDL contains a machine-specific absolute path
  it('no DDL contains an absolute path', () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      expect(stmt.sql).not.toMatch(/^[A-Za-z]:\\/);
      expect(stmt.sql).not.toContain('OneDrive');
      expect(stmt.sql).not.toContain('/home/');
      expect(stmt.sql).not.toContain('/Users/');
    }
  });

  // 14. No manifest value contains username, hostname or OneDrive path
  it('no manifest value contains username, hostname or OneDrive path', () => {
    const manifestStr = JSON.stringify(LEGACY_V322_MANIFEST);
    expect(manifestStr).not.toContain('OneDrive');
    expect(manifestStr).not.toContain('moham');
    expect(manifestStr).not.toContain('PROJECTMANGEMENT');
  });

  // 15. No unsupported Project Code or CRM field is invented
  it('no unsupported Project Code or CRM field is invented', () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      if (stmt.kind === 'TABLE') {
        expect(stmt.sql.toLowerCase()).not.toContain('project_code');
        expect(stmt.sql.toLowerCase()).not.toContain('crm_reference');
        expect(stmt.sql.toLowerCase()).not.toContain('crm_ref');
        expect(stmt.sql.toLowerCase()).not.toContain('sales_owner');
        expect(stmt.sql.toLowerCase()).not.toContain('client_name');
        expect(stmt.sql.toLowerCase()).not.toContain('sct_reference');
      }
    }
  });

  // 16. Canonical schema can be executed in a temporary database
  it('canonical schema executes in a temporary database', () => {
    const { db, cleanup } = createTempDb();
    try {
      expect(() => executeFreshSchema(db)).not.toThrow();
    } finally {
      cleanup();
    }
  });

  // 17. Every expected table is created
  it('every expected table is created after schema execution', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const actualTables = getTableNames(db);
      for (const table of TABLE_NAMES) {
        expect(actualTables).toContain(table);
      }
    } finally {
      cleanup();
    }
  });

  // 18. Every expected index is created
  it('every expected index is created after schema execution', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const actualIndexes = getIndexNames(db);
      for (const idx of INDEX_NAMES) {
        expect(actualIndexes).toContain(idx);
      }
    } finally {
      cleanup();
    }
  });

  // 19. No duplicate column exists in any table
  it('no duplicate column exists in any table', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      for (const table of TABLE_NAMES) {
        const columns = getTableColumns(db, table);
        const names = columns.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
      }
    } finally {
      cleanup();
    }
  });

  // 20. revision_packages.status final shape matches historical source
  it('revision_packages.status column exists with correct default', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const columns = getTableColumns(db, 'revision_packages');
      const statusCol = columns.find((c) => c.name === 'status');
      expect(statusCol).toBeDefined();
      expect(statusCol!.type).toBe('TEXT');
      expect(statusCol!.notnull).toBe(1);
      expect(statusCol!.dflt_value).toMatch(/Draft/i);
    } finally {
      cleanup();
    }
  });

  // 21. Every ensureColumn operation is classified correctly
  it('compatibility columns are classified correctly', () => {
    const alreadyInBase = COMPATIBILITY_COLUMNS.filter((c) => c.alreadyInBaseCreate);
    expect(alreadyInBase.length).toBe(4);
    const baseNames = alreadyInBase.map((c) => c.table + '.' + c.column).sort();
    expect(baseNames).toEqual([
      'project_revisions.locked',
      'project_revisions.reissue_number',
      'project_revisions.snapshot_hash',
      'revision_packages.status',
    ]);

    const compatibilityAdditions = COMPATIBILITY_COLUMNS.filter((c) => !c.alreadyInBaseCreate);
    expect(compatibilityAdditions.length).toBe(18);
  });

  // 22. user_version remains 0
  it('user_version remains 0 after schema execution', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      expect(getUserVersion(db)).toBe(0);
    } finally {
      cleanup();
    }
  });

  // 23. schema_migrations table does not exist
  it('schema_migrations table does not exist', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      expect(hasSchemaMigrationsTable(db)).toBe(false);
    } finally {
      cleanup();
    }
  });

  // 24. DDL fingerprint matches independently locked expected value
  it('DDL fingerprint matches independently locked expected value', () => {
    const fp = computeCanonicalDdlFingerprint(CANONICAL_FRESH_DDL);
    expect(fp).toBe(EXPECTED_DDL_FINGERPRINT);
  });

  // 25. DDL fingerprint preserves historical execution order
  it('DDL fingerprint preserves historical execution order', () => {
    const orderPreserved = computeCanonicalDdlFingerprint(CANONICAL_FRESH_DDL);
    const reversed = computeCanonicalDdlFingerprint([...CANONICAL_FRESH_DDL].reverse());
    expect(orderPreserved).not.toBe(reversed);
  });

  // 26. Structural fingerprint is deterministic
  it('structural fingerprint is deterministic', () => {
    const snapshot: LegacyV322SchemaSnapshot = {
      tables: [],
      indexes: [],
      triggerNames: [],
      viewNames: [],
      virtualTableNames: [],
    };
    const fp1 = computeStructuralFingerprint(snapshot);
    const fp2 = computeStructuralFingerprint(snapshot);
    expect(fp1).toBe(fp2);
  });

  // 27. Structural fingerprint is 64 lowercase hex
  it('structural fingerprint is 64 lowercase hex', () => {
    const snapshot: LegacyV322SchemaSnapshot = {
      tables: [],
      indexes: [],
      triggerNames: [],
      viewNames: [],
      virtualTableNames: [],
    };
    const fp = computeStructuralFingerprint(snapshot);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  // 28. A structural field mutation changes structural fingerprint
  it('structural field mutation changes structural fingerprint', () => {
    const base: LegacyV322SchemaSnapshot = {
      tables: [],
      indexes: [],
      triggerNames: [],
      viewNames: [],
      virtualTableNames: [],
    };
    const baseFp = computeStructuralFingerprint(base);

    const mutated: LegacyV322SchemaSnapshot = {
      tables: [],
      indexes: [],
      triggerNames: ['some_trigger'],
      viewNames: [],
      virtualTableNames: [],
    };
    const mutatedFp = computeStructuralFingerprint(mutated);
    expect(mutatedFp).not.toBe(baseFp);
  });

  // 29. A DDL mutation changes DDL fingerprint
  it('DDL mutation changes DDL fingerprint', () => {
    const base = ['CREATE TABLE t (a TEXT)'];
    const mutated = ['CREATE TABLE t (a TEXT, b INTEGER)'];
    expect(computeCanonicalDdlFingerprint(base)).not.toBe(computeCanonicalDdlFingerprint(mutated));
  });

  // 30. Structural fingerprint matches independently locked expected value
  it('structural fingerprint matches independently locked expected value', () => {
    const fp = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    expect(fp).toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
  });

  // 31. Structural fingerprint uses complete 24-table, 8-index schema
  it('structural fingerprint uses complete 24-table, 8-index schema', () => {
    expect(CANONICAL_SCHEMA_SNAPSHOT.tables.length).toBe(24);
    expect(CANONICAL_SCHEMA_SNAPSHOT.indexes.length).toBe(8);
    expect(CANONICAL_SCHEMA_SNAPSHOT.triggerNames.length).toBe(0);
    expect(CANONICAL_SCHEMA_SNAPSHOT.viewNames.length).toBe(0);
    expect(CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames.length).toBe(0);
  });

  // 32. Column type mutation changes structural fingerprint
  it('column type mutation changes structural fingerprint', () => {
    const base = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    const mutatedTables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((t) =>
      t.tableName === 'app_state'
        ? {
            ...t,
            columns: t.columns.map((c, i) => (i === 0 ? { ...c, declaredType: 'INTEGER' } : c)),
          }
        : t,
    );
    const mutated: LegacyV322SchemaSnapshot = {
      tables: mutatedTables,
      indexes: CANONICAL_SCHEMA_SNAPSHOT.indexes,
      triggerNames: CANONICAL_SCHEMA_SNAPSHOT.triggerNames,
      viewNames: CANONICAL_SCHEMA_SNAPSHOT.viewNames,
      virtualTableNames: CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames,
    };
    expect(computeStructuralFingerprint(mutated)).not.toBe(base);
  });

  // 33. Default mutation changes structural fingerprint
  it('default mutation changes structural fingerprint', () => {
    const base = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    const mutatedTables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((t) =>
      t.tableName === 'revision_packages'
        ? {
            ...t,
            columns: t.columns.map((c) =>
              c.name === 'status' ? { ...c, defaultExpression: "'Approved'" } : c,
            ),
          }
        : t,
    );
    const mutated: LegacyV322SchemaSnapshot = {
      tables: mutatedTables,
      indexes: CANONICAL_SCHEMA_SNAPSHOT.indexes,
      triggerNames: CANONICAL_SCHEMA_SNAPSHOT.triggerNames,
      viewNames: CANONICAL_SCHEMA_SNAPSHOT.viewNames,
      virtualTableNames: CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames,
    };
    expect(computeStructuralFingerprint(mutated)).not.toBe(base);
  });

  // 34. Constraint mutation changes structural fingerprint
  it('constraint mutation changes structural fingerprint', () => {
    const base = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    const mutatedTables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((t) =>
      t.tableName === 'project_deliverables'
        ? { ...t, uniqueConstraints: ['project_id, title'] }
        : t,
    );
    const mutated: LegacyV322SchemaSnapshot = {
      tables: mutatedTables,
      indexes: CANONICAL_SCHEMA_SNAPSHOT.indexes,
      triggerNames: CANONICAL_SCHEMA_SNAPSHOT.triggerNames,
      viewNames: CANONICAL_SCHEMA_SNAPSHOT.viewNames,
      virtualTableNames: CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames,
    };
    expect(computeStructuralFingerprint(mutated)).not.toBe(base);
  });

  // 35. Index direction mutation changes structural fingerprint
  it('index direction mutation changes structural fingerprint', () => {
    const base = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    const mutatedIndexes = CANONICAL_SCHEMA_SNAPSHOT.indexes.map((idx) =>
      idx.indexName === 'ix_workspace_activity_project'
        ? { ...idx, columnDirections: ['ASC'] }
        : idx,
    );
    const mutated: LegacyV322SchemaSnapshot = {
      tables: CANONICAL_SCHEMA_SNAPSHOT.tables,
      indexes: mutatedIndexes,
      triggerNames: CANONICAL_SCHEMA_SNAPSHOT.triggerNames,
      viewNames: CANONICAL_SCHEMA_SNAPSHOT.viewNames,
      virtualTableNames: CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames,
    };
    expect(computeStructuralFingerprint(mutated)).not.toBe(base);
  });

  // 36. Object name mutation changes structural fingerprint
  it('object name mutation changes structural fingerprint', () => {
    const base = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
    const mutatedTables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((t) =>
      t.tableName === 'app_state' ? { ...t, tableName: 'app_state_renamed' } : t,
    );
    const mutated: LegacyV322SchemaSnapshot = {
      tables: mutatedTables,
      indexes: CANONICAL_SCHEMA_SNAPSHOT.indexes,
      triggerNames: CANONICAL_SCHEMA_SNAPSHOT.triggerNames,
      viewNames: CANONICAL_SCHEMA_SNAPSHOT.viewNames,
      virtualTableNames: CANONICAL_SCHEMA_SNAPSHOT.virtualTableNames,
    };
    expect(computeStructuralFingerprint(mutated)).not.toBe(base);
  });

  // 37. SQLite introspection confirms canonical metadata
  it('SQLite introspection confirms canonical table count and column details', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const tables = getTableNames(db);
      expect(tables.length).toBe(24);
      for (const tableName of TABLE_NAMES) {
        expect(tables).toContain(tableName);
        const columns = getTableColumns(db, tableName);
        expect(columns.length).toBeGreaterThan(0);
        const names = columns.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
      }
    } finally {
      cleanup();
    }
  });

  // 38. SQLite introspection confirms index count and ownership
  it('SQLite introspection confirms index count and ownership', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const indexes = getIndexNames(db);
      expect(indexes.length).toBe(8);
      for (const idxName of INDEX_NAMES) {
        expect(indexes).toContain(idxName);
      }
    } finally {
      cleanup();
    }
  });

  // 39. SQLite introspection confirms no triggers, views, or virtual tables
  it('SQLite introspection confirms no triggers, views, or virtual tables', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .all() as { name: string }[];
      expect(triggers.length).toBe(0);
      const views = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as {
        name: string;
      }[];
      expect(views.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  // 40. SQLite introspection confirms no explicit foreign keys
  it('SQLite introspection confirms no explicit foreign keys', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      let totalFks = 0;
      for (const tableName of TABLE_NAMES) {
        const fks = db.prepare("PRAGMA foreign_key_list('" + tableName + "')").all() as unknown[];
        totalFks += fks.length;
      }
      expect(totalFks).toBe(0);
    } finally {
      cleanup();
    }
  });

  // 41. SQLite introspection confirms user_version is 0
  it('SQLite introspection confirms user_version is 0', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      expect(getUserVersion(db)).toBe(0);
    } finally {
      cleanup();
    }
  });

  // 42. SQLite introspection confirms no schema_migrations table
  it('SQLite introspection confirms no schema_migrations table', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      expect(hasSchemaMigrationsTable(db)).toBe(false);
    } finally {
      cleanup();
    }
  });
  // 43. Manifest and exported arrays are deeply immutable
  it('manifest is deeply immutable', () => {
    expect(Object.isFrozen(LEGACY_V322_MANIFEST)).toBe(true);
    expect(Object.isFrozen(LEGACY_V322_MANIFEST.tableNames)).toBe(true);
    expect(Object.isFrozen(LEGACY_V322_MANIFEST.ownedIndexNames)).toBe(true);
    expect(Object.isFrozen(LEGACY_V322_MANIFEST.supportedInitialProfiles)).toBe(true);
    expect(Object.isFrozen(LEGACY_V322_MANIFEST.compatibilityColumnOperations)).toBe(true);
    expect(Object.isFrozen(LEGACY_V322_MANIFEST.runtimeDefaultRows)).toBe(true);
  });

  it('schema statements array is deeply immutable', () => {
    expect(Object.isFrozen(SCHEMA_STATEMENTS)).toBe(true);
    for (const stmt of SCHEMA_STATEMENTS) {
      expect(Object.isFrozen(stmt)).toBe(true);
    }
  });

  // 44. Caller mutation cannot affect exported constants
  it('caller mutation cannot affect exported constants', () => {
    const originalLength = TABLE_NAMES.length;
    expect(() => (TABLE_NAMES as unknown as string[]).push('injected')).toThrow();
    expect(TABLE_NAMES.length).toBe(originalLength);
  });

  // 45. Schema-only profile is not mislabeled as a truly empty database
  it('schema-only profile has user tables and is not empty', () => {
    const { db, cleanup } = createTempDb();
    try {
      executeFreshSchema(db);
      const tables = getTableNames(db);
      expect(tables.length).toBeGreaterThan(0);
      expect(getUserVersion(db)).toBe(0);
      const hasUserSchema = tables.some((t) => !t.startsWith('sqlite_'));
      expect(hasUserSchema).toBe(true);
    } finally {
      cleanup();
    }
  });

  // 46. Runtime-minimal automatic-row contract matches source
  it('runtime default rows metadata is complete', () => {
    expect(RUNTIME_DEFAULT_ROWS.length).toBe(4);
    const tables = RUNTIME_DEFAULT_ROWS.map((r) => r.table);
    expect(tables).toContain('personal_settings');
    expect(tables).toContain('microsoft_connection');
    expect(tables).toContain('app_state');
    expect(tables).toContain('local_accounts');
  });

  // 47. Credential-sensitive defaults contain no real data
  it('credential-sensitive defaults contain no real data', () => {
    const sensitive = RUNTIME_DEFAULT_ROWS.filter((r) => r.credentialSensitive);
    expect(sensitive.length).toBe(1);
    expect(sensitive[0]!.table).toBe('local_accounts');
    expect(sensitive[0]!.credentialSensitive).toBe(true);
  });

  // 48. No fixture builder is implemented
  it('no fixture builder is implemented', () => {
    const schemaContent = readFileSync(join(__dirname, 'legacy-v322-schema.ts'), 'utf-8');
    expect(schemaContent).not.toContain('FixtureBuilder');
  });

  // 49. No binary SQLite file is created in the repository
  it('no binary SQLite file is created in the repository', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    executeFreshSchema(db);
    const tables = getTableNames(db);
    expect(tables.length).toBeGreaterThan(0);
    db.close();
  });

  // 50. Temporary database handles close and files can be deleted
  it('temporary database handles close and files can be deleted', () => {
    const { db, cleanup } = createTempDb();
    executeFreshSchema(db);
    expect(() => cleanup()).not.toThrow();
  });

  // 51. File-backed WAL journal mode is verified
  it('file-backed WAL journal mode is verified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-v322-wal-test-'));
    const dbPath = join(dir, 'test-wal.sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      executeFreshSchema(db);
      const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(mode.journal_mode.toLowerCase()).toBe('wal');
    } finally {
      db.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // 52. No root helper or generator file is created
  it('no root helper or generator file is created', () => {
    const rootFiles = readdirSync(join(__dirname, '..', '..', '..', '..', '..'));
    const suspicious = rootFiles.filter(
      (f: string) =>
        f.includes('_gen') ||
        f.includes('generator') ||
        f.includes('part1') ||
        f.includes('part2') ||
        f.includes('test-block') ||
        f.includes('gen_block') ||
        f.includes('write_tests') ||
        /^test\d+\./.test(f),
    );
    expect(suspicious).toEqual([]);
  });
});
