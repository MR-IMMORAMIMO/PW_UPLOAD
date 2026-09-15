/**
 * AUTO-01C — Capture Ledger State Machine (API/service reality gate).
 *
 * Proves the owner-locked capture lifecycle through the REAL service + store
 * authority (not only pure domain helpers):
 *   A. Happy path — DETECTED -> STABILIZING -> STAGED -> VERIFYING -> ADMITTED
 *      -> MATERIALIZING -> COMPLETED.
 *   B. Illegal skips — DETECTED->COMPLETED/ADMITTED, STAGED->COMPLETED,
 *      terminal states never advance.
 *   C. Degraded — UNRESOLVED / FAILED_RECOVERABLE / DISCARDED.
 *   D. Recovery — resume only via the dedicated operation; deterministic
 *      targets; attemptCount; milestone timestamps preserved.
 *   E. UNRESOLVED — no auto-advance; explicit resolve returns to VERIFYING.
 *   F. Completion invariants — finalArtifactId/finalVersionId required;
 *      same-project/same-artifact lineage enforced.
 *   G. Admission/materialization — ADMITTED requires the artifact identity;
 *      MATERIALIZING respects it.
 *   H. Context recovery — an already-DETECTED capture may recover even when
 *      its ToolContext later becomes EXPIRED; recovery never calls new-capture
 *      authorization; mismatched historical context fails truthfully.
 *   I. Terminal/audit — ledger rows survive COMPLETED/DISCARDED/CLOSED context.
 *   J. Attempts/errors — attemptCount semantics; failure reason persistence.
 *   K. AUTO-01B regression — EXPIRED cannot authorize a NEW capture; LIVE with
 *      exact capability still authorizes; Work Session remains irrelevant.
 *
 * No filesystem watcher, stabilization, staging, hashing, materialization,
 * ManagedArtifact admission pipeline, or recovery worker is exercised —
 * ManagedArtifact/ArtifactVersion rows are SEEDED only to prove the
 * final-lineage invariants.
 */

import { createHash, randomUUID } from 'node:crypto';
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
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
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

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const FIXED_BASE_MS = Date.parse('2026-08-20T09:00:00.000Z');
const T1 = new Date(FIXED_BASE_MS).toISOString();
const T2 = new Date(FIXED_BASE_MS + 1000).toISOString();
const T3 = new Date(FIXED_BASE_MS + 2000).toISOString();
const T4 = new Date(FIXED_BASE_MS + 3000).toISOString();

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

function sha256(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01c-'));
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
    return { backupId: 'bk-auto01c-0001' };
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
    return { attemptId: 'att-auto01c-0001' };
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
  contexts: ToolContextService;
  captures: CaptureLedgerService;
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
  const contexts = new ToolContextService(artifacts);
  const captures = new CaptureLedgerService(artifacts);
  return { db, artifacts, contexts, captures };
}

function createContext(
  h: Harness,
  projectId: string,
  tool = 'AutoCAD',
  channel = `autocad-${randomUUID()}`,
) {
  return h.contexts.open({
    projectId,
    tool,
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel,
    openedAt: T1,
  });
}

function detectCapture(projectId: string, toolContextId: string | null, sourcePath?: string) {
  return {
    projectId,
    toolContextId,
    sourcePath: sourcePath ?? 'C:/exports/Layout.pdf',
    sourceChannel: 'autocad-session-1',
    expectedArtifactType: 'LightingLayout',
    detectedAt: T1,
  };
}

function makeCapability(tool = 'AutoCAD', channel = 'autocad-chan'): CaptureCapability {
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

/** Seeds a ManagedArtifact + one ArtifactVersion in `projectId`. */
function seedArtifactAndVersion(harness: Harness, projectId: string) {
  const artifact = harness.artifacts.createManagedArtifact({
    projectId,
    artifactType: 'LightingLayout',
    sourceTool: 'AutoCAD',
    canonicalPath: 'WORKING/CAD/Layout.dwg',
  });
  const version = harness.artifacts.createArtifactVersion({
    artifactId: artifact.artifactId,
    version: 1,
    contentHash: sha256('layout-v1'),
    locatorValue: 'WORKING/CAD/Layout.dwg',
  });
  return { artifact, version };
}

/** Drives a capture to ADMITTED with the seeded artifact (skips verified steps). */
async function admitCapture(
  h: Harness,
  projectId: string,
  artifactId: string,
  toolContextId: string | null = null,
) {
  const created = h.captures.createDetectedCapture(detectCapture(projectId, toolContextId));
  h.captures.advance(created.captureId, T2);
  h.captures.advance(created.captureId, T3);
  h.captures.advance(created.captureId, T3);
  const admitted = h.captures.advance(created.captureId, T4, { finalArtifactId: artifactId });
  expect(admitted.entry.state).toBe('ADMITTED');
  return created.captureId;
}

describe('AUTO-01C Capture Ledger state machine', () => {
  describe('A. Happy path (service-level, real persistence)', () => {
    it('A1-A7: DETECTED -> STABILIZING -> STAGED -> VERIFYING -> ADMITTED -> MATERIALIZING -> COMPLETED', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId);
      const { artifact, version } = seedArtifactAndVersion(h, projectId);

      const created = h.captures.createDetectedCapture(detectCapture(projectId, ctx.toolContextId));
      expect(created.state).toBe('DETECTED');
      expect(created.attemptCount).toBe(0);
      expect(created.toolContextId).toBe(ctx.toolContextId);

      const stabilizing = h.captures.advance(created.captureId, T2);
      expect(stabilizing.entry.state).toBe('STABILIZING');
      expect(stabilizing.entry.detectedAt).toBe(T1);
      expect(stabilizing.entry.stagedAt).toBeNull();

      const staged = h.captures.advance(created.captureId, T3);
      expect(staged.entry.state).toBe('STAGED');
      expect(staged.entry.stagedAt).toBe(T3);

      const verifying = h.captures.advance(created.captureId, T3);
      expect(verifying.entry.state).toBe('VERIFYING');

      const admitted = h.captures.advance(created.captureId, T4, {
        finalArtifactId: artifact.artifactId,
      });
      expect(admitted.entry.state).toBe('ADMITTED');
      expect(admitted.entry.finalArtifactId).toBe(artifact.artifactId);
      expect(admitted.entry.finalVersionId).toBeNull();
      expect(admitted.entry.admittedAt).toBe(T4);

      const materializing = h.captures.advance(created.captureId, T4);
      expect(materializing.entry.state).toBe('MATERIALIZING');
      expect(materializing.entry.finalArtifactId).toBe(artifact.artifactId);

      const completed = h.captures.complete(
        created.captureId,
        artifact.artifactId,
        version.versionId,
        T4,
      );
      expect(completed.state).toBe('COMPLETED');
      expect(completed.finalArtifactId).toBe(artifact.artifactId);
      expect(completed.finalVersionId).toBe(version.versionId);
      expect(completed.completedAt).toBe(T4);

      // Persisted truth.
      const persisted = h.captures.get(created.captureId);
      expect(persisted.state).toBe('COMPLETED');
      expect(persisted.completedAt).toBe(T4);
    });
  });

  describe('B. Illegal skips / terminal safety', () => {
    it('B8-B10: DETECTED -> COMPLETED, DETECTED -> ADMITTED, STAGED -> COMPLETED rejected', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact } = seedArtifactAndVersion(h, projectId);
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));

      // DETECTED -> COMPLETED rejects (service refuses from a pre-terminal flow).
      expect(() => h.captures.complete(created.captureId, randomUUID(), randomUUID(), T2)).toThrow(
        DomainError,
      );

      // DETECTED -> ADMITTED is impossible: even supplying finalArtifactId early
      // advances exactly ONE step (STABILIZING), never to ADMITTED.
      const one = h.captures.advance(created.captureId, T2, {
        finalArtifactId: artifact.artifactId,
      });
      expect(one.entry.state).toBe('STABILIZING');
      const two = h.captures.advance(created.captureId, T3);
      expect(two.entry.state).toBe('STAGED');
      const three = h.captures.advance(created.captureId, T3);
      expect(three.entry.state).toBe('VERIFYING');

      // STAGED/VERIFYING -> COMPLETED rejects.
      expect(() => h.captures.complete(created.captureId, randomUUID(), randomUUID(), T3)).toThrow(
        DomainError,
      );
    });

    it('B11-B12: COMPLETED and DISCARDED never advance', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(() => h.captures.advance(captureId, T4)).toThrow(DomainError);
      expect(() => h.captures.markFailedRecoverable(captureId, 'x', T4)).toThrow(DomainError);
      expect(() => h.captures.discard(captureId, T4)).toThrow(DomainError);

      const other = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.discard(other.captureId, T2, 'no longer relevant');
      expect(h.captures.get(other.captureId).state).toBe('DISCARDED');
      expect(() => h.captures.advance(other.captureId, T2)).toThrow(DomainError);
      expect(() => h.captures.resolve(other.captureId, T2)).toThrow(DomainError);
      expect(() => h.captures.markUnresolved(other.captureId, 'x', T2)).toThrow(DomainError);
    });
  });

  describe('C. Degraded states', () => {
    it('C13: DETECTED -> UNRESOLVED and VERIFYING -> UNRESOLVED are legal with a reason', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const detected = h.captures.createDetectedCapture(detectCapture(projectId, null));
      const unresolved = h.captures.markUnresolved(detected.captureId, 'ambiguous source', T2);
      expect(unresolved.state).toBe('UNRESOLVED');
      expect(unresolved.error).toBe('ambiguous source');
      expect(() => h.captures.markUnresolved(detected.captureId, '', T2)).toThrow(DomainError);

      const other = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(other.captureId, T2);
      h.captures.advance(other.captureId, T3);
      h.captures.advance(other.captureId, T3);
      const verifyingUnresolved = h.captures.markUnresolved(
        other.captureId,
        'provenance unclear',
        T3,
      );
      expect(verifyingUnresolved.state).toBe('UNRESOLVED');
      expect(verifyingUnresolved.error).toBe('provenance unclear');
    });

    it('C15-C16: VERIFYING -> FAILED_RECOVERABLE and MATERIALIZING -> FAILED_RECOVERABLE', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact } = seedArtifactAndVersion(h, projectId);

      // Failure at VERIFYING.
      const verifying = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(verifying.captureId, T2);
      h.captures.advance(verifying.captureId, T3);
      h.captures.advance(verifying.captureId, T3);
      const failedAtVerifying = h.captures.markFailedRecoverable(
        verifying.captureId,
        'verify failed',
        T3,
      );
      expect(failedAtVerifying.state).toBe('FAILED_RECOVERABLE');
      expect(failedAtVerifying.error).toBe('verify failed');

      // Failure at MATERIALIZING (admitted first).
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      const failedAtMaterializing = h.captures.markFailedRecoverable(captureId, 'disk full', T4);
      expect(failedAtMaterializing.state).toBe('FAILED_RECOVERABLE');
      expect(failedAtMaterializing.finalArtifactId).toBe(artifact.artifactId);
    });

    it('C17: explicit discard works from allowed pre-terminal states', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      const discarded = h.captures.discard(created.captureId, T4, 'blocked source');
      expect(discarded.state).toBe('DISCARDED');
      expect(discarded.error).toBe('blocked source');
      expect(h.captures.get(created.captureId).state).toBe('DISCARDED');
    });
  });

  describe('D. Recovery', () => {
    it('D18: FAILED_RECOVERABLE cannot ordinary-advance', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      h.captures.markFailedRecoverable(created.captureId, 'boom', T3);
      expect(() => h.captures.advance(created.captureId, T4)).toThrow(DomainError);
    });

    it('D19-D21: resume is deterministic, increments attemptCount once, preserves milestones', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      const staged = h.captures.advance(created.captureId, T3);
      expect(staged.entry.stagedAt).toBe(T3);
      h.captures.advance(created.captureId, T3);
      h.captures.markFailedRecoverable(created.captureId, 'hash mismatch', T3);

      // Deterministic resume: stagedAt set -> VERIFYING.
      const resumed = h.captures.resume(created.captureId, T4);
      expect(resumed.state).toBe('VERIFYING');
      expect(resumed.attemptCount).toBe(1);
      // Milestone timestamps preserved.
      expect(resumed.stagedAt).toBe(T3);

      // Second failure + resume: attemptCount increments again; stagedAt unchanged.
      h.captures.markFailedRecoverable(created.captureId, 'again', T4);
      const resumed2 = h.captures.resume(created.captureId, T4);
      expect(resumed2.state).toBe('VERIFYING');
      expect(resumed2.attemptCount).toBe(2);
      expect(resumed2.stagedAt).toBe(T3);
    });

    it('D20b: resume after ADMITTED failure returns to MATERIALIZING and does not re-admit', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.markFailedRecoverable(captureId, 'materialize failed', T4);
      const resumed = h.captures.resume(captureId, T4);
      expect(resumed.state).toBe('MATERIALIZING');
      expect(resumed.finalArtifactId).toBe(artifact.artifactId);
      expect(resumed.admittedAt).toBe(T4);
      expect(resumed.attemptCount).toBe(1);
    });

    it('D20a: resume before anything was staged returns to STABILIZING', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.markFailedRecoverable(created.captureId, 'source vanished', T2);
      const resumed = h.captures.resume(created.captureId, T2);
      expect(resumed.state).toBe('STABILIZING');
      expect(resumed.attemptCount).toBe(1);
    });
  });

  describe('E. UNRESOLVED', () => {
    it('E23: UNRESOLVED cannot auto-advance', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      h.captures.markUnresolved(created.captureId, 'unclear', T3);
      expect(() => h.captures.advance(created.captureId, T4)).toThrow(DomainError);
      expect(() => h.captures.resume(created.captureId, T4)).toThrow(DomainError);
    });

    it('E24: explicit resolve of a staged capture returns to VERIFYING', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      h.captures.markUnresolved(created.captureId, 'unclear', T3);
      const resolved = h.captures.resolve(created.captureId, T4);
      expect(resolved.state).toBe('VERIFYING');
      expect(resolved.error).toBeNull();
    });

    it('E25: DETECTED-origin UNRESOLVED resolves to STABILIZING with stagedAt null (B1)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.markUnresolved(created.captureId, 'ambiguous source', T2);
      const resolved = h.captures.resolve(created.captureId, T3);
      expect(resolved.state).toBe('STABILIZING');
      expect(resolved.stagedAt).toBeNull();
      expect(resolved.error).toBeNull();
      // The unsafe static path is rejected through the real service authority.
      expect(() => h.captures.resolve(created.captureId, T3)).toThrow(DomainError);
    });

    it('E26: STABILIZING-origin UNRESOLVED resolves to STABILIZING (B1)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.markUnresolved(created.captureId, 'source vanished', T3);
      const resolved = h.captures.resolve(created.captureId, T4);
      expect(resolved.state).toBe('STABILIZING');
      expect(resolved.stagedAt).toBeNull();
    });

    it('E27: staged VERIFYING-origin UNRESOLVED resolves to VERIFYING and preserves stagedAt (B1)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      const staged = h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      h.captures.markUnresolved(created.captureId, 'provenance unclear', T3);
      const resolved = h.captures.resolve(created.captureId, T4);
      expect(resolved.state).toBe('VERIFYING');
      expect(resolved.stagedAt).toBe(staged.entry.stagedAt);
      expect(resolved.error).toBeNull();
    });

    it('E28: resolve from any non-UNRESOLVED state rejects truthfully (B1)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      expect(() => h.captures.resolve(created.captureId, T2)).toThrow(DomainError);
      h.captures.advance(created.captureId, T2);
      expect(() => h.captures.resolve(created.captureId, T3)).toThrow(DomainError);
      h.captures.discard(created.captureId, T3, 'cancelled');
      expect(() => h.captures.resolve(created.captureId, T4)).toThrow(DomainError);
    });
  });

  describe('F. Completion invariants', () => {
    it('F25-F26: COMPLETED without finalArtifactId/finalVersionId rejects', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      // Missing finalVersionId (random/nonexistent version).
      expect(() => h.captures.complete(captureId, artifact.artifactId, randomUUID(), T4)).toThrow(
        DomainError,
      );
    });

    it('F27: finalVersion must belong to finalArtifact (cross-artifact rejects)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact: layout } = seedArtifactAndVersion(h, projectId);
      // Second artifact in the SAME project with its own version.
      const other = h.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/BOQ.xlsx',
      });
      const otherVersion = h.artifacts.createArtifactVersion({
        artifactId: other.artifactId,
        version: 1,
        contentHash: sha256('boq-v1'),
        locatorValue: 'WORKING/BOQ/BOQ.xlsx',
      });
      const captureId = await admitCapture(h, projectId, layout.artifactId);
      h.captures.advance(captureId, T4);
      expect(() =>
        h.captures.complete(captureId, layout.artifactId, otherVersion.versionId, T4),
      ).toThrow(/final version must belong/i);
    });

    it('F28-F29: finalArtifact must belong to the ledger project (cross-project rejects)', async () => {
      const h = await makeHarness();
      const projectA = randomUUID();
      const projectB = randomUUID();
      const { artifact: a } = seedArtifactAndVersion(h, projectA);
      const { artifact: b, version: vb } = seedArtifactAndVersion(h, projectB);
      const captureId = await admitCapture(h, projectA, a.artifactId);
      h.captures.advance(captureId, T4);
      // Artifact b belongs to a different project than the ledger.
      expect(() => h.captures.complete(captureId, b.artifactId, vb.versionId, T4)).toThrow(
        /must belong to the ledger project/i,
      );
    });

    it('F30: valid same-artifact/same-project completion succeeds', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      const completed = h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(completed.state).toBe('COMPLETED');
      expect(completed.finalVersionId).toBe(version.versionId);
    });
  });

  describe('G. Admission / materialization', () => {
    it('G31: ADMITTED without finalArtifactId rejects', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      expect(() => h.captures.advance(created.captureId, T4)).toThrow(DomainError);
    });

    it('G32: MATERIALIZING respects the admitted artifact identity', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      const materializing = h.captures.advance(captureId, T4);
      expect(materializing.entry.state).toBe('MATERIALIZING');
      expect(materializing.entry.finalArtifactId).toBe(artifact.artifactId);
    });
  });

  describe('H. Context recovery', () => {
    it('H33: an already-DETECTED capture may continue after its context expires', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId);
      const created = h.captures.createDetectedCapture(detectCapture(projectId, ctx.toolContextId));
      // The context expires AFTER the capture was detected.
      h.contexts.expire(ctx.toolContextId, T2);
      expect(h.contexts.get(ctx.toolContextId).state).toBe('EXPIRED');
      // Continuation works without re-authorization.
      const continued = h.captures.advance(created.captureId, T2);
      expect(continued.entry.state).toBe('STABILIZING');
      // The owned-recovery context check passes against the historical identity.
      const owned = h.captures.assertOwnedRecoveryContext(created.captureId, ctx.toolContextId);
      expect(owned.captureId).toBe(created.captureId);
    });

    it('H34: recovery never invokes NEW-capture authorization (EXPIRED would deny it)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId, 'AutoCAD', 'exp-chan');
      h.contexts.expire(ctx.toolContextId, T2);
      // New-capture authorization on the EXPIRED context DENIES.
      const decision = h.contexts.authorizeNewCapture(
        projectId,
        ctx.toolContextId,
        'AutoCAD',
        'LightingLayout',
        'Working',
        'exp-chan',
        AUTOMATIC_CAPTURE_SOURCE_CLASS,
        makeCapability('AutoCAD', 'exp-chan'),
      );
      expect(decision).toMatchObject({ outcome: 'DENIED', reason: 'CONTEXT_EXPIRED' });
      // Yet a ledger capture already owned by that context continues.
      const created = h.captures.createDetectedCapture(detectCapture(projectId, ctx.toolContextId));
      h.captures.advance(created.captureId, T2);
      expect(h.captures.get(created.captureId).state).toBe('STABILIZING');
    });

    it('H35: unknown/mismatched historical context fails truthfully', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId, 'AutoCAD', 'ctx-chan');
      const created = h.captures.createDetectedCapture(detectCapture(projectId, ctx.toolContextId));
      expect(() => h.captures.assertOwnedRecoveryContext(created.captureId, null)).toThrow(
        /does not match/i,
      );
      expect(() => h.captures.assertOwnedRecoveryContext(created.captureId, randomUUID())).toThrow(
        /does not match/i,
      );
    });
  });

  describe('I. Terminal / audit', () => {
    it('I36-I38: ledger rows are not deleted on COMPLETED, DISCARDED, or CLOSED context', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const ctx = createContext(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId, ctx.toolContextId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(h.captures.get(captureId).state).toBe('COMPLETED');

      const discarded = h.captures.createDetectedCapture(
        detectCapture(projectId, ctx.toolContextId),
      );
      h.captures.discard(discarded.captureId, T2, 'cancelled');
      expect(h.captures.get(discarded.captureId).state).toBe('DISCARDED');

      // CLOSED context does not delete related capture ledger rows.
      h.contexts.close(ctx.toolContextId, T4);
      expect(h.contexts.get(ctx.toolContextId).state).toBe('CLOSED');
      expect(h.captures.get(captureId).state).toBe('COMPLETED');
      expect(h.captures.get(discarded.captureId).state).toBe('DISCARDED');
      expect(h.captures.list(projectId)).toHaveLength(2);
    });
  });

  describe('J. Attempts / errors', () => {
    it('J39: initial attemptCount is 0', async () => {
      const h = await makeHarness();
      const created = h.captures.createDetectedCapture(detectCapture(randomUUID(), null));
      expect(created.attemptCount).toBe(0);
    });

    it('J40: recovery increments the attempt count; J41: ordinary transitions do not', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.advance(created.captureId, T2);
      h.captures.advance(created.captureId, T3);
      h.captures.advance(created.captureId, T3);
      expect(h.captures.get(created.captureId).attemptCount).toBe(0);
      h.captures.markFailedRecoverable(created.captureId, 'x', T3);
      h.captures.resume(created.captureId, T4);
      expect(h.captures.get(created.captureId).attemptCount).toBe(1);
    });

    it('J42: failure reason persists truthfully', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      h.captures.markUnresolved(created.captureId, 'ambiguous source', T2);
      expect(h.captures.get(created.captureId).error).toBe('ambiguous source');
      // Healthy progress clears the CURRENT error (history is not event-sourced).
      h.captures.resolve(created.captureId, T3);
      expect(h.captures.get(created.captureId).error).toBeNull();
    });
  });

  describe('K. AUTO-01B regression', () => {
    it('K43: EXPIRED cannot authorize a NEW capture', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId, 'AutoCAD', 'k-chan');
      h.contexts.expire(ctx.toolContextId, T2);
      const decision = h.contexts.authorizeNewCapture(
        projectId,
        ctx.toolContextId,
        'AutoCAD',
        'LightingLayout',
        'Working',
        'k-chan',
        AUTOMATIC_CAPTURE_SOURCE_CLASS,
        makeCapability('AutoCAD', 'k-chan'),
      );
      expect(decision).toMatchObject({ outcome: 'DENIED', reason: 'CONTEXT_EXPIRED' });
    });

    it('K44: LIVE with exact capability still authorizes', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId, 'AutoCAD', 'k-live');
      const decision = h.contexts.authorizeNewCapture(
        projectId,
        ctx.toolContextId,
        'AutoCAD',
        'LightingLayout',
        'Working',
        'k-live',
        AUTOMATIC_CAPTURE_SOURCE_CLASS,
        makeCapability('AutoCAD', 'k-live'),
      );
      expect(decision).toMatchObject({ outcome: 'AUTHORIZED' });
    });

    it('K45: Work Session remains irrelevant to capture authorization', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const ctx = createContext(h, projectId, 'AutoCAD', 'k-ws');
      // No Work Session exists anywhere in this harness; authorization must not
      // depend on one.
      const decision = h.contexts.authorizeNewCapture(
        projectId,
        ctx.toolContextId,
        'AutoCAD',
        'LightingLayout',
        'Working',
        'k-ws',
        AUTOMATIC_CAPTURE_SOURCE_CLASS,
        makeCapability('AutoCAD', 'k-ws'),
      );
      expect(decision).toMatchObject({ outcome: 'AUTHORIZED' });
    });
  });

  describe('L. Creation state safety (H1 + creation contract)', () => {
    it('L1: normal production create with NO state starts DETECTED', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const entry = h.artifacts.createCaptureLedgerEntry({
        projectId,
        sourcePath: 'C:/exports/plain.pdf',
        sourceChannel: 'test',
        expectedArtifactType: 'BOQ',
        detectedAt: T1,
      });
      expect(entry.state).toBe('DETECTED');
      expect(entry.attemptCount).toBe(0);
      expect(entry.finalArtifactId).toBeNull();
      expect(entry.finalVersionId).toBeNull();
    });

    it('L2: normal production create with explicit DETECTED starts DETECTED', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const entry = h.artifacts.createCaptureLedgerEntry({
        projectId,
        sourcePath: 'C:/exports/explicit.pdf',
        sourceChannel: 'test',
        expectedArtifactType: 'BOQ',
        state: 'DETECTED',
        detectedAt: T1,
      });
      expect(entry.state).toBe('DETECTED');
      expect(entry.attemptCount).toBe(0);
    });

    it('L3: COMPLETED through the normal production creation boundary is REJECTED (never coerced)', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      // The production input type permits only 'DETECTED'; the cast exercises
      // the defensive RUNTIME rejection of a non-DETECTED value.
      expect(() =>
        h.artifacts.createCaptureLedgerEntry({
          projectId,
          sourcePath: 'C:/exports/forced.pdf',
          sourceChannel: 'test',
          expectedArtifactType: 'BOQ',
          state: 'COMPLETED' as 'DETECTED',
          detectedAt: T1,
        }),
      ).toThrow(/only be created in DETECTED state/i);
    });

    it('L4: ADMITTED through the normal production creation boundary is REJECTED', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      expect(() =>
        h.artifacts.createCaptureLedgerEntry({
          projectId,
          sourcePath: 'C:/exports/admitted.pdf',
          sourceChannel: 'test',
          expectedArtifactType: 'BOQ',
          state: 'ADMITTED' as 'DETECTED',
          detectedAt: T1,
        }),
      ).toThrow(/only be created in DETECTED state/i);
    });

    it('L5: FAILED_RECOVERABLE through the normal production creation boundary is REJECTED', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      expect(() =>
        h.artifacts.createCaptureLedgerEntry({
          projectId,
          sourcePath: 'C:/exports/failed.pdf',
          sourceChannel: 'test',
          expectedArtifactType: 'BOQ',
          state: 'FAILED_RECOVERABLE' as 'DETECTED',
          detectedAt: T1,
        }),
      ).toThrow(/only be created in DETECTED state/i);
    });

    it('L6: no ledger row is created after a rejected non-DETECTED creation attempt', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      for (const state of ['ADMITTED', 'COMPLETED', 'FAILED_RECOVERABLE', 'DISCARDED'] as const) {
        expect(() =>
          h.artifacts.createCaptureLedgerEntry({
            projectId,
            sourcePath: `C:/exports/${state}.pdf`,
            sourceChannel: 'test',
            expectedArtifactType: 'BOQ',
            state: state as 'DETECTED',
            detectedAt: T1,
          }),
        ).toThrow(/only be created in DETECTED state/i);
      }
      expect(h.artifacts.listCaptureLedgerEntries(projectId)).toHaveLength(0);
    });

    it('L7: the test/internal seeding helper still supports arbitrary states for invariant proofs', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const seeded = h.artifacts.createCaptureLedgerEntryForTest({
        projectId,
        sourcePath: 'C:/exports/seeded.pdf',
        sourceChannel: 'test',
        expectedArtifactType: 'BOQ',
        state: 'COMPLETED',
        detectedAt: T1,
      });
      expect(seeded.state).toBe('COMPLETED');
    });

    it('L8: CaptureLedgerService.createDetectedCapture continues to create DETECTED only', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const created = h.captures.createDetectedCapture(detectCapture(projectId, null));
      expect(created.state).toBe('DETECTED');
      expect(created.attemptCount).toBe(0);
    });
  });

  describe('M. Idempotent replay identity safety (H3)', () => {
    it('M1: same-state replay with the SAME finalArtifactId is a safe no-op', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      const completed = h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      // Replay the identical complete: same artifact + same version -> no-op.
      const replay = h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(replay.state).toBe('COMPLETED');
      expect(replay.finalArtifactId).toBe(artifact.artifactId);
      expect(replay.completedAt).toBe(completed.completedAt);
    });

    it('M2: same-state replay with the SAME finalVersionId is a safe no-op', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      const replay = h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(replay.state).toBe('COMPLETED');
      expect(replay.finalVersionId).toBe(version.versionId);
    });

    it('M3: same-state replay with a DIFFERENT finalArtifactId throws CONFLICT', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const other = h.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/Other.xlsx',
      });
      const otherVersion = h.artifacts.createArtifactVersion({
        artifactId: other.artifactId,
        version: 1,
        contentHash: sha256('other-v1'),
        locatorValue: 'WORKING/BOQ/Other.xlsx',
      });
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      // Replay with a divergent artifact identity.
      expect(() =>
        h.captures.complete(captureId, other.artifactId, otherVersion.versionId, T4),
      ).toThrow(DomainError);
    });

    it('M4: same-state replay with a DIFFERENT finalVersionId throws CONFLICT', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const other = h.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/Other.xlsx',
      });
      const otherVersion = h.artifacts.createArtifactVersion({
        artifactId: other.artifactId,
        version: 1,
        contentHash: sha256('other-v1'),
        locatorValue: 'WORKING/BOQ/Other.xlsx',
      });
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      // Replay with a divergent version identity.
      expect(() =>
        h.captures.complete(captureId, artifact.artifactId, otherVersion.versionId, T4),
      ).toThrow(DomainError);
    });

    it('M5: persisted identity remains unchanged after a rejected divergent replay', async () => {
      const h = await makeHarness();
      const projectId = randomUUID();
      const { artifact, version } = seedArtifactAndVersion(h, projectId);
      const other = h.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/Other.xlsx',
      });
      const otherVersion = h.artifacts.createArtifactVersion({
        artifactId: other.artifactId,
        version: 1,
        contentHash: sha256('other-v1'),
        locatorValue: 'WORKING/BOQ/Other.xlsx',
      });
      const captureId = await admitCapture(h, projectId, artifact.artifactId);
      h.captures.advance(captureId, T4);
      h.captures.complete(captureId, artifact.artifactId, version.versionId, T4);
      expect(() =>
        h.captures.complete(captureId, other.artifactId, otherVersion.versionId, T4),
      ).toThrow(DomainError);
      const persisted = h.captures.get(captureId);
      expect(persisted.finalArtifactId).toBe(artifact.artifactId);
      expect(persisted.finalVersionId).toBe(version.versionId);
      expect(persisted.state).toBe('COMPLETED');
    });
  });
});
