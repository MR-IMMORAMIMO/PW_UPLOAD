import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V22_MIGRATION_ID = 'production-21-22-master-luminaire-library';
export const PRODUCTION_V22_MIGRATION_DESCRIPTION =
  'Add the versioned Master Luminaire Library, managed asset provenance, and exact Project bindings.';

export const PRODUCTION_V22_TABLE_NAMES = Object.freeze([
  'luminaire_manufacturers',
  'luminaire_library_products',
  'luminaire_library_variants',
  'luminaire_library_versions',
  'luminaire_library_assets',
  'luminaire_library_asset_versions',
  'luminaire_library_version_assets',
  'project_luminaire_library_bindings',
  'luminaire_library_activity',
] as const);

export const PRODUCTION_V22_INDEX_NAMES = Object.freeze([
  'ux_luminaire_manufacturers_normalized_name',
  'ix_luminaire_library_products_manufacturer_status',
  'ix_luminaire_library_variants_product_status',
  'ix_luminaire_library_versions_variant_sequence',
  'ix_luminaire_library_versions_search',
  'ix_luminaire_library_assets_owner_type',
  'ix_luminaire_library_asset_versions_asset_sequence',
  'ix_luminaire_library_asset_versions_hash',
  'ix_luminaire_library_version_assets_asset',
  'ix_project_luminaire_library_bindings_version',
  'ix_luminaire_library_activity_entity_time',
  'ux_luminaire_library_activity_idempotency',
  'ix_luminaire_asset_versions_source_library',
] as const);

export const PRODUCTION_V22_DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS luminaire_manufacturers (
    manufacturer_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_luminaire_manufacturers_normalized_name
    ON luminaire_manufacturers(normalized_name)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_products (
    product_id TEXT PRIMARY KEY,
    manufacturer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(product_id, manufacturer_id),
    FOREIGN KEY(manufacturer_id) REFERENCES luminaire_manufacturers(manufacturer_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_products_manufacturer_status
    ON luminaire_library_products(manufacturer_id, status, normalized_name, product_id)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_variants (
    variant_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_label TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    ordering_code TEXT NOT NULL,
    wattage TEXT NOT NULL,
    lumens TEXT NOT NULL,
    light_color TEXT NOT NULL,
    cri TEXT NOT NULL,
    beam_angle TEXT NOT NULL,
    ip_rating TEXT NOT NULL,
    mounting TEXT NOT NULL,
    cutout TEXT NOT NULL,
    driver TEXT NOT NULL,
    control TEXT NOT NULL,
    emergency TEXT NOT NULL,
    dimensions TEXT NOT NULL,
    body_color_finish TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    latest_published_version_id TEXT,
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(variant_id, product_id),
    FOREIGN KEY(product_id) REFERENCES luminaire_library_products(product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(latest_published_version_id) REFERENCES luminaire_library_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_variants_product_status
    ON luminaire_library_variants(product_id, status, normalized_label, variant_id)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_versions (
    version_id TEXT PRIMARY KEY,
    manufacturer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    version_sequence INTEGER NOT NULL CHECK(version_sequence >= 1),
    snapshot_json TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    search_text TEXT NOT NULL,
    product_type TEXT NOT NULL,
    light_color TEXT NOT NULL,
    beam_angle TEXT NOT NULL,
    published_by_id TEXT NOT NULL,
    published_by_name TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE(variant_id, version_sequence),
    FOREIGN KEY(manufacturer_id) REFERENCES luminaire_manufacturers(manufacturer_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(product_id) REFERENCES luminaire_library_products(product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(variant_id, product_id) REFERENCES luminaire_library_variants(variant_id, product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_versions_variant_sequence
    ON luminaire_library_versions(variant_id, version_sequence DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_versions_search
    ON luminaire_library_versions(product_type, light_color, beam_angle, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_assets (
    asset_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('ProductImage', 'Datasheet', 'IES', 'LDT')),
    label TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(asset_type NOT IN ('IES', 'LDT') OR variant_id IS NOT NULL),
    UNIQUE(asset_id, product_id),
    FOREIGN KEY(product_id) REFERENCES luminaire_library_products(product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(variant_id, product_id) REFERENCES luminaire_library_variants(variant_id, product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_assets_owner_type
    ON luminaire_library_assets(product_id, variant_id, asset_type, status)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_asset_versions (
    asset_version_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    version_sequence INTEGER NOT NULL CHECK(version_sequence >= 1),
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    locator_value TEXT NOT NULL,
    created_by_id TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(asset_id, version_sequence),
    UNIQUE(locator_value),
    FOREIGN KEY(asset_id) REFERENCES luminaire_library_assets(asset_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_asset_versions_asset_sequence
    ON luminaire_library_asset_versions(asset_id, version_sequence DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_asset_versions_hash
    ON luminaire_library_asset_versions(content_hash)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_version_assets (
    version_id TEXT NOT NULL,
    asset_version_id TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('ProductImage', 'Datasheet', 'IES', 'LDT')),
    PRIMARY KEY(version_id, asset_version_id),
    FOREIGN KEY(version_id) REFERENCES luminaire_library_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(asset_version_id) REFERENCES luminaire_library_asset_versions(asset_version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_version_assets_asset
    ON luminaire_library_version_assets(asset_version_id, version_id)`,
  `CREATE TABLE IF NOT EXISTS project_luminaire_library_bindings (
    project_id TEXT NOT NULL,
    luminaire_id TEXT PRIMARY KEY,
    manufacturer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    selected_version_id TEXT NOT NULL,
    description_override TEXT,
    row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
    selected_by_id TEXT NOT NULL,
    selected_by_name TEXT NOT NULL,
    selected_at TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, luminaire_id),
    FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id)
      ON UPDATE RESTRICT ON DELETE CASCADE,
    FOREIGN KEY(manufacturer_id) REFERENCES luminaire_manufacturers(manufacturer_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(product_id) REFERENCES luminaire_library_products(product_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(variant_id) REFERENCES luminaire_library_variants(variant_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY(selected_version_id) REFERENCES luminaire_library_versions(version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_project_luminaire_library_bindings_version
    ON project_luminaire_library_bindings(selected_version_id, project_id)`,
  `CREATE TABLE IF NOT EXISTS luminaire_library_activity (
    activity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    idempotency_key TEXT,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_luminaire_library_activity_entity_time
    ON luminaire_library_activity(entity_type, entity_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_luminaire_library_activity_idempotency
    ON luminaire_library_activity(idempotency_key) WHERE idempotency_key IS NOT NULL`,
]);

function columnNames(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>).map(
      (row) => String(row.name),
    ),
  );
}

function ensureProjectLuminaireColumns(database: DatabaseSync): void {
  const columns = columnNames(database, 'project_luminaires');
  for (const [name, definition] of [
    ['product_type', "TEXT NOT NULL DEFAULT ''"],
    ['variant_label', "TEXT NOT NULL DEFAULT ''"],
    ['ordering_code', "TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!columns.has(name))
      database.exec(`ALTER TABLE project_luminaires ADD COLUMN ${name} ${definition}`);
  }
}

function rebuildProjectLuminaireAssets(database: DatabaseSync): void {
  const columns = columnNames(database, 'luminaire_asset_versions');
  if (columns.has('source_library_asset_version_id')) {
    database.exec(`CREATE INDEX IF NOT EXISTS ix_luminaire_asset_versions_source_library
      ON luminaire_asset_versions(source_library_asset_version_id)`);
    return;
  }
  database.exec(`CREATE TABLE luminaire_asset_versions__v22 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    luminaire_id TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('Datasheet', 'ProductImage', 'IES', 'LDT')),
    version_sequence INTEGER NOT NULL CHECK(version_sequence > 0),
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
    file_hash TEXT,
    backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0, 1)),
    attached_at TEXT NOT NULL,
    attached_by_id TEXT,
    attached_by_name_snapshot TEXT,
    locator_kind TEXT NOT NULL CHECK(locator_kind IN ('LEGACY_PATH', 'DATA_ROOT_RELATIVE')),
    locator_value TEXT NOT NULL,
    source_library_asset_version_id TEXT,
    UNIQUE(luminaire_id, asset_type, version_sequence),
    FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id) ON DELETE CASCADE,
    FOREIGN KEY(source_library_asset_version_id)
      REFERENCES luminaire_library_asset_versions(asset_version_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
  )`);
  database.exec(`INSERT INTO luminaire_asset_versions__v22
    (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
     mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
     attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id)
    SELECT id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
           mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
           attached_by_name_snapshot, 'LEGACY_PATH', file_path, NULL
    FROM luminaire_asset_versions`);
  database.exec('DROP TABLE luminaire_asset_versions');
  database.exec('ALTER TABLE luminaire_asset_versions__v22 RENAME TO luminaire_asset_versions');
  database.exec(`CREATE INDEX ix_luminaire_asset_versions_project
    ON luminaire_asset_versions(project_id, luminaire_id, asset_type, version_sequence DESC)`);
  database.exec(`CREATE INDEX ix_luminaire_asset_versions_luminaire
    ON luminaire_asset_versions(luminaire_id, asset_type, version_sequence DESC)`);
  database.exec(`CREATE INDEX ix_luminaire_asset_versions_source_library
    ON luminaire_asset_versions(source_library_asset_version_id)`);
}

export function applyV22LuminaireLibrarySchema(database: DatabaseSync): void {
  database.exec('PRAGMA defer_foreign_keys = ON');
  for (const ddl of PRODUCTION_V22_DDL) database.exec(ddl);
  ensureProjectLuminaireColumns(database);
  rebuildProjectLuminaireAssets(database);
  database.exec('PRAGMA defer_foreign_keys = OFF');
}

export function rollbackV22LuminaireLibrarySchema(database: DatabaseSync): void {
  const bindings = database
    .prepare('SELECT COUNT(*) AS count FROM project_luminaire_library_bindings')
    .get() as { count: number };
  if (bindings.count > 0) {
    throw new Error(
      'Version-22 rollback is blocked while Project luminaires retain Library bindings.',
    );
  }
  database.exec('PRAGMA defer_foreign_keys = ON');
  database.exec('DROP INDEX IF EXISTS ix_luminaire_asset_versions_source_library');
  database.exec(`CREATE TABLE luminaire_asset_versions__v21 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    luminaire_id TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK(asset_type IN ('Datasheet', 'ProductImage')),
    version_sequence INTEGER NOT NULL CHECK(version_sequence > 0),
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
    file_hash TEXT,
    backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0, 1)),
    attached_at TEXT NOT NULL,
    attached_by_id TEXT,
    attached_by_name_snapshot TEXT,
    UNIQUE(luminaire_id, asset_type, version_sequence),
    FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id) ON DELETE CASCADE
  )`);
  database.exec(`INSERT INTO luminaire_asset_versions__v21
    (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
     mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
     attached_by_name_snapshot)
    SELECT id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
           mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
           attached_by_name_snapshot
    FROM luminaire_asset_versions
    WHERE asset_type IN ('Datasheet', 'ProductImage')`);
  database.exec('DROP TABLE luminaire_asset_versions');
  database.exec('ALTER TABLE luminaire_asset_versions__v21 RENAME TO luminaire_asset_versions');
  database.exec(`CREATE INDEX ix_luminaire_asset_versions_project
    ON luminaire_asset_versions(project_id, luminaire_id, asset_type, version_sequence DESC)`);
  database.exec(`CREATE INDEX ix_luminaire_asset_versions_luminaire
    ON luminaire_asset_versions(luminaire_id, asset_type, version_sequence DESC)`);
  for (const table of [...PRODUCTION_V22_TABLE_NAMES].reverse()) {
    database.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  database.exec('PRAGMA defer_foreign_keys = OFF');
}

export function validateV22LuminaireLibrarySchema(database: DatabaseSync): void {
  for (const table of PRODUCTION_V22_TABLE_NAMES) {
    const found = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table);
    if (!found) throw new Error(`Version-22 migration is missing table ${table}.`);
  }
  for (const index of PRODUCTION_V22_INDEX_NAMES) {
    const found = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?")
      .get(index);
    if (!found) throw new Error(`Version-22 migration is missing index ${index}.`);
  }
  const projectColumns = columnNames(database, 'project_luminaires');
  for (const column of ['product_type', 'variant_label', 'ordering_code']) {
    if (!projectColumns.has(column)) throw new Error(`Version-22 migration is missing ${column}.`);
  }
  const assetColumns = columnNames(database, 'luminaire_asset_versions');
  for (const column of ['locator_kind', 'locator_value', 'source_library_asset_version_id']) {
    if (!assetColumns.has(column)) throw new Error(`Version-22 migration is missing ${column}.`);
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) throw new Error('Version-22 migration has foreign-key violations.');
}

export function computeV22MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V22_MIGRATION_ID,
        description: PRODUCTION_V22_MIGRATION_DESCRIPTION,
        ddl: PRODUCTION_V22_DDL,
        tables: PRODUCTION_V22_TABLE_NAMES,
        indexes: PRODUCTION_V22_INDEX_NAMES,
        projectColumns: ['product_type', 'variant_label', 'ordering_code'],
        assetColumns: ['locator_kind', 'locator_value', 'source_library_asset_version_id'],
      }),
      'utf8',
    )
    .digest('hex');
}
