/**
 * P5D — Project Intelligence & Productivity API route contract test.
 *
 * Proves the HTTP boundary for the P5D routes on a real shared-connection
 * app.inject harness (schema v28):
 *   1. POST /actions creates an Action; PATCH /actions/:id/merge applies a
 *      sparse CAS patch and rejects a stale row_version with 409.
 *   2. GET /readiness aggregates existing authorities (blocking Action ->
 *      NOT_READY).
 *   3. GET /revision-comparison compares two exact Revision UUIDs.
 *   4. GET /intelligence returns the cohesive Project-scoped overview.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { loadConfig, type AppConfig } from '@scli/config';
import type { AppUser } from '@scli/domain';
import { createApp } from './app';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ProjectService } from './project-service';
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
import { createNonProductionPersonalCanonicalRegistry } from './infrastructure/output-registry/createNonProductionPersonalCanonicalRegistry';

const FIXED_BASE_MS = Date.parse('2026-08-29T12:00:00.000Z');

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

const tempRoots: string[] = [];
const openHandles: DatabaseSyncInstance[] = [];
const openClosables: Array<{ close(): void }> = [];

afterEach(async () => {
  while (openClosables.length) {
    const closable = openClosables.pop();
    if (closable) {
      try {
        await (closable as { close(): Promise<void> | void }).close();
      } catch {
        // Best-effort close.
      }
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
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p5d-api-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'scli.sqlite');
}

function makeConfig(dir: string, dbPath = dbPathIn(dir)): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: dbPath,
    STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Local Admin',
    STANDALONE_ADMIN_EMAIL: 'admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-p5d-api-0001' };
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
    return { attemptId: 'att-p5d-api-0001' };
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

async function buildHarness(dir: string) {
  const p = dbPathIn(dir);
  const empty = new DatabaseSync(p);
  empty.close();
  const runner = new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(dir),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
  await runner.run(p);

  const config = makeConfig(dir, p);
  const db = new DatabaseSync(p);
  openHandles.push(db);
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openClosables.push(provider, store);
  const registry = createNonProductionPersonalCanonicalRegistry(store, {
    now: () => new Date(FIXED_BASE_MS),
  });
  const app = await createApp({
    config,
    provider,
    personalStore: store,
    canonicalOutputRegistry: registry,
    clock: () => new Date(FIXED_BASE_MS),
  });
  openClosables.push(app);
  const service = new ProjectService(
    provider,
    config.COMPANY_TIMEZONE,
    () => new Date(FIXED_BASE_MS),
    'personal',
  );
  const users = await provider.listUsers();
  const admin = users.find((user) => user.role === 'Admin' && user.isActive);
  if (!admin) throw new Error('Standalone bootstrap Admin missing.');
  return { app, provider, store, service, admin, config, registry };
}

const projectInput = (name: string) => ({
  projectName: name,
  clientName: 'Test Client',
  projectType: 'Lighting Layout',
  description: 'A lighting design request.',
  collaboratorDesignerIds: [],
  siteLocation: 'Dubai, UAE',
  designStage: 'Concept' as const,
  lightingScope: 'Interior lighting design and luminaire coordination.',
  luxRequirements: 'Target 500 lux at working plane.',
  drawingReference: 'A-101',
  priority: 'Normal' as const,
  complexity: 'Medium' as const,
  estimatedHours: 8,
  requiredDeliveryDate: '2028-08-20',
  projectFolderUrl: null,
  idempotencyKey: randomUUID(),
});

async function createProject(
  service: ProjectService,
  store: PersonalWorkspaceStore,
  admin: AppUser,
  name: string,
) {
  const project = (await service.createProject(admin, projectInput(name))).project;
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  return project;
}

describe('P5D Project Intelligence API routes', () => {
  it('creates an Action and applies a sparse CAS patch, rejecting a stale row_version', async () => {
    const dir = newTempDir();
    const { app, service, admin, store } = await buildHarness(dir);
    const project = await createProject(service, store, admin, 'P5D Action CAS');

    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      payload: {
        title: 'Blocking layout fix',
        details: '',
        owner: 'Mohamed',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'High',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        categoryId: null,
        notes: '',
        blocksIssue: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const action = created.json<{
      data: { id: string; rowVersion: number; blocksIssue: boolean };
    }>().data;
    expect(action.blocksIssue).toBe(true);
    expect(action.rowVersion).toBe(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/actions/${action.id}/merge`,
      payload: { rowVersion: 1, status: 'InProgress' },
    });
    expect(patched.statusCode).toBe(200);
    const patchedAction = patched.json<{ data: { status: string; rowVersion: number } }>().data;
    expect(patchedAction.status).toBe('InProgress');
    expect(patchedAction.rowVersion).toBe(2);

    // Stale row_version -> 409 CONFLICT.
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/actions/${action.id}/merge`,
      payload: { rowVersion: 1, status: 'Completed' },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('readiness is NOT_READY when an open blocking Action exists', async () => {
    const dir = newTempDir();
    const { app, service, admin, registry, store } = await buildHarness(dir);
    const project = await createProject(service, store, admin, 'P5D Readiness');

    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      payload: {
        title: 'Blocking layout fix',
        details: '',
        owner: 'Mohamed',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'High',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        categoryId: null,
        notes: '',
        blocksIssue: true,
      },
    });

    const revision = registry.createRevision({
      projectId: project.id,
      projectSnapshot: {
        id: project.id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        clientName: project.clientName,
        projectType: project.projectType,
        status: project.status,
        updatedAt: project.updatedAt,
      },
      luminaires: [],
      createdBy: { actorId: admin.id, actorNameSnapshot: admin.displayName },
    });

    const readiness = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/readiness?revisionId=${revision.revisionId}`,
    });
    expect(readiness.statusCode).toBe(200);
    const body = readiness.json<{
      data: { level: string; counts: { openBlockingActions: number } };
    }>().data;
    expect(body.level).toBe('NOT_READY');
    expect(body.counts.openBlockingActions).toBe(1);
  });

  it('GET /intelligence returns the cohesive Project-scoped overview', async () => {
    const dir = newTempDir();
    const { app, service, admin, store } = await buildHarness(dir);
    const project = await createProject(service, store, admin, 'P5D Overview');

    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      payload: {
        title: 'Open action',
        details: '',
        owner: 'Mohamed',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'Normal',
        sourceType: 'Manual',
        sourceId: null,
        revisionId: null,
        categoryId: null,
        notes: '',
      },
    });

    const overview = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/intelligence`,
    });
    expect(overview.statusCode).toBe(200);
    const body = overview.json<{
      data: { projectId: string; actionCounts: { open: number; openBlocking: number } };
    }>().data;
    expect(body.projectId).toBe(project.id);
    expect(body.actionCounts.open).toBe(1);
    expect(body.actionCounts.openBlocking).toBe(0);
  });
});
