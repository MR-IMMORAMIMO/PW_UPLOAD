import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'reality-check-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('P2.1A user-visible reality check', () => {
  it('creates an SCT project with CRM through the real Personal API path', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p21a-reality-'));
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

    const profilesResponse = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    expect(profilesResponse.statusCode).toBe(200);
    const profile = profilesResponse
      .json<{ data: Array<{ name: string; folders: unknown; outputFolders: unknown }> }>()
      .data.find((candidate) => candidate.name === 'Full Lighting Design');
    if (!profile) throw new Error('Missing Full Lighting Design folder profile.');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Dubai Hills Villa',
        clientName: 'Reality Client',
        projectType: 'Villa Lighting Design',
        description: 'P2.1A reality check.',
        siteLocation: 'Dubai Hills',
        designStage: 'Concept',
        lightingScope: 'Complete villa lighting design and documentation.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 24,
        requiredDeliveryDate: '2026-08-20',
        createFolders: true,
        projectRoot: config.PERSONAL_PROJECT_ROOT,
        folderProfile: 'Full Lighting Design',
        folderStructure: profile.folders,
        outputFolders: profile.outputFolders,
        services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        luminaireInputMode: 'Later',
        crmReference: 'CRM-48572',
        idempotencyKey: randomUUID(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      data: {
        project: { id: string; projectCode: string; crmReference: string | null };
        folderCreation: {
          folderName: string;
          folderPath: string;
          createdFolderCount: number;
        } | null;
      };
    }>().data;

    expect(created.project.id).toMatch(uuidPattern);
    expect(created.project.projectCode).toBe('001_SCT260807_DUBAI_HILLS_VILLA');
    expect(created.project.crmReference).toBe('CRM-48572');
    expect(created.folderCreation?.folderName).toBe(created.project.projectCode);
    expect(existsSync(created.folderCreation?.folderPath ?? '')).toBe(true);
    expect(path.basename(created.folderCreation?.folderPath ?? '')).toBe(
      created.project.projectCode,
    );

    // Close/reopen: a fresh provider + store over the same database must preserve CRM.
    const reopenedProvider = new StandaloneDataProvider(config);
    const reopenedStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenedProvider, reopenedStore);
    const reopened = await createApp({
      config,
      provider: reopenedProvider,
      personalStore: reopenedStore,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(reopened);

    const getResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${created.project.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json<{ data: { crmReference: string | null } }>().data.crmReference).toBe(
      'CRM-48572',
    );

    const searchResponse = await reopened.inject({
      method: 'GET',
      url: '/api/projects?search=CRM-48572',
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(
      searchResponse.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id),
    ).toContain(created.project.id);

    const withoutCrmResponse = await reopened.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'No CRM Villa',
        clientName: 'Reality Client',
        projectType: 'Villa Lighting Design',
        description: 'P2.1A reality check without CRM.',
        siteLocation: 'Dubai Hills',
        designStage: 'Concept',
        lightingScope: 'Complete villa lighting design and documentation.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 24,
        requiredDeliveryDate: '2026-08-20',
        createFolders: false,
        folderProfile: 'Full Lighting Design',
        services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        luminaireInputMode: 'Later',
        idempotencyKey: randomUUID(),
      },
    });
    expect(withoutCrmResponse.statusCode).toBe(201);
    expect(
      withoutCrmResponse.json<{
        data: { project: { crmReference: string | null; projectCode: string } };
      }>().data.project.crmReference,
    ).toBeNull();
  });
});
