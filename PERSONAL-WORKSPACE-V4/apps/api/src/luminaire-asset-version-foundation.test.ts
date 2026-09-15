import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { attachLuminaireAssetSchema, type LuminaireRecordInput } from '@scli/contracts';
import type { AppUser } from '@scli/domain';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const roots: string[] = [];
const stores: PersonalWorkspaceStore[] = [];

const actor: AppUser = {
  id: randomUUID(),
  entraObjectId: 'local-asset-user',
  displayName: 'Asset Owner',
  email: 'asset@local.test',
  jobTitle: 'Lighting Designer',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
};

const luminaire: LuminaireRecordInput = {
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '',
  description: '',
  manufacturer: 'Scientechnic',
  model: 'DLX',
  wattage: '18W',
  lumens: '',
  lightColor: '3000K',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  datasheetPath: '',
  location: '',
  unit: 'No.',
  quantity: 1,
  notes: '',
  sourceName: 'Manual',
  dimensions: '',
  bodyColorFinish: '',
};

function configFor(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'asset-version-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Asset Admin',
    STANDALONE_ADMIN_EMAIL: 'asset-admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Asset-Version-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
  });
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-assets-'));
  roots.push(root);
  const store = new PersonalWorkspaceStore(configFor(path.join(root, 'app.sqlite'), root));
  stores.push(store);
  const projectId = randomUUID();
  store.initializeProject(
    projectId,
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Manual',
    '2026-08-20',
  );
  return { store, projectId };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('immutable Luminaire asset versions', () => {
  it('allocates independent monotonic sequences and preserves previous versions', () => {
    const { store, projectId } = setup();
    const item = store.addLuminaire(projectId, luminaire);
    const beforeAttachment = Date.now();

    const firstDatasheet = store.attachLuminaireAsset(
      projectId,
      item.id,
      { assetType: 'Datasheet', filePath: 'C:\\assets\\DL01-v1.pdf' },
      actor,
    );
    const secondDatasheet = store.attachLuminaireAsset(
      projectId,
      item.id,
      { assetType: 'Datasheet', filePath: 'C:\\assets\\DL01-v2.pdf' },
      actor,
    );
    const firstImage = store.attachLuminaireAsset(
      projectId,
      item.id,
      { assetType: 'ProductImage', filePath: 'C:\\assets\\DL01-v1.webp' },
      actor,
    );
    const afterAttachment = Date.now();

    expect(firstDatasheet.versionSequence).toBe(1);
    expect(secondDatasheet.versionSequence).toBe(2);
    expect(firstImage.versionSequence).toBe(1);
    expect(
      store
        .listLuminaireAssetVersions(projectId, item.id, 'Datasheet')
        .map((version) => version.versionSequence),
    ).toEqual([2, 1]);
    const refreshed = store.getWorkspace(projectId).luminaires[0]!;
    expect(refreshed.datasheetPath).toBe('C:\\assets\\DL01-v2.pdf');
    expect(refreshed.imagePath).toBe('C:\\assets\\DL01-v1.webp');
    expect(secondDatasheet.attachedByNameSnapshot).toBe('Asset Owner');
    expect(
      [firstDatasheet, secondDatasheet, firstImage].every((version) => !version.backfilled),
    ).toBe(true);
    expect(Date.parse(secondDatasheet.attachedAt)).toBeGreaterThanOrEqual(beforeAttachment);
    expect(Date.parse(secondDatasheet.attachedAt)).toBeLessThanOrEqual(afterAttachment);
  });

  it('persists Desktop attachments as managed immutable AssetVersions', () => {
    const { store, projectId } = setup();
    store
      .getSharedDatabase()
      .exec(
        'ALTER TABLE luminaire_asset_versions ADD COLUMN locator_kind TEXT; ALTER TABLE luminaire_asset_versions ADD COLUMN locator_value TEXT; ALTER TABLE luminaire_asset_versions ADD COLUMN source_library_asset_version_id TEXT;',
      );
    const item = store.addLuminaire(projectId, luminaire);
    const assetVersionId = randomUUID();
    const absolutePath = `C:\\managed\\${assetVersionId}\\DL01.pdf`;
    const locatorValue = `project-luminaire-assets/${projectId}/${item.id}/${assetVersionId}/DL01.pdf`;

    const attached = store.attachLuminaireAsset(
      projectId,
      item.id,
      { assetType: 'Datasheet', filePath: 'C:\\incoming\\DL01.pdf' },
      actor,
      {
        assetVersionId,
        fileName: 'DL01.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        contentHash: 'a'.repeat(64),
        locatorValue,
        absolutePath,
      },
    );

    expect(attached).toMatchObject({
      id: assetVersionId,
      versionSequence: 1,
      filePath: absolutePath,
      fileName: 'DL01.pdf',
      sizeBytes: 4096,
      fileHash: 'a'.repeat(64),
    });
    expect(store.getWorkspace(projectId).luminaires[0]!.datasheetPath).toBe(absolutePath);
    expect(
      store
        .getSharedDatabase()
        .prepare('SELECT locator_kind, locator_value FROM luminaire_asset_versions WHERE id = ?')
        .get(assetVersionId),
    ).toEqual({ locator_kind: 'DATA_ROOT_RELATIVE', locator_value: locatorValue });
  });

  it('creates canonical initial versions for compatibility paths and rejects cross-project access', () => {
    const { store, projectId } = setup();
    const item = store.addLuminaire(
      projectId,
      { ...luminaire, datasheetPath: 'C:\\assets\\legacy.pdf' },
      actor,
    );
    expect(store.listLuminaireAssetVersions(projectId, item.id, 'Datasheet')).toMatchObject([
      { backfilled: false, attachedById: actor.id, attachedByNameSnapshot: actor.displayName },
    ]);

    const otherProjectId = randomUUID();
    store.initializeProject(
      otherProjectId,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      '2026-08-20',
    );
    expect(() => store.listLuminaireAssetVersions(otherProjectId, item.id)).toThrow(/not found/i);
  });

  it('validates asset file types before changing compatibility paths', () => {
    const { store, projectId } = setup();
    const item = store.addLuminaire(projectId, luminaire);
    expect(() =>
      store.attachLuminaireAsset(
        projectId,
        item.id,
        { assetType: 'Datasheet', filePath: 'C:\\assets\\bad.png' },
        actor,
      ),
    ).toThrow(/PDF/i);
    expect(store.getWorkspace(projectId).luminaires[0]!.datasheetPath).toBe('');
    expect(store.listLuminaireAssetVersions(projectId, item.id)).toEqual([]);
  });

  it('appends on compatibility edits and retains immutable history when the path is cleared', () => {
    const { store, projectId } = setup();
    const item = store.addLuminaire(
      projectId,
      { ...luminaire, datasheetPath: 'C:\\assets\\A.pdf' },
      actor,
    );

    store.updateLuminaire(
      projectId,
      item.id,
      { ...luminaire, datasheetPath: 'C:\\assets\\B.pdf' },
      actor,
    );
    const afterEdit = store.listLuminaireAssetVersions(projectId, item.id, 'Datasheet');
    expect(
      afterEdit.map(({ versionSequence, fileName, backfilled }) => ({
        versionSequence,
        fileName,
        backfilled,
      })),
    ).toEqual([
      { versionSequence: 2, fileName: 'B.pdf', backfilled: false },
      { versionSequence: 1, fileName: 'A.pdf', backfilled: false },
    ]);
    expect(store.listLuminaireAssetSummaries(projectId)[0]!.datasheet?.id).toBe(afterEdit[0]!.id);

    store.updateLuminaire(projectId, item.id, { ...luminaire, datasheetPath: '' }, actor);
    expect(store.getWorkspace(projectId).luminaires[0]!.datasheetPath).toBe('');
    expect(store.listLuminaireAssetSummaries(projectId)[0]!.datasheet).toBeNull();
    expect(store.listLuminaireAssetVersions(projectId, item.id, 'Datasheet')).toEqual(afterEdit);
  });

  it('duplicates compatibility assets as independent v1 versions without reusing identities', () => {
    const { store, projectId } = setup();
    const original = store.addLuminaire(
      projectId,
      {
        ...luminaire,
        datasheetPath: 'C:\\assets\\DL01.pdf',
        imagePath: 'C:\\assets\\DL01.png',
      },
      actor,
    );
    const duplicate = store.addLuminaire(
      projectId,
      {
        ...luminaire,
        tag: 'DL02',
        datasheetPath: original.datasheetPath,
        imagePath: original.imagePath,
      },
      actor,
    );

    expect(duplicate.id).not.toBe(original.id);
    const originalVersions = store.listLuminaireAssetVersions(projectId, original.id);
    const duplicateVersions = store.listLuminaireAssetVersions(projectId, duplicate.id);
    expect(
      originalVersions.map(({ assetType, versionSequence }) => ({ assetType, versionSequence })),
    ).toEqual([
      { assetType: 'Datasheet', versionSequence: 1 },
      { assetType: 'ProductImage', versionSequence: 1 },
    ]);
    expect(
      duplicateVersions.map(({ assetType, versionSequence }) => ({ assetType, versionSequence })),
    ).toEqual([
      { assetType: 'Datasheet', versionSequence: 1 },
      { assetType: 'ProductImage', versionSequence: 1 },
    ]);
    const originalVersionIds = new Set(originalVersions.map((version) => version.id));
    expect(duplicateVersions.some((version) => originalVersionIds.has(version.id))).toBe(false);
    expect(duplicateVersions.every((version) => version.luminaireId === duplicate.id)).toBe(true);
  });

  it('cascades asset versions only for the deleted Luminaire', () => {
    const { store, projectId } = setup();
    const deleted = store.addLuminaire(
      projectId,
      { ...luminaire, datasheetPath: 'C:\\assets\\deleted.pdf' },
      actor,
    );
    const retained = store.addLuminaire(
      projectId,
      { ...luminaire, tag: 'DL02', datasheetPath: 'C:\\assets\\retained.pdf' },
      actor,
    );

    store.deleteLuminaire(projectId, deleted.id);
    const database = store.getSharedDatabase();
    expect(store.getWorkspace(projectId).luminaires.some((item) => item.id === deleted.id)).toBe(
      false,
    );
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM luminaire_asset_versions WHERE luminaire_id = ?')
        .get(deleted.id),
    ).toEqual({ count: 0 });
    expect(store.listLuminaireAssetVersions(projectId, retained.id, 'Datasheet')).toMatchObject([
      { fileName: 'retained.pdf', versionSequence: 1 },
    ]);
  });

  it('keeps provenance server-owned at the strict attachment input boundary', () => {
    expect(
      attachLuminaireAssetSchema.safeParse({
        assetType: 'Datasheet',
        filePath: 'C:\\assets\\DL01.pdf',
        backfilled: true,
        versionSequence: 9,
        attachedAt: '2026-08-16T00:00:00.000Z',
        attachedById: actor.id,
        attachedByNameSnapshot: actor.displayName,
      }).success,
    ).toBe(false);
  });
});
