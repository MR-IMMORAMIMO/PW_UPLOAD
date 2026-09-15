/**
 * Tests for DatabaseStartupLock - database-scoped cross-process startup lock.
 *
 * P1.8B - Implement Database-Scoped Startup Lock and Workspace Startup Coordinator Core
 */

import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseStartupLock } from './DatabaseStartupLock';
import { DatabaseStartupLockError } from './startup-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCK_MODULE_URL = pathToFileURL(
  path.resolve('apps/api/src/infrastructure/startup/DatabaseStartupLock.ts'),
).href;

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

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) removeTree(root);
  }
});

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-startup-lock-'));
  tempRoots.push(dir);
  return dir;
}

interface Fixture {
  tempRoot: string;
  dir: string;
  dbPath: string;
}

function setup(): Fixture {
  const tempRoot = newTempDir();
  const dir = path.join(tempRoot, 'data');
  mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'workspace.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)');
  db.close();
  return { tempRoot, dir, dbPath };
}

function expectLockError(fn: () => unknown, code: DatabaseStartupLockError['code']): void {
  try {
    fn();
    throw new Error('expected DatabaseStartupLockError to be thrown');
  } catch (error) {
    if (!(error instanceof DatabaseStartupLockError)) {
      throw error;
    }
    expect(error.code).toBe(code);
  }
}

function lockFilesIn(dir: string): string[] {
  return readdirSync(dir).filter(
    (name) => name.startsWith('.scli-startup-') && name.endsWith('.lock.sqlite'),
  );
}

// ---------------------------------------------------------------------------
// Child-process helpers (real cross-process evidence)
// ---------------------------------------------------------------------------

interface ChildResult {
  ok?: boolean;
  identityHash?: string;
  code?: string;
  released?: boolean;
}

function buildChildScript(): string {
  return `
import { DatabaseStartupLock } from '${LOCK_MODULE_URL}';

const lock = new DatabaseStartupLock();
const databasePath = process.argv[2] ?? '';
const mode = process.argv[3] ?? 'hold';
try {
  const lease = lock.acquire(databasePath);
  process.send?.({ ok: true, identityHash: lease.databaseIdentityHash });
  if (mode === 'acquire') {
    lease.release();
    process.send?.({ released: true });
    process.exit(0);
  }
  process.on('message', (message: unknown) => {
    if (message === 'release') {
      try {
        lease.release();
        process.send?.({ released: true });
        process.exit(0);
      } catch (error) {
        process.send?.({ released: false, code: (error as { code?: string }).code ?? 'UNKNOWN' });
        process.exit(1);
      }
    }
  });
} catch (error) {
  process.send?.({ ok: false, code: (error as { code?: string }).code ?? 'UNKNOWN' });
  process.exit(2);
}
`;
}

function spawnLockChild(
  databasePath: string,
  mode: 'hold' | 'acquire',
): { child: ChildProcess; firstMessage: Promise<ChildResult> } {
  const dir = newTempDir();
  const scriptPath = path.join(dir, 'lock-child.ts');
  writeFileSync(scriptPath, buildChildScript());
  const child = fork(scriptPath, [databasePath, mode], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const firstMessage = new Promise<ChildResult>((resolve, reject) => {
    child.once('message', (message) => resolve(message as ChildResult));
    child.once('error', reject);
  });
  return { child, firstMessage };
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DatabaseStartupLock', () => {
  it('acquires a lock for a valid database path', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    expect(lease.databaseIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    lease.release();
  });

  it('rejects a second local instance', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');
    lease.release();
  });

  it('rejects a separate child process while the parent holds the lock', async () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    const { child, firstMessage } = spawnLockChild(fx.dbPath, 'hold');
    const result = await firstMessage;
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LOCK_ALREADY_HELD');
    await waitForExit(child);
    lease.release();
  });

  it('first-use cross-process race has exactly one winner', async () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    // The sibling lock database does not exist yet: both children race to create it.
    expect(lockFilesIn(fx.dir).length).toBe(0);
    const { child: childA, firstMessage: msgA } = spawnLockChild(fx.dbPath, 'hold');
    const { child: childB, firstMessage: msgB } = spawnLockChild(fx.dbPath, 'hold');
    const [resultA, resultB] = await Promise.all([msgA, msgB]);
    const winners = [resultA, resultB].filter((r) => r.ok === true);
    const losers = [resultA, resultB].filter((r) => r.ok === false);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0]?.code).toBe('LOCK_ALREADY_HELD');
    const winner = resultA.ok === true ? childA : childB;
    const loser = resultA.ok === true ? childB : childA;
    winner.send('release');
    await waitForExit(winner);
    await waitForExit(loser);
    // The lock database is not corrupt: a fresh acquire succeeds after release.
    const lease = lock.acquire(fx.dbPath);
    expect(lease.databaseIdentityHash).toBe(winners[0]?.identityHash);
    lease.release();
  }, 15000);

  it('lets a child process acquire after the parent releases', async () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    const { child, firstMessage } = spawnLockChild(fx.dbPath, 'acquire');
    const result = await firstMessage;
    expect(result.ok).toBe(true);
    expect(result.identityHash).toMatch(/^[0-9a-f]{64}$/);
    await waitForExit(child);
  });

  it('releases the lock automatically when the owning child process crashes', async () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const { child, firstMessage } = spawnLockChild(fx.dbPath, 'hold');
    const result = await firstMessage;
    expect(result.ok).toBe(true);
    expect(result.identityHash).toMatch(/^[0-9a-f]{64}$/);

    // The parent is rejected while the child holds the lock.
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');

    // Terminate the child without any release; the OS must close its SQLite handle.
    child.kill('SIGKILL');
    await waitForExit(child);

    // The parent can acquire again without deleting any stale marker.
    const lease = lock.acquire(fx.dbPath);
    expect(lease.databaseIdentityHash).toBe(result.identityHash);
    lease.release();
  });

  it('recovers a hot journal left by a crashed writer', async () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    const lockFile = path.join(fx.dir, lockFilesIn(fx.dir)[0]!);
    const dir = newTempDir();
    const scriptPath = path.join(dir, 'hot-journal-child.ts');
    writeFileSync(
      scriptPath,
      `
import { DatabaseSync } from 'node:sqlite';
const lockPath = process.argv[2] ?? '';
const db = new DatabaseSync(lockPath);
db.exec('PRAGMA journal_mode = DELETE');
db.exec('BEGIN EXCLUSIVE');
db.exec('INSERT INTO startup_lock (id) VALUES (1)');
process.send?.({ wrote: true });
process.on('message', () => {});
`,
    );
    const child = fork(scriptPath, [lockFile], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const wrote = new Promise<void>((resolve, reject) => {
      child.once('message', (message) => {
        if ((message as { wrote?: boolean }).wrote === true) resolve();
      });
      child.once('error', reject);
    });
    await wrote;
    child.kill('SIGKILL');
    await waitForExit(child);
    // SQLite must roll back the hot journal; the lock is acquirable without deleting
    // or replacing the lock database.
    expect(lockFilesIn(fx.dir).length).toBe(1);
    const lease2 = lock.acquire(fx.dbPath);
    expect(lease2.databaseIdentityHash).toBe(lease.databaseIdentityHash);
    lease2.release();
  }, 15000);

  it('requires no stale-marker deletion: the persistent lock database is harmless', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    expect(lockFilesIn(fx.dir).length).toBe(1);
    const lease2 = lock.acquire(fx.dbPath);
    lease2.release();
  });

  it('maps parent-junction aliases to one lock identity', (ctx) => {
    const fx = setup();
    const junctionDir = path.join(fx.tempRoot, 'junction-alias');
    try {
      symlinkSync(fx.dir, junctionDir, 'junction');
    } catch {
      ctx.skip();
      return;
    }
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    const aliasPath = path.join(junctionDir, path.basename(fx.dbPath));
    expectLockError(() => lock.acquire(aliasPath), 'LOCK_ALREADY_HELD');
    lease.release();
  });

  it('maps case and path-segment aliases to one lock identity on Windows', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    const caseAlias = fx.dbPath.toLowerCase();
    const segmentAlias = path.join(fx.dir, 'sub', '..', path.basename(fx.dbPath));
    expectLockError(() => lock.acquire(caseAlias), 'LOCK_ALREADY_HELD');
    expectLockError(() => lock.acquire(segmentAlias), 'LOCK_ALREADY_HELD');
    lease.release();
  });

  it('keeps the lock identity stable when the target database is atomically replaced', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    const replacement = path.join(fx.tempRoot, 'replacement.sqlite');
    const db = new DatabaseSync(replacement);
    db.exec('CREATE TABLE t (id INTEGER)');
    db.close();
    // Atomic replace of the target while the lease is held (restore-style replacement).
    unlinkSync(fx.dbPath);
    renameSync(replacement, fx.dbPath);
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');
    lease.release();
    const lease2 = lock.acquire(fx.dbPath);
    expect(lease2.databaseIdentityHash).toBe(lease.databaseIdentityHash);
    lease2.release();
  });

  it('keeps unrelated database identities independent', () => {
    const fx = setup();
    const otherPath = path.join(fx.dir, 'other.sqlite');
    const other = new DatabaseSync(otherPath);
    other.exec('CREATE TABLE t (id INTEGER)');
    other.close();
    const lock = new DatabaseStartupLock();
    const leaseA = lock.acquire(fx.dbPath);
    const leaseB = lock.acquire(otherPath);
    expect(leaseA.databaseIdentityHash).not.toBe(leaseB.databaseIdentityHash);
    leaseA.release();
    leaseB.release();
  });

  it('rejects a non-regular lock-database entry', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    const lockFile = path.join(fx.dir, lockFilesIn(fx.dir)[0]!);
    unlinkSync(lockFile);
    mkdirSync(lockFile);
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_DATABASE_UNSAFE');
  });

  it('rejects a symlink lock-database entry', (ctx) => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    const lockFile = path.join(fx.dir, lockFilesIn(fx.dir)[0]!);
    const target = path.join(fx.tempRoot, 'lock-target.sqlite');
    const targetDb = new DatabaseSync(target);
    targetDb.close();
    try {
      unlinkSync(lockFile);
      symlinkSync(target, lockFile, 'file');
    } catch {
      ctx.skip();
      return;
    }
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_DATABASE_UNSAFE');
  });

  it('fails closed when the target database has multiple hard links', (ctx) => {
    const fx = setup();
    const linkPath = path.join(fx.dir, 'workspace-link.sqlite');
    try {
      linkSync(fx.dbPath, linkPath);
    } catch {
      ctx.skip();
      return;
    }
    const lock = new DatabaseStartupLock();
    expectLockError(() => lock.acquire(fx.dbPath), 'UNSAFE_DATABASE_PATH');
  });

  it('closes the handle of a failed acquisition', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');
    lease.release();
    // The failed acquisition left no lingering lock, so a fresh acquire succeeds.
    const lease2 = lock.acquire(fx.dbPath);
    lease2.release();
  });

  it('release is idempotent', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    lease.release();
    expect(() => lease.release()).not.toThrow();
  });

  it('keeps the lock held until release', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    expectLockError(() => lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');
    lease.release();
    const lease2 = lock.acquire(fx.dbPath);
    lease2.release();
  });

  it('exposes no path in results or errors', () => {
    const fx = setup();
    const lock = new DatabaseStartupLock();
    const lease = lock.acquire(fx.dbPath);
    const json = JSON.stringify(lease);
    expect(json).not.toContain(fx.tempRoot);
    expect(json).not.toContain(':\\');
    expect(json).not.toContain('sqlite');
    expect(lease.databaseIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    try {
      lock.acquire(fx.dbPath);
      throw new Error('expected LOCK_ALREADY_HELD');
    } catch (error) {
      if (!(error instanceof DatabaseStartupLockError)) throw error;
      expect(error.code).toBe('LOCK_ALREADY_HELD');
      expect(error.message).not.toContain(fx.tempRoot);
      expect(error.message).not.toContain(':\\');
    }
    lease.release();
  });
});
