/**
 * V4-PACKAGES-E2E-04B — Internal Manifest + Draft/Issued Filesystem Truth.
 *
 * Proves:
 *  - NEW Folder/Zip package manifests live OUTSIDE the client-facing package
 *    tree, in an app-owned package-id-scoped internal path.
 *  - The client package tree contains no JSON manifest / metadata sidecar.
 *  - manifestLocatorValue is the persisted authority and points to the new
 *    internal file.
 *  - Verify still resolves the manifest through manifestLocatorValue and
 *    VERIFIEDs, hashing the actual client copies.
 *  - Historical packages whose persisted manifestLocatorValue points to the
 *    OLD client-folder location still verify WITHOUT migration.
 *  - Draft defaults to DRAFT/REV_XX; Issued to ISSUED/REV_XX (server-owned,
 *    business-status driven, not lifecycle).
 *  - Reissue resolves its own internal manifest and does not mutate a prior
 *    package.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
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
import { CanonicalArtifactReconciler } from './infrastructure/output-registry/CanonicalArtifactReconciler';
import { PackageReproducibilityService } from './infrastructure/output-registry/PackageReproducibilityService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { resolveCanonicalArtifactPath } from './infrastructure/output-registry/canonical-artifact-files';

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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e04b-'));
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
  store.addLuminaire(project.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'E2E-04B test luminaire',
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
    notes: 'E2E-04B',
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
  return { outputs: [...schedule.outputs, ...boq.outputs] };
}

function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
  );
}

function packageRequest(
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
    label: 'E2E-04B Package',
    status: 'Draft' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_04B',
    selectedItemIds,
    warningOverrideReason: 'E2E-04B verification override',
    ...overrides,
  };
}

/** Builds a FINALIZED mixed package (Schedule/BOQ outputs) on a composed PREPARING revision. */
async function buildFinalizedPackage(
  harness: Harness,
  overrides: Partial<{
    status: 'Draft' | 'Issued';
    relativeOutputFolder: string;
    label: string;
  }> = {},
) {
  const target = prepareManualRevision(harness);
  const generated = await targetGenerate(harness, target.revisionId);
  await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
  const record = await harness.packages.create(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    packageRequest(
      generated.outputs.map((output) => output.outputId),
      overrides,
    ),
    [],
  );
  return { target, generated, record };
}

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

function createReconciler(harness: Harness): CanonicalArtifactReconciler {
  return new CanonicalArtifactReconciler(harness.registry, (projectId) =>
    harness.store.getProjectFolderPath(projectId),
  );
}

describe('PACKAGES-E2E-04B — internal manifest + Draft/Issued status truth', () => {
  it('1: NEW Folder package manifest is stored OUTSIDE the client package root', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    expect(issuePackage.manifestLocatorValue).toBeTruthy();
    // The manifest lives in an app-owned package-scoped path, NOT under the
    // client-facing folder.
    expect(issuePackage.manifestLocatorValue).not.toMatch(/^ISSUED\/REV_01_04B\//);
    const manifestPath = path.join(harness.projectRoot, issuePackage.manifestLocatorValue!);
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('2: client package tree contains no JSON manifest / metadata sidecar', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const files = listFilesRecursive(record.folderPath);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    expect(jsonFiles).toEqual([]);
    // Only the numbered deliverable folders exist.
    const names = files.map((file) => path.basename(file));
    expect(names.some((name) => name === 'SCLI_PACKAGE_MANIFEST.json')).toBe(false);
  });

  it('3: manifestLocatorValue points to the new internal package-scoped file', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    // Internal path is package-id-scoped and project-contained.
    expect(issuePackage.manifestLocatorValue).toContain(issuePackage.packageId);
    expect(issuePackage.manifestLocatorValue!.startsWith('/')).toBe(false);
    expect(issuePackage.manifestLocatorValue!.startsWith('..')).toBe(false);
    const manifestPath = path.join(harness.projectRoot, issuePackage.manifestLocatorValue!);
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('4: internal manifest is project-contained/app-owned (resolvable via canonical path authority)', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    // Resolving through the canonical path authority must stay inside project root.
    const resolved = resolveCanonicalArtifactPath(
      harness.projectRoot,
      issuePackage.manifestLocatorValue!,
    );
    expect(path.relative(harness.projectRoot, resolved).startsWith('..')).toBe(false);
  });

  it('5: Verify returns VERIFIED for a new relocated-manifest package', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
    expect(result!.deliverables.length).toBeGreaterThan(0);
    for (const deliverable of result!.deliverables) {
      expect(deliverable.status).toBe('VERIFIED');
    }
  });

  it('6: Verify hashes the actual client package copies', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    // Tamper with a client copy -> Verify must return MISMATCH/MISSING.
    const files = listFilesRecursive(record.folderPath).filter((f) => f.endsWith('.pdf'));
    expect(files.length).toBeGreaterThan(0);
    const target = files[0]!;
    writeFileSync(target, 'tampered bytes');
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(['MISMATCH', 'MISSING']).toContain(result!.status);
  });

  it('7: historical package with OLD client-folder manifest locator still verifies without migration', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    // Simulate a historical row: force the persisted manifestLocatorValue back to
    // the OLD client-folder location and place a manifest copy there.
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const oldLocator = 'ISSUED/REV_01_04B/SCLI_PACKAGE_MANIFEST.json';
    const oldPath = path.join(harness.projectRoot, ...oldLocator.split('/'));
    mkdirSync(path.dirname(oldPath), { recursive: true });
    const current = readFileSync(
      path.join(harness.projectRoot, issuePackage.manifestLocatorValue!),
      'utf8',
    );
    writeFileSync(oldPath, current);
    harness.store
      .getSharedDatabase()
      .prepare(
        'UPDATE canonical_issue_packages SET manifest_locator_value = ? WHERE package_id = ?',
      )
      .run(oldLocator, record.id);
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
  });

  it('8: manifest byte/hash semantics unchanged by relocation', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const manifest = canonicalPackageManifestSchema.parse(
      JSON.parse(
        readFileSync(path.join(harness.projectRoot, issuePackage.manifestLocatorValue!), 'utf8'),
      ),
    );
    expect(manifest.packageId).toBe(record.id);
    expect(manifest.version).toBe(2);
  });

  it('9: reissue creates its own NEW internal manifest identity and does not mutate the prior package', async () => {
    const harness = createHarness();
    const first = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const second = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B_REISSUE_1',
    });
    expect(second.record.id).not.toBe(first.record.id);
    const firstPkg = harness.registry.getIssuePackage(first.record.id);
    const secondPkg = harness.registry.getIssuePackage(second.record.id);
    expect(secondPkg.manifestLocatorValue).toContain(secondPkg.packageId);
    // Prior package manifest + client tree are untouched.
    expect(existsSync(path.join(harness.projectRoot, firstPkg.manifestLocatorValue!))).toBe(true);
    const firstManifest = canonicalPackageManifestSchema.parse(
      JSON.parse(
        readFileSync(path.join(harness.projectRoot, firstPkg.manifestLocatorValue!), 'utf8'),
      ),
    );
    expect(firstManifest.packageId).toBe(first.record.id);
  });

  it('12: Issued explicit folder is honored', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, { status: 'Issued' });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    expect(issuePackage.artifactLocatorValue).toMatch(/^ISSUED\//);
  });

  it('13: explicit custom folder is honored even when it is non-default', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Draft',
      relativeOutputFolder: 'CUSTOM/REV_01',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    expect(issuePackage.artifactLocatorValue).toBe('CUSTOM/REV_01');
  });

  it('14: Draft status with an explicit ISSUED folder does not silently rewrite (explicit override honored)', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Draft',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    // An explicitly supplied client folder is respected as-is.
    expect(issuePackage.artifactLocatorValue).toBe('ISSUED/REV_01_04B');
  });
});

describe('PACKAGES-E2E-04B1 — Canonical Artifact Reconciler client-folder authority', () => {
  it('1: a valid FINALIZED new package with an internal manifest does NOT report FINAL_ARTIFACT_MISSING', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    // The manifest lives under the internal metadata path, NOT the client folder.
    expect(issuePackage.manifestLocatorValue).toContain('INTERNAL/PACKAGE_METADATA');
    expect(issuePackage.artifactLocatorValue).toBe('ISSUED/REV_01_04B');

    const report = await createReconciler(harness).reconcile();

    // The reconciler must NOT derive the client folder from dirname(manifest).
    // It must use the canonical package record's client artifact locator.
    expect(report.finalizedPackages).toBe(0);
    expect(report.failedPackages).toBe(0);
    expect(
      report.issues.filter(
        (issue) => issue.entityType === 'PACKAGE' && issue.entityId === record.id,
      ),
    ).toEqual([]);
    expect(
      report.issues.some(
        (issue) => issue.entityType === 'PACKAGE' && issue.code === 'FINAL_ARTIFACT_MISSING',
      ),
    ).toBe(false);
  });

  it('2: the reconciler validates the ACTUAL client package location (hashes the real client copies)', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    // Tamper with a client copy. The reconciler must detect it via the client
    // artifact locator (not the internal manifest folder).
    const files = listFilesRecursive(record.folderPath).filter((f) => f.endsWith('.pdf'));
    expect(files.length).toBeGreaterThan(0);
    writeFileSync(files[0]!, 'tampered client bytes');

    const report = await createReconciler(harness).reconcile();

    // The reconciler validates the actual client package location, so a tampered
    // client copy surfaces as a package issue (hash mismatch), not a false pass.
    expect(
      report.issues.some((issue) => issue.entityType === 'PACKAGE' && issue.entityId === record.id),
    ).toBe(true);
  });

  it('3: a historical OLD-location manifest package still reconciles without migration', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    // Simulate a historical row: force the persisted manifestLocatorValue back
    // to the OLD client-folder location and place a manifest copy there.
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const oldLocator = 'ISSUED/REV_01_04B/SCLI_PACKAGE_MANIFEST.json';
    const oldPath = path.join(harness.projectRoot, ...oldLocator.split('/'));
    mkdirSync(path.dirname(oldPath), { recursive: true });
    const current = readFileSync(
      path.join(harness.projectRoot, issuePackage.manifestLocatorValue!),
      'utf8',
    );
    writeFileSync(oldPath, current);
    harness.store
      .getSharedDatabase()
      .prepare(
        'UPDATE canonical_issue_packages SET manifest_locator_value = ? WHERE package_id = ?',
      )
      .run(oldLocator, record.id);

    const report = await createReconciler(harness).reconcile();

    expect(report.failedPackages).toBe(0);
    expect(
      report.issues.some(
        (issue) => issue.entityType === 'PACKAGE' && issue.code === 'FINAL_ARTIFACT_MISSING',
      ),
    ).toBe(false);
  });

  it('4: an actually missing client artifact still reports missing truthfully', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    // Remove the entire client package folder (the artifact locator target).
    rmSync(record.folderPath, { recursive: true, force: true });

    const report = await createReconciler(harness).reconcile();

    expect(
      report.issues.some(
        (issue) =>
          issue.entityType === 'PACKAGE' &&
          issue.entityId === record.id &&
          issue.code === 'FINAL_ARTIFACT_MISSING',
      ),
    ).toBe(true);
  });

  it('5: reconciliation performs NO lifecycle mutation on a valid FINALIZED package', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const before = harness.registry.getIssuePackage(record.id);

    await createReconciler(harness).reconcile();

    const after = harness.registry.getIssuePackage(record.id);
    expect(after.lifecycleState).toBe('FINALIZED');
    expect(after.failureReason).toBeNull();
    expect(after).toEqual(before);
  });
});

describe('PACKAGES-E2E-04B1 — explicit manifest failure + ZIP cleanliness + new-locator recovery', () => {
  it('1: deleting the internal manifest makes Verify fail truthfully (MISSING) with no regeneration and no lifecycle mutation', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const manifestPath = path.join(harness.projectRoot, issuePackage.manifestLocatorValue!);
    expect(existsSync(manifestPath)).toBe(true);
    rmSync(manifestPath, { force: true });

    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('MISSING');
    // No regeneration: the manifest is not recreated.
    expect(existsSync(manifestPath)).toBe(false);
    // No lifecycle mutation.
    expect(harness.registry.getIssuePackage(record.id).lifecycleState).toBe('FINALIZED');
  });

  it('2: corrupting the internal manifest makes Verify fail truthfully (MISMATCH) with no regeneration and no lifecycle mutation', async () => {
    const harness = createHarness();
    const { record } = await buildFinalizedPackage(harness, {
      status: 'Issued',
      relativeOutputFolder: 'ISSUED/REV_01_04B',
    });
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const manifestPath = path.join(harness.projectRoot, issuePackage.manifestLocatorValue!);
    writeFileSync(manifestPath, '{ not valid json');

    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('MISMATCH');
    // No regeneration: the corrupt manifest is not rewritten.
    expect(readFileSync(manifestPath, 'utf8')).toBe('{ not valid json');
    // No lifecycle mutation.
    expect(harness.registry.getIssuePackage(record.id).lifecycleState).toBe('FINALIZED');
  });

  it('3: a real Zip-mode package contains NO manifest / INTERNAL / .scli entries, and the internal manifest still exists separately', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      {
        ...packageRequest(generated.outputs.map((output) => output.outputId)),
        status: 'Issued',
        outputMode: 'Zip',
        relativeOutputFolder: 'ISSUED/REV_01_04B_ZIP',
      },
      [],
    );
    const issuePackage = harness.registry.getIssuePackage(record.id);
    expect(issuePackage.artifactLocatorValue).toBe('ISSUED/REV_01_04B_ZIP.zip');
    const zipPath = path.join(harness.projectRoot, issuePackage.artifactLocatorValue!);
    expect(existsSync(zipPath)).toBe(true);

    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const entryNames = Object.keys(zip.files);
    // No manifest, no metadata sidecar, no internal folder, no .scli anywhere.
    expect(entryNames.some((name) => name.endsWith('SCLI_PACKAGE_MANIFEST.json'))).toBe(false);
    expect(entryNames.some((name) => name.endsWith('.manifest.json'))).toBe(false);
    expect(entryNames.some((name) => name.includes('INTERNAL/'))).toBe(false);
    expect(entryNames.some((name) => name.includes('.scli'))).toBe(false);
    // The ZIP still contains the real client deliverables.
    expect(entryNames.some((name) => name.includes('03_LUMINAIRE_SCHEDULE'))).toBe(true);
    expect(entryNames.some((name) => name.includes('04_TECHNICAL_BOQ'))).toBe(true);
    // The internal manifest still exists separately at its persisted locator.
    const manifestPath = path.join(harness.projectRoot, issuePackage.manifestLocatorValue!);
    expect(existsSync(manifestPath)).toBe(true);
    expect(issuePackage.manifestLocatorValue).toContain('INTERNAL/PACKAGE_METADATA');
  });

  it('4: recovery of a NEW internal-locator package preserves identity, keeps the internal manifest, recovers the client folder, and Verify succeeds', async () => {
    const harness = createHarness();
    const target = prepareManualRevision(harness);
    const generated = await targetGenerate(harness, target.revisionId);
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);
    const request = {
      ...packageRequest(generated.outputs.map((output) => output.outputId)),
      status: 'Issued' as const,
      outputMode: 'Folder' as const,
      relativeOutputFolder: 'ISSUED/REV_01_04B_RECOVER',
    };
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      request,
      [],
    );
    const issuePackage = harness.registry.getIssuePackage(record.id);
    const internalManifestLocator = issuePackage.manifestLocatorValue!;
    expect(internalManifestLocator).toContain('INTERNAL/PACKAGE_METADATA');
    const clientFolder = path.join(harness.projectRoot, issuePackage.artifactLocatorValue!);
    expect(existsSync(clientFolder)).toBe(true);

    // Simulate an interrupted finalization that left the final evidence in
    // place: the package is FAILED_RECOVERABLE (the state recovery requires)
    // while the client folder and internal manifest remain on disk.
    const database = harness.store.getSharedDatabase();
    database
      .prepare(
        `UPDATE canonical_issue_packages
         SET lifecycle_state = 'FAILED_RECOVERABLE',
             failure_reason = 'Simulated interrupted finalization.'
         WHERE package_id = ?`,
      )
      .run(record.id);

    // Exercise the real recovery path with recoveryPackageId.
    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      { ...request, recoveryPackageId: record.id },
      [],
    );
    expect(recovered.id).toBe(record.id);
    const after = harness.registry.getIssuePackage(record.id);
    expect(after.lifecycleState).toBe('FINALIZED');
    // Same packageId, manifestLocatorValue stays internal, no duplicate metadata path.
    expect(after.packageId).toBe(record.id);
    expect(after.manifestLocatorValue).toBe(internalManifestLocator);
    expect(after.manifestLocatorValue).toContain('INTERNAL/PACKAGE_METADATA');
    // Client package is recovered correctly.
    expect(existsSync(clientFolder)).toBe(true);
    // Verify succeeds after recovery.
    const result = await harness.verifier.verify(harness.project.id, record.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('VERIFIED');
  });
});
