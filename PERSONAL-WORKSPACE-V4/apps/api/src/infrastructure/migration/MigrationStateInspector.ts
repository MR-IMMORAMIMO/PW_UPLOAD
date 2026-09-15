/**
 * MigrationStateInspector: the single source of truth for read-only migration-state inspection.
 *
 * The inspector receives a DatabaseSync-compatible handle from its caller and performs only
 * SELECT and PRAGMA reads. It never executes SQLite writes, never opens or closes connections,
 * and never depends on filesystem, network, Electron, Fastify, Teams, or UI APIs.
 *
 * It is designed to be shared by SchemaMigrationRunner (now) and InterruptedMigrationReconciler
 * (later) so that both components interpret database migration state identically.
 *
 * Registry identity is captured at construction time as deeply immutable, callback-free records.
 * The caller cannot later influence inspection by mutating the source array or any migration
 * definition, and no executable callback or descriptive metadata is retained or returned.
 *
 * The returned MigrationStateView is deeply immutable: every array is a frozen ReadonlyArray
 * and the view object itself is frozen.
 */

import type { DatabaseSync } from 'node:sqlite';
import type { MigrationDefinition } from './types';

// ---------------------------------------------------------------------------
// Expected schema_migrations table shape (for validation only; the inspector
// never creates or modifies this table). Required columns are validated by name
// and affinity; extra additive columns are accepted so that an externally-extended
// history table is not falsely rejected.
// ---------------------------------------------------------------------------

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly pk: number;
}

const EXPECTED_SCHEMA_MIGRATIONS_COLUMNS: readonly ExpectedColumn[] = Object.freeze([
  Object.freeze({ name: 'migration_id', type: 'TEXT', notnull: 0, pk: 1 }),
  Object.freeze({ name: 'from_version', type: 'INTEGER', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'to_version', type: 'INTEGER', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'checksum', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'description', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'app_version', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'backup_id', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'started_at', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'completed_at', type: 'TEXT', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'duration_ms', type: 'INTEGER', notnull: 1, pk: 0 }),
  Object.freeze({ name: 'validation_result', type: 'TEXT', notnull: 1, pk: 0 }),
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Callback-free identity record for a registered migration. Contains only the fields the
 * inspector needs to validate history and compute a pending chain. No up()/validate()
 * callbacks, no description, and no reference to a caller-owned MigrationDefinition.
 */
export interface MigrationIdentity {
  readonly id: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly checksum: string;
}

/** A single history row read from the schema_migrations table. */
export interface HistoryRow {
  readonly migration_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly checksum: string;
}

/** Internal result of history validation. */
interface HistoryValidation {
  readonly valid: boolean;
  readonly issue: string | null;
  readonly checksumMismatches: readonly string[];
}

/** Deeply immutable view of the current migration state of a database. */
export interface MigrationStateView {
  readonly currentVersion: number;
  readonly isEmpty: boolean;
  readonly isPopulated: boolean;
  readonly historyTableExists: boolean;
  readonly historyTableValid: boolean;
  readonly historyRows: readonly HistoryRow[];
  readonly historyValid: boolean;
  readonly historyIssue: string | null;
  readonly checksumMismatches: readonly string[];
  readonly futureSchemaVersion: boolean;
  readonly pendingMigrations: readonly MigrationIdentity[];
  readonly atTarget: boolean;
  readonly validIntermediateVersion: boolean;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export class MigrationStateInspector {
  private readonly sortedIdentities: readonly MigrationIdentity[];

  public constructor(
    migrations: readonly MigrationDefinition[],
    private readonly targetVersion: number,
  ) {
    // Capture identity-only fields into frozen, caller-independent records so that later
    // mutation of the source array or any MigrationDefinition cannot change decisions, and
    // no callback or descriptive metadata is retained.
    this.sortedIdentities = Object.freeze(
      migrations
        .map((migration) =>
          Object.freeze({
            id: migration.id,
            fromVersion: migration.fromVersion,
            toVersion: migration.toVersion,
            checksum: migration.checksum,
          }),
        )
        .sort((a, b) => a.fromVersion - b.fromVersion),
    );
  }

  public inspect(database: DatabaseSync): MigrationStateView {
    const currentVersion = this.readUserVersion(database);

    const isEmpty = currentVersion === 0 && this.hasNoUserSchemaObjects(database);
    const isPopulated = currentVersion === 0 && !isEmpty;

    const historyTableExists = this.checkHistoryTableExists(database);
    const historyTableValid = historyTableExists ? this.validateHistoryTableShape(database) : false;

    const historyRows: readonly HistoryRow[] =
      historyTableExists && historyTableValid
        ? Object.freeze(this.loadHistory(database))
        : Object.freeze([]);

    const historyValidation = this.validateHistory(historyRows, currentVersion);

    const futureSchemaVersion = currentVersion > this.targetVersion;

    const pendingMigrations: readonly MigrationIdentity[] = Object.freeze(
      this.computePendingChain(currentVersion),
    );

    const atTarget = currentVersion === this.targetVersion;

    const validIntermediateVersion =
      currentVersion === 0 || this.sortedIdentities.some((m) => m.toVersion === currentVersion);

    const view: MigrationStateView = Object.freeze({
      currentVersion,
      isEmpty,
      isPopulated,
      historyTableExists,
      historyTableValid,
      historyRows,
      historyValid: historyValidation.valid,
      historyIssue: historyValidation.issue,
      checksumMismatches: Object.freeze([...historyValidation.checksumMismatches]),
      futureSchemaVersion,
      pendingMigrations,
      atTarget,
      validIntermediateVersion,
    });

    return view;
  }

  private readUserVersion(db: DatabaseSync): number {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    return row.user_version;
  }

  private hasNoUserSchemaObjects(db: DatabaseSync): boolean {
    const rows = db
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')",
      )
      .all() as { name: string; type: string }[];
    // schema_migrations is infrastructure owned by the runner, not a user object, so a
    // version-zero database containing only it is still treated as having no user schema.
    return !rows.some((row) => !row.name.startsWith('sqlite_') && row.name !== 'schema_migrations');
  }

  private checkHistoryTableExists(db: DatabaseSync): boolean {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name: string } | undefined;
    return row !== undefined;
  }

  private validateHistoryTableShape(db: DatabaseSync): boolean {
    const columns = db.prepare("PRAGMA table_info('schema_migrations')").all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];

    const columnsByName = new Map<string, { type: string; notnull: number; pk: number }>();
    for (const col of columns) {
      columnsByName.set(col.name, { type: col.type, notnull: col.notnull, pk: col.pk });
    }

    // Required columns must be present with the expected affinity, NOT NULL flag, and primary-key
    // flag. Extra additive columns are intentionally accepted so that a backward-compatible
    // schema_migrations extension is not falsely flagged as malformed.
    for (const expected of EXPECTED_SCHEMA_MIGRATIONS_COLUMNS) {
      const actual = columnsByName.get(expected.name);
      if (!actual) {
        return false;
      }
      if (
        actual.type !== expected.type ||
        actual.notnull !== expected.notnull ||
        actual.pk !== expected.pk
      ) {
        return false;
      }
    }

    return true;
  }

  private loadHistory(db: DatabaseSync): HistoryRow[] {
    const rows = db
      .prepare(
        'SELECT migration_id, from_version, to_version, checksum FROM schema_migrations ORDER BY to_version ASC',
      )
      .all() as unknown[];
    const out: HistoryRow[] = [];
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      out.push({
        migration_id: r.migration_id as string,
        from_version: r.from_version as number,
        to_version: r.to_version as number,
        checksum: r.checksum as string,
      });
    }
    return out;
  }

  private validateHistory(rows: readonly HistoryRow[], currentVersion: number): HistoryValidation {
    // Row-shape validation: malformed data that would break row interpretation maps to a typed
    // inspection issue rather than a raw cast or a later false checksum result. These all map
    // to a history-mismatch condition (never to a checksum mismatch) so the runner preserves
    // its existing error-code mapping.
    for (const row of rows) {
      if (typeof row.migration_id !== 'string' || row.migration_id.length === 0) {
        return {
          valid: false,
          issue: 'History row has an invalid migration_id.',
          checksumMismatches: [],
        };
      }
      if (!Number.isInteger(row.from_version) || row.from_version < 0) {
        return {
          valid: false,
          issue: 'History row has an invalid from_version.',
          checksumMismatches: [],
        };
      }
      if (!Number.isInteger(row.to_version) || row.to_version < 0) {
        return {
          valid: false,
          issue: 'History row has an invalid to_version.',
          checksumMismatches: [],
        };
      }
    }

    // Duplicate detection is performed before the row-count check so a duplicate is not masked
    // by an incidental count mismatch.
    const byId = new Map<string, HistoryRow>();
    for (const row of rows) {
      if (byId.has(row.migration_id)) {
        return {
          valid: false,
          issue: 'History contains a duplicate migration_id.',
          checksumMismatches: [],
        };
      }
      byId.set(row.migration_id, row);
    }

    // Defensive duplicate-to_version detection. The schema enforces UNIQUE(to_version), but the
    // inspector must not trust constraints; a duplicate version path is a malformed history.
    const seenToVersion = new Set<number>();
    for (const row of rows) {
      if (seenToVersion.has(row.to_version)) {
        return {
          valid: false,
          issue: 'History contains a duplicate to_version.',
          checksumMismatches: [],
        };
      }
      seenToVersion.add(row.to_version);
    }

    const expected = this.sortedIdentities.filter((m) => m.toVersion <= currentVersion);

    if (rows.length !== expected.length) {
      return {
        valid: false,
        issue: 'History row count does not match the expected applied migrations.',
        checksumMismatches: [],
      };
    }

    const checksumMismatches: string[] = [];

    for (const migration of expected) {
      const row = byId.get(migration.id);
      if (!row) {
        return {
          valid: false,
          issue: 'Missing history row for migration ' + migration.id + '.',
          checksumMismatches: [],
        };
      }
      if (row.from_version !== migration.fromVersion || row.to_version !== migration.toVersion) {
        return {
          valid: false,
          issue: 'History version mismatch for migration ' + migration.id + '.',
          checksumMismatches: [],
        };
      }
      // A malformed (non-string) checksum still differs from the registered checksum and is
      // reported as a checksum mismatch, preserving the runner's existing error mapping.
      if (row.checksum !== migration.checksum) {
        checksumMismatches.push(migration.id);
      }
    }

    if (checksumMismatches.length > 0) {
      return {
        valid: false,
        issue: 'Checksum mismatch for migration(s): ' + checksumMismatches.join(', ') + '.',
        checksumMismatches,
      };
    }

    return { valid: true, issue: null, checksumMismatches: [] };
  }

  private computePendingChain(currentVersion: number): MigrationIdentity[] {
    return this.sortedIdentities.filter(
      (m) => m.fromVersion >= currentVersion && m.toVersion <= this.targetVersion,
    );
  }
}
