import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import type { Project, ProjectActivity, ProjectCreateRecord } from '@scli/domain';
import type { FastifyInstance } from 'fastify';
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
    STANDALONE_SESSION_SECRET: 'p23a-reality-secret-that-is-longer-than-thirty-two-characters',
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

class FailingCommitProvider extends StandaloneDataProvider {
  public constructor(
    config: AppConfig,
    private readonly failingCode: string,
  ) {
    super(config);
  }

  public override async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    if (patch.projectCode === this.failingCode) {
      throw new Error('Simulated persistence failure');
    }
    return super.updateProject(id, patch);
  }
}

class AlwaysFailingUpdateProvider extends StandaloneDataProvider {
  public override async updateProject(): Promise<Project> {
    throw new Error('Simulated persistence failure');
  }
}

class FailingAuditProvider extends StandaloneDataProvider {
  public override async appendActivities(activities: ProjectActivity[]): Promise<void> {
    if (activities.some((activity) => activity.actionType === 'ProjectReferenceChanged')) {
      throw new Error('Simulated audit failure');
    }
    return super.appendActivities(activities);
  }
}

async function createManagedSctProject(app: FastifyInstance, config: AppConfig) {
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
      projectName: 'Dubai Villa',
      clientName: 'Reality Client',
      projectType: 'Villa Lighting Design',
      description: 'P2.3A reality check.',
      siteLocation: 'Dubai',
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
  if (!created.folderCreation) throw new Error('Managed folder was not created.');
  return { project: created.project, folderPath: created.folderCreation.folderPath };
}

describe('P2.3A controlled reference reality check', () => {
  it('renames a managed SCT project folder end to end and survives reopen', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-reality-'));
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

    const { project: created, folderPath: oldFolder } = await createManagedSctProject(app, config);
    const projectId = created.id;
    const oldCode = created.projectCode;
    const newCode = '001_SCT260807_DUBAI_HILLS_VILLA';
    expect(oldCode).toBe('001_SCT260807_DUBAI_VILLA');
    expect(projectId).toMatch(uuidPattern);
    expect(path.basename(oldFolder)).toBe(oldCode);
    expect(existsSync(oldFolder)).toBe(true);
    writeFileSync(path.join(oldFolder, 'NOTES.txt'), 'client brief notes', 'utf8');

    const luminaireResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: { tag: 'DL01', category: 'Downlight', quantity: 12 },
    });
    expect(luminaireResponse.statusCode).toBe(201);
    const luminaireId = luminaireResponse.json<{ data: { id: string } }>().data.id;
    const revisionResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/revisions`,
      payload: {
        revisionNumber: 1,
        title: 'Rev A issue',
        summary: 'First issue',
        changeLog: 'Initial issue',
      },
    });
    expect(revisionResponse.statusCode).toBe(201);
    const revisionId = revisionResponse.json<{ data: { id: string } }>().data.id;

    const newFolder = path.join(path.dirname(oldFolder), newCode);
    const changeResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/reference`,
      payload: {
        projectCode: newCode,
        expectedVersion: 1,
        auditReason: 'Client renamed the villa.',
      },
    });
    expect(changeResponse.statusCode).toBe(200);
    const changed = changeResponse.json<{
      data: {
        project: {
          id: string;
          projectCode: string;
          projectFolderPath: string | null;
          version: number;
        };
        folderRenamed: boolean;
        recoveryRequired: boolean;
      };
    }>().data;
    expect(changed.project.id).toBe(projectId);
    expect(changed.project.projectCode).toBe(newCode);
    expect(changed.project.projectFolderPath).toBe(newFolder);
    expect(changed.project.version).toBe(2);
    expect(changed.folderRenamed).toBe(true);
    expect(changed.recoveryRequired).toBe(false);

    expect(existsSync(newFolder)).toBe(true);
    expect(existsSync(oldFolder)).toBe(false);
    expect(existsSync(path.join(newFolder, 'NOTES.txt'))).toBe(true);
    const projectInfo = readFileSync(path.join(newFolder, 'PROJECT_INFO.txt'), 'utf8');
    expect(projectInfo).toContain(`Project Code   : ${newCode}`);
    expect(projectInfo).toContain('Company Code   : SCT');
    expect(projectInfo).toContain(`Folder Name    : ${newCode}`);

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const workspace = workspaceResponse.json<{
      data: {
        folderPath: string | null;
        luminaires: Array<{ id: string }>;
        deliverables: unknown[];
        revisions: Array<{ id: string }>;
      };
    }>().data;
    expect(workspace.folderPath).toBe(newFolder);
    expect(workspace.luminaires.map((item) => item.id)).toContain(luminaireId);
    expect(workspace.deliverables.length).toBeGreaterThan(0);
    expect(workspace.revisions.map((item) => item.id)).toContain(revisionId);

    const indexResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/file-index`,
    });
    const index = indexResponse.json<{
      data: { folderPath: string; items: Array<{ filePath: string }> };
    }>().data;
    expect(index.folderPath).toBe(newFolder);
    expect(index.items.length).toBeGreaterThan(0);
    expect(index.items.every((item) => item.filePath.startsWith(newFolder))).toBe(true);

    const activityResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/activity`,
    });
    const referenceActivity = activityResponse
      .json<{
        data: Array<{
          actionType: string;
          fieldName: string | null;
          oldValue: string | null;
          newValue: string | null;
        }>;
      }>()
      .data.find((item) => item.actionType === 'ProjectReferenceChanged');
    expect(referenceActivity).toMatchObject({
      fieldName: 'projectCode',
      oldValue: oldCode,
      newValue: newCode,
    });

    const currentSearch = await app.inject({
      method: 'GET',
      url: '/api/projects?search=DUBAI_HILLS_VILLA',
    });
    expect(
      currentSearch.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id),
    ).toContain(projectId);
    const historicalSearch = await app.inject({
      method: 'GET',
      url: '/api/personal/search?q=DUBAI_VILLA',
    });
    expect(
      historicalSearch.json<{ data: Array<{ projectId: string; type: string }> }>().data,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ projectId, type: 'Project' })]));

    const reopenProvider = new StandaloneDataProvider(config);
    const reopenStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenProvider, reopenStore);
    const reopened = await createApp({
      config,
      provider: reopenProvider,
      personalStore: reopenStore,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(reopened);
    const getResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    const persisted = getResponse.json<{
      data: {
        id: string;
        projectCode: string;
        crmReference: string | null;
        projectFolderPath: string | null;
      };
    }>().data;
    expect(persisted.id).toBe(projectId);
    expect(persisted.projectCode).toBe(newCode);
    expect(persisted.crmReference).toBe('CRM-48572');
    expect(persisted.projectFolderPath).toBe(newFolder);
    expect(existsSync(persisted.projectFolderPath ?? '')).toBe(true);
    const reopenedWorkspace = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(
      reopenedWorkspace.json<{
        data: { folderPath: string | null; luminaires: Array<{ id: string }> };
      }>().data,
    ).toMatchObject({ folderPath: newFolder, luminaires: [{ id: luminaireId }] });
  });

  it('rejects duplicate references and target folder collisions before any mutation', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-duplicate-'));
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
    const first = await createManagedSctProject(app, config);
    const second = await createManagedSctProject(app, config);
    expect(first.project.projectCode).toBe('001_SCT260807_DUBAI_VILLA');
    expect(second.project.projectCode).toBe('002_SCT260807_DUBAI_VILLA');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/projects/${second.project.id}/reference`,
      payload: { projectCode: first.project.projectCode, expectedVersion: 1 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(existsSync(second.folderPath)).toBe(true);
    expect(path.basename(second.folderPath)).toBe(second.project.projectCode);
    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/projects/${second.project.id}`,
    });
    expect(unchanged.json<{ data: { projectCode: string; version: number } }>().data).toMatchObject(
      {
        projectCode: second.project.projectCode,
        version: 1,
      },
    );

    const target = path.join(path.dirname(first.folderPath), '003_SCT260807_TARGET_COLLISION');
    mkdirSync(target);
    temporaryDirectories.push(target);
    const collision = await app.inject({
      method: 'POST',
      url: `/api/projects/${first.project.id}/reference`,
      payload: { projectCode: '003_SCT260807_TARGET_COLLISION', expectedVersion: 1 },
    });
    expect(collision.statusCode).toBe(409);
    expect(existsSync(first.folderPath)).toBe(true);
    expect(path.basename(first.folderPath)).toBe(first.project.projectCode);
  });

  it('rejects unsafe references and keeps the generic metadata patch code-locked', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-unsafe-'));
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
    const { project, folderPath } = await createManagedSctProject(app, config);
    const unsafe = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: '../../EVIL', expectedVersion: 1 },
    });
    expect(unsafe.statusCode).toBe(400);
    const legacyTarget = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: '019_SCLI251204_GEVI_SHARJAH', expectedVersion: 1 },
    });
    expect(legacyTarget.statusCode).toBe(400);
    expect(existsSync(folderPath)).toBe(true);
    expect(path.basename(folderPath)).toBe(project.projectCode);

    const patchWithCode = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      payload: {
        projectCode: '999_SCT999999_HACKED',
        projectName: 'Renamed Through Metadata Editor',
        expectedVersion: 1,
      },
    });
    expect(patchWithCode.statusCode).toBe(200);
    expect(
      patchWithCode.json<{ data: { projectCode: string; projectName: string } }>().data,
    ).toMatchObject({
      projectCode: project.projectCode,
      projectName: 'Renamed Through Metadata Editor',
    });
    expect(path.basename(folderPath)).toBe(project.projectCode);
    const codeOnlyPatch = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      payload: { projectCode: '999_SCT999999_HACKED' },
    });
    expect(codeOnlyPatch.statusCode).toBe(400);
  });

  it('keeps legacy SCLI projects untouched until explicit action and converts on request', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-legacy-'));
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
    const legacyFolder = path.join(config.PERSONAL_PROJECT_ROOT, '019_SCLI251204_GEVI_SHARJAH');
    mkdirSync(legacyFolder, { recursive: true });
    writeFileSync(path.join(legacyFolder, 'DESIGN.NOTES.txt'), 'legacy content', 'utf8');
    const projectId = randomUUID();
    const legacyProject: Project = {
      id: projectId,
      projectCode: '019_SCLI251204_GEVI_SHARJAH',
      projectName: 'GEVI Sharjah',
      clientName: 'Legacy Client',
      projectType: 'Villa Lighting Design',
      description: 'Imported legacy project.',
      salesOwnerId: '77777777-7777-4777-8777-777777777777',
      salesOwnerNameSnapshot: 'Reality Admin',
      salesOwnerEmailSnapshot: 'reality@local.test',
      createdById: '77777777-7777-4777-8777-777777777777',
      createdByNameSnapshot: 'Reality Admin',
      createdByEmailSnapshot: 'reality@local.test',
      assignedDesignerId: null,
      assignedDesignerNameSnapshot: null,
      collaboratorDesignerIds: [],
      collaboratorDesignerNameSnapshots: [],
      siteLocation: 'Sharjah',
      designStage: 'Concept',
      lightingScope: 'Legacy villa scope.',
      luxRequirements: '',
      drawingReference: '',
      status: 'Planning',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 0,
      actualHours: 0,
      progressPercent: 0,
      requiredDeliveryDate: '2026-08-20',
      projectFolderUrl: null,
      projectFolderPath: legacyFolder,
      folderProfile: 'Full Lighting Design',
      services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      luminaireInputMode: 'Later',
      revisionNumber: 0,
      createdAt: '2025-12-04T12:00:00.000Z',
      updatedAt: '2025-12-04T12:00:00.000Z',
      completedAt: null,
      cancelledAt: null,
      version: 1,
      isLegacyProject: true,
      legacyImportedAt: '2025-12-04T12:00:00.000Z',
      legacyFolderName: '019_SCLI251204_GEVI_SHARJAH',
      statusBeforeArchive: null,
      folderIndexedAt: null,
      folderFileCount: 0,
    };
    const record: ProjectCreateRecord = {
      project: legacyProject,
      activities: [],
      notifications: [],
      idempotencyKey: `legacy:${randomUUID()}`,
    };
    await provider.createProject(record);
    store.initializeProject(
      projectId,
      legacyProject.services ?? [],
      'Full Lighting Design',
      'Later',
      legacyProject.requiredDeliveryDate,
    );
    store.setFolderPath(projectId, legacyFolder);

    const before = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    expect(before.json<{ data: { projectCode: string } }>().data.projectCode).toBe(
      '019_SCLI251204_GEVI_SHARJAH',
    );
    expect(existsSync(legacyFolder)).toBe(true);

    const converted = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/reference`,
      payload: { projectCode: '019_SCT251204_GEVI_SHARJAH', expectedVersion: 1 },
    });
    expect(converted.statusCode).toBe(200);
    const convertedData = converted.json<{
      data: { project: { id: string; projectCode: string }; folderRenamed: boolean };
    }>().data;
    expect(convertedData.project.id).toBe(projectId);
    expect(convertedData.project.projectCode).toBe('019_SCT251204_GEVI_SHARJAH');
    expect(convertedData.folderRenamed).toBe(true);
    const newLegacyFolder = path.join(config.PERSONAL_PROJECT_ROOT, '019_SCT251204_GEVI_SHARJAH');
    expect(existsSync(newLegacyFolder)).toBe(true);
    expect(existsSync(legacyFolder)).toBe(false);
    expect(existsSync(path.join(newLegacyFolder, 'DESIGN.NOTES.txt'))).toBe(true);
    const regeneratedInfo = readFileSync(path.join(newLegacyFolder, 'PROJECT_INFO.txt'), 'utf8');
    expect(regeneratedInfo).toContain('Project Code   : 019_SCT251204_GEVI_SHARJAH');
    expect(regeneratedInfo).toContain('Company Code   : SCT');
    const searchResponse = await app.inject({
      method: 'GET',
      url: '/api/projects?search=GEVI_SHARJAH',
    });
    expect(
      searchResponse.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id),
    ).toContain(projectId);
  });

  it('is idempotent for a same-code request', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-noop-'));
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
    const { project, folderPath } = await createManagedSctProject(app, config);
    const noop = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: project.projectCode, expectedVersion: 1 },
    });
    expect(noop.statusCode).toBe(200);
    expect(
      noop.json<{
        data: { project: { projectCode: string; version: number }; folderRenamed: boolean };
      }>().data,
    ).toMatchObject({
      project: { projectCode: project.projectCode, version: 1 },
      folderRenamed: false,
    });
    expect(path.basename(folderPath)).toBe(project.projectCode);
  });

  it('leaves the database unchanged when the folder cannot be renamed', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-missing-'));
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
    const { project, folderPath } = await createManagedSctProject(app, config);
    rmSync(folderPath, { recursive: true, force: true });
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: '001_SCT260807_DUBAI_HILLS_VILLA', expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    const after = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    expect(after.json<{ data: { projectCode: string; version: number } }>().data).toMatchObject({
      projectCode: project.projectCode,
      version: 1,
    });
  });

  it('compensates a failed persistence commit by restoring the old folder name', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-compensate-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new FailingCommitProvider(config, '001_SCT260807_DUBAI_HILLS_VILLA');
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);
    const { project, folderPath } = await createManagedSctProject(app, config);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: '001_SCT260807_DUBAI_HILLS_VILLA', expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(500);
    const after = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    expect(after.json<{ data: { projectCode: string; version: number } }>().data).toMatchObject({
      projectCode: project.projectCode,
      version: 1,
    });
    expect(existsSync(folderPath)).toBe(true);
    expect(existsSync(path.join(path.dirname(folderPath), '001_SCT260807_DUBAI_HILLS_VILLA'))).toBe(
      false,
    );
  });

  it('returns an explicit recovery-required result when compensation fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-recovery-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new AlwaysFailingUpdateProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);
    const { project, folderPath } = await createManagedSctProject(app, config);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: '001_SCT260807_DUBAI_HILLS_VILLA', expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{
      error: { code: string; details?: { recoveryRequired?: boolean; failedSteps?: string[] } };
    }>();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details?.recoveryRequired).toBe(true);
    expect(body.error.details?.failedSteps).toContain('project');
    expect(existsSync(folderPath)).toBe(true);
    expect(existsSync(path.join(path.dirname(folderPath), '001_SCT260807_DUBAI_HILLS_VILLA'))).toBe(
      false,
    );
  });

  it('compensates a failed audit append after the durable commit', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p23a-audit-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
    const provider = new FailingAuditProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);
    const { project, folderPath } = await createManagedSctProject(app, config);
    const newCode = '001_SCT260807_DUBAI_HILLS_VILLA';
    const newFolder = path.join(path.dirname(folderPath), newCode);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/reference`,
      payload: { projectCode: newCode, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(500);
    const after = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    expect(after.json<{ data: { projectCode: string; version: number } }>().data).toMatchObject({
      projectCode: project.projectCode,
      version: 1,
    });
    expect(existsSync(folderPath)).toBe(true);
    expect(existsSync(newFolder)).toBe(false);
    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/workspace`,
    });
    expect(workspaceResponse.json<{ data: { folderPath: string | null } }>().data.folderPath).toBe(
      folderPath,
    );
    const indexResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/file-index`,
    });
    expect(indexResponse.json<{ data: { folderPath: string } }>().data.folderPath).toBe(folderPath);
    const activityResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/activity`,
    });
    expect(
      activityResponse
        .json<{ data: Array<{ actionType: string }> }>()
        .data.some((item) => item.actionType === 'ProjectReferenceChanged'),
    ).toBe(false);
  });
});
