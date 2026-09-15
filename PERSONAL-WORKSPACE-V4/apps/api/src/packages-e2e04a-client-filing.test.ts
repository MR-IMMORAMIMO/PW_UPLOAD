/**
 * V4-PACKAGES-E2E-04A — Client Package Folder Taxonomy + Deterministic Copy Naming.
 *
 * Proves the canonical package materializer files each deliverable into the
 * OWNER-LOCKED client taxonomy and gives Layout / DIALux DocumentSnapshots a
 * deterministic CLIENT COPY name while leaving every stored/source artifact
 * and the GeneratedOutput names untouched.
 *
 * Locked taxonomy:
 *   01_LIGHTING_LAYOUT    <- DocumentSnapshot category Drawing
 *   02_DIALUX_REPORT      <- DocumentSnapshot category LuxReport
 *   03_LUMINAIRE_SCHEDULE <- Luminaire Schedule PDF + XLSX
 *   04_TECHNICAL_BOQ      <- Technical BOQ PDF + XLSX
 *   05_DATASHEETS         <- DocumentSnapshot category Datasheet (when supplied)
 *   07_SUPPORTING_DOCUMENTS <- safe fallback for unsupported/Other snapshots
 *
 * Classification is STRUCTURED (snapshot.category), never filename/title/path
 * guessing. Copy naming uses canonical projectCode + revisionLabel authority.
 * Manifest packageRelativePath must resolve to the REAL new folder/name so
 * Verify hashes the true client-facing copy.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, DocumentCategory, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { PersonalWorkspaceStore } from './personal-workspace-store';
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
import { PackageReproducibilityService } from './infrastructure/output-registry/PackageReproducibilityService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';

const admin = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

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
  verifier: PackageReproducibilityService;
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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e04a-'));
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
    description: 'E2E-04A taxonomy test luminaire',
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
    notes: 'E2E-04A taxonomy',
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
    generation,
    deliverables,
    packages: new CanonicalIssuePackageService(
      store,
      registry,
      () => new Date('2026-08-20T10:00:00.000Z'),
    ),
    verifier: new PackageReproducibilityService(
      registry,
      (projectId) => store.getProjectFolderPath(projectId),
      () => new Date('2026-08-20T12:00:00.000Z'),
    ),
  };
}

async function targetGenerate(harness: Harness, targetRevisionId: string) {
  const schedule = await harness.generation.generateSchedule(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    {
      format: 'Both',
      issueStatus: 'For Review',
      issueDate: '2026-08-20',
      targetRevisionId,
    },
  );
  const boq = await harness.generation.generateBoq(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    {
      format: 'Both',
      issueStatus: 'For Review',
      issueDate: '2026-08-20',
      targetRevisionId,
    },
  );
  return {
    outputs: [...schedule.outputs, ...boq.outputs],
  };
}

function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
  );
}

function addDocument(
  harness: Harness,
  relativePath: string,
  content: string,
  category: DocumentCategory,
  title: string,
) {
  const filePath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return harness.store.operations.createDocument(harness.project.id, {
    category,
    documentNumber: '',
    title,
    revision: 'A',
    status: 'Working',
    filePath: relativePath,
    issuedTo: '',
    issueDate: null,
    notes: '',
  });
}

async function addSnapshot(
  harness: Harness,
  revisionId: string,
  relativePath: string,
  content: string,
  category: DocumentCategory,
  title: string,
) {
  const document = addDocument(harness, relativePath, content, category, title);
  return await harness.deliverables.createDocumentSnapshot(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    revisionId,
    { sourceDocumentId: document.id, title },
  );
}

function packageRequest(
  selectedItemIds: string[],
  overrides: Partial<{ status: 'Draft' | 'Issued'; relativeOutputFolder: string }> = {},
) {
  return {
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'E2E-04A Package',
    status: 'Draft' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_TAXONOMY',
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

interface SnapshotSpec {
  category: DocumentCategory;
}

/**
 * Builds a composed PREPARING Revision, adds Schedule/BOQ via targeted
 * generation plus the given snapshot categories, finalizes once, and creates a
 * single Folder-mode package. Returns the package record + manifest helpers.
 */
async function buildMixedPackage(harness: Harness, snapshotSpecs: SnapshotSpec[]) {
  const target = prepareManualRevision(harness);
  const generated = await targetGenerate(harness, target.revisionId);
  const snapshots: Array<{
    deliverableId: string;
    category: string;
    revisionId: string;
    contentHash: string;
  }> = [];
  for (const spec of snapshotSpecs) {
    const snapshot = await addSnapshot(
      harness,
      target.revisionId,
      `Docs/${spec.category}.pdf`,
      `bytes-${spec.category}`,
      spec.category,
      `${spec.category} Snapshot`,
    );
    snapshots.push({
      deliverableId: snapshot.deliverableId,
      category: spec.category,
      revisionId: snapshot.revisionId,
      contentHash: snapshot.contentHash,
    });
  }
  await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
  const selectedItemIds = [
    ...generated.outputs.map((output) => output.outputId),
    ...snapshots.map((snapshot) => snapshot.deliverableId),
  ];
  const record = await harness.packages.create(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    packageRequest(selectedItemIds),
    [],
  );
  return { target, generated, snapshots, record };
}

function packagedPath(record: { folderPath: string }, packageRelativePath: string) {
  return path.join(record.folderPath, ...packageRelativePath.split('/'));
}

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Finds a GeneratedOutput manifest deliverable, narrowed by family + format. */
function findGeneratedOutput(
  manifest: ReturnType<typeof readManifest>,
  family: 'LuminaireSchedule' | 'TechnicalBoq',
  format: string,
) {
  const item = manifest.deliverables.find(
    (candidate) =>
      candidate.sourceType === 'GeneratedOutput' &&
      candidate.outputFamily === family &&
      candidate.outputFormat === format,
  );
  if (!item || item.sourceType !== 'GeneratedOutput') {
    throw new Error(`Missing manifest GeneratedOutput ${family}:${format}`);
  }
  return item;
}

describe('PACKAGES-E2E-04A — client folder taxonomy + deterministic copy naming', () => {
  it('1: Drawing DocumentSnapshot is filed under 01_LIGHTING_LAYOUT', async () => {
    const harness = createHarness();
    const { snapshots, record } = await buildMixedPackage(harness, [{ category: 'Drawing' }]);
    const manifest = readManifest(harness, record);
    const drawing = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    expect(drawing.packageRelativePath).toMatch(/^01_LIGHTING_LAYOUT\//);
    expect(drawing.packageRelativePath.endsWith('.pdf')).toBe(true);
    expect(snapshots[0]!.contentHash).toBe(sha('bytes-Drawing'));
  });

  it('2: LuxReport DocumentSnapshot is filed under 02_DIALUX_REPORT', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [{ category: 'LuxReport' }]);
    const manifest = readManifest(harness, record);
    const report = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    expect(report.packageRelativePath).toMatch(/^02_DIALUX_REPORT\//);
  });

  it('3: Schedule PDF + XLSX are both under 03_LUMINAIRE_SCHEDULE', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, []);
    const manifest = readManifest(harness, record);
    const schedulePdf = manifest.deliverables.find(
      (item) =>
        item.sourceType === 'GeneratedOutput' &&
        item.outputFamily === 'LuminaireSchedule' &&
        item.outputFormat === 'PDF',
    )!;
    const scheduleXlsx = manifest.deliverables.find(
      (item) =>
        item.sourceType === 'GeneratedOutput' &&
        item.outputFamily === 'LuminaireSchedule' &&
        item.outputFormat === 'XLSX',
    )!;
    expect(schedulePdf.packageRelativePath).toMatch(/^03_LUMINAIRE_SCHEDULE\//);
    expect(scheduleXlsx.packageRelativePath).toMatch(/^03_LUMINAIRE_SCHEDULE\//);
  });

  it('4: BOQ PDF + BOQ XLSX are kept under 04_TECHNICAL_BOQ', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, []);
    const manifest = readManifest(harness, record);
    const boqPdf = manifest.deliverables.find(
      (item) =>
        item.sourceType === 'GeneratedOutput' &&
        item.outputFamily === 'TechnicalBoq' &&
        item.outputFormat === 'PDF',
    )!;
    const boqXlsx = manifest.deliverables.find(
      (item) =>
        item.sourceType === 'GeneratedOutput' &&
        item.outputFamily === 'TechnicalBoq' &&
        item.outputFormat === 'XLSX',
    )!;
    expect(boqPdf.packageRelativePath).toMatch(/^04_TECHNICAL_BOQ\//);
    expect(boqXlsx.packageRelativePath).toMatch(/^04_TECHNICAL_BOQ\//);
  });

  it('5: Datasheet DocumentSnapshot category is filed under 05_DATASHEETS', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [{ category: 'Datasheet' }]);
    const manifest = readManifest(harness, record);
    const datasheet = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    expect(datasheet.packageRelativePath).toMatch(/^05_DATASHEETS\//);
  });

  it('6: unsupported / Other DocumentSnapshot falls back to 07_SUPPORTING_DOCUMENTS', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [{ category: 'Other' }]);
    const manifest = readManifest(harness, record);
    const other = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    expect(other.packageRelativePath).toMatch(/^07_SUPPORTING_DOCUMENTS\//);
  });

  it('7: Layout package copy name is <PROJECT_CODE>_LIGHTING_LAYOUT_<REVISION>.<ext>', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [{ category: 'Drawing' }]);
    const manifest = readManifest(harness, record);
    const drawing = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    const expectedPrefix = `${harness.project.projectCode}_LIGHTING_LAYOUT_`;
    expect(path.basename(drawing.packageRelativePath)).toMatch(
      new RegExp(`^${expectedPrefix}.+\\.pdf$`),
    );
  });

  it('8: DIALux package copy name is <PROJECT_CODE>_DIALUX_REPORT_<REVISION>.<ext>', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [{ category: 'LuxReport' }]);
    const manifest = readManifest(harness, record);
    const report = manifest.deliverables.find((item) => item.sourceType === 'DocumentSnapshot')!;
    const expected = `${harness.project.projectCode}_DIALUX_REPORT_`;
    expect(path.basename(report.packageRelativePath)).toMatch(new RegExp(`^${expected}.+\\.pdf$`));
  });

  it('9: Schedule package-copy names remain unchanged', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, []);
    const manifest = readManifest(harness, record);
    const schedulePdf = findGeneratedOutput(manifest, 'LuminaireSchedule', 'PDF');
    const output = harness.registry.getOutput(schedulePdf.outputId);
    expect(path.basename(schedulePdf.packageRelativePath)).toBe(
      path.basename(output.locatorValue!),
    );
  });

  it('10: BOQ package-copy names remain unchanged', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, []);
    const manifest = readManifest(harness, record);
    const boqPdf = findGeneratedOutput(manifest, 'TechnicalBoq', 'PDF');
    const output = harness.registry.getOutput(boqPdf.outputId);
    expect(path.basename(boqPdf.packageRelativePath)).toBe(path.basename(output.locatorValue!));
  });

  it('11: original stored/source artifacts are unchanged', async () => {
    const harness = createHarness();
    const { snapshots, record } = await buildMixedPackage(harness, [
      { category: 'Drawing' },
      { category: 'LuxReport' },
    ]);
    const manifest = readManifest(harness, record);
    for (const snapshot of snapshots) {
      const storedRecord = harness.registry
        .listDocumentSnapshotsForRevision(snapshot.revisionId)
        .find((item) => item.deliverableId === snapshot.deliverableId)!;
      const storedPath = path.join(harness.projectRoot, storedRecord.locatorValue);
      expect(existsSync(storedPath)).toBe(true);
      expect(readFileSync(storedPath)).toEqual(Buffer.from(`bytes-${snapshot.category}`));
    }
    for (const item of manifest.deliverables) {
      if (item.sourceType === 'GeneratedOutput') {
        const output = harness.registry.getOutput(item.outputId);
        expect(existsSync(path.join(harness.projectRoot, output.locatorValue!))).toBe(true);
      }
    }
  });

  it('12: collision suffix remains deterministic (_2, _3)', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const first = await addSnapshot(
      harness,
      target.revisionId,
      'Docs/LayoutA.pdf',
      'same-bytes',
      'Drawing',
      'Layout A',
    );
    const second = await addSnapshot(
      harness,
      target.revisionId,
      'Docs/LayoutB.pdf',
      'same-bytes',
      'Drawing',
      'Layout B',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([
        ...generated.outputs.map((output) => output.outputId),
        first.deliverableId,
        second.deliverableId,
      ]),
      [],
    );
    const manifest = readManifest(harness, record);
    const drawingNames = manifest.deliverables
      .filter((item) => item.sourceType === 'DocumentSnapshot')
      .map((item) => path.basename(item.packageRelativePath))
      .sort();
    expect(new Set(drawingNames).size).toBe(2);
    expect(drawingNames.some((name) => /_2\.pdf$/.test(name))).toBe(true);
  });

  it('13: manifest packageRelativePath matches the real new folder/name on disk', async () => {
    const harness = createHarness();
    const { target, record } = await buildMixedPackage(harness, [
      { category: 'Drawing' },
      { category: 'LuxReport' },
    ]);
    const manifest = readManifest(harness, record);
    for (const item of manifest.deliverables) {
      const onDisk = packagedPath(record, item.packageRelativePath);
      expect(existsSync(onDisk)).toBe(true);
      const bytes = readFileSync(onDisk);
      const storedLocator =
        item.sourceType === 'GeneratedOutput'
          ? harness.registry.getOutput(item.outputId).locatorValue!
          : harness.registry
              .listDocumentSnapshotsForRevision(target.revisionId)
              .find((s) => s.deliverableId === item.deliverableId)!.locatorValue;
      const storedBytes = readFileSync(path.join(harness.projectRoot, storedLocator));
      expect(bytes.equals(storedBytes)).toBe(true);
    }
  });

  it('14: Verify still verifies the renamed/refiled client copy', async () => {
    const harness = createHarness();
    const { record } = await buildMixedPackage(harness, [
      { category: 'Drawing' },
      { category: 'LuxReport' },
    ]);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
    expect(result!.deliverables.length).toBeGreaterThan(0);
    for (const deliverable of result!.deliverables) {
      expect(deliverable.status).toBe('VERIFIED');
    }
  });

  it('15: classification is category-only — no filename/title/path heuristic', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const doc = addDocument(harness, 'Misc/weird.pdf', 'bytes', 'LuxReport', 'Unrelated Name');
    const snapshot = await harness.deliverables.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      target.revisionId,
      { sourceDocumentId: doc.id, title: 'Unrelated Name' },
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([
        ...generated.outputs.map((output) => output.outputId),
        snapshot.deliverableId,
      ]),
      [],
    );
    const manifest = readManifest(harness, record);
    const reportItem = manifest.deliverables.find(
      (item) => item.sourceType === 'DocumentSnapshot',
    )!;
    expect(reportItem.packageRelativePath).toMatch(/^02_DIALUX_REPORT\//);
    expect(path.basename(reportItem.packageRelativePath)).toMatch(/^.+_DIALUX_REPORT_.+\.pdf$/);
  });
});
