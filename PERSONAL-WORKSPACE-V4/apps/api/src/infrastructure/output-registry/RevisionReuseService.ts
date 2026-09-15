import type {
  AppUser,
  CanonicalRevisionRecord,
  Project,
  RevisionReuseEligibility,
  RevisionReuseInput,
} from '@scli/domain';
import { DomainError, isManager } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { luminaireSnapshotList, projectSnapshotForManual } from './RevisionDeliverableService.js';

/** P2C-04 server authority for deliberate immediate Revision number reuse. */
export class RevisionReuseService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly clock: () => Date,
  ) {}

  public eligibility(project: Project, actor: AppUser): RevisionReuseEligibility {
    this.assertCanReuse(actor);
    return { candidate: this.registry.findReusableRevisionCandidate(project.id) };
  }

  public reuseRevision(
    project: Project,
    actor: AppUser,
    input: RevisionReuseInput,
  ): CanonicalRevisionRecord {
    this.assertCanReuse(actor);
    const workspace = this.personalStore.getWorkspace(project.id);
    const reusedAt = this.clock().toISOString();
    return this.registry.reuseRevisionNumber(
      {
        projectId: project.id,
        projectSnapshot: projectSnapshotForManual(project, workspace),
        luminaires: luminaireSnapshotList(workspace),
        createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
      },
      input.deleteOperationId,
      input.reason,
      reusedAt,
      (revision) => {
        this.personalStore.operations.recordWorkspaceActivity(
          project.id,
          'Revision',
          revision.revisionId,
          'REV_SEQUENCE_REUSED',
          `Reused Revision number ${revision.revisionLabel}`,
          `${revision.revisionLabel} was reused as a new Revision by ${actor.displayName}. Reason: ${input.reason.trim()}`,
          reusedAt,
        );
      },
    );
  }

  private assertCanReuse(actor: AppUser): void {
    if (!actor.isActive || !isManager(actor)) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Owner/Manager authorization is required to reuse a Revision number.',
        403,
      );
    }
  }
}
