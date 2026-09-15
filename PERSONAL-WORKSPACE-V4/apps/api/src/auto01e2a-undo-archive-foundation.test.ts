/**
 * AUTO-01E2A — Undo / Archive foundation (API/service reality gate).
 *
 * Proves the safe undo of a COMPLETED materialized capture BEFORE immutable
 * downstream references exist, through the REAL service + store authority
 * (real temp files + targeted failure injection):
 *   A. Undo success — capture stays COMPLETED, artifact ACTIVE -> ARCHIVED,
 *      version untouched, managed file moved to the archive root, archived
 *      bytes hash-verified against the immutable ArtifactVersion proof.
 *   B. Undo forbidden after a Revision Document Snapshot references the
 *      final version (CONFLICT; artifact stays ACTIVE; file not moved).
 *   C. Undo forbidden for a non-COMPLETED capture.
 *   D. Already-ARCHIVED retry — safe no-op, no duplicate move.
 *   E. Move failure — typed UNDO_MOVE_FAILED; artifact stays ACTIVE; managed
 *      file retained; retry possible.
 *   F. DB failure after move — archive file already durable; retry completes
 *      the ACTIVE -> ARCHIVED transition safely (crash Case A).
 *   G. ArtifactVersion immutability — hash / locator / captureId / identity
 *      unchanged across undo.
 *   H. Source preservation — the original source file is never touched.
 *
 * No undo UI, no API route, no RBAC, no Revision/Package/Issue integration,
 * no restore-from-archive, no v16.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { MaterializationService } from './infrastructure/managed-artifact/MaterializationService';
import type { MaterializationFsPort } from './infrastructure/managed-artifact/MaterializationService';
import {
  UndoArchiveError,
  UndoArchiveService,
  NodeUndoArchiveFs,
} from './infrastructure/managed-artifact/UndoArchiveService';
import type { UndoArchiveFsPort } from './infrastructure/managed-artifact/UndoArchiveService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
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

const FIXED_BASE_MS = Date.parse('2026-08-20T12:00:00.000Z');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01e2a-'));
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
    return { backupId: 'bk-auto01e2a-0001' };
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
    return { attemptId: 'att-auto01e2a-0001' };
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
  undo: UndoArchiveService;
  registry: CanonicalOutputRegistryStore;
  dataRoot: string;
}

async function makeHarness(options?: {
  fs?: MaterializationFsPort;
  undoFs?: UndoArchiveFsPort;
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
    ...(options?.fs !== undefined ? { fs: options.fs } : {}),
  });
  const undo = new UndoArchiveService({
    store: artifacts,
    captures,
    materialize,
    dataRoot: dir,
    ...(options?.undoFs !== undefined ? { fs: options.undoFs } : {}),
  });
  const registry = new CanonicalOutputRegistryStore(db, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  return { db, artifacts, contexts, captures, staging, materialize, undo, registry, dataRoot: dir };
}

/** Delegating undo fs port with targeted overrides (explicit delegation, never spread). */
function delegateUndoFs(overrides: Partial<UndoArchiveFsPort>): UndoArchiveFsPort {
  const real = new NodeUndoArchiveFs();
  return {
    exists: (p) => (overrides.exists ? overrides.exists(p) : real.exists(p)),
    rename: (s, d) => (overrides.rename ? overrides.rename(s, d) : real.rename(s, d)),
    mkdir: (d) => (overrides.mkdir ? overrides.mkdir(d) : real.mkdir(d)),
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
): Promise<{ captureId: string }> {
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
  return { captureId: capture.captureId };
}

/** Materializes a real staged source to COMPLETED and returns capture + artifact + version. */
async function materializeRealCapture(
  h: Harness,
  projectId: string,
  sourcePath: string,
): Promise<{ captureId: string; artifactId: string; versionId: string; sourceBytes: Buffer }> {
  const ctx = createContext(h, projectId);
  const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);
  const sourceBytes = readFileSync(sourcePath);
  const done = await h.materialize.materializeCapture(captureId, T3);
  expect(done.state).toBe('COMPLETED');
  const artifact = h.artifacts.getManagedArtifact(done.finalArtifactId!);
  const version = h.artifacts.getArtifactVersion(done.finalVersionId!);
  return {
    captureId,
    artifactId: artifact.artifactId,
    versionId: version.versionId,
    sourceBytes,
  };
}

/** Direct seed of a project_documents row (same pattern as AUTO-01A reality gate). */
function insertProjectDocument(
  db: DatabaseSyncInstance,
  id: string,
  projectId: string,
  title: string,
): void {
  db.prepare(
    `INSERT INTO project_documents
     (id, project_id, category, document_number, title, revision, status, file_path,
      issued_to, issue_date, notes, created_at, updated_at)
     VALUES (?, ?, 'Drawing', 'DOC', ?, 'A', 'Working', ?, '', NULL, '', ?, ?)`,
  ).run(id, projectId, title, `Drawings/${title}.pdf`, T1, T1);
}

/** Seeds a PREPARING canonical Revision + a Document Snapshot referencing the given version. */
function seedSnapshotReference(
  h: Harness,
  projectId: string,
  sourceDocumentId: string,
  versionId: string,
): void {
  const revision = h.registry.createRevision({
    projectId,
    projectSnapshot: {
      id: projectId,
      projectCode: `PRJ-${randomUUID().slice(0, 8).toUpperCase()}`,
      projectName: 'E2A Freeze Project',
      clientName: 'Freeze Client',
      projectType: 'Lighting Layout',
      status: 'Active',
      updatedAt: T1,
      canonicalOperation: 'MANUAL_DELIVERABLES',
    },
    luminaires: [],
    createdBy: { actorId: randomUUID(), actorNameSnapshot: 'Local Admin' },
  });
  h.registry.createDocumentSnapshot({
    projectId,
    revisionId: revision.revisionId,
    sourceDocumentId,
    category: 'Drawing',
    title: 'Frozen Layout',
    fileName: 'Frozen.pdf',
    sourceRelativePath: 'Drawings/Frozen.pdf',
    locatorValue: 'DELIVERABLES/REV_01/Frozen.pdf',
    contentHash: sha256('frozen-bytes'),
    sizeBytes: 100,
    createdBy: null,
    sourceArtifactVersionId: versionId,
  });
}

// ---------------------------------------------------------------------------
// A. Undo success
// ---------------------------------------------------------------------------

describe('AUTO-01E2A Undo / Archive foundation', () => {
  it('A1: undo archives the managed file, ARCHIVEs the artifact, keeps the capture COMPLETED', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'layout.dwg');
    const bytes = Buffer.from('AUTO-01E2A-UNDO-HAPPY-PATH');
    writeFileSync(sourcePath, bytes);

    const { captureId, artifactId, versionId } = await materializeRealCapture(
      h,
      projectId,
      sourcePath,
    );
    const managedPath = h.materialize.managedPathFor(captureId);
    const archivePath = h.undo.archivePathFor(captureId);
    expect(existsSync(managedPath)).toBe(true);
    expect(existsSync(archivePath)).toBe(false);

    const archived = await h.undo.undoCapture(captureId, T4);

    // ManagedArtifact ACTIVE -> ARCHIVED.
    expect(archived.artifactId).toBe(artifactId);
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.currentWorkingVersion).toBe(1);

    // CaptureLedger remains COMPLETED with final identities intact.
    const entry = h.captures.get(captureId);
    expect(entry.state).toBe('COMPLETED');
    expect(entry.finalArtifactId).toBe(artifactId);
    expect(entry.finalVersionId).toBe(versionId);
    expect(entry.completedAt).toBe(T3);

    // File moved from managed root to the archive root.
    expect(existsSync(managedPath)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);
    expect(readFileSync(archivePath).equals(bytes)).toBe(true);
  });

  it('A2: the archived file hash matches the immutable ArtifactVersion proof', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'hash-check.dwg');
    const bytes = Buffer.from('AUTO-01E2A-HASH-VERIFY');
    writeFileSync(sourcePath, bytes);

    const { captureId } = await materializeRealCapture(h, projectId, sourcePath);
    await h.undo.undoCapture(captureId, T4);

    const entry = h.captures.get(captureId);
    const version = h.artifacts.getArtifactVersion(entry.finalVersionId!);
    const archivedBytes = readFileSync(h.undo.archivePathFor(captureId));
    expect(sha256(archivedBytes.toString('utf8'))).toBe(version.contentHash);
    expect(archivedBytes.equals(bytes)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B. Forbidden after an immutable reference
  // -------------------------------------------------------------------------

  it('B1: undo is CONFLICT when a revision snapshot references the final version', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'frozen.dwg');
    writeFileSync(sourcePath, 'FROZEN-BYTES');

    const { captureId, artifactId, versionId } = await materializeRealCapture(
      h,
      projectId,
      sourcePath,
    );
    const docId = randomUUID();
    insertProjectDocument(h.db, docId, projectId, 'Frozen Doc');
    seedSnapshotReference(h, projectId, docId, versionId);

    const managedPath = h.materialize.managedPathFor(captureId);
    const archivePath = h.undo.archivePathFor(captureId);

    await expect(h.undo.undoCapture(captureId, T4)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // Artifact remains ACTIVE; nothing moved.
    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('ACTIVE');
    expect(existsSync(managedPath)).toBe(true);
    expect(existsSync(archivePath)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // C. Forbidden for a non-COMPLETED capture
  // -------------------------------------------------------------------------

  it('C1: undo rejects a capture that never completed (VERIFYING)', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'not-completed.dwg');
    writeFileSync(sourcePath, 'NOT-COMPLETED');

    const ctx = createContext(h, projectId);
    const { captureId } = await stageRealCapture(h, projectId, sourcePath, ctx.toolContextId);

    await expect(h.undo.undoCapture(captureId, T4)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    // No filesystem side effects.
    expect(existsSync(h.undo.archivePathFor(captureId))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // D. Already-archived retry
  // -------------------------------------------------------------------------

  it('D1: an already-ARCHIVED artifact undo is a safe no-op (no duplicate move)', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'retry.dwg');
    writeFileSync(sourcePath, 'RETRY-UNDO');

    const { captureId, artifactId } = await materializeRealCapture(h, projectId, sourcePath);
    const archived = await h.undo.undoCapture(captureId, T3);
    expect(archived.status).toBe('ARCHIVED');

    const archivePath = h.undo.archivePathFor(captureId);
    const managedPath = h.materialize.managedPathFor(captureId);
    const archivedAgain = await h.undo.undoCapture(captureId, T4);

    expect(archivedAgain.status).toBe('ARCHIVED');
    expect(archivedAgain.artifactId).toBe(artifactId);
    expect(existsSync(archivePath)).toBe(true);
    expect(existsSync(managedPath)).toBe(false);
    // Exactly one archived file remains (no duplicate move).
    const archiveDir = path.dirname(archivePath);
    const files = readdirSync(archiveDir).filter((f) => !f.startsWith('.'));
    expect(files).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // E. Move failure
  // -------------------------------------------------------------------------

  it('E1: a rename failure leaves ACTIVE with a typed error and the managed file intact', async () => {
    const h = await makeHarness({
      undoFs: delegateUndoFs({
        rename: () => {
          throw new Error('simulated archive move failure');
        },
      }),
    });
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'move-fail.dwg');
    const bytes = Buffer.from('MOVE-FAILURE');
    writeFileSync(sourcePath, bytes);

    const { captureId, artifactId } = await materializeRealCapture(h, projectId, sourcePath);
    const managedPath = h.materialize.managedPathFor(captureId);

    await expect(h.undo.undoCapture(captureId, T4)).rejects.toBeInstanceOf(UndoArchiveError);
    await expect(h.undo.undoCapture(captureId, T4)).rejects.toMatchObject({
      code: 'UNDO_MOVE_FAILED',
    });

    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('ACTIVE');
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath).equals(bytes)).toBe(true);
    expect(existsSync(h.undo.archivePathFor(captureId))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // F. DB failure after move (crash Case A)
  // -------------------------------------------------------------------------

  it('F1: a DB failure after the move is recovered by re-running undo', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'crash-a.dwg');
    writeFileSync(sourcePath, 'CRASH-AFTER-MOVE');

    const { captureId, artifactId } = await materializeRealCapture(h, projectId, sourcePath);
    const managedPath = h.materialize.managedPathFor(captureId);
    const archivePath = h.undo.archivePathFor(captureId);

    // Simulate the DB update failing AFTER the file was moved.
    const spy = vi.spyOn(h.artifacts, 'archiveManagedArtifact');
    spy.mockImplementationOnce(() => {
      throw new Error('simulated DB failure');
    });

    await expect(h.undo.undoCapture(captureId, T4)).rejects.toThrow(/simulated DB failure/);

    // File was moved; DB was not updated.
    expect(existsSync(managedPath)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);
    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('ACTIVE');

    // Retry: archive already present -> verify hash -> complete the transition.
    const recovered = await h.undo.undoCapture(captureId, T4);
    expect(recovered.status).toBe('ARCHIVED');
    expect(existsSync(archivePath)).toBe(true);
    expect(existsSync(managedPath)).toBe(false);
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // G. ArtifactVersion immutability
  // -------------------------------------------------------------------------

  it('G1: the ArtifactVersion is byte-for-byte unchanged across undo', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'immutable.dwg');
    const bytes = Buffer.from('IMMUTABLE-VERSION');
    writeFileSync(sourcePath, bytes);

    const { captureId, versionId } = await materializeRealCapture(h, projectId, sourcePath);
    const before = h.artifacts.getArtifactVersion(versionId);

    await h.undo.undoCapture(captureId, T4);

    const after = h.artifacts.getArtifactVersion(versionId);
    expect(after).toEqual(before);
    expect(after.contentHash).toBe(sha256('IMMUTABLE-VERSION'));
    expect(after.locatorKind).toBe('PROJECT_RELATIVE');
    expect(after.captureId).toBe(captureId);
    // The locator still points at the ORIGINAL managed path (history as-of-creation).
    expect(after.locatorValue).toBe(`_managed/${captureId}/source.dwg`);
  });

  // -------------------------------------------------------------------------
  // H. Source preservation
  // -------------------------------------------------------------------------

  it('H1: the original source file is never touched by undo', async () => {
    const h = await makeHarness();
    const projectId = randomUUID();
    const sourcePath = path.join(h.dataRoot, 'source-preserve.dwg');
    const bytes = Buffer.from('SOURCE-PRESERVED-UNDO');
    writeFileSync(sourcePath, bytes);
    const beforeHash = sha256('SOURCE-PRESERVED-UNDO');

    const { captureId } = await materializeRealCapture(h, projectId, sourcePath);
    await h.undo.undoCapture(captureId, T4);

    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath).equals(bytes)).toBe(true);
    const after = await sha256FileStreaming(sourcePath);
    expect(after).toBe(beforeHash);
  });
});
