/**
 * P2C-03 — Safe Revision Delete domain model.
 *
 * A Safe Revision Delete is a destructive, recoverable aggregate operation on a
 * single canonical Revision. Its authority is server-only and never inferred
 * by the client: the UI only OFFERS the Delete action based on a server
 * `delete-eligibility` read, and the mutation re-runs the complete eligibility
 * check at deletion time.
 *
 * The durable operation is recorded in the v17 `revision_delete_operations`
 * table, which is BOTH the deletion recovery journal (in-flight operations
 * with their exact artifact manifest) AND the consumed-sequence tombstone
 * authority (a COMPLETED operation permanently records that the Revision UUID
 * and its sequence were consumed, so the allocator never reuses the number).
 */

/** Delete-operation states (deliberately NOT Package lifecycle states). */
export const revisionDeleteStates = [
  'PLANNED',
  'ARCHIVING',
  'ARCHIVED',
  'DB_COMMITTED',
  'COMPLETED',
  'FAILED_RECOVERABLE',
] as const;
export type RevisionDeleteState = (typeof revisionDeleteStates)[number];

/** Stable blocked-reason codes the server returns for an ineligible Revision. */
export const revisionDeleteBlockReasons = [
  'REVISION_FINALIZED',
  'REVISION_NOT_PREPARING',
  'REVISION_NOT_MANUAL',
  'REVISION_IN_RECOVERY',
  'PACKAGE_HISTORY_EXISTS',
  'COMPATIBILITY_HISTORY_EXISTS',
  'ARTIFACT_OWNERSHIP_UNPROVEN',
  'ARTIFACT_HASH_MISMATCH',
  'SOURCE_PATH_UNSAFE',
  'OWNER_PERMISSION_REQUIRED',
  'DELETE_OPERATION_NOT_RECOVERABLE',
] as const;
export type RevisionDeleteBlockReason = (typeof revisionDeleteBlockReasons)[number];

/** Explicit Inspector action; recovery is never inferred from canDelete alone. */
export const revisionDeleteActions = ['DELETE', 'RETRY_DELETE', 'NONE'] as const;
export type RevisionDeleteAction = (typeof revisionDeleteActions)[number];

/** Counts surfaced to the UI confirmation and persisted on the operation. */
export interface RevisionDeleteCounts {
  documentSnapshots: number;
  datasheetSnapshots: number;
  generatedOutputs: number;
}

/** Server-authoritative delete-eligibility truth. The UI never invents it. */
export interface RevisionDeleteEligibility {
  revisionId: string;
  deleteAction: RevisionDeleteAction;
  canDelete: boolean;
  blockedReasons: RevisionDeleteBlockReason[];
  counts: RevisionDeleteCounts;
}

/**
 * One owned artifact in the exact deletion manifest. Every member is a
 * Revision-owned canonical copy (never the mutable source), and every member
 * carries the persisted immutable content hash so archive moves can be
 * byte-verified before the delete commits.
 */
export interface RevisionDeleteManifestItem {
  /** Canonical row id (snapshot deliverable_id / output_id). */
  rowId: string;
  sourceType: 'DocumentSnapshot' | 'Datasheet' | 'GeneratedOutput';
  /** Deterministic project-relative locator of the owned artifact. */
  locatorValue: string;
  contentHash: string | null;
  sizeBytes: number | null;
  /** Project-relative archive destination (never an external path). */
  archiveDestination: string;
}

/** The exact persisted deletion manifest (serialized into artifact_manifest_json). */
export interface RevisionDeleteManifest {
  revisionId: string;
  items: RevisionDeleteManifestItem[];
}

/** Durable delete-operation record as returned by the authority. */
export interface RevisionDeleteOperationRecord {
  operationId: string;
  projectId: string;
  revisionId: string;
  revisionSequence: number;
  revisionLabel: string;
  actorId: string | null;
  actorNameSnapshot: string | null;
  state: RevisionDeleteState;
  failureReason: string | null;
  artifactManifest: RevisionDeleteManifest;
  documentSnapshotCount: number;
  datasheetSnapshotCount: number;
  generatedOutputCount: number;
  createdAt: string;
  archiveStartedAt: string | null;
  dbCommittedAt: string | null;
  completedAt: string | null;
  reusedByRevisionId: string | null;
  reusedAt: string | null;
  reusedByActorId: string | null;
  reusedByActorName: string | null;
  reuseReason: string | null;
  updatedAt: string;
}

/** Result of a delete mutation. Reusable across completed / recoverable outcomes. */
export type RevisionDeleteResult =
  | {
      outcome: 'DELETED';
      operation: RevisionDeleteOperationRecord;
    }
  | {
      outcome: 'RETRYABLE';
      operation: RevisionDeleteOperationRecord;
    };

/** The one server-derived, immediately reusable deleted Revision number. */
export interface RevisionReuseCandidate {
  deleteOperationId: string;
  revisionSequence: number;
  revisionLabel: string;
  deletedRevisionId: string;
  deletedAt: string;
}

/** Project-scoped eligibility returns at most one candidate. */
export interface RevisionReuseEligibility {
  candidate: RevisionReuseCandidate | null;
}

/** Strict client mutation authority: no sequence, label, identity, actor, or timestamp. */
export interface RevisionReuseInput {
  deleteOperationId: string;
  reason: string;
}
