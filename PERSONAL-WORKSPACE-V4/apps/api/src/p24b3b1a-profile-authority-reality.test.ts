import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import type { CreateFolderProfileInput } from '@scli/contracts';
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
    STANDALONE_SESSION_SECRET: 'p24b3b1a-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

interface SqlRowStore {
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    run(...params: unknown[]): unknown;
  };
}

function sqlStore(store: PersonalWorkspaceStore): SqlRowStore {
  return (store as unknown as { database: SqlRowStore }).database;
}

function insertHistoricalRow(
  store: PersonalWorkspaceStore,
  name: string,
  folders: unknown,
  outputs: Record<string, string>,
): void {
  sqlStore(store)
    .prepare(
      `INSERT INTO custom_folder_profiles
       (name, description, folders_json, output_folders_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      'Historical legacy profile.',
      JSON.stringify(folders),
      JSON.stringify(outputs),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
}

function createInput(name = 'Lighting + Authority'): CreateFolderProfileInput {
  return {
    name,
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

async function setup(): Promise<{
  directory: string;
  config: AppConfig;
  store: PersonalWorkspaceStore;
  app: Awaited<ReturnType<typeof createApp>>;
}> {
  const directory = mkdtempSync(path.join(tmpdir(), 'p24b3b1a-reality-'));
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
  return { directory, config, store, app };
}

describe('P2.4B3B1A profile authority reality check', () => {
  it('classifies factory, user, and legacy profiles without display-name identity', async () => {
    const { config, store, app } = await setup();

    const list = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    expect(list.statusCode).toBe(200);
    const presets = list.json<{
      data: Array<{
        name: string;
        builtIn: boolean;
        source?: string;
        factoryProfileKey?: string;
        profileId?: string;
      }>;
    }>().data;
    const factories = presets.filter((preset) => preset.source === 'factory');
    expect(factories.length).toBeGreaterThanOrEqual(6);
    const keys = factories.map((preset) => preset.factoryProfileKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key && key.length > 0)).toBe(true);
    const full = presets.find((preset) => preset.name === 'Full Lighting Design');
    expect(full?.factoryProfileKey).toBe('full-lighting-design');
    expect(full?.builtIn).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    expect(created.statusCode).toBe(201);
    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;

    insertHistoricalRow(store, 'Old Facade Profile', [{ name: '01_RECEIVED', children: [] }], {
      scheduleExcel: '01_RECEIVED',
      datasheets: '01_RECEIVED',
    });

    const withAll = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const all = withAll.json<{
      data: Array<{
        name: string;
        source?: string;
        profileId?: string;
        factoryProfileKey?: string;
      }>;
    }>().data;
    const user = all.find((preset) => preset.name === 'Lighting + Authority');
    expect(user?.source).toBe('user');
    expect(user?.profileId).toBe(profileId);
    const legacy = all.find((preset) => preset.name === 'Old Facade Profile');
    expect(legacy?.source).toBe('legacy');
    expect(legacy?.profileId).toBeUndefined();
    expect(legacy?.factoryProfileKey).toBeUndefined();
    expect(readdirSync(config.PERSONAL_PROJECT_ROOT)).toHaveLength(0);
  });

  it('persists factory, user, and blank canonical defaults across reload', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;

    const factorySet = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
    });
    expect(factorySet.statusCode).toBe(200);
    expect(
      factorySet.json<{
        data: { defaultProfileRef: { kind: string; factoryProfileKey?: string } };
      }>().data.defaultProfileRef,
    ).toEqual({ kind: 'factory', factoryProfileKey: 'full-lighting-design' });
    expect(
      factorySet.json<{ data: { defaultProfileId: string | null } }>().data.defaultProfileId,
    ).toBeNull();

    const reopened = new PersonalWorkspaceStore(config);
    closeables.push(reopened);
    const service = new FolderProfileService(reopened);
    expect(service.getDefaultProfileRef()).toEqual({
      kind: 'factory',
      factoryProfileKey: 'full-lighting-design',
    });
    expect(service.getDefaultProfile()).toBeNull();
    expect(reopened.getSettings().defaultFolderProfile).toBe('Full Lighting Design');

    const userSet = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { profileId },
    });
    expect(userSet.statusCode).toBe(200);
    expect(
      userSet.json<{
        data: { defaultProfileRef: { kind: string; profileId?: string } };
      }>().data.defaultProfileRef,
    ).toEqual({ kind: 'user', profileId });
    const reopened2 = new PersonalWorkspaceStore(config);
    closeables.push(reopened2);
    expect(new FolderProfileService(reopened2).getDefaultProfileRef()).toEqual({
      kind: 'user',
      profileId,
    });
    expect(reopened2.getSettings().defaultFolderProfile).toBe('Lighting + Authority');

    const blankSet = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'blank' },
    });
    expect(blankSet.statusCode).toBe(200);
    expect(
      blankSet.json<{ data: { defaultProfileRef: { kind: string } } }>().data.defaultProfileRef,
    ).toEqual({
      kind: 'blank',
    });
    const reopened3 = new PersonalWorkspaceStore(config);
    closeables.push(reopened3);
    const blankService = new FolderProfileService(reopened3);
    expect(blankService.getDefaultProfileRef()).toEqual({ kind: 'blank' });
    expect(reopened3.getSettings().defaultFolderProfile).toBe('Lighting + Authority');
  });

  it('loads an old defaultProfileId catalog as a user ref without rewriting it', async () => {
    const { config, store, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    const profile = created.json<{ data: Record<string, unknown> }>().data;

    sqlStore(store)
      .prepare(
        'INSERT OR REPLACE INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)',
      )
      .run(
        'folder_profile_catalog',
        JSON.stringify({
          schemaVersion: '1.0',
          profiles: [profile],
          defaultProfileId: profile.profileId,
        }),
        '2026-01-01T00:00:00.000Z',
      );

    const reopened = new PersonalWorkspaceStore(config);
    closeables.push(reopened);
    const service = new FolderProfileService(reopened);
    expect(service.getDefaultProfileRef()).toEqual({
      kind: 'user',
      profileId: profile.profileId,
    });

    const raw = sqlStore(reopened)
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get('folder_profile_catalog') as { json_value: string };
    const persisted = JSON.parse(raw.json_value) as Record<string, unknown>;
    expect(persisted).toHaveProperty('defaultProfileId');
    expect(persisted).not.toHaveProperty('defaultProfileRef');

    const catalog = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const data = catalog.json<{
      data: {
        defaultProfileRef: { kind: string; profileId?: string };
        defaultProfileId: string | null;
      };
    }>().data;
    expect(data.defaultProfileRef).toEqual({ kind: 'user', profileId: profile.profileId });
    expect(data.defaultProfileId).toBe(profile.profileId);
  });

  it('resolves legacy defaults only when no canonical default is set', async () => {
    const { store, app } = await setup();

    const fresh = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const freshData = fresh.json<{
      data: {
        defaultProfileRef: { kind: string };
        effectiveDefaultRef: { kind: string; factoryProfileKey?: string };
        legacyDefaultFolderProfile: string;
        legacyDefaultMatch: string;
        legacyImportRequired: boolean;
      };
    }>().data;
    expect(freshData.defaultProfileRef).toEqual({ kind: 'blank' });
    expect(freshData.effectiveDefaultRef).toEqual({
      kind: 'factory',
      factoryProfileKey: 'full-lighting-design',
    });
    expect(freshData.legacyDefaultFolderProfile).toBe('Full Lighting Design');
    expect(freshData.legacyDefaultMatch).toBe('factory');

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput('Lighting + Authority'),
    });
    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;
    const userMirror = await app.inject({
      method: 'PATCH',
      url: '/api/personal/settings',
      payload: { defaultFolderProfile: 'Lighting + Authority' },
    });
    expect(userMirror.statusCode).toBe(200);
    const userResolved = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const userData = userResolved.json<{
      data: {
        effectiveDefaultRef: { kind: string; profileId?: string };
        legacyDefaultMatch: string;
      };
    }>().data;
    expect(userData.effectiveDefaultRef).toEqual({ kind: 'user', profileId });
    expect(userData.legacyDefaultMatch).toBe('user');

    insertHistoricalRow(store, 'Old Facade Profile', [{ name: '01_RECEIVED', children: [] }], {
      scheduleExcel: '01_RECEIVED',
    });
    const legacyMirror = await app.inject({
      method: 'PATCH',
      url: '/api/personal/settings',
      payload: { defaultFolderProfile: 'Old Facade Profile' },
    });
    expect(legacyMirror.statusCode).toBe(200);
    const legacyResolved = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const legacyData = legacyResolved.json<{
      data: {
        effectiveDefaultRef: { kind: string };
        legacyDefaultMatch: string;
        legacyImportRequired: boolean;
      };
    }>().data;
    expect(legacyData.effectiveDefaultRef).toEqual({ kind: 'blank' });
    expect(legacyData.legacyDefaultMatch).toBe('legacy');
    expect(legacyData.legacyImportRequired).toBe(true);

    const explicit = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'user', profileId },
    });
    expect(explicit.statusCode).toBe(200);
    const differingMirror = await app.inject({
      method: 'PATCH',
      url: '/api/personal/settings',
      payload: { defaultFolderProfile: 'Full Lighting Design' },
    });
    expect(differingMirror.statusCode).toBe(200);
    const canonical = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const canonicalData = canonical.json<{
      data: {
        defaultProfileRef: { kind: string; profileId?: string };
        effectiveDefaultRef: { kind: string; profileId?: string };
        legacyDefaultMatch: string;
      };
    }>().data;
    expect(canonicalData.defaultProfileRef).toEqual({ kind: 'user', profileId });
    expect(canonicalData.effectiveDefaultRef).toEqual({ kind: 'user', profileId });
    expect(canonicalData.legacyDefaultMatch).toBe('canonical');
  });

  it('blank canonical default stays canonical even when the legacy mirror differs', async () => {
    const { app } = await setup();
    await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'factory', factoryProfileKey: 'classic-scli' },
    });
    const blank = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'blank' },
    });
    expect(blank.statusCode).toBe(200);
    const catalog = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const data = catalog.json<{
      data: {
        defaultProfileRef: { kind: string };
        effectiveDefaultRef: { kind: string };
        legacyDefaultFolderProfile: string;
        legacyDefaultMatch: string;
      };
    }>().data;
    expect(data.defaultProfileRef).toEqual({ kind: 'blank' });
    expect(data.effectiveDefaultRef).toEqual({ kind: 'blank' });
    expect(data.legacyDefaultFolderProfile).toBe('Classic SCLI');
    expect(data.legacyDefaultMatch).toBe('canonical');
  });

  it('imports a historical legacy profile losslessly and safely retries', async () => {
    const { config, store, app } = await setup();
    insertHistoricalRow(
      store,
      'Old Facade Profile',
      [
        { name: '01_RECEIVED', children: [] },
        {
          name: '02_OUTPUT',
          children: [{ name: 'EXCEL', children: [] }],
        },
      ],
      { scheduleExcel: '02_OUTPUT/EXCEL', datasheets: '02_OUTPUT' },
    );

    const imported = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog/import',
      payload: { name: 'Old Facade Profile' },
    });
    expect(imported.statusCode).toBe(201);
    const profile = imported.json<{
      data: {
        profileId: string;
        name: string;
        folders: Array<{ profileFolderId: string }>;
        outputDefaults: Array<{ outputTypeId: string; destinationProfileFolderId: string }>;
      };
    }>().data;
    expect(profile.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.folders.every((folder) => folder.profileFolderId.length > 0)).toBe(true);
    expect(
      profile.outputDefaults.map((outputDefault) => outputDefault.outputTypeId).sort(),
    ).toEqual(['datasheets', 'scheduleExcel']);

    const row = sqlStore(store)
      .prepare('SELECT * FROM custom_folder_profiles WHERE name = ?')
      .get('Old Facade Profile') as Record<string, unknown>;
    expect(String(row.description)).toBe('Historical legacy profile.');
    expect(JSON.parse(String(row.output_folders_json))).toEqual({
      scheduleExcel: '02_OUTPUT/EXCEL',
      datasheets: '02_OUTPUT',
    });
    expect(String(row.updated_at)).toBe('2026-01-01T00:00:00.000Z');

    const retry = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog/import',
      payload: { name: 'Old Facade Profile' },
    });
    expect(retry.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog/import',
      payload: { name: 'Never Existed' },
    });
    expect(missing.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const names = list.json<{ data: Array<{ name: string }> }>().data.map((preset) => preset.name);
    expect(names.filter((name) => name === 'Old Facade Profile')).toHaveLength(1);
    expect(readdirSync(config.PERSONAL_PROJECT_ROOT)).toHaveLength(0);
  });

  it('preserves unknown output defaults through legacy preset writes', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: {
        name: 'Lighting + Authority',
        description: 'Canonical profile with a custom output.',
        folders: [
          { name: '01_WORKING', children: [] },
          { name: '02_OUTPUT', children: [{ name: 'EXCEL', children: [] }] },
          { name: '03_EXTRA', children: [] },
        ],
        outputDefaults: [
          { outputTypeId: 'scheduleExcel', destinationPath: '02_OUTPUT/EXCEL' },
          { outputTypeId: 'CustomDeliverable', destinationPath: '03_EXTRA' },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;

    const saved = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles',
      payload: {
        name: 'Lighting + Authority',
        description: 'Edited through the legacy endpoint.',
        folders: [
          { name: '01_WORKING', children: [] },
          { name: '02_OUTPUT', children: [{ name: 'EXCEL', children: [] }] },
          { name: '03_EXTRA', children: [] },
        ],
        outputFolders: {
          scheduleExcel: '01_WORKING',
          schedulePdf: '01_WORKING',
          boqExcel: '01_WORKING',
          boqPdf: '01_WORKING',
          datasheets: '01_WORKING',
        },
      },
    });
    expect(saved.statusCode).toBe(201);

    const reloaded = await app.inject({
      method: 'GET',
      url: `/api/folder-profiles/catalog/${profileId}`,
    });
    const profile = reloaded.json<{
      data: {
        outputDefaults: Array<{ outputTypeId: string; destinationProfileFolderId: string }>;
        folders: Array<{ profileFolderId: string; name: string }>;
      };
    }>().data;
    const custom = profile.outputDefaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'CustomDeliverable',
    );
    expect(custom).toBeDefined();
    const extraFolder = profile.folders.find((folder) => folder.name === '03_EXTRA');
    expect(custom?.destinationProfileFolderId).toBe(extraFolder?.profileFolderId);
    const workingFolder = profile.folders.find((folder) => folder.name === '01_WORKING');
    const scheduleExcel = profile.outputDefaults.find(
      (outputDefault) => outputDefault.outputTypeId === 'scheduleExcel',
    );
    expect(scheduleExcel?.destinationProfileFolderId).toBe(workingFolder?.profileFolderId);
  });

  it('keeps concurrent valid mutations and failed imports safe', async () => {
    const { app, store } = await setup();
    insertHistoricalRow(store, 'Old Facade Profile', [{ name: '01_RECEIVED', children: [] }], {
      scheduleExcel: '01_RECEIVED',
    });

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog',
        payload: { ...createInput('Concurrent Alpha'), description: 'A' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog',
        payload: { ...createInput('Concurrent Beta'), description: 'B' },
      }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const [imported, created] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog/import',
        payload: { name: 'Old Facade Profile' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/folder-profiles/catalog',
        payload: createInput('Concurrent Gamma'),
      }),
    ]);
    expect(imported.statusCode).toBe(201);
    expect(created.statusCode).toBe(201);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog/import',
      payload: { name: 'Never Existed' },
    });
    expect(failed.statusCode).toBe(404);
    const afterFailed = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput('After Failure'),
    });
    expect(afterFailed.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const names = list
      .json<{ data: { profiles: Array<{ name: string }> } }>()
      .data.profiles.map((profile) => profile.name);
    for (const name of [
      'Concurrent Alpha',
      'Concurrent Beta',
      'Concurrent Gamma',
      'After Failure',
      'Old Facade Profile',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('keeps default mutations coherent with profile mutations', async () => {
    const { app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput(),
    });
    const profileId = created.json<{ data: { profileId: string } }>().data.profileId;

    await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'factory', factoryProfileKey: 'essential' },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${profileId}`,
    });
    expect(deleted.statusCode).toBe(200);
    const afterDelete = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    expect(
      afterDelete.json<{ data: { defaultProfileRef: { kind: string } } }>().data.defaultProfileRef,
    ).toEqual({ kind: 'factory', factoryProfileKey: 'essential' });

    const second = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: createInput('Default Target'),
    });
    const secondId = second.json<{ data: { profileId: string } }>().data.profileId;
    await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'user', profileId: secondId },
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${secondId}`,
    });
    const cleared = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    expect(
      cleared.json<{ data: { defaultProfileRef: { kind: string } } }>().data.defaultProfileRef,
    ).toEqual({
      kind: 'blank',
    });
  });
});
