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
import { CanonicalArtifactReconciler } from './infrastructure/output-registry/CanonicalArtifactReconciler';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import {
  canonicalPackageManifestSchema,
  CanonicalIssuePackageService,
} from './infrastructure/output-registry/CanonicalIssuePackageService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import {
  outputTemporaryPath,
  packageStagingPath,
  resolveCanonicalArtifactPath,
  revisionRenderTemporaryPath,
  sha256File,
} from './infrastructure/output-registry/canonical-artifact-files';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V14_DDL,
  applyV12IssueAuditColumns,
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

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

class FakeLightingRenderer implements LightingPackageRenderer {
  public failNext = false;
  public renderedRevisions: string[] = [];
  public renderedInputModes: string[] = [];
  public afterRender: (() => Promise<void>) | null = null;

  public constructor(private readonly scratchRoot: string) {}

  public async render(
    _project: Project,
    _workspace: Parameters<LightingPackageRenderer['render']>[1],
    input: LightingExportInput,
  ): Promise<TemporaryLightingRenderResult> {
    this.renderedRevisions.push(input.revision);
    this.renderedInputModes.push(_workspace.lightingPackage.inputMode);
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
    await this.afterRender?.();
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
  readonly renderer: FakeLightingRenderer;
  readonly generation: CanonicalGenerationService;
  readonly packages: CanonicalIssuePackageService;
  readonly luminaire: LuminaireRecord;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p2-fnd-05-'));
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
    quantity: 12,
    notes: 'Canonical snapshot test',
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
  const renderer = new FakeLightingRenderer(root);
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    renderer,
    generation: new CanonicalGenerationService(store, registry, renderer),
    packages: new CanonicalIssuePackageService(
      store,
      registry,
      () => new Date('2026-08-10T10:00:00.000Z'),
    ),
    luminaire,
  };
}

function countRows(harness: Harness, table: string): number {
  const row = harness.store
    .getSharedDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return Number(row.count);
}

function canonicalSnapshot(harness: Harness) {
  return {
    projectId: harness.project.id,
    projectSnapshot: {
      id: harness.project.id,
      projectCode: harness.project.projectCode,
      projectName: harness.project.projectName,
      clientName: harness.project.clientName,
      projectType: harness.project.projectType,
      status: harness.project.status,
      updatedAt: harness.project.updatedAt,
      canonicalOperation: 'GENERATED_OUTPUTS',
    },
    luminaires: [
      {
        luminaireId: harness.luminaire.id,
        tag: harness.luminaire.tag,
        category: harness.luminaire.category,
        imagePath: harness.luminaire.imagePath,
        description: harness.luminaire.description,
        manufacturer: harness.luminaire.manufacturer,
        model: harness.luminaire.model,
        wattage: harness.luminaire.wattage,
        lumens: harness.luminaire.lumens,
        lightColor: harness.luminaire.lightColor,
        cri: harness.luminaire.cri,
        beamAngle: harness.luminaire.beamAngle,
        ipRating: harness.luminaire.ipRating,
        mounting: harness.luminaire.mounting,
        cutout: harness.luminaire.cutout,
        driver: harness.luminaire.driver,
        control: harness.luminaire.control,
        emergency: harness.luminaire.emergency,
        datasheetPath: harness.luminaire.datasheetPath,
        location: harness.luminaire.location,
        unit: harness.luminaire.unit,
        quantity: harness.luminaire.quantity,
        notes: harness.luminaire.notes,
        sourceName: harness.luminaire.sourceName,
        dimensions: harness.luminaire.dimensions,
        bodyColorFinish: harness.luminaire.bodyColorFinish,
        attachmentReferences: [harness.luminaire.imagePath, harness.luminaire.datasheetPath],
      },
    ],
    createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
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

describe('P2-FND-05 canonical generation authority and atomicity', () => {
  it('reserves one server-sequenced Revision, finalizes four hashed Outputs, and derives legacy reads', async () => {
    const harness = createHarness();
    const generated = await generate(harness);

    expect(generated.revision).toMatchObject({
      revisionSequence: 1,
      revisionLabel: 'REV_01',
      lifecycleState: 'FINALIZED',
    });
    expect(harness.renderer.renderedRevisions).toEqual(['01']);
    expect(new Set(generated.outputs.map((output) => output.revisionId))).toEqual(
      new Set([generated.revision.revisionId]),
    );
    expect(generated.outputs).toHaveLength(4);
    for (const output of generated.outputs) {
      expect(output).toMatchObject({
        lifecycleState: 'FINALIZED',
        locatorKind: 'PROJECT_RELATIVE',
        templateProvenance: 'RESOLVED',
      });
      expect(output.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(output.resolvedTemplateSnapshot).not.toBeNull();
      const artifact = resolveCanonicalArtifactPath(harness.projectRoot, output.locatorValue!);
      expect(existsSync(artifact)).toBe(true);
      expect(await sha256File(artifact)).toBe(output.contentHash);
    }
    expect(generated.revision.luminaireSnapshot?.[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      tag: 'DL01',
      quantity: 12,
    });
    expect(generated.record.id).toBe(generated.revision.revisionId);
    expect(generated.record.revision).toBe(1);
    expect(countRows(harness, 'canonical_revisions')).toBe(1);
    expect(countRows(harness, 'project_revisions')).toBe(1);
    expect(countRows(harness, 'project_exports')).toBe(1);
    expect(countRows(harness, 'project_documents')).toBe(4);
    const compatibility = harness.store
      .getSharedDatabase()
      .prepare('SELECT id, revision FROM project_exports')
      .get() as { id: string; revision: number };
    expect(compatibility).toEqual({ id: generated.revision.revisionId, revision: 1 });
  });

  it('marks a renderer failure recoverable and an explicit retry preserves Revision and Output UUIDs', async () => {
    const harness = createHarness();
    harness.renderer.failNext = true;
    await expect(generate(harness)).rejects.toThrow('Injected renderer failure');

    const failedRevision = harness.registry.listRevisions(harness.project.id)[0]!;
    const failedOutputs = harness.registry.listOutputsForRevision(failedRevision.revisionId);
    const outputIds = failedOutputs.map((output) => output.outputId).sort();
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(failedOutputs).toHaveLength(4);
    expect(failedOutputs.every((output) => output.lifecycleState === 'FAILED_RECOVERABLE')).toBe(
      true,
    );
    expect(countRows(harness, 'project_exports')).toBe(0);

    const historicalWorkspace = harness.store.getWorkspace(harness.project.id);
    const recovered = await harness.generation.generate(
      harness.project,
      {
        ...historicalWorkspace,
        outputFolders: {
          ...historicalWorkspace.outputFolders,
          datasheets: 'CHANGED_AFTER_FAILURE',
        },
        lightingPackage: {
          ...historicalWorkspace.lightingPackage,
          inputMode: 'AutoCadCsv',
        },
      },
      actor,
      {
        ...exportInput,
        revision: '777',
        recoveryRevisionId: failedRevision.revisionId,
      },
    );
    expect(recovered.revision.revisionId).toBe(failedRevision.revisionId);
    expect(recovered.outputs.map((output) => output.outputId).sort()).toEqual(outputIds);
    expect(recovered.revision.lifecycleState).toBe('FINALIZED');
    expect(harness.renderer.renderedRevisions).toEqual(['01', '01']);
    expect(harness.renderer.renderedInputModes).toEqual([
      historicalWorkspace.lightingPackage.inputMode,
      historicalWorkspace.lightingPackage.inputMode,
    ]);
    expect(recovered.result.datasheetFolder).toBe(
      path.join(
        harness.projectRoot,
        historicalWorkspace.outputFolders.datasheets,
        failedRevision.revisionLabel,
      ),
    );
    expect(countRows(harness, 'canonical_revisions')).toBe(1);
    expect(countRows(harness, 'canonical_outputs')).toBe(4);
    expect(countRows(harness, 'project_exports')).toBe(1);
  });

  it('recovers a register-only Revision with its reserved UUID and server-owned sequence', () => {
    const harness = createHarness();
    const revisionInput = {
      revisionNumber: 999,
      reissueNumber: 0,
      title: 'Manual design register',
      status: 'Draft' as const,
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: 'Reserved before an injected process interruption.',
      changeLog: '',
      sourceType: 'Manual' as const,
      sourceReference: '',
    };
    const snapshot = canonicalSnapshot(harness);
    const interrupted = harness.registry.createRevision({
      ...snapshot,
      projectSnapshot: {
        ...snapshot.projectSnapshot,
        canonicalOperation: 'REGISTER_ONLY',
        canonicalRevisionInput: revisionInput,
      },
    });
    harness.registry.setRevisionLifecycle(
      interrupted.revisionId,
      'FAILED_RECOVERABLE',
      'Injected register projection interruption.',
    );

    const recovered = harness.generation.createRegisterOnlyRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      { ...revisionInput, recoveryRevisionId: interrupted.revisionId },
    );
    expect(recovered).toMatchObject({
      id: interrupted.revisionId,
      revisionNumber: 1,
      title: revisionInput.title,
    });
    expect(harness.registry.getRevision(interrupted.revisionId).lifecycleState).toBe('FINALIZED');
    expect(countRows(harness, 'canonical_revisions')).toBe(1);
    expect(countRows(harness, 'project_revisions')).toBe(1);
  });

  it('preserves partial success and blocks an unrelated final-path collision without overwriting it', async () => {
    const harness = createHarness();
    let collisionPath = '';
    harness.renderer.afterRender = async () => {
      const output = harness.registry
        .listOutputs(harness.project.id)
        .find(
          (candidate) =>
            candidate.outputFamily === 'TechnicalBoq' && candidate.outputFormat === 'PDF',
        )!;
      collisionPath = resolveCanonicalArtifactPath(harness.projectRoot, output.locatorValue!);
      mkdirSync(path.dirname(collisionPath), { recursive: true });
      writeFileSync(collisionPath, 'unrelated-existing-file');
    };

    await expect(generate(harness)).rejects.toThrow('do not match the persisted SHA-256 hash');
    const revision = harness.registry.listRevisions(harness.project.id)[0]!;
    const outputs = harness.registry.listOutputsForRevision(revision.revisionId);
    expect(revision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(outputs.filter((output) => output.lifecycleState === 'FINALIZED')).toHaveLength(3);
    const failed = outputs.find((output) => output.lifecycleState === 'FAILED_RECOVERABLE')!;
    expect(failed.outputFamily).toBe('TechnicalBoq');
    expect(failed.outputFormat).toBe('PDF');
    expect(readFileSync(collisionPath, 'utf8')).toBe('unrelated-existing-file');
    expect(existsSync(outputTemporaryPath(collisionPath, failed.outputId))).toBe(true);

    await expect(
      generate(harness, { ...exportInput, recoveryRevisionId: revision.revisionId }),
    ).rejects.toThrow('occupied ambiguously');
    expect(countRows(harness, 'canonical_revisions')).toBe(1);
    expect(countRows(harness, 'canonical_outputs')).toBe(4);
    expect(readFileSync(collisionPath, 'utf8')).toBe('unrelated-existing-file');
  });

  it('reconciles exact PREPARING evidence conservatively and is idempotent across restart passes', async () => {
    const harness = createHarness();
    const revision = harness.registry.createRevision(canonicalSnapshot(harness));
    const rendererScratch = revisionRenderTemporaryPath(harness.projectRoot, revision.revisionId);
    mkdirSync(rendererScratch);
    const schedule = harness.registry.resolveEffectiveTemplate(
      harness.project.id,
      'LuminaireSchedule',
    );
    const boq = harness.registry.resolveEffectiveTemplate(harness.project.id, 'TechnicalBoq');
    const definitions = [
      ['LuminaireSchedule', 'XLSX', 'RECOVERY/REV_01/schedule.xlsx', schedule],
      ['LuminaireSchedule', 'PDF', 'RECOVERY/REV_01/schedule.pdf', schedule],
      ['TechnicalBoq', 'XLSX', 'RECOVERY/REV_01/boq.xlsx', boq],
      ['TechnicalBoq', 'PDF', 'RECOVERY/REV_01/boq.pdf', boq],
    ] as const;
    const outputs = definitions.map(([outputFamily, outputFormat, relativePath, template]) =>
      harness.registry.createOutput({
        revisionId: revision.revisionId,
        outputFamily,
        outputFormat,
        relativePath,
        contentHash: null,
        resolvedTemplate: template,
      }),
    );
    const recoveredFinalPath = resolveCanonicalArtifactPath(
      harness.projectRoot,
      outputs[0]!.locatorValue!,
    );
    mkdirSync(path.dirname(recoveredFinalPath), { recursive: true });
    writeFileSync(recoveredFinalPath, 'complete-final-bytes');
    harness.registry.setOutputContentHash(
      outputs[0]!.outputId,
      await sha256File(recoveredFinalPath),
    );

    const tempOnlyFinalPath = resolveCanonicalArtifactPath(
      harness.projectRoot,
      outputs[1]!.locatorValue!,
    );
    mkdirSync(path.dirname(tempOnlyFinalPath), { recursive: true });
    const ownedTemporaryPath = outputTemporaryPath(tempOnlyFinalPath, outputs[1]!.outputId);
    writeFileSync(ownedTemporaryPath, 'owned-temporary-bytes');

    harness.registry.setOutputContentHash(outputs[3]!.outputId, 'a'.repeat(64));
    harness.registry.setOutputLifecycle(outputs[3]!.outputId, 'FINALIZED');
    const reconciler = new CanonicalArtifactReconciler(harness.registry, (projectId) =>
      harness.store.getProjectFolderPath(projectId),
    );
    const first = await reconciler.reconcile();
    expect(first).toMatchObject({ finalizedOutputs: 1, failedOutputs: 2, failedRevisions: 1 });
    expect(first.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'TEMP_ARTIFACT_REMAINS',
        'FINAL_ARTIFACT_MISSING',
        'RECOVERY_ATTENTION',
      ]),
    );
    expect(first.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'REVISION',
          entityId: revision.revisionId,
          code: 'TEMP_ARTIFACT_REMAINS',
        }),
      ]),
    );
    expect(harness.registry.getOutput(outputs[0]!.outputId).lifecycleState).toBe('FINALIZED');
    expect(harness.registry.getOutput(outputs[1]!.outputId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(harness.registry.getOutput(outputs[2]!.outputId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(harness.registry.getOutput(outputs[3]!.outputId).lifecycleState).toBe('FINALIZED');
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(existsSync(ownedTemporaryPath)).toBe(true);
    expect(existsSync(rendererScratch)).toBe(true);
    const identitiesBefore = {
      revisions: harness.registry.listRevisions().map((item) => item.revisionId),
      outputs: harness.registry.listOutputs().map((item) => item.outputId),
    };

    const second = await reconciler.reconcile();
    expect(second).toMatchObject({
      finalizedOutputs: 0,
      failedOutputs: 0,
      finalizedRevisions: 0,
      failedRevisions: 0,
    });
    expect({
      revisions: harness.registry.listRevisions().map((item) => item.revisionId),
      outputs: harness.registry.listOutputs().map((item) => item.outputId),
    }).toEqual(identitiesBefore);
    expect(existsSync(ownedTemporaryPath)).toBe(true);
    expect(existsSync(rendererScratch)).toBe(true);
    expect(second.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['TEMP_ARTIFACT_REMAINS', 'FINAL_ARTIFACT_MISSING']),
    );
  });
});

describe('P2-FND-05 revision-scoped canonical Issue Packages', () => {
  it('builds package artifacts and a canonical UUID manifest before finalization and preserves reissues', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const first = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: 999,
        reissueNumber: 77,
        label: 'REV_01 Draft',
        status: 'Draft',
        outputMode: 'Both',
        relativeOutputFolder: 'ISSUED/REV_01_PACKAGE',
        selectedItemIds,
        warningOverrideReason: '',
      },
      [],
    );
    const canonicalFirst = harness.registry.getIssuePackage(first.id);
    expect(canonicalFirst).toMatchObject({
      revisionId: generated.revision.revisionId,
      packageSequence: 1,
      lifecycleState: 'FINALIZED',
    });
    expect(first).toMatchObject({ revisionNumber: 1, reissueNumber: 0, itemCount: 4 });
    expect(existsSync(first.folderPath)).toBe(true);
    expect(existsSync(first.zipPath)).toBe(true);
    const manifest = canonicalPackageManifestSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(
            harness.projectRoot,
            harness.registry.getIssuePackage(first.id).manifestLocatorValue!,
          ),
          'utf8',
        ),
      ),
    );
    expect(manifest).toMatchObject({
      packageId: first.id,
      projectId: harness.project.id,
      revisionId: generated.revision.revisionId,
      revisionSequence: 1,
      packageSequence: 1,
    });
    expect(manifest.outputs.map((output) => output.outputId)).toEqual(selectedItemIds);
    expect(manifest.outputs.every((output) => /^[a-f0-9]{64}$/.test(output.contentHash))).toBe(
      true,
    );
    expect(manifest.luminaires[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      tag: 'DL01',
    });
    expect(harness.registry.listPackageOutputs(first.id).map((item) => item.outputId)).toEqual(
      selectedItemIds,
    );
    expect(existsSync(packageStagingPath(first.folderPath, first.id))).toBe(false);

    const second = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: 42,
        reissueNumber: 42,
        label: 'REV_01 Reissue',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/REV_01_REISSUE_01',
        selectedItemIds,
        warningOverrideReason: '',
      },
      [],
    );
    expect(second).toMatchObject({ revisionNumber: 1, reissueNumber: 1 });
    expect(harness.registry.getIssuePackage(second.id).packageSequence).toBe(2);
    expect(countRows(harness, 'canonical_issue_packages')).toBe(2);
    expect(countRows(harness, 'revision_packages')).toBe(2);
  });

  it('blocks mixed-Revision and unfinalized Output selections before any final package artifact', async () => {
    const harness = createHarness();
    const first = await generate(harness);
    const second = await generate(harness);
    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          revisionNumber: 1,
          reissueNumber: 0,
          label: 'Mixed',
          status: 'Draft',
          outputMode: 'Folder',
          relativeOutputFolder: 'ISSUED/MIXED',
          selectedItemIds: [first.outputs[0]!.outputId, second.outputs[0]!.outputId],
          warningOverrideReason: '',
        },
        [],
      ),
    ).rejects.toThrow('cannot mix Deliverables');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(0);
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'MIXED'))).toBe(false);

    harness.store
      .getSharedDatabase()
      .prepare(
        `UPDATE canonical_outputs
         SET lifecycle_state = 'PREPARING', finalized_at = NULL
         WHERE output_id = ?`,
      )
      .run(first.outputs[0]!.outputId);
    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          revisionNumber: 1,
          reissueNumber: 0,
          label: 'Unfinalized',
          status: 'Draft',
          outputMode: 'Folder',
          relativeOutputFolder: 'ISSUED/UNFINALIZED',
          selectedItemIds: [first.outputs[0]!.outputId],
          warningOverrideReason: '',
        },
        [],
      ),
    ).rejects.toThrow('only finalized');
    expect(harness.registry.listIssuePackages()[0]?.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'UNFINALIZED'))).toBe(false);
  });

  it('fails closed on a missing source and explicitly retries the same Package UUID', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const missing = generated.outputs[0]!;
    const sourcePath = resolveCanonicalArtifactPath(harness.projectRoot, missing.locatorValue!);
    const heldPath = `${sourcePath}.held-by-test`;
    renameSync(sourcePath, heldPath);
    const request = {
      revisionNumber: 1,
      reissueNumber: 0,
      label: 'Missing source',
      status: 'Draft' as const,
      outputMode: 'Folder' as const,
      relativeOutputFolder: 'ISSUED/MISSING_SOURCE',
      selectedItemIds: generated.outputs.map((output) => output.outputId),
      warningOverrideReason: '',
    };

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        request,
        [],
      ),
    ).rejects.toThrow('missing or is not a regular file');
    const failedPackage = harness.registry.listIssuePackages()[0]!;
    expect(failedPackage.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'MISSING_SOURCE'))).toBe(false);

    renameSync(heldPath, sourcePath);
    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      { ...request, recoveryPackageId: failedPackage.packageId },
      [],
    );
    expect(recovered.id).toBe(failedPackage.packageId);
    expect(harness.registry.getIssuePackage(recovered.id).lifecycleState).toBe('FINALIZED');
    expect(countRows(harness, 'canonical_issue_packages')).toBe(1);
    expect(countRows(harness, 'revision_packages')).toBe(1);
  });

  it('fails closed when finalized source bytes no longer match the stored SHA-256', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const tampered = generated.outputs[0]!;
    writeFileSync(
      resolveCanonicalArtifactPath(harness.projectRoot, tampered.locatorValue!),
      'tampered-bytes',
    );

    await expect(
      harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          revisionNumber: 1,
          reissueNumber: 0,
          label: 'Tampered source',
          status: 'Draft',
          outputMode: 'Folder',
          relativeOutputFolder: 'ISSUED/TAMPERED_SOURCE',
          selectedItemIds: generated.outputs.map((output) => output.outputId),
          warningOverrideReason: '',
        },
        [],
      ),
    ).rejects.toThrow('SHA-256 integrity');
    expect(harness.registry.listIssuePackages()[0]?.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(existsSync(path.join(harness.projectRoot, 'ISSUED', 'TAMPERED_SOURCE'))).toBe(false);
  });

  it('reconciles final package evidence and leaves an exact owned staging folder recoverable', async () => {
    const harness = createHarness();
    const generated = await generate(harness);
    const selectedItemIds = generated.outputs.map((output) => output.outputId);
    const createFolderPackage = async (label: string, relativeOutputFolder: string) =>
      await harness.packages.create(
        harness.project,
        harness.store.getWorkspace(harness.project.id),
        actor,
        {
          revisionNumber: 999,
          reissueNumber: 99,
          label,
          status: 'Draft',
          outputMode: 'Folder',
          relativeOutputFolder,
          selectedItemIds,
          warningOverrideReason: '',
        },
        [],
      );
    const tempInterrupted = await createFolderPackage('Temp interrupted', 'ISSUED/TEMP_CRASH');
    const finalInterrupted = await createFolderPackage('Final interrupted', 'ISSUED/FINAL_CRASH');
    const database = harness.store.getSharedDatabase();
    database
      .prepare(
        `UPDATE canonical_issue_packages
         SET lifecycle_state = 'PREPARING', finalized_at = NULL
         WHERE package_id IN (?, ?)`,
      )
      .run(tempInterrupted.id, finalInterrupted.id);
    database.prepare('DELETE FROM revision_packages WHERE id = ?').run(finalInterrupted.id);
    const staging = packageStagingPath(tempInterrupted.folderPath, tempInterrupted.id);
    renameSync(tempInterrupted.folderPath, staging);

    const reconciler = new CanonicalArtifactReconciler(harness.registry, (projectId) =>
      harness.store.getProjectFolderPath(projectId),
    );
    const first = await reconciler.reconcile();
    expect(first).toMatchObject({ finalizedPackages: 0, failedPackages: 2 });
    expect(harness.registry.getIssuePackage(finalInterrupted.id).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(harness.registry.getIssuePackage(tempInterrupted.id).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(existsSync(staging)).toBe(true);
    expect(first.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: tempInterrupted.id,
          code: 'TEMP_ARTIFACT_REMAINS',
        }),
      ]),
    );

    const recovered = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: 999,
        reissueNumber: 99,
        label: 'Final interrupted',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/FINAL_CRASH',
        selectedItemIds,
        warningOverrideReason: '',
        recoveryPackageId: finalInterrupted.id,
      },
      [],
    );
    expect(recovered.id).toBe(finalInterrupted.id);
    expect(harness.registry.getIssuePackage(finalInterrupted.id).lifecycleState).toBe('FINALIZED');

    const second = await reconciler.reconcile();
    expect(second).toMatchObject({ finalizedPackages: 0, failedPackages: 0 });
    expect(countRows(harness, 'canonical_issue_packages')).toBe(2);
    expect(existsSync(staging)).toBe(true);
  });
});

describe('P2-FND-05 immutable template and Luminaire identity history', () => {
  it('keeps the stored template snapshot and Luminaire UUID while preserving each exact historical Tag', async () => {
    const harness = createHarness();
    const first = await generate(harness);
    const firstSchedule = first.outputs.find(
      (output) => output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'PDF',
    )!;
    const storedTemplate = structuredClone(firstSchedule.resolvedTemplateSnapshot);
    expect(storedTemplate?.templateId).toBe('schedule.technical-modern');
    const firstPackage = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: 1,
        reissueNumber: 0,
        label: 'Before Tag rename',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/BEFORE_TAG_RENAME',
        selectedItemIds: [firstSchedule.outputId],
        warningOverrideReason: '',
      },
      [],
    );

    harness.registry.setGlobalDefault({
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.full-technical',
      versionId: 'v1',
      config: { rowDensity: 'Compact' },
    });
    harness.registry.setTemplateState('schedule.technical-modern', 'inactive');
    harness.store.updateLuminaire(harness.project.id, harness.luminaire.id, {
      ...harness.luminaire,
      tag: 'DL-A',
    });
    const second = await generate(harness);
    const secondSchedule = second.outputs.find(
      (output) => output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'PDF',
    )!;
    const secondPackage = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: 2,
        reissueNumber: 0,
        label: 'After Tag rename',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/AFTER_TAG_RENAME',
        selectedItemIds: [secondSchedule.outputId],
        warningOverrideReason: '',
      },
      [],
    );

    expect(harness.registry.getOutput(firstSchedule.outputId).resolvedTemplateSnapshot).toEqual(
      storedTemplate,
    );
    expect(
      second.outputs.find((output) => output.outputFamily === 'LuminaireSchedule')
        ?.resolvedTemplateSnapshot,
    ).toMatchObject({ templateId: 'schedule.classic-grid-pro.full-technical' });
    expect(first.revision.luminaireSnapshot?.[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      tag: 'DL01',
    });
    expect(second.revision.luminaireSnapshot?.[0]).toMatchObject({
      luminaireId: harness.luminaire.id,
      tag: 'DL-A',
    });
    expect(first.revision.revisionSequence).toBe(1);
    expect(second.revision.revisionSequence).toBe(2);
    expect(
      harness.store.compareRevisionPackages(harness.project.id, firstPackage.id, secondPackage.id),
    ).toMatchObject({
      added: 0,
      removed: 0,
      changed: 1,
      items: [expect.objectContaining({ tag: 'DL-A', status: 'Changed' })],
    });
  });
});
