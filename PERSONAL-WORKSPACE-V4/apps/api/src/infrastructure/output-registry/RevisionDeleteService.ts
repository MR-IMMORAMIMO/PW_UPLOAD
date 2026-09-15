import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AppUser,
  CanonicalRevisionRecord,
  Project,
  RevisionDeleteBlockReason,
  RevisionDeleteCounts,
  RevisionDeleteEligibility,
  RevisionDeleteManifest,
  RevisionDeleteManifestItem,
  RevisionDeleteOperationRecord,
  RevisionDeleteResult,
} from '@scli/domain';
import { DomainError, isManager } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import {
  CanonicalOutputRegistryStore,
  normalizeCanonicalProjectRelativePath,
} from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  resolveCanonicalArtifactPath,
  sha256File,
} from './canonical-artifact-files.js';

/**
 * P2C-03 — Safe Revision Delete orchestration authority.
 *
 * Deletes an accidentally-created unissued canonical MANUAL_DELIVERABLES
 * Revision that is PREPARING, has no immutable downstream history, and whose
 * owned filesystem artifacts are all provable. The delete is recoverable and
 * archive-first:
 *
 *   1. authorize (Owner/Admin)
 *   2. re-run the complete eligibility check at mutation time (never trusts a GET)
 *   3. create/reuse the ONE durable delete operation per Revision
 *   4. persist the exact artifact manifest
 *   5. ARCHIVE owned files using no-overwrite moves
 *   6. verify archived files
 *   7. BEGIN a DB transaction, re-check dependencies, delete Revision-owned rows,
 *      delete the canonical Revision, append activity, mark DB_COMMITTED, COMMIT
 *   8. mark COMPLETED
 *
 * A filesystem or DB failure never leaves the Revision unrecoverable: the
 * operation becomes FAILED_RECOVERABLE and a retry reuses the same operation
 * id + manifest, verifying already-archived members without duplicating them.
 */
export class RevisionDeleteService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly clock: () => Date,
    private readonly operationId: () => string = randomUUID,
  ) {}

  // ---------------------------------------------------------------------------
  // Eligibility (server truth; never invented by the UI)
  // ---------------------------------------------------------------------------

  public async deleteEligibility(
    project: Project,
    revisionId: string,
    actor: AppUser,
  ): Promise<RevisionDeleteEligibility> {
    const revision = this.resolveSameProjectRevision(project, revisionId);
    const existingOperation = this.registry.getRevisionDeleteOperationByProjectRevision(
      project.id,
      revision.revisionId,
    );
    const recoverableOperation =
      existingOperation?.state === 'FAILED_RECOVERABLE' ? existingOperation : null;
    const reasons = await this.eligibilityReasons(project, revision, actor, recoverableOperation);
    if (existingOperation && existingOperation.state !== 'FAILED_RECOVERABLE') {
      reasons.push('DELETE_OPERATION_NOT_RECOVERABLE');
    }
    const deleteAction =
      reasons.length > 0
        ? 'NONE'
        : recoverableOperation
          ? 'RETRY_DELETE'
          : existingOperation
            ? 'NONE'
            : 'DELETE';
    return {
      revisionId: revision.revisionId,
      deleteAction,
      canDelete: deleteAction !== 'NONE',
      blockedReasons: reasons,
      counts: this.countsFor(revision),
    };
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  public async deleteRevision(
    project: Project,
    revisionId: string,
    actor: AppUser,
  ): Promise<RevisionDeleteResult> {
    // 1 — authorize at mutation time.
    this.assertCanDelete(actor);

    // Idempotent completed/tombstone result: if the Revision is already gone
    // (its deletion committed) but a durable delete operation exists, return
    // the truthful completed tombstone instead of an ambiguous not-found.
    // Retry always converges on the SAME operation id and manifest.
    const existingOperation = this.registry.getRevisionDeleteOperationByProjectRevision(
      project.id,
      revisionId,
    );
    if (existingOperation) {
      if (existingOperation.state === 'COMPLETED') {
        return { outcome: 'DELETED', operation: existingOperation };
      }
      if (existingOperation.state === 'DB_COMMITTED') {
        const completed = this.registry.setRevisionDeleteOperationState(
          existingOperation.operationId,
          'COMPLETED',
          { completedAt: this.now(), updatedAt: this.now() },
        );
        return { outcome: 'DELETED', operation: completed };
      }
    }

    // 2) re-run the complete eligibility check at mutation time. A Revision
    // already fully deleted with no tombstone is treated as not-found.
    let revision: CanonicalRevisionRecord;
    try {
      revision = this.resolveSameProjectRevision(project, revisionId);
    } catch (error) {
      if (existingOperation) {
        // The Revision was archived and DB-deleted on a prior attempt but final
        // bookkeeping never completed: converge on the durable operation.
        const completed = this.registry.setRevisionDeleteOperationState(
          existingOperation.operationId,
          'COMPLETED',
          { completedAt: this.now(), updatedAt: this.now() },
        );
        return { outcome: 'DELETED', operation: completed };
      }
      throw error;
    }
    const reasons = await this.eligibilityReasons(
      project,
      revision,
      actor,
      existingOperation ?? null,
    );
    if (reasons.length > 0) {
      throw new DomainError(
        'CONFLICT',
        `This Revision cannot be deleted: ${reasons.join(', ')}.`,
        409,
      );
    }

    const workspace = this.personalStore.getWorkspace(project.id);
    const projectRoot = workspace.folderPath ?? null;
    if (!projectRoot) {
      throw new DomainError(
        'CONFLICT',
        'The Project folder is not connected; the Revision cannot be safely archived.',
        409,
      );
    }

    const now = this.now();
    const operationId = this.operationId();
    const manifest = this.buildManifest(revision, operationId);
    const counts = this.countsFor(revision);

    // 3) create/reuse the durable delete operation inside a transaction so the
    //    operation row and the eventual DB commit are atomic. On a FAILED_RECOVERABLE
    //    retry this REUSES the SAME operation id and its persisted manifest. The
    //    operation id is decided HERE (before the archive namespace is built) so a
    //    retry always resolves the same operation-scoped archive directory.
    const database = this.registry.getSharedDatabase();
    let operation: RevisionDeleteOperationRecord;
    database.exec('BEGIN IMMEDIATE');
    try {
      operation = this.registry.createOrReuseRevisionDeleteOperation({
        operationId,
        projectId: revision.projectId,
        revisionId: revision.revisionId,
        revisionSequence: revision.revisionSequence,
        revisionLabel: revision.revisionLabel,
        actorId: actor.id,
        actorNameSnapshot: actor.displayName,
        manifest,
        counts,
        createdAt: now,
      });
      if (operation.state === 'FAILED_RECOVERABLE') {
        // Retry: return to ARCHIVING so the (idempotent) archive pass re-runs.
        operation = this.registry.setRevisionDeleteOperationState(
          operation.operationId,
          'ARCHIVING',
          {
            failureReason: null,
            archiveStartedAt: now,
            updatedAt: now,
          },
        );
      } else {
        operation = this.registry.setRevisionDeleteOperationState(
          operation.operationId,
          'PLANNED',
          {
            updatedAt: now,
          },
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Preserve the primary error.
      }
      throw error;
    }

    // 4) ARCHIVE owned files (no-overwrite moves), then verify.
    try {
      operation = this.registry.setRevisionDeleteOperationState(
        operation.operationId,
        'ARCHIVING',
        { archiveStartedAt: now, updatedAt: now },
      );
      await this.archiveManifest(operation, projectRoot);
      operation = this.registry.setRevisionDeleteOperationState(operation.operationId, 'ARCHIVED', {
        updatedAt: now,
      });
    } catch (error) {
      await this.markRecoverable(operation.operationId, error);
      return {
        outcome: 'RETRYABLE',
        operation: this.registry.getRevisionDeleteOperation(operation.operationId),
      };
    }

    // 5) DB transaction: FULL in-transaction recheck, delete owned rows, delete
    //    Revision, append activity, mark DB_COMMITTED, COMMIT. The recheck
    //    re-reads the Revision and every dependency inside the open transaction
    //    (H1) so a Revision that changed since eligibility (e.g. became
    //    FINALIZED) is never deleted.
    database.exec('BEGIN IMMEDIATE');
    try {
      this.registry.assertRevisionDeleteStillEligible(
        revision.projectId,
        revision.revisionId,
        revision.revisionSequence,
      );
      this.registry.deleteCanonicalRevisionRows(revision.revisionId);
      this.personalStore.operations.recordWorkspaceActivity(
        revision.projectId,
        'Revision',
        revision.revisionId,
        'DELETED',
        `Deleted Revision ${revision.revisionLabel}`,
        `Deleted revision ${revision.revisionLabel} (${revision.revisionId}) by ${actor.displayName}.`,
        now,
      );
      operation = this.registry.setRevisionDeleteOperationState(
        operation.operationId,
        'DB_COMMITTED',
        { dbCommittedAt: now, updatedAt: now },
      );
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Preserve the primary error.
      }
      await this.markRecoverable(operation.operationId, error);
      return {
        outcome: 'RETRYABLE',
        operation: this.registry.getRevisionDeleteOperation(operation.operationId),
      };
    }

    // 6) Mark COMPLETED (final bookkeeping; if interrupted, a retry converges
    //    because the Revision is already gone and the tombstone is DB_COMMITTED).
    operation = this.registry.setRevisionDeleteOperationState(operation.operationId, 'COMPLETED', {
      completedAt: now,
      updatedAt: now,
    });
    return { outcome: 'DELETED', operation };
  }

  // -------------------------------------------------------------------------
  // Eligibility internals
  // -------------------------------------------------------------------------

  private async eligibilityReasons(
    project: Project,
    revision: CanonicalRevisionRecord,
    actor: AppUser,
    existingOperation: RevisionDeleteOperationRecord | null,
  ): Promise<RevisionDeleteBlockReason[]> {
    const reasons: RevisionDeleteBlockReason[] = [];
    if (!this.canDelete(actor)) reasons.push('OWNER_PERMISSION_REQUIRED');

    if (revision.lifecycleState === 'FINALIZED') reasons.push('REVISION_FINALIZED');
    if (revision.lifecycleState !== 'PREPARING') reasons.push('REVISION_NOT_PREPARING');
    const operation = revision.projectSnapshot?.canonicalOperation;
    if (operation !== 'MANUAL_DELIVERABLES') reasons.push('REVISION_NOT_MANUAL');
    if (revision.lifecycleState === 'FAILED_RECOVERABLE') reasons.push('REVISION_IN_RECOVERY');

    if (this.registry.countIssuePackagesForRevision(revision.revisionId) > 0) {
      reasons.push('PACKAGE_HISTORY_EXISTS');
    }
    if (this.registry.countCompatibilityRevisionsForProject(project.id, revision.revisionId) > 0) {
      reasons.push('COMPATIBILITY_HISTORY_EXISTS');
    }
    // H3 — direct fail-closed probe of the legacy revision_packages authority.
    // Blocks deletion when a legacy package references this Revision's
    // sequence/project even if a compatibility project_revisions row is absent.
    if (
      this.registry.countLegacyRevisionPackageDependenciesForProject(
        project.id,
        revision.revisionSequence,
      ) > 0
    ) {
      reasons.push('COMPATIBILITY_HISTORY_EXISTS');
    }

    // Filesystem proof — every owned artifact must be a real, hash-verifiable
    // canonical copy under the project root. On a retry, an artifact that was
    // already moved to its persisted archive destination (e.g. a DB failure
    // after a complete archive) is accepted as proven at its archive path.
    const projectRoot = this.personalStore.getWorkspace(project.id).folderPath ?? null;
    const proof = await this.proveOwnedArtifacts(revision, projectRoot, existingOperation);
    if (proof.unprovenOwnership) reasons.push('ARTIFACT_OWNERSHIP_UNPROVEN');
    if (proof.hashMismatch) reasons.push('ARTIFACT_HASH_MISMATCH');
    if (proof.unsafePath) reasons.push('SOURCE_PATH_UNSAFE');

    return reasons;
  }

  private countsFor(revision: CanonicalRevisionRecord): RevisionDeleteCounts {
    const snapshots = this.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    // Generated Outputs = ALL canonical output members owned by this Revision.
    // This matches the Revision Deliverables read (listRevisionDeliverables
    // emits one GeneratedOutput member per canonical_outputs row) and the
    // delete authority (deleteCanonicalRevisionRows removes every output for
    // the Revision). A provenance filter here would silently under-count, so
    // counts and destructive authority stay on ONE source of truth.
    const outputs = this.registry.listOutputsForRevision(revision.revisionId);
    return {
      documentSnapshots: snapshots.filter((s) => s.category !== 'Datasheet').length,
      datasheetSnapshots: snapshots.filter((s) => s.category === 'Datasheet').length,
      generatedOutputs: outputs.length,
    };
  }

  private buildManifest(
    revision: CanonicalRevisionRecord,
    operationId: string,
  ): RevisionDeleteManifest {
    // H2 — operation-scoped archive namespace. Every new Revision delete archive
    // lives under INTERNAL/REVISION_DELETE_ARCHIVE/<operationId>/<member-name>.
    // member-name stays deterministic: canonical row id + safe basename. A retry
    // reuses the SAME operationId directory (the manifest is persisted with the
    // exact destination), and two operations can never share a namespace.
    const archivePrefix = `INTERNAL/REVISION_DELETE_ARCHIVE/${operationId}`;
    const items: RevisionDeleteManifestItem[] = [];
    const snapshots = this.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    for (const snapshot of snapshots) {
      const archiveRelative = normalizeCanonicalProjectRelativePath(
        `${archivePrefix}/${snapshot.deliverableId}_${path.basename(snapshot.locatorValue)}`,
      );
      items.push({
        rowId: snapshot.deliverableId,
        sourceType: snapshot.category === 'Datasheet' ? 'Datasheet' : 'DocumentSnapshot',
        locatorValue: snapshot.locatorValue,
        contentHash: snapshot.contentHash,
        sizeBytes: snapshot.sizeBytes,
        archiveDestination: archiveRelative,
      });
    }
    const outputs = this.registry.listOutputsForRevision(revision.revisionId);
    for (const output of outputs) {
      if (output.provenanceClassification !== 'CANONICAL') continue;
      if (output.locatorKind !== 'PROJECT_RELATIVE' || !output.locatorValue) continue;
      const archiveRelative = normalizeCanonicalProjectRelativePath(
        `${archivePrefix}/${output.outputId}_${path.basename(output.locatorValue)}`,
      );
      items.push({
        rowId: output.outputId,
        sourceType: 'GeneratedOutput',
        locatorValue: output.locatorValue,
        contentHash: output.contentHash,
        sizeBytes: null,
        archiveDestination: archiveRelative,
      });
    }
    return { revisionId: revision.revisionId, items };
  }

  /** Tri-state filesystem ownership proof over every owned artifact. */
  private async proveOwnedArtifacts(
    revision: CanonicalRevisionRecord,
    projectRoot: string | null,
    existingOperation: RevisionDeleteOperationRecord | null,
  ): Promise<{ unprovenOwnership: boolean; hashMismatch: boolean; unsafePath: boolean }> {
    const result = { unprovenOwnership: false, hashMismatch: false, unsafePath: false };
    if (!projectRoot) {
      result.unprovenOwnership = true;
      return result;
    }
    // On a retry, the persisted operation manifest records which artifacts were
    // already moved to their archive destination. An owned row whose source is
    // absent but whose archive member exists (with a matching hash) is proven.
    const archivedByRowId = new Map<string, RevisionDeleteManifestItem>();
    if (existingOperation) {
      for (const item of existingOperation.artifactManifest.items) {
        archivedByRowId.set(item.rowId, item);
      }
    }
    const snapshots = this.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    for (const snapshot of snapshots) {
      const target = resolveCanonicalArtifactPath(projectRoot, snapshot.locatorValue);
      const kind = await artifactPathKind(target);
      if (kind !== 'FILE') {
        const archived = archivedByRowId.get(snapshot.deliverableId);
        if (archived) {
          const archivedTarget = resolveCanonicalArtifactPath(
            projectRoot,
            archived.archiveDestination,
          );
          const archivedKind = await artifactPathKind(archivedTarget);
          if (archivedKind === 'FILE') {
            if (archived.contentHash) {
              const current = await sha256File(archivedTarget);
              if (current !== archived.contentHash) result.hashMismatch = true;
            }
            continue;
          }
        }
        result.unprovenOwnership = true;
        continue;
      }
      if (snapshot.contentHash) {
        const current = await sha256File(target);
        if (current !== snapshot.contentHash) result.hashMismatch = true;
      }
    }
    const outputs = this.registry.listOutputsForRevision(revision.revisionId);
    for (const output of outputs) {
      if (output.locatorKind !== 'PROJECT_RELATIVE' || !output.locatorValue) continue;
      const target = resolveCanonicalArtifactPath(projectRoot, output.locatorValue);
      const kind = await artifactPathKind(target);
      if (kind !== 'FILE') {
        const archived = archivedByRowId.get(output.outputId);
        if (archived) {
          const archivedTarget = resolveCanonicalArtifactPath(
            projectRoot,
            archived.archiveDestination,
          );
          const archivedKind = await artifactPathKind(archivedTarget);
          if (archivedKind === 'FILE') {
            if (archived.contentHash) {
              const current = await sha256File(archivedTarget);
              if (current !== archived.contentHash) result.hashMismatch = true;
            }
            continue;
          }
        }
        result.unprovenOwnership = true;
        continue;
      }
      if (output.contentHash) {
        const current = await sha256File(target);
        if (current !== output.contentHash) result.hashMismatch = true;
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Archive
  // -------------------------------------------------------------------------

  private async archiveManifest(
    operation: RevisionDeleteOperationRecord,
    projectRoot: string,
  ): Promise<void> {
    for (const item of operation.artifactManifest.items) {
      const source = resolveCanonicalArtifactPath(projectRoot, item.locatorValue);
      const destination = resolveCanonicalArtifactPath(projectRoot, item.archiveDestination);
      const destKind = await artifactPathKind(destination);
      if (destKind === 'FILE') {
        // Already archived on a prior attempt: verify it matches the expected
        // hash and skip the move (idempotent retry).
        if (item.contentHash) {
          const current = await sha256File(destination);
          if (current !== item.contentHash) {
            throw new DomainError(
              'CONFLICT',
              'An archived artifact already exists with a mismatched hash.',
              409,
            );
          }
        }
        continue;
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
    }
  }

  private async markRecoverable(operationId: string, error: unknown): Promise<void> {
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Revision deletion failed.';
    this.registry.setRevisionDeleteOperationState(operationId, 'FAILED_RECOVERABLE', {
      failureReason: message.slice(0, 1_000),
      updatedAt: this.now(),
    });
  }

  private resolveSameProjectRevision(
    project: Project,
    revisionId: string,
  ): CanonicalRevisionRecord {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id) {
      throw new DomainError('NOT_FOUND', 'Revision not found.', 404);
    }
    return revision;
  }

  private canDelete(actor: AppUser): boolean {
    return actor.isActive && isManager(actor);
  }

  private assertCanDelete(actor: AppUser): void {
    if (!this.canDelete(actor)) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Owner/Manager authorization is required to delete a Revision.',
        403,
      );
    }
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
