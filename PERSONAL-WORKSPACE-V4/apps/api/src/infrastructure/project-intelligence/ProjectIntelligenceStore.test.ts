import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ProjectIntelligenceStore } from './ProjectIntelligenceStore';

const NOW = '2026-08-29T00:00:00.000Z';
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const REVISION_ID = '20000000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);

function migrateThrough(target: number): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION') {
      database.exec('PRAGMA foreign_keys=OFF');
    }
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date(NOW) },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys=ON');
  }
  database.exec(`PRAGMA user_version = ${target}`);
  return database;
}

function makeStore(): { database: DatabaseSync; store: ProjectIntelligenceStore } {
  const database = migrateThrough(28);
  const store = new ProjectIntelligenceStore(database, 'LEGACY_SELF_MANAGED');
  return { database, store };
}

describe('ProjectIntelligenceStore', () => {
  it('registers, lists, and fingerprints a controlled source with CAS', () => {
    const { store } = makeStore();
    const source = store.registerSourceFile({
      projectId: PROJECT_ID,
      sourceType: 'AUTOCAD',
      displayName: 'plan.dwg',
      originalRelativeLocator: 'plan.dwg',
      sha256: SHA,
      sizeBytes: 1024,
      modifiedAt: NOW,
      now: NOW,
    });
    expect(source.rowVersion).toBe(1);
    expect(store.listSourceFiles(PROJECT_ID)).toHaveLength(1);

    const refreshed = store.updateSourceFingerprint({
      projectId: PROJECT_ID,
      sourceId: source.id,
      sha256: 'b'.repeat(64),
      sizeBytes: 2048,
      modifiedAt: NOW,
      checkedAt: NOW,
      expectedRowVersion: 1,
    });
    expect(refreshed.rowVersion).toBe(2);
    expect(refreshed.latestHash).toBe('b'.repeat(64));

    // Stale row_version is rejected with CONFLICT.
    expect(() =>
      store.updateSourceFingerprint({
        projectId: PROJECT_ID,
        sourceId: source.id,
        sha256: 'c'.repeat(64),
        sizeBytes: 2048,
        modifiedAt: NOW,
        checkedAt: NOW,
        expectedRowVersion: 1,
      }),
    ).toThrow(/changed during the freshness check/);
  });

  it('captures immutable baselines and rejects duplicates', () => {
    const { store } = makeStore();
    const source = store.registerSourceFile({
      projectId: PROJECT_ID,
      sourceType: 'EXCEL',
      displayName: 'boq.xlsx',
      originalRelativeLocator: 'boq.xlsx',
      sha256: SHA,
      sizeBytes: 512,
      modifiedAt: NOW,
      now: NOW,
    });
    const baseline = store.captureBaseline({
      projectId: PROJECT_ID,
      revisionId: REVISION_ID,
      sourceFileId: source.id,
      sha256: SHA,
      sizeBytes: 512,
      capturedAt: NOW,
      capturedById: 'actor',
      capturedByName: 'Actor',
    });
    expect(baseline.revisionId).toBe(REVISION_ID);
    expect(store.getBaseline(PROJECT_ID, source.id, REVISION_ID)).not.toBeNull();
    expect(store.listBaselinesForRevision(PROJECT_ID, REVISION_ID)).toHaveLength(1);
    expect(store.listBaselinesForSource(PROJECT_ID, source.id)).toHaveLength(1);
  });

  it('deletes a source and its baselines atomically', () => {
    const { store } = makeStore();
    const source = store.registerSourceFile({
      projectId: PROJECT_ID,
      sourceType: 'OTHER',
      displayName: 'notes.txt',
      originalRelativeLocator: 'notes.txt',
      sha256: SHA,
      sizeBytes: 10,
      modifiedAt: NOW,
      now: NOW,
    });
    store.captureBaseline({
      projectId: PROJECT_ID,
      revisionId: REVISION_ID,
      sourceFileId: source.id,
      sha256: SHA,
      sizeBytes: 10,
      capturedAt: NOW,
      capturedById: 'actor',
      capturedByName: 'Actor',
    });
    store.deleteSourceFile(PROJECT_ID, source.id);
    expect(store.listSourceFiles(PROJECT_ID)).toHaveLength(0);
    expect(store.listBaselinesForRevision(PROJECT_ID, REVISION_ID)).toHaveLength(0);
  });
});
