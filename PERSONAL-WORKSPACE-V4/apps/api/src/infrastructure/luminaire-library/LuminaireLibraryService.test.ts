import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppUser, LuminaireLibraryAssetType } from '@scli/domain';
import { luminaireLibraryListQuerySchema } from '@scli/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore';
import { LuminaireLibraryAssetStorage } from './LuminaireLibraryAssetStorage';
import { LuminaireLibraryService } from './LuminaireLibraryService';
import { LuminaireLibraryStore } from './LuminaireLibraryStore';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const actor: AppUser = {
  id: '90000000-0000-4000-8000-000000000001',
  entraObjectId: '90000000-0000-4000-8000-000000000001',
  displayName: 'Library Manager',
  email: 'manager@example.test',
  jobTitle: 'Manager',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function databaseV22(filePath = ':memory:'): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY, from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL, description TEXT NOT NULL, app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, validation_result TEXT NOT NULL CHECK(validation_result = 'passed'),
      UNIQUE(from_version), UNIQUE(to_version), CHECK(duration_ms >= 0)
    )`);
  const clock = { now: () => new Date('2026-08-25T00:00:00.000Z') };
  for (const migration of PRODUCTION_MIGRATIONS) {
    database.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
    database.exec('BEGIN IMMEDIATE');
    try {
      const context = {
        database,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock,
      };
      migration.up(context);
      migration.validate?.(context);
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  database.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY)');
  return database;
}

const draft = {
  variantLabel: '12W / 3000K / 24 degrees / White / DALI',
  orderingCode: 'LS-12-30-24-W-D',
  wattage: '12W',
  lumens: '1050 lm',
  lightColor: '3000K',
  cri: 'CRI90',
  beamAngle: '24 degrees',
  ipRating: 'IP20',
  mounting: 'Track',
  cutout: '',
  driver: 'Integral',
  control: 'DALI',
  emergency: 'No',
  dimensions: '100 x 200 mm',
  bodyColorFinish: 'White',
};

function insertProjectOnlyLuminaire(
  database: DatabaseSync,
  projectId: string,
  luminaireId: string,
): void {
  database.prepare('INSERT INTO projects (id) VALUES (?)').run(projectId);
  database
    .prepare(
      `INSERT INTO project_luminaires
       (id, project_id, tag, category, image_path, description, manufacturer, model,
        product_type, variant_label, ordering_code, wattage, lumens, light_color, cri,
        beam_angle, ip_rating, mounting, cutout, driver, control, emergency, datasheet_path,
        location, unit, quantity, notes, source_name, dimensions, body_color_finish,
        created_at, updated_at)
       VALUES (${Array.from({ length: 32 }, () => '?').join(', ')})`,
    )
    .run(
      luminaireId,
      projectId,
      'C-UAT-01',
      'Decorative',
      '',
      'Reusable bespoke pendant baseline',
      'Project-only Maker',
      'Bespoke Pendant',
      '',
      '',
      'BP-12-930-DALI',
      '12W',
      '1050 lm',
      '3000K',
      'CRI90',
      '24°',
      'IP20',
      'Suspended',
      '',
      'Integral',
      'DALI',
      'No',
      '',
      'Reception feature',
      'No.',
      3,
      'Project-only aiming note',
      'Manual',
      'Ø240 x 420 mm',
      'White',
      '2026-08-26T00:00:00.000Z',
      '2026-08-26T00:00:00.000Z',
    );
}

function insertProjectAsset(
  database: DatabaseSync,
  dataRoot: string,
  projectId: string,
  luminaireId: string,
  type: LuminaireLibraryAssetType,
  fileName: string,
  bytes: string,
  storedHash?: string,
): string {
  const filePath = path.join(dataRoot, fileName);
  writeFileSync(filePath, bytes);
  const id = `asset-${type.toLocaleLowerCase('en')}`;
  const hash = storedHash ?? createHash('sha256').update(bytes).digest('hex');
  database
    .prepare(
      `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
        attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'LEGACY_PATH', ?, NULL)`,
    )
    .run(
      id,
      projectId,
      luminaireId,
      type,
      filePath,
      fileName,
      type === 'ProductImage'
        ? 'image/png'
        : type === 'Datasheet'
          ? 'application/pdf'
          : `application/${type.toLocaleLowerCase('en')}`,
      Buffer.byteLength(bytes),
      hash,
      '2026-08-26T00:00:00.000Z',
      actor.id,
      actor.displayName,
      filePath,
    );
  return filePath;
}

describe('LuminaireLibraryService disposable owner workflow', () => {
  it('rolls back earlier asset copies when the image is unavailable and allows a safe retry', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'library-unavailable-image-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const projectId = 'c0000000-0000-4000-8000-000000000001';
    const luminaireId = 'c1000000-0000-4000-8000-000000000001';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    insertProjectAsset(
      database,
      dataRoot,
      projectId,
      luminaireId,
      'Datasheet',
      'sheet.pdf',
      'pdf bytes',
    );
    const imagePath = insertProjectAsset(
      database,
      dataRoot,
      projectId,
      luminaireId,
      'ProductImage',
      'image.png',
      'image bytes',
    );
    rmSync(imagePath);
    const before = database
      .prepare('SELECT * FROM project_luminaires WHERE id = ?')
      .get(luminaireId);
    const service = new LuminaireLibraryService(
      new LuminaireLibraryStore(database),
      new LuminaireLibraryAssetStorage(dataRoot),
    );
    const candidate = service.draftCandidate(projectId, luminaireId);
    const input = {
      manufacturer: { mode: 'CREATE_NEW' as const, name: candidate.source.manufacturerName },
      product: {
        mode: 'CREATE_NEW' as const,
        name: candidate.source.productName,
        productType: 'Pendant',
        description: candidate.source.description,
        duplicateDecision: 'NO_MATCHES' as const,
      },
      variant: candidate.source.variant,
      idempotencyKey: 'retry-unavailable-image',
    };
    await expect(
      service.createDraftFromProjectLuminaire(projectId, luminaireId, input, actor),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Product image could not be read.'),
    });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants').get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_library_asset_versions').get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare('SELECT * FROM project_luminaires WHERE id = ?').get(luminaireId),
    ).toEqual(before);
    expect(readdirSync(path.join(dataRoot, 'luminaire-library', 'assets'))).toEqual([]);
    writeFileSync(imagePath, 'image bytes');
    const result = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      input,
      actor,
    );
    expect(result.assets).toHaveLength(2);
    const replay = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      input,
      actor,
    );
    expect(replay.variant.variantId).toBe(result.variant.variantId);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_library_variants').get(),
    ).toEqual({ count: 1 });
    database.close();
  });
  it('publishes immutable versions, copies four asset types, and updates only one Project explicitly', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-library-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const store = new LuminaireLibraryStore(database, () => new Date('2026-08-25T00:00:00.000Z'));
    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    const service = new LuminaireLibraryService(
      store,
      storage,
      () => new Date('2026-08-25T00:00:00.000Z'),
    );

    const manufacturer = store.createManufacturer(
      { name: 'ERCO', idempotencyKey: 'maker-create-1' },
      actor,
    );
    expect(
      store.createManufacturer({ name: 'Ignored retry', idempotencyKey: 'maker-create-1' }, actor)
        .manufacturerId,
    ).toBe(manufacturer.manufacturerId);
    const product = store.createProduct(
      {
        manufacturerId: manufacturer.manufacturerId,
        name: 'Lightscan',
        productType: 'Spotlight',
        description: 'Track spotlight baseline',
        idempotencyKey: 'product-create-1',
      },
      actor,
    );
    const variant = store.createVariant(
      product.productId,
      { ...draft, idempotencyKey: 'variant-create-1' },
      actor,
    );

    const assetCases: Array<[LuminaireLibraryAssetType, string, string]> = [
      ['ProductImage', 'lightscan.png', 'PNG bytes'],
      ['Datasheet', 'lightscan.pdf', 'PDF bytes'],
      ['IES', 'lightscan.ies', 'IES bytes'],
      ['LDT', 'lightscan.ldt', 'LDT bytes'],
    ];
    for (const [type, filename, bytes] of assetCases) {
      const source = path.join(dataRoot, filename);
      writeFileSync(source, bytes);
      const logical = store.createAsset(
        {
          productId: product.productId,
          variantId: type === 'IES' || type === 'LDT' ? variant.variantId : null,
          assetType: type,
          label: `${type} current`,
          idempotencyKey: `asset-${type}-create`,
        },
        actor,
      );
      const admitted = await service.admitAssetVersion(
        logical.assetId,
        {
          sourceFilePath: source,
          expectedLatestSequence: 0,
          idempotencyKey: `asset-${type}-version-1`,
        },
        actor,
      );
      expect(readFileSync(storage.resolveLocator(admitted.locatorValue), 'utf8')).toBe(bytes);
      const opened = await service.assetContent(admitted.assetVersionId, dataRoot);
      expect(opened.bytes.toString('utf8')).toBe(bytes);
      expect(opened.fileName).toBe(filename);
    }

    const v1 = store.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: variant.rowVersion,
        idempotencyKey: 'publish-version-1',
      },
      actor,
    );
    expect(v1.status).toBe('PUBLISHED');
    expect(v1.version.versionSequence).toBe(1);
    expect(v1.version.snapshot.assetVersionIds).toHaveLength(4);
    const noChange = store.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: variant.rowVersion,
        idempotencyKey: 'publish-version-no-change',
      },
      actor,
    );
    expect(noChange).toMatchObject({ status: 'NO_CHANGE' });
    expect(noChange.version.versionId).toBe(v1.version.versionId);

    const projectA = 'a0000000-0000-4000-8000-000000000001';
    const projectB = 'b0000000-0000-4000-8000-000000000001';
    database.prepare('INSERT INTO projects (id) VALUES (?), (?)').run(projectA, projectB);
    const selectionA = await service.addProjectLuminaire(
      projectA,
      {
        versionId: v1.version.versionId,
        tag: 'L1',
        category: 'Accent',
        location: 'Gallery',
        unit: 'No.',
        quantity: 6,
        notes: 'Preserve this note',
        descriptionOverride: null,
        idempotencyKey: 'select-project-a',
      },
      actor,
    );
    const selectionB = await service.addProjectLuminaire(
      projectB,
      {
        versionId: v1.version.versionId,
        tag: 'L2',
        category: 'Accent',
        location: 'Lobby',
        unit: 'No.',
        quantity: 2,
        notes: 'Project B remains old',
        descriptionOverride: null,
        idempotencyKey: 'select-project-b',
      },
      actor,
    );
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM luminaire_asset_versions WHERE luminaire_id = ?')
        .get(selectionA.luminaireId),
    ).toEqual({ count: 4 });
    const projectAsset = database
      .prepare(
        `SELECT file_path, locator_kind, source_library_asset_version_id
         FROM luminaire_asset_versions WHERE luminaire_id = ? AND asset_type = 'IES'`,
      )
      .get(selectionA.luminaireId) as {
      file_path: string;
      locator_kind: string;
      source_library_asset_version_id: string;
    };
    expect(projectAsset.locator_kind).toBe('DATA_ROOT_RELATIVE');
    expect(projectAsset.source_library_asset_version_id).toBeTruthy();
    expect(existsSync(projectAsset.file_path)).toBe(true);
    expect(readFileSync(projectAsset.file_path, 'utf8')).toBe('IES bytes');

    const revisionRegistry = new CanonicalOutputRegistryStore(
      database,
      { now: () => new Date('2026-08-25T00:00:00.000Z') },
      'CANONICAL',
    );
    const snapshotProjectLuminaire = (luminaireId: string) => {
      const item = database
        .prepare('SELECT * FROM project_luminaires WHERE id = ?')
        .get(luminaireId) as Record<string, unknown>;
      return {
        luminaireId: String(item.id),
        tag: String(item.tag),
        category: String(item.category),
        imagePath: String(item.image_path),
        description: String(item.description),
        manufacturer: String(item.manufacturer),
        model: String(item.model),
        productType: String(item.product_type),
        variantLabel: String(item.variant_label),
        orderingCode: String(item.ordering_code),
        wattage: String(item.wattage),
        lumens: String(item.lumens),
        lightColor: String(item.light_color),
        cri: String(item.cri),
        beamAngle: String(item.beam_angle),
        ipRating: String(item.ip_rating),
        mounting: String(item.mounting),
        cutout: String(item.cutout),
        driver: String(item.driver),
        control: String(item.control),
        emergency: String(item.emergency),
        datasheetPath: String(item.datasheet_path),
        location: String(item.location),
        unit: String(item.unit),
        quantity: Number(item.quantity),
        notes: String(item.notes),
        sourceName: String(item.source_name),
        dimensions: String(item.dimensions),
        bodyColorFinish: String(item.body_color_finish),
        attachmentReferences: [String(item.image_path), String(item.datasheet_path)].filter(
          Boolean,
        ),
      };
    };
    const revisionInput = (luminaireId: string) => ({
      projectId: projectA,
      projectSnapshot: {
        id: projectA,
        projectCode: 'UAT-A',
        projectName: 'Disposable Project A',
        clientName: 'Fixture Client',
        projectType: 'Lighting Design',
        status: 'Active',
        updatedAt: '2026-08-25T00:00:00.000Z',
      },
      luminaires: [snapshotProjectLuminaire(luminaireId)],
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const revisionR1 = revisionRegistry.createRevision(revisionInput(selectionA.luminaireId));
    const immutableR1 = structuredClone(revisionRegistry.getRevision(revisionR1.revisionId));

    const edited = store.updateVariant(
      variant.variantId,
      {
        ...draft,
        wattage: '14W',
        lumens: '1250 lm',
        beamAngle: '36 degrees',
        expectedRowVersion: 1,
      },
      actor,
    );
    expect(service.status(projectA, selectionA.luminaireId).status).toBe('CURRENT');
    const v2 = store.publishVariant(
      variant.variantId,
      {
        expectedProductRowVersion: product.rowVersion,
        expectedVariantRowVersion: edited.rowVersion,
        idempotencyKey: 'publish-version-2',
      },
      actor,
    );
    expect(v2.version.versionSequence).toBe(2);
    expect(service.status(projectA, selectionA.luminaireId).status).toBe('UPDATE_AVAILABLE');
    expect(service.status(projectB, selectionB.luminaireId).status).toBe('UPDATE_AVAILABLE');
    expect(service.compare(projectA, selectionA.luminaireId).fieldChanges).toEqual(
      expect.arrayContaining([{ field: 'wattage', before: '12W', after: '14W' }]),
    );

    const overridden = service.updateDescriptionOverride(
      projectA,
      selectionA.luminaireId,
      { descriptionOverride: 'Project-specific aiming note', expectedBindingRowVersion: 1 },
      actor,
    );
    await service.updateProjectLuminaire(
      projectA,
      selectionA.luminaireId,
      {
        expectedSelectedVersionId: v1.version.versionId,
        targetVersionId: v2.version.versionId,
        expectedBindingRowVersion: overridden.rowVersion,
        idempotencyKey: 'update-project-a-v2',
      },
      actor,
    );
    const rowA = database
      .prepare(
        'SELECT id, tag, category, location, unit, quantity, notes, description, wattage, lumens FROM project_luminaires WHERE id = ?',
      )
      .get(selectionA.luminaireId) as Record<string, unknown>;
    expect(rowA).toMatchObject({
      id: selectionA.luminaireId,
      tag: 'L1',
      category: 'Accent',
      location: 'Gallery',
      unit: 'No.',
      quantity: 6,
      notes: 'Preserve this note',
      description: 'Project-specific aiming note',
      wattage: '14W',
      lumens: '1250 lm',
    });
    expect(service.status(projectA, selectionA.luminaireId).status).toBe('CURRENT');
    expect(service.status(projectB, selectionB.luminaireId).selectedVersionId).toBe(
      v1.version.versionId,
    );
    const revisionR2 = revisionRegistry.createRevision(revisionInput(selectionA.luminaireId));
    expect(revisionRegistry.getRevision(revisionR1.revisionId)).toEqual(immutableR1);
    expect(immutableR1.luminaireSnapshot?.[0]).toMatchObject({ wattage: '12W', lumens: '1050 lm' });
    expect(revisionR2.luminaireSnapshot?.[0]).toMatchObject({ wattage: '14W', lumens: '1250 lm' });
    expect(revisionR2.snapshotHash).not.toBe(immutableR1.snapshotHash);
    for (const attachment of immutableR1.luminaireSnapshot?.[0]?.attachmentReferences ?? []) {
      expect(existsSync(attachment)).toBe(true);
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_revisions').get()).toEqual({
      count: 0,
    });

    store.archive('VARIANT', variant.variantId, edited.rowVersion, 'archive-variant-1', actor);
    expect(service.status(projectB, selectionB.luminaireId).status).toBe(
      'LIBRARY_VARIANT_ARCHIVED',
    );
    expect(existsSync(projectAsset.file_path)).toBe(true);
    database.close();
  });

  it('rejects unsafe asset types and leaves no managed final file after DB admission failure', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-library-safety-'));
    roots.push(dataRoot);
    const source = path.join(dataRoot, 'unsafe.exe');
    writeFileSync(source, 'unsafe');
    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    await expect(storage.admitLibraryAsset(source, 'Datasheet')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(await storage.reconcileOrphans(new Set())).toEqual([]);
  });

  it('admits a Project attachment into UUID-bound managed storage', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5c-project-asset-admission-'));
    roots.push(dataRoot);
    const source = path.join(dataRoot, 'DL01.pdf');
    writeFileSync(source, '%PDF-1.4\nfixture');
    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    const projectId = 'c0000000-0000-4000-8000-000000000001';
    const luminaireId = 'c1000000-0000-4000-8000-000000000001';
    const assetVersionId = 'c2000000-0000-4000-8000-000000000001';

    const admitted = await storage.admitProjectAsset({
      sourcePath: source,
      assetType: 'Datasheet',
      projectId,
      luminaireId,
      projectAssetVersionId: assetVersionId,
    });

    expect(admitted.assetVersionId).toBe(assetVersionId);
    expect(admitted.locatorValue).toBe(
      `project-luminaire-assets/${projectId}/${luminaireId}/${assetVersionId}/DL01.pdf`,
    );
    expect(admitted.absolutePath).toContain(
      path.join('project-luminaire-assets', projectId, luminaireId, assetVersionId),
    );
    expect(readFileSync(admitted.absolutePath, 'utf8')).toBe('%PDF-1.4\nfixture');
  });

  it('creates one retry-safe mutable Draft and preserves every Project-owned field', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-project-promotion-simple-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const projectId = 'c0000000-0000-4000-8000-000000000001';
    const luminaireId = 'c1000000-0000-4000-8000-000000000001';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    const before = database
      .prepare('SELECT * FROM project_luminaires WHERE id = ?')
      .get(luminaireId);
    const store = new LuminaireLibraryStore(database);
    const service = new LuminaireLibraryService(store, new LuminaireLibraryAssetStorage(dataRoot));
    const candidate = service.draftCandidate(projectId, luminaireId);
    expect(candidate.eligibility).toMatchObject({ eligible: true, reasonCode: 'ELIGIBLE' });
    expect(candidate.excludedProjectFields.map((item) => item.field)).toEqual([
      'tag',
      'category',
      'location',
      'unit',
      'quantity',
      'notes',
    ]);
    const input = {
      manufacturer: { mode: 'CREATE_NEW' as const, name: 'Project-only Maker' },
      product: {
        mode: 'CREATE_NEW' as const,
        name: 'Bespoke Pendant',
        productType: 'Pendant',
        description: candidate.source.description,
        duplicateDecision: 'NO_MATCHES' as const,
      },
      variant: candidate.source.variant,
      idempotencyKey: 'project-promotion-simple-1',
    };
    const created = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      input,
      actor,
    );
    const replay = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      input,
      actor,
    );
    expect(replay.variant.variantId).toBe(created.variant.variantId);
    expect(created.variant.latestPublishedVersionId).toBeNull();
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_library_versions').get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM project_luminaire_library_bindings').get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare('SELECT * FROM project_luminaires WHERE id = ?').get(luminaireId),
    ).toEqual(before);
    expect(
      database
        .prepare(
          "SELECT project_id, action, detail_json FROM luminaire_library_activity WHERE action = 'DRAFT_CREATED_FROM_PROJECT_LUMINAIRE'",
        )
        .get(),
    ).toMatchObject({ project_id: projectId, action: 'DRAFT_CREATED_FROM_PROJECT_LUMINAIRE' });
    database.close();
  });

  it('copies four Project assets with A equals B equals C and leaves source bytes independent', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-project-promotion-assets-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const projectId = 'd0000000-0000-4000-8000-000000000001';
    const luminaireId = 'd1000000-0000-4000-8000-000000000001';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    const cases: Array<[LuminaireLibraryAssetType, string, string]> = [
      ['ProductImage', 'bespoke.png', 'project image bytes'],
      ['Datasheet', 'bespoke.pdf', 'project pdf bytes'],
      ['IES', 'bespoke.ies', 'project ies bytes'],
      ['LDT', 'bespoke.ldt', 'project ldt bytes'],
    ];
    const sourcePaths = cases.map(([type, fileName, bytes]) => ({
      type,
      bytes,
      path: insertProjectAsset(database, dataRoot, projectId, luminaireId, type, fileName, bytes),
    }));
    const store = new LuminaireLibraryStore(database);
    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    const service = new LuminaireLibraryService(store, storage);
    const candidate = service.draftCandidate(projectId, luminaireId);
    const result = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      {
        manufacturer: { mode: 'CREATE_NEW', name: candidate.source.manufacturerName },
        product: {
          mode: 'CREATE_NEW',
          name: candidate.source.productName,
          productType: 'Pendant',
          description: candidate.source.description,
          duplicateDecision: 'NO_MATCHES',
        },
        variant: candidate.source.variant,
        idempotencyKey: 'project-promotion-assets-1',
      },
      actor,
    );
    expect(result.assets).toHaveLength(4);
    for (const promoted of result.assets) {
      const source = sourcePaths.find((item) => item.type === promoted.asset.assetType)!;
      const managedPath = storage.resolveLocator(promoted.version.locatorValue);
      expect(readFileSync(managedPath, 'utf8')).toBe(source.bytes);
      expect(readFileSync(source.path, 'utf8')).toBe(source.bytes);
      expect(promoted.version.contentHash).toBe(
        createHash('sha256').update(source.bytes).digest('hex'),
      );
      expect(managedPath).not.toBe(source.path);
    }
    database.close();
  });

  it('requires an explicit duplicate choice and reports linked Luminaires as ineligible', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-project-promotion-duplicate-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const projectId = 'f0000000-0000-4000-8000-000000000001';
    const luminaireId = 'f1000000-0000-4000-8000-000000000001';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    const store = new LuminaireLibraryStore(database);
    const service = new LuminaireLibraryService(store, new LuminaireLibraryAssetStorage(dataRoot));
    const manufacturer = store.createManufacturer(
      { name: 'Project-only Maker', idempotencyKey: 'duplicate-maker' },
      actor,
    );
    const existingProduct = store.createProduct(
      {
        manufacturerId: manufacturer.manufacturerId,
        name: 'Bespoke Pendant',
        productType: 'Pendant',
        description: 'Existing reusable product',
        idempotencyKey: 'duplicate-product',
      },
      actor,
    );
    const existingVariant = store.createVariant(
      existingProduct.productId,
      { ...draft, variantLabel: 'Existing configuration', idempotencyKey: 'duplicate-variant' },
      actor,
    );
    const candidate = service.draftCandidate(projectId, luminaireId);
    expect(candidate.manufacturerMatches[0]?.manufacturerId).toBe(manufacturer.manufacturerId);
    expect(candidate.duplicateSuggestions.map((item) => item.productId)).toContain(
      existingProduct.productId,
    );
    await expect(
      service.createDraftFromProjectLuminaire(
        projectId,
        luminaireId,
        {
          manufacturer: { mode: 'USE_EXISTING', manufacturerId: manufacturer.manufacturerId },
          product: {
            mode: 'CREATE_NEW',
            name: 'Bespoke Pendant',
            productType: 'Pendant',
            description: candidate.source.description,
            duplicateDecision: 'NO_MATCHES',
          },
          variant: candidate.source.variant,
          idempotencyKey: 'duplicate-unresolved',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const separate = await service.createDraftFromProjectLuminaire(
      projectId,
      luminaireId,
      {
        manufacturer: { mode: 'USE_EXISTING', manufacturerId: manufacturer.manufacturerId },
        product: {
          mode: 'CREATE_NEW',
          name: 'Bespoke Pendant',
          productType: 'Pendant',
          description: candidate.source.description,
          duplicateDecision: 'KEEP_SEPARATE',
        },
        variant: candidate.source.variant,
        idempotencyKey: 'duplicate-keep-separate',
      },
      actor,
    );
    expect(separate.product.productId).not.toBe(existingProduct.productId);
    const published = store.publishVariant(
      existingVariant.variantId,
      {
        expectedProductRowVersion: existingProduct.rowVersion,
        expectedVariantRowVersion: existingVariant.rowVersion,
        idempotencyKey: 'duplicate-publish-existing',
      },
      actor,
    );
    const linked = await service.addProjectLuminaire(
      projectId,
      {
        versionId: published.version.versionId,
        tag: 'L-LINK',
        category: 'Decorative',
        location: 'Lobby',
        unit: 'No.',
        quantity: 1,
        notes: '',
        descriptionOverride: null,
        idempotencyKey: 'duplicate-linked-project-item',
      },
      actor,
    );
    expect(service.draftCandidate(projectId, linked.luminaireId).eligibility).toMatchObject({
      eligible: false,
      reasonCode: 'ALREADY_LINKED',
    });
    database.close();
  });

  it('fails closed on stored hash mismatch and cleans an earlier partial managed copy', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-project-promotion-failure-'));
    roots.push(dataRoot);
    const database = databaseV22();
    const projectId = 'e0000000-0000-4000-8000-000000000001';
    const luminaireId = 'e1000000-0000-4000-8000-000000000001';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    const imagePath = insertProjectAsset(
      database,
      dataRoot,
      projectId,
      luminaireId,
      'ProductImage',
      'valid.png',
      'valid image',
      '0'.repeat(64),
    );
    const datasheetPath = insertProjectAsset(
      database,
      dataRoot,
      projectId,
      luminaireId,
      'Datasheet',
      'valid.pdf',
      'actual pdf',
    );
    const store = new LuminaireLibraryStore(database);
    const storage = new LuminaireLibraryAssetStorage(dataRoot);
    const service = new LuminaireLibraryService(store, storage);
    const candidate = service.draftCandidate(projectId, luminaireId);
    await expect(
      service.createDraftFromProjectLuminaire(
        projectId,
        luminaireId,
        {
          manufacturer: { mode: 'CREATE_NEW', name: candidate.source.manufacturerName },
          product: {
            mode: 'CREATE_NEW',
            name: candidate.source.productName,
            productType: 'Pendant',
            description: candidate.source.description,
            duplicateDecision: 'NO_MATCHES',
          },
          variant: candidate.source.variant,
          idempotencyKey: 'project-promotion-failure-1',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await storage.reconcileOrphans(new Set())).toEqual([]);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM luminaire_library_products').get(),
    ).toEqual({ count: 0 });
    expect(readFileSync(imagePath, 'utf8')).toBe('valid image');
    expect(readFileSync(datasheetPath, 'utf8')).toBe('actual pdf');
    database.close();
  });

  it('saves mutable Drafts, hard-blocks duplicate ordering codes, and filters exact Variants', () => {
    const database = databaseV22();
    const store = new LuminaireLibraryStore(database, () => new Date('2026-08-26T08:00:00.000Z'));
    const erco = store.createManufacturer(
      { name: 'ERCO', idempotencyKey: 'filter-maker-erco' },
      actor,
    );
    const iku = store.createProduct(
      {
        manufacturerId: erco.manufacturerId,
        name: 'Iku',
        productType: 'Recessed Downlight',
        description: 'Professional recessed family',
        idempotencyKey: 'filter-product-iku',
      },
      actor,
    );
    const variantA = store.createVariant(
      iku.productId,
      {
        ...draft,
        variantLabel: 'Iku 10.6W 3000K 24°',
        orderingCode: 'A2000427',
        wattage: '10.6W',
        lumens: '1222 lm',
        lightColor: '3000K',
        cri: 'CRI92',
        beamAngle: '24°',
        ipRating: 'IP44',
        control: 'DALI',
        idempotencyKey: 'filter-variant-a',
      },
      actor,
    );
    const variantB = store.createVariant(
      iku.productId,
      {
        ...draft,
        variantLabel: 'Iku 14W 3000K 36°',
        orderingCode: 'A2000428',
        wattage: '14W',
        lumens: '1500 lm',
        lightColor: '3000K',
        cri: 'CRI90',
        beamAngle: '36°',
        ipRating: 'IP44',
        control: 'DALI',
        idempotencyKey: 'filter-variant-b',
      },
      actor,
    );
    const variantC = store.createVariant(
      iku.productId,
      {
        ...draft,
        variantLabel: 'Iku 20W 4000K Wide Flood',
        orderingCode: 'A2000429',
        wattage: '20W',
        lumens: '2200 lm',
        lightColor: '4000K',
        cri: 'CRI90',
        beamAngle: 'Wide Flood',
        ipRating: 'IP65',
        control: 'On/Off',
        idempotencyKey: 'filter-variant-c',
      },
      actor,
    );
    const saved = store.updateVariant(
      variantA.variantId,
      {
        ...draft,
        ...variantA,
        beamAngle: '24° Narrow',
        orderingCode: ' a2000427 ',
        expectedRowVersion: 1,
      },
      actor,
    );
    expect(saved).toMatchObject({
      variantId: variantA.variantId,
      rowVersion: 2,
      beamAngle: '24° Narrow',
    });
    expect(() =>
      store.updateVariant(
        variantA.variantId,
        {
          ...draft,
          orderingCode: 'A2000427',
          beamAngle: '36°',
          expectedRowVersion: 1,
        },
        actor,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        message: 'Variant changed before this operation.',
      }),
    );
    expect(store.getVariant(variantA.variantId)).toMatchObject({
      rowVersion: 2,
      beamAngle: '24° Narrow',
    });
    expect(store.listVersions(variantA.variantId)).toEqual([]);
    expect(() =>
      store.createVariant(
        iku.productId,
        {
          ...draft,
          variantLabel: 'Duplicate',
          orderingCode: 'A2000427',
          idempotencyKey: 'duplicate-variant',
        },
        actor,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({
          conflictKind: 'DUPLICATE_ORDERING_CODE',
          variantId: variantA.variantId,
        }),
      }),
    );
    const unpublished = store.createVariant(
      iku.productId,
      {
        ...draft,
        variantLabel: 'Unpublished 3200K draft',
        orderingCode: '',
        lightColor: '3200 K',
        beamAngle: '18',
        idempotencyKey: 'unpublished-facet-draft',
      },
      actor,
    );
    expect(
      store.createVariant(
        iku.productId,
        {
          ...draft,
          variantLabel: 'Second empty ordering code',
          orderingCode: '',
          idempotencyKey: 'second-empty-ordering-code',
        },
        actor,
      ).orderingCode,
    ).toBe('');
    const secondManufacturer = store.createManufacturer(
      { name: 'ERCO UAT Independent', idempotencyKey: 'second-maker' },
      actor,
    );
    const secondProduct = store.createProduct(
      {
        manufacturerId: secondManufacturer.manufacturerId,
        name: 'Iku UAT Independent',
        productType: 'Recessed Downlight',
        description: 'Independent Manufacturer namespace',
        idempotencyKey: 'second-maker-product',
      },
      actor,
    );
    expect(
      store.createVariant(
        secondProduct.productId,
        {
          ...draft,
          orderingCode: 'A2000427',
          idempotencyKey: 'same-code-different-maker',
        },
        actor,
      ).orderingCode,
    ).toBe('A2000427');

    for (const [variantId, type, suffix] of [
      [variantA.variantId, 'IES', 'a'],
      [variantB.variantId, 'IES', 'b'],
      [variantC.variantId, 'LDT', 'c'],
    ] as const) {
      const asset = store.createAsset(
        {
          productId: iku.productId,
          variantId,
          assetType: type,
          label: `${type} current`,
          idempotencyKey: `filter-asset-${suffix}`,
        },
        actor,
      );
      store.addAssetVersion(
        asset.assetId,
        {
          assetVersionId: `00000000-0000-4000-8000-00000000000${suffix === 'a' ? '1' : suffix === 'b' ? '2' : '3'}`,
          fileName: `${suffix}.${type.toLocaleLowerCase('en')}`,
          mimeType: `application/${type.toLocaleLowerCase('en')}`,
          sizeBytes: 10,
          contentHash: suffix.repeat(64),
          locatorValue: `luminaire-library/assets/${suffix}`,
          expectedLatestSequence: 0,
          idempotencyKey: `filter-asset-version-${suffix}`,
        },
        actor,
      );
    }
    const unpublishedIes = store.createAsset(
      {
        productId: iku.productId,
        variantId: unpublished.variantId,
        assetType: 'IES',
        label: 'IES current',
        idempotencyKey: 'unpublished-filter-asset',
      },
      actor,
    );
    store.addAssetVersion(
      unpublishedIes.assetId,
      {
        assetVersionId: '00000000-0000-4000-8000-000000000004',
        fileName: 'draft.ies',
        mimeType: 'application/ies',
        sizeBytes: 10,
        contentHash: 'd'.repeat(64),
        locatorValue: 'luminaire-library/assets/d',
        expectedLatestSequence: 0,
        idempotencyKey: 'unpublished-filter-asset-version',
      },
      actor,
    );

    for (const [entry, rowVersion, key] of [
      [variantA, saved.rowVersion, 'publish-filter-a'],
      [variantB, variantB.rowVersion, 'publish-filter-b'],
      [variantC, variantC.rowVersion, 'publish-filter-c'],
    ] as const) {
      store.publishVariant(
        entry.variantId,
        {
          expectedProductRowVersion: iku.rowVersion,
          expectedVariantRowVersion: rowVersion,
          idempotencyKey: key,
        },
        actor,
      );
    }

    const unpublishedNextDraft = store.updateVariant(
      variantA.variantId,
      {
        ...draft,
        variantLabel: 'Iku 12.8W 4100K 60° Draft',
        orderingCode: 'A2000427',
        wattage: '12.8 W',
        lumens: '1500 lm',
        lightColor: '4100 K',
        cri: 'CRI92',
        beamAngle: '60°',
        expectedRowVersion: saved.rowVersion,
      },
      actor,
    );
    expect(unpublishedNextDraft.rowVersion).toBe(3);

    const combined = store.listProducts(
      luminaireLibraryListQuerySchema.parse({
        manufacturerId: erco.manufacturerId,
        productType: 'Recessed Downlight',
        cctKelvin: '3000',
        beam: '24° Narrow,36°',
        wattageMin: '8',
        wattageMax: '15',
        wattageBasis: 'W',
        criMin: '90',
        control: 'DALI',
        hasIes: 'true',
      }),
    );
    expect(combined).toMatchObject({ totalProducts: 1, totalVariants: 2 });
    expect(combined.items[0]?.variants.map((entry) => entry.variant.variantId)).toEqual([
      variantA.variantId,
      variantB.variantId,
    ]);
    expect(combined.facets?.cctKelvin).toEqual(
      expect.arrayContaining([
        { value: '3000', label: '3000K', count: 2 },
        { value: '4000', label: '4000K', count: 0 },
      ]),
    );
    expect(combined.facets?.cctKelvin).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: '3200' })]),
    );
    expect(combined.facets?.cctKelvin).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ value: '4100' })]),
    );
    expect(combined.facets?.beams).toEqual(
      expect.arrayContaining([
        { value: '24° narrow', label: '24° Narrow', count: 1 },
        { value: '36°', label: '36°', count: 1 },
      ]),
    );
    const narrowed = store.listProducts(
      luminaireLibraryListQuerySchema.parse({
        cctKelvin: '3000',
        beam: '24° Narrow',
        hasIes: 'true',
      }),
    );
    expect(narrowed).toMatchObject({ totalProducts: 1, totalVariants: 1 });
    expect(narrowed.items[0]?.variants[0]?.variant.variantId).toBe(variantA.variantId);
    const unpublishedDraftFilter = store.listProducts(
      luminaireLibraryListQuerySchema.parse({ cctKelvin: '4100', beam: '60°' }),
    );
    expect(unpublishedDraftFilter).toMatchObject({ totalProducts: 0, totalVariants: 0 });
    const missingPhotometry = store.listProducts(
      luminaireLibraryListQuerySchema.parse({ missingPhotometry: 'true' }),
    );
    expect(missingPhotometry.totalVariants).toBe(0);
    database.close();
  });

  it('does not promote a legacy ordering-code Model into Product Family', () => {
    const database = databaseV22();
    const projectId = '10000000-0000-4000-8000-000000000090';
    const luminaireId = '20000000-0000-4000-8000-000000000090';
    insertProjectOnlyLuminaire(database, projectId, luminaireId);
    database
      .prepare(
        `UPDATE project_luminaires SET model = 'A2000427', ordering_code = 'A2000427'
         WHERE id = ?`,
      )
      .run(luminaireId);
    const root = mkdtempSync(path.join(tmpdir(), 'p5a-mapping-'));
    roots.push(root);
    const service = new LuminaireLibraryService(
      new LuminaireLibraryStore(database),
      new LuminaireLibraryAssetStorage(root),
    );
    const candidate = service.draftCandidate(projectId, luminaireId);
    expect(candidate.source.productName).toBe('');
    expect(candidate.source.variant.orderingCode).toBe('A2000427');
    database.close();
  });

  it('persists a saved Draft across a database restart without publishing a Version', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p5a-draft-restart-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    const database = databaseV22(databasePath);
    const store = new LuminaireLibraryStore(database, () => new Date('2026-08-26T08:00:00.000Z'));
    const manufacturer = store.createManufacturer(
      { name: 'ERCO', idempotencyKey: 'restart-maker' },
      actor,
    );
    const product = store.createProduct(
      {
        manufacturerId: manufacturer.manufacturerId,
        name: 'Iku',
        productType: 'Recessed Downlight',
        description: 'Restart-safe Draft fixture',
        idempotencyKey: 'restart-product',
      },
      actor,
    );
    const variant = store.createVariant(
      product.productId,
      { ...draft, orderingCode: 'A2000427', idempotencyKey: 'restart-variant' },
      actor,
    );
    store.updateVariant(
      variant.variantId,
      { ...draft, orderingCode: 'A2000427', beamAngle: '25°', expectedRowVersion: 1 },
      actor,
    );
    database.close();

    const reopenedDatabase = new DatabaseSync(databasePath);
    reopenedDatabase.exec('PRAGMA foreign_keys = ON');
    const reopenedStore = new LuminaireLibraryStore(reopenedDatabase);
    expect(reopenedStore.getVariant(variant.variantId)).toMatchObject({
      beamAngle: '25°',
      status: 'ACTIVE',
      rowVersion: 2,
      latestPublishedVersionId: null,
    });
    expect(reopenedStore.listVersions(variant.variantId)).toEqual([]);
    reopenedDatabase.close();
  });
});
