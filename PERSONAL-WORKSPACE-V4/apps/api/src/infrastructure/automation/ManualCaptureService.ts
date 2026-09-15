import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CreateManualCaptureContextInput,
  ManualCaptureContextResponse,
} from '@scli/contracts';
import { DomainError, type AppUser, type DataProvider } from '@scli/domain';
import { ProjectStorageService } from '../../project-storage-service.js';
import { contextInboxPath } from './CaptureInboxBoundary.js';
import { findP4bCapturePolicy, P4B_CAPTURE_POLICIES } from './CapturePolicy.js';
import { AutomationContextService } from './AutomationContextService.js';
import { DesktopHandoffService } from './DesktopHandoffService.js';

export interface ManualAdmissionAudit {
  actorId: string;
  actorName: string;
  authorizedAt: string;
}

export function manualAdmissionAuditPath(dataRoot: string, toolContextId: string): string {
  return path.join(dataRoot, 'automation-sessions', toolContextId, 'manual-admission.json');
}

export class ManualCaptureService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly provider: DataProvider,
    private readonly storage: ProjectStorageService,
    private readonly contexts: AutomationContextService,
    private readonly handoffs: DesktopHandoffService,
    private readonly dataRoot: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    projectId: string,
    input: CreateManualCaptureContextInput,
    actor: AppUser,
  ): Promise<ManualCaptureContextResponse> {
    const policy = P4B_CAPTURE_POLICIES.find(
      (candidate) => candidate.artifactType === input.artifactType,
    );
    if (!policy || !findP4bCapturePolicy(policy.application, input.artifactType)) {
      throw new DomainError('VALIDATION_ERROR', 'Manual capture type is not supported.', 400);
    }
    const project = await this.provider.getProject(projectId);
    if (!project) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    await this.storage.resolveVerifiedProjectRoot(project);
    let revisionLabel: string | null = null;
    if (policy.level === 'REVISION') {
      if (!input.targetRevisionId) {
        throw new DomainError('VALIDATION_ERROR', 'A PREPARING Revision is required.', 400);
      }
      const row = this.database
        .prepare(
          'SELECT project_id, revision_label, lifecycle_state FROM canonical_revisions WHERE revision_id = ?',
        )
        .get(input.targetRevisionId) as
        { project_id: string; revision_label: string; lifecycle_state: string } | undefined;
      if (!row || row.project_id !== projectId) {
        throw new DomainError('NOT_FOUND', 'Canonical Revision not found for this Project.', 404);
      }
      if (row.lifecycle_state !== 'PREPARING') {
        throw new DomainError(
          'INVALID_TRANSITION',
          'The selected Revision must be PREPARING.',
          409,
        );
      }
      revisionLabel = row.revision_label;
    } else if (input.targetRevisionId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Project-level capture cannot target a Revision.',
        400,
      );
    }
    const context = this.contexts.openManual({
      projectId,
      application: policy.application,
      expectedArtifactType: policy.artifactType,
      targetRevisionId: input.targetRevisionId ?? null,
      sourceDocumentId: null,
      actorId: actor.id,
      actorName: actor.displayName,
    });
    const inboxPath = contextInboxPath(this.dataRoot, context.toolContextId);
    mkdirSync(inboxPath, { recursive: true });
    const audit: ManualAdmissionAudit = {
      actorId: actor.id,
      actorName: actor.displayName,
      authorizedAt: this.now().toISOString(),
    };
    const descriptor = openSync(
      manualAdmissionAuditPath(this.dataRoot, context.toolContextId),
      'wx',
      0o600,
    );
    try {
      writeFileSync(descriptor, `${JSON.stringify(audit)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return {
      toolSession: {
        toolContextId: context.toolContextId,
        projectId,
        application: policy.application,
        artifactType: policy.artifactType,
        targetRevisionId: context.targetRevisionId,
        targetRevisionLabel: revisionLabel,
        sourceDocumentId: null,
        sourceFileName: null,
        state: context.state,
        startedAt: context.openedAt,
      },
      pickerHandoff: this.handoffs.create({
        action: 'MANUAL_FILE_PICK',
        projectId,
        toolContextId: context.toolContextId,
        inboxPath,
        allowedExtensions: [...policy.extensions],
      }),
    };
  }
}
