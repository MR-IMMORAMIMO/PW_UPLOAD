import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { PathResolverService } from '../../path/PathResolverService';
import { BackupManager } from '../../backup/BackupManager';
import { SchemaMigrationRunner } from '../SchemaMigrationRunner';
import { LegacyDetector } from '../legacy/LegacyDetector';
import {
  SchemaMigrationError,
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDefinition,
  type MigrationJournalPort,
} from '../types';
import { VersionedMigrationFixtureBuilder } from '../testing/VersionedMigrationFixtureBuilder';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './production-migration-registry';
import {
  computeProductionSchemaFingerprint,
  validateProductionSchemaVersion,
} from './production-schema-validator';

function removeTree(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(directory);
}

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) removeTree(temporaryRoots.pop()!);
});

function newTemporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p2c12-'));
  temporaryRoots.push(root);
  return root;
}

class RecordingBackupFactory implements MigrationBackupFactory {
  public createCount = 0;
  public verifyCount = 0;

  public create(): MigrationBackupPort {
    this.createCount += 1;
    return {
      createVerifiedBackup: async () => ({ backupId: `fixture-backup-${this.createCount}` }),
      verifyBackup: async () => {
        this.verifyCount += 1;
        return { ok: true };
      },
    };
  }
}

class RecordingJournal implements MigrationJournalPort {
  public createCount = 0;

  public async createAttempt(): Promise<{ attemptId: string }> {
    this.createCount += 1;
    return { attemptId: `fixture-attempt-${this.createCount}` };
  }

  public async transition(): Promise<void> {}

  public async markFailed(): Promise<void> {}
}

function makeRunner(
  root: string,
  options: {
    migrations?: readonly MigrationDefinition[];
    backupFactory?: MigrationBackupFactory;
    journal?: RecordingJournal;
  } = {},
): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: options.migrations ?? PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: 'p2c12-fixture',
    databaseFactory: {
      openReadWrite: (databasePath) => new DatabaseSync(databasePath),
      openReadOnly: (databasePath) => new DatabaseSync(databasePath, { readOnly: true }),
    },
    backupFactory: options.backupFactory ?? new RecordingBackupFactory(),
    journal: options.journal ?? new RecordingJournal(),
    clock: { now: () => new Date('2026-08-23T00:00:00.000Z') },
    pathResolver: new PathResolverService(root),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

function readRows(databasePath: string, sql: string): readonly Record<string, unknown>[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

function readUserVersion(databasePath: string): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    database.close();
  }
}

function readHistoryCount(databasePath: string): number {
  return Number(
    readRows(databasePath, 'SELECT COUNT(*) AS count FROM schema_migrations')[0]!.count,
  );
}

async function expectMigrationError(
  action: () => Promise<unknown>,
  code: string,
): Promise<SchemaMigrationError> {
  try {
    await action();
    throw new Error('Expected migration failure.');
  } catch (error) {
    if (!(error instanceof SchemaMigrationError)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
}

function canonicalManifest(
  databasePath: string,
): Record<string, readonly Record<string, unknown>[]> {
  return {
    assets: readRows(
      databasePath,
      `SELECT id, project_id, luminaire_id, version_sequence, file_path, size_bytes,
              file_hash, backfilled, attached_at, attached_by_id, attached_by_name_snapshot
       FROM luminaire_asset_versions ORDER BY project_id, version_sequence`,
    ),
    revisions: readRows(
      databasePath,
      `SELECT revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
              provenance_classification, created_at, finalized_at, updated_at
       FROM canonical_revisions ORDER BY project_id, revision_sequence`,
    ),
    outputs: readRows(
      databasePath,
      `SELECT output_id, project_id, revision_id, output_family, output_format, locator_kind,
              locator_value, content_hash, lifecycle_state, provenance_classification
       FROM canonical_outputs ORDER BY project_id, output_id`,
    ),
    packages: readRows(
      databasePath,
      `SELECT package_id, project_id, revision_id, package_sequence, label,
              artifact_locator_kind, artifact_locator_value, manifest_locator_kind,
              manifest_locator_value, lifecycle_state, provenance_classification
       FROM canonical_issue_packages ORDER BY project_id, package_id`,
    ),
    packageMembers: readRows(
      databasePath,
      `SELECT package_id, source_type, source_id, revision_id, position,
              provenance_classification
       FROM revision_package_deliverables ORDER BY package_id, position`,
    ),
  };
}

describe('versioned migration reality and final v30 validation', () => {
  for (const sourceVersion of [15, 16, 17, 18, 19] as const) {
    it(`preserves the exact populated v${sourceVersion} graph through v25 and restart`, async () => {
      const root = newTemporaryRoot();
      const databasePath = path.join(root, `populated-v${sourceVersion}.sqlite`);
      VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: sourceVersion });

      const before = canonicalManifest(databasePath);
      const beforeSnapshots = readRows(
        databasePath,
        `SELECT deliverable_id, project_id, revision_id, source_document_id,
                category, title, file_name, source_relative_path, locator_kind, locator_value,
                content_hash, size_bytes, created_by_id, created_by_name, created_at,
                source_artifact_version_id
         FROM revision_document_snapshots ORDER BY project_id, deliverable_id`,
      );
      const beforeTombstones =
        sourceVersion >= 17
          ? readRows(
              databasePath,
              `SELECT operation_id, project_id, revision_id, revision_sequence, revision_label,
                      actor_id, actor_name_snapshot, state, failure_reason,
                      artifact_manifest_json, document_snapshot_count,
                      datasheet_snapshot_count, generated_output_count, created_at,
                      archive_started_at, db_committed_at, completed_at, updated_at
               FROM revision_delete_operations ORDER BY operation_id`,
            )
          : [];

      const result = await makeRunner(root).run(databasePath);
      expect(result).toMatchObject({
        status: 'migrated',
        fromVersion: sourceVersion,
        toVersion: 30,
      });
      expect(canonicalManifest(databasePath)).toEqual(before);
      expect(
        readRows(
          databasePath,
          `SELECT deliverable_id, project_id, revision_id, source_document_id,
                  category, title, file_name, source_relative_path, locator_kind, locator_value,
                  content_hash, size_bytes, created_by_id, created_by_name, created_at,
                  source_artifact_version_id
           FROM revision_document_snapshots ORDER BY project_id, deliverable_id`,
        ),
      ).toEqual(beforeSnapshots);

      const afterAssets = canonicalManifest(databasePath).assets!;
      expect(afterAssets.filter((row) => row.file_hash === null)).toHaveLength(2);
      expect(afterAssets.filter((row) => row.file_hash !== null)).toHaveLength(2);
      expect(afterAssets.filter((row) => row.backfilled === 1)).toHaveLength(2);

      const metadata = readRows(
        databasePath,
        `SELECT revision_id, purpose, internal_note
         FROM canonical_revisions ORDER BY project_id, revision_sequence`,
      );
      expect(metadata.every((row) => row.purpose === null && row.internal_note === null)).toBe(
        true,
      );

      if (sourceVersion >= 17) {
        const afterTombstones = readRows(
          databasePath,
          `SELECT operation_id, project_id, revision_id, revision_sequence, revision_label,
                  actor_id, actor_name_snapshot, state, failure_reason, artifact_manifest_json,
                  document_snapshot_count, datasheet_snapshot_count, generated_output_count,
                  created_at, archive_started_at, db_committed_at, completed_at, updated_at
           FROM revision_delete_operations ORDER BY operation_id`,
        );
        expect(afterTombstones).toEqual(beforeTombstones);
      }
      if (sourceVersion === 18) {
        expect(
          readRows(
            databasePath,
            `SELECT reused_by_revision_id, reused_at, reused_by_actor_id,
                    reused_by_actor_name, reuse_reason
             FROM revision_delete_operations
             WHERE operation_id = '90000000-0000-4000-8000-000000000001'`,
          )[0],
        ).toEqual({
          reused_by_revision_id: '20000000-0000-4000-8000-000000000003',
          reused_at: '2026-08-20T08:00:00.000Z',
          reused_by_actor_id: 'reuse-owner',
          reused_by_actor_name: 'Reuse Owner',
          reuse_reason: 'Approved fixture reuse',
        });
      }

      const check = new DatabaseSync(databasePath);
      try {
        check.exec('PRAGMA foreign_keys = ON');
        expect(check.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
        expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        validateProductionSchemaVersion(check, 30);
        expect(computeProductionSchemaFingerprint(check)).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        check.close();
      }

      const digestBeforeRestart = canonicalManifest(databasePath);
      const restart = await makeRunner(root).run(databasePath);
      expect(restart).toMatchObject({ status: 'up-to-date', appliedMigrationIds: [] });
      expect(canonicalManifest(databasePath)).toEqual(digestBeforeRestart);
      expect(readHistoryCount(databasePath)).toBe(30);
    });
  }

  it('refuses partial late target structures instead of completing them', async () => {
    for (const scenario of [
      {
        version: 16 as const,
        mutate: (database: DatabaseSync) =>
          database.exec('CREATE TABLE revision_delete_operations (operation_id TEXT PRIMARY KEY)'),
      },
      {
        version: 17 as const,
        mutate: (database: DatabaseSync) =>
          database.exec(
            'ALTER TABLE revision_delete_operations ADD COLUMN reused_by_revision_id TEXT',
          ),
      },
      {
        version: 18 as const,
        mutate: (database: DatabaseSync) =>
          database.exec('ALTER TABLE canonical_revisions ADD COLUMN purpose INTEGER'),
      },
    ]) {
      const root = newTemporaryRoot();
      const databasePath = path.join(root, `partial-v${scenario.version}.sqlite`);
      VersionedMigrationFixtureBuilder.build({
        outputPath: databasePath,
        version: scenario.version,
      });
      const database = new DatabaseSync(databasePath);
      try {
        scenario.mutate(database);
      } finally {
        database.close();
      }
      await expectMigrationError(
        () => makeRunner(root).run(databasePath),
        'MIGRATION_EXECUTION_FAILED',
      );
      expect(readUserVersion(databasePath)).toBe(scenario.version);
      expect(readHistoryCount(databasePath)).toBe(scenario.version);
    }
  });

  it('rejects a partial reuse tuple before v19 can change schema or history', async () => {
    const root = newTemporaryRoot();
    const databasePath = path.join(root, 'partial-reuse-v18.sqlite');
    VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 18 });
    const database = new DatabaseSync(databasePath);
    try {
      database
        .prepare(
          `UPDATE revision_delete_operations
           SET reused_by_revision_id = '20000000-0000-4000-8000-000000000099'
           WHERE operation_id = '90000000-0000-4000-8000-000000000002'`,
        )
        .run();
    } finally {
      database.close();
    }

    await expectMigrationError(
      () => makeRunner(root).run(databasePath),
      'MIGRATION_EXECUTION_FAILED',
    );
    expect(readUserVersion(databasePath)).toBe(18);
    expect(readHistoryCount(databasePath)).toBe(18);
    expect(
      readRows(databasePath, 'PRAGMA table_info(canonical_revisions)').some(
        (column) => column.name === 'purpose' || column.name === 'internal_note',
      ),
    ).toBe(false);
  });

  it('validates an already-current v23 database before the no-op return', async () => {
    const root = newTemporaryRoot();
    const databasePath = path.join(root, 'malformed-current-v19.sqlite');
    VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 18 });
    await makeRunner(root).run(databasePath);
    const database = new DatabaseSync(databasePath);
    try {
      database.exec('DROP INDEX ix_revision_document_snapshots_source');
    } finally {
      database.close();
    }
    const backupFactory = new RecordingBackupFactory();
    const journal = new RecordingJournal();
    await expectMigrationError(
      () => makeRunner(root, { backupFactory, journal }).run(databasePath),
      'POST_MIGRATION_VALIDATION_FAILED',
    );
    expect(backupFactory.createCount).toBe(0);
    expect(journal.createCount).toBe(0);
    expect(readUserVersion(databasePath)).toBe(30);
    expect(readHistoryCount(databasePath)).toBe(30);
  });

  it('rolls back a fault after the v16 rebuild and succeeds on an explicit retry', async () => {
    const root = newTemporaryRoot();
    const databasePath = path.join(root, 'v16-rebuild-fault.sqlite');
    VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 15 });
    const beforeSnapshots = readRows(
      databasePath,
      'SELECT * FROM revision_document_snapshots ORDER BY deliverable_id',
    );
    const v16 = PRODUCTION_MIGRATIONS[15]!;
    const faultedMigrations = PRODUCTION_MIGRATIONS.map((migration) =>
      migration.id === v16.id
        ? {
            ...migration,
            up: (context: Parameters<MigrationDefinition['up']>[0]) => {
              migration.up(context);
              throw new Error('Injected v16 post-rebuild fault.');
            },
          }
        : migration,
    );
    const backupRoot = path.join(root, 'backups');
    const backupFactory: MigrationBackupFactory = {
      create: (input) =>
        new BackupManager({
          sourceDb: input.sourceDb,
          sourceDatabasePath: input.sourceDatabasePath,
          backupRoot,
          pathResolver: new PathResolverService(root),
          clock: { now: () => new Date('2026-08-23T00:00:00.000Z') },
          idGenerator: { generate: () => 'p2c12-v16-fault-backup' },
          appVersion: 'p2c12-fixture',
          verificationPolicy: { requiredTables: [] },
        }),
    };
    await expectMigrationError(
      () => makeRunner(root, { migrations: faultedMigrations, backupFactory }).run(databasePath),
      'MIGRATION_EXECUTION_FAILED',
    );
    const retainedBackupRoot = path.join(backupRoot, 'p2c12-v16-fault-backup');
    const retainedDatabase = path.join(retainedBackupRoot, 'database.sqlite');
    expect(existsSync(retainedDatabase)).toBe(true);
    expect(readUserVersion(retainedDatabase)).toBe(15);
    expect(
      JSON.parse(readFileSync(path.join(retainedBackupRoot, 'metadata.json'), 'utf8')),
    ).toMatchObject({
      status: 'verified',
      schemaVersion: 15,
      migrationId: 'UPGRADE_15_TO_30',
    });
    expect(readUserVersion(databasePath)).toBe(15);
    expect(readHistoryCount(databasePath)).toBe(15);
    expect(
      readRows(databasePath, 'SELECT * FROM revision_document_snapshots ORDER BY deliverable_id'),
    ).toEqual(beforeSnapshots);
    expect(
      readRows(databasePath, 'PRAGMA table_info(revision_document_snapshots)').some(
        (column) => column.name === 'source_asset_version_id',
      ),
    ).toBe(false);

    const retry = await makeRunner(root).run(databasePath);
    expect(retry).toMatchObject({ status: 'migrated', fromVersion: 15, toVersion: 30 });
    expect(readUserVersion(databasePath)).toBe(30);
    expect(readHistoryCount(databasePath)).toBe(30);
  });
});
