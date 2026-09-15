import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { LegacyProjectImportInput } from '@scli/contracts';
import { LegacyProjectImportService, scanProjectFolder } from './legacy-project-import-service';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const temporaryDirectories: string[] = [];
const closeables: Array<{ close(): void }> = [];

function makeDirectory(name: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), name));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const resource of closeables.splice(0).reverse()) resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('legacy project discovery and indexing', () => {
  it('recognizes SCLI project folders and classifies their file metadata', async () => {
    const directory = makeDirectory('scli-legacy-preview-');
    const root = path.join(directory, '001_MY_PROJECTS');
    const projectFolder = path.join(root, '001_SCLI250919_ARKOS');
    mkdirSync(path.join(root, '000_TEMPLETS'), { recursive: true });
    mkdirSync(path.join(projectFolder, '03_DRAWINGS'), { recursive: true });
    mkdirSync(path.join(projectFolder, '02_DIALUX'), { recursive: true });
    mkdirSync(path.join(projectFolder, '04_3D', 'RENDERS'), { recursive: true });
    mkdirSync(path.join(projectFolder, '08_DATASHEETS'), { recursive: true });
    writeFileSync(path.join(projectFolder, '03_DRAWINGS', 'Lighting Layout.dwg'), 'dwg');
    writeFileSync(path.join(projectFolder, '02_DIALUX', 'ARKOS.evo'), 'evo');
    writeFileSync(path.join(projectFolder, '04_3D', 'RENDERS', 'Lobby.png'), 'png');
    writeFileSync(path.join(projectFolder, '08_DATASHEETS', 'DL01 Datasheet.pdf'), 'pdf');
    writeFileSync(path.join(projectFolder, 'Technical BOQ.xlsx'), 'xlsx');

    const config = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(directory, 'scli.sqlite'),
      STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_NAME: 'Local Admin',
      STANDALONE_ADMIN_EMAIL: 'admin@local.test',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const service = new LegacyProjectImportService(provider, store);

    const preview = await service.preview(root);
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      recognized: true,
      sequenceNumber: 1,
      projectDate: '2025-09-19',
      projectCode: '001_SCLI250919_ARKOS',
      projectName: 'ARKOS',
    });
    expect(preview.nextProjectNumber).toBe(2);

    const index = scanProjectFolder(projectFolder);
    expect(index).toMatchObject({
      fileCount: 5,
      truncated: false,
      counts: {
        Drawings: 1,
        Dialux: 1,
        Renderings: 1,
        TechnicalBoq: 1,
        Datasheets: 1,
      },
    });
  });

  it('recognizes current SCT project folders without renaming them', async () => {
    const directory = makeDirectory('scli-sct-preview-');
    const root = path.join(directory, '001_MY_PROJECTS');
    const projectFolder = path.join(root, '023_SCT260807_DUBAI_HILLS_VILLA');
    mkdirSync(projectFolder, { recursive: true });

    const config = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(directory, 'scli.sqlite'),
      STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_NAME: 'Local Admin',
      STANDALONE_ADMIN_EMAIL: 'admin@local.test',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const service = new LegacyProjectImportService(provider, store);

    const preview = await service.preview(root);
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      recognized: true,
      sequenceNumber: 23,
      projectDate: '2026-08-07',
      projectCode: '023_SCT260807_DUBAI_HILLS_VILLA',
      projectName: 'DUBAI HILLS VILLA',
      warnings: [],
    });
  });

  it('imports the exact legacy code, links the original folder, and advances the sequence', async () => {
    const directory = makeDirectory('scli-legacy-import-');
    const root = path.join(directory, '001_MY_PROJECTS');
    const folderName = '020_SCLI251211_Rahayel';
    const projectFolder = path.join(root, folderName);
    mkdirSync(projectFolder, { recursive: true });
    writeFileSync(path.join(projectFolder, 'Rahayel Lighting Layout.dwg'), 'dwg');

    const config = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(directory, 'scli.sqlite'),
      STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_NAME: 'Local Admin',
      STANDALONE_ADMIN_EMAIL: 'admin@local.test',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const service = new LegacyProjectImportService(provider, store);
    const actor = (await provider.listUsers()).find((user) => user.role === 'Admin');
    if (!actor) throw new Error('Missing standalone admin.');

    const input: LegacyProjectImportInput = {
      rootPath: root,
      projects: [
        {
          folderName,
          folderPath: projectFolder,
          projectCode: folderName,
          projectName: 'Rahayel',
          clientName: 'Legacy Client',
          projectType: 'Lighting Design',
          salesOwnerId: null,
          status: 'Archived',
          services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
          siteLocation: '',
          designStage: 'AsBuilt',
          lightingScope: 'Existing project imported from disk.',
          priority: 'Normal',
          createdDate: '2025-12-11',
          requiredDeliveryDate: '2025-12-11',
          indexFiles: true,
        },
      ],
    };
    const result = await service.importProjects(actor, input);
    const project = await provider.getProject(result.imported[0]!.projectId);

    expect(result).toMatchObject({ nextProjectNumber: 21, imported: [{ fileCount: 1 }] });
    expect(project).toMatchObject({
      projectCode: folderName,
      projectName: 'Rahayel',
      status: 'Archived',
      projectFolderPath: projectFolder,
      isLegacyProject: true,
      legacyFolderName: folderName,
      folderFileCount: 1,
    });
    expect(store.getWorkspace(project!.id).folderPath).toBe(projectFolder);
    expect(store.getFolderIndex(project!.id).counts.Drawings).toBe(1);
    expect(await provider.allocateProjectNumber()).toBe(21);
  });
});
