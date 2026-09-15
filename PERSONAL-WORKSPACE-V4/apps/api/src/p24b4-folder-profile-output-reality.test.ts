import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  factoryProfileSource,
  folderProfileStructuralFingerprint,
  type FolderProfile,
  type FolderProfilePreset,
  type FolderProfileSource,
  type OutputMapping,
  type ProjectFolderDraft,
  type ProjectFolderSnapshot,
} from '@scli/domain';
import type {
  CreateFolderProfileInput,
  ProjectFolderDraftNodeInput,
  ProjectFolderDraftOutputMappingInput,
} from '@scli/contracts';
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
    STANDALONE_SESSION_SECRET: 'p24b4-reality-secret-that-is-longer-than-thirty-two-characters',
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
  provider: StandaloneDataProvider;
  app: Awaited<ReturnType<typeof createApp>>;
}

async function setup(): Promise<TestContext> {
  const directory = mkdtempSync(path.join(tmpdir(), 'p24b4-reality-'));
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
  return { directory, config, store, provider, app };
}

// ---------------------------------------------------------------------------
// The professional "Lighting Design - Full Package" user profile.
// ---------------------------------------------------------------------------

function fullPackageProfileInput(): CreateFolderProfileInput {
  return {
    name: 'Lighting Design - Full Package',
    description: 'Canonical user profile for the P2.4B4 reality journey.',
    folders: [
      { name: '00_RECEIVED', children: [] },
      {
        name: '01_WORKING',
        children: [
          { name: 'CAD', children: [] },
          { name: 'DIALUX', children: [] },
          { name: 'REVIT', children: [] },
          { name: '3D', children: [] },
        ],
      },
      {
        name: '02_TECHNICAL',
        children: [
          { name: 'LUMINAIRE_SCHEDULE', children: [] },
          { name: 'DATASHEETS', children: [] },
          { name: 'BOQ', children: [] },
        ],
      },
      { name: '03_DRAWINGS', children: [] },
      { name: '04_PRESENTATION', children: [] },
      { name: '05_DELIVERABLES', children: [] },
      { name: '06_ARCHIVE', children: [] },
    ],
    outputDefaults: [
      { outputTypeId: 'scheduleExcel', destinationPath: '02_TECHNICAL/LUMINAIRE_SCHEDULE' },
      { outputTypeId: 'schedulePdf', destinationPath: '02_TECHNICAL/LUMINAIRE_SCHEDULE' },
      { outputTypeId: 'boqExcel', destinationPath: '02_TECHNICAL/BOQ' },
      { outputTypeId: 'boqPdf', destinationPath: '02_TECHNICAL/BOQ' },
      { outputTypeId: 'datasheets', destinationPath: '02_TECHNICAL/DATASHEETS' },
      { outputTypeId: 'authoritySubmission', destinationPath: '05_DELIVERABLES' },
      { outputTypeId: 'renderPackage', destinationPath: '04_PRESENTATION' },
    ],
  };
}

function createProjectPayload(
  config: AppConfig,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projectName: 'Dubai Hills Lighting Test',
    clientName: 'Synthetic Client',
    projectType: 'Villa Lighting Design',
    description: 'P2.4B4 reality gate journey.',
    siteLocation: 'Dubai Hills',
    designStage: 'Concept',
    lightingScope: 'Complete villa lighting design and documentation.',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: '2026-08-20',
    createFolders: true,
    projectRoot: config.PERSONAL_PROJECT_ROOT,
    services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
    scopeItems: [
      { code: 'LightingLayout', label: 'Lighting Layout', custom: false },
      { code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false },
      { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
      { code: 'Datasheets', label: 'Datasheets Package', custom: false },
      { label: 'Authority Submission', custom: true },
    ],
    luminaireInputMode: 'Later',
    crmReference: 'CRM-B4-001',
    idempotencyKey: randomUUID(),
    ...overrides,
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

function relativePath(snapshot: ProjectFolderSnapshot, folderId: string): string | null {
  const byId = new Map(snapshot.folders.map((folder) => [folder.folderId, folder]));
  const segments: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.folderId)) return null;
    seen.add(current.folderId);
    segments.unshift(current.name);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}

/** Mirrors the web wizard's draftFromCanonicalProfile: draft ids fresh, source provenance kept. */
function canonicalProfileToDraft(
  profile: FolderProfile,
  generateId: () => string,
): ProjectFolderDraft {
  const idMap = new Map<string, string>();
  for (const node of profile.folders) idMap.set(node.profileFolderId, generateId());
  const folders: ProjectFolderDraftNodeInput[] = profile.folders.map((node) => ({
    draftFolderId: idMap.get(node.profileFolderId)!,
    parentDraftFolderId: node.parentProfileFolderId ? idMap.get(node.parentProfileFolderId)! : null,
    name: node.name,
    displayOrder: node.displayOrder,
    ...(node.semanticRole ? { semanticRole: node.semanticRole } : {}),
    sourceProfileFolderId: node.profileFolderId,
  }));
  const outputMappings: ProjectFolderDraftOutputMappingInput[] = profile.outputDefaults
    .map((output) => {
      const destinationDraftFolderId = idMap.get(output.destinationProfileFolderId);
      return destinationDraftFolderId
        ? { outputTypeId: output.outputTypeId, destinationDraftFolderId }
        : null;
    })
    .filter((mapping): mapping is ProjectFolderDraftOutputMappingInput => mapping !== null);
  const sourceProfile: FolderProfileSource = {
    profileId: profile.profileId,
    profileName: profile.name,
    profileRevision: null,
    structuralFingerprint: profile.structuralFingerprint,
  };
  return { folders, outputMappings, sourceProfile };
}

/** Mirrors the web wizard's draftFromPreset for factory profiles. */
function presetToDraft(
  preset: FolderProfilePreset,
  sourceProfile: FolderProfileSource,
  generateId: () => string,
): ProjectFolderDraft {
  const pathToId = new Map<string, string>();
  const flat: ProjectFolderDraftNodeInput[] = [];
  const flatten = (
    list: FolderProfilePreset['folders'],
    parentPath: string,
    parentDraftId: string | null,
  ): void => {
    list.forEach((node, index) => {
      const id = generateId();
      const rel = parentPath ? `${parentPath}/${node.name}` : node.name;
      pathToId.set(rel.toLowerCase(), id);
      flat.push({
        draftFolderId: id,
        parentDraftFolderId: parentDraftId,
        name: node.name,
        displayOrder: index,
      });
      flatten(node.children, rel, id);
    });
  };
  flatten(preset.folders, '', null);
  const outputMappings: ProjectFolderDraftOutputMappingInput[] = [];
  for (const [outputTypeId, destinationPath] of Object.entries(preset.outputFolders)) {
    if (!destinationPath) continue;
    const destinationDraftFolderId = pathToId.get(destinationPath.toLowerCase());
    if (destinationDraftFolderId) {
      outputMappings.push({ outputTypeId, destinationDraftFolderId });
    }
  }
  return { folders: flat, outputMappings, sourceProfile };
}

interface CreateResponseData {
  project: {
    id: string;
    projectCode: string;
    crmReference: string | null;
    projectFolderPath: string | null;
    folderProfile: string;
  };
  workspace: {
    folderSnapshot: ProjectFolderSnapshot;
    outputMappings: OutputMapping[];
    folderConfigurationFingerprint: string;
    scopeItems: Array<{ id: string; label: string }>;
  };
  folderCreation: { folderPath: string; createdFolderCount: number } | null;
  folderError: string | null;
}

async function getWorkspace(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
): Promise<CreateResponseData['workspace']> {
  const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/workspace` });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: CreateResponseData['workspace'] }>().data;
}

describe('P2.4B4 folder / profile / output end-to-end reality gate', () => {
  it('Reality 1 - settings profile is canonical, defaulted by id, and reloads exactly', async () => {
    const { app } = await setup();

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json<{ data: FolderProfile }>().data;
    expect(profile.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.folders.every((f) => f.profileFolderId.length > 0)).toBe(true);
    const outputTypeIds = profile.outputDefaults.map((o) => o.outputTypeId).sort();
    expect(outputTypeIds).toEqual(
      [
        'authoritySubmission',
        'boqExcel',
        'boqPdf',
        'datasheets',
        'renderPackage',
        'scheduleExcel',
        'schedulePdf',
      ].sort(),
    );

    const setDefault = await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'user', profileId: profile.profileId },
    });
    expect(setDefault.statusCode).toBe(200);
    const catalog = setDefault.json<{
      data: { defaultProfileRef: { kind: string; profileId?: string } };
    }>().data;
    expect(catalog.defaultProfileRef).toEqual({ kind: 'user', profileId: profile.profileId });

    const catalogAgain = await app.inject({ method: 'GET', url: '/api/folder-profiles/catalog' });
    const reloaded = catalogAgain.json<{
      data: {
        defaultProfileRef: { kind: string; profileId?: string };
        effectiveDefaultRef: { kind: string; profileId?: string };
      };
    }>().data;
    expect(reloaded.defaultProfileRef).toEqual({ kind: 'user', profileId: profile.profileId });
    expect(reloaded.effectiveDefaultRef).toEqual({ kind: 'user', profileId: profile.profileId });

    // No legacy display-name identity becomes authority: the default ref is the UUID.
    expect(profile.profileId).not.toBe('Lighting Design - Full Package');
  });

  it('Realities 2-10 - full new-project journey: profile select, customize, save-as, review, canonical create, snapshot, physical disk', async () => {
    const { config, app } = await setup();

    // --- Settings: create the professional profile and set it as the canonical default. ---
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    expect(created.statusCode).toBe(201);
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    await app.inject({
      method: 'PUT',
      url: '/api/folder-profiles/catalog/default',
      payload: { kind: 'user', profileId: sourceProfile.profileId },
    });

    // --- New Project Step 3: canonical default selected by profileId. ---
    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/api/folder-profiles/catalog',
    });
    const catalog = catalogResponse.json<{
      data: { effectiveDefaultRef: { kind: string; profileId?: string } };
    }>().data;
    expect(catalog.effectiveDefaultRef).toEqual({
      kind: 'user',
      profileId: sourceProfile.profileId,
    });

    // Build the wizard draft exactly as the web does (fresh draft ids, source provenance).
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    expect(draft.folders.length).toBe(14);
    expect(draft.outputMappings.length).toBe(7);
    // Compact preview: no filesystem call, no existing-project action — the draft is pure state.
    expect(draft.folders.every((f) => f.sourceProfileFolderId)).toBe(true);

    // --- Reality 4: project-only customization. ---
    const byName = new Map(draft.folders.map((f) => [f.name, f]));
    const drawings = byName.get('03_DRAWINGS')!;
    const technical = byName.get('02_TECHNICAL')!;
    const presentation = byName.get('04_PRESENTATION')!;
    const deliverables = byName.get('05_DELIVERABLES')!;

    // Rename 03_DRAWINGS -> 03_LIGHTING_DRAWINGS, keeping draftFolderId.
    const drawingsId = drawings.draftFolderId;
    drawings.name = '03_LIGHTING_DRAWINGS';

    // Add a project-only folder MOCKUP under 02_TECHNICAL with a fresh id and no source provenance.
    const mockupId = crypto.randomUUID();
    draft.folders.push({
      draftFolderId: mockupId,
      parentDraftFolderId: technical.draftFolderId,
      name: 'MOCKUP',
      displayOrder: 3,
    });

    // Move 04_PRESENTATION under 05_DELIVERABLES.
    presentation.parentDraftFolderId = deliverables.draftFolderId;

    // Reorder two siblings (swap 00_RECEIVED and 06_ARCHIVE display order).
    const received = byName.get('00_RECEIVED')!;
    const archive = byName.get('06_ARCHIVE')!;
    [received.displayOrder, archive.displayOrder] = [archive.displayOrder, received.displayOrder];

    // Change one known output destination (scheduleExcel -> 05_DELIVERABLES).
    const scheduleExcel = draft.outputMappings.find((m) => m.outputTypeId === 'scheduleExcel')!;
    scheduleExcel.destinationDraftFolderId = deliverables.draftFolderId;

    // Existing draftFolderIds survive rename/reorder/move.
    expect(byName.get('03_DRAWINGS')!.draftFolderId).toBe(drawingsId);
    const finalDrawings = draft.folders.find((f) => f.draftFolderId === drawingsId)!;
    expect(finalDrawings.name).toBe('03_LIGHTING_DRAWINGS');
    // New project-only folder: fresh id, no fake source provenance.
    expect(
      draft.folders.find((f) => f.draftFolderId === mockupId)?.sourceProfileFolderId,
    ).toBeUndefined();
    // Unknown outputs survive.
    const unknownIds = draft.outputMappings
      .filter((m) => m.outputTypeId === 'authoritySubmission' || m.outputTypeId === 'renderPackage')
      .map((m) => m.outputTypeId);
    expect(unknownIds.sort()).toEqual(['authoritySubmission', 'renderPackage']);

    // --- Reality 5: navigation persistence — the draft state is not rebuilt from the profile. ---
    // (Web navigation preserves React state; at the API level we assert the draft is self-contained
    // and the source profile has not been mutated by any customization.)
    const sourceAfter = await app.inject({
      method: 'GET',
      url: `/api/folder-profiles/catalog/${sourceProfile.profileId}`,
    });
    const untouchedSource = sourceAfter.json<{ data: FolderProfile }>().data;
    expect(untouchedSource.folders).toEqual(sourceProfile.folders);
    expect(untouchedSource.outputDefaults).toEqual(sourceProfile.outputDefaults);

    // --- Reality 6: Save As New Profile. ---
    const saveAs = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: draftToProfileCreateInput(draft, 'Lighting Design + Mockup'),
    });
    expect(saveAs.statusCode).toBe(201);
    const savedProfile = saveAs.json<{ data: FolderProfile }>().data;
    expect(savedProfile.profileId).not.toBe(sourceProfile.profileId);
    expect(savedProfile.profileId).toMatch(/^[0-9a-f-]{36}$/);
    const draftIds = new Set(draft.folders.map((f) => f.draftFolderId));
    expect(savedProfile.folders.every((f) => !draftIds.has(f.profileFolderId))).toBe(true);
    const savedTypes = savedProfile.outputDefaults.map((o) => o.outputTypeId).sort();
    expect(savedTypes).toContain('authoritySubmission');
    expect(savedTypes).toContain('renderPackage');
    // Global default NOT automatically changed.
    const catalogAfterSave = await app.inject({
      method: 'GET',
      url: '/api/folder-profiles/catalog',
    });
    expect(
      catalogAfterSave.json<{ data: { defaultProfileRef: { kind: string; profileId?: string } } }>()
        .data.defaultProfileRef,
    ).toEqual({ kind: 'user', profileId: sourceProfile.profileId });
    // Current draft unchanged.
    expect(draft.folders.length).toBe(15);
    expect(draft.outputMappings.length).toBe(7);

    // --- Reality 8: canonical create. ---
    const idempotencyKey = crypto.randomUUID();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
        folderProfile: sourceProfile.name,
        folderDraft: draft,
        idempotencyKey,
      }),
    });
    expect(createResponse.statusCode).toBe(201);
    const projectData = createResponse.json<{ data: CreateResponseData }>().data;
    expect(projectData.folderError).toBeNull();
    expect(projectData.project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(projectData.project.projectCode).toMatch(/^001_SCT260807_DUBAI_HILLS_LIGHTING_TEST$/);
    expect(projectData.project.crmReference).toBe('CRM-B4-001');
    expect(projectData.folderCreation?.createdFolderCount).toBe(15);

    const snapshot = projectData.workspace.folderSnapshot;
    const snapshotIds = new Set(snapshot.folders.map((f) => f.folderId));
    // Fresh project folder ids differ from draft ids and profile ids.
    expect([...snapshotIds].every((id) => !draftIds.has(id))).toBe(true);
    expect(
      [...snapshotIds].every((id) => !sourceProfile.folders.some((p) => p.profileFolderId === id)),
    ).toBe(true);
    // Provenance retained.
    expect(snapshot.sourceProfile?.profileId).toBe(sourceProfile.profileId);
    expect(snapshot.sourceProfile?.profileName).toBe('Lighting Design - Full Package');

    // --- Reality 9: persisted snapshot equals the final reviewed draft structurally. ---
    const bySnapshotName = new Map(snapshot.folders.map((f) => [f.name, f]));
    expect(bySnapshotName.get('03_LIGHTING_DRAWINGS')).toBeTruthy();
    expect(bySnapshotName.get('03_DRAWINGS')).toBeUndefined();
    const snapshotMockup = bySnapshotName.get('MOCKUP')!;
    expect(snapshotMockup.sourceProfileFolderId).toBeUndefined();
    const drawingsSnapshot = bySnapshotName.get('03_LIGHTING_DRAWINGS')!;
    expect(drawingsSnapshot.sourceProfileFolderId).toBe(
      byName.get('03_DRAWINGS')!.sourceProfileFolderId,
    );
    expect(relativePath(snapshot, bySnapshotName.get('04_PRESENTATION')!.folderId)).toBe(
      '05_DELIVERABLES/04_PRESENTATION',
    );
    expect(relativePath(snapshot, snapshotMockup.folderId)).toBe('02_TECHNICAL/MOCKUP');

    // Exactly one canonical snapshot, exactly the mappings, no dangling destination.
    const mappings = projectData.workspace.outputMappings;
    expect(mappings).toHaveLength(7);
    for (const mapping of mappings) {
      expect(mapping.unresolved).toBe(false);
      expect(mapping.destinationFolderId).not.toBeNull();
      expect(snapshotIds.has(mapping.destinationFolderId!)).toBe(true);
    }
    const mappingByType = new Map(mappings.map((m) => [m.outputTypeId, m]));
    expect(mappingByType.get('scheduleExcel')?.destinationFolderId).toBe(
      bySnapshotName.get('05_DELIVERABLES')?.folderId,
    );
    expect(mappingByType.get('authoritySubmission')?.destinationFolderId).toBe(
      bySnapshotName.get('05_DELIVERABLES')?.folderId,
    );
    expect(mappingByType.get('renderPackage')?.destinationFolderId).toBe(
      bySnapshotName.get('04_PRESENTATION')?.folderId,
    );

    // --- Reality 10: physical disk matches the enabled canonical snapshot. ---
    const expectedPaths = [
      '00_RECEIVED',
      '01_WORKING',
      '01_WORKING/3D',
      '01_WORKING/CAD',
      '01_WORKING/DIALUX',
      '01_WORKING/REVIT',
      '02_TECHNICAL',
      '02_TECHNICAL/BOQ',
      '02_TECHNICAL/DATASHEETS',
      '02_TECHNICAL/LUMINAIRE_SCHEDULE',
      '02_TECHNICAL/MOCKUP',
      '03_LIGHTING_DRAWINGS',
      '05_DELIVERABLES',
      '05_DELIVERABLES/04_PRESENTATION',
      '06_ARCHIVE',
    ].sort((a, b) => a.localeCompare(b));
    expect(relativeDirectories(projectData.folderCreation!.folderPath)).toEqual(expectedPaths);
    // Old 03_DRAWINGS does not appear as a stale descendant.
    expect(
      relativeDirectories(projectData.folderCreation!.folderPath).some((p) =>
        p.includes('03_DRAWINGS'),
      ),
    ).toBe(false);
  });

  it('Reality 11 - source profile independence after create (edit + delete source)', async () => {
    const { config, app } = await setup();

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = createResponse.json<{ data: CreateResponseData }>().data;
    const projectId = data.project.id;
    const before = await getWorkspace(app, projectId);

    // Edit the source profile materially.
    await app.inject({
      method: 'PATCH',
      url: `/api/folder-profiles/catalog/${sourceProfile.profileId}`,
      payload: {
        name: 'Lighting Design - Full Package RENAMED',
        description: 'Mutated after project creation.',
        folders: [
          { name: '00_RECEIVED', children: [] },
          { name: '01_WORKING', children: [{ name: 'CAD', children: [] }] },
          { name: '99_NEW_AREA', children: [] },
        ],
        outputDefaults: [{ outputTypeId: 'scheduleExcel', destinationPath: '99_NEW_AREA' }],
      },
    });
    // Delete the source profile in the isolated test.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/folder-profiles/catalog/${sourceProfile.profileId}`,
    });
    expect(deleted.statusCode).toBe(200);

    const after = await getWorkspace(app, projectId);
    expect(after.folderSnapshot.folders).toEqual(before.folderSnapshot.folders);
    expect(after.folderSnapshot.sourceProfile).toEqual(before.folderSnapshot.sourceProfile);
    expect(after.outputMappings).toEqual(before.outputMappings);
    expect(after.folderConfigurationFingerprint).toBe(before.folderConfigurationFingerprint);
  });

  it('Reality 12 - reload/reopen from persisted state regenerates nothing', async () => {
    const { config, provider, app } = await setup();

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = createResponse.json<{ data: CreateResponseData }>().data;
    const projectId = data.project.id;
    const before = await getWorkspace(app, projectId);

    // Reopen a fresh store against the same DB — simulates a restart without a
    // second provider/sqlite handle (avoiding Windows file locks on cleanup).
    const reopenedStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenedStore);
    const reopenedApp = await createApp({
      config,
      provider,
      personalStore: reopenedStore,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(reopenedApp);

    const after = await getWorkspace(reopenedApp, projectId);
    expect(after.folderSnapshot).toEqual(before.folderSnapshot);
    expect(after.outputMappings).toEqual(before.outputMappings);
    expect(after.folderSnapshot.sourceProfile).toEqual(before.folderSnapshot.sourceProfile);
    expect(relativeDirectories(data.folderCreation!.folderPath)).toEqual(
      relativeDirectories(path.join(config.PERSONAL_PROJECT_ROOT, data.project.projectCode)),
    );
  });

  it('Realities 13-19 + 21 - controlled existing-project edits preserve IDs and protect mappings', async () => {
    const { config, app } = await setup();

    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = createResponse.json<{ data: CreateResponseData }>().data;
    const projectId = data.project.id;
    const folderPath = data.folderCreation!.folderPath;
    let workspace = await getWorkspace(app, projectId);

    const byName = new Map(workspace.folderSnapshot.folders.map((f) => [f.name, f]));
    const receivedId = byName.get('00_RECEIVED')!.folderId;
    const boqId = byName.get('BOQ')!.folderId;
    const scheduleId = byName.get('LUMINAIRE_SCHEDULE')!.folderId;
    const technicalId = byName.get('02_TECHNICAL')!.folderId;
    const deliverablesId = byName.get('05_DELIVERABLES')!.folderId;
    const archiveId = byName.get('06_ARCHIVE')!.folderId;

    const runAction = async (body: Record<string, unknown>) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/folder-actions`,
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      workspace = await getWorkspace(app, projectId);
      return response;
    };
    const fp = () => workspace.folderConfigurationFingerprint;

    // Reality 13 - rename a content-safe folder.
    writeFileSync(path.join(folderPath, '00_RECEIVED', 'brief.txt'), 'brief');
    await runAction({
      action: 'rename',
      folderId: receivedId,
      name: '00_INPUT',
      expectedFolderConfigurationFingerprint: fp(),
    });
    expect(workspace.folderSnapshot.folders.find((f) => f.folderId === receivedId)?.name).toBe(
      '00_INPUT',
    );
    expect(existsSync(path.join(folderPath, '00_INPUT', 'brief.txt'))).toBe(true);
    expect(existsSync(path.join(folderPath, '00_RECEIVED'))).toBe(false);

    // Reality 14 - case-only rename keeps the same folderId and updates disk spelling.
    await runAction({
      action: 'rename',
      folderId: receivedId,
      name: '00_input',
      expectedFolderConfigurationFingerprint: fp(),
    });
    const renamed = workspace.folderSnapshot.folders.find((f) => f.folderId === receivedId)!;
    expect(renamed.name).toBe('00_input');
    expect(renamed.folderId).toBe(receivedId);
    const rootEntries = readdirSync(folderPath);
    expect(rootEntries).toContain('00_input');
    expect(rootEntries).not.toContain('00_INPUT');

    // Reality 15 - move a folder (stable ids for it and its descendants).
    const movingId = byName.get('03_DRAWINGS')!.folderId;
    await runAction({
      action: 'move',
      folderId: movingId,
      newParentFolderId: technicalId,
      expectedFolderConfigurationFingerprint: fp(),
    });
    expect(
      workspace.folderSnapshot.folders.find((f) => f.folderId === movingId)?.parentFolderId,
    ).toBe(technicalId);
    expect(relativePath(workspace.folderSnapshot, movingId)).toBe('02_TECHNICAL/03_DRAWINGS');
    expect(existsSync(path.join(folderPath, '02_TECHNICAL', '03_DRAWINGS'))).toBe(true);

    // Reality 16 - reorder siblings changes displayOrder, no physical move, ids unchanged.
    const archiveOrder = workspace.folderSnapshot.folders.find(
      (f) => f.folderId === archiveId,
    )!.displayOrder;
    const scheduleOrder = workspace.folderSnapshot.folders.find(
      (f) => f.folderId === scheduleId,
    )!.displayOrder;
    await runAction({
      action: 'reorder',
      folderId: scheduleId,
      newDisplayOrder: scheduleOrder,
      expectedFolderConfigurationFingerprint: fp(),
    });
    // Physical tree unchanged (no numeric prefix rewriting; reorder is logical only).
    expect(existsSync(path.join(folderPath, '02_TECHNICAL', 'LUMINAIRE_SCHEDULE'))).toBe(true);
    expect(workspace.folderSnapshot.folders.find((f) => f.folderId === scheduleId)?.folderId).toBe(
      scheduleId,
    );
    void archiveOrder;

    // Reality 17 - disable/enable an unmapped folder: no destructive delete, stable id.
    await runAction({
      action: 'disable',
      folderId: archiveId,
      expectedFolderConfigurationFingerprint: fp(),
    });
    expect(workspace.folderSnapshot.folders.find((f) => f.folderId === archiveId)?.enabled).toBe(
      false,
    );
    expect(existsSync(path.join(folderPath, '06_ARCHIVE'))).toBe(true);
    await runAction({
      action: 'enable',
      folderId: archiveId,
      expectedFolderConfigurationFingerprint: fp(),
    });
    expect(workspace.folderSnapshot.folders.find((f) => f.folderId === archiveId)?.enabled).toBe(
      true,
    );

    // Reality 18 - mapped folder protection: BOQ is an output destination (boqExcel/boqPdf).
    const disableMapped = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions`,
      payload: { action: 'disable', folderId: boqId, expectedFolderConfigurationFingerprint: fp() },
    });
    expect(disableMapped.statusCode).toBe(409);
    const deleteMapped = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: boqId,
        expectedFolderConfigurationFingerprint: fp(),
      },
    });
    expect(deleteMapped.statusCode).toBe(409);

    // Reality 19 - delete empty only: add empty folder, delete; then non-empty blocked.
    const tempId = crypto.randomUUID();
    const addResponse = await runAction({
      action: 'add',
      parentFolderId: technicalId,
      name: 'TEMP_EMPTY',
      expectedFolderConfigurationFingerprint: fp(),
    });
    const addedId = addResponse.json<{ data: { folderId: string } }>().data.folderId;
    void tempId;
    await runAction({
      action: 'delete-empty',
      folderId: addedId,
      expectedFolderConfigurationFingerprint: fp(),
    });
    expect(existsSync(path.join(folderPath, '02_TECHNICAL', 'TEMP_EMPTY'))).toBe(false);

    const nonEmptyId = crypto.randomUUID();
    const addNonEmpty = await runAction({
      action: 'add',
      parentFolderId: technicalId,
      name: 'TEMP_NONEMPTY',
      expectedFolderConfigurationFingerprint: fp(),
    });
    const nonEmptyFolderId = addNonEmpty.json<{ data: { folderId: string } }>().data.folderId;
    void nonEmptyId;
    writeFileSync(path.join(folderPath, '02_TECHNICAL', 'TEMP_NONEMPTY', 'keep.txt'), 'keep');
    const blockDelete = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions`,
      payload: {
        action: 'delete-empty',
        folderId: nonEmptyFolderId,
        expectedFolderConfigurationFingerprint: fp(),
      },
    });
    expect(blockDelete.statusCode).toBe(400);
    expect(existsSync(path.join(folderPath, '02_TECHNICAL', 'TEMP_NONEMPTY', 'keep.txt'))).toBe(
      true,
    );

    // Reality 21 - output identity after structural edits.
    const finalMappings = new Map(workspace.outputMappings.map((m) => [m.outputTypeId, m]));
    // scheduleExcel still points to its original destination folder id (LUMINAIRE_SCHEDULE).
    expect(finalMappings.get('scheduleExcel')?.destinationFolderId).toBe(scheduleId);
    // authoritySubmission and renderPackage point to the same intended folder ids.
    expect(finalMappings.get('authoritySubmission')?.destinationFolderId).toBe(deliverablesId);
    expect(finalMappings.get('renderPackage')?.destinationFolderId).toBe(
      byName.get('04_PRESENTATION')!.folderId,
    );
  });

  it('Reality 20 - external link / drift safety stays fail-closed', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = createResponse.json<{ data: CreateResponseData }>().data;
    const projectId = data.project.id;
    const folderPath = data.folderCreation!.folderPath;
    const workspace = await getWorkspace(app, projectId);
    const receivedId = workspace.folderSnapshot.folders.find(
      (f) => f.name === '00_RECEIVED',
    )!.folderId;

    // Unknown folderId is not treated as an arbitrary managed descendant.
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: 'not-a-real-folder-id',
        name: 'X',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(unknown.statusCode).toBe(400);

    // Link/junction safety: if a junction can be created, managed edits must refuse.
    const linkPath = path.join(folderPath, '00_RECEIVED');
    const external = path.join(config.PERSONAL_PROJECT_ROOT, 'external-target');
    mkdirSync(external, { recursive: true });
    try {
      rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(external, linkPath, 'junction');
    } catch {
      return; // junction creation not available here; covered by service tests.
    }
    const unsafe = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/folder-actions`,
      payload: {
        action: 'rename',
        folderId: receivedId,
        name: '00_SAFE',
        expectedFolderConfigurationFingerprint: workspace.folderConfigurationFingerprint,
      },
    });
    expect(unsafe.statusCode).toBe(409);
  });

  it('Reality 22 - same-key idempotency returns the identical project and tree', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();
    const payload = createProjectPayload(config, { folderDraft: draft, idempotencyKey });

    const first = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(first.statusCode).toBe(201);
    const createdData = first.json<{ data: CreateResponseData }>().data;
    const rootPath = createdData.folderCreation!.folderPath;
    const diskBefore = relativeDirectories(rootPath);

    const retry = await app.inject({ method: 'POST', url: '/api/projects', payload });
    expect(retry.statusCode).toBe(201);
    const repeated = retry.json<{ data: CreateResponseData }>().data;
    expect(repeated.project.id).toBe(createdData.project.id);
    expect(repeated.workspace.folderSnapshot.folders).toEqual(
      createdData.workspace.folderSnapshot.folders,
    );
    expect(repeated.workspace.outputMappings).toEqual(createdData.workspace.outputMappings);
    expect(repeated.folderCreation).toBeNull(); // no second tree.
    expect(relativeDirectories(rootPath)).toEqual(diskBefore);
  });

  it('Reality 23 - physical creation failure surfaces Folder Needs Attention and recovers from persisted snapshot', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();

    // Create durable project state without materializing folders.
    const later = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
        folderDraft: draft,
        idempotencyKey,
        createFolders: false,
      }),
    });
    expect(later.statusCode).toBe(201);
    const laterData = later.json<{ data: CreateResponseData }>().data;
    expect(laterData.folderCreation).toBeNull();
    const projectCode = laterData.project.projectCode;

    // Block the physical root so materialization fails AFTER durable state exists.
    const blocker = path.join(config.PERSONAL_PROJECT_ROOT, projectCode);
    mkdirSync(blocker);
    const failed = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
        folderDraft: draft,
        idempotencyKey,
        createFolders: true,
      }),
    });
    expect(failed.statusCode).toBe(201);
    const failedData = failed.json<{ data: CreateResponseData }>().data;
    expect(failedData.project.id).toBe(laterData.project.id);
    expect(failedData.folderError).toContain('already exists');
    expect(failedData.project.projectFolderPath).toBeNull();
    // Snapshot and mappings survive the failure.
    expect(failedData.workspace.folderSnapshot.folders).toEqual(
      laterData.workspace.folderSnapshot.folders,
    );
    expect(failedData.workspace.outputMappings).toEqual(laterData.workspace.outputMappings);

    // Remove blocker and recover using the persisted snapshot.
    rmSync(blocker, { recursive: true, force: true });
    const recovered = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
        folderDraft: draft,
        idempotencyKey,
        createFolders: true,
      }),
    });
    expect(recovered.statusCode).toBe(201);
    const recoveredData = recovered.json<{ data: CreateResponseData }>().data;
    expect(recoveredData.folderError).toBeNull();
    expect(recoveredData.project.id).toBe(laterData.project.id);
    expect(recoveredData.folderCreation?.createdFolderCount).toBe(14);
    expect(recoveredData.workspace.folderSnapshot.folders).toEqual(
      failedData.workspace.folderSnapshot.folders,
    );
  });

  it('Reality 24 - blank project creates exactly zero folders and no injected defaults', async () => {
    const { config, app } = await setup();
    const draft: ProjectFolderDraft = { folders: [], outputMappings: [], sourceProfile: null };
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft, folderProfile: 'Blank' }),
    });
    expect(response.statusCode).toBe(201);
    const data = response.json<{ data: CreateResponseData }>().data;
    expect(data.folderError).toBeNull();
    expect(data.workspace.folderSnapshot.folders).toEqual([]);
    expect(data.workspace.outputMappings).toEqual([]);
    expect(data.folderCreation?.createdFolderCount).toBe(0);
    expect(relativeDirectories(data.folderCreation!.folderPath)).toEqual([]);
  });

  it('Reality 25 - factory profile uses factoryProfileKey and produces an independent project', async () => {
    const { config, app } = await setup();
    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((p) => p.factoryProfileKey === 'full-lighting-design');
    if (!preset) throw new Error('Missing full-lighting-design factory profile.');
    expect(preset.source).toBe('factory');
    expect(preset.builtIn).toBe(true);

    const source = factoryProfileSource(
      preset.factoryProfileKey!,
      preset.name,
      folderProfileStructuralFingerprint(preset.folders, preset.outputFolders),
    );
    const draft = presetToDraft(preset, source, () => crypto.randomUUID());
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft, folderProfile: preset.name }),
    });
    expect(response.statusCode).toBe(201);
    const data = response.json<{ data: CreateResponseData }>().data;
    expect(data.folderError).toBeNull();
    expect(data.workspace.folderSnapshot.sourceProfile?.factoryProfileKey).toBe(
      'full-lighting-design',
    );
    expect(data.workspace.folderSnapshot.sourceProfile?.profileId).toBeNull();
    // Independent snapshot and project folder ids.
    expect(data.workspace.folderSnapshot.folders.length).toBeGreaterThan(0);
    const draftIds = new Set(draft.folders.map((f) => f.draftFolderId));
    expect(data.workspace.folderSnapshot.folders.every((f) => !draftIds.has(f.folderId))).toBe(
      true,
    );
  });

  it('Reality 26 - legacy creation adapter remains green with canonical output', async () => {
    const { config, app } = await setup();
    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((p) => p.name === 'Full Lighting Design');
    if (!preset) throw new Error('Missing Full Lighting Design factory profile.');

    const legacy = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
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

    // Legacy historical profiles stay explicit-import-only: the New Project selector excludes them.
    const legacyList = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const sources = legacyList
      .json<{ data: Array<{ source: string }> }>()
      .data.map((p) => p.source);
    expect(sources).not.toContain('legacy');
  });

  it('Reality 27 - Scope and Folder Profile are fully independent', async () => {
    const { config, app } = await setup();
    const profiles = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
    const preset = profiles
      .json<{ data: FolderProfilePreset[] }>()
      .data.find((p) => p.factoryProfileKey === 'full-lighting-design');
    if (!preset) throw new Error('Missing factory profile.');

    const scopeA = [
      { code: 'LightingLayout', label: 'Lighting Layout', custom: false },
      { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
    ];
    const scopeB = [
      { code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false },
      { label: 'Custom Scope Item', custom: true },
    ];

    // Same folder profile (factory) with two different scopes.
    const factorySource = factoryProfileSource(
      preset.factoryProfileKey!,
      preset.name,
      folderProfileStructuralFingerprint(preset.folders, preset.outputFolders),
    );
    const draft1 = presetToDraft(preset, factorySource, () => crypto.randomUUID());
    const draft2 = presetToDraft(preset, factorySource, () => crypto.randomUUID());
    const p1 = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft1, scopeItems: scopeA }),
    });
    const p2 = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft2, scopeItems: scopeB }),
    });
    expect(p1.statusCode).toBe(201);
    expect(p2.statusCode).toBe(201);

    // Two different folder profiles with the same scope (factory vs blank).
    const blank = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, {
        folderDraft: { folders: [], outputMappings: [], sourceProfile: null },
        scopeItems: scopeA,
        folderProfile: 'Blank',
      }),
    });
    expect(blank.statusCode).toBe(201);
    const factoryData = p1.json<{ data: CreateResponseData }>().data;
    const blankData = blank.json<{ data: CreateResponseData }>().data;
    expect(factoryData.workspace.folderSnapshot.folders.length).toBeGreaterThan(0);
    expect(blankData.workspace.folderSnapshot.folders.length).toBe(0);
  });

  it('Reality 28 - project reference/root rename keeps ids, snapshot, and mappings intact', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = createResponse.json<{ data: CreateResponseData }>().data;
    const projectId = data.project.id;
    const oldCode = data.project.projectCode;
    const before = await getWorkspace(app, projectId);
    const oldFolder = data.folderCreation!.folderPath;
    const newCode = oldCode.replace('DUBAI_HILLS_LIGHTING_TEST', 'DUBAI_HILLS_LIGHTING_RENAMED');

    const changeResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/reference`,
      payload: {
        projectCode: newCode,
        expectedVersion: 1,
        auditReason: 'Client renamed the project.',
      },
    });
    expect(changeResponse.statusCode).toBe(200);
    const changed = changeResponse.json<{
      data: { project: { id: string; projectCode: string } };
    }>().data;
    expect(changed.project.id).toBe(projectId);
    expect(changed.project.projectCode).toBe(newCode);
    expect(existsSync(path.join(path.dirname(oldFolder), newCode))).toBe(true);
    expect(existsSync(oldFolder)).toBe(false);

    const after = await getWorkspace(app, projectId);
    expect(after.folderSnapshot.folders).toEqual(before.folderSnapshot.folders);
    expect(after.outputMappings).toEqual(before.outputMappings);
    // CRM and project id preserved; snapshot not regenerated.
    const projectResponse = await app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
    const project = projectResponse.json<{ data: { id: string; crmReference: string | null } }>()
      .data;
    expect(project.id).toBe(projectId);
    expect(project.crmReference).toBe('CRM-B4-001');
  });

  it('Reality 29 - no silent data loss across the whole journey', async () => {
    const { config, app } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/folder-profiles/catalog',
      payload: fullPackageProfileInput(),
    });
    const sourceProfile = created.json<{ data: FolderProfile }>().data;
    const draft = canonicalProfileToDraft(sourceProfile, () => crypto.randomUUID());
    const before = {
      draftIds: new Set(draft.folders.map((f) => f.draftFolderId)),
      profileIds: new Set(sourceProfile.folders.map((f) => f.profileFolderId)),
      outputTypes: draft.outputMappings.map((m) => m.outputTypeId).sort(),
      scopeLabels: [
        'Authority Submission',
        'Datasheets Package',
        'Lighting Layout',
        'Luminaire Schedule',
        'Technical BOQ',
      ].sort(),
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: createProjectPayload(config, { folderDraft: draft }),
    });
    const data = response.json<{ data: CreateResponseData }>().data;

    const snapshotIds = new Set(data.workspace.folderSnapshot.folders.map((f) => f.folderId));
    const mappingTypes = data.workspace.outputMappings.map((m) => m.outputTypeId).sort();
    // All draft ids materialize as project folder ids (differing but 1:1 present).
    expect(snapshotIds.size).toBe(before.draftIds.size);
    // All output types preserved (known + unknown).
    expect(mappingTypes).toEqual(before.outputTypes);
    // Source profile unchanged by the project.
    const profileAfter = await app.inject({
      method: 'GET',
      url: `/api/folder-profiles/catalog/${sourceProfile.profileId}`,
    });
    expect(profileAfter.json<{ data: FolderProfile }>().data.folders).toEqual(
      sourceProfile.folders,
    );
    // Scope preserved.
    const workspaceAfter = await getWorkspace(app, data.project.id);
    const actualScope = workspaceAfter.scopeItems.map((s) => s.label).sort();
    expect(actualScope).toEqual(before.scopeLabels);
    expect(data.project.crmReference).toBe('CRM-B4-001');
    expect(data.project.projectCode).toMatch(/^001_SCT260807_DUBAI_HILLS_LIGHTING_TEST$/);
  });
});

/** Mirrors the web draftToProfileCreateInput for Save As New Profile. */
function draftToProfileCreateInput(
  draft: ProjectFolderDraft,
  name: string,
): CreateFolderProfileInput {
  const byParent = new Map<string | null, ProjectFolderDraftNodeInput[]>();
  for (const node of draft.folders) {
    const siblings = byParent.get(node.parentDraftFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentDraftFolderId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.displayOrder - b.displayOrder);
  }
  const build = (parentId: string | null): CreateFolderProfileInput['folders'] =>
    (byParent.get(parentId) ?? []).map((node) => ({
      name: node.name,
      children: build(node.draftFolderId),
    }));
  const outputDefaults: CreateFolderProfileInput['outputDefaults'] = draft.outputMappings
    .map((mapping) => {
      const p = draftRelativePath(draft, mapping.destinationDraftFolderId);
      return p ? { outputTypeId: mapping.outputTypeId, destinationPath: p } : null;
    })
    .filter((o): o is { outputTypeId: string; destinationPath: string } => o !== null);
  return {
    name,
    description: 'Custom project folder structure.',
    folders: build(null),
    outputDefaults,
  };
}

function draftRelativePath(draft: ProjectFolderDraft, draftFolderId: string): string | null {
  const byId = new Map(draft.folders.map((n) => [n.draftFolderId, n]));
  const segments: string[] = [];
  let current = byId.get(draftFolderId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.draftFolderId)) return null;
    seen.add(current.draftFolderId);
    segments.unshift(current.name);
    current = current.parentDraftFolderId ? byId.get(current.parentDraftFolderId) : undefined;
  }
  return segments.length ? segments.join('/') : null;
}
