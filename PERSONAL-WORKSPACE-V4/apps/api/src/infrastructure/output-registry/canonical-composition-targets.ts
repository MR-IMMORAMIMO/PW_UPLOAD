import { DomainError } from '@scli/domain';
import type {
  CanonicalOutputRecord,
  CanonicalRevisionRecord,
  OutputFamily,
  ScheduleGenerationFormat,
  TechnicalOutputComposableTarget,
  TechnicalOutputRequestedTargetView,
  TechnicalOutputTargetRejection,
} from '@scli/domain';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { isManualCompositionDraftRevision } from './canonical-composition-reservations.js';

/**
 * C1 — Revision composition TARGET authority.
 *
 * ONE shared eligibility + duplicate boundary reused by BOTH C1 callers:
 *
 *  - TechnicalOutputWorkspaceService (advisory read: what MAY be targeted), and
 *  - CanonicalGenerationService targeted generation (authority: what IS targeted),
 *
 * so the advisory list the page renders and the server-side re-verification can
 * never diverge. Client selection is NEVER authority: every generation call
 * re-derives eligibility here from persisted registry state, and an ineligible
 * target is REJECTED — never silently downgraded to a standalone generation.
 *
 * Eligibility deliberately delegates the composed-draft predicate to the C0
 * authority (isManualCompositionDraftRevision) rather than restating it, so
 * composition draft identity has exactly one definition.
 */

/** The Output lifecycles that occupy a family/format slot on a target Revision. */
const occupyingOutputLifecycles = ['PREPARING', 'FINALIZED'] as const;

export type CompositionTargetVerdict =
  | { readonly kind: 'ELIGIBLE'; readonly revision: CanonicalRevisionRecord }
  | {
      readonly kind: 'REJECTED';
      readonly rejection: TechnicalOutputTargetRejection;
      readonly message: string;
      /** Present whenever the Revision was found and belongs to this Project. */
      readonly revision: CanonicalRevisionRecord | null;
    };

/**
 * Classifies ONE candidate target Revision without mutating anything.
 *
 * Ordering is chosen so the surfaced reason is the most specific truth about the
 * Revision: what KIND of Revision it is precedes what STATE it is in, because a
 * generated-output or register-only Revision is never composable in any state.
 */
export function classifyCompositionTarget(
  registry: CanonicalOutputRegistryStore,
  projectId: string,
  revisionId: string,
): CompositionTargetVerdict {
  let revision: CanonicalRevisionRecord;
  try {
    revision = registry.getRevision(revisionId);
  } catch {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_NOT_FOUND',
      message: 'The selected target Revision no longer exists.',
      revision: null,
    };
  }
  if (revision.projectId !== projectId) {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_OTHER_PROJECT',
      message: 'The selected target Revision belongs to a different Project.',
      revision: null,
    };
  }
  if (revision.provenanceClassification !== 'CANONICAL') {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_NOT_CANONICAL',
      message: 'Legacy imported Revisions cannot receive newly generated Outputs.',
      revision,
    };
  }
  if (revision.projectSnapshot?.canonicalOperation !== 'MANUAL_DELIVERABLES') {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_NOT_COMPOSED',
      message: `${revision.revisionLabel} is not a composed Revision, so it cannot receive a generated Output.`,
      revision,
    };
  }
  if (revision.lifecycleState === 'FINALIZED') {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_FINALIZED',
      message: `${revision.revisionLabel} is already Finalized and is immutable.`,
      revision,
    };
  }
  if (revision.lifecycleState === 'FAILED_RECOVERABLE') {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_FAILED_RECOVERABLE',
      message: `${revision.revisionLabel} needs to be resumed before Outputs can be generated into it.`,
      revision,
    };
  }
  if (!isManualCompositionDraftRevision(revision)) {
    return {
      kind: 'REJECTED',
      rejection: 'TARGET_NOT_PREPARING',
      message: `${revision.revisionLabel} is no longer Preparing, so it cannot receive a generated Output.`,
      revision,
    };
  }
  return { kind: 'ELIGIBLE', revision };
}

/**
 * Server-side generation authority: resolves the verified target Revision or
 * throws. Never returns a fallback, so a caller cannot accidentally continue as
 * a standalone generation.
 */
export function requireCompositionTarget(
  registry: CanonicalOutputRegistryStore,
  projectId: string,
  revisionId: string,
): CanonicalRevisionRecord {
  const verdict = classifyCompositionTarget(registry, projectId, revisionId);
  if (verdict.kind === 'ELIGIBLE') return verdict.revision;
  const statusCode = verdict.rejection === 'TARGET_NOT_FOUND' ? 404 : 409;
  const code =
    verdict.rejection === 'TARGET_NOT_FOUND'
      ? 'NOT_FOUND'
      : verdict.rejection === 'TARGET_OTHER_PROJECT' ||
          verdict.rejection === 'TARGET_NOT_CANONICAL' ||
          verdict.rejection === 'TARGET_NOT_COMPOSED'
        ? 'VALIDATION_ERROR'
        : 'CONFLICT';
  throw new DomainError(code, verdict.message, code === 'VALIDATION_ERROR' ? 400 : statusCode, {
    targetRevisionId: revisionId,
    targetRejection: verdict.rejection,
  });
}

/** The formats requested by ONE generation call. */
export function requestedGenerationFormats(
  format: ScheduleGenerationFormat,
): readonly ('XLSX' | 'PDF')[] {
  return format === 'Both' ? (['XLSX', 'PDF'] as const) : ([format] as const);
}

/**
 * The formats of ONE Output family already occupied on a Revision.
 *
 * FAILED_RECOVERABLE is deliberately NOT occupying: it is a dead reservation, not
 * a deliverable, and blocking on it would trap a composed draft forever.
 */
export function occupiedTargetFormats(
  outputs: readonly CanonicalOutputRecord[],
  family: OutputFamily,
): ScheduleGenerationFormat[] {
  const formats = new Set<ScheduleGenerationFormat>();
  for (const output of outputs) {
    if (output.outputFamily !== family) continue;
    if (!occupyingOutputLifecycles.includes(output.lifecycleState as 'PREPARING' | 'FINALIZED')) {
      continue;
    }
    formats.add(output.outputFormat as ScheduleGenerationFormat);
  }
  return [...formats];
}

/**
 * Duplicate policy: ONE Output family/format may exist at most ONCE per
 * Revision. A conflict is rejected as a typed CONFLICT — never replaced,
 * superseded, auto-versioned, or silently renamed.
 *
 * `Both` is admissible only when BOTH slots are free; a partially occupied
 * Revision is rejected so the user explicitly requests the free format.
 */
export function assertTargetFormatSlotsFree(
  registry: CanonicalOutputRegistryStore,
  revision: CanonicalRevisionRecord,
  family: OutputFamily,
  familyLabel: string,
  format: ScheduleGenerationFormat,
): void {
  const occupied = occupiedTargetFormats(
    registry.listOutputsForRevision(revision.revisionId),
    family,
  );
  const clashes = requestedGenerationFormats(format).filter((requested) =>
    occupied.includes(requested),
  );
  if (!clashes.length) return;
  const free = requestedGenerationFormats('Both').filter(
    (candidate) => !occupied.includes(candidate),
  );
  const clashText = clashes.join(' and ');
  const remedy =
    format === 'Both' && free.length
      ? ` Request ${free.join(' and ')} only, or remove the existing Output first.`
      : '';
  throw new DomainError(
    'CONFLICT',
    `${revision.revisionLabel} already contains a ${familyLabel} ${clashText} Output.${remedy}`,
    409,
    {
      targetRevisionId: revision.revisionId,
      outputFamily: family,
      conflictingFormats: clashes,
      occupiedFormats: occupied,
    },
  );
}

/** Projects ONE eligible Revision into the advisory read view. */
export function composableTargetView(
  registry: CanonicalOutputRegistryStore,
  revision: CanonicalRevisionRecord,
  family: OutputFamily,
): TechnicalOutputComposableTarget {
  return {
    revisionId: revision.revisionId,
    revisionLabel: revision.revisionLabel,
    revisionSequence: revision.revisionSequence,
    lifecycleState: revision.lifecycleState,
    createdAt: revision.createdAt,
    createdByName: revision.createdByName,
    occupiedFormats: occupiedTargetFormats(
      registry.listOutputsForRevision(revision.revisionId),
      family,
    ),
    snapshotCount: registry.listDocumentSnapshotsForRevision(revision.revisionId).length,
  };
}

/** Every composed draft Revision of a Project that may currently be targeted. */
export function composableTargetViews(
  registry: CanonicalOutputRegistryStore,
  revisions: readonly CanonicalRevisionRecord[],
  family: OutputFamily,
): TechnicalOutputComposableTarget[] {
  return revisions
    .filter((revision) => isManualCompositionDraftRevision(revision))
    .sort((left, right) => right.revisionSequence - left.revisionSequence)
    .map((revision) => composableTargetView(registry, revision, family));
}

/** The server verdict for the target the client currently claims to target. */
export function requestedTargetView(
  registry: CanonicalOutputRegistryStore,
  projectId: string,
  revisionId: string,
  family: OutputFamily,
): TechnicalOutputRequestedTargetView {
  const verdict = classifyCompositionTarget(registry, projectId, revisionId);
  if (verdict.kind === 'ELIGIBLE') {
    return {
      revisionId,
      eligible: true,
      rejection: null,
      message: '',
      target: composableTargetView(registry, verdict.revision, family),
    };
  }
  return {
    revisionId,
    eligible: false,
    rejection: verdict.rejection,
    message: verdict.message,
    target: null,
  };
}
