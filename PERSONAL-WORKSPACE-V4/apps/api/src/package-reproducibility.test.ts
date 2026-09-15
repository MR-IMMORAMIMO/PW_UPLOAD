import { PackageArtifactAccess } from './infrastructure/output-registry/PackageArtifactAccess';
import JSZip from 'jszip';
/**
 * REV-02A2 — Package reproducibility verification tests.
 *
 * Proves the on-demand, read-only verification endpoint end to end through the
 * canonical package path and GET /api/projects/:id/issue-packages/:packageId/verify:
 *   - project isolation (package of another project denied)
 *   - VERIFIED (stored canonical bytes + packaged copy match immutable hashes)
 *   - MISSING canonical artifact
 *   - MISSING packaged copy
 *   - MISMATCH canonical hash
 *   - MISMATCH packaged-copy hash
 *   - UNAVAILABLE when storage/path cannot be resolved
 *   - mixed DocumentSnapshot + GeneratedOutput
 *   - verification does NOT mutate package/revision/output lifecycle or audit timestamps
 *   - reissue verifies independently by package identity
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
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
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { PackageReproducibilityService } from './infrastructure/output-registry/PackageReproducibilityService';

const admin = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
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

function createHarness(projectSeedIndex = 0): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-reproducibility-'));
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
  const project = structuredClone(seedProjects[projectSeedIndex]!);
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
    description: 'Reproducibility test luminaire',
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
    notes: 'Reproducibility snapshot',
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
    verifier: new PackageReproducibilityService(
      registry,
      (projectId) => store.getProjectFolderPath(projectId),
      () => new Date('2026-08-20T12:00:00.000Z'),
    ),
  };
}

async function createAppFor(harness: Harness): Promise<FastifyInstance> {
  const app = await createApp({
    config: loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
    provider: new MockDataProvider(),
    personalStore: harness.store,
    canonicalOutputRegistry: harness.registry,
  });
  apps.push(app);
  return app;
}

function addDocument(harness: Harness, relativePath: string, content: string) {
  const filePath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return harness.store.operations.createDocument(harness.project.id, {
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
    admin,
    revisionId,
    { sourceDocumentId: document.id, title },
  );
}

function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
  );
}

async function targetGenerate(harness: Harness, targetRevisionId: string) {
  return await harness.generation.generateSchedule(
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
}

function packageRequest(
  _harness: Harness,
  selectedItemIds: string[],
  overrides: Partial<{
    status: 'Draft' | 'Issued';
    label: string;
    relativeOutputFolder: string;
  }> = {},
) {
  return {
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'REV_01 Verify',
    status: 'Issued' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_VERIFY',
    selectedItemIds,
    warningOverrideReason: 'Verification test override',
    ...overrides,
  };
}

/** Creates an Issued Folder-mode package on a FINALIZED manual Revision with mixed deliverables. */
async function createMixedIssuedPackage(harness: Harness) {
  const target = prepareManualRevision(harness);
  const generated = await targetGenerate(harness, target.revisionId);
  const dwg = await addSnapshot(
    harness,
    target.revisionId,
    'Drawings/Layout.dwg',
    'dwg-bytes',
    'Layout DWG',
  );
  await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
  const selectedItemIds = [
    ...generated.outputs.map((output) => output.outputId),
    dwg.deliverableId,
  ];
  const record = await harness.packages.create(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/REV_01_VERIFY' }),
    [],
  );
  return { target, generated, dwg, record };
}

async function verify(
  harness: Harness,
  actorId: string,
  packageId: string,
  opts: { projectId?: string } = {},
) {
  const projectId = opts.projectId ?? harness.project.id;
  const app = await createAppFor(harness);
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/issue-packages/${packageId}/verify`,
    headers: { 'x-mock-user-id': actorId },
  });
  return response;
}

function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function outputStoredPath(harness: Harness, outputId: string): string | null {
  const output = harness.registry.getOutput(outputId);
  if (!output.locatorValue) return null;
  return path.join(harness.projectRoot, output.locatorValue);
}

describe('REV-02A2 — Package reproducibility verification', () => {
  it('1: VERIFIED — stored canonical bytes and packaged copy match immutable hashes', async () => {
    const harness = createHarness();
    const { record } = await createMixedIssuedPackage(harness);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
    expect(result!.deliverables.length).toBeGreaterThan(0);
    for (const deliverable of result!.deliverables) {
      expect(deliverable.status).toBe('VERIFIED');
    }
  });

  it('2: MISSING — a canonical stored artifact is absent', async () => {
    const harness = createHarness();
    const { record, generated } = await createMixedIssuedPackage(harness);
    const output = generated.outputs[0]!;
    const storedPath = outputStoredPath(harness, output.outputId);
    if (storedPath && existsSync(storedPath)) unlinkSync(storedPath);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('MISSING');
    const outputDeliverable = result!.deliverables.find(
      (item) => item.sourceType === 'GeneratedOutput' && item.sourceId === output.outputId,
    );
    expect(outputDeliverable).toBeDefined();
    expect(outputDeliverable!.status).toBe('MISSING');
  });

  it('3: MISSING — packaged copy is absent', async () => {
    const harness = createHarness();
    const { record, generated } = await createMixedIssuedPackage(harness);
    const output = generated.outputs[0]!;
    const packagedPath = packagedManifestMemberPath(harness, record.id, output.outputId);
    if (packagedPath && existsSync(packagedPath)) unlinkSync(packagedPath);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    const outputDeliverable = result!.deliverables.find(
      (item) => item.sourceType === 'GeneratedOutput' && item.sourceId === output.outputId,
    );
    expect(outputDeliverable).toBeDefined();
    expect(outputDeliverable!.status).toBe('MISSING');
    expect(result!.status).toBe('MISSING');
  });

  it('4: MISMATCH — stored canonical bytes differ from immutable hash', async () => {
    const harness = createHarness();
    const { record, generated } = await createMixedIssuedPackage(harness);
    const output = generated.outputs[0]!;
    const storedPath = outputStoredPath(harness, output.outputId);
    if (storedPath && existsSync(storedPath)) writeFileSync(storedPath, 'tampered-canonical-bytes');
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('MISMATCH');
    const outputDeliverable = result!.deliverables.find(
      (item) => item.sourceType === 'GeneratedOutput' && item.sourceId === output.outputId,
    );
    expect(outputDeliverable).toBeDefined();
    expect(outputDeliverable!.status).toBe('MISMATCH');
    expect(outputDeliverable!.actualHash).toBe(sha('tampered-canonical-bytes'));
  });

  it('5: MISMATCH — packaged copy bytes differ from immutable hash', async () => {
    const harness = createHarness();
    const { record, generated } = await createMixedIssuedPackage(harness);
    const output = generated.outputs[0]!;
    const packagedPath = packagedManifestMemberPath(harness, record.id, output.outputId);
    if (packagedPath && existsSync(packagedPath))
      writeFileSync(packagedPath, 'tampered-packaged-bytes');
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('MISMATCH');
    const outputDeliverable = result!.deliverables.find(
      (item) => item.sourceType === 'GeneratedOutput' && item.sourceId === output.outputId,
    );
    expect(outputDeliverable).toBeDefined();
    expect(outputDeliverable!.status).toBe('MISMATCH');
    expect(outputDeliverable!.actualHash).toBe(sha('tampered-packaged-bytes'));
  });

  it('6: UNAVAILABLE — storage path cannot be resolved', async () => {
    const harness = createHarness();
    const { record } = await createMixedIssuedPackage(harness);
    // Resolver returns null → storage cannot be resolved → UNAVAILABLE (not
    // a mutation, and not reported as a missing file).
    const verifier = new PackageReproducibilityService(
      harness.registry,
      () => null,
      () => new Date('2026-08-20T12:00:00.000Z'),
    );
    const result = await verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('UNAVAILABLE');
  });

  it('7: mixed deliverables — DocumentSnapshot and GeneratedOutput both project', async () => {
    const harness = createHarness();
    const { record, dwg, generated } = await createMixedIssuedPackage(harness);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    const snapshotDeliverable = result!.deliverables.find(
      (item) => item.sourceType === 'DocumentSnapshot' && item.sourceId === dwg.deliverableId,
    );
    const outputDeliverable = result!.deliverables.find(
      (item) =>
        item.sourceType === 'GeneratedOutput' && item.sourceId === generated.outputs[0]!.outputId,
    );
    expect(snapshotDeliverable).toBeDefined();
    expect(snapshotDeliverable!.status).toBe('VERIFIED');
    expect(outputDeliverable).toBeDefined();
    expect(outputDeliverable!.status).toBe('VERIFIED');
  });

  it('8: project isolation — package of another project is denied', async () => {
    const harnessA = createHarness(0);
    const harnessB = createHarness(1);
    const { record } = await createMixedIssuedPackage(harnessB);
    // Verify B's package against A's project: 404 (not global by UUID).
    const response = await verify(harnessA, admin.id, record.id);
    expect(response.statusCode).toBe(404);
    // Same-package verify against B succeeds.
    const responseB = await verify(harnessB, admin.id, record.id);
    expect(responseB.statusCode).toBe(200);
    expect(responseB.json().data.status).toBe('VERIFIED');
  });

  it('9: verification does NOT mutate package/revision/output lifecycle or audit timestamps', async () => {
    const harness = createHarness();
    const { record, target } = await createMixedIssuedPackage(harness);
    const beforePackage = harness.registry.getIssuePackage(record.id);
    const beforeRevision = harness.registry.getRevision(target.revisionId);
    const beforeOutputs = harness.registry.listOutputsForRevision(target.revisionId);
    const before = {
      packageUpdatedAt: beforePackage.updatedAt,
      packageLifecycle: beforePackage.lifecycleState,
      revisionUpdatedAt: beforeRevision.updatedAt,
      revisionLifecycle: beforeRevision.lifecycleState,
      outputUpdatedAts: beforeOutputs.map((o) => o.updatedAt),
      outputLifecycles: beforeOutputs.map((o) => o.lifecycleState),
      issuedAt: beforePackage.issuedAt,
      finalizedAt: beforePackage.finalizedAt,
    };

    // Run twice, tampering one stored artifact in between to exercise the
    // failure path — neither run may mutate DB state.
    await harness.verifier.verify(harness.project.id, record.id);
    const output = harness.registry.listOutputsForRevision(target.revisionId)[0]!;
    const storedPath = outputStoredPath(harness, output.outputId);
    if (storedPath && existsSync(storedPath)) writeFileSync(storedPath, 'tampered-for-noop');
    await harness.verifier.verify(harness.project.id, record.id);

    const afterPackage = harness.registry.getIssuePackage(record.id);
    const afterRevision = harness.registry.getRevision(target.revisionId);
    const afterOutputs = harness.registry.listOutputsForRevision(target.revisionId);
    const after = {
      packageUpdatedAt: afterPackage.updatedAt,
      packageLifecycle: afterPackage.lifecycleState,
      revisionUpdatedAt: afterRevision.updatedAt,
      revisionLifecycle: afterRevision.lifecycleState,
      outputUpdatedAts: afterOutputs.map((o) => o.updatedAt),
      outputLifecycles: afterOutputs.map((o) => o.lifecycleState),
      issuedAt: afterPackage.issuedAt,
      finalizedAt: afterPackage.finalizedAt,
    };
    expect(after).toEqual(before);
  });

  it('10: reissue verifies independently by package identity', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/REV_01_FIRST' }),
      [],
    );
    const reissue = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/REV_01_REISSUE' }),
      [],
    );
    expect(reissue.id).not.toBe(first.id);

    const firstResult = await harness.verifier.verify(harness.project.id, first.id);
    const reissueResult = await harness.verifier.verify(harness.project.id, reissue.id);
    expect(firstResult).not.toBeNull();
    expect(reissueResult).not.toBeNull();
    expect(firstResult!.packageId).toBe(first.id);
    expect(reissueResult!.packageId).toBe(reissue.id);
    expect(firstResult!.status).toBe('VERIFIED');
    expect(reissueResult!.status).toBe('VERIFIED');
  });
});

function packagedManifestMemberPath(
  harness: Harness,
  packageId: string,
  outputId: string,
): string | null {
  const pkg = harness.registry.getIssuePackage(packageId);
  const locator = pkg.manifestLocatorValue;
  if (!locator || !pkg.artifactLocatorValue) return null;
  const manifestPath = path.join(harness.projectRoot, locator);
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const member = manifest.deliverables?.find(
    (item: { outputId?: string }) => item.outputId === outputId,
  );
  if (!member) return null;
  return path.join(
    harness.projectRoot,
    ...pkg.artifactLocatorValue.split('/'),
    ...member.packageRelativePath.split('/'),
  );
}

describe('Saved package file access', () => {
  it('opens Folder copies after the source changes and rejects download without a ZIP', async () => {
    const h = createHarness();
    const { record, dwg } = await createMixedIssuedPackage(h);
    const access = new PackageArtifactAccess(h.registry);
    writeFileSync(path.join(h.projectRoot, dwg.locatorValue), 'changed source');
    const file = await access.read(
      h.project.id,
      record.id,
      h.projectRoot,
      record.packageHash,
      dwg.deliverableId,
    );
    expect(file.bytes.toString()).toBe('dwg-bytes');
    await expect(
      access.read(h.project.id, record.id, h.projectRoot, record.packageHash),
    ).rejects.toThrow('No ZIP');
    await expect(
      access.read(
        '00000000-0000-4000-8000-000000000999',
        record.id,
        h.projectRoot,
        record.packageHash,
        dwg.deliverableId,
      ),
    ).rejects.toThrow();
  });
  it('returns the saved ZIP and member bytes, rejecting changed files and unrelated members', async () => {
    const h = createHarness();
    const target = prepareManualRevision(h);
    const snap = await addSnapshot(h, target.revisionId, 'Drawings/A.pdf', '%PDF-test', 'A');
    await h.deliverables.finalizeRevision(h.project, target.revisionId);
    const record = await h.packages.create(
      h.project,
      h.store.getWorkspace(h.project.id),
      admin,
      { ...packageRequest(h, [snap.deliverableId]), outputMode: 'Zip' },
      [],
    );
    const access = new PackageArtifactAccess(h.registry);
    const archive = await access.read(h.project.id, record.id, h.projectRoot, record.packageHash);
    const file = await access.read(
      h.project.id,
      record.id,
      h.projectRoot,
      record.packageHash,
      snap.deliverableId,
    );
    expect(archive.bytes.subarray(0, 2).toString()).toBe('PK');
    expect(file.bytes.toString()).toBe('%PDF-test');
    await expect(
      access.read(
        h.project.id,
        record.id,
        h.projectRoot,
        record.packageHash,
        '00000000-0000-4000-8000-000000000888',
      ),
    ).rejects.toThrow('not in this package');
    const zip = await JSZip.loadAsync(archive.bytes);
    const member = Object.values(zip.files).find((item) => !item.dir)!;
    zip.file(member.name, 'changed');
    const canonical = h.registry.getIssuePackage(record.id);
    writeFileSync(
      path.join(h.projectRoot, canonical.artifactLocatorValue!),
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    await expect(
      access.read(h.project.id, record.id, h.projectRoot, record.packageHash),
    ).rejects.toThrow();
    const app = await createAppFor(h);
    const bad = await app.inject({
      method: 'GET',
      url:
        '/api/projects/' +
        h.project.id +
        '/issue-packages/' +
        record.id +
        '/file?path=C:/outside.pdf',
      headers: { 'x-mock-user-id': admin.id },
    });
    expect(bad.statusCode).toBe(400);
  });
});
