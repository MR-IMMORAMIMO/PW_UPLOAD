/**
 * REV-02A — canonical Issue History read model tests.
 *
 * Proves the read-only projection end to end through the canonical package
 * path and the GET /api/projects/:id/issue-history route:
 *   - project isolation (A cannot see B)
 *   - deterministic ordering (Issued DESC, Draft last, reissue above)
 *   - actor visibility (Admin / Sales / Designer)
 *   - mixed deliverables (DocumentSnapshot + GeneratedOutput)
 *   - Draft package null Issue fields
 *   - FAILED_RECOVERABLE recovery produces no duplicate history entry
 *   - reissue mints a new package identity
 *   - legacy revision_packages rows never appear in canonical history
 *   - broken Deliverable references degrade without failing the response
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
import { IssueHistoryService } from './infrastructure/output-registry/IssueHistoryService';

const admin = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const salesOne = seedUsers.find((candidate) => candidate.role === 'Sales') as AppUser;
const designerOne = seedUsers.find((candidate) => candidate.role === 'Designer') as AppUser;

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
  history: IssueHistoryService;
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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-issue-history-'));
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
    description: 'Issue history test luminaire',
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
    notes: 'Issue history snapshot',
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
    history: new IssueHistoryService(registry),
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

/** Standalone generation: creates + finalizes a canonical Revision with Outputs. */
async function generateOutputs(harness: Harness) {
  return await harness.generation.generate(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
    { revision: '99', issueStatus: 'For Review', issueDate: '2026-08-20' },
  );
}

/** Registers an operational Project Document backed by a real file inside the project root. */
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
    admin,
    revisionId,
    { sourceDocumentId: document.id, title },
  );
}

/** A composed B0 draft: MANUAL_DELIVERABLES PREPARING Revision. */
function prepareManualRevision(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    admin,
  );
}

/** C1 targeted Schedule/BOQ generation into an existing PREPARING composed Revision. */
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
    recoveryPackageId: string;
  }> = {},
) {
  return {
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'REV_01 Issue History',
    status: 'Issued' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_HISTORY',
    selectedItemIds,
    warningOverrideReason: 'Issue history test override',
    ...overrides,
  };
}

async function issueHistory(harness: Harness, actorId: string) {
  const app = await createAppFor(harness);
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${harness.project.id}/issue-history`,
    headers: { 'x-mock-user-id': actorId },
  });
  return response;
}

describe('REV-02A — Issue History read model', () => {
  it('1: project isolation — Project A cannot see Project B history', async () => {
    const harnessA = createHarness(0);
    const harnessB = createHarness(1);
    const generatedA = await generateOutputs(harnessA);
    await harnessA.packages.create(
      harnessA.project,
      harnessA.store.getWorkspace(harnessA.project.id),
      admin,
      packageRequest(
        harnessA,
        generatedA.outputs.map((output) => output.outputId),
      ),
      [],
    );
    const generatedB = await generateOutputs(harnessB);
    await harnessB.packages.create(
      harnessB.project,
      harnessB.store.getWorkspace(harnessB.project.id),
      admin,
      packageRequest(
        harnessB,
        generatedB.outputs.map((output) => output.outputId),
      ),
      [],
    );

    const app = await createAppFor(harnessA);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${harnessA.project.id}/issue-history`,
      headers: { 'x-mock-user-id': admin.id },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as Array<{
      package: { packageId: string };
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.package.packageId).toBe(harnessA.registry.listIssuePackages()[0]!.packageId);
    // The other project's package id never appears.
    const otherPackageId = harnessB.registry.listIssuePackages()[0]!.packageId;
    expect(items.some((item) => item.package.packageId === otherPackageId)).toBe(false);
  });

  it('2: ordering — Issued DESC, Draft last, reissue above its predecessor', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    // First issue (10:00:00).
    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/FIRST' }),
      [],
    );
    // Reissue (10:00:00, sequence 2).
    const reissue = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, {
        label: 'REV_01 Reissue',
        relativeOutputFolder: 'ISSUED/REISSUE',
      }),
      [],
    );
    // Draft (no issuedAt).
    const draft = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, {
        status: 'Draft',
        relativeOutputFolder: 'ISSUED/DRAFT',
      }),
      [],
    );

    const items = harness.history.list(harness.project.id);
    expect(items.map((item) => item.package.packageId)).toEqual([reissue.id, first.id, draft.id]);
    expect(items[0]!.package.businessStatus).toBe('Issued');
    expect(items[0]!.package.packageSequence).toBe(2);
    expect(items[2]!.package.businessStatus).toBe('Draft');
    expect(items[2]!.package.issuedAt).toBeNull();
  });

  it('3: actor visibility — Admin sees all, Sales sees own, Designer sees assigned', async () => {
    const harness = createHarness(0); // salesOwnerId = salesOne, assignedDesignerId = null
    const generated = await generateOutputs(harness);
    await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(
        harness,
        generated.outputs.map((output) => output.outputId),
      ),
      [],
    );

    // Admin: 200 with the package.
    const adminResponse = await issueHistory(harness, admin.id);
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.json().data.items).toHaveLength(1);

    // Sales owner: 200 with the package.
    const salesResponse = await issueHistory(harness, salesOne.id);
    expect(salesResponse.statusCode).toBe(200);
    expect(salesResponse.json().data.items).toHaveLength(1);

    // Designer not assigned to this project: denied.
    const designerResponse = await issueHistory(harness, designerOne.id);
    expect(designerResponse.statusCode).toBe(403);
  });

  it('4: mixed deliverables — DocumentSnapshot and GeneratedOutput both project', async () => {
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
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const selectedItemIds = [
      ...generated.outputs.map((output) => output.outputId),
      dwg.deliverableId,
    ];
    await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/MIXED' }),
      [],
    );

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(1);
    const deliverables = items[0]!.deliverables;
    const snapshot = deliverables.find((item) => item.sourceType === 'DocumentSnapshot');
    const output = deliverables.find((item) => item.sourceType === 'GeneratedOutput');
    expect(snapshot).toBeDefined();
    expect(output).toBeDefined();
    if (snapshot?.sourceType === 'DocumentSnapshot') {
      expect(snapshot.deliverableId).toBe(dwg.deliverableId);
      expect(snapshot.title).toBe('Layout DWG');
      expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshot.sizeBytes).toBeGreaterThan(0);
      expect(snapshot.locator).toContain('DELIVERABLES');
      expect(snapshot.sourceArtifactVersionId).toBeNull();
    }
    if (output?.sourceType === 'GeneratedOutput') {
      expect(output.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(output.templateId).toBeTruthy();
      expect(output.templateVersionId).toBeTruthy();
      expect(output.resolvedTemplateSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('5: Draft package — null Issue fields and Draft business status', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const draft = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(
        harness,
        generated.outputs.map((output) => output.outputId),
        {
          status: 'Draft',
          relativeOutputFolder: 'ISSUED/DRAFT_ONLY',
        },
      ),
      [],
    );

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.package.packageId).toBe(draft.id);
    expect(items[0]!.package.businessStatus).toBe('Draft');
    expect(items[0]!.package.issuedAt).toBeNull();
    expect(items[0]!.package.issuedBy).toBeNull();
    expect(items[0]!.package.lifecycleState).toBe('FINALIZED');
    expect(items[0]!.deliverables.length).toBeGreaterThan(0);
  });

  it('6: FAILED_RECOVERABLE recovery — no duplicate history entry', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const request = packageRequest(harness, selectedItemIds, {
      relativeOutputFolder: 'ISSUED/RECOVER',
    });

    // Force a recoverable failure by moving the real source artifact away.
    const missing = generated.outputs[0]!;
    const sourcePath = path.join(harness.projectRoot, missing.locatorValue!);
    const heldPath = `${sourcePath}.held-by-test`;
    expect(existsSync(sourcePath)).toBe(true);
    renameSync(sourcePath, heldPath);

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        admin,
        request,
        [],
      ),
    ).rejects.toThrow();
    const failedPackage = harness.registry.listIssuePackages()[0]!;
    expect(failedPackage.lifecycleState).toBe('FAILED_RECOVERABLE');

    // Restore the source and retry with the same identity.
    renameSync(heldPath, sourcePath);
    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      { ...request, recoveryPackageId: failedPackage.packageId },
      [],
    );
    expect(recovered.id).toBe(failedPackage.packageId);

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.package.packageId).toBe(failedPackage.packageId);
    expect(items[0]!.package.lifecycleState).toBe('FINALIZED');
    expect(items[0]!.package.issuedAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('7: reissue — new package identity with its own entry', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/REISSUE_1' }),
      [],
    );
    const second = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, {
        label: 'REV_01 Reissue',
        relativeOutputFolder: 'ISSUED/REISSUE_2',
      }),
      [],
    );
    expect(second.id).not.toBe(first.id);

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(2);
    expect(items[0]!.package.packageId).toBe(second.id);
    expect(items[1]!.package.packageId).toBe(first.id);
    expect(items[0]!.package.packageSequence).toBe(2);
    expect(items[1]!.package.packageSequence).toBe(1);
    // Both entries share the same Revision.
    expect(items[0]!.revision.revisionId).toBe(items[1]!.revision.revisionId);
  });

  it('8: legacy separation — revision_packages rows never appear in canonical history', async () => {
    const harness = createHarness();
    // Insert a legacy compatibility row directly (never a canonical package).
    const legacyId = 'b0000000-0000-4000-8000-000000000001';
    harness.store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO revision_packages
         (id, project_id, revision_number, reissue_number, label, status, output_mode,
          folder_path, zip_path, item_count, total_bytes, package_hash,
          warning_override_reason, manifest_json, luminaire_snapshot_json, created_at)
         VALUES (?, ?, 1, 0, 'Legacy package', 'Issued', 'Folder', ?, '', 1, 10,
                 'legacy-hash', '', '[]', '[]', ?)`,
      )
      .run(
        legacyId,
        harness.project.id,
        path.join(harness.projectRoot, 'ISSUED', 'LEGACY'),
        '2026-07-01T08:00:00.000Z',
      );

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(0);
    expect(items.some((item) => item.package.packageId === legacyId)).toBe(false);
  });

  it('9: broken references — history remains readable with degraded deliverables', async () => {
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
    await harness.deliverables.finalizeRevision(harness.project, target.revisionId);

    const selectedItemIds = [
      ...generated.outputs.map((output) => output.outputId),
      dwg.deliverableId,
    ];
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      admin,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/BROKEN' }),
      [],
    );

    // Break one Deliverable source reference (simulate a deleted snapshot row).
    harness.store
      .getSharedDatabase()
      .prepare('DELETE FROM revision_document_snapshots WHERE deliverable_id = ?')
      .run(dwg.deliverableId);

    const items = harness.history.list(harness.project.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.package.packageId).toBe(record.id);
    // The broken snapshot is omitted; the GeneratedOutput members survive.
    expect(items[0]!.deliverables.some((item) => item.sourceType === 'GeneratedOutput')).toBe(true);
    expect(
      items[0]!.deliverables.some(
        (item) =>
          item.sourceType === 'DocumentSnapshot' && item.deliverableId === dwg.deliverableId,
      ),
    ).toBe(false);
  });
});
