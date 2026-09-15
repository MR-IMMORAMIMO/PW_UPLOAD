/**
 * Exact source-derived identity for the pre-P2.6/P2.8 self-managed Personal schema.
 *
 * This is deliberately separate from the frozen v3.2.2 identity. It represents the one
 * production-shaped, unversioned schema needed by UAT-FIX-04-A: the 24-table/8-index production
 * baseline after every source-defined compatibility column has been applied, with the production
 * Asia/Dubai time-zone default. It does not admit subsets, supersets, or later V2/V3 tables.
 */

import {
  PRODUCTION_CANONICAL_DDL,
  PRODUCTION_COMPATIBILITY_COLUMNS,
  PRODUCTION_INDEX_NAMES,
  PRODUCTION_TABLE_NAMES,
} from '../registry/production-migration-registry';
import {
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  computeStructuralFingerprint,
  type LegacyV322ColumnDef,
  type LegacyV322SchemaSnapshot,
} from './legacy-v322-schema';

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertProductionBaselineMatchesLockedSource(): void {
  const production = PRODUCTION_CANONICAL_DDL.map(normalizeSql);
  const locked = CANONICAL_FRESH_DDL.map(normalizeSql);
  if (!arraysEqual(production, locked)) {
    throw new Error(
      'Current self-managed oracle is stale: production baseline DDL no longer matches the locked source.',
    );
  }

  const snapshotTables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((table) => table.tableName).sort();
  const snapshotIndexes = CANONICAL_SCHEMA_SNAPSHOT.indexes.map((index) => index.indexName).sort();
  if (
    !arraysEqual(snapshotTables, [...PRODUCTION_TABLE_NAMES].sort()) ||
    !arraysEqual(snapshotIndexes, [...PRODUCTION_INDEX_NAMES].sort())
  ) {
    throw new Error(
      'Current self-managed oracle is stale: production object inventory no longer matches the locked source.',
    );
  }
}

function parseCompatibilityColumn(name: string, definition: string): LegacyV322ColumnDef {
  const match = definition.match(/^([A-Za-z0-9_]+(?:\s*\([^)]*\))?)(.*)$/);
  if (!match) {
    throw new Error(`Unsupported compatibility definition for ${name}.`);
  }
  const rest = match[2] ?? '';
  if (/\b(?:PRIMARY\s+KEY|UNIQUE|COLLATE|REFERENCES|CHECK)\b/i.test(rest)) {
    throw new Error(`Compatibility definition for ${name} has unsupported structural semantics.`);
  }
  const defaultMatch = definition.match(/DEFAULT\s+('[^']*'|[^\s,)]+)/i);
  return Object.freeze({
    name,
    declaredType: match[1]!,
    notNull: /\bNOT\s+NULL\b/i.test(rest),
    defaultExpression: defaultMatch?.[1],
    primaryKeyOrder: undefined,
    unique: false,
    collation: undefined,
  });
}

function buildCurrentSnapshot(): LegacyV322SchemaSnapshot {
  assertProductionBaselineMatchesLockedSource();

  const tables = CANONICAL_SCHEMA_SNAPSHOT.tables.map((table) => ({
    ...table,
    columns: [...table.columns],
  }));
  const byName = new Map(tables.map((table) => [table.tableName, table] as const));

  for (const operation of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (operation.alreadyInBaseCreate) continue;
    const table = byName.get(operation.table);
    if (!table) {
      throw new Error(
        `Compatibility table ${operation.table} is missing from the production baseline.`,
      );
    }
    if (table.columns.some((column) => column.name === operation.column)) {
      throw new Error(
        `Compatibility column ${operation.table}.${operation.column} already exists in the production baseline.`,
      );
    }
    table.columns = [
      ...table.columns,
      parseCompatibilityColumn(operation.column, operation.definition),
    ];
  }

  return Object.freeze({
    tables: Object.freeze(
      tables.map((table) =>
        Object.freeze({
          ...table,
          columns: Object.freeze(table.columns.map((column) => Object.freeze(column))),
        }),
      ),
    ),
    indexes: CANONICAL_SCHEMA_SNAPSHOT.indexes,
    triggerNames: Object.freeze([]),
    viewNames: Object.freeze([]),
    virtualTableNames: Object.freeze([]),
  });
}

export const CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT = buildCurrentSnapshot();

const computedCurrentFingerprint = computeStructuralFingerprint(
  CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT,
);

/** Locked literal for the one admitted current self-managed unversioned source shape. */
export const CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT =
  '2027a5e577c5e1fec4e8c5240e79cc2ea33b7d332a080daed26ddc741a588060';

if (computedCurrentFingerprint !== CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT) {
  throw new Error('Current self-managed unversioned structural fingerprint changed unexpectedly.');
}

export const CURRENT_SELF_MANAGED_UNVERSIONED_TABLE_COUNT =
  CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT.tables.length;

export const CURRENT_SELF_MANAGED_UNVERSIONED_INDEX_COUNT =
  CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT.indexes.length;
