import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import {
  deriveFolderRelativePath,
  folderProfileStructuralFingerprint,
  type FolderNodePreset,
  type FolderProfilePreset,
  type OutputMapping,
  type ProjectFolderSnapshot,
} from '@scli/domain';
import type { CreateFolderProfileInput } from '@scli/contracts';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

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
    STANDALONE_SESSION_SECRET: 'p24b3b2a-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

interface TestContext {
  directory: string;
  config: AppConfig;
  store: PersonalWorkspaceStore;
  app: Awaited<ReturnType<typeof createApp>>;
}

async function setup(): Promise<TestContext> {
  const directory = mkdtempSync(path.join(tmpdir(), 'p24b3b2a-reality-'));
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

function createPayload(
  config: AppConfig,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projectName: 'Dubai Hills Villa',
    clientName: 'Private Client',
    projectType: 'Villa Lighting Design',
    description: 'P2.4B3B2A reality check.',
    siteLocation: 'Dubai Hills',
    designStage: 'Concept',
    lightingScope: 'Complete villa lighting design and documentation.',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: '2026-08-20',
    createFolders: true,
    projectRoot: config.PERSONAL_PROJECT_ROOT,
    services: ['LightingDesign', 'TechnicalBoq', 'Datasheets'],
    scopeItems: [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
      { code: 'Datasheets', label: 'Datasheets Package', custom: false },
      { label: 'Mockup Review', custom: true },
    ],
    luminaireInputMode: 'Later',
    crmReference: 'CRM-48572',
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

interface DraftNode {
  draftFolderId: string;
  parentDraftFolderId: string | null;
  name: string;
  displayOrder: number;
  sourceProfileFolderId?: string | null;
}

function realityDraftNodes(): DraftNode[] {
  return [
    {
      draftFolderId: 'D1',
      parentDraftFolderId: null,
      name: 'RECEIVED',
      displayOrder: 0,
      sourceProfileFolderId: 'pf-received',
    },
    {
      draftFolderId: 'D2',
      parentDraftFolderId: null,
      name: 'WORKING',
      displayOrder: 1,
      sourceProfileFolderId: 'pf-working',
    },
    {
      draftFolderId: 'D3',
      parentDraftFolderId: null,
      name: 'LIGHTING_DRAWINGS',
      displayOrder: 2,
      sourceProfileFolderId: 'pf-drawings',
    },
    {
      draftFolderId: 'D4',
      parentDraftFolderId: null,
      name: 'TECHNICAL',
      displayOrder: 3,
      sourceProfileFolderId: 'pf-technical',
    },
    {
      draftFolderId: 'D5',
      parentDraftFolderId: 'D4',
      name: 'DATASHEETS',
      displayOrder: 0,
      sourceProfileFolderId: 'pf-datasheets',
    },
    {
      draftFolderId: 'D6',
      parentDraftFolderId: 'D4',
      name: 'BOQ',
      displayOrder: 1,
      sourceProfileFolderId: 'pf-boq',
    },
    {
      draftFolderId: 'D7',
      parentDraftFolderId: null,
      name: 'DELIVERABLES',
      displayOrder: 4,
      sourceProfileFolderId: 'pf-deliverables',
    },
    { draftFolderId: 'D8', parentDraftFolderId: 'D4', name: 'MOCKUP', displayOrder: 2 },
  ];
}

const realityOutputMappings = [
  { outputTypeId: 'TechnicalBoq', destinationDraftFolderId: 'D6' },
  { outputTypeId: 'Datasheets', destinationDraftFolderId: 'D5' },
  { outputTypeId: 'Reports', destinationDraftFolderId: 'D7' },
];

function factorySource(profile: FolderProfilePreset): {
  profileId: null;
  profileName: string;
  profileRevision: null;
  structuralFingerprint: string;
  factoryProfileKey: string;
} {
  return {
    profileId: null,
    profileName: profile.name,
    profileRevision: null,
    structuralFingerprint: folderProfileStructuralFingerprint(
      profile.folders,
      profile.outputFolders,
    ),
    factoryProfileKey: 'full-lighting-design',
  };
}

function relativeDirectories(root: string): string[] {
  const entries: string[] = [];
  const visit = (current: string, relative: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      entries.push(childRelative);
      visit(path.join(current, entry.name), childRelative);
    }
  };
  visit(root, '');
  return entries.sort((left, right) => left.localeCompare(right));
}

function snapshotFolderNames(snapshot: ProjectFolderSnapshot): string[] {
  return snapshot.folders.map((folder) => folder.name);
}

interface CreateResponseData {
  project: {
    id: string;
    projectCode: string;
    crmReference: string | null;
    folderProfile: string;
    projectFolderPath: string | null;
  };
  workspace: {
    folderSnapshot: ProjectFolderSnapshot;
    outputMappings: OutputMapping[];
    folderStructure: FolderNodePreset[];
    folderPath: string | null;
    folderProfile: string;
  };
  folderCreation: {
    folderPath: string;
    createdFolderCount: number;
  } | null;
  folderError: string | null;
}

describe('P2.4B3B2A canonical project folder draft reality check', () => {
  it('creates, persists, materializes, and retries the canonical draft exactly', async () => {
    const { config, app } = await setup();

    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((candidate) => candidate.name === 'Full Lighting Design');
    if (!preset) throw new Error('Missing Full Lighting Design factory profile.');

    const folderDraft = {
      folders: realityDraftNodes(),
      outputMappings: realityOutputMappings,
      sourceProfile: factorySource(preset),
    };
    const idempotencyKey = randomUUID();
    const payload = createPayload(config, { folderDraft, idempotencyKey });

    const first = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(first.statusCode).toBe(201);
    const created = first.json<{ data: CreateResponseData }>().data;
    expect(created.folderError).toBeNull();
    expect(created.project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.project.projectCode).toBe('001_SCT260807_DUBAI_HILLS_VILLA');
    expect(created.project.crmReference).toBe('CRM-48572');
    expect(created.project.projectFolderPath).toBe(created.folderCreation?.folderPath ?? null);
    expect(created.folderCreation?.createdFolderCount).toBe(8);

    const snapshot = created.workspace.folderSnapshot;
    expect(snapshotFolderNames(snapshot)).toEqual([
      'RECEIVED',
      'WORKING',
      'LIGHTING_DRAWINGS',
      'TECHNICAL',
      'DATASHEETS',
      'BOQ',
      'MOCKUP',
      'DELIVERABLES',
    ]);
    const draftIds = new Set(folderDraft.folders.map((node) => node.draftFolderId));
    const profileIds = new Set(
      folderDraft.folders
        .map((node) => node.sourceProfileFolderId)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (const folder of snapshot.folders) {
      expect(draftIds.has(folder.folderId)).toBe(false);
      expect(profileIds.has(folder.folderId)).toBe(false);
    }
    expect(snapshot.sourceProfile?.factoryProfileKey).toBe('full-lighting-design');
    expect(snapshot.sourceProfile?.profileName).toBe('Full Lighting Design');
    expect(snapshot.sourceProfile?.structuralFingerprint).toBe(
      factorySource(preset).structuralFingerprint,
    );
    const byName = new Map(snapshot.folders.map((folder) => [folder.name, folder]));
    expect(byName.get('LIGHTING_DRAWINGS')?.sourceProfileFolderId).toBe('pf-drawings');
    expect(byName.get('MOCKUP')?.sourceProfileFolderId).toBeUndefined();
    expect(byName.get('DATASHEETS')?.parentFolderId).toBe(byName.get('TECHNICAL')?.folderId);

    const mappings = created.workspace.outputMappings;
    const mappingById = new Map(mappings.map((mapping) => [mapping.outputTypeId, mapping]));
    expect(mappingById.get('TechnicalBoq')?.destinationFolderId).toBe(byName.get('BOQ')?.folderId);
    expect(mappingById.get('Datasheets')?.destinationFolderId).toBe(
      byName.get('DATASHEETS')?.folderId,
    );
    expect(mappingById.get('Reports')?.destinationFolderId).toBe(
      byName.get('DELIVERABLES')?.folderId,
    );
    expect(mappings.every((mapping) => mapping.unresolved === false)).toBe(true);
    expect(
      deriveFolderRelativePath(snapshot, mappingById.get('TechnicalBoq')!.destinationFolderId!),
    ).toBe('TECHNICAL/BOQ');

    const expectedPaths = [
      'RECEIVED',
      'WORKING',
      'LIGHTING_DRAWINGS',
      'TECHNICAL',
      'TECHNICAL/DATASHEETS',
      'TECHNICAL/BOQ',
      'TECHNICAL/MOCKUP',
      'DELIVERABLES',
    ].sort((left, right) => left.localeCompare(right));
    expect(relativeDirectories(created.folderCreation!.folderPath)).toEqual(expectedPaths);

    // Response-loss retry with the exact same idempotency key.
    const retry = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(retry.statusCode).toBe(201);
    const repeated = retry.json<{ data: CreateResponseData }>().data;
    expect(repeated.project.id).toBe(created.project.id);
    expect(repeated.project.projectCode).toBe(created.project.projectCode);
    expect(repeated.folderError).toBeNull();
    expect(repeated.workspace.folderSnapshot.folders).toEqual(snapshot.folders);
    expect(repeated.workspace.outputMappings).toEqual(mappings);
    expect(repeated.folderCreation).toBeNull();
    expect(relativeDirectories(created.folderCreation!.folderPath)).toEqual(expectedPaths);

    const workspaces = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.project.id}/workspace`,
    });
    const persisted = workspaces.json<{ data: CreateResponseData['workspace'] }>().data;
    expect(persisted.folderSnapshot.folders).toEqual(snapshot.folders);
    expect(persisted.outputMappings).toEqual(mappings);
    expect(persisted.folderPath).toBe(created.folderCreation?.folderPath);
  });

  it('rejects ambiguous canonical plus legacy authority', async () => {
    const { config, app } = await setup();
    const mixed = createPayload(config, {
      folderDraft: {
        folders: realityDraftNodes(),
        outputMappings: realityOutputMappings,
        sourceProfile: null,
      },
      folderStructure: [{ name: '01_INPUT', children: [] }],
    });
    const response = await app.inject({ method: 'POST', url: '/api/projects', payload: mixed });
    expect(response.statusCode).toBe(400);
  });

  it('keeps a blank canonical draft empty with no injected defaults', async () => {
    const { config, app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, {
        folderDraft: { folders: [], outputMappings: [], sourceProfile: null },
      }),
    });
    expect(response.statusCode).toBe(201);
    const created = response.json<{ data: CreateResponseData }>().data;
    expect(created.folderError).toBeNull();
    expect(created.workspace.folderSnapshot.folders).toEqual([]);
    expect(created.workspace.outputMappings).toEqual([]);
    expect(created.folderCreation?.createdFolderCount).toBe(0);
    expect(relativeDirectories(created.folderCreation!.folderPath)).toEqual([]);
    expect(created.workspace.folderStructure).toEqual([]);
  });

  it('rejects an invalid draft before any physical folder mutation', async () => {
    const { config, app } = await setup();
    const invalid = createPayload(config, {
      folderDraft: {
        folders: [
          { draftFolderId: 'A', parentDraftFolderId: 'B', name: 'A_FOLDER', displayOrder: 0 },
          { draftFolderId: 'B', parentDraftFolderId: 'A', name: 'B_FOLDER', displayOrder: 0 },
        ],
        outputMappings: [],
        sourceProfile: null,
      },
    });
    const response = await app.inject({ method: 'POST', url: '/api/projects', payload: invalid });
    expect(response.statusCode).toBe(400);
    expect(
      readdirSync(config.PERSONAL_PROJECT_ROOT).filter((entry) => entry !== 'PROJECT_INFO.txt'),
    ).toEqual([]);
  });

  it('preserves project, snapshot, and mappings when physical creation fails', async () => {
    const { config, app } = await setup();
    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((candidate) => candidate.name === 'Full Lighting Design');
    if (!preset) throw new Error('Missing Full Lighting Design factory profile.');
    const folderDraft = {
      folders: realityDraftNodes(),
      outputMappings: realityOutputMappings,
      sourceProfile: factorySource(preset),
    };
    const idempotencyKey = randomUUID();

    const later = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, { folderDraft, idempotencyKey, createFolders: false }),
    });
    expect(later.statusCode).toBe(201);
    const laterData = later.json<{ data: CreateResponseData }>().data;
    expect(laterData.folderCreation).toBeNull();
    const projectCode = laterData.project.projectCode;
    const blocker = path.join(config.PERSONAL_PROJECT_ROOT, projectCode);
    mkdirSync(blocker);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, { folderDraft, idempotencyKey, createFolders: true }),
    });
    expect(failed.statusCode).toBe(201);
    const failedData = failed.json<{ data: CreateResponseData }>().data;
    expect(failedData.project.id).toBe(laterData.project.id);
    expect(failedData.folderError).toContain('already exists');
    expect(failedData.project.projectFolderPath).toBeNull();
    expect(failedData.workspace.folderSnapshot.folders).toEqual(
      laterData.workspace.folderSnapshot.folders,
    );
    expect(failedData.workspace.outputMappings).toEqual(laterData.workspace.outputMappings);
    const failedIds = failedData.workspace.folderSnapshot.folders.map((folder) => folder.folderId);

    rmSync(blocker, { recursive: true, force: true });
    const recovered = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, { folderDraft, idempotencyKey, createFolders: true }),
    });
    expect(recovered.statusCode).toBe(201);
    const recoveredData = recovered.json<{ data: CreateResponseData }>().data;
    expect(recoveredData.folderError).toBeNull();
    expect(recoveredData.project.id).toBe(laterData.project.id);
    expect(recoveredData.workspace.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(
      failedIds,
    );
    expect(recoveredData.folderCreation?.createdFolderCount).toBe(8);
    expect(recoveredData.workspace.folderSnapshot.folders).toEqual(
      failedData.workspace.folderSnapshot.folders,
    );
  });

  it('keeps the reviewed project unchanged after source profile edit and deletion', async () => {
    const { config, app } = await setup();
    const profileInput: CreateFolderProfileInput = {
      name: 'Villa Lighting Profile',
      description: 'Reality profile for canonical draft provenance.',
      folders: [
        { name: '01_RECEIVED', children: [] },
        { name: '02_WORKING', children: [] },
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
    const createdProfile = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: profileInput,
    });
    expect(createdProfile.statusCode).toBe(201);
    const profile = createdProfile.json<{
      data: {
        profileId: string;
        name: string;
        structuralFingerprint: string;
        folders: Array<{
          profileFolderId: string;
          parentProfileFolderId: string | null;
          name: string;
          displayOrder: number;
        }>;
      };
    }>().data;

    const idByProfile = new Map(
      profile.folders.map((folder) => [folder.name, folder.profileFolderId]),
    );
    const draftNodes: DraftNode[] = profile.folders.map((folder) => ({
      draftFolderId: `D-${folder.profileFolderId}`,
      parentDraftFolderId: folder.parentProfileFolderId
        ? `D-${folder.parentProfileFolderId}`
        : null,
      name: folder.name,
      displayOrder: folder.displayOrder,
      sourceProfileFolderId: folder.profileFolderId,
    }));
    const folderDraft = {
      folders: draftNodes,
      outputMappings: [
        { outputTypeId: 'TechnicalBoq', destinationDraftFolderId: `D-${idByProfile.get('BOQ')}` },
        {
          outputTypeId: 'Datasheets',
          destinationDraftFolderId: `D-${idByProfile.get('DATASHEETS')}`,
        },
        {
          outputTypeId: 'Reports',
          destinationDraftFolderId: `D-${idByProfile.get('05_DELIVERABLES')}`,
        },
      ],
      sourceProfile: {
        profileId: profile.profileId,
        profileName: profile.name,
        profileRevision: null,
        structuralFingerprint: profile.structuralFingerprint,
      },
    };

    const createdProject = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, { folderDraft, createFolders: false }),
    });
    expect(createdProject.statusCode).toBe(201);
    const projectData = createdProject.json<{ data: CreateResponseData }>().data;
    const projectId = projectData.project.id;
    const snapshotBefore = projectData.workspace.folderSnapshot;
    const mappingsBefore = projectData.workspace.outputMappings;

    await app.inject({
      method: 'PATCH',
      url: `/api/folder-profiles/catalog/${profile.profileId}`,
      payload: {
        name: 'Villa Lighting Profile RENAMED',
        description: 'Mutated after the reviewed draft was captured.',
        folders: [
          { name: '01_RECEIVED', children: [] },
          { name: '02_WORKING', children: [] },
          {
            name: '03_REDESIGNED',
            children: [
              { name: 'DATASHEETS', children: [] },
              { name: 'BOQ', children: [] },
              { name: 'NEW_AREA', children: [] },
            ],
          },
        ],
        outputDefaults: [{ outputTypeId: 'TechnicalBoq', destinationPath: '03_REDESIGNED/BOQ' }],
      },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${profile.profileId}`,
    });
    expect(deleted.statusCode).toBe(200);

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(workspace.statusCode).toBe(200);
    const after = workspace.json<{ data: CreateResponseData['workspace'] }>().data;
    expect(after.folderSnapshot.folders).toEqual(snapshotBefore.folders);
    expect(after.folderSnapshot.sourceProfile).toEqual(snapshotBefore.sourceProfile);
    expect(after.outputMappings).toEqual(mappingsBefore);
  });

  it('keeps legacy personal create, connect, and later behavior green', async () => {
    const { config, app } = await setup();
    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((candidate) => candidate.name === 'Full Lighting Design');
    if (!preset) throw new Error('Missing Full Lighting Design factory profile.');

    const legacy = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, {
        folderProfile: 'Full Lighting Design',
        folderStructure: preset.folders,
        outputFolders: preset.outputFolders,
      }),
    });
    expect(legacy.statusCode).toBe(201);
    const legacyData = legacy.json<{ data: CreateResponseData }>().data;
    expect(legacyData.folderError).toBeNull();
    expect(legacyData.folderCreation?.createdFolderCount).toBeGreaterThan(0);
    expect(legacyData.workspace.folderSnapshot.folders.length).toBeGreaterThan(0);

    const connectBase = mkdtempSync(path.join(tmpdir(), 'p24b3b2a-connect-'));
    temporaryDirectories.push(connectBase);
    const existing = path.join(connectBase, 'Existing Client Folder');
    mkdirSync(existing);
    const connect = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, {
        createFolders: false,
        connectFolderPath: existing,
      }),
    });
    expect(connect.statusCode).toBe(201);
    const connectData = connect.json<{ data: CreateResponseData }>().data;
    expect(connectData.folderError).toBeNull();
    expect(connectData.workspace.folderPath).toBe(existing);
    expect(connectData.folderCreation).toBeNull();

    const later = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createPayload(config, { createFolders: false }),
    });
    expect(later.statusCode).toBe(201);
    const laterData = later.json<{ data: CreateResponseData }>().data;
    expect(laterData.folderError).toBeNull();
    expect(laterData.folderCreation).toBeNull();
    expect(laterData.workspace.folderPath).toBeNull();
  });
});
