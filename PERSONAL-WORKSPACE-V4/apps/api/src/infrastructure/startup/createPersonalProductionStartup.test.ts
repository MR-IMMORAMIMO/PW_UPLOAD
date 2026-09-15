/**
 * Focused tests for the personal production startup assembly and the real personal-server
 * child process (P1.8I).
 *
 * The assembly must use the real WorkspaceStartupCoordinator, the production migration
 * registry, EXTERNALLY_MIGRATED provider/store factories, lazy single-construction runtime
 * dependencies, path-free public results, and a graceful shutdown that always closes the app
 * before the coordinator. Child-process tests exercise the real personal-server entry point
 * against temporary databases only.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from '../../app';
import { PersonalWorkspaceStore } from '../../personal-workspace-store';
import { StandaloneDataProvider } from '../../standalone-data-provider';
import { BackupManager } from '../backup/BackupManager';
import { PersistentMigrationJournal } from '../migration/journal/PersistentMigrationJournal';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from '../migration/registry/production-migration-registry';
import { LegacyV322FixtureBuilder } from '../migration/testing/LegacyV322FixtureBuilder';
import { PathResolverService } from '../path/PathResolverService';
import {
  createGracefulShutdown,
  createPersonalProductionStartup,
  type PersonalProductionStartup,
} from './createPersonalProductionStartup';
import type { MigrationClock } from '../migration/types';

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const PERSONAL_SERVER_SOURCE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'personal-server.ts');

function removeTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

const tempRoots: string[] = [];
const openStartups: PersonalProductionStartup[] = [];
const runningChildren: ChildProcess[] = [];

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (gracefulTimer) clearTimeout(gracefulTimer);
      if (forcedTimer) clearTimeout(forcedTimer);
      child.off('exit', onExit);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onExit = (): void => finish();

    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }

    const gracefulTimer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch (error) {
        finish(error);
      }
    }, 8000);
    const forcedTimer = setTimeout(
      () => finish(new Error('child process did not exit after forced termination')),
      10_000,
    );
    gracefulTimer.unref?.();
    forcedTimer.unref?.();

    try {
      child.kill('SIGINT');
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) finish();
      else finish(error);
    }
  });
}

afterEach(async () => {
  let cleanupError: unknown;
  for (const child of runningChildren.splice(0)) {
    try {
      await stopChild(child);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  while (openStartups.length) {
    const startup = openStartups.pop();
    if (startup) {
      try {
        await startup.shutdown();
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) {
      try {
        removeTree(root);
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }
  if (cleanupError !== undefined) throw cleanupError;
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-personal-startup-'));
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
    PORT: '3001',
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
  return { now: () => new Date(FIXED_DATE.getTime() + ticks++ * 1000) };
}

function makeStartup(config: AppConfig, dbPath: string): PersonalProductionStartup {
  let counter = 0;
  const startup = createPersonalProductionStartup({
    config,
    databasePath: dbPath,
    clock: makeClock(),
    journalIdGenerator: { generate: () => 'att-' + String(++counter).padStart(4, '0') },
    backupIdGenerator: { generate: () => 'bk-' + String(++counter).padStart(4, '0') },
    restoreStagingNameGenerator: { generate: () => 'n' + String(++counter).padStart(4, '0') },
    lockBusyTimeoutMs: 200,
    runnerBusyTimeoutMs: 5000,
  });
  openStartups.push(startup);
  return startup;
}

function createEmptyDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.close();
}

function userVersion(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    db.close();
  }
}

function historyCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name?: string } | undefined;
    if (!table) return 0;
    const row = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

function localAccountIds(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT user_id FROM local_accounts ORDER BY user_id').all() as Array<{
      user_id: string;
    }>;
    return rows.map((row) => row.user_id);
  } finally {
    db.close();
  }
}
function projectWorkspaceIds(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT project_id FROM project_workspaces ORDER BY project_id')
      .all() as Array<{ project_id: string }>;
    return rows.map((row) => row.project_id);
  } finally {
    db.close();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

interface ServerProcess {
  readonly child: ChildProcess;
  readonly port: number;
  stdout(): string;
  stderr(): string;
}

function spawnPersonalServer(dataRoot: string, port: number): ServerProcess {
  // Run the server in the tracked process; the tsx CLI spawns a grandchild that
  // can retain the SQLite directory after its parent exits on Windows.
  const child = spawn(process.execPath, ['--import', 'tsx', PERSONAL_SERVER_SOURCE], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      PORT: String(port),
      STANDALONE_DB_PATH: dbPathIn(dataRoot),
      STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
      COMPANY_TIMEZONE: 'Asia/Dubai',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  runningChildren.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return {
    child,
    port,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function waitForExit(
  server: ServerProcess,
  timeoutMs = 60_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        server.child.kill();
      } catch {
        // Best-effort.
      }
      reject(new Error('child process did not exit in time'));
    }, timeoutMs);
    server.child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopServer(server: ServerProcess): Promise<void> {
  await stopChild(server.child);
}

describe('createPersonalProductionStartup', () => {
  it('is lazy: no provider, store, or database is created before start', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    expect(() => startup.runtimeDependencies()).toThrow(
      /available only after a successful startup/,
    );
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(path.join(dir, 'backups'))).toBe(false);
  });

  it('migrates a fresh database 0 to 2 and creates exactly one provider and one store', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    const config = makeConfig(dir, dbPath);
    createEmptyDb(dbPath);
    let providerCalls = 0;
    let storeCalls = 0;
    const startup = createPersonalProductionStartup({
      config,
      databasePath: dbPath,
      clock: makeClock(),
      journalIdGenerator: { generate: () => 'att-0001' },
      backupIdGenerator: { generate: () => 'bk-0001' },
      lockBusyTimeoutMs: 200,
      providerFactory: {
        create() {
          providerCalls += 1;
          return new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
        },
      },
      storeFactory: {
        create() {
          storeCalls += 1;
          return new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
        },
      },
    });
    openStartups.push(startup);

    const result = await startup.start();
    expect(result.outcome).toBe('READY_AFTER_MIGRATION');
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(result.appliedMigrationIds).toEqual(
      PRODUCTION_MIGRATIONS.map((migration) => migration.id),
    );
    expect(result.manualActionRequired).toBe(false);
    expect(result.databaseIdentityHash).toBeTruthy();
    expect(providerCalls).toBe(1);
    expect(storeCalls).toBe(1);

    const dependencies = startup.runtimeDependencies();
    expect(dependencies.provider).toBeInstanceOf(StandaloneDataProvider);
    expect(dependencies.personalStore).toBeInstanceOf(PersonalWorkspaceStore);
    const again = startup.runtimeDependencies();
    expect(again.provider).toBe(dependencies.provider);
    expect(again.personalStore).toBe(dependencies.personalStore);

    expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
  });

  it('starts a current target database without a second migration', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    const config = makeConfig(dir, dbPath);
    createEmptyDb(dbPath);
    const first = makeStartup(config, dbPath);
    await first.start();
    await first.shutdown();

    const second = makeStartup(config, dbPath);
    const result = await second.start();
    expect(result.outcome).toBe('READY');
    expect(result.migrated).toBe(false);
    expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
  });

  it('migrates an exact v3.2.2 REPRESENTATIVE_POPULATED fixture and preserves project data', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    LegacyV322FixtureBuilder.build({ outputPath: dbPath, profile: 'REPRESENTATIVE_POPULATED' });
    const idsBefore = projectWorkspaceIds(dbPath);
    expect(idsBefore.length).toBeGreaterThan(0);

    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    const result = await startup.start();
    expect(result.outcome).toBe('READY_AFTER_MIGRATION');
    await startup.shutdown();

    expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
    expect(projectWorkspaceIds(dbPath)).toEqual(idsBefore);
  });

  it('blocks startup when a pending restore fails and keeps factories lazy', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    let providerCalls = 0;
    let storeCalls = 0;
    const startup = createPersonalProductionStartup({
      config,
      databasePath: dbPath,
      clock: makeClock(),
      journalIdGenerator: { generate: () => 'att-0001' },
      backupIdGenerator: { generate: () => 'bk-0001' },
      lockBusyTimeoutMs: 200,
      providerFactory: {
        create() {
          providerCalls += 1;
          return new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
        },
      },
      storeFactory: {
        create() {
          storeCalls += 1;
          return new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
        },
      },
    });
    openStartups.push(startup);
    writeFileSync(
      path.join(dir, 'restore-pending.json'),
      JSON.stringify({ version: 1, backupId: 'bk-missing' }),
      'utf8',
    );
    const before = readFileSync(dbPath);

    const result = await startup.start();
    expect(result.outcome).toBe('STARTUP_BLOCKED');
    expect(result.reasonCode).toBe('RESTORE_FAILED');
    expect(providerCalls).toBe(0);
    expect(storeCalls).toBe(0);
    expect(() => startup.runtimeDependencies()).toThrow();
    expect(existsSync(path.join(dir, 'restore-pending.json'))).toBe(true);
    expect(readFileSync(dbPath)).toEqual(before);
  });

  it('returns RECOVERY_REQUIRED for an unresolved real journal attempt and keeps factories lazy', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const journalRoot = path.join(dir, 'journal');
    mkdirSync(journalRoot, { recursive: true });
    const journal = new PersistentMigrationJournal({
      journalRoot,
      databasePath: dbPath,
      pathResolver: new PathResolverService(dir),
      clock: makeClock(),
      idGenerator: { generate: () => 'att-0001' },
      appVersion: '3.3.0',
      journalFormatVersion: 1 as const,
    });
    await journal.createAttempt({ fromVersion: 0, targetVersion: 1 });

    let providerCalls = 0;
    let storeCalls = 0;
    const startup = createPersonalProductionStartup({
      config,
      databasePath: dbPath,
      clock: makeClock(),
      journalIdGenerator: { generate: () => 'att-0002' },
      backupIdGenerator: { generate: () => 'bk-0001' },
      lockBusyTimeoutMs: 200,
      providerFactory: {
        create() {
          providerCalls += 1;
          return new StandaloneDataProvider(config, EXTERNALLY_MIGRATED);
        },
      },
      storeFactory: {
        create() {
          storeCalls += 1;
          return new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED);
        },
      },
    });
    openStartups.push(startup);

    const result = await startup.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.reasonCode).toBe('UNRESOLVED_MIGRATION_ATTEMPT');
    expect(result.manualActionRequired).toBe(true);
    expect(providerCalls).toBe(0);
    expect(storeCalls).toBe(0);
    expect(() => startup.runtimeDependencies()).toThrow();
    expect(userVersion(dbPath)).toBe(0);
  });

  it('holds the lock during runtime, blocks a second coordinator, and reacquires after shutdown', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const first = makeStartup(config, dbPath);
    await first.start();

    const second = makeStartup(config, dbPath);
    const blocked = await second.start();
    expect(blocked.outcome).toBe('STARTUP_BLOCKED');
    expect(blocked.reasonCode).toBe('DATABASE_LOCKED');

    await first.shutdown();
    const third = makeStartup(config, dbPath);
    const reacquired = await third.start();
    expect(reacquired.outcome === 'READY' || reacquired.outcome === 'READY_AFTER_MIGRATION').toBe(
      true,
    );
  });

  it('graceful shutdown closes the app before the coordinator and releases the lock', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });

    const order: string[] = [];
    const appClose = vi
      .spyOn(app as unknown as { close(): Promise<void> }, 'close')
      .mockImplementation(async () => {
        order.push('app.close');
      });
    const realCoordinatorShutdown = startup.coordinator.shutdown.bind(startup.coordinator);
    const coordinatorShutdown = vi
      .spyOn(startup.coordinator, 'shutdown')
      .mockImplementation(async () => {
        order.push('coordinator.shutdown');
        await realCoordinatorShutdown();
      });

    const controller = createGracefulShutdown({ app, coordinator: startup.coordinator });
    await controller.shutdown();
    expect(order).toEqual(['app.close', 'coordinator.shutdown']);
    expect(appClose).toHaveBeenCalledTimes(1);
    expect(coordinatorShutdown).toHaveBeenCalledTimes(1);

    const reacquired = makeStartup(config, dbPath);
    const result = await reacquired.start();
    expect(result.outcome === 'READY' || result.outcome === 'READY_AFTER_MIGRATION').toBe(true);
  });

  it('wires the Personal atomic coordinator for production shared-connection deps', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    // Production startup shares ONE DatabaseSync handle between provider and store.
    expect(dependencies.provider.getSharedDatabase()).toBe(
      dependencies.personalStore.getSharedDatabase(),
    );
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });
    await app.ready();
    // A real Personal status change through the production-wired app must go
    // through the atomic coordinator and persist a WorkflowTransitionRecord.
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Production Wiring',
        clientName: 'Test Client',
        projectType: 'Lighting Layout',
        description: 'A lighting design request.',
        collaboratorDesignerIds: [],
        siteLocation: 'Dubai, UAE',
        designStage: 'Concept',
        lightingScope: 'Interior lighting design.',
        luxRequirements: 'Target 500 lux.',
        drawingReference: 'A-101',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 8,
        requiredDeliveryDate: '2099-08-20',
        projectFolderUrl: null,
        idempotencyKey: '11111111-2222-4333-8444-555555555555',
      },
    });
    expect(created.statusCode).toBe(201);
    const projectId = (created.json() as { data: { project: { id: string } } }).data.project.id;
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      payload: { status: 'InProgress' },
    });
    expect(response.statusCode).toBe(200);
    expect(dependencies.personalStore.listWorkflowTransitions(projectId)).toHaveLength(1);
    await app.close();
  });

  it('still shuts down the coordinator when app.close fails', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });

    const appClose = vi
      .spyOn(app as unknown as { close(): Promise<void> }, 'close')
      .mockRejectedValue(new Error('close boom'));
    const coordinatorShutdown = vi.spyOn(startup.coordinator, 'shutdown');

    const controller = createGracefulShutdown({ app, coordinator: startup.coordinator });
    await expect(controller.shutdown()).resolves.toBeUndefined();
    expect(appClose).toHaveBeenCalledTimes(1);
    expect(coordinatorShutdown).toHaveBeenCalledTimes(1);

    const reacquired = makeStartup(config, dbPath);
    const result = await reacquired.start();
    expect(result.outcome === 'READY' || result.outcome === 'READY_AFTER_MIGRATION').toBe(true);
  });

  it('triggers coordinator shutdown after a listen failure', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
    try {
      await expect(app.listen({ port, host: '127.0.0.1' })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    const controller = createGracefulShutdown({ app, coordinator: startup.coordinator });
    await controller.shutdown();

    const reacquired = makeStartup(config, dbPath);
    const result = await reacquired.start();
    expect(result.outcome === 'READY' || result.outcome === 'READY_AFTER_MIGRATION').toBe(true);
  });
  it('executes exactly one shutdown sequence for repeated calls', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });

    const appClose = vi.spyOn(app as unknown as { close(): Promise<void> }, 'close');
    const controller = createGracefulShutdown({ app, coordinator: startup.coordinator });
    await Promise.all([controller.shutdown(), controller.shutdown(), controller.shutdown()]);
    expect(appClose).toHaveBeenCalledTimes(1);
  });

  it('installs and removes SIGINT/SIGTERM handlers and removes them on shutdown', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const startup = makeStartup(config, dbPath);
    await startup.start();
    const dependencies = startup.runtimeDependencies();
    const app = await createApp({
      config,
      provider: dependencies.provider,
      personalStore: dependencies.personalStore,
    });
    vi.spyOn(app as unknown as { close(): Promise<void> }, 'close').mockResolvedValue(undefined);

    const baselineSIGINT = process.listenerCount('SIGINT');
    const baselineSIGTERM = process.listenerCount('SIGTERM');
    const controller = createGracefulShutdown({ app, coordinator: startup.coordinator });
    controller.install(['SIGINT', 'SIGTERM']);
    expect(process.listenerCount('SIGINT')).toBe(baselineSIGINT + 1);
    expect(process.listenerCount('SIGTERM')).toBe(baselineSIGTERM + 1);

    await controller.shutdown();
    expect(process.listenerCount('SIGINT')).toBe(baselineSIGINT);
    expect(process.listenerCount('SIGTERM')).toBe(baselineSIGTERM);

    const secondRemove = controller.install(['SIGINT']);
    expect(process.listenerCount('SIGINT')).toBe(baselineSIGINT + 1);
    secondRemove();
    expect(process.listenerCount('SIGINT')).toBe(baselineSIGINT);
  });
});

describe('personal-server child-process smoke tests', () => {
  it(
    'fresh empty database migrates, becomes reachable, and releases the lock',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      createEmptyDb(dbPath);
      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      try {
        expect(await waitForHealth(port)).toBe(true);
        expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      } finally {
        await stopServer(server);
      }

      const port2 = await freePort();
      const again = spawnPersonalServer(dir, port2);
      try {
        expect(await waitForHealth(port2)).toBe(true);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      } finally {
        await stopServer(again);
      }
    },
  );

  it(
    'exact v3.2.2 RUNTIME_MINIMAL fixture migrates, becomes reachable, and preserves data',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      LegacyV322FixtureBuilder.build({ outputPath: dbPath, profile: 'RUNTIME_MINIMAL' });
      const userIdsBefore = localAccountIds(dbPath);
      expect(userIdsBefore.length).toBeGreaterThan(0);
      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      try {
        expect(await waitForHealth(port)).toBe(true);
        expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
        expect(localAccountIds(dbPath)).toEqual(userIdsBefore);
      } finally {
        await stopServer(server);
      }
    },
  );

  it(
    'current version-2 database starts with no second migration history row',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      const config = makeConfig(dir, dbPath);
      createEmptyDb(dbPath);
      const setup = makeStartup(config, dbPath);
      await setup.start();
      await setup.shutdown();
      expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);

      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      try {
        expect(await waitForHealth(port)).toBe(true);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      } finally {
        await stopServer(server);
      }
    },
  );

  it(
    'a same-database second process is blocked by the lock while the first stays healthy',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      createEmptyDb(dbPath);
      const portA = await freePort();
      const serverA = spawnPersonalServer(dir, portA);
      try {
        expect(await waitForHealth(portA)).toBe(true);

        const portB = await freePort();
        const serverB = spawnPersonalServer(dir, portB);
        const exit = await waitForExit(serverB);
        expect(exit.code).toBe(3);
        expect(await waitForHealth(portB, 2000)).toBe(false);

        expect(await waitForHealth(portA)).toBe(true);
      } finally {
        await stopServer(serverA);
      }

      const portC = await freePort();
      const serverC = spawnPersonalServer(dir, portC);
      try {
        expect(await waitForHealth(portC)).toBe(true);
      } finally {
        await stopServer(serverC);
      }
    },
  );

  it(
    'pending verified restore runs before migration and the server becomes reachable',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      const config = makeConfig(dir, dbPath);
      createEmptyDb(dbPath);
      const setup = makeStartup(config, dbPath);
      await setup.start();
      await setup.shutdown();

      const restoreMarker = (value: string): void => {
        const db = new DatabaseSync(dbPath);
        try {
          db.prepare(
            `INSERT INTO app_state (state_key, json_value, updated_at)
             VALUES ('restore-marker', ?, '2026-08-04T12:00:00.000Z')
             ON CONFLICT(state_key) DO UPDATE SET json_value = excluded.json_value`,
          ).run(JSON.stringify(value));
        } finally {
          db.close();
        }
      };
      restoreMarker('RESTORED');
      const backupRoot = path.join(dir, 'backups');
      mkdirSync(backupRoot, { recursive: true });
      const sourceDb = new DatabaseSync(dbPath);
      const backupManager = new BackupManager({
        sourceDb,
        sourceDatabasePath: dbPath,
        backupRoot,
        pathResolver: new PathResolverService(dir),
        clock: { now: () => FIXED_DATE },
        idGenerator: { generate: () => 'bk-restore-0001' },
        appVersion: '3.3.0',
        verificationPolicy: { requiredTables: [] },
      });
      const backupResult = await backupManager.createVerifiedBackup({ reason: 'TEST' });
      sourceDb.close();
      restoreMarker('ORIGINAL');
      writeFileSync(
        path.join(dir, 'restore-pending.json'),
        JSON.stringify({ version: 1, backupId: backupResult.backupId }),
        'utf8',
      );

      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      try {
        expect(await waitForHealth(port)).toBe(true);
        expect(existsSync(path.join(dir, 'restore-pending.json'))).toBe(false);
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const row = db
            .prepare("SELECT json_value FROM app_state WHERE state_key = 'restore-marker'")
            .get() as { json_value: string } | undefined;
          expect(row?.json_value).toBe(JSON.stringify('RESTORED'));
        } finally {
          db.close();
        }
        expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      } finally {
        await stopServer(server);
      }
    },
  );

  it(
    'invalid pending restore never listens and leaves the database unchanged',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      createEmptyDb(dbPath);
      const before = readFileSync(dbPath);
      writeFileSync(
        path.join(dir, 'restore-pending.json'),
        JSON.stringify({ version: 1, backupId: 'bk-does-not-exist' }),
        'utf8',
      );

      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      const exit = await waitForExit(server);
      expect(exit.code).toBe(3);
      expect(await waitForHealth(port, 2000)).toBe(false);
      expect(readFileSync(dbPath)).toEqual(before);
      expect(existsSync(path.join(dir, 'restore-pending.json'))).toBe(true);
      expect(historyCount(dbPath)).toBe(0);
    },
  );

  it(
    'recovery-required database never listens and emits a manual-action outcome',
    { timeout: 120_000 },
    async () => {
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      createEmptyDb(dbPath);
      const journalRoot = path.join(dir, 'journal');
      mkdirSync(journalRoot, { recursive: true });
      const journal = new PersistentMigrationJournal({
        journalRoot,
        databasePath: dbPath,
        pathResolver: new PathResolverService(dir),
        clock: makeClock(),
        idGenerator: { generate: () => 'att-0001' },
        appVersion: '3.3.0',
        journalFormatVersion: 1 as const,
      });
      await journal.createAttempt({ fromVersion: 0, targetVersion: 1 });

      const port = await freePort();
      const server = spawnPersonalServer(dir, port);
      const exit = await waitForExit(server);
      expect(exit.code).toBe(4);
      expect(await waitForHealth(port, 2000)).toBe(false);
      expect(userVersion(dbPath)).toBe(0);
      expect(historyCount(dbPath)).toBe(0);
    },
  );
});
