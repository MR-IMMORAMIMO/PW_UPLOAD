import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    STANDALONE_SESSION_SECRET: 'p29b-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
  });
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('P2.9B legacy import compatibility reality', () => {
  it('imports a legacy project preserving metadata, baseline actualHours, and no fabricated history', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p29b-reality-'));
    temporaryDirectories.push(directory);
    const root = path.join(directory, '001_MY_PROJECTS');
    const legacyFolder = path.join(root, '042_SCLI260802_LEGACY_VILLA');
    mkdirSync(path.join(legacyFolder, '03_DRAWINGS'), { recursive: true });
    writeFileSync(path.join(legacyFolder, '03_DRAWINGS', 'Villa Lighting Layout.dwg'), 'dwg');
    const config = makeConfig(path.join(directory, 'reality.sqlite'), root);

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

    // Preview to recognize the folder.
    const preview = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/preview',
      payload: { rootPath: root },
    });
    expect(preview.statusCode).toBe(200);
    const candidate = preview
      .json<{ data: { candidates: Array<{ folderPath: string; projectCode: string }> } }>()
      .data.candidates.find((item) => item.folderPath === legacyFolder);
    if (!candidate) throw new Error('Legacy folder not recognized.');

    // Import with the new compatibility fields.
    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: {
        rootPath: root,
        projects: [
          {
            folderName: '042_SCLI260802_LEGACY_VILLA',
            folderPath: legacyFolder,
            projectCode: candidate.projectCode,
            projectName: 'Legacy Villa',
            clientName: 'Legacy Client',
            projectType: 'Hospital',
            crmReference: 'CRM-LEGACY-1',
            commercialValueMinor: 12_500_050,
            commercialCurrency: 'AED',
            actualHours: 12.5,
            salesOwnerId: null,
            status: 'Archived',
            services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
            siteLocation: 'Dubai',
            designStage: 'AsBuilt',
            lightingScope: 'Legacy lighting project',
            priority: 'Normal',
            createdDate: '2026-08-02',
            requiredDeliveryDate: '2026-08-02',
            indexFiles: false,
          },
        ],
      },
    });
    expect(importResponse.statusCode).toBe(201);
    const imported = importResponse.json<{
      data: { imported: Array<{ projectId: string; projectCode: string }> };
    }>().data.imported[0]!;

    // 1) New UUID, 2) projectCode preserved, 3) folder linked in place.
    expect(imported.projectId).toMatch(uuidPattern);
    expect(imported.projectCode).toBe(candidate.projectCode);

    const project = await provider.getProject(imported.projectId);
    if (!project) throw new Error('Imported project missing.');
    expect(project.projectFolderPath).toBe(legacyFolder);
    // 4) projectType from draft.
    expect(project.projectType).toBe('Hospital');
    // 5) CRM Reference round-trips.
    expect(project.crmReference).toBe('CRM-LEGACY-1');
    // 6) Commercial value valid pair persists exactly.
    expect(project.commercialValueMinor).toBe(12_500_050);
    expect(project.commercialCurrency).toBe('AED');
    // 8) actualHours baseline persists exactly.
    expect(project.actualHours).toBe(12.5);
    // Legacy source has no equivalent field, so project configuration remains historically absent.
    expect(project).not.toHaveProperty('luminaireInputMode');
    // 9+10) No WorkSessions fabricated; zero rows.
    expect(store.listWorkSessions(imported.projectId)).toEqual([]);
    // 12+13) No workflow transitions or revision cycles fabricated.
    expect(store.listWorkflowTransitions(imported.projectId)).toEqual([]);
    expect(store.listRevisionCycles(imported.projectId)).toEqual([]);
    // 14) Truthful LegacyImported activity preserved.
    const activities = await provider.listActivities(imported.projectId);
    expect(activities.some((activity) => activity.actionType === 'LegacyImported')).toBe(true);
  });

  it('imports a legacy project with absent optional fields using safe defaults', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p29b-reality-'));
    temporaryDirectories.push(directory);
    const root = path.join(directory, '001_MY_PROJECTS');
    const legacyFolder = path.join(root, '043_SCLI260802_LEGACY_BARE');
    mkdirSync(legacyFolder, { recursive: true });
    const config = makeConfig(path.join(directory, 'reality.sqlite'), root);

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

    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: {
        rootPath: root,
        projects: [
          {
            folderName: '043_SCLI260802_LEGACY_BARE',
            folderPath: legacyFolder,
            projectCode: '043_SCLI260802_LEGACY_BARE',
            projectName: 'Legacy Bare',
            clientName: 'Not recorded',
            salesOwnerId: null,
            status: 'Archived',
            services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
            siteLocation: 'Not recorded',
            designStage: 'AsBuilt',
            lightingScope: 'Legacy lighting project',
            priority: 'Normal',
            createdDate: '2026-08-02',
            requiredDeliveryDate: '2026-08-02',
            indexFiles: false,
          },
        ],
      },
    });
    expect(importResponse.statusCode).toBe(201);
    const imported = importResponse.json<{
      data: { imported: Array<{ projectId: string }> };
    }>().data.imported[0]!;
    const project = await provider.getProject(imported.projectId);
    if (!project) throw new Error('Imported project missing.');
    // 7) Commercial value absent remains absent.
    expect(project.commercialValueMinor).toBeNull();
    expect(project.commercialCurrency).toBeNull();
    expect(project.crmReference).toBeNull();
    // No actualHours provided -> safe default 0.
    expect(project.actualHours).toBe(0);
    expect(project).not.toHaveProperty('luminaireInputMode');
    // projectType default preserved.
    expect(project.projectType).toBe('Legacy Project');
  });

  it('rejects invalid legacy import compatibility payloads', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p29b-reality-'));
    temporaryDirectories.push(directory);
    const root = path.join(directory, '001_MY_PROJECTS');
    const legacyFolder = path.join(root, '044_SCLI260802_LEGACY_INVALID');
    mkdirSync(legacyFolder, { recursive: true });
    const config = makeConfig(path.join(directory, 'reality.sqlite'), root);

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

    const base = {
      folderName: '044_SCLI260802_LEGACY_INVALID',
      folderPath: legacyFolder,
      projectCode: '044_SCLI260802_LEGACY_INVALID',
      projectName: 'Legacy Invalid',
      clientName: 'Not recorded',
      salesOwnerId: null,
      status: 'Archived',
      services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      siteLocation: 'Not recorded',
      designStage: 'AsBuilt',
      lightingScope: 'Legacy lighting project',
      priority: 'Normal',
      createdDate: '2026-08-02',
      requiredDeliveryDate: '2026-08-02',
      indexFiles: false,
    };

    // Half commercial pair rejected.
    const halfPair = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: { rootPath: root, projects: [{ ...base, commercialValueMinor: 100 }] },
    });
    expect(halfPair.statusCode).toBe(400);

    // Negative commercial amount rejected.
    const negative = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: {
        rootPath: root,
        projects: [{ ...base, commercialValueMinor: -5, commercialCurrency: 'AED' }],
      },
    });
    expect(negative.statusCode).toBe(400);

    // Malformed currency rejected.
    const badCurrency = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: {
        rootPath: root,
        projects: [{ ...base, commercialValueMinor: 100, commercialCurrency: 'aed' }],
      },
    });
    expect(badCurrency.statusCode).toBe(400);

    // Negative actualHours rejected.
    const badHours = await app.inject({
      method: 'POST',
      url: '/api/personal/legacy-projects/import',
      payload: { rootPath: root, projects: [{ ...base, actualHours: -1 }] },
    });
    expect(badHours.statusCode).toBe(400);
  });
});
