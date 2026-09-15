/**
 * PACKAGES-E2E-02 — registered ProjectDocument snapshot source.
 *
 * An explicitly registered same-project ProjectDocument may be used as a
 * DocumentSnapshot source even when its persisted path is an absolute external
 * path (e.g. OneDrive outside the connected project root). The source is read
 * ONLY; the snapshot is created inside canonical project-controlled storage.
 *
 * These tests pin the source-resolution seam in RevisionDeliverableService:
 *  - project-relative registered sources still resolve under projectRoot with
 *    containment enforcement;
 *  - same-project absolute external sources resolve verbatim (not rebased);
 *  - the source is never moved/renamed/deleted, and its bytes are unchanged;
 *  - the snapshot locator stays canonical / project-relative;
 *  - missing / directory / cross-project / forged-path / partial-cleanup
 *    failures reject truthfully.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { createRevisionDocumentSnapshotSchema } from '@scli/contracts';
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
  artifacts: ManagedArtifactStore | undefined;
  service: RevisionDeliverableService;
  project: Project;
  otherProject: Project;
}

function createHarness(withArtifacts = false): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e02-'));
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
  const artifacts = withArtifacts ? new ManagedArtifactStore(database) : undefined;
  const service = new RevisionDeliverableService(store, registry, artifacts);
  const otherProject = structuredClone(seedProjects[1]!);
  return { root, projectRoot, store, registry, artifacts, service, project, otherProject };
}

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

/** Registers a Project Document whose persisted filePath points at an existing file. */
function registerDocument(harness: Harness, filePath: string, content: string, projectId?: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return harness.store.operations.createDocument(projectId ?? harness.project.id, {
    category: 'Drawing',
    documentNumber: '',
    title: path.basename(filePath),
    revision: 'A',
    status: 'Working',
    filePath,
    issuedTo: '',
    issueDate: null,
    notes: '',
  });
}

async function prepare(harness: Harness) {
  return harness.service.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
  );
}

describe('PACKAGES-E2E-02 registered ProjectDocument snapshot source', () => {
  it('1. project-relative registered ProjectDocument still snapshots successfully', async () => {
    const harness = createHarness();
    const document = registerDocument(
      harness,
      path.join(harness.projectRoot, 'Drawings', 'Layout-A.pdf'),
      'layout-bytes',
    );
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceDocumentId).toBe(document.id);
    expect(snapshot.locatorKind).toBe('PROJECT_RELATIVE');
    expect(snapshot.locatorValue.startsWith('DELIVERABLES/')).toBe(true);
    // sourceRelativePath is normalized to forward slashes.
    expect(snapshot.sourceRelativePath).toBe('Drawings/Layout-A.pdf');
  });

  it('2. same-project absolute external ProjectDocument snapshots successfully', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Lighting_Layout.pdf');
    const document = registerDocument(harness, external, 'external-layout-bytes');
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceDocumentId).toBe(document.id);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.sizeBytes).toBeGreaterThan(0);
    expect(snapshot.locatorKind).toBe('PROJECT_RELATIVE');
    expect(snapshot.locatorValue.startsWith('DELIVERABLES/')).toBe(true);
  });

  it('3. external source file remains unchanged after snapshot', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Report.pdf');
    const bytes = 'unchanged-external-bytes';
    const document = registerDocument(harness, external, bytes);
    const revision = await prepare(harness);

    await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(existsSync(external)).toBe(true);
    expect(readFileSync(external, 'utf8')).toBe(bytes);
  });

  it('4. snapshot file is created inside canonical project-controlled storage', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Layout.pdf');
    const document = registerDocument(harness, external, 'bytes');
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    const snapshotPath = path.join(harness.projectRoot, snapshot.locatorValue);
    expect(existsSync(snapshotPath)).toBe(true);
    expect(snapshotPath.startsWith(harness.projectRoot)).toBe(true);
  });

  it('5. snapshot locator remains canonical / project-relative', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Layout.pdf');
    const document = registerDocument(harness, external, 'bytes');
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.locatorKind).toBe('PROJECT_RELATIVE');
    expect(snapshot.locatorValue).not.toContain('OneDrive');
    expect(snapshot.locatorValue).not.toContain(harness.root);
  });

  it('6. nonexistent absolute registered source rejects', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Missing.pdf');
    const document = registerDocument(harness, external, 'x');
    rmSync(external);
    const revision = await prepare(harness);

    await expect(
      harness.service.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: document.id },
      ),
    ).rejects.toThrow(/missing/);
  });

  it('7. external directory path (not regular file) rejects', async () => {
    const harness = createHarness();
    const dirPath = path.join(harness.root, 'OneDrive', 'Folder.pdf');
    mkdirSync(dirPath, { recursive: true });
    // Register a document whose persisted path is a directory (not a file).
    const document = harness.store.operations.createDocument(harness.project.id, {
      category: 'Drawing',
      documentNumber: '',
      title: 'Folder.pdf',
      revision: 'A',
      status: 'Working',
      filePath: dirPath,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const revision = await prepare(harness);

    await expect(
      harness.service.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: document.id },
      ),
    ).rejects.toThrow(/regular file/);
  });

  it('8. another project documentId rejects', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Other.pdf');
    const otherDocument = registerDocument(
      harness,
      external,
      'other-bytes',
      harness.otherProject.id,
    );
    const revision = await prepare(harness);

    await expect(
      harness.service.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: otherDocument.id },
      ),
    ).rejects.toThrow(/belongs to this Project|not found|Document/);
  });

  it('9. request cannot override the persisted path with a forged sourcePath', async () => {
    const harness = createHarness();
    const legit = path.join(harness.root, 'OneDrive', 'Legit.pdf');
    const document = registerDocument(harness, legit, 'legit-bytes');
    const revision = await prepare(harness);

    // The route parses the request through the non-passthrough contract schema,
    // so an over-posted sourcePath is stripped and never reaches the service.
    const parsed = createRevisionDocumentSnapshotSchema.parse({
      sourceDocumentId: document.id,
      sourcePath: '/forged/elsewhere.pdf',
    });
    expect(parsed).not.toHaveProperty('sourcePath');

    // The snapshot is sourced from the persisted document.filePath.
    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      parsed,
    );

    expect(snapshot.sourceDocumentId).toBe(document.id);
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('10. external source bytes are hashed correctly', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Report.pdf');
    const bytes = 'external-pdf-bytes-123';
    const document = registerDocument(harness, external, bytes);
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('11. REV-01A sourceArtifactVersionId links when an external source matches a same-project ArtifactVersion', async () => {
    const harness = createHarness(true);
    const bytes = 'managed-external-bytes';
    // Create a ManagedArtifact + ArtifactVersion carrying the same bytes.
    const artifact = harness.artifacts!.createManagedArtifact({
      projectId: harness.project.id,
      artifactType: 'Drawing',
      sourceTool: 'AutoCAD',
      canonicalPath: '_managed/e2e02/source.pdf',
    });
    const version = harness.artifacts!.createArtifactVersion({
      artifactId: artifact.artifactId,
      version: 1,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: Buffer.byteLength(bytes),
      locatorKind: 'PROJECT_RELATIVE',
      locatorValue: artifact.canonicalPath,
    });
    // External source file carrying the same bytes.
    const external = path.join(harness.root, 'OneDrive', 'Managed.pdf');
    const document = registerDocument(harness, external, bytes);
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBe(version.versionId);
    expect(snapshot.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('12. unmatched external file creates a valid snapshot with provenance null', async () => {
    const harness = createHarness();
    const external = path.join(harness.root, 'OneDrive', 'Unmatched.pdf');
    const document = registerDocument(harness, external, 'unmatched-bytes');
    const revision = await prepare(harness);

    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    expect(snapshot.sourceArtifactVersionId).toBeNull();
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('13. failure before copy leaves no snapshot DB row and no partial snapshot file', async () => {
    const harness = createHarness();
    const missingPath = path.join(harness.root, 'OneDrive', 'Missing2.pdf');
    const document = registerDocument(harness, missingPath, 'x');
    rmSync(missingPath);
    const revision = await prepare(harness);
    const before = harness.registry.listDocumentSnapshotsForRevision(revision.revisionId);

    await expect(
      harness.service.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: document.id },
      ),
    ).rejects.toThrow(/missing/);

    const after = harness.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    expect(after).toHaveLength(before.length);
    const deliverablesDir = path.join(harness.projectRoot, 'DELIVERABLES');
    expect(existsSync(deliverablesDir)).toBe(false);
  });
});
