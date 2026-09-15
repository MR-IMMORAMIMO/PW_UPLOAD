import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V27_MIGRATION_ID = 'production-26-27-luminaire-datasheet-verification';
export const PRODUCTION_V27_MIGRATION_DESCRIPTION =
  'Add normalized Luminaire Datasheet document-source authority and durable verification fingerprints.';

export const PRODUCTION_V27_TABLE_NAMES = Object.freeze([
  'luminaire_datasheet_verifications',
] as const);

export const PRODUCTION_V27_INDEX_NAMES = Object.freeze([
  'ux_document_sources_luminaire_asset_version',
  'ux_luminaire_datasheet_verifications_current',
  'ix_luminaire_datasheet_verifications_asset',
  'ix_luminaire_datasheet_verifications_document_version',
] as const);

export const PRODUCTION_V27_TRIGGER_NAMES = Object.freeze([
  'trg_document_sources_luminaire_datasheet_insert',
  'trg_document_sources_luminaire_datasheet_update',
  'trg_luminaire_datasheet_verifications_authority_insert',
  'trg_luminaire_datasheet_verifications_authority_update',
] as const);

const DOCUMENT_SOURCES_V27_DDL = `CREATE TABLE document_sources__v27 (
  source_id TEXT PRIMARY KEY,
  storage_mode TEXT NOT NULL CHECK (storage_mode IN (
    'DOCUMENT_STORE','MANAGED_ARTIFACT_VERSION','LUMINAIRE_ASSET_VERSION'
  )),
  storage_state TEXT NOT NULL CHECK (storage_state IN ('STAGING','AVAILABLE','MISSING')),
  managed_locator TEXT,
  artifact_version_id TEXT,
  luminaire_asset_version_id TEXT,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  media_type TEXT NOT NULL CHECK (media_type = 'application/pdf'),
  original_file_name TEXT NOT NULL CHECK (length(trim(original_file_name)) BETWEEN 1 AND 260),
  admission_mechanism TEXT NOT NULL CHECK (admission_mechanism IN (
    'GLOBAL_SELECT','PROJECT_SELECT','PHASE4_ARTIFACT','LUMINAIRE_ATTACHMENT'
  )),
  admitted_at TEXT NOT NULL,
  finalized_at TEXT,
  CHECK (
    (storage_mode = 'DOCUMENT_STORE' AND managed_locator IS NOT NULL
      AND artifact_version_id IS NULL AND luminaire_asset_version_id IS NULL)
    OR
    (storage_mode = 'MANAGED_ARTIFACT_VERSION' AND managed_locator IS NULL
      AND artifact_version_id IS NOT NULL AND luminaire_asset_version_id IS NULL)
    OR
    (storage_mode = 'LUMINAIRE_ASSET_VERSION' AND managed_locator IS NULL
      AND artifact_version_id IS NULL AND luminaire_asset_version_id IS NOT NULL)
  ),
  FOREIGN KEY (artifact_version_id) REFERENCES artifact_versions(version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (luminaire_asset_version_id) REFERENCES luminaire_asset_versions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)`;

const DOCUMENT_SOURCES_V26_DDL = `CREATE TABLE document_sources__v26 (
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
)`;

const VERIFICATION_DDL = `CREATE TABLE luminaire_datasheet_verifications (
  verification_id TEXT PRIMARY KEY,
  project_luminaire_id TEXT NOT NULL,
  luminaire_asset_version_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  luminaire_authority_kind TEXT NOT NULL
    CHECK (luminaire_authority_kind IN ('PROJECT_ROW','LIBRARY_VERSION')),
  luminaire_authority_version TEXT NOT NULL CHECK (length(trim(luminaire_authority_version)) > 0),
  datasheet_sha256 TEXT NOT NULL
    CHECK (length(datasheet_sha256) = 64 AND datasheet_sha256 NOT GLOB '*[^0-9a-f]*'),
  extractor_fingerprint TEXT NOT NULL
    CHECK (length(extractor_fingerprint) = 64 AND extractor_fingerprint NOT GLOB '*[^0-9a-f]*'),
  semantic_mapping_version TEXT NOT NULL CHECK (length(trim(semantic_mapping_version)) > 0),
  comparison_fingerprint TEXT NOT NULL
    CHECK (length(comparison_fingerprint) = 64 AND comparison_fingerprint NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('CURRENT','STALE','SUPERSEDED')),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_luminaire_id) REFERENCES project_luminaires(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (luminaire_asset_version_id) REFERENCES luminaire_asset_versions(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)`;

const INDEX_DDL = Object.freeze([
  `CREATE UNIQUE INDEX ux_document_sources_store_hash ON document_sources(sha256)
    WHERE storage_mode = 'DOCUMENT_STORE' AND storage_state = 'AVAILABLE'`,
  `CREATE UNIQUE INDEX ux_document_sources_artifact_version ON document_sources(artifact_version_id)
    WHERE artifact_version_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_document_sources_luminaire_asset_version
    ON document_sources(luminaire_asset_version_id)
    WHERE luminaire_asset_version_id IS NOT NULL`,
  `CREATE UNIQUE INDEX ux_luminaire_datasheet_verifications_current
    ON luminaire_datasheet_verifications(project_luminaire_id) WHERE state = 'CURRENT'`,
  `CREATE INDEX ix_luminaire_datasheet_verifications_asset
    ON luminaire_datasheet_verifications(luminaire_asset_version_id, state, updated_at DESC)`,
  `CREATE INDEX ix_luminaire_datasheet_verifications_document_version
    ON luminaire_datasheet_verifications(document_version_id, state)`,
] as const);

const TRIGGER_DDL = Object.freeze([
  `CREATE TRIGGER trg_document_sources_luminaire_datasheet_insert
    BEFORE INSERT ON document_sources
    WHEN NEW.storage_mode = 'LUMINAIRE_ASSET_VERSION'
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM luminaire_asset_versions
        WHERE id = NEW.luminaire_asset_version_id AND asset_type = 'Datasheet'
      ) THEN RAISE(ABORT, 'LUMINAIRE_DATASHEET_SOURCE_INVALID') END;
    END`,
  `CREATE TRIGGER trg_document_sources_luminaire_datasheet_update
    BEFORE UPDATE OF storage_mode,luminaire_asset_version_id ON document_sources
    WHEN NEW.storage_mode = 'LUMINAIRE_ASSET_VERSION'
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM luminaire_asset_versions
        WHERE id = NEW.luminaire_asset_version_id AND asset_type = 'Datasheet'
      ) THEN RAISE(ABORT, 'LUMINAIRE_DATASHEET_SOURCE_INVALID') END;
    END`,
  `CREATE TRIGGER trg_luminaire_datasheet_verifications_authority_insert
    BEFORE INSERT ON luminaire_datasheet_verifications
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM luminaire_asset_versions lav
        JOIN project_luminaires pl ON pl.id = NEW.project_luminaire_id
        JOIN document_versions dv ON dv.version_id = NEW.document_version_id
        JOIN document_sources ds ON ds.source_id = dv.source_id
        WHERE lav.id = NEW.luminaire_asset_version_id
          AND lav.luminaire_id = NEW.project_luminaire_id
          AND lav.project_id = pl.project_id
          AND lav.asset_type = 'Datasheet'
          AND lav.file_hash = NEW.datasheet_sha256
          AND ds.storage_mode = 'LUMINAIRE_ASSET_VERSION'
          AND ds.luminaire_asset_version_id = lav.id
          AND ds.sha256 = NEW.datasheet_sha256
      ) THEN RAISE(ABORT, 'LUMINAIRE_DATASHEET_VERIFICATION_AUTHORITY_INVALID') END;
    END`,
  `CREATE TRIGGER trg_luminaire_datasheet_verifications_authority_update
    BEFORE UPDATE OF project_luminaire_id,luminaire_asset_version_id,document_version_id,datasheet_sha256
    ON luminaire_datasheet_verifications
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM luminaire_asset_versions lav
        JOIN project_luminaires pl ON pl.id = NEW.project_luminaire_id
        JOIN document_versions dv ON dv.version_id = NEW.document_version_id
        JOIN document_sources ds ON ds.source_id = dv.source_id
        WHERE lav.id = NEW.luminaire_asset_version_id
          AND lav.luminaire_id = NEW.project_luminaire_id
          AND lav.project_id = pl.project_id
          AND lav.asset_type = 'Datasheet'
          AND lav.file_hash = NEW.datasheet_sha256
          AND ds.storage_mode = 'LUMINAIRE_ASSET_VERSION'
          AND ds.luminaire_asset_version_id = lav.id
          AND ds.sha256 = NEW.datasheet_sha256
      ) THEN RAISE(ABORT, 'LUMINAIRE_DATASHEET_VERIFICATION_AUTHORITY_INVALID') END;
    END`,
] as const);

function objectNames(database: DatabaseSync, type: 'table' | 'index' | 'trigger'): Set<string> {
  return new Set(
    (
      database.prepare('SELECT name FROM sqlite_schema WHERE type = ?').all(type) as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  );
}

function createV27IndexesAndTriggers(database: DatabaseSync): void {
  for (const ddl of INDEX_DDL) database.exec(ddl);
  for (const ddl of TRIGGER_DDL) database.exec(ddl);
}

function requireForeignKeyRebuildMode(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA foreign_keys').get() as
    { foreign_keys?: number } | undefined;
  const referencedRows = database.prepare('SELECT COUNT(*) count FROM document_versions').get() as {
    count: number;
  };
  if (row?.foreign_keys !== 0 && referencedRows.count > 0) {
    throw new Error(
      'Version-27 document-source table rebuild requires declared foreign-key rebuild mode.',
    );
  }
}

export function applyV27LuminaireDatasheetVerification(database: DatabaseSync): void {
  const upgraded = hasColumn(database, 'document_sources', 'luminaire_asset_version_id');
  const tables = objectNames(database, 'table');
  const indexes = objectNames(database, 'index');
  const triggers = objectNames(database, 'trigger');
  const complete =
    upgraded &&
    PRODUCTION_V27_TABLE_NAMES.every((name) => tables.has(name)) &&
    PRODUCTION_V27_INDEX_NAMES.every((name) => indexes.has(name)) &&
    PRODUCTION_V27_TRIGGER_NAMES.every((name) => triggers.has(name));
  if (complete) return;
  const partial =
    upgraded ||
    PRODUCTION_V27_TABLE_NAMES.some((name) => tables.has(name)) ||
    PRODUCTION_V27_INDEX_NAMES.some((name) => indexes.has(name)) ||
    PRODUCTION_V27_TRIGGER_NAMES.some((name) => triggers.has(name)) ||
    tables.has('document_sources__v27');
  if (partial)
    throw new Error('Version-27 migration found a partial Datasheet verification schema.');

  requireForeignKeyRebuildMode(database);
  database.exec(DOCUMENT_SOURCES_V27_DDL);
  database.exec(`INSERT INTO document_sources__v27
    (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,
     luminaire_asset_version_id,sha256,size_bytes,media_type,original_file_name,
     admission_mechanism,admitted_at,finalized_at)
    SELECT source_id,storage_mode,storage_state,managed_locator,artifact_version_id,
           NULL,sha256,size_bytes,media_type,original_file_name,
           admission_mechanism,admitted_at,finalized_at
    FROM document_sources`);
  database.exec('DROP TABLE document_sources');
  database.exec('ALTER TABLE document_sources__v27 RENAME TO document_sources');
  database.exec(VERIFICATION_DDL);
  createV27IndexesAndTriggers(database);
}

export function rollbackV27LuminaireDatasheetVerification(database: DatabaseSync): void {
  const verificationCount = database
    .prepare('SELECT COUNT(*) count FROM luminaire_datasheet_verifications')
    .get() as { count: number };
  const sourceCount = database
    .prepare(
      `SELECT COUNT(*) count FROM document_sources
       WHERE storage_mode = 'LUMINAIRE_ASSET_VERSION' OR luminaire_asset_version_id IS NOT NULL`,
    )
    .get() as { count: number };
  if (verificationCount.count > 0 || sourceCount.count > 0) {
    throw new Error('Version-27 rollback is blocked while Luminaire Datasheet authority exists.');
  }
  requireForeignKeyRebuildMode(database);
  for (const name of PRODUCTION_V27_TRIGGER_NAMES) database.exec(`DROP TRIGGER IF EXISTS ${name}`);
  database.exec('DROP TABLE luminaire_datasheet_verifications');
  database.exec(DOCUMENT_SOURCES_V26_DDL);
  database.exec(`INSERT INTO document_sources__v26
    (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,size_bytes,
     media_type,original_file_name,admission_mechanism,admitted_at,finalized_at)
    SELECT source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,size_bytes,
           media_type,original_file_name,admission_mechanism,admitted_at,finalized_at
    FROM document_sources`);
  database.exec('DROP TABLE document_sources');
  database.exec('ALTER TABLE document_sources__v26 RENAME TO document_sources');
  database.exec(`CREATE UNIQUE INDEX ux_document_sources_store_hash ON document_sources(sha256)
    WHERE storage_mode = 'DOCUMENT_STORE' AND storage_state = 'AVAILABLE'`);
  database.exec(`CREATE UNIQUE INDEX ux_document_sources_artifact_version
    ON document_sources(artifact_version_id) WHERE artifact_version_id IS NOT NULL`);
}

export function validateV27LuminaireDatasheetVerification(database: DatabaseSync): void {
  if (!hasColumn(database, 'document_sources', 'luminaire_asset_version_id'))
    throw new Error('Version-27 document source authority is missing.');
  const tables = objectNames(database, 'table');
  const indexes = objectNames(database, 'index');
  const triggers = objectNames(database, 'trigger');
  for (const name of PRODUCTION_V27_TABLE_NAMES)
    if (!tables.has(name)) throw new Error(`Version-27 migration is missing table ${name}.`);
  for (const name of PRODUCTION_V27_INDEX_NAMES)
    if (!indexes.has(name)) throw new Error(`Version-27 migration is missing index ${name}.`);
  for (const name of PRODUCTION_V27_TRIGGER_NAMES)
    if (!triggers.has(name)) throw new Error(`Version-27 migration is missing trigger ${name}.`);
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0)
    throw new Error('Version-27 Datasheet verification schema has foreign-key violations.');
}

export function computeV27MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V27_MIGRATION_ID,
        description: PRODUCTION_V27_MIGRATION_DESCRIPTION,
        sourceTable: DOCUMENT_SOURCES_V27_DDL,
        verificationTable: VERIFICATION_DDL,
        indexes: INDEX_DDL,
        triggers: TRIGGER_DDL,
      }),
      'utf8',
    )
    .digest('hex');
}
