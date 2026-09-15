/**
 * Deterministic populated fixture for the exact current self-managed unversioned UAT shape.
 *
 * The frozen v3.2.2 builder supplies the source-proven 24-table baseline. This builder then
 * applies every current production compatibility column in the same order as the historical
 * LEGACY_SELF_MANAGED stores and adds representative synthetic user data. It never reads a local
 * product database and refuses to overwrite an existing path through the frozen builder.
 */

import { unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  seedActivities,
  seedProjects,
  seedSettings,
  seedUserIds,
  seedUsers,
} from '@scli/test-data';

import { LegacyDetector } from '../legacy/LegacyDetector';
import {
  PRODUCTION_COMPATIBILITY_COLUMNS,
  PRODUCTION_INDEX_NAMES,
  PRODUCTION_TABLE_NAMES,
} from '../registry/production-migration-registry';
import { LegacyV322FixtureBuilder } from './LegacyV322FixtureBuilder';
import { CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT } from './current-self-managed-unversioned-schema';

const FIXED_TIMESTAMP = '2026-08-01T08:00:00.000Z';
const FIRST_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000002';

export interface CurrentSelfManagedUnversionedFixtureOptions {
  readonly outputPath: string;
}

export interface CurrentSelfManagedUnversionedFixtureResult {
  readonly databasePath: string;
  readonly userVersion: 0;
  readonly hasMigrationHistory: false;
  readonly tableNames: readonly string[];
  readonly ownedIndexNames: readonly string[];
  readonly structuralSchemaFingerprint: string;
  readonly projectIds: readonly string[];
}

export class CurrentSelfManagedUnversionedFixtureBuilderError extends Error {
  public readonly code: 'BUILD_FAILED' | 'VERIFICATION_FAILED';

  public constructor(
    code: 'BUILD_FAILED' | 'VERIFICATION_FAILED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CurrentSelfManagedUnversionedFixtureBuilderError';
    this.code = code;
  }
}

function cleanupCreatedFixture(outputPath: string): void {
  for (const target of [outputPath, outputPath + '-wal', outputPath + '-shm']) {
    try {
      unlinkSync(target);
    } catch {
      // Best-effort cleanup of only the path created by this builder.
    }
  }
}

function applyCompatibilityColumns(database: DatabaseSync): void {
  for (const operation of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (operation.alreadyInBaseCreate) continue;
    const columns = database.prepare(`PRAGMA table_info(${operation.table})`).all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === operation.column)) {
      throw new CurrentSelfManagedUnversionedFixtureBuilderError(
        'BUILD_FAILED',
        `Compatibility column already exists: ${operation.table}.${operation.column}.`,
      );
    }
    database.exec(
      `ALTER TABLE ${operation.table} ADD COLUMN ${operation.column} ${operation.definition}`,
    );
  }
}

function buildAppState(): string {
  const projects = structuredClone(seedProjects.slice(0, 2));
  const first = projects[0]!;
  const second = projects[1]!;

  Object.assign(first, {
    projectCode: '019_SCLI251204_GEVI_SHARJAH',
    crmReference: 'CRM-UAT-LEGACY-019',
    actualHours: 17.5,
    projectFolderUrl: null,
    projectFolderPath: 'C:\\UAT Fixture\\019_SCLI251204_GEVI_SHARJAH',
    folderProfile: 'UAT Current Profile',
    services: ['LightingDesign', 'LuminaireSchedule', 'TechnicalBoq'],
    luminaireInputMode: 'Manual',
  });
  Object.assign(second, {
    projectCode: '020_SCT260801_CURRENT_SCHEMA',
    crmReference: 'CRM-UAT-CURRENT-020',
    actualHours: 9,
    projectFolderUrl: null,
    projectFolderPath: 'C:\\UAT Fixture\\020_SCT260801_CURRENT_SCHEMA',
    folderProfile: 'UAT Current Profile',
    services: ['LuxCalculations', 'LuminaireSchedule'],
    luminaireInputMode: 'Excel',
  });

  const projectIds = new Set(projects.map((project) => project.id));
  const activities = seedActivities.filter((activity) => projectIds.has(activity.projectId));
  return JSON.stringify({
    users: structuredClone(seedUsers),
    projects,
    activities: structuredClone(activities),
    comments: [],
    notifications: [],
    settings: structuredClone(seedSettings),
    lastSequence: 42,
  });
}

function insertRepresentativeCurrentData(database: DatabaseSync): void {
  database
    .prepare("UPDATE app_state SET json_value = ?, updated_at = ? WHERE state_key = 'primary'")
    .run(buildAppState(), FIXED_TIMESTAMP);

  database
    .prepare(
      `INSERT OR IGNORE INTO local_accounts
       (user_id, email, salt, password_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      seedUserIds.admin,
      'uat.fixture.admin@example.test',
      'uat-fixture-salt',
      'uat-fixture-password-hash',
      FIXED_TIMESTAMP,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys
       (idempotency_key, project_id, created_at) VALUES (?, ?, ?)`,
    )
    .run('uat-fixture-create-001', FIRST_PROJECT_ID, FIXED_TIMESTAMP);

  database
    .prepare(
      `UPDATE personal_settings SET
         project_root = ?, default_folder_profile = ?, default_input_mode = ?,
         auto_open_project_folder = 1, updated_at = ?, designer_name = ?, company_name = ?,
         company_logo_path = ?, accent_color = ?, time_zone = ?, backup_retention = ?
       WHERE id = 1`,
    )
    .run(
      'C:\\UAT Fixture',
      'UAT Current Profile',
      'Manual',
      FIXED_TIMESTAMP,
      'UAT Designer',
      'SCIENTECHNIC',
      'C:\\UAT Fixture\\logo.png',
      '#008C95',
      'Asia/Dubai',
      20,
    );

  const workspaceInsert = database.prepare(
    `INSERT INTO project_workspaces
       (project_id, folder_path, folder_profile, services_json, input_mode, created_at, updated_at,
        folders_json, output_folders_json, pdf_paper_size)
     VALUES (?, ?, 'UAT Current Profile', ?, ?, ?, ?, ?, ?, 'A3')`,
  );
  workspaceInsert.run(
    FIRST_PROJECT_ID,
    'C:\\UAT Fixture\\019_SCLI251204_GEVI_SHARJAH',
    '["LightingDesign","LuminaireSchedule","TechnicalBoq"]',
    'Manual',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    '[{"name":"01_INPUT","children":[]}]',
    '{"scheduleExcel":"04_SCHEDULE","boqExcel":"05_BOQ"}',
  );
  workspaceInsert.run(
    SECOND_PROJECT_ID,
    'C:\\UAT Fixture\\020_SCT260801_CURRENT_SCHEMA',
    '["LuxCalculations","LuminaireSchedule"]',
    'Excel',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    '[{"name":"01_INPUT","children":[{"name":"Drawings"}]}]',
    '{"scheduleExcel":"04_SCHEDULE"}',
  );

  database
    .prepare(
      `INSERT INTO project_luminaires
       (id, project_id, tag, category, image_path, description, manufacturer, model, wattage,
        lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
        emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
        body_color_finish, created_at, updated_at)
       VALUES (?, ?, 'L-UAT-01', 'Downlight', '', 'UAT retained luminaire', 'Fixture Maker',
               'FM-100', '12W', '1100lm', '3000K', '90', '36deg', 'IP44', 'Recessed',
               '100mm', 'Remote', 'DALI', 'No', 'C:\\UAT Fixture\\datasheet.pdf', 'Lobby',
               'pcs', 8, 'Preserve exactly', 'Manual', '100x100x90mm', 'White', ?, ?)`,
    )
    .run(
      '91000000-0000-4000-8000-000000000001',
      FIRST_PROJECT_ID,
      FIXED_TIMESTAMP,
      FIXED_TIMESTAMP,
    );

  database
    .prepare(
      `INSERT INTO project_output_columns
       (project_id, output_type, field_key, header, visible, sort_order, width,
        compare_in_revision, required_for_issue, internal_only)
       VALUES (?, 'schedule', 'tag', 'Luminaire Tag', 1, 1, 175, 1, 1, 0)`,
    )
    .run(FIRST_PROJECT_ID);

  database
    .prepare(
      `INSERT INTO project_exports
       (id, project_id, revision, excel_path, pdf_path, datasheet_folder, created_at,
        schedule_excel_path, schedule_pdf_path, boq_excel_path, boq_pdf_path)
       VALUES (?, ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      '92000000-0000-4000-8000-000000000001',
      FIRST_PROJECT_ID,
      'C:\\UAT Fixture\\legacy-export.xlsx',
      'C:\\UAT Fixture\\legacy-export.pdf',
      'C:\\UAT Fixture\\datasheets',
      FIXED_TIMESTAMP,
      'C:\\UAT Fixture\\schedule-r3.xlsx',
      'C:\\UAT Fixture\\schedule-r3.pdf',
      'C:\\UAT Fixture\\boq-r3.xlsx',
      'C:\\UAT Fixture\\boq-r3.pdf',
    );

  database
    .prepare(
      `INSERT INTO custom_folder_profiles
       (name, description, folders_json, output_folders_json, created_at, updated_at)
       VALUES ('UAT Current Profile', 'Source-equivalent current profile', ?, ?, ?, ?)`,
    )
    .run(
      '[{"name":"01_INPUT","children":[{"name":"Drawings"}]}]',
      '{"scheduleExcel":"04_SCHEDULE","boqExcel":"05_BOQ"}',
      FIXED_TIMESTAMP,
      FIXED_TIMESTAMP,
    );

  database
    .prepare(
      `INSERT INTO revision_packages
       (id, project_id, revision_number, reissue_number, label, status, output_mode, folder_path,
        zip_path, item_count, total_bytes, package_hash, warning_override_reason, manifest_json,
        created_at, luminaire_snapshot_json)
       VALUES (?, ?, 3, 1, 'Revision 3 Reissue 1', 'Issued', 'Full', ?, ?, 2, 4096,
               'uat-package-hash', '', '{"items":["schedule","boq"]}', ?, ?)`,
    )
    .run(
      '93000000-0000-4000-8000-000000000001',
      FIRST_PROJECT_ID,
      'C:\\UAT Fixture\\packages\\R03-01',
      'C:\\UAT Fixture\\packages\\R03-01.zip',
      FIXED_TIMESTAMP,
      '[{"tag":"L-UAT-01","quantity":8}]',
    );

  database
    .prepare(
      `INSERT INTO project_revisions
       (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
        summary, change_log, source_type, source_reference, locked, snapshot_hash,
        reissue_number, created_at, updated_at)
       VALUES (?, ?, 3, 'Retained current revision', 'Issued', ?, ?, ?,
               'Existing revision summary', 'Existing change log', 'Client', 'CRM-UAT-LEGACY-019',
               1, 'uat-revision-snapshot', 1, ?, ?)`,
    )
    .run(
      '94000000-0000-4000-8000-000000000001',
      FIRST_PROJECT_ID,
      FIXED_TIMESTAMP,
      '2026-08-08',
      FIXED_TIMESTAMP,
      FIXED_TIMESTAMP,
      FIXED_TIMESTAMP,
    );

  database
    .prepare(
      `INSERT INTO workspace_activity
       (id, project_id, entity_type, entity_id, action, title, detail, created_at)
       VALUES (?, ?, 'Project', ?, 'Imported', 'Existing activity',
               'Genuine pre-migration activity retained by the fixture', ?)`,
    )
    .run(
      '95000000-0000-4000-8000-000000000001',
      FIRST_PROJECT_ID,
      FIRST_PROJECT_ID,
      FIXED_TIMESTAMP,
    );
}

function verifyCurrentShape(databasePath: string): void {
  const result = new LegacyDetector().inspect(databasePath);
  if (
    result.status !== 'CURRENT_SELF_MANAGED_UNVERSIONED' ||
    result.safeReasonCode !== 'EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA' ||
    result.observedStructuralFingerprint !== CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT
  ) {
    throw new CurrentSelfManagedUnversionedFixtureBuilderError(
      'VERIFICATION_FAILED',
      'Built fixture does not match the exact current self-managed unversioned identity.',
    );
  }
}

export class CurrentSelfManagedUnversionedFixtureBuilder {
  private constructor() {
    // Static-only class.
  }

  public static build(
    options: CurrentSelfManagedUnversionedFixtureOptions,
  ): CurrentSelfManagedUnversionedFixtureResult {
    LegacyV322FixtureBuilder.build({
      outputPath: options.outputPath,
      profile: 'REPRESENTATIVE_POPULATED',
    });

    const database = new DatabaseSync(options.outputPath);
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec('BEGIN IMMEDIATE');
      try {
        applyCompatibilityColumns(database);
        insertRepresentativeCurrentData(database);
        database.exec('COMMIT');
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // Preserve the original build error.
        }
        throw error;
      }
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      database.close();

      verifyCurrentShape(options.outputPath);
      return Object.freeze({
        databasePath: options.outputPath,
        userVersion: 0 as const,
        hasMigrationHistory: false as const,
        tableNames: PRODUCTION_TABLE_NAMES,
        ownedIndexNames: PRODUCTION_INDEX_NAMES,
        structuralSchemaFingerprint: CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT,
        projectIds: Object.freeze([FIRST_PROJECT_ID, SECOND_PROJECT_ID]),
      });
    } catch (error) {
      try {
        if (database.isOpen) database.close();
      } catch {
        // Best-effort close before cleaning the builder-owned output.
      }
      cleanupCreatedFixture(options.outputPath);
      if (error instanceof CurrentSelfManagedUnversionedFixtureBuilderError) throw error;
      throw new CurrentSelfManagedUnversionedFixtureBuilderError(
        'BUILD_FAILED',
        'Current self-managed fixture build failed.',
        { cause: error },
      );
    }
  }
}
