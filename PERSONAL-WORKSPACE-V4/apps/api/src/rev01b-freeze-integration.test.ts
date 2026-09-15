/**
 * V4-REV01B — Freeze integration (Revision FINALIZED -> ManagedArtifact FROZEN).
 *
 * Proves the immutable boundary end to end through the REAL service + store
 * authority (real temp files + deterministic clock):
 *   A. FINALIZED Revision freezes the artifact referenced by its immutable
 *      Document Snapshot (status FROZEN, freeze stamp == finalization stamp).
 *   B. A PREPARING Revision does NOT freeze — snapshot creation leaves the
 *      artifact ACTIVE and removable.
 *   C. Multiple snapshots referencing the same artifact version freeze the
 *      artifact exactly once (DISTINCT discovery).
 *   D. Undo before freeze succeeds: ACTIVE artifact, capture COMPLETED,
 *      managed file archived, hash-verified.
 *   E. Undo after freeze is denied (INVALID_TRANSITION 409); no archive move,
 *      ledger unchanged, version untouched.
 *   F. A FROZEN artifact cannot create a new ArtifactVersion and can never
 *      return to ACTIVE (domain authority).
 *   G. Package flow unchanged — an Issue Package can still be created for a
 *      FINALIZED Revision whose artifact is frozen.
 *
 * No schema change (v15), no web-v4, no AUTO-01A/B/C/D/E1/E2A behavior
 * change. Freeze discovery is revision_document_snapshots ->
 * source_artifact_version_id -> artifact_versions -> managed_artifacts
 * (never a ProjectDocument mapping).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@scli/config';
import { canTransitionManagedArtifact, transitionManagedArtifact } from '@scli/domain';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { ToolContextService } from './infrastructure/managed-artifact/ToolContextService';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import { CaptureStagingService } from './infrastructure/managed-artifact/CaptureStagingService';
import { MaterializationService } from './infrastructure/managed-artifact/MaterializationService';
import type { MaterializationFsPort } from './infrastructure/managed-artifact/MaterializationService';
import { UndoArchiveService } from './infrastructure/managed-artifact/UndoArchiveService';
import type { UndoArchiveFsPort } from './infrastructure/managed-artifact/UndoArchiveService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService';
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

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

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
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-rev01b-'));
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
    return { backupId: 'bk-rev01b-0001' };
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
    return { attemptId: 'att-rev01b-0001' };
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
  root: string;
  projectRoot: string;
  store: PersonalWorkspaceStore;
  artifacts: ManagedArtifactStore;
  captures: CaptureLedgerService;
  staging: CaptureStagingService;
  materialize: MaterializationService;
  undo: UndoArchiveService;
  registry: CanonicalOutputRegistryStore;
  deliverables: RevisionDeliverableService;
  packages: CanonicalIssuePackageService;
  project: Project;
}

async function makeHarness(options?: {
  fs?: MaterializationFsPort;
  undoFs?: UndoArchiveFsPort;
}): Promise<Harness> {
  const root = newTempDir();
  const dbPath = path.join(root, 'scli.sqlite');
  const empty = new DatabaseSync(dbPath);
  empty.close();
  await new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS,
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(root),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  }).run(dbPath);
  const config = makeConfig(dbPath);
  const db = new DatabaseSync(dbPath);
  openHandles.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openStores.push(provider, store);

  const project = structuredClone(seedProjects[0]!);
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  store.setFolderPath(project.id, projectRoot);

  const artifacts = new ManagedArtifactStore(db);
  const captures = new CaptureLedgerService(artifacts);
  const staging = new CaptureStagingService({
    store: artifacts,
    captures,
    dataRoot: root,
    stabilizationPolicy: { requiredStableSamples: 2, sampleIntervalMs: 1, timeoutMs: 200 },
  });
  const materialize = new MaterializationService({
    store: artifacts,
    captures,
    staging,
    dataRoot: root,
    ...(options?.fs !== undefined ? { fs: options.fs } : {}),
  });
  const undo = new UndoArchiveService({
    store: artifacts,
    captures,
    materialize,
    dataRoot: root,
    ...(options?.undoFs !== undefined ? { fs: options.undoFs } : {}),
  });
  const registry = new CanonicalOutputRegistryStore(db, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const deliverables = new RevisionDeliverableService(store, registry, artifacts);
  const packages = new CanonicalIssuePackageService(
    store,
    registry,
    () => new Date(FIXED_BASE_MS + 10_000),
  );
  return {
    db,
    root,
    projectRoot,
    store,
    artifacts,
    captures,
    staging,
    materialize,
    undo,
    registry,
    deliverables,
    packages,
    project,
  };
}

/** Real capture pipeline: stages + materializes a source file to COMPLETED. */
async function materializeCapture(
  h: Harness,
  projectId: string,
  sourcePath: string,
): Promise<{ captureId: string; artifactId: string; versionId: string }> {
  const context = new ToolContextService(h.artifacts).open({
    projectId,
    tool: 'AutoCAD',
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel: `autocad-${randomUUID()}`,
    openedAt: T1,
  });
  const capture = h.captures.createDetectedCapture({
    projectId,
    toolContextId: context.toolContextId,
    sourcePath,
    sourceChannel: 'autocad-session-1',
    expectedArtifactType: 'LightingLayout',
    detectedAt: T1,
  });
  const staged = await h.staging.stageCapture(capture.captureId, T2);
  expect(staged.state).toBe('VERIFYING');
  const done = await h.materialize.materializeCapture(capture.captureId, T3);
  expect(done.state).toBe('COMPLETED');
  return {
    captureId: capture.captureId,
    artifactId: done.finalArtifactId!,
    versionId: done.finalVersionId!,
  };
}

/** Registers an operational Project Document backed by a real file. */
function addDocument(h: Harness, relativePath: string, content: string) {
  const filePath = path.join(h.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return h.store.operations.createDocument(h.project.id, {
    category: 'Drawing',
    documentNumber: '',
    title: relativePath,
    revision: 'A',
    status: 'Working',
    filePath: relativePath,
    issuedTo: '',
    issueDate: null,
    notes: '',
  });
}

/** Prepares a manual Revision and adds an immutable Document Snapshot from the given bytes. */
async function addSnapshot(
  h: Harness,
  relativePath: string,
  content: string,
): Promise<{ revisionId: string; deliverableId: string }> {
  const document = addDocument(h, relativePath, content);
  const revision = h.deliverables.prepareRevision(
    h.project,
    h.store.getWorkspace(h.project.id),
    actor,
  );
  const snapshot = await h.deliverables.createDocumentSnapshot(
    h.project,
    h.store.getWorkspace(h.project.id),
    actor,
    revision.revisionId,
    { sourceDocumentId: document.id },
  );
  return { revisionId: revision.revisionId, deliverableId: snapshot.deliverableId };
}

// ---------------------------------------------------------------------------
// A. FINALIZED Revision freezes the artifact
// ---------------------------------------------------------------------------

describe('REV-01B freeze integration', () => {
  it('A1: finalizing a Revision freezes the artifact referenced by its snapshot', async () => {
    const h = await makeHarness();
    const bytes = 'frozen-layout-bytes';
    const { artifactId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    const { revisionId } = await addSnapshot(h, 'Drawings/Layout-A.dwg', bytes);

    const finalized = await h.deliverables.finalizeRevision(h.project, revisionId);

    expect(finalized.lifecycleState).toBe('FINALIZED');
    expect(finalized.finalizedAt).toBeTruthy();
    const artifact = h.artifacts.getManagedArtifact(artifactId);
    expect(artifact.status).toBe('FROZEN');
    // The freeze stamp equals the persisted finalization stamp.
    expect(artifact.updatedAt).toBe(finalized.finalizedAt);
  });

  it('A2: a snapshot whose bytes match a managed version links and freezes through provenance', async () => {
    const h = await makeHarness();
    const bytes = 'linked-bytes';
    const { versionId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    const { revisionId, deliverableId } = await addSnapshot(h, 'Drawings/Linked.dwg', bytes);
    const snapshot = h.registry.getDocumentSnapshot(deliverableId);
    expect(snapshot.sourceArtifactVersionId).toBe(versionId);

    await h.deliverables.finalizeRevision(h.project, revisionId);
    const version = h.artifacts.getArtifactVersion(snapshot.sourceArtifactVersionId!);
    expect(h.artifacts.getManagedArtifact(version.artifactId).status).toBe('FROZEN');
  });

  // -------------------------------------------------------------------------
  // B. PREPARING does not freeze
  // -------------------------------------------------------------------------

  it('B1: creating a snapshot while PREPARING leaves the artifact ACTIVE', async () => {
    const h = await makeHarness();
    const bytes = 'preparing-bytes';
    const { artifactId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    await addSnapshot(h, 'Drawings/Preparing.dwg', bytes);

    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('ACTIVE');
  });

  // -------------------------------------------------------------------------
  // C. Multiple snapshots, same artifact — freeze once
  // -------------------------------------------------------------------------

  it('C1: two snapshots referencing the same artifact freeze it exactly once', async () => {
    const h = await makeHarness();
    const bytes = 'shared-bytes';
    const { artifactId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    // Two distinct source documents carrying identical bytes — both snapshots
    // bind to the same ArtifactVersion (hash proof), so discovery must dedupe.
    const docA = addDocument(h, 'Drawings/A.dwg', bytes);
    const docB = addDocument(h, 'Drawings/B.dwg', bytes);
    const revisionA = h.deliverables.prepareRevision(
      h.project,
      h.store.getWorkspace(h.project.id),
      actor,
    );
    await h.deliverables.createDocumentSnapshot(
      h.project,
      h.store.getWorkspace(h.project.id),
      actor,
      revisionA.revisionId,
      { sourceDocumentId: docA.id },
    );
    await h.deliverables.createDocumentSnapshot(
      h.project,
      h.store.getWorkspace(h.project.id),
      actor,
      revisionA.revisionId,
      { sourceDocumentId: docB.id },
    );

    const freeze = vi.spyOn(h.artifacts, 'freezeManagedArtifact');
    await h.deliverables.finalizeRevision(h.project, revisionA.revisionId);

    expect(freeze).toHaveBeenCalledTimes(1);
    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('FROZEN');
  });

  // -------------------------------------------------------------------------
  // D. Undo before freeze
  // -------------------------------------------------------------------------

  it('D1: undo succeeds while the artifact is still ACTIVE (pre-finalization)', async () => {
    const h = await makeHarness();
    const bytes = 'undo-before-freeze';
    const { captureId, artifactId, versionId } = await materializeCapture(
      h,
      h.project.id,
      writeBytes(h, bytes),
    );
    const managedPath = h.materialize.managedPathFor(captureId);
    const archivePath = h.undo.archivePathFor(captureId);
    expect(existsSync(managedPath)).toBe(true);
    expect(existsSync(archivePath)).toBe(false);

    const archived = await h.undo.undoCapture(captureId, T4);

    expect(archived.artifactId).toBe(artifactId);
    expect(archived.status).toBe('ARCHIVED');
    const entry = h.captures.get(captureId);
    expect(entry.state).toBe('COMPLETED');
    expect(entry.finalVersionId).toBe(versionId);
    expect(existsSync(managedPath)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // E. Undo after freeze
  // -------------------------------------------------------------------------

  it('E1: undo after freeze is denied (INVALID_TRANSITION 409), nothing moves', async () => {
    const h = await makeHarness();
    const bytes = 'frozen-undo-bytes';
    const { captureId, artifactId } = await materializeCapture(
      h,
      h.project.id,
      writeBytes(h, bytes),
    );
    const { revisionId } = await addSnapshot(h, 'Drawings/Frozen.dwg', bytes);
    await h.deliverables.finalizeRevision(h.project, revisionId);

    const managedPath = h.materialize.managedPathFor(captureId);
    const archivePath = h.undo.archivePathFor(captureId);

    await expect(h.undo.undoCapture(captureId, T4)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      statusCode: 409,
    });

    // No archive move, ledger unchanged, version untouched.
    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('FROZEN');
    expect(existsSync(managedPath)).toBe(true);
    expect(existsSync(archivePath)).toBe(false);
    const entry = h.captures.get(captureId);
    expect(entry.state).toBe('COMPLETED');
  });

  // -------------------------------------------------------------------------
  // F. FROZEN artifact cannot create a new version / return ACTIVE
  // -------------------------------------------------------------------------

  it('F1: a FROZEN artifact rejects a new ArtifactVersion (CONFLICT 409)', async () => {
    const h = await makeHarness();
    const bytes = 'frozen-version-bytes';
    const { artifactId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    const { revisionId } = await addSnapshot(h, 'Drawings/Frozen.dwg', bytes);
    await h.deliverables.finalizeRevision(h.project, revisionId);

    // createArtifactVersion throws synchronously, so the rejection must be
    // observed through a promise wrap.
    await expect(
      Promise.resolve().then(() =>
        h.artifacts.createArtifactVersion({
          artifactId,
          version: 2,
          contentHash: sha256('new-bytes'),
          sizeBytes: 8,
          locatorKind: 'PROJECT_RELATIVE',
          locatorValue: '_managed/next/source.pdf',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

    // Existing version rows remain immutable.
    const versions = h.artifacts.listArtifactVersions(artifactId);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.version).toBe(1);
  });

  it('F2: a FROZEN artifact can never transition back to ACTIVE (domain authority)', () => {
    const artifact = {
      artifactId: randomUUID(),
      projectId: randomUUID(),
      artifactType: 'Drawing',
      sourceTool: 'AutoCAD',
      canonicalPath: '_managed/x/source.pdf',
      status: 'FROZEN' as const,
      currentWorkingVersion: 1,
      projectDocumentId: null,
      createdAt: T1,
      updatedAt: T3,
    };
    expect(
      // canTransitionManagedArtifact is re-exported by the domain package.
      canTransitionManagedArtifact('FROZEN', 'ACTIVE'),
    ).toBe(false);
    expect(() => transitionManagedArtifact(artifact, 'ACTIVE', T4)).toThrow('not allowed');
  });

  // -------------------------------------------------------------------------
  // G. Package flow unchanged
  // -------------------------------------------------------------------------

  it('G1: an Issue Package can still be created for a FINALIZED frozen Revision', async () => {
    const h = await makeHarness();
    const bytes = 'package-bytes';
    const { artifactId } = await materializeCapture(h, h.project.id, writeBytes(h, bytes));
    const { revisionId, deliverableId } = await addSnapshot(h, 'Drawings/Pkg.dwg', bytes);
    await h.deliverables.finalizeRevision(h.project, revisionId);

    const record = await h.packages.create(
      h.project,
      h.store.getWorkspace(h.project.id),
      actor,
      {
        revisionNumber: 1,
        reissueNumber: 0,
        label: 'REV_01 Freeze Package',
        status: 'Draft' as const,
        outputMode: 'Folder' as const,
        relativeOutputFolder: 'ISSUED/REV_01_FREEZE',
        selectedItemIds: [deliverableId],
        warningOverrideReason: '',
      },
      [],
    );

    expect(record.id).toBeTruthy();
    const members = h.registry.listPackageDeliverables(record.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.sourceType).toBe('DocumentSnapshot');
    expect(members[0]!.sourceId).toBe(deliverableId);
    // Freeze untouched by the package path.
    expect(h.artifacts.getManagedArtifact(artifactId).status).toBe('FROZEN');
    expect(h.registry.getRevision(revisionId).lifecycleState).toBe('FINALIZED');
  });
});

// ---------------------------------------------------------------------------
// Local helpers (top-level functions used above)
// ---------------------------------------------------------------------------

function writeBytes(h: Harness, content: string): string {
  const sourcePath = path.join(h.root, `${randomUUID()}.dwg`);
  writeFileSync(sourcePath, content);
  return sourcePath;
}
