/**
 * Focused tests for the production pending-restore gate (P1.8I).
 *
 * The gate must restore only through RestoreManager, must never copy or rename raw files, must
 * finalize the pending request only after verified success, must preserve the request on every
 * failure, and must keep every public error path-free. Temporary databases and synthetic
 * BackupManager backups only.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BackupManager } from '../backup/BackupManager';
import {
  RestoreManager,
  RestoreManagerError,
  type BackupVerificationPort,
} from '../backup/RestoreManager';
import { PathResolverService } from '../path/PathResolverService';
import { ProductionPendingRestoreGate } from './ProductionPendingRestoreGate';
import { PendingRestoreGateError } from './startup-types';

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');

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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-pending-restore-'));
  tempRoots.push(dir);
  return dir;
}

function createMarkerDb(dbPath: string, value: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO marker (id, value) VALUES (1, ?)').run(value);
  db.close();
}

function readMarker(dbPath: string): string {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM marker WHERE id = 1').get() as {
      value: string;
    };
    return row.value;
  } finally {
    db.close();
  }
}

interface Fixture {
  dataRoot: string;
  targetPath: string;
  requestPath: string;
  legacyPath: string;
  backupId: string;
  backupDbPath: string;
  gate: ProductionPendingRestoreGate;
  manager: BackupManager;
  restoreManager: RestoreManager;
}

async function setup(overrides: { verifier?: BackupVerificationPort } = {}): Promise<Fixture> {
  const tempRoot = newTempDir();
  const dataRoot = path.join(tempRoot, 'data');
  const backupRoot = path.join(dataRoot, 'backups');
  mkdirSync(backupRoot, { recursive: true });
  const targetPath = path.join(dataRoot, 'scli.sqlite');
  createMarkerDb(targetPath, 'ORIGINAL');
  const sourcePath = path.join(dataRoot, 'source.sqlite');
  createMarkerDb(sourcePath, 'RESTORED');
  const sourceDb = new DatabaseSync(sourcePath);
  const pathResolver = new PathResolverService(dataRoot);
  let counter = 0;
  const manager = new BackupManager({
    sourceDb,
    sourceDatabasePath: sourcePath,
    backupRoot,
    pathResolver,
    clock: { now: () => FIXED_DATE },
    idGenerator: { generate: () => 'bk-' + String(++counter).padStart(4, '0') },
    appVersion: '3.3.0',
    verificationPolicy: { requiredTables: [] },
  });
  const backupResult = await manager.createVerifiedBackup({ reason: 'TEST' });
  sourceDb.close();
  const backupDbPath = path.join(backupRoot, backupResult.backupId, 'database.sqlite');
  let stagingCounter = 0;
  const restoreManager = new RestoreManager({
    backupRoot,
    pathResolver,
    verifier: overrides.verifier ?? manager,
    stagingNameGenerator: {
      generate: () => 'n' + String(++stagingCounter),
    },
  });
  const requestPath = path.join(dataRoot, 'restore-pending.json');
  const legacyPath = path.join(dataRoot, 'restore-pending.sqlite');
  const gate = new ProductionPendingRestoreGate({
    targetDatabasePath: targetPath,
    requestPath,
    legacyRequestPath: legacyPath,
    restoreManager,
  });
  return {
    dataRoot,
    targetPath,
    requestPath,
    legacyPath,
    backupId: backupResult.backupId,
    backupDbPath,
    gate,
    manager,
    restoreManager,
  };
}

function writeRequest(fx: Fixture, payload: unknown): void {
  writeFileSync(fx.requestPath, JSON.stringify(payload), 'utf8');
}

async function expectGateError(fn: () => Promise<unknown>): Promise<PendingRestoreGateError> {
  try {
    await fn();
    throw new Error('expected PendingRestoreGateError to be thrown');
  } catch (error) {
    if (!(error instanceof PendingRestoreGateError)) throw error;
    return error;
  }
}

describe('ProductionPendingRestoreGate', () => {
  it('is a no-op when no pending request exists', async () => {
    const fx = await setup();
    expect(await fx.gate.run()).toBe('NO_PENDING_RESTORE');
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('restores a verified backup and finalizes the request only after success', async () => {
    const fx = await setup();
    writeRequest(fx, { version: 1, backupId: fx.backupId });
    expect(await fx.gate.run()).toBe('RESTORED');
    expect(readMarker(fx.targetPath)).toBe('RESTORED');
    expect(readFileSync(fx.targetPath)).toEqual(readFileSync(fx.backupDbPath));
    expect(existsSync(fx.requestPath)).toBe(false);
  });

  it('blocks an invalid JSON request and preserves it', async () => {
    const fx = await setup();
    writeFileSync(fx.requestPath, '{not-json', 'utf8');
    const error = await expectGateError(() => fx.gate.run());
    expect(error.code).toBe('RESTORE_FAILED');
    expect(existsSync(fx.requestPath)).toBe(true);
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('blocks an invalid request shape and preserves it', async () => {
    const fx = await setup();
    for (const payload of [
      { version: 2, backupId: fx.backupId },
      { backupId: fx.backupId },
      { version: 1 },
      { version: 1, backupId: '' },
      { version: 1, backupId: 'a/b' },
      { version: 1, backupId: '..' },
      { version: 1, backupId: 42 },
    ]) {
      writeRequest(fx, payload);
      await expectGateError(() => fx.gate.run());
      expect(existsSync(fx.requestPath)).toBe(true);
      expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
    }
  });

  it('blocks a missing backup and preserves the request', async () => {
    const fx = await setup();
    writeRequest(fx, { version: 1, backupId: 'bk-does-not-exist' });
    await expectGateError(() => fx.gate.run());
    expect(existsSync(fx.requestPath)).toBe(true);
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('blocks a RestoreManager failure and preserves the request', async () => {
    const fx = await setup();
    const verifier: BackupVerificationPort = {
      verifyBackup: async () => {
        throw new RestoreManagerError('BACKUP_VERIFICATION_FAILED', 'backup cannot be verified');
      },
    };
    const failingGate = new ProductionPendingRestoreGate({
      targetDatabasePath: fx.targetPath,
      requestPath: fx.requestPath,
      legacyRequestPath: fx.legacyPath,
      restoreManager: new RestoreManager({
        backupRoot: path.join(fx.dataRoot, 'backups'),
        pathResolver: new PathResolverService(fx.dataRoot),
        verifier,
      }),
    });
    writeRequest(fx, { version: 1, backupId: fx.backupId });
    await expectGateError(() => failingGate.run());
    expect(existsSync(fx.requestPath)).toBe(true);
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('fails closed on a legacy raw marker and never copies it', async () => {
    const fx = await setup();
    writeFileSync(fx.legacyPath, 'legacy-raw-marker', 'utf8');
    const error = await expectGateError(() => fx.gate.run());
    expect(error.code).toBe('RESTORE_FAILED');
    expect(existsSync(fx.legacyPath)).toBe(true);
    expect(existsSync(fx.requestPath)).toBe(false);
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('blocks an unreadable request file and preserves it', async () => {
    const fx = await setup();
    mkdirSync(fx.requestPath, { recursive: true });
    await expectGateError(() => fx.gate.run());
    expect(existsSync(fx.requestPath)).toBe(true);
    expect(readMarker(fx.targetPath)).toBe('ORIGINAL');
  });

  it('keeps public errors path-free', async () => {
    const fx = await setup();
    writeFileSync(fx.requestPath, '{not-json', 'utf8');
    const error = await expectGateError(() => fx.gate.run());
    expect(error.message.toLowerCase()).not.toContain(fx.dataRoot.toLowerCase());
    expect(error.message.toLowerCase()).not.toContain(fx.targetPath.toLowerCase());
  });
});
