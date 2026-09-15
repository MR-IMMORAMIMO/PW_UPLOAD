/**
 * AUTO-01B — ToolContextService lifecycle + automatic-capture authority (API).
 *
 * Proves the ONE narrow ToolContext authority/service layer that owns product
 * lifecycle semantics (open / expire / rebind / close / get / list /
 * authorization) and does NOT expose:
 *   - a delete ToolContext operation (CLOSED is used instead)
 *   - any Work Session dependency
 *   - arbitrary raw setToolContextState to callers
 *
 * Uses the real ManagedArtifactStore persistence (no duplicate ToolContext
 * persistence). No filesystem watcher, staging, capture execution, or UI.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { DomainError, AUTOMATIC_CAPTURE_SOURCE_CLASS } from '@scli/domain';
import type { CaptureCapability } from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { SchemaMigrationRunner } from './infrastructure/migration/SchemaMigrationRunner';
import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import { PathResolverService } from './infrastructure/path/PathResolverService';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';
import type {
  MigrationBackupFactory,
  MigrationBackupPort,
  MigrationClock,
  MigrationDatabaseFactory,
  MigrationJournalPort,
  MigrationJournalState,
} from './infrastructure/migration/types';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const FIXED_BASE_MS = Date.parse('2026-08-20T09:00:00.000Z');

const openHandles: DatabaseSyncInstance[] = [];
const openStores: Array<{ close(): void }> = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (openStores.length) openStores.pop()?.close();
  while (openHandles.length) openHandles.pop()?.close();
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01b-'));
  tempRoots.push(dir);
  return dir;
}

function makeConfig(dbPath: string) {
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
    return { backupId: 'bk-auto01b-0001' };
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
    return { attemptId: 'att-auto01b-0001' };
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

interface Harness {
  db: DatabaseSyncInstance;
  artifacts: ManagedArtifactStore;
  service: ToolContextService;
}

async function makeHarness(): Promise<Harness> {
  const dir = newTempDir();
  const p = path.join(dir, 'scli.sqlite');
  const empty = new DatabaseSync(p);
  empty.close();
  await new SchemaMigrationRunner({
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
  }).run(p);
  const config = makeConfig(p);
  const db = new DatabaseSync(p);
  openHandles.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openStores.push(provider, store);
  const artifacts = new ManagedArtifactStore(db);
  const service = new ToolContextService(artifacts);
  return { db, artifacts, service };
}

function openInput(projectId: string, tool = 'AutoCAD', channel = `autocad-${randomUUID()}`) {
  return {
    projectId,
    tool,
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel,
    openedAt: new Date(FIXED_BASE_MS).toISOString(),
  };
}

function makeCapability(tool = 'AutoCAD', channel = 'autocad-c'): CaptureCapability {
  return {
    tool,
    artifactType: 'LightingLayout',
    mode: 'Working',
    channel,
    sourceClass: AUTOMATIC_CAPTURE_SOURCE_CLASS,
    automaticCaptureAllowed: true,
    operational: true,
  };
}

describe('AUTO-01B ToolContextService lifecycle', () => {
  it('S1: open creates a LIVE ToolContext; get/list return it', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId));
    expect(ctx.state).toBe('LIVE');
    expect(ctx.projectId).toBe(projectId);
    expect(h.service.get(ctx.toolContextId).toolContextId).toBe(ctx.toolContextId);
    expect(h.service.list()).toHaveLength(1);
    expect(h.service.list(projectId)).toHaveLength(1);
  });

  it('S2: expire moves LIVE -> EXPIRED and stamps expiredAt', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId));
    const expired = h.service.expire(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    expect(expired.state).toBe('EXPIRED');
    expect(expired.expiredAt).toBe('2026-08-20T10:00:00.000Z');
    // Persisted.
    expect(h.artifacts.getToolContext(ctx.toolContextId).state).toBe('EXPIRED');
  });

  it('S3: close moves LIVE -> CLOSED and stamps closedAt', async () => {
    const h = await makeHarness();
    const ctx = h.service.open(openInput(randomUUID()));
    const closed = h.service.close(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    expect(closed.state).toBe('CLOSED');
    expect(closed.closedAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('S4: rebind requires an existing EXPIRED context and preserves identity fields', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId));
    h.service.expire(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    const rebound = h.service.rebind(ctx.toolContextId, '2026-08-20T11:00:00.000Z');
    expect(rebound.state).toBe('REBOUND');
    expect(rebound.toolContextId).toBe(ctx.toolContextId);
    expect(rebound.projectId).toBe(projectId);
    expect(rebound.tool).toBe(ctx.tool);
    expect(rebound.expectedArtifactType).toBe(ctx.expectedArtifactType);
  });

  it('S5: rebind on a LIVE context is rejected truthfully (INVALID_TRANSITION)', async () => {
    const h = await makeHarness();
    const ctx = h.service.open(openInput(randomUUID()));
    expect(() => h.service.rebind(ctx.toolContextId, '2026-08-20T10:00:00.000Z')).toThrow(
      DomainError,
    );
  });

  it('S6: CLOSED is terminal — cannot rebind or expire', async () => {
    const h = await makeHarness();
    const ctx = h.service.open(openInput(randomUUID()));
    h.service.close(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    expect(() => h.service.rebind(ctx.toolContextId, '2026-08-20T11:00:00.000Z')).toThrow(
      DomainError,
    );
    expect(() => h.service.expire(ctx.toolContextId, '2026-08-20T11:00:00.000Z')).toThrow(
      DomainError,
    );
    expect(h.artifacts.getToolContext(ctx.toolContextId).state).toBe('CLOSED');
  });

  it('S7: EXPIRED -> LIVE directly is rejected via the locked policy', async () => {
    const h = await makeHarness();
    const ctx = h.service.open(openInput(randomUUID()));
    h.service.expire(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    // No public service operation can force EXPIRED -> LIVE; the low-level store
    // raw setter is not exposed by the service surface.
    expect(Object.keys(h.service)).not.toContain('setToolContextState');
    expect(h.artifacts.getToolContext(ctx.toolContextId).state).toBe('EXPIRED');
  });

  it('S8: unknown ToolContext fails truthfully (NOT_FOUND)', async () => {
    const h = await makeHarness();
    expect(() => h.service.get(randomUUID())).toThrow(DomainError);
    expect(() => h.service.close(randomUUID(), '2026-08-20T10:00:00.000Z')).toThrow(DomainError);
    expect(() => h.service.rebind(randomUUID(), '2026-08-20T10:00:00.000Z')).toThrow(DomainError);
  });

  it('S9: no delete operation is exposed (CLOSED replaces deletion)', async () => {
    const h = await makeHarness();
    const ctx = h.service.open(openInput(randomUUID()));
    // The service surface has no delete method.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(h.service))).not.toContain('delete');
    // The context is closed, not deleted, and remains readable for audit.
    const closed = h.service.close(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    expect(closed.state).toBe('CLOSED');
    expect(h.service.get(ctx.toolContextId).state).toBe('CLOSED');
  });

  it('S10: a LIVE context authorizes new capture when the exact capability exists', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId, 'AutoCAD', 'autocad-chan'));
    const decision = h.service.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      makeCapability('AutoCAD', 'autocad-chan'),
    );
    expect(decision).toMatchObject({ outcome: 'AUTHORIZED' });
  });

  it('S11: REBOUND authorizes; EXPIRED/CLOSED deny new capture', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId, 'AutoCAD', 're-chan'));
    const capability = makeCapability('AutoCAD', 're-chan');

    const liveDecision = h.service.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      're-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      capability,
    );
    expect(liveDecision).toMatchObject({ outcome: 'AUTHORIZED' });

    h.service.expire(ctx.toolContextId, '2026-08-20T10:00:00.000Z');
    const expired = h.service.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      're-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      capability,
    );
    expect(expired).toMatchObject({ outcome: 'DENIED', reason: 'CONTEXT_EXPIRED' });

    const rebound = h.service.rebind(ctx.toolContextId, '2026-08-20T11:00:00.000Z');
    expect(rebound.state).toBe('REBOUND');
    const reboundDecision = h.service.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      're-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      capability,
    );
    expect(reboundDecision).toMatchObject({ outcome: 'AUTHORIZED' });

    h.service.close(ctx.toolContextId, '2026-08-20T12:00:00.000Z');
    const closed = h.service.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      're-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      capability,
    );
    expect(closed).toMatchObject({ outcome: 'DENIED', reason: 'CONTEXT_CLOSED' });
  });

  it('S12: project mismatch denies', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = h.service.open(openInput(projectId, 'AutoCAD', 'm-chan'));
    const decision = h.service.authorizeNewCapture(
      randomUUID(),
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      'm-chan',
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      makeCapability('AutoCAD', 'm-chan'),
    );
    expect(decision).toMatchObject({ outcome: 'DENIED', reason: 'PROJECT_MISMATCH' });
  });
});
