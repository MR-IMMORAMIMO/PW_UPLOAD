/**
 * P2C-03 — Safe Revision Delete reality tests.
 *
 * Covers the deletion eligibility authority, the archive-first deletion
 * mutation, the durable delete-operation journal / tombstone, idempotent
 * retry and recovery convergence, the tombstone-aware sequence allocator, and
 * the source-preservation guarantees. Uses a REAL filesystem for every
 * archive/move/hash assertion.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { builtInTemplateVersions, type AppUser, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeleteService } from './infrastructure/output-registry/RevisionDeleteService';
import { RevisionDeleteReconciler } from './infrastructure/output-registry/RevisionDeleteReconciler';
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
const designer = seedUsers.find((candidate) => candidate.role === 'Designer') as AppUser;

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
  service: RevisionDeleteService;
  deliverableService: RevisionDeliverableService;
  project: Project;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-revdelete-'));
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
  const deliverableService = new RevisionDeliverableService(store, registry);
  const service = new RevisionDeleteService(
    store,
    registry,
    () => new Date('2026-08-22T08:00:00.000Z'),
  );
  return { root, projectRoot, store, registry, service, deliverableService, project };
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
  // FK behavior is under test here; enforce it so invalid source/revision rows fail.
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

/** Prepares a manual PREPARING MANUAL_DELIVERABLES Revision through the B0 workflow. */
function prepareRevision(
  harness: Harness,
): ReturnType<typeof harness.deliverableService.prepareRevision> {
  return harness.deliverableService.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
  );
}

function now_iso(): string {
  return new Date('2026-08-22T08:00:00.000Z').toISOString();
}

function luminaireInput(tag: string) {
  return {
    tag,
    category: 'Downlight',
    imagePath: '',
    description: '',
    manufacturer: 'Scientechnic',
    model: 'DLX',
    wattage: '18W',
    lumens: '',
    lightColor: '3000K',
    cri: '',
    beamAngle: '',
    ipRating: '',
    mounting: '',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    datasheetPath: '',
    location: '',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'Manual',
    dimensions: '',
    bodyColorFinish: '',
  };
}

/** Adds an immutable Datasheet DocumentSnapshot to the Revision via the B0 intake authority. */
async function addDatasheet(
  harness: Harness,
  revisionId: string,
  content: string,
  index = 0,
): Promise<void> {
  const lum = harness.store.addLuminaire(harness.project.id, luminaireInput(`DL${index}`));
  const sourceDir = path.join(harness.root, `datasheet-src-${index}`);
  mkdirSync(sourceDir);
  const filePath = path.join(sourceDir, `datasheet-${index}.pdf`);
  writeFileSync(filePath, content);
  const version = harness.store.attachLuminaireAsset(
    harness.project.id,
    lum.id,
    { assetType: 'Datasheet', filePath },
    actor,
  );
  await harness.deliverableService.addDatasheetDeliverable(
    harness.project,
    revisionId,
    version.id,
    actor,
  );
}

/** Adds a canonical GeneratedOutput member to the Revision with a real artifact file. */
function addGeneratedOutput(
  harness: Harness,
  revision: ReturnType<typeof prepareRevision>,
  relativePath: string,
  content: string,
): void {
  const template = builtInTemplateVersions.find(
    (c) => c.templateId === 'schedule.technical-modern',
  );
  if (!template) throw new Error('Expected a built-in technical schedule template.');
  const output = harness.registry.createOutput({
    revisionId: revision.revisionId,
    outputFamily: 'LuminaireSchedule',
    outputFormat: 'PDF',
    relativePath,
    contentHash: null,
    resolvedTemplate: template,
  });
  harness.registry.setOutputContentHash(
    output.outputId,
    createHash('sha256').update(content).digest('hex'),
  );
  harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
  const artifactPath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, content);
}

describe('P2C-03 Safe Revision Delete', () => {
  it('PREPARING empty manual Revision is eligible and deleted (archives nothing)', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.deleteAction).toBe('DELETE');
    expect(eligibility.blockedReasons).toEqual([]);
    expect(eligibility.counts).toEqual({
      documentSnapshots: 0,
      datasheetSnapshots: 0,
      generatedOutputs: 0,
    });

    const result = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(result.outcome).toBe('DELETED');
    expect(result.operation.state).toBe('COMPLETED');
    // The canonical Revision is gone and a durable tombstone records the consumed sequence.
    expect(() => harness.registry.getRevision(revision.revisionId)).toThrow();
    const tombstone = harness.registry.getRevisionDeleteOperationByRevision(revision.revisionId);
    expect(tombstone).not.toBeNull();
    expect(tombstone!.state).toBe('COMPLETED');
    expect(tombstone!.revisionSequence).toBe(revision.revisionSequence);
  });

  it('PREPARING manual Revision with a ProjectDocument snapshot archives the exact copy and preserves the source', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'Drawings/Layout-A.pdf', 'layout-pdf-bytes');
    const sourcePath = path.join(harness.projectRoot, 'Drawings/Layout-A.pdf');
    const sourceBytes = 'layout-pdf-bytes';
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'Layout A' },
    );
    const ownedPath = path.join(harness.projectRoot, snapshot.locatorValue);

    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.counts.documentSnapshots).toBe(1);

    const result = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(result.outcome).toBe('DELETED');

    // The exact canonical snapshot was moved into the archive (not deleted).
    expect(existsSync(ownedPath)).toBe(false);
    const archiveRelative = result.operation.artifactManifest.items.find(
      (i) => i.rowId === snapshot.deliverableId,
    )!.archiveDestination;
    const archivedPath = path.join(harness.projectRoot, archiveRelative);
    expect(existsSync(archivedPath)).toBe(true);
    // Source Project Document is preserved unchanged.
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBytes);
    // The snapshot DB row is gone.
    expect(() => harness.registry.getDocumentSnapshot(snapshot.deliverableId)).toThrow();
  });

  it('FINALIZED Revision is blocked with REVISION_FINALIZED', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'A.pdf', 'bytes');
    const revision = prepareRevision(harness);
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'A' },
    );
    await harness.deliverableService.finalizeRevision(harness.project, revision.revisionId);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('REVISION_FINALIZED');
    await expect(
      harness.service.deleteRevision(harness.project, revision.revisionId, actor),
    ).rejects.toThrow(/cannot be deleted/);
    // Revision still present and FINALIZED.
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('FINALIZED');
  });

  it('a non-manual (REGISTER_ONLY) Revision is blocked with REVISION_NOT_MANUAL', async () => {
    const harness = createHarness();
    const revision = harness.registry.createRevision({
      projectId: harness.project.id,
      projectSnapshot: { ...baseProjectSnapshot(harness), canonicalOperation: 'REGISTER_ONLY' },
      luminaires: [],
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('REVISION_NOT_MANUAL');
  });

  it('a FAILED_RECOVERABLE Revision is blocked with REVISION_IN_RECOVERY', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'test failure',
    );
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('REVISION_IN_RECOVERY');
  });

  it('a legacy/imported Revision is blocked with REVISION_NOT_PREPARING', async () => {
    const harness = createHarness();
    // Insert a legacy-imported canonical Revision directly (LEGACY_IMPORTED lifecycle).
    const legacyId = 'a1000000-0000-4000-8000-000000000099';
    harness.store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO canonical_revisions
         (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
          provenance_classification, legacy_source_id, created_at, updated_at)
         VALUES (?, ?, 99, 'REV_99', 'LEGACY_IMPORTED', 'LEGACY_VERIFIED', 'legacy-imp', ?, ?)`,
      )
      .run(legacyId, harness.project.id, now_iso(), now_iso());
    const eligibility = await harness.service.deleteEligibility(harness.project, legacyId, actor);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('REVISION_NOT_PREPARING');
  });

  it('Package history blocks deletion (PACKAGE_HISTORY_EXISTS)', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'A.pdf', 'bytes');
    const revision = prepareRevision(harness);
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'A' },
    );
    await harness.deliverableService.finalizeRevision(harness.project, revision.revisionId);
    // A canonical Issue Package bound to the Revision (finalized source).
    harness.registry.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'PKG-01',
      artifactRelativePath: 'DELIVERABLES/REV_01/pkg.zip',
      manifestRelativePath: 'INTERNAL/PACKAGES/PKG-01/manifest.json',
      issuedBy: null,
      issuedAt: null,
    });
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('PACKAGE_HISTORY_EXISTS');
    await expect(
      harness.service.deleteRevision(harness.project, revision.revisionId, actor),
    ).rejects.toThrow();
  });

  it('a compatibility project_revisions row blocks deletion (COMPATIBILITY_HISTORY_EXISTS)', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    // A compatibility projection row exists for the same canonical sequence.
    harness.store.operations.recordCanonicalRevisionProjection(
      harness.project.id,
      revision.revisionId,
      revision.revisionSequence,
      {
        revisionNumber: revision.revisionSequence,
        reissueNumber: 0,
        title: 'Compat',
        status: 'Draft',
        receivedAt: null,
        dueDate: null,
        issuedAt: null,
        summary: '',
        changeLog: '',
        sourceType: 'Manual',
        sourceReference: '',
      },
      revision.createdAt,
    );
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('COMPATIBILITY_HISTORY_EXISTS');
  });

  it('an unauthorized (Designer) actor is blocked with OWNER_PERMISSION_REQUIRED and rejected at mutation', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      designer,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('OWNER_PERMISSION_REQUIRED');
    await expect(
      harness.service.deleteRevision(harness.project, revision.revisionId, designer),
    ).rejects.toThrow(/authorization|permission/i);
    // Revision remains present.
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('a wrong-project Revision resolves to not-found (never cross-project delete)', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const otherProject = structuredClone(seedProjects[1]!);
    await expect(
      harness.service.deleteEligibility(otherProject, revision.revisionId, actor),
    ).rejects.toThrow('Revision not found');
    await expect(
      harness.service.deleteRevision(otherProject, revision.revisionId, actor),
    ).rejects.toThrow('Revision not found');
  });

  it('a hash mismatch blocks deletion (ARTIFACT_HASH_MISMATCH)', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'A.pdf', 'original-bytes');
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'A' },
    );
    // Tamper with the owned snapshot file on disk.
    writeFileSync(path.join(harness.projectRoot, snapshot.locatorValue), 'tampered-bytes');
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('ARTIFACT_HASH_MISMATCH');
    await expect(
      harness.service.deleteRevision(harness.project, revision.revisionId, actor),
    ).rejects.toThrow();
  });

  it('a missing owned artifact blocks as ARTIFACT_OWNERSHIP_UNPROVEN', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'A/D-B.pdf', 'bytes-b');
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'B' },
    );
    rmSync(path.join(harness.projectRoot, snapshot.locatorValue), { force: true });
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('ARTIFACT_OWNERSHIP_UNPROVEN');
  });
});

describe('P2C-03 tombstone sequence allocator', () => {
  it('creating after a successful delete does not reuse the deleted sequence', async () => {
    const harness = createHarness();
    const first = prepareRevision(harness);
    // Allocate until the highest sequence is a predictable value (e.g. REV_01).
    expect(first.revisionSequence).toBe(1);
    await harness.service.deleteRevision(harness.project, first.revisionId, actor);
    // The tombstone consumed sequence 1; a new Revision must be 2 (never 1 again).
    const next = prepareRevision(harness);
    expect(next.revisionSequence).toBe(2);
    expect(next.revisionLabel).toBe('REV_02');
  });

  it('deleting the highest Revision then creating another goes to the next consumed sequence', async () => {
    const harness = createHarness();
    // Create several, delete the highest.
    const r1 = prepareRevision(harness);
    const r2 = prepareRevision(harness);
    const r3 = prepareRevision(harness);
    expect(r3.revisionSequence).toBe(3);
    await harness.service.deleteRevision(harness.project, r3.revisionId, actor);
    // The allocator must not accidentally reuse 3; next is 4.
    const next = prepareRevision(harness);
    expect(next.revisionSequence).toBe(4);
    expect(next.revisionLabel).toBe('REV_04');
    // Lower sequences stay unique and untouched.
    expect(harness.registry.getRevision(r1.revisionId).revisionSequence).toBe(1);
    expect(harness.registry.getRevision(r2.revisionId).revisionSequence).toBe(2);
  });
});

describe('P2C-03 recovery / idempotency', () => {
  it('repeated DELETE after COMPLETED returns the truthful completed tombstone', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const first = await harness.service.deleteRevision(harness.project, revision.revisionId, actor);
    expect(first.outcome).toBe('DELETED');
    const second = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(second.outcome).toBe('DELETED');
    expect(second.operation.operationId).toBe(first.operation.operationId);
    expect(second.operation.state).toBe('COMPLETED');
  });

  it('a DB_COMMITTED operation converges to COMPLETED on retry', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const document = addDocument(harness, 'A.pdf', 'bytes');
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'A' },
    );
    // First run the full delete to create the operation + archive.
    const result = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    // Simulate the final-bookkeeping interruption by manually setting DB_COMMITTED (rows already gone).
    harness.registry.setRevisionDeleteOperationState(result.operation.operationId, 'DB_COMMITTED', {
      updatedAt: '2026-08-22T08:01:00.000Z',
    });
    const retry = await harness.service.deleteRevision(harness.project, revision.revisionId, actor);
    expect(retry.outcome).toBe('DELETED');
    expect(retry.operation.state).toBe('COMPLETED');
  });

  it('no duplicate archive files and no duplicate delete operations on retry', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'A-D.pdf', 'payload');
    const revision = prepareRevision(harness);
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'A' },
    );
    const result = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(result.outcome).toBe('DELETED');
    // A single durable operation exists for this revision UUID.
    const operations = harness.registry.listRevisionDeleteOperations(harness.project.id);
    expect(operations.filter((o) => o.revisionId === revision.revisionId).length).toBe(1);
    // H2 — the archive is scoped to the operationId and holds exactly one member file.
    const opDirName = result.operation.artifactManifest.items[0]!.archiveDestination.split('/')
      .slice(0, -1)
      .join('/');
    const opDir = path.join(harness.projectRoot, opDirName);
    // The operation directory path equals the operationId segment.
    expect(opDirName).toBe(`INTERNAL/REVISION_DELETE_ARCHIVE/${result.operation.operationId}`);
    const archiveFiles = readdirSync(opDir, { withFileTypes: true }).filter((e) => e.isFile());
    expect(archiveFiles.length).toBe(1);
    // The manifest records the exact operation-scoped archive destination.
    const dest = result.operation.artifactManifest.items[0]!.archiveDestination;
    expect(
      dest.startsWith(`INTERNAL/REVISION_DELETE_ARCHIVE/${result.operation.operationId}/`),
    ).toBe(true);
    expect(archiveFiles[0]!.name.endsWith('.pdf')).toBe(true);
  });
});

describe('P2C-03 startup reconciliation', () => {
  it('DB_COMMITTED operations are completed; non-terminal operations are surfaced as recoverable', () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    // Create a durable operation and force it to DB_COMMITTED (rows already deleted).
    const op = harness.registry.createOrReuseRevisionDeleteOperation({
      operationId: 'b2000000-0000-4000-8000-000000000001',
      projectId: harness.project.id,
      revisionId: revision.revisionId,
      revisionSequence: revision.revisionSequence,
      revisionLabel: revision.revisionLabel,
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
      manifest: { revisionId: revision.revisionId, items: [] },
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
      createdAt: '2026-08-22T08:00:00.000Z',
    });
    harness.registry.setRevisionDeleteOperationState(op.operationId, 'DB_COMMITTED', {
      dbCommittedAt: '2026-08-22T08:00:01.000Z',
      updatedAt: '2026-08-22T08:00:01.000Z',
    });
    // A second, non-terminal operation (PLANNED) for a different revision.
    const r2 = prepareRevision(harness);
    const op2 = harness.registry.createOrReuseRevisionDeleteOperation({
      operationId: 'b2000000-0000-4000-8000-000000000002',
      projectId: harness.project.id,
      revisionId: r2.revisionId,
      revisionSequence: r2.revisionSequence,
      revisionLabel: r2.revisionLabel,
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
      manifest: { revisionId: r2.revisionId, items: [] },
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
      createdAt: '2026-08-22T08:02:00.000Z',
    });

    const result = new RevisionDeleteReconciler(harness.registry).reconcile();
    expect(result.completed).toContain(op.operationId);
    expect(result.surfacedRecoverable).toContain(op2.operationId);
    expect(harness.registry.getRevisionDeleteOperation(op.operationId).state).toBe('COMPLETED');
    expect(harness.registry.getRevisionDeleteOperation(op2.operationId).state).toBe(
      'FAILED_RECOVERABLE',
    );
    // No silent destructive guessing: the revision rows are untouched (not deleted).
    expect(harness.registry.getRevision(revision.revisionId).revisionId).toBe(revision.revisionId);
    expect(harness.registry.getRevision(r2.revisionId).revisionId).toBe(r2.revisionId);
  });
});

describe('P2C-10A restart-safe delete recovery projection', () => {
  it('projects Retry Delete after restart and resumes the same persisted operation', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'Restart/Source.pdf', 'restart-safe-bytes');
    const sourcePath = path.join(harness.projectRoot, 'Restart/Source.pdf');
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'Restart Safe' },
    );
    const operationId = 'c1000000-0000-4000-8000-000000000010';
    const archiveDestination = `INTERNAL/REVISION_DELETE_ARCHIVE/${operationId}/${snapshot.deliverableId}_${path.basename(snapshot.locatorValue)}`;
    const operation = harness.registry.createOrReuseRevisionDeleteOperation({
      operationId,
      projectId: harness.project.id,
      revisionId: revision.revisionId,
      revisionSequence: revision.revisionSequence,
      revisionLabel: revision.revisionLabel,
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
      manifest: {
        revisionId: revision.revisionId,
        items: [
          {
            rowId: snapshot.deliverableId,
            sourceType: 'DocumentSnapshot',
            locatorValue: snapshot.locatorValue,
            contentHash: snapshot.contentHash,
            sizeBytes: snapshot.sizeBytes,
            archiveDestination,
          },
        ],
      },
      counts: { documentSnapshots: 1, datasheetSnapshots: 0, generatedOutputs: 0 },
      createdAt: now_iso(),
    });

    // Simulate a process stopping after the archive pass but before DB commit.
    const ownedPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const archivedPath = path.join(harness.projectRoot, archiveDestination);
    mkdirSync(path.dirname(archivedPath), { recursive: true });
    renameSync(ownedPath, archivedPath);
    harness.registry.setRevisionDeleteOperationState(operation.operationId, 'ARCHIVED', {
      archiveStartedAt: now_iso(),
      updatedAt: now_iso(),
    });

    const reconciliation = new RevisionDeleteReconciler(harness.registry).reconcile();
    expect(reconciliation.surfacedRecoverable).toEqual([operationId]);
    expect(harness.registry.getRevisionDeleteOperation(operationId).state).toBe(
      'FAILED_RECOVERABLE',
    );

    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility).toMatchObject({
      revisionId: revision.revisionId,
      deleteAction: 'RETRY_DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 1, datasheetSnapshots: 0, generatedOutputs: 0 },
    });
    expect(readFileSync(archivedPath, 'utf8')).toBe('restart-safe-bytes');

    writeFileSync(archivedPath, 'tampered-after-restart');
    const tampered = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(tampered.deleteAction).toBe('NONE');
    expect(tampered.blockedReasons).toContain('ARTIFACT_HASH_MISMATCH');
    writeFileSync(archivedPath, 'restart-safe-bytes');
    expect(
      (await harness.service.deleteEligibility(harness.project, revision.revisionId, actor))
        .deleteAction,
    ).toBe('RETRY_DELETE');

    const unauthorized = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      designer,
    );
    expect(unauthorized.deleteAction).toBe('NONE');
    expect(unauthorized.blockedReasons).toContain('OWNER_PERMISSION_REQUIRED');

    const otherProject = structuredClone(seedProjects[1]!);
    await expect(
      harness.service.deleteRevision(otherProject, revision.revisionId, actor),
    ).rejects.toThrow('Revision not found');

    const retry = await harness.service.deleteRevision(harness.project, revision.revisionId, actor);
    expect(retry.outcome).toBe('DELETED');
    expect(retry.operation.operationId).toBe(operationId);
    expect(retry.operation.state).toBe('COMPLETED');
    expect(
      readdirSync(path.dirname(archivedPath)).filter((name) => name.endsWith('.pdf')),
    ).toHaveLength(1);
    expect(readFileSync(sourcePath, 'utf8')).toBe('restart-safe-bytes');
    expect(harness.registry.listRevisionDeleteOperations(harness.project.id)).toHaveLength(1);

    // A stale repeated request converges on the same completed tombstone.
    const repeated = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(repeated.outcome).toBe('DELETED');
    expect(repeated.operation.operationId).toBe(operationId);
    expect(repeated.operation.state).toBe('COMPLETED');
  });

  it('does not project Retry for a non-reconciled or completed operation', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const operation = harness.registry.createOrReuseRevisionDeleteOperation({
      operationId: 'c1000000-0000-4000-8000-000000000011',
      projectId: harness.project.id,
      revisionId: revision.revisionId,
      revisionSequence: revision.revisionSequence,
      revisionLabel: revision.revisionLabel,
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
      manifest: { revisionId: revision.revisionId, items: [] },
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
      createdAt: now_iso(),
    });

    const planned = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(planned.deleteAction).toBe('NONE');
    expect(planned.blockedReasons).toContain('DELETE_OPERATION_NOT_RECOVERABLE');

    harness.registry.setRevisionDeleteOperationState(operation.operationId, 'COMPLETED', {
      completedAt: now_iso(),
      updatedAt: now_iso(),
    });
    const completed = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(completed.deleteAction).toBe('NONE');
    expect(completed.canDelete).toBe(false);
  });
});

describe('P2C-03H destructive-path hardening', () => {
  it('H3: a legacy revision_packages dependency blocks deletion (COMPATIBILITY_HISTORY_EXISTS) even with no project_revisions row', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    // No compatibility project_revisions row is created. Insert ONLY a legacy
    // revision_packages row that references the same sequence/project.
    harness.store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO revision_packages
         (id, project_id, revision_number, reissue_number, label, status, output_mode,
          folder_path, zip_path, item_count, total_bytes, package_hash,
          warning_override_reason, manifest_json, created_at)
         VALUES (?, ?, ?, 0, 'PKG-LEGACY', 'Draft', 'manual', 'out/pkg', 'out/pkg.zip',
          1, 10, 'abc', '', '{}', ?)`,
      )
      .run(
        'f0000000-0000-4000-8000-000000000099',
        harness.project.id,
        revision.revisionSequence,
        now_iso(),
      );
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockedReasons).toContain('COMPATIBILITY_HISTORY_EXISTS');
    await expect(
      harness.service.deleteRevision(harness.project, revision.revisionId, actor),
    ).rejects.toThrow(/cannot be deleted/);
    // The legacy row is NEVER deleted and the Revision stays PREPARING.
    const legacyRow = harness.registry
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS total FROM revision_packages WHERE id = ?')
      .get('f0000000-0000-4000-8000-000000000099') as { total: number };
    expect(legacyRow.total).toBe(1);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('H4: a non-movable archive destination leaves the Revision intact and a retry converges', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'Locked/Blocked-A.pdf', 'blocked-bytes');
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'Blocked A' },
    );
    const sourcePath = path.join(harness.projectRoot, 'Locked/Blocked-A.pdf');
    const sourceBytes = 'blocked-bytes';

    // Pre-create the durable operation with a KNOWN operationId so the archive
    // destination is deterministic, and block it by occupying the destination
    // path with a directory (a deterministic, Windows-compatible simulation of
    // a non-movable canonical artifact — the rename cannot complete).
    const operationId = 'c0000000-0000-4000-8000-000000000011';
    const archiveDestination = `INTERNAL/REVISION_DELETE_ARCHIVE/${operationId}/${snapshot.deliverableId}_${path.basename(snapshot.locatorValue)}`;
    harness.registry.createOrReuseRevisionDeleteOperation({
      operationId,
      projectId: harness.project.id,
      revisionId: revision.revisionId,
      revisionSequence: revision.revisionSequence,
      revisionLabel: revision.revisionLabel,
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
      manifest: {
        revisionId: revision.revisionId,
        items: [
          {
            rowId: snapshot.deliverableId,
            sourceType: 'DocumentSnapshot',
            locatorValue: snapshot.locatorValue,
            contentHash: snapshot.contentHash,
            sizeBytes: snapshot.sizeBytes,
            archiveDestination,
          },
        ],
      },
      counts: { documentSnapshots: 1, datasheetSnapshots: 0, generatedOutputs: 0 },
      createdAt: now_iso(),
    });
    harness.registry.setRevisionDeleteOperationState(operationId, 'FAILED_RECOVERABLE', {
      updatedAt: now_iso(),
    });
    const blockedPath = path.join(harness.projectRoot, archiveDestination);
    mkdirSync(path.dirname(blockedPath), { recursive: true });
    mkdirSync(blockedPath);

    const failed = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(failed.outcome).toBe('RETRYABLE');
    expect(failed.operation.state).toBe('FAILED_RECOVERABLE');
    expect(failed.operation.operationId).toBe(operationId);
    // Archive could not complete: source stays, Revision DB row stays, snapshot stays.
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBytes);
    expect(harness.registry.getRevision(revision.revisionId).revisionId).toBe(revision.revisionId);
    expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId).deliverableId).toBe(
      snapshot.deliverableId,
    );

    // Remove the failure condition (blocking directory) and Retry Delete.
    rmSync(blockedPath, { recursive: true, force: true });
    const retry = await harness.service.deleteRevision(harness.project, revision.revisionId, actor);
    expect(retry.outcome).toBe('DELETED');
    expect(retry.operation.state).toBe('COMPLETED');
    expect(retry.operation.operationId).toBe(operationId);
    // Revision DB row and snapshot gone; exactly one archived member; source preserved.
    expect(() => harness.registry.getRevision(revision.revisionId)).toThrow();
    expect(() => harness.registry.getDocumentSnapshot(snapshot.deliverableId)).toThrow();
    const opDir = path.join(harness.projectRoot, `INTERNAL/REVISION_DELETE_ARCHIVE/${operationId}`);
    const archived = readdirSync(opDir, { withFileTypes: true }).filter((e) => e.isFile());
    expect(archived.length).toBe(1);
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBytes);
    // Exactly one durable delete operation exists for this Revision UUID.
    const ops = harness.registry.listRevisionDeleteOperations(harness.project.id);
    expect(ops.filter((o) => o.revisionId === revision.revisionId).length).toBe(1);
  });

  it('H5: a DB failure after a complete archive leaves the Revision recoverable and a retry converges without duplicate archive members', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'DbFail/Archive-A.pdf', 'archive-then-db-fail');
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'Archive A' },
    );
    const sourcePath = path.join(harness.projectRoot, 'DbFail/Archive-A.pdf');
    const sourceBytes = 'archive-then-db-fail';

    // Narrowest fault-injection seam: a BEFORE DELETE trigger on
    // canonical_revisions that aborts the transaction exactly when the final
    // canonical delete runs — AFTER the archive has fully completed. This is a
    // repository-native, deterministic DB failure and does not weaken any
    // production transaction logic.
    harness.registry
      .getSharedDatabase()
      .exec(
        "CREATE TRIGGER IF NOT EXISTS test_h5_block_revision_delete BEFORE DELETE ON canonical_revisions BEGIN SELECT RAISE(ABORT, 'H5 injected DB failure'); END",
      );

    const failed = await harness.service.deleteRevision(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(failed.outcome).toBe('RETRYABLE');
    expect(failed.operation.state).toBe('FAILED_RECOVERABLE');
    // Archived bytes remain intact (archive completed before the DB failure).
    const dest = failed.operation.artifactManifest.items[0]!.archiveDestination;
    const archivedPath = path.join(harness.projectRoot, dest);
    expect(existsSync(archivedPath)).toBe(true);
    expect(readFileSync(archivedPath, 'utf8')).toBe(sourceBytes);
    // Active Revision DB state preserved (transaction rolled back).
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId).deliverableId).toBe(
      snapshot.deliverableId,
    );

    // Remove the fault and Retry Delete.
    harness.registry
      .getSharedDatabase()
      .exec('DROP TRIGGER IF EXISTS test_h5_block_revision_delete');
    const retry = await harness.service.deleteRevision(harness.project, revision.revisionId, actor);
    expect(retry.outcome).toBe('DELETED');
    expect(retry.operation.state).toBe('COMPLETED');
    expect(retry.operation.operationId).toBe(failed.operation.operationId);
    expect(retry.operation.artifactManifest.items[0]!.archiveDestination).toBe(dest);
    // Revision gone, no duplicate archive member, source untouched.
    expect(() => harness.registry.getRevision(revision.revisionId)).toThrow();
    const opDir = path.join(harness.projectRoot, path.dirname(dest));
    const archived = readdirSync(opDir, { withFileTypes: true }).filter((e) => e.isFile());
    expect(archived.length).toBe(1);
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(sourceBytes);
  });
});

describe('P2C-03 delete confirmation counts', () => {
  it('Empty Revision: total=0 generated=0 documents=0 datasheets=0', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.canDelete).toBe(true);
    expect(eligibility.counts).toEqual({
      documentSnapshots: 0,
      datasheetSnapshots: 0,
      generatedOutputs: 0,
    });
  });

  it('2: two normal DocumentSnapshots -> total=2 documents=2', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    for (let i = 0; i < 2; i++) {
      const document = addDocument(harness, `Docs/Doc-${i}.pdf`, `bytes-${i}`);
      await harness.deliverableService.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: document.id, title: `Doc ${i}` },
      );
    }
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts).toEqual({
      documentSnapshots: 2,
      datasheetSnapshots: 0,
      generatedOutputs: 0,
    });
  });

  it('3: one Datasheet -> total=1 datasheets=1', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    await addDatasheet(harness, revision.revisionId, 'ds-bytes', 0);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts).toEqual({
      documentSnapshots: 0,
      datasheetSnapshots: 1,
      generatedOutputs: 0,
    });
  });

  it('4: two GeneratedOutputs -> total=2 generated=2', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    addGeneratedOutput(
      harness,
      revision,
      `DELIVERABLES/${revision.revisionLabel}/out-1.pdf`,
      'gen-1',
    );
    addGeneratedOutput(
      harness,
      revision,
      `DELIVERABLES/${revision.revisionLabel}/out-2.pdf`,
      'gen-2',
    );
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts).toEqual({
      documentSnapshots: 0,
      datasheetSnapshots: 0,
      generatedOutputs: 2,
    });
  });

  it('5: UAT-equivalent mixed Revision -> total=5 generated=2 documents=2 datasheets=1', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    // 2 normal ProjectDocument snapshots.
    for (let i = 0; i < 2; i++) {
      const document = addDocument(harness, `Docs/Doc-${i}.pdf`, `bytes-${i}`);
      await harness.deliverableService.createDocumentSnapshot(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        revision.revisionId,
        { sourceDocumentId: document.id, title: `Doc ${i}` },
      );
    }
    // 1 Datasheet snapshot.
    await addDatasheet(harness, revision.revisionId, 'ds-bytes', 0);
    // 2 GeneratedOutputs.
    addGeneratedOutput(
      harness,
      revision,
      `DELIVERABLES/${revision.revisionLabel}/out-1.pdf`,
      'gen-1',
    );
    addGeneratedOutput(
      harness,
      revision,
      `DELIVERABLES/${revision.revisionLabel}/out-2.pdf`,
      'gen-2',
    );
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts).toEqual({
      documentSnapshots: 2,
      datasheetSnapshots: 1,
      generatedOutputs: 2,
    });
    // totalDeliverables = generated + nonDatasheetDocs + datasheets.
    const total =
      eligibility.counts.generatedOutputs +
      eligibility.counts.documentSnapshots +
      eligibility.counts.datasheetSnapshots;
    expect(total).toBe(5);
  });

  it('6: exact Revision UUID scoping — outputs/snapshots from other Revisions do not affect counts', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    // Another PREPARING Revision in the same project with its own members.
    const other = prepareRevision(harness);
    addGeneratedOutput(harness, other, `DELIVERABLES/${other.revisionLabel}/o.pdf`, 'other-gen');
    const otherDocument = addDocument(harness, 'Other/Doc.pdf', 'other-doc');
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      other.revisionId,
      { sourceDocumentId: otherDocument.id, title: 'Other' },
    );
    // The target Revision is empty; foreign members must not leak in.
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts).toEqual({
      documentSnapshots: 0,
      datasheetSnapshots: 0,
      generatedOutputs: 0,
    });
  });

  it('8: Datasheets are not double-counted under Document Snapshots', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness);
    const document = addDocument(harness, 'Docs/Doc.pdf', 'doc-bytes');
    await harness.deliverableService.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'Doc' },
    );
    await addDatasheet(harness, revision.revisionId, 'ds-bytes', 0);
    const eligibility = await harness.service.deleteEligibility(
      harness.project,
      revision.revisionId,
      actor,
    );
    expect(eligibility.counts.documentSnapshots).toBe(1);
    expect(eligibility.counts.datasheetSnapshots).toBe(1);
    expect(eligibility.counts.generatedOutputs).toBe(0);
  });
});

function baseProjectSnapshot(harness: Harness) {
  return {
    id: harness.project.id,
    projectCode: harness.project.projectCode,
    projectName: harness.project.projectName,
    clientName: harness.project.clientName,
    projectType: harness.project.projectType,
    status: harness.project.status,
    updatedAt: harness.project.updatedAt,
    siteLocation: harness.project.siteLocation,
    designStage: harness.project.designStage,
    description: harness.project.description,
    folderProfile: harness.store.getWorkspace(harness.project.id).folderProfile,
    lightingPackage: structuredClone(
      harness.store.getWorkspace(harness.project.id).lightingPackage,
    ),
    outputFolders: structuredClone(harness.store.getWorkspace(harness.project.id).outputFolders),
  };
}
