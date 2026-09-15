/**
 * P2.6B1 workflow-history + Revision Cycle persistence reality gate.
 *
 * Proves the transaction-neutral store primitives against the committed V2
 * schema:
 * - insert/get/list transitions and cycles
 * - deterministic ordering (sequence / cycle_number)
 * - duplicate transitionId / duplicate project sequence rejection
 * - getOpenRevisionCycle
 * - lifecycle-row update primitive (Open -> workStarted -> ReturnedToClient,
 *   and Open -> Cancelled)
 * - B1 methods do NOT commit independently (ROLLBACK leaves no rows;
 *   COMMIT persists rows)
 * - legacy projects with zero history/cycles return []
 * - close/reopen preserves committed rows
 * - ProjectActivity / Project.revisionNumber storage untouched
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import { loadConfig, type AppConfig } from '@scli/config';
import { PersonalWorkspaceStore } from './personal-workspace-store';
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
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';
import type { RevisionCycle, WorkflowTransitionRecord } from '@scli/domain';

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
const openStores: Array<{ close(): void }> = [];

afterEach(() => {
  while (openStores.length) {
    const store = openStores.pop();
    if (store) {
      try {
        store.close();
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-p26b1-'));
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
    return { backupId: 'bk-p26b1-0001' };
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
    return { attemptId: 'att-p26b1-0001' };
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

function openDb(p: string): DatabaseSyncInstance {
  const db = new DatabaseSync(p);
  openHandles.push(db);
  return db;
}

/** Creates a migrated V2 database and returns an owned store over it. */
async function makeMigratedStore(dir: string, p = dbPathIn(dir)): Promise<PersonalWorkspaceStore> {
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
  const store = new PersonalWorkspaceStore(makeConfig(dir, p));
  openStores.push(store);
  return store;
}

/**
 * Creates a migrated V2 database and a store over an INJECTED shared
 * connection. B2 owns the outer transaction on that shared connection, so the
 * test returns both so it can BEGIN/COMMIT/ROLLBACK on the SAME handle the
 * store writes through.
 */
async function makeMigratedStoreWithSharedDb(
  dir: string,
  p = dbPathIn(dir),
): Promise<{ store: PersonalWorkspaceStore; db: DatabaseSyncInstance }> {
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
  const db = openDb(p);
  const store = new PersonalWorkspaceStore(makeConfig(dir, p), undefined, db);
  openStores.push(store);
  return { store, db };
}

function transitionRowCount(db: DatabaseSyncInstance, projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM workflow_transitions WHERE project_id = ?')
    .get(projectId) as { count: number };
  return Number(row.count);
}

function cycleRowCount(db: DatabaseSyncInstance, projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM revision_cycles WHERE project_id = ?')
    .get(projectId) as { count: number };
  return Number(row.count);
}

// Canonical test fixtures.
const PROJECT_P = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROJECT_Q = 'bbbbbbbb-0000-4000-8000-000000000002';
const T1 = '11111111-0000-4000-8000-000000000001';
const T2 = '22222222-0000-4000-8000-000000000002';
const T3 = '33333333-0000-4000-8000-000000000003';
const T4 = '44444444-0000-4000-8000-000000000004';
const C1 = '55555555-0000-4000-8000-000000000001';
const C2 = '66666666-0000-4000-8000-000000000002';
const C3 = '77777777-0000-4000-8000-000000000003';

const transition = (
  transitionId: string,
  projectId: string,
  sequence: number,
  fromStatus: WorkflowTransitionRecord['fromStatus'],
  toStatus: WorkflowTransitionRecord['toStatus'],
  occurredAt: string,
  reason: string | null = null,
  revisionCycleId: string | null = null,
): WorkflowTransitionRecord => ({
  transitionId,
  projectId,
  sequence,
  fromStatus,
  toStatus,
  occurredAt,
  actorId: null,
  reason,
  revisionCycleId,
});

const openCycle = (
  revisionCycleId: string,
  projectId: string,
  cycleNumber: number,
  openedAt: string,
  openedByTransitionId: string,
  feedbackSummary: string,
): RevisionCycle => ({
  revisionCycleId,
  projectId,
  cycleNumber,
  status: 'Open',
  openedAt,
  openedByTransitionId,
  feedbackSummary,
  workStartedAt: null,
  returnedToClientAt: null,
  cancelledAt: null,
});

describe('P2.6B1 workflow history + revision cycle persistence', () => {
  it('insert/get/list a WorkflowTransitionRecord', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    const record = transition(
      T1,
      PROJECT_P,
      1,
      'Planning',
      'InProgress',
      '2026-08-01T08:00:00.000Z',
    );
    expect(store.insertWorkflowTransition(record)).toEqual(record);
    expect(store.getWorkflowTransition(T1)).toEqual(record);
    expect(store.listWorkflowTransitions(PROJECT_P)).toEqual([record]);
  });

  it('lists transitions in ascending sequence order with no cross-project leakage', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T2, PROJECT_P, 2, 'InProgress', 'ClientReview', '2026-08-01T09:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T3, PROJECT_Q, 1, 'Planning', 'InProgress', '2026-08-01T10:00:00.000Z'),
    );
    const pTransitions = store.listWorkflowTransitions(PROJECT_P);
    expect(pTransitions.map((t) => t.transitionId)).toEqual([T1, T2]);
    expect(pTransitions.map((t) => t.sequence)).toEqual([1, 2]);
    expect(store.listWorkflowTransitions(PROJECT_Q).map((t) => t.transitionId)).toEqual([T3]);
  });

  it('rejects a duplicate transitionId', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    expect(() =>
      store.insertWorkflowTransition(
        transition(T1, PROJECT_P, 2, 'InProgress', 'ClientReview', '2026-08-01T09:00:00.000Z'),
      ),
    ).toThrow();
  });

  it('rejects a duplicate sequence within the same project but allows it across projects', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    // Same project + same sequence.
    expect(() =>
      store.insertWorkflowTransition(
        transition(T2, PROJECT_P, 1, 'InProgress', 'ClientReview', '2026-08-01T09:00:00.000Z'),
      ),
    ).toThrow();
    // Different project + same sequence allowed.
    expect(() =>
      store.insertWorkflowTransition(
        transition(T3, PROJECT_Q, 1, 'Planning', 'InProgress', '2026-08-01T10:00:00.000Z'),
      ),
    ).not.toThrow();
  });

  it('round-trips nullable actorId/reason/revisionCycleId on transitions', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    const withNulls = transition(
      T1,
      PROJECT_P,
      1,
      'Planning',
      'InProgress',
      '2026-08-01T08:00:00.000Z',
    );
    store.insertWorkflowTransition(withNulls);
    expect(store.getWorkflowTransition(T1)).toEqual(withNulls);
    const withCycle = transition(
      T2,
      PROJECT_P,
      2,
      'ClientReview',
      'RevisionRequired',
      '2026-08-01T11:00:00.000Z',
      'Client requested changes.',
      C1,
    );
    store.insertWorkflowTransition(withCycle);
    const loaded = store.getWorkflowTransition(T2)!;
    expect(loaded.reason).toBe('Client requested changes.');
    expect(loaded.revisionCycleId).toBe(C1);
  });

  it('insert/get/list a RevisionCycle', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    const cycle = openCycle(
      C1,
      PROJECT_P,
      1,
      '2026-08-01T08:30:00.000Z',
      T3,
      'Client requested lighting revisions.',
    );
    expect(store.insertRevisionCycle(cycle)).toEqual(cycle);
    expect(store.getRevisionCycle(C1)).toEqual(cycle);
    expect(store.listRevisionCycles(PROJECT_P)).toEqual([cycle]);
  });

  it('lists cycles deterministically by cycleNumber with no cross-project leakage', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T4, PROJECT_P, 2, 'RevisionRequired', 'InProgress', '2026-08-02T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T1, PROJECT_Q, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    // Cycle 1 for P (opened), cycle 2 for P (after 1 returned), cycle 1 for Q.
    const c1 = openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.');
    store.insertRevisionCycle(c1);
    store.persistRevisionCycleLifecycle({
      ...c1,
      status: 'ReturnedToClient',
      workStartedAt: '2026-08-02T08:00:00.000Z',
      returnedToClientAt: '2026-08-03T08:00:00.000Z',
    });
    const c2 = {
      ...openCycle(C2, PROJECT_P, 2, '2026-08-03T08:00:00.000Z', T4, 'Second feedback.'),
    };
    const q1 = openCycle(C3, PROJECT_Q, 1, '2026-08-01T08:30:00.000Z', T1, 'Q feedback.');
    store.insertRevisionCycle(c2);
    store.insertRevisionCycle(q1);
    expect(store.listRevisionCycles(PROJECT_P).map((c) => c.cycleNumber)).toEqual([1, 2]);
    expect(store.listRevisionCycles(PROJECT_Q).map((c) => c.revisionCycleId)).toEqual([C3]);
  });

  it('getOpenRevisionCycle returns the Open cycle and null when none open', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    expect(store.getOpenRevisionCycle(PROJECT_P)).toBeNull();
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    const cycle = openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.');
    store.insertRevisionCycle(cycle);
    expect(store.getOpenRevisionCycle(PROJECT_P)?.revisionCycleId).toBe(C1);
  });

  it('SQLite one-open-cycle invariant still rejects a second Open cycle', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T4, PROJECT_P, 2, 'RevisionRequired', 'InProgress', '2026-08-02T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
    );
    expect(() =>
      store.insertRevisionCycle(
        openCycle(C2, PROJECT_P, 2, '2026-08-02T09:00:00.000Z', T4, 'Second feedback.'),
      ),
    ).toThrow();
  });

  it('lifecycle update primitive persists an Open -> workStarted -> ReturnedToClient row', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
    );
    // Open -> work started.
    const started: RevisionCycle = {
      ...openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
      workStartedAt: '2026-08-02T08:00:00.000Z',
    };
    store.persistRevisionCycleLifecycle(started);
    expect(store.getRevisionCycle(C1)?.workStartedAt).toBe('2026-08-02T08:00:00.000Z');
    // -> ReturnedToClient.
    const returned: RevisionCycle = {
      ...started,
      status: 'ReturnedToClient',
      returnedToClientAt: '2026-08-03T08:00:00.000Z',
    };
    store.persistRevisionCycleLifecycle(returned);
    const loaded = store.getRevisionCycle(C1)!;
    expect(loaded.status).toBe('ReturnedToClient');
    expect(loaded.workStartedAt).toBe('2026-08-02T08:00:00.000Z');
    expect(loaded.returnedToClientAt).toBe('2026-08-03T08:00:00.000Z');
    expect(loaded.cancelledAt).toBeNull();
  });

  it('lifecycle update primitive persists a valid Cancelled row', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
    );
    const cancelled: RevisionCycle = {
      ...openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
      status: 'Cancelled',
      cancelledAt: '2026-08-02T08:00:00.000Z',
    };
    store.persistRevisionCycleLifecycle(cancelled);
    const loaded = store.getRevisionCycle(C1)!;
    expect(loaded.status).toBe('Cancelled');
    expect(loaded.cancelledAt).toBe('2026-08-02T08:00:00.000Z');
    expect(loaded.returnedToClientAt).toBeNull();
  });

  it('fails closed on a corrupt persisted transition row instead of returning an unchecked cast', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const store = await makeMigratedStore(dir, p);
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    store.close();
    openStores.pop();
    const db = openDb(p);
    db.prepare('UPDATE workflow_transitions SET from_status = ? WHERE transition_id = ?').run(
      'NotARealStatus',
      T1,
    );
    db.close();
    const reopened = new PersonalWorkspaceStore(makeConfig(dir, p));
    openStores.push(reopened);
    expect(() => reopened.getWorkflowTransition(T1)).toThrow();
    expect(() => reopened.listWorkflowTransitions(PROJECT_P)).toThrow();
  });

  it('fails closed on a corrupt persisted revision cycle row', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    const store = await makeMigratedStore(dir, p);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
    );
    store.close();
    openStores.pop();
    const db = openDb(p);
    db.prepare('UPDATE revision_cycles SET opened_at = ? WHERE revision_cycle_id = ?').run(
      'not-a-timestamp',
      C1,
    );
    db.close();
    const reopened = new PersonalWorkspaceStore(makeConfig(dir, p));
    openStores.push(reopened);
    expect(() => reopened.getRevisionCycle(C1)).toThrow();
    expect(() => reopened.listRevisionCycles(PROJECT_P)).toThrow();
  });

  it('closed cycle representation reloads identically', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 1, 'ClientReview', 'RevisionRequired', '2026-08-01T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
    );
    const returned: RevisionCycle = {
      ...openCycle(C1, PROJECT_P, 1, '2026-08-01T08:30:00.000Z', T3, 'First feedback.'),
      status: 'ReturnedToClient',
      workStartedAt: '2026-08-02T08:00:00.000Z',
      returnedToClientAt: '2026-08-03T08:00:00.000Z',
    };
    store.persistRevisionCycleLifecycle(returned);
    expect(store.getRevisionCycle(C1)).toEqual(returned);
  });
});

describe('P2.6B1 transaction-neutrality', () => {
  it('B1 inserts do NOT commit independently: ROLLBACK leaves no rows', async () => {
    const dir = newTempDir();
    const { store, db } = await makeMigratedStoreWithSharedDb(dir);
    db.exec('BEGIN IMMEDIATE');
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 2, 'ClientReview', 'RevisionRequired', '2026-08-01T09:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T09:30:00.000Z', T3, 'First feedback.'),
    );
    db.exec('ROLLBACK');
    expect(transitionRowCount(db, PROJECT_P)).toBe(0);
    expect(cycleRowCount(db, PROJECT_P)).toBe(0);
  });

  it('B1 inserts persist after COMMIT', async () => {
    const dir = newTempDir();
    const { store, db } = await makeMigratedStoreWithSharedDb(dir);
    db.exec('BEGIN IMMEDIATE');
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 2, 'ClientReview', 'RevisionRequired', '2026-08-01T09:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T09:30:00.000Z', T3, 'First feedback.'),
    );
    db.exec('COMMIT');
    expect(transitionRowCount(db, PROJECT_P)).toBe(2);
    expect(cycleRowCount(db, PROJECT_P)).toBe(1);
  });
});

describe('P2.6B1 legacy / reload behavior', () => {
  it('old project with zero history/cycles returns [] without writing fabricated rows', async () => {
    const dir = newTempDir();
    const store = await makeMigratedStore(dir);
    // No transitions/cycles inserted for PROJECT_P.
    expect(store.listWorkflowTransitions(PROJECT_P)).toEqual([]);
    expect(store.listRevisionCycles(PROJECT_P)).toEqual([]);
    expect(store.getOpenRevisionCycle(PROJECT_P)).toBeNull();
    expect(store.getWorkflowTransition(T1)).toBeNull();
    expect(store.getRevisionCycle(C1)).toBeNull();
    // Nothing was written on read.
    const db = openDb(dbPathIn(dir));
    expect(transitionRowCount(db, PROJECT_P)).toBe(0);
    expect(cycleRowCount(db, PROJECT_P)).toBe(0);
  });

  it('close/reopen preserves transition records and revision cycles', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    let store = await makeMigratedStore(dir, p);
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    store.insertWorkflowTransition(
      transition(T3, PROJECT_P, 2, 'ClientReview', 'RevisionRequired', '2026-08-01T09:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C1, PROJECT_P, 1, '2026-08-01T09:30:00.000Z', T3, 'First feedback.'),
    );
    store.close();
    openStores.pop();

    store = new PersonalWorkspaceStore(makeConfig(dir, p));
    openStores.push(store);
    expect(store.listWorkflowTransitions(PROJECT_P).map((t) => t.transitionId)).toEqual([T1, T3]);
    expect(store.getRevisionCycle(C1)?.feedbackSummary).toBe('First feedback.');
  });
});

describe('P2.6B1 reality walkthrough', () => {
  it('A-I) inserts, lifecycle, cross-project cycles, and transaction semantics through the real store', async () => {
    const dir = newTempDir();
    const p = dbPathIn(dir);
    // Use an injected shared connection so the store writes and the B2-style
    // BEGIN/COMMIT/ROLLBACK run through the SAME handle (as production does).
    const { store, db } = await makeMigratedStoreWithSharedDb(dir, p);

    // A) Existing project with zero history/cycles.
    expect(store.listWorkflowTransitions(PROJECT_P)).toEqual([]);
    expect(store.listRevisionCycles(PROJECT_P)).toEqual([]);

    // B) T1 Planning -> InProgress.
    store.insertWorkflowTransition(
      transition(T1, PROJECT_P, 1, 'Planning', 'InProgress', '2026-08-01T08:00:00.000Z'),
    );
    // C) T2 InProgress -> ClientReview.
    store.insertWorkflowTransition(
      transition(T2, PROJECT_P, 2, 'InProgress', 'ClientReview', '2026-08-01T09:00:00.000Z'),
    );
    expect(store.listWorkflowTransitions(PROJECT_P).map((t) => t.transitionId)).toEqual([T1, T2]);

    // D) T3 ClientReview -> RevisionRequired, cycle C1.
    store.insertWorkflowTransition(
      transition(
        T3,
        PROJECT_P,
        3,
        'ClientReview',
        'RevisionRequired',
        '2026-08-01T10:00:00.000Z',
        'Client requested lighting revisions.',
        C1,
      ),
    );
    const c1 = openCycle(
      C1,
      PROJECT_P,
      1,
      '2026-08-01T10:30:00.000Z',
      T3,
      'Client requested lighting revisions.',
    );
    store.insertRevisionCycle(c1);
    const t3Loaded = store.getWorkflowTransition(T3)!;
    expect(t3Loaded.revisionCycleId).toBe(C1);
    expect(t3Loaded.reason).toBe('Client requested lighting revisions.');
    expect(store.getRevisionCycle(C1)).toEqual(c1);

    // E) C1 lifecycle: workStarted -> ReturnedToClient.
    const started: RevisionCycle = { ...c1, workStartedAt: '2026-08-02T08:00:00.000Z' };
    store.persistRevisionCycleLifecycle(started);
    const returned: RevisionCycle = {
      ...started,
      status: 'ReturnedToClient',
      returnedToClientAt: '2026-08-03T08:00:00.000Z',
    };
    store.persistRevisionCycleLifecycle(returned);
    expect(store.getRevisionCycle(C1)).toEqual(returned);

    // F) C2 allowed after C1 returned; second simultaneous Open cycle rejected.
    store.insertWorkflowTransition(
      transition(T4, PROJECT_P, 4, 'RevisionRequired', 'InProgress', '2026-08-02T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C2, PROJECT_P, 2, '2026-08-04T08:00:00.000Z', T4, 'Second feedback.'),
    );
    expect(store.getOpenRevisionCycle(PROJECT_P)?.revisionCycleId).toBe(C2);
    expect(() =>
      store.insertRevisionCycle(
        openCycle(C3, PROJECT_P, 3, '2026-08-04T09:00:00.000Z', T4, 'Third feedback.'),
      ),
    ).toThrow();

    // G) BEGIN + insert TQ-like + C3 + ROLLBACK => neither persists.
    const TQ = '88888888-0000-4000-8000-000000000009';
    db.exec('BEGIN IMMEDIATE');
    store.insertWorkflowTransition(
      transition(TQ, PROJECT_Q, 1, 'Planning', 'InProgress', '2026-08-05T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C3, PROJECT_Q, 1, '2026-08-05T08:30:00.000Z', TQ, 'Q feedback.'),
    );
    db.exec('ROLLBACK');
    expect(store.getWorkflowTransition(TQ)).toBeNull();
    expect(store.listRevisionCycles(PROJECT_Q)).toEqual([]);

    // H) BEGIN + insert + COMMIT => both persist.
    db.exec('BEGIN IMMEDIATE');
    store.insertWorkflowTransition(
      transition(TQ, PROJECT_Q, 1, 'Planning', 'InProgress', '2026-08-05T08:00:00.000Z'),
    );
    store.insertRevisionCycle(
      openCycle(C3, PROJECT_Q, 1, '2026-08-05T08:30:00.000Z', TQ, 'Q feedback.'),
    );
    db.exec('COMMIT');
    expect(store.listWorkflowTransitions(PROJECT_Q).length).toBe(1);
    expect(store.listRevisionCycles(PROJECT_Q).length).toBe(1);

    // I) Close/reopen: all committed rows survive with exact IDs/order.
    store.close();
    openStores.pop();
    db.close();
    const reopened = new PersonalWorkspaceStore(makeConfig(dir, p));
    openStores.push(reopened);
    expect(reopened.listWorkflowTransitions(PROJECT_P).map((t) => t.transitionId)).toEqual([
      T1,
      T2,
      T3,
      T4,
    ]);
    expect(reopened.listRevisionCycles(PROJECT_P).map((c) => c.cycleNumber)).toEqual([1, 2]);
    expect(reopened.getRevisionCycle(C1)?.status).toBe('ReturnedToClient');
    expect(reopened.getRevisionCycle(C2)?.status).toBe('Open');
  });
});
