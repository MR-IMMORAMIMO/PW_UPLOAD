import {
  DomainError,
  type OutputTemplateOverride,
  type PdfPaperSize,
  type ProjectWorkspace,
  type ScheduleArtifactPresence,
  type TechnicalScheduleOutputHistoryItem,
  type TechnicalScheduleRevisionView,
  type TechnicalScheduleWorkspaceView,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { artifactPathKind, resolveCanonicalArtifactPresence } from './canonical-artifact-files.js';
import { composableTargetViews, requestedTargetView } from './canonical-composition-targets.js';

export type TechnicalOutputFamily = 'LuminaireSchedule' | 'TechnicalBoq';

export interface TechnicalOutputConfigInput {
  readonly templateId?: string | undefined;
  readonly templateVersionId?: string | undefined;
  readonly columns?:
    | readonly {
        readonly columnId: string;
        readonly visible?: boolean | undefined;
        readonly order?: number | undefined;
        readonly width?: number | undefined;
      }[]
    | undefined;
  readonly paperSize?: PdfPaperSize | undefined;
  readonly reset?: true | undefined;
}

interface TechnicalOutputWorkspaceOptions {
  readonly family: TechnicalOutputFamily;
  readonly label: string;
  readonly requirePhysicalProjectRoot: boolean;
}

const currentSelectableScheduleTemplates = new Set([
  'schedule.technical-modern/v2',
  'schedule.classic-grid-pro.consultant/v1',
  'schedule.classic-grid-pro.compact/v1',
]);

/** Shared read/config authority for the two independent technical output families. */
export class TechnicalOutputWorkspaceService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly options: TechnicalOutputWorkspaceOptions,
  ) {}

  public async read(
    projectId: string,
    workspace: ProjectWorkspace,
    selectedRevisionId?: string,
    targetRevisionId?: string,
  ): Promise<TechnicalScheduleWorkspaceView> {
    if (workspace.projectId !== projectId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `${this.options.label} workspace Project mismatch.`,
        400,
      );
    }
    const canonicalRevisions = this.registry.listRevisions(projectId);
    const familyOutputs = this.registry
      .listOutputs(projectId)
      .filter((output) => output.outputFamily === this.options.family);
    const outputRevisionIds = new Set(
      familyOutputs.flatMap((output) => (output.revisionId ? [output.revisionId] : [])),
    );
    const compatibilityById = new Map(
      workspace.revisions.map((revision) => [revision.id, revision]),
    );
    const revisions = canonicalRevisions.map((revision): TechnicalScheduleRevisionView => {
      const compatibility = compatibilityById.get(revision.revisionId);
      return {
        revision,
        generatedOutputRevision: outputRevisionIds.has(revision.revisionId),
        compatibility: compatibility
          ? {
              status: compatibility.status,
              issuedAt: compatibility.issuedAt,
              locked: compatibility.locked,
            }
          : null,
      };
    });
    const revisionById = new Map(
      canonicalRevisions.map((revision) => [revision.revisionId, revision]),
    );
    const outputs = (
      await Promise.all(
        familyOutputs.map(async (output): Promise<TechnicalScheduleOutputHistoryItem> => {
          const revision = output.revisionId ? revisionById.get(output.revisionId) : undefined;
          return {
            output,
            revisionLabel: revision?.revisionLabel ?? '',
            revisionSequence: revision?.revisionSequence ?? 0,
            templateName: output.resolvedTemplateSnapshot?.displayName ?? null,
            createdById: revision?.createdById ?? null,
            createdByName: revision?.createdByName ?? null,
            artifactPresence: await this.artifactPresence(workspace.folderPath, output),
          };
        }),
      )
    ).sort(
      (left, right) =>
        right.revisionSequence - left.revisionSequence ||
        right.output.createdAt.localeCompare(left.output.createdAt) ||
        left.output.outputFormat.localeCompare(right.output.outputFormat),
    );

    let selectedRevision = null;
    if (selectedRevisionId) {
      const revision = this.registry.getRevision(selectedRevisionId);
      if (revision.projectId !== projectId) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Selected Revision does not belong to this Project.',
          400,
        );
      }
      const metadata = revisions.find(
        (candidate) => candidate.revision.revisionId === revision.revisionId,
      );
      if (!metadata) {
        throw new DomainError('CONFLICT', 'Selected Revision metadata is unavailable.', 409);
      }
      selectedRevision = {
        metadata,
        rows: structuredClone(revision.luminaireSnapshot ?? []),
      };
    }

    const generationReasons: string[] = [];
    if (workspace.luminaires.length === 0) {
      generationReasons.push('At least one luminaire required');
    }
    if (!workspace.folderPath) {
      generationReasons.push('Project folder required');
    } else if (
      this.options.requirePhysicalProjectRoot &&
      (await artifactPathKind(workspace.folderPath)) !== 'DIRECTORY'
    ) {
      generationReasons.push('Project folder is missing');
    }

    const activeTemplateVersions = this.registry.listActiveTemplateVersions(this.options.family);
    const selectableTemplateVersions =
      this.options.family === 'LuminaireSchedule'
        ? activeTemplateVersions.filter((version) =>
            currentSelectableScheduleTemplates.has(`${version.templateId}/${version.versionId}`),
          )
        : activeTemplateVersions;

    return {
      projectId,
      currentRows: structuredClone(workspace.luminaires),
      templates: selectableTemplateVersions.map((version) => ({
        templateId: version.templateId,
        templateVersionId: version.versionId,
        name: version.definition.displayName,
        version: version.versionId,
        resolvedTemplate: structuredClone(version.definition),
      })),
      effectiveTemplate:
        this.options.family === 'LuminaireSchedule'
          ? this.registry.resolveEffectiveTechnicalScheduleTemplate(projectId)
          : this.registry.resolveEffectiveTechnicalBoqTemplate(projectId),
      projectOverride: this.registry.getProjectOverride(projectId, this.options.family),
      revisions,
      selectedRevision,
      outputs,
      generationReadiness: {
        ready: generationReasons.length === 0,
        reasons: generationReasons,
      },
      // Advisory only (C1 §13): a truthful list of the composed drafts that MAY
      // currently be targeted, plus the server verdict for the one the client
      // claims to target. Neither grants generation authority — the generation
      // call re-verifies eligibility through the same shared authority.
      composableTargets: composableTargetViews(
        this.registry,
        canonicalRevisions,
        this.options.family,
      ),
      requestedTarget: targetRevisionId
        ? requestedTargetView(this.registry, projectId, targetRevisionId, this.options.family)
        : null,
    };
  }

  public updateConfig(projectId: string, input: TechnicalOutputConfigInput) {
    this.personalStore.getWorkspace(projectId);
    const current = this.registry.getProjectOverride(projectId, this.options.family);
    const effective =
      this.options.family === 'LuminaireSchedule'
        ? this.registry.resolveEffectiveTechnicalScheduleTemplate(projectId)
        : this.registry.resolveEffectiveTechnicalBoqTemplate(projectId);
    const templateId = input.templateId ?? effective.templateId;
    const versionId = input.templateVersionId ?? effective.versionId;
    const sameCurrentPair = current?.templateId === templateId && current.versionId === versionId;
    const config: OutputTemplateOverride =
      input.reset === true ? {} : sameCurrentPair ? structuredClone(current.config) : {};

    if (input.columns) {
      const columns = new Map((config.columns ?? []).map((column) => [column.columnId, column]));
      for (const column of input.columns) {
        columns.set(column.columnId, { ...columns.get(column.columnId), ...column });
      }
      config.columns = [...columns.values()];
    }
    if (input.paperSize) config.paperSize = input.paperSize;

    const projectOverride = this.registry.setTechnicalOutputProjectOverride(
      projectId,
      this.options.family,
      { templateId, versionId, config },
    );
    return {
      projectOverride,
      effectiveTemplate:
        this.options.family === 'LuminaireSchedule'
          ? this.registry.resolveEffectiveTechnicalScheduleTemplate(projectId)
          : this.registry.resolveEffectiveTechnicalBoqTemplate(projectId),
    };
  }

  private async artifactPresence(
    projectRoot: string | null,
    output: TechnicalScheduleOutputHistoryItem['output'],
  ): Promise<ScheduleArtifactPresence> {
    return (await resolveCanonicalArtifactPresence(projectRoot, output)).presence;
  }
}
