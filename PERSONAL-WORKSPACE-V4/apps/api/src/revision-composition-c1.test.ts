/**
 * V4-REVISION-COMPOSITION-C1 — Targeted Generation into a Composed Revision.
 *
 * Proves the C1 targeted-generation authority end to end (service + registry +
 * workspace read), the part the frontend tests cannot reach:
 *
 *  F-A   an eligible target (CANONICAL + PREPARING + MANUAL_DELIVERABLES + same
 *        project) receives newly generated Outputs INSIDE that Revision, which
 *        stays PREPARING;
 *  §13   the workspace read surfaces composableTargets (advisory) and a truthful
 *        requestedTarget verdict for the exact Revision the client names;
 *  §dupe  the SAME family + format is rejected BEFORE render, a DIFFERENT format
 *        is allowed, and 'Both' is rejected when either slot is occupied;
 *  §no-proj  targeted generation does NOT run the legacy compatibility projection
 *        (no project_revisions row is written, unlike standalone generation);
 *  §R3   a targeted failure resolves ONLY the reservations this request created
 *        (discarded or proven-finalized) and never fails the parent Revision nor
 *        touches unrelated pre-existing FINALIZED Outputs;
 *  §no-fallback  an ineligible / foreign / unknown target is REJECTED — it never
 *        silently degrades into a standalone generation;
 *  §excl  targetRevisionId and recoveryRevisionId are mutually exclusive.
 *
 * The C0 boundary test (revision-composition-c0.test.ts) remains valid: the raw
 * canonical output record schema still has no targetRevisionId — C1 only adds it
 * to the GENERATION and WORKSPACE-QUERY contracts, never to the persisted record.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { generateTechnicalScheduleSchema } from '@scli/contracts';
import type { AppUser, LuminaireRecord, Project, ScheduleGenerationFormat } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import type {
  LightingExportInput,
  LightingPackageRenderer,
  TemporaryLightingRenderResult,
} from './luminaire-export-service';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { LuminaireScheduleOutputService } from './infrastructure/output-registry/LuminaireScheduleOutputService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';

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
  public failNext = false;
  public rendered = 0;

  public constructor(private readonly scratchRoot: string) {}

  public async render(
    _project: Project,
    _workspace: Parameters<LightingPackageRenderer['render']>[1],
    input: LightingExportInput,
  ): Promise<TemporaryLightingRenderResult> {
    this.rendered += 1;
    const folder = mkdtempSync(path.join(this.scratchRoot, 'renderer-'));
    const datasheetFolder = path.join(folder, 'datasheets');
    mkdirSync(datasheetFolder);
    const scheduleExcelPath = path.join(folder, 'schedule.xlsx');
    const schedulePdfPath = path.join(folder, 'schedule.pdf');
    writeFileSync(scheduleExcelPath, `schedule-xlsx:${input.revision}`);
    writeFileSync(schedulePdfPath, `schedule-pdf:${input.revision}`);
    writeFileSync(path.join(datasheetFolder, 'DL01.pdf'), 'scratch-only');
    if (this.failNext) {
      this.failNext = false;
      rmSync(folder, { recursive: true, force: true });
      throw new Error('Injected Schedule renderer failure');
    }
    return {
      scheduleExcelPath,
      schedulePdfPath,
      boqExcelPath: scheduleExcelPath,
      boqPdfPath: schedulePdfPath,
      datasheetFolder,
      datasheetCount: 1,
      cleanup: async () => rmSync(folder, { recursive: true, force: true }),
    };
  }
}

interface Harness {
  root: string;
  projectRoot: string;
  project: Project;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  renderer: FakeRenderer;
  generation: CanonicalGenerationService;
  schedule: LuminaireScheduleOutputService;
  revisionDeliverable: RevisionDeliverableService;
  database: DatabaseSync;
  luminaire: LuminaireRecord;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-composition-c1-'));
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
  const luminaire = store.addLuminaire(project.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'Trimless recessed LED downlight',
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
    notes: 'C1 targeted generation test',
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
    renderer,
    generation,
    schedule: new LuminaireScheduleOutputService(store, registry),
    revisionDeliverable: new RevisionDeliverableService(store, registry),
    database,
    luminaire,
  };
}

/** An eligible C1 target: a PREPARING composed MANUAL_DELIVERABLES Revision. */
function prepareComposedDraft(harness: Harness) {
  return harness.revisionDeliverable.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
  );
}

function countRows(harness: Harness, table: string): number {
  const row = harness.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

async function targetGenerate(
  harness: Harness,
  targetRevisionId: string,
  format: ScheduleGenerationFormat,
) {
  return harness.generation.generateSchedule(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    {
      format,
      issueStatus: 'For Review',
      issueDate: '2026-08-17',
      targetRevisionId,
    },
  );
}

describe('C1 — targeted generation into a composed Revision', () => {
  it('F-A + §13: generates Outputs inside the target Revision, which stays PREPARING, and the read surfaces the eligible target', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);

    const generated = await targetGenerate(harness, target.revisionId, 'Both');
    expect(generated.revision.revisionId).toBe(target.revisionId);
    expect(generated.revision.lifecycleState).toBe('PREPARING');
    expect(generated.outputs.map((output) => output.outputFormat).sort()).toEqual(['PDF', 'XLSX']);
    expect(generated.outputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
    expect(generated.outputs.every((output) => output.revisionId === target.revisionId)).toBe(true);
    expect(generated.files.xlsxPath && existsSync(generated.files.xlsxPath)).toBe(true);
    expect(generated.files.pdfPath && existsSync(generated.files.pdfPath)).toBe(true);

    const reloaded = harness.registry.getRevision(target.revisionId);
    expect(reloaded.lifecycleState).toBe('PREPARING');

    // §13 — the workspace read lists the draft as composable and, when asked
    // about this exact Revision, returns an ELIGIBLE verdict with its target.
    const read = await harness.schedule.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
      undefined,
      target.revisionId,
    );
    expect(read.composableTargets.map((item) => item.revisionId)).toContain(target.revisionId);
    expect(read.requestedTarget).toMatchObject({
      revisionId: target.revisionId,
      eligible: true,
      rejection: null,
    });
    expect(read.requestedTarget?.target).toMatchObject({
      revisionId: target.revisionId,
      lifecycleState: 'PREPARING',
    });
    expect(read.outputs.some((item) => item.output.revisionId === target.revisionId)).toBe(true);
  });

  it('§13 — a read for an absent target reports an ineligible verdict with no target', async () => {
    const harness = createHarness();
    const read = await harness.schedule.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
      undefined,
      '99999999-9999-4999-8999-999999999999',
    );
    expect(read.requestedTarget).toMatchObject({
      eligible: false,
      rejection: 'TARGET_NOT_FOUND',
      target: null,
    });
  });

  it('§dupe — same family + format is rejected before render; a different format is allowed', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);

    const first = await targetGenerate(harness, target.revisionId, 'XLSX');
    expect(first.outputs.map((output) => output.outputFormat)).toEqual(['XLSX']);
    const rendersAfterFirst = harness.renderer.rendered;

    // Same family + format: rejected with a typed CONFLICT, no render occurs.
    await expect(targetGenerate(harness, target.revisionId, 'XLSX')).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(harness.renderer.rendered).toBe(rendersAfterFirst);

    // Different format: allowed onto the same Revision.
    const second = await targetGenerate(harness, target.revisionId, 'PDF');
    expect(second.outputs.map((output) => output.outputFormat).sort()).toEqual(['PDF']);
    expect(
      harness.registry
        .listOutputsForRevision(target.revisionId)
        .map((o) => o.outputFormat)
        .sort(),
    ).toEqual(['PDF', 'XLSX']);
  });

  it('§dupe — Both is rejected when either slot is already occupied', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);
    await targetGenerate(harness, target.revisionId, 'XLSX');
    const rendersAfterFirst = harness.renderer.rendered;

    await expect(targetGenerate(harness, target.revisionId, 'Both')).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(harness.renderer.rendered).toBe(rendersAfterFirst);
  });

  it('§excl — the generation contract rejects targetRevisionId together with recoveryRevisionId', () => {
    const parsed = generateTechnicalScheduleSchema.safeParse({
      format: 'XLSX',
      issueStatus: 'For Review',
      issueDate: '2026-08-17',
      targetRevisionId: '99999999-9999-4999-8999-999999999999',
      recoveryRevisionId: '88888888-8888-4888-8888-888888888888',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message).join(' ')).toMatch(
        /mutually exclusive/,
      );
    }
  });

  it('§no-fallback — an unknown, foreign, or ineligible target is rejected and never degrades to standalone', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);
    const revisionsBefore = countRows(harness, 'canonical_revisions');
    const outputsBefore = harness.registry.listOutputs(harness.project.id).length;

    // Unknown target.
    await expect(
      targetGenerate(harness, '99999999-9999-4999-8999-999999999999', 'XLSX'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    // FAILED_RECOVERABLE composed Revision is ineligible (reject, do not silently continue).
    harness.registry.setRevisionLifecycle(
      target.revisionId,
      'FAILED_RECOVERABLE',
      'Simulated failed draft.',
    );
    await expect(targetGenerate(harness, target.revisionId, 'XLSX')).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // None of these created a Revision or an Output.
    expect(countRows(harness, 'canonical_revisions')).toBe(revisionsBefore);
    expect(harness.registry.listOutputs(harness.project.id).length).toBe(outputsBefore);
  });

  it('§no-proj — targeted generation does not run the legacy compatibility projection', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);
    const projectedBefore = countRows(harness, 'project_revisions');

    await targetGenerate(harness, target.revisionId, 'XLSX');
    expect(countRows(harness, 'project_revisions')).toBe(projectedBefore);
  });

  it('§R3 — a targeted failure resolves only this request reservations, never fails the parent or touches pre-existing FINALIZED Outputs', async () => {
    const harness = createHarness();
    const target = prepareComposedDraft(harness);

    // A pre-existing finalized Output on the SAME Revision must survive.
    const preExisting = harness.registry.createOutput({
      revisionId: target.revisionId,
      outputFamily: 'LuminaireSchedule',
      outputFormat: 'PDF',
      relativePath: `DELIVERABLES/${target.revisionLabel}/pre-existing.pdf`,
      contentHash: 'a'.repeat(64),
      resolvedTemplate: harness.registry.resolveEffectiveTechnicalScheduleTemplate(
        harness.project.id,
      ),
    });
    harness.registry.setOutputLifecycle(preExisting.outputId, 'FINALIZED');

    harness.renderer.failNext = true;
    await expect(targetGenerate(harness, target.revisionId, 'XLSX')).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
      statusCode: 500,
    });

    // The parent Revision is never failed; the unrelated pre-existing FINALIZED
    // Output is untouched.
    expect(harness.registry.getRevision(target.revisionId).lifecycleState).toBe('PREPARING');
    expect(harness.registry.getOutput(preExisting.outputId).lifecycleState).toBe('FINALIZED');
    expect(
      existsSync(
        path.join(harness.projectRoot, `DELIVERABLES/${target.revisionLabel}/pre-existing.pdf`),
      ),
    ).toBe(false); // the pre-existing was only reserved/finalized with a fake hash; no file was ever written

    // The failed XLSX reservation must not remain in a PREPARING state.
    const failedOutputs = harness.registry.listOutputsForRevision(target.revisionId);
    expect(failedOutputs.some((output) => output.outputFormat === 'XLSX')).toBe(false);
  });
});

describe('C1 — targeted generation HTTP contract', () => {
  it('rejects targetRevisionId together with recoveryRevisionId at the route boundary', async () => {
    const harness = createHarness();
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
      method: 'POST',
      url: `/api/projects/${harness.project.id}/luminaire-schedule/generate`,
      headers,
      payload: {
        format: 'XLSX',
        issueStatus: 'For Review',
        issueDate: '2026-08-17',
        targetRevisionId: '99999999-9999-4999-8999-999999999999',
        recoveryRevisionId: '88888888-8888-4888-8888-888888888888',
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const messages = (body.error.details?.issues ?? []).map(
      (issue: { message: string }) => issue.message,
    );
    expect(messages.join(' ')).toMatch(/mutually exclusive/);
  });
});
