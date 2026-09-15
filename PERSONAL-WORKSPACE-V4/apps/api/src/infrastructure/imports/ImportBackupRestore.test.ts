import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppUser } from '@scli/domain';
import { BackupManager } from '../backup/BackupManager';
import { ProductionWorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService';
import { RestoreManager } from '../backup/RestoreManager';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from '../luminaire-library/LuminaireLibraryService';
import { LuminaireLibraryStore } from '../luminaire-library/LuminaireLibraryStore';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { PathResolverService } from '../path/PathResolverService';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore';
import { ImportInspectionService } from './ImportInspectionService';
import { ImportApplyService } from './ImportApplyService';
import { ImportReconciliationService } from './ImportReconciliationService';
import { ImportSessionStore } from './ImportSessionStore';
import { ImportSourceAdmission } from './ImportSourceAdmission';

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

describe('Smart Import canonical backup and restore', () => {
  it('reopens the persisted inspection after verified restore without source bytes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p5b-import-backup-'));
    roots.push(root);
    const dataRoot = path.join(root, 'data');
    const backupRoot = path.join(dataRoot, 'backups');
    const sourcePath = path.join(dataRoot, 'workspace.sqlite');
    mkdirSync(dataRoot, { recursive: true });
    const source = new DatabaseSync(sourcePath);
    source.exec('PRAGMA foreign_keys = ON');
    for (const migration of PRODUCTION_MIGRATIONS) {
      source.exec(
        migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
          ? 'PRAGMA foreign_keys = OFF'
          : 'PRAGMA foreign_keys = ON',
      );
      source.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
      migration.up({
        database: source,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
      });
      source.exec('COMMIT');
      source.exec('PRAGMA foreign_keys = ON');
    }
    source.exec('PRAGMA user_version = 25');
    const store = new ImportSessionStore(source, () => new Date('2026-08-27T00:00:00.000Z'));
    const admission = new ImportSourceAdmission(dataRoot);
    const service = new ImportInspectionService(store, admission);
    const created = service.create({ destinationMode: 'MASTER_LIBRARY', projectId: null }, actor);
    const inspected = await service.inspectBuffer(
      created.importSessionId,
      'library.csv',
      Buffer.from('Manufacturer,Product Family,Wattage [W]\nERCO,Lightscan,12'),
    );
    expect(inspected.counts.total).toBe(1);
    source
      .prepare(`UPDATE import_sessions SET apply_plan_fingerprint = ? WHERE import_session_id = ?`)
      .run('1'.repeat(64), created.importSessionId);
    source
      .prepare(
        `INSERT INTO import_apply_attempts
       (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
        preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, backup_id,
        state, total_count, applied_count, failed_count, counts_json, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', 1, 1, 0, ?, ?, ?, ?)`,
      )
      .run(
        '50000000-0000-4000-8000-000000000001',
        created.importSessionId,
        'restore-idempotency',
        inspected.sessionRevision,
        inspected.previewFingerprint,
        '1'.repeat(64),
        '2'.repeat(64),
        'opaque-backup-id',
        JSON.stringify({ applied: 1, failed: 0 }),
        '2026-08-27T00:30:00.000Z',
        '2026-08-27T00:31:00.000Z',
        '2026-08-27T00:31:00.000Z',
      );
    const projectWrites = new ProjectLuminaireWriteStore(
      source,
      () => new Date('2026-08-27T00:20:00.000Z'),
    );
    const preApply = projectWrites.create('70000000-0000-4000-8000-000000000001', {
      tag: 'PRE01',
      category: '',
      imagePath: '',
      description: 'Before Apply',
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
      location: 'Before',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });

    const pathResolver = new PathResolverService(dataRoot);
    const manager = new BackupManager({
      sourceDb: source,
      sourceDatabasePath: sourcePath,
      backupRoot,
      pathResolver,
      clock: { now: () => new Date('2026-08-27T01:00:00.000Z') },
      idGenerator: { generate: () => 'bk-p5b-import-0001' },
      appVersion: '3.2.2',
      verificationPolicy: {
        requiredTables: [
          'import_sessions',
          'import_source_tables',
          'import_rows',
          'import_apply_attempts',
        ],
      },
    });
    const backup = await manager.createVerifiedBackup({ reason: 'P5B_IMPORT_TEST' });
    projectWrites.patch(
      '70000000-0000-4000-8000-000000000001',
      preApply.id,
      1,
      'PRE01',
      [{ field: 'location', before: 'Before', after: 'After Apply' }],
      false,
    );
    expect(projectWrites.get('70000000-0000-4000-8000-000000000001', preApply.id)).toMatchObject({
      location: 'After Apply',
      rowVersion: 2,
    });
    source.close();

    const targetPath = path.join(dataRoot, 'restored.sqlite');
    writeFileSync(targetPath, 'placeholder');
    const restore = new RestoreManager({
      backupRoot,
      pathResolver,
      verifier: manager,
      stagingNameGenerator: { generate: () => 'p5b-import-restore' },
    });
    await restore.restore({ targetDatabasePath: targetPath, backupId: backup.backupId });

    const restored = new DatabaseSync(targetPath, { readOnly: true });
    try {
      const restoredStore = new ImportSessionStore(restored);
      const reopened = restoredStore.get(created.importSessionId);
      const rows = restoredStore.rows(created.importSessionId, {
        page: 0,
        limit: 50,
        filter: 'ALL',
      });
      expect(reopened).toMatchObject({
        sourceSha256: inspected.sourceSha256,
        previewFingerprint: inspected.previewFingerprint,
        counts: inspected.counts,
      });
      expect(restoredStore.tables(created.importSessionId)[0]).toMatchObject({
        mapping: expect.any(Array),
      });
      expect(rows.items[0]).toMatchObject({
        rawCells: expect.any(Array),
        normalizationEvidence: expect.any(Array),
        validationReasons: expect.any(Array),
      });
      expect(restoredStore.list(actor.id, { page: 0, limit: 30 }).items[0]?.importSessionId).toBe(
        created.importSessionId,
      );
      expect(restoredStore.get(created.importSessionId).applyPlanFingerprint).toBe('1'.repeat(64));
      expect(
        restored
          .prepare(
            `SELECT apply_plan_fingerprint, destination_fingerprint, backup_id, state, updated_at
         FROM import_apply_attempts WHERE idempotency_key = ?`,
          )
          .get('restore-idempotency'),
      ).toEqual({
        apply_plan_fingerprint: '1'.repeat(64),
        destination_fingerprint: '2'.repeat(64),
        backup_id: 'opaque-backup-id',
        state: 'SUCCEEDED',
        updated_at: '2026-08-27T00:31:00.000Z',
      });
      expect(
        restored
          .prepare('SELECT location, row_version FROM project_luminaires WHERE id = ?')
          .get(preApply.id),
      ).toEqual({ location: 'Before', row_version: 1 });
    } finally {
      restored.close();
    }
  });

  it('restores the pre-Apply database and managed roots after a Library-backed Project add', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p5b-library-asset-restore-'));
    roots.push(root);
    const dataRoot = path.join(root, 'data');
    const sourcePath = path.join(dataRoot, 'workspace.sqlite');
    const backupRoot = path.join(dataRoot, 'backups');
    const libraryRoot = path.join(dataRoot, 'luminaire-library', 'assets');
    const projectRoot = path.join(dataRoot, 'project-luminaire-assets');
    mkdirSync(projectRoot, { recursive: true });
    const source = new DatabaseSync(sourcePath);
    source.exec('PRAGMA foreign_keys = ON');
    for (const migration of PRODUCTION_MIGRATIONS) {
      source.exec(
        migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
          ? 'PRAGMA foreign_keys = OFF'
          : 'PRAGMA foreign_keys = ON',
      );
      source.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
      migration.up({
        database: source,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock: { now: () => new Date('2026-08-27T02:00:00.000Z') },
      });
      source.exec('COMMIT');
      source.exec('PRAGMA foreign_keys = ON');
    }
    source.exec('PRAGMA user_version = 25');

    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    const libraryStore = new LuminaireLibraryStore(
      source,
      () => new Date('2026-08-27T02:00:00.000Z'),
    );
    const library = new LuminaireLibraryService(
      libraryStore,
      storage,
      () => new Date('2026-08-27T02:00:00.000Z'),
    );
    const manufacturer = libraryStore.createManufacturer(
      { name: 'ERCO', idempotencyKey: 'restore-maker' },
      actor,
    );
    const product = libraryStore.createProduct(
      {
        manufacturerId: manufacturer.manufacturerId,
        name: 'Lightscan',
        productType: 'Spotlight',
        description: 'Managed restore fixture',
        idempotencyKey: 'restore-product',
      },
      actor,
    );
    const variant = libraryStore.createVariant(
      product.productId,
      {
        variantLabel: '12W 3000K',
        orderingCode: 'LS-RESTORE',
        wattage: '12W',
        lumens: '1000 lm',
        lightColor: '3000K',
        cri: 'CRI90',
        beamAngle: '24 degrees',
        ipRating: 'IP20',
        mounting: 'Track',
        cutout: '',
        driver: 'Integral',
        control: 'DALI',
        emergency: 'No',
        dimensions: '',
        bodyColorFinish: 'White',
        idempotencyKey: 'restore-variant',
      },
      actor,
    );
    const incomingAsset = path.join(dataRoot, 'incoming-lightscan.ies');
    const assetBytes = 'IESNA:LM-63 managed restore fixture';
    writeFileSync(incomingAsset, assetBytes);
    const logicalAsset = libraryStore.createAsset(
      {
        productId: product.productId,
        variantId: variant.variantId,
        assetType: 'IES',
        label: 'Photometry',
        idempotencyKey: 'restore-asset',
      },
      actor,
    );
    await library.admitAssetVersion(
      logicalAsset.assetId,
      {
        sourceFilePath: incomingAsset,
        expectedLatestSequence: 0,
        idempotencyKey: 'restore-asset-version',
      },
      actor,
    );
    const published = libraryStore.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: variant.rowVersion,
        idempotencyKey: 'restore-publish',
      },
      actor,
    ).version;

    const projectId = '70000000-0000-4000-8000-000000000002';
    const store = new ImportSessionStore(source, () => new Date('2026-08-27T02:00:00.000Z'));
    let session = store.create({ destinationMode: 'PROJECT', projectId }, actor);
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
    session = store.persistInspection(session.importSessionId, {
      sourceFileName: 'library-add.csv',
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 80,
      sourceExtension: '.csv',
      detectedAdapterId: 'GENERIC_CSV',
      detectedAdapterVersion: '1',
      detection: {},
      destinationFingerprint: 'b'.repeat(64),
      previewFingerprint: 'c'.repeat(64),
      status: 'READY_FOR_REVIEW',
      tables: [
        {
          sourceTableId: '71000000-0000-4000-8000-000000000001',
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
              importRowId: '72000000-0000-4000-8000-000000000001',
              sourceRowNumber: 2,
              sourceRowKey: '2:key',
              sourceRowFingerprint: 'e'.repeat(64),
              rawCells: [],
              mappedCandidate: {},
              normalizationEvidence: [
                evidence('TAG', 'LIB-R01'),
                evidence('MANUFACTURER', 'ERCO'),
                evidence('ORDERING_CODE', 'LS-RESTORE'),
                evidence('LOCATION', 'Gallery'),
                evidence('QUANTITY', 2),
              ],
              validationReasons: [],
              rowStatus: 'READY',
            },
          ],
        },
      ],
    });
    const reconciliation = new ImportReconciliationService(
      store,
      () => new Date('2026-08-27T02:00:00.000Z'),
    );
    session = reconciliation.reconcile(session.importSessionId, {
      expectedSessionRevision: session.sessionRevision,
      expectedPreviewFingerprint: session.previewFingerprint!,
    });
    let row = store.rows(session.importSessionId, { page: 0, limit: 50, filter: 'ALL' }).items[0]!;
    expect(
      row.reconciliation?.schemaVersion === 1
        ? row.reconciliation.exactLibraryMatch?.versionId
        : null,
    ).toBe(published.versionId);
    row = reconciliation.setAction(session.importSessionId, row.importRowId, {
      expectedSessionRevision: session.sessionRevision,
      expectedRowVersion: row.rowVersion,
      action: { type: 'PROJECT_ADD_FROM_LIBRARY', versionId: published.versionId },
    });
    session = store.get(session.importSessionId);

    const managedAssetRoots = [
      { key: 'luminaire-library', absolutePath: libraryRoot },
      { key: 'project-luminaire-assets', absolutePath: projectRoot },
    ] as const;
    const manager = new BackupManager({
      sourceDb: source,
      sourceDatabasePath: sourcePath,
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: () => new Date('2026-08-27T02:10:00.000Z') },
      idGenerator: { generate: () => 'bk-p5b-library-asset-restore' },
      appVersion: '3.2.2',
      verificationPolicy: {
        requiredTables: [
          'project_luminaires',
          'project_luminaire_library_bindings',
          'luminaire_asset_versions',
          'import_apply_attempts',
        ],
      },
      managedAssetRoots,
    });
    const backups = new ProductionWorkspaceBackupService(
      manager,
      backupRoot,
      path.join(dataRoot, 'restore-pending.json'),
    );
    const apply = new ImportApplyService(
      store,
      library,
      backups,
      () => new Date('2026-08-27T02:10:00.000Z'),
    );
    const result = await apply.apply(
      session.importSessionId,
      {
        expectedSessionRevision: session.sessionRevision,
        previewFingerprint: session.previewFingerprint!,
        destinationFingerprint: session.destinationFingerprint!,
        applyPlanFingerprint: session.applyPlanFingerprint!,
        idempotencyKey: 'library-managed-restore-apply',
        mode: 'ALL',
        confirmPartial: false,
      },
      actor,
    );
    expect(result).toMatchObject({
      state: 'SUCCEEDED',
      backupId: 'bk-p5b-library-asset-restore',
      counts: { addedFromLibrary: 1 },
    });
    const applied = source
      .prepare(
        `SELECT pl.id, b.selected_version_id, av.file_path, av.file_hash
           FROM project_luminaires pl
           JOIN project_luminaire_library_bindings b ON b.luminaire_id = pl.id
           JOIN luminaire_asset_versions av ON av.luminaire_id = pl.id
          WHERE pl.project_id = ?`,
      )
      .get(projectId) as {
      id: string;
      selected_version_id: string;
      file_path: string;
      file_hash: string;
    };
    expect(applied.selected_version_id).toBe(published.versionId);
    expect(existsSync(applied.file_path)).toBe(true);
    expect(readFileSync(applied.file_path, 'utf8')).toBe(assetBytes);
    expect(applied.file_hash).toBe(createHash('sha256').update(assetBytes).digest('hex'));
    source.close();

    const restoredPath = path.join(dataRoot, 'restored-before-apply.sqlite');
    writeFileSync(restoredPath, 'placeholder');
    const restore = new RestoreManager({
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      verifier: manager,
      stagingNameGenerator: { generate: () => 'p5b-library-asset-restore' },
      managedAssetRoots,
    });
    const restoredResult = await restore.restore({
      targetDatabasePath: restoredPath,
      backupId: result.backupId!,
    });
    expect(restoredResult).toMatchObject({ status: 'RESTORED', verificationPassed: true });
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      expect(
        restored
          .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
          .get(projectId),
      ).toEqual({ count: 0 });
      expect(
        restored.prepare('SELECT COUNT(*) AS count FROM project_luminaire_library_bindings').get(),
      ).toEqual({ count: 0 });
      expect(
        restored.prepare('SELECT COUNT(*) AS count FROM luminaire_asset_versions').get(),
      ).toEqual({ count: 0 });
    } finally {
      restored.close();
    }
    const restoredProjectFiles = existsSync(projectRoot)
      ? readdirSync(projectRoot, { recursive: true, withFileTypes: true }).filter((entry) =>
          entry.isFile(),
        )
      : [];
    expect(restoredProjectFiles).toHaveLength(0);
    const restoredLibraryFiles = readdirSync(libraryRoot, {
      recursive: true,
      withFileTypes: true,
    }).filter((entry) => entry.isFile());
    expect(restoredLibraryFiles).toHaveLength(1);
    const restoredLibraryPath = path.join(
      restoredLibraryFiles[0]!.parentPath,
      restoredLibraryFiles[0]!.name,
    );
    expect(createHash('sha256').update(readFileSync(restoredLibraryPath)).digest('hex')).toBe(
      createHash('sha256').update(assetBytes).digest('hex'),
    );
  });
});
