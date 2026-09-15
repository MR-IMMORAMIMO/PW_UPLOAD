/**
 * LegacyV322FixtureBuilder � deterministic programmatic fixture builder for the locked v3.2.2 schema.
 *
 * Creates a file-backed SQLite database matching the exact historical v3.2.2 schema identity,
 * with deterministic synthetic data selected by profile. No production constructors, databases,
 * or credentials are accessed.
 *
 * P1.6A-E � Implement Deterministic Legacy v3.2.2 Fixture Builder
 */

import { createHash } from 'node:crypto';
import { lstatSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { win32 as winPath } from 'node:path';

import {
  HISTORICAL_SOURCE_COMMIT,
  TABLE_NAMES,
  INDEX_NAMES,
  SCHEMA_STATEMENTS,
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  computeStructuralFingerprint,
  computeCanonicalDdlFingerprint,
  type LegacyV322FixtureProfile,
} from './legacy-v322-schema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { LegacyV322FixtureProfile };

export interface LegacyV322FixtureOptions {
  readonly outputPath: string;
  readonly profile: LegacyV322FixtureProfile;
}

export interface LegacyV322FixtureResult {
  readonly databasePath: string;
  readonly profile: LegacyV322FixtureProfile;
  readonly applicationVersion: '3.2.2';
  readonly historicalSourceCommit: string;
  readonly userVersion: 0;
  readonly hasMigrationHistory: false;
  readonly tableNames: readonly string[];
  readonly ownedIndexNames: readonly string[];
  readonly structuralSchemaFingerprint: string;
  readonly canonicalDdlFingerprint: string;
  readonly logicalDataFingerprint: string;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class LegacyV322FixtureBuilderError extends Error {
  public readonly code: string;
  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LegacyV322FixtureBuilderError';
    this.code = code;
  }
}
// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

interface PathInfo {
  exists: boolean;
  symlink: boolean;
  directory: boolean;
  file: boolean;
}

function inspectPath(target: string): PathInfo {
  try {
    const stats = lstatSync(target);
    return {
      exists: true,
      symlink: stats.isSymbolicLink(),
      directory: stats.isDirectory(),
      file: stats.isFile(),
    };
  } catch {
    return { exists: false, symlink: false, directory: false, file: false };
  }
}

function validateOutputPath(outputPath: string): void {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new LegacyV322FixtureBuilderError(
      'INVALID_OUTPUT_PATH',
      'outputPath must be a non-empty string.',
    );
  }

  if (!winPath.isAbsolute(outputPath)) {
    throw new LegacyV322FixtureBuilderError(
      'RELATIVE_OUTPUT_PATH',
      'outputPath must be an absolute path.',
    );
  }

  if (outputPath.includes('\0')) {
    throw new LegacyV322FixtureBuilderError(
      'INVALID_OUTPUT_PATH',
      'outputPath must not contain NUL characters.',
    );
  }

  const pathInfo = inspectPath(outputPath);

  if (pathInfo.exists) {
    if (pathInfo.symlink) {
      throw new LegacyV322FixtureBuilderError(
        'OUTPUT_IS_SYMLINK',
        'outputPath must not be a symlink or junction.',
      );
    }
    if (pathInfo.directory) {
      throw new LegacyV322FixtureBuilderError(
        'OUTPUT_IS_DIRECTORY',
        'outputPath must be a file path, not an existing directory.',
      );
    }
    if (pathInfo.file) {
      throw new LegacyV322FixtureBuilderError(
        'OUTPUT_ALREADY_EXISTS',
        'outputPath must not already exist. No overwrite is allowed.',
      );
    }
  }

  const parentDir = winPath.dirname(outputPath);
  const parentInfo = inspectPath(parentDir);

  if (!parentInfo.exists) {
    throw new LegacyV322FixtureBuilderError(
      'MISSING_PARENT_DIRECTORY',
      'The parent directory of outputPath does not exist.',
    );
  }

  if (parentInfo.symlink) {
    throw new LegacyV322FixtureBuilderError(
      'PARENT_IS_SYMLINK',
      'The parent directory of outputPath must not be a symlink.',
    );
  }

  if (!parentInfo.directory) {
    throw new LegacyV322FixtureBuilderError(
      'PARENT_NOT_DIRECTORY',
      'The parent of outputPath must be a directory.',
    );
  }
}
// ---------------------------------------------------------------------------
// Synthetic data helpers
// ---------------------------------------------------------------------------

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function fixedUuid(index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return '00000000-0000-4000-8000-' + hex.padEnd(12, '0');
}

// ---------------------------------------------------------------------------
// Logical data fingerprint
// ---------------------------------------------------------------------------

function computeLogicalDataFingerprint(
  db: DatabaseSync,
  profile: LegacyV322FixtureProfile,
): string {
  const hash = createHash('sha256');

  let tablesToInclude: readonly string[];
  if (profile === 'PARTIAL_STANDALONE_ONLY') {
    tablesToInclude = ['app_state', 'local_accounts', 'idempotency_keys'];
  } else {
    tablesToInclude = TABLE_NAMES;
  }

  for (const tableName of tablesToInclude) {
    const pkInfo = db.prepare("PRAGMA table_info('" + tableName + "')").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pkColumns = pkInfo
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);

    const allColumns = pkInfo.map((c) => c.name);

    let orderClause: string;
    if (pkColumns.length > 0) {
      orderClause = pkColumns.join(', ');
    } else if (allColumns.length > 0) {
      orderClause = allColumns[0]!;
    } else {
      continue;
    }

    const rows = db
      .prepare('SELECT * FROM "' + tableName + '" ORDER BY ' + orderClause)
      .all() as Record<string, unknown>[];

    hash.update('TABLE:' + tableName + '\n');

    for (const row of rows) {
      const ordered: Record<string, unknown> = {};
      for (const col of allColumns) {
        ordered[col] = row[col];
      }
      hash.update(JSON.stringify(ordered) + '\n');
    }
  }

  return hash.digest('hex');
}
// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

function insertSchemaOnlyRows(): void {
  // No rows inserted for SCHEMA_ONLY
}

function insertRuntimeMinimalRows(db: DatabaseSync): void {
  // 1. personal_settings id=1
  db.prepare(
    'INSERT OR IGNORE INTO personal_settings (id, project_root, default_folder_profile, default_input_mode, auto_open_project_folder, updated_at) VALUES (1, ?, ?, ?, 1, ?)',
  ).run('C:\\Synthetic\\Projects', 'Full Lighting Design', 'Manual', FIXED_TIMESTAMP);

  // 2. microsoft_connection id=1
  db.prepare(
    'INSERT OR IGNORE INTO microsoft_connection (id, tenant_id, client_id, connected, account_name, account_email, mail_sync_enabled, calendar_sync_enabled, sync_interval_minutes, token_blob, updated_at) VALUES (1, ?, ?, 0, ?, ?, 0, 0, 30, ?, ?)',
  ).run(
    'syn-tenant-0000-0000-0000-000000000000',
    'syn-client-0000-0000-0000-000000000000',
    'Synthetic Admin',
    'synthetic.admin@example.test',
    '{"synthetic":true}',
    FIXED_TIMESTAMP,
  );

  // 3. app_state state_key='primary'
  const appStateJson = JSON.stringify({
    users: [
      {
        id: fixedUuid(1),
        email: 'synthetic.admin@example.test',
        displayName: 'Synthetic Admin',
        role: 'Admin',
        isActive: true,
      },
    ],
    projects: [],
    activities: [],
    comments: [],
    notifications: [],
    settings: {
      companyTimezone: 'Asia/Dubai',
      projectTypes: [],
    },
    lastSequence: 0,
  });
  db.prepare(
    'INSERT OR IGNORE INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)',
  ).run('primary', appStateJson, FIXED_TIMESTAMP);

  // 4. local_accounts bootstrap account
  db.prepare(
    'INSERT OR IGNORE INTO local_accounts (user_id, email, salt, password_hash, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    fixedUuid(1),
    'synthetic.admin@example.test',
    'syn-salt-00000000000000000000000000000000',
    'syn-hash-00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    FIXED_TIMESTAMP,
  );
}
function insertRepresentativePopulatedRows(db: DatabaseSync): void {
  // Start with RUNTIME_MINIMAL rows
  insertRuntimeMinimalRows(db);

  // project_workspaces
  db.prepare(
    'INSERT OR IGNORE INTO project_workspaces (project_id, folder_path, folder_profile, services_json, input_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'syn-project-0001',
    'C:\\Synthetic\\Workspace\\ProjectA',
    'Full Lighting Design',
    '["LuminaireSchedule","TechnicalBoq","Datasheets"]',
    'Manual',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_deliverables
  db.prepare(
    'INSERT OR IGNORE INTO project_deliverables (id, project_id, service_code, title, status, progress_percent, required, due_date, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, 50, 1, ?, 1, ?)',
  ).run(
    'syn-deliverable-0001',
    'syn-project-0001',
    'LuminaireSchedule',
    'Luminaire Schedule',
    'InProgress',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_luminaires
  db.prepare(
    'INSERT OR IGNORE INTO project_luminaires (id, project_id, tag, category, image_path, description, manufacturer, model, wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control, emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions, body_color_finish, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 12.0, ?, ?, ?, ?, ?, ?)',
  ).run(
    'syn-luminaire-0001',
    'syn-project-0001',
    'L01',
    'LED Downlight',
    'C:\\Synthetic\\Images\\downlight.png',
    'Synthetic LED Downlight',
    'Synthetic Manufacturer',
    'SM-DL-100',
    '15W',
    '1200lm',
    '3000K',
    '90',
    '60�',
    'IP20',
    'Recessed',
    '�150mm',
    'LED Driver',
    'DALI',
    'No',
    'C:\\Synthetic\\Datasheets\\downlight.pdf',
    'Office',
    'pcs',
    'Synthetic fixture data only',
    'Architectural',
    '150x150x100mm',
    'White',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_output_columns
  db.prepare(
    'INSERT OR IGNORE INTO project_output_columns (project_id, output_type, field_key, header, visible, sort_order) VALUES (?, ?, ?, ?, 1, 1)',
  ).run('syn-project-0001', 'schedule', 'tag', 'Tag');

  // project_exports
  db.prepare(
    'INSERT OR IGNORE INTO project_exports (id, project_id, revision, excel_path, pdf_path, datasheet_folder, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
  ).run(
    'syn-export-0001',
    'syn-project-0001',
    'C:\\Synthetic\\Exports\\schedule.xlsx',
    'C:\\Synthetic\\Exports\\schedule.pdf',
    'C:\\Synthetic\\Exports\\Datasheets',
    FIXED_TIMESTAMP,
  );

  // custom_folder_profiles
  db.prepare(
    'INSERT OR IGNORE INTO custom_folder_profiles (name, description, folders_json, output_folders_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'Synthetic Profile',
    'Synthetic fixture data only',
    '[{"name":"01_INPUT","children":[]}]',
    '{"scheduleExcel":"04_SCHEDULE","datasheets":"06_DATASHEETS"}',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // revision_packages
  db.prepare(
    'INSERT OR IGNORE INTO revision_packages (id, project_id, revision_number, reissue_number, label, status, output_mode, folder_path, zip_path, item_count, total_bytes, package_hash, warning_override_reason, manifest_json, created_at) VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, 5, 1024000, ?, ?, ?, ?)',
  ).run(
    'syn-revision-pkg-0001',
    'syn-project-0001',
    'Revision 1',
    'Draft',
    'Full',
    'C:\\Synthetic\\Packages\\R01',
    'C:\\Synthetic\\Packages\\R01.zip',
    'syn-pkg-hash-0001',
    '',
    '{"items":[]}',
    FIXED_TIMESTAMP,
  );

  // project_file_index
  db.prepare(
    'INSERT OR IGNORE INTO project_file_index (id, project_id, category, file_name, relative_path, file_path, extension, size_bytes, modified_at, availability, confidence, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 204800, ?, ?, 100, ?)',
  ).run(
    'syn-file-0001',
    'syn-project-0001',
    'Drawings',
    'synthetic-drawing.pdf',
    'Drawings\\synthetic-drawing.pdf',
    'C:\\Synthetic\\Workspace\\ProjectA\\Drawings\\synthetic-drawing.pdf',
    '.pdf',
    FIXED_TIMESTAMP,
    'Available',
    FIXED_TIMESTAMP,
  );

  // project_file_index_runs
  db.prepare(
    'INSERT OR IGNORE INTO project_file_index_runs (project_id, folder_path, indexed_at, file_count, total_bytes, one_drive_managed, truncated) VALUES (?, ?, ?, 10, 5242880, 0, 0)',
  ).run('syn-project-0001', 'C:\\Synthetic\\Workspace\\ProjectA', FIXED_TIMESTAMP);

  // project_requirements
  db.prepare(
    'INSERT OR IGNORE INTO project_requirements (id, project_id, category, title, details, requested_from, requested_at, due_date, status, impact, source_type, source_reference, notes, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(
    'syn-req-0001',
    'syn-project-0001',
    'Lighting',
    'Office Lighting Design',
    'Design office lighting to 500 lux',
    'Client',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    'Open',
    'Medium',
    'ClientBrief',
    'BRF-001',
    'Synthetic fixture data only',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_checklist_items
  db.prepare(
    'INSERT OR IGNORE INTO project_checklist_items (id, project_id, category, title, service_code, required, completed, waived, waiver_reason, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, 0, 0, ?, 1, ?, ?)',
  ).run(
    'syn-checklist-0001',
    'syn-project-0001',
    'Pre-Issue QA',
    'All client and consultant comments are resolved',
    '',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_actions
  db.prepare(
    'INSERT OR IGNORE INTO project_actions (id, project_id, title, details, owner, due_date, status, priority, source_type, source_id, revision_id, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)',
  ).run(
    'syn-action-0001',
    'syn-project-0001',
    'Review luminaire schedule',
    'Review and approve the luminaire schedule',
    'Synthetic Admin',
    FIXED_TIMESTAMP,
    'Open',
    'High',
    'Internal',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_meetings
  db.prepare(
    'INSERT OR IGNORE INTO project_meetings (id, project_id, title, start_at, end_at, location, attendees_json, agenda, notes, decisions, online_meeting_url, external_event_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(
    'syn-meeting-0001',
    'syn-project-0001',
    'Kickoff Meeting',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    'Virtual',
    '["synthetic.admin@example.test"]',
    'Project kickoff and scope review',
    'Synthetic fixture data only',
    'Proceed with design',
    'https://example.test/meet/synthetic',
    'Scheduled',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_review_items
  db.prepare(
    'INSERT OR IGNORE INTO project_review_items (id, project_id, reference, title, description, area, luminaire_tag, drawing_reference, source_type, source_id, status, response, revision_id, received_at, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)',
  ).run(
    'syn-review-0001',
    'syn-project-0001',
    'RFI-001',
    'Confirm ceiling height',
    'Please confirm the ceiling height in the office area',
    'Lighting',
    'L01',
    'A-101',
    'Client',
    'Open',
    '',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_revisions
  db.prepare(
    'INSERT OR IGNORE INTO project_revisions (id, project_id, revision_number, title, status, received_at, due_date, issued_at, summary, change_log, source_type, source_reference, locked, snapshot_hash, reissue_number, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, 0, ?, ?)',
  ).run(
    'syn-revision-0001',
    'syn-project-0001',
    'Preliminary Design',
    'InProgress',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
    'Initial design submission',
    'Initial issue',
    'Internal',
    'INT-001',
    '',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_documents
  db.prepare(
    'INSERT OR IGNORE INTO project_documents (id, project_id, category, document_number, title, revision, status, file_path, issued_to, issue_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'syn-doc-0001',
    'syn-project-0001',
    'Drawing',
    'SCLI-PROJ-DWG-001',
    'Lighting Layout',
    'A',
    'Draft',
    'C:\\Synthetic\\Documents\\dwg-001.pdf',
    'Client',
    FIXED_TIMESTAMP,
    'Synthetic fixture data only',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_contacts
  db.prepare(
    'INSERT OR IGNORE INTO project_contacts (id, project_id, name, email, company, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'syn-contact-0001',
    'syn-project-0001',
    'Synthetic Contact',
    'synthetic.contact@example.test',
    'Synthetic Company Ltd',
    'Consultant',
    FIXED_TIMESTAMP,
    FIXED_TIMESTAMP,
  );

  // project_communications
  db.prepare(
    'INSERT OR IGNORE INTO project_communications (id, project_id, external_id, kind, conversation_id, subject, sender, participants_json, occurred_at, end_at, preview, web_link, has_attachments, manually_linked, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, ?)',
  ).run(
    'syn-comm-0001',
    'syn-project-0001',
    'syn-ext-001',
    'Email',
    'syn-conv-001',
    'Project Kickoff',
    'synthetic.admin@example.test',
    '["synthetic.contact@example.test"]',
    FIXED_TIMESTAMP,
    'Synthetic fixture data only',
    'https://example.test/mail/synthetic',
    FIXED_TIMESTAMP,
  );

  // workspace_activity
  db.prepare(
    'INSERT OR IGNORE INTO workspace_activity (id, project_id, entity_type, entity_id, action, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'syn-activity-0001',
    'syn-project-0001',
    'Project',
    'syn-project-0001',
    'Created',
    'Project created',
    'Synthetic project created for testing',
    FIXED_TIMESTAMP,
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class LegacyV322FixtureBuilder {
  private constructor() {
    // Static-only class
  }

  public static build(options: LegacyV322FixtureOptions): LegacyV322FixtureResult {
    validateOutputPath(options.outputPath);

    const db = new DatabaseSync(options.outputPath);
    // The constructor creates the output file, so any failure from this point on
    // must remove only the builder-created output and its WAL companions.
    const partialCreated = true;

    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec('PRAGMA user_version = 0;');

      if (options.profile === 'PARTIAL_STANDALONE_ONLY') {
        const standaloneStatements = SCHEMA_STATEMENTS.filter(
          (s) => s.owner === 'StandaloneDataProvider',
        );
        for (const stmt of standaloneStatements) {
          db.exec(stmt.sql);
        }
      } else {
        for (const ddl of CANONICAL_FRESH_DDL) {
          db.exec(ddl);
        }
      }

      switch (options.profile) {
        case 'SCHEMA_ONLY':
          insertSchemaOnlyRows();
          break;
        case 'RUNTIME_MINIMAL':
          insertRuntimeMinimalRows(db);
          break;
        case 'REPRESENTATIVE_POPULATED':
          insertRepresentativePopulatedRows(db);
          break;
        case 'PARTIAL_STANDALONE_ONLY':
          // The original profile contract authorizes zero rows for the
          // standalone-only partial schema.
          break;
        default:
          throw new LegacyV322FixtureBuilderError(
            'UNSUPPORTED_PROFILE',
            'Unsupported profile: ' + (options.profile as string),
          );
      }

      // Verify user_version
      const uvRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (uvRow.user_version !== 0) {
        throw new LegacyV322FixtureBuilderError(
          'VERIFICATION_FAILED',
          'user_version is not 0 after build.',
        );
      }

      // Verify schema_migrations absent
      const smRow = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get() as { name: string } | undefined;
      if (smRow) {
        throw new LegacyV322FixtureBuilderError(
          'VERIFICATION_FAILED',
          'schema_migrations table exists in built fixture.',
        );
      }

      // Verify expected tables
      if (options.profile === 'PARTIAL_STANDALONE_ONLY') {
        const actualTables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[];
        const actualNames = actualTables.map((r) => r.name);
        const expectedStandalone = ['app_state', 'local_accounts', 'idempotency_keys'];
        for (const name of expectedStandalone) {
          if (!actualNames.includes(name)) {
            throw new LegacyV322FixtureBuilderError(
              'VERIFICATION_FAILED',
              'Expected table ' + name + ' not found in partial build.',
            );
          }
        }
        if (actualNames.length !== 3) {
          throw new LegacyV322FixtureBuilderError(
            'VERIFICATION_FAILED',
            'Expected exactly 3 tables for PARTIAL_STANDALONE_ONLY, got ' +
              actualNames.length +
              '.',
          );
        }
      } else {
        const actualTables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[];
        const actualNames = actualTables.map((r) => r.name);
        for (const name of TABLE_NAMES) {
          if (!actualNames.includes(name)) {
            throw new LegacyV322FixtureBuilderError(
              'VERIFICATION_FAILED',
              'Expected table ' + name + ' not found.',
            );
          }
        }
        if (actualNames.length !== 24) {
          throw new LegacyV322FixtureBuilderError(
            'VERIFICATION_FAILED',
            'Expected exactly 24 tables, got ' + actualNames.length + '.',
          );
        }
      }

      // Verify expected indexes (full profiles only)
      if (options.profile !== 'PARTIAL_STANDALONE_ONLY') {
        const actualIndexes = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[];
        const actualIndexNames = actualIndexes.map((r) => r.name);
        for (const name of INDEX_NAMES) {
          if (!actualIndexNames.includes(name)) {
            throw new LegacyV322FixtureBuilderError(
              'VERIFICATION_FAILED',
              'Expected index ' + name + ' not found.',
            );
          }
        }
      }

      // Compute fingerprints
      const structuralFp = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);
      const canonicalDdlFp = computeCanonicalDdlFingerprint(CANONICAL_FRESH_DDL);
      const logicalFp = computeLogicalDataFingerprint(db, options.profile);

      db.close();

      const result: LegacyV322FixtureResult = Object.freeze({
        databasePath: options.outputPath,
        profile: options.profile,
        applicationVersion: '3.2.2',
        historicalSourceCommit: HISTORICAL_SOURCE_COMMIT,
        userVersion: 0 as const,
        hasMigrationHistory: false as const,
        tableNames: Object.freeze(
          options.profile === 'PARTIAL_STANDALONE_ONLY'
            ? Object.freeze(['app_state', 'local_accounts', 'idempotency_keys'])
            : TABLE_NAMES,
        ),
        ownedIndexNames: Object.freeze(
          options.profile === 'PARTIAL_STANDALONE_ONLY' ? Object.freeze([]) : INDEX_NAMES,
        ),
        structuralSchemaFingerprint: structuralFp,
        canonicalDdlFingerprint: canonicalDdlFp,
        logicalDataFingerprint: logicalFp,
      });

      return result;
    } catch (error) {
      try {
        db.close();
      } catch {
        // Best-effort close on error
      }

      if (partialCreated) {
        cleanupPartialOutput(options.outputPath);
      }

      if (error instanceof LegacyV322FixtureBuilderError) {
        throw error;
      }

      throw new LegacyV322FixtureBuilderError(
        'BUILD_FAILED',
        'Fixture build failed: ' + (error as Error).message,
        { cause: error },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function cleanupPartialOutput(outputPath: string): void {
  try {
    unlinkSync(outputPath);
  } catch {
    // Best-effort
  }
  for (const suffix of ['-wal', '-shm']) {
    try {
      unlinkSync(outputPath + suffix);
    } catch {
      // Best-effort
    }
  }
}
