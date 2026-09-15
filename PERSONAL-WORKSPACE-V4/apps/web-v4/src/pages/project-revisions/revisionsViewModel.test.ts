/**
 * PACKAGES-E2E-01 — composable target derivation.
 *
 * The Generate Output menu must derive its target set from the PREPARING
 * composed Revisions only, never from a display sequence. These tests pin the
 * pure derivation: which Revisions are composable, that identity is the UUID,
 * and that ordering is presentation-only.
 */
/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import type { CanonicalRevisionRecord, ProjectRevision, ProjectWorkspace } from '@scli/domain';
import {
  buildCompatibilitySummary,
  buildRevisionRows,
  composableTargetRevisions,
} from './revisionsViewModel';

function revision(
  n: number,
  overrides: Partial<CanonicalRevisionRecord> = {},
): CanonicalRevisionRecord {
  return {
    revisionId: `rev-${n}`,
    projectId: 'p1',
    revisionSequence: n,
    revisionLabel: `R${String(n).padStart(2, '0')}`,
    purpose: null,
    internalNote: null,
    lifecycleState: 'FINALIZED',
    projectSnapshot: { canonicalOperation: 'Initial Generation' },
    luminaireSnapshot: [],
    snapshotHash: `hash-${n}`,
    createdById: 'u1',
    createdByName: 'Maha',
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    failureReason: null,
    createdAt: new Date(2026, 7, 10 + n, 9, 0, 0).toISOString(),
    finalizedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    updatedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    ...overrides,
  };
}

const composedPreparing = (n: number) =>
  revision(n, {
    lifecycleState: 'PREPARING',
    finalizedAt: null,
    projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
  });

function compatibility(id: string, overrides: Partial<ProjectRevision> = {}): ProjectRevision {
  return {
    id,
    projectId: 'p1',
    revisionNumber: 1,
    reissueNumber: 0,
    title: '',
    status: 'Draft',
    receivedAt: null,
    dueDate: null,
    issuedAt: null,
    summary: '',
    changeLog: '',
    sourceType: 'Manual',
    sourceReference: '',
    locked: false,
    snapshotHash: 'compatibility-hash',
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    ...overrides,
  };
}

function workspace(revisions: ProjectRevision[]): ProjectWorkspace {
  return { projectId: 'p1', revisions, documents: [] } as unknown as ProjectWorkspace;
}

describe('composableTargetRevisions', () => {
  it('returns only CANONICAL MANUAL_DELIVERABLES PREPARING Revisions', () => {
    const revisions = [
      composedPreparing(7),
      revision(1), // FINALIZED
      revision(2, {
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' },
      }),
      revision(3, {
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        projectSnapshot: { canonicalOperation: 'REGISTER_ONLY' },
      }),
      revision(4, {
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        provenanceClassification: 'LEGACY_VERIFIED',
        projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      }),
      revision(5, {
        lifecycleState: 'FAILED_RECOVERABLE',
        finalizedAt: null,
        projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      }),
    ];
    const targets = composableTargetRevisions(revisions);
    expect(targets.map((r) => r.revisionId)).toEqual(['rev-7']);
  });

  it('orders newest-first by sequence (presentation only), identity stays the UUID', () => {
    const targets = composableTargetRevisions([composedPreparing(7), composedPreparing(9)]);
    expect(targets.map((r) => r.revisionId)).toEqual(['rev-9', 'rev-7']);
    expect(targets.map((r) => r.revisionSequence)).toEqual([9, 7]);
  });

  it('returns an empty set when no PREPARING composed Revision exists', () => {
    expect(composableTargetRevisions([revision(1)])).toEqual([]);
    expect(composableTargetRevisions([])).toEqual([]);
  });
});

describe('Revision compatibility summary', () => {
  it('prefers the exact canonical UUID and humanizes the persisted status', () => {
    const canonical = revision(1, { legacySourceId: 'legacy-1' });
    const result = buildCompatibilitySummary(
      canonical,
      workspace([
        compatibility('legacy-1', { status: 'Issued', locked: true }),
        compatibility('rev-1', { status: 'InternalReview', title: ' Tender issue ' }),
      ]),
    );

    expect(result).toMatchObject({
      status: 'InternalReview',
      statusLabel: 'Internal Review',
      locked: false,
      title: 'Tender issue',
    });
  });

  it('uses explicit legacySourceId as the only fallback identity', () => {
    const canonical = revision(7, { legacySourceId: 'legacy-record-7' });
    const summary = buildCompatibilitySummary(
      canonical,
      workspace([compatibility('legacy-record-7', { status: 'Superseded' })]),
    );

    expect(summary?.statusLabel).toBe('Superseded');
  });

  it('never joins compatibility by revision number', () => {
    const canonical = revision(7, { legacySourceId: null });
    const records = workspace([compatibility('unrelated-id', { revisionNumber: 7 })]);

    expect(buildCompatibilitySummary(canonical, records)).toBeNull();
    expect(buildRevisionRows([canonical], [], records)[0]?.compatibilityStatus).toBeNull();
  });

  it('keeps only meaningful optional owner-facing fields', () => {
    const summary = buildCompatibilitySummary(
      revision(1),
      workspace([
        compatibility('rev-1', {
          status: 'ReadyToIssue',
          title: ' ',
          summary: 'Current summary',
          changeLog: 'Updated quantities',
          sourceType: 'Meeting',
          reissueNumber: 2,
        }),
      ]),
    );

    expect(summary).toMatchObject({
      statusLabel: 'Ready to Issue',
      title: null,
      summary: 'Current summary',
      changes: 'Updated quantities',
      sourceType: 'Meeting',
      reissueNumber: 2,
    });
  });
});
