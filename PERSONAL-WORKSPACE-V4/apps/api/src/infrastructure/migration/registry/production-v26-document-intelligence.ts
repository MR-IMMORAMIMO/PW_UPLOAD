import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V26_MIGRATION_ID = 'production-25-26-document-intelligence';
export const PRODUCTION_V26_MIGRATION_DESCRIPTION =
  'Add immutable document sources, versioned intelligence, durable processing, review, findings, and governed routing.';

export const PRODUCTION_V26_TABLE_NAMES = Object.freeze([
  'document_sources',
  'intelligence_documents',
  'document_versions',
  'document_processing_attempts',
  'document_extraction_values',
  'document_relationships',
  'document_quality_findings',
  'document_owner_decisions',
  'document_routing_proposals',
] as const);

export const PRODUCTION_V26_INDEX_NAMES = Object.freeze([
  'ux_document_sources_store_hash',
  'ux_document_sources_artifact_version',
  'ix_intelligence_documents_review_queue',
  'ix_intelligence_documents_project_comparison',
  'ux_document_versions_sequence',
  'ix_document_versions_source',
  'ux_document_attempts_one_active',
  'ux_document_attempts_idempotency',
  'ix_document_attempts_queue',
  'ux_document_values_attempt_field',
  'ix_document_values_version_page',
  'ux_document_relationship_pair_type',
  'ix_document_relationships_review',
  'ux_document_findings_generation',
  'ix_document_findings_review',
  'ix_document_decisions_document',
  'ux_document_routing_idempotency',
  'ix_document_routing_review',
] as const);

const DDL = Object.freeze([
  `CREATE TABLE document_sources (
    source_id TEXT PRIMARY KEY,
    storage_mode TEXT NOT NULL CHECK (storage_mode IN ('DOCUMENT_STORE', 'MANAGED_ARTIFACT_VERSION')),
    storage_state TEXT NOT NULL CHECK (storage_state IN ('STAGING', 'AVAILABLE', 'MISSING')),
    managed_locator TEXT,
    artifact_version_id TEXT,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
    media_type TEXT NOT NULL CHECK (media_type = 'application/pdf'),
    original_file_name TEXT NOT NULL CHECK (length(trim(original_file_name)) BETWEEN 1 AND 260),
    admission_mechanism TEXT NOT NULL CHECK (admission_mechanism IN ('GLOBAL_SELECT', 'PROJECT_SELECT', 'PHASE4_ARTIFACT')),
    admitted_at TEXT NOT NULL,
    finalized_at TEXT,
    CHECK (
      (storage_mode = 'DOCUMENT_STORE' AND managed_locator IS NOT NULL AND artifact_version_id IS NULL)
      OR
      (storage_mode = 'MANAGED_ARTIFACT_VERSION' AND managed_locator IS NULL AND artifact_version_id IS NOT NULL)
    ),
    FOREIGN KEY (artifact_version_id) REFERENCES artifact_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_sources_store_hash ON document_sources(sha256)
    WHERE storage_mode = 'DOCUMENT_STORE' AND storage_state = 'AVAILABLE'`,
  `CREATE UNIQUE INDEX ux_document_sources_artifact_version ON document_sources(artifact_version_id)
    WHERE artifact_version_id IS NOT NULL`,
  `CREATE TABLE intelligence_documents (
    document_id TEXT PRIMARY KEY,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ADMITTED','NEEDS_REVIEW','ACCEPTED','SUPERSEDED','EXCLUDED','TOMBSTONED')),
    confirmed_project_id TEXT,
    association_state TEXT NOT NULL CHECK (association_state IN ('CONFIRMED','LIKELY','AMBIGUOUS','CONFLICTING','UNRESOLVED')),
    classification TEXT NOT NULL CHECK (classification IN (
      'DIALUX_CALCULATION_REPORT','LIGHTING_LAYOUT','LUMINAIRE_SCHEDULE','BOQ_QTO','PRODUCT_DATASHEET',
      'TECHNICAL_SUBMITTAL','CLIENT_COMMENT_MARKUP','REFERENCE_DOCUMENT','MEETING_DOCUMENT',
      'COMMERCIAL_RECEIPT','REVISION_REGISTER','TRANSMITTAL','COVER_SHEET','VISUALIZATION_RENDERING','UNKNOWN')),
    classification_confidence REAL NOT NULL CHECK (classification_confidence BETWEEN 0 AND 100),
    active_version_id TEXT,
    comparison_enabled INTEGER NOT NULL DEFAULT 0 CHECK (comparison_enabled IN (0,1)),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    tombstoned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (confirmed_project_id) REFERENCES project_workspaces(project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (active_version_id) REFERENCES document_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK ((association_state = 'CONFIRMED' AND confirmed_project_id IS NOT NULL)
      OR association_state <> 'CONFIRMED')
  )`,
  `CREATE INDEX ix_intelligence_documents_review_queue
    ON intelligence_documents(lifecycle, association_state, classification, updated_at DESC)`,
  `CREATE INDEX ix_intelligence_documents_project_comparison
    ON intelligence_documents(confirmed_project_id, comparison_enabled, lifecycle)`,
  `CREATE TABLE document_versions (
    version_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version_sequence INTEGER NOT NULL CHECK (version_sequence >= 1),
    source_id TEXT NOT NULL,
    admission_provenance_json TEXT NOT NULL CHECK (json_valid(admission_provenance_json)),
    initial_project_context_id TEXT,
    processing_state TEXT NOT NULL CHECK (processing_state IN (
      'QUEUED','VALIDATING','NATIVE_EXTRACTION','OCR','CLASSIFICATION','ASSOCIATION','STRUCTURED_EXTRACTION',
      'RELATIONSHIPS','QUALITY','COMPLETE','INCOMPLETE','FAILED_RETRYABLE','CANCELLED','INTERRUPTED')),
    admitted_at TEXT NOT NULL,
    accepted_at TEXT,
    FOREIGN KEY (document_id) REFERENCES intelligence_documents(document_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (source_id) REFERENCES document_sources(source_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (initial_project_context_id) REFERENCES project_workspaces(project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_versions_sequence ON document_versions(document_id, version_sequence)`,
  `CREATE INDEX ix_document_versions_source ON document_versions(source_id, admitted_at)`,
  `CREATE TABLE document_processing_attempts (
    attempt_id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'QUEUED','VALIDATING','NATIVE_EXTRACTION','OCR','CLASSIFICATION','ASSOCIATION','STRUCTURED_EXTRACTION',
      'RELATIONSHIPS','QUALITY','COMPLETE','INCOMPLETE','FAILED_RETRYABLE','CANCELLED','INTERRUPTED')),
    stage_checkpoint TEXT NOT NULL,
    completed_pages INTEGER NOT NULL DEFAULT 0 CHECK (completed_pages >= 0),
    ocr_pages INTEGER NOT NULL DEFAULT 0 CHECK (ocr_pages BETWEEN 0 AND 40),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
    extractor_fingerprint TEXT NOT NULL CHECK (length(extractor_fingerprint) = 64),
    classification_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(classification_evidence_json)),
    association_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(association_evidence_json)),
    error_code TEXT,
    error_summary TEXT,
    idempotency_key TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (version_id) REFERENCES document_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_attempts_one_active ON document_processing_attempts(version_id)
    WHERE state IN ('QUEUED','VALIDATING','NATIVE_EXTRACTION','OCR','CLASSIFICATION','ASSOCIATION','STRUCTURED_EXTRACTION','RELATIONSHIPS','QUALITY')`,
  `CREATE UNIQUE INDEX ux_document_attempts_idempotency ON document_processing_attempts(idempotency_key)`,
  `CREATE INDEX ix_document_attempts_queue ON document_processing_attempts(state, created_at)`,
  `CREATE TABLE document_extraction_values (
    value_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 200),
    region_json TEXT CHECK (region_json IS NULL OR json_valid(region_json)),
    raw_value TEXT NOT NULL,
    normalized_value_json TEXT CHECK (normalized_value_json IS NULL OR json_valid(normalized_value_json)),
    canonical_field TEXT NOT NULL,
    unit TEXT,
    basis TEXT,
    extraction_method TEXT NOT NULL CHECK (extraction_method IN ('NATIVE_TEXT','NATIVE_TABLE','OCR')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    adapter_id TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES document_processing_attempts(attempt_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (version_id) REFERENCES document_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_values_attempt_field
    ON document_extraction_values(attempt_id, page_number, canonical_field, extraction_method, raw_value)`,
  `CREATE INDEX ix_document_values_version_page
    ON document_extraction_values(version_id, page_number, canonical_field)`,
  `CREATE TABLE document_relationships (
    relationship_id TEXT PRIMARY KEY,
    left_version_id TEXT NOT NULL,
    right_version_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('EXACT_DUPLICATE','POSSIBLE_REVISION','RELATED_DOCUMENT','UNRELATED','AMBIGUOUS_RELATIONSHIP')),
    state TEXT NOT NULL CHECK (state IN ('PROPOSED','CONFIRMED','REJECTED','SUPERSEDED')),
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    generation_fingerprint TEXT NOT NULL CHECK (length(generation_fingerprint) = 64),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (left_version_id < right_version_id),
    FOREIGN KEY (left_version_id) REFERENCES document_versions(version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (right_version_id) REFERENCES document_versions(version_id) ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_relationship_pair_type
    ON document_relationships(left_version_id, right_version_id, relationship_type)`,
  `CREATE INDEX ix_document_relationships_review ON document_relationships(state, updated_at DESC)`,
  `CREATE TABLE document_quality_findings (
    finding_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version_id TEXT,
    finding_code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
    state TEXT NOT NULL CHECK (state IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED_WITH_REASON','SUPERSEDED')),
    title TEXT NOT NULL,
    explanation TEXT NOT NULL,
    field_key TEXT,
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    recommended_action TEXT NOT NULL,
    generation_fingerprint TEXT NOT NULL CHECK (length(generation_fingerprint) = 64),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES intelligence_documents(document_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (version_id) REFERENCES document_versions(version_id) ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_findings_generation
    ON document_quality_findings(document_id, IFNULL(version_id,''), finding_code, IFNULL(field_key,''), generation_fingerprint)`,
  `CREATE INDEX ix_document_findings_review ON document_quality_findings(document_id, state, severity, updated_at DESC)`,
  `CREATE TABLE document_owner_decisions (
    decision_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_id TEXT,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
    before_projection_json TEXT NOT NULL CHECK (json_valid(before_projection_json)),
    after_projection_json TEXT NOT NULL CHECK (json_valid(after_projection_json)),
    evidence_fingerprint TEXT,
    expected_row_version INTEGER NOT NULL CHECK (expected_row_version >= 1),
    decided_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES intelligence_documents(document_id) ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX ix_document_decisions_document ON document_owner_decisions(document_id, decided_at DESC)`,
  `CREATE TABLE document_routing_proposals (
    proposal_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    destination_mapping_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('PROPOSED','APPROVED','EXECUTING','COMPLETED','STALE','REJECTED','FAILED')),
    eligibility_fingerprint TEXT NOT NULL CHECK (length(eligibility_fingerprint) = 64),
    source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
    project_id TEXT NOT NULL,
    folder_fingerprint TEXT NOT NULL CHECK (length(folder_fingerprint) = 64),
    idempotency_key TEXT NOT NULL,
    row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
    approved_decision_id TEXT,
    project_document_id TEXT,
    artifact_version_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES intelligence_documents(document_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (version_id) REFERENCES document_versions(version_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (project_id) REFERENCES project_workspaces(project_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (approved_decision_id) REFERENCES document_owner_decisions(decision_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (project_document_id) REFERENCES project_documents(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (artifact_version_id) REFERENCES artifact_versions(version_id) ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE UNIQUE INDEX ux_document_routing_idempotency ON document_routing_proposals(idempotency_key)`,
  `CREATE INDEX ix_document_routing_review ON document_routing_proposals(document_id, state, updated_at DESC)`,
] as const);

function presentObjects(database: DatabaseSync): number {
  const expected = [...PRODUCTION_V26_TABLE_NAMES, ...PRODUCTION_V26_INDEX_NAMES];
  const rows = database
    .prepare(`SELECT name FROM sqlite_schema WHERE name IN (${expected.map(() => '?').join(',')})`)
    .all(...expected) as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name)).size;
}

export function applyV26DocumentIntelligence(database: DatabaseSync): void {
  const count = presentObjects(database);
  const total = PRODUCTION_V26_TABLE_NAMES.length + PRODUCTION_V26_INDEX_NAMES.length;
  if (count === total) return;
  if (count !== 0)
    throw new Error('Version-26 migration found a partial Document Intelligence schema.');
  for (const ddl of DDL) database.exec(ddl);
  database.exec(`UPDATE intelligence_documents SET active_version_id = NULL WHERE 0`);
}

export function rollbackV26DocumentIntelligence(database: DatabaseSync): void {
  const populated = PRODUCTION_V26_TABLE_NAMES.some((table) => {
    const row = database.prepare(`SELECT 1 present FROM ${table} LIMIT 1`).get() as
      { present: number } | undefined;
    return row !== undefined;
  });
  if (populated) {
    throw new Error('Version-26 rollback is blocked while Document Intelligence records exist.');
  }
  for (const table of [...PRODUCTION_V26_TABLE_NAMES].reverse())
    database.exec(`DROP TABLE IF EXISTS ${table}`);
}

export function validateV26DocumentIntelligence(database: DatabaseSync): void {
  const total = PRODUCTION_V26_TABLE_NAMES.length + PRODUCTION_V26_INDEX_NAMES.length;
  if (presentObjects(database) !== total)
    throw new Error('Version-26 Document Intelligence schema is incomplete.');
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('Version-26 Document Intelligence schema has foreign-key violations.');
  }
}

export function computeV26MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V26_MIGRATION_ID,
        description: PRODUCTION_V26_MIGRATION_DESCRIPTION,
        ddl: DDL,
      }),
      'utf8',
    )
    .digest('hex');
}
