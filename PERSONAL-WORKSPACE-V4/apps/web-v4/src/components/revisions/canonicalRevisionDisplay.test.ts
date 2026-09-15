/**
 * C1 §20 — the ONE display mapping for canonical Revision provenance, and the
 * two client-side eligibility predicates.
 *
 * The mapping is display-only: it must never rename stored provenance, never
 * invent an operation, and never hide an operation it does not recognize. The
 * predicates only decide what to OFFER; the server re-verifies every call.
 */
/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import type { CanonicalRevisionRecord } from '@scli/domain';
import {
  canonicalOperationDisplay,
  canonicalOperationOf,
  canonicalRevisionSourceDisplay,
  isComposableTargetRevision,
  isResumableComposedRevision,
} from './canonicalRevisionDisplay';

function revision(overrides: Partial<CanonicalRevisionRecord> = {}): CanonicalRevisionRecord {
  return {
    revisionId: '11111111-1111-4111-8111-111111111111',
    projectId: 'p1',
    revisionSequence: 6,
    revisionLabel: 'REV_06',
    purpose: null,
    internalNote: null,
    lifecycleState: 'PREPARING',
    projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    luminaireSnapshot: [],
    snapshotHash: 'hash',
    createdById: 'u1',
    createdByName: 'Mohamed Ali',
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    failureReason: null,
    createdAt: '2026-08-18T08:00:00.000Z',
    finalizedAt: null,
    updatedAt: '2026-08-18T08:00:00.000Z',
    ...overrides,
  };
}

describe('canonicalOperationDisplay', () => {
  it('maps the three real canonical operations to owner-facing language', () => {
    expect(canonicalOperationDisplay('MANUAL_DELIVERABLES')).toBe('Composed / Manual Revision');
    expect(canonicalOperationDisplay('GENERATED_OUTPUTS')).toBe('Generated Output Revision');
    expect(canonicalOperationDisplay('REGISTER_ONLY')).toBe('Registered Revision');
  });

  it('returns null for anything it does not recognize rather than inventing a label', () => {
    expect(canonicalOperationDisplay('COMPOSED_DELIVERABLES')).toBeNull();
    expect(canonicalOperationDisplay('Scheduled Regeneration')).toBeNull();
    expect(canonicalOperationDisplay('')).toBeNull();
    expect(canonicalOperationDisplay(undefined)).toBeNull();
    expect(canonicalOperationDisplay(null)).toBeNull();
    expect(canonicalOperationDisplay(7)).toBeNull();
  });
});

describe('canonicalOperationOf', () => {
  it('reads the stored operation from the project snapshot', () => {
    expect(canonicalOperationOf(revision())).toBe('MANUAL_DELIVERABLES');
  });

  it('returns null when the snapshot holds no usable operation', () => {
    expect(canonicalOperationOf(revision({ projectSnapshot: {} }))).toBeNull();
    expect(
      canonicalOperationOf(revision({ projectSnapshot: { canonicalOperation: '' } })),
    ).toBeNull();
    expect(
      canonicalOperationOf(revision({ projectSnapshot: { canonicalOperation: 3 } })),
    ).toBeNull();
    expect(canonicalOperationOf(revision({ projectSnapshot: null }))).toBeNull();
  });
});

describe('canonicalRevisionSourceDisplay', () => {
  it('renders the mapped label for a known operation', () => {
    expect(canonicalRevisionSourceDisplay(revision())).toBe('Composed / Manual Revision');
    expect(
      canonicalRevisionSourceDisplay(
        revision({ projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' } }),
      ),
    ).toBe('Generated Output Revision');
    expect(
      canonicalRevisionSourceDisplay(
        revision({ projectSnapshot: { canonicalOperation: 'REGISTER_ONLY' } }),
      ),
    ).toBe('Registered Revision');
  });

  it('surfaces an unmapped operation verbatim instead of mislabelling it', () => {
    expect(
      canonicalRevisionSourceDisplay(
        revision({ projectSnapshot: { canonicalOperation: 'Scheduled Regeneration' } }),
      ),
    ).toBe('Scheduled Regeneration');
  });

  it('falls back to the provenance classification when no operation is stored', () => {
    expect(canonicalRevisionSourceDisplay(revision({ projectSnapshot: {} }))).toBe('CANONICAL');
    expect(
      canonicalRevisionSourceDisplay(
        revision({ projectSnapshot: {}, provenanceClassification: 'LEGACY_VERIFIED' }),
      ),
    ).toBe('LEGACY_VERIFIED');
  });
});

describe('isComposableTargetRevision', () => {
  it('accepts a CANONICAL PREPARING composed Revision', () => {
    expect(isComposableTargetRevision(revision())).toBe(true);
  });

  it('rejects every other lifecycle, provenance, and operation', () => {
    expect(isComposableTargetRevision(revision({ lifecycleState: 'FINALIZED' }))).toBe(false);
    expect(isComposableTargetRevision(revision({ lifecycleState: 'FAILED_RECOVERABLE' }))).toBe(
      false,
    );
    expect(isComposableTargetRevision(revision({ lifecycleState: 'LEGACY_IMPORTED' }))).toBe(false);
    expect(
      isComposableTargetRevision(revision({ provenanceClassification: 'LEGACY_VERIFIED' })),
    ).toBe(false);
    expect(
      isComposableTargetRevision(
        revision({ projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' } }),
      ),
    ).toBe(false);
    expect(
      isComposableTargetRevision(
        revision({ projectSnapshot: { canonicalOperation: 'REGISTER_ONLY' } }),
      ),
    ).toBe(false);
    expect(isComposableTargetRevision(revision({ projectSnapshot: {} }))).toBe(false);
  });
});

describe('isResumableComposedRevision', () => {
  it('accepts only a CANONICAL FAILED_RECOVERABLE composed Revision', () => {
    expect(isResumableComposedRevision(revision({ lifecycleState: 'FAILED_RECOVERABLE' }))).toBe(
      true,
    );
    expect(isResumableComposedRevision(revision())).toBe(false);
    expect(isResumableComposedRevision(revision({ lifecycleState: 'FINALIZED' }))).toBe(false);
    expect(
      isResumableComposedRevision(
        revision({
          lifecycleState: 'FAILED_RECOVERABLE',
          projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' },
        }),
      ),
    ).toBe(false);
    expect(
      isResumableComposedRevision(
        revision({
          lifecycleState: 'FAILED_RECOVERABLE',
          provenanceClassification: 'LEGACY_VERIFIED',
        }),
      ),
    ).toBe(false);
  });
});
