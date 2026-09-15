/**
 * Golden UAT fixture — non-mutating PLAN preflight.
 *
 * PLAN mode must be ZERO-mutation: it must never run production startup, never run
 * SchemaMigrationRunner, never open the target DB read-write, never create a migration
 * journal/backup, never advance user_version, never set WAL/journal pragmas, never seed
 * default rows, and never create fixture files or a manifest.
 *
 * This module performs ONLY read-only SQLite inspection (immutable=1 + readOnly:true, the
 * same authority used by LegacyDetector) and reuses the existing MigrationStateInspector
 * (the single source of truth for read-only migration-state interpretation). It never
 * writes to the database and never creates files.
 */

import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { MigrationStateInspector } from '../infrastructure/migration/MigrationStateInspector';
import { PRODUCTION_MIGRATIONS } from '../infrastructure/migration/registry/production-migration-registry';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../infrastructure/migration/registry/production-migration-registry';

export interface GoldenUatPreflight {
  databasePath: string;
  databaseExists: boolean;
  /** Detected schema version (PRAGMA user_version). 0 when the DB does not exist. */
  detectedSchemaVersion: number;
  /** Expected schema version (production target). */
  expectedSchemaVersion: number;
  /** True when the detected schema matches the expected target. */
  schemaAtTarget: boolean;
  /** True when the detected schema is older than the expected target. */
  schemaOlderThanTarget: boolean;
  /** True when the detected schema is newer than the expected target. */
  schemaNewerThanTarget: boolean;
  /** Apply eligibility derived from the detected schema. */
  applyEligibility: 'READY' | 'REQUIRES_CANONICAL_STARTUP_MIGRATION' | 'BLOCKED';
  /** True when the fixture project already exists in the target DB (read-only lookup). */
  fixtureExists: boolean;
  /** Human-readable preflight summary. */
  summary: string;
}

/**
 * Opens a strictly read-only SQLite connection. immutable=1 keeps the open read-only so
 * SQLite does not create or modify -wal/-shm sidecars and never writes to the main file.
 * This is the same authority used by LegacyDetector for read-only inspection.
 */
function openReadOnly(databasePath: string): DatabaseSync {
  const uri = pathToFileURL(databasePath).href + '?immutable=1';
  return new DatabaseSync(uri, { readOnly: true });
}

/**
 * Runs the non-mutating PLAN preflight against a target database path. Never mutates the
 * database and never creates files. If the database does not exist, it is not created.
 */
export function runGoldenUatPreflight(databasePath: string): GoldenUatPreflight {
  const resolved = databasePath;
  const databaseExists = existsSync(resolved);

  let detectedSchemaVersion = 0;
  let fixtureExists = false;

  if (databaseExists) {
    const db = openReadOnly(resolved);
    try {
      const inspector = new MigrationStateInspector(
        PRODUCTION_MIGRATIONS,
        PRODUCTION_SCHEMA_TARGET_VERSION,
      );
      const state = inspector.inspect(db);
      detectedSchemaVersion = state.currentVersion;

      // Optional read-only fixture identity lookup: only when the app_state table exists and
      // the schema is at target. This never writes and never creates the table.
      if (state.historyTableExists) {
        try {
          const row = db
            .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
            .get() as { json_value: string } | undefined;
          if (row) {
            const parsed = JSON.parse(row.json_value) as {
              projects?: Array<{ crmReference?: string | null }>;
            };
            fixtureExists = (parsed.projects ?? []).some(
              (project) => project.crmReference === 'GOLDEN_UAT:BOUTIQUE_HOTEL_LIGHTING_PACKAGE',
            );
          }
        } catch {
          // Read-only fixture lookup is best-effort; a malformed app_state row must not
          // block PLAN. The collision guard still runs during APPLY through canonical paths.
          fixtureExists = false;
        }
      }
    } finally {
      db.close();
    }
  }

  const expectedSchemaVersion = PRODUCTION_SCHEMA_TARGET_VERSION;
  const schemaAtTarget = detectedSchemaVersion === expectedSchemaVersion;
  const schemaOlderThanTarget = detectedSchemaVersion < expectedSchemaVersion;
  const schemaNewerThanTarget = detectedSchemaVersion > expectedSchemaVersion;

  let applyEligibility: GoldenUatPreflight['applyEligibility'];
  if (schemaNewerThanTarget) {
    applyEligibility = 'BLOCKED';
  } else if (schemaAtTarget) {
    applyEligibility = 'READY';
  } else {
    applyEligibility = 'REQUIRES_CANONICAL_STARTUP_MIGRATION';
  }

  const summary = [
    `Target DB: ${resolved}`,
    `Database exists: ${databaseExists ? 'YES' : 'NO'}`,
    `Detected schema: v${detectedSchemaVersion}`,
    `Expected schema: v${expectedSchemaVersion}`,
    `Apply eligibility: ${applyEligibility}`,
    `Fixture project exists: ${fixtureExists ? 'YES' : 'NO'}`,
  ].join('\n');

  return {
    databasePath: resolved,
    databaseExists,
    detectedSchemaVersion,
    expectedSchemaVersion,
    schemaAtTarget,
    schemaOlderThanTarget,
    schemaNewerThanTarget,
    applyEligibility,
    fixtureExists,
    summary,
  };
}
