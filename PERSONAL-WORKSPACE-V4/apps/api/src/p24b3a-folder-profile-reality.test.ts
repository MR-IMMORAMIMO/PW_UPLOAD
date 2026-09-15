import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import type { CreateFolderProfileInput, UpdateFolderProfileInput } from '@scli/contracts';
import type { ProfileFolderNodeDraft } from '@scli/domain';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';
import { FolderProfileService } from './folder-profile-service';

const temporaryDirectories: string[] = [];
const closeables: Array<{ close(): Promise<void> | void }> = [];

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p24b3a-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

function createInput(): CreateFolderProfileInput {
  return {
    name: 'Full Lighting + Authority',
    description: 'Reality profile',
    folders: [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [] },
      { name: '02_CALCULATIONS', children: [] },
      { name: '03_DRAWINGS', children: [] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'DATASHEETS', children: [] },
          { name: 'BOQ', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ],
    outputDefaults: [
      { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
      { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
      { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
    ],
  };
}

describe('P2.4B3A folder profile reality check', () => {
  it('runs the full profile catalog, instantiation, and independence scenario', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b3a-reality-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });

    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    // Create the user profile through the API.
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{ data: { profileId: string; name: string } }>().data;
    expect(created.name).toBe('Full Lighting + Authority');

    // Persist/reopen: a second store on the same database sees the profile.
    const reopenedStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenedStore);
    const reopenedService = new FolderProfileService(reopenedStore);
    const reopened = reopenedService.getProfile(created.profileId);
    expect(reopened.folders).toHaveLength(8);
    expect(reopened.outputDefaults).toHaveLength(3);

    // Instantiate Project A.
    const projectA = reopenedService.instantiateProfile(created.profileId);
    const profileFolderIds = new Set(reopened.folders.map((folder) => folder.profileFolderId));
    const projectAFolderIds = projectA.snapshot.folders.map((folder) => folder.folderId);
    expect(
      projectA.snapshot.folders.every((folder) => !profileFolderIds.has(folder.folderId)),
    ).toBe(true);
    expect(projectA.snapshot.sourceProfile?.profileId).toBe(created.profileId);
    expect(projectA.snapshot.sourceProfile?.structuralFingerprint).toBe(
      reopened.structuralFingerprint,
    );
    const projectAFolderIdSet = new Set(projectAFolderIds);
    for (const mapping of projectA.outputMappings.mappings) {
      expect(projectAFolderIdSet.has(mapping.destinationFolderId!)).toBe(true);
    }
    const boqProjectFolder = projectA.snapshot.folders.find((folder) => folder.name === 'BOQ')!;
    const boqProfileFolder = reopened.folders.find((folder) => folder.name === 'BOQ')!;
    expect(boqProjectFolder.sourceProfileFolderId).toBe(boqProfileFolder.profileFolderId);

    // Instantiate Project B: distinct project folder IDs.
    const projectB = reopenedService.instantiateProfile(created.profileId);
    expect(projectB.snapshot.folders.map((folder) => folder.folderId)).not.toEqual(
      projectAFolderIds,
    );

    // Change the profile: rename, add MOCKUP, change Reports destination.
    const byParent = new Map<string | null, typeof reopened.folders>();
    for (const folder of reopened.folders) {
      const siblings = byParent.get(folder.parentProfileFolderId) ?? [];
      siblings.push(folder);
      byParent.set(folder.parentProfileFolderId, siblings);
    }
    const buildDrafts = (parent: string | null): ProfileFolderNodeDraft[] =>
      (byParent.get(parent) ?? [])
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((folder) => ({
          profileFolderId: folder.profileFolderId,
          name: folder.name,
          semanticRole: folder.semanticRole,
          children: buildDrafts(folder.profileFolderId),
        }));
    const drafts = buildDrafts(null);
    drafts.find((draft) => draft.name === '03_DRAWINGS')!.name = '03_LIGHTING_DRAWINGS';
    drafts.push({ name: 'MOCKUP', children: [] });
    const updateInput: UpdateFolderProfileInput = {
      name: reopened.name,
      description: reopened.description,
      folders: drafts,
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '04_TECHNICAL' },
      ],
    };
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/folder-profiles/catalog/${created.profileId}`,
      payload: updateInput,
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json<{ data: { folders: Array<{ name: string }> } }>().data;
    expect(updated.folders.some((folder) => folder.name === '03_LIGHTING_DRAWINGS')).toBe(true);
    expect(updated.folders.some((folder) => folder.name === 'MOCKUP')).toBe(true);

    // Reopen Project A: unchanged.
    expect(projectA.snapshot.folders.some((folder) => folder.name === '03_DRAWINGS')).toBe(true);
    expect(projectA.snapshot.folders.some((folder) => folder.name === 'MOCKUP')).toBe(false);
    expect(
      projectA.outputMappings.mappings.find((mapping) => mapping.outputTypeId === 'Reports'),
    ).toBeDefined();

    // Instantiate Project C: receives the modified structure.
    const projectC = reopenedService.instantiateProfile(created.profileId);
    expect(projectC.snapshot.folders.some((folder) => folder.name === '03_LIGHTING_DRAWINGS')).toBe(
      true,
    );
    expect(projectC.snapshot.folders.some((folder) => folder.name === 'MOCKUP')).toBe(true);
    expect(projectC.snapshot.folders.map((folder) => folder.folderId)).not.toEqual(
      projectAFolderIds,
    );

    // Duplicate the profile: independent identities.
    const duplicateResponse = await app.inject({
      method: 'POST',
      url: `/api/folder-profiles/catalog/${created.profileId}/duplicate`,
    });
    expect(duplicateResponse.statusCode).toBe(201);
    const duplicate = duplicateResponse.json<{ data: { profileId: string; name: string } }>().data;
    expect(duplicate.profileId).not.toBe(created.profileId);
    const duplicateProfile = reopenedService.getProfile(duplicate.profileId);
    const duplicateFolderIds = new Set(
      duplicateProfile.folders.map((folder) => folder.profileFolderId),
    );
    expect(
      duplicateProfile.folders.every((folder) => !profileFolderIds.has(folder.profileFolderId)),
    ).toBe(true);
    for (const outputDefault of duplicateProfile.outputDefaults) {
      expect(duplicateFolderIds.has(outputDefault.destinationProfileFolderId)).toBe(true);
    }

    // Delete the original profile: Project A remains unchanged.
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${created.profileId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(reopenedService.listProfiles().map((profile) => profile.profileId)).toEqual([
      duplicate.profileId,
    ]);
    expect(projectA.snapshot.folders).toHaveLength(8);
    expect(projectA.snapshot.sourceProfile?.profileId).toBe(created.profileId);

    // No physical project folders were ever created.
    expect(readdirSync(config.PERSONAL_PROJECT_ROOT)).toHaveLength(0);
  });

  it('exposes catalog CRUD and default selection through the API', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b3a-api-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    expect(createResponse.statusCode).toBe(201);
    const profileId = createResponse.json<{ data: { profileId: string } }>().data.profileId;

    const listResponse = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    expect(listResponse.statusCode).toBe(200);
    const list = listResponse.json<{
      data: { profiles: Array<{ profileId: string }>; defaultProfileId: string | null };
    }>().data;
    expect(list.profiles.map((profile) => profile.profileId)).toContain(profileId);
    expect(list.defaultProfileId).toBeNull();

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/folder-profiles/catalog/${profileId}`,
    });
    expect(getResponse.statusCode).toBe(200);

    const setDefaultResponse = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { profileId },
    });
    expect(setDefaultResponse.statusCode).toBe(200);
    const withDefault = setDefaultResponse.json<{ data: { defaultProfileId: string | null } }>()
      .data;
    expect(withDefault.defaultProfileId).toBe(profileId);

    const clearDefaultResponse = await app.inject({
      method: 'DELETE',
      url: '/api/folder-profiles/catalog/default',
    });
    expect(clearDefaultResponse.statusCode).toBe(200);
    expect(
      clearDefaultResponse.json<{ data: { defaultProfileId: string | null } }>().data
        .defaultProfileId,
    ).toBeNull();

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${profileId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
    const afterDelete = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    expect(
      afterDelete.json<{ data: { profiles: Array<{ profileId: string }> } }>().data.profiles,
    ).toHaveLength(0);
  });
});

describe('P2.4B3A catalog concurrency and legacy authority boundary', () => {
  async function setupApp(): Promise<{
    app: Awaited<ReturnType<typeof createApp>>;
    store: PersonalWorkspaceStore;
  }> {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b3a-boundary-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);
    return { app, store };
  }

  function sqlStore(store: PersonalWorkspaceStore): {
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined;
      run(...params: unknown[]): unknown;
    };
  } {
    return (
      store as unknown as {
        database: {
          prepare(sql: string): {
            get(...params: unknown[]): Record<string, unknown> | undefined;
            run(...params: unknown[]): unknown;
          };
        };
      }
    ).database;
  }

  it('two concurrent valid catalog mutations both survive', async () => {
    const { app } = await setupApp();
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog',
        payload: { ...createInput(), name: 'Concurrent Alpha' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog',
        payload: { ...createInput(), name: 'Concurrent Beta' },
      }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const names = list
      .json<{ data: { profiles: Array<{ name: string }> } }>()
      .data.profiles.map((profile) => profile.name);
    expect(names).toContain('Concurrent Alpha');
    expect(names).toContain('Concurrent Beta');
  });

  it('a failed mutation followed by a valid mutation succeeds', async () => {
    const { app } = await setupApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    expect(created.statusCode).toBe(201);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: { ...createInput(), name: 'full lighting + authority' },
    });
    expect(failed.statusCode).toBe(409);

    const second = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: { ...createInput(), name: 'Second Profile' },
    });
    expect(second.statusCode).toBe(201);

    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/folder-profiles/catalog/${profileId}`,
      payload: {
        name: 'Renamed First',
        description: 'Updated',
        folders: createInput().folders,
        outputDefaults: createInput().outputDefaults,
      },
    });
    expect(update.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    expect(list.statusCode).toBe(200);
    const names = list
      .json<{ data: { profiles: Array<{ name: string }> } }>()
      .data.profiles.map((profile) => profile.name);
    expect(names).toContain('Renamed First');
    expect(names).toContain('Second Profile');
  });

  it('legacy profile API writes to the canonical catalog and historical rows stay read-only', async () => {
    const { app, store } = await setupApp();
    const legacyFolders = [
      { name: '01_WORKING', children: [{ name: 'EXCEL', children: [] }] },
      { name: '02_DELIVERABLES', children: [] },
    ];
    const legacyOutputs = {
      scheduleExcel: '01_WORKING/EXCEL',
      schedulePdf: '01_WORKING/EXCEL',
      boqExcel: '02_DELIVERABLES',
      boqPdf: '02_DELIVERABLES',
      datasheets: '02_DELIVERABLES',
    };
    const legacyInput = {
      name: 'Legacy Boundary Profile',
      description: 'Saved through the legacy endpoint.',
      folders: legacyFolders,
      outputFolders: legacyOutputs,
    };
    const saved = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles',
      payload: legacyInput,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json<{ data: { builtIn: boolean; name: string } }>().data).toMatchObject({
      builtIn: false,
      name: 'Legacy Boundary Profile',
    });

    const catalogList = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const catalogProfile = catalogList
      .json<{ data: { profiles: Array<{ profileId: string; name: string }> } }>()
      .data.profiles.find((profile) => profile.name === 'Legacy Boundary Profile');
    expect(catalogProfile).toBeDefined();

    const legacyList = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const legacyNames = legacyList
      .json<{ data: Array<{ name: string }> }>()
      .data.map((profile) => profile.name);
    expect(legacyNames.filter((name) => name === 'Legacy Boundary Profile')).toHaveLength(1);

    const database = sqlStore(store);
    const row = database
      .prepare('SELECT COUNT(*) AS count FROM custom_folder_profiles WHERE name = ?')
      .get('Legacy Boundary Profile');
    expect(row?.count).toBe(0);

    const updated = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles',
      payload: {
        ...legacyInput,
        description: 'Updated through the legacy endpoint.',
        folders: [{ name: '01_WORKING', children: [] }],
        outputFolders: {
          scheduleExcel: '01_WORKING',
          schedulePdf: '01_WORKING',
          boqExcel: '01_WORKING',
          boqPdf: '01_WORKING',
          datasheets: '01_WORKING',
        },
      },
    });
    expect(updated.statusCode).toBe(201);
    const reloaded = await app.inject({
      method: 'GET',
      url: `/api/folder-profiles/catalog/${catalogProfile!.profileId}`,
    });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json<{ data: { description: string } }>().data.description).toBe(
      'Updated through the legacy endpoint.',
    );

    const database2 = sqlStore(store);
    database2
      .prepare(
        `INSERT INTO custom_folder_profiles
         (name, description, folders_json, output_folders_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'Historical Row',
        'Historical profile.',
        JSON.stringify([{ name: 'H1', children: [] }]),
        JSON.stringify({
          scheduleExcel: 'H1',
          schedulePdf: 'H1',
          boqExcel: 'H1',
          boqPdf: 'H1',
          datasheets: 'H1',
        }),
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );

    const withHistorical = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const namesWithHistorical = withHistorical
      .json<{ data: Array<{ name: string }> }>()
      .data.map((profile) => profile.name);
    expect(namesWithHistorical.filter((name) => name === 'Historical Row')).toHaveLength(1);

    const shadowSave = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles',
      payload: {
        name: 'Historical Row',
        description: 'Canonical replacement.',
        folders: [{ name: '01_WORKING', children: [] }],
        outputFolders: {
          scheduleExcel: '01_WORKING',
          schedulePdf: '01_WORKING',
          boqExcel: '01_WORKING',
          boqPdf: '01_WORKING',
          datasheets: '01_WORKING',
        },
      },
    });
    expect(shadowSave.statusCode).toBe(201);
    const afterShadow = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const namesAfterShadow = afterShadow
      .json<{ data: Array<{ name: string }> }>()
      .data.map((profile) => profile.name);
    expect(namesAfterShadow.filter((name) => name === 'Historical Row')).toHaveLength(1);
  });
});
