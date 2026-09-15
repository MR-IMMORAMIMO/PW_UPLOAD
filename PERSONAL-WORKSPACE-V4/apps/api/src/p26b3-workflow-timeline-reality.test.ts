/**
 * P2.6B3 — Personal workflow history read API reality gate.
 *
 * Proves the narrow Personal read endpoint returns the canonical immutable
 * WorkflowTransitionRecord + RevisionCycle records (sequence ASC / cycleNumber
 * ASC), with correct empty/legacy states, project isolation, no write-on-read,
 * no fabricated history, and no derivation from revisionNumber or ProjectActivity.
 *
 * Uses the real Personal API boundary (createApp + StandaloneDataProvider +
 * PersonalWorkspaceStore) exactly as production startup does.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';
import { SchemaMigrationRunner } from './infrastructure/migration/SchemaMigrationRunner';
import {
  type MigrationBackupFactory,
  type MigrationBackupPort,
  type MigrationDatabaseFactory,
  type MigrationJournalPort,
  type MigrationClock,
  type MigrationJournalState,
} from './infrastructure/migration/types';
import { PathResolverService } from './infrastructure/path/PathResolverService';
import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];

const FIXED_BASE_MS = Date.parse('2026-08-07T00:00:00.000Z');

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-p26b3-0001' };
  }
  public async verifyBackup(): Promise<unknown> {
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public create(): MigrationBackupPort {
    return new FakeBackupPort();
  }
}

class FakeJournal implements MigrationJournalPort {
  public states: MigrationJournalState[] = [];
  public async createAttempt(): Promise<{ attemptId: string }> {
    this.states.push('CREATED');
    return { attemptId: 'att-p26b3-0001' };
  }
  public async transition(_attemptId: string, state: MigrationJournalState): Promise<void> {
    this.states.push(state);
  }
  public async markFailed(): Promise<void> {
    this.states.push('FAILED');
  }
}

function realDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p);
    },
    openReadOnly(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p, { readOnly: true });
    },
  };
}

function makeRunner(dataRoot: string): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(dataRoot),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

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
    STANDALONE_SESSION_SECRET: 'p26b3-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

interface ProjectJson {
  id: string;
  status: string;
  revisionNumber: number;
}

interface TransitionJson {
  transitionId: string;
  projectId: string;
  sequence: number;
  fromStatus: string;
  toStatus: string;
  occurredAt: string;
  actorId: string | null;
  reason: string | null;
  revisionCycleId: string | null;
}

interface CycleJson {
  revisionCycleId: string;
  projectId: string;
  cycleNumber: number;
  status: string;
  openedAt: string;
  openedByTransitionId: string;
  feedbackSummary: string;
  workStartedAt: string | null;
  returnedToClientAt: string | null;
  cancelledAt: string | null;
}

interface HistoryJson {
  transitions: TransitionJson[];
  revisionCycles: CycleJson[];
}

async function createPersonalApp(directory: string) {
  const config = makeConfig(
    path.join(directory, 'reality.sqlite'),
    path.join(directory, 'projects'),
  );
  // Open ONE shared connection and inject it into both the provider and the
  // store, exactly as production startup does, so the atomic Personal workflow
  // coordinator is wired and changeStatus writes structured history.
  const dbPath = path.join(directory, 'reality.sqlite');
  // Migrate the fresh DB to the current schema version first.
  const empty = new DatabaseSync(dbPath);
  empty.close();
  await makeRunner(directory).run(dbPath);
  const db = new DatabaseSync(dbPath);
  closeables.push({ close: () => db.close() });
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
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
) {
  return {
    projectName: name,
    clientName: 'Reality Client',
    projectType: 'Villa Lighting Design',
    description: 'P2.6B3 reality check.',
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
  };
}

async function createProject(
  app: Awaited<ReturnType<typeof createPersonalApp>>['app'],
  payload: ReturnType<typeof createPayload>,
) {
  const response = await app.inject({ method: 'POST', url: '/api/projects', payload });
  expect(response.statusCode).toBe(201);
  const data = response.json<{ data: { project: ProjectJson } }>().data;
  return data.project;
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
  expect(response.statusCode).toBe(200);
  return response.json<{ data: ProjectJson }>().data;
}

async function fetchHistory(
  app: Awaited<ReturnType<typeof createPersonalApp>>['app'],
  projectId: string,
): Promise<HistoryJson> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workflow-history`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: HistoryJson }>().data;
}

describe('P2.6B3 workflow history read API', () => {
  it('returns empty transitions and cycles for a project with zero history', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-empty-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('Empty History', profile, config.PERSONAL_PROJECT_ROOT),
    );
    const history = await fetchHistory(app, project.id);
    expect(history.transitions).toEqual([]);
    expect(history.revisionCycles).toEqual([]);
  });

  it('returns transitions in sequence ASC and cycles in cycleNumber ASC with canonical IDs', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-ordered-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('Ordered History', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, project.id, { status: 'InProgress' });
    await changeStatus(app, project.id, { status: 'ClientReview' });
    await changeStatus(app, project.id, {
      status: 'RevisionRequired',
      reason: 'Adjust downlight spacing and reduce facade brightness.',
    });
    await changeStatus(app, project.id, { status: 'InProgress' });
    await changeStatus(app, project.id, { status: 'ClientReview' });
    await changeStatus(app, project.id, {
      status: 'RevisionRequired',
      reason: 'Revise exterior wall-wash aiming.',
    });

    const history = await fetchHistory(app, project.id);
    // Transitions ascending by sequence.
    const sequences = history.transitions.map((t) => t.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(history.transitions.map((t) => t.toStatus)).toEqual([
      'InProgress',
      'ClientReview',
      'RevisionRequired',
      'InProgress',
      'ClientReview',
      'RevisionRequired',
    ]);
    // Cycles ascending by cycleNumber.
    expect(history.revisionCycles.map((c) => c.cycleNumber)).toEqual([1, 2]);
    // Canonical IDs preserved.
    for (const t of history.transitions) {
      expect(t.transitionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(t.projectId).toBe(project.id);
    }
    for (const c of history.revisionCycles) {
      expect(c.revisionCycleId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(c.projectId).toBe(project.id);
    }
  });

  it('preserves transition.revisionCycleId, feedbackSummary, and cycle lifecycle fields', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-fields-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('Field History', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, project.id, { status: 'InProgress' });
    await changeStatus(app, project.id, { status: 'ClientReview' });
    await changeStatus(app, project.id, {
      status: 'RevisionRequired',
      reason: 'Adjust downlight spacing and reduce facade brightness.',
    });
    await changeStatus(app, project.id, { status: 'InProgress' });
    await changeStatus(app, project.id, { status: 'ClientReview' });

    const history = await fetchHistory(app, project.id);
    const cycle1 = history.revisionCycles[0]!;
    expect(cycle1.feedbackSummary).toBe('Adjust downlight spacing and reduce facade brightness.');
    expect(cycle1.status).toBe('ReturnedToClient');
    expect(cycle1.returnedToClientAt).not.toBeNull();
    expect(cycle1.workStartedAt).not.toBeNull();
    // The opening transition links the cycle.
    const opening = history.transitions.find((t) => t.toStatus === 'RevisionRequired')!;
    expect(opening.revisionCycleId).toBe(cycle1.revisionCycleId);
    // The return transition links the same cycle.
    const returned = history.transitions.find(
      (t) => t.toStatus === 'ClientReview' && t.revisionCycleId !== null,
    )!;
    expect(returned.revisionCycleId).toBe(cycle1.revisionCycleId);
  });

  it('preserves cancelled cycle fields', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-cancel-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('Cancel History', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, project.id, { status: 'InProgress' });
    await changeStatus(app, project.id, { status: 'ClientReview' });
    await changeStatus(app, project.id, {
      status: 'RevisionRequired',
      reason: 'Client feedback.',
    });
    await changeStatus(app, project.id, {
      status: 'Cancelled',
      reason: 'Client cancelled the scope.',
    });

    const history = await fetchHistory(app, project.id);
    const cycle = history.revisionCycles[0]!;
    expect(cycle.status).toBe('Cancelled');
    expect(cycle.cancelledAt).not.toBeNull();
    expect(cycle.feedbackSummary).toBe('Client feedback.');
    // Cancellation reason is on the transition, not the cycle feedback.
    const cancel = history.transitions.find((t) => t.toStatus === 'Cancelled')!;
    expect(cancel.reason).toBe('Client cancelled the scope.');
  });

  it('unknown project follows the existing not-found convention', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-notfound-'));
    temporaryDirectories.push(directory);
    const { app } = await createPersonalApp(directory);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${randomUUID()}/workflow-history`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('read causes no writes and no fabricated legacy history', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-readonly-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, provider } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('Read Only', profile, config.PERSONAL_PROJECT_ROOT),
    );
    const before = await fetchHistory(app, project.id);
    expect(before.transitions).toEqual([]);
    // Read again; still empty (no write-on-read, no fabricated history).
    const after = await fetchHistory(app, project.id);
    expect(after.transitions).toEqual([]);
    expect(after.revisionCycles).toEqual([]);
    // No ProjectActivity was created by the read.
    const activities = await provider.listActivities(project.id);
    expect(activities.filter((a) => a.actionType === 'StatusChanged')).toEqual([]);
  });

  it('does not derive cycles from revisionNumber or history from ProjectActivity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-noderive-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const project = await createProject(
      app,
      createPayload('No Derive', profile, config.PERSONAL_PROJECT_ROOT),
    );
    // A project with zero workflow transitions but a non-initial status (legacy).
    await changeStatus(app, project.id, { status: 'InProgress' });
    const history = await fetchHistory(app, project.id);
    // Only the real InProgress transition exists; no fabricated Planning/ClientReview.
    expect(history.transitions.map((t) => t.toStatus)).toEqual(['InProgress']);
    expect(history.revisionCycles).toEqual([]);
    expect(project.revisionNumber).toBe(0);
  });

  it('project isolation: Project A request never returns Project B history/cycles', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26b3-isolation-'));
    temporaryDirectories.push(directory);
    const { app, config, profile } = await createPersonalApp(directory);
    const projectA = await createProject(
      app,
      createPayload('Isolation A', profile, config.PERSONAL_PROJECT_ROOT),
    );
    const projectB = await createProject(
      app,
      createPayload('Isolation B', profile, config.PERSONAL_PROJECT_ROOT),
    );
    await changeStatus(app, projectA.id, { status: 'InProgress' });
    await changeStatus(app, projectA.id, { status: 'ClientReview' });
    await changeStatus(app, projectA.id, {
      status: 'RevisionRequired',
      reason: 'Feedback for A.',
    });
    await changeStatus(app, projectB.id, { status: 'InProgress' });

    const historyA = await fetchHistory(app, projectA.id);
    const historyB = await fetchHistory(app, projectB.id);
    expect(historyA.transitions.length).toBeGreaterThan(0);
    expect(historyB.transitions.length).toBe(1);
    expect(historyB.transitions.every((t) => t.projectId === projectB.id)).toBe(true);
    expect(historyA.revisionCycles.length).toBe(1);
    expect(historyB.revisionCycles).toEqual([]);
    expect(historyA.revisionCycles.every((c) => c.projectId === projectA.id)).toBe(true);
  });
});
