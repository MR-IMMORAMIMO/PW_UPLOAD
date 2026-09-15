/**
 * Legacy v3.2.2 immutable manifest — exact historical schema contract.
 *
 * This module is test infrastructure only. Production application code must not import it.
 *
 * P1.6A-B — Lock Exact Legacy v3.2.2 Schema Manifest and Fixture Contract
 */

import {
  HISTORICAL_SOURCE_COMMIT,
  TABLE_NAMES,
  INDEX_NAMES,
  TRIGGER_NAMES,
  VIEW_NAMES,
  VIRTUAL_TABLE_NAMES,
  SCHEMA_OWNER_BY_OBJECT,
  SCHEMA_STATEMENTS,
  COMPATIBILITY_COLUMNS,
  SUPPORTED_INITIAL_PROFILES,
  RUNTIME_DEFAULT_ROWS,
  type LegacyV322FixtureProfile,
} from './legacy-v322-schema';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface LegacyV322Manifest {
  readonly fixtureFormatVersion: 1;
  readonly applicationVersion: '3.2.2';
  readonly historicalSourceCommit: string;
  readonly expectedUserVersion: 0;
  readonly hasMigrationHistory: false;
  readonly databaseJournalMode: 'wal';
  readonly foreignKeysEnabled: true;
  readonly tableNames: readonly string[];
  readonly ownedIndexNames: readonly string[];
  readonly expectedTriggerNames: readonly string[];
  readonly expectedViewNames: readonly string[];
  readonly expectedVirtualTableNames: readonly string[];
  readonly schemaOwnerByObject: ReadonlyMap<string, string>;
  readonly schemaStatementCount: number;
  readonly compatibilityColumnOperations: readonly {
    readonly table: string;
    readonly column: string;
    readonly definition: string;
    readonly owner: string;
    readonly alreadyInBaseCreate: boolean;
  }[];
  readonly supportedInitialProfiles: readonly LegacyV322FixtureProfile[];
  readonly runtimeDefaultRows: readonly {
    readonly table: string;
    readonly key: string;
    readonly sourceComponent: string;
    readonly creationCondition: string;
    readonly deterministic: boolean;
    readonly environmentDependent: boolean;
    readonly credentialSensitive: boolean;
  }[];
  readonly syntheticDataOnly: true;
  readonly productionDataAccessAllowed: false;
}

export const LEGACY_V322_MANIFEST: LegacyV322Manifest = Object.freeze({
  fixtureFormatVersion: 1 as const,
  applicationVersion: '3.2.2' as const,
  historicalSourceCommit: HISTORICAL_SOURCE_COMMIT,
  expectedUserVersion: 0,
  hasMigrationHistory: false as const,
  databaseJournalMode: 'wal' as const,
  foreignKeysEnabled: true,
  tableNames: TABLE_NAMES,
  ownedIndexNames: INDEX_NAMES,
  expectedTriggerNames: TRIGGER_NAMES,
  expectedViewNames: VIEW_NAMES,
  expectedVirtualTableNames: VIRTUAL_TABLE_NAMES,
  schemaOwnerByObject: SCHEMA_OWNER_BY_OBJECT,
  schemaStatementCount: SCHEMA_STATEMENTS.length,
  compatibilityColumnOperations: COMPATIBILITY_COLUMNS,
  supportedInitialProfiles: SUPPORTED_INITIAL_PROFILES,
  runtimeDefaultRows: RUNTIME_DEFAULT_ROWS,
  syntheticDataOnly: true as const,
  productionDataAccessAllowed: false as const,
});
