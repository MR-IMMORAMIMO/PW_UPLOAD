/**
 * UAT-FIX-04-A production reality gate.
 *
 * Exercises a deterministic populated current self-managed unversioned database through the real
 * production startup assembly: lock, restore gate, interrupted-attempt gate, LegacyDetector,
 * verified BackupManager backup, SchemaMigrationRunner, and the full production registry,
 * external-mode runtime readiness, shutdown, and an up-to-date restart.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig, type AppConfig } from '@scli/config';

import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import {
  PRODUCTION_COMPATIBILITY_COLUMNS,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_TABLE_NAMES,
  PRODUCTION_V2_INDEX_NAMES,
  PRODUCTION_V2_TABLE_NAMES,
  PRODUCTION_V3_INDEX_NAMES,
  PRODUCTION_V3_TABLE_NAMES,
} from './infrastructure/migration/registry/production-migration-registry';
import { CurrentSelfManagedUnversionedFixtureBuilder } from './infrastructure/migration/testing/CurrentSelfManagedUnversionedFixtureBuilder';
import {
  createPersonalProductionStartup,
  type PersonalProductionStartup,
} from './infrastructure/startup/createPersonalProductionStartup';

const FIXED_BASE_MS = Date.parse('2026-08-09T08:00:00.000Z');
const temporaryDirectories: string[] = [];
const openStartups: PersonalProductionStartup[] = [];

afterEach(async () => {
  for (const startup of openStartups.splice(0).reverse()) {
    try {
      await startup.shutdown();
    } catch {
      // Best-effort cleanup; preserve the original test result.
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-fix-04a-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'UAT Fixture Admin',
    STANDALONE_ADMIN_EMAIL: 'uat.fixture.admin@example.test',
    STANDALONE_ADMIN_PASSWORD: 'UAT-Fixture-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'UAT Current Profile',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

function makeStartup(
  config: AppConfig,
  databasePath: string,
  dataRoot: string,
  idSuffix: string,
): PersonalProductionStartup {
  let clockTick = 0;
  const startup = createPersonalProductionStartup({
    config,
    databasePath,
    dataRoot,
    clock: { now: () => new Date(FIXED_BASE_MS + clockTick++ * 1000) },
    journalIdGenerator: { generate: () => `uat-fix-04a-attempt-${idSuffix}` },
    backupIdGenerator: { generate: () => `uat-fix-04a-backup-${idSuffix}` },
    restoreStagingNameGenerator: { generate: () => `uat-fix-04a-restore-${idSuffix}` },
    lockBusyTimeoutMs: 200,
    runnerBusyTimeoutMs: 5_000,
  });
  openStartups.push(startup);
  return startup;
}

function readUserVersion(databasePath: string): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database.prepare('PRAGMA user_version').get() as
      { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    database.close();
  }
}

function hasMigrationHistory(databasePath: string): boolean {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Boolean(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get(),
    );
  } finally {
    database.close();
  }
}

// V29 fields are additive defaults, separately asserted by its migration tests.
// The historical oracle compares every original column and byte unchanged.
function isFinalUiColumn(table: string, column: string): boolean {
  return table === 'project_contacts'
    ? ['phone', 'is_primary'].includes(column)
    : table === 'project_actions'
      ? ['area', 'luminaire_id', 'review_item_id'].includes(column)
      : false;
}

function sourceDataSnapshot(databasePath: string): Record<string, readonly string[]> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const snapshot: Record<string, readonly string[]> = {};
    for (const table of PRODUCTION_TABLE_NAMES) {
      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      const rows = database.prepare(`SELECT * FROM ${table}`).all() as Array<
        Record<string, unknown>
      >;
      snapshot[table] = Object.freeze(
        rows.map((row) =>
          JSON.stringify(
            columns
              // V4-ISSUE-A0: exclude the additive v12 Issue-audit columns from
              // the source-preservation oracle (they are added by migration and
              // are NULL for every pre-migration row).
              .filter(
                (column) =>
                  table !== 'revision_packages' ||
                  !['issued_by_id', 'issued_by_name', 'issued_at'].includes(column.name),
              )
              .filter((column) => !isFinalUiColumn(table, column.name))
              .map((column) => row[column.name]),
          ),
        ),
      );
    }
    return snapshot;
  } finally {
    database.close();
  }
}

function sourceColumnSnapshot(databasePath: string): Record<string, readonly string[]> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const snapshot: Record<string, readonly string[]> = {};
    for (const table of PRODUCTION_TABLE_NAMES) {
      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;
      snapshot[table] = Object.freeze(
        columns
          .filter(
            // V4-ISSUE-A0: exclude the additive v12 Issue-audit columns from
            // the source-preservation oracle (they are added by migration).
            (column) =>
              table !== 'revision_packages' ||
              !['issued_by_id', 'issued_by_name', 'issued_at'].includes(column.name),
          )
          .filter((column) => !isFinalUiColumn(table, column.name))
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
    database.close();
  }
}

function readHistory(databasePath: string): Array<{
  migration_id: string;
  from_version: number;
  to_version: number;
  checksum: string;
  backup_id: string;
}> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        `SELECT migration_id, from_version, to_version, checksum, backup_id
         FROM schema_migrations ORDER BY to_version`,
      )
      .all() as Array<{
      migration_id: string;
      from_version: number;
      to_version: number;
      checksum: string;
      backup_id: string;
    }>;
  } finally {
    database.close();
  }
}

function backupDirectories(backupRoot: string): string[] {
  if (!existsSync(backupRoot)) return [];
  return readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.partial-'))
    .map((entry) => entry.name)
    .sort();
}

describe('UAT-FIX-04-A current unversioned production migration reality', () => {
  it('backs up, adopts through the full registry, preserves data, and restarts up to date', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'scli-uat-fix-04a-'));
    temporaryDirectories.push(dataRoot);
    const databasePath = path.join(dataRoot, 'scli-workspace.sqlite');
    const projectRoot = path.join(dataRoot, 'projects');
    const backupRoot = path.join(dataRoot, 'backups');
    mkdirSync(projectRoot, { recursive: true });

    const fixture = CurrentSelfManagedUnversionedFixtureBuilder.build({
      outputPath: databasePath,
    });
    const detection = new LegacyDetector().inspect(databasePath);
    expect(detection).toMatchObject({
      status: 'CURRENT_SELF_MANAGED_UNVERSIONED',
      safeReasonCode: 'EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA',
      migrationCandidate: true,
      observedUserVersion: 0,
      historyTableExists: false,
    });
    expect(fixture.projectIds).toHaveLength(2);

    const sourceDataBefore = sourceDataSnapshot(databasePath);
    const sourceColumnsBefore = sourceColumnSnapshot(databasePath);
    const config = makeConfig(databasePath, projectRoot);

    const first = makeStartup(config, databasePath, dataRoot, '0001');
    const firstResult = await first.start();
    expect(firstResult).toMatchObject({
      outcome: 'READY_AFTER_MIGRATION',
      migrated: true,
      fromVersion: 0,
      toVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      appliedMigrationIds: PRODUCTION_MIGRATIONS.map((migration) => migration.id),
      manualActionRequired: false,
    });
    expect(first.runtimeDependencies().provider).toBeDefined();
    expect(first.runtimeDependencies().personalStore).toBeDefined();
    await first.shutdown();

    const backupId = 'uat-fix-04a-backup-0001';
    const backupPath = path.join(backupRoot, backupId, 'database.sqlite');
    const metadataPath = path.join(backupRoot, backupId, 'metadata.json');
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(metadataPath)).toBe(true);
    expect(JSON.parse(readFileSync(metadataPath, 'utf-8'))).toMatchObject({
      backupId,
      status: 'verified',
      schemaVersion: 0,
      migrationId: `UPGRADE_0_TO_${PRODUCTION_SCHEMA_TARGET_VERSION}`,
    });
    expect(readUserVersion(backupPath)).toBe(0);
    expect(hasMigrationHistory(backupPath)).toBe(false);
    expect(sourceDataSnapshot(backupPath)).toEqual(sourceDataBefore);
    expect(sourceColumnSnapshot(backupPath)).toEqual(sourceColumnsBefore);

    expect(readUserVersion(databasePath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    const history = readHistory(databasePath);
    expect(history).toEqual(
      PRODUCTION_MIGRATIONS.map((migration) => ({
        migration_id: migration.id,
        from_version: migration.fromVersion,
        to_version: migration.toVersion,
        checksum: migration.checksum,
        backup_id: backupId,
      })),
    );
    const sourceDataAfter = sourceDataSnapshot(databasePath);
    expect({
      ...sourceDataAfter,
      project_actions: sourceDataAfter.project_actions!.map((row) =>
        row.replace(/,null,"","",0,1,null,null,null,null\]$/, ']'),
      ),
      // v9 adds an intentionally empty purpose; legacy Meeting values remain otherwise byte-stable.
      project_meetings: sourceDataAfter.project_meetings!.map((row) => row.replace(/,""\]$/, ']')),
      // v10 adds nullable authored-thread relation fields without fabricating legacy values.
      project_review_items: sourceDataAfter.project_review_items!.map((row) =>
        row.replace(/,null,null,null,null,null\]$/, ']'),
      ),
      // v22 adds empty library-binding columns and v25 adds row-version authority without changing legacy values.
      project_luminaires: sourceDataAfter.project_luminaires!.map((row) =>
        row.replace(/,"","","",1\]$/, ']'),
      ),
    }).toEqual(sourceDataBefore);
    const sourceColumnsAfter = sourceColumnSnapshot(databasePath);
    expect({
      ...sourceColumnsAfter,
      project_actions: sourceColumnsAfter.project_actions!.filter(
        (column) =>
          !column.includes('"category_id"') &&
          !column.includes('"owner_role"') &&
          !column.includes('"notes"') &&
          !column.includes('"blocks_issue"') &&
          !column.includes('"row_version"') &&
          !column.includes('"created_by_id"') &&
          !column.includes('"created_by_name"') &&
          !column.includes('"updated_by_id"') &&
          !column.includes('"updated_by_name"'),
      ),
      project_meetings: sourceColumnsAfter.project_meetings!.filter(
        (column) => !column.includes('"purpose"'),
      ),
      project_review_items: sourceColumnsAfter.project_review_items!.filter(
        (column) =>
          !column.includes('"origin"') &&
          !column.includes('"author_id"') &&
          !column.includes('"author_name_snapshot"') &&
          !column.includes('"author_role_snapshot"') &&
          !column.includes('"luminaire_id"'),
      ),
      project_luminaires: sourceColumnsAfter.project_luminaires!.filter(
        (column) =>
          !column.includes('"product_type"') &&
          !column.includes('"variant_label"') &&
          !column.includes('"ordering_code"') &&
          !column.includes('"row_version"'),
      ),
    }).toEqual(sourceColumnsBefore);

    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const stateRow = migrated
        .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
        .get() as { json_value: string };
      const state = JSON.parse(stateRow.json_value) as {
        projects: Array<{
          id: string;
          projectCode: string;
          crmReference: string;
          actualHours: number;
        }>;
      };
      expect(state.projects.map((project) => project.id)).toEqual(fixture.projectIds);
      expect(state.projects.map((project) => project.projectCode)).toEqual([
        '019_SCLI251204_GEVI_SHARJAH',
        '020_SCT260801_CURRENT_SCHEMA',
      ]);
      expect(state.projects.map((project) => project.crmReference)).toEqual([
        'CRM-UAT-LEGACY-019',
        'CRM-UAT-CURRENT-020',
      ]);
      expect(state.projects.map((project) => project.actualHours)).toEqual([17.5, 9]);

      for (const table of [...PRODUCTION_V2_TABLE_NAMES, ...PRODUCTION_V3_TABLE_NAMES]) {
        const count = migrated.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        };
        expect(count.count).toBe(0);
      }
      for (const index of [...PRODUCTION_V2_INDEX_NAMES, ...PRODUCTION_V3_INDEX_NAMES]) {
        const row = migrated
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?")
          .get(index) as { name?: string } | undefined;
        expect(row?.name).toBe(index);
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
      ).toEqual({ count: sourceDataBefore.project_actions!.length });
      expect(
        migrated
          .prepare(
            "SELECT COUNT(*) AS count FROM project_actions WHERE owner_role = '' AND notes = ''",
          )
          .get(),
      ).toEqual({ count: sourceDataBefore.project_actions!.length });
      const genuineActivityCount = migrated
        .prepare('SELECT COUNT(*) AS count FROM workspace_activity')
        .get() as { count: number };
      expect(genuineActivityCount.count).toBe(sourceDataBefore['workspace_activity']!.length);
    } finally {
      migrated.close();
    }
    expect(backupDirectories(backupRoot)).toEqual([backupId]);

    const second = makeStartup(config, databasePath, dataRoot, '0002');
    const secondResult = await second.start();
    expect(secondResult).toMatchObject({
      outcome: 'READY',
      migrated: false,
      fromVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      toVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      appliedMigrationIds: [],
      manualActionRequired: false,
    });
    await second.shutdown();

    expect(readHistory(databasePath)).toEqual(history);
    const sourceDataAfterRestart = sourceDataSnapshot(databasePath);
    expect({
      ...sourceDataAfterRestart,
      project_actions: sourceDataAfterRestart.project_actions!.map((row) =>
        row.replace(/,null,"","",0,1,null,null,null,null\]$/, ']'),
      ),
      project_meetings: sourceDataAfterRestart.project_meetings!.map((row) =>
        row.replace(/,""\]$/, ']'),
      ),
      project_review_items: sourceDataAfterRestart.project_review_items!.map((row) =>
        row.replace(/,null,null,null,null,null\]$/, ']'),
      ),
      project_luminaires: sourceDataAfterRestart.project_luminaires!.map((row) =>
        row.replace(/,"","","",1\]$/, ']'),
      ),
    }).toEqual(sourceDataBefore);
    expect(backupDirectories(backupRoot)).toEqual([backupId]);
  });
});
