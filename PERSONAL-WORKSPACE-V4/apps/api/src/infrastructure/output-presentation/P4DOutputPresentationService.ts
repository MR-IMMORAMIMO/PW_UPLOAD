import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { P4dOutputGenerateInput, P4dOutputPreviewInput } from '@scli/contracts';
import {
  DomainError,
  type AppUser,
  type CanonicalLuminaireSnapshot,
  type CanonicalOutputRecord,
  type CanonicalRevisionRecord,
  type LuminaireRecord,
  type Project,
  type ProjectWorkspace,
  type ResolvedOutputEnvelope,
  type TechnicalScheduleGenerationResult,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import {
  CanonicalOutputRegistryStore,
  normalizeCanonicalProjectRelativePath,
} from '../output-registry/CanonicalOutputRegistryStore.js';
import {
  assertTargetFormatSlotsFree,
  requireCompositionTarget,
} from '../output-registry/canonical-composition-targets.js';
import {
  boundedArtifactFailure,
  ensureArtifactParent,
  moveArtifactNoReplace,
  outputTemporaryPath,
  resolveCanonicalArtifactPath,
  sha256File,
} from '../output-registry/canonical-artifact-files.js';
import { ProfessionalOutputResolver } from './ProfessionalOutputResolver.js';
import { serializeProfessionalPdf } from './ProfessionalPdfSerializer.js';
import { serializeProfessionalXlsx } from './ProfessionalXlsxSerializer.js';

function snapshot(luminaire: LuminaireRecord): CanonicalLuminaireSnapshot {
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

function safeStem(value: string): string {
  return (
    value
      .normalize('NFKD')
      .split('')
      .map((character) => (character.charCodeAt(0) <= 31 ? '_' : character))
      .join('')
      .replaceAll(/[<>:"/\\|?*]/g, '_')
      .trim()
      .replaceAll(/\s+/g, '_')
      .replaceAll(/_+/g, '_')
      .replace(/^[ ._]+|[ ._]+$/g, '')
      .slice(0, 100) || 'SCLI_PROJECT'
  );
}

function familyStem(kind: ResolvedOutputEnvelope['outputKind']): string {
  return (
    {
      LuminaireSchedule: 'Technical_Luminaire_Schedule',
      PresentationSchedule: 'Presentation_Luminaire_Schedule',
      TechnicalBoq: 'Technical_Lighting_BOQ',
      DatasheetRegister: 'Datasheet_Register',
    } as const
  )[kind];
}

function outputFolder(workspace: ProjectWorkspace, envelope: ResolvedOutputEnvelope): string {
  if (envelope.outputKind === 'TechnicalBoq')
    return envelope.format === 'PDF'
      ? workspace.outputFolders.boqPdf
      : workspace.outputFolders.boqExcel;
  if (envelope.outputKind === 'DatasheetRegister') return workspace.outputFolders.datasheets;
  return envelope.format === 'PDF'
    ? workspace.outputFolders.schedulePdf
    : workspace.outputFolders.scheduleExcel;
}

export class P4DOutputPresentationService {
  private readonly resolver: ProfessionalOutputResolver;

  public constructor(
    personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
  ) {
    this.resolver = new ProfessionalOutputResolver(personalStore, registry);
  }

  public preview(
    project: Project,
    workspace: ProjectWorkspace,
    input: P4dOutputPreviewInput,
  ): Promise<ResolvedOutputEnvelope> {
    return this.resolver.resolve(project, workspace, input);
  }

  public async generate(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: P4dOutputGenerateInput,
  ): Promise<TechnicalScheduleGenerationResult> {
    if (!workspace.folderPath)
      throw new DomainError(
        'CONFLICT',
        'Verified Project storage is required for generation.',
        409,
      );
    const preview = await this.resolver.resolve(project, workspace, input);
    if (preview.sourceFingerprint !== input.previewFingerprint) {
      throw new DomainError(
        'CONFLICT',
        'Project data, template, branding, or output options changed after Preview. Preview again before generating.',
        409,
      );
    }
    const blocking = preview.messages.filter((message) => message.level === 'BLOCKING_ERROR');
    if (blocking.length)
      throw new DomainError(
        'VALIDATION_ERROR',
        blocking.map((message) => message.message).join(' '),
        400,
      );
    let createdRevision = false;
    let revision: CanonicalRevisionRecord;
    if (input.targetRevisionId) {
      revision = requireCompositionTarget(this.registry, project.id, input.targetRevisionId);
      assertTargetFormatSlotsFree(
        this.registry,
        revision,
        input.outputKind,
        familyStem(input.outputKind).replaceAll('_', ' '),
        input.format,
      );
    } else {
      revision = this.registry.createRevision({
        projectId: project.id,
        projectSnapshot: {
          id: project.id,
          projectCode: project.projectCode,
          projectName: project.projectName,
          clientName: project.clientName,
          projectType: project.projectType,
          status: project.status,
          updatedAt: project.updatedAt,
          canonicalOperation: 'GENERATED_OUTPUTS',
          generationIssueStatus: input.issueStatus,
          generationIssueDate: input.issueDate,
          p4dOutputKind: input.outputKind,
          p4dOutputFormat: input.format,
          folderProfile: workspace.folderProfile,
          outputFolders: structuredClone(workspace.outputFolders),
        },
        luminaires: workspace.luminaires.map(snapshot),
        createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
      });
      createdRevision = true;
    }
    const finalEnvelope = await this.resolver.resolve(project, workspace, {
      ...input,
      targetRevisionId: revision.revisionId,
    });
    if (finalEnvelope.sourceFingerprint !== preview.sourceFingerprint) {
      if (createdRevision)
        this.registry.setRevisionLifecycle(
          revision.revisionId,
          'FAILED_RECOVERABLE',
          'Resolved output authority changed during generation preparation.',
        );
      throw new DomainError(
        'CONFLICT',
        'Resolved output authority changed during generation preparation. Preview again.',
        409,
        { revisionId: revision.revisionId },
      );
    }
    const extension = input.format.toLowerCase();
    const relativePath = normalizeCanonicalProjectRelativePath(
      path.posix.join(
        outputFolder(workspace, finalEnvelope).replaceAll('\\', '/'),
        `${safeStem(project.projectCode)}_${revision.revisionLabel}_${familyStem(input.outputKind)}.${extension}`,
      ),
    );
    let output: CanonicalOutputRecord | null = null;
    let temporaryPath: string | null = null;
    try {
      output = this.registry.createOutput({
        revisionId: revision.revisionId,
        outputFamily: input.outputKind,
        outputFormat: input.format,
        relativePath,
        contentHash: null,
        resolvedTemplate: finalEnvelope.template,
      });
      const finalPath = resolveCanonicalArtifactPath(workspace.folderPath, relativePath);
      temporaryPath = outputTemporaryPath(finalPath, output.outputId);
      await ensureArtifactParent(finalPath);
      const bytes =
        input.format === 'PDF'
          ? serializeProfessionalPdf(finalEnvelope)
          : await serializeProfessionalXlsx(finalEnvelope);
      await writeFile(temporaryPath, bytes, { flag: 'wx' });
      const hash = await sha256File(temporaryPath);
      this.registry.setOutputContentHash(output.outputId, hash);
      await moveArtifactNoReplace(temporaryPath, finalPath);
      temporaryPath = null;
      output = this.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
      if (createdRevision)
        revision = this.registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
      else revision = this.registry.getRevision(revision.revisionId);
      return {
        revision,
        outputs: [output],
        files: {
          xlsxPath: input.format === 'XLSX' ? finalPath : null,
          pdfPath: input.format === 'PDF' ? finalPath : null,
        },
      };
    } catch (error) {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
      const reason = boundedArtifactFailure(error, 'Professional output generation failed.');
      if (output) {
        try {
          if (this.registry.getOutput(output.outputId).lifecycleState === 'PREPARING')
            this.registry.setOutputLifecycle(output.outputId, 'FAILED_RECOVERABLE', reason);
        } catch {
          /* preserve primary error */
        }
      }
      if (createdRevision) {
        try {
          if (this.registry.getRevision(revision.revisionId).lifecycleState === 'PREPARING')
            this.registry.setRevisionLifecycle(revision.revisionId, 'FAILED_RECOVERABLE', reason);
        } catch {
          /* preserve primary error */
        }
      }
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'EXPORT_FAILED',
        'The professional output could not be generated safely. Its canonical reservation remains recoverable.',
        500,
        { revisionId: revision.revisionId },
      );
    }
  }
}
