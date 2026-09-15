/**
 * V4-REV01A — Snapshot provenance wiring (DocumentSnapshot.sourceArtifactVersionId).
 *
 * Proves the server-derived provenance path end to end:
 *  - a DocumentSnapshot created from bytes identical to a managed
 *    ArtifactVersion in the SAME project is linked to that exact version UUID;
 *  - unmanaged documents / cross-project hashes / changed files stay NULL;
 *  - the legacy constructor (no ManagedArtifactStore) preserves NULL behavior.
 *
 * The provenance is server-derived (content-hash match is the binding rule)
 * and is never accepted from the client.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV12IssueAuditColumns,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

interface Harness {
  root: string;
  projectRoot: string;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  artifacts: ManagedArtifactStore;
  service: RevisionDeliverableService;
  project: Project;
  otherProject: Project;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createHarness(withArtifacts: boolean): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-rev01a-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const project = structuredClone(seedProjects[0]!);
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, projectRoot);
  const database = store.getSharedDatabase();
  applyV4DataDeliverableTables(database);
  const registry = new CanonicalOutputRegistryStore(database, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const artifacts = new ManagedArtifactStore(database);
  const service = withArtifacts
    ? new RevisionDeliverableService(store, registry, artifacts)
    : new RevisionDeliverableService(store, registry);
  const otherProject = structuredClone(seedProjects[1]!);
  return { root, projectRoot, store, registry, artifacts, service, project, otherProject };
}

/** Applies the v4/v13/v14/v15 DDL + compatibility columns to a shared test database. */
function applyV4DataDeliverableTables(database: DatabaseSync): void {
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV15SnapshotProvenanceColumn(database);
  applyV16SnapshotRebuild(database);
  applyV17RevisionDeleteTable(database);
  database.exec('PRAGMA foreign_keys = ON');
}

/** Registers an operational Project Document backed by a real file inside the project root. */
function addDocument(harness: Harness, relativePath: string, content: string) {
  const filePath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  const document = harness.store.operations.createDocument(harness.project.id, {
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
  return document;
}

/** Creates a ManagedArtifact + one ArtifactVersion carrying the given bytes in the given project. */
function addManagedVersion(
  harness: Harness,
  projectId: string,
  content: string,
): { artifactId: string; versionId: string; contentHash: string } {
  const artifact = harness.artifacts.createManagedArtifact({
    projectId,
    artifactType: 'Drawing',
    sourceTool: 'AutoCAD',
    canonicalPath: `_managed/rev01a/${projectId.slice(0, 8)}/source.pdf`,
  });
  const contentHash = sha256(content);
  const version = harness.artifacts.createArtifactVersion({
    artifactId: artifact.artifactId,
    version: 1,
    contentHash,
    sizeBytes: Buffer.byteLength(content),
    locatorKind: 'PROJECT_RELATIVE',
    locatorValue: artifact.canonicalPath,
  });
  return { artifactId: artifact.artifactId, versionId: version.versionId, contentHash };
}

describe('REV-01A DocumentSnapshot provenance wiring', () => {
  it('links a snapshot to the matching managed ArtifactVersion (same project, identical bytes)', async () => {
    const harness = createHarness(true);
    const bytes = 'managed-layout-pdf-bytes';
    const { versionId } = addManagedVersion(harness, harness.project.id, bytes);
    const document = addDocument(harness, 'Drawings/Layout-A.pdf', bytes);
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBe(versionId);
    // The snapshot bytes and the version bytes are the same immutable proof.
    expect(snapshot.contentHash).toBe(sha256(bytes));
  });

  it('keeps provenance NULL for an unmanaged document (no matching ArtifactVersion)', async () => {
    const harness = createHarness(true);
    const document = addDocument(harness, 'Drawings/Manual.pdf', 'manual-intake-bytes');
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBeNull();
  });

  it('never links across projects (same hash in another project stays NULL)', async () => {
    const harness = createHarness(true);
    const bytes = 'shared-bytes';
    addManagedVersion(harness, harness.otherProject.id, bytes);
    const document = addDocument(harness, 'Drawings/Shared.pdf', bytes);
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBeNull();
  });

  it('never links a changed file (version hash A, snapshot bytes B)', async () => {
    const harness = createHarness(true);
    addManagedVersion(harness, harness.project.id, 'original-bytes');
    const document = addDocument(harness, 'Drawings/Changed.pdf', 'changed-bytes');
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBeNull();
    expect(snapshot.contentHash).toBe(sha256('changed-bytes'));
  });

  it('preserves legacy behavior when constructed without the ManagedArtifactStore', async () => {
    const harness = createHarness(false);
    const bytes = 'managed-bytes';
    const { versionId } = addManagedVersion(harness, harness.project.id, bytes);
    expect(versionId).toBeTruthy();
    const document = addDocument(harness, 'Drawings/Legacy.pdf', bytes);
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    // Legacy constructor: provenance stays NULL even when a version exists.
    expect(snapshot.sourceArtifactVersionId).toBeNull();
  });
});
