import { lstatSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { PRODUCTION_MIGRATIONS } from '../registry/production-migration-registry';

export type VersionedMigrationFixtureVersion = 15 | 16 | 17 | 18 | 19;

export interface VersionedMigrationFixtureOptions {
  readonly outputPath: string;
  readonly version: VersionedMigrationFixtureVersion;
}

export interface VersionedMigrationFixtureResult {
  readonly databasePath: string;
  readonly userVersion: VersionedMigrationFixtureVersion;
  readonly projectIds: readonly [string, string];
  readonly canonicalRevisionIds: readonly [string, string];
  readonly reusedRevisionId: string;
}

const FIXED_AT = '2026-08-20T08:00:00.000Z';
const PROJECT_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
] as const;
const REVISION_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
] as const;
const REUSED_REVISION_ID = '20000000-0000-4000-8000-000000000003';

function cleanup(outputPath: string): void {
  for (const target of [outputPath, `${outputPath}-wal`, `${outputPath}-shm`]) {
    try {
      unlinkSync(target);
    } catch {
      // Best-effort cleanup of only this builder's output.
    }
  }
}

function createHistoryTable(database: DatabaseSync): void {
  database.exec(`CREATE TABLE schema_migrations (
    migration_id TEXT PRIMARY KEY,
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    description TEXT NOT NULL,
    app_version TEXT NOT NULL,
    backup_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
    UNIQUE(from_version),
    UNIQUE(to_version),
    CHECK (duration_ms >= 0)
  )`);
}

function migrateSchema(database: DatabaseSync, version: VersionedMigrationFixtureVersion): void {
  createHistoryTable(database);
  const clock = { now: () => new Date(FIXED_AT) };
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= version)) {
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
      database
        .prepare(
          `INSERT INTO schema_migrations
           (migration_id, from_version, to_version, checksum, description, app_version,
            backup_id, started_at, completed_at, duration_ms, validation_result)
           VALUES (?, ?, ?, ?, ?, 'fixture', 'fixture-backup', ?, ?, 0, 'passed')`,
        )
        .run(
          migration.id,
          migration.fromVersion,
          migration.toVersion,
          migration.checksum,
          migration.description,
          FIXED_AT,
          FIXED_AT,
        );
      database.exec(`PRAGMA user_version = ${migration.toVersion}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

function seedWorkspace(database: DatabaseSync, projectId: string, suffix: string): void {
  database
    .prepare(
      `INSERT INTO project_workspaces
       (project_id, folder_path, folder_profile, services_json, input_mode, created_at, updated_at)
       VALUES (?, ?, 'Default', '["LightingDesign"]', 'Manual', ?, ?)`,
    )
    .run(projectId, `C:\\Fixture\\Project-${suffix}`, FIXED_AT, FIXED_AT);
}

function seedDocument(database: DatabaseSync, projectId: string, suffix: string): string {
  const documentId = `30000000-0000-4000-8000-00000000000${suffix}`;
  database
    .prepare(
      `INSERT INTO project_documents
       (id, project_id, category, document_number, title, revision, status, file_path,
        issued_to, issue_date, notes, created_at, updated_at)
       VALUES (?, ?, 'Datasheet', ?, ?, 'A', 'Current', ?, '', NULL, '', ?, ?)`,
    )
    .run(
      documentId,
      projectId,
      `DOC-${suffix}`,
      `Fixture document ${suffix}`,
      `Documents\\fixture-${suffix}.pdf`,
      FIXED_AT,
      FIXED_AT,
    );
  return documentId;
}

function seedLuminaire(database: DatabaseSync, projectId: string, suffix: string): string {
  const luminaireId = `40000000-0000-4000-8000-00000000000${suffix}`;
  database
    .prepare(
      `INSERT INTO project_luminaires
       (id, project_id, tag, category, image_path, description, manufacturer, model,
        wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver,
        control, emergency, datasheet_path, location, unit, quantity, notes, source_name,
        dimensions, body_color_finish, created_at, updated_at)
       VALUES (?, ?, ?, 'Downlight', '', 'Fixture luminaire', 'SCLI', ?, '10 W', '1000 lm',
               '3000 K', '90', '36 deg', 'IP20', 'Recessed', '', '', 'DALI', 'No', ?,
               'Zone', 'No.', 2, '', 'P2C-12', '', 'White', ?, ?)`,
    )
    .run(
      luminaireId,
      projectId,
      `L${suffix}`,
      `MODEL-${suffix}`,
      `Datasheets\\L${suffix}.pdf`,
      FIXED_AT,
      FIXED_AT,
    );
  return luminaireId;
}

function seedAssetVersions(
  database: DatabaseSync,
  projectId: string,
  luminaireId: string,
  suffix: string,
): { legacyId: string; hashedId: string } {
  const legacyId = `50000000-0000-4000-8000-00000000001${suffix}`;
  const hashedId = `50000000-0000-4000-8000-00000000002${suffix}`;
  const insert = database.prepare(
    `INSERT INTO luminaire_asset_versions
     (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
      mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
      attached_by_name_snapshot)
     VALUES (?, ?, ?, 'Datasheet', ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    legacyId,
    projectId,
    luminaireId,
    1,
    `C:\\Legacy\\L${suffix}.pdf`,
    `L${suffix}.pdf`,
    null,
    null,
    1,
    FIXED_AT,
    null,
    null,
  );
  insert.run(
    hashedId,
    projectId,
    luminaireId,
    2,
    `Datasheets\\L${suffix}-v2.pdf`,
    `L${suffix}-v2.pdf`,
    2048,
    suffix.repeat(64),
    0,
    FIXED_AT,
    `actor-${suffix}`,
    `Owner ${suffix}`,
  );
  return { legacyId, hashedId };
}

function seedRevision(
  database: DatabaseSync,
  projectId: string,
  revisionId: string,
  sequence: number,
): void {
  const snapshot = JSON.stringify({ projectId, fixture: 'P2C-12' });
  database
    .prepare(
      `INSERT INTO canonical_revisions
       (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
        project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
        created_by_name, provenance_classification, legacy_source_id, failure_reason,
        created_at, finalized_at, updated_at)
       VALUES (?, ?, ?, ?, 'FINALIZED', ?, '[]', ?, 'fixture-owner', 'Fixture Owner',
               'CANONICAL', NULL, NULL, ?, ?, ?)`,
    )
    .run(
      revisionId,
      projectId,
      sequence,
      `REV_${String(sequence).padStart(2, '0')}`,
      snapshot,
      String(sequence).repeat(64),
      FIXED_AT,
      FIXED_AT,
      FIXED_AT,
    );
  database
    .prepare(
      `INSERT INTO project_revisions
       (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
        summary, change_log, source_type, source_reference, locked, snapshot_hash,
        reissue_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Issued', NULL, NULL, ?, 'Compatibility summary',
               'Compatibility change log', 'CanonicalRevision', ?, 1, ?, 0, ?, ?)`,
    )
    .run(
      `compat-${revisionId}`,
      projectId,
      sequence,
      `Compatibility REV ${sequence}`,
      FIXED_AT,
      revisionId,
      String(sequence).repeat(64),
      FIXED_AT,
      FIXED_AT,
    );
}

function seedArtifact(
  database: DatabaseSync,
  projectId: string,
  documentId: string,
  suffix: string,
): string {
  const artifactId = `60000000-0000-4000-8000-00000000001${suffix}`;
  const versionId = `60000000-0000-4000-8000-00000000002${suffix}`;
  database
    .prepare(
      `INSERT INTO managed_artifacts
       (artifact_id, project_id, artifact_type, source_tool, canonical_path, status,
        current_working_version, project_document_id, created_at, updated_at)
       VALUES (?, ?, 'ProjectDocument', 'Manual', ?, 'FROZEN', 1, ?, ?, ?)`,
    )
    .run(artifactId, projectId, `Documents/fixture-${suffix}.pdf`, documentId, FIXED_AT, FIXED_AT);
  database
    .prepare(
      `INSERT INTO artifact_versions
       (version_id, artifact_id, version, content_hash, size_bytes, locator_kind,
        locator_value, capture_id, created_at)
       VALUES (?, ?, 1, ?, 1024, 'PROJECT_RELATIVE', ?, NULL, ?)`,
    )
    .run(versionId, artifactId, suffix.repeat(64), `Documents/fixture-${suffix}.pdf`, FIXED_AT);
  return versionId;
}

function seedSnapshot(
  database: DatabaseSync,
  version: VersionedMigrationFixtureVersion,
  input: {
    projectId: string;
    revisionId: string;
    documentId: string;
    assetVersionId: string;
    artifactVersionId: string;
    suffix: string;
  },
): void {
  const common = [
    `70000000-0000-4000-8000-00000000001${input.suffix}`,
    input.projectId,
    input.revisionId,
    'Datasheet',
    `Fixture snapshot ${input.suffix}`,
    `fixture-${input.suffix}.pdf`,
    `Documents/fixture-${input.suffix}.pdf`,
    'PROJECT_RELATIVE',
    `Documents/fixture-${input.suffix}.pdf`,
    input.suffix.repeat(64),
    1024,
    'fixture-owner',
    'Fixture Owner',
    FIXED_AT,
    input.artifactVersionId,
  ] as const;
  if (version === 15) {
    database
      .prepare(
        `INSERT INTO revision_document_snapshots
         (deliverable_id, project_id, revision_id, source_document_id, category, title,
          file_name, source_relative_path, locator_kind, locator_value, content_hash,
          size_bytes, created_by_id, created_by_name, created_at, source_artifact_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(common[0], common[1], common[2], input.documentId, ...common.slice(3));
    return;
  }
  database
    .prepare(
      `INSERT INTO revision_document_snapshots
       (deliverable_id, project_id, revision_id, source_document_id, source_asset_version_id,
        category, title, file_name, source_relative_path, locator_kind, locator_value,
        content_hash, size_bytes, created_by_id, created_by_name, created_at,
        source_artifact_version_id)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(common[0], common[1], common[2], input.documentId, ...common.slice(3));
  database
    .prepare(
      `INSERT INTO revision_document_snapshots
       (deliverable_id, project_id, revision_id, source_document_id, source_asset_version_id,
        category, title, file_name, source_relative_path, locator_kind, locator_value,
        content_hash, size_bytes, created_by_id, created_by_name, created_at,
        source_artifact_version_id)
       VALUES (?, ?, ?, NULL, ?, 'Datasheet', ?, ?, ?, 'PROJECT_RELATIVE', ?, ?, 2048,
               'fixture-owner', 'Fixture Owner', ?, NULL)`,
    )
    .run(
      `70000000-0000-4000-8000-00000000002${input.suffix}`,
      input.projectId,
      input.revisionId,
      input.assetVersionId,
      `Asset snapshot ${input.suffix}`,
      `asset-${input.suffix}.pdf`,
      `Datasheets/asset-${input.suffix}.pdf`,
      `Datasheets/asset-${input.suffix}.pdf`,
      input.suffix.repeat(64),
      FIXED_AT,
    );
}

function seedOutputPackage(
  database: DatabaseSync,
  projectId: string,
  revisionId: string,
  documentSnapshotId: string,
  suffix: string,
): void {
  const outputId = `80000000-0000-4000-8000-00000000001${suffix}`;
  const packageId = `80000000-0000-4000-8000-00000000002${suffix}`;
  const template = database
    .prepare(
      `SELECT template_id, version_id, definition_json, definition_hash
       FROM output_template_versions ORDER BY template_id, version_id LIMIT 1`,
    )
    .get() as {
    template_id: string;
    version_id: string;
    definition_json: string;
    definition_hash: string;
  };
  database
    .prepare(
      `INSERT INTO canonical_outputs
       (output_id, project_id, revision_id, output_family, output_format, locator_kind,
        locator_value, legacy_absolute_path, content_hash, template_id, template_version_id,
        resolved_template_snapshot_json, resolved_template_snapshot_hash, lifecycle_state,
        provenance_classification, legacy_source_id, legacy_source_field, template_provenance,
        failure_reason, created_at, finalized_at, updated_at)
       VALUES (?, ?, ?, 'LuminaireSchedule', 'PDF', 'PROJECT_RELATIVE', ?, NULL, ?, ?, ?, ?, ?,
               'FINALIZED', 'CANONICAL', NULL, NULL, 'RESOLVED', NULL, ?, ?, ?)`,
    )
    .run(
      outputId,
      projectId,
      revisionId,
      `Outputs/schedule-${suffix}.pdf`,
      suffix.repeat(64),
      template.template_id,
      template.version_id,
      template.definition_json,
      template.definition_hash,
      FIXED_AT,
      FIXED_AT,
      FIXED_AT,
    );
  database
    .prepare(
      `INSERT INTO canonical_issue_packages
       (package_id, project_id, revision_id, package_sequence, label, artifact_locator_kind,
        artifact_locator_value, legacy_absolute_path, manifest_locator_kind,
        manifest_locator_value, lifecycle_state, provenance_classification, legacy_source_id,
        failure_reason, created_at, finalized_at, updated_at)
       VALUES (?, ?, ?, 1, ?, 'PROJECT_RELATIVE', ?, NULL, 'PROJECT_RELATIVE', ?,
               'FINALIZED', 'CANONICAL', NULL, NULL, ?, ?, ?)`,
    )
    .run(
      packageId,
      projectId,
      revisionId,
      `Issue package ${suffix}`,
      `Packages/package-${suffix}.zip`,
      `Packages/package-${suffix}.json`,
      FIXED_AT,
      FIXED_AT,
      FIXED_AT,
    );
  database
    .prepare(
      `INSERT INTO canonical_package_outputs
       (package_id, output_id, revision_id, position, provenance_classification, created_at)
       VALUES (?, ?, ?, 0, 'CANONICAL', ?)`,
    )
    .run(packageId, outputId, revisionId, FIXED_AT);
  const member = database.prepare(
    `INSERT INTO revision_package_deliverables
     (package_id, source_type, source_id, revision_id, position,
      provenance_classification, created_at)
     VALUES (?, ?, ?, ?, ?, 'CANONICAL', ?)`,
  );
  member.run(packageId, 'GeneratedOutput', outputId, revisionId, 0, FIXED_AT);
  member.run(packageId, 'DocumentSnapshot', documentSnapshotId, revisionId, 1, FIXED_AT);
}

function seedDeleteOperations(
  database: DatabaseSync,
  version: VersionedMigrationFixtureVersion,
): void {
  if (version < 17) return;
  const insert = database.prepare(
    `INSERT INTO revision_delete_operations
     (operation_id, project_id, revision_id, revision_sequence, revision_label, actor_id,
      actor_name_snapshot, state, failure_reason, artifact_manifest_json,
      document_snapshot_count, datasheet_snapshot_count, generated_output_count, created_at,
      archive_started_at, db_committed_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'fixture-owner', 'Fixture Owner', 'COMPLETED', NULL, ?,
             ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    '90000000-0000-4000-8000-000000000001',
    PROJECT_IDS[0],
    '90000000-0000-4000-8000-000000000011',
    9,
    'REV_09',
    JSON.stringify({ revisionId: '90000000-0000-4000-8000-000000000011', items: [] }),
    1,
    1,
    1,
    FIXED_AT,
    FIXED_AT,
    FIXED_AT,
    FIXED_AT,
    FIXED_AT,
  );
  if (version < 18) return;
  database
    .prepare(
      `UPDATE revision_delete_operations
       SET reused_by_revision_id = ?, reused_at = ?, reused_by_actor_id = 'reuse-owner',
           reused_by_actor_name = 'Reuse Owner', reuse_reason = 'Approved fixture reuse'
       WHERE operation_id = '90000000-0000-4000-8000-000000000001'`,
    )
    .run(REUSED_REVISION_ID, FIXED_AT);
  database
    .prepare(
      `INSERT INTO revision_delete_operations
       (operation_id, project_id, revision_id, revision_sequence, revision_label, actor_id,
        actor_name_snapshot, state, failure_reason, artifact_manifest_json,
        document_snapshot_count, datasheet_snapshot_count, generated_output_count, created_at,
        archive_started_at, db_committed_at, completed_at, updated_at)
       VALUES ('90000000-0000-4000-8000-000000000002', ?,
               '90000000-0000-4000-8000-000000000012', 12, 'REV_12', NULL, NULL,
               'COMPLETED', NULL, '{"items":[]}', 0, 0, 0, ?, ?, ?, ?, ?)`,
    )
    .run(PROJECT_IDS[1], FIXED_AT, FIXED_AT, FIXED_AT, FIXED_AT, FIXED_AT);
}

function seedPopulatedGraph(
  database: DatabaseSync,
  version: VersionedMigrationFixtureVersion,
): void {
  for (const [index, projectId] of PROJECT_IDS.entries()) {
    const suffix = String(index + 1);
    seedWorkspace(database, projectId, suffix);
    const documentId = seedDocument(database, projectId, suffix);
    const luminaireId = seedLuminaire(database, projectId, suffix);
    const assets = seedAssetVersions(database, projectId, luminaireId, suffix);
    seedRevision(database, projectId, REVISION_IDS[index]!, index + 1);
    const artifactVersionId = seedArtifact(database, projectId, documentId, suffix);
    seedSnapshot(database, version, {
      projectId,
      revisionId: REVISION_IDS[index]!,
      documentId,
      assetVersionId: assets.hashedId,
      artifactVersionId,
      suffix,
    });
    seedOutputPackage(
      database,
      projectId,
      REVISION_IDS[index]!,
      `70000000-0000-4000-8000-00000000001${suffix}`,
      suffix,
    );
  }
  if (version >= 18) seedRevision(database, PROJECT_IDS[0], REUSED_REVISION_ID, 9);
  seedDeleteOperations(database, version);
}

export class VersionedMigrationFixtureBuilder {
  public static build(options: VersionedMigrationFixtureOptions): VersionedMigrationFixtureResult {
    try {
      lstatSync(options.outputPath);
      throw new Error('Versioned migration fixture output already exists.');
    } catch (error) {
      if (error instanceof Error && !('code' in error)) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.outputPath);
      database.exec('PRAGMA foreign_keys = ON');
      migrateSchema(database, options.version);
      database.exec('BEGIN IMMEDIATE');
      seedPopulatedGraph(database, options.version);
      database.exec('COMMIT');
      const violations = database.prepare('PRAGMA foreign_key_check').all();
      if (violations.length !== 0) throw new Error('Fixture foreign key verification failed.');
      database.close();
      database = undefined;
      return {
        databasePath: options.outputPath,
        userVersion: options.version,
        projectIds: PROJECT_IDS,
        canonicalRevisionIds: REVISION_IDS,
        reusedRevisionId: REUSED_REVISION_ID,
      };
    } catch (error) {
      try {
        database?.exec('ROLLBACK');
      } catch {
        // No transaction may be active.
      }
      try {
        database?.close();
      } catch {
        // Best-effort close before cleanup.
      }
      cleanup(options.outputPath);
      throw error;
    }
  }
}
