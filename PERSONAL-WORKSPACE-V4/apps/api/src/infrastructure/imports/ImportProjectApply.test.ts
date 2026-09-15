import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppUser } from '@scli/domain';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from '../luminaire-library/LuminaireLibraryService';
import { LuminaireLibraryStore } from '../luminaire-library/LuminaireLibraryStore';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore';
import { ImportApplyService } from './ImportApplyService';
import { ImportReconciliationService } from './ImportReconciliationService';
import { ImportSessionStore } from './ImportSessionStore';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const NOW = new Date('2026-08-27T08:00:00.000Z');
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
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
  public async createBackup() {
    return 'unused';
  }
  public async createVerifiedBackup() {
    this.count += 1;
    return { backupId: 'backup-opaque-1' };
  }
  public async listBackups() {
    return [];
  }
  public async scheduleRestore() {
    return 'unused';
  }
}

class DeferredBackupStub implements WorkspaceBackupService {
  public started!: Promise<void>;
  private signalStarted!: () => void;
  private release!: () => void;
  public constructor() {
    this.started = new Promise((resolve) => {
      this.signalStarted = resolve;
    });
  }
  public async createBackup() {
    return 'unused';
  }
  public async createVerifiedBackup() {
    this.signalStarted();
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return { backupId: 'deferred-backup' };
  }
  public resume() {
    this.release();
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

function fixture(
  evidence: Array<Record<string, unknown>>,
  additionalRows: Array<{
    importRowId: string;
    sourceRowNumber: number;
    sourceRowFingerprint: string;
    evidence: Array<Record<string, unknown>>;
    validationReasons?: Array<Record<string, unknown>>;
  }> = [],
) {
  const db = database();
  const root = mkdtempSync(path.join(tmpdir(), 'p5b-apply-'));
  roots.push(root);
  const store = new ImportSessionStore(db, () => NOW);
  const session = store.create({ destinationMode: 'PROJECT', projectId: PROJECT_ID }, actor);
  const preview = 'a'.repeat(64);
  store.persistInspection(session.importSessionId, {
    sourceFileName: 'owner.csv',
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
        rows: [
          {
            importRowId: '40000000-0000-4000-8000-000000000001',
            sourceRowNumber: 2,
            sourceRowKey: '2:key',
            sourceRowFingerprint: 'e'.repeat(64),
            rawCells: [],
            mappedCandidate: {},
            normalizationEvidence: evidence,
            validationReasons: [],
            rowStatus: 'READY',
          },
          ...additionalRows.map((row) => ({
            importRowId: row.importRowId,
            sourceRowNumber: row.sourceRowNumber,
            sourceRowKey: `${row.sourceRowNumber}:key`,
            sourceRowFingerprint: row.sourceRowFingerprint,
            rawCells: [],
            mappedCandidate: {},
            normalizationEvidence: row.evidence,
            validationReasons: row.validationReasons ?? [],
            rowStatus: row.validationReasons?.some((reason) => reason.severity === 'BLOCKING')
              ? ('BLOCKED' as const)
              : ('READY' as const),
          })),
        ],
      },
    ],
  });
  const libraryStore = new LuminaireLibraryStore(db, () => NOW);
  const library = new LuminaireLibraryService(
    libraryStore,
    new LuminaireLibraryAssetStorage(root),
    () => NOW,
  );
  const backup = new BackupStub();
  return {
    db,
    store,
    preview,
    backup,
    libraryStore,
    library,
    reconciliation: new ImportReconciliationService(store, () => NOW),
    apply: new ImportApplyService(store, library, backup, () => NOW),
  };
}

const value = (canonicalField: string, normalizedValue: string | number | null) => ({
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

describe('P5B-B Project Apply authority', () => {
  it('applies bounded bulk actions and planned Project field setters in one review revision', () => {
    const secondId = '40000000-0000-4000-8000-000000000002';
    const f = fixture(
      [value('TAG', 'DL01'), value('LOCATION', 'Imported Lobby')],
      [
        {
          importRowId: secondId,
          sourceRowNumber: 3,
          sourceRowFingerprint: 'f'.repeat(64),
          evidence: [value('TAG', 'DL02'), value('LOCATION', 'Imported Corridor')],
        },
      ],
    );
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const rowIds = f.store
      .rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items.map((row) => row.importRowId);
    const afterActions = f.reconciliation.setBulkActions(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      rowIds,
      action: 'PROJECT_CREATE_ONLY',
    });
    expect(afterActions.sessionRevision).toBe(session.sessionRevision + 1);
    expect(afterActions.applyPlanFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const firstPlan = afterActions.applyPlanFingerprint;
    const beforeEvidence = f.store.row(session.importSessionId, rowIds[0]!).normalizationEvidence;
    const afterFields = f.reconciliation.setBulkActions(session.importSessionId, {
      expectedSessionRevision: afterActions.sessionRevision,
      rowIds,
      projectFields: {
        category: 'Interior',
        location: 'Owner planned zone',
        unit: 'Each',
        quantity: 2.5,
      },
    });
    expect(afterFields.sessionRevision).toBe(afterActions.sessionRevision + 1);
    expect(afterFields.applyPlanFingerprint).not.toBe(firstPlan);
    for (const rowId of rowIds) {
      expect(f.store.row(session.importSessionId, rowId).intendedAction).toMatchObject({
        type: 'PROJECT_CREATE_ONLY',
        payload: {
          category: 'Interior',
          location: 'Owner planned zone',
          unit: 'Each',
          quantity: 2.5,
        },
      });
    }
    expect(f.store.row(session.importSessionId, rowIds[0]!).normalizationEvidence).toEqual(
      beforeEvidence,
    );
  });

  it('creates one canonical Project-only row behind one backup and replays idempotently', async () => {
    const f = fixture([
      value('TAG', ' dl01 '),
      value('LOCATION', 'Main Lobby'),
      value('QUANTITY', 2.5),
    ]);
    let session = f.store.get(
      f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!.importSessionId,
    );
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_CREATE_ONLY' },
    });
    session = f.store.get(session.importSessionId);
    const request = {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: f.preview,
      destinationFingerprint: session.destinationFingerprint!,
      applyPlanFingerprint: session.applyPlanFingerprint!,
      idempotencyKey: 'p5b-create-idempotency',
      mode: 'ALL' as const,
      confirmPartial: false,
    };
    const first = await f.apply.apply(session.importSessionId, request, actor);
    const replay = await f.apply.apply(session.importSessionId, request, actor);
    expect(first).toMatchObject({
      state: 'SUCCEEDED',
      backupId: 'backup-opaque-1',
      counts: {
        created: 1,
        updatedProjectOnlyResult: 0,
        updatedLinkedProjectFieldsResult: 0,
        addedFromLibrary: 0,
        skippedResult: 0,
        failed: 0,
        remainingBlocked: 0,
        remainingUnresolved: 0,
      },
    });
    expect(replay.applyAttemptId).toBe(first.applyAttemptId);
    const reopened = new ImportApplyService(f.store, f.library, f.backup, () => NOW).listAttempts(
      session.importSessionId,
    )[0]!;
    expect(reopened.counts).toEqual(first.counts);
    expect(f.backup.count).toBe(1);
    expect(f.db.prepare('SELECT tag, quantity, row_version FROM project_luminaires').get()).toEqual(
      {
        tag: 'DL01',
        quantity: 2.5,
        row_version: 1,
      },
    );
    expect(
      (f.db.prepare('SELECT COUNT(*) AS count FROM canonical_revisions').get() as { count: number })
        .count,
    ).toBe(0);
  });

  it('materializes a blank-preserving sparse update and increments row version exactly once', async () => {
    const f = fixture([
      value('TAG', 'DL01'),
      value('LOCATION', 'Main Lobby'),
      value('DESCRIPTION', null),
    ]);
    const writes = new ProjectLuminaireWriteStore(f.db, () => NOW);
    const existing = writes.create(PROJECT_ID, {
      tag: 'Dl01',
      category: '',
      imagePath: '',
      description: 'Preserve me',
      manufacturer: '',
      model: '',
      productType: '',
      variantLabel: '',
      orderingCode: '',
      wattage: '',
      lumens: '',
      lightColor: '',
      cri: '',
      beamAngle: '',
      ipRating: '',
      mounting: '',
      cutout: '',
      driver: '',
      control: '',
      emergency: '',
      datasheetPath: '',
      location: 'Lobby',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_UPDATE_EXISTING' },
    });
    session = f.store.get(session.importSessionId);
    await f.apply.apply(
      session.importSessionId,
      {
        expectedSessionRevision: session.sessionRevision,
        previewFingerprint: f.preview,
        destinationFingerprint: session.destinationFingerprint!,
        applyPlanFingerprint: session.applyPlanFingerprint!,
        idempotencyKey: 'p5b-update-idempotency',
        mode: 'ALL',
        confirmPartial: false,
      },
      actor,
    );
    expect(writes.get(PROJECT_ID, existing.id)).toMatchObject({
      tag: 'DL01',
      location: 'Main Lobby',
      description: 'Preserve me',
      rowVersion: 2,
    });
  });

  it('fails stale before backup or mutation', async () => {
    const f = fixture([value('TAG', 'DL01'), value('LOCATION', 'Main Lobby')]);
    const writes = new ProjectLuminaireWriteStore(f.db, () => NOW);
    const existing = writes.create(PROJECT_ID, {
      tag: 'DL01',
      category: '',
      imagePath: '',
      description: '',
      manufacturer: '',
      model: '',
      wattage: '',
      lumens: '',
      lightColor: '',
      cri: '',
      beamAngle: '',
      ipRating: '',
      mounting: '',
      cutout: '',
      driver: '',
      control: '',
      emergency: '',
      datasheetPath: '',
      location: 'Lobby',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_UPDATE_EXISTING' },
    });
    session = f.store.get(session.importSessionId);
    writes.patch(
      PROJECT_ID,
      existing.id,
      1,
      'DL01',
      [{ field: 'notes', before: '', after: 'Concurrent edit' }],
      false,
    );
    await expect(
      f.apply.apply(
        session.importSessionId,
        {
          expectedSessionRevision: session.sessionRevision,
          previewFingerprint: f.preview,
          destinationFingerprint: session.destinationFingerprint!,
          applyPlanFingerprint: session.applyPlanFingerprint!,
          idempotencyKey: 'p5b-stale-idempotency',
          mode: 'ALL',
          confirmPartial: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_TARGET_CHANGED' });
    expect(f.backup.count).toBe(0);
  });

  it('defaults exact Library reconciliation to latest but applies an explicitly selected older Version UUID', async () => {
    const f = fixture([
      value('TAG', ' lib01 '),
      value('MANUFACTURER', 'ERCO'),
      value('ORDERING_CODE', 'LS-12'),
      value('LOCATION', 'Reception'),
    ]);
    const manufacturer = f.libraryStore.createManufacturer(
      { name: 'ERCO', idempotencyKey: 'p5b-maker' },
      actor,
    );
    const product = f.libraryStore.createProduct(
      {
        manufacturerId: manufacturer.manufacturerId,
        name: 'Lightscan',
        productType: 'Spotlight',
        description: 'Published product',
        idempotencyKey: 'p5b-product',
      },
      actor,
    );
    const base = {
      variantLabel: '12W 3000K',
      orderingCode: 'LS-12',
      wattage: '12W',
      lumens: '1000 lm',
      lightColor: '3000K',
      cri: 'CRI90',
      beamAngle: '24°',
      ipRating: 'IP20',
      mounting: 'Track',
      cutout: '',
      driver: 'Integral',
      control: 'DALI',
      emergency: 'No',
      dimensions: '',
      bodyColorFinish: 'White',
    };
    const variant = f.libraryStore.createVariant(
      product.productId,
      {
        ...base,
        idempotencyKey: 'p5b-variant',
      },
      actor,
    );
    const v1 = f.libraryStore.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: variant.rowVersion,
        idempotencyKey: 'p5b-publish-v1',
      },
      actor,
    ).version;
    const edited = f.libraryStore.updateVariant(
      variant.variantId,
      {
        ...base,
        wattage: '14W',
        expectedRowVersion: variant.rowVersion,
      },
      actor,
    );
    const v2 = f.libraryStore.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: edited.rowVersion,
        idempotencyKey: 'p5b-publish-v2',
      },
      actor,
    ).version;
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    let row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    expect(row.reconciliation).toMatchObject({
      selectedLibraryVersionId: v2.versionId,
      exactLibraryMatch: { versionId: v2.versionId, isLatest: true },
    });
    expect(row.reconciliation?.schemaVersion).toBe(1);
    if (!row.reconciliation || row.reconciliation.schemaVersion !== 1)
      throw new Error('Expected Project reconciliation.');
    expect(row.reconciliation.availableLibraryVersions.map((item) => item.versionId)).toEqual([
      v2.versionId,
      v1.versionId,
    ]);
    row = f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_ADD_FROM_LIBRARY', versionId: v1.versionId },
    });
    expect(row.intendedAction).toMatchObject({
      type: 'PROJECT_ADD_FROM_LIBRARY',
      versionId: v1.versionId,
      olderPublishedVersion: true,
    });
    session = f.store.get(session.importSessionId);
    const request = {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: f.preview,
      destinationFingerprint: session.destinationFingerprint!,
      applyPlanFingerprint: session.applyPlanFingerprint!,
      idempotencyKey: 'p5b-library-add',
      mode: 'ALL',
      confirmPartial: false,
    } as const;
    if (!row.intendedAction || row.intendedAction.type !== 'PROJECT_ADD_FROM_LIBRARY')
      throw new Error('Expected Library action');
    await f.library.addProjectLuminaire(
      PROJECT_ID,
      {
        versionId: row.intendedAction.versionId,
        tag: row.intendedAction.canonicalTag,
        category: row.intendedAction.project.category,
        location: row.intendedAction.project.location,
        unit: row.intendedAction.project.unit,
        quantity: row.intendedAction.project.quantity,
        notes: row.intendedAction.project.notes,
        descriptionOverride: row.intendedAction.project.descriptionOverride || null,
        idempotencyKey: `import:${session.importSessionId}:${row.importRowId}:${session.applyPlanFingerprint}`,
      },
      actor,
    );
    const interruptedAttemptId = '60000000-0000-4000-8000-000000000001';
    f.db
      .prepare(
        `INSERT INTO import_apply_attempts
       (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
        preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, backup_id, state,
        total_count, counts_json, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'opaque-precrash-backup', 'ABANDONED', 1, ?, ?, ?, ?)`,
      )
      .run(
        interruptedAttemptId,
        session.importSessionId,
        request.idempotencyKey,
        request.expectedSessionRevision,
        request.previewFingerprint,
        request.applyPlanFingerprint,
        request.destinationFingerprint,
        JSON.stringify({
          createProjectOnly: 0,
          updateProjectOnly: 0,
          updateLinkedProjectFields: 0,
          addFromLibrary: 1,
          skip: 0,
          blocked: 0,
          unresolved: 0,
          readyMutations: 1,
          applied: 0,
          failed: 0,
        }),
        NOW.toISOString(),
        NOW.toISOString(),
        NOW.toISOString(),
      );
    f.db
      .prepare("UPDATE import_rows SET apply_state = 'PENDING' WHERE import_row_id = ?")
      .run(row.importRowId);
    const repaired = await f.apply.apply(session.importSessionId, request, actor);
    expect(repaired).toMatchObject({
      applyAttemptId: interruptedAttemptId,
      state: 'SUCCEEDED',
      counts: { applied: 1 },
    });
    expect(
      f.db
        .prepare(
          `SELECT pl.tag, pl.row_version, b.selected_version_id
       FROM project_luminaires pl JOIN project_luminaire_library_bindings b ON b.luminaire_id = pl.id`,
        )
        .get(),
    ).toEqual({ tag: 'LIB01', row_version: 1, selected_version_id: v1.versionId });
    expect(
      (f.db.prepare('SELECT COUNT(*) AS count FROM project_luminaires').get() as { count: number })
        .count,
    ).toBe(1);
  });

  it('preserves blocking inspection validation and requires explicit ready-only Apply', async () => {
    const secondId = '40000000-0000-4000-8000-000000000002';
    const f = fixture(
      [value('TAG', 'DL01'), value('LOCATION', 'Lobby')],
      [
        {
          importRowId: secondId,
          sourceRowNumber: 3,
          sourceRowFingerprint: 'f'.repeat(64),
          evidence: [value('TAG', 'DL02'), value('QUANTITY', -1)],
          validationReasons: [
            {
              code: 'INVALID_QUANTITY',
              severity: 'BLOCKING',
              layer: 'DOMAIN',
              field: 'QUANTITY',
              message: 'Quantity must be zero or greater.',
            },
          ],
        },
      ],
    );
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const rows = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' }).items;
    expect(rows.find((row) => row.importRowId === secondId)).toMatchObject({
      rowStatus: 'BLOCKED',
    });
    const ready = rows.find((row) => row.importRowId !== secondId)!;
    f.reconciliation.setAction(session.importSessionId, ready.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: ready.rowVersion,
      action: { type: 'PROJECT_CREATE_ONLY' },
    });
    session = f.store.get(session.importSessionId);
    const authority = {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: f.preview,
      destinationFingerprint: session.destinationFingerprint!,
      applyPlanFingerprint: session.applyPlanFingerprint!,
      idempotencyKey: 'p5b-partial-authority',
    };
    await expect(
      f.apply.apply(
        session.importSessionId,
        {
          ...authority,
          mode: 'ALL',
          confirmPartial: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_PARTIAL_CONFIRMATION_REQUIRED' });
    expect(f.backup.count).toBe(0);
    const result = await f.apply.apply(
      session.importSessionId,
      {
        ...authority,
        mode: 'READY_ONLY',
        confirmPartial: true,
      },
      actor,
    );
    expect(result).toMatchObject({
      state: 'SUCCEEDED',
      counts: {
        applied: 1,
        blocked: 1,
        created: 1,
        failed: 0,
        remainingBlocked: 1,
        remainingUnresolved: 0,
      },
    });
    expect(f.backup.count).toBe(1);
    expect(
      (f.db.prepare('SELECT COUNT(*) AS count FROM project_luminaires').get() as { count: number })
        .count,
    ).toBe(1);
    expect(f.store.row(session.importSessionId, secondId)).toMatchObject({
      applyState: 'NOT_APPLIED',
      rowStatus: 'BLOCKED',
    });
  });

  it('abandons interrupted attempts on startup while preserving replay authority', () => {
    const f = fixture([value('TAG', 'DL01')]);
    const session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    f.db
      .prepare(
        `INSERT INTO import_apply_attempts
       (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
        preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, state,
        total_count, counts_json, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 1, '{}', ?, ?)`,
      )
      .run(
        '50000000-0000-4000-8000-000000000001',
        session.importSessionId,
        'interrupted-key',
        session.sessionRevision,
        f.preview,
        '1'.repeat(64),
        '2'.repeat(64),
        NOW.toISOString(),
        NOW.toISOString(),
      );
    f.db
      .prepare("UPDATE import_rows SET apply_state = 'PENDING' WHERE import_row_id = ?")
      .run(row.importRowId);
    new ImportApplyService(f.store, f.library, f.backup, () => NOW);
    expect(
      f.db
        .prepare('SELECT state FROM import_apply_attempts WHERE idempotency_key = ?')
        .get('interrupted-key'),
    ).toEqual({ state: 'ABANDONED' });
    expect(f.store.row(session.importSessionId, row.importRowId)).toMatchObject({
      applyState: 'PENDING',
      rowStatus: 'READY',
      reconciliation: null,
      intendedAction: null,
    });
    expect(f.store.get(session.importSessionId).sessionRevision).toBe(session.sessionRevision);
  });

  it('rejects a different idempotency key while an actual Apply request holds the active SQLite lock', async () => {
    const f = fixture([value('TAG', 'DL01')]);
    let session = f.store.list(actor.id, { page: 0, limit: 10 }).items[0]!;
    session = f.reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: f.preview,
    });
    const row = f.store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' })
      .items[0]!;
    f.reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_CREATE_ONLY' },
    });
    session = f.store.get(session.importSessionId);
    const deferred = new DeferredBackupStub();
    const service = new ImportApplyService(f.store, f.library, deferred, () => NOW);
    const authority = {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: f.preview,
      destinationFingerprint: session.destinationFingerprint!,
      applyPlanFingerprint: session.applyPlanFingerprint!,
      mode: 'ALL' as const,
      confirmPartial: false,
    };
    const first = service.apply(
      session.importSessionId,
      { ...authority, idempotencyKey: 'concurrent-first' },
      actor,
    );
    await deferred.started;
    await expect(
      service.apply(
        session.importSessionId,
        {
          ...authority,
          idempotencyKey: 'concurrent-second',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_APPLY_ALREADY_RUNNING' });
    deferred.resume();
    await expect(first).resolves.toMatchObject({ state: 'SUCCEEDED' });
  });
});
