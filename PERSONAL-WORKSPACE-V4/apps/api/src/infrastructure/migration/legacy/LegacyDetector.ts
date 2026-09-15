/**
 * LegacyDetector: strictly read-only classification of an existing SQLite database against the
 * locked historical v3.2.2 identity and the separately locked current self-managed unversioned
 * identity admitted by UAT-FIX-04-A.
 *
 * Detection only. It never migrates, mutates, repairs, backs up, restores, journals,
 * resolves, or integrates startup behavior. It opens the supplied database in
 * read-only immutable mode (so no WAL/SHM sidecar is created or modified), enables
 * PRAGMA query_only as defense-in-depth, delegates current migration-state
 * classification to MigrationStateInspector, and performs only read-only schema
 * introspection before returning a deeply immutable, path-free result.
 *
 * P1.6B-A - Implement Read-Only Legacy v3.2.2 Detector
 */

import { lstatSync } from 'node:fs';
import { win32 as winPath } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep the specifier dynamic so the bundler does not rewrite `node:sqlite` to `sqlite`.
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { MigrationStateInspector, type MigrationStateView } from '../MigrationStateInspector';
import {
  CANONICAL_FRESH_DDL,
  CANONICAL_SCHEMA_SNAPSHOT,
  SCHEMA_STATEMENTS,
  computeStructuralFingerprint,
  type LegacyV322ColumnDef,
  type LegacyV322IndexDef,
  type LegacyV322SchemaSnapshot,
  type LegacyV322TableDef,
} from '../testing/legacy-v322-schema';
import {
  CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT,
  CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT,
} from '../testing/current-self-managed-unversioned-schema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LegacyDetectionStatus =
  | 'LEGACY_V3_2_2'
  | 'CURRENT_SELF_MANAGED_UNVERSIONED'
  | 'EMPTY_DATABASE'
  | 'PARTIAL_LEGACY_SCHEMA'
  | 'NOT_APPLICABLE'
  | 'BLOCKED';

export interface LegacyDetectionResult {
  readonly status: LegacyDetectionStatus;
  readonly observedUserVersion: number;
  readonly historyTableExists: boolean;
  readonly migrationCandidate: boolean;
  readonly manualActionRequired: boolean;
  readonly safeReasonCode: string;
  readonly observedTableCount: number;
  readonly observedOwnedIndexCount: number;
  readonly observedStructuralFingerprint: string | null;
}

export type LegacyDetectorErrorCode =
  'INVALID_DATABASE_PATH' | 'UNSAFE_DATABASE_PATH' | 'DATABASE_UNAVAILABLE';

export class LegacyDetectorError extends Error {
  public readonly code: LegacyDetectorErrorCode;

  public constructor(
    code: LegacyDetectorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LegacyDetectorError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Canonical identities derived from the committed legacy schema
// ---------------------------------------------------------------------------

const CANONICAL_STRUCTURAL_FINGERPRINT = computeStructuralFingerprint(CANONICAL_SCHEMA_SNAPSHOT);

const PARTIAL_STANDALONE_TABLE_NAMES: readonly string[] = Object.freeze(
  SCHEMA_STATEMENTS.filter((s) => s.owner === 'StandaloneDataProvider' && s.kind === 'TABLE').map(
    (s) => s.objectName,
  ),
);

const CANONICAL_PARTIAL_SNAPSHOT: LegacyV322SchemaSnapshot = Object.freeze({
  tables: Object.freeze(
    CANONICAL_SCHEMA_SNAPSHOT.tables.filter((t) =>
      PARTIAL_STANDALONE_TABLE_NAMES.includes(t.tableName),
    ),
  ),
  indexes: Object.freeze([]),
  triggerNames: Object.freeze([]),
  viewNames: Object.freeze([]),
  virtualTableNames: Object.freeze([]),
});

const CANONICAL_PARTIAL_FINGERPRINT = computeStructuralFingerprint(CANONICAL_PARTIAL_SNAPSHOT);

const CANONICAL_DDL_BY_TABLE: ReadonlyMap<string, string> = new Map(
  CANONICAL_FRESH_DDL.map((ddl) => {
    const match = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    return [match ? match[1]! : '', ddl] as const;
  }).filter(([name]) => name.length > 0),
);

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

function validateDatabasePath(databasePath: string): void {
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new LegacyDetectorError(
      'INVALID_DATABASE_PATH',
      'databasePath must be a non-empty string.',
    );
  }

  if (!winPath.isAbsolute(databasePath)) {
    throw new LegacyDetectorError(
      'INVALID_DATABASE_PATH',
      'databasePath must be an absolute path.',
    );
  }

  if (databasePath.includes('\0')) {
    throw new LegacyDetectorError(
      'INVALID_DATABASE_PATH',
      'databasePath must not contain NUL characters.',
    );
  }

  let stats;
  try {
    stats = lstatSync(databasePath);
  } catch {
    throw new LegacyDetectorError('INVALID_DATABASE_PATH', 'databasePath does not exist.');
  }

  if (stats.isSymbolicLink()) {
    throw new LegacyDetectorError(
      'UNSAFE_DATABASE_PATH',
      'databasePath must not be a symlink or junction.',
    );
  }

  if (stats.isDirectory()) {
    throw new LegacyDetectorError(
      'INVALID_DATABASE_PATH',
      'databasePath must be a file, not a directory.',
    );
  }

  if (!stats.isFile()) {
    throw new LegacyDetectorError('UNSAFE_DATABASE_PATH', 'databasePath must be a regular file.');
  }
}

// ---------------------------------------------------------------------------
// Read-only open
// ---------------------------------------------------------------------------

function openReadOnly(databasePath: string): DatabaseSyncInstance {
  // immutable=1 keeps the open strictly read-only: SQLite does not create or
  // modify -wal/-shm sidecars and never writes to the main file. The tradeoff is
  // that uncheckpointed WAL content is not visible; a legacy database is expected
  // to be closed, and an actively-written database fails closed at open time.
  const uri = pathToFileURL(databasePath).href + '?immutable=1';
  try {
    return new DatabaseSync(uri, { readOnly: true });
  } catch (error) {
    throw new LegacyDetectorError(
      'DATABASE_UNAVAILABLE',
      'The database could not be opened for read-only inspection.',
      { cause: error },
    );
  }
}

// ---------------------------------------------------------------------------
// Observed structural snapshot
// ---------------------------------------------------------------------------

class UnreadableSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnreadableSchemaError';
  }
}

function buildObservedSnapshot(db: DatabaseSyncInstance): LegacyV322SchemaSnapshot {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as { type: string; name: string; sql: string | null }[];

  const tables: LegacyV322TableDef[] = [];
  const indexes: LegacyV322IndexDef[] = [];
  const triggerNames: string[] = [];
  const viewNames: string[] = [];
  const virtualTableNames: string[] = [];

  for (const row of rows) {
    if (row.type === 'table') {
      if (row.sql === null) {
        throw new UnreadableSchemaError('Table ' + row.name + ' has no stored schema SQL.');
      }
      if (row.sql.toUpperCase().startsWith('CREATE VIRTUAL TABLE')) {
        virtualTableNames.push(row.name);
        continue;
      }
      const table = parseTableDdl(row.name, row.sql);
      if (table.columns.length === 0) {
        throw new UnreadableSchemaError('Table ' + row.name + ' has unreadable schema SQL.');
      }
      tables.push(table);
    } else if (row.type === 'index') {
      if (row.sql === null) {
        throw new UnreadableSchemaError('Index ' + row.name + ' has no stored schema SQL.');
      }
      indexes.push(parseIndexDdl(row.sql));
    } else if (row.type === 'trigger') {
      triggerNames.push(row.name);
    } else if (row.type === 'view') {
      viewNames.push(row.name);
    }
  }

  return Object.freeze({
    tables: Object.freeze(
      tables.map((t) =>
        Object.freeze({ ...t, columns: Object.freeze(t.columns.map((c) => Object.freeze(c))) }),
      ),
    ),
    indexes: Object.freeze(indexes.map((i) => Object.freeze(i))),
    triggerNames: Object.freeze(triggerNames),
    viewNames: Object.freeze(viewNames),
    virtualTableNames: Object.freeze(virtualTableNames),
  });
}

// ---------------------------------------------------------------------------
// DDL parsing (mirrors the committed canonical parser so observed structure
// canonicalizes identically to the locked identity)
// ---------------------------------------------------------------------------

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

function parseTableDdl(tableName: string, sql: string): LegacyV322TableDef {
  const columns: LegacyV322ColumnDef[] = [];
  const primaryKeyColumns: string[] = [];
  const uniqueConstraints: string[] = [];
  const foreignKeys: string[] = [];
  const checkConstraints: string[] = [];

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
  const parts = splitTopLevelCommas(inner);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

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
        primaryKeyColumns.push(...match[1]!.split(',').map((c) => c.trim()));
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

function parseIndexDdl(sql: string): LegacyV322IndexDef {
  // Match: CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table(col1 [ASC|DESC], ...)
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

  // A partial index is a semantic difference from every canonical v3.2.2 index.
  const whereMatch = sql.match(/\)\s*WHERE\s+([\s\S]+)$/i);
  const partialPredicate = whereMatch ? whereMatch[1]!.trim() : undefined;

  return {
    indexName,
    tableName,
    unique,
    columns: Object.freeze(columns),
    columnDirections: Object.freeze(columnDirections),
    partialPredicate,
  };
}

// ---------------------------------------------------------------------------
// Structural comparison
// ---------------------------------------------------------------------------

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sortedJoin(values: readonly string[]): string {
  return [...values].sort().join(';');
}

function columnsEqual(
  a: readonly LegacyV322ColumnDef[],
  b: readonly LegacyV322ColumnDef[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.name !== y.name ||
      x.declaredType !== y.declaredType ||
      x.notNull !== y.notNull ||
      x.defaultExpression !== y.defaultExpression ||
      x.primaryKeyOrder !== y.primaryKeyOrder ||
      x.unique !== y.unique ||
      x.collation !== y.collation
    ) {
      return false;
    }
  }
  return true;
}

function tableDefsEqual(a: LegacyV322TableDef, b: LegacyV322TableDef): boolean {
  return (
    a.tableName === b.tableName &&
    columnsEqual(a.columns, b.columns) &&
    arraysEqual(a.primaryKeyColumns, b.primaryKeyColumns) &&
    sortedJoin(a.uniqueConstraints) === sortedJoin(b.uniqueConstraints) &&
    sortedJoin(a.foreignKeys) === sortedJoin(b.foreignKeys) &&
    sortedJoin(a.checkConstraints) === sortedJoin(b.checkConstraints)
  );
}

function indexDefsEqual(a: LegacyV322IndexDef, b: LegacyV322IndexDef): boolean {
  return (
    a.indexName === b.indexName &&
    a.tableName === b.tableName &&
    a.unique === b.unique &&
    arraysEqual(a.columns, b.columns) &&
    arraysEqual(a.columnDirections, b.columnDirections) &&
    a.partialPredicate === b.partialPredicate
  );
}

function snapshotsEqual(a: LegacyV322SchemaSnapshot, b: LegacyV322SchemaSnapshot): boolean {
  if (a.tables.length !== b.tables.length || a.indexes.length !== b.indexes.length) return false;
  if (!arraysEqual([...a.triggerNames].sort(), [...b.triggerNames].sort())) return false;
  if (!arraysEqual([...a.viewNames].sort(), [...b.viewNames].sort())) return false;
  if (!arraysEqual([...a.virtualTableNames].sort(), [...b.virtualTableNames].sort())) return false;

  const tablesByName = new Map(b.tables.map((t) => [t.tableName, t]));
  for (const table of a.tables) {
    const other = tablesByName.get(table.tableName);
    if (!other || !tableDefsEqual(table, other)) return false;
  }

  const indexesByName = new Map(b.indexes.map((i) => [i.indexName, i]));
  for (const index of a.indexes) {
    const other = indexesByName.get(index.indexName);
    if (!other || !indexDefsEqual(index, other)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Strict DDL semantics (column-level CHECK and REFERENCES are not captured by
// the committed canonical parser, so they are verified separately to avoid
// silently normalizing away semantic differences)
// ---------------------------------------------------------------------------

function normalizeSqlFragment(fragment: string): string {
  return fragment.replace(/\s+/g, ' ').trim();
}

function extractCheckExpressions(sql: string): string[] {
  const out: string[] = [];
  const upper = sql.toUpperCase();
  let searchFrom = 0;
  while (searchFrom < sql.length) {
    const checkIndex = upper.indexOf('CHECK', searchFrom);
    if (checkIndex === -1) break;
    const openIndex = sql.indexOf('(', checkIndex + 5);
    if (openIndex === -1) break;
    let depth = 0;
    let end = openIndex;
    for (; end < sql.length; end++) {
      if (sql[end] === '(') depth++;
      else if (sql[end] === ')') {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    if (depth !== 0) break;
    out.push(normalizeSqlFragment(sql.slice(checkIndex, end)));
    searchFrom = end;
  }
  return out.sort();
}

function extractReferences(sql: string): string[] {
  const out: string[] = [];
  const re = /REFERENCES\s+[A-Za-z0-9_]+(?:\s*\([^)]*\))?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    out.push(normalizeSqlFragment(match[0]));
  }
  return out.sort();
}

function strictDdlSemanticsMatch(db: DatabaseSyncInstance): boolean {
  const rows = db
    .prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string; sql: string | null }[];

  for (const row of rows) {
    const canonical = CANONICAL_DDL_BY_TABLE.get(row.name);
    if (!canonical) continue;
    const observed = row.sql;
    if (observed === null) return false;
    if (
      JSON.stringify(extractCheckExpressions(canonical)) !==
      JSON.stringify(extractCheckExpressions(observed))
    ) {
      return false;
    }
    if (
      JSON.stringify(extractReferences(canonical)) !== JSON.stringify(extractReferences(observed))
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function hasUncheckpointedWal(databasePath: string): boolean {
  try {
    const stats = lstatSync(databasePath + '-wal');
    return stats.isSymbolicLink() || stats.size > 0;
  } catch {
    return false;
  }
}

function emptyResult(state: MigrationStateView): LegacyDetectionResult {
  return deepFreeze<LegacyDetectionResult>({
    status: 'EMPTY_DATABASE',
    observedUserVersion: state.currentVersion,
    historyTableExists: state.historyTableExists,
    migrationCandidate: false,
    manualActionRequired: false,
    safeReasonCode: 'EMPTY_DATABASE',
    observedTableCount: 0,
    observedOwnedIndexCount: 0,
    observedStructuralFingerprint: null,
  });
}

function notApplicableResult(state: MigrationStateView): LegacyDetectionResult {
  return deepFreeze<LegacyDetectionResult>({
    status: 'NOT_APPLICABLE',
    observedUserVersion: state.currentVersion,
    historyTableExists: state.historyTableExists,
    migrationCandidate: false,
    manualActionRequired: false,
    safeReasonCode: 'VERSIONED_OR_HISTORY_PRESENT',
    observedTableCount: 0,
    observedOwnedIndexCount: 0,
    observedStructuralFingerprint: null,
  });
}

function malformedHistoryResult(state: MigrationStateView): LegacyDetectionResult {
  return deepFreeze<LegacyDetectionResult>({
    status: 'BLOCKED',
    observedUserVersion: state.currentVersion,
    historyTableExists: true,
    migrationCandidate: false,
    manualActionRequired: true,
    safeReasonCode: 'MALFORMED_MIGRATION_HISTORY',
    observedTableCount: 0,
    observedOwnedIndexCount: 0,
    observedStructuralFingerprint: null,
  });
}

function walBlockedResult(
  observedUserVersion: number,
  historyTableExists: boolean,
): LegacyDetectionResult {
  return deepFreeze<LegacyDetectionResult>({
    status: 'BLOCKED',
    observedUserVersion,
    historyTableExists,
    migrationCandidate: false,
    manualActionRequired: true,
    safeReasonCode: 'WAL_STATE_NOT_FULLY_VISIBLE',
    observedTableCount: 0,
    observedOwnedIndexCount: 0,
    observedStructuralFingerprint: null,
  });
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export class LegacyDetector {
  private readonly inspector: MigrationStateInspector;

  public constructor() {
    this.inspector = new MigrationStateInspector([], 0);
  }

  public inspect(databasePath: string): LegacyDetectionResult {
    validateDatabasePath(databasePath);

    // A non-empty WAL means committed state may exist only in the WAL, which the
    // immutable read-only open cannot see. Fail closed rather than classify from
    // a stale main database file.
    if (hasUncheckpointedWal(databasePath)) {
      return walBlockedResult(0, false);
    }

    const db = openReadOnly(databasePath);
    try {
      try {
        db.exec('PRAGMA query_only = ON');
      } catch {
        // query_only is defense-in-depth; the immutable read-only open already
        // prevents writes. Continue if the pragma is unsupported.
      }

      const state = this.inspector.inspect(db);

      let result: LegacyDetectionResult;
      if (state.isEmpty) {
        result = emptyResult(state);
      } else if (state.historyTableExists) {
        // Migration history exists. Only a valid, consistent history is outside
        // LegacyDetector responsibility; malformed or inconsistent history fails
        // closed instead of becoming a normal NOT_APPLICABLE.
        result =
          state.historyTableValid && state.historyValid
            ? notApplicableResult(state)
            : malformedHistoryResult(state);
      } else if (state.currentVersion > 0) {
        result = notApplicableResult(state);
      } else {
        result = this.inspectStructure(db, state);
      }

      // Re-check after inspection: a WAL that appeared mid-inspection means the
      // observed state may be stale, so the result must fail closed.
      if (hasUncheckpointedWal(databasePath)) {
        return walBlockedResult(state.currentVersion, state.historyTableExists);
      }
      return result;
    } finally {
      try {
        db.close();
      } catch {
        // Best-effort close; the owned handle must not leak.
      }
    }
  }

  private inspectStructure(
    db: DatabaseSyncInstance,
    state: MigrationStateView,
  ): LegacyDetectionResult {
    // Populated, unversioned, no migration history: structural legacy inspection.
    let observed: LegacyV322SchemaSnapshot;
    try {
      observed = buildObservedSnapshot(db);
    } catch (error) {
      if (error instanceof UnreadableSchemaError) {
        return deepFreeze<LegacyDetectionResult>({
          status: 'BLOCKED',
          observedUserVersion: state.currentVersion,
          historyTableExists: state.historyTableExists,
          migrationCandidate: false,
          manualActionRequired: true,
          safeReasonCode: 'UNKNOWN_UNVERSIONED_SCHEMA',
          observedTableCount: 0,
          observedOwnedIndexCount: 0,
          observedStructuralFingerprint: null,
        });
      }
      throw error;
    }

    const observedFingerprint = computeStructuralFingerprint(observed);
    const strictMatch = strictDdlSemanticsMatch(db);

    if (
      strictMatch &&
      snapshotsEqual(observed, CANONICAL_SCHEMA_SNAPSHOT) &&
      observedFingerprint === CANONICAL_STRUCTURAL_FINGERPRINT
    ) {
      return deepFreeze<LegacyDetectionResult>({
        status: 'LEGACY_V3_2_2',
        observedUserVersion: state.currentVersion,
        historyTableExists: state.historyTableExists,
        migrationCandidate: true,
        manualActionRequired: false,
        safeReasonCode: 'EXACT_LEGACY_V3_2_2_SCHEMA',
        observedTableCount: observed.tables.length,
        observedOwnedIndexCount: observed.indexes.length,
        observedStructuralFingerprint: observedFingerprint,
      });
    }

    if (
      strictMatch &&
      snapshotsEqual(observed, CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA_SNAPSHOT) &&
      observedFingerprint === CURRENT_SELF_MANAGED_UNVERSIONED_STRUCTURAL_FINGERPRINT
    ) {
      return deepFreeze<LegacyDetectionResult>({
        status: 'CURRENT_SELF_MANAGED_UNVERSIONED',
        observedUserVersion: state.currentVersion,
        historyTableExists: state.historyTableExists,
        migrationCandidate: true,
        manualActionRequired: false,
        safeReasonCode: 'EXACT_CURRENT_SELF_MANAGED_UNVERSIONED_SCHEMA',
        observedTableCount: observed.tables.length,
        observedOwnedIndexCount: observed.indexes.length,
        observedStructuralFingerprint: observedFingerprint,
      });
    }

    if (
      strictMatch &&
      snapshotsEqual(observed, CANONICAL_PARTIAL_SNAPSHOT) &&
      observedFingerprint === CANONICAL_PARTIAL_FINGERPRINT
    ) {
      return deepFreeze<LegacyDetectionResult>({
        status: 'PARTIAL_LEGACY_SCHEMA',
        observedUserVersion: state.currentVersion,
        historyTableExists: state.historyTableExists,
        migrationCandidate: false,
        manualActionRequired: true,
        safeReasonCode: 'PARTIAL_STANDALONE_ONLY_SCHEMA',
        observedTableCount: observed.tables.length,
        observedOwnedIndexCount: observed.indexes.length,
        observedStructuralFingerprint: observedFingerprint,
      });
    }

    return deepFreeze<LegacyDetectionResult>({
      status: 'BLOCKED',
      observedUserVersion: state.currentVersion,
      historyTableExists: state.historyTableExists,
      migrationCandidate: false,
      manualActionRequired: true,
      safeReasonCode: 'UNKNOWN_UNVERSIONED_SCHEMA',
      observedTableCount: observed.tables.length,
      observedOwnedIndexCount: observed.indexes.length,
      observedStructuralFingerprint: observedFingerprint,
    });
  }
}
