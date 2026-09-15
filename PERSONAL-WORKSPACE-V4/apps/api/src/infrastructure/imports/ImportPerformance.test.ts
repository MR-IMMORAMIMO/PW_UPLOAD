import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppUser } from '@scli/domain';
import { applyV24SmartImportInspection } from '../migration/registry/production-v24-smart-import-inspection';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ImportAdapterRegistry } from './ImportAdapterRegistry';
import { ImportInspectionService } from './ImportInspectionService';
import { ImportLibraryReconciliationService } from './ImportLibraryReconciliationService';
import { ImportSessionStore } from './ImportSessionStore';
import { ImportSourceAdmission } from './ImportSourceAdmission';
import {
  SqliteLuminaireLibraryDraftWritePort,
  type LuminaireLibraryDraftWritePort,
} from './LuminaireLibraryDraftWritePort';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});
const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  entraObjectId: 'standalone:owner',
  displayName: 'Workspace Owner',
  email: 'owner@example.com',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
} satisfies AppUser;

describe('Smart Import synthetic performance evidence', () => {
  it('measures bounded parse, persistence, query, and database size at required scales', async () => {
    const metrics: Array<Record<string, number>> = [];
    for (const rowCount of [100, 1_000, 5_000, 10_000]) {
      const root = mkdtempSync(path.join(tmpdir(), `p5b-perf-${rowCount}-`));
      roots.push(root);
      const databasePath = path.join(root, 'workspace.sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec('PRAGMA journal_mode = DELETE; PRAGMA user_version = 24');
      applyV24SmartImportInspection(database);
      const csv = [
        'Manufacturer,Product Family,Ordering Code,Wattage [W],Lumens [lm],CCT [K],CRI,Beam Angle',
        ...Array.from(
          { length: rowCount },
          (_, index) => `Brand ${index},Family ${index},SKU-${index},12,950,3000,90,24°`,
        ),
      ].join('\n');
      const buffer = Buffer.from(csv);
      const parseStart = performance.now();
      await new ImportAdapterRegistry().inspect('performance.csv', buffer);
      const parseMs = performance.now() - parseStart;
      const store = new ImportSessionStore(database);
      const service = new ImportInspectionService(store, new ImportSourceAdmission(root));
      const session = service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
      const totalStart = performance.now();
      await service.inspectBuffer(session.importSessionId, 'performance.csv', buffer);
      const inspectAndPersistMs = performance.now() - totalStart;
      const queryStart = performance.now();
      const page = store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' });
      const queryMs = performance.now() - queryStart;
      expect(page.items).toHaveLength(50);
      expect(page.totalCount).toBe(rowCount);
      database.close();
      metrics.push({
        rowCount,
        parseMs: Number(parseMs.toFixed(1)),
        persistenceMs: Number(Math.max(0, inspectAndPersistMs - parseMs).toFixed(1)),
        queryMs: Number(queryMs.toFixed(1)),
        persistedBytes: statSync(databasePath).size,
      });
    }
    console.info(`P5B_PERFORMANCE ${JSON.stringify(metrics)}`);
  }, 120_000);

  it('measures indexed Library grouping and one batched catalogue read at required scales', () => {
    const metrics: Array<Record<string, number>> = [];
    for (const rowCount of [100, 1_000, 5_000, 10_000]) {
      const root = mkdtempSync(path.join(tmpdir(), `p5bc-perf-${rowCount}-`));
      roots.push(root);
      const databasePath = path.join(root, 'workspace.sqlite');
      const database = new DatabaseSync(databasePath);
      database.exec('PRAGMA foreign_keys = ON');
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
          clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
        });
        database.exec('COMMIT');
        database.exec('PRAGMA foreign_keys = ON');
      }
      const store = new ImportSessionStore(database, () => new Date('2026-08-27T00:00:00.000Z'));
      const created = store.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
      const previewFingerprint = 'a'.repeat(64);
      const evidence = (canonicalField: string, normalizedValue: string | number) => ({
        canonicalField,
        sourceColumnKey: canonicalField,
        rawValue: normalizedValue,
        normalizedValue,
        basis: null,
        unit: null,
        success: true,
        reason: null,
        normalizerVersion: '1',
      });
      store.persistInspection(created.importSessionId, {
        sourceFileName: `p5bc-${rowCount}.csv`,
        sourceSha256: 'b'.repeat(64),
        sourceSizeBytes: rowCount * 100,
        sourceExtension: '.csv',
        detectedAdapterId: 'GENERIC_CSV',
        detectedAdapterVersion: '1',
        detection: {},
        destinationFingerprint: 'c'.repeat(64),
        previewFingerprint,
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
            rows: Array.from({ length: rowCount }, (_, index) => ({
              importRowId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
              sourceRowNumber: index + 2,
              sourceRowKey: `${index + 2}:key`,
              sourceRowFingerprint: createHash('sha256').update(String(index)).digest('hex'),
              rawCells: [],
              mappedCandidate: {},
              normalizationEvidence: [
                evidence('MANUFACTURER', `Brand ${index % 100}`),
                evidence('PRODUCT_FAMILY', `Family ${index % 500}`),
                evidence('VARIANT_LABEL', `Variant ${index}`),
                evidence('ORDERING_CODE', `SKU-${index}`),
              ],
              validationReasons: [],
              rowStatus: 'READY' as const,
            })),
          },
        ],
      });
      const basePort = new SqliteLuminaireLibraryDraftWritePort(database);
      let catalogueReads = 0;
      const countedPort = new Proxy(basePort, {
        get(target, property) {
          if (property === 'catalogue')
            return () => {
              catalogueReads += 1;
              return target.catalogue();
            };
          const member = Reflect.get(target, property);
          return typeof member === 'function' ? member.bind(target) : member;
        },
      }) as LuminaireLibraryDraftWritePort;
      const service = new ImportLibraryReconciliationService(store, countedPort);
      const current = store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
      const start = performance.now();
      service.reconcile(created.importSessionId, {
        expectedSessionRevision: current.sessionRevision,
        expectedPreviewFingerprint: previewFingerprint,
      });
      const reconcileMs = performance.now() - start;
      expect(catalogueReads).toBe(1);
      expect(
        store.rows(created.importSessionId, { page: 0, limit: 1, filter: 'ALL' }).totalCount,
      ).toBe(rowCount);
      database.close();
      metrics.push({
        rowCount,
        groupingAndLookupMs: Number(reconcileMs.toFixed(1)),
        catalogueReads,
        persistedBytes: statSync(databasePath).size,
      });
    }
    console.info(`P5B_C_RECONCILIATION_PERFORMANCE ${JSON.stringify(metrics)}`);
  }, 120_000);
});
