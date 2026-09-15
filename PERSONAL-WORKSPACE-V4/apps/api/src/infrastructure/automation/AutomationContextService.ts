import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from '@scli/domain';
import type { ToolContext } from '@scli/domain';
import type { AutomationApplication } from '@scli/contracts';
import { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore';
import { ToolContextService } from '../managed-artifact/ToolContextService';

export interface OpenAutomationContextRequest {
  projectId: string;
  application: AutomationApplication;
  expectedArtifactType: string;
  targetRevisionId?: string | null;
  sourceDocumentId?: string | null;
}

export interface OpenManualCaptureContextRequest extends OpenAutomationContextRequest {
  actorId: string;
  actorName: string;
}

/**
 * Phase 4A's durable integration-context authority. It binds exact UUIDs and
 * lifecycle only; file detection/routing and output classification are later
 * Phase 4 slices.
 */
export class AutomationContextService {
  private readonly database: DatabaseSync;
  private readonly contexts: ToolContextService;
  private readonly now: () => Date;

  public constructor(database: DatabaseSync, store: ManagedArtifactStore, now = () => new Date()) {
    this.database = database;
    this.contexts = new ToolContextService(store);
    this.now = now;
  }

  public expireActiveContextsAfterRestart(): number {
    const active = this.contexts
      .list()
      .filter((context) => context.state === 'LIVE' || context.state === 'REBOUND');
    const at = this.now().toISOString();
    for (const context of active) this.contexts.expire(context.toolContextId, at);
    return active.length;
  }

  public open(input: OpenAutomationContextRequest): ToolContext {
    if (input.targetRevisionId) this.assertRevisionBinding(input.projectId, input.targetRevisionId);
    if (input.sourceDocumentId) this.assertDocumentBinding(input.projectId, input.sourceDocumentId);
    return this.contexts.open({
      projectId: input.projectId,
      targetRevisionId: input.targetRevisionId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      tool: input.application,
      expectedArtifactType: input.expectedArtifactType,
      mode: 'EXTERNAL_OUTPUT_SESSION',
      channel: 'DEDICATED_SESSION_INBOX',
      openedAt: this.now().toISOString(),
    });
  }

  /** P4C one-shot manual intake authority; never enables automatic capture. */
  public openManual(input: OpenManualCaptureContextRequest): ToolContext {
    if (input.targetRevisionId) this.assertRevisionBinding(input.projectId, input.targetRevisionId);
    return this.contexts.open({
      projectId: input.projectId,
      targetRevisionId: input.targetRevisionId ?? null,
      sourceDocumentId: null,
      tool: input.application,
      expectedArtifactType: input.expectedArtifactType,
      mode: 'MANUAL_EXPLICIT',
      channel: 'MANUAL_PICKER_INBOX',
      openedAt: this.now().toISOString(),
    });
  }

  public get(toolContextId: string): ToolContext {
    return this.contexts.get(toolContextId);
  }

  public list(projectId: string): ToolContext[] {
    return this.contexts.list(projectId);
  }

  public expire(toolContextId: string): ToolContext {
    return this.contexts.expire(toolContextId, this.now().toISOString());
  }

  public rebind(toolContextId: string): ToolContext {
    const context = this.contexts.get(toolContextId);
    if (context.targetRevisionId) {
      this.assertRevisionBinding(context.projectId, context.targetRevisionId);
    }
    if (context.sourceDocumentId) {
      this.assertDocumentBinding(context.projectId, context.sourceDocumentId);
    }
    return this.contexts.rebind(toolContextId, this.now().toISOString());
  }

  public close(toolContextId: string): ToolContext {
    return this.contexts.close(toolContextId, this.now().toISOString());
  }

  private assertRevisionBinding(projectId: string, revisionId: string): void {
    const row = this.database
      .prepare('SELECT project_id FROM canonical_revisions WHERE revision_id = ?')
      .get(revisionId) as { project_id?: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Canonical Revision not found.', 404);
    if (row.project_id !== projectId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Automation context Revision must belong to the selected Project.',
        400,
      );
    }
  }

  private assertDocumentBinding(projectId: string, documentId: string): void {
    const row = this.database
      .prepare('SELECT project_id FROM project_documents WHERE id = ?')
      .get(documentId) as { project_id?: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project Document not found.', 404);
    if (row.project_id !== projectId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Automation context source Document must belong to the selected Project.',
        400,
      );
    }
  }
}
