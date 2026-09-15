import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  JournalWriteHooks,
  MigrationResolutionInput,
  AttemptResolutionInspection,
} from '../journal/journal-types';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  MigrationDefinition,
  MigrationJournalDetails,
  MigrationJournalState,
  MigrationClock,
} from '../types';
import { MigrationStateInspector } from '../MigrationStateInspector';
import { PersistentMigrationJournal } from '../journal/PersistentMigrationJournal';
import { PersistentMigrationJournalError } from '../journal/journal-types';
import { PathResolverService } from '../../path/PathResolverService';
import {
  InterruptedMigrationReconciler,
  type BackupEvidenceVerifier,
  type ReadOnlyDatabaseOpener,
} from './InterruptedMigrationReconciler';

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);
const FINGERPRINT_A = 'a'.repeat(64);

function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(dir);
}

function newTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'reconciler-test-'));
}

function makeClock(): MigrationClock {
  let ticks = 0;
  const base = Date.parse('2026-08-05T12:00:00.000Z');
  return { now: () => new Date(base + ticks++ * 1000) };
}

function makeIdGenerator(prefix: string): { generate(): string } {
  let counter = 0;
  return { generate: () => prefix + '-' + String(counter++).padStart(4, '0') };
}

function makeMigration(input: {
  id: string;
  from: number;
  to: number;
  checksum: string;
  description: string;
  up: string;
}): MigrationDefinition {
  return {
    id: input.id,
    fromVersion: input.from,
    toVersion: input.to,
    checksum: input.checksum,
    description: input.description,
    up: (ctx) => ctx.database.exec(input.up),
  };
}

const baseMigrations = [
  makeMigration({
    id: 'm-0-1',
    from: 0,
    to: 1,
    checksum: CHECKSUM_A,
    description: 'create base table',
    up: 'CREATE TABLE base (id INTEGER PRIMARY KEY, name TEXT)',
  }),
  makeMigration({
    id: 'm-1-2',
    from: 1,
    to: 2,
    checksum: CHECKSUM_B,
    description: 'add extra table',
    up: 'CREATE TABLE extra (id INTEGER PRIMARY KEY)',
  }),
  makeMigration({
    id: 'm-2-3',
    from: 2,
    to: 3,
    checksum: CHECKSUM_C,
    description: 'add notes table',
    up: 'CREATE TABLE notes (id INTEGER PRIMARY KEY)',
  }),
];

function historyUpTo(version: number): {
  migration_id: string;
  from_version: number;
  to_version: number;
  checksum: string;
}[] {
  return baseMigrations
    .filter((m) => m.toVersion <= version)
    .map((m) => ({
      migration_id: m.id,
      from_version: m.fromVersion,
      to_version: m.toVersion,
      checksum: m.checksum,
    }));
}

function committedStates(
  upToVersion: number,
  terminal = false,
): {
  state: MigrationJournalState;
  details?: MigrationJournalDetails;
}[] {
  const states: { state: MigrationJournalState; details?: MigrationJournalDetails }[] = [
    { state: 'PREFLIGHT_VALIDATED' },
    { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
  ];
  for (const m of baseMigrations.filter((m) => m.toVersion <= upToVersion)) {
    states.push({
      state: 'TRANSACTION_STARTED',
      details: { migrationId: m.id, fromVersion: m.fromVersion, toVersion: m.toVersion },
    });
    states.push({
      state: 'COMMITTED',
      details: {
        migrationId: m.id,
        fromVersion: m.fromVersion,
        toVersion: m.toVersion,
        durationMs: 100,
      },
    });
  }
  if (terminal) {
    states.push({ state: 'POST_VALIDATION_PASSED' });
    states.push({ state: 'SUCCEEDED' });
  }
  return states;
}

function startedState(upToVersion: number): {
  state: MigrationJournalState;
  details?: MigrationJournalDetails;
} {
  const m = baseMigrations.find((x) => x.toVersion === upToVersion)!;
  return {
    state: 'TRANSACTION_STARTED',
    details: { migrationId: m.id, fromVersion: m.fromVersion, toVersion: m.toVersion },
  };
}

function ensureHistoryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
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
}

function historyRow(
  db: DatabaseSync,
  row: { migration_id: string; from_version: number; to_version: number; checksum: string },
): void {
  db.prepare(
    `INSERT INTO schema_migrations (
      migration_id, from_version, to_version, checksum, description,
      app_version, backup_id, started_at, completed_at, duration_ms, validation_result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed')`,
  ).run(
    row.migration_id,
    row.from_version,
    row.to_version,
    row.checksum,
    'test',
    '1.0.0',
    'bk-0001',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:01.000Z',
    1000,
  );
}

interface ReconcilerFixture {
  reconciler: InterruptedMigrationReconciler;
  journal: PersistentMigrationJournal;
  inspector: MigrationStateInspector;
  dbPath: string;
  dataRoot: string;
  cleanup: () => void;
}

function createBackupFile(fx: ReconcilerFixture, backupId: string): string {
  const backupPath = path.join(fx.dataRoot, 'backups', backupId);
  mkdirSync(path.dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, Buffer.from('backup-evidence-' + backupId));
  return backupPath;
}

async function safePlanFromFixture(
  fx: ReconcilerFixture,
  states: { state: MigrationJournalState; details?: MigrationJournalDetails }[],
  fromVersion = 0,
  targetVersion = 3,
): Promise<{
  attemptId: string;
  plan: import('./InterruptedMigrationReconciler').ReconciliationPlan;
}> {
  const attemptId = await createAttemptWithStates(fx.journal, states, fromVersion, targetVersion);
  const result = await fx.reconciler.inspect(attemptId);
  if (result.status !== 'SAFE_PLAN') {
    throw new Error(`Expected SAFE_PLAN but got ${result.status}`);
  }
  return { attemptId, plan: result.plan };
}

function mutationOfPlan(
  plan: import('./InterruptedMigrationReconciler').ReconciliationPlan,
  field: keyof import('./InterruptedMigrationReconciler').ReconciliationPlan,
  value: unknown,
): import('./InterruptedMigrationReconciler').ReconciliationPlan {
  return {
    ...plan,
    [field]: value,
  } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
}
function makeReconcilerFixture(overrides?: {
  dbVersion?: number;
  withHistory?: boolean;
  historyRows?: {
    migration_id: string;
    from_version: number;
    to_version: number;
    checksum: string;
  }[];
  backupVerified?: boolean;
  backupShouldThrow?: boolean;
  extraTable?: string;
  migrations?: MigrationDefinition[];
  targetVersion?: number;
  useRealBackupFile?: boolean;
  journalWriteHooks?: JournalWriteHooks;
}): ReconcilerFixture {
  const dataRoot = newTempDir();
  const journalRoot = path.join(dataRoot, 'journals');
  const dbPath = path.join(dataRoot, 'data', 'app.db');
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  try {
    if (overrides?.dbVersion !== undefined && overrides.dbVersion > 0) {
      db.exec('PRAGMA user_version = ' + overrides.dbVersion);
    }
    if (overrides?.extraTable) {
      db.exec(`CREATE TABLE ${overrides.extraTable} (id INTEGER PRIMARY KEY)`);
    }
    if (overrides?.withHistory) {
      ensureHistoryTable(db);
      if (overrides.historyRows) {
        for (const row of overrides.historyRows) historyRow(db, row);
      }
    }
  } finally {
    db.close();
  }

  const pathResolver = new PathResolverService(dataRoot);
  const clock = makeClock();
  const idGenerator = makeIdGenerator('att');
  const inspector = new MigrationStateInspector(
    overrides?.migrations ?? baseMigrations,
    overrides?.targetVersion ?? 3,
  );

  const journal = new PersistentMigrationJournal({
    journalRoot,
    databasePath: dbPath,
    pathResolver,
    clock,
    idGenerator,
    appVersion: '3.3.0',
    journalFormatVersion: 1 as const,
    writeHooks: overrides?.journalWriteHooks,
  });

  const backupVerified = overrides?.backupVerified ?? true;
  const backupShouldThrow = overrides?.backupShouldThrow ?? false;
  const useRealBackupFile = overrides?.useRealBackupFile ?? false;

  const backupVerifier: BackupEvidenceVerifier = {
    async verifyBackupEvidence(backupId: string): Promise<boolean> {
      if (backupShouldThrow) throw new Error('Simulated backup verification failure');
      if (useRealBackupFile) {
        return existsSync(path.join(dataRoot, 'backups', backupId));
      }
      return backupVerified;
    },
  };

  const databaseOpener: ReadOnlyDatabaseOpener = {
    open(): DatabaseSync {
      return new DatabaseSync(dbPath, { readOnly: true });
    },
  };

  const reconciler = new InterruptedMigrationReconciler({
    journal,
    inspector,
    databaseOpener,
    backupVerifier,
  });

  return { reconciler, journal, inspector, dbPath, dataRoot, cleanup: () => removeTree(dataRoot) };
}

async function createAttemptWithStates(
  journal: PersistentMigrationJournal,
  states: { state: MigrationJournalState; details?: MigrationJournalDetails }[],
  fromVersion = 0,
  targetVersion = 3,
): Promise<string> {
  const { attemptId } = await journal.createAttempt({ fromVersion, targetVersion });
  for (const s of states) {
    if (s.state === 'FAILED') {
      await journal.markFailed(attemptId, { code: 'TEST_FAILURE', message: 'Test failure' });
    } else {
      await journal.transition(attemptId, s.state, s.details);
    }
  }
  return attemptId;
}

async function appendResolvedSuccess(
  journal: PersistentMigrationJournal,
  attemptId: string,
): Promise<void> {
  const inspection = await journal.inspectAttempt(attemptId);
  const latestChecksum = inspection.records[inspection.records.length - 1]!.checksum;
  await journal.appendResolution(attemptId, {
    disposition: 'RESOLVED_SUCCESS',
    planFingerprint: FINGERPRINT_A,
    attemptLatestChecksum: latestChecksum,
    observedUserVersion: 3,
    observedHistoryFingerprint: FINGERPRINT_A,
    observedCompletedMigrationIds: baseMigrations.map((m) => m.id),
    backupId: 'bk-test',
    backupVerified: true,
    startupAllowed: true,
    newAttemptAllowed: false,
    manualActionRequired: false,
    safeReasonCode: 'RESOLVED_SUCCESS',
  });
}

describe('InterruptedMigrationReconciler', () => {
  const fixtures: ReconcilerFixture[] = [];
  afterEach(() => {
    for (const f of fixtures) f.cleanup();
    fixtures.length = 0;
  });

  function trackFixture(f: ReconcilerFixture): ReconcilerFixture {
    fixtures.push(f);
    return f;
  }

  describe('read-only guarantee', () => {
    it('leaves database, attempt, and sidecar byte-identical', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: historyUpTo(1),
        }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(1, true), 0, 1);
      const beforeDb = readFileSync(fx.dbPath);
      const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
      const beforeAttempt = readFileSync(attemptPath);
      await fx.reconciler.inspect(attemptId);
      expect(Buffer.compare(beforeDb, readFileSync(fx.dbPath))).toBe(0);
      expect(Buffer.compare(beforeAttempt, readFileSync(attemptPath))).toBe(0);
      expect(existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl'))).toBe(
        false,
      );
    });

    it('leaves an existing resolution sidecar byte-identical', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 3,
          withHistory: true,
          historyRows: historyUpTo(3),
        }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      await appendResolvedSuccess(fx.journal, attemptId);
      const resolutionPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
      const before = readFileSync(resolutionPath);
      await fx.reconciler.inspect(attemptId);
      expect(Buffer.compare(before, readFileSync(resolutionPath))).toBe(0);
    });

    it('does not write to the database while a transaction is open', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const before = readFileSync(fx.dbPath);
      await fx.reconciler.inspect(attemptId);
      expect(Buffer.compare(before, readFileSync(fx.dbPath))).toBe(0);
    });

    it('returns deeply immutable results', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(fx.journal, [], 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(Object.isFrozen(result)).toBe(true);
      if (result.status === 'SAFE_PLAN') {
        expect(Object.isFrozen(result.plan)).toBe(true);
        expect(Object.isFrozen(result.plan.observedCompletedMigrationIds)).toBe(true);
      }
    });

    it('does not leak absolute paths', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: historyUpTo(1),
        }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(1, true), 0, 1);
      const result = await fx.reconciler.inspect(attemptId);
      const json = JSON.stringify(result);
      expect(json).not.toContain(fx.dataRoot.replace(/\\/g, '/'));
      expect(json).not.toContain(fx.dbPath.replace(/\\/g, '/'));
    });

    it('throws on unknown programming errors', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      await expect(fx.reconciler.inspect('')).rejects.toThrow();
    });
  });

  describe('existing resolution handling', () => {
    it('effective resolution returns ALREADY_RESOLVED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 3,
          withHistory: true,
          historyRows: historyUpTo(3),
        }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      await appendResolvedSuccess(fx.journal, attemptId);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('ALREADY_RESOLVED');
      if (result.status === 'ALREADY_RESOLVED') {
        expect(result.effectiveDisposition).toBe('RESOLVED_SUCCESS');
        expect(result.resolutionChecksum).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('stale resolution returns BLOCKED', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const inspection = await fx.journal.inspectAttempt(attemptId);
      const latestChecksum = inspection.records[inspection.records.length - 1]!.checksum;
      await fx.journal.appendResolution(attemptId, {
        disposition: 'SAFE_PRE_TRANSACTION_RETRY',
        planFingerprint: FINGERPRINT_A,
        attemptLatestChecksum: latestChecksum,
        observedUserVersion: 0,
        observedHistoryFingerprint: FINGERPRINT_A,
        observedCompletedMigrationIds: [],
        backupVerified: false,
        startupAllowed: false,
        newAttemptAllowed: true,
        manualActionRequired: false,
        safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
      });
      await fx.journal.markFailed(attemptId, { code: 'TEST_FAILURE', message: 'Test failure' });
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('STALE_EXISTING_RESOLUTION');
      }
    });

    it('corrupt resolution returns BLOCKED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      const resolutionPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
      writeFileSync(resolutionPath, 'not valid json', 'utf8');
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('CORRUPT_EXISTING_RESOLUTION');
        expect(result).not.toHaveProperty('plan');
      }
    });

    it('symlinked sidecar returns BLOCKED when supported', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      const resolutionPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
      try {
        symlinkSync(path.join(fx.dataRoot, 'journals', 'nonexistent'), resolutionPath);
        const result = await fx.reconciler.inspect(attemptId);
        expect(result.status).toBe('BLOCKED');
      } catch (err) {
        if (err instanceof Error && /EPERM|privilege|not permitted/i.test(err.message)) return;
        throw err;
      }
    });
  });

  describe('no action required', () => {
    it('healthy SUCCEEDED plus matching database returns NO_ACTION_REQUIRED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('NO_ACTION_REQUIRED');
    });

    it('healthy SUCCEEDED with mismatched database returns BLOCKED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 2, withHistory: true, historyRows: historyUpTo(2) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('SUCCEEDED_DATABASE_MISMATCH');
        expect(result.manualActionRequired).toBe(true);
      }
    });
  });

  describe('SAFE_PRE_TRANSACTION_RETRY', () => {
    it.each([
      {
        label: 'CREATED',
        states: [] as { state: MigrationJournalState; details?: MigrationJournalDetails }[],
      },
      { label: 'PREFLIGHT_VALIDATED', states: [{ state: 'PREFLIGHT_VALIDATED' as const }] },
      {
        label: 'BACKUP_VERIFIED',
        states: [
          { state: 'PREFLIGHT_VALIDATED' as const },
          { state: 'BACKUP_VERIFIED' as const, details: { backupId: 'bk-test' } },
        ],
      },
      {
        label: 'FAILED',
        states: [{ state: 'PREFLIGHT_VALIDATED' as const }, { state: 'FAILED' as const }],
      },
    ])('$label plus unchanged database returns SAFE_PLAN', async ({ states }) => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(fx.journal, states, 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('SAFE_PRE_TRANSACTION_RETRY');
      }
    });

    it('committed mutation prevents SAFE_PRE_TRANSACTION_RETRY', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(1, false), 0, 1);
      const result = await fx.reconciler.inspect(attemptId);
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).not.toBe('SAFE_PRE_TRANSACTION_RETRY');
      }
    });

    it('unmatched transaction prevents SAFE_PRE_TRANSACTION_RETRY', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const result = await fx.reconciler.inspect(attemptId);
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).not.toBe('SAFE_PRE_TRANSACTION_RETRY');
      }
    });

    it('changed database version prevents SAFE_PRE_TRANSACTION_RETRY', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 1 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).not.toBe('SAFE_PRE_TRANSACTION_RETRY');
      }
    });
  });

  describe('transaction dispositions', () => {
    it('unmatched started transaction and unchanged database returns TRANSACTION_ROLLED_BACK', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('TRANSACTION_ROLLED_BACK');
        expect(result.plan.observedCurrentMigrationId).toBe('m-0-1');
        expect(result.plan.backupVerified).toBe(true);
        expect(result.plan.newAttemptAllowed).toBe(true);
        expect(result.plan.manualActionRequired).toBe(false);
      }
    });

    it('unmatched started transaction with confirmed commit returns COMMIT_CONFIRMED_FROM_DATABASE', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        expect(result.plan.observedUserVersion).toBe(1);
        expect(result.plan.observedCompletedMigrationIds).toEqual(['m-0-1']);
        expect(result.plan.newAttemptAllowed).toBe(false);
      }
    });

    it('full committed range without SUCCEEDED returns RESOLVED_SUCCESS', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, false), 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('RESOLVED_SUCCESS');
        expect(result.plan.observedCompletedMigrationIds).toEqual(['m-0-1', 'm-1-2', 'm-2-3']);
        expect(result.plan.newAttemptAllowed).toBe(false);
        expect(result.plan.manualActionRequired).toBe(false);
      }
    });
  });

  describe('VALID_INTERMEDIATE_VERSION', () => {
    it('partial committed range with matching intermediate database returns VALID_INTERMEDIATE_VERSION', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 2, withHistory: true, historyRows: historyUpTo(2) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(2, false), 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('VALID_INTERMEDIATE_VERSION');
        expect(result.plan.observedUserVersion).toBe(2);
        expect(result.plan.observedCompletedMigrationIds).toEqual(['m-0-1', 'm-1-2']);
        expect(result.plan.newAttemptAllowed).toBe(true);
      }
    });
  });

  describe('blocked states', () => {
    it('missing attempt returns BLOCKED', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const result = await fx.reconciler.inspect('att-missing-attempt');
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('ATTEMPT_NOT_FOUND');
        expect(result.manualActionRequired).toBe(true);
      }
    });

    it('unverified backup evidence returns BLOCKED', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0, backupVerified: false }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('BACKUP_EVIDENCE_UNAVAILABLE');
      }
    });

    it('future schema version returns BLOCKED', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 5 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_FUTURE_SCHEMA');
      }
    });

    it('populated version-zero database returns BLOCKED', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0, extraTable: 'legacy_table' }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('LEGACY_DETECTION_REQUIRED');
      }
    });

    it('history checksum mismatch returns BLOCKED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: 'x'.repeat(64) },
          ],
        }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_CHECKSUM_MISMATCH');
      }
    });

    it('incomplete history returns BLOCKED', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 2, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_HISTORY_INVALID');
      }
    });

    it('BLOCKED results do not expose a plan', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 5 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      expect(result).not.toHaveProperty('plan');
    });
  });

  describe('fingerprints', () => {
    it('history fingerprint is deterministic and lowercase 64-hex', async () => {
      const fx1 = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const fx2 = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const a1 = await createAttemptWithStates(
        fx1.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const a2 = await createAttemptWithStates(
        fx2.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const r1 = await fx1.reconciler.inspect(a1);
      const r2 = await fx2.reconciler.inspect(a2);
      expect(r1.status).toBe('SAFE_PLAN');
      expect(r2.status).toBe('SAFE_PLAN');
      if (r1.status === 'SAFE_PLAN' && r2.status === 'SAFE_PLAN') {
        expect(r1.plan.observedHistoryFingerprint).toBe(r2.plan.observedHistoryFingerprint);
        expect(r1.plan.observedHistoryFingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('plan fingerprint is deterministic and lowercase 64-hex', async () => {
      const fx1 = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const fx2 = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const states = [
        { state: 'PREFLIGHT_VALIDATED' as const },
        { state: 'BACKUP_VERIFIED' as const, details: { backupId: 'bk-test' } },
        startedState(1),
      ];
      const a1 = await createAttemptWithStates(fx1.journal, states, 0, 1);
      const a2 = await createAttemptWithStates(fx2.journal, states, 0, 1);
      const r1 = await fx1.reconciler.inspect(a1);
      const r2 = await fx2.reconciler.inspect(a2);
      expect(r1.status).toBe('SAFE_PLAN');
      expect(r2.status).toBe('SAFE_PLAN');
      if (r1.status === 'SAFE_PLAN' && r2.status === 'SAFE_PLAN') {
        expect(r1.plan.planFingerprint).toBe(r2.plan.planFingerprint);
        expect(r1.plan.planFingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('plan fingerprint changes when a safety-relevant field changes', async () => {
      const fx1 = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const fx2 = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const states = [
        { state: 'PREFLIGHT_VALIDATED' as const },
        { state: 'BACKUP_VERIFIED' as const, details: { backupId: 'bk-test' } },
        startedState(1),
      ];
      const a1 = await createAttemptWithStates(fx1.journal, states, 0, 1);
      const a2 = await createAttemptWithStates(fx2.journal, states, 0, 1);
      const r1 = await fx1.reconciler.inspect(a1);
      const r2 = await fx2.reconciler.inspect(a2);
      expect(r1.status).toBe('SAFE_PLAN');
      expect(r2.status).toBe('SAFE_PLAN');
      if (r1.status === 'SAFE_PLAN' && r2.status === 'SAFE_PLAN') {
        expect(r1.plan.planFingerprint).not.toBe(r2.plan.planFingerprint);
      }
    });
  });

  describe('inspection independence and recovery', () => {
    it('repeating the same attempt returns identical results', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const first = await fx.reconciler.inspect(attemptId);
      const second = await fx.reconciler.inspect(attemptId);
      expect(first).toEqual(second);
    });

    it('different attempts are independent', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const a1 = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }, { state: 'FAILED' }],
        0,
        3,
      );
      const a2 = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const r1 = await fx.reconciler.inspect(a1);
      const r2 = await fx.reconciler.inspect(a2);
      expect(r1.status).toBe('SAFE_PLAN');
      expect(r2.status).toBe('SAFE_PLAN');
      if (r1.status === 'SAFE_PLAN' && r2.status === 'SAFE_PLAN') {
        expect(r1.plan.attemptId).toBe(a1);
        expect(r2.plan.attemptId).toBe(a2);
        expect(r1.plan.planFingerprint).not.toBe(r2.plan.planFingerprint);
      }
    });

    it('a failed inspection does not break later valid inspections', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const missing = await fx.reconciler.inspect('att-missing-attempt');
      expect(missing.status).toBe('BLOCKED');
      const validId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const valid = await fx.reconciler.inspect(validId);
      expect(valid.status).toBe('SAFE_PLAN');
    });
  });
  describe('attempt corruption and unsafe entries', () => {
    it('empty attempt file returns BLOCKED ATTEMPT_CORRUPT', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(fx.journal, [], 0, 3);
      const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
      writeFileSync(attemptPath, '', 'utf8');
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('ATTEMPT_CORRUPT');
        expect(result.manualActionRequired).toBe(true);
      }
    });

    it('malformed attempt json returns BLOCKED ATTEMPT_CORRUPT', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(fx.journal, [], 0, 3);
      const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
      writeFileSync(attemptPath, 'not valid json', 'utf8');
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('ATTEMPT_CORRUPT');
      }
    });

    it('a symlinked attempt file propagates the typed unsafe-entry error', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(fx.journal, [], 0, 3);
      const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
      try {
        unlinkSync(attemptPath);
        symlinkSync(path.join(fx.dataRoot, 'journals', 'nonexistent-target'), attemptPath);
      } catch (err) {
        if (err instanceof Error && /EPERM|EACCES|privilege|not permitted/i.test(err.message))
          return;
        throw err;
      }
      await expect(fx.reconciler.inspect(attemptId)).rejects.toThrow(
        PersistentMigrationJournalError,
      );
    });
  });

  describe('database blocker reason codes', () => {
    it('unknown migration id in history returns BLOCKED DATABASE_HISTORY_INVALID', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-unknown', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
          ],
        }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_HISTORY_INVALID');
      }
    });

    it('missing history table at a non-zero version returns BLOCKED DATABASE_HISTORY_INVALID', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 2 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_HISTORY_INVALID');
      }
    });

    it('history with a wrong version range returns BLOCKED DATABASE_HISTORY_INVALID', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-0-1', from_version: 2, to_version: 1, checksum: CHECKSUM_A },
          ],
        }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_HISTORY_INVALID');
      }
    });

    it('database at a non-registered intermediate version returns BLOCKED DATABASE_STATE_AMBIGUOUS', async () => {
      const gapMigrations = [
        makeMigration({
          id: 'm-0-1',
          from: 0,
          to: 1,
          checksum: CHECKSUM_A,
          description: 'base',
          up: 'CREATE TABLE base (id INTEGER PRIMARY KEY)',
        }),
        makeMigration({
          id: 'm-2-3',
          from: 2,
          to: 3,
          checksum: CHECKSUM_C,
          description: 'notes',
          up: 'CREATE TABLE notes (id INTEGER PRIMARY KEY)',
        }),
      ];
      const fx = trackFixture(
        makeReconcilerFixture({
          dbVersion: 2,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
          ],
          migrations: gapMigrations,
          targetVersion: 3,
        }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('DATABASE_STATE_AMBIGUOUS');
      }
    });

    it('database below attempt start version returns BLOCKED ATTEMPT_DATABASE_RANGE_MISMATCH', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        2,
        3,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('ATTEMPT_DATABASE_RANGE_MISMATCH');
      }
    });

    it('database above attempt target version returns BLOCKED ATTEMPT_DATABASE_RANGE_MISMATCH', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        2,
      );
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('BLOCKED');
      if (result.status === 'BLOCKED') {
        expect(result.safeReasonCode).toBe('ATTEMPT_DATABASE_RANGE_MISMATCH');
      }
    });
  });

  describe('multi-migration transaction dispositions', () => {
    it('earlier commits then a final rolled-back transaction return TRANSACTION_ROLLED_BACK at the committed prefix', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 2, withHistory: true, historyRows: historyUpTo(2) }),
      );
      const states = [...committedStates(2, false), startedState(3)];
      const attemptId = await createAttemptWithStates(fx.journal, states, 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('TRANSACTION_ROLLED_BACK');
        expect(result.plan.observedCurrentMigrationId).toBe('m-2-3');
        expect(result.plan.observedUserVersion).toBe(2);
        expect(result.plan.observedCompletedMigrationIds).toEqual(['m-0-1', 'm-1-2']);
        expect(result.plan.backupVerified).toBe(true);
        expect(result.plan.newAttemptAllowed).toBe(true);
        expect(result.plan.manualActionRequired).toBe(false);
      }
    });

    it('committed intermediate migration absent from the journal returns COMMIT_CONFIRMED_FROM_DATABASE below target', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 2, withHistory: true, historyRows: historyUpTo(2) }),
      );
      const states = [...committedStates(1, false), startedState(2)];
      const attemptId = await createAttemptWithStates(fx.journal, states, 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('SAFE_PLAN');
      if (result.status === 'SAFE_PLAN') {
        expect(result.plan.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        expect(result.plan.observedUserVersion).toBe(2);
        expect(result.plan.observedCompletedMigrationIds).toEqual(['m-0-1', 'm-1-2']);
        expect(result.plan.observedCurrentMigrationId).toBe('m-1-2');
        expect(result.plan.newAttemptAllowed).toBe(true);
        expect(result.plan.manualActionRequired).toBe(false);
      }
    });
  });

  describe('error propagation and resource handling', () => {
    it('propagates unknown backup-verifier programming errors', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0, backupShouldThrow: true }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      await expect(fx.reconciler.inspect(attemptId)).rejects.toThrow(
        'Simulated backup verification failure',
      );
    });

    it('closes the database handle and propagates when the inspector throws', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      let opens = 0;
      let closes = 0;
      const throwingInspector = {
        inspect(): never {
          throw new Error('inspector boom');
        },
      } as unknown as MigrationStateInspector;
      const databaseOpener: ReadOnlyDatabaseOpener = {
        open(): DatabaseSync {
          opens++;
          const inner = new DatabaseSync(fx.dbPath, { readOnly: true });
          const handler: ProxyHandler<DatabaseSync> = {
            get(target, prop) {
              if (prop === 'close') {
                return () => {
                  closes++;
                  target.close();
                };
              }
              const value = (target as unknown as Record<string | symbol, unknown>)[prop];
              return typeof value === 'function' ? value.bind(target) : value;
            },
          };
          return new Proxy(inner, handler) as unknown as DatabaseSync;
        },
      };
      const reconciler = new InterruptedMigrationReconciler({
        journal: fx.journal,
        inspector: throwingInspector,
        databaseOpener,
        backupVerifier: {
          async verifyBackupEvidence(): Promise<boolean> {
            return true;
          },
        },
      });
      await expect(reconciler.inspect(attemptId)).rejects.toThrow('inspector boom');
      expect(opens).toBe(1);
      expect(closes).toBe(1);
    });
  });

  describe('history fingerprint sensitivity', () => {
    it('changes when the observed history checksum changes', async () => {
      const altMigrations = [
        makeMigration({
          id: 'm-0-1',
          from: 0,
          to: 1,
          checksum: 'z'.repeat(64),
          description: 'alt base',
          up: 'CREATE TABLE base (id INTEGER PRIMARY KEY, name TEXT)',
        }),
        makeMigration({
          id: 'm-1-2',
          from: 1,
          to: 2,
          checksum: CHECKSUM_B,
          description: 'add extra table',
          up: 'CREATE TABLE extra (id INTEGER PRIMARY KEY)',
        }),
        makeMigration({
          id: 'm-2-3',
          from: 2,
          to: 3,
          checksum: CHECKSUM_C,
          description: 'add notes table',
          up: 'CREATE TABLE notes (id INTEGER PRIMARY KEY)',
        }),
      ];
      const fxA = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: CHECKSUM_A },
          ],
        }),
      );
      const fxB = trackFixture(
        makeReconcilerFixture({
          dbVersion: 1,
          withHistory: true,
          historyRows: [
            { migration_id: 'm-0-1', from_version: 0, to_version: 1, checksum: 'z'.repeat(64) },
          ],
          migrations: altMigrations,
        }),
      );
      const states = [
        { state: 'PREFLIGHT_VALIDATED' as const },
        { state: 'BACKUP_VERIFIED' as const, details: { backupId: 'bk-test' } },
        startedState(1),
      ];
      const aId = await createAttemptWithStates(fxA.journal, states, 0, 1);
      const bId = await createAttemptWithStates(fxB.journal, states, 0, 1);
      const ra = await fxA.reconciler.inspect(aId);
      const rb = await fxB.reconciler.inspect(bId);
      expect(ra.status).toBe('SAFE_PLAN');
      expect(rb.status).toBe('SAFE_PLAN');
      if (ra.status === 'SAFE_PLAN' && rb.status === 'SAFE_PLAN') {
        expect(ra.plan.observedHistoryFingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(ra.plan.observedHistoryFingerprint).not.toBe(rb.plan.observedHistoryFingerprint);
      }
    });
  });

  describe('plan fingerprint sensitivity', () => {
    it('reflects the observed database state, not only the attempt', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const rolledBack = await fx.reconciler.inspect(attemptId);
      const db = new DatabaseSync(fx.dbPath);
      db.exec('PRAGMA user_version = 1');
      ensureHistoryTable(db);
      historyRow(db, {
        migration_id: 'm-0-1',
        from_version: 0,
        to_version: 1,
        checksum: CHECKSUM_A,
      });
      db.close();
      const confirmed = await fx.reconciler.inspect(attemptId);
      expect(rolledBack.status).toBe('SAFE_PLAN');
      expect(confirmed.status).toBe('SAFE_PLAN');
      if (rolledBack.status === 'SAFE_PLAN' && confirmed.status === 'SAFE_PLAN') {
        expect(rolledBack.plan.attemptId).toBe(confirmed.plan.attemptId);
        expect(rolledBack.plan.attemptLatestChecksum).toBe(confirmed.plan.attemptLatestChecksum);
        expect(rolledBack.plan.backupId).toBe(confirmed.plan.backupId);
        expect(rolledBack.plan.observedCurrentMigrationId).toBe(
          confirmed.plan.observedCurrentMigrationId,
        );
        expect(rolledBack.plan.disposition).not.toBe(confirmed.plan.disposition);
        expect(rolledBack.plan.planFingerprint).not.toBe(confirmed.plan.planFingerprint);
      }
    });
  });

  describe('result immutability', () => {
    it('a frozen plan array resists mutation and a later inspection is unaffected', async () => {
      const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [{ state: 'PREFLIGHT_VALIDATED' }],
        0,
        3,
      );
      const first = await fx.reconciler.inspect(attemptId);
      expect(first.status).toBe('SAFE_PLAN');
      if (first.status === 'SAFE_PLAN') {
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.plan)).toBe(true);
        expect(Object.isFrozen(first.plan.observedCompletedMigrationIds)).toBe(true);
        expect(() => {
          (first.plan.observedCompletedMigrationIds as string[]).push('forged');
        }).toThrow();
        expect(first.plan.observedCompletedMigrationIds.length).toBe(0);
      }
      const second = await fx.reconciler.inspect(attemptId);
      expect(second).toEqual(first);
    });

    it('NO_ACTION_REQUIRED does not expose a plan or retry permission', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 3, withHistory: true, historyRows: historyUpTo(3) }),
      );
      const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
      const result = await fx.reconciler.inspect(attemptId);
      expect(result.status).toBe('NO_ACTION_REQUIRED');
      expect(result).not.toHaveProperty('plan');
      expect(result).not.toHaveProperty('newAttemptAllowed');
      expect(result).not.toHaveProperty('manualActionRequired');
    });
  });

  describe('transaction read-only boundary', () => {
    it('does not create a sidecar or modify the attempt for transaction dispositions', async () => {
      const fx = trackFixture(
        makeReconcilerFixture({ dbVersion: 1, withHistory: true, historyRows: historyUpTo(1) }),
      );
      const attemptId = await createAttemptWithStates(
        fx.journal,
        [
          { state: 'PREFLIGHT_VALIDATED' },
          { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
          startedState(1),
        ],
        0,
        1,
      );
      const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
      const before = readFileSync(attemptPath);
      const beforeEntries = readdirSync(path.join(fx.dataRoot, 'journals')).slice().sort();
      await fx.reconciler.inspect(attemptId);
      expect(Buffer.compare(before, readFileSync(attemptPath))).toBe(0);
      expect(existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl'))).toBe(
        false,
      );
      expect(readdirSync(path.join(fx.dataRoot, 'journals')).slice().sort()).toEqual(beforeEntries);
    });
  });

  describe('apply()', () => {
    describe('basic apply', () => {
      it('applies a valid SAFE_PRE_TRANSACTION_RETRY plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.attemptId).toBe(attemptId);
          expect(result.disposition).toBe('SAFE_PRE_TRANSACTION_RETRY');
          expect(result.planFingerprint).toBe(plan.planFingerprint);
          expect(result.resolutionChecksum).toMatch(/^[0-9a-f]{64}$/);
        }
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        expect(existsSync(sidecarPath)).toBe(true);
      });

      it('applies a valid TRANSACTION_ROLLED_BACK plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(2, false), startedState(3)],
          0,
          3,
        );
        expect(plan.disposition).toBe('TRANSACTION_ROLLED_BACK');
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.disposition).toBe('TRANSACTION_ROLLED_BACK');
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('applies a valid COMMIT_CONFIRMED_FROM_DATABASE below target plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        expect(plan.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        expect(plan.newAttemptAllowed).toBe(true);
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('applies a valid COMMIT_CONFIRMED_FROM_DATABASE at target plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 1,
            withHistory: true,
            historyRows: historyUpTo(1),
            targetVersion: 1,
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [
            { state: 'PREFLIGHT_VALIDATED' },
            { state: 'BACKUP_VERIFIED', details: { backupId: 'bk-test' } },
            startedState(1),
          ],
          0,
          1,
        );
        expect(plan.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        expect(plan.newAttemptAllowed).toBe(false);
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('applies a valid VALID_INTERMEDIATE_VERSION plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 1,
            withHistory: true,
            historyRows: historyUpTo(1),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(fx, committedStates(1, false), 0, 3);
        expect(plan.disposition).toBe('VALID_INTERMEDIATE_VERSION');
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.disposition).toBe('VALID_INTERMEDIATE_VERSION');
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('applies a valid RESOLVED_SUCCESS plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 3,
            withHistory: true,
            historyRows: historyUpTo(3),
            targetVersion: 3,
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(fx, committedStates(3, false), 0, 3);
        expect(plan.disposition).toBe('RESOLVED_SUCCESS');
        expect(plan.startupAllowed).toBe(true);
        expect(plan.newAttemptAllowed).toBe(false);
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.disposition).toBe('RESOLVED_SUCCESS');
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('applied record exactly matches the fresh plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const record = JSON.parse(readFileSync(sidecarPath, 'utf8').trim());
        expect(record.disposition).toBe(plan.disposition);
        expect(record.planFingerprint).toBe(plan.planFingerprint);
        expect(record.attemptLatestChecksum).toBe(plan.attemptLatestChecksum);
        expect(record.observedUserVersion).toBe(plan.observedUserVersion);
        expect(record.observedHistoryFingerprint).toBe(plan.observedHistoryFingerprint);
        expect(record.observedCompletedMigrationIds).toEqual([
          ...plan.observedCompletedMigrationIds,
        ]);
        expect(record.observedCurrentMigrationId).toBe(plan.observedCurrentMigrationId);
        expect(record.backupId).toBe(plan.backupId);
        expect(record.backupVerified).toBe(plan.backupVerified);
        expect(record.startupAllowed).toBe(plan.startupAllowed);
        expect(record.newAttemptAllowed).toBe(plan.newAttemptAllowed);
        expect(record.manualActionRequired).toBe(plan.manualActionRequired);
        expect(record.safeReasonCode).toBe(plan.safeReasonCode);
      });

      it('resolution sidecar contains one record and is newline terminated', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.reconciler.apply(plan);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const content = readFileSync(sidecarPath, 'utf8');
        expect(content.endsWith('\n')).toBe(true);
        expect(content.split('\n').filter((line) => line.length > 0).length).toBe(1);
      });

      it('resolution sidecar checksum validates', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.reconciler.apply(plan);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const record = JSON.parse(readFileSync(sidecarPath, 'utf8').trim());
        expect(record.checksum).toMatch(/^[0-9a-f]{64}$/);
        const { checksum, ...rest } = record;
        expect(createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex')).toBe(
          checksum,
        );
      });
    });

    describe('reinspection and stale plans', () => {
      it('returns STALE_PLAN when the attempt changes after inspection', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.journal.markFailed(attemptId, { code: 'TEST_FAILURE', message: 'Test failure' });
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('STALE_PLAN');
        if (result.status === 'STALE_PLAN') {
          expect(result.attemptId).toBe(attemptId);
          expect(result.expectedPlanFingerprint).toBe(plan.planFingerprint);
          expect(result.currentInspectionStatus).toBe('SAFE_PLAN');
          expect(result.manualActionRequired).toBe(false);
        }
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN when the database userVersion and history change after inspection', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        expect(plan.disposition).toBe('COMMIT_CONFIRMED_FROM_DATABASE');
        const db = new DatabaseSync(fx.dbPath);
        db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run('m-1-2');
        db.exec('PRAGMA user_version = 1');
        db.close();
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN when database history rows change after inspection', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 1,
            withHistory: true,
            historyRows: historyUpTo(1),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        expect(plan.disposition).toBe('TRANSACTION_ROLLED_BACK');
        const db = new DatabaseSync(fx.dbPath);
        historyRow(db, {
          migration_id: 'm-1-2',
          from_version: 1,
          to_version: 2,
          checksum: CHECKSUM_B,
        });
        db.exec('PRAGMA user_version = 2');
        db.close();
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN or BLOCKED when backup evidence changes after inspection', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        unlinkSync(path.join(fx.dataRoot, 'backups', 'bk-test'));
        const result = await fx.reconciler.apply(plan);
        expect(['STALE_PLAN', 'BLOCKED']).toContain(result.status);
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN when fresh inspect becomes NO_ACTION_REQUIRED', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 3,
            withHistory: true,
            historyRows: historyUpTo(3),
            targetVersion: 3,
          }),
        );
        const attemptId = await createAttemptWithStates(fx.journal, committedStates(3, true), 0, 3);
        const forgedPlan = {
          attemptId,
          disposition: 'SAFE_PRE_TRANSACTION_RETRY',
          planFingerprint: FINGERPRINT_A,
          attemptLatestChecksum: FINGERPRINT_A,
          observedUserVersion: 0,
          observedHistoryFingerprint: FINGERPRINT_A,
          observedCompletedMigrationIds: [],
          backupVerified: false,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forgedPlan);
        expect(result.status).toBe('STALE_PLAN');
        if (result.status === 'STALE_PLAN') {
          expect(result.currentInspectionStatus).toBe('NO_ACTION_REQUIRED');
        }
      });

      it('returns BLOCKED when fresh inspect becomes BLOCKED', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 4 }));
        const attemptId = await createAttemptWithStates(
          fx.journal,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const forgedPlan = {
          attemptId,
          disposition: 'SAFE_PRE_TRANSACTION_RETRY',
          planFingerprint: FINGERPRINT_A,
          attemptLatestChecksum: FINGERPRINT_A,
          observedUserVersion: 0,
          observedHistoryFingerprint: FINGERPRINT_A,
          observedCompletedMigrationIds: [],
          backupVerified: false,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forgedPlan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.manualActionRequired).toBe(true);
          expect(result).not.toHaveProperty('plan');
        }
      });

      it.each([
        { field: 'disposition', value: 'TRANSACTION_ROLLED_BACK' },
        { field: 'planFingerprint', value: 'b'.repeat(64) },
        { field: 'attemptLatestChecksum', value: 'b'.repeat(64) },
        { field: 'observedUserVersion', value: 99 },
        { field: 'observedHistoryFingerprint', value: 'b'.repeat(64) },
        { field: 'observedCompletedMigrationIds', value: ['m-0-1'] },
        { field: 'observedCurrentMigrationId', value: 'm-0-1' },
        { field: 'backupId', value: 'bk-other' },
        { field: 'backupVerified', value: true },
        { field: 'startupAllowed', value: true },
        { field: 'newAttemptAllowed', value: false },
        { field: 'safeReasonCode', value: 'OTHER_REASON' },
      ])('returns STALE_PLAN when $field differs', async ({ field, value }) => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const mutated = mutationOfPlan(
          plan,
          field as keyof import('./InterruptedMigrationReconciler').ReconciliationPlan,
          value,
        );
        const result = await fx.reconciler.apply(mutated);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('caller-object mutation after apply starts cannot alter persisted data', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const originalFingerprint = plan.planFingerprint;
        const planCopy = { ...plan };
        const promise = fx.reconciler.apply(planCopy);
        (planCopy as unknown as Record<string, unknown>).planFingerprint = 'z'.repeat(64);
        const result = await promise;
        expect(result.status).toBe('APPLIED');
        if (result.status === 'APPLIED') {
          expect(result.planFingerprint).toBe(originalFingerprint);
        }
        const sidecar = JSON.parse(
          readFileSync(
            path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl'),
            'utf8',
          ).trim(),
        );
        expect(sidecar.planFingerprint).toBe(originalFingerprint);
      });

      it('apply uses the fresh plan, not the caller object', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const stale = mutationOfPlan(plan, 'observedUserVersion', 99);
        const result = await fx.reconciler.apply(stale);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });
      it('returns STALE_PLAN when the caller planFingerprint differs from the fresh plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const forged = mutationOfPlan(plan, 'planFingerprint', 'd'.repeat(64));
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN when the caller mutates the completed-ID array but keeps the stale fingerprint', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        const forged = {
          ...plan,
          observedCompletedMigrationIds: [...plan.observedCompletedMigrationIds, 'm-2-3'],
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('returns STALE_PLAN when the caller supplies a valid-looking new fingerprint for a mutated plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const forged = {
          ...plan,
          planFingerprint: 'e'.repeat(64),
          observedUserVersion: 5,
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });
    });

    describe('existing resolution', () => {
      it('returns ALREADY_RESOLVED for an identical effective resolution', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const first = await fx.reconciler.apply(plan);
        expect(first.status).toBe('APPLIED');
        const second = await fx.reconciler.apply(plan);
        expect(second.status).toBe('ALREADY_RESOLVED');
        if (second.status === 'ALREADY_RESOLVED') {
          expect(second.attemptId).toBe(attemptId);
          expect(second.disposition).toBe(plan.disposition);
          expect(second.planFingerprint).toBe(plan.planFingerprint);
        }
      });

      it('leaves the sidecar byte-identical on a repeated apply', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.reconciler.apply(plan);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const before = readFileSync(sidecarPath);
        await fx.reconciler.apply(plan);
        const after = readFileSync(sidecarPath);
        expect(Buffer.compare(before, after)).toBe(0);
      });

      it('returns BLOCKED for an effective resolution with a different fingerprint', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const forgedInput: MigrationResolutionInput = {
          ...plan,
          planFingerprint: 'b'.repeat(64),
        };
        await fx.journal.appendResolution(attemptId, forgedInput);
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
          expect(result.manualActionRequired).toBe(true);
        }
      });

      it('returns BLOCKED for a stale existing resolution', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.reconciler.apply(plan);
        await fx.journal.markFailed(attemptId, { code: 'TEST_FAILURE', message: 'Test failure' });
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('STALE_EXISTING_RESOLUTION');
        }
      });

      it('returns BLOCKED for a corrupt existing resolution', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const attemptId = await createAttemptWithStates(
          fx.journal,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        writeFileSync(
          path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl'),
          'not valid json',
          'utf8',
        );
        const forgedPlan = {
          attemptId,
          disposition: 'SAFE_PRE_TRANSACTION_RETRY',
          planFingerprint: FINGERPRINT_A,
          attemptLatestChecksum: FINGERPRINT_A,
          observedUserVersion: 0,
          observedHistoryFingerprint: FINGERPRINT_A,
          observedCompletedMigrationIds: [],
          backupVerified: false,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forgedPlan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('CORRUPT_EXISTING_RESOLUTION');
        }
      });

      it('returns BLOCKED when the existing resolution has a different disposition but same fingerprint', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        await fx.reconciler.apply(plan);
        const forged = mutationOfPlan(plan, 'disposition', 'TRANSACTION_ROLLED_BACK');
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
        }
      });

      it('returns BLOCKED when the existing resolution has a different flag but same fingerprint', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        await fx.reconciler.apply(plan);
        const forged = mutationOfPlan(plan, 'newAttemptAllowed', false);
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
        }
      });

      it('returns BLOCKED when the existing resolution has the same fingerprint but different observed values', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        await fx.reconciler.apply(plan);
        const forged = mutationOfPlan(plan, 'safeReasonCode', 'DIFFERENT_REASON');
        const result = await fx.reconciler.apply(forged);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
        }
      });
    });

    describe('input validation', () => {
      const basePlan = {
        attemptId: 'att-valid-0000',
        disposition: 'SAFE_PRE_TRANSACTION_RETRY' as const,
        planFingerprint: FINGERPRINT_A,
        attemptLatestChecksum: FINGERPRINT_A,
        observedUserVersion: 0,
        observedHistoryFingerprint: FINGERPRINT_A,
        observedCompletedMigrationIds: [] as string[],
        backupVerified: false,
        startupAllowed: false,
        newAttemptAllowed: true,
        manualActionRequired: false,
        safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
      };

      it('rejects an invalid attemptId', async () => {
        const plan = {
          ...basePlan,
          attemptId: '',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects an invalid planFingerprint', async () => {
        const plan = {
          ...basePlan,
          planFingerprint: 'not-hex',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects an invalid attemptLatestChecksum', async () => {
        const plan = {
          ...basePlan,
          attemptLatestChecksum: 'short',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects an invalid history fingerprint', async () => {
        const plan = {
          ...basePlan,
          observedHistoryFingerprint: 'bad',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects duplicate completed migration IDs', async () => {
        const plan = {
          ...basePlan,
          observedCompletedMigrationIds: ['m-0-1', 'm-0-1'],
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects path-like strings', async () => {
        const plan = {
          ...basePlan,
          backupId: 'C:/secret',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects an unsupported disposition', async () => {
        const plan = {
          ...basePlan,
          disposition: 'UNKNOWN',
        } as unknown as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });

      it('rejects a negative or non-integer observed version', async () => {
        const plan = {
          ...basePlan,
          observedUserVersion: -1,
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
      });
    });

    describe('application result privacy and immutability', () => {
      it('returns deeply immutable results', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const result = await fx.reconciler.apply(plan);
        expect(Object.isFrozen(result)).toBe(true);
        expect(() => {
          (result as unknown as Record<string, unknown>).status = 'BLOCKED';
        }).toThrow();
      });

      it('does not leak absolute paths in results', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const result = await fx.reconciler.apply(plan);
        const json = JSON.stringify(result);
        expect(json).not.toContain(fx.dataRoot.split('\\').join('/'));
        expect(json).not.toContain(fx.dbPath.split('\\').join('/'));
      });

      it('does not expose Error, SQL, or stack in results', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const result = await fx.reconciler.apply(plan);
        expect(JSON.stringify(result)).not.toContain('Error');
        expect(JSON.stringify(result)).not.toContain('stack');
        expect(JSON.stringify(result)).not.toContain('SQL');
      });

      it('BLOCKED result contains no plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 4 }));
        const attemptId = await createAttemptWithStates(
          fx.journal,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const forgedPlan = {
          attemptId,
          disposition: 'SAFE_PRE_TRANSACTION_RETRY',
          planFingerprint: FINGERPRINT_A,
          attemptLatestChecksum: FINGERPRINT_A,
          observedUserVersion: 0,
          observedHistoryFingerprint: FINGERPRINT_A,
          observedCompletedMigrationIds: [],
          backupVerified: false,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
        } as import('./InterruptedMigrationReconciler').ReconciliationPlan;
        const result = await fx.reconciler.apply(forgedPlan);
        expect(result.status).toBe('BLOCKED');
        expect(result).not.toHaveProperty('plan');
      });

      it('STALE_PLAN result contains no plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const stale = mutationOfPlan(plan, 'observedUserVersion', 99);
        const result = await fx.reconciler.apply(stale);
        expect(result.status).toBe('STALE_PLAN');
        expect(result).not.toHaveProperty('plan');
      });
    });
  });

  describe('apply() - failures, concurrency, and read-only boundaries', () => {
    describe('append failure handling', () => {
      it('maps STALE_RESOLUTION_PLAN to STALE_PLAN', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        vi.spyOn(fx.journal, 'appendResolution').mockRejectedValueOnce(
          new PersistentMigrationJournalError('STALE_RESOLUTION_PLAN', 'The attempt changed.'),
        );
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('STALE_PLAN');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('throws on a resolution write failure and does not retry', async () => {
        let calls = 0;
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 0,
            journalWriteHooks: {
              beforeResolutionFirstWrite: async () => {
                calls++;
                throw new Error('Simulated write failure');
              },
            },
          }),
        );
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
        expect(calls).toBe(1);
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('throws on a resolution fsync failure and does not retry', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 0,
            journalWriteHooks: {
              afterResolutionWriteBeforeSync: async () => {
                throw new Error('Simulated fsync failure');
              },
            },
          }),
        );
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });

      it('throws on a resolution read-verification failure and does not retry', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 0,
            journalWriteHooks: {
              afterResolutionCloseBeforeVerify: async (attemptId) => {
                writeFileSync(
                  path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl'),
                  'corrupt',
                  'utf8',
                );
              },
            },
          }),
        );
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        expect(existsSync(sidecarPath)).toBe(true);
        expect(readFileSync(sidecarPath, 'utf8')).toBe('corrupt');
      });

      it('throws on an unknown append error', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        vi.spyOn(fx.journal, 'appendResolution').mockRejectedValueOnce(new Error('Unknown boom'));
        await expect(fx.reconciler.apply(plan)).rejects.toThrow('Unknown boom');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(false);
      });

      it('does not poison the apply queue after a thrown error', async () => {
        let calls = 0;
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 0,
            journalWriteHooks: {
              beforeResolutionFirstWrite: async () => {
                if (++calls === 1) {
                  throw new Error('First write fails');
                }
              },
            },
          }),
        );
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('APPLIED');
        expect(
          existsSync(path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl')),
        ).toBe(true);
      });
    });

    describe('RESOLUTION_ALREADY_EXISTS race handling', () => {
      it('returns ALREADY_RESOLVED when append races with the same plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.journal.appendResolution(attemptId, { ...plan });
        vi.spyOn(fx.journal, 'appendResolution').mockRejectedValueOnce(
          new PersistentMigrationJournalError('RESOLUTION_ALREADY_EXISTS', 'exists'),
        );
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('ALREADY_RESOLVED');
      });

      it('returns BLOCKED when append races with a different plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.journal.appendResolution(attemptId, { ...plan, planFingerprint: 'b'.repeat(64) });
        vi.spyOn(fx.journal, 'appendResolution').mockRejectedValueOnce(
          new PersistentMigrationJournalError('RESOLUTION_ALREADY_EXISTS', 'exists'),
        );
        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
        }
      });

      it('returns ALREADY_RESOLVED when an actual EEXIST race occurs with the same plan', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 0,
          }),
        );
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        // Create a valid sidecar by applying once.
        await fx.reconciler.apply(plan);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const sidecarBytes = readFileSync(sidecarPath);
        // Remove the sidecar so inspect() sees SAFE_PLAN.
        unlinkSync(sidecarPath);

        // Mock appendResolution to recreate the sidecar from the saved bytes, then throw
        // RESOLUTION_ALREADY_EXISTS. This simulates another process creating the sidecar
        // between the Reconciler's reinspection and the append attempt.
        vi.spyOn(fx.journal, 'appendResolution').mockImplementation(async () => {
          writeFileSync(sidecarPath, sidecarBytes);
          throw new PersistentMigrationJournalError('RESOLUTION_ALREADY_EXISTS', 'Race');
        });

        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('ALREADY_RESOLVED');
        if (result.status === 'ALREADY_RESOLVED') {
          expect(result.planFingerprint).toBe(plan.planFingerprint);
        }
      });

      it('returns BLOCKED when an actual EEXIST race occurs with a different plan', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        // Create a valid sidecar with a different planFingerprint.
        const differentInput: MigrationResolutionInput = {
          ...plan,
          planFingerprint: 'b'.repeat(64),
        };
        await fx.journal.appendResolution(attemptId, differentInput);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const sidecarBytes = readFileSync(sidecarPath);
        // Remove the sidecar so inspect() sees SAFE_PLAN.
        unlinkSync(sidecarPath);

        // Mock appendResolution to recreate the different sidecar, simulating a race.
        vi.spyOn(fx.journal, 'appendResolution').mockImplementation(async () => {
          writeFileSync(sidecarPath, sidecarBytes);
          throw new PersistentMigrationJournalError('RESOLUTION_ALREADY_EXISTS', 'Race');
        });

        const result = await fx.reconciler.apply(plan);
        expect(result.status).toBe('BLOCKED');
        if (result.status === 'BLOCKED') {
          expect(result.safeReasonCode).toBe('DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS');
        }
      });
    });

    describe('post-write verification', () => {
      it('never reports APPLIED when post-write inspection is not effective', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        let calls = 0;
        const original = fx.journal.inspectAttemptResolution.bind(fx.journal);
        vi.spyOn(fx.journal, 'inspectAttemptResolution').mockImplementation(async (id) => {
          calls++;
          if (calls === 2) {
            return {
              attemptId: id,
              classification: 'terminal-success',
              effectiveResolutionStatus: 'STALE',
              newAttemptAllowed: false,
              startupAllowed: false,
              manualActionRequired: true,
            } as AttemptResolutionInspection;
          }
          return original(id);
        });
        await expect(fx.reconciler.apply(plan)).rejects.toThrow();
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        expect(existsSync(sidecarPath)).toBe(true);
      });
    });

    describe('idempotency and concurrency', () => {
      it('first apply APPLIED, second apply ALREADY_RESOLVED', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const first = await fx.reconciler.apply(plan);
        expect(first.status).toBe('APPLIED');
        const second = await fx.reconciler.apply(plan);
        expect(second.status).toBe('ALREADY_RESOLVED');
      });

      it('second apply leaves the sidecar byte-identical', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        await fx.reconciler.apply(plan);
        const sidecarPath = path.join(fx.dataRoot, 'journals', attemptId + '.resolution.jsonl');
        const before = readFileSync(sidecarPath);
        await fx.reconciler.apply(plan);
        const after = readFileSync(sidecarPath);
        expect(Buffer.compare(before, after)).toBe(0);
      });

      it('two concurrent same-plan applies produce one APPLIED and one ALREADY_RESOLVED', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const [a, b] = await Promise.all([fx.reconciler.apply(plan), fx.reconciler.apply(plan)]);
        const statuses = new Set([a.status, b.status]);
        expect(statuses.has('APPLIED')).toBe(true);
        expect(statuses.has('ALREADY_RESOLVED')).toBe(true);
      });

      it('two concurrent different-plan applies cannot both succeed', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { plan } = await safePlanFromFixture(fx, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const other = mutationOfPlan(plan, 'observedUserVersion', 99);
        const [a, b] = await Promise.all([fx.reconciler.apply(plan), fx.reconciler.apply(other)]);
        expect(a.status === 'APPLIED' && b.status === 'APPLIED').toBe(false);
      });

      it('different attempts remain independent under concurrent apply', async () => {
        const fxA = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const fxB = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const a = await safePlanFromFixture(fxA, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const b = await safePlanFromFixture(fxB, [{ state: 'PREFLIGHT_VALIDATED' }], 0, 3);
        const [ra, rb] = await Promise.all([
          fxA.reconciler.apply(a.plan),
          fxB.reconciler.apply(b.plan),
        ]);
        expect(ra.status).toBe('APPLIED');
        expect(rb.status).toBe('APPLIED');
      });
    });

    describe('read-only boundaries', () => {
      it('leaves the original attempt, database, and backup byte-identical', async () => {
        const fx = trackFixture(
          makeReconcilerFixture({
            dbVersion: 2,
            withHistory: true,
            historyRows: historyUpTo(2),
            useRealBackupFile: true,
          }),
        );
        createBackupFile(fx, 'bk-test');
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [...committedStates(1, false), startedState(2)],
          0,
          3,
        );
        const beforeDb = readFileSync(fx.dbPath);
        const attemptPath = path.join(fx.dataRoot, 'journals', attemptId + '.jsonl');
        const beforeAttempt = readFileSync(attemptPath);
        const backupPath = path.join(fx.dataRoot, 'backups', 'bk-test');
        const beforeBackup = readFileSync(backupPath);
        await fx.reconciler.apply(plan);
        expect(Buffer.compare(beforeDb, readFileSync(fx.dbPath))).toBe(0);
        expect(Buffer.compare(beforeAttempt, readFileSync(attemptPath))).toBe(0);
        expect(Buffer.compare(beforeBackup, readFileSync(backupPath))).toBe(0);
      });

      it('does not invoke createAttempt, transition, or markFailed', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const createAttemptSpy = vi.spyOn(fx.journal, 'createAttempt');
        const transitionSpy = vi.spyOn(fx.journal, 'transition');
        const markFailedSpy = vi.spyOn(fx.journal, 'markFailed');
        await fx.reconciler.apply(plan);
        expect(createAttemptSpy).not.toHaveBeenCalled();
        expect(transitionSpy).not.toHaveBeenCalledWith(
          attemptId,
          expect.any(String),
          expect.anything(),
        );
        expect(markFailedSpy).not.toHaveBeenCalledWith(attemptId, expect.anything());
      });

      it('creates only the resolution sidecar and leaves other journal entries unchanged', async () => {
        const fx = trackFixture(makeReconcilerFixture({ dbVersion: 0 }));
        const { attemptId, plan } = await safePlanFromFixture(
          fx,
          [{ state: 'PREFLIGHT_VALIDATED' }],
          0,
          3,
        );
        const beforeEntries = readdirSync(path.join(fx.dataRoot, 'journals')).slice().sort();
        await fx.reconciler.apply(plan);
        const afterEntries = readdirSync(path.join(fx.dataRoot, 'journals')).slice().sort();
        expect(afterEntries.length).toBe(beforeEntries.length + 1);
        expect(afterEntries).toContain(attemptId + '.resolution.jsonl');
      });
    });
  });
});
