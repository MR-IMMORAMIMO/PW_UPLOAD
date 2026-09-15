import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MigrationDefinition } from './types';
import { MigrationStateInspector } from './MigrationStateInspector';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);
const BAD_CHECKSUM = 'z'.repeat(64);

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

function newTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'migration-inspector-'));
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'test.db');
}

function makeMigration(input: {
  id: string;
  from: number;
  to: number;
  checksum: string;
  description: string;
  up: (ctx: { database: DatabaseSyncInstance }) => void;
  validate?: (ctx: { database: DatabaseSyncInstance }) => void;
}): MigrationDefinition {
  const base = {
    id: input.id,
    fromVersion: input.from,
    toVersion: input.to,
    checksum: input.checksum,
    description: input.description,
    up: input.up as MigrationDefinition['up'],
  };
  return input.validate
    ? { ...base, validate: input.validate as NonNullable<MigrationDefinition['validate']> }
    : base;
}

const baseMigrations = [
  makeMigration({
    id: 'm-0-1',
    from: 0,
    to: 1,
    checksum: CHECKSUM_A,
    description: 'create base table',
    up: (ctx) => ctx.database.exec('CREATE TABLE base (id INTEGER PRIMARY KEY, name TEXT)'),
    validate: (ctx) => {
      const row = ctx.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'base'")
        .get() as { name: string } | undefined;
      if (!row) throw new Error('base table missing');
    },
  }),
  makeMigration({
    id: 'm-1-2',
    from: 1,
    to: 2,
    checksum: CHECKSUM_B,
    description: 'add extra table',
    up: (ctx) => ctx.database.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)'),
  }),
  makeMigration({
    id: 'm-2-3',
    from: 2,
    to: 3,
    checksum: CHECKSUM_C,
    description: 'add notes table',
    up: (ctx) => ctx.database.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)'),
  }),
];

function makeInspector(
  migrations: readonly MigrationDefinition[] = baseMigrations,
  targetVersion = 3,
): MigrationStateInspector {
  return new MigrationStateInspector(migrations, targetVersion);
}

function emptyDb(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  const db = new DatabaseSync(p);
  db.close();
  return p;
}

function ensureHistoryTable(db: DatabaseSyncInstance): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL CHECK (validation_result = 'passed'), UNIQUE(from_version), UNIQUE(to_version), CHECK (duration_ms >= 0))",
  );
}

function historyRow(
  db: DatabaseSyncInstance,
  row: {
    migration_id: string;
    from_version: number;
    to_version: number;
    checksum: string;
    description?: string;
  },
): void {
  db.prepare(
    "INSERT INTO schema_migrations (migration_id, from_version, to_version, checksum, description, app_version, backup_id, started_at, completed_at, duration_ms, validation_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')",
  ).run(
    row.migration_id,
    row.from_version,
    row.to_version,
    row.checksum,
    row.description ?? 'test',
    '1.0.0',
    'bk-0001',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:01.000Z',
    1000,
  );
}

describe('MigrationStateInspector', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) removeTree(d);
    tempDirs.length = 0;
  });

  function trackDir(dir: string): string {
    tempDirs.push(dir);
    return dir;
  }

  describe('version-zero empty database', () => {
    it('reports currentVersion 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.currentVersion).toBe(0);
      } finally {
        db.close();
      }
    });

    it('reports isEmpty true', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.isEmpty).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports isPopulated false', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.isPopulated).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports historyTableExists false', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.historyTableExists).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports historyTableValid false when table does not exist', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.historyTableValid).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports empty historyRows', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.historyRows).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('reports historyValid true (no history to validate)', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports historyIssue null', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.historyIssue).toBeNull();
      } finally {
        db.close();
      }
    });

    it('reports empty checksumMismatches', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.checksumMismatches).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('reports futureSchemaVersion false', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.futureSchemaVersion).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports all migrations as pending', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.pendingMigrations.map((m) => m.id)).toEqual(['m-0-1', 'm-1-2', 'm-2-3']);
      } finally {
        db.close();
      }
    });

    it('reports atTarget false when target > 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.atTarget).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports atTarget true when target is 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = new MigrationStateInspector([], 0).inspect(db);
        expect(view.atTarget).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports validIntermediateVersion true', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.validIntermediateVersion).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  describe('version-zero populated database', () => {
    it('reports isEmpty false when user tables exist', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY)');
        const view = makeInspector().inspect(db);
        expect(view.isEmpty).toBe(false);
        expect(view.isPopulated).toBe(true);
        expect(view.currentVersion).toBe(0);
      } finally {
        db.close();
      }
    });

    it('treats schema_migrations as not a user table for isEmpty', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        const view = makeInspector().inspect(db);
        expect(view.isEmpty).toBe(true);
        expect(view.isPopulated).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports isPopulated true when both user tables and schema_migrations exist', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY)');
        ensureHistoryTable(db);
        const view = makeInspector().inspect(db);
        expect(view.isPopulated).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  describe('history table shape validation', () => {
    it('reports historyTableValid true for correct shape', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        const view = makeInspector().inspect(db);
        expect(view.historyTableExists).toBe(true);
        expect(view.historyTableValid).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports historyTableValid false for wrong column count', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY)');
        const view = makeInspector().inspect(db);
        expect(view.historyTableExists).toBe(true);
        expect(view.historyTableValid).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports historyTableValid false for wrong column name', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (wrong_name TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
        );
        const view = makeInspector().inspect(db);
        expect(view.historyTableValid).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports historyTableValid false for wrong column type', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id INTEGER PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
        );
        const view = makeInspector().inspect(db);
        expect(view.historyTableValid).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe('history validation', () => {
    it('validates correct history', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 1,
          to_version: 2,
          checksum: CHECKSUM_B,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(true);
        expect(view.historyIssue).toBeNull();
        expect(view.checksumMismatches).toEqual([]);
        expect(view.historyRows).toHaveLength(2);
      } finally {
        db.close();
      }
    });

    it('detects duplicate migration_id in history', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id TEXT, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
        );
        db.exec('PRAGMA user_version = 1');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('row count');
      } finally {
        db.close();
      }
    });

    it('detects wrong history row count', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('row count');
      } finally {
        db.close();
      }
    });

    it('detects missing history row for an expected migration', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-2-3',
          from_version: 2,
          to_version: 3,
          checksum: CHECKSUM_C,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('Missing history row');
      } finally {
        db.close();
      }
    });

    it('detects version mismatch in history', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
        );
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 0,
          to_version: 2,
          checksum: CHECKSUM_B,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('version mismatch');
      } finally {
        db.close();
      }
    });

    it('detects checksum mismatch', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 1,
          to_version: 2,
          checksum: BAD_CHECKSUM,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('Checksum mismatch');
        expect(view.checksumMismatches).toEqual(['m-1-2']);
      } finally {
        db.close();
      }
    });

    it('detects multiple checksum mismatches', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: BAD_CHECKSUM,
        });
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 1,
          to_version: 2,
          checksum: BAD_CHECKSUM,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.checksumMismatches).toEqual(['m-0-1', 'm-1-2']);
      } finally {
        db.close();
      }
    });
  });

  describe('future schema version', () => {
    it('detects when currentVersion exceeds targetVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 5');
        const view = makeInspector(baseMigrations, 3).inspect(db);
        expect(view.futureSchemaVersion).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports futureSchemaVersion false when currentVersion equals targetVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 3');
        const view = makeInspector(baseMigrations, 3).inspect(db);
        expect(view.futureSchemaVersion).toBe(false);
      } finally {
        db.close();
      }
    });

    it('reports futureSchemaVersion false when currentVersion is below targetVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 1');
        const view = makeInspector(baseMigrations, 3).inspect(db);
        expect(view.futureSchemaVersion).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe('pending chain', () => {
    it('returns all migrations when currentVersion is 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.pendingMigrations.map((m) => m.id)).toEqual(['m-0-1', 'm-1-2', 'm-2-3']);
      } finally {
        db.close();
      }
    });

    it('returns remaining migrations when partially applied', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 1');
        const view = makeInspector().inspect(db);
        expect(view.pendingMigrations.map((m) => m.id)).toEqual(['m-1-2', 'm-2-3']);
      } finally {
        db.close();
      }
    });

    it('returns empty array when at target', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 3');
        const view = makeInspector().inspect(db);
        expect(view.pendingMigrations).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe('at-target detection', () => {
    it('reports atTarget true when currentVersion equals targetVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 3');
        const view = makeInspector().inspect(db);
        expect(view.atTarget).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports atTarget false when currentVersion is below targetVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 1');
        const view = makeInspector().inspect(db);
        expect(view.atTarget).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe('valid intermediate version', () => {
    it('reports validIntermediateVersion true for version 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.validIntermediateVersion).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports validIntermediateVersion true for a version matching a migration toVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 2');
        const view = makeInspector().inspect(db);
        expect(view.validIntermediateVersion).toBe(true);
      } finally {
        db.close();
      }
    });

    it('reports validIntermediateVersion false for a version not matching any migration toVersion', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 99');
        const view = makeInspector().inspect(db);
        expect(view.validIntermediateVersion).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe('deep immutability', () => {
    it('returns a frozen view object', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(Object.isFrozen(view)).toBe(true);
      } finally {
        db.close();
      }
    });

    it('returns frozen historyRows array', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 1');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(Object.isFrozen(view.historyRows)).toBe(true);
      } finally {
        db.close();
      }
    });

    it('returns frozen checksumMismatches array', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 1');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: BAD_CHECKSUM,
        });
        const view = makeInspector().inspect(db);
        expect(Object.isFrozen(view.checksumMismatches)).toBe(true);
      } finally {
        db.close();
      }
    });

    it('returns frozen pendingMigrations array', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(Object.isFrozen(view.pendingMigrations)).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  describe('no writes', () => {
    it('does not modify user_version', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('PRAGMA user_version = 2');
        makeInspector().inspect(db);
        const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
        expect(row.user_version).toBe(2);
      } finally {
        db.close();
      }
    });

    it('does not create the schema_migrations table', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        makeInspector().inspect(db);
        const row = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
          )
          .get() as { name: string } | undefined;
        expect(row).toBeUndefined();
      } finally {
        db.close();
      }
    });

    it('does not insert history rows', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        makeInspector().inspect(db);
        const count = db.prepare('SELECT COUNT(*) as cnt FROM schema_migrations').get() as {
          cnt: number;
        };
        expect(count.cnt).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty migration registry with targetVersion 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = new MigrationStateInspector([], 0).inspect(db);
        expect(view.currentVersion).toBe(0);
        expect(view.atTarget).toBe(true);
        expect(view.pendingMigrations).toEqual([]);
        expect(view.validIntermediateVersion).toBe(true);
      } finally {
        db.close();
      }
    });

    it('handles database with only sqlite_ internal tables', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.isEmpty).toBe(true);
      } finally {
        db.close();
      }
    });

    it('correctly identifies history as valid when no migrations registered and version is 0', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = new MigrationStateInspector([], 0).inspect(db);
        expect(view.historyValid).toBe(true);
        expect(view.historyIssue).toBeNull();
      } finally {
        db.close();
      }
    });

    it('accepts a history table with extra additive columns (shape valid)', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL, extra_column TEXT)',
        );
        const view = makeInspector().inspect(db);
        // Extra additive columns must remain accepted so a backward-compatible
        // schema_migrations extension is not falsely flagged as malformed.
        expect(view.historyTableValid).toBe(true);
      } finally {
        db.close();
      }
    });

    it('rejects a history table missing a required column (shape invalid)', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL)',
        );
        db.exec('PRAGMA user_version = 2');
        const view = makeInspector().inspect(db);
        expect(view.historyTableValid).toBe(false);
        // A malformed table yields no trusted rows; with a versioned DB the empty row
        // count cannot match the expected applied migrations, so history is also invalid.
        expect(view.historyValid).toBe(false);
      } finally {
        db.close();
      }
    });

    it('rejects a history table with a wrong required column type (shape invalid)', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec(
          'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version TEXT NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
        );
        const view = makeInspector().inspect(db);
        expect(view.historyTableValid).toBe(false);
      } finally {
        db.close();
      }
    });
  });

  describe('registry identity and immutability', () => {
    it('pending migrations expose only identity fields and no callbacks or description', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.pendingMigrations.length).toBeGreaterThan(0);
        for (const m of view.pendingMigrations) {
          expect(Object.prototype.hasOwnProperty.call(m, 'id')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(m, 'fromVersion')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(m, 'toVersion')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(m, 'checksum')).toBe(true);
          expect(Object.prototype.hasOwnProperty.call(m, 'up')).toBe(false);
          expect(Object.prototype.hasOwnProperty.call(m, 'validate')).toBe(false);
          expect(Object.prototype.hasOwnProperty.call(m, 'description')).toBe(false);
        }
      } finally {
        db.close();
      }
    });

    it('captures identity independent of later source-array mutation', () => {
      const source = [...baseMigrations];
      const inspector = makeInspector(source, 3);
      // Mutate the source array after construction: append a junk entry and reverse it.
      source.push(
        makeMigration({
          id: 'm-3-4',
          from: 3,
          to: 4,
          checksum: 'd'.repeat(64),
          description: 'junk',
          up: () => undefined,
        }),
      );
      source.reverse();
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = inspector.inspect(db);
        // The pending chain must reflect the original three migrations, in version order,
        // unaffected by the post-construction source mutation.
        expect(view.pendingMigrations.map((m) => m.id)).toEqual(['m-0-1', 'm-1-2', 'm-2-3']);
      } finally {
        db.close();
      }
    });

    it('captures identity independent of later source-object mutation', () => {
      const source = baseMigrations.map((m) => ({ ...m }));
      const inspector = makeInspector(source, 3);
      // Mutate the original source object fields after construction.
      (source[0] as { id: string }).id = 'mutated-id';
      (source[0] as { checksum: string }).checksum = 'f'.repeat(64);
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = inspector.inspect(db);
        expect(view.pendingMigrations[0]!.id).toBe('m-0-1');
        expect(view.pendingMigrations[0]!.checksum).toBe(CHECKSUM_A);
      } finally {
        db.close();
      }
    });

    it('returned identity records are frozen and cannot be mutated', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        for (const m of view.pendingMigrations) {
          expect(Object.isFrozen(m)).toBe(true);
        }
      } finally {
        db.close();
      }
    });

    it('caller mutation of a returned view does not affect a later inspection', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 1');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const first = makeInspector().inspect(db);
        // The returned arrays are frozen, so a mutation attempt throws in strict mode.
        expect(() => (first.checksumMismatches as string[]).push('injected')).toThrow();
        const second = makeInspector().inspect(db);
        expect(second.checksumMismatches).toEqual([]);
        expect(second.historyValid).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  describe('version-zero schema_migrations ambiguity', () => {
    it('a version-zero DB with only an empty schema_migrations is empty yet has a history table', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        const view = makeInspector().inspect(db);
        // schema_migrations is excluded from the user-object check, so isEmpty is true even
        // though a history table exists. This is the ambiguous state the runner refuses to
        // migrate without explicit legacy detection.
        expect(view.currentVersion).toBe(0);
        expect(view.isEmpty).toBe(true);
        expect(view.isPopulated).toBe(false);
        expect(view.historyTableExists).toBe(true);
      } finally {
        db.close();
      }
    });

    it('a version-zero DB with user tables and schema_migrations is populated', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        db.exec('CREATE TABLE user_data (id INTEGER PRIMARY KEY)');
        ensureHistoryTable(db);
        const view = makeInspector().inspect(db);
        expect(view.currentVersion).toBe(0);
        expect(view.isEmpty).toBe(false);
        expect(view.isPopulated).toBe(true);
        expect(view.historyTableExists).toBe(true);
      } finally {
        db.close();
      }
    });

    it('a truly empty version-zero DB has no history table and may proceed', () => {
      const p = emptyDb();
      const db = new DatabaseSync(p);
      try {
        const view = makeInspector().inspect(db);
        expect(view.isEmpty).toBe(true);
        expect(view.isPopulated).toBe(false);
        expect(view.historyTableExists).toBe(false);
        expect(view.pendingMigrations.length).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    });
  });

  describe('malformed history rows', () => {
    function malformedTable(db: DatabaseSyncInstance): void {
      // Same columns, affinities, NOT NULL flags and PK as the expected shape, but without
      // UNIQUE/CHECK constraints so that rows violating those constraints can be inserted for
      // negative testing. Shape validation checks columns only, so this table is shape-valid.
      db.exec(
        'CREATE TABLE schema_migrations (migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL, backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL)',
      );
    }

    function insertRow(
      db: DatabaseSyncInstance,
      values: {
        migration_id: unknown;
        from_version: unknown;
        to_version: unknown;
        checksum: unknown;
      },
    ): void {
      db.prepare(
        "INSERT INTO schema_migrations (migration_id, from_version, to_version, checksum, description, app_version, backup_id, started_at, completed_at, duration_ms, validation_result) VALUES (?, ?, ?, ?, 'd', '1.0.0', 'bk-0001', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0, 'passed')",
      ).run(
        values.migration_id as string,
        values.from_version as number,
        values.to_version as number,
        values.checksum as string,
      );
    }

    it('rejects a null migration_id', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        malformedTable(db);
        db.exec('PRAGMA user_version = 1');
        insertRow(db, { migration_id: null, from_version: 0, to_version: 1, checksum: CHECKSUM_A });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('migration_id');
      } finally {
        db.close();
      }
    });

    it('rejects a non-integer from_version', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        malformedTable(db);
        db.exec('PRAGMA user_version = 1');
        insertRow(db, {
          migration_id: 'm-0-1',
          from_version: 'zero',
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('from_version');
      } finally {
        db.close();
      }
    });

    it('rejects a negative to_version', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        malformedTable(db);
        db.exec('PRAGMA user_version = 1');
        insertRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: -1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('to_version');
      } finally {
        db.close();
      }
    });

    it('rejects a duplicate to_version', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        malformedTable(db);
        db.exec('PRAGMA user_version = 1');
        insertRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        insertRow(db, {
          migration_id: 'm-1-2',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_B,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('to_version');
      } finally {
        db.close();
      }
    });

    it('rejects a non-advancing version path via version mismatch', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        malformedTable(db);
        db.exec('PRAGMA user_version = 1');
        // to_version does not advance beyond from_version; for the registered m-0-1
        // (from=0,to=1) this is also a version mismatch.
        insertRow(db, {
          migration_id: 'm-0-1',
          from_version: 1,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        const view = makeInspector().inspect(db);
        expect(view.historyValid).toBe(false);
        expect(view.historyIssue).toContain('version mismatch');
      } finally {
        db.close();
      }
    });
  });

  describe('query-only inspection', () => {
    it('inspects successfully under PRAGMA query_only = ON', () => {
      const dir = trackDir(newTempDir());
      const p = dbPathIn(dir);
      const db = new DatabaseSync(p);
      try {
        ensureHistoryTable(db);
        db.exec('PRAGMA user_version = 2');
        historyRow(db, {
          migration_id: 'm-0-1',
          from_version: 0,
          to_version: 1,
          checksum: CHECKSUM_A,
        });
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 1,
          to_version: 2,
          checksum: CHECKSUM_B,
        });
        db.exec('PRAGMA query_only = ON');
        const view = makeInspector().inspect(db);
        expect(view.currentVersion).toBe(2);
        expect(view.historyValid).toBe(true);
        expect(view.atTarget).toBe(false);
        // Confirm the connection is genuinely read-only: a write must be rejected.
        expect(() => db.exec('CREATE TABLE should_fail (id INTEGER PRIMARY KEY)')).toThrow();
      } finally {
        db.close();
      }
    });
  });
});
