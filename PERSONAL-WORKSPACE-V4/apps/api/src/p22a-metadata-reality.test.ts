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
    STANDALONE_SESSION_SECRET: 'p22a-reality-secret-that-is-longer-than-thirty-two-characters',
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

describe('P2.2A metadata reality check', () => {
  it('edits personal metadata through the real API path and survives close/reopen', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p22a-reality-'));
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
        projectType: 'Lighting Layout',
        description: 'P2.2A reality check.',
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
    const projectId = created.project.id;
    const projectCode = created.project.projectCode;
    const folderPath = created.folderCreation?.folderPath ?? null;

    expect(projectId).toMatch(uuidPattern);
    expect(projectCode).toBe('001_SCT260807_DUBAI_HILLS_VILLA');
    expect(created.project.crmReference).toBe('CRM-48572');
    expect(folderPath).toBeTruthy();
    expect(existsSync(folderPath ?? '')).toBe(true);

    const luminaireResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: { tag: 'DL01', category: 'Downlight', quantity: 12 },
    });
    expect(luminaireResponse.statusCode).toBe(201);
    const luminaireId = luminaireResponse.json<{ data: { id: string } }>().data.id;

    const editResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      payload: {
        projectName: 'Dubai Hills Villa - Updated',
        clientName: 'Al Barari Client',
        crmReference: 'CRM-99110',
        projectType: 'Lux Calculations',
        description: 'Updated villa lighting design and documentation.',
        siteLocation: 'Dubai Hills, Al Barari',
        designStage: 'DetailedDesign',
        lightingScope: 'Interior, landscape and facade lighting design.',
        luxRequirements: '500 lux at working plane.',
        drawingReference: 'L-101 Rev B',
        priority: 'High',
        complexity: 'Large',
        estimatedHours: 40,
        progressPercent: 30,
        requiredDeliveryDate: '2026-09-15',
        expectedVersion: 1,
      },
    });
    expect(editResponse.statusCode).toBe(200);
    const edited = editResponse.json<{
      data: {
        id: string;
        projectCode: string;
        projectName: string;
        clientName: string;
        crmReference: string | null;
        projectType: string;
        description: string;
        siteLocation: string;
        designStage: string;
        lightingScope: string;
        luxRequirements: string;
        drawingReference: string;
        priority: string;
        complexity: string;
        estimatedHours: number;
        actualHours: number;
        progressPercent: number;
        requiredDeliveryDate: string;
        version: number;
      };
    }>().data;
    expect(edited.id).toBe(projectId);
    expect(edited.projectCode).toBe(projectCode);
    expect(edited).toMatchObject({
      projectName: 'Dubai Hills Villa - Updated',
      clientName: 'Al Barari Client',
      crmReference: 'CRM-99110',
      projectType: 'Lux Calculations',
      description: 'Updated villa lighting design and documentation.',
      siteLocation: 'Dubai Hills, Al Barari',
      designStage: 'DetailedDesign',
      lightingScope: 'Interior, landscape and facade lighting design.',
      luxRequirements: '500 lux at working plane.',
      drawingReference: 'L-101 Rev B',
      priority: 'High',
      complexity: 'Large',
      estimatedHours: 40,
      // P2.8C: actualHours is no longer directly editable through the Personal
      // metadata path, so it is NOT part of this edit and remains 0.
      actualHours: 0,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
      version: 2,
    });

    // Close/reopen: a fresh provider + store over the same database must preserve the edits.
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
      url: `/api/projects/${projectId}`,
    });
    expect(getResponse.statusCode).toBe(200);
    const persisted = getResponse.json<{
      data: {
        id: string;
        projectCode: string;
        projectName: string;
        crmReference: string | null;
        designStage: string;
        priority: string;
        estimatedHours: number;
        actualHours: number;
        progressPercent: number;
        requiredDeliveryDate: string;
      };
    }>().data;
    expect(persisted.id).toBe(projectId);
    expect(persisted.projectCode).toBe(projectCode);
    expect(persisted).toMatchObject({
      projectName: 'Dubai Hills Villa - Updated',
      crmReference: 'CRM-99110',
      designStage: 'DetailedDesign',
      priority: 'High',
      estimatedHours: 40,
      // P2.8C: actualHours is no longer directly editable through the Personal
      // metadata path; it remains the baseline 0 here.
      actualHours: 0,
      progressPercent: 30,
      requiredDeliveryDate: '2026-09-15',
    });

    const searchResponse = await reopened.inject({
      method: 'GET',
      url: '/api/projects?search=CRM-99110',
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(
      searchResponse.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id),
    ).toContain(projectId);

    const workspaceResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json<{
      data: { folderPath: string | null; luminaires: Array<{ id: string }> };
    }>().data;
    expect(workspace.folderPath).toBe(folderPath);
    expect(existsSync(workspace.folderPath ?? '')).toBe(true);
    expect(workspace.luminaires.map((item) => item.id)).toContain(luminaireId);

    const activityResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/activity`,
    });
    expect(activityResponse.statusCode).toBe(200);
    const activity = activityResponse.json<{ data: Array<{ fieldName: string | null }> }>().data;
    expect(activity.map((item) => item.fieldName)).toEqual(
      expect.arrayContaining([
        'projectName',
        'clientName',
        'crmReference',
        'projectType',
        'description',
        'siteLocation',
        'designStage',
        'lightingScope',
        'luxRequirements',
        'drawingReference',
        'priority',
        'complexity',
        'estimatedHours',
        'progressPercent',
        'requiredDeliveryDate',
      ]),
    );
  });
});
