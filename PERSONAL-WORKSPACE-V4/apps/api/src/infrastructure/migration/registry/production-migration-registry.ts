import {
  applyV30OptionalContactEmail,
  validateV30OptionalContactEmail,
  computeV30MigrationChecksum,
  PRODUCTION_V30_MIGRATION_ID,
} from './production-v30-optional-contact-email';
import {
  applyV29FinalUiRelations,
  validateV29FinalUiRelations,
  computeV29MigrationChecksum,
  PRODUCTION_V29_MIGRATION_ID,
  PRODUCTION_V29_MIGRATION_DESCRIPTION,
} from './production-v29-final-ui-relations';
/**
 * Production migration registry and transitional external schema-management mode.
 *
 * This module is executable production source: it owns the reviewed 0 -> 1 baseline-adoption
 * migration that creates or adopts the complete current product schema through
 * SchemaMigrationRunner. It intentionally does not import any migration/testing/** module; the
 * committed legacy v3.2.2 manifest remains an independent historical verification oracle used by
 * focused tests.
 *
 * The registry also owns the transitional schema-management modes:
 *
 * - LEGACY_SELF_MANAGED (temporary default): constructors keep today's behavior and create,
 *   alter, back up, and compatibility-migrate the schema themselves. This keeps the current
 *   application runnable until production startup wiring lands.
 * - EXTERNALLY_MIGRATED: constructors perform no schema creation, alteration, legacy backup, or
 *   compatibility data migration. They fail closed on a post-migration readiness assertion
 *   (user_version, schema_migrations, and component-owned tables/indexes) before inserting
 *   runtime default rows.
 *
 * Production startup wiring MUST explicitly select EXTERNALLY_MIGRATED. Removal of
 * LEGACY_SELF_MANAGED is deferred until the End-to-End Reality Gate passes; legacy mode is not
 * safe for final production.
 *
 * The migration never creates runtime default rows (app_state primary, bootstrap account,
 * personal_settings id=1, microsoft_connection id=1) and never writes backups, journal files,
 * history rows, or PRAGMA user_version itself - SchemaMigrationRunner owns those.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  builtInTemplateVersions,
  p4dProfessionalTemplateVersions,
  validateTemplateVersion,
  type OutputTemplateDefinition,
} from '@scli/domain';
import type { MigrationContext, MigrationDefinition } from '../types';
import {
  validateProductionSchemaVersion,
  validateProductionSchemaVersionDuringForeignKeyRebuild,
  validateV22UpgradeAuthority,
} from './production-schema-validator';
import {
  applyV22LuminaireLibrarySchema,
  computeV22MigrationChecksum,
  PRODUCTION_V22_INDEX_NAMES,
  PRODUCTION_V22_MIGRATION_DESCRIPTION,
  PRODUCTION_V22_MIGRATION_ID,
  PRODUCTION_V22_TABLE_NAMES,
  validateV22LuminaireLibrarySchema,
} from './production-v22-luminaire-library';
import {
  applyV23LuminaireLibraryHardening,
  computeV23MigrationChecksum,
  PRODUCTION_V23_INDEX_NAMES,
  PRODUCTION_V23_MIGRATION_DESCRIPTION,
  PRODUCTION_V23_MIGRATION_ID,
  validateV23LuminaireLibraryHardening,
} from './production-v23-luminaire-library-hardening';
import {
  applyV24SmartImportInspection,
  computeV24MigrationChecksum,
  PRODUCTION_V24_INDEX_NAMES,
  PRODUCTION_V24_MIGRATION_DESCRIPTION,
  PRODUCTION_V24_MIGRATION_ID,
  PRODUCTION_V24_TABLE_NAMES,
  validateV24SmartImportInspection,
} from './production-v24-smart-import-inspection';
import {
  applyV25SmartImportProjectApply,
  computeV25MigrationChecksum,
  PRODUCTION_V25_INDEX_NAMES,
  PRODUCTION_V25_MIGRATION_DESCRIPTION,
  PRODUCTION_V25_MIGRATION_ID,
  validateV25SmartImportProjectApply,
} from './production-v25-smart-import-project-apply';
import {
  applyV26DocumentIntelligence,
  computeV26MigrationChecksum,
  PRODUCTION_V26_INDEX_NAMES,
  PRODUCTION_V26_MIGRATION_DESCRIPTION,
  PRODUCTION_V26_MIGRATION_ID,
  PRODUCTION_V26_TABLE_NAMES,
  validateV26DocumentIntelligence,
} from './production-v26-document-intelligence';
import {
  applyV27LuminaireDatasheetVerification,
  computeV27MigrationChecksum,
  PRODUCTION_V27_INDEX_NAMES,
  PRODUCTION_V27_MIGRATION_DESCRIPTION,
  PRODUCTION_V27_MIGRATION_ID,
  PRODUCTION_V27_TABLE_NAMES,
  PRODUCTION_V27_TRIGGER_NAMES,
  validateV27LuminaireDatasheetVerification,
} from './production-v27-luminaire-datasheet-verification';
import {
  applyV28ProjectIntelligenceProductivity,
  computeV28MigrationChecksum,
  PRODUCTION_V28_INDEX_NAMES,
  PRODUCTION_V28_MIGRATION_DESCRIPTION,
  PRODUCTION_V28_MIGRATION_ID,
  PRODUCTION_V28_TABLE_NAMES,
  validateV28ProjectIntelligenceProductivity,
} from './production-v28-project-intelligence-productivity';

export const PRODUCTION_SCHEMA_TARGET_VERSION = 30 as const;

// ---------------------------------------------------------------------------
// Transitional schema-management mode
// ---------------------------------------------------------------------------

export const LEGACY_SELF_MANAGED = 'LEGACY_SELF_MANAGED' as const;
export const EXTERNALLY_MIGRATED = 'EXTERNALLY_MIGRATED' as const;
export type SchemaManagementMode = typeof LEGACY_SELF_MANAGED | typeof EXTERNALLY_MIGRATED;

/** Temporary default preserving the currently runnable application until startup wiring lands. */
export const DEFAULT_SCHEMA_MANAGEMENT_MODE: SchemaManagementMode = LEGACY_SELF_MANAGED;

export type SchemaManagementComponent =
  'StandaloneDataProvider' | 'PersonalWorkspaceStore' | 'PersonalOperationsStore';

export type SchemaManagementErrorCode =
  | 'INVALID_SCHEMA_MANAGEMENT_MODE'
  | 'USER_VERSION_MISMATCH'
  | 'MIGRATION_HISTORY_MISSING'
  | 'REQUIRED_TABLE_MISSING'
  | 'REQUIRED_INDEX_MISSING'
  | 'REQUIRED_TRIGGER_MISSING'
  | 'SCHEMA_READ_CHECK_FAILED';

/** Bounded, path-free error for external-mode schema-readiness failures. */
export class SchemaManagementError extends Error {
  public readonly code: SchemaManagementErrorCode;

  public constructor(
    code: SchemaManagementErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SchemaManagementError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Component-owned schema inventory
// ---------------------------------------------------------------------------

const COMPONENT_TABLES: Readonly<Record<SchemaManagementComponent, readonly string[]>> =
  Object.freeze({
    StandaloneDataProvider: Object.freeze(['app_state', 'local_accounts', 'idempotency_keys']),
    PersonalWorkspaceStore: Object.freeze([
      'personal_settings',
      'project_workspaces',
      'project_deliverables',
      'project_luminaires',
      'luminaire_asset_versions',
      'project_output_columns',
      'project_exports',
      'custom_folder_profiles',
      'revision_packages',
      'project_file_index',
      'project_file_index_runs',
      'workflow_transitions',
      'revision_cycles',
      'work_sessions',
      'output_templates',
      'output_template_versions',
      'global_output_template_defaults',
      'project_output_template_overrides',
      'canonical_revisions',
      'canonical_outputs',
      'canonical_issue_packages',
      'canonical_package_outputs',
      'revision_document_snapshots',
      'revision_package_deliverables',
      'managed_artifacts',
      'artifact_versions',
      'tool_contexts',
      'capture_ledger',
      'revision_delete_operations',
      ...PRODUCTION_V22_TABLE_NAMES,
      ...PRODUCTION_V24_TABLE_NAMES,
      ...PRODUCTION_V26_TABLE_NAMES,
      ...PRODUCTION_V27_TABLE_NAMES,
      ...PRODUCTION_V28_TABLE_NAMES,
    ]),
    PersonalOperationsStore: Object.freeze([
      'project_requirements',
      'project_tags',
      'project_scope_notes',
      'project_checklist_items',
      'project_actions',
      'action_categories',
      'project_meetings',
      'meeting_participants',
      'meeting_agenda_items',
      'meeting_notes',
      'meeting_action_links',
      'project_review_items',
      'project_review_replies',
      'project_review_attachments',
      'project_revisions',
      'project_documents',
      'project_contacts',
      'project_communications',
      'workspace_activity',
      'microsoft_connection',
    ]),
  });

const COMPONENT_INDEXES: Readonly<Record<SchemaManagementComponent, readonly string[]>> =
  Object.freeze({
    StandaloneDataProvider: Object.freeze([]),
    PersonalWorkspaceStore: Object.freeze([
      'ix_revision_packages_project',
      'idx_project_file_index_project_category',
      'ix_workflow_transitions_project',
      'ux_revision_cycles_one_open',
      'ix_work_sessions_project',
      'ux_work_sessions_one_active',
      'ix_luminaire_asset_versions_project',
      'ix_luminaire_asset_versions_luminaire',
      'ix_output_templates_family_state',
      'ix_output_template_versions_template',
      'ix_project_output_template_overrides_project',
      'ix_canonical_revisions_project_created',
      'ix_canonical_outputs_revision',
      'ix_canonical_outputs_project_family',
      'ix_canonical_issue_packages_revision',
      'ix_canonical_issue_packages_project',
      'ix_canonical_package_outputs_output',
      'ix_revision_document_snapshots_project',
      'ix_revision_document_snapshots_revision',
      'ix_revision_document_snapshots_source',
      'ux_revision_document_snapshots_document_source',
      'ux_revision_document_snapshots_asset_source',
      'ix_revision_package_deliverables_package',
      'ix_revision_package_deliverables_source',
      'ix_revision_package_deliverables_revision',
      'ix_managed_artifacts_project_type',
      'ux_managed_artifacts_one_project_document',
      'ix_artifact_versions_artifact',
      'ix_tool_contexts_project_state',
      'ix_capture_ledger_state',
      'ix_capture_ledger_project_source_hash',
      'ux_revision_delete_operations_revision',
      'ix_revision_delete_operations_project_state',
      'ux_revision_delete_operations_reused_revision',
      ...PRODUCTION_V22_INDEX_NAMES,
      ...PRODUCTION_V23_INDEX_NAMES,
      ...PRODUCTION_V24_INDEX_NAMES,
      ...PRODUCTION_V26_INDEX_NAMES,
      ...PRODUCTION_V27_INDEX_NAMES,
      ...PRODUCTION_V25_INDEX_NAMES,
      ...PRODUCTION_V28_INDEX_NAMES.filter((name) => name !== 'ix_project_actions_issue_blocking'),
    ]),
    PersonalOperationsStore: Object.freeze([
      'ix_project_requirements_project',
      'ix_project_tags_project',
      'ix_project_scope_notes_project',
      'ix_project_actions_due',
      'ix_project_actions_category',
      'ix_action_categories_sort',
      'ix_project_meetings_start',
      'ix_meeting_action_links_meeting_relation',
      'ix_meeting_action_links_action_relation',
      'ux_project_review_items_id_project',
      'ix_project_review_replies_thread_order',
      'ix_project_review_attachments_project_order',
      'ux_project_review_root_document',
      'ux_project_review_reply_document',
      'ux_project_documents_id_project',
      'ix_project_documents_project',
      'ix_project_communications_project',
      'ix_workspace_activity_project',
      'ix_project_actions_issue_blocking',
    ]),
  });

const COMPONENT_TRIGGERS: Readonly<Record<SchemaManagementComponent, readonly string[]>> =
  Object.freeze({
    StandaloneDataProvider: Object.freeze([]),
    PersonalWorkspaceStore: Object.freeze([
      'trg_output_template_versions_no_update',
      'trg_output_template_versions_no_delete',
      ...PRODUCTION_V27_TRIGGER_NAMES,
    ]),
    PersonalOperationsStore: Object.freeze([]),
  });

// ---------------------------------------------------------------------------
// Canonical schema statements (locked order, independent of testing modules)
// ---------------------------------------------------------------------------

export const PRODUCTION_CANONICAL_DDL: readonly string[] = Object.freeze([
  'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS local_accounts (\n  user_id TEXT PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,\n  salt TEXT NOT NULL,\n  password_hash TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS idempotency_keys (\n  idempotency_key TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS personal_settings (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  project_root TEXT NOT NULL,\n  default_folder_profile TEXT NOT NULL,\n  default_input_mode TEXT NOT NULL,\n  auto_open_project_folder INTEGER NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS project_workspaces (\n  project_id TEXT PRIMARY KEY,\n  folder_path TEXT,\n  folder_profile TEXT NOT NULL,\n  services_json TEXT NOT NULL,\n  input_mode TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS project_deliverables (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  service_code TEXT NOT NULL,\n  title TEXT NOT NULL,\n  status TEXT NOT NULL,\n  progress_percent INTEGER NOT NULL,\n  required INTEGER NOT NULL,\n  due_date TEXT,\n  sort_order INTEGER NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, service_code)\n)',
  'CREATE TABLE IF NOT EXISTS project_luminaires (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  tag TEXT NOT NULL,\n  category TEXT NOT NULL,\n  image_path TEXT NOT NULL,\n  description TEXT NOT NULL,\n  manufacturer TEXT NOT NULL,\n  model TEXT NOT NULL,\n  wattage TEXT NOT NULL,\n  lumens TEXT NOT NULL,\n  light_color TEXT NOT NULL,\n  cri TEXT NOT NULL,\n  beam_angle TEXT NOT NULL,\n  ip_rating TEXT NOT NULL,\n  mounting TEXT NOT NULL,\n  cutout TEXT NOT NULL,\n  driver TEXT NOT NULL,\n  control TEXT NOT NULL,\n  emergency TEXT NOT NULL,\n  datasheet_path TEXT NOT NULL,\n  location TEXT NOT NULL,\n  unit TEXT NOT NULL,\n  quantity REAL NOT NULL,\n  notes TEXT NOT NULL,\n  source_name TEXT NOT NULL,\n  dimensions TEXT NOT NULL,\n  body_color_finish TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, tag)\n)',
  'CREATE TABLE IF NOT EXISTS project_output_columns (\n  project_id TEXT NOT NULL,\n  output_type TEXT NOT NULL,\n  field_key TEXT NOT NULL,\n  header TEXT NOT NULL,\n  visible INTEGER NOT NULL,\n  sort_order INTEGER NOT NULL,\n  PRIMARY KEY(project_id, output_type, field_key)\n)',
  'CREATE TABLE IF NOT EXISTS project_exports (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision INTEGER NOT NULL,\n  excel_path TEXT NOT NULL,\n  pdf_path TEXT NOT NULL,\n  datasheet_folder TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
  'CREATE TABLE IF NOT EXISTS custom_folder_profiles (\n  name TEXT PRIMARY KEY COLLATE NOCASE,\n  description TEXT NOT NULL,\n  folders_json TEXT NOT NULL,\n  output_folders_json TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  "CREATE TABLE IF NOT EXISTS revision_packages (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision_number INTEGER NOT NULL,\n  reissue_number INTEGER NOT NULL DEFAULT 0,\n  label TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'Draft',\n  output_mode TEXT NOT NULL,\n  folder_path TEXT NOT NULL,\n  zip_path TEXT NOT NULL,\n  item_count INTEGER NOT NULL,\n  total_bytes INTEGER NOT NULL,\n  package_hash TEXT NOT NULL,\n  warning_override_reason TEXT NOT NULL,\n  manifest_json TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
  'CREATE INDEX IF NOT EXISTS ix_revision_packages_project\n  ON revision_packages(project_id, revision_number DESC, reissue_number DESC, created_at DESC)',
  'CREATE TABLE IF NOT EXISTS project_file_index (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  file_name TEXT NOT NULL,\n  relative_path TEXT NOT NULL,\n  file_path TEXT NOT NULL,\n  extension TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL,\n  modified_at TEXT,\n  availability TEXT NOT NULL,\n  confidence INTEGER NOT NULL,\n  indexed_at TEXT NOT NULL,\n  UNIQUE(project_id, relative_path)\n)',
  'CREATE TABLE IF NOT EXISTS project_file_index_runs (\n  project_id TEXT PRIMARY KEY,\n  folder_path TEXT NOT NULL,\n  indexed_at TEXT NOT NULL,\n  file_count INTEGER NOT NULL,\n  total_bytes INTEGER NOT NULL,\n  one_drive_managed INTEGER NOT NULL,\n  truncated INTEGER NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS idx_project_file_index_project_category\n  ON project_file_index(project_id, category, modified_at DESC)',
  'CREATE TABLE IF NOT EXISTS project_requirements (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  title TEXT NOT NULL,\n  details TEXT NOT NULL,\n  requested_from TEXT NOT NULL,\n  requested_at TEXT,\n  due_date TEXT,\n  status TEXT NOT NULL,\n  impact TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_reference TEXT NOT NULL,\n  notes TEXT NOT NULL,\n  sort_order INTEGER NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS ix_project_requirements_project\n  ON project_requirements(project_id, status, due_date)',
  'CREATE TABLE IF NOT EXISTS project_checklist_items (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  title TEXT NOT NULL,\n  service_code TEXT,\n  required INTEGER NOT NULL,\n  completed INTEGER NOT NULL,\n  waived INTEGER NOT NULL,\n  waiver_reason TEXT NOT NULL,\n  sort_order INTEGER NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, category, title)\n)',
  'CREATE TABLE IF NOT EXISTS project_actions (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  details TEXT NOT NULL,\n  owner TEXT NOT NULL,\n  due_date TEXT,\n  status TEXT NOT NULL,\n  priority TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_id TEXT,\n  revision_id TEXT,\n  completed_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS ix_project_actions_due\n  ON project_actions(project_id, status, due_date)',
  'CREATE TABLE IF NOT EXISTS project_meetings (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  start_at TEXT NOT NULL,\n  end_at TEXT NOT NULL,\n  location TEXT NOT NULL,\n  attendees_json TEXT NOT NULL,\n  agenda TEXT NOT NULL,\n  notes TEXT NOT NULL,\n  decisions TEXT NOT NULL,\n  online_meeting_url TEXT NOT NULL,\n  external_event_id TEXT,\n  status TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS ix_project_meetings_start\n  ON project_meetings(project_id, start_at)',
  'CREATE TABLE IF NOT EXISTS project_review_items (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  reference TEXT NOT NULL,\n  title TEXT NOT NULL,\n  description TEXT NOT NULL,\n  area TEXT NOT NULL,\n  luminaire_tag TEXT NOT NULL,\n  drawing_reference TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_id TEXT,\n  status TEXT NOT NULL,\n  response TEXT NOT NULL,\n  revision_id TEXT,\n  received_at TEXT NOT NULL,\n  due_date TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  "CREATE TABLE IF NOT EXISTS project_revisions (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision_number INTEGER NOT NULL,\n  title TEXT NOT NULL,\n  status TEXT NOT NULL,\n  received_at TEXT,\n  due_date TEXT,\n  issued_at TEXT,\n  summary TEXT NOT NULL,\n  change_log TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_reference TEXT NOT NULL,\n  locked INTEGER NOT NULL DEFAULT 0,\n  snapshot_hash TEXT NOT NULL DEFAULT '',\n  reissue_number INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, revision_number)\n)",
  'CREATE TABLE IF NOT EXISTS project_documents (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  document_number TEXT NOT NULL,\n  title TEXT NOT NULL,\n  revision TEXT NOT NULL,\n  status TEXT NOT NULL,\n  file_path TEXT NOT NULL,\n  issued_to TEXT NOT NULL,\n  issue_date TEXT,\n  notes TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS ix_project_documents_project\n  ON project_documents(project_id, status, category)',
  'CREATE TABLE IF NOT EXISTS project_contacts (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  name TEXT NOT NULL,\n  email TEXT NOT NULL COLLATE NOCASE,\n  company TEXT NOT NULL,\n  role TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, email)\n)',
  'CREATE TABLE IF NOT EXISTS project_communications (\n  id TEXT PRIMARY KEY,\n  project_id TEXT,\n  external_id TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  conversation_id TEXT NOT NULL,\n  subject TEXT NOT NULL,\n  sender TEXT NOT NULL,\n  participants_json TEXT NOT NULL,\n  occurred_at TEXT NOT NULL,\n  end_at TEXT,\n  preview TEXT NOT NULL,\n  web_link TEXT NOT NULL,\n  has_attachments INTEGER NOT NULL,\n  manually_linked INTEGER NOT NULL,\n  synced_at TEXT NOT NULL,\n  UNIQUE(kind, external_id)\n)',
  'CREATE INDEX IF NOT EXISTS ix_project_communications_project\n  ON project_communications(project_id, occurred_at DESC)',
  'CREATE TABLE IF NOT EXISTS workspace_activity (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT,\n  action TEXT NOT NULL,\n  title TEXT NOT NULL,\n  detail TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
  'CREATE INDEX IF NOT EXISTS ix_workspace_activity_project\n  ON workspace_activity(project_id, created_at DESC)',
  'CREATE TABLE IF NOT EXISTS microsoft_connection (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  tenant_id TEXT NOT NULL,\n  client_id TEXT NOT NULL,\n  connected INTEGER NOT NULL,\n  account_name TEXT NOT NULL,\n  account_email TEXT NOT NULL,\n  mail_sync_enabled INTEGER NOT NULL,\n  calendar_sync_enabled INTEGER NOT NULL,\n  sync_interval_minutes INTEGER NOT NULL,\n  last_sync_at TEXT,\n  last_error TEXT,\n  token_blob TEXT NOT NULL,\n  token_expires_at TEXT,\n  updated_at TEXT NOT NULL\n)',
]);

export const PRODUCTION_TABLE_NAMES: readonly string[] = Object.freeze(
  PRODUCTION_CANONICAL_DDL.filter((sql) => /^CREATE TABLE IF NOT EXISTS/i.test(sql))
    .map((sql) => {
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
      return match ? match[1]! : '';
    })
    .filter((name) => name.length > 0),
);

export const PRODUCTION_INDEX_NAMES: readonly string[] = Object.freeze(
  PRODUCTION_CANONICAL_DDL.filter((sql) => /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/i.test(sql))
    .map((sql) => {
      const match = sql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/i);
      return match ? match[1]! : '';
    })
    .filter((name) => name.length > 0),
);

// ---------------------------------------------------------------------------
// Version 2 schema additions (P2.6B0)
//
// Version 1 is the immutable baseline-adoption schema (PRODUCTION_CANONICAL_DDL
// above). Version 2 adds the P2.6 workflow storage tables and their indexes on
// top of Version 1. These statements are executed only by the 1 -> 2 migration;
// they are never folded into the Version-1 canonical DDL so a Version-1
// database still validates against exactly the same schema as before.
// ---------------------------------------------------------------------------

export const PRODUCTION_V2_DDL: readonly string[] = Object.freeze([
  'CREATE TABLE IF NOT EXISTS workflow_transitions (\n  transition_id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  sequence INTEGER NOT NULL,\n  from_status TEXT NOT NULL,\n  to_status TEXT NOT NULL,\n  occurred_at TEXT NOT NULL,\n  actor_id TEXT,\n  reason TEXT,\n  revision_cycle_id TEXT,\n  UNIQUE(project_id, sequence)\n)',
  'CREATE INDEX IF NOT EXISTS ix_workflow_transitions_project\n  ON workflow_transitions(project_id, sequence)',
  "CREATE TABLE IF NOT EXISTS revision_cycles (\n  revision_cycle_id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  cycle_number INTEGER NOT NULL,\n  status TEXT NOT NULL CHECK (status IN ('Open', 'ReturnedToClient', 'Cancelled')),\n  opened_at TEXT NOT NULL,\n  opened_by_transition_id TEXT NOT NULL,\n  feedback_summary TEXT NOT NULL,\n  work_started_at TEXT,\n  returned_to_client_at TEXT,\n  cancelled_at TEXT,\n  UNIQUE(project_id, cycle_number),\n  FOREIGN KEY (opened_by_transition_id) REFERENCES workflow_transitions(transition_id)\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_cycles_one_open\n  ON revision_cycles(project_id) WHERE status = 'Open'",
]);

export const PRODUCTION_V2_TABLE_NAMES: readonly string[] = Object.freeze([
  'workflow_transitions',
  'revision_cycles',
]);

export const PRODUCTION_V2_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_workflow_transitions_project',
  'ux_revision_cycles_one_open',
]);

// ---------------------------------------------------------------------------
// Version 3 schema additions (P2.8A)
//
// Version 3 adds the Personal WorkSession storage table and its indexes on top
// of Version 2. These statements are executed only by the 2 -> 3 migration;
// they are never folded into the Version-1 canonical DDL or the Version-2 DDL
// so a Version-1 or Version-2 database still validates against exactly the
// same schema as before.
//
// The global one-active invariant is enforced by a partial UNIQUE index on a
// constant non-null active_key (1) that is present only while a session is
// active (ended_at IS NULL). An ended session releases the key by setting
// ended_at, so at most one active row can exist across ALL projects.
// ---------------------------------------------------------------------------

export const PRODUCTION_V3_DDL: readonly string[] = Object.freeze([
  'CREATE TABLE IF NOT EXISTS work_sessions (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  started_at TEXT NOT NULL,\n  ended_at TEXT,\n  active_key INTEGER,\n  created_at TEXT NOT NULL,\n  CHECK (\n    (ended_at IS NULL AND active_key IS 1)\n    OR\n    (ended_at IS NOT NULL AND active_key IS NULL)\n  )\n)',
  'CREATE INDEX IF NOT EXISTS ix_work_sessions_project\n  ON work_sessions(project_id, started_at DESC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_work_sessions_one_active\n  ON work_sessions(active_key) WHERE active_key IS NOT NULL',
]);

export const PRODUCTION_V3_TABLE_NAMES: readonly string[] = Object.freeze(['work_sessions']);

export const PRODUCTION_V3_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_work_sessions_project',
  'ux_work_sessions_one_active',
]);

// ---------------------------------------------------------------------------
// Version 5 schema additions (P2-TIMER-FND-01)
//
// Version 5 is strictly ADDITIVE for the existing Personal work_sessions
// table: it adds the true Pause/Resume persistent fields. No table rebuild, no
// CHECK rewrite, no index change, no event/segment table. The existing CHECK
// and partial UNIQUE index remain valid for all three states (RUNNING / PAUSED
// / STOPPED), because a PAUSED session keeps ended_at NULL and active_key = 1
// (it remains the current WorkSession). These statements are executed only by
// the 4 -> 5 migration; they are never folded into any earlier version DDL.
//
// Upgrade semantics:
//   - historical STOPPED rows: paused_at = NULL, accumulated_paused_ms = 0
//   - active RUNNING rows:     paused_at = NULL, accumulated_paused_ms = 0,
//                              ended_at NULL, active_key = 1 (stay RUNNING)
//   - NO fabricated pause history.
// ---------------------------------------------------------------------------

export const PRODUCTION_V5_DDL: readonly string[] = Object.freeze([
  'ALTER TABLE work_sessions ADD COLUMN paused_at TEXT',
  'ALTER TABLE work_sessions ADD COLUMN accumulated_paused_ms INTEGER NOT NULL DEFAULT 0',
]);

export const PRODUCTION_V5_COLUMN_NAMES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    work_sessions: Object.freeze([
      'id',
      'project_id',
      'started_at',
      'ended_at',
      'active_key',
      'created_at',
      'paused_at',
      'accumulated_paused_ms',
    ]),
  });

// ---------------------------------------------------------------------------
// Version 4 canonical Revision / Output / Package and Template Registry (P2-FND-04)
//
// Version 4 is strictly additive. The existing project_revisions, project_exports, and
// revision_packages tables remain the readable legacy compatibility source. New writes use the
// canonical registry authority; no old writer is silently changed or dual-written here.
// ---------------------------------------------------------------------------

export const PRODUCTION_V4_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS output_templates (
    template_id TEXT PRIMARY KEY,
    family TEXT NOT NULL CHECK (family IN ('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule')),
    origin TEXT NOT NULL CHECK (origin IN ('builtin', 'custom')),
    state TEXT NOT NULL CHECK (state IN ('active', 'inactive')),
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_output_templates_family_state
    ON output_templates(family, state, template_id)`,
  `CREATE TABLE IF NOT EXISTS output_template_versions (
    template_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    definition_hash TEXT NOT NULL CHECK (
      length(definition_hash) = 64 AND definition_hash NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    PRIMARY KEY(template_id, version_id),
    FOREIGN KEY (template_id) REFERENCES output_templates(template_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_output_template_versions_template
    ON output_template_versions(template_id, created_at, version_id)`,
  `CREATE TRIGGER IF NOT EXISTS trg_output_template_versions_no_update
    BEFORE UPDATE ON output_template_versions
    BEGIN
      SELECT RAISE(ABORT, 'Template versions are immutable; create a new Version ID.');
    END`,
  `CREATE TRIGGER IF NOT EXISTS trg_output_template_versions_no_delete
    BEFORE DELETE ON output_template_versions
    BEGIN
      SELECT RAISE(ABORT, 'Template versions are immutable and cannot be deleted.');
    END`,
  `CREATE TABLE IF NOT EXISTS global_output_template_defaults (
    output_family TEXT PRIMARY KEY
      CHECK (output_family IN ('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule')),
    template_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json)),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (template_id, version_id)
      REFERENCES output_template_versions(template_id, version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS project_output_template_overrides (
    project_id TEXT NOT NULL,
    output_family TEXT NOT NULL
      CHECK (output_family IN ('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule')),
    template_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, output_family),
    FOREIGN KEY (template_id, version_id)
      REFERENCES output_template_versions(template_id, version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_project_output_template_overrides_project
    ON project_output_template_overrides(project_id, output_family)`,
  `CREATE TABLE IF NOT EXISTS canonical_revisions (
    revision_id TEXT PRIMARY KEY CHECK (
      length(revision_id) = 36 AND substr(revision_id, 9, 1) = '-' AND
      substr(revision_id, 14, 1) = '-' AND substr(revision_id, 19, 1) = '-' AND
      substr(revision_id, 24, 1) = '-' AND substr(revision_id, 15, 1) GLOB '[1-8]' AND
      substr(revision_id, 20, 1) GLOB '[89ab]' AND lower(revision_id) = revision_id AND
      replace(revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    ),
    project_id TEXT NOT NULL,
    revision_sequence INTEGER NOT NULL,
    revision_label TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('PREPARING', 'FINALIZED', 'FAILED_RECOVERABLE', 'LEGACY_IMPORTED')),
    project_snapshot_json TEXT CHECK (
      project_snapshot_json IS NULL OR json_valid(project_snapshot_json)
    ),
    luminaire_snapshot_json TEXT CHECK (
      luminaire_snapshot_json IS NULL OR json_valid(luminaire_snapshot_json)
    ),
    snapshot_hash TEXT CHECK (
      snapshot_hash IS NULL OR
      (length(snapshot_hash) = 64 AND snapshot_hash NOT GLOB '*[^0-9a-f]*')
    ),
    created_by_id TEXT,
    created_by_name TEXT,
    provenance_classification TEXT NOT NULL
      CHECK (provenance_classification IN ('CANONICAL', 'LEGACY_VERIFIED', 'LEGACY_UNVERIFIED')),
    legacy_source_id TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    finalized_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, revision_sequence),
    UNIQUE(revision_id, project_id),
    UNIQUE(legacy_source_id),
    CHECK (
      provenance_classification <> 'CANONICAL' OR
      (revision_sequence > 0 AND project_snapshot_json IS NOT NULL AND
       luminaire_snapshot_json IS NOT NULL AND snapshot_hash IS NOT NULL AND
       created_by_id IS NOT NULL AND created_by_name IS NOT NULL AND legacy_source_id IS NULL AND
       lifecycle_state <> 'LEGACY_IMPORTED')
    ),
    CHECK (
      provenance_classification = 'CANONICAL' OR lifecycle_state = 'LEGACY_IMPORTED'
    )
  )`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_revisions_project_created
    ON canonical_revisions(project_id, revision_sequence DESC, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS canonical_outputs (
    output_id TEXT PRIMARY KEY CHECK (
      length(output_id) = 36 AND substr(output_id, 9, 1) = '-' AND
      substr(output_id, 14, 1) = '-' AND substr(output_id, 19, 1) = '-' AND
      substr(output_id, 24, 1) = '-' AND substr(output_id, 15, 1) GLOB '[1-8]' AND
      substr(output_id, 20, 1) GLOB '[89ab]' AND lower(output_id) = output_id AND
      replace(output_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    ),
    project_id TEXT NOT NULL,
    revision_id TEXT,
    output_family TEXT
      CHECK (output_family IS NULL OR output_family IN ('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule')),
    output_format TEXT NOT NULL,
    locator_kind TEXT NOT NULL
      CHECK (locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    locator_value TEXT,
    legacy_absolute_path TEXT,
    content_hash TEXT CHECK (
      content_hash IS NULL OR
      (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')
    ),
    template_id TEXT,
    template_version_id TEXT,
    resolved_template_snapshot_json TEXT CHECK (
      resolved_template_snapshot_json IS NULL OR json_valid(resolved_template_snapshot_json)
    ),
    resolved_template_snapshot_hash TEXT CHECK (
      resolved_template_snapshot_hash IS NULL OR
      (length(resolved_template_snapshot_hash) = 64 AND
       resolved_template_snapshot_hash NOT GLOB '*[^0-9a-f]*')
    ),
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('PREPARING', 'FINALIZED', 'FAILED_RECOVERABLE', 'LEGACY_IMPORTED')),
    provenance_classification TEXT NOT NULL
      CHECK (provenance_classification IN ('CANONICAL', 'LEGACY_VERIFIED', 'LEGACY_UNVERIFIED')),
    legacy_source_id TEXT,
    legacy_source_field TEXT,
    template_provenance TEXT NOT NULL CHECK (template_provenance IN ('RESOLVED', 'LEGACY_UNKNOWN')),
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    finalized_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(output_id, revision_id),
    UNIQUE(legacy_source_id, legacy_source_field),
    FOREIGN KEY (revision_id, project_id)
      REFERENCES canonical_revisions(revision_id, project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (template_id, template_version_id)
      REFERENCES output_template_versions(template_id, version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
      provenance_classification <> 'CANONICAL' OR
      (revision_id IS NOT NULL AND output_family IS NOT NULL AND
       locator_kind = 'PROJECT_RELATIVE' AND locator_value IS NOT NULL AND
       length(locator_value) > 0 AND legacy_absolute_path IS NULL AND
       template_id IS NOT NULL AND template_version_id IS NOT NULL AND
       resolved_template_snapshot_json IS NOT NULL AND
       resolved_template_snapshot_hash IS NOT NULL AND template_provenance = 'RESOLVED' AND
       legacy_source_id IS NULL AND legacy_source_field IS NULL AND
       lifecycle_state <> 'LEGACY_IMPORTED')
    ),
    CHECK (
      provenance_classification = 'CANONICAL' OR lifecycle_state = 'LEGACY_IMPORTED'
    ),
    CHECK (
      locator_kind <> 'LEGACY_ABSOLUTE' OR legacy_absolute_path IS NOT NULL
    )
  )`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_outputs_revision
    ON canonical_outputs(revision_id, output_family, output_format, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_outputs_project_family
    ON canonical_outputs(project_id, output_family, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS canonical_issue_packages (
    package_id TEXT PRIMARY KEY CHECK (
      length(package_id) = 36 AND substr(package_id, 9, 1) = '-' AND
      substr(package_id, 14, 1) = '-' AND substr(package_id, 19, 1) = '-' AND
      substr(package_id, 24, 1) = '-' AND substr(package_id, 15, 1) GLOB '[1-8]' AND
      substr(package_id, 20, 1) GLOB '[89ab]' AND lower(package_id) = package_id AND
      replace(package_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    ),
    project_id TEXT NOT NULL,
    revision_id TEXT,
    package_sequence INTEGER CHECK (package_sequence IS NULL OR package_sequence >= 0),
    label TEXT NOT NULL,
    artifact_locator_kind TEXT NOT NULL
      CHECK (artifact_locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    artifact_locator_value TEXT,
    legacy_absolute_path TEXT,
    manifest_locator_kind TEXT
      CHECK (manifest_locator_kind IS NULL OR
             manifest_locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    manifest_locator_value TEXT,
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('PREPARING', 'FINALIZED', 'FAILED_RECOVERABLE', 'LEGACY_IMPORTED')),
    provenance_classification TEXT NOT NULL
      CHECK (provenance_classification IN ('CANONICAL', 'LEGACY_VERIFIED', 'LEGACY_UNVERIFIED')),
    legacy_source_id TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    finalized_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(package_id, revision_id),
    UNIQUE(revision_id, package_sequence),
    UNIQUE(legacy_source_id),
    FOREIGN KEY (revision_id, project_id)
      REFERENCES canonical_revisions(revision_id, project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
      provenance_classification <> 'CANONICAL' OR
      (revision_id IS NOT NULL AND package_sequence IS NOT NULL AND package_sequence > 0 AND
       artifact_locator_kind = 'PROJECT_RELATIVE' AND legacy_absolute_path IS NULL AND
       (manifest_locator_kind IS NULL OR manifest_locator_kind = 'PROJECT_RELATIVE') AND
       legacy_source_id IS NULL AND lifecycle_state <> 'LEGACY_IMPORTED')
    ),
    CHECK (
      provenance_classification = 'CANONICAL' OR lifecycle_state = 'LEGACY_IMPORTED'
    ),
    CHECK (
      artifact_locator_kind <> 'LEGACY_ABSOLUTE' OR legacy_absolute_path IS NOT NULL
    )
  )`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_issue_packages_revision
    ON canonical_issue_packages(revision_id, package_sequence, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_issue_packages_project
    ON canonical_issue_packages(project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS canonical_package_outputs (
    package_id TEXT NOT NULL,
    output_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    provenance_classification TEXT NOT NULL
      CHECK (provenance_classification IN ('CANONICAL', 'LEGACY_VERIFIED', 'LEGACY_UNVERIFIED')),
    created_at TEXT NOT NULL,
    PRIMARY KEY(package_id, output_id),
    UNIQUE(package_id, position),
    FOREIGN KEY (package_id, revision_id)
      REFERENCES canonical_issue_packages(package_id, revision_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (output_id, revision_id)
      REFERENCES canonical_outputs(output_id, revision_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_canonical_package_outputs_output
    ON canonical_package_outputs(output_id, package_id)`,
]);

export const PRODUCTION_V4_TABLE_NAMES: readonly string[] = Object.freeze([
  'output_templates',
  'output_template_versions',
  'global_output_template_defaults',
  'project_output_template_overrides',
  'canonical_revisions',
  'canonical_outputs',
  'canonical_issue_packages',
  'canonical_package_outputs',
]);

export const PRODUCTION_V4_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_output_templates_family_state',
  'ix_output_template_versions_template',
  'ix_project_output_template_overrides_project',
  'ix_canonical_revisions_project_created',
  'ix_canonical_outputs_revision',
  'ix_canonical_outputs_project_family',
  'ix_canonical_issue_packages_revision',
  'ix_canonical_issue_packages_project',
  'ix_canonical_package_outputs_output',
]);

export const PRODUCTION_V4_TRIGGER_NAMES: readonly string[] = Object.freeze([
  'trg_output_template_versions_no_update',
  'trg_output_template_versions_no_delete',
]);

/** Exact Version-4 column order. Kept explicit so validation cannot accept a partial table. */
export const PRODUCTION_V4_COLUMN_NAMES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    output_templates: Object.freeze([
      'template_id',
      'family',
      'origin',
      'state',
      'display_name',
      'created_at',
      'updated_at',
    ]),
    output_template_versions: Object.freeze([
      'template_id',
      'version_id',
      'definition_json',
      'definition_hash',
      'created_at',
      'created_by',
    ]),
    global_output_template_defaults: Object.freeze([
      'output_family',
      'template_id',
      'version_id',
      'config_json',
      'updated_at',
    ]),
    project_output_template_overrides: Object.freeze([
      'project_id',
      'output_family',
      'template_id',
      'version_id',
      'config_json',
      'updated_at',
    ]),
    canonical_revisions: Object.freeze([
      'revision_id',
      'project_id',
      'revision_sequence',
      'revision_label',
      'lifecycle_state',
      'project_snapshot_json',
      'luminaire_snapshot_json',
      'snapshot_hash',
      'created_by_id',
      'created_by_name',
      'provenance_classification',
      'legacy_source_id',
      'failure_reason',
      'created_at',
      'finalized_at',
      'updated_at',
    ]),
    canonical_outputs: Object.freeze([
      'output_id',
      'project_id',
      'revision_id',
      'output_family',
      'output_format',
      'locator_kind',
      'locator_value',
      'legacy_absolute_path',
      'content_hash',
      'template_id',
      'template_version_id',
      'resolved_template_snapshot_json',
      'resolved_template_snapshot_hash',
      'lifecycle_state',
      'provenance_classification',
      'legacy_source_id',
      'legacy_source_field',
      'template_provenance',
      'failure_reason',
      'created_at',
      'finalized_at',
      'updated_at',
    ]),
    canonical_issue_packages: Object.freeze([
      'package_id',
      'project_id',
      'revision_id',
      'package_sequence',
      'label',
      'artifact_locator_kind',
      'artifact_locator_value',
      'legacy_absolute_path',
      'manifest_locator_kind',
      'manifest_locator_value',
      'lifecycle_state',
      'provenance_classification',
      'legacy_source_id',
      'failure_reason',
      'created_at',
      'finalized_at',
      'updated_at',
    ]),
    canonical_package_outputs: Object.freeze([
      'package_id',
      'output_id',
      'revision_id',
      'position',
      'provenance_classification',
      'created_at',
    ]),
  });

export interface ProductionV4ForeignKey {
  readonly table: string;
  readonly from: string;
  readonly targetTable: string;
  readonly to: string;
}

/** Exact Version-4 FK column mappings; every one is RESTRICT on UPDATE and DELETE. */
export const PRODUCTION_V4_FOREIGN_KEYS: readonly ProductionV4ForeignKey[] = Object.freeze([
  Object.freeze({
    table: 'output_template_versions',
    from: 'template_id',
    targetTable: 'output_templates',
    to: 'template_id',
  }),
  Object.freeze({
    table: 'global_output_template_defaults',
    from: 'template_id',
    targetTable: 'output_template_versions',
    to: 'template_id',
  }),
  Object.freeze({
    table: 'global_output_template_defaults',
    from: 'version_id',
    targetTable: 'output_template_versions',
    to: 'version_id',
  }),
  Object.freeze({
    table: 'project_output_template_overrides',
    from: 'template_id',
    targetTable: 'output_template_versions',
    to: 'template_id',
  }),
  Object.freeze({
    table: 'project_output_template_overrides',
    from: 'version_id',
    targetTable: 'output_template_versions',
    to: 'version_id',
  }),
  Object.freeze({
    table: 'canonical_outputs',
    from: 'revision_id',
    targetTable: 'canonical_revisions',
    to: 'revision_id',
  }),
  Object.freeze({
    table: 'canonical_outputs',
    from: 'project_id',
    targetTable: 'canonical_revisions',
    to: 'project_id',
  }),
  Object.freeze({
    table: 'canonical_outputs',
    from: 'template_id',
    targetTable: 'output_template_versions',
    to: 'template_id',
  }),
  Object.freeze({
    table: 'canonical_outputs',
    from: 'template_version_id',
    targetTable: 'output_template_versions',
    to: 'version_id',
  }),
  Object.freeze({
    table: 'canonical_issue_packages',
    from: 'revision_id',
    targetTable: 'canonical_revisions',
    to: 'revision_id',
  }),
  Object.freeze({
    table: 'canonical_issue_packages',
    from: 'project_id',
    targetTable: 'canonical_revisions',
    to: 'project_id',
  }),
  Object.freeze({
    table: 'canonical_package_outputs',
    from: 'package_id',
    targetTable: 'canonical_issue_packages',
    to: 'package_id',
  }),
  Object.freeze({
    table: 'canonical_package_outputs',
    from: 'revision_id',
    targetTable: 'canonical_issue_packages',
    to: 'revision_id',
  }),
  Object.freeze({
    table: 'canonical_package_outputs',
    from: 'output_id',
    targetTable: 'canonical_outputs',
    to: 'output_id',
  }),
  Object.freeze({
    table: 'canonical_package_outputs',
    from: 'revision_id',
    targetTable: 'canonical_outputs',
    to: 'revision_id',
  }),
]);

// ---------------------------------------------------------------------------
// Compatibility column operations (exact count recalculated from source)
// ---------------------------------------------------------------------------

export interface ProductionCompatibilityColumn {
  readonly table: string;
  readonly column: string;
  readonly definition: string;
  readonly alreadyInBaseCreate: boolean;
}

/**
 * 22 compatibility operations: 19 from PersonalWorkspaceStore ensureColumn calls and 3 from
 * PersonalOperationsStore ensureColumn calls. Four are already present in the base CREATE
 * statements (revision_packages.status, project_revisions.locked/snapshot_hash/reissue_number);
 * the remaining 18 are executed by the 0 -> 1 migration. time_zone uses the repository default
 * company timezone because migrations must be deterministic and database-only.
 */
export const PRODUCTION_COMPATIBILITY_COLUMNS: readonly ProductionCompatibilityColumn[] =
  Object.freeze([
    {
      table: 'project_workspaces',
      column: 'folders_json',
      definition: "TEXT NOT NULL DEFAULT '[]'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_workspaces',
      column: 'output_folders_json',
      definition: "TEXT NOT NULL DEFAULT '{}'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_workspaces',
      column: 'pdf_paper_size',
      definition: "TEXT NOT NULL DEFAULT 'Auto'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'designer_name',
      definition: "TEXT NOT NULL DEFAULT 'Mohamed'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'company_name',
      definition: "TEXT NOT NULL DEFAULT 'SCIENTECHNIC'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'company_logo_path',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'accent_color',
      definition: "TEXT NOT NULL DEFAULT '#008C95'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'time_zone',
      definition: "TEXT NOT NULL DEFAULT 'Asia/Dubai'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'personal_settings',
      column: 'backup_retention',
      definition: 'INTEGER NOT NULL DEFAULT 20',
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_exports',
      column: 'schedule_excel_path',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_exports',
      column: 'schedule_pdf_path',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_exports',
      column: 'boq_excel_path',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_exports',
      column: 'boq_pdf_path',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_output_columns',
      column: 'width',
      definition: 'INTEGER NOT NULL DEFAULT 140',
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_output_columns',
      column: 'compare_in_revision',
      definition: 'INTEGER NOT NULL DEFAULT 1',
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_output_columns',
      column: 'required_for_issue',
      definition: 'INTEGER NOT NULL DEFAULT 0',
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_output_columns',
      column: 'internal_only',
      definition: 'INTEGER NOT NULL DEFAULT 0',
      alreadyInBaseCreate: false,
    },
    {
      table: 'revision_packages',
      column: 'status',
      definition: "TEXT NOT NULL DEFAULT 'Draft'",
      alreadyInBaseCreate: true,
    },
    {
      table: 'revision_packages',
      column: 'luminaire_snapshot_json',
      definition: "TEXT NOT NULL DEFAULT '[]'",
      alreadyInBaseCreate: false,
    },
    {
      table: 'project_revisions',
      column: 'locked',
      definition: 'INTEGER NOT NULL DEFAULT 0',
      alreadyInBaseCreate: true,
    },
    {
      table: 'project_revisions',
      column: 'snapshot_hash',
      definition: "TEXT NOT NULL DEFAULT ''",
      alreadyInBaseCreate: true,
    },
    {
      table: 'project_revisions',
      column: 'reissue_number',
      definition: 'INTEGER NOT NULL DEFAULT 0',
      alreadyInBaseCreate: true,
    },
  ]);

// ---------------------------------------------------------------------------
// 0 -> 1 baseline-adoption migration
// ---------------------------------------------------------------------------

export const PRODUCTION_MIGRATION_ID = 'production-0-1-baseline-adoption';
export const PRODUCTION_MIGRATION_DESCRIPTION =
  'Adopt the complete current product schema and apply the source-proven compatibility data migration.';

const TECHNICAL_BOQ_COMPATIBILITY_UPDATE_SQL = `UPDATE project_checklist_items
  SET title = ?, updated_at = ?
  WHERE title = ? AND service_code = 'TechnicalBoq'`;
const TECHNICAL_BOQ_NEW_TITLE = 'Units and quantities are reviewed';
const TECHNICAL_BOQ_OLD_TITLE = 'Units and quantities are reviewed without price fields';

function ensureColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function up(context: MigrationContext): void {
  const database = context.database;
  for (const ddl of PRODUCTION_CANONICAL_DDL) database.exec(ddl);
  for (const op of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (op.alreadyInBaseCreate) continue;
    ensureColumn(database, op.table, op.column, op.definition);
  }
  database
    .prepare(TECHNICAL_BOQ_COMPATIBILITY_UPDATE_SQL)
    .run(TECHNICAL_BOQ_NEW_TITLE, context.clock.now().toISOString(), TECHNICAL_BOQ_OLD_TITLE);
}

function validate(context: MigrationContext): void {
  const database = context.database;
  const tableRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableNames = new Set(tableRows.map((row) => row.name));
  for (const name of PRODUCTION_TABLE_NAMES) {
    if (!tableNames.has(name))
      throw new Error(`Migration validation failed: missing table ${name}.`);
  }
  const indexRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const indexNames = new Set(indexRows.map((row) => row.name));
  for (const name of PRODUCTION_INDEX_NAMES) {
    if (!indexNames.has(name))
      throw new Error(`Migration validation failed: missing index ${name}.`);
  }
  for (const op of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (op.alreadyInBaseCreate) continue;
    const columns = database.prepare(`PRAGMA table_info(${op.table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === op.column)) {
      throw new Error(
        `Migration validation failed: missing compatibility column ${op.table}.${op.column}.`,
      );
    }
  }
  const history = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name?: string } | undefined;
  if (!history) {
    throw new Error('Migration validation failed: schema_migrations table missing.');
  }
}

function computeMigrationChecksum(): string {
  const payload = JSON.stringify({
    id: PRODUCTION_MIGRATION_ID,
    fromVersion: 0,
    toVersion: 1,
    description: PRODUCTION_MIGRATION_DESCRIPTION,
    canonicalDdl: PRODUCTION_CANONICAL_DDL,
    compatibilityColumns: PRODUCTION_COMPATIBILITY_COLUMNS,
    dataMigrationSql: TECHNICAL_BOQ_COMPATIBILITY_UPDATE_SQL,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// 1 -> 2 workflow storage migration (P2.6B0)
// ---------------------------------------------------------------------------

export const PRODUCTION_V2_MIGRATION_ID = 'production-1-2-workflow-storage';
export const PRODUCTION_V2_MIGRATION_DESCRIPTION =
  'Add the P2.6 workflow_transitions and revision_cycles storage tables and their indexes.';

function upV2(context: MigrationContext): void {
  const database = context.database;
  for (const ddl of PRODUCTION_V2_DDL) database.exec(ddl);
}

function validateV2(context: MigrationContext): void {
  const database = context.database;
  const tableRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableNames = new Set(tableRows.map((row) => row.name));
  for (const name of PRODUCTION_V2_TABLE_NAMES) {
    if (!tableNames.has(name))
      throw new Error(`Migration validation failed: missing table ${name}.`);
  }
  const indexRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const indexNames = new Set(indexRows.map((row) => row.name));
  for (const name of PRODUCTION_V2_INDEX_NAMES) {
    if (!indexNames.has(name))
      throw new Error(`Migration validation failed: missing index ${name}.`);
  }
}

function computeV2MigrationChecksum(): string {
  const payload = JSON.stringify({
    id: PRODUCTION_V2_MIGRATION_ID,
    fromVersion: 1,
    toVersion: 2,
    description: PRODUCTION_V2_MIGRATION_DESCRIPTION,
    v2Ddl: PRODUCTION_V2_DDL,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// 2 -> 3 Personal WorkSession storage migration (P2.8A)
// ---------------------------------------------------------------------------

export const PRODUCTION_V3_MIGRATION_ID = 'production-2-3-work-sessions';
export const PRODUCTION_V3_MIGRATION_DESCRIPTION =
  'Add the P2.8A Personal work_sessions storage table and its project-history and global one-active indexes.';

function upV3(context: MigrationContext): void {
  const database = context.database;
  for (const ddl of PRODUCTION_V3_DDL) database.exec(ddl);
}

function validateV3(context: MigrationContext): void {
  const database = context.database;
  const tableRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const tableNames = new Set(tableRows.map((row) => row.name));
  for (const name of PRODUCTION_V3_TABLE_NAMES) {
    if (!tableNames.has(name))
      throw new Error(`Migration validation failed: missing table ${name}.`);
  }
  const indexRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const indexNames = new Set(indexRows.map((row) => row.name));
  for (const name of PRODUCTION_V3_INDEX_NAMES) {
    if (!indexNames.has(name))
      throw new Error(`Migration validation failed: missing index ${name}.`);
  }
}

function computeV3MigrationChecksum(): string {
  const payload = JSON.stringify({
    id: PRODUCTION_V3_MIGRATION_ID,
    fromVersion: 2,
    toVersion: 3,
    description: PRODUCTION_V3_MIGRATION_DESCRIPTION,
    v3Ddl: PRODUCTION_V3_DDL,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// 4 -> 5 Personal WorkSession Pause/Resume migration (P2-TIMER-FND-01)
// ---------------------------------------------------------------------------

export const PRODUCTION_V5_MIGRATION_ID = 'production-4-5-work-session-pause-resume';
export const PRODUCTION_V5_MIGRATION_DESCRIPTION =
  'Add the Personal work_sessions paused_at and accumulated_paused_ms columns for true Pause/Resume (schema v5, purely additive).';

function upV5(context: MigrationContext): void {
  const database = context.database;
  for (const ddl of PRODUCTION_V5_DDL) database.exec(ddl);
}

function validateV5(context: MigrationContext): void {
  const database = context.database;
  const columns = database.prepare('PRAGMA table_info(work_sessions)').all() as Array<{
    name: string;
  }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const expectedColumns = PRODUCTION_V5_COLUMN_NAMES.work_sessions ?? [];
  for (const name of expectedColumns) {
    if (!columnNames.has(name)) {
      throw new Error(`Migration validation failed: work_sessions is missing column ${name}.`);
    }
  }
}

function computeV5MigrationChecksum(): string {
  const payload = JSON.stringify({
    id: PRODUCTION_V5_MIGRATION_ID,
    fromVersion: 4,
    toVersion: 5,
    description: PRODUCTION_V5_MIGRATION_DESCRIPTION,
    v5Ddl: PRODUCTION_V5_DDL,
    v5Columns: PRODUCTION_V5_COLUMN_NAMES,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

export const PRODUCTION_V6_MIGRATION_ID = 'production-5-6-scope-metadata';
const PRODUCTION_V6_DDL = Object.freeze([
  "CREATE TABLE IF NOT EXISTS project_tags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL, normalized_label TEXT NOT NULL, color_key TEXT NOT NULL CHECK(color_key IN ('teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, normalized_label))",
  'CREATE INDEX IF NOT EXISTS ix_project_tags_project ON project_tags(project_id, created_at)',
  "CREATE TABLE IF NOT EXISTS project_scope_notes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('Note', 'Exclusion')), text TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS ix_project_scope_notes_project ON project_scope_notes(project_id, sort_order, created_at)',
]);
function upV6(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V6_DDL) context.database.exec(ddl);
}

function validateV6(context: MigrationContext): void {
  const expectedColumns: Readonly<Record<string, readonly string[]>> = {
    project_tags: [
      'id',
      'project_id',
      'label',
      'normalized_label',
      'color_key',
      'created_at',
      'updated_at',
    ],
    project_scope_notes: [
      'id',
      'project_id',
      'type',
      'text',
      'sort_order',
      'created_at',
      'updated_at',
    ],
  };
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actual = context.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (
      actual.length === 0 ||
      columns.some((column) => !actual.some((entry) => entry.name === column))
    ) {
      throw new Error(`Migration validation failed: ${table} does not have its required columns.`);
    }
  }
  for (const index of ['ix_project_tags_project', 'ix_project_scope_notes_project']) {
    if (
      !context.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index)
    ) {
      throw new Error(`Migration validation failed: missing index ${index}.`);
    }
  }
}

function computeV6MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V6_MIGRATION_ID, ddl: PRODUCTION_V6_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 6 -> 7 global Action Category catalog
// ---------------------------------------------------------------------------

export const PRODUCTION_V7_MIGRATION_ID = 'production-6-7-action-categories';
export const PRODUCTION_V7_MIGRATION_DESCRIPTION =
  'Add the global Action Category catalog and nullable project action category relation.';
const PRODUCTION_V7_SEED_TIMESTAMP = '2026-08-15T00:00:00.000Z';
export const PRODUCTION_V7_ACTION_CATEGORY_DEFAULTS = Object.freeze([
  ['97000001-0000-4000-8000-000000000001', 'Lighting Design', 'lightbulb', 'teal'],
  ['97000002-0000-4000-8000-000000000002', 'DIALux Calculation', 'sun', 'blue'],
  ['97000003-0000-4000-8000-000000000003', 'Lighting Layout', 'layout', 'blue'],
  ['97000004-0000-4000-8000-000000000004', 'Luminaire Selection', 'lamp', 'purple'],
  ['97000005-0000-4000-8000-000000000005', 'Luminaire Schedule', 'table', 'purple'],
  ['97000006-0000-4000-8000-000000000006', 'BOQ / Quantity', 'receipt', 'gold'],
  ['97000007-0000-4000-8000-000000000007', 'Datasheet / Information', 'file-text', 'blue'],
  ['97000008-0000-4000-8000-000000000008', 'Deliverable / Package', 'package', 'teal'],
  ['97000009-0000-4000-8000-000000000009', 'Revision', 'revision', 'gold'],
  ['97000010-0000-4000-8000-000000000010', 'Client Feedback', 'message', 'gold'],
  ['97000011-0000-4000-8000-000000000011', 'Coordination', 'people', 'teal'],
  ['97000012-0000-4000-8000-000000000012', 'Site / Installation', 'location', 'green'],
  ['97000013-0000-4000-8000-000000000013', 'Technical Check', 'checklist', 'green'],
  ['97000014-0000-4000-8000-000000000014', 'Meeting Follow-up', 'calendar', 'purple'],
  ['97000015-0000-4000-8000-000000000015', 'Commercial / Pricing', 'receipt', 'gold'],
  ['97000016-0000-4000-8000-000000000016', 'General', 'tags', 'slate'],
] as const);
const PRODUCTION_V7_DDL = Object.freeze([
  "CREATE TABLE action_categories (id TEXT PRIMARY KEY, label TEXT NOT NULL, normalized_label TEXT NOT NULL, icon_key TEXT NOT NULL, color_key TEXT NOT NULL CHECK(color_key IN ('teal', 'blue', 'purple', 'gold', 'green', 'red', 'slate')), sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(normalized_label))",
  'CREATE INDEX ix_action_categories_sort ON action_categories(sort_order, normalized_label, id)',
  'ALTER TABLE project_actions ADD COLUMN category_id TEXT REFERENCES action_categories(id) ON UPDATE RESTRICT ON DELETE SET NULL',
  'CREATE INDEX ix_project_actions_category ON project_actions(category_id)',
]);
function upV7(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V7_DDL) context.database.exec(ddl);
  const insert = context.database.prepare(
    'INSERT INTO action_categories (id, label, normalized_label, icon_key, color_key, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  PRODUCTION_V7_ACTION_CATEGORY_DEFAULTS.forEach(([id, label, iconKey, colorKey], index) =>
    insert.run(
      id,
      label,
      label.toLowerCase(),
      iconKey,
      colorKey,
      index + 1,
      PRODUCTION_V7_SEED_TIMESTAMP,
      PRODUCTION_V7_SEED_TIMESTAMP,
    ),
  );
}
function validateV7(context: MigrationContext): void {
  const database = context.database;
  const categories = database.prepare('PRAGMA table_info(action_categories)').all() as Array<{
    name: string;
  }>;
  const categoryColumns = [
    'id',
    'label',
    'normalized_label',
    'icon_key',
    'color_key',
    'sort_order',
    'created_at',
    'updated_at',
  ];
  if (categoryColumns.some((name) => !categories.some((column) => column.name === name)))
    throw new Error('Migration validation failed: action_categories columns differ.');
  const actions = database.prepare('PRAGMA table_info(project_actions)').all() as Array<{
    name: string;
  }>;
  if (!actions.some((column) => column.name === 'category_id'))
    throw new Error('Migration validation failed: project_actions.category_id is missing.');
  for (const index of ['ix_action_categories_sort', 'ix_project_actions_category'])
    if (
      !database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index)
    )
      throw new Error(`Migration validation failed: missing index ${index}.`);
  const foreignKeys = database.prepare('PRAGMA foreign_key_list(project_actions)').all() as Array<{
    from: string;
    table: string;
    on_delete: string;
    on_update: string;
  }>;
  if (
    !foreignKeys.some(
      (foreignKey) =>
        foreignKey.from === 'category_id' &&
        foreignKey.table === 'action_categories' &&
        foreignKey.on_delete === 'SET NULL' &&
        foreignKey.on_update === 'RESTRICT',
    )
  )
    throw new Error('Migration validation failed: action category foreign key differs.');
  const count = database.prepare('SELECT COUNT(*) AS count FROM action_categories').get() as {
    count: number;
  };
  if (count.count !== 16)
    throw new Error('Migration validation failed: action category defaults differ.');
}
function computeV7MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V7_MIGRATION_ID,
        ddl: PRODUCTION_V7_DDL,
        defaults: PRODUCTION_V7_ACTION_CATEGORY_DEFAULTS,
        timestamp: PRODUCTION_V7_SEED_TIMESTAMP,
      }),
      'utf8',
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 7 -> 8 Action owner role and working notes
// ---------------------------------------------------------------------------

export const PRODUCTION_V8_MIGRATION_ID = 'production-7-8-action-owner-role-notes';
export const PRODUCTION_V8_MIGRATION_DESCRIPTION =
  'Add canonical optional owner role and working notes fields to project actions.';
const PRODUCTION_V8_DDL = Object.freeze([
  "ALTER TABLE project_actions ADD COLUMN owner_role TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE project_actions ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
]);
function upV8(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V8_DDL) context.database.exec(ddl);
}
function validateV8(context: MigrationContext): void {
  const columns = context.database.prepare('PRAGMA table_info(project_actions)').all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  for (const name of ['owner_role', 'notes']) {
    const column = columns.find((item) => item.name === name);
    if (!column || column.notnull !== 1 || column.dflt_value !== "''") {
      throw new Error(`Migration validation failed: project_actions.${name} differs.`);
    }
  }
}
function computeV8MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V8_MIGRATION_ID, ddl: PRODUCTION_V8_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 8 -> 9 Meeting structured authority
// ---------------------------------------------------------------------------

export const PRODUCTION_V9_MIGRATION_ID = 'production-8-9-meeting-structured-authority';
export const PRODUCTION_V9_MIGRATION_DESCRIPTION =
  'Add Meeting purpose, structured participants, agenda, notes, and Action relations.';
const PRODUCTION_V9_DDL = Object.freeze([
  "ALTER TABLE project_meetings ADD COLUMN purpose TEXT NOT NULL DEFAULT ''",
  'CREATE TABLE meeting_participants (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, name TEXT NOT NULL, role TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(meeting_id, sort_order))',
  'CREATE TABLE meeting_agenda_items (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, content TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(meeting_id, sort_order))',
  'CREATE TABLE meeting_notes (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, content TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  "CREATE TABLE meeting_action_links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meeting_id TEXT NOT NULL REFERENCES project_meetings(id) ON DELETE CASCADE, action_id TEXT NOT NULL REFERENCES project_actions(id) ON DELETE CASCADE, relation_type TEXT NOT NULL CHECK(relation_type IN ('Linked', 'CreatedFromMeeting')), created_at TEXT NOT NULL, UNIQUE(meeting_id, action_id))",
  'CREATE INDEX ix_meeting_action_links_meeting_relation ON meeting_action_links(meeting_id, relation_type)',
  'CREATE INDEX ix_meeting_action_links_action_relation ON meeting_action_links(action_id, relation_type)',
]);
function upV9(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V9_DDL) context.database.exec(ddl);
}
function validateV9(context: MigrationContext): void {
  const column = (
    context.database.prepare('PRAGMA table_info(project_meetings)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>
  ).find((item) => item.name === 'purpose');
  if (!column || column.notnull !== 1 || column.dflt_value !== "''") {
    throw new Error('Migration validation failed: project_meetings.purpose differs.');
  }
  for (const table of [
    'meeting_participants',
    'meeting_agenda_items',
    'meeting_notes',
    'meeting_action_links',
  ]) {
    if (
      !context.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
    ) {
      throw new Error(`Migration validation failed: ${table} missing.`);
    }
  }
}
function computeV9MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V9_MIGRATION_ID, ddl: PRODUCTION_V9_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 9 -> 10 Comments thread foundation
// ---------------------------------------------------------------------------

export const PRODUCTION_V10_MIGRATION_ID = 'production-9-10-comments-thread-foundation';
export const PRODUCTION_V10_MIGRATION_DESCRIPTION =
  'Add authored Review roots, immutable replies, stable Luminaire relations, and registered-document attachment relations.';
const PRODUCTION_V10_REVIEW_COLUMNS = Object.freeze([
  "origin TEXT CHECK(origin IS NULL OR origin IN ('Client', 'Internal'))",
  'author_id TEXT',
  'author_name_snapshot TEXT',
  'author_role_snapshot TEXT',
  'luminaire_id TEXT',
]);
const PRODUCTION_V10_DDL = Object.freeze([
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_items_id_project ON project_review_items(id, project_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_project_documents_id_project ON project_documents(id, project_id)',
  "CREATE TABLE IF NOT EXISTS project_review_replies (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_item_id TEXT NOT NULL, body TEXT NOT NULL CHECK(length(trim(body)) > 0), author_id TEXT NOT NULL, author_name_snapshot TEXT NOT NULL, author_role_snapshot TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('Client', 'Internal')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id, project_id), FOREIGN KEY(review_item_id, project_id) REFERENCES project_review_items(id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT)",
  'CREATE INDEX IF NOT EXISTS ix_project_review_replies_thread_order ON project_review_replies(project_id, review_item_id, created_at, id)',
  'CREATE TABLE IF NOT EXISTS project_review_attachments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, review_item_id TEXT, reply_id TEXT, created_by_id TEXT NOT NULL, created_by_name_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, CHECK((review_item_id IS NOT NULL AND reply_id IS NULL) OR (review_item_id IS NULL AND reply_id IS NOT NULL)), FOREIGN KEY(review_item_id, project_id) REFERENCES project_review_items(id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT, FOREIGN KEY(reply_id, project_id) REFERENCES project_review_replies(id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT, FOREIGN KEY(document_id, project_id) REFERENCES project_documents(id, project_id) ON UPDATE RESTRICT ON DELETE RESTRICT)',
  'CREATE INDEX IF NOT EXISTS ix_project_review_attachments_project_order ON project_review_attachments(project_id, created_at, id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_root_document ON project_review_attachments(review_item_id, document_id) WHERE review_item_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_project_review_reply_document ON project_review_attachments(reply_id, document_id) WHERE reply_id IS NOT NULL',
]);

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

function upV10(context: MigrationContext): void {
  for (const definition of PRODUCTION_V10_REVIEW_COLUMNS) {
    const column = definition.split(' ', 1)[0]!;
    if (!hasColumn(context.database, 'project_review_items', column)) {
      context.database.exec(`ALTER TABLE project_review_items ADD COLUMN ${definition}`);
    }
  }
  for (const ddl of PRODUCTION_V10_DDL) context.database.exec(ddl);
}

function validateV10(context: MigrationContext): void {
  for (const definition of PRODUCTION_V10_REVIEW_COLUMNS) {
    const column = definition.split(' ', 1)[0]!;
    if (!hasColumn(context.database, 'project_review_items', column)) {
      throw new Error(`Migration validation failed: project_review_items.${column} missing.`);
    }
  }
  for (const table of ['project_review_replies', 'project_review_attachments']) {
    if (
      !context.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
    ) {
      throw new Error(`Migration validation failed: ${table} missing.`);
    }
  }
  for (const index of [
    'ux_project_review_items_id_project',
    'ux_project_documents_id_project',
    'ix_project_review_replies_thread_order',
    'ix_project_review_attachments_project_order',
    'ux_project_review_root_document',
    'ux_project_review_reply_document',
  ]) {
    if (
      !context.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index)
    ) {
      throw new Error(`Migration validation failed: ${index} missing.`);
    }
  }
  const violations = context.database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length !== 0) {
    throw new Error('Migration validation failed: Comments thread foreign-key violations exist.');
  }
}

function computeV10MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V10_MIGRATION_ID,
        columns: PRODUCTION_V10_REVIEW_COLUMNS,
        ddl: PRODUCTION_V10_DDL,
      }),
      'utf8',
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 10 -> 11 immutable Luminaire Datasheet / Product Image versions
// ---------------------------------------------------------------------------

export const PRODUCTION_V11_MIGRATION_ID = 'production-10-11-luminaire-asset-versions';
export const PRODUCTION_V11_MIGRATION_DESCRIPTION =
  'Add immutable project- and Luminaire-scoped Datasheet and Product Image versions, with one truthful initial snapshot for each existing compatibility path.';

const PRODUCTION_V11_DDL = Object.freeze([
  "CREATE TABLE IF NOT EXISTS luminaire_asset_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, luminaire_id TEXT NOT NULL, asset_type TEXT NOT NULL CHECK(asset_type IN ('Datasheet', 'ProductImage')), version_sequence INTEGER NOT NULL CHECK(version_sequence > 0), file_path TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0), file_hash TEXT, backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0, 1)), attached_at TEXT NOT NULL, attached_by_id TEXT, attached_by_name_snapshot TEXT, UNIQUE(luminaire_id, asset_type, version_sequence), FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id) ON DELETE CASCADE)",
  'CREATE INDEX IF NOT EXISTS ix_luminaire_asset_versions_project ON luminaire_asset_versions(project_id, luminaire_id, asset_type, version_sequence DESC)',
  'CREATE INDEX IF NOT EXISTS ix_luminaire_asset_versions_luminaire ON luminaire_asset_versions(luminaire_id, asset_type, version_sequence DESC)',
]);

function v11MimeType(assetType: 'Datasheet' | 'ProductImage', filePath: string): string {
  if (assetType === 'Datasheet') return 'application/pdf';
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function upV11(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V11_DDL) context.database.exec(ddl);
  const observedAt = context.clock.now().toISOString();
  const rows = context.database
    .prepare(
      `SELECT id, project_id, datasheet_path, image_path
       FROM project_luminaires ORDER BY project_id, id`,
    )
    .all() as Array<{
    id: string;
    project_id: string;
    datasheet_path: string;
    image_path: string;
  }>;
  const insert = context.database.prepare(
    `INSERT OR IGNORE INTO luminaire_asset_versions
     (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
      mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
      attached_by_name_snapshot)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, 1, ?, NULL, NULL)`,
  );
  for (const row of rows) {
    for (const [assetType, filePath] of [
      ['Datasheet', row.datasheet_path],
      ['ProductImage', row.image_path],
    ] as const) {
      const normalized = filePath.trim();
      if (!normalized) continue;
      insert.run(
        deterministicV4Uuid('luminaire-asset-backfill', row.id, assetType),
        row.project_id,
        row.id,
        assetType,
        normalized,
        path.basename(normalized.replaceAll('\\', '/')),
        v11MimeType(assetType, normalized),
        observedAt,
      );
    }
  }
}

function validateV11(context: MigrationContext): void {
  for (const name of [
    'luminaire_asset_versions',
    'ix_luminaire_asset_versions_project',
    'ix_luminaire_asset_versions_luminaire',
  ]) {
    const found = context.database
      .prepare("SELECT name FROM sqlite_master WHERE name = ? AND type IN ('table', 'index')")
      .get(name);
    if (!found) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  const provenanceColumn = (
    context.database.prepare('PRAGMA table_info(luminaire_asset_versions)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>
  ).find((column) => column.name === 'backfilled');
  if (
    !provenanceColumn ||
    Number(provenanceColumn.notnull) !== 1 ||
    Number(provenanceColumn.dflt_value) !== 0
  ) {
    throw new Error(
      'Migration validation failed: backfilled must be NOT NULL with a zero default.',
    );
  }
  const tableSql = context.database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('luminaire_asset_versions') as { sql?: string } | undefined;
  if (!tableSql?.sql?.includes('CHECK(backfilled IN (0, 1))')) {
    throw new Error('Migration validation failed: backfilled boolean check constraint missing.');
  }
  const missing = context.database
    .prepare(
      `SELECT COUNT(*) AS count FROM project_luminaires l
       WHERE (trim(l.datasheet_path) <> '' AND NOT EXISTS (
         SELECT 1 FROM luminaire_asset_versions v
         WHERE v.luminaire_id = l.id AND v.asset_type = 'Datasheet' AND v.backfilled = 1
       )) OR (trim(l.image_path) <> '' AND NOT EXISTS (
         SELECT 1 FROM luminaire_asset_versions v
         WHERE v.luminaire_id = l.id AND v.asset_type = 'ProductImage' AND v.backfilled = 1
       ))`,
    )
    .get() as { count: number };
  if (Number(missing.count) !== 0) {
    throw new Error(
      'Migration validation failed: existing Luminaire asset paths were not backfilled.',
    );
  }
  const invalidBackfill = context.database
    .prepare(
      `SELECT COUNT(*) AS count FROM luminaire_asset_versions
       WHERE backfilled <> 1 OR attached_by_id IS NOT NULL OR attached_by_name_snapshot IS NOT NULL`,
    )
    .get() as { count: number };
  if (Number(invalidBackfill.count) !== 0) {
    throw new Error(
      'Migration validation failed: legacy asset provenance or actor semantics are invalid.',
    );
  }
}

function computeV11MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V11_MIGRATION_ID,
        ddl: PRODUCTION_V11_DDL,
        backfill: 'one-backfilled-version-per-non-empty-compatibility-path-at-observation-time',
      }),
      'utf8',
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 11 -> 12 Issue Package audit authority (V4-ISSUE-A0)
//
// Version 12 is strictly ADDITIVE for the canonical Issue Package registry and
// the legacy revision_packages compatibility projection. It adds the immutable
// Issue audit columns (issued_by_id, issued_by_name, issued_at) as nullable
// columns with no default and no backfill: Draft packages and pre-migration
// rows keep NULL because their Issue event is unknown. No historical timestamp
// is fabricated from created_at/finalized_at and no actor is guessed.
// ---------------------------------------------------------------------------

export const PRODUCTION_V12_MIGRATION_ID = 'production-11-12-issue-package-audit';
export const PRODUCTION_V12_MIGRATION_DESCRIPTION =
  'Add nullable immutable Issue audit columns (issued_by_id, issued_by_name, issued_at) to canonical_issue_packages and revision_packages.';

export const PRODUCTION_V12_DDL: readonly string[] = Object.freeze([
  'ALTER TABLE canonical_issue_packages ADD COLUMN issued_by_id TEXT',
  'ALTER TABLE canonical_issue_packages ADD COLUMN issued_by_name TEXT',
  'ALTER TABLE canonical_issue_packages ADD COLUMN issued_at TEXT',
  'ALTER TABLE revision_packages ADD COLUMN issued_by_id TEXT',
  'ALTER TABLE revision_packages ADD COLUMN issued_by_name TEXT',
  'ALTER TABLE revision_packages ADD COLUMN issued_at TEXT',
]);

function upV12(context: MigrationContext): void {
  applyV12IssueAuditColumns(context.database);
}

/**
 * Idempotent V4-ISSUE-A0 column application for non-production harnesses that
 * apply the v4 registry DDL after store construction (the store already ensures
 * the revision_packages columns). Never throws on an already-present column.
 */
export function applyV12IssueAuditColumns(database: DatabaseSync): void {
  for (const table of ['canonical_issue_packages', 'revision_packages']) {
    for (const column of ['issued_by_id', 'issued_by_name', 'issued_at']) {
      if (!hasColumn(database, table, column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    }
  }
}

function validateV12(context: MigrationContext): void {
  for (const table of ['canonical_issue_packages', 'revision_packages']) {
    const columns = context.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    for (const name of ['issued_by_id', 'issued_by_name', 'issued_at']) {
      const column = columns.find((item) => item.name === name);
      if (!column || Number(column.notnull) !== 0 || column.dflt_value !== null) {
        throw new Error(
          `Migration validation failed: ${table}.${name} must be a nullable column without a default.`,
        );
      }
    }
  }
}

function computeV12MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V12_MIGRATION_ID, ddl: PRODUCTION_V12_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 12 -> 13 Revision Deliverable Foundation (V4-REVISION-DELIVERABLE-B0)
//
// Version 13 is strictly ADDITIVE. It adds one durable immutable Document
// Snapshot authority table (`revision_document_snapshots`) that binds an
// immutable copy of a registered Project Document to a canonical Revision.
// Generated canonical Outputs are NOT duplicated here — they remain naturally
// visible through the unified Deliverables read projection from
// `canonical_outputs`. No backfill, no destructive rewrite: existing
// register-only FINALIZED zero-deliverable Revisions and their history remain
// valid and readable.
// ---------------------------------------------------------------------------

export const PRODUCTION_V13_MIGRATION_ID = 'production-12-13-revision-deliverable-foundation';
export const PRODUCTION_V13_MIGRATION_DESCRIPTION =
  'Add the immutable Revision Document Snapshot deliverable table (revision_document_snapshots) with project-relative artifact locator, SHA-256 content identity, and canonical Revision + Project Document provenance.';

export const PRODUCTION_V13_TABLE_NAMES: readonly string[] = Object.freeze([
  'revision_document_snapshots',
]);

export const PRODUCTION_V13_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_revision_document_snapshots_project',
  'ix_revision_document_snapshots_revision',
  'ix_revision_document_snapshots_source',
]);

/**
 * Idempotent v13 DDL application for non-production harnesses and the migration
 * up() path. The store's LEGACY_SELF_MANAGED mirror may already have created
 * the table, so each statement is `IF NOT EXISTS` guarded.
 */
export const PRODUCTION_V13_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS revision_document_snapshots (
    deliverable_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    locator_kind TEXT NOT NULL CHECK (locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    locator_value TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_by_id TEXT,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(deliverable_id, project_id),
    UNIQUE(revision_id, source_document_id, content_hash),
    FOREIGN KEY (revision_id, project_id)
      REFERENCES canonical_revisions(revision_id, project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id)
      REFERENCES project_documents(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_project
    ON revision_document_snapshots(project_id, revision_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_revision
    ON revision_document_snapshots(revision_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_source
    ON revision_document_snapshots(source_document_id, project_id)`,
]);

function upV13(context: MigrationContext): void {
  applyV13RevisionDeliverableTables(context.database);
}

/**
 * Idempotent v13 table application for non-production harnesses that apply the
 * v4 registry DDL after store construction. Never throws when the table already
 * exists.
 */
export function applyV13RevisionDeliverableTables(database: DatabaseSync): void {
  for (const ddl of PRODUCTION_V13_DDL) database.exec(ddl);
}

function validateV13(context: MigrationContext): void {
  for (const name of PRODUCTION_V13_TABLE_NAMES) {
    const table = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    if (!table) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  for (const name of PRODUCTION_V13_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  // The snapshot table must enforce immutable SHA-256 content identity.
  const columns = context.database
    .prepare('PRAGMA table_info(revision_document_snapshots)')
    .all() as Array<{ name: string }>;
  for (const expected of [
    'deliverable_id',
    'project_id',
    'revision_id',
    'source_document_id',
    'category',
    'title',
    'file_name',
    'source_relative_path',
    'locator_kind',
    'locator_value',
    'content_hash',
    'size_bytes',
    'created_at',
  ]) {
    if (!columns.some((column) => column.name === expected)) {
      throw new Error(
        `Migration validation failed: revision_document_snapshots.${expected} missing.`,
      );
    }
  }
  const tableSql = context.database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('revision_document_snapshots') as { sql?: string } | undefined;
  if (
    !tableSql?.sql?.includes('content_hash TEXT NOT NULL') ||
    !tableSql?.sql?.includes('length(content_hash) = 64')
  ) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots content hash contract missing.',
    );
  }
  // The corrected source FK must reference the stable project_documents PRIMARY KEY.
  const sourceFk = context.database
    .prepare('PRAGMA foreign_key_list(revision_document_snapshots)')
    .all() as Array<{ from: string; table: string; to: string }>;
  const revisionFk = sourceFk.find((fk) => fk.table === 'canonical_revisions');
  const documentFk = sourceFk.find((fk) => fk.table === 'project_documents');
  if (!documentFk || documentFk.from !== 'source_document_id' || documentFk.to !== 'id') {
    throw new Error(
      'Migration validation failed: revision_document_snapshots source_document FK must reference project_documents(id).',
    );
  }
  if (!revisionFk) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots revision FK missing.',
    );
  }
}

function computeV13MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V13_MIGRATION_ID, ddl: PRODUCTION_V13_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 13 -> 14 generic immutable Package Deliverable membership (B2)
// ---------------------------------------------------------------------------

export const PRODUCTION_V14_MIGRATION_ID = 'production-13-14-generic-package-deliverables';
export const PRODUCTION_V14_MIGRATION_DESCRIPTION =
  'Add the generic immutable Issue Package Deliverable membership table (revision_package_deliverables) and migrate existing canonical package-output relations into it as the single writable package-membership authority.';

export const PRODUCTION_V14_TABLE_NAMES: readonly string[] = Object.freeze([
  'revision_package_deliverables',
]);

export const PRODUCTION_V14_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_revision_package_deliverables_package',
  'ix_revision_package_deliverables_source',
  'ix_revision_package_deliverables_revision',
]);

/**
 * Idempotent v14 DDL application for non-production harnesses and the migration
 * up() path. The store's LEGACY_SELF_MANAGED mirror may already have created
 * the table, so each statement is `IF NOT EXISTS` guarded.
 *
 * The generic table types membership by immutable deliverable source. There is
 * deliberately NO polymorphic foreign key: SQLite cannot express a composite FK
 * to two different source tables, so the migration enforces the valid half
 * (package + revision ownership) with real FKs and lets the store/service
 * enforce source existence, same-revision membership, supported source type and
 * uniqueness. `UNIQUE(package_id, source_type, source_id)` prevents duplicate
 * members; `UNIQUE(package_id, position)` preserves deterministic manifest
 * ordering. `source_id` is an opaque UUID TEXT column — no fake polymorphic FK,
 * no mutable ProjectDocument target.
 */
export const PRODUCTION_V14_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS revision_package_deliverables (
    package_id TEXT NOT NULL,
    source_type TEXT NOT NULL
      CHECK (source_type IN ('GeneratedOutput', 'DocumentSnapshot')),
    source_id TEXT NOT NULL CHECK (length(source_id) = 36),
    revision_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    provenance_classification TEXT NOT NULL
      CHECK (provenance_classification IN ('CANONICAL', 'LEGACY_VERIFIED', 'LEGACY_UNVERIFIED')),
    created_at TEXT NOT NULL,
    PRIMARY KEY(package_id, source_type, source_id),
    UNIQUE(package_id, position),
    FOREIGN KEY (package_id, revision_id)
      REFERENCES canonical_issue_packages(package_id, revision_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_revision_package_deliverables_package
    ON revision_package_deliverables(package_id, position, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_revision_package_deliverables_source
    ON revision_package_deliverables(source_type, source_id, package_id)`,
  `CREATE INDEX IF NOT EXISTS ix_revision_package_deliverables_revision
    ON revision_package_deliverables(revision_id, source_type, position)`,
]);

function upV14(context: MigrationContext): void {
  applyV14GenericPackageDeliverableTables(context.database);
  // Migrate existing canonical package-output memberships into the generic
  // deliverable authority. Canonical rows become 'GeneratedOutput' members
  // preserving position and provenance. Legacy (non-canonical) package-output
  // relations are NOT copied: they reference legacy outputs with no canonical
  // revision identity and remain readable only through the legacy relation.
  // Idempotent: the copy only inserts rows that do not already exist.
  context.database.exec(`
    INSERT OR IGNORE INTO revision_package_deliverables
      (package_id, source_type, source_id, revision_id, position,
       provenance_classification, created_at)
    SELECT po.package_id, 'GeneratedOutput', po.output_id, po.revision_id, po.position,
           po.provenance_classification, po.created_at
    FROM canonical_package_outputs po
    INNER JOIN canonical_issue_packages pkg
      ON pkg.package_id = po.package_id AND pkg.revision_id = po.revision_id
    WHERE pkg.provenance_classification = 'CANONICAL'
  `);
}

/**
 * Idempotent v14 table application for non-production harnesses that apply the
 * v4 registry DDL after store construction. Never throws when the table already
 * exists.
 */
export function applyV14GenericPackageDeliverableTables(database: DatabaseSync): void {
  for (const ddl of PRODUCTION_V14_DDL) database.exec(ddl);
}

function validateV14(context: MigrationContext): void {
  for (const name of PRODUCTION_V14_TABLE_NAMES) {
    const table = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    if (!table) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  for (const name of PRODUCTION_V14_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  const columns = context.database
    .prepare('PRAGMA table_info(revision_package_deliverables)')
    .all() as Array<{ name: string }>;
  for (const expected of [
    'package_id',
    'source_type',
    'source_id',
    'revision_id',
    'position',
    'provenance_classification',
    'created_at',
  ]) {
    if (!columns.some((column) => column.name === expected)) {
      throw new Error(
        `Migration validation failed: revision_package_deliverables.${expected} missing.`,
      );
    }
  }
  const tableSql = context.database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('revision_package_deliverables') as { sql?: string } | undefined;
  if (!tableSql?.sql?.includes("CHECK (source_type IN ('GeneratedOutput', 'DocumentSnapshot'))")) {
    throw new Error(
      'Migration validation failed: revision_package_deliverables source-type contract missing.',
    );
  }
  const fk = context.database
    .prepare('PRAGMA foreign_key_list(revision_package_deliverables)')
    .all() as Array<{ from: string; table: string; to: string }>;
  const packageFk = fk.find((entry) => entry.table === 'canonical_issue_packages');
  if (!packageFk || packageFk.from !== 'package_id') {
    throw new Error(
      'Migration validation failed: revision_package_deliverables package FK missing.',
    );
  }
}

function computeV14MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V14_MIGRATION_ID, ddl: PRODUCTION_V14_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 14 -> 15 Managed Artifact Persistence Foundation (AUTO-01A)
//
// Version 15 is strictly ADDITIVE. It introduces the owner-locked AUTO-00
// persistence foundation for future managed Auto-Capture:
//   - `managed_artifacts`    — PRIMARY stable identity for a managed working
//     artifact (AUTO-D01). ProjectDocument remains the operational /
//     compatibility record; the relationship is a nullable one-directional FK
//     from ManagedArtifact -> project_documents so the two never compete for
//     the same artifact identity.
//   - `artifact_versions`    immutable working-version records (AUTO-D01/D02).
//     The version SEQUENCE is presentation/order only; the `version_id` UUID is
//     the canonical identity. Deletion is RESTRICTed by historical provenance.
//   - `tool_contexts`        managed tool instance context (AUTO-D06). Multiple
//     concurrent contexts across projects/tools may coexist; there is no single
//     global active project. EXPIRED/CLOSED cannot authorize a new capture.
//   - `capture_ledger`       persistent recovery/audit cursor (AUTO-01A). Rows
//     are append-only audit truth and are never silently cascade-deleted.
//
// It also adds one nullable immutable provenance link on the existing
// `revision_document_snapshots` table: `source_artifact_version_id`, a UUID FK
// to `artifact_versions.version_id` (AUTO-D02). Existing/historical snapshots
// keep NULL (always valid). No table rebuild is required: adding a nullable
// FK column with no default is supported by SQLite ALTER TABLE and is the
// repository-native additive pattern (v5, v12).
//
// No backfill, no destructive rewrite, no fabricated history. No operational
// capture behavior is introduced here — this is persistence/domain foundation
// only.
// ---------------------------------------------------------------------------

export const PRODUCTION_V15_MIGRATION_ID =
  'production-14-15-managed-artifact-persistence-foundation';
export const PRODUCTION_V15_MIGRATION_DESCRIPTION =
  'Add the Managed Artifact persistence foundation: managed_artifacts, artifact_versions, tool_contexts, capture_ledger, plus nullable immutable source_artifact_version_id provenance on revision_document_snapshots.';

export const PRODUCTION_V15_TABLE_NAMES: readonly string[] = Object.freeze([
  'managed_artifacts',
  'artifact_versions',
  'tool_contexts',
  'capture_ledger',
]);

export const PRODUCTION_V15_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_managed_artifacts_project_type',
  'ux_managed_artifacts_one_project_document',
  'ix_artifact_versions_artifact',
  'ix_tool_contexts_project_state',
  'ix_capture_ledger_state',
  'ix_capture_ledger_project_source_hash',
]);

/**
 * Idempotent v15 DDL application for non-production harnesses and the migration
 * up() path. Each table statement is `IF NOT EXISTS` guarded; the snapshot
 * provenance column is added only when absent.
 */
export const PRODUCTION_V15_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS managed_artifacts (
    artifact_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL,
    source_tool TEXT NOT NULL,
    canonical_path TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('ACTIVE', 'FROZEN', 'ARCHIVED')),
    current_working_version INTEGER NOT NULL CHECK (current_working_version >= 0),
    project_document_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, canonical_path),
    -- Same-project ownership: the linked ProjectDocument must belong to the SAME
    -- project as the ManagedArtifact. project_id is NOT NULL, so ON DELETE
    -- SET NULL on the composite FK would violate NOT NULL; the repo-native
    -- composite-FK pattern (project_review_attachments) uses ON DELETE RESTRICT.
    FOREIGN KEY (project_document_id, project_id)
      REFERENCES project_documents(id, project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_managed_artifacts_project_type
    ON managed_artifacts(project_id, artifact_type)`,
  // AUTO-D01: at most one ManagedArtifact may be the managed identity for a
  // given operational ProjectDocument. Unmanaged rows (NULL) are unrestricted.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_managed_artifacts_one_project_document
    ON managed_artifacts(project_document_id) WHERE project_document_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS artifact_versions (
    version_id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    content_hash TEXT NOT NULL
      CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    locator_kind TEXT NOT NULL
      CHECK (locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    locator_value TEXT NOT NULL,
    capture_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(artifact_id, version),
    FOREIGN KEY (artifact_id)
      REFERENCES managed_artifacts(artifact_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_artifact_versions_artifact
    ON artifact_versions(artifact_id, version)`,
  `CREATE TABLE IF NOT EXISTS tool_contexts (
    tool_context_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    expected_artifact_type TEXT NOT NULL,
    mode TEXT NOT NULL,
    channel TEXT NOT NULL,
    state TEXT NOT NULL
      CHECK (state IN ('LIVE', 'REBOUND', 'EXPIRED', 'CLOSED')),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    expired_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_tool_contexts_project_state
    ON tool_contexts(project_id, state)`,
  `CREATE TABLE IF NOT EXISTS capture_ledger (
    capture_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tool_context_id TEXT,
    source_path TEXT NOT NULL,
    source_channel TEXT NOT NULL,
    expected_artifact_type TEXT NOT NULL,
    content_hash TEXT CHECK (
      content_hash IS NULL OR
      (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')
    ),
    size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
    state TEXT NOT NULL
      CHECK (state IN (
        'DETECTED', 'STABILIZING', 'STAGED', 'VERIFYING', 'ADMITTED',
        'MATERIALIZING', 'COMPLETED', 'UNRESOLVED', 'FAILED_RECOVERABLE',
        'DISCARDED'
      )),
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
    detected_at TEXT NOT NULL,
    staged_at TEXT,
    admitted_at TEXT,
    completed_at TEXT,
    error TEXT,
    final_artifact_id TEXT,
    final_version_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tool_context_id)
      REFERENCES tool_contexts(tool_context_id)
      ON UPDATE RESTRICT ON DELETE SET NULL,
    FOREIGN KEY (final_artifact_id)
      REFERENCES managed_artifacts(artifact_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (final_version_id)
      REFERENCES artifact_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_capture_ledger_state
    ON capture_ledger(state)`,
  `CREATE INDEX IF NOT EXISTS ix_capture_ledger_project_source_hash
    ON capture_ledger(project_id, source_path, content_hash)`,
]);

/** Idempotently adds the nullable snapshot provenance FK column (AUTO-D02). */
export function applyV15SnapshotProvenanceColumn(database: DatabaseSync): void {
  if (!hasColumn(database, 'revision_document_snapshots', 'source_artifact_version_id')) {
    database.exec(
      `ALTER TABLE revision_document_snapshots
       ADD COLUMN source_artifact_version_id TEXT
       REFERENCES artifact_versions(version_id)
       ON UPDATE RESTRICT ON DELETE RESTRICT`,
    );
  }
}

function upV15(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V15_DDL) context.database.exec(ddl);
  applyV15SnapshotProvenanceColumn(context.database);
}

function validateV15(context: MigrationContext): void {
  for (const name of PRODUCTION_V15_TABLE_NAMES) {
    const table = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    if (!table) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  for (const name of PRODUCTION_V15_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  const columns = context.database
    .prepare('PRAGMA table_info(revision_document_snapshots)')
    .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
  const provenance = columns.find((column) => column.name === 'source_artifact_version_id');
  if (!provenance || Number(provenance.notnull) !== 0 || provenance.dflt_value !== null) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots.source_artifact_version_id must be a nullable column without a default.',
    );
  }
}

function computeV15MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V15_MIGRATION_ID, ddl: PRODUCTION_V15_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 15 -> 16 Datasheet Structured Provenance Foundation (PACKAGES-E2E-05F)
//
// Version 16 re-binds the Revision DocumentSnapshot primary source authority.
// A snapshot may be sourced from ONE of two immutable authorities:
//
//   A. ProjectDocument            (source_document_id)
//   B. LuminaireAssetVersion      (source_asset_version_id)
//
// The v13 table created `source_document_id` as NOT NULL. This migration
// rebuilds the table so it becomes nullable and adds the nullable
// `source_asset_version_id` FK to `luminaire_asset_versions(id)`. Luminaire
// identity is DERIVED structurally (source_asset_version_id ->
// luminaire_asset_versions.luminaire_id -> project_luminaires.id); there is
// deliberately NO duplicated `source_luminaire_id` FK.
//
// A table CHECK enforces the source XOR invariant: every row must have exactly
// one primary source (never both NULL, never both populated). Deduplication
// moves to partial unique indexes because AssetVersion ID already identifies
// the exact Luminaire + asset version (dedupe by (revision_id,
// source_asset_version_id)), while document sources keep the historical
// (revision_id, source_document_id, content_hash) key.
//
// `source_artifact_version_id` (REV-01A ManagedArtifact provenance) is
// preserved EXACTLY — it is not a replacement for `source_asset_version_id`.
//
// Data migration is lossless and guess-free: every existing v15 row keeps its
// source_document_id and source_artifact_version_id exactly; new
// source_asset_version_id is NULL.
// ---------------------------------------------------------------------------

export const PRODUCTION_V16_MIGRATION_ID =
  'production-15-16-datasheet-structured-provenance-foundation';
export const PRODUCTION_V16_MIGRATION_DESCRIPTION =
  'Rebind Revision DocumentSnapshot source authority to a ProjectDocument XOR LuminaireAssetVersion model with a source XOR CHECK, dual partial unique dedupe indexes, and preserved ManagedArtifact provenance.';

export const PRODUCTION_V16_INDEX_NAMES: readonly string[] = Object.freeze([
  'ux_revision_document_snapshots_document_source',
  'ux_revision_document_snapshots_asset_source',
]);

const PRODUCTION_V16_SNAPSHOT_DDL = `CREATE TABLE revision_document_snapshots (
  deliverable_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  source_document_id TEXT,
  source_asset_version_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  locator_kind TEXT NOT NULL CHECK (locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
  locator_value TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_by_id TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL,
  source_artifact_version_id TEXT,
  -- Source XOR invariant: exactly one primary source authority per snapshot.
  CHECK (
    (source_document_id IS NOT NULL AND source_asset_version_id IS NULL)
    OR
    (source_document_id IS NULL AND source_asset_version_id IS NOT NULL)
  ),
  UNIQUE(deliverable_id, project_id),
  FOREIGN KEY (revision_id, project_id)
    REFERENCES canonical_revisions(revision_id, project_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (source_document_id)
    REFERENCES project_documents(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (source_asset_version_id)
    REFERENCES luminaire_asset_versions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  -- REV-01A ManagedArtifact provenance FK preserved from v15.
  FOREIGN KEY (source_artifact_version_id)
    REFERENCES artifact_versions(version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)`;

const PRODUCTION_V16_DDL: readonly string[] = Object.freeze([
  PRODUCTION_V16_SNAPSHOT_DDL,
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_document_snapshots_document_source\n  ON revision_document_snapshots(revision_id, source_document_id, content_hash)\n  WHERE source_document_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_document_snapshots_asset_source\n  ON revision_document_snapshots(revision_id, source_asset_version_id)\n  WHERE source_asset_version_id IS NOT NULL',
]);

/**
 * Idempotent v16 table rebuild for non-production harnesses and the migration
 * up() path. Transaction-neutral: it must run inside the caller's transaction
 * (the migration runner opens `BEGIN IMMEDIATE`; the harness registry helper
 * does too) so a failure rolls back atomically. A v15 table is rebuilt in place
 * (preserving every row); a table that already carries the v16 shape is left
 * untouched.
 */
export function applyV16SnapshotRebuild(database: DatabaseSync): void {
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'revision_document_snapshots'",
    )
    .get() as { name?: string } | undefined;
  if (!table) {
    for (const ddl of PRODUCTION_V16_DDL) database.exec(ddl);
    return;
  }
  const hasAssetColumn = (
    database.prepare('PRAGMA table_info(revision_document_snapshots)').all() as Array<{
      name: string;
    }>
  ).some((column) => column.name === 'source_asset_version_id');
  if (hasAssetColumn) return;
  database.exec('DROP TABLE IF EXISTS revision_document_snapshots_v16_new');
  database.exec(`CREATE TABLE revision_document_snapshots_v16_new (
    deliverable_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    source_document_id TEXT,
    source_asset_version_id TEXT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    locator_kind TEXT NOT NULL CHECK (locator_kind IN ('PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN')),
    locator_value TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    created_by_id TEXT,
    created_by_name TEXT,
    created_at TEXT NOT NULL,
    source_artifact_version_id TEXT,
    CHECK (
      (source_document_id IS NOT NULL AND source_asset_version_id IS NULL)
      OR
      (source_document_id IS NULL AND source_asset_version_id IS NOT NULL)
    ),
    UNIQUE(deliverable_id, project_id),
    FOREIGN KEY (revision_id, project_id)
      REFERENCES canonical_revisions(revision_id, project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id)
      REFERENCES project_documents(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (source_asset_version_id)
      REFERENCES luminaire_asset_versions(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    -- REV-01A ManagedArtifact provenance FK preserved from v15.
    FOREIGN KEY (source_artifact_version_id)
      REFERENCES artifact_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
    )`);
  database.exec(`INSERT INTO revision_document_snapshots_v16_new
    (deliverable_id, project_id, revision_id, source_document_id, source_asset_version_id,
     category, title, file_name, source_relative_path, locator_kind, locator_value,
     content_hash, size_bytes, created_by_id, created_by_name, created_at,
     source_artifact_version_id)
    SELECT deliverable_id, project_id, revision_id, source_document_id, NULL,
           category, title, file_name, source_relative_path, locator_kind, locator_value,
           content_hash, size_bytes, created_by_id, created_by_name, created_at,
           source_artifact_version_id
    FROM revision_document_snapshots`);
  database.exec('DROP TABLE revision_document_snapshots');
  database.exec(
    'ALTER TABLE revision_document_snapshots_v16_new RENAME TO revision_document_snapshots',
  );
  for (const index of [
    'ix_revision_document_snapshots_project',
    'ix_revision_document_snapshots_revision',
    'ix_revision_document_snapshots_source',
  ]) {
    database.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  database.exec(
    'CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_project\n  ON revision_document_snapshots(project_id, revision_id, created_at)',
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_revision\n  ON revision_document_snapshots(revision_id, created_at)',
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS ix_revision_document_snapshots_source\n  ON revision_document_snapshots(source_document_id, project_id)',
  );
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_document_snapshots_document_source\n  ON revision_document_snapshots(revision_id, source_document_id, content_hash)\n  WHERE source_document_id IS NOT NULL',
  );
  database.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_document_snapshots_asset_source\n  ON revision_document_snapshots(revision_id, source_asset_version_id)\n  WHERE source_asset_version_id IS NOT NULL',
  );
}

function upV16(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 15);
  applyV16SnapshotRebuild(context.database);
}

function validateV16(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 16);
  const columns = context.database
    .prepare('PRAGMA table_info(revision_document_snapshots)')
    .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
  const documentColumn = columns.find((column) => column.name === 'source_document_id');
  const assetColumn = columns.find((column) => column.name === 'source_asset_version_id');
  const artifactColumn = columns.find((column) => column.name === 'source_artifact_version_id');
  if (
    !documentColumn ||
    Number(documentColumn.notnull) !== 0 ||
    documentColumn.dflt_value !== null
  ) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots.source_document_id must be a nullable column without a default.',
    );
  }
  if (!assetColumn || Number(assetColumn.notnull) !== 0 || assetColumn.dflt_value !== null) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots.source_asset_version_id must be a nullable column without a default.',
    );
  }
  if (!artifactColumn || Number(artifactColumn.notnull) !== 0) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots.source_artifact_version_id must be preserved as a nullable column.',
    );
  }
  const tableSql = context.database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('revision_document_snapshots') as { sql?: string } | undefined;
  if (
    !tableSql?.sql?.includes(
      'source_document_id IS NOT NULL AND source_asset_version_id IS NULL',
    ) ||
    !tableSql?.sql?.includes('source_document_id IS NULL AND source_asset_version_id IS NOT NULL')
  ) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots source XOR CHECK contract missing.',
    );
  }
  const fk = context.database
    .prepare('PRAGMA foreign_key_list(revision_document_snapshots)')
    .all() as Array<{ from: string; table: string; to: string }>;
  const documentFk = fk.find((entry) => entry.table === 'project_documents');
  const assetFk = fk.find((entry) => entry.table === 'luminaire_asset_versions');
  const artifactFk = fk.find((entry) => entry.table === 'artifact_versions');
  if (!documentFk || documentFk.from !== 'source_document_id' || documentFk.to !== 'id') {
    throw new Error(
      'Migration validation failed: revision_document_snapshots source_document FK must reference project_documents(id).',
    );
  }
  if (!assetFk || assetFk.from !== 'source_asset_version_id' || assetFk.to !== 'id') {
    throw new Error(
      'Migration validation failed: revision_document_snapshots source_asset FK must reference luminaire_asset_versions(id).',
    );
  }
  if (
    !artifactFk ||
    artifactFk.from !== 'source_artifact_version_id' ||
    artifactFk.to !== 'version_id'
  ) {
    throw new Error(
      'Migration validation failed: revision_document_snapshots source_artifact FK must reference artifact_versions(version_id).',
    );
  }
  for (const index of [
    'ix_revision_document_snapshots_project',
    'ix_revision_document_snapshots_revision',
    'ix_revision_document_snapshots_source',
    ...PRODUCTION_V16_INDEX_NAMES,
  ]) {
    const found = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(index);
    if (!found) throw new Error(`Migration validation failed: ${index} missing.`);
  }
}

function computeV16MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V16_MIGRATION_ID, ddl: PRODUCTION_V16_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 16 -> 17 Safe Revision Delete (P2C-03)
//
// Version 17 is STRICTLY ADDITIVE: it creates ONE durable table,
// `revision_delete_operations`, which serves BOTH purposes required by the
// Safe Revision Delete aggregate:
//
//   1. deletion recovery journal — an in-flight (PLANNED / ARCHIVING / ARCHIVED
//      / DB_COMMITTED / FAILED_RECOVERABLE) delete operation records its exact
//      artifact manifest so a retry reuses the SAME operation id and manifest.
//   2. consumed-sequence tombstone authority — a COMPLETED operation is the
//      permanent record that a Revision UUID and its revision_sequence were
//      consumed, so the Revision sequence allocator never accidentally reuses a
//      deleted sequence number.
//
// There is deliberately NO second tombstone table and NO Package lifecycle
// state reuse. The operation row is a durable reference to the deleted
// Revision by UUID/project (NOT a RESTRICT FK) so it survives the deletion of
// the canonical_revisions row: deleting the Revision must leave the tombstone
// intact.
//
// `artifact_manifest_json` is the exact, persisted deletion manifest (owned
// artifact records with canonical row id, source type, locator, expected hash,
// size, and archive destination). It is written BEFORE any filesystem
// mutation so an interrupted/retried delete converges without guessing.
//
// No backfill, no destructive rewrite, no fabricated history. Foreign keys
// remain enabled.
// ---------------------------------------------------------------------------

export const PRODUCTION_V17_MIGRATION_ID = 'production-16-17-safe-revision-delete';
export const PRODUCTION_V17_MIGRATION_DESCRIPTION =
  'Add the Safe Revision Delete recovery-journal / consumed-sequence tombstone table (revision_delete_operations) with an explicit delete state machine and one-operation-per-Revision identity.';

export const PRODUCTION_V17_TABLE_NAMES: readonly string[] = Object.freeze([
  'revision_delete_operations',
]);

export const PRODUCTION_V17_INDEX_NAMES: readonly string[] = Object.freeze([
  'ux_revision_delete_operations_revision',
  'ix_revision_delete_operations_project_state',
]);

export const PRODUCTION_V17_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS revision_delete_operations (
    operation_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    -- Deleted Revision UUID. UNIQUE(revision_id) enforces the ONE durable
    -- delete operation per Revision identity invariant (retry reuses it).
    revision_id TEXT NOT NULL,
    revision_sequence INTEGER NOT NULL CHECK (revision_sequence >= 1),
    revision_label TEXT NOT NULL,
    actor_id TEXT,
    actor_name_snapshot TEXT,
    state TEXT NOT NULL
      CHECK (state IN (
        'PLANNED', 'ARCHIVING', 'ARCHIVED', 'DB_COMMITTED', 'COMPLETED',
        'FAILED_RECOVERABLE'
      )),
    failure_reason TEXT,
    -- Exact deletion manifest persisted BEFORE any filesystem mutation so a
    -- retry re-reads the SAME manifest and never guesses.
    artifact_manifest_json TEXT NOT NULL CHECK (json_valid(artifact_manifest_json)),
    document_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (document_snapshot_count >= 0),
    datasheet_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (datasheet_snapshot_count >= 0),
    generated_output_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_output_count >= 0),
    created_at TEXT NOT NULL,
    archive_started_at TEXT,
    db_committed_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_delete_operations_revision\n  ON revision_delete_operations(revision_id)',
  'CREATE INDEX IF NOT EXISTS ix_revision_delete_operations_project_state\n  ON revision_delete_operations(project_id, state, created_at)',
]);

/** Idempotent v17 DDL application for non-production harnesses and the migration up() path. */
export function applyV17RevisionDeleteTable(database: DatabaseSync): void {
  for (const ddl of PRODUCTION_V17_DDL) database.exec(ddl);
}

function upV17(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 16);
  applyV17RevisionDeleteTable(context.database);
}

function validateV17(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 17);
  for (const name of PRODUCTION_V17_TABLE_NAMES) {
    const table = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    if (!table) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  const columns = context.database
    .prepare('PRAGMA table_info(revision_delete_operations)')
    .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
  const columnNames = new Set(columns.map((column) => column.name));
  for (const required of [
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
    if (!columnNames.has(required)) {
      throw new Error(
        `Migration validation failed: revision_delete_operations missing ${required}.`,
      );
    }
  }
  for (const name of PRODUCTION_V17_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
  // Foreign keys must remain enabled after migration.
  const foreignKeysEnabled = context.database.prepare('PRAGMA foreign_keys').get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeysEnabled?.foreign_keys !== 1) {
    throw new Error('Migration validation failed: foreign keys are not enabled.');
  }
}

function computeV17MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V17_MIGRATION_ID, ddl: PRODUCTION_V17_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 17 -> 18 Revision Number Reuse (P2C-04)
//
// Strictly additive structured provenance on the existing permanent delete
// operation. There is deliberately no FK to canonical_revisions: a reused
// Revision may itself be safely deleted during an immediate repeated-reuse
// chain, while the earlier tombstone and its reuse evidence must remain
// immutable and non-null. The partial UNIQUE index still proves that one new
// Revision identity can originate from at most one delete operation.
// ---------------------------------------------------------------------------

export const PRODUCTION_V18_MIGRATION_ID = 'production-17-18-revision-number-reuse';
export const PRODUCTION_V18_MIGRATION_DESCRIPTION =
  'Add structured one-claim Revision number reuse provenance to revision_delete_operations.';

export const PRODUCTION_V18_COLUMN_NAMES: readonly string[] = Object.freeze([
  'reused_by_revision_id',
  'reused_at',
  'reused_by_actor_id',
  'reused_by_actor_name',
  'reuse_reason',
]);

export const PRODUCTION_V18_INDEX_NAMES: readonly string[] = Object.freeze([
  'ux_revision_delete_operations_reused_revision',
]);

export const PRODUCTION_V18_DDL: readonly string[] = Object.freeze([
  'ALTER TABLE revision_delete_operations ADD COLUMN reused_by_revision_id TEXT',
  'ALTER TABLE revision_delete_operations ADD COLUMN reused_at TEXT',
  'ALTER TABLE revision_delete_operations ADD COLUMN reused_by_actor_id TEXT',
  'ALTER TABLE revision_delete_operations ADD COLUMN reused_by_actor_name TEXT',
  'ALTER TABLE revision_delete_operations ADD COLUMN reuse_reason TEXT',
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_delete_operations_reused_revision
    ON revision_delete_operations(reused_by_revision_id)
    WHERE reused_by_revision_id IS NOT NULL`,
]);

/** Idempotent helper for non-production harnesses that intentionally assemble current schema. */
export function applyV18RevisionReuseColumns(database: DatabaseSync): void {
  const existing = new Set(
    (
      database.prepare('PRAGMA table_info(revision_delete_operations)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  for (const ddl of PRODUCTION_V18_DDL) {
    const match = /ADD COLUMN ([a-z_]+)/i.exec(ddl);
    if (match && existing.has(match[1]!)) continue;
    database.exec(ddl);
  }
}

function upV18(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 17);
  applyV18RevisionReuseColumns(context.database);
}

function validateV18(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 18);
  const columns = context.database
    .prepare('PRAGMA table_info(revision_delete_operations)')
    .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
  for (const required of PRODUCTION_V18_COLUMN_NAMES) {
    const column = columns.find((candidate) => candidate.name === required);
    if (!column || column.notnull !== 0 || column.dflt_value !== null) {
      throw new Error(
        `Migration validation failed: nullable revision_delete_operations.${required} missing.`,
      );
    }
  }
  for (const name of PRODUCTION_V18_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
}

function computeV18MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V18_MIGRATION_ID, ddl: PRODUCTION_V18_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 18 -> 19 Canonical Revision Purpose + Internal Note (P2C-07)
//
// Strictly additive nullable metadata on the canonical Revision authority.
// Historical rows remain NULL: compatibility summary/changeLog fields are not
// semantic authority and are deliberately not mapped or backfilled.
// ---------------------------------------------------------------------------

export const PRODUCTION_V19_MIGRATION_ID = 'production-18-19-revision-metadata';
export const PRODUCTION_V19_MIGRATION_DESCRIPTION =
  'Add nullable canonical Revision Purpose and Internal Note metadata.';

export const PRODUCTION_V19_COLUMN_NAMES: readonly string[] = Object.freeze([
  'purpose',
  'internal_note',
]);

export const PRODUCTION_V19_DDL: readonly string[] = Object.freeze([
  'ALTER TABLE canonical_revisions ADD COLUMN purpose TEXT',
  'ALTER TABLE canonical_revisions ADD COLUMN internal_note TEXT',
]);

/** Idempotent helper for non-production harnesses that assemble current schema. */
export function applyV19RevisionMetadataColumns(database: DatabaseSync): void {
  const existing = new Set(
    (
      database.prepare('PRAGMA table_info(canonical_revisions)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  for (const ddl of PRODUCTION_V19_DDL) {
    const match = /ADD COLUMN ([a-z_]+)/i.exec(ddl);
    if (match && existing.has(match[1]!)) continue;
    database.exec(ddl);
  }
}

function upV19(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 18);
  applyV19RevisionMetadataColumns(context.database);
}

function validateV19(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 19);
  const columns = context.database
    .prepare('PRAGMA table_info(canonical_revisions)')
    .all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  for (const required of PRODUCTION_V19_COLUMN_NAMES) {
    const column = columns.find((candidate) => candidate.name === required);
    if (!column || column.notnull !== 0 || column.dflt_value !== null) {
      throw new Error(
        `Migration validation failed: nullable canonical_revisions.${required} missing.`,
      );
    }
  }
}

function computeV19MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V19_MIGRATION_ID, ddl: PRODUCTION_V19_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 19 -> 20 Automation Revision Binding Audit (Phase 4A)
//
// Strictly additive nullable audit snapshots. Historical rows remain NULL.
// Revision/document columns deliberately have no foreign key: later lifecycle
// operations must not erase or rebind the captured historical identities.
// ---------------------------------------------------------------------------

export const PRODUCTION_V20_MIGRATION_ID = 'production-19-20-automation-revision-binding-audit';
export const PRODUCTION_V20_MIGRATION_DESCRIPTION =
  'Add immutable automation Revision/source bindings and durable routing-decision audit fields.';

export const PRODUCTION_V20_TOOL_CONTEXT_COLUMN_NAMES: readonly string[] = Object.freeze([
  'target_revision_id',
  'source_document_id',
]);
export const PRODUCTION_V20_CAPTURE_LEDGER_COLUMN_NAMES: readonly string[] = Object.freeze([
  'target_revision_id',
  'routing_decision',
  'routing_reason',
  'decided_at',
  'decided_by_id',
  'decided_by_name',
]);
export const PRODUCTION_V20_INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_capture_ledger_project_revision_state',
]);

export const PRODUCTION_V20_DDL: readonly string[] = Object.freeze([
  'ALTER TABLE tool_contexts ADD COLUMN target_revision_id TEXT',
  'ALTER TABLE tool_contexts ADD COLUMN source_document_id TEXT',
  'ALTER TABLE capture_ledger ADD COLUMN target_revision_id TEXT',
  `ALTER TABLE capture_ledger ADD COLUMN routing_decision TEXT
    CHECK (routing_decision IS NULL OR routing_decision IN ('AUTO_APPROVED', 'USER_CONFIRMED', 'REJECTED'))`,
  'ALTER TABLE capture_ledger ADD COLUMN routing_reason TEXT',
  'ALTER TABLE capture_ledger ADD COLUMN decided_at TEXT',
  'ALTER TABLE capture_ledger ADD COLUMN decided_by_id TEXT',
  'ALTER TABLE capture_ledger ADD COLUMN decided_by_name TEXT',
  `CREATE INDEX IF NOT EXISTS ix_capture_ledger_project_revision_state
    ON capture_ledger(project_id, target_revision_id, state)`,
]);

/** Idempotent helper for isolated fixtures that intentionally assemble v20. */
export function applyV20AutomationRevisionBindingAudit(database: DatabaseSync): void {
  const columnsByTable = new Map<string, Set<string>>();
  for (const table of ['tool_contexts', 'capture_ledger'] as const) {
    columnsByTable.set(
      table,
      new Set(
        (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      ),
    );
  }
  for (const ddl of PRODUCTION_V20_DDL) {
    const match = /ALTER TABLE ([a-z_]+) ADD COLUMN ([a-z_]+)/i.exec(ddl);
    if (match && columnsByTable.get(match[1]!)?.has(match[2]!)) continue;
    database.exec(ddl);
  }
}

function upV20(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 19);
  applyV20AutomationRevisionBindingAudit(context.database);
}

function validateNullableColumns(
  database: DatabaseSync,
  table: string,
  names: readonly string[],
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  for (const required of names) {
    const column = columns.find((candidate) => candidate.name === required);
    if (!column || column.notnull !== 0 || column.dflt_value !== null) {
      throw new Error(`Migration validation failed: nullable ${table}.${required} missing.`);
    }
  }
}

function validateV20(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 20);
  validateNullableColumns(
    context.database,
    'tool_contexts',
    PRODUCTION_V20_TOOL_CONTEXT_COLUMN_NAMES,
  );
  validateNullableColumns(
    context.database,
    'capture_ledger',
    PRODUCTION_V20_CAPTURE_LEDGER_COLUMN_NAMES,
  );
  for (const name of PRODUCTION_V20_INDEX_NAMES) {
    const index = context.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(name);
    if (!index) throw new Error(`Migration validation failed: ${name} missing.`);
  }
}

function computeV20MigrationChecksum(): string {
  return createHash('sha256')
    .update(JSON.stringify({ id: PRODUCTION_V20_MIGRATION_ID, ddl: PRODUCTION_V20_DDL }), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// 3 -> 4 canonical Output Registry migration (P2-FND-04)
// ---------------------------------------------------------------------------

export const PRODUCTION_V4_MIGRATION_ID = 'production-3-4-canonical-output-registry';
export const PRODUCTION_V4_MIGRATION_DESCRIPTION =
  'Add the canonical Revision, row-based Output, Issue Package, and immutable Output Template registry with conservative legacy provenance.';

const PRODUCTION_V4_BUILTIN_CREATED_BY = 'SYSTEM_P2_FND_04_MIGRATION';
const LEGACY_RELATION_UNVERIFIED = 'LEGACY_RELATION_UNVERIFIED';
const LEGACY_PACKAGE_SEQUENCE_AMBIGUOUS = 'LEGACY_PACKAGE_SEQUENCE_AMBIGUOUS';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type V4SqlRow = Record<string, unknown>;

function canonicalizeV4Json(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Version-4 persisted JSON numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalizeV4Json(item));
  if (typeof value !== 'object') {
    throw new Error('Version-4 persisted registry values must be JSON-compatible.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Version-4 persisted registry objects must be plain JSON objects.');
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) {
      throw new Error('Version-4 persisted registry values must not contain undefined.');
    }
    result[key] = canonicalizeV4Json(item);
  }
  return result;
}

function canonicalV4Json(value: unknown): string {
  return JSON.stringify(canonicalizeV4Json(value));
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface ProductionV4BuiltInRegistration {
  readonly templateId: string;
  readonly versionId: string;
  readonly family: string;
  readonly origin: string;
  readonly state: string;
  readonly displayName: string;
  readonly definitionJson: string;
  readonly definitionHash: string;
}

/** Canonical registration payload sourced only from the P2-FND-03 domain definitions. */
export const PRODUCTION_V4_BUILTIN_REGISTRATIONS: readonly ProductionV4BuiltInRegistration[] =
  Object.freeze(
    builtInTemplateVersions.map((definition) => {
      const definitionJson = canonicalV4Json(definition);
      return Object.freeze({
        templateId: definition.templateId,
        versionId: definition.versionId,
        family: definition.family,
        origin: definition.origin,
        state: definition.state,
        displayName: definition.displayName,
        definitionJson,
        definitionHash: sha256Text(definitionJson),
      });
    }),
  );

export interface ProductionV4LegacyExportMapping {
  readonly sourceField: string;
  readonly fallbackSourceField: string | null;
  readonly manifestSuffix: string;
  readonly outputFamily: 'LuminaireSchedule' | 'TechnicalBoq';
  readonly outputFormat: 'XLSX' | 'PDF';
}

/** Only the four authoritative fixed export fields are imported; datasheets are excluded. */
export const PRODUCTION_V4_LEGACY_EXPORT_MAPPINGS: readonly ProductionV4LegacyExportMapping[] =
  Object.freeze([
    Object.freeze({
      sourceField: 'schedule_excel_path',
      fallbackSourceField: 'excel_path',
      manifestSuffix: 'schedule-excel',
      outputFamily: 'LuminaireSchedule',
      outputFormat: 'XLSX',
    }),
    Object.freeze({
      sourceField: 'schedule_pdf_path',
      fallbackSourceField: 'pdf_path',
      manifestSuffix: 'schedule-pdf',
      outputFamily: 'LuminaireSchedule',
      outputFormat: 'PDF',
    }),
    Object.freeze({
      sourceField: 'boq_excel_path',
      fallbackSourceField: null,
      manifestSuffix: 'boq-excel',
      outputFamily: 'TechnicalBoq',
      outputFormat: 'XLSX',
    }),
    Object.freeze({
      sourceField: 'boq_pdf_path',
      fallbackSourceField: null,
      manifestSuffix: 'boq-pdf',
      outputFamily: 'TechnicalBoq',
      outputFormat: 'PDF',
    }),
  ]);

/** Checksum-visible legacy policy. Changing any relationship rule requires a new migration. */
export const PRODUCTION_V4_LEGACY_POLICY = Object.freeze({
  builtInCreatedBy: PRODUCTION_V4_BUILTIN_CREATED_BY,
  revisionIdentity: 'preserve-valid-source-uuid-otherwise-sha256-uuid-v8',
  exportIdentity: 'sha256-uuid-v8-from-export-id-and-actual-source-field',
  scheduleFallback:
    'use-excel_path-or-pdf_path-only-when-corresponding-schedule-field-is-blank-and-record-actual-source-field',
  exportRelationEvidence:
    'exactly-one-project-revision-with-same-project-source-type-ProjectExport-and-source-reference-equal-export-id',
  packageRelationEvidence: 'exact-manifest-export-item-ids-with-one-shared-verified-revision',
  packageSequenceEvidence: 'unique-existing-reissue-number-within-one-verified-revision',
  ambiguousRelation: 'LEGACY_UNVERIFIED-with-null-canonical-relation',
  unverifiedReason: LEGACY_RELATION_UNVERIFIED,
  ambiguousPackageSequenceReason: LEGACY_PACKAGE_SEQUENCE_AMBIGUOUS,
  templateProvenance: 'LEGACY_UNKNOWN',
  datasheetRegistry: 'excluded',
});

function deterministicV4Uuid(kind: string, ...identityParts: readonly string[]): string {
  const digest = sha256Text(canonicalV4Json({ namespace: 'scli:p2-fnd-04', kind, identityParts }));
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const uuidHex = `${digest.slice(0, 12)}8${digest.slice(13, 16)}${variant}${digest.slice(17, 32)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`;
}

function preserveUuidOrDerive(kind: string, sourceId: string): string {
  return UUID_PATTERN.test(sourceId) ? sourceId.toLowerCase() : deterministicV4Uuid(kind, sourceId);
}

function requireLegacyText(row: V4SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`Version-4 legacy migration requires text column ${column}.`);
  }
  return value;
}

function requireLegacyInteger(row: V4SqlRow, column: string): number {
  const value = Number(row[column]);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Version-4 legacy migration requires integer column ${column}.`);
  }
  return value;
}

function assertV4RowMatches(
  row: V4SqlRow | undefined,
  expected: Readonly<Record<string, unknown>>,
  label: string,
): void {
  if (!row) throw new Error(`Version-4 migration validation failed: missing ${label}.`);
  for (const [column, expectedValue] of Object.entries(expected)) {
    const actualValue = row[column];
    const equal =
      typeof expectedValue === 'number'
        ? Number(actualValue) === expectedValue
        : actualValue === expectedValue;
    if (!equal) {
      throw new Error(
        `Version-4 migration validation failed: ${label} column ${column} does not match its deterministic source.`,
      );
    }
  }
}

function registerV4BuiltIns(
  database: DatabaseSync,
  createdAt: string,
  insertMissing: boolean,
): void {
  const identities = new Set<string>();
  for (let index = 0; index < builtInTemplateVersions.length; index += 1) {
    const definition: OutputTemplateDefinition = builtInTemplateVersions[index]!;
    const registration = PRODUCTION_V4_BUILTIN_REGISTRATIONS[index]!;
    validateTemplateVersion(definition);
    const identity = `${registration.templateId}\u0000${registration.versionId}`;
    if (identities.has(identity)) {
      throw new Error('Version-4 built-in Template ID and Version ID identities must be unique.');
    }
    identities.add(identity);

    let template = database
      .prepare('SELECT * FROM output_templates WHERE template_id = ?')
      .get(registration.templateId) as V4SqlRow | undefined;
    if (!template && insertMissing) {
      database
        .prepare(
          `INSERT INTO output_templates
           (template_id, family, origin, state, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          registration.templateId,
          registration.family,
          registration.origin,
          registration.state,
          registration.displayName,
          createdAt,
          createdAt,
        );
      template = database
        .prepare('SELECT * FROM output_templates WHERE template_id = ?')
        .get(registration.templateId) as V4SqlRow | undefined;
    }
    assertV4RowMatches(
      template,
      {
        template_id: registration.templateId,
        family: registration.family,
        origin: registration.origin,
        state: registration.state,
        display_name: registration.displayName,
      },
      `built-in Template ${registration.templateId}`,
    );

    let version = database
      .prepare(
        `SELECT * FROM output_template_versions
         WHERE template_id = ? AND version_id = ?`,
      )
      .get(registration.templateId, registration.versionId) as V4SqlRow | undefined;
    if (!version && insertMissing) {
      database
        .prepare(
          `INSERT INTO output_template_versions
           (template_id, version_id, definition_json, definition_hash, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          registration.templateId,
          registration.versionId,
          registration.definitionJson,
          registration.definitionHash,
          createdAt,
          PRODUCTION_V4_BUILTIN_CREATED_BY,
        );
      version = database
        .prepare(
          `SELECT * FROM output_template_versions
           WHERE template_id = ? AND version_id = ?`,
        )
        .get(registration.templateId, registration.versionId) as V4SqlRow | undefined;
    }
    assertV4RowMatches(
      version,
      {
        template_id: registration.templateId,
        version_id: registration.versionId,
        definition_json: registration.definitionJson,
        definition_hash: registration.definitionHash,
        created_by: PRODUCTION_V4_BUILTIN_CREATED_BY,
      },
      `built-in Template Version ${registration.templateId}/${registration.versionId}`,
    );
  }

  const builtInTemplates = database
    .prepare(
      "SELECT template_id FROM output_templates WHERE origin = 'builtin' ORDER BY template_id",
    )
    .all() as Array<{ template_id: string }>;
  const expectedTemplateIds = PRODUCTION_V4_BUILTIN_REGISTRATIONS.map(
    (item) => item.templateId,
  ).sort();
  if (
    canonicalV4Json(builtInTemplates.map((row) => row.template_id)) !==
    canonicalV4Json(expectedTemplateIds)
  ) {
    throw new Error('Version-4 migration validation failed: built-in Template inventory differs.');
  }
  const builtInVersions = database
    .prepare(
      `SELECT v.template_id, v.version_id
       FROM output_template_versions v
       INNER JOIN output_templates t ON t.template_id = v.template_id
       WHERE t.origin = 'builtin'
       ORDER BY v.template_id, v.version_id`,
    )
    .all() as Array<{ template_id: string; version_id: string }>;
  const expectedVersions = PRODUCTION_V4_BUILTIN_REGISTRATIONS.map(
    (item) => `${item.templateId}\u0000${item.versionId}`,
  ).sort();
  if (
    canonicalV4Json(builtInVersions.map((row) => `${row.template_id}\u0000${row.version_id}`)) !==
    canonicalV4Json(expectedVersions)
  ) {
    throw new Error(
      'Version-4 migration validation failed: built-in Template Version inventory differs.',
    );
  }
}

interface LegacyLocator {
  readonly kind: 'LEGACY_ABSOLUTE' | 'LEGACY_UNKNOWN';
  readonly value: string | null;
  readonly absolutePath: string | null;
}

function classifyLegacyLocator(rawPath: string): LegacyLocator {
  const absolute = /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(rawPath);
  return absolute
    ? { kind: 'LEGACY_ABSOLUTE', value: null, absolutePath: rawPath }
    : { kind: 'LEGACY_UNKNOWN', value: rawPath || null, absolutePath: null };
}

function migrateLegacyRevisions(database: DatabaseSync, insertMissing: boolean): void {
  const rows = database
    .prepare(
      `SELECT id, project_id, revision_number, issued_at, created_at, updated_at
       FROM project_revisions ORDER BY project_id, revision_number, id`,
    )
    .all() as V4SqlRow[];
  for (const source of rows) {
    const sourceId = requireLegacyText(source, 'id');
    const projectId = requireLegacyText(source, 'project_id');
    const sequence = requireLegacyInteger(source, 'revision_number');
    const revisionId = preserveUuidOrDerive('legacy-revision', sourceId);
    const createdAt = requireLegacyText(source, 'created_at');
    const updatedAt = requireLegacyText(source, 'updated_at');
    const issuedAt = source.issued_at === null ? null : requireLegacyText(source, 'issued_at');
    const expected = {
      revision_id: revisionId,
      project_id: projectId,
      revision_sequence: sequence,
      revision_label: `REV_${String(sequence).padStart(2, '0')}`,
      lifecycle_state: 'LEGACY_IMPORTED',
      project_snapshot_json: null,
      luminaire_snapshot_json: null,
      snapshot_hash: null,
      created_by_id: null,
      created_by_name: null,
      provenance_classification: 'LEGACY_VERIFIED',
      legacy_source_id: sourceId,
      failure_reason: null,
      created_at: createdAt,
      finalized_at: issuedAt,
      updated_at: updatedAt,
    } as const;
    let existing = database
      .prepare('SELECT * FROM canonical_revisions WHERE legacy_source_id = ?')
      .get(sourceId) as V4SqlRow | undefined;
    if (!existing && insertMissing) {
      database
        .prepare(
          `INSERT INTO canonical_revisions
           (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
            project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
            created_by_name, provenance_classification, legacy_source_id, failure_reason,
            created_at, finalized_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          revisionId,
          projectId,
          sequence,
          expected.revision_label,
          expected.lifecycle_state,
          expected.provenance_classification,
          sourceId,
          createdAt,
          issuedAt,
          updatedAt,
        );
      existing = database
        .prepare('SELECT * FROM canonical_revisions WHERE legacy_source_id = ?')
        .get(sourceId) as V4SqlRow | undefined;
    }
    assertV4RowMatches(existing, expected, `legacy Revision ${sourceId}`);
  }
}

function verifiedRevisionForExport(
  database: DatabaseSync,
  exportId: string,
  projectId: string,
): string | null {
  const matches = database
    .prepare(
      `SELECT id FROM project_revisions
       WHERE project_id = ? AND source_type = 'ProjectExport' AND source_reference = ?
       ORDER BY id`,
    )
    .all(projectId, exportId) as Array<{ id: string }>;
  if (matches.length !== 1) return null;
  const canonical = database
    .prepare(
      `SELECT revision_id FROM canonical_revisions
       WHERE legacy_source_id = ? AND project_id = ? AND provenance_classification = 'LEGACY_VERIFIED'`,
    )
    .get(matches[0]!.id, projectId) as { revision_id?: string } | undefined;
  return canonical?.revision_id ?? null;
}

function migrateLegacyOutputs(database: DatabaseSync, insertMissing: boolean): void {
  const fields = [
    ...new Set(
      PRODUCTION_V4_LEGACY_EXPORT_MAPPINGS.flatMap((item) =>
        item.fallbackSourceField
          ? [item.sourceField, item.fallbackSourceField]
          : [item.sourceField],
      ),
    ),
  ].join(', ');
  const exports = database
    .prepare(
      `SELECT id, project_id, created_at, ${fields}
       FROM project_exports ORDER BY project_id, created_at, id`,
    )
    .all() as V4SqlRow[];
  for (const source of exports) {
    const exportId = requireLegacyText(source, 'id');
    const projectId = requireLegacyText(source, 'project_id');
    const createdAt = requireLegacyText(source, 'created_at');
    const revisionId = verifiedRevisionForExport(database, exportId, projectId);
    for (const mapping of PRODUCTION_V4_LEGACY_EXPORT_MAPPINGS) {
      const primaryPath = requireLegacyText(source, mapping.sourceField);
      const fallbackPath = mapping.fallbackSourceField
        ? requireLegacyText(source, mapping.fallbackSourceField)
        : '';
      const actualSourceField =
        primaryPath.trim() || !mapping.fallbackSourceField
          ? mapping.sourceField
          : mapping.fallbackSourceField;
      const pathValue = primaryPath.trim() ? primaryPath : fallbackPath;
      if (!pathValue.trim()) continue;
      const locator = classifyLegacyLocator(pathValue);
      const outputId = deterministicV4Uuid('legacy-output', exportId, actualSourceField);
      const provenance = revisionId ? 'LEGACY_VERIFIED' : 'LEGACY_UNVERIFIED';
      const expected = {
        output_id: outputId,
        project_id: projectId,
        revision_id: revisionId,
        output_family: mapping.outputFamily,
        output_format: mapping.outputFormat,
        locator_kind: locator.kind,
        locator_value: locator.value,
        legacy_absolute_path: locator.absolutePath,
        content_hash: null,
        template_id: null,
        template_version_id: null,
        resolved_template_snapshot_json: null,
        resolved_template_snapshot_hash: null,
        lifecycle_state: 'LEGACY_IMPORTED',
        provenance_classification: provenance,
        legacy_source_id: exportId,
        legacy_source_field: actualSourceField,
        template_provenance: 'LEGACY_UNKNOWN',
        failure_reason: revisionId ? null : LEGACY_RELATION_UNVERIFIED,
        created_at: createdAt,
        finalized_at: createdAt,
        updated_at: createdAt,
      } as const;
      let existing = database
        .prepare(
          `SELECT * FROM canonical_outputs
           WHERE legacy_source_id = ? AND legacy_source_field = ?`,
        )
        .get(exportId, actualSourceField) as V4SqlRow | undefined;
      if (!existing && insertMissing) {
        database
          .prepare(
            `INSERT INTO canonical_outputs
             (output_id, project_id, revision_id, output_family, output_format, locator_kind,
              locator_value, legacy_absolute_path, content_hash, template_id, template_version_id,
              resolved_template_snapshot_json, resolved_template_snapshot_hash, lifecycle_state,
              provenance_classification, legacy_source_id, legacy_source_field,
              template_provenance, failure_reason, created_at, finalized_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            outputId,
            projectId,
            revisionId,
            mapping.outputFamily,
            mapping.outputFormat,
            locator.kind,
            locator.value,
            locator.absolutePath,
            expected.lifecycle_state,
            provenance,
            exportId,
            actualSourceField,
            expected.template_provenance,
            expected.failure_reason,
            createdAt,
            createdAt,
            createdAt,
          );
        existing = database
          .prepare(
            `SELECT * FROM canonical_outputs
             WHERE legacy_source_id = ? AND legacy_source_field = ?`,
          )
          .get(exportId, actualSourceField) as V4SqlRow | undefined;
      }
      assertV4RowMatches(existing, expected, `legacy Output ${exportId}/${actualSourceField}`);
    }
  }
}

interface VerifiedPackageOutput {
  readonly outputId: string;
  readonly revisionId: string;
  readonly revisionSequence: number;
  readonly position: number;
}

interface PackageEvidence {
  readonly outputs: readonly VerifiedPackageOutput[];
  readonly revisionId: string | null;
  readonly revisionSequence: number | null;
  readonly failureReason: string | null;
}

function packageEvidenceFromManifest(
  database: DatabaseSync,
  rawManifest: string,
  projectId: string,
): PackageEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch {
    return {
      outputs: [],
      revisionId: null,
      revisionSequence: null,
      failureReason: LEGACY_RELATION_UNVERIFIED,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      outputs: [],
      revisionId: null,
      revisionSequence: null,
      failureReason: LEGACY_RELATION_UNVERIFIED,
    };
  }
  const mappingBySuffix = new Map(
    PRODUCTION_V4_LEGACY_EXPORT_MAPPINGS.map((mapping) => [mapping.manifestSuffix, mapping]),
  );
  const outputs: VerifiedPackageOutput[] = [];
  const seenOutputIds = new Set<string>();
  let sharedRevisionId: string | null = null;
  let sharedRevisionSequence: number | null = null;
  for (let position = 0; position < parsed.length; position += 1) {
    const item = parsed[position];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    const itemId = (item as Record<string, unknown>).itemId;
    if (typeof itemId !== 'string') {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    if (!itemId.startsWith('export:')) continue;
    const match = itemId.match(/^export:([^:]+):(schedule-pdf|schedule-excel|boq-pdf|boq-excel)$/);
    if (!match) {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    const exportId = match[1]!;
    const mapping = mappingBySuffix.get(match[2]!);
    if (!mapping) {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    const allowedSourceFields = mapping.fallbackSourceField
      ? [mapping.sourceField, mapping.fallbackSourceField]
      : [mapping.sourceField];
    const matchingOutputs = database
      .prepare(
        `SELECT o.output_id, o.revision_id, r.revision_sequence
         FROM canonical_outputs o
         INNER JOIN canonical_revisions r ON r.revision_id = o.revision_id
         WHERE o.legacy_source_id = ?
           AND o.legacy_source_field IN (?, ?)
           AND o.project_id = ? AND o.provenance_classification = 'LEGACY_VERIFIED'
         ORDER BY o.legacy_source_field, o.output_id`,
      )
      .all(
        exportId,
        allowedSourceFields[0]!,
        allowedSourceFields[1] ?? allowedSourceFields[0]!,
        projectId,
      ) as V4SqlRow[];
    const output = matchingOutputs.length === 1 ? matchingOutputs[0] : undefined;
    if (!output || typeof output.revision_id !== 'string' || typeof output.output_id !== 'string') {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    const revisionSequence = Number(output.revision_sequence);
    if (!Number.isSafeInteger(revisionSequence) || seenOutputIds.has(output.output_id)) {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    if (sharedRevisionId !== null && sharedRevisionId !== output.revision_id) {
      return {
        outputs: [],
        revisionId: null,
        revisionSequence: null,
        failureReason: LEGACY_RELATION_UNVERIFIED,
      };
    }
    sharedRevisionId = output.revision_id;
    sharedRevisionSequence = revisionSequence;
    seenOutputIds.add(output.output_id);
    outputs.push({
      outputId: output.output_id,
      revisionId: output.revision_id,
      revisionSequence,
      position,
    });
  }
  if (outputs.length === 0 || sharedRevisionId === null || sharedRevisionSequence === null) {
    return {
      outputs: [],
      revisionId: null,
      revisionSequence: null,
      failureReason: LEGACY_RELATION_UNVERIFIED,
    };
  }
  return {
    outputs,
    revisionId: sharedRevisionId,
    revisionSequence: sharedRevisionSequence,
    failureReason: null,
  };
}

interface LegacyPackageCandidate {
  readonly source: V4SqlRow;
  readonly sourceId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly sequence: number | null;
  readonly evidence: PackageEvidence;
  readonly sequenceKey: string | null;
}

function collectLegacyPackageCandidates(database: DatabaseSync): LegacyPackageCandidate[] {
  const rows = database
    .prepare(
      `SELECT id, project_id, revision_number, reissue_number, label, folder_path, zip_path,
              manifest_json, created_at
       FROM revision_packages ORDER BY project_id, created_at, id`,
    )
    .all() as V4SqlRow[];
  return rows.map((source) => {
    const sourceId = requireLegacyText(source, 'id');
    const projectId = requireLegacyText(source, 'project_id');
    const evidence = packageEvidenceFromManifest(
      database,
      requireLegacyText(source, 'manifest_json'),
      projectId,
    );
    const revisionNumber = Number(source.revision_number);
    const reissueNumber = Number(source.reissue_number);
    const sequenceIsUsable =
      evidence.revisionId !== null &&
      evidence.revisionSequence !== null &&
      Number.isSafeInteger(revisionNumber) &&
      revisionNumber === evidence.revisionSequence &&
      Number.isSafeInteger(reissueNumber) &&
      reissueNumber >= 0;
    const sequence = sequenceIsUsable ? reissueNumber : null;
    return {
      source,
      sourceId,
      projectId,
      packageId: preserveUuidOrDerive('legacy-package', sourceId),
      sequence,
      evidence,
      sequenceKey:
        sequence !== null && evidence.revisionId !== null
          ? `${evidence.revisionId}\u0000${sequence}`
          : null,
    };
  });
}

function migrateLegacyPackages(database: DatabaseSync, insertMissing: boolean): void {
  const candidates = collectLegacyPackageCandidates(database);
  const sequenceCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.sequenceKey) {
      sequenceCounts.set(
        candidate.sequenceKey,
        (sequenceCounts.get(candidate.sequenceKey) ?? 0) + 1,
      );
    }
  }
  for (const candidate of candidates) {
    const sequenceUnique =
      candidate.sequenceKey !== null && sequenceCounts.get(candidate.sequenceKey) === 1;
    const verified =
      sequenceUnique &&
      candidate.sequence !== null &&
      candidate.evidence.revisionId !== null &&
      candidate.evidence.failureReason === null;
    const revisionId = verified ? candidate.evidence.revisionId : null;
    const packageSequence = verified ? candidate.sequence : null;
    const provenance = verified ? 'LEGACY_VERIFIED' : 'LEGACY_UNVERIFIED';
    const failureReason = verified
      ? null
      : candidate.sequenceKey !== null && !sequenceUnique
        ? LEGACY_PACKAGE_SEQUENCE_AMBIGUOUS
        : LEGACY_RELATION_UNVERIFIED;
    const zipPath = requireLegacyText(candidate.source, 'zip_path');
    const folderPath = requireLegacyText(candidate.source, 'folder_path');
    const artifactPath = zipPath.trim() ? zipPath : folderPath;
    const locator = classifyLegacyLocator(artifactPath);
    const createdAt = requireLegacyText(candidate.source, 'created_at');
    const expected = {
      package_id: candidate.packageId,
      project_id: candidate.projectId,
      revision_id: revisionId,
      package_sequence: packageSequence,
      label: requireLegacyText(candidate.source, 'label'),
      artifact_locator_kind: locator.kind,
      artifact_locator_value: locator.value,
      legacy_absolute_path: locator.absolutePath,
      manifest_locator_kind: null,
      manifest_locator_value: null,
      lifecycle_state: 'LEGACY_IMPORTED',
      provenance_classification: provenance,
      legacy_source_id: candidate.sourceId,
      failure_reason: failureReason,
      created_at: createdAt,
      finalized_at: null,
      updated_at: createdAt,
    } as const;
    let existing = database
      .prepare('SELECT * FROM canonical_issue_packages WHERE legacy_source_id = ?')
      .get(candidate.sourceId) as V4SqlRow | undefined;
    if (!existing && insertMissing) {
      database
        .prepare(
          `INSERT INTO canonical_issue_packages
           (package_id, project_id, revision_id, package_sequence, label, artifact_locator_kind,
            artifact_locator_value, legacy_absolute_path, manifest_locator_kind,
            manifest_locator_value, lifecycle_state, provenance_classification, legacy_source_id,
            failure_reason, created_at, finalized_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          candidate.packageId,
          candidate.projectId,
          revisionId,
          packageSequence,
          expected.label,
          locator.kind,
          locator.value,
          locator.absolutePath,
          expected.lifecycle_state,
          provenance,
          candidate.sourceId,
          failureReason,
          createdAt,
          createdAt,
        );
      existing = database
        .prepare('SELECT * FROM canonical_issue_packages WHERE legacy_source_id = ?')
        .get(candidate.sourceId) as V4SqlRow | undefined;
    }
    assertV4RowMatches(existing, expected, `legacy Issue Package ${candidate.sourceId}`);

    const expectedLinks = verified ? candidate.evidence.outputs : [];
    for (const output of expectedLinks) {
      let link = database
        .prepare(
          `SELECT * FROM canonical_package_outputs
           WHERE package_id = ? AND output_id = ?`,
        )
        .get(candidate.packageId, output.outputId) as V4SqlRow | undefined;
      if (!link && insertMissing) {
        database
          .prepare(
            `INSERT INTO canonical_package_outputs
             (package_id, output_id, revision_id, position, provenance_classification, created_at)
             VALUES (?, ?, ?, ?, 'LEGACY_VERIFIED', ?)`,
          )
          .run(candidate.packageId, output.outputId, output.revisionId, output.position, createdAt);
        link = database
          .prepare(
            `SELECT * FROM canonical_package_outputs
             WHERE package_id = ? AND output_id = ?`,
          )
          .get(candidate.packageId, output.outputId) as V4SqlRow | undefined;
      }
      assertV4RowMatches(
        link,
        {
          package_id: candidate.packageId,
          output_id: output.outputId,
          revision_id: output.revisionId,
          position: output.position,
          provenance_classification: 'LEGACY_VERIFIED',
          created_at: createdAt,
        },
        `legacy Package Output ${candidate.sourceId}/${output.outputId}`,
      );
    }
    const actualLinks = database
      .prepare(
        `SELECT output_id FROM canonical_package_outputs
         WHERE package_id = ? ORDER BY position, output_id`,
      )
      .all(candidate.packageId) as Array<{ output_id: string }>;
    const expectedOutputIds = expectedLinks.map((output) => output.outputId);
    if (
      canonicalV4Json(actualLinks.map((row) => row.output_id)) !==
      canonicalV4Json(expectedOutputIds)
    ) {
      throw new Error(
        `Version-4 migration validation failed: legacy Issue Package ${candidate.sourceId} has unexpected Output relations.`,
      );
    }
  }
}

function migrateLegacyV4Graph(database: DatabaseSync, insertMissing: boolean): void {
  migrateLegacyRevisions(database, insertMissing);
  migrateLegacyOutputs(database, insertMissing);
  migrateLegacyPackages(database, insertMissing);
}

function normalizeV4SchemaSql(sql: string): string {
  return sql
    .trim()
    .replace(/;$/, '')
    .replace(/\bIF NOT EXISTS\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function v4SchemaObject(sql: string): { type: 'table' | 'index' | 'trigger'; name: string } {
  const table = sql.match(/^CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
  if (table) return { type: 'table', name: table[1]! };
  const index = sql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)/i);
  if (index) return { type: 'index', name: index[1]! };
  const trigger = sql.match(/^CREATE TRIGGER IF NOT EXISTS\s+(\w+)/i);
  if (trigger) return { type: 'trigger', name: trigger[1]! };
  throw new Error('Version-4 DDL inventory contains an unsupported statement.');
}

function validateV4Schema(database: DatabaseSync): void {
  for (const expectedSql of PRODUCTION_V4_DDL) {
    const object = v4SchemaObject(expectedSql);
    const actual = database
      .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get(object.type, object.name) as { sql?: string | null } | undefined;
    if (
      typeof actual?.sql !== 'string' ||
      normalizeV4SchemaSql(actual.sql) !== normalizeV4SchemaSql(expectedSql)
    ) {
      throw new Error(
        `Version-4 migration validation failed: ${object.type} ${object.name} differs from canonical DDL.`,
      );
    }
  }
  for (const table of PRODUCTION_V4_TABLE_NAMES) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    const actualNames = columns.map((column) => column.name);
    const expectedNames = PRODUCTION_V4_COLUMN_NAMES[table];
    if (!expectedNames || canonicalV4Json(actualNames) !== canonicalV4Json(expectedNames)) {
      throw new Error(
        `Version-4 migration validation failed: table ${table} has an unexpected column inventory.`,
      );
    }
  }
  const actualForeignKeys: string[] = [];
  for (const table of PRODUCTION_V4_TABLE_NAMES) {
    const rows = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }>;
    for (const row of rows) {
      if (row.on_update !== 'RESTRICT' || row.on_delete !== 'RESTRICT') {
        throw new Error(
          `Version-4 migration validation failed: table ${table} has a non-RESTRICT foreign key.`,
        );
      }
      actualForeignKeys.push(`${table}\u0000${row.from}\u0000${row.table}\u0000${row.to}`);
    }
  }
  const expectedForeignKeys = PRODUCTION_V4_FOREIGN_KEYS.map(
    (foreignKey) =>
      `${foreignKey.table}\u0000${foreignKey.from}\u0000${foreignKey.targetTable}\u0000${foreignKey.to}`,
  );
  if (canonicalV4Json(actualForeignKeys.sort()) !== canonicalV4Json(expectedForeignKeys.sort())) {
    throw new Error('Version-4 migration validation failed: foreign-key inventory differs.');
  }
  const foreignKeysEnabled = database.prepare('PRAGMA foreign_keys').get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeysEnabled?.foreign_keys !== 1) {
    throw new Error('Version-4 migration validation failed: SQLite foreign keys are disabled.');
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length !== 0) {
    throw new Error('Version-4 migration validation failed: foreign-key violations exist.');
  }
}

function upV4(context: MigrationContext): void {
  for (const ddl of PRODUCTION_V4_DDL) context.database.exec(ddl);
  const createdAt = context.clock.now().toISOString();
  registerV4BuiltIns(context.database, createdAt, true);
  migrateLegacyV4Graph(context.database, true);
}

function validateV4(context: MigrationContext): void {
  validateV4Schema(context.database);
  registerV4BuiltIns(context.database, '', false);
  migrateLegacyV4Graph(context.database, false);
}

function computeV4MigrationChecksum(): string {
  const payload = JSON.stringify({
    id: PRODUCTION_V4_MIGRATION_ID,
    fromVersion: 3,
    toVersion: 4,
    description: PRODUCTION_V4_MIGRATION_DESCRIPTION,
    v4Ddl: PRODUCTION_V4_DDL,
    v4Columns: PRODUCTION_V4_COLUMN_NAMES,
    v4ForeignKeys: PRODUCTION_V4_FOREIGN_KEYS,
    builtIns: PRODUCTION_V4_BUILTIN_REGISTRATIONS,
    legacyExportMappings: PRODUCTION_V4_LEGACY_EXPORT_MAPPINGS,
    legacyPolicy: PRODUCTION_V4_LEGACY_POLICY,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// 20 -> 21 bounded P4D Datasheet Register family extension
// ---------------------------------------------------------------------------

export const PRODUCTION_V21_MIGRATION_ID = 'production-20-21-datasheet-register-output-family';
export const PRODUCTION_V21_MIGRATION_DESCRIPTION =
  'Extend the constrained canonical Output Template family with DatasheetRegister and register immutable P4D professional Template Versions.';

const V20_OUTPUT_FAMILY_CHECK = "('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule')";
const V21_OUTPUT_FAMILY_CHECK =
  "('LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule', 'DatasheetRegister')";
export const PRODUCTION_V21_REBUILT_TABLES = Object.freeze([
  'output_templates',
  'output_template_versions',
  'global_output_template_defaults',
  'project_output_template_overrides',
  'canonical_outputs',
] as const);

function rebuildV21FamilyTables(database: DatabaseSync): void {
  const constrained = new Set([
    'output_templates',
    'global_output_template_defaults',
    'project_output_template_overrides',
    'canonical_outputs',
  ]);
  const dependentObjects: Array<{ type: string; name: string; sql: string }> = [];
  const constrainedStates: Array<'v20' | 'v21'> = [];
  const tableSql = new Map<string, string>();
  for (const tableName of PRODUCTION_V21_REBUILT_TABLES) {
    const row = database
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(tableName) as { sql?: unknown } | undefined;
    if (!row || typeof row.sql !== 'string') {
      throw new Error(`Version-21 migration requires table ${tableName}.`);
    }
    tableSql.set(tableName, row.sql);
    const v20Occurrences = row.sql.split(V20_OUTPUT_FAMILY_CHECK).length - 1;
    const v21Occurrences = row.sql.split(V21_OUTPUT_FAMILY_CHECK).length - 1;
    if (constrained.has(tableName)) {
      if (v20Occurrences === 1 && v21Occurrences === 0) constrainedStates.push('v20');
      else if (v20Occurrences === 0 && v21Occurrences === 1) constrainedStates.push('v21');
      else {
        throw new Error(
          `Version-21 migration found an unexpected Output-family constraint in ${tableName}.`,
        );
      }
    } else if (v20Occurrences !== 0 || v21Occurrences !== 0) {
      throw new Error(
        `Version-21 migration found an unexpected Output-family constraint in ${tableName}.`,
      );
    }
  }
  if (constrainedStates.every((state) => state === 'v21')) return;
  if (!constrainedStates.every((state) => state === 'v20')) {
    throw new Error('Version-21 migration found a partially upgraded Output-family schema.');
  }
  for (const tableName of PRODUCTION_V21_REBUILT_TABLES) {
    const originalSql = tableSql.get(tableName)!;
    const temporaryName = `${tableName}__v21`;
    const createSql = originalSql
      .replace(V20_OUTPUT_FAMILY_CHECK, V21_OUTPUT_FAMILY_CHECK)
      .replace(
        new RegExp(
          `^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\\[]?${tableName}["'\\]]?`,
          'i',
        ),
        `CREATE TABLE ${temporaryName}`,
      );
    dependentObjects.push(
      ...(database
        .prepare(
          `SELECT type, name, sql FROM sqlite_schema
           WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL
           ORDER BY type, name`,
        )
        .all(tableName) as Array<{ type: string; name: string; sql: string }>),
    );
    database.exec(createSql);
    database.exec(`INSERT INTO ${temporaryName} SELECT * FROM ${tableName}`);
  }
  for (const tableName of [...PRODUCTION_V21_REBUILT_TABLES].reverse()) {
    database.exec(`DROP TABLE ${tableName}`);
  }
  for (const tableName of PRODUCTION_V21_REBUILT_TABLES) {
    database.exec(`ALTER TABLE ${tableName}__v21 RENAME TO ${tableName}`);
  }
  for (const object of dependentObjects) database.exec(object.sql);
}

function registerV21ProfessionalTemplates(
  database: DatabaseSync,
  createdAt: string,
  insertMissing = true,
): void {
  for (const definition of p4dProfessionalTemplateVersions) {
    validateTemplateVersion(definition);
    const definitionJson = canonicalV4Json(definition);
    const definitionHash = sha256Text(definitionJson);
    const existingTemplate = database
      .prepare('SELECT family, origin FROM output_templates WHERE template_id = ?')
      .get(definition.templateId) as { family?: unknown; origin?: unknown } | undefined;
    if (!existingTemplate && insertMissing) {
      database
        .prepare(
          `INSERT INTO output_templates
           (template_id, family, origin, state, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          definition.templateId,
          definition.family,
          definition.origin,
          definition.state,
          definition.displayName,
          createdAt,
          createdAt,
        );
    } else if (!existingTemplate) {
      throw new Error(`Version-21 Template ${definition.templateId} is missing.`);
    } else if (
      existingTemplate.family !== definition.family ||
      existingTemplate.origin !== definition.origin
    ) {
      throw new Error(`Version-21 Template identity conflict for ${definition.templateId}.`);
    }
    const existingVersion = database
      .prepare(
        `SELECT definition_json, definition_hash FROM output_template_versions
         WHERE template_id = ? AND version_id = ?`,
      )
      .get(definition.templateId, definition.versionId) as
      { definition_json?: unknown; definition_hash?: unknown } | undefined;
    if (!existingVersion && insertMissing) {
      database
        .prepare(
          `INSERT INTO output_template_versions
           (template_id, version_id, definition_json, definition_hash, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          definition.templateId,
          definition.versionId,
          definitionJson,
          definitionHash,
          createdAt,
          'SYSTEM_P4D_V21_MIGRATION',
        );
    } else if (!existingVersion) {
      throw new Error(
        `Version-21 Template Version ${definition.templateId}/${definition.versionId} is missing.`,
      );
    } else if (
      existingVersion.definition_json !== definitionJson ||
      existingVersion.definition_hash !== definitionHash
    ) {
      throw new Error(
        `Version-21 immutable Template Version conflict for ${definition.templateId}/${definition.versionId}.`,
      );
    }
  }
}

/** Shared schema/bootstrap boundary for isolated non-production Personal stores. */
export function applyV21OutputPresentationFamily(database: DatabaseSync, createdAt: string): void {
  database.exec('PRAGMA defer_foreign_keys = ON');
  rebuildV21FamilyTables(database);
  registerV21ProfessionalTemplates(database, createdAt);
  database.exec('PRAGMA defer_foreign_keys = OFF');
}

function upV21(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 20);
  applyV21OutputPresentationFamily(context.database, context.clock.now().toISOString());
  // The final graph is revalidated with foreign_keys still ON. Clearing the
  // deferred-drop bookkeeping prevents SQLite from rejecting the transaction
  // for the intentionally replaced parent tables after their exact identities
  // and rows have already been restored.
}

function validateV21(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 21);
  registerV21ProfessionalTemplates(context.database, '', false);
}

function upV22(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 21);
  applyV22LuminaireLibrarySchema(context.database);
}

function validateV22(context: MigrationContext): void {
  validateV22LuminaireLibrarySchema(context.database);
}

function upV23(context: MigrationContext): void {
  validateV22UpgradeAuthority(context.database);
  validateV22LuminaireLibrarySchema(context.database);
  applyV23LuminaireLibraryHardening(context.database);
}

function validateV23(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 23);
  validateV23LuminaireLibraryHardening(context.database);
}

function upV24(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 23);
  validateV23LuminaireLibraryHardening(context.database);
  applyV24SmartImportInspection(context.database);
}

function validateV24(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 24);
  validateV24SmartImportInspection(context.database);
}

function upV25(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 24);
  validateV24SmartImportInspection(context.database);
  applyV25SmartImportProjectApply(context.database);
}

function validateV25(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 25);
  validateV25SmartImportProjectApply(context.database);
}

function upV26(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 25);
  validateV25SmartImportProjectApply(context.database);
  applyV26DocumentIntelligence(context.database);
}

function validateV26(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 26);
  validateV26DocumentIntelligence(context.database);
}

function upV27(context: MigrationContext): void {
  const foreignKeys = context.database.prepare('PRAGMA foreign_keys').get() as {
    foreign_keys?: number;
  };
  if (foreignKeys.foreign_keys === 0)
    validateProductionSchemaVersionDuringForeignKeyRebuild(context.database, 26);
  else validateProductionSchemaVersion(context.database, 26);
  validateV26DocumentIntelligence(context.database);
  applyV27LuminaireDatasheetVerification(context.database);
}

function validateV27(context: MigrationContext): void {
  const foreignKeys = context.database.prepare('PRAGMA foreign_keys').get() as {
    foreign_keys?: number;
  };
  if (foreignKeys.foreign_keys === 0)
    validateProductionSchemaVersionDuringForeignKeyRebuild(context.database, 27);
  else validateProductionSchemaVersion(context.database, 27);
  validateV27LuminaireDatasheetVerification(context.database);
}

function upV28(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 27);
  validateV27LuminaireDatasheetVerification(context.database);
  applyV28ProjectIntelligenceProductivity(context.database);
}

function validateV28(context: MigrationContext): void {
  validateProductionSchemaVersion(context.database, 28);
  validateV28ProjectIntelligenceProductivity(context.database);
}

function computeV21MigrationChecksum(): string {
  const templates = p4dProfessionalTemplateVersions.map((definition) => ({
    templateId: definition.templateId,
    versionId: definition.versionId,
    definitionHash: sha256Text(canonicalV4Json(definition)),
  }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V21_MIGRATION_ID,
        tables: PRODUCTION_V21_REBUILT_TABLES,
        from: V20_OUTPUT_FAMILY_CHECK,
        to: V21_OUTPUT_FAMILY_CHECK,
        templates,
      }),
      'utf8',
    )
    .digest('hex');
}

export const PRODUCTION_MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  Object.freeze({
    id: PRODUCTION_MIGRATION_ID,
    fromVersion: 0,
    toVersion: 1,
    checksum: computeMigrationChecksum(),
    description: PRODUCTION_MIGRATION_DESCRIPTION,
    up,
    validate,
  }),
  Object.freeze({
    id: PRODUCTION_V2_MIGRATION_ID,
    fromVersion: 1,
    toVersion: 2,
    checksum: computeV2MigrationChecksum(),
    description: PRODUCTION_V2_MIGRATION_DESCRIPTION,
    up: upV2,
    validate: validateV2,
  }),
  Object.freeze({
    id: PRODUCTION_V3_MIGRATION_ID,
    fromVersion: 2,
    toVersion: 3,
    checksum: computeV3MigrationChecksum(),
    description: PRODUCTION_V3_MIGRATION_DESCRIPTION,
    up: upV3,
    validate: validateV3,
  }),
  Object.freeze({
    id: PRODUCTION_V4_MIGRATION_ID,
    fromVersion: 3,
    toVersion: 4,
    checksum: computeV4MigrationChecksum(),
    description: PRODUCTION_V4_MIGRATION_DESCRIPTION,
    up: upV4,
    validate: validateV4,
  }),
  Object.freeze({
    id: PRODUCTION_V5_MIGRATION_ID,
    fromVersion: 4,
    toVersion: 5,
    checksum: computeV5MigrationChecksum(),
    description: PRODUCTION_V5_MIGRATION_DESCRIPTION,
    up: upV5,
    validate: validateV5,
  }),
  Object.freeze({
    id: PRODUCTION_V6_MIGRATION_ID,
    fromVersion: 5,
    toVersion: 6,
    checksum: computeV6MigrationChecksum(),
    description: 'Add canonical project tags and scope notes metadata.',
    up: upV6,
    validate: validateV6,
  }),
  Object.freeze({
    id: PRODUCTION_V7_MIGRATION_ID,
    fromVersion: 6,
    toVersion: 7,
    checksum: computeV7MigrationChecksum(),
    description: PRODUCTION_V7_MIGRATION_DESCRIPTION,
    up: upV7,
    validate: validateV7,
  }),
  Object.freeze({
    id: PRODUCTION_V8_MIGRATION_ID,
    fromVersion: 7,
    toVersion: 8,
    checksum: computeV8MigrationChecksum(),
    description: PRODUCTION_V8_MIGRATION_DESCRIPTION,
    up: upV8,
    validate: validateV8,
  }),
  Object.freeze({
    id: PRODUCTION_V9_MIGRATION_ID,
    fromVersion: 8,
    toVersion: 9,
    checksum: computeV9MigrationChecksum(),
    description: PRODUCTION_V9_MIGRATION_DESCRIPTION,
    up: upV9,
    validate: validateV9,
  }),
  Object.freeze({
    id: PRODUCTION_V10_MIGRATION_ID,
    fromVersion: 9,
    toVersion: 10,
    checksum: computeV10MigrationChecksum(),
    description: PRODUCTION_V10_MIGRATION_DESCRIPTION,
    up: upV10,
    validate: validateV10,
  }),
  Object.freeze({
    id: PRODUCTION_V11_MIGRATION_ID,
    fromVersion: 10,
    toVersion: 11,
    checksum: computeV11MigrationChecksum(),
    description: PRODUCTION_V11_MIGRATION_DESCRIPTION,
    up: upV11,
    validate: validateV11,
  }),
  Object.freeze({
    id: PRODUCTION_V12_MIGRATION_ID,
    fromVersion: 11,
    toVersion: 12,
    checksum: computeV12MigrationChecksum(),
    description: PRODUCTION_V12_MIGRATION_DESCRIPTION,
    up: upV12,
    validate: validateV12,
  }),
  Object.freeze({
    id: PRODUCTION_V13_MIGRATION_ID,
    fromVersion: 12,
    toVersion: 13,
    checksum: computeV13MigrationChecksum(),
    description: PRODUCTION_V13_MIGRATION_DESCRIPTION,
    up: upV13,
    validate: validateV13,
  }),
  Object.freeze({
    id: PRODUCTION_V14_MIGRATION_ID,
    fromVersion: 13,
    toVersion: 14,
    checksum: computeV14MigrationChecksum(),
    description: PRODUCTION_V14_MIGRATION_DESCRIPTION,
    up: upV14,
    validate: validateV14,
  }),
  Object.freeze({
    id: PRODUCTION_V15_MIGRATION_ID,
    fromVersion: 14,
    toVersion: 15,
    checksum: computeV15MigrationChecksum(),
    description: PRODUCTION_V15_MIGRATION_DESCRIPTION,
    up: upV15,
    validate: validateV15,
  }),
  Object.freeze({
    id: PRODUCTION_V16_MIGRATION_ID,
    fromVersion: 15,
    toVersion: 16,
    checksum: computeV16MigrationChecksum(),
    description: PRODUCTION_V16_MIGRATION_DESCRIPTION,
    up: upV16,
    validate: validateV16,
  }),
  Object.freeze({
    id: PRODUCTION_V17_MIGRATION_ID,
    fromVersion: 16,
    toVersion: 17,
    checksum: computeV17MigrationChecksum(),
    description: PRODUCTION_V17_MIGRATION_DESCRIPTION,
    up: upV17,
    validate: validateV17,
  }),
  Object.freeze({
    id: PRODUCTION_V18_MIGRATION_ID,
    fromVersion: 17,
    toVersion: 18,
    checksum: computeV18MigrationChecksum(),
    description: PRODUCTION_V18_MIGRATION_DESCRIPTION,
    up: upV18,
    validate: validateV18,
  }),
  Object.freeze({
    id: PRODUCTION_V19_MIGRATION_ID,
    fromVersion: 18,
    toVersion: 19,
    checksum: computeV19MigrationChecksum(),
    description: PRODUCTION_V19_MIGRATION_DESCRIPTION,
    up: upV19,
    validate: validateV19,
  }),
  Object.freeze({
    id: PRODUCTION_V20_MIGRATION_ID,
    fromVersion: 19,
    toVersion: 20,
    checksum: computeV20MigrationChecksum(),
    description: PRODUCTION_V20_MIGRATION_DESCRIPTION,
    up: upV20,
    validate: validateV20,
    validateCurrent: (database: DatabaseSync) => validateProductionSchemaVersion(database, 20),
  }),
  Object.freeze({
    id: PRODUCTION_V21_MIGRATION_ID,
    fromVersion: 20,
    toVersion: 21,
    checksum: computeV21MigrationChecksum(),
    description: PRODUCTION_V21_MIGRATION_DESCRIPTION,
    up: upV21,
    validate: validateV21,
    validateCurrent: (database: DatabaseSync) => validateProductionSchemaVersion(database, 21),
  }),
  Object.freeze({
    id: PRODUCTION_V22_MIGRATION_ID,
    fromVersion: 21,
    toVersion: 22,
    checksum: computeV22MigrationChecksum(),
    description: PRODUCTION_V22_MIGRATION_DESCRIPTION,
    up: upV22,
    validate: validateV22,
    validateCurrent: (database: DatabaseSync) => {
      validateV22UpgradeAuthority(database);
      validateV22LuminaireLibrarySchema(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V23_MIGRATION_ID,
    fromVersion: 22,
    toVersion: 23,
    checksum: computeV23MigrationChecksum(),
    description: PRODUCTION_V23_MIGRATION_DESCRIPTION,
    up: upV23,
    validate: validateV23,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 23);
      validateV23LuminaireLibraryHardening(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V24_MIGRATION_ID,
    fromVersion: 23,
    toVersion: 24,
    checksum: computeV24MigrationChecksum(),
    description: PRODUCTION_V24_MIGRATION_DESCRIPTION,
    up: upV24,
    validate: validateV24,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 24);
      validateV24SmartImportInspection(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V25_MIGRATION_ID,
    fromVersion: 24,
    toVersion: 25,
    checksum: computeV25MigrationChecksum(),
    description: PRODUCTION_V25_MIGRATION_DESCRIPTION,
    up: upV25,
    validate: validateV25,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 25);
      validateV25SmartImportProjectApply(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V26_MIGRATION_ID,
    fromVersion: 25,
    toVersion: 26,
    checksum: computeV26MigrationChecksum(),
    description: PRODUCTION_V26_MIGRATION_DESCRIPTION,
    up: upV26,
    validate: validateV26,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 26);
      validateV26DocumentIntelligence(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V27_MIGRATION_ID,
    fromVersion: 26,
    toVersion: 27,
    foreignKeyMode: 'DISABLED_DURING_MIGRATION',
    checksum: computeV27MigrationChecksum(),
    description: PRODUCTION_V27_MIGRATION_DESCRIPTION,
    up: upV27,
    validate: validateV27,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 27);
      validateV27LuminaireDatasheetVerification(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V28_MIGRATION_ID,
    fromVersion: 27,
    toVersion: 28,
    checksum: computeV28MigrationChecksum(),
    description: PRODUCTION_V28_MIGRATION_DESCRIPTION,
    up: upV28,
    validate: validateV28,
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 28);
      validateV28ProjectIntelligenceProductivity(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V29_MIGRATION_ID,
    fromVersion: 28,
    toVersion: 29,
    checksum: computeV29MigrationChecksum(),
    description: PRODUCTION_V29_MIGRATION_DESCRIPTION,
    up: (context: MigrationContext) => {
      validateProductionSchemaVersion(context.database, 28);
      applyV29FinalUiRelations(context.database);
    },
    validate: (context: MigrationContext) => {
      validateProductionSchemaVersion(context.database, 29);
      validateV29FinalUiRelations(context.database);
    },
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 29);
      validateV29FinalUiRelations(database);
    },
  }),
  Object.freeze({
    id: PRODUCTION_V30_MIGRATION_ID,
    fromVersion: 29,
    toVersion: 30,
    checksum: computeV30MigrationChecksum(),
    description:
      'Allow multiple name-only contacts while preserving unique nonempty project emails.',
    foreignKeyMode: 'DISABLED_DURING_MIGRATION' as const,
    up: (context: MigrationContext) => {
      validateProductionSchemaVersionDuringForeignKeyRebuild(context.database, 29);
      applyV30OptionalContactEmail(context.database);
    },
    validate: (context: MigrationContext) => {
      validateProductionSchemaVersionDuringForeignKeyRebuild(context.database, 30);
      validateV30OptionalContactEmail(context.database);
    },
    validateCurrent: (database: DatabaseSync) => {
      validateProductionSchemaVersion(database, 30);
      validateV30OptionalContactEmail(database);
    },
  }),
]);

export {
  PRODUCTION_V28_MIGRATION_ID,
  PRODUCTION_V28_TABLE_NAMES,
  PRODUCTION_V28_INDEX_NAMES,
  PRODUCTION_V28_ACTION_COLUMN_NAMES,
  applyV28ProjectIntelligenceProductivity,
  rollbackV28ProjectIntelligenceProductivity,
  validateV28ProjectIntelligenceProductivity,
} from './production-v28-project-intelligence-productivity';

export {
  PRODUCTION_V22_MIGRATION_ID,
  PRODUCTION_V22_TABLE_NAMES,
  PRODUCTION_V22_INDEX_NAMES,
  applyV22LuminaireLibrarySchema,
  rollbackV22LuminaireLibrarySchema,
  validateV22LuminaireLibrarySchema,
} from './production-v22-luminaire-library';

export {
  PRODUCTION_V23_MIGRATION_ID,
  PRODUCTION_V23_INDEX_NAMES,
  applyV23LuminaireLibraryHardening,
  validateV23LuminaireLibraryHardening,
} from './production-v23-luminaire-library-hardening';

export {
  PRODUCTION_V24_MIGRATION_ID,
  PRODUCTION_V24_TABLE_NAMES,
  PRODUCTION_V24_INDEX_NAMES,
  applyV24SmartImportInspection,
  rollbackV24SmartImportInspection,
  validateV24SmartImportInspection,
} from './production-v24-smart-import-inspection';

export {
  PRODUCTION_V25_MIGRATION_ID,
  PRODUCTION_V25_INDEX_NAMES,
  applyV25SmartImportProjectApply,
  validateV25SmartImportProjectApply,
} from './production-v25-smart-import-project-apply';

export {
  PRODUCTION_V26_MIGRATION_ID,
  PRODUCTION_V26_TABLE_NAMES,
  PRODUCTION_V26_INDEX_NAMES,
  applyV26DocumentIntelligence,
  rollbackV26DocumentIntelligence,
  validateV26DocumentIntelligence,
} from './production-v26-document-intelligence';

export {
  PRODUCTION_V27_MIGRATION_ID,
  PRODUCTION_V27_TABLE_NAMES,
  PRODUCTION_V27_INDEX_NAMES,
  PRODUCTION_V27_TRIGGER_NAMES,
  applyV27LuminaireDatasheetVerification,
  rollbackV27LuminaireDatasheetVerification,
  validateV27LuminaireDatasheetVerification,
} from './production-v27-luminaire-datasheet-verification';

export interface ProductionMigrationRegistry {
  readonly targetVersion: number;
  readonly migrations: readonly MigrationDefinition[];
}

/** Immutable registry object compatible with SchemaMigrationRunner dependencies. */
export const PRODUCTION_MIGRATION_REGISTRY: ProductionMigrationRegistry = Object.freeze({
  targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
  migrations: PRODUCTION_MIGRATIONS,
});

export function createProductionMigrationRegistry(): ProductionMigrationRegistry {
  return PRODUCTION_MIGRATION_REGISTRY;
}

// ---------------------------------------------------------------------------
// External-mode schema readiness (post-migration assertion, not legacy detection)
// ---------------------------------------------------------------------------

/**
 * Fail-closed post-migration readiness assertion for EXTERNALLY_MIGRATED constructors.
 *
 * Verifies PRAGMA user_version, schema_migrations, and the component-owned tables and indexes.
 * It never creates, alters, repairs, or falls back to legacy self-management, and never
 * duplicates the full LegacyDetector. Error messages are bounded and path-free.
 */
export function verifyExternalSchemaReadiness(
  database: DatabaseSync,
  component: SchemaManagementComponent,
): void {
  if (
    component !== 'StandaloneDataProvider' &&
    component !== 'PersonalWorkspaceStore' &&
    component !== 'PersonalOperationsStore'
  ) {
    throw new SchemaManagementError(
      'INVALID_SCHEMA_MANAGEMENT_MODE',
      'Unknown external schema-management component.',
    );
  }

  let userVersion: number;
  try {
    const row = database.prepare('PRAGMA user_version').get() as
      { user_version?: number } | undefined;
    userVersion = row?.user_version ?? 0;
  } catch (error) {
    throw new SchemaManagementError('SCHEMA_READ_CHECK_FAILED', 'Could not read schema version.', {
      cause: error,
    });
  }
  if (userVersion !== PRODUCTION_SCHEMA_TARGET_VERSION) {
    throw new SchemaManagementError(
      'USER_VERSION_MISMATCH',
      `External schema mode requires schema version ${PRODUCTION_SCHEMA_TARGET_VERSION}.`,
    );
  }

  try {
    const history = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name?: string } | undefined;
    if (!history) {
      throw new SchemaManagementError(
        'MIGRATION_HISTORY_MISSING',
        'External schema mode requires the schema_migrations table.',
      );
    }
    for (const table of COMPONENT_TABLES[component]) {
      const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name?: string } | undefined;
      if (!row) {
        throw new SchemaManagementError(
          'REQUIRED_TABLE_MISSING',
          `External schema mode requires table ${table}.`,
        );
      }
    }
    for (const index of COMPONENT_INDEXES[component]) {
      const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index) as { name?: string } | undefined;
      if (!row) {
        throw new SchemaManagementError(
          'REQUIRED_INDEX_MISSING',
          `External schema mode requires index ${index}.`,
        );
      }
    }
    for (const trigger of COMPONENT_TRIGGERS[component]) {
      const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get(trigger) as { name?: string } | undefined;
      if (!row) {
        throw new SchemaManagementError(
          'REQUIRED_TRIGGER_MISSING',
          `External schema mode requires trigger ${trigger}.`,
        );
      }
    }
  } catch (error) {
    if (error instanceof SchemaManagementError) throw error;
    throw new SchemaManagementError('SCHEMA_READ_CHECK_FAILED', 'Schema readiness check failed.', {
      cause: error,
    });
  }
}

export { PRODUCTION_V29_MIGRATION_ID } from './production-v29-final-ui-relations';
