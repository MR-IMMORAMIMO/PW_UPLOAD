import { PRODUCTION_V30_MIGRATION_ID } from './production-v30-optional-contact-email';
/**
 * Focused tests for the production migration registry (P1.8F).
 *
 * The production registry is executable production source; the committed legacy v3.2.2 manifest
 * and fingerprints are the independent historical verification oracle. Testing modules are only
 * imported by this test file, never by production code.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import {
  SchemaMigrationError,
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDatabaseFactory,
  type MigrationDefinition,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationJournalState,
} from '../types';
import { SchemaMigrationRunner } from '../SchemaMigrationRunner';
import { PathResolverService } from '../../path/PathResolverService';
import { LegacyDetector } from '../legacy/LegacyDetector';
import { builtInTemplateVersions, p4dProfessionalTemplateVersions } from '@scli/domain';
import { CurrentSelfManagedUnversionedFixtureBuilder } from '../testing/CurrentSelfManagedUnversionedFixtureBuilder';
import { LegacyV322FixtureBuilder } from '../testing/LegacyV322FixtureBuilder';
import {
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  COMPATIBILITY_COLUMNS,
  TABLE_NAMES,
  INDEX_NAMES,
  computeCanonicalDdlFingerprint,
  computeStructuralFingerprint,
} from '../testing/legacy-v322-schema';
import {
  PRODUCTION_CANONICAL_DDL,
  PRODUCTION_COMPATIBILITY_COLUMNS,
  PRODUCTION_INDEX_NAMES,
  PRODUCTION_MIGRATION_DESCRIPTION,
  PRODUCTION_MIGRATION_ID,
  PRODUCTION_MIGRATION_REGISTRY,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_TABLE_NAMES,
  PRODUCTION_V2_INDEX_NAMES,
  PRODUCTION_V2_MIGRATION_ID,
  PRODUCTION_V2_TABLE_NAMES,
  PRODUCTION_V3_INDEX_NAMES,
  PRODUCTION_V3_MIGRATION_ID,
  PRODUCTION_V3_TABLE_NAMES,
  PRODUCTION_V4_BUILTIN_REGISTRATIONS,
  PRODUCTION_V4_DDL,
  PRODUCTION_V4_INDEX_NAMES,
  PRODUCTION_V4_MIGRATION_ID,
  PRODUCTION_V4_TABLE_NAMES,
  PRODUCTION_V4_TRIGGER_NAMES,
  PRODUCTION_V5_MIGRATION_ID,
  PRODUCTION_V6_MIGRATION_ID,
  PRODUCTION_V7_MIGRATION_ID,
  PRODUCTION_V8_MIGRATION_ID,
  PRODUCTION_V9_MIGRATION_ID,
  PRODUCTION_V10_MIGRATION_ID,
  PRODUCTION_V11_MIGRATION_ID,
  PRODUCTION_V12_MIGRATION_ID,
  PRODUCTION_V13_INDEX_NAMES,
  PRODUCTION_V13_MIGRATION_ID,
  PRODUCTION_V13_TABLE_NAMES,
  PRODUCTION_V14_INDEX_NAMES,
  PRODUCTION_V14_MIGRATION_ID,
  PRODUCTION_V14_TABLE_NAMES,
  PRODUCTION_V15_INDEX_NAMES,
  PRODUCTION_V15_MIGRATION_ID,
  PRODUCTION_V15_TABLE_NAMES,
  PRODUCTION_V16_INDEX_NAMES,
  PRODUCTION_V16_MIGRATION_ID,
  PRODUCTION_V17_INDEX_NAMES,
  PRODUCTION_V17_MIGRATION_ID,
  PRODUCTION_V17_TABLE_NAMES,
  PRODUCTION_V18_COLUMN_NAMES,
  PRODUCTION_V18_INDEX_NAMES,
  PRODUCTION_V18_MIGRATION_ID,
  PRODUCTION_V19_COLUMN_NAMES,
  PRODUCTION_V19_MIGRATION_ID,
  PRODUCTION_V20_INDEX_NAMES,
  PRODUCTION_V20_MIGRATION_ID,
  PRODUCTION_V21_MIGRATION_ID,
  PRODUCTION_V22_MIGRATION_ID,
  PRODUCTION_V22_TABLE_NAMES,
  PRODUCTION_V22_INDEX_NAMES,
  PRODUCTION_V23_INDEX_NAMES,
  PRODUCTION_V23_MIGRATION_ID,
  PRODUCTION_V24_INDEX_NAMES,
  PRODUCTION_V24_MIGRATION_ID,
  PRODUCTION_V24_TABLE_NAMES,
  PRODUCTION_V25_MIGRATION_ID,
  PRODUCTION_V25_INDEX_NAMES,
  PRODUCTION_V26_MIGRATION_ID,
  PRODUCTION_V26_TABLE_NAMES,
  PRODUCTION_V26_INDEX_NAMES,
  PRODUCTION_V27_MIGRATION_ID,
  PRODUCTION_V27_TABLE_NAMES,
  PRODUCTION_V27_INDEX_NAMES,
  PRODUCTION_V27_TRIGGER_NAMES,
  PRODUCTION_V28_MIGRATION_ID,
  PRODUCTION_V29_MIGRATION_ID,
  PRODUCTION_V28_TABLE_NAMES,
  PRODUCTION_V28_INDEX_NAMES,
  applyV21OutputPresentationFamily,
  createProductionMigrationRegistry,
} from './production-migration-registry';

const EXPECTED_STRUCTURAL_FINGERPRINT =
  '2cb33227fcc587a1e46f6b00556d8f5f0f532f604bc8a888b24db6f5480715d2';
const EXPECTED_DDL_FINGERPRINT = '30f19988b8e530b03c8ed2e9693276b0bcedfdb43e0d1672f36e7966f4987def';
/**
 * Locked literal fingerprint of the complete post-compatibility product schema, including v7
 * Action Categories and v8 Action owner-role and notes columns.
 * indexes, and all 22 compatibility columns with declared types, nullability, defaults, and
 * primary-key positions. Unlike EXPECTED_STRUCTURAL_FINGERPRINT, this describes the final schema
 * AFTER the 18 compatibility additions, not only the base CREATE statements.
 */
const EXPECTED_COMPLETE_PRODUCT_FINGERPRINT =
  '4fced253f4ad6eaecaf516f459eb45b41547053bee95be543d3f07115be4a6db';
const EXPECTED_V4_MIGRATION_CHECKSUM =
  '4a8346aeaec62d656392ad6cfd3a2708e844525f253d8993bbeba20b31962f8c';
const EXPECTED_V5_MIGRATION_CHECKSUM =
  '3706beb828ddaab0ef1eea903880c930525f904078d2965b4152d340f8ec8106';
const EXPECTED_V11_MIGRATION_CHECKSUM =
  '4acde790206c2ece2686fd5f3d6cbe93d56480d463dbdc40d4529460971d8679';
const FIXED_BASE_MS = Date.parse('2026-08-04T12:00:00.000Z');

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-prod-reg-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'app.sqlite');
}

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-prod-0001' };
  }
  public async verifyBackup(): Promise<unknown> {
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public create(): MigrationBackupPort {
    return new FakeBackupPort();
  }
}

class FakeJournal implements MigrationJournalPort {
  public states: MigrationJournalState[] = [];
  public async createAttempt(): Promise<{ attemptId: string }> {
    this.states.push('CREATED');
    return { attemptId: 'att-prod-0001' };
  }
  public async transition(_attemptId: string, state: MigrationJournalState): Promise<void> {
    this.states.push(state);
  }
  public async markFailed(): Promise<void> {
    this.states.push('FAILED');
  }
}

function realDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p);
    },
    openReadOnly(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p, { readOnly: true });
    },
  };
}

function makeRunner(
  migrations: readonly MigrationDefinition[] = PRODUCTION_MIGRATIONS,
  targetVersion: number = PRODUCTION_SCHEMA_TARGET_VERSION,
  clock: MigrationClock = makeClock(),
): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations,
    targetVersion,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock,
    pathResolver: new PathResolverService(newTempDir()),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

function emptyDb(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  const db = new DatabaseSync(p);
  db.close();
  return p;
}

function legacyFixture(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
  return p;
}

function currentSelfManagedFixture(): string {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  CurrentSelfManagedUnversionedFixtureBuilder.build({ outputPath: p });
  return p;
}

function readUserVersion(p: string): number {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    db.close();
  }
}

function readHistory(p: string): Array<{
  migration_id: string;
  from_version: number;
  to_version: number;
  checksum: string;
}> {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const rows = db
      .prepare(
        'SELECT migration_id, from_version, to_version, checksum FROM schema_migrations ORDER BY to_version ASC',
      )
      .all() as Array<{
      migration_id: string;
      from_version: number;
      to_version: number;
      checksum: string;
    }>;
    return rows;
  } finally {
    db.close();
  }
}

function tableCount(p: string): number {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return rows.length;
  } finally {
    db.close();
  }
}

function indexCount(p: string): number {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    return rows.length;
  } finally {
    db.close();
  }
}

async function expectReject(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected SchemaMigrationError to be thrown');
  } catch (error) {
    if (!(error instanceof SchemaMigrationError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe('production migration registry', () => {
  it('target version is exactly 30', () => {
    expect(PRODUCTION_SCHEMA_TARGET_VERSION).toBe(30);
    expect(PRODUCTION_MIGRATION_REGISTRY.targetVersion).toBe(30);
    expect(createProductionMigrationRegistry().targetVersion).toBe(30);
  });

  it('registry contains thirty contiguous migrations through 29 -> 30', () => {
    expect(PRODUCTION_MIGRATIONS.length).toBe(30);
    const first = PRODUCTION_MIGRATIONS[0]!;
    expect(first.fromVersion).toBe(0);
    expect(first.toVersion).toBe(1);
    expect(first.toVersion).toBe(first.fromVersion + 1);
    const second = PRODUCTION_MIGRATIONS[1]!;
    expect(second.fromVersion).toBe(1);
    expect(second.toVersion).toBe(2);
    expect(second.toVersion).toBe(second.fromVersion + 1);
    const third = PRODUCTION_MIGRATIONS[2]!;
    expect(third.fromVersion).toBe(2);
    expect(third.toVersion).toBe(3);
    expect(third.toVersion).toBe(third.fromVersion + 1);
    const fourth = PRODUCTION_MIGRATIONS[3]!;
    expect(fourth.fromVersion).toBe(3);
    expect(fourth.toVersion).toBe(4);
    expect(fourth.toVersion).toBe(fourth.fromVersion + 1);
    const fifth = PRODUCTION_MIGRATIONS[4]!;
    expect(fifth.fromVersion).toBe(4);
    expect(fifth.toVersion).toBe(5);
    expect(fifth.toVersion).toBe(fifth.fromVersion + 1);
    const sixth = PRODUCTION_MIGRATIONS[5]!;
    expect(sixth.fromVersion).toBe(5);
    expect(sixth.toVersion).toBe(6);
    expect(sixth.toVersion).toBe(sixth.fromVersion + 1);
    const seventh = PRODUCTION_MIGRATIONS[6]!;
    expect(seventh.fromVersion).toBe(6);
    expect(seventh.toVersion).toBe(7);
    expect(seventh.toVersion).toBe(seventh.fromVersion + 1);
    const eighth = PRODUCTION_MIGRATIONS[7]!;
    expect(eighth.fromVersion).toBe(7);
    expect(eighth.toVersion).toBe(8);
    expect(eighth.toVersion).toBe(eighth.fromVersion + 1);
    const ninth = PRODUCTION_MIGRATIONS[8]!;
    expect(ninth.fromVersion).toBe(8);
    expect(ninth.toVersion).toBe(9);
    const tenth = PRODUCTION_MIGRATIONS[9]!;
    expect(tenth.fromVersion).toBe(9);
    expect(tenth.toVersion).toBe(10);
    const eleventh = PRODUCTION_MIGRATIONS[10]!;
    expect(eleventh.fromVersion).toBe(10);
    expect(eleventh.toVersion).toBe(11);
    const twelfth = PRODUCTION_MIGRATIONS[11]!;
    expect(twelfth.fromVersion).toBe(11);
    expect(twelfth.toVersion).toBe(12);
    const thirteenth = PRODUCTION_MIGRATIONS[12]!;
    expect(thirteenth.fromVersion).toBe(12);
    expect(thirteenth.toVersion).toBe(13);
    const fourteenth = PRODUCTION_MIGRATIONS[13]!;
    expect(fourteenth.fromVersion).toBe(13);
    expect(fourteenth.toVersion).toBe(14);
    const fifteenth = PRODUCTION_MIGRATIONS[14]!;
    expect(fifteenth.fromVersion).toBe(14);
    expect(fifteenth.toVersion).toBe(15);
    const sixteenth = PRODUCTION_MIGRATIONS[15]!;
    expect(sixteenth.fromVersion).toBe(15);
    expect(sixteenth.toVersion).toBe(16);
    const seventeenth = PRODUCTION_MIGRATIONS[16]!;
    expect(seventeenth.fromVersion).toBe(16);
    expect(seventeenth.toVersion).toBe(17);
    const eighteenth = PRODUCTION_MIGRATIONS[17]!;
    expect(eighteenth.fromVersion).toBe(17);
    expect(eighteenth.toVersion).toBe(18);
    const nineteenth = PRODUCTION_MIGRATIONS[18]!;
    expect(nineteenth.fromVersion).toBe(18);
    expect(nineteenth.toVersion).toBe(19);
    const twentieth = PRODUCTION_MIGRATIONS[19]!;
    expect(twentieth.fromVersion).toBe(19);
    expect(twentieth.toVersion).toBe(20);
    const twentyFirst = PRODUCTION_MIGRATIONS[20]!;
    expect(twentyFirst.fromVersion).toBe(20);
    expect(twentyFirst.toVersion).toBe(21);
    const twentySecond = PRODUCTION_MIGRATIONS[21]!;
    expect(twentySecond.fromVersion).toBe(21);
    expect(twentySecond.toVersion).toBe(22);
    const twentyThird = PRODUCTION_MIGRATIONS[22]!;
    expect(twentyThird.fromVersion).toBe(22);
    expect(twentyThird.toVersion).toBe(23);
    const twentyFourth = PRODUCTION_MIGRATIONS[23]!;
    expect(twentyFourth.fromVersion).toBe(23);
    expect(twentyFourth.toVersion).toBe(24);
    const twentyFifth = PRODUCTION_MIGRATIONS[24]!;
    expect(twentyFifth.fromVersion).toBe(24);
    expect(twentyFifth.toVersion).toBe(25);
    const twentySixth = PRODUCTION_MIGRATIONS[25]!;
    expect(twentySixth.fromVersion).toBe(25);
    expect(twentySixth.toVersion).toBe(26);
    const twentySeventh = PRODUCTION_MIGRATIONS[26]!;
    expect(twentySeventh.fromVersion).toBe(26);
    expect(twentySeventh.toVersion).toBe(27);
    const twentyEighth = PRODUCTION_MIGRATIONS[27]!;
    expect(twentyEighth.fromVersion).toBe(27);
    expect(twentyEighth.toVersion).toBe(28);
    const twentyNinth = PRODUCTION_MIGRATIONS[28]!;
    expect(twentyNinth.fromVersion).toBe(28);
    expect(twentyNinth.toVersion).toBe(29);
    expect(PRODUCTION_MIGRATION_REGISTRY.migrations).toBe(PRODUCTION_MIGRATIONS);
  });

  it('migration ID and checksum are deterministic', () => {
    const migration = PRODUCTION_MIGRATIONS[0]!;
    expect(migration.id).toBe(PRODUCTION_MIGRATION_ID);
    expect(PRODUCTION_MIGRATION_ID).toBe('production-0-1-baseline-adoption');
    expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[0]!.checksum).toBe(migration.checksum);
    expect(createProductionMigrationRegistry().migrations[0]!.id).toBe(migration.id);
    expect(migration.description).toBe(PRODUCTION_MIGRATION_DESCRIPTION);
    const v4Migration = PRODUCTION_MIGRATIONS[3]!;
    expect(v4Migration.id).toBe(PRODUCTION_V4_MIGRATION_ID);
    expect(v4Migration.checksum).toBe(EXPECTED_V4_MIGRATION_CHECKSUM);
    expect(createProductionMigrationRegistry().migrations[3]!.checksum).toBe(
      EXPECTED_V4_MIGRATION_CHECKSUM,
    );
    const v5Migration = PRODUCTION_MIGRATIONS[4]!;
    expect(v5Migration.id).toBe(PRODUCTION_V5_MIGRATION_ID);
    expect(v5Migration.checksum).toBe(EXPECTED_V5_MIGRATION_CHECKSUM);
    expect(createProductionMigrationRegistry().migrations[4]!.checksum).toBe(
      EXPECTED_V5_MIGRATION_CHECKSUM,
    );
    const v6Migration = PRODUCTION_MIGRATIONS[5]!;
    expect(v6Migration.id).toBe(PRODUCTION_V6_MIGRATION_ID);
    expect(v6Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[5]!.checksum).toBe(v6Migration.checksum);
    const v7Migration = PRODUCTION_MIGRATIONS[6]!;
    expect(v7Migration.id).toBe(PRODUCTION_V7_MIGRATION_ID);
    expect(v7Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[6]!.checksum).toBe(v7Migration.checksum);
    const v8Migration = PRODUCTION_MIGRATIONS[7]!;
    expect(v8Migration.id).toBe(PRODUCTION_V8_MIGRATION_ID);
    expect(v8Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(PRODUCTION_MIGRATIONS[8]!.id).toBe(PRODUCTION_V9_MIGRATION_ID);
    expect(PRODUCTION_MIGRATIONS[9]!.id).toBe(PRODUCTION_V10_MIGRATION_ID);
    expect(PRODUCTION_MIGRATIONS[10]!.id).toBe(PRODUCTION_V11_MIGRATION_ID);
    expect(PRODUCTION_MIGRATIONS[10]!.checksum).toBe(EXPECTED_V11_MIGRATION_CHECKSUM);
    expect(createProductionMigrationRegistry().migrations[10]!.checksum).toBe(
      EXPECTED_V11_MIGRATION_CHECKSUM,
    );
    const v12Migration = PRODUCTION_MIGRATIONS[11]!;
    expect(v12Migration.id).toBe(PRODUCTION_V12_MIGRATION_ID);
    expect(v12Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[11]!.checksum).toBe(
      v12Migration.checksum,
    );
    const v13Migration = PRODUCTION_MIGRATIONS[12]!;
    expect(v13Migration.id).toBe(PRODUCTION_V13_MIGRATION_ID);
    expect(v13Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[12]!.checksum).toBe(
      v13Migration.checksum,
    );
    const v14Migration = PRODUCTION_MIGRATIONS[13]!;
    expect(v14Migration.id).toBe(PRODUCTION_V14_MIGRATION_ID);
    expect(v14Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[13]!.checksum).toBe(
      v14Migration.checksum,
    );
    const v15Migration = PRODUCTION_MIGRATIONS[14]!;
    expect(v15Migration.id).toBe(PRODUCTION_V15_MIGRATION_ID);
    expect(v15Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[14]!.checksum).toBe(
      v15Migration.checksum,
    );
    const v16Migration = PRODUCTION_MIGRATIONS[15]!;
    expect(v16Migration.id).toBe(PRODUCTION_V16_MIGRATION_ID);
    expect(v16Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[15]!.checksum).toBe(
      v16Migration.checksum,
    );
    const v17Migration = PRODUCTION_MIGRATIONS[16]!;
    expect(v17Migration.id).toBe(PRODUCTION_V17_MIGRATION_ID);
    expect(v17Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[16]!.checksum).toBe(
      v17Migration.checksum,
    );
    const v18Migration = PRODUCTION_MIGRATIONS[17]!;
    expect(v18Migration.id).toBe(PRODUCTION_V18_MIGRATION_ID);
    expect(v18Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[17]!.checksum).toBe(
      v18Migration.checksum,
    );
    const v19Migration = PRODUCTION_MIGRATIONS[18]!;
    expect(v19Migration.id).toBe(PRODUCTION_V19_MIGRATION_ID);
    expect(v19Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(createProductionMigrationRegistry().migrations[18]!.checksum).toBe(
      v19Migration.checksum,
    );
    const v20Migration = PRODUCTION_MIGRATIONS[19]!;
    expect(v20Migration.id).toBe(PRODUCTION_V20_MIGRATION_ID);
    expect(v20Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    const v21Migration = PRODUCTION_MIGRATIONS[20]!;
    expect(v21Migration.id).toBe(PRODUCTION_V21_MIGRATION_ID);
    expect(v21Migration.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('v14 creates the generic package deliverable authority and migrates canonical memberships', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      for (const name of PRODUCTION_V14_TABLE_NAMES) {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name);
        expect(table).toBeDefined();
      }
      for (const name of PRODUCTION_V14_INDEX_NAMES) {
        const index = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name);
        expect(index).toBeDefined();
      }
      const columns = db
        .prepare('PRAGMA table_info(revision_package_deliverables)')
        .all() as Array<{
        name: string;
      }>;
      for (const expected of [
        'package_id',
        'source_type',
        'source_id',
        'revision_id',
        'position',
        'provenance_classification',
        'created_at',
      ]) {
        expect(columns.some((column) => column.name === expected)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('v15 creates the managed artifact persistence foundation and snapshot provenance column', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      for (const name of PRODUCTION_V15_TABLE_NAMES) {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name);
        expect(table).toBeDefined();
      }
      for (const name of PRODUCTION_V15_INDEX_NAMES) {
        const index = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name);
        expect(index).toBeDefined();
      }
      const snapshotCols = db
        .prepare('PRAGMA table_info(revision_document_snapshots)')
        .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
      const provenance = snapshotCols.find((c) => c.name === 'source_artifact_version_id');
      expect(provenance).toBeDefined();
      expect(provenance!.notnull).toBe(0);
      expect(provenance!.dflt_value).toBeNull();
      const managedCols = db.prepare('PRAGMA table_info(managed_artifacts)').all() as Array<{
        name: string;
      }>;
      for (const expected of [
        'artifact_id',
        'project_id',
        'artifact_type',
        'source_tool',
        'canonical_path',
        'status',
        'current_working_version',
        'project_document_id',
        'created_at',
        'updated_at',
      ]) {
        expect(managedCols.some((c) => c.name === expected)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('empty database migrates to version 30', async () => {
    const p = emptyDb();
    const result = await makeRunner().run(p);
    expect(result.status).toBe('migrated');
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(30);
    expect(result.appliedMigrationIds).toEqual([
      PRODUCTION_MIGRATION_ID,
      PRODUCTION_V2_MIGRATION_ID,
      PRODUCTION_V3_MIGRATION_ID,
      PRODUCTION_V4_MIGRATION_ID,
      PRODUCTION_V5_MIGRATION_ID,
      PRODUCTION_V6_MIGRATION_ID,
      PRODUCTION_V7_MIGRATION_ID,
      PRODUCTION_V8_MIGRATION_ID,
      PRODUCTION_V9_MIGRATION_ID,
      PRODUCTION_V10_MIGRATION_ID,
      PRODUCTION_V11_MIGRATION_ID,
      PRODUCTION_V12_MIGRATION_ID,
      PRODUCTION_V13_MIGRATION_ID,
      PRODUCTION_V14_MIGRATION_ID,
      PRODUCTION_V15_MIGRATION_ID,
      PRODUCTION_V16_MIGRATION_ID,
      PRODUCTION_V17_MIGRATION_ID,
      PRODUCTION_V18_MIGRATION_ID,
      PRODUCTION_V19_MIGRATION_ID,
      PRODUCTION_V20_MIGRATION_ID,
      PRODUCTION_V21_MIGRATION_ID,
      PRODUCTION_V22_MIGRATION_ID,
      PRODUCTION_V23_MIGRATION_ID,
      PRODUCTION_V24_MIGRATION_ID,
      PRODUCTION_V25_MIGRATION_ID,
      PRODUCTION_V26_MIGRATION_ID,
      PRODUCTION_V27_MIGRATION_ID,
      PRODUCTION_V28_MIGRATION_ID,
      PRODUCTION_V29_MIGRATION_ID,
      PRODUCTION_V30_MIGRATION_ID,
    ]);
    expect(readUserVersion(p)).toBe(30);
  });

  it('v21 preserves historical Template Version bytes while extending every constrained family table', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 20), 20).run(p);
    const beforeDb = new DatabaseSync(p, { readOnly: true });
    const before = beforeDb
      .prepare(
        'SELECT template_id, version_id, definition_json, definition_hash FROM output_template_versions ORDER BY template_id, version_id',
      )
      .all();
    beforeDb.close();
    const result = await makeRunner().run(p);
    expect(result).toMatchObject({
      status: 'migrated',
      fromVersion: 20,
      toVersion: 30,
      appliedMigrationIds: [
        PRODUCTION_V21_MIGRATION_ID,
        PRODUCTION_V22_MIGRATION_ID,
        PRODUCTION_V23_MIGRATION_ID,
        PRODUCTION_V24_MIGRATION_ID,
        PRODUCTION_V25_MIGRATION_ID,
        PRODUCTION_V26_MIGRATION_ID,
        PRODUCTION_V27_MIGRATION_ID,
        PRODUCTION_V28_MIGRATION_ID,
        PRODUCTION_V29_MIGRATION_ID,
        PRODUCTION_V30_MIGRATION_ID,
      ],
    });
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const afterHistorical = db
        .prepare(
          "SELECT template_id, version_id, definition_json, definition_hash FROM output_template_versions WHERE NOT (created_by = 'SYSTEM_P4D_V21_MIGRATION') ORDER BY template_id, version_id",
        )
        .all();
      expect(afterHistorical).toEqual(before);
      for (const table of [
        'output_templates',
        'global_output_template_defaults',
        'project_output_template_overrides',
        'canonical_outputs',
      ]) {
        const row = db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table) as { sql: string };
        expect(row.sql).toContain('DatasheetRegister');
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('keeps the isolated v21 bootstrap idempotent after the family constraint is already current', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p);
    try {
      applyV21OutputPresentationFamily(db, '2026-08-25T00:00:00.000Z');
      applyV21OutputPresentationFamily(db, '2026-08-25T00:00:00.000Z');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM output_templates WHERE family = 'DatasheetRegister'",
          )
          .get(),
      ).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it('v17 creates the revision_delete_operations recovery journal / tombstone table', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      for (const name of PRODUCTION_V17_TABLE_NAMES) {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name);
        expect(table).toBeDefined();
      }
      for (const name of PRODUCTION_V17_INDEX_NAMES) {
        const index = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name);
        expect(index).toBeDefined();
      }
      const columns = db.prepare('PRAGMA table_info(revision_delete_operations)').all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      for (const expected of [
        'operation_id',
        'project_id',
        'revision_id',
        'revision_sequence',
        'revision_label',
        'actor_id',
        'actor_name_snapshot',
        'state',
        'failure_reason',
        'artifact_manifest_json',
        'document_snapshot_count',
        'datasheet_snapshot_count',
        'generated_output_count',
        'created_at',
        'archive_started_at',
        'db_committed_at',
        'completed_at',
        'updated_at',
      ]) {
        expect(columns.some((column) => column.name === expected)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('v18 adds nullable structured reuse provenance without changing historical tombstones', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 17), 17).run(p);
    const seed = new DatabaseSync(p);
    try {
      seed
        .prepare(
          `INSERT INTO revision_delete_operations
           (operation_id, project_id, revision_id, revision_sequence, revision_label,
            actor_id, actor_name_snapshot, state, failure_reason, artifact_manifest_json,
            document_snapshot_count, datasheet_snapshot_count, generated_output_count,
            created_at, archive_started_at, db_committed_at, completed_at, updated_at)
           VALUES (?, ?, ?, 1, 'REV_01', ?, 'Owner', 'COMPLETED', NULL, ?, 0, 0, 0,
                   ?, ?, ?, ?, ?)`,
        )
        .run(
          'a0000000-0000-4000-8000-000000000011',
          'a0000000-0000-4000-8000-000000000012',
          'a0000000-0000-4000-8000-000000000013',
          'a0000000-0000-4000-8000-000000000014',
          JSON.stringify({
            revisionId: 'a0000000-0000-4000-8000-000000000013',
            items: [],
          }),
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:00:00.000Z',
        );
    } finally {
      seed.close();
    }
    const result = await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 18), 18).run(p);
    expect(result).toMatchObject({ fromVersion: 17, toVersion: 18 });
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(revision_delete_operations)').all() as Array<{
        name: string;
      }>;
      for (const name of PRODUCTION_V18_COLUMN_NAMES) {
        expect(columns.some((column) => column.name === name)).toBe(true);
      }
      for (const name of PRODUCTION_V18_INDEX_NAMES) {
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name),
        ).toBeDefined();
      }
      const historical = db
        .prepare(
          `SELECT state, artifact_manifest_json, reused_by_revision_id, reused_at,
                  reused_by_actor_id, reused_by_actor_name, reuse_reason
           FROM revision_delete_operations`,
        )
        .get() as Record<string, unknown>;
      expect(historical.state).toBe('COMPLETED');
      expect(historical.artifact_manifest_json).toContain('a0000000-0000-4000-8000-000000000013');
      expect(historical.reused_by_revision_id).toBeNull();
      expect(historical.reused_at).toBeNull();
      expect(historical.reused_by_actor_id).toBeNull();
      expect(historical.reused_by_actor_name).toBeNull();
      expect(historical.reuse_reason).toBeNull();
    } finally {
      db.close();
    }
    expect((await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 18), 18).run(p)).status).toBe(
      'up-to-date',
    );
  });

  it('v19 adds nullable Revision metadata without fabricating historical semantics', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 18), 18).run(p);
    const seed = new DatabaseSync(p);
    try {
      seed
        .prepare(
          `INSERT INTO canonical_revisions
           (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
            project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
            created_by_name, provenance_classification, legacy_source_id, failure_reason,
            created_at, finalized_at, updated_at)
           VALUES (?, ?, 7, 'REV_07', 'LEGACY_IMPORTED', ?, NULL, NULL, NULL, NULL,
                   'LEGACY_UNVERIFIED', ?, NULL, ?, ?, ?)`,
        )
        .run(
          'b0000000-0000-4000-8000-000000000011',
          'b0000000-0000-4000-8000-000000000012',
          JSON.stringify({ summary: 'Legacy summary', changeLog: 'Legacy change log' }),
          'legacy-revision-7',
          '2026-08-21T00:00:00.000Z',
          '2026-08-21T01:00:00.000Z',
          '2026-08-21T01:00:00.000Z',
        );
    } finally {
      seed.close();
    }

    const result = await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 19), 19).run(p);
    expect(result).toMatchObject({ fromVersion: 18, toVersion: 19 });
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(canonical_revisions)').all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      for (const name of PRODUCTION_V19_COLUMN_NAMES) {
        expect(columns).toContainEqual(
          expect.objectContaining({ name, notnull: 0, dflt_value: null }),
        );
      }
      const historical = db
        .prepare(
          `SELECT revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
                  provenance_classification, legacy_source_id, project_snapshot_json,
                  purpose, internal_note
           FROM canonical_revisions WHERE revision_id = ?`,
        )
        .get('b0000000-0000-4000-8000-000000000011') as Record<string, unknown>;
      expect(historical).toMatchObject({
        revision_id: 'b0000000-0000-4000-8000-000000000011',
        project_id: 'b0000000-0000-4000-8000-000000000012',
        revision_sequence: 7,
        revision_label: 'REV_07',
        lifecycle_state: 'LEGACY_IMPORTED',
        provenance_classification: 'LEGACY_UNVERIFIED',
        legacy_source_id: 'legacy-revision-7',
        purpose: null,
        internal_note: null,
      });
      expect(String(historical.project_snapshot_json)).toContain('Legacy summary');
      expect(String(historical.project_snapshot_json)).toContain('Legacy change log');
    } finally {
      db.close();
    }
    expect((await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 19), 19).run(p)).status).toBe(
      'up-to-date',
    );
  });

  it('upgrades a v5 database additively and is restart-safe', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 5), 5).run(p);
    const before = sourceDataSnapshot(p);
    const upgraded = await makeRunner().run(p);
    expect(upgraded).toMatchObject({
      status: 'migrated',
      fromVersion: 5,
      toVersion: 30,
      appliedMigrationIds: [
        PRODUCTION_V6_MIGRATION_ID,
        PRODUCTION_V7_MIGRATION_ID,
        PRODUCTION_V8_MIGRATION_ID,
        PRODUCTION_V9_MIGRATION_ID,
        PRODUCTION_V10_MIGRATION_ID,
        PRODUCTION_V11_MIGRATION_ID,
        PRODUCTION_V12_MIGRATION_ID,
        PRODUCTION_V13_MIGRATION_ID,
        PRODUCTION_V14_MIGRATION_ID,
        PRODUCTION_V15_MIGRATION_ID,
        PRODUCTION_V16_MIGRATION_ID,
        PRODUCTION_V17_MIGRATION_ID,
        PRODUCTION_V18_MIGRATION_ID,
        PRODUCTION_V19_MIGRATION_ID,
        PRODUCTION_V20_MIGRATION_ID,
        PRODUCTION_V21_MIGRATION_ID,
        PRODUCTION_V22_MIGRATION_ID,
        PRODUCTION_V23_MIGRATION_ID,
        PRODUCTION_V24_MIGRATION_ID,
        PRODUCTION_V25_MIGRATION_ID,
        PRODUCTION_V26_MIGRATION_ID,
        PRODUCTION_V27_MIGRATION_ID,
        PRODUCTION_V28_MIGRATION_ID,
        PRODUCTION_V29_MIGRATION_ID,
        PRODUCTION_V30_MIGRATION_ID,
      ],
    });
    expect(sourceDataSnapshot(p)).toEqual(before);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM project_tags').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM project_scope_notes').get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
    expect((await makeRunner().run(p)).status).toBe('up-to-date');
  });

  it('upgrades an already-versioned representative production V3 database through 3 -> 4 -> 5 -> 6 -> 7 -> 8', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 3), 3).run(p);
    const projectId = 'a0000000-0000-4000-8000-000000000001';
    const revisionId = 'a1000000-0000-4000-8000-000000000001';
    const exportId = 'a2000000-0000-4000-8000-000000000001';
    const packageId = 'a3000000-0000-4000-8000-000000000001';
    const timestamp = '2026-08-10T00:00:00.000Z';
    const migrationObservedAt = '2026-08-16T12:30:00.000Z';
    const db = new DatabaseSync(p);
    try {
      db.prepare(
        `INSERT INTO app_state (state_key, json_value, updated_at)
         VALUES ('primary', ?, ?)`,
      ).run(JSON.stringify({ projects: [{ id: projectId, code: 'V3-UPGRADE' }] }), timestamp);
      db.prepare(
        `INSERT INTO project_workspaces
         (project_id, folder_path, folder_profile, services_json, input_mode, created_at, updated_at)
         VALUES (?, ?, 'Standard', '[]', 'Manual', ?, ?)`,
      ).run(projectId, 'C:\\V3 Upgrade', timestamp, timestamp);
      const insertLuminaire = db.prepare(
        `INSERT INTO project_luminaires
         (id, project_id, tag, category, image_path, description, manufacturer, model,
          wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout,
          driver, control, emergency, datasheet_path, location, unit, quantity, notes,
          source_name, dimensions, body_color_finish, created_at, updated_at)
         VALUES (?, ?, ?, 'Downlight', ?, 'V3 retained luminaire', 'Maker', 'M1',
                 '10W', '1000lm', '3000K', '90', '36', 'IP44', 'Recessed', '100mm',
                 'Remote', 'DALI', 'No', ?, 'Lobby', 'pcs',
                 2, '', 'Manual', '100mm', 'White', ?, ?)`,
      );
      const populatedLuminaireId = 'a4000000-0000-4000-8000-000000000001';
      const emptyLuminaireId = 'a4000000-0000-4000-8000-000000000002';
      insertLuminaire.run(
        populatedLuminaireId,
        projectId,
        'DL01',
        'C:\\V3 Upgrade\\DL01.jpg',
        'C:\\V3 Upgrade\\DL01.pdf',
        timestamp,
        timestamp,
      );
      insertLuminaire.run(emptyLuminaireId, projectId, 'DL02', '', '', timestamp, timestamp);
      db.prepare(
        `INSERT INTO project_revisions
         (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
          summary, change_log, source_type, source_reference, locked, snapshot_hash,
          reissue_number, created_at, updated_at)
         VALUES (?, ?, 1, 'V3 Revision', 'Issued', ?, NULL, ?, '', '', 'ProjectExport', ?,
                 1, '', 1, ?, ?)`,
      ).run(revisionId, projectId, timestamp, timestamp, exportId, timestamp, timestamp);
      db.prepare(
        `INSERT INTO project_exports
         (id, project_id, revision, excel_path, pdf_path, datasheet_folder, created_at,
          schedule_excel_path, schedule_pdf_path, boq_excel_path, boq_pdf_path)
         VALUES (?, ?, 1, ?, ?, '', ?, ?, ?, ?, ?)`,
      ).run(
        exportId,
        projectId,
        'C:\\V3 Upgrade\\schedule.xlsx',
        'C:\\V3 Upgrade\\schedule.pdf',
        timestamp,
        'C:\\V3 Upgrade\\schedule.xlsx',
        'C:\\V3 Upgrade\\schedule.pdf',
        'C:\\V3 Upgrade\\boq.xlsx',
        'C:\\V3 Upgrade\\boq.pdf',
      );
      db.prepare(
        `INSERT INTO revision_packages
         (id, project_id, revision_number, reissue_number, label, status, output_mode,
          folder_path, zip_path, item_count, total_bytes, package_hash,
          warning_override_reason, manifest_json, luminaire_snapshot_json, created_at)
         VALUES (?, ?, 1, 1, 'V3 Package', 'Issued', 'Full', ?, ?, 4, 100, '', '', ?, '[]', ?)`,
      ).run(
        packageId,
        projectId,
        'C:\\V3 Upgrade\\Package',
        'C:\\V3 Upgrade\\Package.zip',
        JSON.stringify([
          { itemId: `export:${exportId}:schedule-pdf` },
          { itemId: `export:${exportId}:schedule-excel` },
          { itemId: `export:${exportId}:boq-pdf` },
          { itemId: `export:${exportId}:boq-excel` },
        ]),
        timestamp,
      );
    } finally {
      db.close();
    }
    const beforeData = sourceDataSnapshot(p);
    expect(readUserVersion(p)).toBe(3);
    expect(readHistory(p)).toHaveLength(3);
    const result = await makeRunner(PRODUCTION_MIGRATIONS, PRODUCTION_SCHEMA_TARGET_VERSION, {
      now: () => new Date(migrationObservedAt),
    }).run(p);
    expect(result).toMatchObject({
      status: 'migrated',
      fromVersion: 3,
      toVersion: 30,
      appliedMigrationIds: [
        PRODUCTION_V4_MIGRATION_ID,
        PRODUCTION_V5_MIGRATION_ID,
        PRODUCTION_V6_MIGRATION_ID,
        PRODUCTION_V7_MIGRATION_ID,
        PRODUCTION_V8_MIGRATION_ID,
        PRODUCTION_V9_MIGRATION_ID,
        PRODUCTION_V10_MIGRATION_ID,
        PRODUCTION_V11_MIGRATION_ID,
        PRODUCTION_V12_MIGRATION_ID,
        PRODUCTION_V13_MIGRATION_ID,
        PRODUCTION_V14_MIGRATION_ID,
        PRODUCTION_V15_MIGRATION_ID,
        PRODUCTION_V16_MIGRATION_ID,
        PRODUCTION_V17_MIGRATION_ID,
        PRODUCTION_V18_MIGRATION_ID,
        PRODUCTION_V19_MIGRATION_ID,
        PRODUCTION_V20_MIGRATION_ID,
        PRODUCTION_V21_MIGRATION_ID,
        PRODUCTION_V22_MIGRATION_ID,
        PRODUCTION_V23_MIGRATION_ID,
        PRODUCTION_V24_MIGRATION_ID,
        PRODUCTION_V25_MIGRATION_ID,
        PRODUCTION_V26_MIGRATION_ID,
        PRODUCTION_V27_MIGRATION_ID,
        PRODUCTION_V28_MIGRATION_ID,
        PRODUCTION_V29_MIGRATION_ID,
        PRODUCTION_V30_MIGRATION_ID,
      ],
    });
    const migratedData = sourceDataSnapshot(p);
    expect({
      ...migratedData,
      project_luminaires: migratedData.project_luminaires!.map((row) =>
        row.replace(/,"","","",1\]$/, ']'),
      ),
    }).toEqual(beforeData);
    expect(readHistory(p)).toHaveLength(30);
    const migrated = new DatabaseSync(p, { readOnly: true });
    try {
      expect(migrated.prepare('SELECT COUNT(*) AS count FROM canonical_revisions').get()).toEqual({
        count: 1,
      });
      expect(migrated.prepare('SELECT COUNT(*) AS count FROM canonical_outputs').get()).toEqual({
        count: 4,
      });
      expect(
        migrated.prepare('SELECT COUNT(*) AS count FROM canonical_issue_packages').get(),
      ).toEqual({ count: 1 });
      expect(
        migrated.prepare('SELECT COUNT(*) AS count FROM canonical_package_outputs').get(),
      ).toEqual({ count: 4 });
      expect(
        migrated
          .prepare(
            `SELECT asset_type, version_sequence, file_name, mime_type, backfilled, attached_at,
                    attached_by_id, attached_by_name_snapshot
             FROM luminaire_asset_versions
             WHERE luminaire_id = ?
             ORDER BY asset_type`,
          )
          .all('a4000000-0000-4000-8000-000000000001'),
      ).toEqual([
        {
          asset_type: 'Datasheet',
          version_sequence: 1,
          file_name: 'DL01.pdf',
          mime_type: 'application/pdf',
          backfilled: 1,
          attached_at: migrationObservedAt,
          attached_by_id: null,
          attached_by_name_snapshot: null,
        },
        {
          asset_type: 'ProductImage',
          version_sequence: 1,
          file_name: 'DL01.jpg',
          mime_type: 'image/jpeg',
          backfilled: 1,
          attached_at: migrationObservedAt,
          attached_by_id: null,
          attached_by_name_snapshot: null,
        },
      ]);
      expect(
        migrated
          .prepare('SELECT COUNT(*) AS count FROM luminaire_asset_versions WHERE luminaire_id = ?')
          .get('a4000000-0000-4000-8000-000000000002'),
      ).toEqual({ count: 0 });
      expect(migrationObservedAt).not.toBe(timestamp);
    } finally {
      migrated.close();
    }
  });

  it('empty migration creates the complete user product tables plus the history table', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    expect(tableCount(p)).toBe(78);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const names = rows.map((r) => r.name);
      for (const expected of TABLE_NAMES) {
        expect(names).toContain(expected);
      }
      expect(names).toContain('workflow_transitions');
      expect(names).toContain('revision_cycles');
      expect(names).toContain('work_sessions');
      expect(names).toContain('schema_migrations');
      for (const expected of [
        ...TABLE_NAMES,
        'workflow_transitions',
        'revision_cycles',
        'work_sessions',
        ...PRODUCTION_V4_TABLE_NAMES,
        ...PRODUCTION_V13_TABLE_NAMES,
        ...PRODUCTION_V17_TABLE_NAMES,
        ...PRODUCTION_V24_TABLE_NAMES,
        ...PRODUCTION_V27_TABLE_NAMES,
        ...PRODUCTION_V28_TABLE_NAMES,
        'action_categories',
        'meeting_participants',
        'meeting_agenda_items',
        'meeting_notes',
        'meeting_action_links',
        'project_review_replies',
        'project_review_attachments',
        'luminaire_asset_versions',
        'schema_migrations',
      ]) {
        expect(names.filter((n) => n === expected).length).toBe(1);
      }
    } finally {
      db.close();
    }
  });

  it('creates exactly 107 owned product indexes', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    expect(indexCount(p)).toBe(107);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const names = rows.map((r) => r.name);
      for (const expected of INDEX_NAMES) {
        expect(names).toContain(expected);
      }
      expect(names).toContain('ix_workflow_transitions_project');
      expect(names).toContain('ux_revision_cycles_one_open');
      expect(names).toContain('ix_work_sessions_project');
      expect(names).toContain('ux_work_sessions_one_active');
      expect(names).toContain('ix_luminaire_asset_versions_project');
      expect(names).toContain('ix_luminaire_asset_versions_luminaire');
      for (const expected of PRODUCTION_V4_INDEX_NAMES) expect(names).toContain(expected);
      expect(names).toContain('ix_action_categories_sort');
      expect(names).toContain('ix_project_actions_category');
      expect(names).toContain('ix_meeting_action_links_meeting_relation');
      expect(names).toContain('ix_meeting_action_links_action_relation');
      expect(names).toContain('ux_project_review_items_id_project');
      expect(names).toContain('ux_project_documents_id_project');
      expect(names).toContain('ix_project_review_replies_thread_order');
      expect(names).toContain('ix_project_review_attachments_project_order');
      expect(names).toContain('ux_project_review_root_document');
      expect(names).toContain('ux_project_review_reply_document');
      for (const expected of PRODUCTION_V13_INDEX_NAMES) expect(names).toContain(expected);
      for (const expected of PRODUCTION_V18_INDEX_NAMES) expect(names).toContain(expected);
      for (const expected of PRODUCTION_V20_INDEX_NAMES) expect(names).toContain(expected);
      for (const expected of PRODUCTION_V24_INDEX_NAMES) expect(names).toContain(expected);
      for (const expected of PRODUCTION_V27_INDEX_NAMES) expect(names).toContain(expected);
      for (const expected of PRODUCTION_V28_INDEX_NAMES) expect(names).toContain(expected);
    } finally {
      db.close();
    }
  });

  it('exact final product schema matches the locked structural fingerprint', async () => {
    // The locked structural fingerprint describes the canonical base schema (24 tables + 8
    // indexes). The migration executes those exact statements and then adds the 18 compatibility
    // columns on top; both layers are asserted against the locked oracle.
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((r) => r.name).sort()).toEqual(
        [
          ...TABLE_NAMES,
          ...PRODUCTION_V2_TABLE_NAMES,
          ...PRODUCTION_V3_TABLE_NAMES,
          ...PRODUCTION_V4_TABLE_NAMES,
          ...PRODUCTION_V13_TABLE_NAMES,
          ...PRODUCTION_V14_TABLE_NAMES,
          ...PRODUCTION_V15_TABLE_NAMES,
          ...PRODUCTION_V17_TABLE_NAMES,
          ...PRODUCTION_V22_TABLE_NAMES,
          ...PRODUCTION_V24_TABLE_NAMES,
          ...PRODUCTION_V26_TABLE_NAMES,
          ...PRODUCTION_V27_TABLE_NAMES,
          ...PRODUCTION_V28_TABLE_NAMES,
          'project_tags',
          'project_scope_notes',
          'action_categories',
          'meeting_participants',
          'meeting_agenda_items',
          'meeting_notes',
          'meeting_action_links',
          'project_review_replies',
          'project_review_attachments',
          'luminaire_asset_versions',
        ].sort(),
      );
      expect(indexes.map((r) => r.name).sort()).toEqual(
        [
          ...INDEX_NAMES,
          ...PRODUCTION_V2_INDEX_NAMES,
          ...PRODUCTION_V3_INDEX_NAMES,
          ...PRODUCTION_V4_INDEX_NAMES,
          ...PRODUCTION_V13_INDEX_NAMES,
          ...PRODUCTION_V14_INDEX_NAMES,
          ...PRODUCTION_V15_INDEX_NAMES,
          ...PRODUCTION_V16_INDEX_NAMES,
          ...PRODUCTION_V17_INDEX_NAMES,
          ...PRODUCTION_V18_INDEX_NAMES,
          ...PRODUCTION_V20_INDEX_NAMES,
          ...PRODUCTION_V22_INDEX_NAMES,
          ...PRODUCTION_V23_INDEX_NAMES,
          ...PRODUCTION_V24_INDEX_NAMES,
          ...PRODUCTION_V25_INDEX_NAMES,
          ...PRODUCTION_V26_INDEX_NAMES,
          ...PRODUCTION_V27_INDEX_NAMES,
          ...PRODUCTION_V28_INDEX_NAMES,
          'ix_project_tags_project',
          'ix_project_scope_notes_project',
          'ix_action_categories_sort',
          'ix_project_actions_category',
          'ix_meeting_action_links_meeting_relation',
          'ix_meeting_action_links_action_relation',
          'ux_project_review_items_id_project',
          'ux_project_documents_id_project',
          'ux_project_contacts_nonempty_email',
          'ix_project_review_replies_thread_order',
          'ix_project_review_attachments_project_order',
          'ux_project_review_root_document',
          'ux_project_review_reply_document',
          'ix_luminaire_asset_versions_project',
          'ix_luminaire_asset_versions_luminaire',
        ].sort(),
      );
      // The base canonical identity must reproduce the locked structural fingerprint.
      const freshDir = newTempDir();
      const freshPath = dbPathIn(freshDir);
      const fresh = new DatabaseSync(freshPath);
      try {
        for (const ddl of PRODUCTION_CANONICAL_DDL) fresh.exec(ddl);
      } finally {
        fresh.close();
      }
      const detected = new LegacyDetector().inspect(freshPath);
      expect(detected.status).toBe('LEGACY_V3_2_2');
      expect(detected.observedStructuralFingerprint).toBe(
        computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT),
      );
      expect(detected.observedStructuralFingerprint).toBe(EXPECTED_STRUCTURAL_FINGERPRINT);
      // The final migrated schema additionally contains every compatibility column.
      for (const op of PRODUCTION_COMPATIBILITY_COLUMNS) {
        const columns = db.prepare(`PRAGMA table_info(${op.table})`).all() as Array<{
          name: string;
        }>;
        expect(columns.map((c) => c.name)).toContain(op.column);
      }
    } finally {
      db.close();
    }
  });

  it('exact DDL behavior matches the locked schema contract', () => {
    expect(PRODUCTION_CANONICAL_DDL.length).toBe(CANONICAL_FRESH_DDL.length);
    const normalize = (sql: string) => sql.trim().replace(/\s+/g, ' ');
    for (let i = 0; i < PRODUCTION_CANONICAL_DDL.length; i++) {
      expect(normalize(PRODUCTION_CANONICAL_DDL[i]!)).toBe(normalize(CANONICAL_FRESH_DDL[i]!));
    }
    expect(computeCanonicalDdlFingerprint(PRODUCTION_CANONICAL_DDL)).toBe(
      computeCanonicalDdlFingerprint(CANONICAL_FRESH_DDL),
    );
    expect(computeCanonicalDdlFingerprint(PRODUCTION_CANONICAL_DDL)).toBe(EXPECTED_DDL_FINGERPRINT);
    // Recalculated compatibility inventory matches the locked manifest exactly.
    expect(PRODUCTION_COMPATIBILITY_COLUMNS.length).toBe(COMPATIBILITY_COLUMNS.length);
    expect(PRODUCTION_COMPATIBILITY_COLUMNS.length).toBe(22);
    const addedByMigration = PRODUCTION_COMPATIBILITY_COLUMNS.filter(
      (op) => !op.alreadyInBaseCreate,
    );
    expect(addedByMigration.length).toBe(18);
    expect(PRODUCTION_TABLE_NAMES.length).toBe(24);
    expect(PRODUCTION_INDEX_NAMES.length).toBe(8);
  });

  it('v13 source_document FK references project_documents(id) and is enforced with foreign_keys ON', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      // The FK must target the stable PRIMARY KEY column (project_documents.id),
      // not an invalid composite that would raise "foreign key mismatch".
      const fks = db
        .prepare('PRAGMA foreign_key_list(revision_document_snapshots)')
        .all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
      }>;
      const sourceFk = fks.find((fk) => fk.table === 'project_documents');
      expect(sourceFk).toBeDefined();
      expect(sourceFk!.from).toBe('source_document_id');
      expect(sourceFk!.to).toBe('id');
      expect(sourceFk!.seq).toBe(0);

      // A valid canonical Revision + Project Document pair is required before an
      // INSERT referencing them can succeed under enforcement.
      const revisionId = '70000000-0000-4000-8000-000000000001';
      const projectId = '10000000-0000-4000-8000-000000000001';
      db.prepare(
        `INSERT INTO project_documents
         (id, project_id, category, document_number, title, revision, status,
          file_path, issued_to, issue_date, notes, created_at, updated_at)
         VALUES (?, ?, 'Drawing', '', 'Layout', 'A', 'Working', 'Layout.pdf', '', NULL, '', ?, ?)`,
      ).run(
        '71000000-0000-4000-8000-000000000001',
        projectId,
        '2026-08-10T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z',
      );
      db.prepare(
        `INSERT INTO canonical_revisions
         (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
          project_snapshot_json, luminaire_snapshot_json, snapshot_hash,
          created_by_id, created_by_name, provenance_classification, legacy_source_id,
          failure_reason, created_at, finalized_at, updated_at)
         VALUES (?, ?, 1, 'REV_01', 'LEGACY_IMPORTED',
                 NULL, NULL, NULL, NULL, NULL, 'LEGACY_VERIFIED', 'legacy-test', NULL, ?, NULL, ?)`,
      ).run(revisionId, projectId, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');

      const insertSnapshot = (deliverableId: string, sourceDocumentId: string, createdAt: string) =>
        db
          .prepare(
            `INSERT INTO revision_document_snapshots
           (deliverable_id, project_id, revision_id, source_document_id, category, title,
            file_name, source_relative_path, locator_kind, locator_value, content_hash,
            size_bytes, created_by_id, created_by_name, created_at)
           VALUES (?, ?, ?, ?, 'Drawing', 'Layout', 'Layout.pdf', 'Layout.pdf',
                   'PROJECT_RELATIVE', 'DELIVERABLES/REV_01/Layout.pdf',
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10,
                   'test', 'Test', ?)`,
          )
          .run(deliverableId, projectId, revisionId, sourceDocumentId, createdAt);

      // 1. valid snapshot insert succeeds (references existing revision + document).
      insertSnapshot(
        '72000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001',
        '2026-08-10T00:00:00.000Z',
      );

      // 2. nonexistent source_document_id fails FK enforcement.
      expect(() =>
        insertSnapshot(
          '72000000-0000-4000-8000-000000000002',
          '71999999-0000-4000-8000-000000000099',
          '2026-08-10T00:00:00.000Z',
        ),
      ).toThrow(/FOREIGN KEY constraint failed/);

      // 3. nonexistent revision fails FK enforcement.
      expect(() =>
        db
          .prepare(
            `INSERT INTO revision_document_snapshots
           (deliverable_id, project_id, revision_id, source_document_id, category, title,
            file_name, source_relative_path, locator_kind, locator_value, content_hash,
            size_bytes, created_at)
           VALUES (?, ?, ?, ?, 'Drawing', 'Layout', 'Layout.pdf', 'Layout.pdf',
                   'PROJECT_RELATIVE', 'DELIVERABLES/REV_01/Layout.pdf',
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10, ?)`,
          )
          .run(
            '72000000-0000-4000-8000-000000000003',
            projectId,
            '70999999-0000-4000-8000-000000000099',
            '71000000-0000-4000-8000-000000000001',
            '2026-08-10T00:00:00.000Z',
          ),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('creates the exact V4 inventory, registers canonical built-ins, and enforces version immutability', async () => {
    expect(PRODUCTION_V4_DDL).toHaveLength(
      PRODUCTION_V4_TABLE_NAMES.length +
        PRODUCTION_V4_INDEX_NAMES.length +
        PRODUCTION_V4_TRIGGER_NAMES.length,
    );
    expect(PRODUCTION_V4_BUILTIN_REGISTRATIONS).toHaveLength(builtInTemplateVersions.length);
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p);
    try {
      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(triggers.map((row) => row.name).sort()).toEqual(
        [...PRODUCTION_V4_TRIGGER_NAMES, ...PRODUCTION_V27_TRIGGER_NAMES].sort(),
      );
      const templates = db
        .prepare(
          `SELECT template_id, family, origin, state, display_name
           FROM output_templates ORDER BY template_id`,
        )
        .all() as Array<Record<string, unknown>>;
      const versions = db
        .prepare(
          `SELECT template_id, version_id, definition_json, definition_hash, created_by
           FROM output_template_versions ORDER BY template_id, version_id`,
        )
        .all() as Array<{
        template_id: string;
        version_id: string;
        definition_json: string;
        definition_hash: string;
        created_by: string;
      }>;
      expect(templates).toHaveLength(
        new Set(
          [...builtInTemplateVersions, ...p4dProfessionalTemplateVersions].map(
            (item) => item.templateId,
          ),
        ).size,
      );
      expect(versions).toHaveLength(
        builtInTemplateVersions.length + p4dProfessionalTemplateVersions.length,
      );
      for (const registration of PRODUCTION_V4_BUILTIN_REGISTRATIONS) {
        const row = versions.find(
          (item) =>
            item.template_id === registration.templateId &&
            item.version_id === registration.versionId,
        );
        expect(row).toBeDefined();
        expect(row!.definition_json).toBe(registration.definitionJson);
        expect(row!.definition_hash).toBe(registration.definitionHash);
        expect(createHash('sha256').update(row!.definition_json, 'utf8').digest('hex')).toBe(
          row!.definition_hash,
        );
        expect(JSON.parse(row!.definition_json)).toEqual(
          builtInTemplateVersions.find(
            (definition) =>
              definition.templateId === registration.templateId &&
              definition.versionId === registration.versionId,
          ),
        );
      }
      const first = PRODUCTION_V4_BUILTIN_REGISTRATIONS[0]!;
      expect(() =>
        db
          .prepare(
            `UPDATE output_template_versions SET definition_hash = ?
             WHERE template_id = ? AND version_id = ?`,
          )
          .run('0'.repeat(64), first.templateId, first.versionId),
      ).toThrow(/immutable/i);
      expect(() =>
        db
          .prepare('DELETE FROM output_template_versions WHERE template_id = ? AND version_id = ?')
          .run(first.templateId, first.versionId),
      ).toThrow(/immutable/i);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('fails closed when an existing built-in Template ID and Version ID has another hash', async () => {
    const p = emptyDb();
    await makeRunner(PRODUCTION_MIGRATIONS.slice(0, 3), 3).run(p);
    const registration = PRODUCTION_V4_BUILTIN_REGISTRATIONS[0]!;
    const db = new DatabaseSync(p);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      for (const tableName of ['output_templates', 'output_template_versions']) {
        const ddl = PRODUCTION_V4_DDL.find((sql) =>
          new RegExp(`^CREATE TABLE IF NOT EXISTS ${tableName}\\b`, 'i').test(sql),
        );
        expect(ddl).toBeDefined();
        db.exec(ddl!);
      }
      db.prepare(
        `INSERT INTO output_templates
         (template_id, family, origin, state, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        registration.templateId,
        registration.family,
        registration.origin,
        registration.state,
        registration.displayName,
        '2026-08-10T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z',
      );
      db.prepare(
        `INSERT INTO output_template_versions
         (template_id, version_id, definition_json, definition_hash, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        registration.templateId,
        registration.versionId,
        registration.definitionJson,
        '0'.repeat(64),
        '2026-08-10T00:00:00.000Z',
        'SYSTEM_P2_FND_04_MIGRATION',
      );
    } finally {
      db.close();
    }
    await expectReject(() => makeRunner().run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(readUserVersion(p)).toBe(3);
    expect(readHistory(p)).toHaveLength(3);
    const check = new DatabaseSync(p, { readOnly: true });
    try {
      const count = check
        .prepare('SELECT COUNT(*) AS count FROM output_template_versions')
        .get() as {
        count: number;
      };
      expect(count.count).toBe(1);
      const row = check
        .prepare(
          `SELECT definition_hash FROM output_template_versions
           WHERE template_id = ? AND version_id = ?`,
        )
        .get(registration.templateId, registration.versionId) as { definition_hash: string };
      expect(row.definition_hash).toBe('0'.repeat(64));
      expect(
        check
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canonical_revisions'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      check.close();
    }
  });

  it('schema_migrations contains exactly thirty real rows through 29 -> 30', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const history = readHistory(p);
    expect(history.length).toBe(30);
    expect(history[0]!.migration_id).toBe(PRODUCTION_MIGRATION_ID);
    expect(history[0]!.from_version).toBe(0);
    expect(history[0]!.to_version).toBe(1);
    expect(history[0]!.checksum).toBe(PRODUCTION_MIGRATIONS[0]!.checksum);
    expect(history[1]!.migration_id).toBe(PRODUCTION_V2_MIGRATION_ID);
    expect(history[1]!.from_version).toBe(1);
    expect(history[1]!.to_version).toBe(2);
    expect(history[1]!.checksum).toBe(PRODUCTION_MIGRATIONS[1]!.checksum);
    expect(history[2]!.migration_id).toBe(PRODUCTION_V3_MIGRATION_ID);
    expect(history[2]!.from_version).toBe(2);
    expect(history[2]!.to_version).toBe(3);
    expect(history[2]!.checksum).toBe(PRODUCTION_MIGRATIONS[2]!.checksum);
    expect(history[3]!.migration_id).toBe(PRODUCTION_V4_MIGRATION_ID);
    expect(history[3]!.from_version).toBe(3);
    expect(history[3]!.to_version).toBe(4);
    expect(history[3]!.checksum).toBe(PRODUCTION_MIGRATIONS[3]!.checksum);
    expect(history[4]!.migration_id).toBe(PRODUCTION_V5_MIGRATION_ID);
    expect(history[4]!.from_version).toBe(4);
    expect(history[4]!.to_version).toBe(5);
    expect(history[4]!.checksum).toBe(PRODUCTION_MIGRATIONS[4]!.checksum);
    expect(history[5]!.migration_id).toBe(PRODUCTION_V6_MIGRATION_ID);
    expect(history[5]!.from_version).toBe(5);
    expect(history[5]!.to_version).toBe(6);
    expect(history[5]!.checksum).toBe(PRODUCTION_MIGRATIONS[5]!.checksum);
    expect(history[6]!.migration_id).toBe(PRODUCTION_V7_MIGRATION_ID);
    expect(history[6]!.from_version).toBe(6);
    expect(history[6]!.to_version).toBe(7);
    expect(history[6]!.checksum).toBe(PRODUCTION_MIGRATIONS[6]!.checksum);
    expect(history[7]!.migration_id).toBe(PRODUCTION_V8_MIGRATION_ID);
    expect(history[7]!.from_version).toBe(7);
    expect(history[7]!.to_version).toBe(8);
    expect(history[7]!.checksum).toBe(PRODUCTION_MIGRATIONS[7]!.checksum);
    expect(history[8]!.migration_id).toBe(PRODUCTION_V9_MIGRATION_ID);
    expect(history[8]!.from_version).toBe(8);
    expect(history[8]!.to_version).toBe(9);
    expect(history[9]!.migration_id).toBe(PRODUCTION_V10_MIGRATION_ID);
    expect(history[9]!.from_version).toBe(9);
    expect(history[9]!.to_version).toBe(10);
    expect(history[10]!.migration_id).toBe(PRODUCTION_V11_MIGRATION_ID);
    expect(history[10]!.from_version).toBe(10);
    expect(history[10]!.to_version).toBe(11);
    expect(history[11]!.migration_id).toBe(PRODUCTION_V12_MIGRATION_ID);
    expect(history[11]!.from_version).toBe(11);
    expect(history[11]!.to_version).toBe(12);
    expect(history[12]!.migration_id).toBe(PRODUCTION_V13_MIGRATION_ID);
    expect(history[12]!.from_version).toBe(12);
    expect(history[12]!.to_version).toBe(13);
    expect(history[13]!.migration_id).toBe(PRODUCTION_V14_MIGRATION_ID);
    expect(history[13]!.from_version).toBe(13);
    expect(history[13]!.to_version).toBe(14);
    expect(history[14]!.migration_id).toBe(PRODUCTION_V15_MIGRATION_ID);
    expect(history[14]!.from_version).toBe(14);
    expect(history[14]!.to_version).toBe(15);
    expect(history[15]!.migration_id).toBe(PRODUCTION_V16_MIGRATION_ID);
    expect(history[15]!.from_version).toBe(15);
    expect(history[15]!.to_version).toBe(16);
    expect(history[16]!.migration_id).toBe(PRODUCTION_V17_MIGRATION_ID);
    expect(history[16]!.from_version).toBe(16);
    expect(history[16]!.to_version).toBe(17);
    expect(history[17]!.migration_id).toBe(PRODUCTION_V18_MIGRATION_ID);
    expect(history[17]!.from_version).toBe(17);
    expect(history[17]!.to_version).toBe(18);
    expect(history[18]!.migration_id).toBe(PRODUCTION_V19_MIGRATION_ID);
    expect(history[18]!.from_version).toBe(18);
    expect(history[18]!.to_version).toBe(19);
    expect(history[19]!.migration_id).toBe(PRODUCTION_V20_MIGRATION_ID);
    expect(history[19]!.from_version).toBe(19);
    expect(history[19]!.to_version).toBe(20);
    expect(history[20]!.migration_id).toBe(PRODUCTION_V21_MIGRATION_ID);
    expect(history[20]!.from_version).toBe(20);
    expect(history[20]!.to_version).toBe(21);
    expect(history[21]!.migration_id).toBe(PRODUCTION_V22_MIGRATION_ID);
    expect(history[21]!.from_version).toBe(21);
    expect(history[21]!.to_version).toBe(22);
    expect(history[22]!.migration_id).toBe(PRODUCTION_V23_MIGRATION_ID);
    expect(history[22]!.from_version).toBe(22);
    expect(history[22]!.to_version).toBe(23);
    expect(history[23]!.migration_id).toBe(PRODUCTION_V24_MIGRATION_ID);
    expect(history[23]!.from_version).toBe(23);
    expect(history[23]!.to_version).toBe(24);
    expect(history[24]!.migration_id).toBe(PRODUCTION_V25_MIGRATION_ID);
    expect(history[24]!.from_version).toBe(24);
    expect(history[24]!.to_version).toBe(25);
    expect(history[25]!.migration_id).toBe(PRODUCTION_V26_MIGRATION_ID);
    expect(history[25]!.from_version).toBe(25);
    expect(history[25]!.to_version).toBe(26);
    expect(history[26]!.migration_id).toBe(PRODUCTION_V27_MIGRATION_ID);
    expect(history[26]!.from_version).toBe(26);
    expect(history[26]!.to_version).toBe(27);
    expect(history[27]!.migration_id).toBe(PRODUCTION_V28_MIGRATION_ID);
    expect(history[27]!.from_version).toBe(27);
    expect(history[27]!.to_version).toBe(28);
    expect(history[28]!.migration_id).toBe(PRODUCTION_V29_MIGRATION_ID);
    expect(history[28]!.from_version).toBe(28);
    expect(history[28]!.to_version).toBe(29);
  });

  it('no fake legacy baseline row exists', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const history = readHistory(p);
    expect(history.map((row) => row.migration_id)).toEqual([
      PRODUCTION_MIGRATION_ID,
      PRODUCTION_V2_MIGRATION_ID,
      PRODUCTION_V3_MIGRATION_ID,
      PRODUCTION_V4_MIGRATION_ID,
      PRODUCTION_V5_MIGRATION_ID,
      PRODUCTION_V6_MIGRATION_ID,
      PRODUCTION_V7_MIGRATION_ID,
      PRODUCTION_V8_MIGRATION_ID,
      PRODUCTION_V9_MIGRATION_ID,
      PRODUCTION_V10_MIGRATION_ID,
      PRODUCTION_V11_MIGRATION_ID,
      PRODUCTION_V12_MIGRATION_ID,
      PRODUCTION_V13_MIGRATION_ID,
      PRODUCTION_V14_MIGRATION_ID,
      PRODUCTION_V15_MIGRATION_ID,
      PRODUCTION_V16_MIGRATION_ID,
      PRODUCTION_V17_MIGRATION_ID,
      PRODUCTION_V18_MIGRATION_ID,
      PRODUCTION_V19_MIGRATION_ID,
      PRODUCTION_V20_MIGRATION_ID,
      PRODUCTION_V21_MIGRATION_ID,
      PRODUCTION_V22_MIGRATION_ID,
      PRODUCTION_V23_MIGRATION_ID,
      PRODUCTION_V24_MIGRATION_ID,
      PRODUCTION_V25_MIGRATION_ID,
      PRODUCTION_V26_MIGRATION_ID,
      PRODUCTION_V27_MIGRATION_ID,
      PRODUCTION_V28_MIGRATION_ID,
      PRODUCTION_V29_MIGRATION_ID,
      PRODUCTION_V30_MIGRATION_ID,
    ]);
    expect(history.every((row) => row.migration_id !== 'legacy-baseline')).toBe(true);
  });

  it('legacy fixture migrates to version 30', async () => {
    const p = legacyFixture();
    const result = await makeRunner().run(p);
    expect(result.status).toBe('migrated');
    expect(result.toVersion).toBe(30);
    expect(readUserVersion(p)).toBe(30);
    expect(readHistory(p).length).toBe(30);
  });

  it('imports only fixed legacy export artifacts, including source-proven Schedule aliases, without guessing relations or templates', async () => {
    const p = legacyFixture();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const outputs = db
        .prepare(
          `SELECT output_id, revision_id, output_family, output_format, locator_kind,
                  legacy_absolute_path, provenance_classification, legacy_source_field,
                  template_id, template_version_id, template_provenance
           FROM canonical_outputs WHERE legacy_source_id = 'syn-export-0001'
           ORDER BY legacy_source_field`,
        )
        .all() as Array<Record<string, unknown>>;
      expect(outputs).toHaveLength(2);
      expect(outputs.map((row) => row.legacy_source_field)).toEqual(['excel_path', 'pdf_path']);
      expect(outputs.map((row) => row.output_family)).toEqual([
        'LuminaireSchedule',
        'LuminaireSchedule',
      ]);
      expect(outputs.map((row) => row.output_format)).toEqual(['XLSX', 'PDF']);
      for (const output of outputs) {
        expect(output.output_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(output.revision_id).toBeNull();
        expect(output.provenance_classification).toBe('LEGACY_UNVERIFIED');
        expect(output.locator_kind).toBe('LEGACY_ABSOLUTE');
        expect(output.legacy_absolute_path).toMatch(/^C:\\Synthetic\\Exports\\schedule\./);
        expect(output.template_id).toBeNull();
        expect(output.template_version_id).toBeNull();
        expect(output.template_provenance).toBe('LEGACY_UNKNOWN');
      }
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM canonical_outputs WHERE legacy_source_field LIKE '%datasheet%'",
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it('keeps ambiguous current exports and packages unverified with nullable relations', async () => {
    const p = currentSelfManagedFixture();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const outputs = db
        .prepare(
          `SELECT output_id, revision_id, provenance_classification, locator_kind,
                  template_provenance, legacy_source_field
           FROM canonical_outputs
           WHERE legacy_source_id = '92000000-0000-4000-8000-000000000001'
           ORDER BY legacy_source_field`,
        )
        .all() as Array<Record<string, unknown>>;
      expect(outputs).toHaveLength(4);
      for (const output of outputs) {
        expect(output.revision_id).toBeNull();
        expect(output.provenance_classification).toBe('LEGACY_UNVERIFIED');
        expect(output.locator_kind).toBe('LEGACY_ABSOLUTE');
        expect(output.template_provenance).toBe('LEGACY_UNKNOWN');
      }
      const issuePackage = db
        .prepare(
          `SELECT package_id, revision_id, package_sequence, provenance_classification
           FROM canonical_issue_packages
           WHERE legacy_source_id = '93000000-0000-4000-8000-000000000001'`,
        )
        .get() as Record<string, unknown>;
      expect(issuePackage.package_id).toBe('93000000-0000-4000-8000-000000000001');
      expect(issuePackage.revision_id).toBeNull();
      expect(issuePackage.package_sequence).toBeNull();
      expect(issuePackage.provenance_classification).toBe('LEGACY_UNVERIFIED');
      const relations = db
        .prepare('SELECT COUNT(*) AS count FROM canonical_package_outputs')
        .get() as { count: number };
      expect(relations.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it('verifies only exact Export evidence and exact manifest IDs, and DB constraints reject mixed revisions', async () => {
    const p = currentSelfManagedFixture();
    const fixture = new DatabaseSync(p);
    try {
      fixture
        .prepare(
          `UPDATE project_revisions
           SET source_type = 'ProjectExport', source_reference = ?
           WHERE id = ?`,
        )
        .run('92000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001');
      fixture
        .prepare('UPDATE revision_packages SET manifest_json = ? WHERE id = ?')
        .run(
          JSON.stringify([
            { itemId: 'export:92000000-0000-4000-8000-000000000001:schedule-pdf' },
            { itemId: 'export:92000000-0000-4000-8000-000000000001:schedule-excel' },
            { itemId: 'export:92000000-0000-4000-8000-000000000001:boq-pdf' },
            { itemId: 'export:92000000-0000-4000-8000-000000000001:boq-excel' },
          ]),
          '93000000-0000-4000-8000-000000000001',
        );
    } finally {
      fixture.close();
    }
    await makeRunner().run(p);
    const db = new DatabaseSync(p);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      const outputs = db
        .prepare(
          `SELECT output_id, revision_id, provenance_classification
           FROM canonical_outputs
           WHERE legacy_source_id = '92000000-0000-4000-8000-000000000001'
           ORDER BY legacy_source_field`,
        )
        .all() as Array<{
        output_id: string;
        revision_id: string;
        provenance_classification: string;
      }>;
      expect(outputs).toHaveLength(4);
      expect(new Set(outputs.map((row) => row.revision_id))).toEqual(
        new Set(['94000000-0000-4000-8000-000000000001']),
      );
      expect(outputs.every((row) => row.provenance_classification === 'LEGACY_VERIFIED')).toBe(
        true,
      );
      const issuePackage = db
        .prepare(
          `SELECT package_id, revision_id, package_sequence, provenance_classification
           FROM canonical_issue_packages
           WHERE legacy_source_id = '93000000-0000-4000-8000-000000000001'`,
        )
        .get() as {
        package_id: string;
        revision_id: string;
        package_sequence: number;
        provenance_classification: string;
      };
      expect(issuePackage).toMatchObject({
        package_id: '93000000-0000-4000-8000-000000000001',
        revision_id: '94000000-0000-4000-8000-000000000001',
        package_sequence: 1,
        provenance_classification: 'LEGACY_VERIFIED',
      });
      const relations = db
        .prepare(
          `SELECT output_id, revision_id, position
           FROM canonical_package_outputs ORDER BY position`,
        )
        .all() as Array<{ output_id: string; revision_id: string; position: number }>;
      expect(relations).toHaveLength(4);
      expect(relations.map((row) => row.position)).toEqual([0, 1, 2, 3]);

      const secondRevisionId = '95000000-0000-4000-8000-000000000002';
      const secondOutputId = '96000000-0000-4000-8000-000000000002';
      db.prepare(
        `INSERT INTO canonical_revisions
         (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
          project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
          created_by_name, provenance_classification, legacy_source_id, failure_reason,
          created_at, finalized_at, updated_at)
         SELECT ?, project_id, 4, 'REV_04', 'LEGACY_IMPORTED', NULL, NULL, NULL, NULL, NULL,
                'LEGACY_VERIFIED', 'test-revision-two', NULL, created_at, NULL, updated_at
         FROM canonical_revisions WHERE revision_id = ?`,
      ).run(secondRevisionId, issuePackage.revision_id);
      db.prepare(
        `INSERT INTO canonical_outputs
         (output_id, project_id, revision_id, output_family, output_format, locator_kind,
          locator_value, legacy_absolute_path, content_hash, template_id, template_version_id,
          resolved_template_snapshot_json, resolved_template_snapshot_hash, lifecycle_state,
          provenance_classification, legacy_source_id, legacy_source_field, template_provenance,
          failure_reason, created_at, finalized_at, updated_at)
         SELECT ?, project_id, ?, 'LuminaireSchedule', 'PDF', 'LEGACY_UNKNOWN', 'test.pdf',
                NULL, NULL, NULL, NULL, NULL, NULL, 'LEGACY_IMPORTED', 'LEGACY_VERIFIED',
                'test-output-two', 'test_field', 'LEGACY_UNKNOWN', NULL,
                created_at, created_at, updated_at
         FROM canonical_revisions WHERE revision_id = ?`,
      ).run(secondOutputId, secondRevisionId, secondRevisionId);
      const insertRelation = db.prepare(
        `INSERT INTO canonical_package_outputs
         (package_id, output_id, revision_id, position, provenance_classification, created_at)
         VALUES (?, ?, ?, ?, 'LEGACY_VERIFIED', '2026-08-10T00:00:00.000Z')`,
      );
      expect(() =>
        insertRelation.run(issuePackage.package_id, secondOutputId, issuePackage.revision_id, 10),
      ).toThrow(/foreign key/i);
      expect(() =>
        insertRelation.run(issuePackage.package_id, secondOutputId, secondRevisionId, 11),
      ).toThrow(/foreign key/i);
    } finally {
      db.close();
    }
  });

  it('current self-managed fixture runs the canonical 0 -> 18 chain without rewriting source data', async () => {
    const p = currentSelfManagedFixture();
    const beforeData = sourceDataSnapshot(p);
    const beforeColumns = sourceColumnSnapshot(p);

    const runner = makeRunner();
    const result = await runner.run(p);
    expect(result).toMatchObject({
      status: 'migrated',
      fromVersion: 0,
      toVersion: 30,
      appliedMigrationIds: [
        PRODUCTION_MIGRATION_ID,
        PRODUCTION_V2_MIGRATION_ID,
        PRODUCTION_V3_MIGRATION_ID,
        PRODUCTION_V4_MIGRATION_ID,
        PRODUCTION_V5_MIGRATION_ID,
        PRODUCTION_V6_MIGRATION_ID,
        PRODUCTION_V7_MIGRATION_ID,
        PRODUCTION_V8_MIGRATION_ID,
        PRODUCTION_V9_MIGRATION_ID,
        PRODUCTION_V10_MIGRATION_ID,
        PRODUCTION_V11_MIGRATION_ID,
        PRODUCTION_V12_MIGRATION_ID,
        PRODUCTION_V13_MIGRATION_ID,
        PRODUCTION_V14_MIGRATION_ID,
        PRODUCTION_V15_MIGRATION_ID,
        PRODUCTION_V16_MIGRATION_ID,
        PRODUCTION_V17_MIGRATION_ID,
        PRODUCTION_V18_MIGRATION_ID,
        PRODUCTION_V19_MIGRATION_ID,
        PRODUCTION_V20_MIGRATION_ID,
        PRODUCTION_V21_MIGRATION_ID,
        PRODUCTION_V22_MIGRATION_ID,
        PRODUCTION_V23_MIGRATION_ID,
        PRODUCTION_V24_MIGRATION_ID,
        PRODUCTION_V25_MIGRATION_ID,
        PRODUCTION_V26_MIGRATION_ID,
        PRODUCTION_V27_MIGRATION_ID,
        PRODUCTION_V28_MIGRATION_ID,
        PRODUCTION_V29_MIGRATION_ID,
        PRODUCTION_V30_MIGRATION_ID,
      ],
    });
    expect(readUserVersion(p)).toBe(30);
    expect(readHistory(p).map((row) => row.migration_id)).toEqual([
      PRODUCTION_MIGRATION_ID,
      PRODUCTION_V2_MIGRATION_ID,
      PRODUCTION_V3_MIGRATION_ID,
      PRODUCTION_V4_MIGRATION_ID,
      PRODUCTION_V5_MIGRATION_ID,
      PRODUCTION_V6_MIGRATION_ID,
      PRODUCTION_V7_MIGRATION_ID,
      PRODUCTION_V8_MIGRATION_ID,
      PRODUCTION_V9_MIGRATION_ID,
      PRODUCTION_V10_MIGRATION_ID,
      PRODUCTION_V11_MIGRATION_ID,
      PRODUCTION_V12_MIGRATION_ID,
      PRODUCTION_V13_MIGRATION_ID,
      PRODUCTION_V14_MIGRATION_ID,
      PRODUCTION_V15_MIGRATION_ID,
      PRODUCTION_V16_MIGRATION_ID,
      PRODUCTION_V17_MIGRATION_ID,
      PRODUCTION_V18_MIGRATION_ID,
      PRODUCTION_V19_MIGRATION_ID,
      PRODUCTION_V20_MIGRATION_ID,
      PRODUCTION_V21_MIGRATION_ID,
      PRODUCTION_V22_MIGRATION_ID,
      PRODUCTION_V23_MIGRATION_ID,
      PRODUCTION_V24_MIGRATION_ID,
      PRODUCTION_V25_MIGRATION_ID,
      PRODUCTION_V26_MIGRATION_ID,
      PRODUCTION_V27_MIGRATION_ID,
      PRODUCTION_V28_MIGRATION_ID,
      PRODUCTION_V29_MIGRATION_ID,
      PRODUCTION_V30_MIGRATION_ID,
    ]);
    const afterData = sourceDataSnapshot(p);
    expect({
      ...afterData,
      project_actions: afterData.project_actions!.map((row) =>
        row.replace(/,null,"","",0,1,null,null,null,null,"",null,null\]$/, ']'),
      ),
      project_contacts: afterData.project_contacts!.map((row) => row.replace(/,"",0\]$/, ']')),
      project_meetings: afterData.project_meetings!.map((row) => row.replace(/,""\]$/, ']')),
      project_luminaires: afterData.project_luminaires!.map((row) =>
        row.replace(/,"","","",1\]$/, ']'),
      ),
    }).toEqual(beforeData);
    const afterColumns = sourceColumnSnapshot(p);
    expect({
      ...afterColumns,
      project_actions: afterColumns.project_actions!.filter(
        (column) =>
          !column.includes('"category_id"') &&
          !column.includes('"owner_role"') &&
          !column.includes('"notes"') &&
          !column.includes('"blocks_issue"') &&
          !column.includes('"row_version"') &&
          !column.includes('"created_by_id"') &&
          !column.includes('"created_by_name"') &&
          !column.includes('"updated_by_id"') &&
          !column.includes('"updated_by_name"') &&
          !column.includes('"area"') &&
          !column.includes('"luminaire_id"') &&
          !column.includes('"review_item_id"'),
      ),
      project_contacts: afterColumns.project_contacts!.filter(
        (column) => !column.includes('"phone"') && !column.includes('"is_primary"'),
      ),
      project_meetings: afterColumns.project_meetings!.filter(
        (column) => !column.includes('"purpose"'),
      ),
      project_luminaires: afterColumns.project_luminaires!.filter(
        (column) =>
          !column.includes('"product_type"') &&
          !column.includes('"variant_label"') &&
          !column.includes('"ordering_code"') &&
          !column.includes('"row_version"'),
      ),
      project_review_items: afterColumns.project_review_items!.filter(
        (column) =>
          !column.includes('"origin"') &&
          !column.includes('"author_id"') &&
          !column.includes('"author_name_snapshot"') &&
          !column.includes('"author_role_snapshot"') &&
          !column.includes('"luminaire_id"'),
      ),
    }).toEqual(beforeColumns);

    const migrated = new DatabaseSync(p, { readOnly: true });
    try {
      for (const table of [...PRODUCTION_V2_TABLE_NAMES, ...PRODUCTION_V3_TABLE_NAMES]) {
        const row = migrated.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        };
        expect(row.count).toBe(0);
      }
      for (const operation of PRODUCTION_COMPATIBILITY_COLUMNS) {
        const columns = migrated.prepare(`PRAGMA table_info(${operation.table})`).all() as Array<{
          name: string;
        }>;
        expect(columns.filter((column) => column.name === operation.column)).toHaveLength(1);
      }
      expect(
        migrated
          .prepare('SELECT COUNT(*) AS count FROM project_actions WHERE category_id IS NULL')
          .get(),
      ).toEqual({ count: beforeData.project_actions!.length });
      expect(
        migrated
          .prepare(
            "SELECT COUNT(*) AS count FROM project_actions WHERE owner_role = '' AND notes = ''",
          )
          .get(),
      ).toEqual({ count: beforeData.project_actions!.length });
    } finally {
      migrated.close();
    }

    const second = await runner.run(p);
    expect(second.status).toBe('up-to-date');
    expect(second.appliedMigrationIds).toEqual([]);
    expect(readHistory(p)).toHaveLength(30);
  });

  it('legacy fixture project IDs remain unchanged', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const before = readProjectIds(p);
    await makeRunner().run(p);
    const after = readProjectIds(p);
    expect(after.workspaceIds).toEqual(before.workspaceIds);
    expect(after.appStateProjectIds).toEqual(before.appStateProjectIds);
    expect(after.allIds.size).toBeGreaterThan(0);
  });

  it('legacy fixture business rows remain intact and the one-time compatibility UPDATE is applied', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p);
    try {
      db.prepare(
        `INSERT INTO project_checklist_items
         (id, project_id, category, title, service_code, required, completed, waived,
          waiver_reason, sort_order, created_at, updated_at)
         VALUES ('syn-checklist-techboq', 'syn-project-0001', 'BOQ QA',
                 'Units and quantities are reviewed without price fields', 'TechnicalBoq',
                 1, 0, 0, '', 99, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).run();
    } finally {
      db.close();
    }
    const beforeCounts = rowCounts(p);
    await makeRunner().run(p);
    const afterCounts = rowCounts(p);
    expect(afterCounts).toEqual(beforeCounts);
    const check = new DatabaseSync(p, { readOnly: true });
    try {
      const row = check
        .prepare(
          "SELECT title, updated_at FROM project_checklist_items WHERE id = 'syn-checklist-techboq'",
        )
        .get() as { title: string; updated_at: string };
      expect(row.title).toBe('Units and quantities are reviewed');
      expect(row.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
      expect(row.updated_at).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
    } finally {
      check.close();
    }
  });

  it('migration rollback returns to exact version-zero state', async () => {
    const dir = newTempDir();
    const p = emptyDb();
    const failing = PRODUCTION_MIGRATIONS[0]!;
    const broken: MigrationDefinition = {
      ...failing,
      up: () => {
        throw new Error('simulated migration failure after partial work');
      },
    };
    const runner = new SchemaMigrationRunner({
      migrations: [broken],
      targetVersion: 1,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(readUserVersion(p)).toBe(0);
    expect(tableCount(p)).toBe(0);
    expect(indexCount(p)).toBe(0);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const history = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get();
      expect(history).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('repeated run is up-to-date and performs no migration', async () => {
    const p = emptyDb();
    const runner = makeRunner();
    const first = await runner.run(p);
    expect(first.status).toBe('migrated');
    const second = await runner.run(p);
    expect(second.status).toBe('up-to-date');
    expect(second.appliedMigrationIds).toEqual([]);
    expect(readHistory(p).length).toBe(30);
    expect(tableCount(p)).toBe(78);
  });

  it('partial and unknown schemas remain rejected by existing admission', async () => {
    // Partial standalone-only legacy schema.
    const partialDir = newTempDir();
    const partialPath = dbPathIn(partialDir);
    LegacyV322FixtureBuilder.build({
      outputPath: partialPath,
      profile: 'PARTIAL_STANDALONE_ONLY',
    });
    await expectReject(() => makeRunner().run(partialPath), 'LEGACY_ADMISSION_REJECTED');

    // Unknown version-zero schema.
    const unknownDir = newTempDir();
    const unknownPath = dbPathIn(unknownDir);
    const db = new DatabaseSync(unknownPath);
    try {
      db.exec('CREATE TABLE unknown_table (id TEXT PRIMARY KEY)');
    } finally {
      db.close();
    }
    await expectReject(() => makeRunner().run(unknownPath), 'LEGACY_ADMISSION_REJECTED');
  });

  it('empty and legacy migrated final product schemas are structurally identical', async () => {
    const emptyPath = emptyDb();
    await makeRunner().run(emptyPath);
    const legacyPath = legacyFixture();
    await makeRunner().run(legacyPath);
    const emptyFp = completeProductFingerprint(emptyPath);
    const legacyFp = completeProductFingerprint(legacyPath);
    expect(legacyFp).toBe(emptyFp);
    expect(emptyFp).toBe(EXPECTED_COMPLETE_PRODUCT_FINGERPRINT);
  });

  it('complete literal final target structural fingerprint is locked', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const fp = completeProductFingerprint(p);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(EXPECTED_COMPLETE_PRODUCT_FINGERPRINT);
  });

  it('RUNTIME_MINIMAL fixture preserves data and IDs across migration', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'RUNTIME_MINIMAL' });
    const beforeIds = readProjectIds(p);
    const beforeCounts = rowCounts(p);
    await makeRunner().run(p);
    expect(readUserVersion(p)).toBe(30);
    expect(readHistory(p).length).toBe(30);
    expect(readProjectIds(p)).toEqual(beforeIds);
    expect(rowCounts(p)).toEqual(beforeCounts);
  });

  it('legacy fixture never duplicates existing compatibility columns', async () => {
    const p = legacyFixture();
    const beforeStatus = columnNames(p, 'revision_packages').filter((n) => n === 'status').length;
    const beforeRevCols = columnNames(p, 'project_revisions');
    await makeRunner().run(p);
    const after = new DatabaseSync(p, { readOnly: true });
    try {
      const statusCols = after.prepare('PRAGMA table_info(revision_packages)').all() as Array<{
        name: string;
      }>;
      expect(statusCols.filter((c) => c.name === 'status').length).toBe(beforeStatus);
      expect(beforeStatus).toBe(1);
      const revCols = after.prepare('PRAGMA table_info(project_revisions)').all() as Array<{
        name: string;
      }>;
      for (const name of beforeRevCols) {
        expect(revCols.map((c) => c.name)).toContain(name);
      }
      for (const op of PRODUCTION_COMPATIBILITY_COLUMNS) {
        const cols = after.prepare(`PRAGMA table_info(${op.table})`).all() as Array<{
          name: string;
        }>;
        expect(cols.filter((c) => c.name === op.column).length).toBe(1);
      }
    } finally {
      after.close();
    }
  });

  it('fresh migrated database time_zone column default is Asia/Dubai', async () => {
    const p = emptyDb();
    await makeRunner().run(p);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const cols = db.prepare('PRAGMA table_info(personal_settings)').all() as Array<{
        name: string;
        dflt_value: string | null;
      }>;
      const tz = cols.find((c) => c.name === 'time_zone');
      expect(tz).toBeDefined();
      expect(tz!.dflt_value).toBe("'Asia/Dubai'");
    } finally {
      db.close();
    }
  });

  it('legacy migration applies the deterministic time_zone default without overwriting settings', async () => {
    const p = legacyFixture();
    const before = new DatabaseSync(p, { readOnly: true });
    let beforeRow: {
      project_root: string;
      default_folder_profile: string;
      default_input_mode: string;
      auto_open_project_folder: number;
      updated_at: string;
    };
    try {
      beforeRow = before
        .prepare(
          'SELECT project_root, default_folder_profile, default_input_mode, auto_open_project_folder, updated_at FROM personal_settings WHERE id = 1',
        )
        .get() as typeof beforeRow;
    } finally {
      before.close();
    }
    await makeRunner().run(p);
    const after = new DatabaseSync(p, { readOnly: true });
    try {
      const row = after
        .prepare(
          'SELECT project_root, default_folder_profile, default_input_mode, auto_open_project_folder, updated_at, time_zone FROM personal_settings WHERE id = 1',
        )
        .get() as typeof beforeRow & { time_zone: string };
      expect(row.project_root).toBe(beforeRow.project_root);
      expect(row.default_folder_profile).toBe(beforeRow.default_folder_profile);
      expect(row.default_input_mode).toBe(beforeRow.default_input_mode);
      expect(row.auto_open_project_folder).toBe(beforeRow.auto_open_project_folder);
      expect(row.updated_at).toBe(beforeRow.updated_at);
      expect(row.time_zone).toBe('Asia/Dubai');
    } finally {
      after.close();
    }
  });

  it('TechnicalBoq UPDATE leaves already-updated rows unchanged', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const db = new DatabaseSync(p);
    try {
      db.prepare(
        `INSERT INTO project_checklist_items
         (id, project_id, category, title, service_code, required, completed, waived,
          waiver_reason, sort_order, created_at, updated_at)
         VALUES ('tbq-already', 'tbq-probe', 'BOQ QA',
                 'Units and quantities are reviewed', 'TechnicalBoq',
                 1, 0, 0, '', 100, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO project_checklist_items
         (id, project_id, category, title, service_code, required, completed, waived,
          waiver_reason, sort_order, created_at, updated_at)
         VALUES ('tbq-old', 'tbq-probe', 'BOQ QA OLD',
                 'Units and quantities are reviewed without price fields', 'TechnicalBoq',
                 1, 0, 0, '', 101, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).run();
    } finally {
      db.close();
    }
    await makeRunner().run(p);
    const check = new DatabaseSync(p, { readOnly: true });
    try {
      const already = check
        .prepare("SELECT title, updated_at FROM project_checklist_items WHERE id = 'tbq-already'")
        .get() as { title: string; updated_at: string };
      expect(already.title).toBe('Units and quantities are reviewed');
      expect(already.updated_at).toBe('2026-01-01T00:00:00.000Z');
      const updated = check
        .prepare("SELECT title, updated_at FROM project_checklist_items WHERE id = 'tbq-old'")
        .get() as { title: string; updated_at: string };
      expect(updated.title).toBe('Units and quantities are reviewed');
      expect(updated.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
      expect(updated.updated_at).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
    } finally {
      check.close();
    }
  });

  it('rollback from a legacy database restores the exact original state', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: p, profile: 'REPRESENTATIVE_POPULATED' });
    const beforeCounts = rowCounts(p);
    const beforeIds = readProjectIds(p);
    const beforeWorkspaceCols = columnNames(p, 'project_workspaces');
    const failing = PRODUCTION_MIGRATIONS[0]!;
    const broken: MigrationDefinition = {
      ...failing,
      up: (context) => {
        // Partial compatibility work before a simulated mid-migration failure.
        context.database.exec(
          "ALTER TABLE project_workspaces ADD COLUMN rollback_probe TEXT NOT NULL DEFAULT ''",
        );
        throw new Error('simulated failure after partial compatibility work');
      },
    };
    const runner = new SchemaMigrationRunner({
      migrations: [broken],
      targetVersion: 1,
      appVersion: '3.3.0',
      databaseFactory: realDatabaseFactory(),
      backupFactory: new FakeBackupFactory(),
      journal: new FakeJournal(),
      clock: makeClock(),
      pathResolver: new PathResolverService(dir),
      busyTimeoutMs: 5000,
      legacyAdmission: new LegacyDetector(),
    });
    await expectReject(() => runner.run(p), 'MIGRATION_EXECUTION_FAILED');
    expect(readUserVersion(p)).toBe(0);
    expect(tableCount(p)).toBe(24);
    const db = new DatabaseSync(p, { readOnly: true });
    try {
      const history = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get();
      expect(history).toBeUndefined();
      const workspaceCols = db.prepare('PRAGMA table_info(project_workspaces)').all() as Array<{
        name: string;
      }>;
      expect(workspaceCols.some((c) => c.name === 'rollback_probe')).toBe(false);
      expect(workspaceCols.map((c) => c.name).sort()).toEqual([...beforeWorkspaceCols].sort());
    } finally {
      db.close();
    }
    expect(rowCounts(p)).toEqual(beforeCounts);
    expect(readProjectIds(p)).toEqual(beforeIds);
  });
});

function readProjectIds(p: string): {
  workspaceIds: string[];
  appStateProjectIds: string[];
  allIds: Set<string>;
} {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const workspaceRows = db
      .prepare('SELECT project_id FROM project_workspaces ORDER BY project_id')
      .all() as Array<{ project_id: string }>;
    const stateRow = db
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as { json_value: string } | undefined;
    const parsed = stateRow
      ? (JSON.parse(stateRow.json_value) as { projects: Array<{ id: string }> })
      : { projects: [] };
    const allIds = new Set<string>();
    for (const row of workspaceRows) allIds.add(row.project_id);
    for (const project of parsed.projects) allIds.add(project.id);
    return {
      workspaceIds: workspaceRows.map((r) => r.project_id),
      appStateProjectIds: parsed.projects.map((project) => project.id),
      allIds,
    };
  } finally {
    db.close();
  }
}

function rowCounts(p: string): Record<string, number> {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const counts: Record<string, number> = {};
    for (const table of TABLE_NAMES) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
        count: number;
      };
      counts[table] = row.count;
    }
    return counts;
  } finally {
    db.close();
  }
}
function columnNames(p: string, table: string): string[] {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    return cols.map((c) => c.name);
  } finally {
    db.close();
  }
}

function sourceDataSnapshot(p: string): Record<string, readonly string[]> {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const snapshot: Record<string, readonly string[]> = {};
    for (const table of PRODUCTION_TABLE_NAMES) {
      const columns = (
        db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      ).filter(
        (column) =>
          (table !== 'project_review_items' ||
            ![
              'origin',
              'author_id',
              'author_name_snapshot',
              'author_role_snapshot',
              'luminaire_id',
            ].includes(column.name)) &&
          // V4-ISSUE-A0: the additive v12 Issue-audit columns are excluded from
          // the source-preservation oracle because they are added by migration
          // and are NULL for every pre-migration row.
          (table !== 'revision_packages' ||
            !['issued_by_id', 'issued_by_name', 'issued_at'].includes(column.name)),
      );
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      snapshot[table] = Object.freeze(
        rows.map((row) => JSON.stringify(columns.map((column) => row[column.name]))).sort(),
      );
    }
    return snapshot;
  } finally {
    db.close();
  }
}

function sourceColumnSnapshot(p: string): Record<string, readonly string[]> {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const snapshot: Record<string, readonly string[]> = {};
    for (const table of PRODUCTION_TABLE_NAMES) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;
      snapshot[table] = Object.freeze(
        columns
          .filter(
            // V4-ISSUE-A0: exclude the additive v12 Issue-audit columns from the
            // source-preservation oracle (they are added by migration).
            (column) =>
              table !== 'revision_packages' ||
              !['issued_by_id', 'issued_by_name', 'issued_at'].includes(column.name),
          )
          .map((column) =>
            JSON.stringify([
              column.name,
              column.type,
              column.notnull,
              column.dflt_value,
              column.pk,
            ]),
          ),
      );
    }
    return snapshot;
  } finally {
    db.close();
  }
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}

function completeProductFingerprint(p: string): string {
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    const parts: string[] = [];
    for (const table of [...TABLE_NAMES].sort()) {
      const sqlRow = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string } | undefined;
      parts.push(`TABLE ${table} ${normalizeSql(sqlRow?.sql ?? '')}`);
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;
      for (const c of cols) {
        parts.push(
          `  COL ${c.name}|${c.type}|nn=${c.notnull}|dflt=${c.dflt_value ?? '<null>'}|pk=${c.pk}`,
        );
      }
    }
    for (const index of [...INDEX_NAMES].sort()) {
      const sqlRow = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?")
        .get(index) as { sql: string } | undefined;
      parts.push(`INDEX ${index} ${normalizeSql(sqlRow?.sql ?? '')}`);
    }
    return createHash('sha256').update(parts.join('\n'), 'utf-8').digest('hex');
  } finally {
    db.close();
  }
}
