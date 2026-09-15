import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { DomainError, type AppUser, type LuminaireRecord, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type {
  LightingExportInput,
  LightingPackageRenderer,
  TemporaryLightingRenderResult,
} from './luminaire-export-service';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { resolveCanonicalArtifactPath } from './infrastructure/output-registry/canonical-artifact-files';
import {
  PRODUCTION_V4_DDL,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];
const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const exportInput: LightingExportInput = {
  revision: '99',
  issueStatus: 'For Review',
  issueDate: '2026-08-10',
};

/** Legacy store schedule column count (pre-canonical workspace defaults). */
const LEGACY_SCHEDULE_COLUMNS = 21;
/** Resolved `schedule.technical-modern` template column count (canonical authority). */
const RESOLVED_SCHEDULE_COLUMNS = 24;

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

interface CapturedRender {
  readonly project: Project;
  readonly workspace: Parameters<LightingPackageRenderer['render']>[1];
  readonly input: LightingExportInput;
  readonly recovering: boolean;
}

class CapturingRenderer implements LightingPackageRenderer {
  public failNext = false;
  public readonly renders: CapturedRender[] = [];

  public constructor(private readonly scratchRoot: string) {}

  public async render(
    project: Project,
    workspace: Parameters<LightingPackageRenderer['render']>[1],
    input: LightingExportInput,
    context?: { operationId: string; recovery: boolean },
  ): Promise<TemporaryLightingRenderResult> {
    this.renders.push({ project, workspace, input, recovering: context?.recovery ?? false });
    const folder = mkdtempSync(path.join(this.scratchRoot, 'renderer-'));
    const datasheetFolder = path.join(folder, 'datasheets');
    mkdirSync(datasheetFolder);
    const scheduleExcelPath = path.join(folder, 'schedule.xlsx');
    const schedulePdfPath = path.join(folder, 'schedule.pdf');
    const boqExcelPath = path.join(folder, 'boq.xlsx');
    const boqPdfPath = path.join(folder, 'boq.pdf');
    writeFileSync(scheduleExcelPath, `schedule-xlsx:${input.revision}`);
    writeFileSync(schedulePdfPath, `schedule-pdf:${input.revision}`);
    writeFileSync(boqExcelPath, `boq-xlsx:${input.revision}`);
    writeFileSync(boqPdfPath, `boq-pdf:${input.revision}`);
    writeFileSync(path.join(datasheetFolder, 'DL01.pdf'), `datasheet:${input.revision}`);
    if (this.failNext) {
      this.failNext = false;
      rmSync(folder, { recursive: true, force: true });
      throw new DomainError('EXPORT_FAILED', 'Injected renderer failure.', 500);
    }
    let cleaned = false;
    return {
      scheduleExcelPath,
      schedulePdfPath,
      boqExcelPath,
      boqPdfPath,
      datasheetFolder,
      datasheetCount: 1,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        rmSync(folder, { recursive: true, force: true });
      },
    };
  }
}

interface Harness {
  readonly root: string;
  readonly projectRoot: string;
  readonly project: Project;
  readonly store: PersonalWorkspaceStore;
  readonly registry: CanonicalOutputRegistryStore;
  readonly renderer: CapturingRenderer;
  readonly generation: CanonicalGenerationService;
  readonly luminaire: LuminaireRecord;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p2-fnd-a2-04-'));
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
    ['LightingLayout'],
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
    quantity: 10,
    notes: 'A2-04 canonical snapshot test',
    sourceName: 'Manual',
    dimensions: '95 x 110 mm',
    bodyColorFinish: 'Black',
  });
  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  applyV17RevisionDeleteTable(database);
  let tick = 0;
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(Date.parse('2026-08-10T09:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const renderer = new CapturingRenderer(root);
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    renderer,
    generation: new CanonicalGenerationService(store, registry, renderer),
    luminaire,
  };
}

async function generate(harness: Harness, input: LightingExportInput = exportInput) {
  return await harness.generation.generate(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    input,
  );
}

function scheduleColumnsOf(workspace: CapturedRender['workspace']): number {
  return workspace.lightingPackage.scheduleColumns.length;
}

function boqColumnsOf(workspace: CapturedRender['workspace']): number {
  return workspace.lightingPackage.boqColumns.length;
}

describe('P2-FND-A2-04 initial render derives from reserved canonical snapshots', () => {
  it('sends the resolved template column set, not the legacy mutable workspace, to the initial renderer', async () => {
    const harness = createHarness();
    const legacyWorkspace = harness.store.getWorkspace(harness.project.id);
    expect(legacyWorkspace.lightingPackage.scheduleColumns).toHaveLength(LEGACY_SCHEDULE_COLUMNS);

    const generated = await generate(harness);

    // The renderer must receive the canonical 24-column resolved presentation, matching the
    // persisted Output snapshot — not the legacy 21-column workspace that used to flow through.
    expect(harness.renderer.renders).toHaveLength(1);
    const initial = harness.renderer.renders[0]!;
    expect(scheduleColumnsOf(initial.workspace)).toBe(RESOLVED_SCHEDULE_COLUMNS);
    expect(initial.recovering).toBe(false);

    const scheduleOutput = generated.outputs.find(
      (output) => output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'XLSX',
    )!;
    const storedColumns = scheduleOutput.resolvedTemplateSnapshot!.columns;
    expect(storedColumns).toHaveLength(RESOLVED_SCHEDULE_COLUMNS);
    // The renderer config and the stored Output snapshot must agree column-for-column.
    const rendererKeys = initial.workspace.lightingPackage.scheduleColumns.map(
      (column) => column.fieldKey,
    );
    const storedKeys = [...storedColumns]
      .sort((left, right) => left.order - right.order)
      .map((column) => column.fieldKey);
    expect(rendererKeys).toEqual(storedKeys);

    const boqOutput = generated.outputs.find(
      (output) => output.outputFamily === 'TechnicalBoq' && output.outputFormat === 'XLSX',
    )!;
    expect(boqColumnsOf(initial.workspace)).toBe(
      boqOutput.resolvedTemplateSnapshot!.columns.length,
    );
    const boqRendererKeys = initial.workspace.lightingPackage.boqColumns.map(
      (column) => column.fieldKey,
    );
    const boqStoredKeys = [...boqOutput.resolvedTemplateSnapshot!.columns]
      .sort((left, right) => left.order - right.order)
      .map((column) => column.fieldKey);
    expect(boqRendererKeys).toEqual(boqStoredKeys);
  });

  it('keeps the initial renderer on the reserved Luminaire technical snapshot after current data changes', async () => {
    const harness = createHarness();
    // Reserve with Quantity 10 / Tag DL01 / Wattage 8W / UUID A.
    const generated = await generate(harness);
    expect(harness.renderer.renders[0]!.workspace.luminaires[0]).toMatchObject({
      id: harness.luminaire.id,
      tag: 'DL01',
      quantity: 10,
      wattage: '8W',
    });

    // Mutate the current mutable source after reservation. The already-reserved Revision's
    // initial render must still reflect the persisted snapshot, never the current store.
    harness.store.updateLuminaire(harness.project.id, harness.luminaire.id, {
      ...harness.luminaire,
      tag: 'DL-A',
      quantity: 20,
      wattage: '12W',
    });
    expect(harness.store.getWorkspace(harness.project.id).luminaires[0]).toMatchObject({
      tag: 'DL-A',
      quantity: 20,
      wattage: '12W',
    });

    // The persisted Revision snapshot and the artifact-defining renderer input must both be the
    // historical DL01 / 10 / 8W state captured at reservation time.
    const persistedSnapshot = harness.registry.getRevision(generated.revision.revisionId)
      .luminaireSnapshot?.[0];
    expect(persistedSnapshot).toMatchObject({
      luminaireId: harness.luminaire.id,
      tag: 'DL01',
      quantity: 10,
      wattage: '8W',
    });
    expect(harness.renderer.renders[0]!.workspace.luminaires[0]).toMatchObject({
      id: harness.luminaire.id,
      tag: 'DL01',
      quantity: 10,
      wattage: '8W',
    });
  });

  it('uses the reserved Project snapshot values for the initial renderer, ignoring later mutations', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const initial = harness.renderer.renders[0]!;
    expect(initial.project.projectName).toBe(harness.project.projectName);
    expect(initial.project.clientName).toBe(harness.project.clientName);

    const renamed = structuredClone(harness.project);
    renamed.projectName = 'MUTATED AFTER RESERVATION';
    renamed.clientName = 'Another Client';
    const later = await harness.generation.generate(
      renamed,
      harness.store.getWorkspace(harness.project.id),
      actor,
      exportInput,
    );
    // This is a NEW generation that legitimately sees the mutated project.
    expect(later.revision.revisionId).not.toBe(generated.revision.revisionId);
    expect(harness.renderer.renders[1]!.project.projectName).toBe('MUTATED AFTER RESERVATION');

    // The FIRST reserved Revision must retain its original snapshot through readback.
    const storedProject = harness.registry.getRevision(
      generated.revision.revisionId,
    ).projectSnapshot;
    expect(storedProject?.projectName).toBe(harness.project.projectName);
    // And the first renderer invocation saw the original value, not the later mutation.
    expect(initial.project.projectName).toBe(harness.project.projectName);
  });

  it('produces an initial render workspace deep-equal to a retry render workspace for the same reserved Revision', async () => {
    const harness = createHarness();
    // Fail the FIRST generation so the reserved Revision is recoverable, but capture its
    // renderer input before the injected failure throws.
    harness.renderer.failNext = true;
    await expect(generate(harness)).rejects.toThrow('Injected renderer failure');
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(harness.renderer.renders).toHaveLength(1);
    const initial = harness.renderer.renders[0]!;
    expect(initial.recovering).toBe(false);
    const initialWorkspace = initial.workspace;

    // Retry the SAME reserved Revision and Outputs.
    const retryWorkspace = harness.store.getWorkspace(harness.project.id);
    const recovered = await harness.generation.generate(harness.project, retryWorkspace, actor, {
      ...exportInput,
      recoveryRevisionId: failedRevision.revisionId,
    });
    expect(recovered.revision.revisionId).toBe(failedRevision.revisionId);
    const retry = harness.renderer.renders.at(-1)!;
    expect(retry.recovering).toBe(true);
    expect(retry.workspace.luminaires).toEqual(initialWorkspace.luminaires);

    // Render-authoritative inputs must match exactly.
    expect(retry.workspace.lightingPackage.inputMode).toBe(
      initialWorkspace.lightingPackage.inputMode,
    );
    expect(retry.workspace.lightingPackage.pdfPaperSize).toBe(
      initialWorkspace.lightingPackage.pdfPaperSize,
    );
    expect(scheduleColumnsOf(retry.workspace)).toBe(scheduleColumnsOf(initialWorkspace));
    expect(boqColumnsOf(retry.workspace)).toBe(boqColumnsOf(initialWorkspace));
    expect(retry.project.projectName).toBe(initial.project.projectName);
    expect(retry.project.clientName).toBe(initial.project.clientName);
    expect(retry.project.projectCode).toBe(initial.project.projectCode);
  });

  it('ignores post-reservation template setting mutations for the already-reserved Output snapshot', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const scheduleOutput = generated.outputs.find(
      (output) => output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'XLSX',
    )!;
    const storedSnapshot = scheduleOutput.resolvedTemplateSnapshot!;
    expect(storedSnapshot.templateId).toBe('schedule.technical-modern');

    // Change the global default, project override, and template active state AFTER reservation.
    harness.registry.setGlobalDefault({
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.full-technical',
      versionId: 'v1',
      config: { rowDensity: 'Compact' },
    });
    harness.registry.setTemplateState('schedule.technical-modern', 'inactive');
    harness.registry.setProjectOverride(harness.project.id, {
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.consultant',
      versionId: 'v1',
      config: {},
    });

    // The reserved Output snapshot and the initial renderer input are unchanged.
    expect(harness.registry.getOutput(scheduleOutput.outputId).resolvedTemplateSnapshot).toEqual(
      storedSnapshot,
    );
    expect(harness.renderer.renders[0]!.workspace.lightingPackage.scheduleColumns).toHaveLength(
      RESOLVED_SCHEDULE_COLUMNS,
    );
  });

  it('preserves historical attachment locators from the reserved snapshot', async () => {
    const harness = createHarness();
    await generate(harness);
    const renderedLuminaire = harness.renderer.renders[0]!.workspace.luminaires[0]!;
    expect(renderedLuminaire.imagePath).toBe(harness.luminaire.imagePath);
    expect(renderedLuminaire.datasheetPath).toBe(harness.luminaire.datasheetPath);

    const storedSnapshot = harness.registry.listRevisions(harness.project.id)[0]!
      .luminaireSnapshot?.[0];
    expect(storedSnapshot?.imagePath).toBe(harness.luminaire.imagePath);
    expect(storedSnapshot?.datasheetPath).toBe(harness.luminaire.datasheetPath);
  });

  it('preserves atomic generation order and recovery after the reconstruction change', async () => {
    const harness = createHarness();
    harness.renderer.failNext = true;
    await expect(generate(harness)).rejects.toThrow('Injected renderer failure');

    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const failedOutputIds = harness.registry
      .listOutputsForRevision(failedRevision.revisionId)
      .map((output) => output.outputId)
      .sort();
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');

    const recovered = await harness.generation.generate(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      { ...exportInput, recoveryRevisionId: failedRevision.revisionId },
    );
    expect(recovered.revision.revisionId).toBe(failedRevision.revisionId);
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(failedOutputIds);
    expect(recovered.revision.lifecycleState).toBe('FINALIZED');
    for (const output of recovered.outputs) {
      const artifact = resolveCanonicalArtifactPath(harness.projectRoot, output.locatorValue!);
      expect(existsSync(artifact)).toBe(true);
    }
  });
});
