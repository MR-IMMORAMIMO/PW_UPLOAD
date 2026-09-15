/**
 * AUTO-01E1 — Materialization foundation (API/service reality gate).
 *
 * Proves the FIRST controlled transformation of ALREADY-TRUSTED staged bytes
 * into a managed working artifact through the REAL service + store authority
 * (real temp files + targeted failure injection):
 *   A. Happy path — STAGED -> ManagedArtifact (ADMITTED) -> ArtifactVersion
 *      (MATERIALIZING) -> COMPLETED through the AUTO-01C authority.
 *   B. Source preservation — source bytes/hash unchanged; never modified.
 *   C. Copy failure — staged bytes NOT copied; capture FAILED_RECOVERABLE;
 *      staged bytes retained; source untouched.
 *   D. Retry same capture — COMPLETED replay is a safe no-op; divergent
 *      identity is CONFLICT.
 *   E. Duplicate version — same artifact + same hash reuses the existing
 *      ArtifactVersion (no duplicate version); same bytes + different artifact
 *      does NOT merge identity (new artifact + new version).
 *   F. Cross-project — same bytes in a different project create a NEW
 *      ManagedArtifact/version (project identity authoritative; no merge).
 *   G. Hash mismatch after managed copy — copied bytes diverge from the staged
 *      proof; capture FAILED_RECOVERABLE; managed copy never trusted.
 *   H. Crash boundary — artifact + version exist but completion missing;
 *      resume from MATERIALIZING reuses them and completes idempotently.
 *
 * No undo UX, no Filing/Naming engine, no Revision/Package/Issue integration,
 * no adapters.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import {
  CaptureStagingService,
  sha256FileStreaming,
} from './infrastructure/managed-artifact/CaptureStagingService';
import {
  MaterializationError,
  MaterializationService,
  NodeMaterializationFs,
} from './infrastructure/managed-artifact/MaterializationService';
import type { MaterializationFsPort } from './infrastructure/managed-artifact/MaterializationService';
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

const FIXED_BASE_MS = Date.parse('2026-08-20T10:00:00.000Z');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01e1-'));
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
    return { backupId: 'bk-auto01e1-0001' };
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
    return { attemptId: 'att-auto01e1-0001' };
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
  materialize: MaterializationService;
  dataRoot: string;
}

async function makeHarness(options?: {
  fs?: MaterializationFsPort;
  managedRootOverride?: string;
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
    stabilizationPolicy: { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 200 },
  });
  const materialize = new MaterializationService({
    store: artifacts,
    captures,
    staging,
    dataRoot: dir,
    ...(options?.managedRootOverride !== undefined
      ? { managedRootOverride: options.managedRootOverride }
      : {}),
    ...(options?.fs !== undefined ? { fs: options.fs } : {}),
  });
  return { db, artifacts, contexts, captures, staging, materialize, dataRoot: dir };
}

/** Delegating materialization fs port with targeted overrides (explicit delegation, never spread). */
function delegateMaterializeFs(overrides: Partial<MaterializationFsPort>): MaterializationFsPort {
  const real = new NodeMaterializationFs();
  return {
    mkdir: (d) => (overrides.mkdir ? overrides.mkdir(d) : real.mkdir(d)),
    copyFile: (s, d) => (overrides.copyFile ? overrides.copyFile(s, d) : real.copyFile(s, d)),
    accessReadable: (p) =>
      overrides.accessReadable ? overrides.accessReadable(p) : real.accessReadable(p),
  };
}

function createContext(h: Harness, projectId: string) {
  return h.contexts.open({
    projectId,
    tool: 'AutoCAD',
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel: `autocad-${randomUUID()}`,
    openedAt: T1,
  });
}

/** Stages a real source file into the ledger (AUTO-01D), returning the capture at VERIFYING. */
async function stageRealCapture(
  h: Harness,
  projectId: string,
  sourcePath: string,
  toolContextId: string | null,
): Promise<{ captureId: string; sourceBytes: Buffer }> {
  const sourceBytes = readFileSync(sourcePath);
  const capture = h.captures.createDetectedCapture({
    projectId,
    toolContextId,
    sourcePath,
    sourceChannel: 'autocad-session-1',
    expectedArtifactType: 'LightingLayout',
    detectedAt: T1,
  });
  const staged = await h.staging.stageCapture(capture.captureId, T2);
  expect(staged.state).toBe('VERIFYING');
  return { captureId: capture.captureId, sourceBytes };
}

/** Materializes a real staged source to COMPLETED and returns capture + artifact + version. */
async function materializeRealCapture(h: Harness, projectId: string, sourcePath: string) {
  const ctx = createContext(h, projectId);
  const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
  const done = await h.materialize.materializeCapture(captureId, T3);
  expect(done.state).toBe('COMPLETED');
  const artifact = h.artifacts.getManagedArtifact(done.finalArtifactId!);
  const version = h.artifacts.getArtifactVersion(done.finalVersionId!);
  return { captureId, artifact, version };
}

// ---------------------------------------------------------------------------
// A. Happy path
// ---------------------------------------------------------------------------
describe('AUTO-01E1 Materialization foundation', () => {
  it('A1: STAGED -> ManagedArtifact -> ArtifactVersion -> COMPLETED through AUTO-01C', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'layout.dwg');
    const bytes = Buffer.from('AUTO-01E1-HAPPY-PATH');
    writeFileSync(sourcePath, bytes);

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
    const done = await h.materialize.materializeCapture(captureId, T3);

    expect(done.state).toBe('COMPLETED');
    expect(done.finalArtifactId).not.toBeNull();
    expect(done.finalVersionId).not.toBeNull();
    expect(done.completedAt).toBe(T3);

    const artifact = h.artifacts.getManagedArtifact(done.finalArtifactId!);
    expect(artifact.projectId).toBe(projectId);
    expect(artifact.artifactType).toBe('LightingLayout');
    expect(artifact.sourceTool).toBe('AutoCAD');
    expect(artifact.currentWorkingVersion).toBe(1);

    const version = h.artifacts.getArtifactVersion(done.finalVersionId!);
    expect(version.artifactId).toBe(artifact.artifactId);
    expect(version.version).toBe(1);
    expect(version.contentHash).toBe(sha256('AUTO-01E1-HAPPY-PATH'));
    expect(version.sizeBytes).toBe(bytes.length);
    expect(version.locatorKind).toBe('PROJECT_RELATIVE');
    expect(version.locatorValue).toBe(`_managed/${captureId}/source.dwg`);
    expect(version.captureId).toBe(captureId);

    // Managed bytes are a faithful copy of the staged bytes.
    const managedPath = h.materialize.managedPathFor(captureId);
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath).equals(bytes)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B. Source preservation
  // -------------------------------------------------------------------------

  it('B1: source bytes and hash are unchanged after materialization', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'preserve.dwg');
    const bytes = Buffer.from('SOURCE-MUST-NOT-CHANGE');
    writeFileSync(sourcePath, bytes);
    const beforeHash = sha256('SOURCE-MUST-NOT-CHANGE');

    const { captureId } = await materializeRealCapture(h, projectId, sourcePath);

    expect(readFileSync(sourcePath).equals(bytes)).toBe(true);
    expect(await sha256FileStreaming(sourcePath)).toBe(beforeHash);
    expect(existsSync(sourcePath)).toBe(true);

    // Staged bytes also retained (COPY, never MOVE).
    const stagedPath = h.staging.finalStagedPathFor(captureId);
    expect(existsSync(stagedPath)).toBe(true);
    expect(readFileSync(stagedPath).equals(bytes)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // C. Copy failure -> FAILED_RECOVERABLE
  // -------------------------------------------------------------------------

  it('C1: copy failure marks FAILED_RECOVERABLE and retains staged bytes', async () => {
    const fs = delegateMaterializeFs({
      copyFile: () => {
        throw new Error('simulated disk failure');
      },
    });
    const h = await makeHarness({ fs });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'copy-fail.dwg');
    const bytes = Buffer.from('COPY-FAILURE');
    writeFileSync(sourcePath, bytes);

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);

    await expect(h.materialize.materializeCapture(captureId, T3)).rejects.toBeInstanceOf(
      MaterializationError,
    );
    const entry = h.captures.get(captureId);
    expect(entry.state).toBe('FAILED_RECOVERABLE');
    expect(entry.error).toMatch(/MATERIALIZATION_COPY_FAILED/);
    // Staged bytes retained for recovery.
    expect(existsSync(h.staging.finalStagedPathFor(captureId))).toBe(true);
    // Source untouched.
    expect(readFileSync(sourcePath).equals(bytes)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // D. Retry same capture
  // -------------------------------------------------------------------------

  it('D1: COMPLETED replay is a safe idempotent no-op', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'retry.dwg');
    writeFileSync(sourcePath, 'RETRY-SAME-CAPTURE');

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
    const done = await h.materialize.materializeCapture(captureId, T3);
    expect(done.state).toBe('COMPLETED');

    const replayed = await h.materialize.materializeCapture(captureId, T4);
    expect(replayed.state).toBe('COMPLETED');
    expect(replayed.finalArtifactId).toBe(done.finalArtifactId);
    expect(replayed.finalVersionId).toBe(done.finalVersionId);
    // No duplicate artifact or version rows.
    expect(h.artifacts.listManagedArtifacts(projectId)).toHaveLength(1);
    expect(h.artifacts.listArtifactVersions(done.finalArtifactId!)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // E. Duplicate version
  // -------------------------------------------------------------------------

  it('E1: same artifact + same hash reuses the existing ArtifactVersion (no duplicate)', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'dup-version.dwg');
    writeFileSync(sourcePath, 'SAME-ARTIFACT-SAME-HASH');
    const contentHash = sha256('SAME-ARTIFACT-SAME-HASH');

    // Seed the artifact + version the capture will target (DUPLICATE_CONTENT_SAME_ARTIFACT).
    const seeded = h.artifacts.createManagedArtifact({
      projectId,
      artifactType: 'LightingLayout',
      sourceTool: 'AutoCAD',
      canonicalPath: 'WORKING/CAD/dup.dwg',
    });
    const seededVersion = h.artifacts.createArtifactVersion({
      artifactId: seeded.artifactId,
      version: 1,
      contentHash,
      locatorValue: 'WORKING/CAD/dup.dwg',
    });

    // Stage and pre-target the capture to the SAME artifact, then materialize.
    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
    // Pre-target: VERIFYING -> ADMITTED with the seeded artifact.
    h.captures.advance(captureId, T3, { finalArtifactId: seeded.artifactId });
    const done = await h.materialize.materializeCapture(captureId, T3);

    expect(done.finalArtifactId).toBe(seeded.artifactId);
    // Version is REUSED, not duplicated.
    expect(done.finalVersionId).toBe(seededVersion.versionId);
    expect(h.artifacts.listArtifactVersions(seeded.artifactId)).toHaveLength(1);
    expect(h.artifacts.listManagedArtifacts(projectId)).toHaveLength(1);
  });

  it('E2: same bytes + different artifact does NOT merge identity (new artifact + new version)', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'diff-artifact.dwg');
    writeFileSync(sourcePath, 'SAME-BYTES-DIFF-ARTIFACT');
    const contentHash = sha256('SAME-BYTES-DIFF-ARTIFACT');

    // A DIFFERENT artifact already carries these bytes.
    h.artifacts.createManagedArtifact({
      projectId,
      artifactType: 'LightingLayout',
      sourceTool: 'AutoCAD',
      canonicalPath: 'WORKING/CAD/other.dwg',
    });
    h.artifacts.createArtifactVersion({
      artifactId: h.artifacts.listManagedArtifacts(projectId)[0]!.artifactId,
      version: 1,
      contentHash,
      locatorValue: 'WORKING/CAD/other.dwg',
    });

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
    const done = await h.materialize.materializeCapture(captureId, T3);

    // A NEW ManagedArtifact was created (identity NOT merged).
    expect(h.artifacts.listManagedArtifacts(projectId)).toHaveLength(2);
    const newArtifact = h.artifacts.getManagedArtifact(done.finalArtifactId!);
    expect(newArtifact.canonicalPath).toBe(`_managed/${captureId}/source.dwg`);
    expect(h.artifacts.listArtifactVersions(newArtifact.artifactId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // F. Cross-project rejection
  // -------------------------------------------------------------------------

  it('F1: same bytes in a different project create a NEW artifact (no cross-project merge)', async () => {
    const h = await makeHarness();
    const projectA = randomUUID();
    const projectB = randomUUID();
    const sourceA = path.join(h.dataRoot, 'a.dwg');
    const sourceB = path.join(h.dataRoot, 'b.dwg');
    writeFileSync(sourceA, 'CROSS-PROJECT-BYTES');
    writeFileSync(sourceB, 'CROSS-PROJECT-BYTES');

    // Project A already has the bytes.
    const { artifact: artA, version: verA } = await materializeRealCapture(h, projectA, sourceA);

    // Project B materializes the same bytes -> NEW artifact + NEW version in B.
    const { artifact: artB, version: verB } = await materializeRealCapture(h, projectB, sourceB);

    expect(artB.artifactId).not.toBe(artA.artifactId);
    expect(artB.projectId).toBe(projectB);
    expect(verB.versionId).not.toBe(verA.versionId);
    expect(h.artifacts.listManagedArtifacts(projectA)).toHaveLength(1);
    expect(h.artifacts.listManagedArtifacts(projectB)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // G. Hash mismatch after managed copy
  // -------------------------------------------------------------------------

  it('G1: copied bytes that diverge from the proof fail closed (FAILED_RECOVERABLE)', async () => {
    const fs = delegateMaterializeFs({
      copyFile: async (_s, dest) => {
        writeFileSync(dest, 'CORRUPTED-COPY-BYTES');
      },
    });
    const h = await makeHarness({ fs });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'hash-mismatch.dwg');
    writeFileSync(sourcePath, 'ORIGINAL-BYTES');

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);

    await expect(h.materialize.materializeCapture(captureId, T3)).rejects.toBeInstanceOf(
      MaterializationError,
    );
    const entry = h.captures.get(captureId);
    expect(entry.state).toBe('FAILED_RECOVERABLE');
    expect(entry.error).toMatch(/MATERIALIZATION_HASH_MISMATCH/);
    // Staged bytes retained; source untouched.
    expect(existsSync(h.staging.finalStagedPathFor(captureId))).toBe(true);
    expect(readFileSync(sourcePath).equals(Buffer.from('ORIGINAL-BYTES'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // H. Crash boundary
  // -------------------------------------------------------------------------

  it('H1: artifact + version exist but completion missing — resume from MATERIALIZING completes idempotently', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'crash.dwg');
    writeFileSync(sourcePath, 'CRASH-BOUNDARY');

    // Drive to MATERIALIZING manually (as if a crash left the ledger mid-flight),
    // with the artifact + version already created.
    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
    const artifact = h.artifacts.createManagedArtifact({
      projectId,
      artifactType: 'LightingLayout',
      sourceTool: 'AutoCAD',
      canonicalPath: `_managed/${captureId}/source.dwg`,
    });
    const version = h.artifacts.createArtifactVersion({
      artifactId: artifact.artifactId,
      version: 1,
      contentHash: sha256('CRASH-BOUNDARY'),
      sizeBytes: Buffer.byteLength('CRASH-BOUNDARY'),
      locatorValue: `_managed/${captureId}/source.dwg`,
      captureId,
    });
    h.captures.advance(captureId, T3, { finalArtifactId: artifact.artifactId });
    h.captures.advance(captureId, T3);

    // Resume: already MATERIALIZING with artifact + version present.
    const done = await h.materialize.materializeCapture(captureId, T4);
    expect(done.state).toBe('COMPLETED');
    expect(done.finalArtifactId).toBe(artifact.artifactId);
    expect(done.finalVersionId).toBe(version.versionId);
    // No duplicate version was created on resume.
    expect(h.artifacts.listArtifactVersions(artifact.artifactId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // I. Path / boundary guards
  // -------------------------------------------------------------------------

  it('I1: canonical path is project-relative, capture-derived, and traversal-safe', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const ctx = createContext(h, projectId);
    const capture = h.captures.createDetectedCapture({
      projectId,
      toolContextId: ctx.toolContextId,
      sourcePath: path.join(h.dataRoot, 'Layout.DWG'),
      sourceChannel: 'autocad-session-1',
      expectedArtifactType: 'LightingLayout',
      detectedAt: T1,
    });
    const rel = h.materialize.canonicalPathFor(capture.captureId);
    // Project-relative, no traversal, capture-derived, sanitized extension.
    expect(rel.startsWith('_managed/')).toBe(true);
    expect(rel).toBe(`_managed/${capture.captureId}/source.dwg`);
    expect(rel).not.toMatch(/\.\./);
    const managed = h.materialize.managedPathFor(capture.captureId);
    expect(managed.startsWith(h.materialize.getManagedRoot())).toBe(true);
    expect(managed.endsWith('source.dwg')).toBe(true);
  });

  it('I2: materialization refuses an invalid (non-forward) ledger state', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'invalid-state.dwg');
    writeFileSync(sourcePath, 'INVALID-STATE');
    const ctx = createContext(h, projectId);
    const capture = h.captures.createDetectedCapture({
      projectId,
      toolContextId: ctx.toolContextId,
      sourcePath,
      sourceChannel: 'autocad-session-1',
      expectedArtifactType: 'LightingLayout',
      detectedAt: T1,
    });
    // Still DETECTED (not yet trusted/staged) -> materialization must refuse.
    await expect(h.materialize.materializeCapture(capture.captureId, T2)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});
