/**
 * AUTO-01D — Staging + Hashing + Dedup (API/service reality gate).
 *
 * Proves the FIRST controlled handling of real file bytes through the REAL
 * service + store authority (real temp files + targeted failure injection):
 *   A. Source preservation — path/size/hash/bytes unchanged; never deleted.
 *   B. Stabilization — stable file stages; changing size/mtime does not stage
 *      prematurely; disappearing source fails truthfully; bounded timeout.
 *   C. Staging — application-owned root, captureId-derived dir, no collisions,
 *      traversal-safe construction, partial never trusted, staged bytes match.
 *   D. Source change during copy — detected, staged copy not trusted, ledger
 *      does not advance, source untouched.
 *   E. Hashing — SHA-256 matches expected bytes; size exact; proof persists
 *      through the narrow authority; malformed hash cannot persist.
 *   F. Ledger states — DETECTED -> STABILIZING -> STAGED -> VERIFYING through
 *      the AUTO-01C authority; no skips; stagedAt stamped by the transition.
 *   G. Dedup — duplicate event / same artifact+hash / different artifact /
 *      different project typed decisions.
 *   H. Internal path / loop protection — staging root classified internal;
 *      external paths not falsely classified.
 *   I. Cleanup — DISCARD-safe cleanup removes only the owned stage;
 *      FAILED_RECOVERABLE bytes retained; source unaffected.
 *   J. Restart — re-instantiated service derives the same path; staged bytes
 *      readable; hash re-verifies; partial rejected.
 *   K. AUTO-01C regression — strict machine, resume semantics, COMPLETED
 *      invariants unchanged.
 *   L. AUTO-01B regression — EXPIRED cannot authorize NEW capture; source
 *      firewall authority unchanged.
 *
 * No watcher, no ManagedArtifact admission pipeline, no ArtifactVersion
 * creation, no materialization, no recovery worker, no adapters, no UI.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { AUTOMATIC_CAPTURE_SOURCE_CLASS } from '@scli/domain';
import type { CaptureCapability } from '@scli/domain';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import {
  CaptureStagingError,
  CaptureStagingService,
  NodeCaptureStagingFs,
  sha256FileStreaming,
} from './infrastructure/managed-artifact/CaptureStagingService';
import type { CaptureStagingFsPort } from './infrastructure/managed-artifact/CaptureStagingService';
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01d-'));
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
    return { backupId: 'bk-auto01d-0001' };
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
    return { attemptId: 'att-auto01d-0001' };
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
  staging: CaptureStagingService;
  dataRoot: string;
}

async function makeHarness(options?: {
  stagingRootOverride?: string;
  fs?: CaptureStagingFsPort;
  stabilizationPolicy?: {
    requiredStableSamples: number;
    sampleIntervalMs: number;
    timeoutMs: number;
  };
  sleep?: (ms: number) => Promise<void>;
}): Promise<Harness> {
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
  const staging = new CaptureStagingService({
    store: artifacts,
    captures,
    dataRoot: dir,
    ...(options?.stagingRootOverride !== undefined
      ? { stagingRootOverride: options.stagingRootOverride }
      : {}),
    ...(options?.stabilizationPolicy !== undefined
      ? { stabilizationPolicy: options.stabilizationPolicy }
      : {}),
    ...(options?.fs !== undefined ? { fs: options.fs } : {}),
    ...(options?.sleep !== undefined ? { sleep: options.sleep } : {}),
  });
  return { db, artifacts, contexts, captures, staging, dataRoot: dir };
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

function detectCapture(projectId: string, toolContextId: string | null, sourcePath: string) {
  return {
    projectId,
    toolContextId,
    sourcePath,
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

/**
 * Builds a delegating fs port from the real port with targeted overrides.
 * (Spreading a class instance loses prototype methods, so delegation is
 * explicit.)
 */
function delegateFs(overrides: Partial<CaptureStagingFsPort>): CaptureStagingFsPort {
  const real = new NodeCaptureStagingFs();
  return {
    snapshot: (p) => (overrides.snapshot ? overrides.snapshot(p) : real.snapshot(p)),
    copyFile: (s, d) => (overrides.copyFile ? overrides.copyFile(s, d) : real.copyFile(s, d)),
    rename: (f, t) => (overrides.rename ? overrides.rename(f, t) : real.rename(f, t)),
    mkdir: (d) => (overrides.mkdir ? overrides.mkdir(d) : real.mkdir(d)),
    rm: (p) => (overrides.rm ? overrides.rm(p) : real.rm(p)),
    readFile: (p) => (overrides.readFile ? overrides.readFile(p) : real.readFile(p)),
    accessReadable: (p) =>
      overrides.accessReadable ? overrides.accessReadable(p) : real.accessReadable(p),
  };
}

/** Seeds a ManagedArtifact + one ArtifactVersion in `projectId`. */
function seedArtifactAndVersion(harness: Harness, projectId: string, contentHash: string) {
  const artifact = harness.artifacts.createManagedArtifact({
    projectId,
    artifactType: 'LightingLayout',
    sourceTool: 'AutoCAD',
    canonicalPath: 'WORKING/CAD/Layout.dwg',
  });
  const version = harness.artifacts.createArtifactVersion({
    artifactId: artifact.artifactId,
    version: 1,
    contentHash,
    locatorValue: 'WORKING/CAD/Layout.dwg',
  });
  return { artifact, version };
}

/** Creates a DETECTED capture for a real source file and returns it. */
function createDetectedForSource(
  h: Harness,
  projectId: string,
  sourcePath: string,
  toolContextId: string | null = null,
) {
  return h.captures.createDetectedCapture(detectCapture(projectId, toolContextId, sourcePath));
}

/** Fast stabilization policy for tests (no real seconds). */
const FAST_POLICY = { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 200 };

// ---------------------------------------------------------------------------
// A. Source preservation
// ---------------------------------------------------------------------------

describe('A. Source preservation', () => {
  it('A1-A4: source path, bytes, hash and size remain unchanged after staging', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'source-layout.dwg');
    const bytes = Buffer.from('DWG-BYTES-V1');
    writeFileSync(sourcePath, bytes);
    const beforeHash = sha256(bytes.toString('utf8'));
    const beforeSize = bytes.length;

    const capture = createDetectedForSource(h, projectId, sourcePath);
    const staged = await h.staging.stageCapture(capture.captureId, T2);

    expect(staged.state).toBe('VERIFYING');
    expect(staged.stagedAt).not.toBeNull();
    // Source path unchanged (same string), bytes unchanged, hash unchanged.
    expect(h.captures.get(capture.captureId).sourcePath).toBe(sourcePath);
    const after = Buffer.from(readFileSync(sourcePath));
    expect(after.equals(bytes)).toBe(true);
    expect(after.length).toBe(beforeSize);
    expect(sha256(after.toString('utf8'))).toBe(beforeHash);
  });

  it('A5: source file is never deleted by staging', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'source-keep.pdf');
    writeFileSync(sourcePath, 'PDF-BYTES');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    expect(existsSync(sourcePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. Stabilization
// ---------------------------------------------------------------------------

describe('B. Stabilization', () => {
  it('B6: a stable file reaches STAGED (and VERIFYING) through the service', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'stable.dwg');
    writeFileSync(sourcePath, 'STABLE-BYTES');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    const result = await h.staging.stageCapture(capture.captureId, T2);
    expect(result.state).toBe('VERIFYING');
    expect(result.stagedAt).not.toBeNull();
  });

  it('B7: a changing-size file does not stage prematurely', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'growing.dwg');
    writeFileSync(sourcePath, 'A');
    // The source keeps growing: every sample sees a different size, so the
    // stabilization wait must time out instead of staging.
    let size = 1;
    const growingFs = delegateFs({
      snapshot: async (p) => {
        const s = await new NodeCaptureStagingFs().snapshot(p);
        if (s.exists) {
          writeFileSync(sourcePath, 'X'.repeat(++size));
          return { ...s, size };
        }
        return s;
      },
    });
    const h2 = await makeHarness({
      fs: growingFs,
      stabilizationPolicy: { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 50 },
    });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      CaptureStagingError,
    );
    expect(h2.captures.get(capture2.captureId).state).toBe('STABILIZING');
  });

  it('B8: a changing-mtime file does not stage prematurely', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'touching.dwg');
    writeFileSync(sourcePath, 'TOUCH');
    const touchingFs = delegateFs({
      snapshot: async (p) => {
        const s = await new NodeCaptureStagingFs().snapshot(p);
        if (s.exists) {
          const now = new Date();
          utimesSync(sourcePath, now, now);
          return { ...s, mtimeMs: now.getTime() };
        }
        return s;
      },
    });
    const h2 = await makeHarness({
      fs: touchingFs,
      stabilizationPolicy: { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 50 },
    });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      CaptureStagingError,
    );
    expect(h2.captures.get(capture2.captureId).state).toBe('STABILIZING');
  });

  it('B9: source disappears during stabilization -> FAILED_RECOVERABLE truthfully', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'vanishing.dwg');
    writeFileSync(sourcePath, 'VANISH');
    let removed = false;
    const vanishingFs = delegateFs({
      snapshot: async (p) => {
        if (!removed) {
          removed = true;
          rmSync(sourcePath, { force: true });
        }
        return new NodeCaptureStagingFs().snapshot(p);
      },
    });
    const h2 = await makeHarness({ fs: vanishingFs, stabilizationPolicy: FAST_POLICY });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      CaptureStagingError,
    );
    // The ledger is marked FAILED_RECOVERABLE with a precise reason; the row
    // is never deleted.
    const entry = h2.captures.get(capture2.captureId);
    expect(entry.state).toBe('FAILED_RECOVERABLE');
    expect(entry.error).toMatch(/SOURCE_NOT_FOUND|disappeared/i);
  });

  it('B10: bounded timeout exits truthfully (SOURCE_NOT_STABLE)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'never-stable.dwg');
    writeFileSync(sourcePath, 'N');
    const unstableFs = delegateFs({
      snapshot: async (p) => {
        const s = await new NodeCaptureStagingFs().snapshot(p);
        if (s.exists) {
          writeFileSync(sourcePath, 'N'.repeat(Math.floor(Math.random() * 100) + 1));
          return { ...s, size: s.size + 1 };
        }
        return s;
      },
    });
    const h2 = await makeHarness({
      fs: unstableFs,
      stabilizationPolicy: { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 30 },
    });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      /SOURCE_NOT_STABLE|did not stabilize/i,
    );
  });
});

// ---------------------------------------------------------------------------
// C. Staging
// ---------------------------------------------------------------------------

describe('C. Staging', () => {
  it('C11: staging root is application-owned (inside the data root)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    expect(h.staging.getStagingRoot()).toBe(path.join(h.dataRoot, 'capture-stage'));
  });

  it('C12: staging directory is derived from captureId', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'derived.dwg');
    writeFileSync(sourcePath, 'DERIVED');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    expect(h.staging.stagingDirFor(capture.captureId)).toBe(
      path.join(h.staging.getStagingRoot(), capture.captureId),
    );
    await h.staging.stageCapture(capture.captureId, T2);
    expect(existsSync(h.staging.stagingDirFor(capture.captureId))).toBe(true);
  });

  it('C13: two captures cannot collide (distinct staging dirs)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourceA = path.join(h.dataRoot, 'a.dwg');
    const sourceB = path.join(h.dataRoot, 'b.dwg');
    writeFileSync(sourceA, 'AAA');
    writeFileSync(sourceB, 'BBB');
    const capA = createDetectedForSource(h, projectId, sourceA);
    const capB = createDetectedForSource(h, projectId, sourceB);
    expect(h.staging.stagingDirFor(capA.captureId)).not.toBe(
      h.staging.stagingDirFor(capB.captureId),
    );
    await h.staging.stageCapture(capA.captureId, T2);
    await h.staging.stageCapture(capB.captureId, T2);
    expect(existsSync(h.staging.finalStagedPathFor(capA.captureId))).toBe(true);
    expect(existsSync(h.staging.finalStagedPathFor(capB.captureId))).toBe(true);
  });

  it('C14: traversal-safe construction (no user component escapes staging)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    // A hostile source filename must never become a directory component.
    const sourcePath = path.join(h.dataRoot, '..', 'escape.dwg');
    writeFileSync(sourcePath, 'ESCAPE');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    const dir = h.staging.stagingDirFor(capture.captureId);
    expect(path.relative(h.staging.getStagingRoot(), dir)).not.toMatch(/^\.\./);
    expect(path.isAbsolute(path.relative(h.staging.getStagingRoot(), dir))).toBe(false);
  });

  it('C15: partial file is not considered final staged content', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'partial.dwg');
    writeFileSync(sourcePath, 'PARTIAL');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    // Simulate a crash: only the partial file exists.
    const dir = h.staging.stagingDirFor(capture.captureId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(h.staging.partialPathFor(capture.captureId), 'PARTIAL');
    // The final staged path must not exist yet.
    expect(existsSync(h.staging.finalStagedPathFor(capture.captureId))).toBe(false);
    // verifyStagedCapture must reject the partial-only state.
    await expect(h.staging.verifyStagedCapture(capture.captureId)).rejects.toThrow(
      /STAGING_NOT_FINALIZED|no staged milestone/i,
    );
  });

  it('C16: staged bytes exactly match the stabilized source', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'exact.dwg');
    const bytes = Buffer.from('EXACT-BYTES');
    writeFileSync(sourcePath, bytes);
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const stagedBytes = readFileSync(h.staging.finalStagedPathFor(capture.captureId));
    expect(stagedBytes.equals(bytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Source change during copy
// ---------------------------------------------------------------------------

describe('D. Source change during copy', () => {
  it('D17-D20: source mutation during copy is detected; staged copy not trusted; ledger does not advance; source untouched', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'mutating.dwg');
    writeFileSync(sourcePath, 'ORIGINAL-BYTES');
    let mutated = false;
    const mutatingFs = delegateFs({
      copyFile: async (src, dst) => {
        await new NodeCaptureStagingFs().copyFile(src, dst);
        if (!mutated) {
          mutated = true;
          // The source application writes again right after the copy.
          writeFileSync(sourcePath, 'MUTATED-BYTES');
        }
      },
    });
    const h2 = await makeHarness({ fs: mutatingFs, stabilizationPolicy: FAST_POLICY });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      /SOURCE_CHANGED_DURING_COPY|changed while it was being copied/i,
    );
    const entry = h2.captures.get(capture2.captureId);
    expect(entry.state).toBe('FAILED_RECOVERABLE');
    expect(entry.error).toMatch(/SOURCE_CHANGED_DURING_COPY/i);
    // The partial staged copy is removed (never trusted).
    expect(existsSync(h2.staging.partialPathFor(capture2.captureId))).toBe(false);
    // The source remains untouched (still the mutated bytes the app wrote).
    expect(readFileSync(sourcePath, 'utf8')).toBe('MUTATED-BYTES');
  });

  it('D21-B1: same-size in-place source mutation during copy is DETECTED by hash proof (A !== B !== C)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const sourcePath = path.join(h.dataRoot, 'same-size-mutate.dwg');
    const original = 'SAME-SIZE-ORIGINAL-BYTES-1234';
    const mutated = 'SAME-SIZE-MUTATED-BYTES-43215';
    writeFileSync(sourcePath, original);
    expect(Buffer.byteLength(original)).toBe(Buffer.byteLength(mutated));
    const preStat = statSync(sourcePath);
    let didMutate = false;
    const mutatingFs = delegateFs({
      copyFile: async (src, dst) => {
        await new NodeCaptureStagingFs().copyFile(src, dst);
        if (!didMutate) {
          didMutate = true;
          // Same-size in-place mutation: the byte content changes but size AND
          // mtime are restored, so metadata-only validation could never detect
          // this. Only the byte-truth hash proof (A === B === C) can.
          writeFileSync(sourcePath, mutated);
          utimesSync(sourcePath, preStat.atime, preStat.mtime);
        }
      },
    });
    const h2 = await makeHarness({ fs: mutatingFs, stabilizationPolicy: FAST_POLICY });
    const capture2 = createDetectedForSource(h2, randomUUID(), sourcePath);
    await expect(h2.staging.stageCapture(capture2.captureId, T2)).rejects.toThrow(
      /SOURCE_CHANGED_DURING_COPY|changed while it was being copied/i,
    );
    // Ledger truth preserved: FAILED_RECOVERABLE with precise reason, never
    // advanced to STAGED/VERIFYING, never deleted.
    const entry = h2.captures.get(capture2.captureId);
    expect(entry.state).toBe('FAILED_RECOVERABLE');
    expect(entry.error).toMatch(/SOURCE_CHANGED_DURING_COPY/i);
    expect(entry.stagedAt).toBeNull();
    expect(entry.contentHash).toBeNull();
    // The partial staged copy is removed (never trusted).
    expect(existsSync(h2.staging.partialPathFor(capture2.captureId))).toBe(false);
    // Source bytes changed (the app's own write) with UNCHANGED size and
    // restored mtime — proving the detection was byte-truth, not metadata-truth.
    expect(readFileSync(sourcePath, 'utf8')).toBe(mutated);
    expect(statSync(sourcePath).size).toBe(Buffer.byteLength(original));
    // utimesSync restores the mtime to the pre-copy value (whole-millisecond
    // precision); sub-millisecond drift is filesystem truncation, not a change.
    expect(Math.abs(statSync(sourcePath).mtimeMs - preStat.mtimeMs)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// E. Hashing
// ---------------------------------------------------------------------------

describe('E. Hashing', () => {
  it('E21: SHA-256 matches expected bytes', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'hash.dwg');
    const bytes = Buffer.from('HASH-ME');
    writeFileSync(sourcePath, bytes);
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const stagedPath = h.staging.finalStagedPathFor(capture.captureId);
    expect(await sha256FileStreaming(stagedPath)).toBe(sha256('HASH-ME'));
  });

  it('E22: sizeBytes exact', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'size.dwg');
    writeFileSync(sourcePath, 'SIZE-BYTES');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    expect(h.captures.get(capture.captureId).sizeBytes).toBe('SIZE-BYTES'.length);
  });

  it('E23: hash persists to ledger through the narrow authority', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'persist.dwg');
    writeFileSync(sourcePath, 'PERSIST');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const entry = h.captures.get(capture.captureId);
    expect(entry.contentHash).toBe(sha256('PERSIST'));
    expect(entry.sizeBytes).toBe('PERSIST'.length);
  });

  it('E24: malformed hash cannot be persisted', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'malformed.dwg');
    writeFileSync(sourcePath, 'MALFORMED');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    // Advance to STABILIZING so the proof authority is reachable.
    h.captures.advance(capture.captureId, T2);
    expect(() => h.artifacts.recordStagedContentProof(capture.captureId, 'not-a-hash', 9)).toThrow(
      /SHA-256 hex digest/i,
    );
    expect(h.captures.get(capture.captureId).contentHash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F. Ledger states
// ---------------------------------------------------------------------------

describe('F. Ledger states', () => {
  it('F25-F29: DETECTED -> STABILIZING -> STAGED -> VERIFYING through the service; no skips; stagedAt stamped by the transition authority', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'flow.dwg');
    writeFileSync(sourcePath, 'FLOW');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    expect(capture.state).toBe('DETECTED');
    // DETECTED -> STABILIZING is the first step of stageCapture.
    const staged = await h.staging.stageCapture(capture.captureId, T2);
    expect(staged.state).toBe('VERIFYING');
    expect(staged.stagedAt).not.toBeNull();
    // stagedAt was stamped by the AUTO-01C transition authority (first-write-wins).
    expect(staged.stagedAt).toBe(T2);
  });

  it('F28: no state skip (DETECTED -> VERIFYING is impossible)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'skip.dwg');
    writeFileSync(sourcePath, 'SKIP');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    expect(() => h.captures.advance(capture.captureId, T2, {})).not.toThrow();
    // A direct DETECTED -> VERIFYING attempt is rejected by the domain graph.
    expect(() => h.artifacts.transitionCaptureState(capture.captureId, 'VERIFYING', T2)).toThrow(
      /INVALID_TRANSITION|not allowed/i,
    );
  });
});

// ---------------------------------------------------------------------------
// G. Dedup
// ---------------------------------------------------------------------------

describe('G. Dedup', () => {
  it('G30: same source/channel/hash duplicate event returns DUPLICATE_EVENT', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'dupe-event.dwg');
    writeFileSync(sourcePath, 'DUPE-EVENT');
    const first = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(first.captureId, T2);
    // A second filesystem event for the same source/channel/content.
    const second = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(second.captureId, T2);
    const decision = h.staging.decideDedup(second.captureId);
    expect(decision.kind).toBe('DUPLICATE_EVENT');
    if (decision.kind === 'DUPLICATE_EVENT') {
      expect(decision.existingCaptureId).toBe(first.captureId);
    }
  });

  it('G31: same artifact + same hash returns DUPLICATE_CONTENT_SAME_ARTIFACT', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'same-artifact.dwg');
    writeFileSync(sourcePath, 'SAME-ARTIFACT');
    const { artifact } = seedArtifactAndVersion(h, projectId, sha256('SAME-ARTIFACT'));
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    // Admit the capture to the SAME artifact so the decision can compare.
    h.captures.advance(capture.captureId, T3, { finalArtifactId: artifact.artifactId });
    const decision = h.staging.decideDedup(capture.captureId);
    expect(decision.kind).toBe('DUPLICATE_CONTENT_SAME_ARTIFACT');
  });

  it('G30-B2: an old COMPLETED capture is history, NOT a duplicate EVENT for a new capture', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'old-completed.dwg');
    const bytes = 'OLD-COMPLETED-CAPTURE';
    writeFileSync(sourcePath, bytes);
    const { artifact, version } = seedArtifactAndVersion(h, projectId, sha256(bytes));

    // 1. Old COMPLETED capture: same sourcePath, same channel, same hash.
    const oldCapture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(oldCapture.captureId, T2);
    h.captures.advance(oldCapture.captureId, T3, { finalArtifactId: artifact.artifactId });
    h.captures.advance(oldCapture.captureId, T3);
    const done = h.captures.complete(
      oldCapture.captureId,
      artifact.artifactId,
      version.versionId,
      T4,
    );
    expect(done.state).toBe('COMPLETED');

    // 2. New authorized capture of the same source/channel/bytes later.
    const fresh = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(fresh.captureId, T2);
    // The fresh capture targets the same artifact (the new occurrence of the
    // same working artifact), so content dedup can compare identities.
    h.captures.advance(fresh.captureId, T3, { finalArtifactId: artifact.artifactId });

    // 3. The new capture is NOT a duplicate EVENT (the old row is terminal
    // history). Content dedup may still apply — the decision is separate.
    const decision = h.staging.decideDedup(fresh.captureId);
    expect(decision.kind).not.toBe('DUPLICATE_EVENT');
    expect(decision.kind).toBe('DUPLICATE_CONTENT_SAME_ARTIFACT');
  });

  it('G32: same hash + different artifact does NOT merge identity', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'diff-artifact.dwg');
    writeFileSync(sourcePath, 'DIFF-ARTIFACT');
    // Seed a version with the same hash under a DIFFERENT artifact.
    seedArtifactAndVersion(h, projectId, sha256('DIFF-ARTIFACT'));
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const decision = h.staging.decideDedup(capture.captureId);
    expect(decision.kind).toBe('SAME_BYTES_DIFFERENT_ARTIFACT');
  });

  it('G33: same hash + different project does NOT merge working-artifact identity', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectA = randomUUID();
    const projectB = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'cross-project.dwg');
    writeFileSync(sourcePath, 'CROSS-PROJECT');
    // Project A has a version with the same hash.
    seedArtifactAndVersion(h, projectA, sha256('CROSS-PROJECT'));
    // Project B captures the same bytes.
    const captureB = createDetectedForSource(h, projectB, sourcePath);
    await h.staging.stageCapture(captureB.captureId, T2);
    const decision = h.staging.decideDedup(captureB.captureId);
    // Project identity is authoritative: no cross-project merge.
    expect(decision.kind).toBe('NEW_CONTENT');
  });
});

// ---------------------------------------------------------------------------
// H. Internal path / loop protection
// ---------------------------------------------------------------------------

describe('H. Internal path / loop protection', () => {
  it('H34: staging-root path is classified internal', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    expect(h.staging.isInternalCapturePath(h.staging.getStagingRoot())).toBe(true);
    expect(
      h.staging.isInternalCapturePath(path.join(h.staging.getStagingRoot(), 'some-capture-id')),
    ).toBe(true);
  });

  it('H35: external source path is not falsely classified internal', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    expect(h.staging.isInternalCapturePath('C:/exports/layout.dwg')).toBe(false);
    expect(h.staging.isInternalCapturePath(path.join(h.dataRoot, '..', 'outside'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I. Cleanup
// ---------------------------------------------------------------------------

describe('I. Cleanup', () => {
  it('I36: DISCARD-safe staging cleanup removes only the owned capture stage', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'discard.dwg');
    writeFileSync(sourcePath, 'DISCARD');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const dir = h.staging.stagingDirFor(capture.captureId);
    expect(existsSync(dir)).toBe(true);
    h.captures.discard(capture.captureId, T3, 'user cancellation');
    await h.staging.cleanupStaging(capture.captureId);
    expect(existsSync(dir)).toBe(false);
    // The source file is unaffected.
    expect(existsSync(sourcePath)).toBe(true);
  });

  it('I37: FAILED_RECOVERABLE staging bytes are retained', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'retain.dwg');
    writeFileSync(sourcePath, 'RETAIN');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    h.captures.markFailedRecoverable(capture.captureId, 'verification failed', T3);
    await expect(h.staging.cleanupStaging(capture.captureId)).rejects.toThrow(
      /FAILED_RECOVERABLE staging bytes are retained/i,
    );
    expect(existsSync(h.staging.finalStagedPathFor(capture.captureId))).toBe(true);
  });

  it('I38: source file is unaffected by cleanup', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'cleanup-source.dwg');
    writeFileSync(sourcePath, 'CLEANUP-SOURCE');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    h.captures.discard(capture.captureId, T3, 'cancelled');
    await h.staging.cleanupStaging(capture.captureId);
    expect(readFileSync(sourcePath, 'utf8')).toBe('CLEANUP-SOURCE');
  });
});

// ---------------------------------------------------------------------------
// J. Restart
// ---------------------------------------------------------------------------

describe('J. Restart', () => {
  it('J39-J41: re-instantiated service derives the same path; staged bytes readable; hash re-verifies', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'restart.dwg');
    writeFileSync(sourcePath, 'RESTART-BYTES');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    const stagedPath = h.staging.finalStagedPathFor(capture.captureId);
    expect(existsSync(stagedPath)).toBe(true);

    // Simulate an app restart: a NEW service instance over the same data root.
    const restarted = new CaptureStagingService({
      store: h.artifacts,
      captures: h.captures,
      dataRoot: h.dataRoot,
      stabilizationPolicy: FAST_POLICY,
    });
    expect(restarted.finalStagedPathFor(capture.captureId)).toBe(stagedPath);
    expect(existsSync(restarted.finalStagedPathFor(capture.captureId))).toBe(true);
    const verified = await restarted.verifyStagedCapture(capture.captureId);
    expect(verified.contentHash).toBe(sha256('RESTART-BYTES'));
  });

  it('J42: partial staged file is rejected after restart', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'partial-restart.dwg');
    writeFileSync(sourcePath, 'PARTIAL-RESTART');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    // Simulate a crash mid-copy: only the partial file exists.
    const dir = h.staging.stagingDirFor(capture.captureId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(h.staging.partialPathFor(capture.captureId), 'PARTIAL-RESTART');
    const restarted = new CaptureStagingService({
      store: h.artifacts,
      captures: h.captures,
      dataRoot: h.dataRoot,
      stabilizationPolicy: FAST_POLICY,
    });
    await expect(restarted.verifyStagedCapture(capture.captureId)).rejects.toThrow(
      /STAGING_NOT_FINALIZED|no staged milestone/i,
    );
  });
});

// ---------------------------------------------------------------------------
// K. AUTO-01C regression
// ---------------------------------------------------------------------------

describe('K. AUTO-01C regression', () => {
  it('K43: capture state machine remains strict (no skips)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'strict.dwg');
    writeFileSync(sourcePath, 'STRICT');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    expect(() => h.captures.advance(capture.captureId, T2, {})).not.toThrow();
    expect(() => h.artifacts.transitionCaptureState(capture.captureId, 'COMPLETED', T2)).toThrow(
      /INVALID_TRANSITION|not allowed/i,
    );
  });

  it('K44: FAILED_RECOVERABLE resume semantics unchanged', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'resume.dwg');
    writeFileSync(sourcePath, 'RESUME');
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    h.captures.markFailedRecoverable(capture.captureId, 'verification failed', T3);
    const before = h.captures.get(capture.captureId);
    expect(before.attemptCount).toBe(0);
    const resumed = h.captures.resume(capture.captureId, T4);
    expect(resumed.state).toBe('VERIFYING');
    expect(resumed.attemptCount).toBe(1);
  });

  it('K45: COMPLETED invariants unchanged', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'complete.dwg');
    writeFileSync(sourcePath, 'COMPLETE');
    const { artifact, version } = seedArtifactAndVersion(h, projectId, sha256('COMPLETE'));
    const capture = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture.captureId, T2);
    h.captures.advance(capture.captureId, T3, { finalArtifactId: artifact.artifactId });
    h.captures.advance(capture.captureId, T3);
    const done = h.captures.complete(capture.captureId, artifact.artifactId, version.versionId, T4);
    expect(done.state).toBe('COMPLETED');
    expect(done.completedAt).toBe(T4);
    // COMPLETED without finalVersionId rejects.
    const capture2 = createDetectedForSource(h, projectId, sourcePath);
    await h.staging.stageCapture(capture2.captureId, T2);
    h.captures.advance(capture2.captureId, T3, { finalArtifactId: artifact.artifactId });
    h.captures.advance(capture2.captureId, T3);
    expect(() => h.artifacts.transitionCaptureState(capture2.captureId, 'COMPLETED', T4)).toThrow(
      /COMPLETED requires finalArtifactId and finalVersionId/i,
    );
  });
});

// ---------------------------------------------------------------------------
// L. AUTO-01B regression
// ---------------------------------------------------------------------------

describe('L. AUTO-01B regression', () => {
  it('L46: EXPIRED still cannot authorize NEW capture', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const ctx = createContext(h, projectId);
    h.contexts.expire(ctx.toolContextId, T2);
    const decision = h.contexts.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      ctx.channel,
      AUTOMATIC_CAPTURE_SOURCE_CLASS,
      makeCapability('AutoCAD', ctx.channel),
    );
    expect(decision).toMatchObject({ outcome: 'DENIED', reason: 'CONTEXT_EXPIRED' });
  });

  it('L47: source firewall authority unchanged (loop-protected class denied)', async () => {
    const h = await makeHarness({ stabilizationPolicy: FAST_POLICY });
    const projectId = randomUUID();
    const ctx = createContext(h, projectId);
    const decision = h.contexts.authorizeNewCapture(
      projectId,
      ctx.toolContextId,
      'AutoCAD',
      'LightingLayout',
      'Working',
      ctx.channel,
      'CAPTURE_STAGING',
      makeCapability('AutoCAD', ctx.channel),
    );
    expect(decision).toMatchObject({ outcome: 'DENIED', reason: 'CAPTURE_LOOP_PROTECTED' });
  });
});
