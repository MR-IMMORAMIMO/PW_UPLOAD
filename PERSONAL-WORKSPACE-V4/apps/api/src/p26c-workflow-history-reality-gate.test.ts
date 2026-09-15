/**
 * P2.6C — Final cross-slice Workflow History + Revision Cycle reality gate.
 *
 * Proves the complete P2.6 Personal production-style chain works as one
 * coherent system:
 *
 *   production startup / shared SQLite / migration V2
 *   -> actual HTTP status transition
 *   -> project.status
 *   -> ProjectActivity
 *   -> WorkflowTransitionRecord
 *   -> RevisionCycle
 *   -> workflow-history read API
 *   -> canonical data consumed by the already-tested Timeline UI
 *
 * This gate adds NO product functionality and makes ZERO production changes.
 * It uses the exact production assembly (createPersonalProductionStartup's
 * composition: ONE shared DatabaseSync connection injected into both the
 * StandaloneDataProvider and PersonalWorkspaceStore, migrated to V2 via the
 * real SchemaMigrationRunner) on isolated temporary filesystem/database only,
 * and drives the REAL HTTP routes through Fastify injection (the same boundary
 * the web client uses).
 *
 * Gates A-R exercise one continuous Project A journey; Gate P (isolation) and
 * Gate S (legacy partial history) use their own isolated runtimes; Gate U
 * proves the real HTTP response parses through the shared web contract.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '@scli/config';
import { workflowHistoryResponseSchema } from '@scli/contracts';
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

const FIXED_BASE_MS = Date.parse('2026-08-07T00:00:00.000Z');

// Fixed deterministic transition UUIDs (valid v4 format) for replay/conflict
// assertions. The journey uses these so same-ID replay and conflict are exact.
const T1 = '10000000-0000-4000-8000-000000000001'; // Planning -> InProgress
const T2 = '20000000-0000-4000-8000-000000000002'; // InProgress -> ClientReview
const T3 = '30000000-0000-4000-8000-000000000003'; // ClientReview -> RevisionRequired (Cycle 1)
const T4 = '40000000-0000-4000-8000-000000000004'; // RevisionRequired -> InProgress (start work)
const T5A = 'a1000000-0000-4000-8000-000000000001'; // InProgress -> OnHold
const T5B = 'a2000000-0000-4000-8000-000000000002'; // OnHold -> InProgress (resume)
const T5 = '50000000-0000-4000-8000-000000000005'; // InProgress -> ClientReview (return Cycle 1)
const T6 = '60000000-0000-4000-8000-000000000006'; // ClientReview -> RevisionRequired (Cycle 2)
const T7 = '70000000-0000-4000-8000-000000000007'; // RevisionRequired -> InProgress (start Cycle 2)
const T8 = '80000000-0000-4000-8000-000000000008'; // InProgress -> Cancelled (cancel Cycle 2)
const T9 = '90000000-0000-4000-8000-000000000009'; // Cancelled -> InProgress (reopen)
const T10 = 'a0000000-0000-4000-8000-00000000000a'; // ClientReview -> RevisionRequired (Cycle 3)

const FEEDBACK_1 = 'Adjust downlight spacing and reduce facade brightness.';
const FEEDBACK_2 = 'Revise exterior wall-wash aiming.';
const FEEDBACK_3 = 'Final client adjustment to landscape lighting.';
const CANCEL_REASON = 'Client cancelled the revision scope.';

const closeables: Array<{ close(): Promise<void> | void }> = [];
const openHandles: DatabaseSyncInstance[] = [];
const temporaryDirectories: string[] = [];

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

function makeAppClock(): () => Date {
  let ticks = 0;
  return () => new Date(FIXED_BASE_MS + ticks++ * 1000);
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) {
    try {
      await resource.close();
    } catch {
      // Best-effort close.
    }
  }
  while (openHandles.length) {
    const handle = openHandles.pop();
    if (handle) {
      try {
        if (handle.isOpen) handle.close();
      } catch {
        // Best-effort close.
      }
    }
  }
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
    STANDALONE_SESSION_SECRET: 'p26c-reality-secret-that-is-longer-than-thirty-two-characters',
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
  version: number;
  updatedAt: string;
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

interface Runtime {
  app: Awaited<ReturnType<typeof createApp>>;
  config: AppConfig;
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  profile: { folders: unknown; outputFolders: unknown };
  projectRoot: string;
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-p26c-0001' };
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
    return { attemptId: 'att-p26c-0001' };
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

/**
 * Starts a REAL production-style Personal runtime on an isolated temp path,
 * using the exact production assembly: ONE shared DatabaseSync connection
 * migrated to V2 via the real SchemaMigrationRunner, injected into both the
 * StandaloneDataProvider and PersonalWorkspaceStore, then createApp with the
 * shared-connection provider/store so the atomic coordinator is wired.
 */
async function startRuntime(directory: string): Promise<Runtime> {
  const databasePath = path.join(directory, 'scli.sqlite');
  const projectRoot = path.join(directory, 'projects');
  const config = makeConfig(databasePath, projectRoot);
  // Migrate the fresh DB to the current schema version (V2) first.
  const empty = new DatabaseSync(databasePath);
  empty.close();
  await makeRunner(directory).run(databasePath);
  const db = new DatabaseSync(databasePath);
  openHandles.push(db);
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  closeables.push(provider, store);
  const app = await createApp({ config, provider, personalStore: store, clock: makeAppClock() });
  closeables.push(app);
  const profilesResponse = await app.inject({ method: 'GET', url: '/api/folder-profiles' });
  const profile = profilesResponse
    .json<{ data: Array<{ name: string; folders: unknown; outputFolders: unknown }> }>()
    .data.find((candidate) => candidate.name === 'Full Lighting Design');
  if (!profile) throw new Error('Missing Full Lighting Design folder profile.');
  return { app, config, provider, store, profile, projectRoot };
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
    description: 'P2.6C reality check.',
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
  app: Awaited<ReturnType<typeof createApp>>,
  payload: ReturnType<typeof createPayload>,
): Promise<ProjectJson> {
  const response = await app.inject({ method: 'POST', url: '/api/projects', payload });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { project: ProjectJson } }>().data.project;
}

async function changeStatus(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; project?: ProjectJson }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/status`,
    payload: body,
  });
  if (response.statusCode === 200) {
    return {
      statusCode: response.statusCode,
      project: response.json<{ data: ProjectJson }>().data,
    };
  }
  return { statusCode: response.statusCode };
}

async function fetchHistory(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
): Promise<HistoryJson> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workflow-history`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: HistoryJson }>().data;
}

const STATUS_ACTIONS = new Set([
  'StatusChanged',
  'RevisionRequested',
  'ProjectCancelled',
  'ProjectReopened',
  'ProjectCompleted',
]);

async function statusActivities(
  provider: StandaloneDataProvider,
  projectId: string,
): Promise<Array<{ actionType: string; message: string }>> {
  const all = await provider.listActivities(projectId);
  return all.filter((a) => STATUS_ACTIONS.has(a.actionType));
}

describe('P2.6C workflow history + revision cycle reality gate', () => {
  it('Gates A-R: full production-style journey on Project A', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26c-journey-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, provider, store, projectRoot } = await startRuntime(directory);

    // ---- Gate A: fresh startup + empty history ----
    const projectA = await createProject(app, createPayload('Journey A', profile, projectRoot));
    expect(projectA.status).toBe('Planning');
    let history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toEqual([]);
    expect(history.revisionCycles).toEqual([]);
    // No fabricated ProjectCreated workflow row, no write-on-read.
    expect(history.transitions).toEqual([]);
    expect(history.revisionCycles).toEqual([]);

    // ---- Gate B: start work (Planning -> InProgress, T1) ----
    const b = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T1 });
    expect(b.statusCode).toBe(200);
    expect(b.project!.status).toBe('InProgress');
    // Exactly one relevant ProjectActivity.
    expect(await statusActivities(provider, projectA.id)).toHaveLength(1);
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(1);
    const t1 = history.transitions[0]!;
    expect(t1.transitionId).toBe(T1);
    expect(t1.sequence).toBe(1);
    expect(t1.fromStatus).toBe('Planning');
    expect(t1.toStatus).toBe('InProgress');
    expect(t1.revisionCycleId).toBeNull();
    expect(history.revisionCycles).toEqual([]);

    // ---- Gate C: initial client review (InProgress -> ClientReview, T2) ----
    const c = await changeStatus(app, projectA.id, { status: 'ClientReview', transitionId: T2 });
    expect(c.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(2);
    const t2 = history.transitions[1]!;
    expect(t2.transitionId).toBe(T2);
    expect(t2.sequence).toBe(2);
    expect(t2.revisionCycleId).toBeNull();
    expect(history.revisionCycles).toEqual([]);

    // ---- Gate D: first client feedback / Cycle 1 (ClientReview -> RevisionRequired, T3) ----
    const d = await changeStatus(app, projectA.id, {
      status: 'RevisionRequired',
      reason: FEEDBACK_1,
      transitionId: T3,
    });
    expect(d.statusCode).toBe(200);
    expect(d.project!.status).toBe('RevisionRequired');
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(3);
    const t3 = history.transitions[2]!;
    expect(t3.transitionId).toBe(T3);
    expect(t3.sequence).toBe(3);
    expect(t3.reason).toBe(FEEDBACK_1);
    expect(history.revisionCycles).toHaveLength(1);
    const cycle1 = history.revisionCycles[0]!;
    expect(cycle1.cycleNumber).toBe(1);
    expect(cycle1.status).toBe('Open');
    expect(cycle1.feedbackSummary).toBe(FEEDBACK_1);
    expect(cycle1.openedByTransitionId).toBe(T3);
    expect(cycle1.openedAt).toBe(t3.occurredAt);
    expect(cycle1.workStartedAt).toBeNull();
    expect(cycle1.returnedToClientAt).toBeNull();
    expect(cycle1.cancelledAt).toBeNull();
    // Canonical link: transition.revisionCycleId == cycle.revisionCycleId.
    expect(t3.revisionCycleId).toBe(cycle1.revisionCycleId);
    const cycle1Id = cycle1.revisionCycleId;

    // ---- Gate E: same-ID replay of T3 ----
    const e = await changeStatus(app, projectA.id, {
      status: 'RevisionRequired',
      reason: FEEDBACK_1,
      transitionId: T3,
    });
    expect(e.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(3); // no duplicate
    expect(history.revisionCycles).toHaveLength(1); // still exactly Cycle 1
    expect(history.revisionCycles[0]!.cycleNumber).toBe(1);
    expect(history.revisionCycles[0]!.openedAt).toBe(cycle1.openedAt);
    expect(await statusActivities(provider, projectA.id)).toHaveLength(3); // no duplicate activity

    // ---- Gate F: conflicting transitionId (reuse T3 with different target) ----
    const f = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T3 });
    expect(f.statusCode).toBe(409);
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(3); // zero durable side effects
    expect(history.revisionCycles).toHaveLength(1);
    expect(history.revisionCycles[0]!.revisionCycleId).toBe(cycle1Id);
    expect(history.revisionCycles[0]!.status).toBe('Open');
    expect(await statusActivities(provider, projectA.id)).toHaveLength(3);

    // ---- Gate G: start revision work (RevisionRequired -> InProgress, T4) ----
    const g = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T4 });
    expect(g.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    const t4 = history.transitions[3]!;
    expect(t4.transitionId).toBe(T4);
    expect(t4.sequence).toBe(4);
    expect(t4.revisionCycleId).toBe(cycle1Id);
    const cycle1AfterStart = history.revisionCycles[0]!;
    expect(cycle1AfterStart.status).toBe('Open');
    expect(cycle1AfterStart.workStartedAt).not.toBeNull();
    expect(cycle1AfterStart.feedbackSummary).toBe(FEEDBACK_1);
    const workStartedAt = cycle1AfterStart.workStartedAt;

    // ---- Gate H: hold / resume while Cycle 1 is Open ----
    const h1 = await changeStatus(app, projectA.id, { status: 'OnHold', transitionId: T5A });
    expect(h1.statusCode).toBe(200);
    const h2 = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T5B });
    expect(h2.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    const cycle1AfterHold = history.revisionCycles[0]!;
    expect(cycle1AfterHold.status).toBe('Open');
    expect(cycle1AfterHold.workStartedAt).toBe(workStartedAt); // unchanged
    expect(cycle1AfterHold.revisionCycleId).toBe(cycle1Id);
    expect(history.revisionCycles).toHaveLength(1); // no new cycle
    // Hold/resume history links the same Open cycle.
    const holdT = history.transitions.find((t) => t.transitionId === T5A)!;
    const resumeT = history.transitions.find((t) => t.transitionId === T5B)!;
    expect(holdT.revisionCycleId).toBe(cycle1Id);
    expect(resumeT.revisionCycleId).toBe(cycle1Id);

    // ---- Gate I: return Cycle 1 to client (InProgress -> ClientReview, T5) ----
    const i = await changeStatus(app, projectA.id, { status: 'ClientReview', transitionId: T5 });
    expect(i.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    const cycle1Returned = history.revisionCycles[0]!;
    expect(cycle1Returned.status).toBe('ReturnedToClient');
    expect(cycle1Returned.returnedToClientAt).not.toBeNull();
    expect(cycle1Returned.feedbackSummary).toBe(FEEDBACK_1);
    expect(history.revisionCycles).toHaveLength(1); // no Cycle 2 yet
    const returnT = history.transitions.find((t) => t.transitionId === T5)!;
    expect(returnT.revisionCycleId).toBe(cycle1Id);

    // ---- Gate J: Cycle 2 (ClientReview -> RevisionRequired, T6) ----
    const j = await changeStatus(app, projectA.id, {
      status: 'RevisionRequired',
      reason: FEEDBACK_2,
      transitionId: T6,
    });
    expect(j.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.revisionCycles).toHaveLength(2);
    const cycle2 = history.revisionCycles[1]!;
    expect(cycle2.cycleNumber).toBe(2);
    expect(cycle2.status).toBe('Open');
    expect(cycle2.feedbackSummary).toBe(FEEDBACK_2);
    expect(cycle2.openedByTransitionId).toBe(T6);
    // Cycle 1 unchanged.
    expect(history.revisionCycles[0]!.status).toBe('ReturnedToClient');
    expect(history.revisionCycles[0]!.feedbackSummary).toBe(FEEDBACK_1);
    const t6 = history.transitions.find((t) => t.transitionId === T6)!;
    expect(t6.revisionCycleId).toBe(cycle2.revisionCycleId);
    const cycle2Id = cycle2.revisionCycleId;

    // ---- Gate K: cancel open Cycle 2 ----
    const k1 = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T7 });
    expect(k1.statusCode).toBe(200);
    const k2 = await changeStatus(app, projectA.id, {
      status: 'Cancelled',
      reason: CANCEL_REASON,
      transitionId: T8,
    });
    expect(k2.statusCode).toBe(200);
    expect(k2.project!.status).toBe('Cancelled');
    history = await fetchHistory(app, projectA.id);
    const cycle2Cancelled = history.revisionCycles[1]!;
    expect(cycle2Cancelled.status).toBe('Cancelled');
    expect(cycle2Cancelled.cancelledAt).not.toBeNull();
    expect(cycle2Cancelled.feedbackSummary).toBe(FEEDBACK_2); // feedback preserved
    // Cancellation reason is on the transition only, not the cycle feedback.
    const cancelT = history.transitions.find((t) => t.transitionId === T8)!;
    expect(cancelT.reason).toBe(CANCEL_REASON);
    expect(cancelT.revisionCycleId).toBe(cycle2Id);
    // Cycle 1 remains ReturnedToClient.
    expect(history.revisionCycles[0]!.status).toBe('ReturnedToClient');

    // ---- Gate L: reopen does not reopen cycle ----
    const l1 = await changeStatus(app, projectA.id, { status: 'InProgress', transitionId: T9 });
    expect(l1.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.revisionCycles).toHaveLength(2); // no new cycle
    expect(history.revisionCycles[1]!.status).toBe('Cancelled');
    expect(history.revisionCycles[1]!.cancelledAt).toBe(cycle2Cancelled.cancelledAt); // unchanged
    const reopenT = history.transitions.find((t) => t.transitionId === T9)!;
    expect(reopenT.revisionCycleId).toBeNull(); // no Open cycle exists
    // InProgress -> ClientReview with no Open cycle creates no cycle.
    const l2 = await changeStatus(app, projectA.id, { status: 'ClientReview' });
    expect(l2.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.revisionCycles).toHaveLength(2); // still no new cycle

    // ---- Gate M: Cycle 3 numbering (ClientReview -> RevisionRequired, T10) ----
    const m = await changeStatus(app, projectA.id, {
      status: 'RevisionRequired',
      reason: FEEDBACK_3,
      transitionId: T10,
    });
    expect(m.statusCode).toBe(200);
    history = await fetchHistory(app, projectA.id);
    expect(history.revisionCycles).toHaveLength(3);
    expect(history.revisionCycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]);
    const cycle3 = history.revisionCycles[2]!;
    expect(cycle3.cycleNumber).toBe(3); // NOT Cycle 2 reused
    expect(cycle3.status).toBe('Open');
    expect(cycle3.feedbackSummary).toBe(FEEDBACK_3);
    // Only Cycle 3 is Open.
    expect(history.revisionCycles.filter((c) => c.status === 'Open')).toHaveLength(1);
    expect(history.revisionCycles[2]!.status).toBe('Open');
    const cycle3Id = cycle3.revisionCycleId;

    // ---- Gate N: read API canonical projection ----
    history = await fetchHistory(app, projectA.id);
    const sequences = history.transitions.map((t) => t.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b)); // sequence ASC
    expect(history.revisionCycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]); // cycleNumber ASC
    for (const t of history.transitions) {
      expect(t.transitionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(t.projectId).toBe(projectA.id);
    }
    for (const c of history.revisionCycles) {
      expect(c.revisionCycleId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(c.projectId).toBe(projectA.id);
    }
    // Every revisionCycleId link correct.
    const t3Link = history.transitions.find((t) => t.transitionId === T3)!;
    const t6Link = history.transitions.find((t) => t.transitionId === T6)!;
    const t10Link = history.transitions.find((t) => t.transitionId === T10)!;
    expect(t3Link.revisionCycleId).toBe(cycle1Id);
    expect(t6Link.revisionCycleId).toBe(cycle2Id);
    expect(t10Link.revisionCycleId).toBe(cycle3Id);
    // Feedback snapshots correct.
    expect(history.revisionCycles.map((c) => c.feedbackSummary)).toEqual([
      FEEDBACK_1,
      FEEDBACK_2,
      FEEDBACK_3,
    ]);
    // Lifecycle fields exact.
    expect(history.revisionCycles.map((c) => c.status)).toEqual([
      'ReturnedToClient',
      'Cancelled',
      'Open',
    ]);
    expect(history.revisionCycles[0]!.returnedToClientAt).not.toBeNull();
    expect(history.revisionCycles[1]!.cancelledAt).not.toBeNull();
    expect(history.revisionCycles[2]!.workStartedAt).toBeNull();
    // No presentation labels persisted by server, no TimelineEvent persistence.
    for (const t of history.transitions) {
      expect(t).not.toHaveProperty('label');
      expect(t).not.toHaveProperty('eventType');
    }
    for (const c of history.revisionCycles) {
      expect(c).not.toHaveProperty('label');
    }

    // ---- Gate O: read is non-mutating ----
    const beforeRead = await fetchHistory(app, projectA.id);
    const beforeTransitions = beforeRead.transitions.length;
    const beforeCycles = beforeRead.revisionCycles.length;
    const beforeActivities = (await statusActivities(provider, projectA.id)).length;
    for (let i = 0; i < 3; i += 1) {
      const again = await fetchHistory(app, projectA.id);
      expect(again.transitions).toEqual(beforeRead.transitions);
      expect(again.revisionCycles).toEqual(beforeRead.revisionCycles);
    }
    expect((await fetchHistory(app, projectA.id)).transitions).toHaveLength(beforeTransitions);
    expect((await fetchHistory(app, projectA.id)).revisionCycles).toHaveLength(beforeCycles);
    expect(await statusActivities(provider, projectA.id)).toHaveLength(beforeActivities);

    // ---- Gate Q: stale conflict ----
    // Project is at RevisionRequired (Cycle 3 Open). A stale expectedCurrentStatus
    // must 409 with zero durable side effects.
    const q = await changeStatus(app, projectA.id, {
      status: 'InProgress',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(q.statusCode).toBe(409);
    history = await fetchHistory(app, projectA.id);
    expect(history.transitions).toHaveLength(beforeTransitions); // no new transition
    expect(history.revisionCycles).toHaveLength(beforeCycles); // no cycle mutation
    expect(history.revisionCycles[2]!.status).toBe('Open'); // Cycle 3 unchanged
    expect(await statusActivities(provider, projectA.id)).toHaveLength(beforeActivities);
    // No sequence/cycle-number consumption.
    expect(history.transitions.map((t) => t.sequence)).toEqual(
      [...history.transitions.map((t) => t.sequence)].sort((a, b) => a - b),
    );

    // ---- Gate T: ProjectActivity + structured history coexist ----
    const activities = await statusActivities(provider, projectA.id);
    expect(activities.length).toBeGreaterThan(0); // human/general audit feed present
    // Structured history comes from workflow_transitions / revision_cycles, not
    // ProjectActivity reconstruction: transitions carry `sequence` and `reason`
    // (fields that do not exist on ProjectActivity), and cycles carry
    // `cycleNumber`/`feedbackSummary` (not derivable from activities).
    const structured = await fetchHistory(app, projectA.id);
    expect(structured.transitions.every((t) => typeof t.sequence === 'number')).toBe(true);
    expect(structured.transitions.some((t) => t.reason !== null)).toBe(true);
    expect(structured.revisionCycles.every((c) => typeof c.cycleNumber === 'number')).toBe(true);
    // The store's workflow_transitions table is the source (same records).
    const storeTransitions = store.listWorkflowTransitions(projectA.id);
    expect(storeTransitions.length).toBe(structured.transitions.length);
    expect(storeTransitions.map((t) => t.transitionId)).toEqual(
      structured.transitions.map((t) => t.transitionId),
    );

    // ---- Gate U: web contract compatibility ----
    const parsed = workflowHistoryResponseSchema.safeParse(structured);
    expect(parsed.success).toBe(true);

    // ---- Gate R: close / reopen real runtime, exact durable preservation ----
    const captured = await fetchHistory(app, projectA.id);
    const capturedProject = (
      await app.inject({ method: 'GET', url: `/api/projects/${projectA.id}` })
    ).json<{ data: ProjectJson }>().data;
    await app.close();
    // Release the shared connection so the DB file is unlocked for reopen.
    const dbHandle = openHandles.pop()!;
    if (dbHandle.isOpen) dbHandle.close();
    closeables.splice(0); // provider/store/app already closed via app.close()

    // Restart the production-style runtime on THE SAME temp DB/storage.
    const reopened = await startRuntime(directory);
    const reopenedProject = (
      await reopened.app.inject({ method: 'GET', url: `/api/projects/${projectA.id}` })
    ).json<{ data: ProjectJson }>().data;
    expect(reopenedProject.status).toBe(capturedProject.status);
    const reopenedHistory = await fetchHistory(reopened.app, projectA.id);
    expect(reopenedHistory.transitions).toEqual(captured.transitions);
    expect(reopenedHistory.revisionCycles).toEqual(captured.revisionCycles);
    // Exact durable preservation of every canonical field.
    expect(reopenedHistory.transitions.map((t) => t.transitionId)).toEqual(
      captured.transitions.map((t) => t.transitionId),
    );
    expect(reopenedHistory.transitions.map((t) => t.sequence)).toEqual(
      captured.transitions.map((t) => t.sequence),
    );
    expect(reopenedHistory.transitions.map((t) => t.fromStatus)).toEqual(
      captured.transitions.map((t) => t.fromStatus),
    );
    expect(reopenedHistory.transitions.map((t) => t.toStatus)).toEqual(
      captured.transitions.map((t) => t.toStatus),
    );
    expect(reopenedHistory.transitions.map((t) => t.reason)).toEqual(
      captured.transitions.map((t) => t.reason),
    );
    expect(reopenedHistory.transitions.map((t) => t.occurredAt)).toEqual(
      captured.transitions.map((t) => t.occurredAt),
    );
    expect(reopenedHistory.transitions.map((t) => t.revisionCycleId)).toEqual(
      captured.transitions.map((t) => t.revisionCycleId),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.revisionCycleId)).toEqual(
      captured.revisionCycles.map((c) => c.revisionCycleId),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.cycleNumber)).toEqual(
      captured.revisionCycles.map((c) => c.cycleNumber),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.status)).toEqual(
      captured.revisionCycles.map((c) => c.status),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.feedbackSummary)).toEqual(
      captured.revisionCycles.map((c) => c.feedbackSummary),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.openedAt)).toEqual(
      captured.revisionCycles.map((c) => c.openedAt),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.workStartedAt)).toEqual(
      captured.revisionCycles.map((c) => c.workStartedAt),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.returnedToClientAt)).toEqual(
      captured.revisionCycles.map((c) => c.returnedToClientAt),
    );
    expect(reopenedHistory.revisionCycles.map((c) => c.cancelledAt)).toEqual(
      captured.revisionCycles.map((c) => c.cancelledAt),
    );
    void config;
  });

  it('Gate P: project isolation — A request never returns B history/cycles', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26c-isolation-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, projectRoot } = await startRuntime(directory);
    const projectA = await createProject(app, createPayload('Isolation A', profile, projectRoot));
    const projectB = await createProject(app, createPayload('Isolation B', profile, projectRoot));
    // Give B at least one real transition.
    await changeStatus(app, projectB.id, { status: 'InProgress' });
    await changeStatus(app, projectB.id, { status: 'ClientReview' });
    await changeStatus(app, projectB.id, {
      status: 'RevisionRequired',
      reason: 'Feedback for B.',
    });
    // A has no transitions.
    const historyA = await fetchHistory(app, projectA.id);
    expect(historyA.transitions).toEqual([]);
    expect(historyA.revisionCycles).toEqual([]);
    // B has its own history only.
    const historyB = await fetchHistory(app, projectB.id);
    expect(historyB.transitions.length).toBeGreaterThan(0);
    expect(historyB.transitions.every((t) => t.projectId === projectB.id)).toBe(true);
    expect(historyB.revisionCycles.length).toBe(1);
    expect(historyB.revisionCycles.every((c) => c.projectId === projectB.id)).toBe(true);
    void config;
  });

  it('Gate S: legacy partial history — non-initial status, zero structured rows, first sequence = 1', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p26c-legacy-'));
    temporaryDirectories.push(directory);
    const { app, config, profile, provider, projectRoot } = await startRuntime(directory);
    const project = await createProject(app, createPayload('Legacy', profile, projectRoot));
    // Represent a legitimate pre-P2.6 Personal project already at a non-initial
    // status with zero WorkflowTransitionRecord and zero RevisionCycle rows.
    // Use the real persisted Personal state boundary (provider.updateProject
    // writes status to app_state without any structured history).
    await provider.updateProject(project.id, {
      status: 'InProgress',
      updatedAt: '2026-08-07T00:00:00.000Z',
      version: project.version + 1,
    });
    // workflow-history API returns empty for both.
    let history = await fetchHistory(app, project.id);
    expect(history.transitions).toEqual([]);
    expect(history.revisionCycles).toEqual([]);
    // First NEW valid P2.6 transition: InProgress -> ClientReview.
    const first = await changeStatus(app, project.id, { status: 'ClientReview' });
    expect(first.statusCode).toBe(200);
    history = await fetchHistory(app, project.id);
    // First recorded sequence = 1; no fabricated earlier transitions.
    expect(history.transitions).toHaveLength(1);
    expect(history.transitions[0]!.sequence).toBe(1);
    expect(history.transitions[0]!.fromStatus).toBe('InProgress');
    expect(history.transitions[0]!.toStatus).toBe('ClientReview');
    // No fabricated cycle (ClientReview is not ClientReview -> RevisionRequired).
    expect(history.revisionCycles).toEqual([]);
    void config;
  });
});
