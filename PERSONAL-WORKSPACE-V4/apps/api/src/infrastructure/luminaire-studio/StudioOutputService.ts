import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import {
  assertTargetFormatSlotsFree,
  requireCompositionTarget,
} from '../output-registry/canonical-composition-targets.js';
import { z } from 'zod';
import {
  canonicalLuminaireSnapshotSchema,
  studioDocumentSchema,
  studioOutputRequestSchema,
  type StudioDocument,
} from '@scli/contracts';
import {
  DomainError,
  type AppUser,
  type CanonicalOutputRecord,
  type Project,
  type ProjectWorkspace,
} from '@scli/domain';
import {
  CanonicalOutputRegistryStore,
  normalizeCanonicalProjectRelativePath,
} from '../output-registry/CanonicalOutputRegistryStore.js';
import {
  ensureArtifactParent,
  moveArtifactNoReplace,
  outputTemporaryPath,
  resolveCanonicalArtifactPath,
  sha256File,
  readVerifiedCanonicalArtifact,
} from '../output-registry/canonical-artifact-files.js';

export { studioOutputRequestSchema } from '@scli/contracts';
type Input = z.infer<typeof studioOutputRequestSchema>;
const run = promisify(execFile);

export class StudioOutputService {
  constructor(
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly sourceRoot: string,
    private readonly renderOverride?: (requestFile: string) => Promise<void>,
  ) {}

  public async generate(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    original: StudioDocument,
    input: Input,
  ) {
    if (!workspace.folderPath)
      throw new DomainError(
        'CONFLICT',
        'Connect the project folder before generating outputs.',
        409,
      );
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const target = input.targetRevisionId
      ? requireCompositionTarget(this.registry, project.id, input.targetRevisionId)
      : null;
    if (target) {
      if (input.separate)
        throw new DomainError(
          'VALIDATION_ERROR',
          'Generate combined Specifications for a Revision. Separate files remain available through the standalone export.',
          400,
        );
      assertTargetFormatSlotsFree(
        this.registry,
        target,
        input.kind === 'datasheets'
          ? 'DatasheetRegister'
          : input.kind === 'boq'
            ? 'TechnicalBoq'
            : 'LuminaireSchedule',
        input.kind === 'datasheets'
          ? 'Luminaire Specifications'
          : input.kind === 'boq'
            ? 'BOQ'
            : 'Luminaire Schedule',
        input.format,
      );
      // A composed Revision owns frozen technical truth. Never render later Project edits into it.
      const current = workspace.luminaires.map((row) =>
        canonicalLuminaireSnapshotSchema.parse({
          ...row,
          luminaireId: row.id,
          attachmentReferences: [row.imagePath, row.datasheetPath].filter(Boolean),
        }),
      );
      const frozen = target.luminaireSnapshot ?? [];
      if (
        current.length !== frozen.length ||
        frozen.some((row) => {
          const actual = current.find((candidate) => candidate.luminaireId === row.luminaireId);
          return (
            !actual ||
            Object.entries(row).some(
              ([key, value]) => !isDeepStrictEqual(actual[key as keyof typeof actual], value),
            )
          );
        })
      )
        throw new DomainError(
          'CONFLICT',
          'Project luminaires changed after this Revision was prepared. Prepare a new Revision to export the current Output Studio preview.',
          409,
        );
      for (const key of ['projectCode', 'projectName', 'clientName', 'projectType'] as const) {
        if (target.projectSnapshot?.[key] !== project[key])
          throw new DomainError(
            'CONFLICT',
            'Project details changed after this Revision was prepared. Prepare a new Revision for the current preview.',
            409,
          );
      }
    }
    const previous = this.registry
      .listRevisions(project.id)
      .find((item) => item.projectSnapshot?.studioOutputOperationId === input.operationId);
    if (previous) {
      if (
        previous.projectSnapshot?.studioRequestHash !== requestHash ||
        !['FINALIZED', 'FAILED_RECOVERABLE'].includes(previous.lifecycleState)
      )
        throw new DomainError(
          'CONFLICT',
          'This Studio output operation is already recorded. Review its Revision before retrying.',
          409,
          { revisionId: previous.revisionId },
        );
      if (previous.lifecycleState === 'FINALIZED') {
        const outputs = this.registry.listOutputsForRevision(previous.revisionId);
        return {
          revisionId: previous.revisionId,
          revisionSequence: previous.revisionSequence,
          outputs,
          artifacts: outputs.map((output) => ({
            name: path.basename(output.locatorValue ?? ''),
            url: `/api/projects/${project.id}/luminaire-studio/outputs/${output.outputId}/download`,
          })),
        };
      }
    }
    const document = previous
      ? studioDocumentSchema.parse(previous.projectSnapshot?.studioDocument)
      : structuredClone(original);
    if (input.kind !== 'datasheets') document.output.kind = input.kind;
    for (const key of ['columns', 'boqColumns', 'accessoryColumns']) {
      const columns = document.output[key];
      if (Array.isArray(columns))
        document.output[key] = columns.filter(
          (column) =>
            !(
              column &&
              typeof column === 'object' &&
              !Array.isArray(column) &&
              ['rate', 'amount'].includes(String(column.key))
            ),
        );
    }
    const selection = input.selection.length
      ? input.selection
      : document.luminaires.map((row) => row.id);
    if (
      !selection.length ||
      selection.some((id) => !document.luminaires.some((row) => row.id === id))
    )
      throw new DomainError(
        'VALIDATION_ERROR',
        'Select luminaires belonging to this project.',
        400,
      );
    const family =
      input.kind === 'datasheets'
        ? 'DatasheetRegister'
        : input.kind === 'boq'
          ? 'TechnicalBoq'
          : 'LuminaireSchedule';
    const template = this.registry.resolveEffectiveTemplate(project.id, family);
    // Preserve registered section identities; freeze renderer evidence in section configuration.
    // Adding a synthetic section violates the canonical registry's template structure contract.
    template.sections = template.sections.map((section, index) =>
      index === 0
        ? {
            ...section,
            config: {
              ...section.config,
              studioRenderSnapshot: JSON.stringify({
                operationId: input.operationId,
                requestHash,
                document,
              }),
            },
          }
        : section,
    );
    const revision =
      target ??
      previous ??
      this.registry.createRevision({
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
          studioVersion: '1.4.1',
          studioOutputOperationId: input.operationId,
          studioRequestHash: requestHash,
          studioDocument: document,
          studioOutputRequest: input,
          folderProfile: workspace.folderProfile,
          outputFolders: structuredClone(workspace.outputFolders),
        },
        luminaires: workspace.luminaires.map((row) =>
          canonicalLuminaireSnapshotSchema.parse({
            ...row,
            luminaireId: row.id,
            attachmentReferences: [row.imagePath, row.datasheetPath].filter(Boolean),
          }),
        ),
        createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
      });
    if (previous) this.registry.setRevisionLifecycle(previous.revisionId, 'PREPARING');
    document.meta.revision = revision.revisionLabel;
    const folder =
      input.kind === 'datasheets'
        ? workspace.outputFolders.datasheets
        : input.kind === 'boq'
          ? input.format === 'PDF'
            ? workspace.outputFolders.boqPdf
            : workspace.outputFolders.boqExcel
          : input.format === 'PDF'
            ? workspace.outputFolders.schedulePdf
            : workspace.outputFolders.scheduleExcel;
    // A separate workbook per tag gets a separate canonical Output; none are hidden in a ZIP.
    const batches =
      input.kind === 'datasheets' && input.separate ? selection.map((id) => [id]) : [selection];
    const outputs: CanonicalOutputRecord[] = [];
    const artifacts: Array<{ name: string; url: string }> = [];
    // Reserve the composed slot synchronously before the first render-related await.
    const targetName = target
      ? `${project.projectCode.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}_${revision.revisionLabel}_Studio_${input.kind}_${input.operationId}.${input.format.toLowerCase()}`
      : null;
    const targetOutput = targetName
      ? this.registry.createOutput({
          revisionId: revision.revisionId,
          outputFamily: family,
          outputFormat: input.format,
          relativePath: normalizeCanonicalProjectRelativePath(
            path.posix.join(folder.replaceAll('\\', '/'), targetName),
          ),
          contentHash: null,
          resolvedTemplate: template,
        })
      : null;
    const scratch = await mkdtemp(path.join(tmpdir(), 'scli-studio-'));
    let pending: CanonicalOutputRecord | null = null;
    let temporary: string | null = null;
    try {
      for (const [index, ids] of batches.entries()) {
        const stem = project.projectCode.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
        const name =
          targetName ??
          `${stem}_${revision.revisionLabel}_Studio_${input.kind}${batches.length > 1 ? `_${index + 1}` : ''}.${input.format.toLowerCase()}`;
        const relativePath = normalizeCanonicalProjectRelativePath(
          path.posix.join(folder.replaceAll('\\', '/'), name),
        );
        // Freeze Studio's actual layout beside the shared template identity in the immutable revision.
        const existing = this.registry
          .listOutputsForRevision(revision.revisionId)
          .find((item) => item.locatorValue === relativePath);
        pending =
          targetOutput ??
          existing ??
          this.registry.createOutput({
            revisionId: revision.revisionId,
            outputFamily: family,
            outputFormat: input.format,
            relativePath,
            contentHash: null,
            resolvedTemplate: template,
          });
        const final = resolveCanonicalArtifactPath(workspace.folderPath, relativePath);
        await ensureArtifactParent(final);
        const present = await access(final).then(
          () => true,
          () => false,
        );
        if (present) {
          if (!pending.contentHash || (await sha256File(final)) !== pending.contentHash)
            throw new DomainError(
              'CONFLICT',
              'Recovery found a different file at the reserved output path.',
              409,
            );
          outputs.push(
            pending.lifecycleState === 'FINALIZED'
              ? pending
              : this.registry.setOutputLifecycle(pending.outputId, 'FINALIZED'),
          );
          artifacts.push({
            name,
            url: `/api/projects/${project.id}/luminaire-studio/outputs/${pending.outputId}/download`,
          });
          pending = null;
          continue;
        }
        if (pending.lifecycleState === 'FINALIZED')
          throw new DomainError(
            'CONFLICT',
            'A finalized output file is missing. Restore its original artifact before recovery.',
            409,
          );
        this.registry.setOutputLifecycle(pending.outputId, 'PREPARING');
        temporary = outputTemporaryPath(final, pending.outputId);
        const requestFile = path.join(scratch, `request-${index}.json`);
        await writeFile(
          requestFile,
          JSON.stringify({
            document,
            selection: ids,
            format: input.format,
            kind: input.kind,
            output: temporary,
          }),
          { flag: 'wx' },
        );
        if (this.renderOverride) await this.renderOverride(requestFile);
        else {
          const require = createRequire(path.join(this.sourceRoot, 'package.json'));
          const packagedExecutable = process.env.SCT_STUDIO_PACKAGED_EXECUTABLE;
          const electron = packagedExecutable || (require('electron') as string);
          const environment = { ...process.env };
          delete environment.ELECTRON_RUN_AS_NODE;
          await run(
            electron,
            packagedExecutable
              ? ['--sct-studio-render', requestFile]
              : [path.join(this.sourceRoot, 'tools/render-luminaire-studio.cjs'), requestFile],
            { windowsHide: true, timeout: 100000, env: environment, maxBuffer: 1024 * 1024 },
          );
        }
        this.registry.setOutputContentHash(pending.outputId, await sha256File(temporary));
        await moveArtifactNoReplace(temporary, final);
        temporary = null;
        outputs.push(this.registry.setOutputLifecycle(pending.outputId, 'FINALIZED'));
        artifacts.push({
          name,
          url: `/api/projects/${project.id}/luminaire-studio/outputs/${pending.outputId}/download`,
        });
        pending = null;
      }
      if (!target) this.registry.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
      return {
        revisionId: revision.revisionId,
        revisionSequence: revision.revisionSequence,
        outputs,
        artifacts,
      };
    } catch (error) {
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
      if (pending && pending.lifecycleState !== 'FINALIZED')
        this.registry.setOutputLifecycle(
          pending.outputId,
          'FAILED_RECOVERABLE',
          'Studio rendering did not complete.',
        );
      if (!target)
        this.registry.setRevisionLifecycle(
          revision.revisionId,
          'FAILED_RECOVERABLE',
          'Studio rendering did not complete.',
        );
      throw new DomainError(
        'EXPORT_FAILED',
        'Studio output generation failed. The Revision records the incomplete attempt; no existing output was replaced.',
        500,
        {
          revisionId: revision.revisionId,
          reason: error instanceof Error ? error.message.slice(0, 250) : 'Render failure',
        },
      );
    } finally {
      if (path.resolve(scratch).startsWith(path.resolve(tmpdir()) + path.sep + 'scli-studio-'))
        await rm(scratch, { recursive: true, force: true });
    }
  }

  public ownsRevision(projectId: string, revisionId: string): boolean {
    const revision = this.registry.getRevision(revisionId);
    return revision.projectId === projectId && revision.projectSnapshot?.studioVersion === '1.4.1';
  }

  public async recover(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    revisionId: string,
  ) {
    if (!this.ownsRevision(project.id, revisionId))
      throw new DomainError('NOT_FOUND', 'Studio Revision not found in this project.', 404);
    const revision = this.registry.getRevision(revisionId);
    const document = studioDocumentSchema.parse(revision.projectSnapshot?.studioDocument);
    const input = studioOutputRequestSchema.parse(revision.projectSnapshot?.studioOutputRequest);
    // Recovery renders the recorded snapshot, never the project's later edits.
    const frozenWorkspace = {
      ...workspace,
      outputFolders: revision.projectSnapshot?.outputFolders as ProjectWorkspace['outputFolders'],
    };
    const result = await this.generate(project, frozenWorkspace, actor, document, input);
    const file = (format: string) => {
      const output = result.outputs.find((item) => item.outputFormat === format);
      return output?.locatorValue && workspace.folderPath
        ? resolveCanonicalArtifactPath(workspace.folderPath, output.locatorValue)
        : null;
    };
    return {
      ...result,
      revision: this.registry.getRevision(revisionId),
      files: { xlsxPath: file('XLSX'), pdfPath: file('PDF') },
    };
  }

  public async download(project: Project, workspace: ProjectWorkspace, outputId: string) {
    const output = this.registry.getOutput(outputId);
    if (!output.revisionId) throw new DomainError('NOT_FOUND', 'The output has no Revision.', 404);
    const revision = this.registry.getRevision(output.revisionId);
    if (
      revision.projectId !== project.id ||
      !output.resolvedTemplateSnapshot?.sections.some(
        (section) => typeof section.config?.studioRenderSnapshot === 'string',
      ) ||
      output.lifecycleState !== 'FINALIZED' ||
      !workspace.folderPath ||
      !output.locatorValue
    )
      throw new DomainError('NOT_FOUND', 'Studio output is not available for this project.', 404);
    const file = await readVerifiedCanonicalArtifact(
      workspace.folderPath,
      output.locatorValue,
      output.contentHash,
    );
    const filename = file.canonical;
    return {
      bytes: file.bytes,
      name: path.basename(filename),
      type:
        output.outputFormat === 'PDF'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
