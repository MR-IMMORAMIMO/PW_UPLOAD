import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import type { FolderNodePreset, ProjectOutputFolders } from '@scli/domain';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { PersonalWorkspaceStore, type WorkspaceWithScope } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');

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
    STANDALONE_SESSION_SECRET: 'p24b2-reality-secret-that-is-longer-than-thirty-two-characters',
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

const realityFolders: FolderNodePreset[] = [
  { name: '00_RECEIVED', children: [] },
  { name: '01_WORKING', children: [] },
  { name: '03_DRAWINGS', children: [] },
  {
    name: '04_TECHNICAL',
    children: [
      { name: 'DATASHEETS', children: [] },
      { name: 'BOQ', children: [] },
    ],
  },
  { name: '05_DELIVERABLES', children: [] },
];

const realityOutputs: ProjectOutputFolders = {
  scheduleExcel: '05_DELIVERABLES',
  schedulePdf: '05_DELIVERABLES',
  boqExcel: '04_TECHNICAL/BOQ',
  boqPdf: '04_TECHNICAL/BOQ',
  datasheets: '04_TECHNICAL/DATASHEETS',
};

async function createRealityProject(app: FastifyInstance, config: AppConfig) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      projectName: 'Dubai Hills Villa',
      clientName: 'Private Client',
      projectType: 'Villa Lighting Design',
      description: 'P2.4B2 reality check.',
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
      folderStructure: realityFolders,
      outputFolders: realityOutputs,
      services: ['LightingDesign', 'TechnicalBoq', 'Datasheets'],
      scopeItems: [
        { code: 'LightingDesign', label: 'Lighting Design', custom: false },
        { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
        { code: 'Datasheets', label: 'Datasheets Package', custom: false },
      ],
      luminaireInputMode: 'Later',
      crmReference: 'CRM-48572',
      idempotencyKey: randomUUID(),
    },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json<{
    data: {
      project: { id: string; projectCode: string; crmReference: string | null };
      workspace: WorkspaceWithScope;
      folderCreation: { folderPath: string } | null;
    };
  }>().data;
  const folderPath = data.folderCreation?.folderPath ?? '';
  expect(folderPath).toBeTruthy();
  return { projectId: data.project.id, projectCode: data.project.projectCode, folderPath };
}

async function getWorkspace(app: FastifyInstance, projectId: string): Promise<WorkspaceWithScope> {
  const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/workspace` });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: WorkspaceWithScope }>().data;
}

function folderIdByName(snapshot: WorkspaceWithScope['folderSnapshot'], name: string): string {
  const node = snapshot.folders.find((folder) => folder.name === name);
  if (!node) throw new Error(`Missing folder ${name}`);
  return node.folderId;
}

function action(
  projectId: string,
  body: Record<string, unknown>,
): { method: 'POST'; url: string; payload: Record<string, unknown> } {
  return { method: 'POST', url: `/api/projects/${projectId}/folder-actions`, payload: body };
}

describe('P2.4B2 controlled folder structure editor reality check', () => {
  it('runs the full A-K reality scenario on synthetic data', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-reality-'));
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
    const created = await createRealityProject(app, config);
    const { projectId, folderPath } = created;
    let workspace = await getWorkspace(app, projectId);

    const f3Id = folderIdByName(workspace.folderSnapshot, '03_DRAWINGS');
    const f4Id = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const f5Id = folderIdByName(workspace.folderSnapshot, 'DATASHEETS');
    const f6Id = folderIdByName(workspace.folderSnapshot, 'BOQ');
    const f7Id = folderIdByName(workspace.folderSnapshot, '05_DELIVERABLES');
    const f1Id = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    // Seed files under F3 and F5.
    writeFileSync(path.join(folderPath, '03_DRAWINGS', 'layout.dwg'), 'dwg');
    writeFileSync(path.join(folderPath, '04_TECHNICAL', 'DATASHEETS', 'ds.pdf'), 'pdf');

    // A) Add MOCKUP under F4.
    const addResponse = await app.inject(
      action(projectId, {
        action: 'add',
        parentFolderId: f4Id,
        name: 'MOCKUP',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(addResponse.statusCode).toBe(200);
    const mockupId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    expect(existsSync(path.join(folderPath, '04_TECHNICAL', 'MOCKUP'))).toBe(true);
    workspace = await getWorkspace(app, projectId);

    // B) Reorder siblings without path changes.
    const reorderResponse = await app.inject(
      action(projectId, {
        action: 'reorder',
        folderId: f1Id,
        newDisplayOrder: 2,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(reorderResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, projectId);
    const reordered = workspace.folderSnapshot.folders.find((folder) => folder.folderId === f1Id);
    expect(reordered?.displayOrder).toBe(2);
    expect(existsSync(path.join(folderPath, '00_RECEIVED'))).toBe(true);

    // C) Rename F3 with a file present.
    const renamePreview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions/preview`,
      payload: { action: 'rename', folderId: f3Id, name: '03_LIGHTING_DRAWINGS' },
    });
    expect(renamePreview.statusCode).toBe(200);
    const previewData = renamePreview.json<{
      data: {
        currentRelativePath: string;
        proposedRelativePath: string;
        containsEntries: boolean;
        warnings: string[];
      };
    }>().data;
    expect(previewData.currentRelativePath).toBe('03_DRAWINGS');
    expect(previewData.proposedRelativePath).toBe('03_LIGHTING_DRAWINGS');
    expect(previewData.containsEntries).toBe(true);
    expect(previewData.warnings.length).toBeGreaterThan(0);

    const renameResponse = await app.inject(
      action(projectId, {
        action: 'rename',
        folderId: f3Id,
        name: '03_LIGHTING_DRAWINGS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(renameResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, projectId);
    const renamed = workspace.folderSnapshot.folders.find((folder) => folder.folderId === f3Id);
    expect(renamed?.name).toBe('03_LIGHTING_DRAWINGS');
    expect(renamed?.folderId).toBe(f3Id);
    expect(existsSync(path.join(folderPath, '03_LIGHTING_DRAWINGS', 'layout.dwg'))).toBe(true);
    const indexResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/file-index`,
    });
    const indexItems = indexResponse.json<{ data: { items: Array<{ relativePath: string }> } }>()
      .data.items;
    expect(
      indexItems.some((item) =>
        item.relativePath.replaceAll('\\', '/').startsWith('03_LIGHTING_DRAWINGS/'),
      ),
    ).toBe(true);

    // D) Move MOCKUP from F4 to F7 with the same folderId.
    const moveResponse = await app.inject(
      action(projectId, {
        action: 'move',
        folderId: mockupId,
        newParentFolderId: f7Id,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(moveResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, projectId);
    const moved = workspace.folderSnapshot.folders.find((folder) => folder.folderId === mockupId);
    expect(moved?.parentFolderId).toBe(f7Id);
    expect(moved?.folderId).toBe(mockupId);
    expect(existsSync(path.join(folderPath, '05_DELIVERABLES', 'MOCKUP'))).toBe(true);
    expect(existsSync(path.join(folderPath, '04_TECHNICAL', 'MOCKUP'))).toBe(false);

    // E) Disable an unmapped folder; physical data remains.
    const disableResponse = await app.inject(
      action(projectId, {
        action: 'disable',
        folderId: f1Id,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(disableResponse.statusCode).toBe(200);
    expect(existsSync(path.join(folderPath, '00_RECEIVED'))).toBe(true);
    workspace = await getWorkspace(app, projectId);
    expect(
      workspace.folderSnapshot.folders.find((folder) => folder.folderId === f1Id)?.enabled,
    ).toBe(false);

    // F) Disable F6 must be rejected because TechnicalBoq maps to F6.
    const disableMapped = await app.inject(
      action(projectId, {
        action: 'disable',
        folderId: f6Id,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(disableMapped.statusCode).toBe(409);

    // G) Create TEMP_EMPTY and delete it.
    const tempAdd = await app.inject(
      action(projectId, {
        action: 'add',
        parentFolderId: f4Id,
        name: 'TEMP_EMPTY',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(tempAdd.statusCode).toBe(200);
    const tempId = tempAdd.json<{ data: { folderId: string } }>().data.folderId;
    workspace = await getWorkspace(app, projectId);
    const tempDelete = await app.inject(
      action(projectId, {
        action: 'delete-empty',
        folderId: tempId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(tempDelete.statusCode).toBe(200);
    expect(existsSync(path.join(folderPath, '04_TECHNICAL', 'TEMP_EMPTY'))).toBe(false);
    workspace = await getWorkspace(app, projectId);

    // H) Delete F5 must be rejected: it contains a file and is mapped.
    const deleteMapped = await app.inject(
      action(projectId, {
        action: 'delete-empty',
        folderId: f5Id,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(deleteMapped.statusCode).toBe(409);
    expect(existsSync(path.join(folderPath, '04_TECHNICAL', 'DATASHEETS', 'ds.pdf'))).toBe(true);

    // I) Close/reopen: canonical IDs, order, parentage, enabled states, and mappings persist.
    const snapshotBeforeClose = workspace.folderSnapshot;
    const mappingsBeforeClose = workspace.outputMappings;
    const reopenResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(reopenResponse.statusCode).toBe(200);
    const reopened = reopenResponse.json<{ data: WorkspaceWithScope }>().data;
    expect(reopened.folderSnapshot.folders).toEqual(snapshotBeforeClose.folders);
    expect(reopened.outputMappings).toEqual(mappingsBeforeClose);
    expect(reopened.folderSnapshot.folders.find((folder) => folder.folderId === f3Id)?.name).toBe(
      '03_LIGHTING_DRAWINGS',
    );
    expect(
      reopened.folderSnapshot.folders.find((folder) => folder.folderId === mockupId)
        ?.parentFolderId,
    ).toBe(f7Id);
    expect(
      reopened.folderSnapshot.folders.find((folder) => folder.folderId === f1Id)?.enabled,
    ).toBe(false);

    // J) Stale action with an old fingerprint must be rejected before disk mutation.
    const stale = await app.inject(
      action(projectId, {
        action: 'add',
        parentFolderId: null,
        name: '07_STALE',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(stale.statusCode).toBe(200);
    const staleFingerprint = workspace.folderConfigurationFingerprint;
    const staleAction = await app.inject(
      action(projectId, {
        action: 'add',
        parentFolderId: null,
        name: '08_STALE_TOO',
        expectedFolderConfigurationFingerprint: staleFingerprint,
      }),
    );
    expect(staleAction.statusCode).toBe(409);
    expect(staleAction.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');
    expect(existsSync(path.join(folderPath, '08_STALE_TOO'))).toBe(false);
  });

  it('keeps legacy projects read-only on preview and canonicalizes only on a successful explicit mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-reality-legacy-'));
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
    const created = await createRealityProject(app, config);
    const legacyFolders = [
      '00_RECEIVED',
      '01_WORKING',
      '03_DRAWINGS',
      '04_TECHNICAL/DATASHEETS',
      '04_TECHNICAL/BOQ',
      '05_DELIVERABLES',
      '99_UNKNOWN_LEGACY',
    ];
    const legacyOutputs = {
      scheduleExcel: '05_DELIVERABLES',
      schedulePdf: '05_DELIVERABLES',
      boqExcel: '04_TECHNICAL/BOQ',
      boqPdf: '04_TECHNICAL/BOQ',
      datasheets: '04_TECHNICAL/DATASHEETS',
      customOutput: '00_RECEIVED',
    };
    const db = new DatabaseSync(config.STANDALONE_DB_PATH);
    try {
      db.prepare(
        'UPDATE project_workspaces SET folders_json = ?, output_folders_json = ? WHERE project_id = ?',
      ).run(JSON.stringify(legacyFolders), JSON.stringify(legacyOutputs), created.projectId);
    } finally {
      db.close();
    }
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions/preview`,
      payload: { action: 'rename', folderId: receivedId, name: '00_INPUT' },
    });
    expect(preview.statusCode).toBe(200);
    const rawDb = new DatabaseSync(config.STANDALONE_DB_PATH);
    let stored = '';
    try {
      const row = rawDb
        .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
        .get(created.projectId) as { folders_json: string };
      stored = row.folders_json;
    } finally {
      rawDb.close();
    }
    expect(stored.includes('schemaVersion')).toBe(false);

    const addResponse = await app.inject(
      action(created.projectId, {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    );
    expect(addResponse.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    expect(after.folderSnapshot.folders.some((folder) => folder.name === '99_UNKNOWN_LEGACY')).toBe(
      true,
    );
    expect(after.outputMappings.some((mapping) => mapping.outputTypeId === 'customOutput')).toBe(
      true,
    );
    const rawDb2 = new DatabaseSync(config.STANDALONE_DB_PATH);
    try {
      const row = rawDb2
        .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
        .get(created.projectId) as { folders_json: string };
      stored = row.folders_json;
    } finally {
      rawDb2.close();
    }
    expect(stored.includes('schemaVersion')).toBe(true);
  });
});
