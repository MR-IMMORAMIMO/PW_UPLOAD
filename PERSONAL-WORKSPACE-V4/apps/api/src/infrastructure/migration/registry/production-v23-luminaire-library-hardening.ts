import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const PRODUCTION_V23_MIGRATION_ID = 'production-22-23-master-luminaire-library-hardening';
export const PRODUCTION_V23_MIGRATION_DESCRIPTION =
  'Add normalized Luminaire Library technical-filter authority, manufacturer ordering-code uniqueness, and managed locator defaults.';

export const PRODUCTION_V23_INDEX_NAMES = Object.freeze([
  'ux_luminaire_library_variants_manufacturer_ordering_code',
  'ix_luminaire_library_variants_technical_filters',
] as const);

export const PRODUCTION_V23_VARIANT_COLUMNS = Object.freeze([
  'manufacturer_id',
  'normalized_ordering_code',
  'wattage_value',
  'wattage_basis',
  'lumens_value',
  'lumens_basis',
  'cct_kelvin',
  'cri_value',
  'beam_degrees',
  'beam_facet',
  'ip_facet',
  'control_facet',
] as const);

const PRODUCTION_V23_NORMALIZATION_AUTHORITY = Object.freeze({
  unicode: 'NFKC',
  orderingCodeLocale: 'en-uppercase-single-space',
  facetLocale: 'en-lowercase-single-space',
  wattagePattern: '^(decimal) W or W/M',
  lumensPattern: '^(decimal) LM or LM/M',
  cctPattern: '3-5 digits followed by K',
  criPattern: 'optional CRI followed by 0-100 decimal',
  beamPattern: '0-360 decimal with optional degree suffix',
});

const V23_VARIANT_TABLE_DDL = `CREATE TABLE luminaire_library_variants__v23 (
  variant_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  manufacturer_id TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  ordering_code TEXT NOT NULL,
  normalized_ordering_code TEXT NOT NULL,
  wattage TEXT NOT NULL,
  wattage_value REAL,
  wattage_basis TEXT CHECK(wattage_basis IS NULL OR wattage_basis IN ('W', 'W_PER_M')),
  lumens TEXT NOT NULL,
  lumens_value REAL,
  lumens_basis TEXT CHECK(lumens_basis IS NULL OR lumens_basis IN ('LM', 'LM_PER_M')),
  light_color TEXT NOT NULL,
  cct_kelvin INTEGER CHECK(cct_kelvin IS NULL OR cct_kelvin > 0),
  cri TEXT NOT NULL,
  cri_value REAL CHECK(cri_value IS NULL OR (cri_value >= 0 AND cri_value <= 100)),
  beam_angle TEXT NOT NULL,
  beam_degrees REAL CHECK(beam_degrees IS NULL OR (beam_degrees > 0 AND beam_degrees <= 360)),
  beam_facet TEXT NOT NULL,
  ip_rating TEXT NOT NULL,
  ip_facet TEXT NOT NULL,
  mounting TEXT NOT NULL,
  cutout TEXT NOT NULL,
  driver TEXT NOT NULL,
  control TEXT NOT NULL,
  control_facet TEXT NOT NULL,
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
  UNIQUE(variant_id, product_id, manufacturer_id),
  FOREIGN KEY(product_id) REFERENCES luminaire_library_products(product_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(product_id, manufacturer_id)
    REFERENCES luminaire_library_products(product_id, manufacturer_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY(latest_published_version_id) REFERENCES luminaire_library_versions(version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)`;

const V23_ASSET_VERSION_TABLE_DDL = `CREATE TABLE luminaire_asset_versions__v23 (
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
  locator_kind TEXT NOT NULL DEFAULT 'LEGACY_PATH'
    CHECK(locator_kind IN ('LEGACY_PATH', 'DATA_ROOT_RELATIVE')),
  locator_value TEXT NOT NULL DEFAULT '',
  source_library_asset_version_id TEXT,
  UNIQUE(luminaire_id, asset_type, version_sequence),
  FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id) ON DELETE CASCADE,
  FOREIGN KEY(source_library_asset_version_id)
    REFERENCES luminaire_library_asset_versions(asset_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
)`;

const V23_INDEX_DDL = Object.freeze([
  `CREATE INDEX ix_luminaire_library_variants_product_status
    ON luminaire_library_variants(product_id, status, normalized_label, variant_id)`,
  `CREATE UNIQUE INDEX ux_luminaire_library_variants_manufacturer_ordering_code
    ON luminaire_library_variants(manufacturer_id, normalized_ordering_code)
    WHERE normalized_ordering_code <> ''`,
  `CREATE INDEX ix_luminaire_library_variants_technical_filters
    ON luminaire_library_variants(status, cct_kelvin, beam_facet, wattage_basis, wattage_value,
      lumens_basis, lumens_value, cri_value, ip_facet, control_facet)`,
  `CREATE INDEX ix_luminaire_asset_versions_project
    ON luminaire_asset_versions(project_id, luminaire_id, asset_type, version_sequence DESC)`,
  `CREATE INDEX ix_luminaire_asset_versions_luminaire
    ON luminaire_asset_versions(luminaire_id, asset_type, version_sequence DESC)`,
  `CREATE INDEX ix_luminaire_asset_versions_source_library
    ON luminaire_asset_versions(source_library_asset_version_id)`,
] as const);

type Row = Record<string, string | number | null>;

function columnRows(database: DatabaseSync, table: string): Row[] {
  return database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
}

function columnNames(database: DatabaseSync, table: string): Set<string> {
  return new Set(columnRows(database, table).map((row) => String(row.name)));
}

function normalizeOrderingCode(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en');
}

function normalizeFacet(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function finiteNonNegative(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePower(value: string): { value: number; basis: 'W' | 'W_PER_M' } | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(W(?:\s*\/\s*M)?)$/i);
  if (!match) return null;
  const parsed = finiteNonNegative(match[1]!);
  if (parsed === null) return null;
  return { value: parsed, basis: /\/\s*M$/i.test(match[2]!) ? 'W_PER_M' : 'W' };
}

function parseLumens(value: string): { value: number; basis: 'LM' | 'LM_PER_M' } | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(LM(?:\s*\/\s*M)?)$/i);
  if (!match) return null;
  const parsed = finiteNonNegative(match[1]!);
  if (parsed === null) return null;
  return { value: parsed, basis: /\/\s*M$/i.test(match[2]!) ? 'LM_PER_M' : 'LM' };
}

function parseCct(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d{3,5})\s*K$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCri(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(?:CRI\s*)?(\d{1,3}(?:\.\d+)?)$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function parseBeamDegrees(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:°|DEG(?:REES?)?)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 360 ? parsed : null;
}

function normalizedTechnical(row: Row): {
  normalizedOrderingCode: string;
  wattageValue: number | null;
  wattageBasis: 'W' | 'W_PER_M' | null;
  lumensValue: number | null;
  lumensBasis: 'LM' | 'LM_PER_M' | null;
  cctKelvin: number | null;
  criValue: number | null;
  beamDegrees: number | null;
  beamFacet: string;
  ipFacet: string;
  controlFacet: string;
} {
  const wattage = parsePower(String(row.wattage));
  const lumens = parseLumens(String(row.lumens));
  const beamDegrees = parseBeamDegrees(String(row.beam_angle));
  return {
    normalizedOrderingCode: normalizeOrderingCode(String(row.ordering_code)),
    wattageValue: wattage?.value ?? null,
    wattageBasis: wattage?.basis ?? null,
    lumensValue: lumens?.value ?? null,
    lumensBasis: lumens?.basis ?? null,
    cctKelvin: parseCct(String(row.light_color)),
    criValue: parseCri(String(row.cri)),
    beamDegrees,
    beamFacet: beamDegrees === null ? normalizeFacet(String(row.beam_angle)) : `${beamDegrees}°`,
    ipFacet: normalizeFacet(String(row.ip_rating)),
    controlFacet: normalizeFacet(String(row.control)),
  };
}

function requiredValue(row: Row, column: string): string | number | null {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`Version-23 migration source row is missing ${column}.`);
  }
  return value;
}

function historicalVariantRows(database: DatabaseSync): Row[] {
  return database
    .prepare(
      `SELECT v.*, p.manufacturer_id
       FROM luminaire_library_variants v
       INNER JOIN luminaire_library_products p ON p.product_id = v.product_id
       ORDER BY v.variant_id`,
    )
    .all() as Row[];
}

function assertOrderingCodeUniqueness(rows: readonly Row[]): void {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const normalized = normalizeOrderingCode(String(row.ordering_code));
    if (normalized === '') continue;
    const key = `${String(row.manufacturer_id)}\u0000${normalized}`;
    const previous = seen.get(key);
    if (previous) {
      throw new Error(
        `Version-23 migration cannot enforce ordering-code uniqueness for variants ${previous} and ${String(row.variant_id)}.`,
      );
    }
    seen.set(key, String(row.variant_id));
  }
}

function rebuildVariants(database: DatabaseSync): void {
  const rows = historicalVariantRows(database);
  const sourceCount = database
    .prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants')
    .get() as { count: number };
  if (rows.length !== sourceCount.count) {
    throw new Error(
      'Version-23 migration found a Library variant without canonical product authority.',
    );
  }
  assertOrderingCodeUniqueness(rows);
  database.exec(V23_VARIANT_TABLE_DDL);

  const columns = [
    'variant_id',
    'product_id',
    'manufacturer_id',
    'variant_label',
    'normalized_label',
    'ordering_code',
    'normalized_ordering_code',
    'wattage',
    'wattage_value',
    'wattage_basis',
    'lumens',
    'lumens_value',
    'lumens_basis',
    'light_color',
    'cct_kelvin',
    'cri',
    'cri_value',
    'beam_angle',
    'beam_degrees',
    'beam_facet',
    'ip_rating',
    'ip_facet',
    'mounting',
    'cutout',
    'driver',
    'control',
    'control_facet',
    'emergency',
    'dimensions',
    'body_color_finish',
    'status',
    'row_version',
    'latest_published_version_id',
    'created_by_id',
    'created_by_name',
    'created_at',
    'updated_by_id',
    'updated_by_name',
    'updated_at',
  ] as const;
  const insert = database.prepare(
    `INSERT INTO luminaire_library_variants__v23 (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
  );
  for (const row of rows) {
    const normalized = normalizedTechnical(row);
    const source = (column: string) => requiredValue(row, column);
    insert.run(
      source('variant_id'),
      source('product_id'),
      source('manufacturer_id'),
      source('variant_label'),
      source('normalized_label'),
      source('ordering_code'),
      normalized.normalizedOrderingCode,
      source('wattage'),
      normalized.wattageValue,
      normalized.wattageBasis,
      source('lumens'),
      normalized.lumensValue,
      normalized.lumensBasis,
      source('light_color'),
      normalized.cctKelvin,
      source('cri'),
      normalized.criValue,
      source('beam_angle'),
      normalized.beamDegrees,
      normalized.beamFacet,
      source('ip_rating'),
      normalized.ipFacet,
      source('mounting'),
      source('cutout'),
      source('driver'),
      source('control'),
      normalized.controlFacet,
      source('emergency'),
      source('dimensions'),
      source('body_color_finish'),
      source('status'),
      source('row_version'),
      source('latest_published_version_id'),
      source('created_by_id'),
      source('created_by_name'),
      source('created_at'),
      source('updated_by_id'),
      source('updated_by_name'),
      source('updated_at'),
    );
  }
  database.exec('DROP TABLE luminaire_library_variants');
  database.exec('ALTER TABLE luminaire_library_variants__v23 RENAME TO luminaire_library_variants');
  for (const ddl of V23_INDEX_DDL.slice(0, 3)) database.exec(ddl);
}

function assetLocatorDefaultsPresent(database: DatabaseSync): boolean {
  const columns = new Map(
    columnRows(database, 'luminaire_asset_versions').map((row) => [
      String(row.name),
      row.dflt_value,
    ]),
  );
  return columns.get('locator_kind') === "'LEGACY_PATH'" && columns.get('locator_value') === "''";
}

function rebuildAssetVersions(database: DatabaseSync): void {
  database.exec(V23_ASSET_VERSION_TABLE_DDL);
  database.exec(`INSERT INTO luminaire_asset_versions__v23
    (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
     mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
     attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id)
    SELECT id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
           mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
           attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id
    FROM luminaire_asset_versions`);
  database.exec('DROP TABLE luminaire_asset_versions');
  database.exec('ALTER TABLE luminaire_asset_versions__v23 RENAME TO luminaire_asset_versions');
  for (const ddl of V23_INDEX_DDL.slice(3)) database.exec(ddl);
}

export function applyV23LuminaireLibraryHardening(database: DatabaseSync): void {
  const columns = columnNames(database, 'luminaire_library_variants');
  const present = PRODUCTION_V23_VARIANT_COLUMNS.filter((column) => columns.has(column));
  if (present.length !== 0 && present.length !== PRODUCTION_V23_VARIANT_COLUMNS.length) {
    throw new Error('Version-23 migration found a partial Luminaire variant hardening schema.');
  }
  const variantsHardened = present.length === PRODUCTION_V23_VARIANT_COLUMNS.length;
  const assetsHardened = assetLocatorDefaultsPresent(database);
  if (variantsHardened && assetsHardened) {
    for (const ddl of V23_INDEX_DDL)
      database.exec(
        ddl
          .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
          .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS '),
      );
    return;
  }

  const leftovers = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name IN ('luminaire_library_variants__v23', 'luminaire_asset_versions__v23')`,
    )
    .all();
  if (leftovers.length > 0) {
    throw new Error('Version-23 migration found an unresolved temporary hardening table.');
  }

  database.exec('PRAGMA defer_foreign_keys = ON');
  if (!variantsHardened) rebuildVariants(database);
  if (!assetsHardened) rebuildAssetVersions(database);
  database.exec('PRAGMA defer_foreign_keys = OFF');
}

export function validateV23LuminaireLibraryHardening(database: DatabaseSync): void {
  const columns = columnNames(database, 'luminaire_library_variants');
  for (const column of PRODUCTION_V23_VARIANT_COLUMNS) {
    if (!columns.has(column)) throw new Error(`Version-23 migration is missing ${column}.`);
  }
  for (const index of PRODUCTION_V23_INDEX_NAMES) {
    const found = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?")
      .get(index);
    if (!found) throw new Error(`Version-23 migration is missing index ${index}.`);
  }
  if (!assetLocatorDefaultsPresent(database)) {
    throw new Error('Version-23 migration is missing managed locator defaults.');
  }
  const mismatchedManufacturer = database
    .prepare(
      `SELECT v.variant_id
       FROM luminaire_library_variants v
       INNER JOIN luminaire_library_products p ON p.product_id = v.product_id
       WHERE v.manufacturer_id <> p.manufacturer_id
       LIMIT 1`,
    )
    .get();
  if (mismatchedManufacturer) {
    throw new Error('Version-23 migration has mismatched variant manufacturer authority.');
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) throw new Error('Version-23 migration has foreign-key violations.');
}

export function computeV23MigrationChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: PRODUCTION_V23_MIGRATION_ID,
        description: PRODUCTION_V23_MIGRATION_DESCRIPTION,
        variantTable: V23_VARIANT_TABLE_DDL,
        assetVersionTable: V23_ASSET_VERSION_TABLE_DDL,
        indexes: V23_INDEX_DDL,
        variantColumns: PRODUCTION_V23_VARIANT_COLUMNS,
        normalization: PRODUCTION_V23_NORMALIZATION_AUTHORITY,
      }),
      'utf8',
    )
    .digest('hex');
}
