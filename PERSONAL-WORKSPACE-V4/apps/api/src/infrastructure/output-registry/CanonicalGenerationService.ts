import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  projectOutputFoldersSchema,
  projectRevisionSchema,
  type CanonicalProjectSnapshotInput,
  type GenerateTechnicalBoqInput,
  type GenerateTechnicalScheduleInput,
  type ProjectRevisionInput,
  updateLightingPackageSchema,
} from '@scli/contracts';
import {
  DomainError,
  type AppUser,
  type CanonicalLuminaireSnapshot,
  type CanonicalOutputRecord,
  type CanonicalRevisionRecord,
  type LuminaireRecord,
  type OutputColumn,
  type OutputFamily,
  type Project,
  type ProjectExportRecord,
  type ProjectRevision,
  type ProjectWorkspace,
  type ResolvedOutputTemplate,
  type ScheduleGenerationFormat,
  type TechnicalBoqGenerationResult,
  type TechnicalScheduleGenerationResult,
} from '@scli/domain';
import type {
  LightingExportInput,
  LightingExportResult,
  LightingPackageRenderer,
  TemporaryLightingRenderResult,
} from '../../luminaire-export-service.js';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import {
  CanonicalOutputRegistryStore,
  normalizeCanonicalProjectRelativePath,
} from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  boundedArtifactFailure,
  copyArtifactExclusive,
  ensureArtifactParent,
  moveArtifactNoReplace,
  outputTemporaryPath,
  resolveCanonicalArtifactPath,
  sha256File,
} from './canonical-artifact-files.js';
import {
  discardCanonicalOutputReservation,
  finalizeProvenCanonicalOutputReservation,
  isUnprovenOutputReservationLifecycle,
  proveCanonicalOutputReservation,
} from './canonical-composition-reservations.js';
import {
  assertTargetFormatSlotsFree,
  requireCompositionTarget,
} from './canonical-composition-targets.js';

interface OutputPlan {
  readonly outputFamily: Exclude<OutputFamily, 'PresentationSchedule' | 'DatasheetRegister'>;
  readonly outputFormat: 'XLSX' | 'PDF';
  readonly relativePath: string;
  readonly source: keyof Pick<
    TemporaryLightingRenderResult,
    'scheduleExcelPath' | 'schedulePdfPath' | 'boqExcelPath' | 'boqPdfPath'
  >;
  readonly resolvedTemplate: ResolvedOutputTemplate;
}

interface TechnicalOutputGenerationSpec {
  readonly family: 'LuminaireSchedule' | 'TechnicalBoq';
  readonly label: 'Luminaire Schedule' | 'Technical BOQ';
  readonly shortLabel: 'Schedule' | 'BOQ';
  readonly snapshotFormatKey: 'scheduleGenerationFormat' | 'boqGenerationFormat';
  readonly requirePhysicalProjectRoot: boolean;
}

const scheduleGenerationSpec: TechnicalOutputGenerationSpec = {
  family: 'LuminaireSchedule',
  label: 'Luminaire Schedule',
  shortLabel: 'Schedule',
  snapshotFormatKey: 'scheduleGenerationFormat',
  requirePhysicalProjectRoot: false,
};

const boqGenerationSpec: TechnicalOutputGenerationSpec = {
  family: 'TechnicalBoq',
  label: 'Technical BOQ',
  shortLabel: 'BOQ',
  snapshotFormatKey: 'boqGenerationFormat',
  requirePhysicalProjectRoot: true,
};

export interface CanonicalGenerationResult {
  readonly result: LightingExportResult;
  readonly record: ProjectExportRecord;
  readonly revision: CanonicalRevisionRecord;
  readonly outputs: CanonicalOutputRecord[];
}

function canonicalFileStem(value: string): string {
  const decomposed = value.normalize('NFKD').replaceAll(/[\u0300-\u036f]/g, '');
  const printable = [...decomposed]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? '_' : character;
    })
    .join('');
  const collapsed = printable
    .replaceAll(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replaceAll(/\s+/g, '_')
    .replaceAll(/_+/g, '_');
  const safe = collapsed.replace(/^[ ._]+|[ ._]+$/g, '').slice(0, 120) || 'SCLI_PROJECT';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `SCLI_${safe}` : safe;
}

function relativeArtifact(...parts: string[]): string {
  return normalizeCanonicalProjectRelativePath(
    path.posix.join(...parts.map((part) => part.replaceAll('\\', '/'))),
  );
}

function luminaireSnapshot(luminaire: LuminaireRecord): CanonicalLuminaireSnapshot {
  return {
    luminaireId: luminaire.id,
    tag: luminaire.tag,
    category: luminaire.category,
    imagePath: luminaire.imagePath,
    description: luminaire.description,
    manufacturer: luminaire.manufacturer,
    model: luminaire.model,
    productType: luminaire.productType ?? '',
    variantLabel: luminaire.variantLabel ?? '',
    orderingCode: luminaire.orderingCode ?? '',
    wattage: luminaire.wattage,
    lumens: luminaire.lumens,
    lightColor: luminaire.lightColor,
    cri: luminaire.cri,
    beamAngle: luminaire.beamAngle,
    ipRating: luminaire.ipRating,
    mounting: luminaire.mounting,
    cutout: luminaire.cutout,
    driver: luminaire.driver,
    control: luminaire.control,
    emergency: luminaire.emergency,
    datasheetPath: luminaire.datasheetPath,
    location: luminaire.location,
    unit: luminaire.unit,
    quantity: luminaire.quantity,
    notes: luminaire.notes,
    sourceName: luminaire.sourceName,
    dimensions: luminaire.dimensions,
    bodyColorFinish: luminaire.bodyColorFinish,
    attachmentReferences: [
      ...new Set([luminaire.imagePath, luminaire.datasheetPath].filter(Boolean)),
    ],
  };
}

function projectSnapshot(
  project: Project,
  workspace: ProjectWorkspace,
  operation: 'GENERATED_OUTPUTS' | 'REGISTER_ONLY',
  input?: LightingExportInput,
): CanonicalProjectSnapshotInput {
  return {
    id: project.id,
    projectCode: project.projectCode,
    projectName: project.projectName,
    clientName: project.clientName,
    projectType: project.projectType,
    status: project.status,
    updatedAt: project.updatedAt,
    siteLocation: project.siteLocation,
    designStage: project.designStage,
    description: project.description,
    canonicalOperation: operation,
    folderProfile: workspace.folderProfile,
    generationIssueStatus: input?.issueStatus ?? '',
    generationIssueDate: input?.issueDate ?? '',
    lightingPackage: structuredClone(workspace.lightingPackage),
    outputFolders: structuredClone(workspace.outputFolders),
  };
}

function outputColumns(template: ResolvedOutputTemplate): OutputColumn[] {
  return [...template.columns]
    .sort((left, right) => left.order - right.order)
    .map((column) => ({
      fieldKey: column.fieldKey,
      header: column.label,
      visible: column.visible,
      sortOrder: column.order,
      width: column.width,
      compareInRevision: true,
      requiredForIssue: false,
      internalOnly: false,
    }));
}

function storedText(
  snapshot: Record<string, unknown> | null,
  key: string,
  fallback: string,
): string {
  const value = snapshot?.[key];
  return typeof value === 'string' ? value : fallback;
}

export class CanonicalGenerationService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly renderer: LightingPackageRenderer,
  ) {}

  public async generate(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: LightingExportInput,
  ): Promise<CanonicalGenerationResult> {
    if (input.recoveryRevisionId) {
      return this.retry(project, workspace, input.recoveryRevisionId, input);
    }
    this.assertGenerationReady(workspace);
    const resolvedSchedule = this.registry.resolveEffectiveTemplate(
      project.id,
      'LuminaireSchedule',
    );
    const resolvedBoq = this.registry.resolveEffectiveTemplate(project.id, 'TechnicalBoq');
    const revision = this.registry.createRevision({
      projectId: project.id,
      projectSnapshot: projectSnapshot(project, workspace, 'GENERATED_OUTPUTS', input),
      luminaires: workspace.luminaires.map(luminaireSnapshot),
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const plans = this.outputPlans(project, workspace, revision, resolvedSchedule, resolvedBoq);
    let outputs: CanonicalOutputRecord[] = [];
    try {
      outputs = this.registry.createOutputs(
        plans.map((plan) => ({
          revisionId: revision.revisionId,
          outputFamily: plan.outputFamily,
          outputFormat: plan.outputFormat,
          relativePath: plan.relativePath,
          contentHash: null,
          resolvedTemplate: plan.resolvedTemplate,
        })),
      );
      // Initial generation must derive renderer inputs from the same reserved canonical
      // source of truth that retry uses. After reservation the renderer never consults
      // mutable current Project/Luminaire/template state for these Outputs.
      const canonicalProject = this.projectForRevision(project, revision);
      const canonicalWorkspace = this.workspaceForRevision(workspace, revision, outputs);
      return await this.execute(
        canonicalProject,
        canonicalWorkspace,
        revision,
        outputs,
        plans,
        input,
        false,
      );
    } catch (error) {
      const reason = boundedArtifactFailure(error, 'Canonical generation failed.');
      this.markGenerationFailed(revision.revisionId, reason);
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          revisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        'The lighting package could not be generated safely. The reserved Revision is recoverable.',
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  public async generateSchedule(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: GenerateTechnicalScheduleInput,
  ): Promise<TechnicalScheduleGenerationResult> {
    return this.generateTechnicalOutput(project, workspace, actor, input, scheduleGenerationSpec);
  }

  public async generateBoq(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: GenerateTechnicalBoqInput,
  ): Promise<TechnicalBoqGenerationResult> {
    return this.generateTechnicalOutput(project, workspace, actor, input, boqGenerationSpec);
  }

  private async generateTechnicalOutput(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: GenerateTechnicalScheduleInput | GenerateTechnicalBoqInput,
    spec: TechnicalOutputGenerationSpec,
  ): Promise<TechnicalScheduleGenerationResult> {
    if (input.recoveryRevisionId) {
      return this.retryTechnicalOutput(project, workspace, input.recoveryRevisionId, input, spec);
    }
    if (!input.format) {
      throw new DomainError('VALIDATION_ERROR', `${spec.label} format is required.`, 400);
    }
    if (input.targetRevisionId) {
      return this.generateTechnicalOutputIntoTarget(
        project,
        workspace,
        input,
        input.targetRevisionId,
        input.format,
        spec,
      );
    }
    await this.assertTechnicalOutputGenerationReady(workspace, spec);
    const resolvedTemplate =
      spec.family === 'LuminaireSchedule'
        ? this.registry.resolveEffectiveTechnicalScheduleTemplate(project.id)
        : this.registry.resolveEffectiveTechnicalBoqTemplate(project.id);
    const renderInput: LightingExportInput = {
      revision: '00',
      issueStatus: input.issueStatus,
      issueDate: input.issueDate,
    };
    const revision = this.registry.createRevision({
      projectId: project.id,
      projectSnapshot: {
        ...projectSnapshot(project, workspace, 'GENERATED_OUTPUTS', renderInput),
        [spec.snapshotFormatKey]: input.format,
        technicalOutputGenerationIntent: {
          family: spec.family,
          formats: input.format === 'Both' ? ['PDF', 'XLSX'] : [input.format],
        },
      },
      luminaires: workspace.luminaires.map(luminaireSnapshot),
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    const plans = this.technicalOutputPlans(
      project,
      workspace,
      revision,
      resolvedTemplate,
      input.format,
      spec,
    );
    try {
      const outputs = this.registry.createOutputs(
        plans.map((plan) => ({
          revisionId: revision.revisionId,
          outputFamily: plan.outputFamily,
          outputFormat: plan.outputFormat,
          relativePath: plan.relativePath,
          contentHash: null,
          resolvedTemplate: plan.resolvedTemplate,
        })),
      );
      const canonicalProject = this.projectForRevision(project, revision);
      const canonicalWorkspace = this.workspaceForRevision(workspace, revision, outputs);
      const finalized = await this.renderAndFinalizeOutputs(
        canonicalProject,
        canonicalWorkspace,
        revision,
        outputs,
        plans,
        renderInput,
        false,
      );
      try {
        const finalizedRevision = this.finalizeTechnicalOutputRevision(
          revision,
          finalized.outputs,
          input.issueStatus,
          input.issueDate,
          spec,
        );
        const byFormat = new Map(
          finalized.outputs.map((output) => [
            output.outputFormat,
            resolveCanonicalArtifactPath(workspace.folderPath!, output.locatorValue!),
          ]),
        );
        return {
          revision: finalizedRevision,
          outputs: finalized.outputs,
          files: {
            xlsxPath: byFormat.get('XLSX') ?? null,
            pdfPath: byFormat.get('PDF') ?? null,
          },
        };
      } finally {
        await this.cleanupRender(finalized.render);
      }
    } catch (error) {
      const reason = boundedArtifactFailure(
        error,
        `Canonical ${spec.shortLabel} generation failed.`,
      );
      this.markGenerationFailed(revision.revisionId, reason);
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          revisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        `The ${spec.label} could not be generated safely. The reserved Revision is recoverable.`,
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  /**
   * C1 — TARGETED generation into an existing composed Revision.
   *
   * This path reserves, renders, hash-proves, and FINALIZES canonical Outputs
   * against a Revision that already exists. It deliberately does NOT:
   *
   *  - create a Revision (the target is loaded and re-verified, never trusted),
   *  - finalize the target Revision (composition stays the Owner's decision),
   *  - run the legacy compatibility projection (that belongs to the standalone
   *    generated-output lifecycle, and a composed draft is not yet issued), or
   *  - mark the parent Revision FAILED_RECOVERABLE on failure (§10 / C0 R3).
   *
   * Everything from reservation onwards is shared verbatim with the standalone
   * path so the two can never drift in how an artifact is proven.
   */
  private async generateTechnicalOutputIntoTarget(
    project: Project,
    workspace: ProjectWorkspace,
    input: GenerateTechnicalScheduleInput | GenerateTechnicalBoqInput,
    targetRevisionId: string,
    format: ScheduleGenerationFormat,
    spec: TechnicalOutputGenerationSpec,
  ): Promise<TechnicalScheduleGenerationResult> {
    await this.assertTechnicalOutputGenerationReady(workspace, spec);
    // Client selection is NOT authority: eligibility is re-derived from persisted
    // registry state on EVERY call, and an ineligible target is rejected rather
    // than silently downgraded to a standalone generation.
    const revision = requireCompositionTarget(this.registry, project.id, targetRevisionId);
    // The duplicate policy runs BEFORE template resolution and rendering so a
    // conflicting request never resolves a Template or touches the filesystem.
    assertTargetFormatSlotsFree(this.registry, revision, spec.family, spec.label, format);
    if (!revision.luminaireSnapshot?.length) {
      throw new DomainError(
        'CONFLICT',
        `${revision.revisionLabel} captured no luminaires, so a ${spec.label} cannot be generated into it.`,
        409,
      );
    }
    const resolvedTemplate =
      spec.family === 'LuminaireSchedule'
        ? this.registry.resolveEffectiveTechnicalScheduleTemplate(project.id)
        : this.registry.resolveEffectiveTechnicalBoqTemplate(project.id);
    const renderInput: LightingExportInput = {
      revision: String(revision.revisionSequence).padStart(2, '0'),
      issueStatus: storedText(revision.projectSnapshot, 'generationIssueStatus', input.issueStatus),
      issueDate: storedText(revision.projectSnapshot, 'generationIssueDate', input.issueDate),
    };
    const plans = this.technicalOutputPlans(
      project,
      workspace,
      revision,
      resolvedTemplate,
      format,
      spec,
    );
    let reserved: CanonicalOutputRecord[] = [];
    try {
      reserved = this.registry.createOutputs(
        plans.map((plan) => ({
          revisionId: revision.revisionId,
          outputFamily: plan.outputFamily,
          outputFormat: plan.outputFormat,
          relativePath: plan.relativePath,
          contentHash: null,
          resolvedTemplate: plan.resolvedTemplate,
        })),
      );
      const canonicalProject = this.projectForRevision(project, revision);
      const canonicalWorkspace = this.workspaceForRevision(workspace, revision, reserved);
      const finalized = await this.renderAndFinalizeOutputs(
        canonicalProject,
        canonicalWorkspace,
        revision,
        reserved,
        plans,
        renderInput,
        false,
      );
      try {
        // Only the Outputs THIS request produced are reported: a composed
        // Revision may already carry unrelated finalized Outputs.
        const producedIds = new Set(reserved.map((output) => output.outputId));
        return this.technicalOutputGenerationResult(
          workspace.folderPath!,
          this.registry.getRevision(revision.revisionId),
          finalized.outputs.filter((output) => producedIds.has(output.outputId)),
        );
      } finally {
        await this.cleanupRender(finalized.render);
      }
    } catch (error) {
      await this.disposeTargetedOutputReservations(workspace, reserved);
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          targetRevisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        `The ${spec.label} could not be generated safely into ${revision.revisionLabel}. The Revision is unchanged and still Preparing.`,
        500,
        { targetRevisionId: revision.revisionId },
      );
    }
  }

  /**
   * C0 R3 disposal for a FAILED targeted generation.
   *
   * The parent Revision is NEVER failed and pre-existing Outputs are never
   * touched — only the reservations this request created are resolved:
   *
   *  - already FINALIZED, or hash-provable   -> preserved / finalized,
   *  - unproven                              -> discarded through the C0
   *                                             proof-guarded authority.
   *
   * Disposal failure never masks the original generation failure.
   */
  private async disposeTargetedOutputReservations(
    workspace: ProjectWorkspace,
    reserved: readonly CanonicalOutputRecord[],
  ): Promise<void> {
    for (const created of reserved) {
      try {
        const output = this.registry.getOutput(created.outputId);
        if (output.lifecycleState === 'FINALIZED') continue;
        if (!isUnprovenOutputReservationLifecycle(output.lifecycleState)) continue;
        const proof = await proveCanonicalOutputReservation(workspace.folderPath, output);
        if (proof.kind === 'PROVEN_FINAL') {
          finalizeProvenCanonicalOutputReservation(this.registry, output);
          continue;
        }
        if (proof.kind === 'UNPROVEN') {
          await discardCanonicalOutputReservation(this.registry, output, proof);
          continue;
        }
        // UNPROVABLE: neither proof nor safe disposal is possible. The single
        // Output is marked recoverable so it stays visible; the parent Revision
        // is still never failed.
        if (output.lifecycleState === 'PREPARING') {
          this.registry.setOutputLifecycle(
            output.outputId,
            'FAILED_RECOVERABLE',
            'Targeted generation could not prove or dispose of this reservation.',
          );
        }
      } catch {
        // Preserve the primary failure. Reconciliation re-inspects persisted state.
      }
    }
  }

  private async retryTechnicalOutput(
    project: Project,
    workspace: ProjectWorkspace,
    revisionId: string,
    input: GenerateTechnicalScheduleInput | GenerateTechnicalBoqInput,
    spec: TechnicalOutputGenerationSpec,
  ): Promise<TechnicalScheduleGenerationResult> {
    await this.assertTechnicalOutputGenerationReady(workspace, spec);
    let revision = this.registry.getRevision(revisionId);
    if (
      revision.projectId !== project.id ||
      revision.provenanceClassification !== 'CANONICAL' ||
      revision.projectSnapshot?.canonicalOperation !== 'GENERATED_OUTPUTS'
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Recovery Revision is not this Project's canonical ${spec.shortLabel} generation.`,
        400,
      );
    }
    if (revision.lifecycleState !== 'FAILED_RECOVERABLE') {
      throw new DomainError(
        'CONFLICT',
        `Only a failed recoverable ${spec.shortLabel} Revision can be retried.`,
        409,
      );
    }
    const storedFormat = this.storedTechnicalOutputGenerationFormat(revision, spec);
    if (input.format && input.format !== storedFormat) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Recovery format does not match the stored ${spec.shortLabel} generation attempt.`,
        400,
      );
    }
    let outputs = this.registry.listOutputsForRevision(revision.revisionId);
    const plans = this.technicalOutputRecoveryPlans(revision, outputs, storedFormat, spec);
    const recoveryInput: LightingExportInput = {
      revision: String(revision.revisionSequence).padStart(2, '0'),
      issueStatus: storedText(revision.projectSnapshot, 'generationIssueStatus', input.issueStatus),
      issueDate: storedText(revision.projectSnapshot, 'generationIssueDate', input.issueDate),
    };
    try {
      revision = this.registry.setRevisionLifecycle(revision.revisionId, 'PREPARING');
      for (const output of outputs) {
        if (output.lifecycleState === 'FAILED_RECOVERABLE') {
          this.registry.setOutputLifecycle(output.outputId, 'PREPARING');
        }
      }
      await this.finalizeMatchingTechnicalOutputArtifacts(workspace.folderPath!, outputs, spec);
      outputs = this.registry.listOutputsForRevision(revision.revisionId);
      if (outputs.every((output) => output.lifecycleState === 'FINALIZED')) {
        await this.assertFinalizedTechnicalOutputArtifactIntegrity(
          workspace.folderPath!,
          outputs,
          spec,
        );
        const finalizedRevision = this.finalizeTechnicalOutputRevision(
          revision,
          outputs,
          recoveryInput.issueStatus,
          recoveryInput.issueDate,
          spec,
        );
        return this.technicalOutputGenerationResult(
          workspace.folderPath!,
          finalizedRevision,
          outputs,
        );
      }

      const recoveryProject = this.projectForRevision(project, revision);
      const recoveryWorkspace = this.workspaceForRevision(workspace, revision, outputs);
      const finalized = await this.renderAndFinalizeOutputs(
        recoveryProject,
        recoveryWorkspace,
        revision,
        outputs,
        plans,
        recoveryInput,
        true,
      );
      try {
        const finalizedRevision = this.finalizeTechnicalOutputRevision(
          revision,
          finalized.outputs,
          recoveryInput.issueStatus,
          recoveryInput.issueDate,
          spec,
        );
        return this.technicalOutputGenerationResult(
          workspace.folderPath!,
          finalizedRevision,
          finalized.outputs,
        );
      } finally {
        await this.cleanupRender(finalized.render);
      }
    } catch (error) {
      const reason = boundedArtifactFailure(error, `Canonical ${spec.shortLabel} recovery failed.`);
      this.markGenerationFailed(revision.revisionId, reason);
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          revisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        `The recoverable ${spec.label} could not be finalized safely.`,
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  public createRegisterOnlyRevision(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: ProjectRevisionInput,
  ): ProjectRevision {
    if (input.recoveryRevisionId) {
      return this.retryRegisterOnlyRevision(project, input.recoveryRevisionId);
    }
    const { recoveryRevisionId: _recoveryRevisionId, ...projectionInput } = input;
    void _recoveryRevisionId;
    const revision = this.registry.createRevision({
      projectId: project.id,
      projectSnapshot: {
        ...projectSnapshot(project, workspace, 'REGISTER_ONLY'),
        canonicalRevisionInput: structuredClone(projectionInput),
      },
      luminaires: workspace.luminaires.map(luminaireSnapshot),
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    try {
      const projection = this.personalStore.recordCanonicalRevisionProjection(revision, {
        ...projectionInput,
        revisionNumber: revision.revisionSequence,
      });
      this.registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
      return projection;
    } catch (error) {
      this.markGenerationFailed(
        revision.revisionId,
        boundedArtifactFailure(error, 'Revision register projection failed.'),
      );
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          revisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        'The Revision register could not be finalized safely. Its canonical identity is recoverable.',
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  private retryRegisterOnlyRevision(project: Project, revisionId: string): ProjectRevision {
    let revision = this.registry.getRevision(revisionId);
    if (
      revision.projectId !== project.id ||
      revision.provenanceClassification !== 'CANONICAL' ||
      revision.projectSnapshot?.canonicalOperation !== 'REGISTER_ONLY'
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        "Recovery Revision is not this Project's canonical register-only operation.",
        400,
      );
    }
    if (
      revision.lifecycleState !== 'FAILED_RECOVERABLE' ||
      this.registry.listOutputsForRevision(revision.revisionId).length !== 0
    ) {
      throw new DomainError(
        'CONFLICT',
        'Only a failed register-only canonical Revision can be retried explicitly.',
        409,
      );
    }
    const storedInput = (() => {
      try {
        return projectRevisionSchema.parse(revision.projectSnapshot!.canonicalRevisionInput);
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Stored register-only Revision recovery input is invalid.',
          409,
        );
      }
    })();
    const { recoveryRevisionId: _recoveryRevisionId, ...projectionInput } = storedInput;
    void _recoveryRevisionId;
    try {
      revision = this.registry.setRevisionLifecycle(revision.revisionId, 'PREPARING');
      const projection = this.personalStore.recordCanonicalRevisionProjection(revision, {
        ...projectionInput,
        revisionNumber: revision.revisionSequence,
      });
      this.registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
      return projection;
    } catch (error) {
      this.markGenerationFailed(
        revision.revisionId,
        boundedArtifactFailure(error, 'Revision register recovery failed.'),
      );
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          revisionId: revision.revisionId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        'The recoverable Revision register could not be finalized safely.',
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  public async retry(
    project: Project,
    workspace: ProjectWorkspace,
    revisionId: string,
    input: LightingExportInput,
  ): Promise<CanonicalGenerationResult> {
    this.assertGenerationReady(workspace);
    let revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id || revision.provenanceClassification !== 'CANONICAL') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Recovery Revision does not belong to this Project.',
        400,
      );
    }
    if (revision.lifecycleState !== 'FAILED_RECOVERABLE') {
      throw new DomainError(
        'CONFLICT',
        'Only a recoverable canonical Revision can be retried explicitly.',
        409,
      );
    }
    const outputs = this.registry.listOutputsForRevision(revision.revisionId);
    if (outputs.length !== 4 || outputs.some((output) => !output.resolvedTemplateSnapshot)) {
      throw new DomainError(
        'CONFLICT',
        'The recoverable Revision does not have its complete reserved Output identity set.',
        409,
      );
    }
    const plans = outputs.map((output): OutputPlan => {
      const source = this.rendererSource(output);
      return {
        outputFamily: output.outputFamily as Exclude<
          OutputFamily,
          'PresentationSchedule' | 'DatasheetRegister'
        >,
        outputFormat: output.outputFormat as 'XLSX' | 'PDF',
        relativePath: output.locatorValue!,
        source,
        resolvedTemplate: output.resolvedTemplateSnapshot!,
      };
    });
    try {
      revision = this.registry.setRevisionLifecycle(revision.revisionId, 'PREPARING');
      for (const output of outputs) {
        if (output.lifecycleState === 'FAILED_RECOVERABLE') {
          this.registry.setOutputLifecycle(output.outputId, 'PREPARING');
        }
      }
      const retryProject = this.projectForRevision(project, revision);
      const retryWorkspace = this.workspaceForRevision(workspace, revision, outputs);
      const retryInput: LightingExportInput = {
        revision: String(revision.revisionSequence).padStart(2, '0'),
        issueStatus: storedText(
          revision.projectSnapshot,
          'generationIssueStatus',
          input.issueStatus,
        ),
        issueDate: storedText(revision.projectSnapshot, 'generationIssueDate', input.issueDate),
      };
      return await this.execute(
        retryProject,
        retryWorkspace,
        revision,
        this.registry.listOutputsForRevision(revision.revisionId),
        plans,
        retryInput,
        true,
      );
    } catch (error) {
      const reason = boundedArtifactFailure(error, 'Canonical generation recovery failed.');
      this.markGenerationFailed(revision.revisionId, reason);
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'EXPORT_FAILED',
        'The recoverable Revision could not be finalized safely.',
        500,
        { revisionId: revision.revisionId },
      );
    }
  }

  private async execute(
    project: Project,
    workspace: ProjectWorkspace,
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    plans: OutputPlan[],
    input: LightingExportInput,
    recovering: boolean,
  ): Promise<CanonicalGenerationResult> {
    const finalized = await this.renderAndFinalizeOutputs(
      project,
      workspace,
      revision,
      outputs,
      plans,
      input,
      recovering,
    );
    try {
      const datasheetRelativePath = relativeArtifact(
        workspace.outputFolders.datasheets,
        revision.revisionLabel,
      );
      const datasheetFolder = await this.materializeDatasheets(
        finalized.render,
        resolveCanonicalArtifactPath(workspace.folderPath!, datasheetRelativePath),
        revision.revisionId,
      );
      const record = this.personalStore.recordCanonicalExportProjection(
        revision,
        finalized.outputs,
        datasheetFolder,
        input.issueStatus,
        input.issueDate,
      );
      const finalizedRevision = this.registry.setRevisionLifecycle(
        revision.revisionId,
        'FINALIZED',
      );
      const byFamily = new Map(
        finalized.outputs.map((output) => [
          `${output.outputFamily}:${output.outputFormat}`,
          resolveCanonicalArtifactPath(workspace.folderPath!, output.locatorValue!),
        ]),
      );
      const scheduleExcelPath = byFamily.get('LuminaireSchedule:XLSX')!;
      const schedulePdfPath = byFamily.get('LuminaireSchedule:PDF')!;
      const boqExcelPath = byFamily.get('TechnicalBoq:XLSX')!;
      const boqPdfPath = byFamily.get('TechnicalBoq:PDF')!;
      return {
        result: {
          excelPath: scheduleExcelPath,
          pdfPath: schedulePdfPath,
          scheduleExcelPath,
          schedulePdfPath,
          boqExcelPath,
          boqPdfPath,
          datasheetFolder,
          datasheetCount: finalized.render.datasheetCount,
          outputFolder: workspace.folderPath!,
        },
        record,
        revision: finalizedRevision,
        outputs: finalized.outputs,
      };
    } finally {
      await this.cleanupRender(finalized.render);
    }
  }

  private async renderAndFinalizeOutputs(
    project: Project,
    workspace: ProjectWorkspace,
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    plans: OutputPlan[],
    input: LightingExportInput,
    recovering: boolean,
  ): Promise<{ render: TemporaryLightingRenderResult; outputs: CanonicalOutputRecord[] }> {
    const projectRoot = workspace.folderPath!;
    const outputByKey = new Map(
      outputs.map((output) => [`${output.outputFamily}:${output.outputFormat}`, output] as const),
    );
    for (const output of outputs) {
      if (!output.locatorValue) {
        throw new DomainError('CONFLICT', 'Output locator is missing.', 409);
      }
      const finalPath = resolveCanonicalArtifactPath(projectRoot, output.locatorValue);
      if (
        output.lifecycleState !== 'FINALIZED' &&
        (await artifactPathKind(finalPath)) !== 'MISSING'
      ) {
        if (!output.contentHash || (await artifactPathKind(finalPath)) !== 'FILE') {
          throw new DomainError('CONFLICT', 'A final Output path is occupied ambiguously.', 409);
        }
        if ((await sha256File(finalPath)) !== output.contentHash) {
          throw new DomainError('CONFLICT', 'A final Output path contains unrelated bytes.', 409);
        }
      }
    }

    const { recoveryRevisionId: _recoveryRevisionId, ...renderInput } = input;
    void _recoveryRevisionId;
    const render = await this.renderer.render(
      project,
      workspace,
      {
        ...renderInput,
        revision: String(revision.revisionSequence).padStart(2, '0'),
      },
      {
        operationId: revision.revisionId,
        recovery: recovering,
      },
    );
    try {
      for (const plan of plans) {
        let output = outputByKey.get(`${plan.outputFamily}:${plan.outputFormat}`);
        if (!output) throw new DomainError('CONFLICT', 'Reserved Output plan is incomplete.', 409);
        const finalPath = resolveCanonicalArtifactPath(projectRoot, output.locatorValue!);
        if (output.lifecycleState === 'FINALIZED') {
          if (!output.contentHash || (await sha256File(finalPath)) !== output.contentHash) {
            throw new DomainError(
              'CONFLICT',
              'A finalized Output failed integrity validation.',
              409,
            );
          }
          continue;
        }
        if (
          output.contentHash &&
          (await artifactPathKind(finalPath)) === 'FILE' &&
          (await sha256File(finalPath)) === output.contentHash
        ) {
          this.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
          continue;
        }
        const temporaryPath = outputTemporaryPath(finalPath, output.outputId);
        const temporaryKind = await artifactPathKind(temporaryPath);
        if (temporaryKind !== 'MISSING') {
          if (temporaryKind !== 'FILE') {
            throw new DomainError('CONFLICT', 'Owned Output recovery path is not a file.', 409);
          }
          const temporaryHash = await sha256File(temporaryPath);
          if (output.contentHash && temporaryHash === output.contentHash) {
            await ensureArtifactParent(finalPath);
            await moveArtifactNoReplace(temporaryPath, finalPath);
          } else {
            await rm(temporaryPath, { force: true });
            this.registry.setOutputContentHash(output.outputId, null);
            await copyArtifactExclusive(render[plan.source], temporaryPath);
          }
        } else {
          await copyArtifactExclusive(render[plan.source], temporaryPath);
        }
        if ((await artifactPathKind(finalPath)) === 'MISSING') {
          const hash = await sha256File(temporaryPath);
          output = this.registry.setOutputContentHash(output.outputId, hash);
          await moveArtifactNoReplace(temporaryPath, finalPath);
        }
        const finalHash = await sha256File(finalPath);
        if (finalHash !== output.contentHash) {
          throw new DomainError(
            'CONFLICT',
            'Final Output bytes do not match the persisted SHA-256 hash.',
            409,
          );
        }
        this.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
      }
      return {
        render,
        outputs: this.registry.listOutputsForRevision(revision.revisionId),
      };
    } catch (error) {
      await this.cleanupRender(render);
      throw error;
    }
  }

  private async cleanupRender(render: TemporaryLightingRenderResult): Promise<void> {
    try {
      await render.cleanup();
    } catch {
      // Scratch cleanup must not turn already-finalized registry/file state into a false failure.
    }
  }

  private storedTechnicalOutputGenerationFormat(
    revision: CanonicalRevisionRecord,
    spec: TechnicalOutputGenerationSpec,
  ): ScheduleGenerationFormat {
    const format = revision.projectSnapshot?.[spec.snapshotFormatKey];
    if (format === 'XLSX' || format === 'PDF' || format === 'Both') return format;
    throw new DomainError(
      'CONFLICT',
      `Stored ${spec.shortLabel} recovery format is missing or invalid.`,
      409,
    );
  }

  private technicalOutputRecoveryPlans(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    format: ScheduleGenerationFormat,
    spec: TechnicalOutputGenerationSpec,
  ): OutputPlan[] {
    const expectedFormats = format === 'Both' ? ['PDF', 'XLSX'] : [format];
    const storedIntent = revision.projectSnapshot?.technicalOutputGenerationIntent;
    if (
      (storedIntent !== undefined || spec.family === 'TechnicalBoq') &&
      (typeof storedIntent !== 'object' ||
        storedIntent === null ||
        Array.isArray(storedIntent) ||
        (storedIntent as Record<string, unknown>).family !== spec.family ||
        JSON.stringify((storedIntent as Record<string, unknown>).formats) !==
          JSON.stringify(expectedFormats))
    ) {
      throw new DomainError(
        'CONFLICT',
        `Recoverable ${spec.shortLabel} Revision generation intent is incomplete or contradictory.`,
        409,
      );
    }
    const actualFormats = [...new Set(outputs.map((output) => output.outputFormat))].sort();
    if (
      outputs.length !== expectedFormats.length ||
      actualFormats.length !== expectedFormats.length ||
      actualFormats.some((actual, index) => actual !== expectedFormats[index])
    ) {
      throw new DomainError(
        'CONFLICT',
        `Recoverable ${spec.shortLabel} Revision does not contain its exact expected format set.`,
        409,
      );
    }
    return outputs.map((output): OutputPlan => {
      if (
        output.projectId !== revision.projectId ||
        output.revisionId !== revision.revisionId ||
        output.outputFamily !== spec.family ||
        output.provenanceClassification !== 'CANONICAL' ||
        output.locatorKind !== 'PROJECT_RELATIVE' ||
        !output.locatorValue ||
        !output.resolvedTemplateSnapshot ||
        output.resolvedTemplateSnapshot.family !== spec.family ||
        (output.lifecycleState !== 'FINALIZED' && output.lifecycleState !== 'FAILED_RECOVERABLE')
      ) {
        throw new DomainError(
          'CONFLICT',
          `Recoverable ${spec.shortLabel} Output evidence is incomplete or contradictory.`,
          409,
        );
      }
      if (output.lifecycleState === 'FINALIZED' && !output.contentHash) {
        throw new DomainError(
          'CONFLICT',
          `Finalized ${spec.shortLabel} Output is missing its persisted content hash.`,
          409,
        );
      }
      return {
        outputFamily: spec.family,
        outputFormat: output.outputFormat as 'XLSX' | 'PDF',
        relativePath: output.locatorValue,
        source: this.rendererSource(output),
        resolvedTemplate: output.resolvedTemplateSnapshot,
      };
    });
  }

  private async finalizeMatchingTechnicalOutputArtifacts(
    projectRoot: string,
    outputs: CanonicalOutputRecord[],
    spec: TechnicalOutputGenerationSpec,
  ): Promise<void> {
    for (const output of outputs) {
      if (output.lifecycleState !== 'FAILED_RECOVERABLE' || !output.contentHash) continue;
      const artifact = resolveCanonicalArtifactPath(projectRoot, output.locatorValue!);
      const kind = await artifactPathKind(artifact);
      if (kind === 'MISSING') continue;
      if (kind !== 'FILE' || (await sha256File(artifact)) !== output.contentHash) {
        throw new DomainError(
          'CONFLICT',
          `Recoverable ${spec.shortLabel} artifact evidence contradicts its persisted identity.`,
          409,
        );
      }
      this.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    }
  }

  private async assertFinalizedTechnicalOutputArtifactIntegrity(
    projectRoot: string,
    outputs: CanonicalOutputRecord[],
    spec: TechnicalOutputGenerationSpec,
  ): Promise<void> {
    for (const output of outputs) {
      if (!output.contentHash || !output.locatorValue) {
        throw new DomainError(
          'CONFLICT',
          `Finalized ${spec.shortLabel} Output evidence is incomplete.`,
          409,
        );
      }
      const artifact = resolveCanonicalArtifactPath(projectRoot, output.locatorValue);
      if (
        (await artifactPathKind(artifact)) !== 'FILE' ||
        (await sha256File(artifact)) !== output.contentHash
      ) {
        throw new DomainError(
          'CONFLICT',
          `Finalized ${spec.shortLabel} artifact failed persisted identity validation.`,
          409,
        );
      }
    }
  }

  private finalizeTechnicalOutputRevision(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    issueStatus: string,
    issueDate: string,
    spec: TechnicalOutputGenerationSpec,
  ): CanonicalRevisionRecord {
    return this.registry.finalizeRevisionWithCompatibilityProjection(revision.revisionId, () => {
      if (spec.family === 'LuminaireSchedule') {
        return this.personalStore.recordCanonicalScheduleProjection(
          revision,
          outputs,
          issueStatus,
          issueDate,
        );
      }
      return this.personalStore.recordCanonicalBoqProjection(
        revision,
        outputs,
        issueStatus,
        issueDate,
      );
    }).revision;
  }

  private technicalOutputGenerationResult(
    projectRoot: string,
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
  ): TechnicalScheduleGenerationResult {
    const byFormat = new Map(
      outputs.map((output) => [
        output.outputFormat,
        resolveCanonicalArtifactPath(projectRoot, output.locatorValue!),
      ]),
    );
    return {
      revision,
      outputs,
      files: {
        xlsxPath: byFormat.get('XLSX') ?? null,
        pdfPath: byFormat.get('PDF') ?? null,
      },
    };
  }

  private technicalOutputPlans(
    project: Project,
    workspace: ProjectWorkspace,
    revision: CanonicalRevisionRecord,
    template: ResolvedOutputTemplate,
    format: ScheduleGenerationFormat,
    spec: TechnicalOutputGenerationSpec,
  ): OutputPlan[] {
    const stem = canonicalFileStem(project.projectName);
    const isSchedule = spec.family === 'LuminaireSchedule';
    const plans: OutputPlan[] = [
      {
        outputFamily: spec.family,
        outputFormat: 'XLSX',
        relativePath: relativeArtifact(
          isSchedule ? workspace.outputFolders.scheduleExcel : workspace.outputFolders.boqExcel,
          revision.revisionLabel,
          `${stem}_${isSchedule ? 'Luminaire_Schedule' : 'Technical_BOQ'}.xlsx`,
        ),
        source: isSchedule ? 'scheduleExcelPath' : 'boqExcelPath',
        resolvedTemplate: template,
      },
      {
        outputFamily: spec.family,
        outputFormat: 'PDF',
        relativePath: relativeArtifact(
          isSchedule ? workspace.outputFolders.schedulePdf : workspace.outputFolders.boqPdf,
          revision.revisionLabel,
          `${stem}_${isSchedule ? 'Luminaire_Schedule' : 'Technical_BOQ'}.pdf`,
        ),
        source: isSchedule ? 'schedulePdfPath' : 'boqPdfPath',
        resolvedTemplate: template,
      },
    ];
    return format === 'Both' ? plans : plans.filter((plan) => plan.outputFormat === format);
  }

  private outputPlans(
    project: Project,
    workspace: ProjectWorkspace,
    revision: CanonicalRevisionRecord,
    schedule: ResolvedOutputTemplate,
    boq: ResolvedOutputTemplate,
  ): OutputPlan[] {
    const stem = canonicalFileStem(project.projectName);
    return [
      {
        outputFamily: 'LuminaireSchedule',
        outputFormat: 'XLSX',
        relativePath: relativeArtifact(
          workspace.outputFolders.scheduleExcel,
          revision.revisionLabel,
          `${stem}_Luminaire_Schedule.xlsx`,
        ),
        source: 'scheduleExcelPath',
        resolvedTemplate: schedule,
      },
      {
        outputFamily: 'LuminaireSchedule',
        outputFormat: 'PDF',
        relativePath: relativeArtifact(
          workspace.outputFolders.schedulePdf,
          revision.revisionLabel,
          `${stem}_Luminaire_Schedule.pdf`,
        ),
        source: 'schedulePdfPath',
        resolvedTemplate: schedule,
      },
      {
        outputFamily: 'TechnicalBoq',
        outputFormat: 'XLSX',
        relativePath: relativeArtifact(
          workspace.outputFolders.boqExcel,
          revision.revisionLabel,
          `${stem}_Technical_BOQ.xlsx`,
        ),
        source: 'boqExcelPath',
        resolvedTemplate: boq,
      },
      {
        outputFamily: 'TechnicalBoq',
        outputFormat: 'PDF',
        relativePath: relativeArtifact(
          workspace.outputFolders.boqPdf,
          revision.revisionLabel,
          `${stem}_Technical_BOQ.pdf`,
        ),
        source: 'boqPdfPath',
        resolvedTemplate: boq,
      },
    ];
  }

  private async materializeDatasheets(
    render: TemporaryLightingRenderResult,
    finalFolder: string,
    revisionId: string,
  ): Promise<string> {
    const sourceEntries = (await readdir(render.datasheetFolder, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .sort((left, right) => left.name.localeCompare(right.name));
    const finalKind = await artifactPathKind(finalFolder);
    if (finalKind === 'DIRECTORY') {
      const finalEntries = (await readdir(finalFolder, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .sort((left, right) => left.name.localeCompare(right.name));
      if (
        sourceEntries.length === finalEntries.length &&
        sourceEntries.every((entry, index) => entry.name === finalEntries[index]?.name)
      ) {
        for (const entry of sourceEntries) {
          if (
            (await sha256File(path.join(render.datasheetFolder, entry.name))) !==
            (await sha256File(path.join(finalFolder, entry.name)))
          ) {
            throw new DomainError('CONFLICT', 'Final Datasheet bytes are ambiguous.', 409);
          }
        }
        return finalFolder;
      }
      throw new DomainError('CONFLICT', 'The final Datasheet folder is already occupied.', 409);
    }
    if (finalKind !== 'MISSING') {
      throw new DomainError('CONFLICT', 'The final Datasheet locator is not a folder.', 409);
    }
    const temporaryFolder = path.join(
      path.dirname(finalFolder),
      `.scli-datasheets-${revisionId}.tmp`,
    );
    const temporaryKind = await artifactPathKind(temporaryFolder);
    if (temporaryKind !== 'MISSING') {
      if (temporaryKind !== 'DIRECTORY') {
        throw new DomainError('CONFLICT', 'Owned Datasheet recovery path is invalid.', 409);
      }
      await rm(temporaryFolder, { recursive: true, force: true });
    }
    await mkdir(path.dirname(finalFolder), { recursive: true });
    await mkdir(temporaryFolder);
    for (const entry of sourceEntries) {
      await copyFile(
        path.join(render.datasheetFolder, entry.name),
        path.join(temporaryFolder, entry.name),
        constants.COPYFILE_EXCL,
      );
    }
    await moveArtifactNoReplace(temporaryFolder, finalFolder);
    return finalFolder;
  }

  private rendererSource(output: CanonicalOutputRecord): OutputPlan['source'] {
    if (output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'XLSX') {
      return 'scheduleExcelPath';
    }
    if (output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'PDF') {
      return 'schedulePdfPath';
    }
    if (output.outputFamily === 'TechnicalBoq' && output.outputFormat === 'XLSX') {
      return 'boqExcelPath';
    }
    if (output.outputFamily === 'TechnicalBoq' && output.outputFormat === 'PDF') {
      return 'boqPdfPath';
    }
    throw new DomainError('CONFLICT', 'The reserved Output has no current Phase-2 renderer.', 409);
  }

  private projectForRevision(project: Project, revision: CanonicalRevisionRecord): Project {
    return {
      ...project,
      projectCode: storedText(revision.projectSnapshot, 'projectCode', project.projectCode),
      projectName: storedText(revision.projectSnapshot, 'projectName', project.projectName),
      clientName: storedText(revision.projectSnapshot, 'clientName', project.clientName),
      siteLocation: storedText(revision.projectSnapshot, 'siteLocation', project.siteLocation),
    };
  }

  private workspaceForRevision(
    workspace: ProjectWorkspace,
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
  ): ProjectWorkspace {
    const outputFolders = (() => {
      try {
        return projectOutputFoldersSchema.parse(revision.projectSnapshot?.outputFolders);
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Stored Revision output-folder snapshot is invalid.',
          409,
        );
      }
    })();
    const storedLightingPackage = (() => {
      try {
        const parsed = updateLightingPackageSchema.parse(revision.projectSnapshot?.lightingPackage);
        if (
          !parsed.inputMode ||
          !parsed.pdfPaperSize ||
          !parsed.scheduleColumns ||
          !parsed.boqColumns
        ) {
          throw new Error('incomplete');
        }
        return {
          inputMode: parsed.inputMode,
          pdfPaperSize: parsed.pdfPaperSize,
          scheduleColumns: parsed.scheduleColumns,
          boqColumns: parsed.boqColumns,
        };
      } catch {
        throw new DomainError(
          'CONFLICT',
          'Stored Revision lighting-package snapshot is invalid.',
          409,
        );
      }
    })();
    const scheduleTemplate = outputs.find(
      (output) => output.outputFamily === 'LuminaireSchedule',
    )?.resolvedTemplateSnapshot;
    const boqTemplate = outputs.find(
      (output) => output.outputFamily === 'TechnicalBoq',
    )?.resolvedTemplateSnapshot;
    return {
      ...workspace,
      outputFolders,
      luminaires: (revision.luminaireSnapshot ?? []).map((snapshot): LuminaireRecord => ({
        id: snapshot.luminaireId,
        projectId: revision.projectId,
        tag: snapshot.tag,
        category: snapshot.category,
        imagePath: snapshot.imagePath,
        description: snapshot.description,
        manufacturer: snapshot.manufacturer,
        model: snapshot.model,
        wattage: snapshot.wattage,
        lumens: snapshot.lumens,
        lightColor: snapshot.lightColor,
        cri: snapshot.cri,
        beamAngle: snapshot.beamAngle,
        ipRating: snapshot.ipRating,
        mounting: snapshot.mounting,
        cutout: snapshot.cutout,
        driver: snapshot.driver,
        control: snapshot.control,
        emergency: snapshot.emergency,
        datasheetPath: snapshot.datasheetPath,
        location: snapshot.location,
        unit: snapshot.unit,
        quantity: snapshot.quantity,
        notes: snapshot.notes,
        sourceName: snapshot.sourceName,
        dimensions: snapshot.dimensions,
        bodyColorFinish: snapshot.bodyColorFinish,
        rowVersion: 1,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
      })),
      lightingPackage: {
        ...workspace.lightingPackage,
        ...storedLightingPackage,
        ...(scheduleTemplate ? { scheduleColumns: outputColumns(scheduleTemplate) } : {}),
        ...(boqTemplate ? { boqColumns: outputColumns(boqTemplate) } : {}),
        ...(scheduleTemplate || boqTemplate
          ? { pdfPaperSize: (scheduleTemplate ?? boqTemplate)!.paperSize }
          : {}),
      },
    };
  }

  private markGenerationFailed(revisionId: string, reason: string): void {
    for (const output of this.registry.listOutputsForRevision(revisionId)) {
      if (output.lifecycleState !== 'PREPARING') continue;
      try {
        this.registry.setOutputLifecycle(output.outputId, 'FAILED_RECOVERABLE', reason);
      } catch {
        // Preserve the primary failure. Reconciliation will re-inspect exact persisted state.
      }
    }
    try {
      const revision = this.registry.getRevision(revisionId);
      if (revision.lifecycleState === 'PREPARING') {
        this.registry.setRevisionLifecycle(revisionId, 'FAILED_RECOVERABLE', reason);
      }
    } catch {
      // Preserve the primary failure; no filesystem cleanup or identity re-allocation occurs here.
    }
  }

  private assertGenerationReady(
    workspace: ProjectWorkspace,
    outputLabel = 'Schedule and BOQ files',
  ): void {
    if (!workspace.luminaires.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Add or import at least one luminaire before exporting.',
        400,
      );
    }
    if (!workspace.folderPath) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Create or connect the project folder before generating ${outputLabel}.`,
        400,
      );
    }
  }

  private async assertTechnicalOutputGenerationReady(
    workspace: ProjectWorkspace,
    spec: TechnicalOutputGenerationSpec,
  ): Promise<void> {
    this.assertGenerationReady(workspace, `${spec.label} files`);
    if (
      spec.requirePhysicalProjectRoot &&
      (await artifactPathKind(workspace.folderPath!)) !== 'DIRECTORY'
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `The Project folder must exist before generating ${spec.label} files.`,
        400,
      );
    }
  }
}
