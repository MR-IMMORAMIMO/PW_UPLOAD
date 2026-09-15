/**
 * P2-TIMER-FND-01 — API route-level Pause/Resume contract test (schema v5).
 *
 * Proves the HTTP boundary for the Personal WorkSession pause/resume routes
 * on a real shared-connection app.inject harness (schema V5):
 *   1. POST /api/personal/work-sessions/pause pauses a RUNNING session
 *   2. POST /api/personal/work-sessions/resume resumes a PAUSED session
 *   3. resume while RUNNING -> 409 CONFLICT
 *   4. pause while PAUSED -> 409 CONFLICT
 *   5. no active -> pause/resume -> 404
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

const FIXED_BASE_MS = Date.parse('2026-08-04T12:00:00.000Z');

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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-timer-v5-api-'));
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
    return { backupId: 'bk-timer-v5-api-0001' };
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
    return { attemptId: 'att-timer-v5-api-0001' };
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
  const app = await createApp({
    config,
    provider,
    personalStore: store,
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
  return { app, provider, store, service, admin, config };
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
  requiredDeliveryDate: '2026-08-20',
  projectFolderUrl: null,
  idempotencyKey: randomUUID(),
});

async function createProject(service: ProjectService, admin: AppUser, name: string) {
  return (await service.createProject(admin, projectInput(name))).project;
}

describe('P2-TIMER-FND-01 Personal WorkSession pause/resume API routes', () => {
  it('pause and resume a RUNNING session through the HTTP boundary', async () => {
    const dir = newTempDir();
    const { app, service, admin } = await buildHarness(dir);
    const project = await createProject(service, admin, 'Route Cycle');
    const startResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/start',
      payload: { projectId: project.id, idempotencyKey: randomUUID() },
    });
    expect(startResponse.statusCode).toBe(201);
    const startBody = startResponse.json<{ data: { session: { id: string } } }>();
    const sessionId = startBody.data.session.id;

    const pauseResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/pause',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(pauseResponse.statusCode).toBe(200);
    const pauseBody = pauseResponse.json<{
      data: { session: { id: string; pausedAt: string | null } };
    }>();
    expect(pauseBody.data.session.id).toBe(sessionId);
    expect(pauseBody.data.session.pausedAt).not.toBeNull();

    const resumeResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/resume',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(resumeResponse.statusCode).toBe(200);
    const resumeBody = resumeResponse.json<{
      data: { session: { id: string; pausedAt: string | null; accumulatedPausedMs: number } };
    }>();
    expect(resumeBody.data.session.id).toBe(sessionId);
    expect(resumeBody.data.session.pausedAt).toBeNull();
    // The pause->resume gap is real wall-clock milliseconds; it must be a
    // finite non-negative accumulated value (the tiny real pause interval).
    expect(resumeBody.data.session.accumulatedPausedMs).toBeGreaterThanOrEqual(0);
  });

  it('resume while RUNNING -> 409 CONFLICT', async () => {
    const dir = newTempDir();
    const { app, service, admin } = await buildHarness(dir);
    const project = await createProject(service, admin, 'Resume 409');
    await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/start',
      payload: { projectId: project.id, idempotencyKey: randomUUID() },
    });
    const resumeResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/resume',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(resumeResponse.statusCode).toBe(409);
  });

  it('pause while PAUSED -> 409 CONFLICT', async () => {
    const dir = newTempDir();
    const { app, service, admin } = await buildHarness(dir);
    const project = await createProject(service, admin, 'Pause 409');
    await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/start',
      payload: { projectId: project.id, idempotencyKey: randomUUID() },
    });
    await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/pause',
      payload: { idempotencyKey: randomUUID() },
    });
    const secondPause = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/pause',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(secondPause.statusCode).toBe(409);
  });

  it('no active session -> pause/resume -> 404', async () => {
    const dir = newTempDir();
    const { app } = await buildHarness(dir);
    const pauseResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/pause',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(pauseResponse.statusCode).toBe(404);
    const resumeResponse = await app.inject({
      method: 'POST',
      url: '/api/personal/work-sessions/resume',
      payload: { idempotencyKey: randomUUID() },
    });
    expect(resumeResponse.statusCode).toBe(404);
  });
});
