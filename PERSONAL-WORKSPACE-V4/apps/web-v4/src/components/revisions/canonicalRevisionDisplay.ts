import type { CanonicalRevisionRecord } from '@scli/domain';

/**
 * ONE display mapping for canonical Revision creation provenance (C1 §20).
 *
 * canonicalOperation is an internal discriminator, not owner-facing language, so
 * every V4 surface that shows "Source" renders it through this mapping. The
 * mapping is DISPLAY-ONLY: it never changes stored provenance, never adds a new
 * operation, and never invents a state the registry does not hold.
 */
export function canonicalOperationDisplay(operation: unknown): string | null {
  switch (operation) {
    case 'MANUAL_DELIVERABLES':
      return 'Composed / Manual Revision';
    case 'GENERATED_OUTPUTS':
      return 'Generated Output Revision';
    case 'REGISTER_ONLY':
      return 'Registered Revision';
    default:
      return null;
  }
}

/** The stored creation provenance of a canonical Revision, if it holds one. */
export function canonicalOperationOf(revision: CanonicalRevisionRecord): string | null {
  const operation =
    revision.projectSnapshot && typeof revision.projectSnapshot === 'object'
      ? (revision.projectSnapshot as Record<string, unknown>).canonicalOperation
      : undefined;
  return typeof operation === 'string' && operation ? operation : null;
}

/**
 * The owner-facing Source of a Revision.
 *
 * Falls back to the raw stored operation (and then to the provenance
 * classification) rather than to an invented label, so an unmapped future
 * operation stays visibly truthful instead of silently mislabelled.
 */
export function canonicalRevisionSourceDisplay(revision: CanonicalRevisionRecord): string {
  const operation = canonicalOperationOf(revision);
  if (operation) return canonicalOperationDisplay(operation) ?? operation;
  return revision.provenanceClassification;
}

/**
 * Whether a Revision may currently receive a newly generated Output.
 *
 * Mirrors the server composition-target predicate. Client-side it is only ever
 * used to decide what to OFFER — the server re-verifies eligibility on every
 * generation call and rejects an ineligible target.
 */
export function isComposableTargetRevision(revision: CanonicalRevisionRecord): boolean {
  return (
    revision.provenanceClassification === 'CANONICAL' &&
    revision.lifecycleState === 'PREPARING' &&
    canonicalOperationOf(revision) === 'MANUAL_DELIVERABLES'
  );
}

/** Whether a Revision is a composed draft that failed and can be resumed (B1). */
export function isResumableComposedRevision(revision: CanonicalRevisionRecord): boolean {
  return (
    revision.provenanceClassification === 'CANONICAL' &&
    revision.lifecycleState === 'FAILED_RECOVERABLE' &&
    canonicalOperationOf(revision) === 'MANUAL_DELIVERABLES'
  );
}
