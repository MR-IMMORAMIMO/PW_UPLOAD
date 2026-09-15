import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Project, ProjectDocument, RevisionDocumentSnapshotRecord } from '@scli/domain';
import type { GoldenUatHarness } from './golden-uat-harness.js';
import { preflightGoldenFixtureFile, writeGoldenFixtureFile } from './golden-uat-assets.js';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_IDEMPOTENCY_KEY,
  GOLDEN_UAT_PROJECT_NAME,
} from './golden-uat-types.js';
import {
  GOLDEN_V19_IDS,
  GOLDEN_V19_INTERNAL_NOTE,
  GOLDEN_V19_PROJECT_CODE,
  GOLDEN_V19_PROJECT_ID,
  GOLDEN_V19_PURPOSE,
  GOLDEN_V19_REUSE_REASON,
  goldenV19GeneratedOutputFiles,
  goldenV19SourceFiles,
  type GoldenV19FixtureFile,
} from './golden-v19-fixture.js';
import {
  inspectGoldenV19XlsxSemantics,
  type GoldenV19XlsxKind,
} from './golden-v19-xlsx-semantics.js';
import {
  CanonicalOutputRegistryStore,
  type CanonicalRegistryIdentityFactory,
} from '../infrastructure/output-registry/CanonicalOutputRegistryStore.js';
import { RevisionDeliverableService } from '../infrastructure/output-registry/RevisionDeliverableService.js';
import { RevisionDeleteService } from '../infrastructure/output-registry/RevisionDeleteService.js';
import { RevisionReuseService } from '../infrastructure/output-registry/RevisionReuseService.js';
import { CanonicalIssuePackageService } from '../infrastructure/output-registry/CanonicalIssuePackageService.js';
import { PackageReproducibilityService } from '../infrastructure/output-registry/PackageReproducibilityService.js';
import { IssueHistoryService } from '../infrastructure/output-registry/IssueHistoryService.js';

export interface GoldenV19ApplyResult {
  changed: boolean;
  projectId: string;
  deletedRevisionId: string;
  revisionId: string;
  deleteOperationId: string;
  packageIds: readonly [string, string];
  sourceFiles: GoldenV19FixtureFile[];
  generatedOutputFiles: GoldenV19FixtureFile[];
}

export interface GoldenV19AllocationAuthority {
  canonicalSequences: number[];
  compatibilitySequences: number[];
  exportSequences: number[];
  legacyPackageSequences: number[];
  deleteOperationSequences: number[];
  highWater: number;
}

interface DeterministicQueues {
  revisions: string[];
  outputs: string[];
  snapshots: string[];
  packages: string[];
}

function shiftRequired(queue: string[], kind: string): string {
  const value = queue.shift();
  if (!value) throw new Error(`Golden v19 fixture exhausted its deterministic ${kind} identities.`);
  return value;
}

function fixtureIdentityFactory(queues: DeterministicQueues): CanonicalRegistryIdentityFactory {
  return {
    revisionId: () => shiftRequired(queues.revisions, 'Revision'),
    outputId: () => shiftRequired(queues.outputs, 'Output'),
    documentSnapshotId: () => shiftRequired(queues.snapshots, 'Document Snapshot'),
  };
}

function expectedQueues(): DeterministicQueues {
  return {
    revisions: [GOLDEN_V19_IDS.deletedRevision, GOLDEN_V19_IDS.lastingRevision],
    outputs: [
      GOLDEN_V19_IDS.scheduleXlsx,
      GOLDEN_V19_IDS.schedulePdf,
      GOLDEN_V19_IDS.boqXlsx,
      GOLDEN_V19_IDS.boqPdf,
    ],
    snapshots: [
      GOLDEN_V19_IDS.deletedSnapshot,
      GOLDEN_V19_IDS.drawingSnapshot,
      GOLDEN_V19_IDS.dialuxSnapshot,
      GOLDEN_V19_IDS.datasheetSnapshot,
    ],
    packages: [GOLDEN_V19_IDS.initialPackage, GOLDEN_V19_IDS.reissuePackage],
  };
}

async function exactGoldenProject(harness: GoldenUatHarness): Promise<Project> {
  const projects = await harness.provider.listProjects();
  const byId = projects.filter((project) => project.id === GOLDEN_V19_PROJECT_ID);
  const byMarker = projects.filter((project) => project.crmReference === GOLDEN_UAT_CRM_REFERENCE);
  if (byId.length !== 1 || byMarker.length !== 1 || byId[0]?.id !== byMarker[0]?.id) {
    throw new Error(
      'IDENTITY_MISMATCH: exact Golden UUID and marker do not resolve to one Project.',
    );
  }
  const project = byId[0]!;
  if (
    project.projectCode !== GOLDEN_V19_PROJECT_CODE ||
    project.projectName !== GOLDEN_UAT_PROJECT_NAME
  ) {
    throw new Error(
      'IDENTITY_MISMATCH: Golden Project code or name differs from the locked identity.',
    );
  }
  const idempotency = harness.store
    .getSharedDatabase()
    .prepare('SELECT project_id FROM idempotency_keys WHERE idempotency_key = ?')
    .get(GOLDEN_UAT_IDEMPOTENCY_KEY) as { project_id?: unknown } | undefined;
  if (idempotency?.project_id !== GOLDEN_V19_PROJECT_ID) {
    throw new Error(
      'IDENTITY_MISMATCH: Golden fixture idempotency identity is absent or conflicting.',
    );
  }
  return project;
}

function sequenceValues(database: DatabaseSync, sql: string, projectId: string): number[] {
  return (database.prepare(sql).all(projectId) as Array<{ sequence_value: number }>).map((row) =>
    Number(row.sequence_value),
  );
}

/** One project-scoped view of every authority that can reserve a Revision sequence. */
export function readGoldenV19AllocationAuthority(
  database: DatabaseSync,
): GoldenV19AllocationAuthority {
  const canonicalSequences = sequenceValues(
    database,
    `SELECT revision_sequence AS sequence_value
       FROM canonical_revisions WHERE project_id = ? ORDER BY revision_sequence`,
    GOLDEN_V19_PROJECT_ID,
  );
  const compatibilitySequences = sequenceValues(
    database,
    `SELECT revision_number AS sequence_value
       FROM project_revisions WHERE project_id = ? ORDER BY revision_number`,
    GOLDEN_V19_PROJECT_ID,
  );
  const exportSequences = sequenceValues(
    database,
    `SELECT revision AS sequence_value
       FROM project_exports WHERE project_id = ? ORDER BY revision`,
    GOLDEN_V19_PROJECT_ID,
  );
  const legacyPackageSequences = sequenceValues(
    database,
    `SELECT revision_number AS sequence_value
       FROM revision_packages WHERE project_id = ? ORDER BY revision_number, reissue_number`,
    GOLDEN_V19_PROJECT_ID,
  );
  const deleteOperationSequences = sequenceValues(
    database,
    `SELECT revision_sequence AS sequence_value
       FROM revision_delete_operations WHERE project_id = ? ORDER BY revision_sequence`,
    GOLDEN_V19_PROJECT_ID,
  );
  const all = [
    ...canonicalSequences,
    ...compatibilitySequences,
    ...exportSequences,
    ...legacyPackageSequences,
    ...deleteOperationSequences,
  ];
  return {
    canonicalSequences,
    compatibilitySequences,
    exportSequences,
    legacyPackageSequences,
    deleteOperationSequences,
    highWater: Math.max(0, ...all),
  };
}

function exactSequences(actual: readonly number[], expected: readonly number[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function assertCleanBaselineAuthority(authority: GoldenV19AllocationAuthority): void {
  const compatibilityMax = Math.max(0, ...authority.compatibilitySequences);
  const hiddenSequence = [
    ...authority.compatibilitySequences,
    ...authority.exportSequences,
    ...authority.legacyPackageSequences,
    ...authority.deleteOperationSequences,
  ].some((sequence) => sequence >= 3);
  if (
    !exactSequences(authority.canonicalSequences, [1, 2]) ||
    compatibilityMax !== 2 ||
    hiddenSequence ||
    authority.highWater !== 2
  ) {
    throw new Error(
      `CONFLICT: Golden v19 allocation authority is not the clean sequence-2 baseline: ${JSON.stringify(authority)}`,
    );
  }
}

function completeAuthorityIsExact(authority: GoldenV19AllocationAuthority): boolean {
  return (
    exactSequences(authority.canonicalSequences, [1, 2, 3]) &&
    Math.max(0, ...authority.compatibilitySequences) === 2 &&
    authority.compatibilitySequences.every((sequence) => sequence < 3) &&
    authority.exportSequences.every((sequence) => sequence < 3) &&
    authority.legacyPackageSequences.every((sequence) => sequence <= 3) &&
    exactSequences(authority.deleteOperationSequences, [3]) &&
    authority.highWater === 3
  );
}

/** Shared PLAN/APPLY classifier. It fails closed for hidden or partial sequence authority. */
export function classifyGoldenV19State(
  registry: CanonicalOutputRegistryStore,
): 'BASELINE' | 'COMPLETE' {
  const revisions = registry.listRevisions(GOLDEN_V19_PROJECT_ID);
  const allocationAuthority = readGoldenV19AllocationAuthority(registry.getSharedDatabase());
  const lasting = revisions.find(
    (revision) => revision.revisionId === GOLDEN_V19_IDS.lastingRevision,
  );
  const deleteOperations = registry.listRevisionDeleteOperations(GOLDEN_V19_PROJECT_ID);
  const operation = deleteOperations.find(
    (candidate) => candidate.operationId === GOLDEN_V19_IDS.deleteOperation,
  );
  if (lasting || operation) {
    const outputs = registry.listOutputsForRevision(GOLDEN_V19_IDS.lastingRevision);
    const snapshots = registry.listDocumentSnapshotsForRevision(GOLDEN_V19_IDS.lastingRevision);
    const packages = registry
      .listIssuePackages(GOLDEN_V19_PROJECT_ID)
      .filter((item) => item.revisionId === GOLDEN_V19_IDS.lastingRevision);
    const expectedOutputIds = [
      GOLDEN_V19_IDS.scheduleXlsx,
      GOLDEN_V19_IDS.schedulePdf,
      GOLDEN_V19_IDS.boqXlsx,
      GOLDEN_V19_IDS.boqPdf,
    ];
    const expectedSnapshotIds = [
      GOLDEN_V19_IDS.drawingSnapshot,
      GOLDEN_V19_IDS.dialuxSnapshot,
      GOLDEN_V19_IDS.datasheetSnapshot,
    ];
    if (
      completeAuthorityIsExact(allocationAuthority) &&
      revisions.length === 3 &&
      deleteOperations.length === 1 &&
      lasting?.revisionSequence === 3 &&
      lasting.lifecycleState === 'FINALIZED' &&
      lasting.purpose === GOLDEN_V19_PURPOSE &&
      lasting.internalNote === GOLDEN_V19_INTERNAL_NOTE &&
      operation?.state === 'COMPLETED' &&
      operation.revisionId === GOLDEN_V19_IDS.deletedRevision &&
      operation.reusedByRevisionId === GOLDEN_V19_IDS.lastingRevision &&
      operation.reuseReason === GOLDEN_V19_REUSE_REASON &&
      outputs.length === expectedOutputIds.length &&
      expectedOutputIds.every((id) =>
        outputs.some(
          (output) =>
            output.outputId === id &&
            output.lifecycleState === 'FINALIZED' &&
            output.revisionId === GOLDEN_V19_IDS.lastingRevision,
        ),
      ) &&
      snapshots.length === expectedSnapshotIds.length &&
      expectedSnapshotIds.every((id) =>
        snapshots.some((snapshot) => snapshot.deliverableId === id),
      ) &&
      packages.length === 2 &&
      packages.some(
        (item) =>
          item.packageId === GOLDEN_V19_IDS.initialPackage &&
          item.packageSequence === 1 &&
          item.lifecycleState === 'FINALIZED',
      ) &&
      packages.some(
        (item) =>
          item.packageId === GOLDEN_V19_IDS.reissuePackage &&
          item.packageSequence === 2 &&
          item.lifecycleState === 'FINALIZED',
      )
    ) {
      return 'COMPLETE';
    }
    throw new Error('CONFLICT: partial or conflicting Golden v19 Revision/delete state exists.');
  }
  assertCleanBaselineAuthority(allocationAuthority);
  const database = registry.getSharedDatabase();
  const fixedIdentities = Object.values(GOLDEN_V19_IDS);
  const collisionTables: Array<[string, string]> = [
    ['canonical_revisions', 'revision_id'],
    ['canonical_outputs', 'output_id'],
    ['revision_document_snapshots', 'deliverable_id'],
    ['canonical_issue_packages', 'package_id'],
    ['revision_delete_operations', 'operation_id'],
  ];
  for (const [table, column] of collisionTables) {
    for (const identity of fixedIdentities) {
      const row = database
        .prepare(`SELECT 1 AS present FROM ${table} WHERE ${column} = ?`)
        .get(identity);
      if (row)
        throw new Error(`CONFLICT: deterministic fixture identity ${identity} is already in use.`);
    }
  }
  return 'BASELINE';
}

function ensureDocument(
  harness: GoldenUatHarness,
  project: Project,
  input: {
    category: 'Drawing' | 'LuxReport' | 'Other';
    documentNumber: string;
    title: string;
    filePath: string;
  },
): ProjectDocument {
  const matches = harness.store
    .getWorkspace(project.id)
    .documents.filter((document) => document.documentNumber === input.documentNumber);
  if (matches.length > 1) {
    throw new Error(`CONFLICT: duplicate fixture ProjectDocument ${input.documentNumber}.`);
  }
  const existing = matches[0];
  if (existing) {
    if (
      existing.category !== input.category ||
      existing.title !== input.title ||
      path.resolve(existing.filePath) !== path.resolve(input.filePath)
    ) {
      throw new Error(`CONFLICT: fixture ProjectDocument ${input.documentNumber} differs.`);
    }
    return existing;
  }
  return harness.store.operations.createDocument(project.id, {
    ...input,
    revision: 'REV_03',
    status: 'Working',
    issuedTo: 'Fixture tooling',
    issueDate: null,
    notes: 'Golden v19 fixture-owned source.',
  });
}

function writeFixtureFile(root: string, file: GoldenV19FixtureFile): string {
  const target = path.resolve(root, file.relativePath);
  writeGoldenFixtureFile(root, target, file.bytes);
  return target;
}

function inspectExistingFixtureFile(
  root: string,
  file: GoldenV19FixtureFile,
): { target: string; bytes: Buffer; sha256: string; sizeBytes: number } {
  const target = path.resolve(root, file.relativePath);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`CONFLICT: fixture file escapes its owned root: ${target}`);
  }
  if (!existsSync(target)) throw new Error(`MISSING: completed fixture file is absent: ${target}`);
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`CONFLICT: completed fixture path is not a regular file: ${target}`);
  }
  const bytes = readFileSync(target);
  return {
    target,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: stats.size,
  };
}

function assertExistingFixtureFile(root: string, file: GoldenV19FixtureFile): void {
  const actual = inspectExistingFixtureFile(root, file);
  if (actual.sha256 !== file.sha256 || actual.sizeBytes !== file.sizeBytes) {
    throw new Error(`HASH_MISMATCH: completed fixture bytes differ at ${actual.target}`);
  }
}

async function assertExistingGeneratedFixtureFile(
  root: string,
  file: GoldenV19FixtureFile,
  registry: CanonicalOutputRegistryStore,
): Promise<void> {
  const xlsx: { kind: GoldenV19XlsxKind; outputId: string } | undefined =
    file.logicalId === 'output-schedule-xlsx'
      ? { kind: 'SCHEDULE', outputId: GOLDEN_V19_IDS.scheduleXlsx }
      : file.logicalId === 'output-boq-xlsx'
        ? { kind: 'TECHNICAL_BOQ', outputId: GOLDEN_V19_IDS.boqXlsx }
        : undefined;
  if (!xlsx) {
    assertExistingFixtureFile(root, file);
    return;
  }
  const actual = inspectExistingFixtureFile(root, file);
  const semantics = await inspectGoldenV19XlsxSemantics(actual.bytes, xlsx.kind);
  if (!semantics.matches) {
    throw new Error(`HASH_MISMATCH: completed fixture XLSX semantics differ at ${actual.target}`);
  }
  const output = registry.getOutput(xlsx.outputId);
  if (output.contentHash !== actual.sha256) {
    throw new Error(`HASH_MISMATCH: completed fixture bytes differ at ${actual.target}`);
  }
}

function snapshotById(
  snapshots: readonly RevisionDocumentSnapshotRecord[],
  id: string,
): RevisionDocumentSnapshotRecord {
  const snapshot = snapshots.find((candidate) => candidate.deliverableId === id);
  if (!snapshot) throw new Error(`MISSING: expected fixture snapshot ${id}.`);
  return snapshot;
}

/**
 * Applies only the additive Phase 2 v19 graph to an already-established exact
 * Golden baseline. Callers must have separately authorized APPLY; this method
 * is intentionally not invoked by PLAN or the read-only verifier.
 */
export async function applyGoldenV19Reality(
  harness: GoldenUatHarness,
  sourceRootInput: string,
): Promise<GoldenV19ApplyResult> {
  const project = await exactGoldenProject(harness);
  const workspaceBefore = harness.store.getWorkspace(project.id);
  if (!workspaceBefore.folderPath) {
    throw new Error('CONFLICT: Golden Project business folder is not connected.');
  }
  const sourceRoot = path.resolve(sourceRootInput);
  const projectRoot = path.resolve(workspaceBefore.folderPath);
  const queues = expectedQueues();
  const registry = new CanonicalOutputRegistryStore(
    harness.store.getSharedDatabase(),
    { now: () => new Date('2026-08-12T08:00:00.000Z') },
    'CANONICAL',
    fixtureIdentityFactory(queues),
  );
  const sourceFiles = goldenV19SourceFiles();
  const generatedOutputFiles = await goldenV19GeneratedOutputFiles();
  // Re-run the shared authority immediately before any possible mutation. PLAN
  // output is advisory and is never trusted as an APPLY-time guard.
  const state = classifyGoldenV19State(registry);
  if (state === 'COMPLETE') {
    for (const file of sourceFiles) assertExistingFixtureFile(sourceRoot, file);
    for (const file of generatedOutputFiles)
      await assertExistingGeneratedFixtureFile(projectRoot, file, registry);
    return {
      changed: false,
      projectId: project.id,
      deletedRevisionId: GOLDEN_V19_IDS.deletedRevision,
      revisionId: GOLDEN_V19_IDS.lastingRevision,
      deleteOperationId: GOLDEN_V19_IDS.deleteOperation,
      packageIds: [GOLDEN_V19_IDS.initialPackage, GOLDEN_V19_IDS.reissuePackage],
      sourceFiles,
      generatedOutputFiles,
    };
  }

  // Preflight every fixture-owned direct write before the first source byte is
  // written. A later conflicting file cannot leave an earlier source behind.
  for (const file of sourceFiles) {
    preflightGoldenFixtureFile(sourceRoot, path.resolve(sourceRoot, file.relativePath), file.bytes);
  }
  for (const file of generatedOutputFiles) {
    preflightGoldenFixtureFile(
      projectRoot,
      path.resolve(projectRoot, file.relativePath),
      file.bytes,
    );
  }

  const sourcePaths = new Map(
    sourceFiles.map((file) => [file.logicalId, writeFixtureFile(sourceRoot, file)]),
  );
  const deleteDocument = ensureDocument(harness, project, {
    category: 'Other',
    documentNumber: 'G19-DELETE-EVIDENCE',
    title: 'Golden v19 temporary delete evidence',
    filePath: sourcePaths.get('source-delete-evidence')!,
  });
  const drawingDocument = ensureDocument(harness, project, {
    category: 'Drawing',
    documentNumber: 'L-301-G19',
    title: 'Golden v19 Lighting Layout',
    filePath: sourcePaths.get('source-drawing')!,
  });
  const dialuxDocument = ensureDocument(harness, project, {
    category: 'LuxReport',
    documentNumber: 'DX-301-G19',
    title: 'Golden v19 DIALux Report',
    filePath: sourcePaths.get('source-dialux-report')!,
  });

  const deliverables = new RevisionDeliverableService(harness.store, registry);
  const temp = deliverables.prepareRevision(
    project,
    harness.store.getWorkspace(project.id),
    harness.admin,
  );
  if (temp.revisionId !== GOLDEN_V19_IDS.deletedRevision || temp.revisionSequence !== 3) {
    throw new Error(
      'CONFLICT: temporary fixture Revision did not receive deterministic sequence 3.',
    );
  }
  await deliverables.createDocumentSnapshot(
    project,
    harness.store.getWorkspace(project.id),
    harness.admin,
    temp.revisionId,
    { sourceDocumentId: deleteDocument.id, title: 'Temporary Safe Delete evidence' },
  );
  const deleteService = new RevisionDeleteService(
    harness.store,
    registry,
    () => new Date('2026-08-12T08:10:00.000Z'),
    () => GOLDEN_V19_IDS.deleteOperation,
  );
  const eligibility = await deleteService.deleteEligibility(
    project,
    temp.revisionId,
    harness.admin,
  );
  if (!eligibility.canDelete || eligibility.deleteAction !== 'DELETE') {
    throw new Error(
      `CONFLICT: temporary fixture Revision is not Safe Delete eligible: ${eligibility.blockedReasons.join(', ')}`,
    );
  }
  const deleted = await deleteService.deleteRevision(project, temp.revisionId, harness.admin);
  if (
    deleted.operation.operationId !== GOLDEN_V19_IDS.deleteOperation ||
    deleted.operation.state !== 'COMPLETED'
  ) {
    throw new Error(
      'CONFLICT: Safe Delete did not produce the expected completed fixture tombstone.',
    );
  }

  const reuse = new RevisionReuseService(
    harness.store,
    registry,
    () => new Date('2026-08-12T08:20:00.000Z'),
  );
  const revision = reuse.reuseRevision(project, harness.admin, {
    deleteOperationId: GOLDEN_V19_IDS.deleteOperation,
    reason: GOLDEN_V19_REUSE_REASON,
  });
  if (revision.revisionId !== GOLDEN_V19_IDS.lastingRevision || revision.revisionSequence !== 3) {
    throw new Error('CONFLICT: deliberate reuse did not create the lasting deterministic REV_03.');
  }
  deliverables.updateRevisionMetadata(project, revision.revisionId, {
    purpose: GOLDEN_V19_PURPOSE,
    internalNote: GOLDEN_V19_INTERNAL_NOTE,
  });

  registry.registerBuiltInTemplateVersions('GOLDEN_V19_FIXTURE');
  registry.registerTechnicalBoqTemplateVersion('GOLDEN_V19_FIXTURE');
  const scheduleTemplate = registry.resolveEffectiveTechnicalScheduleTemplate(project.id);
  const boqTemplate = registry.resolveEffectiveTechnicalBoqTemplate(project.id);
  for (const file of generatedOutputFiles) {
    writeFixtureFile(projectRoot, file);
    const family = file.logicalId.includes('schedule') ? 'LuminaireSchedule' : 'TechnicalBoq';
    const output = registry.createOutput({
      revisionId: revision.revisionId,
      outputFamily: family,
      outputFormat: path.extname(file.relativePath).slice(1).toUpperCase(),
      relativePath: file.relativePath,
      contentHash: file.sha256,
      resolvedTemplate: family === 'LuminaireSchedule' ? scheduleTemplate : boqTemplate,
    });
    registry.setOutputLifecycle(output.outputId, 'FINALIZED');
  }

  await deliverables.createDocumentSnapshot(
    project,
    harness.store.getWorkspace(project.id),
    harness.admin,
    revision.revisionId,
    { sourceDocumentId: drawingDocument.id, title: 'Golden v19 Lighting Layout' },
  );
  await deliverables.createDocumentSnapshot(
    project,
    harness.store.getWorkspace(project.id),
    harness.admin,
    revision.revisionId,
    { sourceDocumentId: dialuxDocument.id, title: 'Golden v19 DIALux Report' },
  );

  const workspaceWithDocuments = harness.store.getWorkspace(project.id);
  const luminaire = workspaceWithDocuments.luminaires.find((candidate) => candidate.tag === 'DL01');
  if (!luminaire)
    throw new Error('MISSING: Golden v19 fixture requires the existing DL01 Luminaire.');
  const datasheetPath = sourcePaths.get('source-datasheet')!;
  const expectedDatasheet = sourceFiles.find((file) => file.logicalId === 'source-datasheet')!;
  const matchingVersions = harness.store
    .listLuminaireAssetVersions(project.id, luminaire.id, 'Datasheet')
    .filter((version) => path.resolve(version.filePath) === path.resolve(datasheetPath));
  if (matchingVersions.length > 1)
    throw new Error('CONFLICT: duplicate fixture Datasheet AssetVersions.');
  const assetVersion =
    matchingVersions[0] ??
    harness.store.attachLuminaireAsset(
      project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: datasheetPath },
      harness.admin,
    );
  if (
    assetVersion.fileHash !== expectedDatasheet.sha256 ||
    assetVersion.sizeBytes !== expectedDatasheet.sizeBytes
  ) {
    throw new Error(
      'HASH_MISMATCH: fixture Datasheet AssetVersion proof differs from source bytes.',
    );
  }
  await deliverables.addDatasheetDeliverable(
    project,
    revision.revisionId,
    assetVersion.id,
    harness.admin,
  );
  await deliverables.finalizeRevision(project, revision.revisionId);

  const snapshots = registry.listDocumentSnapshotsForRevision(revision.revisionId);
  snapshotById(snapshots, GOLDEN_V19_IDS.drawingSnapshot);
  snapshotById(snapshots, GOLDEN_V19_IDS.dialuxSnapshot);
  snapshotById(snapshots, GOLDEN_V19_IDS.datasheetSnapshot);
  const selectedItemIds = [
    ...registry.listOutputsForRevision(revision.revisionId).map((output) => output.outputId),
    ...snapshots.map((snapshot) => snapshot.deliverableId),
  ];
  const packageIds = queues.packages;
  const packages = new CanonicalIssuePackageService(
    harness.store,
    registry,
    () => new Date('2026-08-12T09:00:00.000Z'),
    () => shiftRequired(packageIds, 'Package'),
  );
  for (const [index, packageId] of [
    GOLDEN_V19_IDS.initialPackage,
    GOLDEN_V19_IDS.reissuePackage,
  ].entries()) {
    const created = await packages.create(
      project,
      harness.store.getWorkspace(project.id),
      harness.admin,
      {
        revisionNumber: 3,
        reissueNumber: index,
        label: index === 0 ? 'Golden REV_03 Initial Issue' : 'Golden REV_03 Reissue 1',
        status: 'Issued',
        outputMode: 'Folder',
        relativeOutputFolder: index === 0 ? 'ISSUED/REV_03' : 'ISSUED/REV_03_REISSUE_1',
        selectedItemIds,
        warningOverrideReason: 'Deterministic Golden v19 fixture issue.',
      },
      [],
    );
    if (
      created.id !== packageId ||
      created.revisionNumber !== 3 ||
      created.reissueNumber !== index
    ) {
      throw new Error('CONFLICT: Package authority did not preserve deterministic REV_03 binding.');
    }
  }

  const verifier = new PackageReproducibilityService(
    registry,
    () => projectRoot,
    () => new Date('2026-08-12T10:00:00.000Z'),
  );
  for (const packageId of [GOLDEN_V19_IDS.initialPackage, GOLDEN_V19_IDS.reissuePackage]) {
    const result = await verifier.verify(project.id, packageId);
    if (result?.status !== 'VERIFIED') {
      throw new Error(`HASH_MISMATCH: constructed Package ${packageId} failed verification.`);
    }
  }
  const history = new IssueHistoryService(registry).list(project.id);
  const serializedHistory = JSON.stringify(history);
  if (
    history.length !== 2 ||
    history.some((item) => item.revision.revisionId !== revision.revisionId) ||
    !serializedHistory.includes(GOLDEN_V19_PURPOSE) ||
    serializedHistory.includes('internalNote') ||
    serializedHistory.includes(GOLDEN_V19_INTERNAL_NOTE)
  ) {
    throw new Error(
      'CONFLICT: Issue History privacy or exact Revision binding verification failed.',
    );
  }

  return {
    changed: true,
    projectId: project.id,
    deletedRevisionId: temp.revisionId,
    revisionId: revision.revisionId,
    deleteOperationId: deleted.operation.operationId,
    packageIds: [GOLDEN_V19_IDS.initialPackage, GOLDEN_V19_IDS.reissuePackage],
    sourceFiles,
    generatedOutputFiles,
  };
}
