/**
 * V4-ISSUE-A0 — Issue Record Audit Foundation tests.
 *
 * Proves the server-derived Issue audit authority end-to-end through the
 * canonical package path:
 *   - Issued packages receive server-derived issuedBy/issuedAt
 *   - Draft packages persist nulls
 *   - Client payloads cannot spoof either value
 *   - The API route propagates the authenticated actor
 *   - The same logical issuedAt/issuedBy flows across canonical record,
 *     read projection, and manifest
 *   - FAILED_RECOVERABLE retry preserves the original Issue audit
 *   - Reissue mints its own new Issue audit values
 *   - Legacy/pre-migration rows remain readable with nulls
 *   - Draft manifests do not claim an Issue event
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { projectStorageMarkerFileName, type AppUser, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import type { LightingPackageRenderer } from './luminaire-export-service';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V14_DDL,
  applyV12IssueAuditColumns,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import {
  canonicalPackageManifestSchema,
  CanonicalIssuePackageService,
} from './infrastructure/output-registry/CanonicalIssuePackageService';

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const otherActor = seedUsers.find((candidate) => candidate.role === 'Sales') as AppUser;

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
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-issue-a0-'));
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
  writeFileSync(
    path.join(projectRoot, projectStorageMarkerFileName),
    JSON.stringify({
      schemaVersion: 1,
      projectId: project.id,
      createdAt: '2026-08-10T08:00:00.000Z',
      projectCodeSnapshot: project.projectCode,
    }),
  );
  store.initializeProject(
    project.id,
    ['LightingLayout'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, projectRoot);
  store.addLuminaire(project.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'Issue audit test luminaire',
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
    notes: 'Issue audit snapshot',
    sourceName: 'Manual',
    dimensions: '95 x 110 mm',
    bodyColorFinish: 'Black',
  });
  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV17RevisionDeleteTable(database);
  let tick = 0;
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(Date.parse('2026-08-10T09:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const renderer: LightingPackageRenderer = {
    async render(_project, _workspace, input) {
      const folder = mkdtempSync(path.join(root, 'renderer-'));
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
    },
  };
  const generation = new CanonicalGenerationService(store, registry, renderer);
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    packages: new CanonicalIssuePackageService(
      store,
      registry,
      () => new Date('2026-08-10T10:00:00.000Z'),
    ),
    generation,
  };
}

async function generateOutputs(harness: Harness) {
  return await harness.generation.generate(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    { revision: '99', issueStatus: 'For Review', issueDate: '2026-08-10' },
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
    label: 'REV_01 Issue Audit',
    status: 'Issued' as const,
    outputMode: 'Folder' as const,
    relativeOutputFolder: 'ISSUED/REV_01_AUDIT',
    selectedItemIds,
    // The store's real-time luminaire timestamps postdate the anchored
    // revision clock, so Issued packages need an explicit override reason.
    warningOverrideReason: 'Issue audit test override',
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

async function createAppFor(harness: Harness): Promise<FastifyInstance> {
  const provider = new MockDataProvider();
  await provider.updateProject(harness.project.id, { projectFolderPath: harness.projectRoot });
  const app = await createApp({
    config: loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
    provider,
    personalStore: harness.store,
    canonicalOutputRegistry: harness.registry,
  });
  apps.push(app);
  return app;
}

describe('V4-ISSUE-A0 Issue Record Audit Foundation', () => {
  it('1 + 2 + 7 + 8: Issued package receives server-derived issuedAt and issuedBy consistently across authorities', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds),
      [],
    );

    // Canonical record authority.
    const canonical = harness.registry.getIssuePackage(record.id);
    expect(canonical.issuedById).toBe(actor.id);
    expect(canonical.issuedByName).toBe(actor.displayName);
    expect(canonical.issuedAt).toBe('2026-08-10T10:00:00.000Z');

    // Read projection authority (ProjectWorkspace.revisionPackages).
    const projected = harness.store
      .getWorkspace(harness.project.id)
      .revisionPackages.find((item) => item.id === record.id)!;
    expect(projected.issuedById).toBe(actor.id);
    expect(projected.issuedByName).toBe(actor.displayName);
    expect(projected.issuedAt).toBe('2026-08-10T10:00:00.000Z');

    // Manifest authority — the SAME logical value, no drift.
    const manifest = readManifest(harness, record);
    expect(manifest.issuedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(manifest.issuedBy).toEqual({
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
    });
  });

  it('3: Draft package persists issuedAt = null and issuedBy = null', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        status: 'Draft',
        relativeOutputFolder: 'ISSUED/REV_01_DRAFT',
      }),
      [],
    );

    const canonical = harness.registry.getIssuePackage(record.id);
    expect(canonical.issuedById).toBeNull();
    expect(canonical.issuedByName).toBeNull();
    expect(canonical.issuedAt).toBeNull();

    const projected = harness.store
      .getWorkspace(harness.project.id)
      .revisionPackages.find((item) => item.id === record.id)!;
    expect(projected.issuedById).toBeNull();
    expect(projected.issuedByName).toBeNull();
    expect(projected.issuedAt).toBeNull();

    const manifest = readManifest(harness, record);
    expect(manifest.issuedAt).toBeNull();
    expect(manifest.issuedBy).toBeNull();
  });

  it('4 + 5: client payload cannot spoof issuedAt or issuedBy through the API route', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revision-packages`,
      headers: { 'x-mock-user-id': actor.id },
      payload: {
        ...packageRequest(harness, selectedItemIds),
        issuedAt: '1999-01-01T00:00:00.000Z',
        issuedBy: { actorId: otherActor.id, actorNameSnapshot: 'Spoofed Issuer' },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    // The server-derived actor wins; the spoofed values are ignored.
    expect(body.issuedById).toBe(actor.id);
    expect(body.issuedByName).toBe(actor.displayName);
    expect(body.issuedAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(body.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const canonical = harness.registry.getIssuePackage(body.id);
    expect(canonical.issuedById).toBe(actor.id);
    expect(canonical.issuedByName).toBe(actor.displayName);
    expect(canonical.issuedAt).toBe(body.issuedAt);
  });

  it('6: API route propagates the authenticated actor into package creation', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revision-packages`,
      headers: { 'x-mock-user-id': otherActor.id },
      payload: packageRequest(harness, selectedItemIds),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json().data;
    expect(body.issuedById).toBe(otherActor.id);
    expect(body.issuedByName).toBe(otherActor.displayName);
  });

  it('9 + 10 + 11: FAILED_RECOVERABLE retry preserves the original issuedAt and issuedBy even for another actor', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const request = packageRequest(harness, selectedItemIds, {
      relativeOutputFolder: 'ISSUED/REV_01_RECOVER',
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
        actor,
        request,
        [],
      ),
    ).rejects.toThrow();
    const failedPackage = harness.registry.listIssuePackages()[0]!;
    expect(failedPackage.lifecycleState).toBe('FAILED_RECOVERABLE');
    // The Issue audit was captured at reservation time and must survive failure.
    expect(failedPackage.issuedById).toBe(actor.id);
    expect(failedPackage.issuedByName).toBe(actor.displayName);
    expect(failedPackage.issuedAt).toBe('2026-08-10T10:00:00.000Z');

    // Restore the source and retry as a DIFFERENT actor.
    renameSync(heldPath, sourcePath);
    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      otherActor,
      { ...request, recoveryPackageId: failedPackage.packageId },
      [],
    );
    expect(recovered.id).toBe(failedPackage.packageId);
    const canonical = harness.registry.getIssuePackage(recovered.id);
    expect(canonical.lifecycleState).toBe('FINALIZED');
    // Recovery must NOT rewrite Issue ownership.
    expect(canonical.issuedById).toBe(actor.id);
    expect(canonical.issuedByName).toBe(actor.displayName);
    expect(canonical.issuedAt).toBe('2026-08-10T10:00:00.000Z');

    const projected = harness.store
      .getWorkspace(harness.project.id)
      .revisionPackages.find((item) => item.id === recovered.id)!;
    expect(projected.issuedById).toBe(actor.id);
    expect(projected.issuedByName).toBe(actor.displayName);
    expect(projected.issuedAt).toBe('2026-08-10T10:00:00.000Z');

    const manifest = readManifest(harness, recovered);
    expect(manifest.issuedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(manifest.issuedBy).toEqual({
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
    });
  });

  it('12: reissue creates a new package identity with its own new Issue audit values', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, { relativeOutputFolder: 'ISSUED/REV_01_FIRST' }),
      [],
    );
    const second = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      otherActor,
      packageRequest(harness, selectedItemIds, {
        label: 'REV_01 Reissue',
        relativeOutputFolder: 'ISSUED/REV_01_REISSUE',
      }),
      [],
    );

    expect(second.id).not.toBe(first.id);
    const firstCanonical = harness.registry.getIssuePackage(first.id);
    const secondCanonical = harness.registry.getIssuePackage(second.id);
    expect(secondCanonical.packageSequence).toBe(2);
    // Each Issue event carries its own actor and its own timestamp.
    expect(firstCanonical.issuedById).toBe(actor.id);
    expect(secondCanonical.issuedById).toBe(otherActor.id);
    expect(secondCanonical.issuedAt).toBe('2026-08-10T10:00:00.000Z');
    // The previous package is never mutated by the reissue.
    expect(firstCanonical.issuedById).toBe(actor.id);
    expect(firstCanonical.issuedAt).toBe('2026-08-10T10:00:00.000Z');
  });

  it('13 + 14: legacy/pre-migration package rows remain readable with null Issue audit and no fabricated history', async () => {
    const harness = createHarness();
    // Insert a pre-migration-style row directly (no issued_* columns populated).
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

    const projected = harness.store
      .getWorkspace(harness.project.id)
      .revisionPackages.find((item) => item.id === legacyId)!;
    expect(projected.issuedById).toBeNull();
    expect(projected.issuedByName).toBeNull();
    expect(projected.issuedAt).toBeNull();
    // No historical timestamp is fabricated from createdAt.
    expect(projected.createdAt).toBe('2026-07-01T08:00:00.000Z');
    expect(projected.issuedAt).not.toBe(projected.createdAt);
  });

  it('15 + 16: Draft manifest does not claim an Issue event; Issued manifest remains readable', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    const draft = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        status: 'Draft',
        relativeOutputFolder: 'ISSUED/REV_01_DRAFT_MANIFEST',
      }),
      [],
    );
    const draftManifest = readManifest(harness, draft);
    expect(draftManifest.status).toBe('Draft');
    expect(draftManifest.issuedAt).toBeNull();
    expect(draftManifest.issuedBy).toBeNull();

    const issued = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds, {
        relativeOutputFolder: 'ISSUED/REV_01_ISSUED_MANIFEST',
      }),
      [],
    );
    const issuedManifest = readManifest(harness, issued);
    expect(issuedManifest.status).toBe('Issued');
    expect(issuedManifest.issuedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(issuedManifest.issuedBy).toEqual({
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
    });
  });

  it('18: ProjectWorkspace read projection exposes the new nullable audit fields', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);

    await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      packageRequest(harness, selectedItemIds),
      [],
    );

    const workspace = harness.store.getWorkspace(harness.project.id);
    expect(workspace.revisionPackages[0]).toMatchObject({
      issuedById: actor.id,
      issuedByName: actor.displayName,
      issuedAt: '2026-08-10T10:00:00.000Z',
    });
  });

  it('19 + 20: no Submission or IssueHistory entity/table is introduced', async () => {
    const harness = createHarness();
    const tables = harness.store
      .getSharedDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    expect(names).not.toContain('submissions');
    expect(names).not.toContain('issue_history');
    expect(names).not.toContain('issue_history_entries');
  });
});
