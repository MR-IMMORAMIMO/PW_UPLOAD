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
    STANDALONE_SESSION_SECRET: 'p24a-reality-secret-that-is-longer-than-thirty-two-characters',
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

describe('P2.4A flexible personal project scope reality check', () => {
  it('creates, edits, and reopens a project with custom scope items without data loss', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24a-reality-'));
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
        clientName: 'Private Client',
        projectType: 'Villa Lighting Design',
        description: 'P2.4A reality check.',
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
        services: ['LightingDesign', 'DialuxCalculation', 'TechnicalBoq', 'Datasheets'],
        scopeItems: [
          { code: 'LightingDesign', label: 'Lighting Design', custom: false },
          { code: 'DialuxCalculation', label: 'DIALux Calculation', custom: false },
          { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
          { code: 'Datasheets', label: 'Datasheets Package', custom: false },
          { label: 'Mockup Review', custom: true },
        ],
        luminaireInputMode: 'Later',
        crmReference: 'CRM-48572',
        idempotencyKey: randomUUID(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      data: {
        project: { id: string; projectCode: string; crmReference: string | null };
        workspace: {
          services: string[];
          scopeItems: Array<{ id: string; label: string; custom: boolean }>;
          folderPath: string | null;
        };
        folderCreation: { folderPath: string } | null;
      };
    }>().data;
    const projectId = created.project.id;
    const projectCode = created.project.projectCode;
    const folderPath = created.folderCreation?.folderPath ?? null;

    expect(projectId).toMatch(uuidPattern);
    expect(projectCode).toBe('001_SCT260807_DUBAI_HILLS_VILLA');
    expect(created.project.crmReference).toBe('CRM-48572');
    expect(created.workspace.services).toEqual([
      'LightingDesign',
      'DialuxCalculation',
      'TechnicalBoq',
      'Datasheets',
    ]);
    expect(created.workspace.scopeItems.map((item) => item.label)).toEqual([
      'Lighting Design',
      'DIALux Calculation',
      'Technical BOQ',
      'Datasheets Package',
      'Mockup Review',
    ]);
    expect(folderPath).toBeTruthy();
    expect(existsSync(folderPath ?? '')).toBe(true);

    // Add a luminaire and a BOQ-style document so we can prove scope edits do not delete data.
    const luminaireResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: { tag: 'DL01', category: 'Downlight', quantity: 12 },
    });
    expect(luminaireResponse.statusCode).toBe(201);
    const luminaireId = luminaireResponse.json<{ data: { id: string } }>().data.id;
    const documentResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/documents`,
      payload: {
        category: 'TechnicalBoq',
        documentNumber: 'BOQ-01',
        title: 'Technical BOQ',
        revision: 'REV_00',
        status: 'Working',
        filePath: path.join(folderPath ?? '', 'BOQ.xlsx'),
        issuedTo: '',
        issueDate: null,
        notes: '',
      },
    });
    expect(documentResponse.statusCode).toBe(201);

    // Create a requirement, then delete it through the canonical DELETE route. The
    // requirement must disappear from the workspace read model and a Deleted activity
    // record must be appended.
    const requirementResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/requirements`,
      payload: {
        category: 'Client Information',
        title: 'Latest reflected ceiling plan',
        details: 'Required before layout coordination.',
        requestedFrom: 'Client',
        requestedAt: null,
        dueDate: null,
        status: 'Requested',
        impact: 'Blocking',
        sourceType: 'Manual',
        sourceReference: '',
        notes: '',
        sortOrder: 0,
      },
    });
    expect(requirementResponse.statusCode).toBe(201);
    const requirementId = requirementResponse.json<{ data: { id: string } }>().data.id;

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/requirements/${requirementId}`,
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({ data: { deleted: true } });

    const afterDeleteWorkspace = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const afterDelete = afterDeleteWorkspace.json<{
      data: { requirements: Array<{ id: string }>; activity: Array<{ action: string }> };
    }>().data;
    expect(afterDelete.requirements.some((item) => item.id === requirementId)).toBe(false);
    expect(afterDelete.activity.some((entry) => entry.action === 'Deleted')).toBe(true);

    // Deleting a non-existent requirement returns a typed 404.
    const missingDelete = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/requirements/missing-requirement-id`,
    });
    expect(missingDelete.statusCode).toBe(404);

    // Scope metadata is canonical, project-scoped, and returns only server-confirmed state.
    const tagResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tags`,
      payload: { label: '  Commercial   Interior ', colorKey: 'teal' },
    });
    expect(tagResponse.statusCode).toBe(201);
    const tag = tagResponse.json<{ data: { id: string; label: string; colorKey: string } }>().data;
    expect(tag.id).toMatch(uuidPattern);
    expect(tag.label).toBe('Commercial Interior');
    const duplicateTag = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tags`,
      payload: { label: 'commercial interior', colorKey: 'blue' },
    });
    expect(duplicateTag.statusCode).toBe(409);
    const recoloredTag = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/tags/${tag.id}`,
      payload: { colorKey: 'purple' },
    });
    expect(recoloredTag.json<{ data: { id: string; colorKey: string } }>().data).toMatchObject({
      id: tag.id,
      colorKey: 'purple',
    });

    const noteResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/scope-notes`,
      payload: { type: 'Exclusion', text: 'Landscape lighting is excluded.', sortOrder: 0 },
    });
    expect(noteResponse.statusCode).toBe(201);
    const note = noteResponse.json<{ data: { id: string; type: string } }>().data;
    const editedNote = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/scope-notes/${note.id}`,
      payload: { type: 'Note', text: 'Client requires 3000K throughout.', sortOrder: 0 },
    });
    expect(editedNote.json<{ data: { id: string; type: string } }>().data).toMatchObject({
      id: note.id,
      type: 'Note',
    });
    const metadataWorkspace = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(
      metadataWorkspace.json<{
        data: { tags: Array<{ id: string }>; scopeNotes: Array<{ id: string }> };
      }>().data,
    ).toMatchObject({ tags: [{ id: tag.id }], scopeNotes: [{ id: note.id }] });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/tags/${tag.id}` }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${projectId}/scope-notes/${note.id}`,
        })
      ).statusCode,
    ).toBe(200);

    // Reopen the project and confirm the scope survived.
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

    const workspaceResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(workspaceResponse.statusCode).toBe(200);
    const workspace = workspaceResponse.json<{
      data: {
        services: string[];
        scopeItems: Array<{ id: string; label: string; custom: boolean }>;
        folderPath: string | null;
        luminaires: Array<{ id: string }>;
        documents: Array<{ id: string; category: string }>;
      };
    }>().data;
    expect(workspace.services).toEqual([
      'LightingDesign',
      'DialuxCalculation',
      'TechnicalBoq',
      'Datasheets',
    ]);
    expect(workspace.scopeItems.map((item) => item.label)).toContain('Mockup Review');
    expect(workspace.folderPath).toBe(folderPath);
    expect(workspace.luminaires.map((item) => item.id)).toContain(luminaireId);
    expect(workspace.documents.some((item) => item.category === 'TechnicalBoq')).toBe(true);

    // Edit scope: remove Technical BOQ, add Authority Submission.
    const projectResponse = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    const project = projectResponse.json<{ data: { version: number } }>().data;
    const scopeResponse = await reopened.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/scope`,
      payload: {
        scopeItems: [
          { code: 'LightingDesign', label: 'Lighting Design', custom: false },
          { code: 'DialuxCalculation', label: 'DIALux Calculation', custom: false },
          { code: 'Datasheets', label: 'Datasheets Package', custom: false },
          { label: 'Mockup Review', custom: true },
          { label: 'Authority Submission', custom: true },
        ],
        expectedVersion: project.version,
      },
    });
    expect(scopeResponse.statusCode).toBe(200);
    const updated = scopeResponse.json<{
      data: {
        workspace: {
          services: string[];
          scopeItems: Array<{ id: string; label: string; custom: boolean }>;
          folderPath: string | null;
          luminaires: Array<{ id: string }>;
          documents: Array<{ id: string; category: string }>;
        };
      };
    }>().data.workspace;
    expect(updated.services).toEqual(['LightingDesign', 'DialuxCalculation', 'Datasheets']);
    expect(updated.scopeItems.map((item) => item.label)).toEqual([
      'Lighting Design',
      'DIALux Calculation',
      'Datasheets Package',
      'Mockup Review',
      'Authority Submission',
    ]);
    expect(updated.folderPath).toBe(folderPath);
    expect(updated.luminaires.map((item) => item.id)).toContain(luminaireId);
    expect(updated.documents.some((item) => item.category === 'TechnicalBoq')).toBe(true);

    // Reopen once more and confirm everything persisted.
    const finalProvider = new StandaloneDataProvider(config);
    const finalStore = new PersonalWorkspaceStore(config);
    closeables.push(finalProvider, finalStore);
    const finalApp = await createApp({
      config,
      provider: finalProvider,
      personalStore: finalStore,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(finalApp);

    const finalProjectResponse = await finalApp.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
    });
    const finalProject = finalProjectResponse.json<{
      data: {
        id: string;
        projectCode: string;
        crmReference: string | null;
        projectFolderPath: string | null;
      };
    }>().data;
    expect(finalProject.id).toBe(projectId);
    expect(finalProject.projectCode).toBe(projectCode);
    expect(finalProject.crmReference).toBe('CRM-48572');
    expect(finalProject.projectFolderPath).toBe(folderPath);

    const finalWorkspaceResponse = await finalApp.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const finalWorkspace = finalWorkspaceResponse.json<{
      data: {
        services: string[];
        scopeItems: Array<{ id: string; label: string; custom: boolean }>;
        folderPath: string | null;
        luminaires: Array<{ id: string }>;
        documents: Array<{ id: string; category: string }>;
      };
    }>().data;
    expect(finalWorkspace.services).toEqual(['LightingDesign', 'DialuxCalculation', 'Datasheets']);
    expect(finalWorkspace.scopeItems.map((item) => item.label)).toEqual([
      'Lighting Design',
      'DIALux Calculation',
      'Datasheets Package',
      'Mockup Review',
      'Authority Submission',
    ]);
    expect(finalWorkspace.folderPath).toBe(folderPath);
    expect(existsSync(folderPath ?? '')).toBe(true);
    expect(finalWorkspace.luminaires.map((item) => item.id)).toContain(luminaireId);
    expect(finalWorkspace.documents.some((item) => item.category === 'TechnicalBoq')).toBe(true);
  });
});
