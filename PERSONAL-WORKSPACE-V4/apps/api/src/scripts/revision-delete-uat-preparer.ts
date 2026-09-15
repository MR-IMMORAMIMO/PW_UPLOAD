import { z } from 'zod';
import type { AppUser, Project, RevisionDeleteOperationRecord } from '@scli/domain';
import type { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore';
import type { RevisionDeleteService } from '../infrastructure/output-registry/RevisionDeleteService';

export const REVISION_DELETE_UAT_TEST_PROJECT_ID = '0f4daaad-95a2-4199-b237-0920729dc82a' as const;
export const REVISION_DELETE_UAT_TEST_PROJECT_CODE = '001_SCT260809_TEST' as const;
export const REVISION_DELETE_UAT_GOLDEN_PROJECT_ID =
  '440bef8e-5799-4e96-87e9-5d617320b6a4' as const;
export const REVISION_DELETE_UAT_CONFIRMATION = 'PREPARE_TEST_REVISION_DELETE_ARCHIVE' as const;

const uuidSchema = z.string().uuid();

export interface RevisionDeleteUatPreparationResult {
  readonly projectId: string;
  readonly revisionId: string;
  readonly operationId: string;
  readonly operationState: 'ARCHIVED';
  readonly archivedMemberCount: number;
  readonly archiveNamespace: string;
  readonly nextRequiredStep: 'RESTART DESKTOP APPLICATION';
}

class ArchiveMilestoneIntercepted extends Error {
  public constructor(public readonly operationId: string) {
    super('UAT preparation intentionally stopped after the ARCHIVED milestone.');
    this.name = 'ArchiveMilestoneIntercepted';
  }
}

class ArchiveBoundaryReached extends Error {
  public constructor(public readonly operationId: string) {
    super('UAT preparation boundary reached before FAILED_RECOVERABLE was written.');
    this.name = 'ArchiveBoundaryReached';
  }
}

/**
 * Source-only UAT utility. It drives the real delete service through ARCHIVED,
 * then deterministically stops before the DB deletion transaction. It is not
 * imported by the server, exposed through HTTP, or included in the desktop UI.
 */
export class RevisionDeleteUatPreparer {
  public constructor(
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly deleteService: RevisionDeleteService,
  ) {}

  public async prepare(
    project: Project,
    revisionIdInput: string,
    actor: AppUser,
  ): Promise<RevisionDeleteUatPreparationResult> {
    this.assertProject(project);
    const revisionId = this.parseRevisionId(revisionIdInput);
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id) {
      throw new Error('The exact Revision UUID does not belong to the allowlisted TEST project.');
    }

    const existingOperation = this.registry.getRevisionDeleteOperationByProjectRevision(
      project.id,
      revisionId,
    );
    if (existingOperation) {
      throw new Error(
        `Revision Delete UAT preparation refused: the Revision already has operation ${existingOperation.operationId} in state ${existingOperation.state}.`,
      );
    }

    const eligibility = await this.deleteService.deleteEligibility(project, revisionId, actor);
    if (eligibility.deleteAction !== 'DELETE' || !eligibility.canDelete) {
      const reasons = eligibility.blockedReasons.join(', ') || 'DELETE_NOT_AVAILABLE';
      throw new Error(`Revision Delete UAT preparation refused by Safe Delete: ${reasons}.`);
    }
    const memberCount =
      eligibility.counts.documentSnapshots +
      eligibility.counts.datasheetSnapshots +
      eligibility.counts.generatedOutputs;
    if (memberCount < 1) {
      throw new Error(
        'Revision Delete UAT preparation requires at least one proven Revision-owned member.',
      );
    }

    const originalSetState = this.registry.setRevisionDeleteOperationState;
    let archivedOperationId: string | null = null;
    this.registry.setRevisionDeleteOperationState = ((operationId, state, fields) => {
      if (
        state === 'FAILED_RECOVERABLE' &&
        archivedOperationId !== null &&
        operationId === archivedOperationId
      ) {
        throw new ArchiveBoundaryReached(operationId);
      }
      const operation = originalSetState.call(this.registry, operationId, state, fields);
      if (state === 'ARCHIVED') {
        archivedOperationId = operation.operationId;
        throw new ArchiveMilestoneIntercepted(operation.operationId);
      }
      return operation;
    }) as typeof this.registry.setRevisionDeleteOperationState;

    let boundaryReached = false;
    try {
      await this.deleteService.deleteRevision(project, revisionId, actor);
    } catch (error) {
      if (error instanceof ArchiveBoundaryReached && error.operationId === archivedOperationId) {
        boundaryReached = true;
      } else {
        throw error;
      }
    } finally {
      this.registry.setRevisionDeleteOperationState = originalSetState;
    }
    if (!boundaryReached || !archivedOperationId) {
      throw new Error('Revision Delete UAT preparation did not reach the ARCHIVED boundary.');
    }

    const operation = this.registry.getRevisionDeleteOperation(archivedOperationId);
    this.assertArchivedResult(project, revisionId, operation, memberCount);
    // DB deletion must not have run. This lookup is a final fail-closed proof.
    this.registry.getRevision(revisionId);

    const archiveNamespace = `INTERNAL/REVISION_DELETE_ARCHIVE/${operation.operationId}`;
    return {
      projectId: project.id,
      revisionId,
      operationId: operation.operationId,
      operationState: 'ARCHIVED',
      archivedMemberCount: operation.artifactManifest.items.length,
      archiveNamespace,
      nextRequiredStep: 'RESTART DESKTOP APPLICATION',
    };
  }

  private assertProject(project: Project): void {
    if (project.id === REVISION_DELETE_UAT_GOLDEN_PROJECT_ID) {
      throw new Error('Golden project is hard-rejected: semantic acceptance data is read-only.');
    }
    if (project.id !== REVISION_DELETE_UAT_TEST_PROJECT_ID) {
      throw new Error('Revision Delete UAT preparation is allowlisted only for the TEST project.');
    }
    if (project.projectCode !== REVISION_DELETE_UAT_TEST_PROJECT_CODE) {
      throw new Error('The allowlisted TEST project code does not match canonical project data.');
    }
  }

  private parseRevisionId(input: string): string {
    const parsed = uuidSchema.safeParse(input);
    if (!parsed.success) throw new Error('An explicit valid Revision UUID is required.');
    return parsed.data;
  }

  private assertArchivedResult(
    project: Project,
    revisionId: string,
    operation: RevisionDeleteOperationRecord,
    expectedMemberCount: number,
  ): void {
    if (
      operation.projectId !== project.id ||
      operation.revisionId !== revisionId ||
      operation.artifactManifest.revisionId !== revisionId
    ) {
      throw new Error('Persisted Revision Delete operation identity does not match the request.');
    }
    if (operation.state !== 'ARCHIVED') {
      throw new Error(`Expected ARCHIVED operation state; received ${operation.state}.`);
    }
    if (operation.artifactManifest.items.length !== expectedMemberCount) {
      throw new Error('Persisted manifest count does not match server eligibility counts.');
    }
    const archivePrefix = `INTERNAL/REVISION_DELETE_ARCHIVE/${operation.operationId}/`;
    if (
      operation.artifactManifest.items.some(
        (item) => !item.archiveDestination.startsWith(archivePrefix),
      )
    ) {
      throw new Error('Persisted manifest contains an unexpected archive namespace.');
    }
  }
}
