import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@scli/config';
import {
  DomainError,
  projectStorageMarkerFileName,
  type AppUser,
  type LuminaireRecord,
  type Project,
  type ScheduleGenerationFormat,
} from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { TEST_FUTURE_REQUIRED_DELIVERY_DATE } from '../../../tests/test-authority';
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
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { LuminaireScheduleOutputService } from './infrastructure/output-registry/LuminaireScheduleOutputService';
import { createPersonalProductionRuntime } from './infrastructure/startup/createPersonalProductionServer';

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];
const apps: FastifyInstance[] = [];
const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

class FakeScheduleRenderer implements LightingPackageRenderer {
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
    const boqExcelPath = path.join(folder, 'boq.xlsx');
    const boqPdfPath = path.join(folder, 'boq.pdf');
    writeFileSync(scheduleExcelPath, `schedule-xlsx:${input.revision}`);
    writeFileSync(schedulePdfPath, `schedule-pdf:${input.revision}`);
    writeFileSync(boqExcelPath, `boq-xlsx:${input.revision}`);
    writeFileSync(boqPdfPath, `boq-pdf:${input.revision}`);
    writeFileSync(path.join(datasheetFolder, 'DL01.pdf'), 'scratch-only');
    if (this.failNext) {
      this.failNext = false;
      rmSync(folder, { recursive: true, force: true });
      throw new DomainError('EXPORT_FAILED', 'Injected Schedule renderer failure.', 500);
    }
    return {
      scheduleExcelPath,
      schedulePdfPath,
      boqExcelPath,
      boqPdfPath,
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
  renderer: FakeScheduleRenderer;
  generation: CanonicalGenerationService;
  schedule: LuminaireScheduleOutputService;
  luminaire: LuminaireRecord;
}

function writeStorageMarker(projectRoot: string, project: Project): void {
  writeFileSync(
    path.join(projectRoot, projectStorageMarkerFileName),
    JSON.stringify({
      schemaVersion: 1,
      projectId: project.id,
      createdAt: '2026-08-17T08:00:00.000Z',
      projectCodeSnapshot: project.projectCode,
    }),
  );
}

async function connectedProvider(project: Project, projectRoot: string): Promise<MockDataProvider> {
  const provider = new MockDataProvider();
  await provider.updateProject(project.id, { projectFolderPath: projectRoot });
  return provider;
}

function createHarness(folderConnected = true): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-schedule-output-'));
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
  if (folderConnected) {
    store.setFolderPath(project.id, projectRoot);
    writeStorageMarker(projectRoot, project);
  }
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
    notes: 'Schedule integration test',
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
    { now: () => new Date(Date.parse('2026-08-17T08:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const renderer = new FakeScheduleRenderer(root);
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
    luminaire,
  };
}

async function generate(harness: Harness, format: ScheduleGenerationFormat) {
  return harness.generation.generateSchedule(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    { format, issueStatus: 'For Review', issueDate: '2026-08-17' },
  );
}

async function recover(harness: Harness, revisionId: string, format?: ScheduleGenerationFormat) {
  return harness.generation.generateSchedule(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    {
      ...(format ? { format } : {}),
      issueStatus: 'Ignored during recovery',
      issueDate: '2026-08-18',
      recoveryRevisionId: revisionId,
    },
  );
}

function countRows(harness: Harness, table: string): number {
  const row = harness.store
    .getSharedDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return Number(row.count);
}

function hasTable(store: PersonalWorkspaceStore, table: string): boolean {
  return Boolean(
    store
      .getSharedDatabase()
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

describe('Luminaire Schedule canonical output integration delta', () => {
  it('resolves fallback, lists only active technical templates, and composes project Columns/Paper override immutably', async () => {
    const harness = createHarness();
    const initial = await harness.schedule.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
    );
    expect(initial.effectiveTemplate).toMatchObject({
      templateId: 'schedule.technical-modern',
      versionId: 'v2',
      family: 'LuminaireSchedule',
    });
    expect(
      initial.templates.map(
        (template) => `${template.templateId}/${template.resolvedTemplate.versionId}`,
      ),
    ).toEqual([
      'schedule.classic-grid-pro.compact/v1',
      'schedule.classic-grid-pro.consultant/v1',
      'schedule.technical-modern/v2',
    ]);
    expect(
      initial.templates.every(
        (template) => template.resolvedTemplate.family === 'LuminaireSchedule',
      ),
    ).toBe(true);

    const immutableBefore = harness.registry.getTemplateVersion(
      'schedule.classic-grid-pro.compact',
      'v1',
    );
    const column = immutableBefore.definition.columns[0]!;
    const updated = harness.schedule.updateConfig(harness.project.id, {
      templateId: 'schedule.classic-grid-pro.compact',
      templateVersionId: 'v1',
      columns: [{ columnId: column.columnId, visible: !column.visible, order: 77, width: 222 }],
      paperSize: 'A4',
    });
    expect(updated.projectOverride).toMatchObject({
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.compact',
      versionId: 'v1',
    });
    expect(updated.effectiveTemplate.paperSize).toBe('A4');
    expect(
      updated.effectiveTemplate.columns.find((item) => item.columnId === column.columnId),
    ).toMatchObject({
      visible: !column.visible,
      order: 77,
      width: 222,
    });
    expect(harness.registry.getTemplateVersion('schedule.classic-grid-pro.compact', 'v1')).toEqual(
      immutableBefore,
    );
    expect(() =>
      harness.schedule.updateConfig(harness.project.id, {
        templateId: 'schedule.presentation',
        templateVersionId: 'v1',
      }),
    ).toThrow('LuminaireSchedule template');
  });

  it('returns Revision snapshots and Schedule-only history with truthful Present, Missing, and failed states', async () => {
    const harness = createHarness();
    const generated = await generate(harness, 'Both');
    unlinkSync(generated.files.pdfPath!);
    harness.store.addLuminaire(harness.project.id, {
      tag: 'WL01',
      category: 'Wall Light',
      imagePath: '',
      description: 'Added after historical snapshot',
      manufacturer: '',
      model: '',
      wattage: '',
      lumens: '',
      lightColor: '',
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
    });
    harness.renderer.failNext = true;
    await expect(generate(harness, 'PDF')).rejects.toThrow('Injected Schedule renderer failure');

    const boqRevision = harness.registry.createRevision({
      projectId: harness.project.id,
      projectSnapshot: {
        id: harness.project.id,
        projectCode: harness.project.projectCode,
        projectName: harness.project.projectName,
        clientName: harness.project.clientName,
        projectType: harness.project.projectType,
        status: harness.project.status,
        updatedAt: harness.project.updatedAt,
      },
      luminaires: [],
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const boq = harness.registry.createOutput({
      revisionId: boqRevision.revisionId,
      outputFamily: 'TechnicalBoq',
      outputFormat: 'PDF',
      relativePath: `BOQ/${boqRevision.revisionLabel}/boq.pdf`,
      contentHash: null,
      resolvedTemplate: harness.registry.resolveEffectiveTemplate(
        harness.project.id,
        'TechnicalBoq',
      ),
    });
    harness.registry.setOutputContentHash(boq.outputId, 'a'.repeat(64));
    harness.registry.setOutputLifecycle(boq.outputId, 'FINALIZED');
    harness.registry.setRevisionLifecycle(boqRevision.revisionId, 'FINALIZED');

    const read = await harness.schedule.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
      generated.revision.revisionId,
    );
    expect(read.currentRows).toHaveLength(2);
    expect(read.selectedRevision?.rows).toHaveLength(1);
    expect(read.selectedRevision?.rows[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      quantity: 12,
    });
    expect(read.revisions.map((item) => item.revision.revisionId)).toContain(
      generated.revision.revisionId,
    );
    expect(read.outputs.every((item) => item.output.outputFamily === 'LuminaireSchedule')).toBe(
      true,
    );
    const successfulHistory = read.outputs.filter(
      (item) => item.output.revisionId === generated.revision.revisionId,
    );
    expect(
      successfulHistory.find((item) => item.output.outputFormat === 'XLSX')?.artifactPresence,
    ).toBe('Present');
    expect(
      successfulHistory.find((item) => item.output.outputFormat === 'PDF')?.artifactPresence,
    ).toBe('Missing');
    const failed = read.outputs.find((item) => item.output.lifecycleState === 'FAILED_RECOVERABLE');
    expect(failed).toMatchObject({ artifactPresence: 'Missing' });
    expect(failed?.createdByName).toBe(actor.displayName);
    expect(read.outputs.some((item) => item.output.outputId === boq.outputId)).toBe(false);
  });

  it.each([
    ['XLSX', ['XLSX']],
    ['PDF', ['PDF']],
    ['Both', ['PDF', 'XLSX']],
  ] as const)(
    'generates only requested %s Schedule outputs and no BOQ or Datasheets',
    async (format, formats) => {
      const harness = createHarness();
      const effective = harness.schedule.updateConfig(harness.project.id, {
        columns: [{ columnId: 'model', visible: false, order: 21, width: 240 }],
        paperSize: 'A3',
      }).effectiveTemplate;
      const generated = await generate(harness, format);
      expect(generated.outputs.map((output) => output.outputFormat).sort()).toEqual(formats);
      expect(generated.outputs.every((output) => output.outputFamily === 'LuminaireSchedule')).toBe(
        true,
      );
      expect(generated.outputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
      expect(generated.outputs.every((output) => output.resolvedTemplateSnapshotHash)).toBe(true);
      expect(
        generated.outputs.every(
          (output) => JSON.stringify(output.resolvedTemplateSnapshot) === JSON.stringify(effective),
        ),
      ).toBe(true);
      expect(harness.registry.listOutputs(harness.project.id)).toHaveLength(formats.length);
      expect(countRows(harness, 'project_exports')).toBe(0);
      expect(countRows(harness, 'project_documents')).toBe(formats.length);
      const outputFolders = harness.store.getWorkspace(harness.project.id).outputFolders;
      for (const outputFolder of [
        outputFolders.boqExcel,
        outputFolders.boqPdf,
        outputFolders.datasheets,
      ]) {
        expect(
          existsSync(
            path.join(harness.projectRoot, outputFolder, generated.revision.revisionLabel),
          ),
        ).toBe(false);
      }
      expect(
        harness.registry
          .listOutputs(harness.project.id)
          .some((output) => output.outputFamily === 'TechnicalBoq'),
      ).toBe(false);
      expect(generated.revision.luminaireSnapshot?.[0]?.luminaireId).toBe(harness.luminaire.id);
    },
  );

  it('keeps historical template/column snapshots immutable after a later project override', async () => {
    const harness = createHarness();
    const firstEffective = harness.schedule.updateConfig(harness.project.id, {
      columns: [{ columnId: 'model', visible: false, width: 222 }],
      paperSize: 'A4',
    }).effectiveTemplate;
    const generated = await generate(harness, 'XLSX');
    harness.schedule.updateConfig(harness.project.id, {
      templateId: 'schedule.classic-grid-pro.consultant',
      templateVersionId: 'v1',
      paperSize: 'A3',
    });
    expect(
      harness.registry.getOutput(generated.outputs[0]!.outputId).resolvedTemplateSnapshot,
    ).toEqual(firstEffective);
  });

  it('blocks Golden-style generation without a project folder before reserving history', async () => {
    const harness = createHarness(false);
    const read = await harness.schedule.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
    );
    expect(read.generationReadiness).toEqual({
      ready: false,
      reasons: ['Project folder required'],
    });
    await expect(generate(harness, 'XLSX')).rejects.toThrow('project folder');
    expect(harness.registry.listRevisions(harness.project.id)).toEqual([]);
  });

  it('rejects a selected Revision from another Project', async () => {
    const harness = createHarness();
    const other = structuredClone(seedProjects[1]!);
    const foreign = harness.registry.createRevision({
      projectId: other.id,
      projectSnapshot: {
        id: other.id,
        projectCode: other.projectCode,
        projectName: other.projectName,
        clientName: other.clientName,
        projectType: other.projectType,
        status: other.status,
        updatedAt: other.updatedAt,
      },
      luminaires: [],
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    await expect(
      harness.schedule.read(
        harness.project.id,
        harness.store.getWorkspace(harness.project.id),
        foreign.revisionId,
      ),
    ).rejects.toThrow('does not belong to this Project');
  });

  it.each(['XLSX', 'PDF'] as const)(
    'recovers a %s projection interruption against the same canonical identities without rerendering',
    async (format) => {
      const harness = createHarness();
      const projectionFailure = vi
        .spyOn(harness.store, 'recordCanonicalScheduleProjection')
        .mockImplementationOnce(() => {
          throw new DomainError('CONFLICT', 'Injected compatibility projection failure.', 409);
        });

      await expect(generate(harness, format)).rejects.toThrow(
        'Injected compatibility projection failure',
      );
      projectionFailure.mockRestore();
      const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
      const failedOutput = harness.registry.listOutputsForRevision(failedRevision.revisionId)[0]!;
      expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
      expect(failedOutput.lifecycleState).toBe('FINALIZED');
      expect(countRows(harness, 'project_revisions')).toBe(0);
      expect(countRows(harness, 'project_documents')).toBe(0);
      const renderedBeforeRecovery = harness.renderer.rendered;

      const recovered = await recover(harness, failedRevision.revisionId);

      expect(harness.renderer.rendered).toBe(renderedBeforeRecovery);
      expect(recovered.revision).toMatchObject({
        revisionId: failedRevision.revisionId,
        lifecycleState: 'FINALIZED',
      });
      expect(recovered.outputs).toHaveLength(1);
      expect(recovered.outputs[0]?.outputId).toBe(failedOutput.outputId);
      expect(countRows(harness, 'project_revisions')).toBe(1);
      expect(countRows(harness, 'project_documents')).toBe(1);
      expect(
        harness.registry
          .listOutputsForRevision(failedRevision.revisionId)
          .every((output) => output.outputFamily === 'LuminaireSchedule'),
      ).toBe(true);
    },
  );

  it('rolls back compatibility projection if canonical Revision finalization fails, then recovers Both atomically', async () => {
    const harness = createHarness();
    const originalSetRevisionLifecycle = harness.registry.setRevisionLifecycle.bind(
      harness.registry,
    );
    let failFinalization = true;
    const finalizationFailure = vi
      .spyOn(harness.registry, 'setRevisionLifecycle')
      .mockImplementation((revisionId, state, reason) => {
        if (state === 'FINALIZED' && failFinalization) {
          failFinalization = false;
          throw new DomainError('CONFLICT', 'Injected canonical finalization failure.', 409);
        }
        return originalSetRevisionLifecycle(revisionId, state, reason);
      });

    await expect(generate(harness, 'Both')).rejects.toThrow(
      'Injected canonical finalization failure',
    );
    finalizationFailure.mockRestore();
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const failedOutputs = harness.registry.listOutputsForRevision(failedRevision.revisionId);
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(failedOutputs).toHaveLength(2);
    expect(failedOutputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
    expect(countRows(harness, 'project_revisions')).toBe(0);
    expect(countRows(harness, 'project_documents')).toBe(0);
    const renderedBeforeRecovery = harness.renderer.rendered;

    const recovered = await recover(harness, failedRevision.revisionId, 'Both');

    expect(harness.renderer.rendered).toBe(renderedBeforeRecovery);
    expect(recovered.revision.lifecycleState).toBe('FINALIZED');
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(
      failedOutputs.map((output) => output.outputId).sort(),
    );
    expect(countRows(harness, 'project_revisions')).toBe(1);
    expect(countRows(harness, 'project_documents')).toBe(2);
  });

  it('recovers only the missing state of a partial Both attempt without duplicating the finalized artifact', async () => {
    const harness = createHarness();
    const originalSetOutputLifecycle = harness.registry.setOutputLifecycle.bind(harness.registry);
    let finalizedCount = 0;
    const outputFailure = vi
      .spyOn(harness.registry, 'setOutputLifecycle')
      .mockImplementation((outputId, state, reason) => {
        if (state === 'FINALIZED' && ++finalizedCount === 2) {
          throw new DomainError('CONFLICT', 'Injected second-format finalization failure.', 409);
        }
        return originalSetOutputLifecycle(outputId, state, reason);
      });

    await expect(generate(harness, 'Both')).rejects.toThrow(
      'Injected second-format finalization failure',
    );
    outputFailure.mockRestore();
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const failedOutputs = harness.registry.listOutputsForRevision(failedRevision.revisionId);
    const finalizedOutput = failedOutputs.find((output) => output.lifecycleState === 'FINALIZED')!;
    const incompleteOutput = failedOutputs.find(
      (output) => output.lifecycleState === 'FAILED_RECOVERABLE',
    )!;
    const finalizedPath = path.join(harness.projectRoot, finalizedOutput.locatorValue!);
    const incompletePath = path.join(harness.projectRoot, incompleteOutput.locatorValue!);
    const finalizedBytes = readFileSync(finalizedPath);
    const finalizedMtime = statSync(finalizedPath).mtimeMs;
    unlinkSync(incompletePath);
    const renderedBeforeRecovery = harness.renderer.rendered;

    const recovered = await recover(harness, failedRevision.revisionId);

    expect(harness.renderer.rendered).toBe(renderedBeforeRecovery + 1);
    expect(readFileSync(finalizedPath)).toEqual(finalizedBytes);
    expect(statSync(finalizedPath).mtimeMs).toBe(finalizedMtime);
    expect(existsSync(incompletePath)).toBe(true);
    expect(recovered.outputs).toHaveLength(2);
    expect(recovered.outputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(
      failedOutputs.map((output) => output.outputId).sort(),
    );
  });

  it('rejects cross-Project recovery before changing the failed canonical aggregate', async () => {
    const harness = createHarness();
    harness.renderer.failNext = true;
    await expect(generate(harness, 'PDF')).rejects.toThrow('Injected Schedule renderer failure');
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const foreignProject = structuredClone(seedProjects[1]!);

    await expect(
      harness.generation.generateSchedule(
        foreignProject,
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          recoveryRevisionId: failedRevision.revisionId,
          issueStatus: 'Ignored',
          issueDate: '2026-08-18',
        },
      ),
    ).rejects.toThrow("not this Project's canonical Schedule generation");
    expect(harness.registry.getRevision(failedRevision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
  });

  it('binds the cohesive read, config, and Schedule-only generation API routes', async () => {
    const harness = createHarness();
    const provider = await connectedProvider(harness.project, harness.projectRoot);
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
      canonicalGenerationService: harness.generation,
    });
    apps.push(app);
    const headers = { 'x-mock-user-id': actor.id };
    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/luminaire-schedule`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.effectiveTemplate.templateId).toBe('schedule.technical-modern');

    const config = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/luminaire-schedule/config`,
      headers,
      payload: { paperSize: 'A4' },
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().data.effectiveTemplate.paperSize).toBe('A4');

    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.outputs).toHaveLength(1);
    expect(generated.json().data.outputs[0]).toMatchObject({
      outputFamily: 'LuminaireSchedule',
      outputFormat: 'PDF',
    });

    harness.renderer.failNext = true;
    const failed = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'XLSX', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });
    expect(failed.statusCode).toBe(500);
    const failedRevision = harness.registry
      .listRevisions(harness.project.id)
      .find((revision) => revision.lifecycleState === 'FAILED_RECOVERABLE')!;
    const recovered = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/luminaire-schedule/generate`,
      headers,
      payload: {
        recoveryRevisionId: failedRevision.revisionId,
        issueStatus: 'Ignored',
        issueDate: '2026-08-18',
      },
    });
    expect(recovered.statusCode).toBe(201);
    expect(recovered.json().data.revision.revisionId).toBe(failedRevision.revisionId);
  });

  it('wires an isolated canonical Schedule authority for non-production Personal runtime', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-schedule-runtime-'));
    temporaryRoots.push(root);
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'development',
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
    const projectRoot = path.join(root, 'project');
    mkdirSync(projectRoot);
    store.setFolderPath(project.id, projectRoot);
    writeStorageMarker(projectRoot, project);
    const provider = await connectedProvider(project, projectRoot);
    const isolatedStore = new PersonalWorkspaceStore(config);
    stores.push(isolatedStore);
    expect(hasTable(store, 'canonical_revisions')).toBe(false);
    expect(hasTable(isolatedStore, 'canonical_revisions')).toBe(false);

    const app = await createApp({ config, provider, personalStore: store });
    apps.push(app);
    const headers = { 'x-mock-user-id': actor.id };
    const read = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/luminaire-schedule`,
      headers,
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/luminaire-schedule/config`,
      headers,
      payload: { paperSize: 'A4' },
    });
    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'XLSX', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });

    expect(read.statusCode).toBe(200);
    expect(updated.statusCode).toBe(200);
    expect(generated.statusCode).toBe(400);
    expect(generated.json().error.message).toContain('Add or import at least one luminaire');
    expect(hasTable(store, 'canonical_revisions')).toBe(true);
    expect(hasTable(isolatedStore, 'canonical_revisions')).toBe(false);
  });

  it('keeps the Schedule route surface bound to the explicit canonical Personal production runtime', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-schedule-production-'));
    temporaryRoots.push(root);
    const runtime = await createPersonalProductionRuntime({
      config: loadConfig({
        APP_MODE: 'standalone',
        WORKSPACE_VARIANT: 'personal',
        PERSONAL_AUTO_LOGIN: 'true',
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
        STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
        STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
        STANDALONE_ADMIN_NAME: 'Local Admin',
        STANDALONE_ADMIN_EMAIL: 'admin@local.test',
        STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
        COMPANY_TIMEZONE: 'Asia/Dubai',
      }),
    });
    try {
      mkdirSync(path.join(root, 'projects'));
      const created = await runtime.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          projectName: 'Schedule Production Runtime',
          clientName: 'Test Client',
          projectType: 'Lighting Layout',
          description: 'Production-style Schedule route validation.',
          siteLocation: 'Dubai, UAE',
          designStage: 'Concept',
          lightingScope: 'Interior lighting design.',
          luxRequirements: 'Target 500 lux.',
          drawingReference: 'A-101',
          priority: 'Normal',
          complexity: 'Medium',
          estimatedHours: 8,
          requiredDeliveryDate: TEST_FUTURE_REQUIRED_DELIVERY_DATE,
          projectFolderUrl: null,
          createFolders: true,
          projectRoot: path.join(root, 'projects'),
          idempotencyKey: '88888888-8888-4888-8888-888888888888',
        },
      });
      expect(created.statusCode).toBe(201);
      const projectId = created.json().data.project.id as string;

      const read = await runtime.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/luminaire-schedule`,
      });
      const updated = await runtime.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/luminaire-schedule/config`,
        payload: { paperSize: 'A4' },
      });
      const generated = await runtime.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/luminaire-schedule/generate`,
        payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
      });

      expect(read.statusCode).toBe(200);
      expect(updated.statusCode).toBe(200);
      expect(generated.statusCode).toBe(400);
      expect(generated.json().error.message).not.toContain('authority is unavailable');
      expect(runtime.canonicalOutputRegistry.isCanonicalAuthority()).toBe(true);
    } finally {
      await runtime.startup.shutdown();
      await runtime.app.close();
    }
  });

  it('keeps Personal-only Schedule routes outside the Teams runtime and avoids canonical DB crossover', async () => {
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'team',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    const store = new PersonalWorkspaceStore(config);
    stores.push(store);
    const app = await createApp({ config, provider: new MockDataProvider(), personalStore: store });
    apps.push(app);
    const projectId = seedProjects[0]!.id;
    const headers = { 'x-mock-user-id': actor.id };

    for (const request of [
      { method: 'GET' as const, url: `/api/projects/${projectId}/luminaire-schedule` },
      {
        method: 'PATCH' as const,
        url: `/api/projects/${projectId}/luminaire-schedule/config`,
        payload: { paperSize: 'A4' },
      },
      {
        method: 'POST' as const,
        url: `/api/projects/${projectId}/luminaire-schedule/generate`,
        payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
      },
    ]) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(404);
    }
    expect(hasTable(store, 'canonical_revisions')).toBe(false);
  });
});
