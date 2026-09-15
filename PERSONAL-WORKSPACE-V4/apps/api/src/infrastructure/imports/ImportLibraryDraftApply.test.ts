import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { DomainError, type AppUser } from '@scli/domain';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from '../luminaire-library/LuminaireLibraryService';
import { LuminaireLibraryStore } from '../luminaire-library/LuminaireLibraryStore';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ImportApplyService } from './ImportApplyService';
import { ImportLibraryReconciliationService } from './ImportLibraryReconciliationService';
import { ImportSessionStore } from './ImportSessionStore';
import { SqliteLuminaireLibraryDraftWritePort } from './LuminaireLibraryDraftWritePort';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const NOW = new Date('2026-08-27T08:00:00.000Z');
const actor: AppUser = {
  id: '20000000-0000-4000-8000-000000000001',
  entraObjectId: '20000000-0000-4000-8000-000000000001',
  displayName: 'Owner',
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
};

class BackupStub implements WorkspaceBackupService {
  public count = 0;
  public fail = false;
  public async createBackup() {
    return 'unused';
  }
  public async createVerifiedBackup() {
    this.count += 1;
    if (this.fail) throw new Error('backup failed');
    return { backupId: 'library-backup-1' };
  }
  public async listBackups() {
    return [];
  }
  public async scheduleRestore() {
    return 'unused';
  }
}

function database(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
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
      clock: { now: () => NOW },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys = ON');
  }
  return database;
}

const value = (
  canonicalField: string,
  normalizedValue: string | number,
  basis: string | null = null,
  unit: string | null = null,
) => ({
  canonicalField,
  sourceColumnKey: canonicalField,
  rawValue: normalizedValue,
  normalizedValue,
  basis,
  unit,
  success: true,
  reason: null,
  normalizerVersion: '1',
});

class CountingDraftWritePort extends SqliteLuminaireLibraryDraftWritePort {
  public transactionCount = 0;
  public failTransactionNumber: number | null = null;

  public override transaction<T>(operation: () => T): T {
    this.transactionCount += 1;
    if (this.transactionCount === this.failTransactionNumber)
      throw new Error('synthetic later sub-batch failure');
    return super.transaction(operation);
  }
}

function fixture(orderingCode: string, rowCount = 1) {
  const db = database();
  const root = mkdtempSync(path.join(tmpdir(), 'p5bc-library-'));
  roots.push(root);
  const store = new ImportSessionStore(db, () => NOW);
  const session = store.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
  const preview = 'a'.repeat(64);
  store.persistInspection(session.importSessionId, {
    sourceFileName: 'synthetic-library.csv',
    sourceSha256: 'b'.repeat(64),
    sourceSizeBytes: 100,
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
        rows: Array.from({ length: rowCount }, (_, index) => {
          const rowOrderingCode =
            rowCount === 1 ? orderingCode : `${orderingCode}-${String(index + 1)}`;
          return {
            importRowId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            sourceRowNumber: index + 2,
            sourceRowKey: `${index + 2}:key`,
            sourceRowFingerprint: createHash('sha256').update(String(index)).digest('hex'),
            rawCells: [],
            mappedCandidate: {},
            normalizationEvidence: [
              value('MANUFACTURER', 'Acme'),
              value('PRODUCT_FAMILY', 'Arc'),
              value('PRODUCT_TYPE', 'Downlight'),
              value('DESCRIPTION', 'Architectural recessed family'),
              value('ORDERING_CODE', rowOrderingCode),
              value('WATTAGE', 12, 'W', 'W'),
              value('LUMENS', 900, 'LM', 'lm'),
              value('CCT', '3000 K'),
            ],
            validationReasons: [],
            rowStatus: 'READY' as const,
          };
        }),
      },
    ],
  });
  const libraryStore = new LuminaireLibraryStore(db, () => NOW);
  const library = new LuminaireLibraryService(
    libraryStore,
    new LuminaireLibraryAssetStorage(root),
    () => NOW,
  );
  const drafts = new CountingDraftWritePort(db, () => NOW);
  const backup = new BackupStub();
  return {
    db,
    store,
    preview,
    backup,
    libraryStore,
    drafts,
    reconciliation: new ImportLibraryReconciliationService(store, drafts, () => NOW),
    apply: new ImportApplyService(store, library, backup, () => NOW, undefined, drafts),
  };
}

async function applyCurrent(f: ReturnType<typeof fixture>, keySuffix = 'initial') {
  const session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
  return f.apply.apply(
    session.importSessionId,
    {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint!,
      destinationFingerprint: session.destinationFingerprint!,
      applyPlanFingerprint: session.applyPlanFingerprint!,
      idempotencyKey: `library-apply-${session.importSessionId}-${keySuffix}`,
      mode: 'ALL',
      confirmPartial: false,
    },
    actor,
  );
}

describe('P5B-C Library Draft Apply authority', () => {
  it('returns row-specific guidance when a Library action is attempted before reconciliation', () => {
    const f = fixture('ARC-12-30');
    const session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;

    try {
      f.reconciliation.setAction(session.importSessionId, row.importRowId, {
        expectedSessionRevision: session.sessionRevision,
        expectedRowVersion: row.rowVersion,
        action: { type: 'LIBRARY_CREATE_DRAFT' },
      });
      throw new Error('Expected the action to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'IMPORT_ACTION_INVALID',
        details: expect.objectContaining({
          importRowId: row.importRowId,
          sourceRowNumber: row.sourceRowNumber,
          attemptedAction: 'LIBRARY_CREATE_DRAFT',
          reasonCode: 'LIBRARY_RECONCILIATION_REQUIRED',
          humanReason: expect.any(String),
          requiredNextStep: 'Reconcile Library before choosing an action.',
        }),
      });
      expect((error as Error).message).toContain(`source row ${row.sourceRowNumber}`);
    }
  });

  it('creates one Manufacturer, Product, and mutable Variant after the explicit group decision', async () => {
    const f = fixture('ARC-12-30');
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    expect(row.reconciliation?.schemaVersion).toBe(2);
    if (!row.reconciliation || row.reconciliation.schemaVersion !== 2)
      throw new Error('Expected Library reconciliation.');
    expect(row.reconciliation.allowedActions).toEqual(['SKIP']);
    session = f.reconciliation.decideGroup(session.importSessionId, {
      kind: 'MANUFACTURER',
      expectedSessionRevision: session.sessionRevision,
      manufacturerGroupId: row.reconciliation.manufacturer.manufacturerGroupId,
      decision: { mode: 'CREATE' },
    });
    row = f.store.row(session.importSessionId, row.importRowId);
    row = f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'LIBRARY_CREATE_DRAFT' },
    });
    const result = await applyCurrent(f);
    expect(result.state).toBe('SUCCEEDED');
    expect(f.store.get(session.importSessionId)).toMatchObject({
      sessionStatus: 'COMPLETED',
      completedAt: NOW.toISOString(),
    });
    expect(result.backupId).toBe('library-backup-1');
    expect(result.counts).toMatchObject({
      uniqueManufacturersCreated: 1,
      uniqueProductsCreated: 1,
      variantDraftsCreated: 1,
      publishedVersionsCreated: 0,
    });
    expect(f.backup.count).toBe(1);
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_manufacturers').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_library_products').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_library_versions').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
    expect(f.store.row(session.importSessionId, row.importRowId).resultIdentity).toMatchObject({
      schemaVersion: 2,
      outcome: 'DRAFT_CREATED',
      mutationOccurred: true,
      latestPublishedVersionId: null,
    });
  });

  it('records Use Existing as terminal without a backup or Library mutation', async () => {
    const f = fixture('ARC-EXISTING');
    const maker = f.libraryStore.createManufacturer(
      { name: 'Acme', idempotencyKey: 'maker-existing' },
      actor,
    );
    const product = f.libraryStore.createProduct(
      {
        manufacturerId: maker.manufacturerId,
        name: 'Arc',
        productType: 'Downlight',
        description: 'Existing',
        idempotencyKey: 'product-existing',
      },
      actor,
    );
    const variant = f.libraryStore.createVariant(
      product.productId,
      {
        variantLabel: '12 W · 900 lm · 3000 K',
        orderingCode: 'ARC-EXISTING',
        wattage: '12 W',
        lumens: '900 lm',
        lightColor: '3000 K',
        cri: '',
        beamAngle: '',
        ipRating: '',
        mounting: '',
        cutout: '',
        driver: '',
        control: '',
        emergency: '',
        dimensions: '',
        bodyColorFinish: '',
        idempotencyKey: 'variant-existing',
      },
      actor,
    );
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    row = f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'LIBRARY_USE_EXISTING' },
    });
    const result = await applyCurrent(f);
    expect(result.state).toBe('SUCCEEDED');
    expect(result.backupId).toBeNull();
    expect(result.counts.existingVariantsUsed).toBe(1);
    expect(f.backup.count).toBe(0);
    expect(f.store.row(session.importSessionId, row.importRowId).resultIdentity).toMatchObject({
      schemaVersion: 2,
      outcome: 'USED_EXISTING',
      mutationOccurred: false,
      variantId: variant.variantId,
    });
  });

  it('keeps the Library unchanged when the verified backup fails', async () => {
    const f = fixture('ARC-BACKUP');
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    if (!row.reconciliation || row.reconciliation.schemaVersion !== 2)
      throw new Error('Expected Library reconciliation.');
    session = f.reconciliation.decideGroup(session.importSessionId, {
      kind: 'MANUFACTURER',
      expectedSessionRevision: session.sessionRevision,
      manufacturerGroupId: row.reconciliation.manufacturer.manufacturerGroupId,
      decision: { mode: 'CREATE' },
    });
    row = f.store.row(session.importSessionId, row.importRowId);
    f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'LIBRARY_CREATE_DRAFT' },
    });
    f.backup.fail = true;
    await expect(applyCurrent(f)).rejects.toMatchObject({ code: 'IMPORT_BACKUP_FAILED' });
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);
  });

  it('creates one shared parent and caps a 101-Variant Product group at two transactions', async () => {
    const f = fixture('ARC-BATCH', 101);
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let rows = f.store.rows(session.importSessionId, { page: 0, limit: 500, filter: 'ALL' }).items;
    const reconciliation = rows[0]!.reconciliation;
    if (!reconciliation || reconciliation.schemaVersion !== 2)
      throw new Error('Expected Library reconciliation.');
    session = f.reconciliation.decideGroup(session.importSessionId, {
      kind: 'MANUFACTURER',
      expectedSessionRevision: session.sessionRevision,
      manufacturerGroupId: reconciliation.manufacturer.manufacturerGroupId,
      decision: { mode: 'CREATE' },
    });
    rows = f.store
      .rows(session.importSessionId, { page: 0, limit: 500, filter: 'ALL' })
      .items.filter((row) => row.applyState !== 'APPLIED');
    f.reconciliation.setBulkActions(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      rowIds: rows.map((row) => row.importRowId),
      action: 'LIBRARY_CREATE_DRAFT',
    });
    const applyStart = performance.now();
    const result = await applyCurrent(f);
    const applyMs = performance.now() - applyStart;
    expect(result.state).toBe('SUCCEEDED');
    expect(result.counts).toMatchObject({
      uniqueManufacturersCreated: 1,
      uniqueProductsCreated: 1,
      variantDraftsCreated: 101,
      publishedVersionsCreated: 0,
    });
    expect(f.drafts.transactionCount).toBe(2);
    console.info(
      `P5B_C_APPLY_PERFORMANCE ${JSON.stringify({ rows: 101, transactions: 2, applyMs: Number(applyMs.toFixed(1)) })}`,
    );
  });

  it('persists a later sub-batch failure and resumes only the remaining Variant', async () => {
    const f = fixture('ARC-RESUME', 101);
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let rows = f.store.rows(session.importSessionId, { page: 0, limit: 500, filter: 'ALL' }).items;
    const reconciliation = rows[0]!.reconciliation;
    if (!reconciliation || reconciliation.schemaVersion !== 2)
      throw new Error('Expected Library reconciliation.');
    session = f.reconciliation.decideGroup(session.importSessionId, {
      kind: 'MANUFACTURER',
      expectedSessionRevision: session.sessionRevision,
      manufacturerGroupId: reconciliation.manufacturer.manufacturerGroupId,
      decision: { mode: 'CREATE' },
    });
    rows = f.store.rows(session.importSessionId, { page: 0, limit: 500, filter: 'ALL' }).items;
    f.reconciliation.setBulkActions(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      rowIds: rows.map((row) => row.importRowId),
      action: 'LIBRARY_CREATE_DRAFT',
    });
    f.drafts.failTransactionNumber = 2;
    const partial = await applyCurrent(f, 'partial');
    expect(partial.state).toBe('PARTIALLY_APPLIED');
    expect(f.store.get(session.importSessionId)).toMatchObject({
      sessionStatus: 'NEEDS_REVIEW',
      completedAt: null,
    });
    expect(partial.counts).toMatchObject({ applied: 100, failed: 1, variantDraftsCreated: 100 });
    f.drafts.failTransactionNumber = null;
    session = f.store.get(session.importSessionId);
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    rows = f.store
      .rows(session.importSessionId, { page: 0, limit: 500, filter: 'ALL' })
      .items.filter((row) => row.applyState !== 'APPLIED');
    f.reconciliation.setBulkActions(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      rowIds: rows.map((row) => row.importRowId),
      action: 'LIBRARY_CREATE_DRAFT',
    });
    const resumed = await applyCurrent(f, 'resume');
    expect(resumed.state).toBe('SUCCEEDED');
    expect(f.store.get(session.importSessionId).sessionStatus).toBe('COMPLETED');
    expect(resumed.counts).toMatchObject({ applied: 1, failed: 0, variantDraftsCreated: 1 });
    expect(
      (
        f.db.prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants').get() as {
          count: number;
        }
      ).count,
    ).toBe(101);
  });
});
