import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';

/**
 * P2C-03 — narrow startup reconciliation for incomplete Revision Delete
 * operations.
 *
 * A durable delete operation may be left mid-flight by a process interruption.
 * This reconciler inspects the durable operation state and converges it safely:
 *
 *   - DB_COMMITTED: the Revision rows were already deleted and the deletion
 *     transaction committed. The only missing step is the final COMPLETED
 *     bookkeeping, so the reconciler completes it (no destructive guessing —
 *     the deletion is already durable).
 *   - Any other non-terminal state (PLANNED / ARCHIVING / ARCHIVED): the
 *     delete is NOT complete and must NOT be silently finished. It is surfaced
 *     as FAILED_RECOVERABLE so the owner can Retry Delete, which reuses the
 *     SAME operation id and manifest and verifies already-archived members.
 *
 * COMPLETED operations are left untouched. FAILED_RECOVERABLE operations are
 * left untouched (their retry is owner-driven).
 *
 * No Package lifecycle state is reused. No filesystem mutation happens here.
 */
export class RevisionDeleteReconciler {
  public constructor(private readonly registry: CanonicalOutputRegistryStore) {}

  /** Returns a report of reconciled operations for startup logging. */
  public reconcile(): {
    completed: string[];
    surfacedRecoverable: string[];
  } {
    const completed: string[] = [];
    const surfacedRecoverable: string[] = [];
    const operations = this.registry.listRevisionDeleteOperations();
    for (const operation of operations) {
      if (operation.state === 'COMPLETED' || operation.state === 'FAILED_RECOVERABLE') continue;
      if (operation.state === 'DB_COMMITTED') {
        this.registry.setRevisionDeleteOperationState(operation.operationId, 'COMPLETED', {
          completedAt: this.now(),
          updatedAt: this.now(),
        });
        completed.push(operation.operationId);
        continue;
      }
      // PLANNED / ARCHIVING / ARCHIVED — deletion is not durable; surface for owner retry.
      this.registry.setRevisionDeleteOperationState(operation.operationId, 'FAILED_RECOVERABLE', {
        failureReason:
          'Revision deletion was interrupted before its database deletion committed; Retry Delete to converge.',
        updatedAt: this.now(),
      });
      surfacedRecoverable.push(operation.operationId);
    }
    return { completed, surfacedRecoverable };
  }

  private now(): string {
    return new Date().toISOString();
  }
}
