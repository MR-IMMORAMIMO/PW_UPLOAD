import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import {
  deriveFolderRelativePath,
  type FolderNodePreset,
  type OutputMapping,
  type Project,
  type ProjectFolderSnapshot,
  type ProjectOutputFolders,
} from '@scli/domain';
import { folderActionSchema } from '@scli/contracts';
import { TEST_FUTURE_REQUIRED_DELIVERY_DATE } from '../../../tests/test-authority';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { PersonalWorkspaceStore, type WorkspaceWithScope } from './personal-workspace-store';
import { ProjectFolderService } from './project-folder-service';
import { ProjectFolderStructureService } from './project-folder-structure-service';
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

const syntheticFolders: FolderNodePreset[] = [
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

const syntheticOutputs: ProjectOutputFolders = {
  scheduleExcel: '05_DELIVERABLES',
  schedulePdf: '05_DELIVERABLES',
  boqExcel: '04_TECHNICAL/BOQ',
  boqPdf: '04_TECHNICAL/BOQ',
  datasheets: '04_TECHNICAL/DATASHEETS',
};

interface CreatedProject {
  project: Project;
  projectId: string;
  projectCode: string;
  folderPath: string;
  workspace: WorkspaceWithScope;
}

async function createSyntheticProject(
  app: FastifyInstance,
  config: AppConfig,
  overrides: Record<string, unknown> = {},
): Promise<CreatedProject> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      projectName: 'Dubai Hills Villa',
      clientName: 'Private Client',
      projectType: 'Villa Lighting Design',
      description: 'P2.4B2 test project.',
      siteLocation: 'Dubai Hills',
      designStage: 'Concept',
      lightingScope: 'Complete villa lighting design and documentation.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 24,
      requiredDeliveryDate: TEST_FUTURE_REQUIRED_DELIVERY_DATE,
      createFolders: true,
      projectRoot: config.PERSONAL_PROJECT_ROOT,
      folderProfile: 'Full Lighting Design',
      folderStructure: syntheticFolders,
      outputFolders: syntheticOutputs,
      services: ['LightingDesign', 'TechnicalBoq', 'Datasheets'],
      scopeItems: [
        { code: 'LightingDesign', label: 'Lighting Design', custom: false },
        { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
        { code: 'Datasheets', label: 'Datasheets Package', custom: false },
      ],
      luminaireInputMode: 'Later',
      crmReference: 'CRM-48572',
      idempotencyKey: randomUUID(),
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json<{
    data: {
      project: Project;
      workspace: WorkspaceWithScope;
      folderCreation: { folderPath: string } | null;
    };
  }>().data;
  const folderPath = data.folderCreation?.folderPath ?? '';
  expect(folderPath).toBeTruthy();
  return {
    project: data.project,
    projectId: data.project.id,
    projectCode: data.project.projectCode,
    folderPath,
    workspace: data.workspace,
  };
}

async function getWorkspace(app: FastifyInstance, projectId: string): Promise<WorkspaceWithScope> {
  const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/workspace` });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: WorkspaceWithScope }>().data;
}

function folderIdByName(snapshot: ProjectFolderSnapshot, name: string): string {
  const node = snapshot.folders.find((folder) => folder.name === name);
  if (!node) throw new Error(`Missing folder ${name}`);
  return node.folderId;
}

function physicalPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

function writeLegacyWorkspace(
  databasePath: string,
  projectId: string,
  foldersJson: unknown,
  outputsJson: unknown,
): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(
      'UPDATE project_workspaces SET folders_json = ?, output_folders_json = ? WHERE project_id = ?',
    ).run(JSON.stringify(foldersJson), JSON.stringify(outputsJson), projectId);
  } finally {
    db.close();
  }
}

class FailingPersistStore extends PersonalWorkspaceStore {
  public failPersistence = false;
  public sabotage: 'none' | 'fill-new-folder' | 'recreate-old-paths' | 'file-at-deleted-path' =
    'none';

  public override persistFolderSnapshot(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: OutputMapping[],
  ): WorkspaceWithScope {
    if (!this.failPersistence) {
      return super.persistFolderSnapshot(projectId, snapshot, mappings);
    }
    const workspace = this.getWorkspace(projectId);
    const root = workspace.folderPath;
    if (root) {
      if (this.sabotage === 'fill-new-folder') {
        const known = new Set(
          workspace.folderSnapshot.folders.map((folder) =>
            deriveFolderRelativePath(workspace.folderSnapshot, folder.folderId),
          ),
        );
        const extra = findExtraDirectories(root, known);
        if (extra.length) writeFileSync(path.join(extra[0]!, 'marker.txt'), 'x');
      }
      if (this.sabotage === 'recreate-old-paths') {
        for (const folder of workspace.folderSnapshot.folders) {
          const relative = deriveFolderRelativePath(workspace.folderSnapshot, folder.folderId);
          if (relative) {
            const physical = path.join(root, ...relative.split('/'));
            if (!existsSync(physical)) mkdirSync(physical, { recursive: true });
          }
        }
      }
      if (this.sabotage === 'file-at-deleted-path') {
        for (const folder of workspace.folderSnapshot.folders) {
          const relative = deriveFolderRelativePath(workspace.folderSnapshot, folder.folderId);
          if (relative) {
            const physical = path.join(root, ...relative.split('/'));
            if (!existsSync(physical)) {
              mkdirSync(path.dirname(physical), { recursive: true });
              writeFileSync(physical, 'x');
            }
          }
        }
      }
    }
    throw new Error('Simulated persistence failure');
  }
}

function findExtraDirectories(root: string, known: Set<string | null>): string[] {
  const result: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).replaceAll('\\', '/');
      if (!known.has(relative)) result.push(full);
      pending.push(full);
    }
  }
  return result;
}

function snapshotPhysicalTree(root: string): string {
  const lines: string[] = [];
  const pending: Array<{ directory: string; prefix: string }> = [{ directory: root, prefix: '' }];
  while (pending.length) {
    const { directory, prefix } = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        lines.push(`dir:${relative}`);
        pending.push({ directory: full, prefix: relative });
      } else if (entry.isFile()) {
        lines.push(`file:${relative}:${readFileSync(full, 'utf8')}`);
      } else {
        lines.push(`other:${relative}`);
      }
    }
  }
  return lines.sort().join('\n');
}
describe('P2.4B2 folder structure service', () => {
  it('accepts a current fingerprint and rejects a stale fingerprint before any filesystem mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-fingerprint-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const current = workspace.folderConfigurationFingerprint;

    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: current,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    expect(existsSync(path.join(created.folderPath, '06_MOCKUPS'))).toBe(true);

    const staleResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '07_STALE',
        expectedFolderConfigurationFingerprint: current,
      },
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json().error.code).toBe('CONFLICT');
    expect(staleResponse.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');
    expect(existsSync(path.join(created.folderPath, '07_STALE'))).toBe(false);
  });

  it('rejects stale rename, move, and delete-empty requests before any filesystem mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-stale-actions-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const staleFingerprint = workspace.folderConfigurationFingerprint;

    // A successful mutation changes the fingerprint so the captured one is stale.
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: staleFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);
    const before = snapshotPhysicalTree(created.folderPath);

    const staleRename = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: staleFingerprint,
      },
    });
    expect(staleRename.statusCode).toBe(409);
    expect(staleRename.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');

    const staleMove = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: receivedId,
        newParentFolderId: technicalId,
        expectedFolderConfigurationFingerprint: staleFingerprint,
      },
    });
    expect(staleMove.statusCode).toBe(409);
    expect(staleMove.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');

    const staleDelete = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: receivedId,
        expectedFolderConfigurationFingerprint: staleFingerprint,
      },
    });
    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');

    // The physical tree is byte/path-identical after every stale rejection.
    expect(snapshotPhysicalTree(created.folderPath)).toBe(before);
    const after = await getWorkspace(app, created.projectId);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === receivedId)?.name,
    ).toBe('00_RECEIVED');
  });
  it('serializes same-project operations and keeps different projects independent', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-concurrency-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const first = await createSyntheticProject(app, config);
    const second = await createSyntheticProject(app, config, {
      projectName: 'Marina Tower',
      crmReference: 'CRM-48573',
    });
    const firstWorkspace = await getWorkspace(app, first.projectId);
    const secondWorkspace = await getWorkspace(app, second.projectId);

    const [firstA, firstB, secondA] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/projects/${first.projectId}/folder-actions`,
        payload: {
          action: 'add',
          parentFolderId: null,
          name: 'A1',
          expectedFolderConfigurationFingerprint: firstWorkspace.folderConfigurationFingerprint,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/projects/${first.projectId}/folder-actions`,
        payload: {
          action: 'add',
          parentFolderId: null,
          name: 'A2',
          expectedFolderConfigurationFingerprint: firstWorkspace.folderConfigurationFingerprint,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/api/projects/${second.projectId}/folder-actions`,
        payload: {
          action: 'add',
          parentFolderId: null,
          name: 'B1',
          expectedFolderConfigurationFingerprint: secondWorkspace.folderConfigurationFingerprint,
        },
      }),
    ]);
    // Same-project operations are serialized: the second concurrent action sees the
    // committed first action and is rejected as stale before any filesystem mutation.
    expect(firstA.statusCode).toBe(200);
    expect(firstB.statusCode).toBe(409);
    expect(firstB.json().error.details?.code).toBe('STALE_FOLDER_CONFIGURATION');
    expect(existsSync(path.join(first.folderPath, 'A1'))).toBe(true);
    expect(existsSync(path.join(first.folderPath, 'A2'))).toBe(false);
    // Different projects are independent: both succeed concurrently.
    expect(secondA.statusCode).toBe(200);
    expect(existsSync(path.join(second.folderPath, 'B1'))).toBe(true);
  });

  it('keeps the B1 legacy workspace-setup identity guard active after canonicalization', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-guard-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);

    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);

    const renamedStructure = syntheticFolders.map((folder) =>
      folder.name === '03_DRAWINGS' ? { ...folder, name: '03_LIGHTING_DRAWINGS' } : folder,
    );
    const setupResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.projectId}/workspace-setup`,
      payload: {
        folderProfile: 'Full Lighting Design',
        folderStructure: renamedStructure,
        outputFolders: syntheticOutputs,
      },
    });
    expect(setupResponse.statusCode).toBe(400);
    expect(setupResponse.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('P2.4B2 add folder', () => {
  it('adds root-level and nested children with stable IDs and no output mapping', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');

    const rootAdd = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(rootAdd.statusCode).toBe(200);
    const rootResult = rootAdd.json<{ data: { folderId: string } }>().data;
    expect(rootResult.folderId).toBeTruthy();
    expect(existsSync(path.join(created.folderPath, '06_MOCKUPS'))).toBe(true);

    workspace = await getWorkspace(app, created.projectId);
    const nestedAdd = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'MOCKUP',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(nestedAdd.statusCode).toBe(200);
    const nestedResult = nestedAdd.json<{ data: { folderId: string } }>().data;
    expect(nestedResult.folderId).toBeTruthy();
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'MOCKUP'))).toBe(true);

    workspace = await getWorkspace(app, created.projectId);
    const added = workspace.folderSnapshot.folders.filter(
      (folder) => folder.name === 'MOCKUP' || folder.name === '06_MOCKUPS',
    );
    expect(added).toHaveLength(2);
    expect(
      added.every(
        (folder) =>
          folder.folderId === rootResult.folderId || folder.folderId === nestedResult.folderId,
      ),
    ).toBe(true);
    const mapped = workspace.outputMappings.filter(
      (mapping) =>
        mapping.destinationFolderId === rootResult.folderId ||
        mapping.destinationFolderId === nestedResult.folderId,
    );
    expect(mapped).toHaveLength(0);
  });

  it('rejects duplicate and case-collision sibling names', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-collision-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '00_RECEIVED',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(duplicate.statusCode).toBe(400);

    const caseCollision = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '00_received',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(caseCollision.statusCode).toBe(400);
  });

  it('rejects invalid Windows folder names', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-name-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const invalidNames = [
      '',
      '   ',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a:b',
      'a*b',
      'a?b',
      'a"b',
      'a<b',
      'a>b',
      'a|b',
      'CON',
      'con.txt',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'LPT9',
      'trailing.',
      'trailing ',
    ];
    for (const name of invalidNames) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${created.projectId}/folder-actions`,
        payload: {
          action: 'add',
          parentFolderId: null,
          name,
          expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
        },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('rejects adding into a disabled parent', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-disabled-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const workingId = folderIdByName(workspace.folderSnapshot, '01_WORKING');

    const disable = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'disable',
        folderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(disable.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);

    const add = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: workingId,
        name: 'NEW_CHILD',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(add.statusCode).toBe(400);
    expect(existsSync(path.join(created.folderPath, '01_WORKING', 'NEW_CHILD'))).toBe(false);
  });

  it('removes a newly created folder when persistence fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-compensate-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    failingStore.failPersistence = true;

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(500);
    expect(existsSync(path.join(created.folderPath, '06_MOCKUPS'))).toBe(false);
  });

  it('returns recoveryRequired when compensation is unsafe', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-add-recovery-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    failingStore.failPersistence = true;
    failingStore.sabotage = 'fill-new-folder';

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details?.recoveryRequired).toBe(true);
  });
});

describe('P2.4B2 rename folder', () => {
  it('preserves folderId, descendant IDs, and output mappings while derived paths update', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const datasheetsId = folderIdByName(workspace.folderSnapshot, 'DATASHEETS');
    const boqId = folderIdByName(workspace.folderSnapshot, 'BOQ');
    const drawingsId = folderIdByName(workspace.folderSnapshot, '03_DRAWINGS');
    const drawingsPath = physicalPath(created.folderPath, '03_DRAWINGS');
    mkdirSync(drawingsPath, { recursive: true });
    writeFileSync(path.join(drawingsPath, 'layout.dwg'), 'dwg');

    const renameResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: drawingsId,
        name: '03_LIGHTING_DRAWINGS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(renameResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);

    const renamed = workspace.folderSnapshot.folders.find(
      (folder) => folder.folderId === drawingsId,
    );
    expect(renamed?.name).toBe('03_LIGHTING_DRAWINGS');
    expect(renamed?.folderId).toBe(drawingsId);
    expect(existsSync(path.join(created.folderPath, '03_LIGHTING_DRAWINGS', 'layout.dwg'))).toBe(
      true,
    );
    expect(existsSync(drawingsPath)).toBe(false);

    const technical = workspace.folderSnapshot.folders.find(
      (folder) => folder.folderId === technicalId,
    );
    const datasheets = workspace.folderSnapshot.folders.find(
      (folder) => folder.folderId === datasheetsId,
    );
    const boq = workspace.folderSnapshot.folders.find((folder) => folder.folderId === boqId);
    expect(technical?.folderId).toBe(technicalId);
    expect(datasheets?.folderId).toBe(datasheetsId);
    expect(boq?.folderId).toBe(boqId);
    expect(deriveFolderRelativePath(workspace.folderSnapshot, datasheetsId)).toBe(
      '04_TECHNICAL/DATASHEETS',
    );
    expect(deriveFolderRelativePath(workspace.folderSnapshot, boqId)).toBe('04_TECHNICAL/BOQ');

    const datasheetsMapping = workspace.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'datasheets',
    );
    const boqMapping = workspace.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'boqExcel',
    );
    expect(datasheetsMapping?.destinationFolderId).toBe(datasheetsId);
    expect(boqMapping?.destinationFolderId).toBe(boqId);
    expect(workspace.outputFolders.datasheets).toBe('04_TECHNICAL/DATASHEETS');
    expect(workspace.outputFolders.boqExcel).toBe('04_TECHNICAL/BOQ');

    const index = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.projectId}/file-index`,
    });
    const indexData = index.json<{ data: { items: Array<{ relativePath: string }> } }>().data;
    expect(
      indexData.items.some((item) =>
        item.relativePath.replaceAll('\\', '/').startsWith('03_LIGHTING_DRAWINGS/'),
      ),
    ).toBe(true);
  });

  it('rejects a target collision before any mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-collision-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '01_WORKING',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(400);
    const after = await getWorkspace(app, created.projectId);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === receivedId)?.name,
    ).toBe('00_RECEIVED');
  });

  it('compensates a persistence failure by restoring the original name', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-compensate-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    failingStore.failPersistence = true;

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(500);
    expect(existsSync(path.join(created.folderPath, '00_RECEIVED'))).toBe(true);
    expect(existsSync(path.join(created.folderPath, '00_INPUT'))).toBe(false);
    const after = await getWorkspace(app, created.projectId);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === receivedId)?.name,
    ).toBe('00_RECEIVED');
  });

  it('compensates an audit failure after the durable commit', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-audit-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    const failingAuditStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'operations') {
          return new Proxy(target.operations, {
            get(operationsTarget, operationsProp) {
              if (operationsProp === 'recordWorkspaceActivity') {
                return () => {
                  throw new Error('Simulated audit failure');
                };
              }
              return Reflect.get(operationsTarget, operationsProp, operationsTarget);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const service = new ProjectFolderStructureService(
      failingAuditStore as unknown as PersonalWorkspaceStore,
      new ProjectFolderService(),
    );
    const project = await provider.getProject(created.projectId);
    if (!project) throw new Error('Missing project.');

    await expect(
      service.execute(project, {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      }),
    ).rejects.toThrow('Simulated audit failure');
    expect(existsSync(path.join(created.folderPath, '00_RECEIVED'))).toBe(true);
    expect(existsSync(path.join(created.folderPath, '00_INPUT'))).toBe(false);
    const after = await getWorkspace(app, created.projectId);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === receivedId)?.name,
    ).toBe('00_RECEIVED');
  });

  it('returns recoveryRequired when rename compensation fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-recovery-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    failingStore.failPersistence = true;
    failingStore.sabotage = 'recreate-old-paths';

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details?.recoveryRequired).toBe(true);
  });

  it('supports case-only renames without regenerating identity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-case-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const boqId = folderIdByName(workspace.folderSnapshot, 'BOQ');

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: boqId,
        name: 'boq',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    const node = after.folderSnapshot.folders.find((folder) => folder.folderId === boqId);
    expect(node?.name).toBe('boq');
    expect(node?.folderId).toBe(boqId);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'boq'))).toBe(true);
    // Windows lookups are case-insensitive, so prove the on-disk spelling changed
    // by reading the actual directory entry name.
    const entries = readdirSync(path.join(created.folderPath, '04_TECHNICAL'));
    expect(entries).toContain('boq');
    expect(entries).not.toContain('BOQ');
  });

  it('rejects link/junction-like unsafe nodes when they can be created', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-rename-link-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    const linkPath = path.join(created.folderPath, '00_RECEIVED');
    const external = path.join(directory, 'external');
    mkdirSync(external, { recursive: true });
    try {
      rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(external, linkPath, 'junction');
    } catch {
      return; // junction creation is not available in this environment; skip.
    }
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details?.code).toBe('LINK_SAFETY');
  });
});

describe('P2.4B2 move folder', () => {
  it('moves a folder preserving node and descendant IDs and output mappings', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-move-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const deliverablesId = folderIdByName(workspace.folderSnapshot, '05_DELIVERABLES');
    const mockupPath = path.join(created.folderPath, '04_TECHNICAL', 'MOCKUP');

    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'MOCKUP',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    const mockupId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    writeFileSync(path.join(mockupPath, 'note.txt'), 'x');
    workspace = await getWorkspace(app, created.projectId);

    const moveResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: mockupId,
        newParentFolderId: deliverablesId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(moveResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);
    const moved = workspace.folderSnapshot.folders.find((folder) => folder.folderId === mockupId);
    expect(moved?.parentFolderId).toBe(deliverablesId);
    expect(moved?.folderId).toBe(mockupId);
    expect(existsSync(path.join(created.folderPath, '05_DELIVERABLES', 'MOCKUP', 'note.txt'))).toBe(
      true,
    );
    expect(existsSync(mockupPath)).toBe(false);
    expect(deriveFolderRelativePath(workspace.folderSnapshot, mockupId)).toBe(
      '05_DELIVERABLES/MOCKUP',
    );
  });

  it('rejects move into self, into a descendant, into a disabled parent, and target collisions', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-move-reject-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const datasheetsId = folderIdByName(workspace.folderSnapshot, 'DATASHEETS');
    const workingId = folderIdByName(workspace.folderSnapshot, '01_WORKING');

    const intoSelf = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: technicalId,
        newParentFolderId: technicalId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(intoSelf.statusCode).toBe(400);

    const intoDescendant = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: technicalId,
        newParentFolderId: datasheetsId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(intoDescendant.statusCode).toBe(400);

    const disable = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'disable',
        folderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(disable.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);

    const intoDisabled = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: technicalId,
        newParentFolderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(intoDisabled.statusCode).toBe(400);

    const addRootDatasheets = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: 'DATASHEETS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addRootDatasheets.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);

    const collision = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: datasheetsId,
        newParentFolderId: null,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(collision.statusCode).toBe(400);
  });

  it('compensates a post-filesystem failure and returns recoveryRequired when compensation fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-move-compensate-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const deliverablesId = folderIdByName(workspace.folderSnapshot, '05_DELIVERABLES');
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'MOCKUP',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    const mockupId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    workspace = await getWorkspace(app, created.projectId);
    failingStore.failPersistence = true;

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: mockupId,
        newParentFolderId: deliverablesId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(500);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'MOCKUP'))).toBe(true);
    expect(existsSync(path.join(created.folderPath, '05_DELIVERABLES', 'MOCKUP'))).toBe(false);

    failingStore.failPersistence = true;
    failingStore.sabotage = 'recreate-old-paths';
    const recoveryResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: mockupId,
        newParentFolderId: deliverablesId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(recoveryResponse.statusCode).toBe(409);
    expect(recoveryResponse.json().error.details?.recoveryRequired).toBe(true);
  });
});

describe('P2.4B2 reorder', () => {
  it('changes displayOrder only and never touches the filesystem or numeric prefixes', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-reorder-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    const workingId = folderIdByName(workspace.folderSnapshot, '01_WORKING');
    const before = workspace.folderSnapshot.folders
      .filter((folder) => folder.parentFolderId === null)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((folder) => folder.name);

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'reorder',
        folderId: receivedId,
        newDisplayOrder: 2,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    const rootNodes = after.folderSnapshot.folders
      .filter((folder) => folder.parentFolderId === null)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    expect(rootNodes.map((folder) => folder.name)).not.toEqual(before);
    expect(rootNodes.find((folder) => folder.folderId === receivedId)?.name).toBe('00_RECEIVED');
    expect(rootNodes.find((folder) => folder.folderId === workingId)?.parentFolderId).toBeNull();
    expect(existsSync(path.join(created.folderPath, '00_RECEIVED'))).toBe(true);
    expect(existsSync(path.join(created.folderPath, '01_WORKING'))).toBe(true);
    expect(after.outputMappings).toEqual(workspace.outputMappings);
  });
});

describe('P2.4B2 disable / enable', () => {
  it('keeps files on disk, preserves child flags, blocks mapped folders, and enables without filesystem mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-disable-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const datasheetsId = folderIdByName(workspace.folderSnapshot, 'DATASHEETS');
    const boqId = folderIdByName(workspace.folderSnapshot, 'BOQ');
    const workingId = folderIdByName(workspace.folderSnapshot, '01_WORKING');
    const workingPath = path.join(created.folderPath, '01_WORKING');
    writeFileSync(path.join(workingPath, 'file.txt'), 'x');

    const disable = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'disable',
        folderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(disable.statusCode).toBe(200);
    expect(existsSync(path.join(workingPath, 'file.txt'))).toBe(true);
    workspace = await getWorkspace(app, created.projectId);
    expect(
      workspace.folderSnapshot.folders.find((folder) => folder.folderId === workingId)?.enabled,
    ).toBe(false);

    const disableMapped = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'disable',
        folderId: boqId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(disableMapped.statusCode).toBe(409);

    const disableAncestor = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'disable',
        folderId: technicalId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(disableAncestor.statusCode).toBe(409);

    const enable = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'enable',
        folderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(enable.statusCode).toBe(200);
    expect(existsSync(path.join(workingPath, 'file.txt'))).toBe(true);
    const after = await getWorkspace(app, created.projectId);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === workingId)?.enabled,
    ).toBe(true);
    expect(
      after.folderSnapshot.folders.find((folder) => folder.folderId === datasheetsId)?.enabled,
    ).toBe(true);
  });
});

describe('P2.4B2 delete empty folder', () => {
  it('deletes a leaf empty folder and rejects non-empty, hidden-entry, child-node, and mapped folders', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-delete-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const datasheetsId = folderIdByName(workspace.folderSnapshot, 'DATASHEETS');
    const boqId = folderIdByName(workspace.folderSnapshot, 'BOQ');

    // Create TEMP_EMPTY and delete it.
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'TEMP_EMPTY',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    const tempId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    workspace = await getWorkspace(app, created.projectId);
    const deleteResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: tempId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'TEMP_EMPTY'))).toBe(false);
    workspace = await getWorkspace(app, created.projectId);
    expect(workspace.folderSnapshot.folders.some((folder) => folder.folderId === tempId)).toBe(
      false,
    );

    // Non-empty folder rejected.
    const nonEmptyPath = path.join(created.folderPath, '01_WORKING');
    writeFileSync(path.join(nonEmptyPath, 'file.txt'), 'x');
    const workingId = folderIdByName(workspace.folderSnapshot, '01_WORKING');
    const nonEmpty = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: workingId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(nonEmpty.statusCode).toBe(400);

    // Hidden entry counts as content.
    const hiddenPath = path.join(created.folderPath, '03_DRAWINGS');
    writeFileSync(path.join(hiddenPath, '.hidden'), 'x');
    const drawingsId = folderIdByName(workspace.folderSnapshot, '03_DRAWINGS');
    const hidden = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: drawingsId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(hidden.statusCode).toBe(400);

    // Folder with child nodes rejected.
    const withChildren = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: technicalId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(withChildren.statusCode).toBe(400);

    // Mapped folder rejected.
    const mapped = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: datasheetsId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(mapped.statusCode).toBe(409);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'DATASHEETS'))).toBe(true);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'BOQ'))).toBe(true);
    expect(workspace.folderSnapshot.folders.some((folder) => folder.folderId === boqId)).toBe(true);
  });

  it('has no force-delete action in the contract', () => {
    for (const action of ['delete-recursive', 'delete-force', 'delete-non-empty']) {
      const parsed = folderActionSchema.safeParse({
        action,
        folderId: 'x',
        expectedFolderConfigurationFingerprint: 'y',
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('recreates the empty directory when persistence fails and returns recoveryRequired when compensation fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-delete-compensate-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const failingStore = new FailingPersistStore(config);
    closeables.push(provider, failingStore);
    const app = await createApp({ config, provider, personalStore: failingStore });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'TEMP_EMPTY',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    const tempId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    workspace = await getWorkspace(app, created.projectId);
    failingStore.failPersistence = true;

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: tempId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(500);
    expect(existsSync(path.join(created.folderPath, '04_TECHNICAL', 'TEMP_EMPTY'))).toBe(true);

    failingStore.sabotage = 'file-at-deleted-path';
    const recoveryResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: tempId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(recoveryResponse.statusCode).toBe(409);
    expect(recoveryResponse.json().error.details?.recoveryRequired).toBe(true);
  });
});

describe('P2.4B2 drift and ownership', () => {
  it('fails closed with FOLDER_OUT_OF_SYNC when the expected source is missing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-drift-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    rmSync(path.join(created.folderPath, '00_RECEIVED'), { recursive: true, force: true });

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details?.code).toBe('FOLDER_OUT_OF_SYNC');
  });

  it('never trusts an absolute client path and cannot mutate the project root', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-path-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    const rootName = path.basename(created.folderPath);

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        path: 'C:\\Windows\\System32',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(existsSync(path.join(created.folderPath, '00_INPUT'))).toBe(true);
    expect(existsSync('C:\\Windows\\System32\\00_INPUT')).toBe(false);
    expect(path.basename(created.folderPath)).toBe(rootName);
    const after = await getWorkspace(app, created.projectId);
    expect(after.folderSnapshot.folders.every((folder) => folder.folderId !== null)).toBe(true);
  });

  it('rejects folder actions on Completed and Cancelled projects server-side', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-closed-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    const toInProgress = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/status`,
      payload: { status: 'InProgress', reason: 'P2.4B2 closed project test.' },
    });
    expect(toInProgress.statusCode).toBe(200);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/status`,
      payload: { status: 'Completed', reason: 'P2.4B2 closed project test.' },
    });
    expect(completed.statusCode).toBe(200);
    const completedAction = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(completedAction.statusCode).toBe(409);
    expect(completedAction.json().error.code).toBe('INVALID_TRANSITION');
    expect(existsSync(path.join(created.folderPath, '00_RECEIVED'))).toBe(true);

    const reopen = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/status`,
      payload: { status: 'InProgress', reason: 'Reopen for cancelled test case.' },
    });
    expect(reopen.statusCode).toBe(200);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/status`,
      payload: { status: 'Cancelled', reason: 'P2.4B2 closed project test.' },
    });
    expect(cancelled.statusCode).toBe(200);
    const cancelledAction = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(cancelledAction.statusCode).toBe(409);
    expect(cancelledAction.json().error.code).toBe('INVALID_TRANSITION');
    expect(existsSync(path.join(created.folderPath, '00_RECEIVED'))).toBe(true);
  });
});

describe('P2.4B2 legacy projects', () => {
  it('keeps legacy projects read-only on preview and canonicalizes only on the first successful mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-legacy-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
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
    writeLegacyWorkspace(
      config.STANDALONE_DB_PATH,
      created.projectId,
      legacyFolders,
      legacyOutputs,
    );
    const workspace = await getWorkspace(app, created.projectId);
    expect(workspace.folderSnapshot.schemaVersion).toBe('1.0');
    expect(
      workspace.folderSnapshot.folders.some((folder) => folder.name === '99_UNKNOWN_LEGACY'),
    ).toBe(true);
    expect(
      workspace.outputMappings.some((mapping) => mapping.outputTypeId === 'customOutput'),
    ).toBe(true);

    // Preview must not write canonical JSON.
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');
    const previewResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions/preview`,
      payload: { action: 'rename', folderId: receivedId, name: '00_INPUT' },
    });
    expect(previewResponse.statusCode).toBe(200);
    const rawDb = new DatabaseSync(config.STANDALONE_DB_PATH);
    let storedFolders = '';
    try {
      const row = rawDb
        .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
        .get(created.projectId) as { folders_json: string };
      storedFolders = row.folders_json;
    } finally {
      rawDb.close();
    }
    expect(storedFolders.includes('schemaVersion')).toBe(false);

    // Failed mutation must not canonicalize.
    const failed = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: 'CON',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(failed.statusCode).toBe(400);
    const rawDb2 = new DatabaseSync(config.STANDALONE_DB_PATH);
    try {
      const row = rawDb2
        .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
        .get(created.projectId) as { folders_json: string };
      storedFolders = row.folders_json;
    } finally {
      rawDb2.close();
    }
    expect(storedFolders.includes('schemaVersion')).toBe(false);

    // First successful explicit mutation canonicalizes and preserves unknown entries.
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: null,
        name: '06_MOCKUPS',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    expect(after.folderSnapshot.folders.some((folder) => folder.name === '99_UNKNOWN_LEGACY')).toBe(
      true,
    );
    expect(after.folderSnapshot.folders.some((folder) => folder.name === '06_MOCKUPS')).toBe(true);
    expect(after.outputMappings.some((mapping) => mapping.outputTypeId === 'customOutput')).toBe(
      true,
    );
    const rawDb3 = new DatabaseSync(config.STANDALONE_DB_PATH);
    try {
      const row = rawDb3
        .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
        .get(created.projectId) as { folders_json: string };
      storedFolders = row.folders_json;
    } finally {
      rawDb3.close();
    }
    expect(storedFolders.includes('schemaVersion')).toBe(true);
  });
});

describe('P2.4B2 regression', () => {
  it('preserves projectId, projectCode, CRM, and scope across folder actions', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-regression-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    const workspace = await getWorkspace(app, created.projectId);
    const receivedId = folderIdByName(workspace.folderSnapshot, '00_RECEIVED');

    const renameResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_INPUT',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(renameResponse.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    expect(after.projectId).toBe(created.projectId);
    expect(after.scopeItems.map((item) => item.label)).toEqual([
      'Lighting Design',
      'Technical BOQ',
      'Datasheets Package',
    ]);
    const projectResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.projectId}`,
    });
    const project = projectResponse.json<{ data: Project }>().data;
    expect(project.id).toBe(created.projectId);
    expect(project.projectCode).toBe(created.projectCode);
    expect(project.crmReference).toBe('CRM-48572');
  });

  it('never creates an unresolved output mapping through supported operations', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b2-unresolved-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'test.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({ config, provider, personalStore: store });
    closeables.push(app);
    const created = await createSyntheticProject(app, config);
    let workspace = await getWorkspace(app, created.projectId);
    const technicalId = folderIdByName(workspace.folderSnapshot, '04_TECHNICAL');
    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'add',
        parentFolderId: technicalId,
        name: 'MOCKUP',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(addResponse.statusCode).toBe(200);
    workspace = await getWorkspace(app, created.projectId);
    expect(workspace.outputMappings.every((mapping) => !mapping.unresolved)).toBe(true);
    const deliverablesId = folderIdByName(workspace.folderSnapshot, '05_DELIVERABLES');
    const moveResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.projectId}/folder-actions`,
      payload: {
        action: 'move',
        folderId: addResponse.json<{ data: { folderId: string } }>().data.folderId,
        newParentFolderId: deliverablesId,
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(moveResponse.statusCode).toBe(200);
    const after = await getWorkspace(app, created.projectId);
    expect(after.outputMappings.every((mapping) => !mapping.unresolved)).toBe(true);
  });
});
