/**
 * Legacy v3.2.2 schema representation - exact historical schema extracted from commit
 * f3a316eeb882738e5a93d463882cbb115ae49653.
 *
 * This module is test infrastructure only. Production application code must not import it.
 *
 * P1.6A-B - Lock Exact Legacy v3.2.2 Schema Manifest and Fixture Contract
 */

import { createHash } from 'node:crypto';

// Types

export type LegacyV322SchemaOwner =
  'StandaloneDataProvider' | 'PersonalWorkspaceStore' | 'PersonalOperationsStore';

export type LegacyV322SchemaKind = 'TABLE' | 'INDEX' | 'COMPATIBILITY_COLUMN';

export interface LegacyV322SchemaStatement {
  readonly order: number;
  readonly owner: LegacyV322SchemaOwner;
  readonly kind: LegacyV322SchemaKind;
  readonly objectName: string;
  readonly sql: string;
  readonly historicalSourcePath: string;
}

export interface LegacyV322ColumnDef {
  readonly name: string;
  readonly declaredType: string;
  readonly notNull: boolean;
  readonly defaultExpression: string | undefined;
  readonly primaryKeyOrder: number | undefined;
  readonly unique: boolean;
  readonly collation: string | undefined;
}

export interface LegacyV322TableDef {
  readonly tableName: string;
  readonly columns: readonly LegacyV322ColumnDef[];
  readonly primaryKeyColumns: readonly string[];
  readonly uniqueConstraints: readonly string[];
  readonly foreignKeys: readonly string[];
  readonly checkConstraints: readonly string[];
}

export interface LegacyV322IndexDef {
  readonly indexName: string;
  readonly tableName: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
  readonly columnDirections: readonly string[];
  readonly partialPredicate: string | undefined;
}

export interface LegacyV322SchemaSnapshot {
  readonly tables: readonly LegacyV322TableDef[];
  readonly indexes: readonly LegacyV322IndexDef[];
  readonly triggerNames: readonly string[];
  readonly viewNames: readonly string[];
  readonly virtualTableNames: readonly string[];
}

export interface LegacyV322CompatibilityOp {
  readonly table: string;
  readonly column: string;
  readonly definition: string;
  readonly owner: LegacyV322SchemaOwner;
  readonly alreadyInBaseCreate: boolean;
}

export const HISTORICAL_SOURCE_COMMIT = 'f3a316eeb882738e5a93d463882cbb115ae49653';

const STANDALONE_PATH = 'apps/api/src/standalone-data-provider.ts' as const;
const WORKSPACE_PATH = 'apps/api/src/personal-workspace-store.ts' as const;
const OPERATIONS_PATH = 'apps/api/src/personal-operations-store.ts' as const;

function stmt(
  order: number,
  owner: LegacyV322SchemaOwner,
  kind: LegacyV322SchemaKind,
  objectName: string,
  sql: string,
  path: string,
): LegacyV322SchemaStatement {
  return Object.freeze({ order, owner, kind, objectName, sql, historicalSourcePath: path });
}

export const SCHEMA_STATEMENTS: readonly LegacyV322SchemaStatement[] = Object.freeze([
  stmt(
    1,
    'StandaloneDataProvider',
    'TABLE',
    'app_state',
    'CREATE TABLE IF NOT EXISTS app_state (\n  state_key TEXT PRIMARY KEY,\n  json_value TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    STANDALONE_PATH,
  ),
  stmt(
    2,
    'StandaloneDataProvider',
    'TABLE',
    'local_accounts',
    'CREATE TABLE IF NOT EXISTS local_accounts (\n  user_id TEXT PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE COLLATE NOCASE,\n  salt TEXT NOT NULL,\n  password_hash TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    STANDALONE_PATH,
  ),
  stmt(
    3,
    'StandaloneDataProvider',
    'TABLE',
    'idempotency_keys',
    'CREATE TABLE IF NOT EXISTS idempotency_keys (\n  idempotency_key TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
    STANDALONE_PATH,
  ),
  stmt(
    4,
    'PersonalWorkspaceStore',
    'TABLE',
    'personal_settings',
    'CREATE TABLE IF NOT EXISTS personal_settings (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  project_root TEXT NOT NULL,\n  default_folder_profile TEXT NOT NULL,\n  default_input_mode TEXT NOT NULL,\n  auto_open_project_folder INTEGER NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    5,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_workspaces',
    'CREATE TABLE IF NOT EXISTS project_workspaces (\n  project_id TEXT PRIMARY KEY,\n  folder_path TEXT,\n  folder_profile TEXT NOT NULL,\n  services_json TEXT NOT NULL,\n  input_mode TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    6,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_deliverables',
    'CREATE TABLE IF NOT EXISTS project_deliverables (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  service_code TEXT NOT NULL,\n  title TEXT NOT NULL,\n  status TEXT NOT NULL,\n  progress_percent INTEGER NOT NULL,\n  required INTEGER NOT NULL,\n  due_date TEXT,\n  sort_order INTEGER NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, service_code)\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    7,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_luminaires',
    'CREATE TABLE IF NOT EXISTS project_luminaires (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  tag TEXT NOT NULL,\n  category TEXT NOT NULL,\n  image_path TEXT NOT NULL,\n  description TEXT NOT NULL,\n  manufacturer TEXT NOT NULL,\n  model TEXT NOT NULL,\n  wattage TEXT NOT NULL,\n  lumens TEXT NOT NULL,\n  light_color TEXT NOT NULL,\n  cri TEXT NOT NULL,\n  beam_angle TEXT NOT NULL,\n  ip_rating TEXT NOT NULL,\n  mounting TEXT NOT NULL,\n  cutout TEXT NOT NULL,\n  driver TEXT NOT NULL,\n  control TEXT NOT NULL,\n  emergency TEXT NOT NULL,\n  datasheet_path TEXT NOT NULL,\n  location TEXT NOT NULL,\n  unit TEXT NOT NULL,\n  quantity REAL NOT NULL,\n  notes TEXT NOT NULL,\n  source_name TEXT NOT NULL,\n  dimensions TEXT NOT NULL,\n  body_color_finish TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, tag)\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    8,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_output_columns',
    'CREATE TABLE IF NOT EXISTS project_output_columns (\n  project_id TEXT NOT NULL,\n  output_type TEXT NOT NULL,\n  field_key TEXT NOT NULL,\n  header TEXT NOT NULL,\n  visible INTEGER NOT NULL,\n  sort_order INTEGER NOT NULL,\n  PRIMARY KEY(project_id, output_type, field_key)\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    9,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_exports',
    'CREATE TABLE IF NOT EXISTS project_exports (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision INTEGER NOT NULL,\n  excel_path TEXT NOT NULL,\n  pdf_path TEXT NOT NULL,\n  datasheet_folder TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    10,
    'PersonalWorkspaceStore',
    'TABLE',
    'custom_folder_profiles',
    'CREATE TABLE IF NOT EXISTS custom_folder_profiles (\n  name TEXT PRIMARY KEY COLLATE NOCASE,\n  description TEXT NOT NULL,\n  folders_json TEXT NOT NULL,\n  output_folders_json TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    11,
    'PersonalWorkspaceStore',
    'TABLE',
    'revision_packages',
    "CREATE TABLE IF NOT EXISTS revision_packages (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision_number INTEGER NOT NULL,\n  reissue_number INTEGER NOT NULL DEFAULT 0,\n  label TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'Draft',\n  output_mode TEXT NOT NULL,\n  folder_path TEXT NOT NULL,\n  zip_path TEXT NOT NULL,\n  item_count INTEGER NOT NULL,\n  total_bytes INTEGER NOT NULL,\n  package_hash TEXT NOT NULL,\n  warning_override_reason TEXT NOT NULL,\n  manifest_json TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)",
    WORKSPACE_PATH,
  ),
  stmt(
    12,
    'PersonalWorkspaceStore',
    'INDEX',
    'ix_revision_packages_project',
    'CREATE INDEX IF NOT EXISTS ix_revision_packages_project\n  ON revision_packages(project_id, revision_number DESC, reissue_number DESC, created_at DESC)',
    WORKSPACE_PATH,
  ),
  stmt(
    13,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_file_index',
    'CREATE TABLE IF NOT EXISTS project_file_index (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  file_name TEXT NOT NULL,\n  relative_path TEXT NOT NULL,\n  file_path TEXT NOT NULL,\n  extension TEXT NOT NULL,\n  size_bytes INTEGER NOT NULL,\n  modified_at TEXT,\n  availability TEXT NOT NULL,\n  confidence INTEGER NOT NULL,\n  indexed_at TEXT NOT NULL,\n  UNIQUE(project_id, relative_path)\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    14,
    'PersonalWorkspaceStore',
    'TABLE',
    'project_file_index_runs',
    'CREATE TABLE IF NOT EXISTS project_file_index_runs (\n  project_id TEXT PRIMARY KEY,\n  folder_path TEXT NOT NULL,\n  indexed_at TEXT NOT NULL,\n  file_count INTEGER NOT NULL,\n  total_bytes INTEGER NOT NULL,\n  one_drive_managed INTEGER NOT NULL,\n  truncated INTEGER NOT NULL\n)',
    WORKSPACE_PATH,
  ),
  stmt(
    15,
    'PersonalWorkspaceStore',
    'INDEX',
    'idx_project_file_index_project_category',
    'CREATE INDEX IF NOT EXISTS idx_project_file_index_project_category\n  ON project_file_index(project_id, category, modified_at DESC)',
    WORKSPACE_PATH,
  ),
  stmt(
    16,
    'PersonalOperationsStore',
    'TABLE',
    'project_requirements',
    'CREATE TABLE IF NOT EXISTS project_requirements (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  title TEXT NOT NULL,\n  details TEXT NOT NULL,\n  requested_from TEXT NOT NULL,\n  requested_at TEXT,\n  due_date TEXT,\n  status TEXT NOT NULL,\n  impact TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_reference TEXT NOT NULL,\n  notes TEXT NOT NULL,\n  sort_order INTEGER NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    17,
    'PersonalOperationsStore',
    'INDEX',
    'ix_project_requirements_project',
    'CREATE INDEX IF NOT EXISTS ix_project_requirements_project\n  ON project_requirements(project_id, status, due_date)',
    OPERATIONS_PATH,
  ),
  stmt(
    18,
    'PersonalOperationsStore',
    'TABLE',
    'project_checklist_items',
    'CREATE TABLE IF NOT EXISTS project_checklist_items (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  title TEXT NOT NULL,\n  service_code TEXT,\n  required INTEGER NOT NULL,\n  completed INTEGER NOT NULL,\n  waived INTEGER NOT NULL,\n  waiver_reason TEXT NOT NULL,\n  sort_order INTEGER NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, category, title)\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    19,
    'PersonalOperationsStore',
    'TABLE',
    'project_actions',
    'CREATE TABLE IF NOT EXISTS project_actions (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  details TEXT NOT NULL,\n  owner TEXT NOT NULL,\n  due_date TEXT,\n  status TEXT NOT NULL,\n  priority TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_id TEXT,\n  revision_id TEXT,\n  completed_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    20,
    'PersonalOperationsStore',
    'INDEX',
    'ix_project_actions_due',
    'CREATE INDEX IF NOT EXISTS ix_project_actions_due\n  ON project_actions(project_id, status, due_date)',
    OPERATIONS_PATH,
  ),
  stmt(
    21,
    'PersonalOperationsStore',
    'TABLE',
    'project_meetings',
    'CREATE TABLE IF NOT EXISTS project_meetings (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  start_at TEXT NOT NULL,\n  end_at TEXT NOT NULL,\n  location TEXT NOT NULL,\n  attendees_json TEXT NOT NULL,\n  agenda TEXT NOT NULL,\n  notes TEXT NOT NULL,\n  decisions TEXT NOT NULL,\n  online_meeting_url TEXT NOT NULL,\n  external_event_id TEXT,\n  status TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    22,
    'PersonalOperationsStore',
    'INDEX',
    'ix_project_meetings_start',
    'CREATE INDEX IF NOT EXISTS ix_project_meetings_start\n  ON project_meetings(project_id, start_at)',
    OPERATIONS_PATH,
  ),
  stmt(
    23,
    'PersonalOperationsStore',
    'TABLE',
    'project_review_items',
    'CREATE TABLE IF NOT EXISTS project_review_items (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  reference TEXT NOT NULL,\n  title TEXT NOT NULL,\n  description TEXT NOT NULL,\n  area TEXT NOT NULL,\n  luminaire_tag TEXT NOT NULL,\n  drawing_reference TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_id TEXT,\n  status TEXT NOT NULL,\n  response TEXT NOT NULL,\n  revision_id TEXT,\n  received_at TEXT NOT NULL,\n  due_date TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    24,
    'PersonalOperationsStore',
    'TABLE',
    'project_revisions',
    "CREATE TABLE IF NOT EXISTS project_revisions (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  revision_number INTEGER NOT NULL,\n  title TEXT NOT NULL,\n  status TEXT NOT NULL,\n  received_at TEXT,\n  due_date TEXT,\n  issued_at TEXT,\n  summary TEXT NOT NULL,\n  change_log TEXT NOT NULL,\n  source_type TEXT NOT NULL,\n  source_reference TEXT NOT NULL,\n  locked INTEGER NOT NULL DEFAULT 0,\n  snapshot_hash TEXT NOT NULL DEFAULT '',\n  reissue_number INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, revision_number)\n)",
    OPERATIONS_PATH,
  ),
  stmt(
    25,
    'PersonalOperationsStore',
    'TABLE',
    'project_documents',
    'CREATE TABLE IF NOT EXISTS project_documents (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  category TEXT NOT NULL,\n  document_number TEXT NOT NULL,\n  title TEXT NOT NULL,\n  revision TEXT NOT NULL,\n  status TEXT NOT NULL,\n  file_path TEXT NOT NULL,\n  issued_to TEXT NOT NULL,\n  issue_date TEXT,\n  notes TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    26,
    'PersonalOperationsStore',
    'INDEX',
    'ix_project_documents_project',
    'CREATE INDEX IF NOT EXISTS ix_project_documents_project\n  ON project_documents(project_id, status, category)',
    OPERATIONS_PATH,
  ),
  stmt(
    27,
    'PersonalOperationsStore',
    'TABLE',
    'project_contacts',
    'CREATE TABLE IF NOT EXISTS project_contacts (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  name TEXT NOT NULL,\n  email TEXT NOT NULL COLLATE NOCASE,\n  company TEXT NOT NULL,\n  role TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  UNIQUE(project_id, email)\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    28,
    'PersonalOperationsStore',
    'TABLE',
    'project_communications',
    'CREATE TABLE IF NOT EXISTS project_communications (\n  id TEXT PRIMARY KEY,\n  project_id TEXT,\n  external_id TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  conversation_id TEXT NOT NULL,\n  subject TEXT NOT NULL,\n  sender TEXT NOT NULL,\n  participants_json TEXT NOT NULL,\n  occurred_at TEXT NOT NULL,\n  end_at TEXT,\n  preview TEXT NOT NULL,\n  web_link TEXT NOT NULL,\n  has_attachments INTEGER NOT NULL,\n  manually_linked INTEGER NOT NULL,\n  synced_at TEXT NOT NULL,\n  UNIQUE(kind, external_id)\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    29,
    'PersonalOperationsStore',
    'INDEX',
    'ix_project_communications_project',
    'CREATE INDEX IF NOT EXISTS ix_project_communications_project\n  ON project_communications(project_id, occurred_at DESC)',
    OPERATIONS_PATH,
  ),
  stmt(
    30,
    'PersonalOperationsStore',
    'TABLE',
    'workspace_activity',
    'CREATE TABLE IF NOT EXISTS workspace_activity (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT,\n  action TEXT NOT NULL,\n  title TEXT NOT NULL,\n  detail TEXT NOT NULL,\n  created_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
  stmt(
    31,
    'PersonalOperationsStore',
    'INDEX',
    'ix_workspace_activity_project',
    'CREATE INDEX IF NOT EXISTS ix_workspace_activity_project\n  ON workspace_activity(project_id, created_at DESC)',
    OPERATIONS_PATH,
  ),
  stmt(
    32,
    'PersonalOperationsStore',
    'TABLE',
    'microsoft_connection',
    'CREATE TABLE IF NOT EXISTS microsoft_connection (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  tenant_id TEXT NOT NULL,\n  client_id TEXT NOT NULL,\n  connected INTEGER NOT NULL,\n  account_name TEXT NOT NULL,\n  account_email TEXT NOT NULL,\n  mail_sync_enabled INTEGER NOT NULL,\n  calendar_sync_enabled INTEGER NOT NULL,\n  sync_interval_minutes INTEGER NOT NULL,\n  last_sync_at TEXT,\n  last_error TEXT,\n  token_blob TEXT NOT NULL,\n  token_expires_at TEXT,\n  updated_at TEXT NOT NULL\n)',
    OPERATIONS_PATH,
  ),
]);

// Derived table and index names

export const TABLE_NAMES: readonly string[] = Object.freeze([
  'app_state',
  'local_accounts',
  'idempotency_keys',
  'personal_settings',
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
  'microsoft_connection',
]);

export const INDEX_NAMES: readonly string[] = Object.freeze([
  'ix_revision_packages_project',
  'idx_project_file_index_project_category',
  'ix_project_requirements_project',
  'ix_project_actions_due',
  'ix_project_meetings_start',
  'ix_project_documents_project',
  'ix_project_communications_project',
  'ix_workspace_activity_project',
]);

export const TRIGGER_NAMES: readonly string[] = Object.freeze([]);
export const VIEW_NAMES: readonly string[] = Object.freeze([]);
export const VIRTUAL_TABLE_NAMES: readonly string[] = Object.freeze([]);

export const SCHEMA_OWNER_BY_OBJECT: ReadonlyMap<string, LegacyV322SchemaOwner> = new Map([
  ['app_state', 'StandaloneDataProvider'],
  ['local_accounts', 'StandaloneDataProvider'],
  ['idempotency_keys', 'StandaloneDataProvider'],
  ['personal_settings', 'PersonalWorkspaceStore'],
  ['project_workspaces', 'PersonalWorkspaceStore'],
  ['project_deliverables', 'PersonalWorkspaceStore'],
  ['project_luminaires', 'PersonalWorkspaceStore'],
  ['project_output_columns', 'PersonalWorkspaceStore'],
  ['project_exports', 'PersonalWorkspaceStore'],
  ['custom_folder_profiles', 'PersonalWorkspaceStore'],
  ['revision_packages', 'PersonalWorkspaceStore'],
  ['ix_revision_packages_project', 'PersonalWorkspaceStore'],
  ['project_file_index', 'PersonalWorkspaceStore'],
  ['project_file_index_runs', 'PersonalWorkspaceStore'],
  ['idx_project_file_index_project_category', 'PersonalWorkspaceStore'],
  ['project_requirements', 'PersonalOperationsStore'],
  ['ix_project_requirements_project', 'PersonalOperationsStore'],
  ['project_checklist_items', 'PersonalOperationsStore'],
  ['project_actions', 'PersonalOperationsStore'],
  ['ix_project_actions_due', 'PersonalOperationsStore'],
  ['project_meetings', 'PersonalOperationsStore'],
  ['ix_project_meetings_start', 'PersonalOperationsStore'],
  ['project_review_items', 'PersonalOperationsStore'],
  ['project_revisions', 'PersonalOperationsStore'],
  ['project_documents', 'PersonalOperationsStore'],
  ['ix_project_documents_project', 'PersonalOperationsStore'],
  ['project_contacts', 'PersonalOperationsStore'],
  ['project_communications', 'PersonalOperationsStore'],
  ['ix_project_communications_project', 'PersonalOperationsStore'],
  ['workspace_activity', 'PersonalOperationsStore'],
  ['ix_workspace_activity_project', 'PersonalOperationsStore'],
  ['microsoft_connection', 'PersonalOperationsStore'],
]);

export const COMPATIBILITY_COLUMNS: readonly LegacyV322CompatibilityOp[] = Object.freeze([
  // PersonalWorkspaceStore ensureColumn calls
  {
    table: 'project_workspaces',
    column: 'folders_json',
    definition: "TEXT NOT NULL DEFAULT '[]'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_workspaces',
    column: 'output_folders_json',
    definition: "TEXT NOT NULL DEFAULT '{}'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_workspaces',
    column: 'pdf_paper_size',
    definition: "TEXT NOT NULL DEFAULT 'Auto'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'designer_name',
    definition: "TEXT NOT NULL DEFAULT 'Mohamed'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'company_name',
    definition: "TEXT NOT NULL DEFAULT 'SCIENTECHNIC'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'company_logo_path',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'accent_color',
    definition: "TEXT NOT NULL DEFAULT '#008C95'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'time_zone',
    definition: 'TEXT NOT NULL DEFAULT (environment-dependent)',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'personal_settings',
    column: 'backup_retention',
    definition: 'INTEGER NOT NULL DEFAULT 20',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_exports',
    column: 'schedule_excel_path',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_exports',
    column: 'schedule_pdf_path',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_exports',
    column: 'boq_excel_path',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_exports',
    column: 'boq_pdf_path',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_output_columns',
    column: 'width',
    definition: 'INTEGER NOT NULL DEFAULT 140',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_output_columns',
    column: 'compare_in_revision',
    definition: 'INTEGER NOT NULL DEFAULT 1',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_output_columns',
    column: 'required_for_issue',
    definition: 'INTEGER NOT NULL DEFAULT 0',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_output_columns',
    column: 'internal_only',
    definition: 'INTEGER NOT NULL DEFAULT 0',
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'revision_packages',
    column: 'status',
    definition: "TEXT NOT NULL DEFAULT 'Draft'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: true,
  },
  {
    table: 'revision_packages',
    column: 'luminaire_snapshot_json',
    definition: "TEXT NOT NULL DEFAULT '[]'",
    owner: 'PersonalWorkspaceStore',
    alreadyInBaseCreate: false,
  },
  {
    table: 'project_revisions',
    column: 'locked',
    definition: 'INTEGER NOT NULL DEFAULT 0',
    owner: 'PersonalOperationsStore',
    alreadyInBaseCreate: true,
  },
  {
    table: 'project_revisions',
    column: 'snapshot_hash',
    definition: "TEXT NOT NULL DEFAULT ''",
    owner: 'PersonalOperationsStore',
    alreadyInBaseCreate: true,
  },
  {
    table: 'project_revisions',
    column: 'reissue_number',
    definition: 'INTEGER NOT NULL DEFAULT 0',
    owner: 'PersonalOperationsStore',
    alreadyInBaseCreate: true,
  },
]);

export const CANONICAL_FRESH_DDL: readonly string[] = Object.freeze(
  SCHEMA_STATEMENTS.map((s) => s.sql),
);

function canonicalTableKey(table: LegacyV322TableDef): string {
  const cols = table.columns
    .map(
      (c) =>
        `${c.name}:${c.declaredType}:${c.notNull ? 'NN' : 'NULL'}:${c.defaultExpression ?? '-'}:${c.primaryKeyOrder ?? '-'}:${c.unique ? 'U' : '-'}:${c.collation ?? '-'}`,
    )
    .join('|');
  const pks = table.primaryKeyColumns.join(',');
  const uqs = [...table.uniqueConstraints].sort().join(';');
  const fks = [...table.foreignKeys].sort().join(';');
  const cks = [...table.checkConstraints].sort().join(';');
  return `${table.tableName}|${cols}|PK:${pks}|UQ:${uqs}|FK:${fks}|CK:${cks}`;
}

function canonicalIndexKey(index: LegacyV322IndexDef): string {
  const cols = index.columns.map((c, i) => `${c} ${index.columnDirections[i] ?? 'ASC'}`).join(',');
  return `${index.tableName}|${index.indexName}|${index.unique ? 'UNIQUE' : 'INDEX'}|${cols}|${index.partialPredicate ?? '-'}`;
}

export function computeStructuralFingerprint(snapshot: LegacyV322SchemaSnapshot): string {
  const tableKeys = [...snapshot.tables].map(canonicalTableKey).sort();
  const indexKeys = [...snapshot.indexes].map(canonicalIndexKey).sort();
  const triggers = [...snapshot.triggerNames].sort().join(',');
  const views = [...snapshot.viewNames].sort().join(',');
  const virtuals = [...snapshot.virtualTableNames].sort().join(',');

  const input = [
    'TABLES:',
    ...tableKeys,
    'INDEXES:',
    ...indexKeys,
    'TRIGGERS:',
    triggers,
    'VIEWS:',
    views,
    'VIRTUAL_TABLES:',
    virtuals,
  ].join('\n');

  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

export function computeCanonicalDdlFingerprint(ddlStatements: readonly string[]): string {
  const normalized = ddlStatements.map((s) => s.trim().replace(/\s+/g, ' ')).join('\n');
  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

// ---------------------------------------------------------------------------
// Canonical schema snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build a complete LegacyV322SchemaSnapshot from the canonical DDL statements.
 * This is the trusted historical structural representation used for fingerprint
 * computation and identity locking.
 */
export function buildCanonicalSchemaSnapshot(): LegacyV322SchemaSnapshot {
  const tables: LegacyV322TableDef[] = [];
  const indexes: LegacyV322IndexDef[] = [];

  for (const stmt of SCHEMA_STATEMENTS) {
    if (stmt.kind === 'TABLE') {
      tables.push(parseTableDdl(stmt.objectName, stmt.sql));
    } else if (stmt.kind === 'INDEX') {
      indexes.push(parseIndexDdl(stmt.sql));
    }
  }

  return Object.freeze({
    tables: Object.freeze(
      tables.map((t) =>
        Object.freeze({ ...t, columns: Object.freeze(t.columns.map((c) => Object.freeze(c))) }),
      ),
    ),
    indexes: Object.freeze(indexes.map((i) => Object.freeze(i))),
    triggerNames: TRIGGER_NAMES,
    viewNames: VIEW_NAMES,
    virtualTableNames: VIRTUAL_TABLE_NAMES,
  });
}

function parseTableDdl(tableName: string, sql: string): LegacyV322TableDef {
  const columns: LegacyV322ColumnDef[] = [];
  const primaryKeyColumns: string[] = [];
  const uniqueConstraints: string[] = [];
  const foreignKeys: string[] = [];
  const checkConstraints: string[] = [];

  // Extract the column definitions from between the outer parentheses
  const parenMatch = sql.match(/\(([\s\S]*)\)\s*$/);
  if (!parenMatch) {
    return {
      tableName,
      columns: [],
      primaryKeyColumns: [],
      uniqueConstraints: [],
      foreignKeys: [],
      checkConstraints: [],
    };
  }

  const inner = parenMatch[1]!;
  // Split by top-level commas (not inside nested parens)
  const parts = splitTopLevelCommas(inner);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check for constraint clauses
    if (
      trimmed.toUpperCase().startsWith('UNIQUE(') ||
      trimmed.toUpperCase().startsWith('UNIQUE (')
    ) {
      const match = trimmed.match(/UNIQUE\s*\(([^)]+)\)/i);
      if (match) {
        uniqueConstraints.push(match[1]!.trim());
      }
      continue;
    }

    if (
      trimmed.toUpperCase().startsWith('PRIMARY KEY(') ||
      trimmed.toUpperCase().startsWith('PRIMARY KEY (')
    ) {
      const match = trimmed.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (match) {
        const cols = match[1]!.split(',').map((c) => c.trim());
        primaryKeyColumns.push(...cols);
      }
      continue;
    }

    if (trimmed.toUpperCase().startsWith('CHECK')) {
      checkConstraints.push(trimmed);
      continue;
    }

    if (trimmed.toUpperCase().startsWith('FOREIGN KEY')) {
      foreignKeys.push(trimmed);
      continue;
    }

    // It's a column definition
    const col = parseColumnDef(trimmed);
    if (col) {
      columns.push(col);
    }
  }

  return {
    tableName,
    columns: Object.freeze(columns),
    primaryKeyColumns: Object.freeze(primaryKeyColumns),
    uniqueConstraints: Object.freeze(uniqueConstraints),
    foreignKeys: Object.freeze(foreignKeys),
    checkConstraints: Object.freeze(checkConstraints),
  };
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseColumnDef(text: string): LegacyV322ColumnDef | null {
  // Match: name type [NOT NULL] [DEFAULT expr] [PRIMARY KEY] [UNIQUE] [COLLATE name]
  const match = text.match(/^\s*(\w+)\s+([A-Za-z0-9_]+(?:\s*\([^)]*\))?)\s*(.*?)$/);
  if (!match) return null;

  const name = match[1]!;
  const declaredType = match[2]!;
  const rest = match[3]!.toUpperCase();

  const notNull = rest.includes('NOT NULL');
  const unique = rest.includes('UNIQUE');
  const pkMatch = text.match(/PRIMARY\s+KEY\s*(?:\([^)]*\))?/i);
  const primaryKeyOrder = pkMatch ? 1 : undefined;
  const collMatch = text.match(/COLLATE\s+(\w+)/i);
  const collation = collMatch ? collMatch[1]! : undefined;

  // Extract default value
  let defaultExpression: string | undefined;
  const defMatch = text.match(/DEFAULT\s+('[^']*'|[^\s,)]+)/i);
  if (defMatch) {
    defaultExpression = defMatch[1]!;
  }

  return {
    name,
    declaredType,
    notNull,
    defaultExpression,
    primaryKeyOrder,
    unique,
    collation,
  };
}

function parseIndexDdl(sql: string): LegacyV322IndexDef {
  // Match: CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table(col1 [ASC|DESC], col2 [ASC|DESC], ...)
  const match = sql.match(
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/i,
  );
  if (!match) {
    return {
      indexName: 'unknown',
      tableName: 'unknown',
      unique: false,
      columns: [],
      columnDirections: [],
      partialPredicate: undefined,
    };
  }

  const unique = !!match[1];
  const indexName = match[2]!;
  const tableName = match[3]!;
  const colSpecs = match[4]!.split(',').map((s) => s.trim());

  const columns: string[] = [];
  const columnDirections: string[] = [];
  for (const spec of colSpecs) {
    const dirMatch = spec.match(/^(\w+)\s+(ASC|DESC)$/i);
    if (dirMatch) {
      columns.push(dirMatch[1]!);
      columnDirections.push(dirMatch[2]!.toUpperCase());
    } else {
      columns.push(spec);
      columnDirections.push('ASC');
    }
  }

  return {
    indexName,
    tableName,
    unique,
    columns: Object.freeze(columns),
    columnDirections: Object.freeze(columnDirections),
    partialPredicate: undefined,
  };
}

/**
 * The complete canonical schema snapshot built from the historical DDL source.
 * This is the trusted structural representation used for fingerprint computation.
 */
export const CANONICAL_SCHEMA_SNAPSHOT: LegacyV322SchemaSnapshot = buildCanonicalSchemaSnapshot();
export interface RuntimeDefaultRow {
  readonly table: string;
  readonly key: string;
  readonly sourceComponent: string;
  readonly creationCondition: string;
  readonly deterministic: boolean;
  readonly environmentDependent: boolean;
  readonly credentialSensitive: boolean;
}

export const RUNTIME_DEFAULT_ROWS: readonly RuntimeDefaultRow[] = Object.freeze([
  {
    table: 'personal_settings',
    key: 'id=1',
    sourceComponent: 'PersonalWorkspaceStore',
    creationCondition: 'INSERT OR IGNORE on first constructor call',
    deterministic: false,
    environmentDependent: true,
    credentialSensitive: false,
  },
  {
    table: 'microsoft_connection',
    key: 'id=1',
    sourceComponent: 'PersonalOperationsStore',
    creationCondition: 'INSERT OR IGNORE on first constructor call',
    deterministic: true,
    environmentDependent: false,
    credentialSensitive: false,
  },
  {
    table: 'app_state',
    key: 'state_key=primary',
    sourceComponent: 'StandaloneDataProvider',
    creationCondition: 'INSERT on first constructor call when no existing state row',
    deterministic: false,
    environmentDependent: true,
    credentialSensitive: false,
  },
  {
    table: 'local_accounts',
    key: 'bootstrap admin',
    sourceComponent: 'StandaloneDataProvider',
    creationCondition: 'ensureBootstrapAccount on first constructor call when no accounts exist',
    deterministic: false,
    environmentDependent: true,
    credentialSensitive: true,
  },
]);

export type LegacyV322FixtureProfile =
  'SCHEMA_ONLY' | 'RUNTIME_MINIMAL' | 'REPRESENTATIVE_POPULATED' | 'PARTIAL_STANDALONE_ONLY';

export const SUPPORTED_INITIAL_PROFILES: readonly LegacyV322FixtureProfile[] = Object.freeze([
  'SCHEMA_ONLY',
  'RUNTIME_MINIMAL',
  'REPRESENTATIVE_POPULATED',
  'PARTIAL_STANDALONE_ONLY',
]);

export const DEFERRED_PROFILES: readonly string[] = Object.freeze([
  'EXTRA_TABLE',
  'MISSING_TABLE',
  'EXTRA_COLUMN',
  'CORRUPT_DATABASE',
  'WAL_INTERRUPTED',
  'HALF_WRITTEN',
  'UNKNOWN_SCHEMA',
]);
