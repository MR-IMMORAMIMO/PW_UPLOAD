import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import type { AppUser } from '@scli/domain';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from '../luminaire-library/LuminaireLibraryService';
import { LuminaireLibraryStore } from '../luminaire-library/LuminaireLibraryStore';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ImportApplyService } from './ImportApplyService';
import {
  importAuthorityFingerprint,
  ImportReconciliationService,
} from './ImportReconciliationService';
import { ImportSessionStore } from './ImportSessionStore';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

const NOW = new Date('2026-08-27T08:00:00.000Z');
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const actor = {
  id: '20000000-0000-4000-8000-000000000001',
  entraObjectId: 'standalone:owner',
  displayName: 'Workspace Owner',
  email: 'owner@example.test',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
} satisfies AppUser;

class BackupStub implements WorkspaceBackupService {
  public count = 0;
  public async createBackup() {
    return 'unused';
  }
  public async createVerifiedBackup() {
    this.count += 1;
    return { backupId: `perf-backup-${this.count}` };
  }
  public async listBackups() {
    return [];
  }
  public async scheduleRestore() {
    return 'unused';
  }
}

const evidence = (field: string, normalizedValue: string | number) => ({
  canonicalField: field,
  sourceColumnKey: field,
  rawValue: normalizedValue,
  normalizedValue,
  basis: null,
  unit: null,
  success: true,
  reason: null,
  normalizerVersion: '1',
});

describe('P5B-B Project Apply synthetic performance evidence', () => {
  it('measures reconciliation, destination authority, plan construction, count query, and Project-only Apply at required scales', async () => {
    const metrics: Array<Record<string, number>> = [];
    for (const rowCount of [100, 1_000, 5_000, 10_000]) {
      const root = mkdtempSync(path.join(tmpdir(), `p5b-project-apply-perf-${rowCount}-`));
      roots.push(root);
      const databasePath = path.join(root, 'workspace.sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec(
        'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL',
      );
      for (const migration of PRODUCTION_MIGRATIONS) {
        database.exec(
          migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
            ? 'PRAGMA foreign_keys = OFF'
            : 'PRAGMA foreign_keys = ON',
        );
        database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
        migration.up({
          database,
          migrationId: migration.id,
          fromVersion: migration.fromVersion,
          toVersion: migration.toVersion,
          clock: { now: () => NOW },
        });
        database.exec('COMMIT');
        database.exec('PRAGMA foreign_keys = ON');
      }
      const store = new ImportSessionStore(database, () => NOW);
      const session = store.create({ destinationMode: 'PROJECT', projectId: PROJECT_ID }, actor);
      const preview = 'a'.repeat(64);
      const rows = Array.from({ length: rowCount }, (_, index) => {
        const tag = `DL${String(index + 1).padStart(5, '0')}`;
        return {
          importRowId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          sourceRowNumber: index + 2,
          sourceRowKey: `${index + 2}:${tag}`,
          sourceRowFingerprint: index.toString(16).padStart(64, '0'),
          rawCells: [],
          mappedCandidate: {},
          normalizationEvidence: [evidence('TAG', tag), evidence('QUANTITY', 1)],
          validationReasons: [],
          rowStatus: 'READY' as const,
        };
      });
      store.persistInspection(session.importSessionId, {
        sourceFileName: 'performance.csv',
        sourceSha256: 'b'.repeat(64),
        sourceSizeBytes: rowCount * 50,
        sourceExtension: '.csv',
        detectedAdapterId: 'GENERIC_CSV',
        detectedAdapterVersion: '1',
        detection: {},
        destinationFingerprint: 'c'.repeat(64),
        previewFingerprint: preview,
        status: 'READY_FOR_REVIEW',
        tables: [
          {
            sourceTableId: '30000000-0000-4000-8000-000000000001',
            tableKey: 'csv',
            tableName: 'CSV',
            sourceOrdinal: 0,
            visibilityState: 'VISIBLE',
            detectedRegion: {},
            headerRow: 1,
            selected: true,
            headerSignature: 'headers',
            mapping: [],
            mappingFingerprint: 'd'.repeat(64),
            rows,
          },
        ],
      });
      const reconciliation = new ImportReconciliationService(store, () => NOW);
      let current = store.get(session.importSessionId);
      const fingerprintStart = performance.now();
      const syntheticDestinationFingerprint = importAuthorityFingerprint(
        rows.map((row) => ({
          rowId: row.importRowId,
          tag: row.normalizationEvidence[0]!.normalizedValue,
        })),
      );
      const destinationFingerprintMs = performance.now() - fingerprintStart;
      expect(syntheticDestinationFingerprint).toMatch(/^[0-9a-f]{64}$/);
      const reconciliationStart = performance.now();
      current = reconciliation.reconcile(session.importSessionId, {
        expectedSessionRevision: current.sessionRevision,
        expectedPreviewFingerprint: preview,
      });
      const reconciliationMs = performance.now() - reconciliationStart;
      const planStart = performance.now();
      for (let offset = 0; offset < rows.length; offset += 500) {
        current = reconciliation.setBulkActions(session.importSessionId, {
          expectedSessionRevision: current.sessionRevision,
          rowIds: rows.slice(offset, offset + 500).map((row) => row.importRowId),
          action: 'PROJECT_CREATE_ONLY',
        });
      }
      const planConstructionMs = performance.now() - planStart;
      const countStart = performance.now();
      expect(
        store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' }).totalCount,
      ).toBe(rowCount);
      const countQueryMs = performance.now() - countStart;
      const backup = new BackupStub();
      const library = new LuminaireLibraryService(
        new LuminaireLibraryStore(database, () => NOW),
        new LuminaireLibraryAssetStorage(root),
        () => NOW,
      );
      const apply = new ImportApplyService(store, library, backup, () => NOW);
      current = store.get(session.importSessionId);
      const applyStart = performance.now();
      const result = await apply.apply(
        session.importSessionId,
        {
          expectedSessionRevision: current.sessionRevision,
          previewFingerprint: preview,
          destinationFingerprint: current.destinationFingerprint!,
          applyPlanFingerprint: current.applyPlanFingerprint!,
          idempotencyKey: `performance-${rowCount}`,
          mode: 'ALL',
          confirmPartial: false,
        },
        actor,
      );
      const projectApplyMs = performance.now() - applyStart;
      expect(result).toMatchObject({
        state: 'SUCCEEDED',
        counts: { applied: rowCount, failed: 0 },
      });
      expect(backup.count).toBe(1);
      expect(
        (
          database.prepare('SELECT COUNT(*) AS count FROM project_luminaires').get() as {
            count: number;
          }
        ).count,
      ).toBe(rowCount);
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      database.close();
      metrics.push({
        rowCount,
        reconciliationMs: Number(reconciliationMs.toFixed(1)),
        destinationFingerprintMs: Number(destinationFingerprintMs.toFixed(1)),
        planConstructionMs: Number(planConstructionMs.toFixed(1)),
        countQueryMs: Number(countQueryMs.toFixed(1)),
        projectApplyMs: Number(projectApplyMs.toFixed(1)),
        databaseSizeBytes: statSync(databasePath).size,
      });
    }
    console.info(`P5B_B_PROJECT_APPLY_PERFORMANCE ${JSON.stringify(metrics)}`);
  }, 240_000);
});
