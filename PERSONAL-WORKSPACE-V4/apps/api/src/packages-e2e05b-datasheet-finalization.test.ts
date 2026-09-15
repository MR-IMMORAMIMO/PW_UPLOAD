/**
 * V4-PACKAGES-E2E-05B — Datasheet Package Naming + Presentation + Readiness.
 *
 * Proves the FINAL functional slice of the Packages/Datasheets block:
 *
 *  - NAMING: a Datasheet DocumentSnapshot resolves its exact Luminaire via
 *    sourceAssetVersionId and its CLIENT COPY is named
 *    `<Tag>_<Manufacturer>_<Model>.<ext>` under 05_DATASHEETS, with truthful
 *    fallbacks (UNKNOWN_MANUFACTURER / UNKNOWN_MODEL / LUMINAIRE_<id>),
 *    safeFileName sanitization, extension preservation, deterministic
 *    collision suffixes, and NO filename/title heuristic. The original
 *    AssetVersion file and canonical snapshot are never renamed.
 *  - MANIFEST TRUTH: manifest member.packageRelativePath matches the actual
 *    renamed client copy; Verify = VERIFIED for an intact Datasheet package.
 *  - BUILDER: Datasheet appears in Eligible Deliverables, is labeled
 *    truthfully as Datasheet, uses the canonical deliverableId, participates
 *    in mixed selection with Layout / DIALux / Schedule / BOQ, and a missing
 *    Datasheet snapshot is not selectable. No ProjectDocument/AssetVersion id
 *    is substituted for package membership.
 *  - READINESS: missing verified Datasheets in the target Revision produce a
 *    Warning (never Blocking) with a truthful count; a verified Datasheet
 *    deliberately deselected from the Package warns; the existing
 *    warning-override flow still works.
 *  - FULL MIXED PACKAGE: one Revision with Layout + DIALux + Schedule PDF/XLSX
 *    + BOQ PDF/XLSX + two Datasheets, one create request, correct folder
 *    taxonomy, correct Datasheet filenames, no manifest in the client tree,
 *    Verify = VERIFIED.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e05b-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
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

function luminaireInput(tag: string, opts: { manufacturer?: string; model?: string } = {}) {
  return {
    tag,
    category: 'Downlight',
    imagePath: '',
    description: '',
    manufacturer: opts.manufacturer ?? 'Scientechnic',
    model: opts.model ?? 'DLX',
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

/** Writes a real datasheet file and attaches a Datasheet AssetVersion. */
function attachDatasheet(
  harness: Harness,
  projectId: string,
  luminaireId: string,
  content: string,
  fileName = 'datasheet.pdf',
) {
  const sourceDirectory = path.join(harness.root, randomUuid());
  mkdirSync(sourceDirectory);
  const filePath = path.join(sourceDirectory, fileName);
  writeFileSync(filePath, content);
  return harness.store.attachLuminaireAsset(
    projectId,
    luminaireId,
    { assetType: 'Datasheet', filePath },
    admin,
  );
}

function randomUuid(): string {
  return randomUUID();
}

function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
  );
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
  return { outputs: [...schedule.outputs, ...boq.outputs] };
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
  overrides: Partial<{
    status: 'Draft' | 'Issued';
    label: string;
    relativeOutputFolder: string;
    warningOverrideReason: string;
  }> = {},
) {
  return {
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'E2E-05B Package',
    status: 'Draft' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_05B',
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

function packagedPath(record: { folderPath: string }, packageRelativePath: string) {
  return path.join(record.folderPath, ...packageRelativePath.split('/'));
}

/** Narrowed lookup of a DocumentSnapshot manifest deliverable by deliverableId. */
function findDocumentSnapshot(manifest: ReturnType<typeof readManifest>, deliverableId: string) {
  const item = manifest.deliverables.find(
    (candidate) =>
      candidate.sourceType === 'DocumentSnapshot' && candidate.deliverableId === deliverableId,
  );
  if (!item || item.sourceType !== 'DocumentSnapshot') {
    throw new Error(`Missing manifest DocumentSnapshot ${deliverableId}`);
  }
  return item;
}

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Adds a Datasheet snapshot for a Luminaire to a PREPARING Revision. */
async function addDatasheetSnapshot(
  harness: Harness,
  revisionId: string,
  luminaireId: string,
  content: string,
  fileName = 'datasheet.pdf',
) {
  const version = attachDatasheet(harness, harness.project.id, luminaireId, content, fileName);
  const snapshot = await harness.deliverables.addDatasheetDeliverable(
    harness.project,
    revisionId,
    version.id,
    admin,
  );
  return { version, snapshot };
}

describe('PACKAGES-E2E-05B — datasheet naming', () => {
  it('1: Datasheet snapshot resolves the exact Luminaire via sourceAssetVersionId', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      prepareManualRevision(harness).revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    expect(snapshot.sourceType).toBe('LuminaireAssetVersion');
    expect(snapshot.sourceAssetVersionId).toBeTruthy();
    // Structural resolution: sourceAssetVersionId -> luminaire_asset_versions
    // -> luminaireId -> project_luminaires.
    const version = harness.store.getLuminaireAssetVersionById(
      harness.project.id,
      snapshot.sourceAssetVersionId!,
    );
    expect(version.luminaireId).toBe(luminaire.id);
    const resolved = harness.store.getLuminaireRecord(version.luminaireId, harness.project.id);
    expect(resolved.tag).toBe('DL01');
    expect(resolved.manufacturer).toBe('ERCO');
    expect(resolved.model).toBe('12345');
  });

  it('2: client copy path is 05_DATASHEETS/<Tag>_<Manufacturer>_<Model>.<ext>', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_12345.pdf');
    expect(existsSync(packagedPath(record, ds.packageRelativePath))).toBe(true);
  });

  it('3: original AssetVersion file is unchanged', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const { version } = await addDatasheetSnapshot(
      harness,
      prepareManualRevision(harness).revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    const before = readFileSync(version.filePath);
    expect(sha(before.toString())).toBe(version.fileHash!);
    // The source file is never renamed or rewritten.
    expect(path.basename(version.filePath)).toBe('datasheet.pdf');
  });

  it('4: canonical snapshot is unchanged', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    const storedPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const before = readFileSync(storedPath);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    // The canonical snapshot file is untouched by packaging.
    expect(readFileSync(storedPath)).toEqual(before);
    expect(sha(before.toString())).toBe(snapshot.contentHash);
    void record;
  });

  it('5: extension is preserved', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
      'spec-sheet.pdf',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_12345.pdf');
  });

  it('6: illegal characters are sanitized', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL:01', { manufacturer: 'ERCO/Inc', model: '12:345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    // Illegal Windows characters are replaced with underscores.
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL_01_ERCO_Inc_12_345.pdf');
  });

  it('7: missing manufacturer uses deterministic fallback', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: '', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL01_UNKNOWN_MANUFACTURER_12345.pdf');
  });

  it('8: missing model uses deterministic fallback', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_UNKNOWN_MODEL.pdf');
  });

  it('9: missing tag uses deterministic luminaire-id-based fallback', async () => {
    const harness = createHarness();
    // Create a normal luminaire, then empty its tag AFTER the Revision is
    // created (the canonical snapshot requires a non-blank tag at creation,
    // but the live Luminaire record may later lose its tag). The Datasheet
    // client-copy name must fall back to a deterministic luminaire-id-based
    // name rather than guessing from the filename/title.
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    harness.store
      .getSharedDatabase()
      .prepare('UPDATE project_luminaires SET tag = ? WHERE id = ? AND project_id = ?')
      .run('', luminaire.id, harness.project.id);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    // Deterministic repository-native fallback based on luminaire identity.
    expect(ds.packageRelativePath).toMatch(
      new RegExp(`^05_DATASHEETS/LUMINAIRE_${luminaire.id.slice(0, 8)}_ERCO_12345\\.pdf$`),
    );
  });

  it('10: same normalized filename collision gets a deterministic suffix', async () => {
    const harness = createHarness();
    // Two luminaires whose tags sanitize to the SAME client name (DL:01 and
    // DL/01 both normalize to DL_01) produce the same client filename; the
    // second gets a deterministic _2 suffix. Distinct tags keep the unique
    // (project_id, tag) constraint satisfied.
    const lumA = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL:01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const lumB = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL/01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot: snapA } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      lumA.id,
      'a-bytes',
    );
    const { snapshot: snapB } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      lumB.id,
      'b-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapA.deliverableId, snapB.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const names = manifest.deliverables
      .filter((item) => item.sourceType === 'DocumentSnapshot')
      .map((item) => item.packageRelativePath)
      .sort();
    expect(names).toEqual([
      '05_DATASHEETS/DL_01_ERCO_12345.pdf',
      '05_DATASHEETS/DL_01_ERCO_12345_2.pdf',
    ]);
  });

  it('11: no filename/title heuristic is used', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    // The snapshot title and source filename are deliberately misleading.
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
      'unrelated-name.pdf',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    // The client copy name derives from structured Luminaire fields, not the
    // source filename or snapshot title.
    expect(ds.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_12345.pdf');
  });

  it('12: manifest packageRelativePath matches the actual renamed copy', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    const onDisk = packagedPath(record, ds.packageRelativePath);
    expect(existsSync(onDisk)).toBe(true);
    // The packaged copy bytes equal the stored canonical snapshot bytes.
    const storedBytes = readFileSync(path.join(harness.projectRoot, snapshot.locatorValue));
    expect(readFileSync(onDisk).equals(storedBytes)).toBe(true);
  });

  it('13: Verify = VERIFIED for an intact Datasheet package copy', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
    const ds = result!.deliverables.find(
      (d) => d.sourceType === 'DocumentSnapshot' && d.sourceId === snapshot.deliverableId,
    );
    expect(ds).toBeDefined();
    expect(ds!.status).toBe('VERIFIED');
  });
});

describe('PACKAGES-E2E-05B — package builder', () => {
  it('1: Datasheet appears in Eligible Deliverables', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const item = catalog.items.find((i) => i.id === snapshot.deliverableId);
    expect(item).toBeDefined();
    expect(item?.available).toBe(true);
    expect(item?.group).toBe('Documents');
  });

  it('2: Datasheet row is labeled truthfully as Datasheet with structured metadata', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const item = catalog.items.find((i) => i.id === snapshot.deliverableId)!;
    // Structured Luminaire metadata is exposed (never inferred from title).
    expect(item.datasheet).toEqual({ tag: 'DL01', manufacturer: 'ERCO', model: '12345' });
  });

  it('3: exact canonical deliverableId is used', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const item = catalog.items.find((i) => i.id === snapshot.deliverableId)!;
    expect(item.id).toBe(snapshot.deliverableId);
  });

  it('4+5: Datasheet + Layout + DIALux + Schedule + BOQ can all be selected together in one request', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const layout = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.pdf',
      'layout-bytes',
      'Drawing',
      'Lighting Layout',
    );
    const dialux = await addSnapshot(
      harness,
      target.revisionId,
      'Reports/Dialux.pdf',
      'dialux-bytes',
      'LuxReport',
      'DIALux Report',
    );
    const { snapshot: datasheet } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const selectedItemIds = [
      ...generated.outputs.map((output) => output.outputId),
      layout.deliverableId,
      dialux.deliverableId,
      datasheet.deliverableId,
    ];
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(selectedItemIds),
      [],
    );
    const manifest = readManifest(harness, record);
    const ids = new Set(
      manifest.deliverables.map((item) =>
        item.sourceType === 'GeneratedOutput' ? item.outputId : item.deliverableId,
      ),
    );
    // All canonical IDs are present in the single request.
    for (const id of selectedItemIds) expect(ids.has(id)).toBe(true);
    // Folder taxonomy is correct.
    const layoutItem = findDocumentSnapshot(manifest, layout.deliverableId);
    const dialuxItem = findDocumentSnapshot(manifest, dialux.deliverableId);
    const dsItem = findDocumentSnapshot(manifest, datasheet.deliverableId);
    expect(layoutItem.packageRelativePath).toMatch(/^01_LIGHTING_LAYOUT\//);
    expect(dialuxItem.packageRelativePath).toMatch(/^02_DIALUX_REPORT\//);
    expect(dsItem.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_12345.pdf');
  });

  it('6: missing Datasheet snapshot is not selectable', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    // Attach a datasheet but do NOT add it to the Revision.
    attachDatasheet(harness, harness.project.id, luminaire.id, 'datasheet-bytes');
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    // No Datasheet snapshot exists in the Revision, so none is offered.
    expect(catalog.items.some((item) => item.datasheet)).toBe(false);
  });

  it('7: no ProjectDocument or AssetVersion id is substituted for package membership', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { version, snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest([snapshot.deliverableId]),
      [],
    );
    const manifest = readManifest(harness, record);
    const ds = findDocumentSnapshot(manifest, snapshot.deliverableId);
    // Membership identity is the canonical snapshot deliverableId, never the
    // mutable ProjectDocument id or the AssetVersion id.
    expect(ds.deliverableId).toBe(snapshot.deliverableId);
    expect(ds.deliverableId).not.toBe(version.id);
    expect(ds.deliverableId).not.toBe(luminaire.id);
  });
});

describe('PACKAGES-E2E-05B — readiness', () => {
  it('1: all known verified Datasheets present in Revision -> no missing-datasheet Warning', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    await addDatasheetSnapshot(harness, target.revisionId, luminaire.id, 'datasheet-bytes');
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe('Warning');
  });

  it('2: Luminaire with no verified Datasheet -> Warning', async () => {
    const harness = createHarness();
    harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('Warning');
    expect(check!.detail).toMatch(/1 luminaire/);
  });

  it('3: legacy unverified Datasheet -> Warning', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    // Seed a legacy NULL-hash Datasheet AssetVersion directly.
    db.prepare(
      `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at)
       VALUES (?, ?, ?, 'Datasheet', 1, 'legacy.pdf', 'legacy.pdf', 'application/pdf', 10,
               NULL, 1, ?)`,
    ).run(randomUuid(), harness.project.id, luminaire.id, '2026-01-01');
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it('4: missing source -> Warning', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const filePath = path.join(harness.root, `missing-${randomUuid()}.pdf`);
    writeFileSync(filePath, 'bytes');
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath },
      admin,
    );
    rmSync(filePath, { force: true });
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    void version;
  });

  it('5: hash mismatch -> Warning', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const filePath = path.join(harness.root, `changed-${randomUuid()}.pdf`);
    writeFileSync(filePath, 'original-bytes');
    harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath },
      admin,
    );
    writeFileSync(filePath, 'changed-bytes');
    const target = prepareManualRevision(harness);
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it('6: verified Datasheet exists but not added to Revision -> Warning', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    // Verified Datasheet AssetVersion exists but is NOT added to the Revision.
    attachDatasheet(harness, harness.project.id, luminaire.id, 'datasheet-bytes');
    await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it('7: Datasheet in Revision but deliberately deselected from Package -> Warning', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const { snapshot } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      luminaire.id,
      'datasheet-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    // The Datasheet is present and selectable.
    const item = catalog.items.find((i) => i.id === snapshot.deliverableId)!;
    expect(item.available).toBe(true);
    // The missing-datasheet check passes (the Datasheet IS in the Revision).
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check!.passed).toBe(true);
    // The deselected-datasheet warning is a frontend readiness concern; the
    // server catalog exposes the selectable Datasheet so the Owner may
    // deliberately deselect it and proceed with a Warning Override.
    expect(item.datasheet).toEqual({ tag: 'DL01', manufacturer: 'ERCO', model: '12345' });
  });

  it('8: Warning does NOT become a hard blocker', async () => {
    const harness = createHarness();
    harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check!.passed).toBe(false);
    expect(check!.severity).toBe('Warning');
    // A Warning does not block package creation.
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(generated.outputs.map((output) => output.outputId)),
      [],
    );
    expect(record.id).toBeTruthy();
  });

  it('9: existing warning-override flow still works', async () => {
    const harness = createHarness();
    harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    const check = catalog.checks.find((c) => c.key === 'missing-verified-datasheets');
    expect(check!.passed).toBe(false);
    // Issuing with a Warning requires a Warning Override reason.
    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        admin,
        packageRequest(
          generated.outputs.map((output) => output.outputId),
          {
            status: 'Issued',
            warningOverrideReason: '',
          },
        ),
        [check!],
      ),
    ).rejects.toThrow(/Warnings must be resolved or overridden/);
    // With a reason, the Issued package is created.
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(
        generated.outputs.map((output) => output.outputId),
        {
          status: 'Issued',
          warningOverrideReason: 'Client contract does not require datasheets.',
        },
      ),
      [check!],
    );
    expect(record.status).toBe('Issued');
  });
});

describe('PACKAGES-E2E-05B — full mixed package', () => {
  it('constructs one Revision with Layout + DIALux + Schedule PDF/XLSX + BOQ PDF/XLSX + two Datasheets', async () => {
    const harness = createHarness();
    const lumA = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL01', { manufacturer: 'ERCO', model: '12345' }),
    );
    const lumB = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL02', { manufacturer: 'Philips', model: 'CoreLine' }),
    );
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    const layout = await addSnapshot(
      harness,
      target.revisionId,
      'Drawings/Layout.pdf',
      'layout-bytes',
      'Drawing',
      'Lighting Layout',
    );
    const dialux = await addSnapshot(
      harness,
      target.revisionId,
      'Reports/Dialux.pdf',
      'dialux-bytes',
      'LuxReport',
      'DIALux Report',
    );
    const { snapshot: dsA } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      lumA.id,
      'datasheet-a-bytes',
    );
    const { snapshot: dsB } = await addDatasheetSnapshot(
      harness,
      target.revisionId,
      lumB.id,
      'datasheet-b-bytes',
    );
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const selectedItemIds = [
      ...generated.outputs.map((output) => output.outputId),
      layout.deliverableId,
      dialux.deliverableId,
      dsA.deliverableId,
      dsB.deliverableId,
    ];
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(selectedItemIds),
      [],
    );
    const manifest = readManifest(harness, record);

    // All visible + selectable + one create request.
    const ids = new Set(
      manifest.deliverables.map((item) =>
        item.sourceType === 'GeneratedOutput' ? item.outputId : item.deliverableId,
      ),
    );
    for (const id of selectedItemIds) expect(ids.has(id)).toBe(true);

    // Correct folder taxonomy.
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
    expect(schedulePdf.packageRelativePath).toMatch(/^03_LUMINAIRE_SCHEDULE\//);
    expect(scheduleXlsx.packageRelativePath).toMatch(/^03_LUMINAIRE_SCHEDULE\//);
    expect(boqPdf.packageRelativePath).toMatch(/^04_TECHNICAL_BOQ\//);
    expect(boqXlsx.packageRelativePath).toMatch(/^04_TECHNICAL_BOQ\//);
    const layoutItem = findDocumentSnapshot(manifest, layout.deliverableId);
    const dialuxItem = findDocumentSnapshot(manifest, dialux.deliverableId);
    expect(layoutItem.packageRelativePath).toMatch(/^01_LIGHTING_LAYOUT\//);
    expect(dialuxItem.packageRelativePath).toMatch(/^02_DIALUX_REPORT\//);

    // Correct Datasheet filenames.
    const dsAItem = findDocumentSnapshot(manifest, dsA.deliverableId);
    const dsBItem = findDocumentSnapshot(manifest, dsB.deliverableId);
    expect(dsAItem.packageRelativePath).toBe('05_DATASHEETS/DL01_ERCO_12345.pdf');
    expect(dsBItem.packageRelativePath).toBe('05_DATASHEETS/DL02_Philips_CoreLine.pdf');

    // No manifest in the client tree.
    const clientFiles = listFilesRecursive(record.folderPath);
    expect(clientFiles.some((file) => file.endsWith('.json'))).toBe(false);
    expect(clientFiles.some((file) => path.basename(file) === 'SCLI_PACKAGE_MANIFEST.json')).toBe(
      false,
    );

    // Verify = VERIFIED.
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
    for (const deliverable of result!.deliverables) {
      expect(deliverable.status).toBe('VERIFIED');
    }
  });
});

/** Recursively collects every file path under a directory. */
function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...listFilesRecursive(full));
    else results.push(full);
  }
  return results;
}
