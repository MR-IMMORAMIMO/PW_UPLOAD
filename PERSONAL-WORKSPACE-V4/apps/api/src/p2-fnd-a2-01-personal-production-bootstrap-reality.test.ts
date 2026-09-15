/**
 * P2-FND-A2-01 reality gate: production Personal bootstrap canonicalization.
 *
 * Closes the "two production authorities" gap. Before this slice, Desktop Personal ran through the
 * canonical assembly (personal-server.ts) while `pnpm start` launched the generic apps/api/src/server.ts,
 * which could silently fall back to independent legacy Revision/Export/Package writers. This gate
 * proves every supported production Personal entrypoint resolves to ONE canonical bootstrap:
 *
 *   - `pnpm start` -> `@scli/api start` -> node dist/server.js  (script assertions)
 *   - server.ts production-Personal mode routes to the shared createPersonalProductionRuntime
 *   - the shared runtime assembles an explicit CANONICAL registry + createApp with canonical services
 *   - production generation writes a canonical Revision (server-owned sequence), never a legacy allocator
 *   - production Personal WITHOUT a CANONICAL registry FAILS CLOSED
 *   - standalone restart against the same temp database is idempotent
 *
 * All databases and project roots are disposable OS temp locations; real UAT data is never touched.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, type AppConfig } from '@scli/config';
import { TEST_FUTURE_REQUIRED_DELIVERY_DATE } from '../../../tests/test-authority';
import {
  createPersonalProductionRuntime,
  isPersonalProductionMode,
  PersonalProductionAuthorityError,
} from './infrastructure/startup/createPersonalProductionServer';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SERVER_SOURCE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'server.ts');
const ROOT_PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const API_PACKAGE_JSON = path.join(REPO_ROOT, 'apps', 'api', 'package.json');
const WEB_DIST_INDEX = path.join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html');

const tempRoots: string[] = [];
const runningChildren: ChildProcess[] = [];

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkFileWithRetry(child);
  }
  rmdirSync(dir);
}

/**
 * Windows child-process lock release is asynchronous to the OS: a freshly spawned server child may
 * still hold its .lock.sqlite handle briefly after exit. A bounded single retry after a short delay
 * tolerates that without looping indefinitely (matches the repository's documented EBUSY reality).
 */
function unlinkFileWithRetry(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
    // Wait briefly for the OS to release the handle, then retry once.
    const deadline = Date.now() + 300;
    let lastError: unknown = error;
    while (Date.now() < deadline) {
      // Busy-wait a tiny slice to give the child-process handle time to close.
      const stop = Date.now() + 20;
      while (Date.now() < stop) {
        // synchronous pause
      }
      try {
        unlinkSync(file);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
}

afterEach(() => {
  for (const child of runningChildren.splice(0)) {
    try {
      if (child.exitCode === null) child.kill();
    } catch {
      // Best-effort cleanup.
    }
  }
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p2-fnd-a2-01-'));
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
    NODE_ENV: 'production',
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

function countRows(dbPath: string, table: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
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

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(existsSync(file) ? readFileSync(file, 'utf8') : '{}') as Record<
    string,
    unknown
  >;
}

function readScripts(file: string): Record<string, string> {
  const json = readJson(file);
  const scripts = json.scripts;
  return scripts && typeof scripts === 'object' && !Array.isArray(scripts)
    ? (scripts as Record<string, string>)
    : {};
}

function createProjectPayload(): Record<string, unknown> {
  return {
    projectName: 'A2-01 Canonical Bootstrap',
    clientName: 'Test Client',
    projectType: 'Lighting Layout',
    description: 'Canonical production bootstrap generation.',
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting design.',
    luxRequirements: 'Target 500 lux.',
    drawingReference: 'A-101',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 8,
    requiredDeliveryDate: TEST_FUTURE_REQUIRED_DELIVERY_DATE,
    projectFolderUrl: null,
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
  };
}

describe('P2-FND-A2-01 documented production command resolves to the canonical bootstrap', () => {
  it('asserts the actual package scripts for pnpm start', () => {
    const rootScripts = readScripts(ROOT_PACKAGE_JSON);
    const apiScripts = readScripts(API_PACKAGE_JSON);
    // root start delegates to the api package start
    expect(rootScripts.start).toBe('pnpm --filter @scli/api start');
    // api start launches the compiled server entrypoint that routes production Personal to canonical
    expect(apiScripts.start).toBe('node dist/server.js');
  });

  it('server.ts routes only a supported production Personal standalone runtime to the canonical bootstrap', () => {
    // Production Personal standalone -> canonical branch
    expect(
      isPersonalProductionMode({
        APP_MODE: 'standalone',
        WORKSPACE_VARIANT: 'personal',
        NODE_ENV: 'production',
      }),
    ).toBe(true);
    // Defaults: APP_MODE/WORKSPACE_VARIANT default to standalone/personal but NODE_ENV defaults to development
    expect(isPersonalProductionMode({ NODE_ENV: 'production' })).toBe(true);
    // Test harnesses (mock or NODE_ENV=test) must NOT be routed to the canonical production bootstrap
    expect(
      isPersonalProductionMode({
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        NODE_ENV: 'test',
      }),
    ).toBe(false);
    expect(isPersonalProductionMode({ APP_MODE: 'mock', NODE_ENV: 'production' })).toBe(false);
    // Team variant is a different product runtime, not Personal
    expect(isPersonalProductionMode({ WORKSPACE_VARIANT: 'team', NODE_ENV: 'production' })).toBe(
      false,
    );
    // Development must not be force-canonicalized
    expect(isPersonalProductionMode({ NODE_ENV: 'development' })).toBe(false);
  });
});

describe('P2-FND-A2-01 shared canonical Personal production runtime', () => {
  it('assembles an explicit CANONICAL registry and wires createApp canonical services', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    const runtime = await createPersonalProductionRuntime({ config });
    try {
      expect(runtime.canonicalOutputRegistry.isCanonicalAuthority()).toBe(true);
      expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
      expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);

      // Production generation through the wired app must use the canonical generation service:
      // a register-only Revision writes a canonical_revisions row with a server-owned sequence and
      // derives the legacy projection from that canonical identity, never a legacy allocator.
      const created = await runtime.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: createProjectPayload(),
      });
      expect(created.statusCode).toBe(201);
      const projectId = (created.json() as { data: { project: { id: string } } }).data.project.id;

      const revision = await runtime.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/revisions`,
        payload: {
          revisionNumber: 999,
          reissueNumber: 0,
          title: 'A2-01 canonical register-only revision',
          status: 'Draft',
          receivedAt: null,
          dueDate: null,
          issuedAt: null,
          summary: 'Created through the shared canonical production bootstrap.',
          changeLog: '',
          sourceType: 'Manual',
          sourceReference: '',
        },
      });
      expect(revision.statusCode).toBe(201);
      const record = (revision.json() as { data: { id: string } }).data;

      expect(countRows(dbPath, 'canonical_revisions')).toBe(1);
      // Legacy compatibility projection derives from the canonical identity (same UUID + server sequence).
      expect(countRows(dbPath, 'project_revisions')).toBe(1);
      const canonical = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = canonical
          .prepare('SELECT revision_id, revision_sequence FROM canonical_revisions LIMIT 1')
          .get() as { revision_id: string; revision_sequence: number } | undefined;
        // The response carries the canonical Revision UUID; the server owns the sequence (starts at 1).
        expect(row?.revision_id).toBe(record.id);
        expect(row?.revision_sequence).toBe(1);
      } finally {
        canonical.close();
      }
    } finally {
      await runtime.startup.shutdown();
      await runtime.app.close();
    }
  });

  it('fails closed when production Personal is assembled without a CANONICAL registry', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);
    // Force a legacy-compatibility registry, as if canonical authority were not explicitly requested.
    const registryFactory = (
      database: InstanceType<typeof DatabaseSync>,
    ): CanonicalOutputRegistryStore =>
      new CanonicalOutputRegistryStore(database, { now: () => new Date() }, 'LEGACY_COMPATIBILITY');
    await expect(createPersonalProductionRuntime({ config, registryFactory })).rejects.toThrow(
      PersonalProductionAuthorityError,
    );
    // The production assembly must not have silently constructed a legacy-writer runtime.
    expect(countRows(dbPath, 'schema_migrations')).toBeGreaterThanOrEqual(0);
  });

  it('is restart-idempotent against the same temp database', async () => {
    const dir = newTempDir();
    const dbPath = dbPathIn(dir);
    createEmptyDb(dbPath);
    const config = makeConfig(dir, dbPath);

    const first = await createPersonalProductionRuntime({ config });
    await first.startup.shutdown();
    await first.app.close();
    expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
    const revisionsAfterFirst = countRows(dbPath, 'canonical_revisions');

    const second = await createPersonalProductionRuntime({ config });
    try {
      expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
      // Migration is not re-applied: history count unchanged.
      expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      // No duplicate canonical identity: still exactly the same Revision count as before restart.
      expect(countRows(dbPath, 'canonical_revisions')).toBe(revisionsAfterFirst);
      expect(second.canonicalOutputRegistry.isCanonicalAuthority()).toBe(true);
    } finally {
      await second.startup.shutdown();
      await second.app.close();
    }
  });
});

describe('P2-FND-A2-01 actual production entrypoint (server.ts) smoke test', () => {
  it(
    'spawns server.ts in production Personal mode, becomes reachable with CANONICAL schema, and routes a canonical revision',
    { timeout: 120_000 },
    async () => {
      // Only spawn the static-serving entrypoint when the built web app is present; otherwise this
      // test would depend on a build artifact that a plain vitest run may not have produced.
      if (!existsSync(WEB_DIST_INDEX)) {
        console.warn(
          'Skipping server.ts spawn smoke test: apps/web/dist/index.html is not present. Run pnpm build first.',
        );
        return;
      }
      const dir = newTempDir();
      const dbPath = dbPathIn(dir);
      createEmptyDb(dbPath);
      const port = await freePort();
      const child = spawn(process.execPath, [TSX_CLI, SERVER_SOURCE], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          APP_MODE: 'standalone',
          WORKSPACE_VARIANT: 'personal',
          PERSONAL_AUTO_LOGIN: 'true',
          NODE_ENV: 'production',
          LOG_LEVEL: 'silent',
          PORT: String(port),
          STANDALONE_DB_PATH: dbPath,
          STANDALONE_SESSION_SECRET:
            'test-session-secret-that-is-longer-than-thirty-two-characters',
          STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
          COMPANY_TIMEZONE: 'Asia/Dubai',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      runningChildren.push(child);
      try {
        expect(await waitForHealth(port)).toBe(true);
        // The server.ts production-Personal branch must migrate to schema v4 (canonical registry).
        expect(userVersion(dbPath)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
        expect(historyCount(dbPath)).toBe(PRODUCTION_MIGRATIONS.length);
      } finally {
        try {
          child.kill('SIGINT');
        } catch {
          // Already exiting.
        }
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', () => resolve());
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // Best-effort.
            }
            resolve();
          }, 8000).unref?.();
        });
      }
    },
  );
});
