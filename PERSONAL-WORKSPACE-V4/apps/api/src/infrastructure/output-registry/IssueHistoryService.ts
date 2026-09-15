import type {
  CanonicalIssuePackageRecord,
  IssueHistoryDeliverable,
  IssueHistoryRecord,
} from '@scli/domain';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';

/**
 * REV-02A — canonical Issue History read model.
 *
 * READ-ONLY projection composing the existing canonical authorities:
 *
 *   canonical_issue_packages
 *         |
 *         v
 *   revision_package_deliverables
 *         |
 *         +----------------+
 *         |                |
 *         v                v
 *   DocumentSnapshot   GeneratedOutput
 *
 * It never writes the database, never mutates package lifecycle state and
 * never creates records. The legacy `revision_packages` compatibility table
 * and `workspace.revisionPackages` are deliberately NOT used: this service
 * reads only canonical_issue_packages and its immutable Deliverable sources.
 */
export class IssueHistoryService {
  public constructor(private readonly registry: CanonicalOutputRegistryStore) {}

  /**
   * Lists the canonical Issue History of ONE project, newest Issue first.
   *
   * Ordering (deterministic, service-level — no SQL change):
   *   - Issued packages: issuedAt DESC, packageSequence DESC, packageId ASC
   *   - Draft packages (issuedAt null): after all issued, createdAt DESC
   *
   * Soft degradation: a missing Deliverable source (broken snapshot/output
   * reference) degrades that single deliverable instead of failing the whole
   * history response. Cross-project references are never surfaced.
   */
  public list(projectId: string): IssueHistoryRecord[] {
    const packages = this.registry.listIssuePackages(projectId);
    const records = packages.map((issuePackage) => this.projectPackage(projectId, issuePackage));
    return records.sort((left, right) => {
      const leftIssuedAt = left.package.issuedAt;
      const rightIssuedAt = right.package.issuedAt;
      if (leftIssuedAt !== null && rightIssuedAt !== null) {
        const byIssuedAt = rightIssuedAt.localeCompare(leftIssuedAt);
        if (byIssuedAt !== 0) return byIssuedAt;
        const bySequence = right.package.packageSequence - left.package.packageSequence;
        if (bySequence !== 0) return bySequence;
        return left.package.packageId.localeCompare(right.package.packageId);
      }
      if (leftIssuedAt !== null) return -1;
      if (rightIssuedAt !== null) return 1;
      const byCreatedAt = right.package.createdAt.localeCompare(left.package.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return left.package.packageId.localeCompare(right.package.packageId);
    });
  }

  private projectPackage(
    projectId: string,
    issuePackage: CanonicalIssuePackageRecord,
  ): IssueHistoryRecord {
    const revision = this.resolveRevision(issuePackage);
    const deliverables = this.registry
      .listPackageDeliverables(issuePackage.packageId)
      .map((member) => this.projectDeliverable(projectId, member.sourceType, member.sourceId))
      .filter((deliverable): deliverable is IssueHistoryDeliverable => deliverable !== null);
    return {
      package: {
        packageId: issuePackage.packageId,
        packageSequence: issuePackage.packageSequence ?? 0,
        label: issuePackage.label,
        lifecycleState: issuePackage.lifecycleState,
        businessStatus: issuePackage.issuedAt === null ? 'Draft' : 'Issued',
        createdAt: issuePackage.createdAt,
        finalizedAt: issuePackage.finalizedAt,
        issuedAt: issuePackage.issuedAt,
        issuedBy:
          issuePackage.issuedById && issuePackage.issuedByName
            ? {
                actorId: issuePackage.issuedById,
                actorNameSnapshot: issuePackage.issuedByName,
              }
            : null,
      },
      revision: {
        revisionId: revision.revisionId,
        revisionSequence: revision.revisionSequence,
        revisionLabel: revision.revisionLabel,
        purpose: revision.purpose,
      },
      deliverables,
    };
  }

  private resolveRevision(issuePackage: CanonicalIssuePackageRecord) {
    if (!issuePackage.revisionId) {
      throw new Error(
        `Canonical Issue Package ${issuePackage.packageId} has no Revision identity.`,
      );
    }
    return this.registry.getRevision(issuePackage.revisionId);
  }

  private projectDeliverable(
    projectId: string,
    sourceType: 'GeneratedOutput' | 'DocumentSnapshot',
    sourceId: string,
  ): IssueHistoryDeliverable | null {
    try {
      if (sourceType === 'GeneratedOutput') {
        const output = this.registry.getOutput(sourceId);
        if (output.projectId !== projectId) return null;
        return {
          sourceType: 'GeneratedOutput',
          outputId: output.outputId,
          contentHash: output.contentHash ?? '',
          templateId: output.templateId,
          templateVersionId: output.templateVersionId,
          resolvedTemplateSnapshotHash: output.resolvedTemplateSnapshotHash,
        };
      }
      const snapshot = this.registry.getDocumentSnapshot(sourceId);
      if (snapshot.projectId !== projectId) return null;
      return {
        sourceType: 'DocumentSnapshot',
        deliverableId: snapshot.deliverableId,
        title: snapshot.title,
        contentHash: snapshot.contentHash,
        sizeBytes: snapshot.sizeBytes,
        locator: snapshot.locatorValue,
        sourceArtifactVersionId: snapshot.sourceArtifactVersionId,
      };
    } catch {
      // Soft degradation: a broken Deliverable source must not crash the whole
      // history response. The member is omitted; the package stays readable.
      return null;
    }
  }
}
