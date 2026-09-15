/**
 * V4-GENERIC-PACKAGE-DELIVERABLES-B2 — Generic immutable Package Deliverable
 * membership foundation.
 *
 * Proves the B2 authority end to end:
 *  - v14 schema surface (generic revision_package_deliverables authority)
 *  - catalog exposes GeneratedOutput + DocumentSnapshot eligible deliverables
 *    scoped to catalog.revisionId (null fails closed)
 *  - package create resolves both source types against ONE canonical Revision
 *  - cross-revision / cross-project / duplicate / mutable-document / missing
 *    artifact selections reject before any materialization
 *  - v2 manifest carries generic deliverables[] with immutable proofs
 *  - DWG / JPG / PNG snapshot artifacts remain valid package contents
 *  - recovery verifies every generic member (presence + SHA-256 + ownership)
 *    and never rebuilds a snapshot from the mutable ProjectDocument
 *  - reissue stays on the same Revision with a new Package identity
 *  - Output-only compatibility: legacy non-canonical catalog keeps
 *    revisionId === null
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { RevisionPackageService } from './revision-package-service';
import type { LightingPackageRenderer } from './luminaire-export-service';
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
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import {
  canonicalPackageManifestSchema,
  CanonicalIssuePackageService,
} from './infrastructure/output-registry/CanonicalIssuePackageService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { resolveCanonicalArtifactPath } from './infrastructure/output-registry/canonical-artifact-files';

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
  project: Project;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  packages: CanonicalIssuePackageService;
  generation: CanonicalGenerationService;
  deliverables: RevisionDeliverableService;
  legacyPackages: RevisionPackageService;
}

class FakeRenderer implements LightingPackageRenderer {
  public constructor(private readonly scratchRoot: string) {}

  public async render(
    _project: Project,
    _workspace: Parameters<LightingPackageRenderer['render']>[1],
    input: Parameters<LightingPackageRenderer['render']>[2],
  ): Promise<{
    scheduleExcelPath: string;
    schedulePdfPath: string;
    boqExcelPath: string;
    boqPdfPath: string;
    datasheetFolder: string;
    datasheetCount: number;
    cleanup: () => Promise<void>;
  }> {
    const folder = mkdtempSync(path.join(this.scratchRoot, 'renderer-'));
    const scheduleExcelPath = path.join(folder, 'schedule.xlsx');
    const schedulePdfPath = path.join(folder, 'schedule.pdf');
    const boqExcelPath = path.join(folder, 'boq.xlsx');
    const boqPdfPath = path.join(folder, 'boq.pdf');
    writeFileSync(scheduleExcelPath, `schedule-xlsx:${input.revision}`);
    writeFileSync(schedulePdfPath, `schedule-pdf:${input.revision}`);
    writeFileSync(boqExcelPath, `boq-xlsx:${input.revision}`);
    writeFileSync(boqPdfPath, `boq-pdf:${input.revision}`);
    return {
      scheduleExcelPath,
      schedulePdfPath,
      boqExcelPath,
      boqPdfPath,
      datasheetFolder: folder,
      datasheetCount: 0,
      cleanup: async () => rmSync(folder, { recursive: true, force: true }),
    };
  }
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-package-b2-'));
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
  store.addLuminaire(project.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'B2 generic package test luminaire',
    manufacturer: 'Test Manufacturer',
    model: 'DL-100',
    wattage: '8W',
    lumens: '720 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '24 degrees',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '85 mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '08_DATASHEETS/DL01.pdf',
    location: 'Lobby',
    unit: 'No.',
    quantity: 12,
    notes: 'B2 package snapshot',
    sourceName: 'Manual',
    dimensions: '95 x 110 mm',
    bodyColorFinish: 'Black',
  });
  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV15SnapshotProvenanceColumn(database);
  applyV16SnapshotRebuild(database);
  applyV17RevisionDeleteTable(database);
  let tick = 0;
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(Date.parse('2026-08-20T08:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const renderer = new FakeRenderer(root);
  const generation = new CanonicalGenerationService(store, registry, renderer);
  const deliverables = new RevisionDeliverableService(store, registry);
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    packages: new CanonicalIssuePackageService(
      store,
      registry,
      () => new Date('2026-08-20T10:00:00.000Z'),
    ),
    generation,
    deliverables,
    legacyPackages: new RevisionPackageService(store),
  };
}

/** Standalone generation: creates + finalizes a canonical Revision with Outputs. */
async function generateOutputs(harness: Harness) {
  return await harness.generation.generate(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    { revision: '99', issueStatus: 'For Review', issueDate: '2026-08-20' },
  );
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

/** Adds an immutable Document Snapshot to a PREPARING manual Revision. */
async function addSnapshot(
  harness: Harness,
  revisionId: string,
  relativePath: string,
  content: string,
  title: string,
) {
  const document = addDocument(harness, relativePath, content);
  return await harness.deliverables.createDocumentSnapshot(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    revisionId,
    { sourceDocumentId: document.id, title },
  );
}

/** A composed B0 draft: MANUAL_DELIVERABLES PREPARING Revision. */
function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
  );
}

/** C1 targeted Schedule/BOQ generation into an existing PREPARING composed Revision. */
async function targetGenerate(harness: Harness, targetRevisionId: string) {
  return await harness.generation.generateSchedule(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    {
      format: 'Both',
      issueStatus: 'For Review',
      issueDate: '2026-08-20',
      targetRevisionId,
    },
  );
}

function packageRequest(
  _harness: Harness,
  selectedItemIds: string[],
  overrides: Partial<{
    status: 'Draft' | 'Issued';
    label: string;
    relativeOutputFolder: string;
    recoveryPackageId: string;
  }> = {},
) {
  return {
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'REV_01 B2 Package',
    status: 'Draft' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_B2',
    selectedItemIds,
    warningOverrideReason: '',
    ...overrides,
  };
}

function readManifest(harness: Harness, record: { folderPath: string; id: string }) {
  const locator = harness.registry.getIssuePackage(record.id).manifestLocatorValue;
  expect(locator).toBeTruthy();
  return canonicalPackageManifestSchema.parse(
    JSON.parse(readFileSync(path.join(harness.projectRoot, locator!), 'utf8')),
  );
}

function countRows(harness: Harness, table: string): number {
  const row = harness.store
    .getSharedDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return Number(row.count);
}

describe('B2 — generic package deliverable persistence (v14 authority)', () => {
  it('A1: v14 table exists and new canonical memberships land ONLY in the generic authority', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(
        harness,
        generated.outputs.map((output) => output.outputId),
      ),
      [],
    );
    // The generic table is the single writable authority.
    expect(countRows(harness, 'revision_package_deliverables')).toBe(4);
    expect(countRows(harness, 'canonical_package_outputs')).toBe(0);
    const members = harness.registry.listPackageDeliverables(record.id);
    expect(members).toHaveLength(4);
    expect(members.every((member) => member.sourceType === 'GeneratedOutput')).toBe(true);
    expect(members.every((member) => member.revisionId === generated.revision.revisionId)).toBe(
      true,
    );
  });

  it('A3: duplicate member selection rejects before any package materialization', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const duplicate = [generated.outputs[0]!.outputId, generated.outputs[0]!.outputId];
    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, duplicate, { relativeOutputFolder: 'ISSUED/DUPLICATE' }),
        [],
      ),
    ).rejects.toThrow('must be unique');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(0);
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'DUPLICATE'))).toBe(false);
  });
});

describe('B2 — catalog (GeneratedOutput + DocumentSnapshot eligible deliverables)', () => {
  it('B4: canonical catalog exposes both source types from the exact revisionId', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout-A.dwg',
      'dwg-bytes',
      'Layout DWG',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    expect(catalog.revisionId).toBe(target.revisionId);
    // Generated Outputs (Schedule PDF/XLSX, BOQ PDF/XLSX) are eligible.
    const outputs = harness.registry.listOutputsForRevision(target.revisionId);
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(catalog.items.some((item) => item.id === output.outputId)).toBe(true);
    }
    // The Document Snapshot is eligible under the neutral Documents group.
    const snapshotItem = catalog.items.find((item) => item.id === snapshot.deliverableId);
    expect(snapshotItem).toBeDefined();
    expect(snapshotItem?.group).toBe('Documents');
    expect(snapshotItem?.available).toBe(true);
  });

  it('B5: catalog only returns deliverables from catalog.revisionId (no cross-revision bleed)', async () => {
    const harness = createHarness();
    const first = prepareManualRevision(harness);
    await addSnapshot(harness, first.revisionId, 'Drawings/First.dwg', 'first', 'First');
    await harness.deliverables.finalizeRevision(harness.project, first.revisionId);

    const second = prepareManualRevision(harness);
    await addSnapshot(harness, second.revisionId, 'Drawings/Second.dwg', 'second', 'Second');
    await harness.deliverables.finalizeRevision(harness.project, second.revisionId);

    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    // The catalog selects the newest eligible Revision only.
    expect(catalog.revisionId).toBe(second.revisionId);
    const ids = new Set(
      catalog.items.filter((item) => !item.id.startsWith('missing:')).map((item) => item.id),
    );
    const secondSnapshots = harness.registry.listDocumentSnapshotsForRevision(second.revisionId);
    const firstSnapshots = harness.registry.listDocumentSnapshotsForRevision(first.revisionId);
    expect(secondSnapshots.every((snapshot) => ids.has(snapshot.deliverableId))).toBe(true);
    expect(firstSnapshots.every((snapshot) => !ids.has(snapshot.deliverableId))).toBe(true);
  });

  it('B6: catalog revisionId null fails closed with no eligible Revision', async () => {
    const harness = createHarness();
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    expect(catalog.revisionId).toBeNull();
    expect(
      harness.registry
        .listRevisions(harness.project.id)
        .some((revision) => revision.revisionId === catalog.revisionId),
    ).toBe(false);
  });

  it('B-elig: missing/unproven artifacts are never eligible catalog contents', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    // Remove one generated artifact and the snapshot artifact from disk.
    const missingOutput = generated.outputs[0]!;
    rmSync(resolveCanonicalArtifactPath(harness.projectRoot, missingOutput.locatorValue!));
    rmSync(resolveCanonicalArtifactPath(harness.projectRoot, snapshot.locatorValue));

    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    // The missing GeneratedOutput is not offered; the missing snapshot is not offered.
    expect(catalog.items.some((item) => item.id === missingOutput.outputId)).toBe(false);
    expect(catalog.items.some((item) => item.id === snapshot.deliverableId)).toBe(false);
  });
});

describe('B2 — package create (typed generic deliverable resolution)', () => {
  it('C7: Output-only package still works (regression)', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(
        harness,
        generated.outputs.map((output) => output.outputId),
        { relativeOutputFolder: 'ISSUED/OUTPUT_ONLY' },
      ),
      [],
    );
    expect(record.itemCount).toBe(4);
    const manifest = readManifest(harness, record);
    expect(manifest.outputs).toHaveLength(4);
    expect(manifest.deliverables).toHaveLength(4);
    expect(manifest.deliverables.every((item) => item.sourceType === 'GeneratedOutput')).toBe(true);
  });

  it('C8: Snapshot-only package works', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const pdf = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Plan.pdf',
      'pdf-bytes',
      'Plan PDF',
    );
    const jpg = await addSnapshot(
      harness,
      target.revisionId,
      'Render/Concept.jpg',
      'jpg-bytes',
      'Concept JPG',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, [pdf.deliverableId, jpg.deliverableId], {
        relativeOutputFolder: 'ISSUED/SNAPSHOT_ONLY',
      }),
      [],
    );
    expect(record.itemCount).toBe(2);
    const manifest = readManifest(harness, record);
    expect(manifest.outputs).toHaveLength(0);
    expect(manifest.deliverables).toHaveLength(2);
    expect(manifest.deliverables.every((item) => item.sourceType === 'DocumentSnapshot')).toBe(
      true,
    );
    expect(manifest.deliverables.every((item) => /^[0-9a-f]{64}$/.test(item.contentHash))).toBe(
      true,
    );
    // Both snapshots land under the Documents group with their original extensions.
    expect(
      manifest.deliverables.some(
        (item) => item.sourceType === 'DocumentSnapshot' && item.fileName.endsWith('.pdf'),
      ),
    ).toBe(true);
    expect(
      manifest.deliverables.some(
        (item) => item.sourceType === 'DocumentSnapshot' && item.fileName.endsWith('.jpg'),
      ),
    ).toBe(true);
  });

  it('C9+C10: mixed GeneratedOutput + DocumentSnapshot package works with all members on the exact revision', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const dwg = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg-bytes',
      'Layout DWG',
    );
    const pdf = await addSnapshot(
      harness,
      target.revisionId,
      'Report/Dialux.pdf',
      'dialux-pdf',
      'DIALux PDF',
    );
    const jpg = await addSnapshot(
      harness,
      target.revisionId,
      'Render/Render.jpg',
      'render-jpg',
      'Concept Render',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const selectedItemIds = [
      ...generated.outputs.map((output) => output.outputId),
      dwg.deliverableId,
      pdf.deliverableId,
      jpg.deliverableId,
    ];
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/MIXED' }),
      [],
    );
    expect(record.itemCount).toBe(generated.outputs.length + 3);
    const manifest = readManifest(harness, record);
    expect(manifest.deliverables).toHaveLength(generated.outputs.length + 3);
    expect(
      manifest.deliverables.every(
        (item) => item.sourceType === 'GeneratedOutput' || item.sourceType === 'DocumentSnapshot',
      ),
    ).toBe(true);
    // Every member belongs to the exact package Revision.
    expect(
      manifest.deliverables.every((item) => {
        const sourceId = item.sourceType === 'GeneratedOutput' ? item.outputId : item.deliverableId;
        return (
          (item.sourceType === 'GeneratedOutput'
            ? harness.registry.getOutput(sourceId).revisionId
            : harness.registry.getDocumentSnapshot(sourceId).revisionId) === target.revisionId
        );
      }),
    ).toBe(true);
    // The package itself is bound to the same Revision.
    expect(harness.registry.getIssuePackage(record.id).revisionId).toBe(target.revisionId);
    // The packaged DWG keeps its extension (never forced to PDF).
    expect(
      manifest.deliverables.some(
        (item) => item.sourceType === 'DocumentSnapshot' && item.fileName.endsWith('.dwg'),
      ),
    ).toBe(true);
  });

  it('C11: cross-revision member selection rejects', async () => {
    const harness = createHarness();
    const first = prepareManualRevision(harness);
    const firstOutput = (await targetGenerate(harness, first.revisionId)).outputs[0]!;
    const second = prepareManualRevision(harness);
    const secondSnapshot = await addSnapshot(
      harness,
      second.revisionId,
      'Drawings/Second.dwg',
      's2',
      'Second',
    );
    await harness.deliverables.finalizeRevision(harness.project, first.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, second.revisionId);

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, [firstOutput.outputId, secondSnapshot.deliverableId], {
          relativeOutputFolder: 'ISSUED/CROSS_REVISION',
        }),
        [],
      ),
    ).rejects.toThrow('cannot mix Deliverables from different Revisions');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(0);
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'CROSS_REVISION'))).toBe(false);
  });

  it('C12: cross-project member selection rejects', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const otherProject = structuredClone(seedProjects[1]!);
    const otherHarness = createHarness();
    otherHarness.store.initializeProject(
      otherProject.id,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      otherProject.requiredDeliveryDate,
    );
    const otherTarget = prepareManualRevision(otherHarness);
    const otherSnapshot = await addSnapshot(
      otherHarness,
      otherTarget.revisionId,
      'Drawings/Other.dwg',
      'other',
      'Other',
    );
    await otherHarness.deliverables.finalizeRevision(otherHarness.project, otherTarget.revisionId);

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, [snapshot.deliverableId, otherSnapshot.deliverableId], {
          relativeOutputFolder: 'ISSUED/CROSS_PROJECT',
        }),
        [],
      ),
    ).rejects.toThrow(
      /no longer exist in the immutable Revision authority|cannot mix Deliverables/,
    );
    expect(countRows(harness, 'canonical_issue_packages')).toBe(0);
  });

  it('C13: a mutable ProjectDocument UUID cannot be used as a package member', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    const document = addDocument(harness, 'Drawings/RegisterOnly.pdf', 'register-only');
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, [document.id], { relativeOutputFolder: 'ISSUED/DOCUMENT_ID' }),
        [],
      ),
    ).rejects.toThrow('no longer exist in the immutable Revision authority');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(0);
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'DOCUMENT_ID'))).toBe(false);
  });

  it('C14: duplicate generic member rejects via table constraint', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const issuePackage = harness.registry.createIssuePackage({
      revisionId: target.revisionId,
      label: 'Duplicate member',
      artifactRelativePath: 'ISSUED/DUP_MEMBER',
      manifestRelativePath: 'ISSUED/DUP_MEMBER/SCLI_PACKAGE_MANIFEST.json',
      issuedBy: null,
      issuedAt: null,
    });
    harness.registry.addPackageDeliverable(
      issuePackage.packageId,
      'DocumentSnapshot',
      snapshot.deliverableId,
    );
    expect(() =>
      harness.registry.addPackageDeliverable(
        issuePackage.packageId,
        'DocumentSnapshot',
        snapshot.deliverableId,
      ),
    ).toThrow();
  });

  it('C15: missing artifact rejects before successful issue/materialization', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg-bytes',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    rmSync(resolveCanonicalArtifactPath(harness.projectRoot, snapshot.locatorValue));

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, [snapshot.deliverableId], {
          relativeOutputFolder: 'ISSUED/MISSING_ARTIFACT',
        }),
        [],
      ),
    ).rejects.toThrow('missing or is not a regular file');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(1);
    expect(harness.registry.listIssuePackages()[0]?.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'MISSING_ARTIFACT'))).toBe(false);
  });
});

describe('B2 — manifest generic deliverables truth', () => {
  it('D16+D17+D18+D19: mixed manifest carries deliverables[] with immutable proofs from the authorities', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg-bytes',
      'Layout DWG',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, [generated.outputs[0]!.outputId, snapshot.deliverableId], {
        relativeOutputFolder: 'ISSUED/MANIFEST_TRUTH',
      }),
      [],
    );
    const manifest = readManifest(harness, record);
    expect(manifest.version).toBe(2);
    expect(manifest.deliverables).toHaveLength(2);

    const outputEntry = manifest.deliverables.find(
      (item) => item.sourceType === 'GeneratedOutput',
    )!;
    const output = harness.registry.getOutput(generated.outputs[0]!.outputId);
    expect(outputEntry.outputId).toBe(output.outputId);
    expect(outputEntry.contentHash).toBe(output.contentHash);
    expect(outputEntry.storedRelativeLocator).toBe(output.locatorValue);

    const snapshotEntry = manifest.deliverables.find(
      (item) => item.sourceType === 'DocumentSnapshot',
    )!;
    const snapshotRecord = harness.registry.getDocumentSnapshot(snapshot.deliverableId);
    // Hash + locator come from the immutable snapshot authority, never the
    // mutable ProjectDocument register.
    expect(snapshotEntry.deliverableId).toBe(snapshotRecord.deliverableId);
    expect(snapshotEntry.contentHash).toBe(snapshotRecord.contentHash);
    expect(snapshotEntry.storedRelativeLocator).toBe(snapshotRecord.locatorValue);
    expect(snapshotEntry.title).toBe(snapshotRecord.title);
    expect(snapshotEntry.category).toBe(snapshotRecord.category);
    // Compatibility projection retains the generated-output metadata.
    expect(manifest.outputs).toHaveLength(1);
    expect(manifest.outputs[0]!.outputId).toBe(output.outputId);
  });

  it('D20+D21: DWG and JPG/PNG snapshots remain valid package contents', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const dwg = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg-bytes',
      'Layout DWG',
    );
    const png = await addSnapshot(
      harness,
      target.revisionId,
      'Render/Render.png',
      'png-bytes',
      'Render PNG',
    );
    const jpg = await addSnapshot(
      harness,
      target.revisionId,
      'Render/Concept.jpg',
      'jpg-bytes',
      'Concept JPG',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, [dwg.deliverableId, png.deliverableId, jpg.deliverableId], {
        relativeOutputFolder: 'ISSUED/EXTENSIONS',
      }),
      [],
    );
    const manifest = readManifest(harness, record);
    expect(manifest.deliverables).toHaveLength(3);
    const extensions = manifest.deliverables
      .map((item) =>
        path.extname(
          item.sourceType === 'DocumentSnapshot' ? item.fileName : item.packageRelativePath,
        ),
      )
      .sort();
    expect(extensions).toEqual(['.dwg', '.jpg', '.png']);
  });
});

describe('B2 — recovery (uniform generic member validation)', () => {
  it('E22: mixed package recovery succeeds when all artifacts and hash proofs are valid', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const selectedItemIds = [generated.outputs[0]!.outputId, snapshot.deliverableId];

    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/RECOVER_MIXED' }),
      [],
    );
    // Simulate an interrupted finalization exactly as the startup reconciler
    // would leave it: FAILED_RECOVERABLE package whose final evidence is intact,
    // projection row removed.
    harness.store
      .getSharedDatabase()
      .prepare(
        `UPDATE canonical_issue_packages
         SET lifecycle_state = 'FAILED_RECOVERABLE', finalized_at = NULL, failure_reason = ?
         WHERE package_id = ?`,
      )
      .run('B2 test interruption.', first.id);
    harness.store
      .getSharedDatabase()
      .prepare('DELETE FROM revision_packages WHERE id = ?')
      .run(first.id);

    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        relativeOutputFolder: 'ISSUED/RECOVER_MIXED',
        recoveryPackageId: first.id,
      }),
      [],
    );
    expect(recovered.id).toBe(first.id);
    expect(harness.registry.getIssuePackage(recovered.id).lifecycleState).toBe('FINALIZED');
    expect(countRows(harness, 'revision_package_deliverables')).toBe(2);
  });

  it('E23+E24: missing member source makes recovery fail closed', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const selectedItemIds = [generated.outputs[0]!.outputId, snapshot.deliverableId];

    await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/RECOVER_MISSING' }),
      [],
    );
    const failed = harness.registry.listIssuePackages()[0]!;
    expect(failed.lifecycleState).toBe('FINALIZED');
    // Force the package recoverable (direct SQL, as the reconciler would), then
    // remove one immutable source from the authority — the retry must reject
    // before materialization.
    harness.store
      .getSharedDatabase()
      .prepare(
        `UPDATE canonical_issue_packages
         SET lifecycle_state = 'FAILED_RECOVERABLE', finalized_at = NULL, failure_reason = ?
         WHERE package_id = ?`,
      )
      .run('B2 test failure.', failed.packageId);
    harness.store
      .getSharedDatabase()
      .prepare('DELETE FROM canonical_outputs WHERE output_id = ?')
      .run(generated.outputs[0]!.outputId);

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, selectedItemIds, {
          relativeOutputFolder: 'ISSUED/RECOVER_MISSING',
          recoveryPackageId: failed.packageId,
        }),
        [],
      ),
    ).rejects.toThrow('no longer exist in the immutable Revision authority');
  });

  it('E25: tampered snapshot artifact hash does NOT silently pass', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg-bytes',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    writeFileSync(
      resolveCanonicalArtifactPath(harness.projectRoot, snapshot.locatorValue),
      'tampered-bytes',
    );

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        packageRequest(harness, [snapshot.deliverableId], {
          relativeOutputFolder: 'ISSUED/TAMPERED_SNAPSHOT',
        }),
        [],
      ),
    ).rejects.toThrow('SHA-256 integrity');
    expect(harness.registry.listIssuePackages()[0]?.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'TAMPERED_SNAPSHOT'))).toBe(false);
  });

  it('E26: package bytes come from the immutable snapshot, never the mutable source', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.pdf',
      'original-pdf-bytes',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    // Mutate the source ProjectDocument AFTER the snapshot was taken.
    const sourcePath = path.join(harness.projectRoot, 'Drawings/Layout.pdf');
    writeFileSync(sourcePath, 'MUTATED source bytes that must not leak');

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, [snapshot.deliverableId], {
        relativeOutputFolder: 'ISSUED/IMMUTABLE_SOURCE',
      }),
      [],
    );
    const manifest = readManifest(harness, record);
    expect(manifest.deliverables[0]!.contentHash).toBe(snapshot.contentHash);
    expect(manifest.deliverables[0]!.contentHash).not.toBe(
      createHash('sha256').update('MUTATED source bytes that must not leak').digest('hex'),
    );
    // The packaged copy must hash-match the immutable snapshot proof.
    const packagedPath = path.join(
      record.folderPath,
      manifest.deliverables[0]!.packageRelativePath,
    );
    const packagedBytes = readFileSync(packagedPath);
    expect(createHash('sha256').update(packagedBytes).digest('hex')).toBe(snapshot.contentHash);
  });
});

describe('B2 — reissue', () => {
  it('F27+F28: reissue stays on the same Revision and mints a new Package identity', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.dwg',
      'dwg',
      'Layout',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const selectedItemIds = [generated.outputs[0]!.outputId, snapshot.deliverableId];

    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        relativeOutputFolder: 'ISSUED/REV_01_REISSUE_00',
      }),
      [],
    );
    const second = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        relativeOutputFolder: 'ISSUED/REV_01_REISSUE_01',
        label: 'REV_01 Reissue',
      }),
      [],
    );
    expect(second.id).not.toBe(first.id);
    expect(second.revisionNumber).toBe(first.revisionNumber);
    expect(second.reissueNumber).toBe(1);
    expect(harness.registry.getIssuePackage(first.id).revisionId).toBe(target.revisionId);
    expect(harness.registry.getIssuePackage(second.id).revisionId).toBe(target.revisionId);
    expect(harness.registry.getIssuePackage(second.id).packageSequence).toBe(2);
  });
});

describe('B2 — compatibility', () => {
  it('G29: legacy non-canonical catalog keeps revisionId null (C2 locked)', async () => {
    const harness = createHarness();
    const workspace = harness.store.getWorkspace(harness.project.id);
    const catalog = await harness.legacyPackages.catalog(harness.project, workspace);
    expect(catalog.revisionId).toBeNull();
    expect(catalog.suggestedRevision).toBeGreaterThanOrEqual(1);
  });
});
