import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AutomationApplication,
  P4cArtifactType,
  StartToolSessionInput,
  StartToolSessionResponse,
  ToolSessionRead,
} from '@scli/contracts';
import { DomainError, type DataProvider, type ToolContext } from '@scli/domain';
import { ProjectStorageService, type VerifiedProjectRoot } from '../../project-storage-service.js';
import { contextInboxPath } from './CaptureInboxBoundary.js';
import { findP4bCapturePolicy, type P4bCapturePolicy } from './CapturePolicy.js';
import { AutomationContextService } from './AutomationContextService.js';
import { DesktopHandoffService } from './DesktopHandoffService.js';

interface SourceBinding {
  absolutePath: string;
  fileName: string;
}

interface RevisionBinding {
  id: string;
  label: string;
  state: string;
}

export class ToolSessionWorkflowService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly provider: DataProvider,
    private readonly storage: ProjectStorageService,
    private readonly contexts: AutomationContextService,
    private readonly handoffs: DesktopHandoffService,
    private readonly dataRoot: string,
  ) {}

  public async start(
    projectId: string,
    input: StartToolSessionInput,
  ): Promise<StartToolSessionResponse> {
    const validated = await this.validateIdentity(projectId, input);
    const existing = this.contexts
      .list(projectId)
      .find(
        (context) =>
          (context.state === 'LIVE' || context.state === 'REBOUND') &&
          context.tool === input.application &&
          context.expectedArtifactType === input.artifactType &&
          context.targetRevisionId === (input.targetRevisionId ?? null) &&
          context.sourceDocumentId === (input.sourceDocumentId ?? null),
      );
    const context =
      existing ??
      this.contexts.open({
        projectId,
        application: input.application,
        expectedArtifactType: input.artifactType,
        targetRevisionId: input.targetRevisionId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
      });
    await mkdir(contextInboxPath(this.dataRoot, context.toolContextId), { recursive: true });
    return {
      toolSession: this.read(context, validated.source, validated.revision),
      reusedExisting: Boolean(existing),
      launchHandoff: this.handoffs.create({
        action: 'LAUNCH_TOOL',
        projectId,
        toolContextId: context.toolContextId,
        application: input.application,
        authorizedProjectRoot: validated.root,
        sourcePath: validated.source?.absolutePath ?? null,
      }),
    };
  }

  public async restart(toolContextId: string): Promise<StartToolSessionResponse> {
    const original = this.contexts.get(toolContextId);
    if (original.state !== 'EXPIRED') {
      throw new DomainError('INVALID_TRANSITION', 'Only an expired Tool Session can restart.', 409);
    }
    const input: StartToolSessionInput = {
      application: original.tool as AutomationApplication,
      artifactType: original.expectedArtifactType as P4cArtifactType,
      targetRevisionId: original.targetRevisionId,
      sourceDocumentId: original.sourceDocumentId,
    };
    const validated = await this.validateIdentity(original.projectId, input);
    const rebound = this.contexts.rebind(toolContextId);
    await mkdir(contextInboxPath(this.dataRoot, toolContextId), { recursive: true });
    return {
      toolSession: this.read(rebound, validated.source, validated.revision),
      reusedExisting: true,
      launchHandoff: this.handoffs.create({
        action: 'LAUNCH_TOOL',
        projectId: rebound.projectId,
        toolContextId,
        application: input.application,
        authorizedProjectRoot: validated.root,
        sourcePath: validated.source?.absolutePath ?? null,
      }),
    };
  }

  public async exportFolderHandoff(toolContextId: string) {
    const context = this.contexts.get(toolContextId);
    if (context.state !== 'LIVE' && context.state !== 'REBOUND') {
      throw new DomainError('INVALID_TRANSITION', 'The Tool Session is not active.', 409);
    }
    const project = await this.requireProject(context.projectId);
    await this.storage.resolveVerifiedProjectRoot(project);
    const inboxPath = contextInboxPath(this.dataRoot, toolContextId);
    await mkdir(inboxPath, { recursive: true });
    return this.handoffs.create({
      action: 'OPEN_EXPORT_FOLDER',
      projectId: context.projectId,
      toolContextId,
      inboxPath,
    });
  }

  public list(projectId: string): ToolSessionRead[] {
    return this.contexts.list(projectId).map((context) => {
      const revision = context.targetRevisionId
        ? this.readRevision(context.projectId, context.targetRevisionId, false)
        : null;
      const source = context.sourceDocumentId
        ? this.readSourceRow(context.projectId, context.sourceDocumentId)
        : null;
      return this.read(
        context,
        source ? { absolutePath: '', fileName: path.basename(source.filePath) } : null,
        revision,
      );
    });
  }

  public testLaunch(application: AutomationApplication) {
    return this.handoffs.create({ action: 'TEST_LAUNCH', application });
  }

  private async validateIdentity(projectId: string, input: StartToolSessionInput) {
    const policy = findP4bCapturePolicy(input.application, input.artifactType);
    if (!policy) {
      throw new DomainError('VALIDATION_ERROR', 'Application and output type do not match.', 400);
    }
    const project = await this.requireProject(projectId);
    const root = await this.storage.resolveVerifiedProjectRoot(project);
    const revision = this.validateRevision(projectId, policy, input.targetRevisionId ?? null);
    if (!input.sourceDocumentId) {
      throw new DomainError('VALIDATION_ERROR', 'Select a registered source file.', 400);
    }
    const source = await this.validateSource(
      projectId,
      input.sourceDocumentId,
      input.application,
      root,
    );
    return { root, source, revision };
  }

  private validateRevision(projectId: string, policy: P4bCapturePolicy, revisionId: string | null) {
    if (policy.level === 'PROJECT') {
      if (revisionId)
        throw new DomainError(
          'VALIDATION_ERROR',
          'Project-level output cannot target a Revision.',
          400,
        );
      return null;
    }
    if (!revisionId)
      throw new DomainError('VALIDATION_ERROR', 'A PREPARING Revision is required.', 400);
    const revision = this.readRevision(projectId, revisionId, true);
    if (revision?.state !== 'PREPARING') {
      throw new DomainError('INVALID_TRANSITION', 'The selected Revision must be PREPARING.', 409);
    }
    return revision;
  }

  private readRevision(
    projectId: string,
    revisionId: string,
    required: boolean,
  ): RevisionBinding | null {
    const row = this.database
      .prepare(
        'SELECT revision_id, project_id, revision_label, lifecycle_state FROM canonical_revisions WHERE revision_id = ?',
      )
      .get(revisionId) as
      | { revision_id: string; project_id: string; revision_label: string; lifecycle_state: string }
      | undefined;
    if (!row || row.project_id !== projectId) {
      if (!required) return null;
      throw new DomainError('NOT_FOUND', 'Canonical Revision not found for this Project.', 404);
    }
    return { id: row.revision_id, label: row.revision_label, state: row.lifecycle_state };
  }

  private async validateSource(
    projectId: string,
    documentId: string,
    application: AutomationApplication,
    root: VerifiedProjectRoot,
  ): Promise<SourceBinding> {
    const row = this.readSourceRow(projectId, documentId);
    if (!row) throw new DomainError('NOT_FOUND', 'Project Document not found.', 404);
    const allowed = application === 'AUTOCAD' ? ['.dwg', '.dxf', '.dwt'] : ['.evo', '.dlx'];
    const extension = path.extname(row.filePath).toLowerCase();
    if (!allowed.includes(extension)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `The selected source is not valid for ${application}.`,
        400,
      );
    }
    const absolutePath = path.isAbsolute(row.filePath)
      ? path.resolve(row.filePath)
      : path.resolve(root, row.filePath);
    const relative = path.relative(root, absolutePath);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The source file is outside verified Project storage.',
        400,
      );
    }
    try {
      const metadata = await lstat(absolutePath);
      const real = await realpath(absolutePath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        real.toLowerCase() !== absolutePath.toLowerCase()
      ) {
        throw new Error('invalid');
      }
    } catch {
      throw new DomainError(
        'CONFLICT',
        'The registered source file is not currently available.',
        409,
      );
    }
    return { absolutePath, fileName: path.basename(row.filePath) };
  }

  private readSourceRow(projectId: string, documentId: string) {
    const row = this.database
      .prepare('SELECT project_id, file_path FROM project_documents WHERE id = ?')
      .get(documentId) as { project_id?: string; file_path?: string } | undefined;
    if (!row || row.project_id !== projectId || typeof row.file_path !== 'string') return null;
    return { filePath: row.file_path };
  }

  private read(
    context: ToolContext,
    source: SourceBinding | null,
    revision: RevisionBinding | null,
  ): ToolSessionRead {
    return {
      toolContextId: context.toolContextId,
      projectId: context.projectId,
      application: context.tool as AutomationApplication,
      artifactType: context.expectedArtifactType as P4cArtifactType,
      targetRevisionId: context.targetRevisionId,
      targetRevisionLabel: revision?.label ?? null,
      sourceDocumentId: context.sourceDocumentId,
      sourceFileName: source?.fileName ?? null,
      exportFolder: contextInboxPath(this.dataRoot, context.toolContextId),
      state: context.state,
      startedAt: context.openedAt,
    };
  }

  private async requireProject(projectId: string) {
    const project = await this.provider.getProject(projectId);
    if (!project) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    return project;
  }
}
