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
import { updateTechnicalBoqConfigSchema } from '@scli/contracts';
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
import { TechnicalBoqOutputService } from './infrastructure/output-registry/TechnicalBoqOutputService';
import { createPersonalProductionRuntime } from './infrastructure/startup/createPersonalProductionServer';

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];
const apps: FastifyInstance[] = [];
const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const goldenProjectId = '440bef8e-5799-4e96-87e9-5d617320b6a4';
const testProjectId = '0f4daaad-95a2-4199-b237-0920729dc82a';

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

class FakeBoqRenderer implements LightingPackageRenderer {
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
      throw new DomainError('EXPORT_FAILED', 'Injected BOQ renderer failure.', 500);
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

type FolderMode = 'connected' | 'disconnected' | 'physically-missing';

interface Harness {
  root: string;
  projectRoot: string;
  project: Project;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  renderer: FakeBoqRenderer;
  generation: CanonicalGenerationService;
  boq: TechnicalBoqOutputService;
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

function createHarness(folderMode: FolderMode = 'connected', projectId?: string): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-boq-output-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  if (folderMode !== 'physically-missing') mkdirSync(projectRoot);
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const project = { ...structuredClone(seedProjects[0]!), ...(projectId ? { id: projectId } : {}) };
  store.initializeProject(
    project.id,
    ['TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  if (folderMode !== 'disconnected') {
    store.setFolderPath(project.id, projectRoot);
    if (folderMode === 'connected') writeStorageMarker(projectRoot, project);
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
    notes: 'BOQ integration test',
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
  const renderer = new FakeBoqRenderer(root);
  const generation = new CanonicalGenerationService(store, registry, renderer);
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    renderer,
    generation,
    boq: new TechnicalBoqOutputService(store, registry),
    luminaire,
  };
}

async function generate(harness: Harness, format: ScheduleGenerationFormat) {
  return harness.generation.generateBoq(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    { format, issueStatus: 'For Review', issueDate: '2026-08-17' },
  );
}

async function recover(harness: Harness, revisionId: string, format?: ScheduleGenerationFormat) {
  return harness.generation.generateBoq(
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

describe('Technical BOQ canonical output integration delta', () => {
  it('adds one immutable approved BOQ version and supports only the narrow config/reset surface', async () => {
    const harness = createHarness();
    const legacy = harness.registry.getTemplateVersion('boq.technical-modern', 'v1');
    expect(legacy.definition.columns.map((column) => column.label)).toEqual([
      'Tag',
      'Description',
      'Manufacturer',
      'Model',
      'Location',
      'Unit',
      'Quantity',
      'Notes',
    ]);

    const initial = await harness.boq.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
    );
    expect(initial.effectiveTemplate).toMatchObject({
      templateId: 'boq.technical-approved',
      versionId: 'v2',
      family: 'TechnicalBoq',
      nonPriced: true,
    });
    expect(
      harness.registry.resolveEffectiveTemplate(harness.project.id, 'TechnicalBoq'),
    ).toMatchObject({ templateId: 'boq.technical-approved', versionId: 'v2' });
    expect(initial.effectiveTemplate.columns.map((column) => column.label)).toEqual([
      'Tag',
      'Category',
      'Description',
      'Manufacturer',
      'Model',
      'Unit',
      'Quantity',
      'Location',
      'Notes',
    ]);
    expect(initial.templates.every((item) => item.resolvedTemplate.family === 'TechnicalBoq')).toBe(
      true,
    );

    const updated = harness.boq.updateConfig(harness.project.id, {
      columns: [{ columnId: 'category', visible: false, order: 20, width: 222 }],
      paperSize: 'A4',
    });
    expect(updated.effectiveTemplate).toMatchObject({
      paperSize: 'A4',
      orientation: initial.effectiveTemplate.orientation,
      headerSettings: initial.effectiveTemplate.headerSettings,
      footerSettings: initial.effectiveTemplate.footerSettings,
    });
    expect(
      harness.registry.resolveEffectiveTemplate(harness.project.id, 'TechnicalBoq'),
    ).toMatchObject({ templateId: 'boq.technical-approved', versionId: 'v2' });
    expect(
      updated.effectiveTemplate.columns.find((column) => column.columnId === 'category'),
    ).toMatchObject({ visible: false, order: 20, width: 222 });
    const reset = harness.boq.updateConfig(harness.project.id, { reset: true });
    expect(reset.projectOverride.config).toEqual({});
    expect(reset.effectiveTemplate).toEqual(initial.effectiveTemplate);
    expect(harness.registry.getTemplateVersion('boq.technical-modern', 'v1')).toEqual(legacy);
    expect(() =>
      harness.boq.updateConfig(harness.project.id, {
        templateId: 'schedule.technical-modern',
        templateVersionId: 'v1',
      }),
    ).toThrow('TechnicalBoq template');
    expect(updateTechnicalBoqConfigSchema.safeParse({ orientation: 'Portrait' }).success).toBe(
      false,
    );
    expect(
      updateTechnicalBoqConfigSchema.safeParse({
        paperSize: 'A4',
        orientation: 'Portrait',
      }).success,
    ).toBe(false);
  });

  it('registers the approved BOQ Template Version idempotently', () => {
    const harness = createHarness();
    const first = harness.registry.registerTechnicalBoqTemplateVersion();
    const second = harness.registry.registerTechnicalBoqTemplateVersion();
    expect(second).toEqual(first);
    const count = harness.store
      .getSharedDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM output_template_versions
         WHERE template_id = 'boq.technical-approved' AND version_id = 'v1'`,
      )
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('returns current and historical rows plus BOQ-only history and truthful artifact presence', async () => {
    const harness = createHarness();
    const generated = await generate(harness, 'Both');
    unlinkSync(generated.files.pdfPath!);
    harness.store.addLuminaire(harness.project.id, {
      tag: 'WL01',
      category: 'Wall Light',
      imagePath: '',
      description: 'Added after snapshot',
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
    const read = await harness.boq.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
      generated.revision.revisionId,
    );
    expect(read.currentRows).toHaveLength(2);
    expect(read.selectedRevision?.rows).toHaveLength(1);
    expect(read.selectedRevision?.rows[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      category: 'Downlight',
      unit: 'No.',
      quantity: 12,
    });
    expect(read.outputs.every((item) => item.output.outputFamily === 'TechnicalBoq')).toBe(true);
    expect(read.outputs.find((item) => item.output.outputFormat === 'XLSX')).toMatchObject({
      artifactPresence: 'Present',
      createdByName: actor.displayName,
    });
    expect(read.outputs.find((item) => item.output.outputFormat === 'PDF')?.artifactPresence).toBe(
      'Missing',
    );
    harness.store
      .getSharedDatabase()
      .prepare('UPDATE project_workspaces SET folder_path = NULL WHERE project_id = ?')
      .run(harness.project.id);
    const unavailable = await harness.boq.read(
      harness.project.id,
      harness.store.getWorkspace(harness.project.id),
    );
    expect(unavailable.outputs.every((item) => item.artifactPresence === 'Unavailable')).toBe(true);
  });

  it.each([
    ['XLSX', ['XLSX']],
    ['PDF', ['PDF']],
    ['Both', ['PDF', 'XLSX']],
  ] as const)(
    'generates only requested %s BOQ outputs with exact snapshots',
    async (format, formats) => {
      const harness = createHarness();
      const effective = harness.boq.updateConfig(harness.project.id, {
        columns: [{ columnId: 'model', visible: false, width: 240 }],
        paperSize: 'A4',
      }).effectiveTemplate;
      const generated = await generate(harness, format);
      expect(generated.outputs.map((output) => output.outputFormat).sort()).toEqual(formats);
      expect(generated.outputs.every((output) => output.outputFamily === 'TechnicalBoq')).toBe(
        true,
      );
      expect(generated.outputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
      expect(generated.outputs.every((output) => output.contentHash?.length === 64)).toBe(true);
      expect(generated.outputs.every((output) => output.resolvedTemplateSnapshotHash)).toBe(true);
      expect(
        generated.outputs.every((output) => output.resolvedTemplateSnapshot?.paperSize === 'A4'),
      ).toBe(true);
      expect(
        generated.outputs.every(
          (output) => output.resolvedTemplateSnapshot?.family === 'TechnicalBoq',
        ),
      ).toBe(true);
      expect(generated.revision.projectSnapshot).toMatchObject({
        boqGenerationFormat: format,
        technicalOutputGenerationIntent: { family: 'TechnicalBoq', formats },
      });
      expect(generated.revision.luminaireSnapshot?.[0]).toMatchObject({
        luminaireId: harness.luminaire.id,
        category: 'Downlight',
        description: 'Trimless recessed LED downlight',
        unit: 'No.',
        quantity: 12,
      });
      expect(
        generated.outputs.every(
          (output) => JSON.stringify(output.resolvedTemplateSnapshot) === JSON.stringify(effective),
        ),
      ).toBe(true);
      expect(harness.registry.listOutputs(harness.project.id)).toHaveLength(formats.length);
      expect(countRows(harness, 'project_exports')).toBe(0);
      expect(countRows(harness, 'project_documents')).toBe(formats.length);
      const categories = harness.store
        .getSharedDatabase()
        .prepare('SELECT DISTINCT category FROM project_documents')
        .all() as { category: string }[];
      expect(categories).toEqual([{ category: 'TechnicalBoq' }]);
      const folders = harness.store.getWorkspace(harness.project.id).outputFolders;
      for (const outputFolder of [folders.scheduleExcel, folders.schedulePdf, folders.datasheets]) {
        expect(
          existsSync(
            path.join(harness.projectRoot, outputFolder, generated.revision.revisionLabel),
          ),
        ).toBe(false);
      }
      expect(
        harness.registry
          .listOutputs(harness.project.id)
          .some((output) => output.outputFamily === 'LuminaireSchedule'),
      ).toBe(false);
    },
  );

  it('keeps the generated BOQ template snapshot immutable after later config changes', async () => {
    const harness = createHarness();
    const effective = harness.boq.updateConfig(harness.project.id, {
      columns: [{ columnId: 'notes', visible: false, width: 222 }],
      paperSize: 'A4',
    }).effectiveTemplate;
    const generated = await generate(harness, 'XLSX');
    harness.boq.updateConfig(harness.project.id, {
      templateId: 'boq.classic-grid-pro',
      templateVersionId: 'v1',
      paperSize: 'A3',
    });
    expect(
      harness.registry.getOutput(generated.outputs[0]!.outputId).resolvedTemplateSnapshot,
    ).toEqual(effective);
  });

  it('rolls back the BOQ projection with canonical finalization and recovers the same identities without rerendering', async () => {
    const harness = createHarness();
    const original = harness.registry.setRevisionLifecycle.bind(harness.registry);
    let failFinalization = true;
    const failure = vi
      .spyOn(harness.registry, 'setRevisionLifecycle')
      .mockImplementation((revisionId, state, reason) => {
        if (state === 'FINALIZED' && failFinalization) {
          failFinalization = false;
          throw new DomainError('CONFLICT', 'Injected canonical finalization failure.', 409);
        }
        return original(revisionId, state, reason);
      });
    await expect(generate(harness, 'Both')).rejects.toThrow(
      'Injected canonical finalization failure',
    );
    failure.mockRestore();
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const failedOutputs = harness.registry.listOutputsForRevision(failedRevision.revisionId);
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(failedOutputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
    expect(countRows(harness, 'project_revisions')).toBe(0);
    expect(countRows(harness, 'project_documents')).toBe(0);
    const rendered = harness.renderer.rendered;
    const recovered = await recover(harness, failedRevision.revisionId, 'Both');
    expect(harness.renderer.rendered).toBe(rendered);
    expect(recovered.revision.lifecycleState).toBe('FINALIZED');
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(
      failedOutputs.map((output) => output.outputId).sort(),
    );
    expect(countRows(harness, 'project_revisions')).toBe(1);
    expect(countRows(harness, 'project_documents')).toBe(2);
  });

  it('recovers only a missing partial-Both artifact and never rewrites the finalized BOQ artifact', async () => {
    const harness = createHarness();
    const original = harness.registry.setOutputLifecycle.bind(harness.registry);
    let finalizedCount = 0;
    const failure = vi
      .spyOn(harness.registry, 'setOutputLifecycle')
      .mockImplementation((outputId, state, reason) => {
        if (state === 'FINALIZED' && ++finalizedCount === 2) {
          throw new DomainError('CONFLICT', 'Injected second-format failure.', 409);
        }
        return original(outputId, state, reason);
      });
    await expect(generate(harness, 'Both')).rejects.toThrow('Injected second-format failure');
    failure.mockRestore();
    const revision = harness.registry.listRevisions(harness.project.id)[0]!;
    const outputs = harness.registry.listOutputsForRevision(revision.revisionId);
    const finalized = outputs.find((output) => output.lifecycleState === 'FINALIZED')!;
    const incomplete = outputs.find((output) => output.lifecycleState === 'FAILED_RECOVERABLE')!;
    const finalizedPath = path.join(harness.projectRoot, finalized.locatorValue!);
    const incompletePath = path.join(harness.projectRoot, incomplete.locatorValue!);
    const bytes = readFileSync(finalizedPath);
    const mtime = statSync(finalizedPath).mtimeMs;
    unlinkSync(incompletePath);
    const rendered = harness.renderer.rendered;
    const recovered = await recover(harness, revision.revisionId);
    expect(harness.renderer.rendered).toBe(rendered + 1);
    expect(readFileSync(finalizedPath)).toEqual(bytes);
    expect(statSync(finalizedPath).mtimeMs).toBe(mtime);
    expect(existsSync(incompletePath)).toBe(true);
    expect(recovered.outputs.every((output) => output.lifecycleState === 'FINALIZED')).toBe(true);
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(
      outputs.map((output) => output.outputId).sort(),
    );
  });

  it('allocates distinct canonical BOQ Revisions during concurrent generation', async () => {
    const harness = createHarness();
    const [xlsx, pdf] = await Promise.all([generate(harness, 'XLSX'), generate(harness, 'PDF')]);
    expect([xlsx.revision.revisionSequence, pdf.revision.revisionSequence].sort()).toEqual([1, 2]);
    expect(xlsx.revision.revisionId).not.toBe(pdf.revision.revisionId);
    expect(xlsx.outputs[0]?.outputId).not.toBe(pdf.outputs[0]?.outputId);
    expect(xlsx.outputs[0]?.locatorValue).not.toBe(pdf.outputs[0]?.locatorValue);
  });

  it('rejects cross-family and format-mismatched recovery without changing either aggregate', async () => {
    const harness = createHarness();
    harness.renderer.failNext = true;
    await expect(
      harness.generation.generateSchedule(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
      ),
    ).rejects.toThrow('Injected BOQ renderer failure');
    const scheduleRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    await expect(recover(harness, scheduleRevision.revisionId)).rejects.toThrow(
      'Stored BOQ recovery format is missing or invalid',
    );
    expect(harness.registry.getRevision(scheduleRevision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );

    harness.renderer.failNext = true;
    await expect(generate(harness, 'XLSX')).rejects.toThrow('Injected BOQ renderer failure');
    const boqRevision = harness.registry
      .listRevisions(harness.project.id)
      .find((revision) => revision.revisionId !== scheduleRevision.revisionId)!;
    await expect(recover(harness, boqRevision.revisionId, 'PDF')).rejects.toThrow(
      'Recovery format does not match the stored BOQ generation attempt',
    );
    expect(harness.registry.getRevision(boqRevision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
  });

  it('fails closed for cross-project recovery, Golden no-folder, and TEST missing-root states', async () => {
    const harness = createHarness();
    harness.renderer.failNext = true;
    await expect(generate(harness, 'PDF')).rejects.toThrow('Injected BOQ renderer failure');
    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    await expect(
      harness.generation.generateBoq(
        structuredClone(seedProjects[1]!),
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          recoveryRevisionId: failedRevision.revisionId,
          issueStatus: 'Ignored',
          issueDate: '2026-08-18',
        },
      ),
    ).rejects.toThrow("not this Project's canonical BOQ generation");
    expect(harness.registry.getRevision(failedRevision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );

    const golden = createHarness('disconnected', goldenProjectId);
    const goldenRead = await golden.boq.read(
      golden.project.id,
      golden.store.getWorkspace(golden.project.id),
    );
    expect(goldenRead.generationReadiness).toEqual({
      ready: false,
      reasons: ['Project folder required'],
    });
    await expect(generate(golden, 'XLSX')).rejects.toThrow('project folder');
    expect(golden.registry.listRevisions(golden.project.id)).toEqual([]);

    const test = createHarness('physically-missing', testProjectId);
    const testRead = await test.boq.read(test.project.id, test.store.getWorkspace(test.project.id));
    expect(testRead.generationReadiness).toEqual({
      ready: false,
      reasons: ['Project folder is missing'],
    });
    await expect(generate(test, 'PDF')).rejects.toThrow('must exist');
    expect(test.registry.listRevisions(test.project.id)).toEqual([]);
  });

  it('binds Personal read/config/generate routes and keeps all BOQ routes absent from Teams', async () => {
    const harness = createHarness();
    const provider = await connectedProvider(harness.project, harness.projectRoot);
    const personal = await createApp({
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
    apps.push(personal);
    const headers = { 'x-mock-user-id': actor.id };
    const read = await personal.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/technical-boq`,
      headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.effectiveTemplate).toMatchObject({
      templateId: 'boq.technical-approved',
      versionId: 'v2',
    });
    const updated = await personal.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/technical-boq/config`,
      headers,
      payload: { paperSize: 'A4' },
    });
    expect(updated.statusCode).toBe(200);
    const forbidden = await personal.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/technical-boq/config`,
      headers,
      payload: { orientation: 'Portrait' },
    });
    expect(forbidden.statusCode).toBe(400);
    const combinedOverpost = await personal.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/technical-boq/config`,
      headers,
      payload: { paperSize: 'A3', orientation: 'Portrait' },
    });
    expect(combinedOverpost.statusCode).toBe(400);
    const generated = await personal.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/technical-boq/generate`,
      headers,
      payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.outputs[0]).toMatchObject({
      outputFamily: 'TechnicalBoq',
      outputFormat: 'PDF',
    });

    const teamConfig = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'team',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    const teamStore = new PersonalWorkspaceStore(teamConfig);
    stores.push(teamStore);
    const team = await createApp({
      config: teamConfig,
      provider: new MockDataProvider(),
      personalStore: teamStore,
    });
    apps.push(team);
    for (const request of [
      { method: 'GET' as const, url: `/api/projects/${harness.project.id}/technical-boq` },
      {
        method: 'PATCH' as const,
        url: `/api/projects/${harness.project.id}/technical-boq/config`,
        payload: { paperSize: 'A4' },
      },
      {
        method: 'POST' as const,
        url: `/api/projects/${harness.project.id}/technical-boq/generate`,
        payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
      },
    ]) {
      const response = await team.inject({ ...request, headers });
      expect(response.statusCode).toBe(404);
    }
    expect(hasTable(teamStore, 'canonical_revisions')).toBe(false);
  });

  it('keeps the BOQ route bound to the explicit canonical Personal production runtime', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-boq-production-'));
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
          projectName: 'BOQ Production Runtime',
          clientName: 'Test Client',
          projectType: 'Lighting Layout',
          description: 'Production-style BOQ route validation.',
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
          idempotencyKey: '77777777-7777-4777-8777-777777777777',
        },
      });
      expect(created.statusCode).toBe(201);
      const projectId = created.json().data.project.id as string;
      const read = await runtime.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/technical-boq`,
      });
      const updated = await runtime.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}/technical-boq/config`,
        payload: { paperSize: 'A4' },
      });
      const generated = await runtime.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/technical-boq/generate`,
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
});
