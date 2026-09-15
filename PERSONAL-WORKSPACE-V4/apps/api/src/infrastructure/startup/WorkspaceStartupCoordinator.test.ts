/**
 * Tests for WorkspaceStartupCoordinator and MigrationStartupGate.
 *
 * P1.8B - Implement Database-Scoped Startup Lock and Workspace Startup Coordinator Core
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PathResolverService } from '../path/PathResolverService';
import { PersistentMigrationJournal } from '../migration/journal/PersistentMigrationJournal';
import { SchemaMigrationRunner } from '../migration/SchemaMigrationRunner';
import { SchemaMigrationError } from '../migration/types';
import type {
  MigrationBackupFactory,
  MigrationBackupPort,
  MigrationClock,
  MigrationDatabaseFactory,
  MigrationDefinition,
  MigrationRunResult,
} from '../migration/types';
import { DatabaseStartupLock } from './DatabaseStartupLock';
import {
  MigrationStartupGate,
  WorkspaceStartupCoordinator,
  type WorkspaceStartupCoordinatorDeps,
} from './WorkspaceStartupCoordinator';
import {
  PendingRestoreGateError,
  RuntimeProviderError,
  RuntimeStoreError,
  WorkspaceStartupCoordinatorError,
  type AttemptResolutionInspection,
  type AttemptSummary,
  type DatabaseStartupLease,
  type DatabaseStartupLockPort,
  type MigrationJournalInspectionPort,
  type MigrationRunnerPort,
  type PendingRestoreGate,
  type PendingRestoreOutcome,
  type PersonalStoreFactory,
  type PersonalWorkspaceStore,
  type RuntimeProvider,
  type RuntimeProviderFactory,
  DatabaseStartupLockError,
} from './startup-types';

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-08-04T12:00:00.000Z');
const MIGRATION_CHECKSUM = 'a'.repeat(64);

const MIGRATION_0_1: MigrationDefinition = {
  id: 'm-0-1',
  fromVersion: 0,
  toVersion: 1,
  checksum: MIGRATION_CHECKSUM,
  description: 'create app_state',
  up: (ctx) => {
    ctx.database.exec(
      'CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)',
    );
  },
};

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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-startup-coordinator-'));
  tempRoots.push(dir);
  return dir;
}

function makeClock(): MigrationClock {
  return { now: () => FIXED_DATE };
}

function realDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite: (p) => new DatabaseSync(p),
    openReadOnly: (p) => new DatabaseSync(p, { readOnly: true }),
  };
}

class FakeBackupPort implements MigrationBackupPort {
  public created = false;
  public verified = false;

  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    this.created = true;
    return { backupId: 'bk-0001' };
  }

  public async verifyBackup(): Promise<unknown> {
    this.verified = true;
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public port = new FakeBackupPort();

  public create(): MigrationBackupPort {
    return this.port;
  }
}

function seedUpToDateDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      description TEXT NOT NULL,
      app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
      UNIQUE(from_version),
      UNIQUE(to_version),
      CHECK (duration_ms >= 0)
    )
  `);
  db.prepare(
    `INSERT INTO schema_migrations
        (migration_id, from_version, to_version, checksum, description, app_version, backup_id,
         started_at, completed_at, duration_ms, validation_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')`,
  ).run(
    MIGRATION_0_1.id,
    MIGRATION_0_1.fromVersion,
    MIGRATION_0_1.toVersion,
    MIGRATION_0_1.checksum,
    MIGRATION_0_1.description,
    '3.3.0',
    'bk-preexisting',
    '2026-08-04T12:00:00.000Z',
    '2026-08-04T12:00:01.000Z',
    1000,
  );
  db.exec('PRAGMA user_version = 1');
  db.close();
}

function seedEmptyDb(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.close();
}

function makeRealJournal(dataRoot: string, dbPath: string): PersistentMigrationJournal {
  const journalRoot = path.join(dataRoot, 'journal');
  mkdirSync(journalRoot, { recursive: true });
  let counter = 0;
  return new PersistentMigrationJournal({
    journalRoot,
    databasePath: dbPath,
    pathResolver: new PathResolverService(dataRoot),
    clock: makeClock(),
    idGenerator: { generate: () => 'att-' + String(++counter).padStart(4, '0') },
    appVersion: '3.3.0',
    journalFormatVersion: 1 as const,
  });
}

function makeRealRunner(journal: PersistentMigrationJournal): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: [MIGRATION_0_1],
    targetVersion: 1,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal,
    clock: makeClock(),
    pathResolver: new PathResolverService(path.dirname(journal['journalRoot'] ?? '')),
    busyTimeoutMs: 5000,
    legacyAdmission: {
      inspect: () => {
        throw new Error('legacy admission must not be called for these fixtures');
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Recording fakes
// ---------------------------------------------------------------------------

class RecordingResource implements RuntimeProvider, PersonalWorkspaceStore {
  public closeCalls = 0;

  public constructor(public readonly name: string) {}

  public close(): void {
    this.closeCalls++;
  }
}

class ThrowingCloseResource implements RuntimeProvider, PersonalWorkspaceStore {
  public closeCalls = 0;

  public close(): void {
    this.closeCalls++;
    throw new Error('close boom');
  }
}

class RecordingProviderFactory implements RuntimeProviderFactory {
  public calls = 0;
  public instances: RecordingResource[] = [];
  public failWith: Error | null = null;

  public create(): RuntimeProvider {
    this.calls++;
    if (this.failWith !== null) throw this.failWith;
    const instance = new RecordingResource('provider');
    this.instances.push(instance);
    return instance;
  }
}

class RecordingStoreFactory implements PersonalStoreFactory {
  public calls = 0;
  public instances: RecordingResource[] = [];
  public failWith: Error | null = null;

  public create(): PersonalWorkspaceStore {
    this.calls++;
    if (this.failWith !== null) throw this.failWith;
    const instance = new RecordingResource('store');
    this.instances.push(instance);
    return instance;
  }
}

class RecordingRestoreGate implements PendingRestoreGate {
  public calls = 0;
  public failWith: Error | null = null;
  public outcome: PendingRestoreOutcome = 'NO_PENDING_RESTORE';

  public async run(): Promise<PendingRestoreOutcome> {
    this.calls++;
    if (this.failWith !== null) throw this.failWith;
    return this.outcome;
  }
}

class RecordingRunner implements MigrationRunnerPort {
  public calls = 0;
  public lastPath = '';
  public failWith: Error | null = null;
  public result: MigrationRunResult = {
    status: 'up-to-date',
    fromVersion: 1,
    toVersion: 1,
    appliedMigrationIds: [],
  };

  public async run(databasePath: string): Promise<MigrationRunResult> {
    this.calls++;
    this.lastPath = databasePath;
    if (this.failWith !== null) throw this.failWith;
    return this.result;
  }
}

class RecordingLock implements DatabaseStartupLockPort {
  public acquireCalls = 0;
  public lastPath = '';
  public releaseCalls = 0;
  public failWith: Error | null = null;

  public acquire(databasePath: string): DatabaseStartupLease {
    this.acquireCalls++;
    this.lastPath = databasePath;
    if (this.failWith !== null) throw this.failWith;
    return Object.freeze<DatabaseStartupLease>({
      databaseIdentityHash: 'identity-hash',
      release: () => {
        this.releaseCalls++;
      },
    });
  }
}

class FailingReleaseLock implements DatabaseStartupLockPort {
  public acquireCalls = 0;
  public lastPath = '';
  public releaseCalls = 0;
  public failNextRelease = true;

  public acquire(databasePath: string): DatabaseStartupLease {
    this.acquireCalls++;
    this.lastPath = databasePath;
    return Object.freeze<DatabaseStartupLease>({
      databaseIdentityHash: 'identity-hash',
      release: () => {
        this.releaseCalls++;
        if (this.failNextRelease) {
          this.failNextRelease = false;
          throw new DatabaseStartupLockError('LOCK_RELEASE_FAILED', 'release failed');
        }
      },
    });
  }
}

class FailingRestoreGate implements PendingRestoreGate {
  public async run(): Promise<PendingRestoreOutcome> {
    throw new PendingRestoreGateError('restore failed');
  }
}

class FakeJournalInspection implements MigrationJournalInspectionPort {
  public attempts: AttemptSummary[] = [];
  public resolutions = new Map<string, AttemptResolutionInspection>();
  public calls: string[] = [];

  public async listNonTerminalAttempts(): Promise<AttemptSummary[]> {
    this.calls.push('listNonTerminalAttempts');
    return this.attempts;
  }

  public async inspectAttemptResolution(attemptId: string): Promise<AttemptResolutionInspection> {
    this.calls.push('inspectAttemptResolution:' + attemptId);
    const resolution = this.resolutions.get(attemptId);
    if (resolution === undefined) throw new Error('missing resolution for ' + attemptId);
    return resolution;
  }
}

function makeAttemptSummary(overrides: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    attemptId: 'att-1',
    classification: 'non-terminal',
    identityHash: 'identity-hash',
    latestState: 'TRANSACTION_STARTED',
    terminal: false,
    corrupt: false,
    ...overrides,
  };
}

function makeResolution(
  overrides: Partial<AttemptResolutionInspection> = {},
): AttemptResolutionInspection {
  return Object.freeze<AttemptResolutionInspection>({
    attemptId: 'att-1',
    classification: 'non-terminal',
    effectiveResolutionStatus: 'ABSENT',
    newAttemptAllowed: false,
    startupAllowed: false,
    manualActionRequired: true,
    ...overrides,
  });
}

interface Harness {
  coordinator: WorkspaceStartupCoordinator;
  dbPath: string;
  dataRoot: string;
  journalRoot: string;
  lock: DatabaseStartupLock;
  journal: PersistentMigrationJournal;
  runner: SchemaMigrationRunner;
  gate: MigrationStartupGate;
  restoreGate: RecordingRestoreGate;
  providerFactory: RecordingProviderFactory;
  storeFactory: RecordingStoreFactory;
}

function makeHarness(): Harness {
  const tempRoot = newTempDir();
  const dataRoot = path.join(tempRoot, 'data');
  mkdirSync(dataRoot, { recursive: true });
  const dbPath = path.join(dataRoot, 'workspace.sqlite');
  seedUpToDateDb(dbPath);
  const journal = makeRealJournal(dataRoot, dbPath);
  const runner = makeRealRunner(journal);
  const gate = new MigrationStartupGate(journal);
  const lock = new DatabaseStartupLock();
  const restoreGate = new RecordingRestoreGate();
  const providerFactory = new RecordingProviderFactory();
  const storeFactory = new RecordingStoreFactory();
  const coordinator = new WorkspaceStartupCoordinator({
    databasePath: dbPath,
    lock,
    pendingRestoreGate: restoreGate,
    migrationGate: gate,
    migrationRunner: runner,
    providerFactory,
    storeFactory,
  });
  return {
    coordinator,
    dbPath,
    dataRoot,
    journalRoot: path.join(dataRoot, 'journal'),
    lock,
    journal,
    runner,
    gate,
    restoreGate,
    providerFactory,
    storeFactory,
  };
}

function makeCoordinator(
  overrides: Partial<WorkspaceStartupCoordinatorDeps> & {
    dbPath?: string;
    dataRoot?: string;
  } = {},
): Harness {
  const tempRoot = newTempDir();
  const dataRoot = overrides.dataRoot ?? path.join(tempRoot, 'data');
  mkdirSync(dataRoot, { recursive: true });
  const dbPath = overrides.dbPath ?? path.join(dataRoot, 'workspace.sqlite');
  if (!existsSync(dbPath)) seedUpToDateDb(dbPath);
  const journal = makeRealJournal(dataRoot, dbPath);
  const runner = makeRealRunner(journal);
  const gate = new MigrationStartupGate(journal);
  const lock = new DatabaseStartupLock();
  const restoreGate = new RecordingRestoreGate();
  const providerFactory = new RecordingProviderFactory();
  const storeFactory = new RecordingStoreFactory();
  const coordinator = new WorkspaceStartupCoordinator({
    databasePath: dbPath,
    lock: overrides.lock ?? lock,
    pendingRestoreGate: overrides.pendingRestoreGate ?? restoreGate,
    migrationGate: overrides.migrationGate ?? gate,
    migrationRunner: overrides.migrationRunner ?? runner,
    providerFactory: overrides.providerFactory ?? providerFactory,
    storeFactory: overrides.storeFactory ?? storeFactory,
  });
  return {
    coordinator,
    dbPath,
    dataRoot,
    journalRoot: path.join(dataRoot, 'journal'),
    lock,
    journal,
    runner,
    gate,
    restoreGate,
    providerFactory,
    storeFactory,
  };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceStartupCoordinator', () => {
  it('returns READY for an up-to-date database', async () => {
    const fx = makeHarness();
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('READY');
    expect(result.manualActionRequired).toBe(false);
    expect(result.migrated).toBe(false);
    expect(result.appliedMigrationIds).toEqual([]);
    expect(result.databaseIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    await fx.coordinator.shutdown();
  });

  it('returns READY_AFTER_MIGRATION after a real migration', async () => {
    const fx = makeCoordinator();
    unlinkSync(fx.dbPath);
    seedEmptyDb(fx.dbPath);
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('READY_AFTER_MIGRATION');
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.appliedMigrationIds).toEqual(['m-0-1']);
    await fx.coordinator.shutdown();
  });

  it('acquires the lock before restore, migration, and factories', async () => {
    const events: string[] = [];
    const lock = new RecordingLock();
    const restoreGate = new RecordingRestoreGate();
    const runner = new RecordingRunner();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const originalAcquire = lock.acquire.bind(lock);
    lock.acquire = (p) => {
      events.push('lock.acquire');
      return originalAcquire(p);
    };
    const originalRestore = restoreGate.run.bind(restoreGate);
    restoreGate.run = async () => {
      events.push('restore');
      return originalRestore();
    };
    const originalRun = runner.run.bind(runner);
    runner.run = async (p) => {
      events.push('migration');
      return originalRun(p);
    };
    const originalProvider = providerFactory.create.bind(providerFactory);
    providerFactory.create = () => {
      events.push('provider');
      return originalProvider();
    };
    const originalStore = storeFactory.create.bind(storeFactory);
    storeFactory.create = () => {
      events.push('store');
      return originalStore();
    };
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: restoreGate,
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: runner,
      providerFactory,
      storeFactory,
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('READY');
    expect(events).toEqual(['lock.acquire', 'restore', 'migration', 'provider', 'store']);
    await coordinator.shutdown();
  });

  it('runs the pending restore gate before migration', async () => {
    const fx = makeHarness();
    fx.restoreGate.outcome = 'RESTORED';
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('READY');
    expect(fx.restoreGate.calls).toBe(1);
    await fx.coordinator.shutdown();
  });

  it('prevents migration and factories when restore fails', async () => {
    const fx = makeHarness();
    fx.restoreGate.failWith = new PendingRestoreGateError('restore failed');
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('STARTUP_BLOCKED');
    expect(result.reasonCode).toBe('RESTORE_FAILED');
    expect(fx.providerFactory.calls).toBe(0);
    expect(fx.storeFactory.calls).toBe(0);
    const lease = fx.lock.acquire(fx.dbPath);
    lease.release();
  });

  it('runs migration before provider creation', async () => {
    const fx = makeHarness();
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('READY');
    expect(fx.providerFactory.calls).toBe(1);
    await fx.coordinator.shutdown();
  });

  it('opens the provider before the personal store', async () => {
    const fx = makeHarness();
    await fx.coordinator.start();
    expect(fx.providerFactory.calls).toBe(1);
    expect(fx.storeFactory.calls).toBe(1);
    expect(fx.providerFactory.instances[0]).toBeDefined();
    expect(fx.storeFactory.instances[0]).toBeDefined();
    await fx.coordinator.shutdown();
  });

  it('prevents both factories when migration fails', async () => {
    const fx = makeHarness();
    const runner = new RecordingRunner();
    runner.failWith = new Error('migration boom');
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: fx.dbPath,
      lock: fx.lock,
      pendingRestoreGate: fx.restoreGate,
      migrationGate: fx.gate,
      migrationRunner: runner,
      providerFactory: fx.providerFactory,
      storeFactory: fx.storeFactory,
    });
    await expect(coordinator.start()).rejects.toThrow('migration boom');
    expect(fx.providerFactory.calls).toBe(0);
    expect(fx.storeFactory.calls).toBe(0);
    const lease = fx.lock.acquire(fx.dbPath);
    lease.release();
  });

  it('returns RECOVERY_REQUIRED for an unresolved journal state', async () => {
    const journal = new FakeJournalInspection();
    journal.attempts = [makeAttemptSummary()];
    journal.resolutions.set('att-1', makeResolution());
    const lock = new RecordingLock();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: new MigrationStartupGate(journal),
      migrationRunner: new RecordingRunner(),
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.reasonCode).toBe('UNRESOLVED_MIGRATION_ATTEMPT');
    expect(result.manualActionRequired).toBe(true);
    expect(lock.releaseCalls).toBe(1);
  });

  it('proceeds when an effective resolution allows startup', async () => {
    const journal = new FakeJournalInspection();
    journal.attempts = [makeAttemptSummary()];
    journal.resolutions.set(
      'att-1',
      makeResolution({
        effectiveResolutionStatus: 'EFFECTIVE',
        effectiveDisposition: 'SAFE_PRE_TRANSACTION_RETRY',
        newAttemptAllowed: true,
        startupAllowed: true,
        manualActionRequired: false,
      }),
    );
    const runner = new RecordingRunner();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock: new RecordingLock(),
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: new MigrationStartupGate(journal),
      migrationRunner: runner,
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('READY');
    expect(runner.calls).toBe(1);
  });

  it('blocks when an effective resolution disallows startup', async () => {
    const journal = new FakeJournalInspection();
    journal.attempts = [makeAttemptSummary()];
    journal.resolutions.set(
      'att-1',
      makeResolution({
        effectiveResolutionStatus: 'EFFECTIVE',
        effectiveDisposition: 'VALID_INTERMEDIATE_VERSION',
        startupAllowed: false,
        manualActionRequired: false,
      }),
    );
    const runner = new RecordingRunner();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock: new RecordingLock(),
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: new MigrationStartupGate(journal),
      migrationRunner: runner,
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(runner.calls).toBe(0);
  });

  it('blocks a stale resolution', async () => {
    const journal = new FakeJournalInspection();
    journal.attempts = [makeAttemptSummary()];
    journal.resolutions.set('att-1', makeResolution({ effectiveResolutionStatus: 'STALE' }));
    const runner = new RecordingRunner();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock: new RecordingLock(),
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: new MigrationStartupGate(journal),
      migrationRunner: runner,
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(runner.calls).toBe(0);
  });

  it('blocks a corrupt resolution', async () => {
    const journal = new FakeJournalInspection();
    journal.attempts = [makeAttemptSummary()];
    journal.resolutions.set('att-1', makeResolution({ effectiveResolutionStatus: 'CORRUPT' }));
    const runner = new RecordingRunner();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock: new RecordingLock(),
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: new MigrationStartupGate(journal),
      migrationRunner: runner,
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(runner.calls).toBe(0);
  });

  it('blocks a real active non-terminal attempt and never applies reconciliation', async () => {
    const fx = makeHarness();
    const { attemptId } = await fx.journal.createAttempt({ fromVersion: 0, targetVersion: 1 });
    await fx.journal.transition(attemptId, 'PREFLIGHT_VALIDATED');
    await fx.journal.transition(attemptId, 'BACKUP_VERIFIED', { backupId: 'bk-0001' });
    await fx.journal.transition(attemptId, 'TRANSACTION_STARTED', {
      migrationId: MIGRATION_0_1.id,
      fromVersion: 0,
      toVersion: 1,
    });
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.reasonCode).toBe('UNRESOLVED_MIGRATION_ATTEMPT');
    expect(fx.providerFactory.calls).toBe(0);
    expect(fx.storeFactory.calls).toBe(0);
    const sidecars = readdirSync(fx.journalRoot).filter((name) =>
      name.endsWith('.resolution.jsonl'),
    );
    expect(sidecars).toEqual([]);
  });

  it('serializes concurrent start calls and executes startup once', async () => {
    const fx = makeHarness();
    const [r1, r2] = await Promise.all([fx.coordinator.start(), fx.coordinator.start()]);
    expect(r1).toEqual(r2);
    expect(fx.providerFactory.calls).toBe(1);
    expect(fx.storeFactory.calls).toBe(1);
    await fx.coordinator.shutdown();
  });

  it('does not reopen resources when started again after READY', async () => {
    const fx = makeHarness();
    const first = await fx.coordinator.start();
    const second = await fx.coordinator.start();
    expect(first).toEqual(second);
    expect(fx.providerFactory.calls).toBe(1);
    expect(fx.storeFactory.calls).toBe(1);
    await fx.coordinator.shutdown();
  });

  it('releases the lock when provider creation fails', async () => {
    const fx = makeHarness();
    fx.providerFactory.failWith = new RuntimeProviderError('provider failed');
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('STARTUP_BLOCKED');
    expect(result.reasonCode).toBe('RUNTIME_PROVIDER_FAILED');
    expect(fx.storeFactory.calls).toBe(0);
    const lease = fx.lock.acquire(fx.dbPath);
    lease.release();
  });

  it('closes the provider and releases the lock when store creation fails', async () => {
    const fx = makeHarness();
    fx.storeFactory.failWith = new RuntimeStoreError('store failed');
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('STARTUP_BLOCKED');
    expect(result.reasonCode).toBe('RUNTIME_STORE_FAILED');
    expect(fx.providerFactory.instances[0]?.closeCalls).toBe(1);
    const lease = fx.lock.acquire(fx.dbPath);
    lease.release();
  });

  it('keeps the lock held after a successful start', async () => {
    const fx = makeHarness();
    const result = await fx.coordinator.start();
    expect(result.outcome).toBe('READY');
    expectLockError(() => fx.lock.acquire(fx.dbPath), 'LOCK_ALREADY_HELD');
    await fx.coordinator.shutdown();
  });

  it('shutdown closes the store, then the provider, then releases the lock', async () => {
    const events: string[] = [];
    const lock = new RecordingLock();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const originalProviderCreate = providerFactory.create.bind(providerFactory);
    providerFactory.create = () => {
      const instance = originalProviderCreate();
      const originalClose = instance.close.bind(instance);
      instance.close = () => {
        events.push('provider.close');
        originalClose();
      };
      return instance;
    };
    const originalStoreCreate = storeFactory.create.bind(storeFactory);
    storeFactory.create = () => {
      const instance = originalStoreCreate();
      const originalClose = instance.close.bind(instance);
      instance.close = () => {
        events.push('store.close');
        originalClose();
      };
      return instance;
    };
    const originalRelease = lock.acquire.bind(lock);
    lock.acquire = (p) => {
      const lease = originalRelease(p);
      const originalLeaseRelease = lease.release.bind(lease);
      return Object.freeze<DatabaseStartupLease>({
        databaseIdentityHash: lease.databaseIdentityHash,
        release: () => {
          events.push('lock.release');
          originalLeaseRelease();
        },
      });
    };
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory,
      storeFactory,
    });
    await coordinator.start();
    await coordinator.shutdown();
    expect(events).toEqual(['store.close', 'provider.close', 'lock.release']);
  });

  it('shutdown is idempotent', async () => {
    const fx = makeHarness();
    await fx.coordinator.start();
    await fx.coordinator.shutdown();
    await expect(fx.coordinator.shutdown()).resolves.toBeUndefined();
    expect(fx.providerFactory.instances[0]?.closeCalls).toBe(1);
    expect(fx.storeFactory.instances[0]?.closeCalls).toBe(1);
  });

  it('continues cleanup after one close failure', async () => {
    const lock = new RecordingLock();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const originalStoreCreate = storeFactory.create.bind(storeFactory);
    storeFactory.create = () => {
      originalStoreCreate();
      return new ThrowingCloseResource();
    };
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory,
      storeFactory,
    });
    await coordinator.start();
    await expect(coordinator.shutdown()).rejects.toBeInstanceOf(WorkspaceStartupCoordinatorError);
    expect(providerFactory.instances[0]?.closeCalls).toBe(1);
    expect(lock.releaseCalls).toBe(1);
  });

  it('continues cleanup when the provider close throws', async () => {
    const lock = new RecordingLock();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const originalProviderCreate = providerFactory.create.bind(providerFactory);
    providerFactory.create = () => {
      originalProviderCreate();
      return new ThrowingCloseResource();
    };
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory,
      storeFactory,
    });
    await coordinator.start();
    await expect(coordinator.shutdown()).rejects.toBeInstanceOf(WorkspaceStartupCoordinatorError);
    expect(storeFactory.instances[0]?.closeCalls).toBe(1);
    expect(lock.releaseCalls).toBe(1);
  });

  it('continues cleanup when the lock release throws', async () => {
    const lock = new FailingReleaseLock();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory,
      storeFactory,
    });
    await coordinator.start();
    await expect(coordinator.shutdown()).rejects.toBeInstanceOf(WorkspaceStartupCoordinatorError);
    expect(storeFactory.instances[0]?.closeCalls).toBe(1);
    expect(providerFactory.instances[0]?.closeCalls).toBe(1);
    expect(lock.releaseCalls).toBe(1);
  });

  it('continues cleanup when multiple cleanup steps throw', async () => {
    const lock = new FailingReleaseLock();
    const providerFactory = new RecordingProviderFactory();
    const storeFactory = new RecordingStoreFactory();
    const originalProviderCreate = providerFactory.create.bind(providerFactory);
    providerFactory.create = () => {
      originalProviderCreate();
      return new ThrowingCloseResource();
    };
    const originalStoreCreate = storeFactory.create.bind(storeFactory);
    storeFactory.create = () => {
      originalStoreCreate();
      return new ThrowingCloseResource();
    };
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory,
      storeFactory,
    });
    await coordinator.start();
    await expect(coordinator.shutdown()).rejects.toBeInstanceOf(WorkspaceStartupCoordinatorError);
    expect(lock.releaseCalls).toBe(1);
  });

  it('retries the lock release on shutdown after a bounded failure', async () => {
    const lock = new FailingReleaseLock();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new FailingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: new RecordingRunner(),
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('STARTUP_BLOCKED');
    expect(result.reasonCode).toBe('RESTORE_FAILED');
    expect(lock.releaseCalls).toBe(1);
    await coordinator.shutdown();
    expect(lock.releaseCalls).toBe(2);
  });

  it('maps an unresolved-attempt runner error to RECOVERY_REQUIRED', async () => {
    const runner = new RecordingRunner();
    runner.failWith = new SchemaMigrationError(
      'STARTUP_BLOCKED_BY_UNRESOLVED_ATTEMPT',
      'unresolved attempt',
    );
    const lock = new RecordingLock();
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: 'C:\\synthetic\\workspace.sqlite',
      lock,
      pendingRestoreGate: new RecordingRestoreGate(),
      migrationGate: { inspect: async () => ({ status: 'ALLOWED' }) },
      migrationRunner: runner,
      providerFactory: new RecordingProviderFactory(),
      storeFactory: new RecordingStoreFactory(),
    });
    const result = await coordinator.start();
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.reasonCode).toBe('UNRESOLVED_MIGRATION_ATTEMPT');
    expect(result.manualActionRequired).toBe(true);
    expect(lock.releaseCalls).toBe(1);
  });

  it('does not poison a later retry after a failed start', async () => {
    const fx = makeHarness();
    fx.restoreGate.failWith = new PendingRestoreGateError('restore failed');
    const first = await fx.coordinator.start();
    expect(first.outcome).toBe('STARTUP_BLOCKED');
    expect(first.reasonCode).toBe('RESTORE_FAILED');
    fx.restoreGate.failWith = null;
    const second = await fx.coordinator.start();
    expect(second.outcome).toBe('READY');
    expect(fx.providerFactory.calls).toBe(1);
    await fx.coordinator.shutdown();
  });

  it('returns immutable, path-free public results', async () => {
    const fx = makeHarness();
    const result = await fx.coordinator.start();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.appliedMigrationIds)).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain(fx.dataRoot);
    expect(json).not.toContain(':\\');
    expect(json).not.toContain('Error');
    expect(json).not.toContain(' at ');
    await fx.coordinator.shutdown();
  });

  it('lets unknown programming errors propagate', async () => {
    const fx = makeHarness();
    const runner = new RecordingRunner();
    runner.failWith = new Error('programming boom');
    const coordinator = new WorkspaceStartupCoordinator({
      databasePath: fx.dbPath,
      lock: fx.lock,
      pendingRestoreGate: fx.restoreGate,
      migrationGate: fx.gate,
      migrationRunner: runner,
      providerFactory: fx.providerFactory,
      storeFactory: fx.storeFactory,
    });
    await expect(coordinator.start()).rejects.toThrow('programming boom');
    const lease = fx.lock.acquire(fx.dbPath);
    lease.release();
  });

  it('never constructs production provider or store classes directly', async () => {
    const source = readFileSync(
      path.resolve('apps/api/src/infrastructure/startup/WorkspaceStartupCoordinator.ts'),
      'utf8',
    );
    expect(source).not.toContain('standalone-data-provider');
    expect(source).not.toContain('personal-workspace-store');
    expect(source).not.toContain('new StandaloneDataProvider');
    expect(source).not.toContain('new PersonalWorkspaceStore');
  });

  it('does not import or modify mock or team-demo behavior', async () => {
    for (const file of [
      'WorkspaceStartupCoordinator.ts',
      'DatabaseStartupLock.ts',
      'startup-types.ts',
    ]) {
      const source = readFileSync(
        path.resolve('apps/api/src/infrastructure/startup', file),
        'utf8',
      );
      for (const line of source.split(/\r?\n/)) {
        if (line.includes('from ')) {
          expect(line).not.toMatch(
            /team-demo|mock|standalone-data-provider|personal-workspace-store/,
          );
        }
      }
    }
  });
});
