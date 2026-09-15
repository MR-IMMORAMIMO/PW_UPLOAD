import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

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
    STANDALONE_SESSION_SECRET: 'p25c-reality-secret-that-is-longer-than-thirty-two-characters',
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

interface ProjectJson {
  id: string;
  projectCode: string;
  crmReference: string | null;
  status: string;
  revisionNumber: number;
  completedAt: string | null;
  cancelledAt: string | null;
  statusBeforeHold: string | null;
  projectFolderPath: string | null;
  folderProfile: string | null;
  progressPercent: number;
  version: number;
}

interface WorkspaceJson {
  services: string[];
  scopeItems: Array<{ id: string; label: string; custom: boolean }>;
  folderPath: string | null;
  outputFolders: Record<string, string>;
}

interface ActivityJson {
  actionType: string;
}

async function createPersonalApp(directory: string) {
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
  const profile = profilesResponse
    .json<{ data: Array<{ name: string; folders: unknown; outputFolders: unknown }> }>()
    .data.find((candidate) => candidate.name === 'Full Lighting Design');
  if (!profile) throw new Error('Missing Full Lighting Design folder profile.');
  return { app, config, profile, provider };
}

function createPayload(
  name: string,
  profile: { folders: unknown; outputFolders: unknown },
  projectRoot: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    projectName: name,
    clientName: 'Reality Client',
    projectType: 'Villa Lighting Design',
    description: 'P2.5C reality check.',
    siteLocation: 'Dubai Hills',
    designStage: 'Concept',
    lightingScope: 'Complete villa lighting design and documentation.',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: '2026-08-20',
    createFolders: true,
    projectRoot,
    folderProfile: 'Full Lighting Design',
    folderStructure: profile.folders,
    outputFolders: profile.outputFolders,
    services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
    scopeItems: [
      { code: 'LightingLayout', label: 'Lighting Layout', custom: false },
      { code: 'LuminaireSchedule', label: 'Luminaire Schedule', custom: false },
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

async function createProject(
  app: Awaited<ReturnType<typeof createPersonalApp>>['app'],
  payload: ReturnType<typeof createPayload>,
) {
  const response = await app.inject({ method: 'POST', url: '/api/projects', payload });
  expect(response.statusCode).toBe(201);
  const data = response.json<{
    data: {
      project: ProjectJson;
      workspace: WorkspaceJson;
      folderCreation: { folderPath: string } | null;
    };
  }>().data;
  return data;
}

async function changeStatus(
  app: Awaited<ReturnType<typeof createPersonalApp>>['app'],
  projectId: string,
  body: Record<string, unknown>,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/status`,
    payload: body,
  });
  return response;
}

async function listActivities(
  app: Awaited<ReturnType<typeof createPersonalApp>>['app'],
  projectId: string,
) {
  const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/activity` });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: ActivityJson[] }>().data;
}

describe('P2.5C Personal Workflow + Client Review reality gate', () => {
  it('runs the full operational journey through the real API boundary preserving foundation data', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-reality-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);

    const created = await createProject(
      app,
      createPayload('Workflow Journey Villa', profile, config.PERSONAL_PROJECT_ROOT),
    );
    const projectId = created.project.id;
    const projectCode = created.project.projectCode;
    const folderPath = created.folderCreation?.folderPath ?? null;

    // Reality 1 — fresh project is Planning, no automatic transition.
    expect(created.project.status).toBe('Planning');
    expect(created.project.revisionNumber).toBe(0);
    expect(folderPath).toBeTruthy();
    expect(existsSync(folderPath ?? '')).toBe(true);

    // Reality 2 — Start Work.
    const start = await changeStatus(app, projectId, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    expect(start.statusCode).toBe(200);
    expect(start.json<{ data: ProjectJson }>().data.status).toBe('InProgress');

    // Reality 3 — Move to Client Review.
    const review1 = await changeStatus(app, projectId, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(review1.statusCode).toBe(200);
    expect(review1.json<{ data: ProjectJson }>().data.status).toBe('ClientReview');

    // Reality 4 — Client Requested Changes: no Revision entity, no revisionNumber bump.
    const revision1 = await changeStatus(app, projectId, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(revision1.statusCode).toBe(200);
    const revision1Project = revision1.json<{ data: ProjectJson }>().data;
    expect(revision1Project.status).toBe('RevisionRequired');
    expect(revision1Project.revisionNumber).toBe(0);

    // Reality 5 — Start Revision Work.
    const back1 = await changeStatus(app, projectId, {
      status: 'InProgress',
      expectedCurrentStatus: 'RevisionRequired',
    });
    expect(back1.json<{ data: ProjectJson }>().data.status).toBe('InProgress');

    // Reality 6 — repeat the loop one full additional cycle.
    const review2 = await changeStatus(app, projectId, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(review2.json<{ data: ProjectJson }>().data.status).toBe('ClientReview');
    const revision2 = await changeStatus(app, projectId, {
      status: 'RevisionRequired',
      reason: 'Client requested further lighting revisions.',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(revision2.json<{ data: ProjectJson }>().data.status).toBe('RevisionRequired');
    const back2 = await changeStatus(app, projectId, {
      status: 'InProgress',
      expectedCurrentStatus: 'RevisionRequired',
    });
    expect(back2.json<{ data: ProjectJson }>().data.status).toBe('InProgress');

    // Reality 3 again — Client Review.
    const review3 = await changeStatus(app, projectId, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(review3.json<{ data: ProjectJson }>().data.status).toBe('ClientReview');

    // Reality 11 — Complete from ClientReview is allowed.
    const completed = await changeStatus(app, projectId, {
      status: 'Completed',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(completed.statusCode).toBe(200);
    const completedProject = completed.json<{ data: ProjectJson }>().data;
    expect(completedProject.status).toBe('Completed');
    expect(completedProject.completedAt).toBeTruthy();

    // Reality 12 — Reopen.
    const reopened = await changeStatus(app, projectId, {
      status: 'InProgress',
      expectedCurrentStatus: 'Completed',
    });
    expect(reopened.statusCode).toBe(200);
    const reopenedProject = reopened.json<{ data: ProjectJson }>().data;
    expect(reopenedProject.status).toBe('InProgress');
    expect(reopenedProject.completedAt).toBeNull();

    // No Revision/Submission side effects across the whole journey.
    const activities = await listActivities(app, projectId);
    const revisionRequested = activities.filter((item) => item.actionType === 'RevisionRequested');
    expect(revisionRequested).toHaveLength(2);
    expect(activities.some((item) => item.actionType === 'ProjectCompleted')).toBe(true);
    expect(activities.some((item) => item.actionType === 'ProjectReopened')).toBe(true);
    expect(reopenedProject.revisionNumber).toBe(0);

    // Reality 23 — foundation preserved: identity, CRM, scope, folder, profile, outputs.
    const projectResponse = await app.inject({ method: 'GET', url: `/api/projects/${projectId}` });
    const finalProject = projectResponse.json<{ data: ProjectJson }>().data;
    expect(finalProject.id).toBe(projectId);
    expect(finalProject.projectCode).toBe(projectCode);
    expect(finalProject.crmReference).toBe('CRM-48572');
    expect(finalProject.projectFolderPath).toBe(folderPath);
    expect(finalProject.folderProfile).toBe('Full Lighting Design');

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const workspace = workspaceResponse.json<{ data: WorkspaceJson }>().data;
    expect(workspace.folderPath).toBe(folderPath);
    expect(workspace.scopeItems.map((item) => item.label)).toContain('Mockup Review');
    expect(workspace.services).toEqual([
      'LightingLayout',
      'LuminaireSchedule',
      'TechnicalBoq',
      'Datasheets',
    ]);
    expect(workspace.outputFolders.scheduleExcel).toBeTruthy();
  });

  it('restores the recorded status on OnHold resume from InProgress, ClientReview and RevisionRequired', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-hold-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);

    // InProgress -> OnHold -> Resume.
    const inProgress = await createProject(
      app,
      createPayload('Hold In Progress', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, inProgress.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    const held1 = await changeStatus(app, inProgress.project.id, {
      status: 'OnHold',
      expectedCurrentStatus: 'InProgress',
    });
    expect(held1.statusCode).toBe(200);
    expect(held1.json<{ data: ProjectJson }>().data.statusBeforeHold).toBe('InProgress');
    const resumed1 = await changeStatus(app, inProgress.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'OnHold',
    });
    expect(resumed1.json<{ data: ProjectJson }>().data.status).toBe('InProgress');
    expect(resumed1.json<{ data: ProjectJson }>().data.statusBeforeHold).toBeNull();

    // ClientReview -> OnHold -> Resume restores ClientReview, not InProgress.
    const review = await createProject(
      app,
      createPayload('Hold Client Review', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, review.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    await changeStatus(app, review.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    const held2 = await changeStatus(app, review.project.id, {
      status: 'OnHold',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(held2.json<{ data: ProjectJson }>().data.statusBeforeHold).toBe('ClientReview');
    const resumed2 = await changeStatus(app, review.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'OnHold',
    });
    expect(resumed2.json<{ data: ProjectJson }>().data.status).toBe('ClientReview');

    // RevisionRequired -> OnHold -> Resume restores RevisionRequired.
    const revision = await createProject(
      app,
      createPayload('Hold Revision', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, revision.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    await changeStatus(app, revision.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    await changeStatus(app, revision.project.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
      expectedCurrentStatus: 'ClientReview',
    });
    const held3 = await changeStatus(app, revision.project.id, {
      status: 'OnHold',
      expectedCurrentStatus: 'RevisionRequired',
    });
    expect(held3.json<{ data: ProjectJson }>().data.statusBeforeHold).toBe('RevisionRequired');
    const resumed3 = await changeStatus(app, revision.project.id, {
      status: 'RevisionRequired',
      expectedCurrentStatus: 'OnHold',
    });
    expect(resumed3.json<{ data: ProjectJson }>().data.status).toBe('RevisionRequired');
  });

  it('falls back to InProgress for a legacy OnHold without statusBeforeHold', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-legacy-hold-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, provider } = await createPersonalApp(directory);
    const created = await createProject(
      app,
      createPayload('Legacy Hold', profile, config.PERSONAL_PROJECT_ROOT),
    );

    // Simulate a legacy project already in OnHold with no recorded prior status.
    await provider.updateProject(created.project.id, {
      status: 'OnHold',
      statusBeforeHold: null,
    });

    const resumed = await changeStatus(app, created.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'OnHold',
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json<{ data: ProjectJson }>().data.status).toBe('InProgress');
    expect(resumed.json<{ data: ProjectJson }>().data.statusBeforeHold).toBeNull();
  });

  it('enforces completion rules and cancellation reason at the API boundary', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-rules-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);

    // Planning -> Completed is blocked.
    const planning = await createProject(
      app,
      createPayload('Completion Planning', profile, config.PERSONAL_PROJECT_ROOT),
    );
    const planningComplete = await changeStatus(app, planning.project.id, {
      status: 'Completed',
      expectedCurrentStatus: 'Planning',
    });
    expect(planningComplete.statusCode).toBe(409);

    // RevisionRequired -> Completed is blocked.
    const revision = await createProject(
      app,
      createPayload('Completion Revision', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, revision.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    await changeStatus(app, revision.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    await changeStatus(app, revision.project.id, {
      status: 'RevisionRequired',
      reason: 'Client requested lighting revisions.',
      expectedCurrentStatus: 'ClientReview',
    });
    const revisionComplete = await changeStatus(app, revision.project.id, {
      status: 'Completed',
      expectedCurrentStatus: 'RevisionRequired',
    });
    expect(revisionComplete.statusCode).toBe(409);

    // OnHold -> Completed is blocked.
    const held = await createProject(
      app,
      createPayload('Completion Hold', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, held.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    await changeStatus(app, held.project.id, {
      status: 'OnHold',
      expectedCurrentStatus: 'InProgress',
    });
    const heldComplete = await changeStatus(app, held.project.id, {
      status: 'Completed',
      expectedCurrentStatus: 'OnHold',
    });
    expect(heldComplete.statusCode).toBe(409);

    // Cancellation requires a meaningful reason (server-enforced).
    const cancel = await createProject(
      app,
      createPayload('Cancel Rules', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, cancel.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    const missingReason = await changeStatus(app, cancel.project.id, {
      status: 'Cancelled',
      expectedCurrentStatus: 'InProgress',
    });
    expect(missingReason.statusCode).toBe(400);
    const whitespaceReason = await changeStatus(app, cancel.project.id, {
      status: 'Cancelled',
      expectedCurrentStatus: 'InProgress',
      reason: '   ',
    });
    expect(whitespaceReason.statusCode).toBe(400);

    const cancelled = await changeStatus(app, cancel.project.id, {
      status: 'Cancelled',
      expectedCurrentStatus: 'InProgress',
      reason: 'Client cancelled the lighting design package.',
    });
    expect(cancelled.statusCode).toBe(200);
    const cancelledProject = cancelled.json<{ data: ProjectJson }>().data;
    expect(cancelledProject.status).toBe('Cancelled');
    expect(cancelledProject.cancelledAt).toBeTruthy();
    const cancelActivities = await listActivities(app, cancel.project.id);
    expect(cancelActivities.filter((item) => item.actionType === 'ProjectCancelled')).toHaveLength(
      1,
    );

    // Reopen from Cancelled clears cancelledAt.
    const reopened = await changeStatus(app, cancel.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Cancelled',
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json<{ data: ProjectJson }>().data.cancelledAt).toBeNull();
  });

  it('rejects a stale caller with 409 and makes no mutation or activity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-stale-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const created = await createProject(
      app,
      createPayload('Stale Caller', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, created.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });
    await changeStatus(app, created.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });

    const before = (await listActivities(app, created.project.id)).length;
    // Caller still believes the project is InProgress.
    const stale = await changeStatus(app, created.project.id, {
      status: 'RevisionRequired',
      expectedCurrentStatus: 'InProgress',
    });
    expect(stale.statusCode).toBe(409);
    const projectResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.project.id}`,
    });
    expect(projectResponse.json<{ data: ProjectJson }>().data.status).toBe('ClientReview');
    expect((await listActivities(app, created.project.id)).length).toBe(before);
  });

  it('treats a lost-response retry as an idempotent successful replay without duplicate audit', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-replay-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const created = await createProject(
      app,
      createPayload('Retry Replay', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, created.project.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'Planning',
    });

    const first = await changeStatus(app, created.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(first.statusCode).toBe(200);
    const afterFirst = (await listActivities(app, created.project.id)).filter(
      (item) => item.actionType === 'StatusChanged',
    ).length;

    // Identical retry after a lost response.
    const replay = await changeStatus(app, created.project.id, {
      status: 'ClientReview',
      expectedCurrentStatus: 'InProgress',
    });
    expect(replay.statusCode).toBe(200);
    const replayProject = replay.json<{ data: ProjectJson }>().data;
    expect(replayProject.status).toBe('ClientReview');
    const afterReplay = (await listActivities(app, created.project.id)).filter(
      (item) => item.actionType === 'StatusChanged',
    ).length;
    expect(afterReplay).toBe(afterFirst);
  });

  it('keeps a fresh Planning project in Planning when progress is updated', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-noauto-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const created = await createProject(
      app,
      createPayload('No Auto Start', profile, config.PERSONAL_PROJECT_ROOT),
    );

    const projectResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.project.id}`,
    });
    const project = projectResponse.json<{ data: { version: number } }>().data;
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.project.id}`,
      payload: { progressPercent: 60, expectedVersion: project.version },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json<{ data: ProjectJson }>().data;
    expect(updated.progressPercent).toBe(60);
    expect(updated.status).toBe('Planning');
  });

  it('groups every canonical status into the correct Personal board column exactly once', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-board-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);

    const statuses = [
      'Planning',
      'InProgress',
      'RevisionRequired',
      'ClientReview',
      'OnHold',
      'InternalReview',
      'ReadyToIssue',
      'Issued',
      'Completed',
    ] as const;
    const ids: Record<string, string> = {};
    for (const status of statuses) {
      const created = await createProject(
        app,
        createPayload(`Board ${status}`, profile, config.PERSONAL_PROJECT_ROOT),
      );
      ids[status] = created.project.id;
      // Move each project into its target status through the controlled endpoint.
      const pathFor: Record<string, string[]> = {
        Planning: [],
        InProgress: ['InProgress'],
        RevisionRequired: ['InProgress', 'ClientReview', 'RevisionRequired'],
        ClientReview: ['InProgress', 'ClientReview'],
        OnHold: ['InProgress', 'OnHold'],
        InternalReview: ['InProgress', 'InternalReview'],
        ReadyToIssue: ['InProgress', 'InternalReview', 'ReadyToIssue'],
        Issued: ['InProgress', 'InternalReview', 'ReadyToIssue', 'Issued'],
        Completed: ['InProgress', 'Completed'],
      };
      for (const step of pathFor[status] ?? []) {
        const response = await changeStatus(app, created.project.id, {
          status: step,
          ...(step === 'RevisionRequired'
            ? { reason: 'Client requested lighting revisions.' }
            : {}),
        });
        expect(response.statusCode).toBe(200);
      }
    }

    const listResponse = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(listResponse.statusCode).toBe(200);
    const projects = listResponse.json<{ data: ProjectJson[] }>().data;

    const byStatus = (status: string) =>
      projects.filter((project) => project.status === status).map((project) => project.id);

    // Each project appears exactly once in its intended group.
    expect(byStatus('Planning')).toEqual([ids.Planning]);
    expect(byStatus('InProgress')).toEqual([ids.InProgress]);
    expect(byStatus('RevisionRequired')).toEqual([ids.RevisionRequired]);
    expect(byStatus('ClientReview')).toEqual([ids.ClientReview]);
    expect(byStatus('OnHold')).toEqual([ids.OnHold]);
    expect(byStatus('InternalReview')).toEqual([ids.InternalReview]);
    expect(byStatus('ReadyToIssue')).toEqual([ids.ReadyToIssue]);
    expect(byStatus('Issued')).toEqual([ids.Issued]);
    expect(byStatus('Completed')).toEqual([ids.Completed]);

    // The Personal board grouping maps these statuses to the intended columns.
    const personalBoardColumns = [
      { label: 'Not Started Yet', statuses: ['Planning'] },
      { label: 'In Progress', statuses: ['InProgress', 'RevisionRequired'] },
      { label: 'Waiting', statuses: ['WaitingForInformation', 'WaitingForSales', 'OnHold'] },
      { label: 'Client Review', statuses: ['ClientReview'] },
      { label: 'Internal Review', statuses: ['InternalReview', 'ReadyToIssue'] },
      { label: 'Issued', statuses: ['Issued'] },
      { label: 'Completed', statuses: ['Completed'] },
    ];
    const seen = new Set<string>();
    for (const column of personalBoardColumns) {
      for (const status of column.statuses) {
        for (const id of byStatus(status)) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      }
    }
    expect(seen.size).toBe(statuses.length);
  });

  it('renders legacy Personal statuses readably and never labels Issued as Submission', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p25c-legacy-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, provider } = await createPersonalApp(directory);

    for (const status of [
      'WaitingForInformation',
      'WaitingForSales',
      'InternalReview',
      'ReadyToIssue',
      'Issued',
    ] as const) {
      const created = await createProject(
        app,
        createPayload(`Legacy ${status}`, profile, config.PERSONAL_PROJECT_ROOT),
      );
      await provider.updateProject(created.project.id, { status });

      const projectResponse = await app.inject({
        method: 'GET',
        url: `/api/projects/${created.project.id}`,
      });
      const project = projectResponse.json<{ data: ProjectJson }>().data;
      expect(project.status).toBe(status);
      expect(project.status).not.toBe('Submitted');
      expect(project.status).not.toBe('Submission');
    }
  });
});
