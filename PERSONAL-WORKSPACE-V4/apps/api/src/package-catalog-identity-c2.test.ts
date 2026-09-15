/**
 * V4-PACKAGE-CATALOG-IDENTITY-C2 — Package Catalog Identity Contract.
 *
 * Proves the C2 identity-contract correction end to end: the package catalog
 * must identify its server-selected Revision by the canonical UUID
 * (revisionId), never by the per-project display sequence.
 *
 *  §id-canonical   the canonical producer returns revisionId = the FINALIZED
 *                  revision's UUID and suggestedRevision = the same revision's
 *                  display sequence (they always agree);
 *  §id-none        with no eligible Revision, revisionId is null — never a
 *                  fabricated UUID, and never inferred from the sequence;
 *  §id-http        GET /api/projects/:id/revision-package-catalog surfaces the
 *                  UUID through the wire contract;
 *  §id-legacy      the non-canonical producer returns revisionId === null and
 *                  must NOT derive identity from revisionNumber /
 *                  revisionSequence / suggestedRevision / label.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import type {
  LightingExportInput,
  LightingPackageRenderer,
  TemporaryLightingRenderResult,
} from './luminaire-export-service';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { RevisionPackageService } from './revision-package-service';
import {
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  PRODUCTION_V4_DDL,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

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

class FakeRenderer implements LightingPackageRenderer {
  public async render(
    _project: Project,
    _workspace: Parameters<LightingPackageRenderer['render']>[1],
    input: LightingExportInput,
  ): Promise<TemporaryLightingRenderResult> {
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

  public constructor(private readonly scratchRoot: string) {}
}

interface Harness {
  root: string;
  projectRoot: string;
  project: Project;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  packages: CanonicalIssuePackageService;
  legacyPackages: RevisionPackageService;
  generation: CanonicalGenerationService;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-catalog-c2-'));
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
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, projectRoot);
  store.addLuminaire(project.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'Catalog identity C2 test luminaire',
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
    notes: 'Catalog identity snapshot',
    sourceName: 'Manual',
    dimensions: '95 x 110 mm',
    bodyColorFinish: 'Black',
  });
  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
  applyV15SnapshotProvenanceColumn(database);
  applyV16SnapshotRebuild(database);
  applyV17RevisionDeleteTable(database);
  let tick = 0;
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(Date.parse('2026-08-17T08:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const renderer = new FakeRenderer(root);
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
      () => new Date('2026-08-17T10:00:00.000Z'),
    ),
    legacyPackages: new RevisionPackageService(store),
    generation,
  };
}

/** Standalone generation: creates + finalizes a canonical Revision with Outputs. */
async function generateOutputs(harness: Harness) {
  return await harness.generation.generate(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    { revision: '99', issueStatus: 'For Review', issueDate: '2026-08-17' },
  );
}

describe('C2 — package catalog identity contract (canonical producer)', () => {
  it('§id-canonical — catalog exposes the FINALIZED Revision UUID and its matching display sequence', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
    const revisionId = generated.revision.revisionId;

    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    expect(catalog.revisionId).toBe(revisionId);
    expect(catalog.suggestedRevision).toBe(generated.revision.revisionSequence);
    expect(catalog.items.some((item) => item.id === generated.outputs[0]!.outputId)).toBe(true);
  });

  it('reads an explicitly selected historical Revision and rejects foreign or unfinished identities', async () => {
    const harness = createHarness();
    const first = await generateOutputs(harness);
    const second = await generateOutputs(harness);
    const workspace = harness.store.getWorkspace(harness.project.id);
    const catalog = await harness.packages.catalog(
      harness.project,
      workspace,
      [],
      first.revision.revisionId,
    );
    expect(catalog.revisionId).toBe(first.revision.revisionId);
    expect(catalog.items.some((item) => item.id === first.outputs[0]!.outputId)).toBe(true);
    expect(catalog.items.some((item) => item.id === second.outputs[0]!.outputId)).toBe(false);
    await expect(
      harness.packages.catalog(
        harness.project,
        workspace,
        [],
        '00000000-0000-4000-8000-000000000099',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      harness.packages.catalog(
        { ...harness.project, id: '00000000-0000-4000-8000-000000000099' },
        workspace,
        [],
        first.revision.revisionId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(harness.registry.listRevisions(harness.project.id)).toHaveLength(2);
  });

  it('§id-none — with no eligible Revision, revisionId is null and the sequence is not identity', async () => {
    const harness = createHarness();
    const catalog = await harness.packages.catalog(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      [],
    );
    expect(catalog.revisionId).toBeNull();
    // The fallback sequence is presentation-only; it must never be usable as
    // an identity key (no revision with that UUID exists).
    expect(
      harness.registry
        .listRevisions(harness.project.id)
        .some((revision) => revision.revisionId === catalog.revisionId),
    ).toBe(false);
  });

  it('§id-http — GET revision-package-catalog surfaces revisionId on the wire', async () => {
    const harness = createHarness();
    const generated = await generateOutputs(harness);
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
      canonicalGenerationService: harness.generation,
    });
    apps.push(app);
    const headers = { 'x-mock-user-id': actor.id };

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/revision-package-catalog`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.revisionId).toBe(generated.revision.revisionId);
    expect(body.data.suggestedRevision).toBe(generated.revision.revisionSequence);
    const available = body.data.items.filter((item: { available: boolean }) => item.available);
    expect(available.length).toBeGreaterThan(0);
    expect(available.every((item: { sizeBytes: number }) => item.sizeBytes > 0)).toBe(true);
    expect(
      body.data.checks.find((check: { key: string }) => check.key === 'outputs'),
    ).toMatchObject({ passed: true });
  });
});

describe('C2 — package catalog identity contract (legacy producer)', () => {
  it('§id-legacy — returns revisionId null even when a matching workspace Revision exists; never ordinal-derived', async () => {
    const harness = createHarness();
    // Seed a workspace Revision whose number equals the suggested sequence. The
    // legacy catalog must NOT reverse-lookup it into a canonical UUID.
    const seeded = harness.store.operations.createRevision(harness.project.id, {
      revisionNumber: 4,
      reissueNumber: 0,
      title: 'Rev 04',
      status: 'Draft',
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: 'Legacy catalog identity seed',
      changeLog: '',
      sourceType: 'Manual',
      sourceReference: '',
    });
    const workspace = harness.store.getWorkspace(harness.project.id);
    const catalog = await harness.legacyPackages.catalog(harness.project, workspace);
    expect(catalog.suggestedRevision).toBe(seeded.revisionNumber);
    expect(catalog.revisionId).toBeNull();
    expect(catalog.revisionId).not.toBe(seeded.id);
  });

  it('§id-legacy — returns null identity when no workspace Revision matches the suggested sequence', async () => {
    const harness = createHarness();
    const workspace = harness.store.getWorkspace(harness.project.id);
    // Force a suggested sequence no workspace Revision can match.
    const noMatch = { ...workspace, revisions: [] } as typeof workspace;
    const catalog = await harness.legacyPackages.catalog(harness.project, noMatch);
    expect(catalog.revisionId).toBeNull();
    expect(catalog.suggestedRevision).toBeGreaterThanOrEqual(1);
  });
});
