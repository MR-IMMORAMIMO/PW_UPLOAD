/**
 * AUTO-01A — Managed Artifact persistence foundation domain authority.
 *
 * These are the persistence/domain types for the owner-locked AUTO-00
 * architecture (AUTO-D01..D07). They establish the stable identity model for
 * managed working artifacts and the audit/recovery cursor that future
 * operational Auto-Capture slices (AUTO-01B/C+) build on.
 *
 * This slice introduces persistence and identity ONLY. There is no filesystem
 * watcher, capture service, staging, hashing pipeline, tool launcher, or
 * adapter registry here. The operational Auto-Capture pipeline is out of scope.
 *
 * Identity model (AUTO-D01):
 *   - `ManagedArtifact` is the PRIMARY stable identity for a managed working
 *     artifact. It owns tool provenance, capture provenance, hashes, working
 *     versions, the canonical managed path, and capture/recovery history.
 *   - `ProjectDocument` (in `personal.ts`) remains the compatibility /
 *     operational working-file record. The relationship is one-directional:
 * a ManagedArtifact MAY reference an operational ProjectDocument via a
 * nullable FK. There is no reverse identity claim, so the two never
 * compete for the same artifact.
 */

import { DomainError } from './errors';

/** Lifecycle status of a managed working artifact. */
export const managedArtifactStatuses = ['ACTIVE', 'FROZEN', 'ARCHIVED'] as const;
export type ManagedArtifactStatus = (typeof managedArtifactStatuses)[number];

/**
 * The primary stable identity for a managed working artifact.
 *
 * `canonicalPath` is a project-relative managed path (NOT an arbitrary
 * absolute external path). `currentWorkingVersion` is the latest `ArtifactVersion`
 * sequence; `ArtifactVersion` UUIDs remain the exact identity for historical
 * provenance (AUTO-D02).
 */
export interface ManagedArtifact {
  artifactId: string;
  projectId: string;
  artifactType: string;
  sourceTool: string;
  canonicalPath: string;
  status: ManagedArtifactStatus;
  currentWorkingVersion: number;
  /** Optional operational compatibility record (AUTO-D01). Null when unmanaged-linked. */
  projectDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Working-version artifact locator kinds (project-relative preferred). */
export const artifactVersionLocatorKinds = [
  'PROJECT_RELATIVE',
  'LEGACY_ABSOLUTE',
  'LEGACY_UNKNOWN',
] as const;
export type ArtifactVersionLocatorKind = (typeof artifactVersionLocatorKinds)[number];

/**
 * Immutable working-version record (AUTO-D01/D02).
 *
 * The version SEQUENCE is presentation/order only; the `versionId` UUID is the
 * canonical identity. Historical versions are immutable and protected from
 * deletion while any historical provenance (e.g. a Document Snapshot
 * `sourceArtifactVersionId`) references them.
 */
export interface ArtifactVersion {
  versionId: string;
  artifactId: string;
  /** Monotonic per-artifact sequence. NOT the identity; UUID is the identity. */
  version: number;
  contentHash: string;
  sizeBytes: number | null;
  locatorKind: ArtifactVersionLocatorKind;
  /** Locator/path sufficient for future recovery. */
  locatorValue: string;
  /** Optional capture provenance reference (null until a capture exists). */
  captureId: string | null;
  createdAt: string;
}

/** Tool Context states. EXPIRED cannot authorize a NEW capture (AUTO-D06). */
export const toolContextStates = ['LIVE', 'REBOUND', 'EXPIRED', 'CLOSED'] as const;
export type ToolContextState = (typeof toolContextStates)[number];

/**
 * A managed tool instance's artifact/provenance context (AUTO-D06).
 *
 * Separate from Work Session (time tracking). Multiple concurrent Tool
 * Contexts across projects/tools may coexist; there is no single global active
 * project. `EXPIRED` and `CLOSED` contexts MUST NOT authorize a new automatic
 * capture — only LIVE or explicitly REBOUND may.
 */
export interface ToolContext {
  toolContextId: string;
  projectId: string;
  /** Immutable canonical Revision UUID snapshot; never inferred from a display sequence. */
  targetRevisionId: string | null;
  /** Immutable historical source-document UUID snapshot. */
  sourceDocumentId: string | null;
  tool: string;
  expectedArtifactType: string;
  mode: string;
  channel: string;
  state: ToolContextState;
  openedAt: string;
  closedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
}

/**
 * Domain eligibility rule (AUTO-D06): only LIVE or explicitly REBOUND Tool
 * Contexts may authorize a NEW automatic capture. An EXPIRED context may be
 * used only for recovery of an already-DETECTED capture or historical audit.
 */
export function toolContextCanAuthorizeNewCapture(state: ToolContextState): boolean {
  return state === 'LIVE' || state === 'REBOUND';
}

/**
 * AUTO-01B locked Tool Context lifecycle transition policy.
 *
 * CREATE -> LIVE; LIVE -> EXPIRED/CLOSED; EXPIRED -> REBOUND/CLOSED;
 * REBOUND -> EXPIRED/CLOSED; CLOSED is terminal. Forbidden: CLOSED -> LIVE/REBOUND,
 * EXPIRED -> LIVE directly, LIVE -> REBOUND. A context never becomes REBOUND
 * implicitly (restart, same tool, same project, same filename): REBOUND requires
 * an explicit operation against an existing EXPIRED context.
 */
const toolContextTransitions: Readonly<Record<ToolContextState, readonly ToolContextState[]>> = {
  LIVE: ['EXPIRED', 'CLOSED'],
  REBOUND: ['EXPIRED', 'CLOSED'],
  EXPIRED: ['REBOUND', 'CLOSED'],
  CLOSED: [],
};

/** Whether the Tool Context may move from `from` to `to` under the locked policy. */
export function canTransitionToolContext(from: ToolContextState, to: ToolContextState): boolean {
  return toolContextTransitions[from].includes(to);
}

/**
 * Applies a single valid Tool Context transition, returning the next state.
 *
 * This is a pure domain authority: it never persists and never invents a
 * second context to hide an invalid transition. Invalid transitions throw a
 * `DomainError('INVALID_TRANSITION', 409)`. Rebind is exactly the EXPIRED ->
 * REBOUND transition and preserves every identity-defining field
 * (toolContextId, projectId, tool, expectedArtifactType). `at` stamps the
 * applicable lifecycle timestamp (`expiredAt` / `closedAt`).
 */
export function transitionToolContext(
  context: ToolContext,
  to: ToolContextState,
  at: string,
): ToolContext {
  if (!canTransitionToolContext(context.state, to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Transition from ${context.state} to ${to} is not allowed for a Tool Context.`,
      409,
      { from: context.state, to },
    );
  }
  return {
    ...context,
    state: to,
    expiredAt: to === 'EXPIRED' ? at : context.expiredAt,
    closedAt: to === 'CLOSED' ? at : context.closedAt,
  };
}

/**
 * AUTO-01E2A / REV-01B — ManagedArtifact lifecycle state machine (ACTIVE /
 * FROZEN / ARCHIVED). Mirrors the ToolContext transition-authority pattern.
 *
 * ACTIVE -> ARCHIVED is the safe undo of a completed capture with no immutable
 * downstream references (AUTO-01E2A). ACTIVE -> FROZEN is the Revision
 * FINALIZED immutable boundary (REV-01B): the issuing slices (Revision
 * snapshot / Package / Issue) freeze an artifact once immutable history
 * references its versions. FROZEN and ARCHIVED are terminal; a future
 * explicit restore-from-archive / unfreeze operation is an owner decision
 * that would EXTEND this policy (it must never be an implicit automatic
 * transition). SUPERSEDED / DISCARDED / UNDONE are deliberately not modeled
 * (no v16).
 */
const managedArtifactTransitions: Readonly<
  Record<ManagedArtifactStatus, readonly ManagedArtifactStatus[]>
> = {
  ACTIVE: ['ARCHIVED', 'FROZEN'],
  FROZEN: [],
  ARCHIVED: [],
};

/** Whether the ManagedArtifact may move from `from` to `to` under the locked policy. */
export function canTransitionManagedArtifact(
  from: ManagedArtifactStatus,
  to: ManagedArtifactStatus,
): boolean {
  return managedArtifactTransitions[from].includes(to);
}

/**
 * Applies a single valid ManagedArtifact transition, returning the next state.
 *
 * Pure domain authority: never persists. Invalid transitions throw
 * `DomainError('INVALID_TRANSITION', 409)`. `at` stamps `updatedAt` (the only
 * mutable timestamp on the artifact row; created identity fields are never
 * rewritten).
 */
export function transitionManagedArtifact(
  artifact: ManagedArtifact,
  to: ManagedArtifactStatus,
  at: string,
): ManagedArtifact {
  if (!canTransitionManagedArtifact(artifact.status, to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Transition from ${artifact.status} to ${to} is not allowed for a Managed Artifact.`,
      409,
      { from: artifact.status, to },
    );
  }
  return {
    ...artifact,
    status: to,
    updatedAt: at,
  };
}

/** Locked capture lifecycle state machine (AUTO-00 final state machine). */
export const captureStates = [
  'DETECTED',
  'STABILIZING',
  'STAGED',
  'VERIFYING',
  'ADMITTED',
  'MATERIALIZING',
  'COMPLETED',
  'UNRESOLVED',
  'FAILED_RECOVERABLE',
  'DISCARDED',
] as const;
export type CaptureState = (typeof captureStates)[number];

/** Durable routing decisions. Null means no decision has been recorded yet. */
export const captureRoutingDecisions = ['AUTO_APPROVED', 'USER_CONFIRMED', 'REJECTED'] as const;
export type CaptureRoutingDecision = (typeof captureRoutingDecisions)[number];

/**
 * Persistent recovery/audit cursor for Auto-Capture (AUTO-01A persistence).
 *
 * `contentHash`/`sizeBytes` are nullable until known. `finalArtifactId` /
 * `finalVersionId` become non-null only after the capture is ADMITTED. Rows
 * are append-only audit truth and are never silently cascade-deleted.
 */
export interface CaptureLedgerEntry {
  captureId: string;
  projectId: string;
  /** Immutable Revision UUID snapshot copied from explicit capture context. */
  targetRevisionId: string | null;
  toolContextId: string | null;
  sourcePath: string;
  sourceChannel: string;
  expectedArtifactType: string;
  contentHash: string | null;
  sizeBytes: number | null;
  state: CaptureState;
  attemptCount: number;
  detectedAt: string;
  stagedAt: string | null;
  admittedAt: string | null;
  completedAt: string | null;
  error: string | null;
  finalArtifactId: string | null;
  finalVersionId: string | null;
  routingDecision: CaptureRoutingDecision | null;
  routingReason: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  createdAt: string;
}

export interface CaptureRoutingDecisionInput {
  decision: CaptureRoutingDecision;
  reason?: string | null;
  decidedAt: string;
  decidedById?: string | null;
  decidedByName?: string | null;
}

/**
 * Validates a durable routing decision before persistence. USER_CONFIRMED
 * always carries a complete actor snapshot. System-owned decisions may omit
 * the actor, but a partially populated actor is never valid audit evidence.
 */
export function validateCaptureRoutingDecision(
  input: CaptureRoutingDecisionInput,
): CaptureRoutingDecisionInput {
  if (!captureRoutingDecisions.includes(input.decision)) {
    throw new DomainError('VALIDATION_ERROR', 'Invalid capture routing decision.', 400);
  }
  if (input.decidedAt.trim().length === 0) {
    throw new DomainError('VALIDATION_ERROR', 'A routing decision time is required.', 400);
  }
  const actorId = input.decidedById?.trim() || null;
  const actorName = input.decidedByName?.trim() || null;
  if ((actorId === null) !== (actorName === null)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'A routing decision actor ID and name must be recorded together.',
      400,
    );
  }
  if (input.decision === 'USER_CONFIRMED' && actorId === null) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'USER_CONFIRMED requires a durable actor snapshot.',
      400,
    );
  }
  return {
    decision: input.decision,
    reason: input.reason?.trim() || null,
    decidedAt: input.decidedAt,
    decidedById: actorId,
    decidedByName: actorName,
  };
}

// ---------------------------------------------------------------------------
// AUTO-01C — Capture Ledger state machine (the canonical transition authority).
//
// The ledger row is a DURABLE CAPTURE LEDGER / STATEFUL AUDIT-RECOVERY RECORD:
// one mutable row per capture whose state progresses in place. It is NOT yet
// an append-only transition-event history (full event sourcing is a future
// Activity/Event substrate concern). Rows are never normally deleted.
//
// Forward progress is a strict chain (no skipping):
//   DETECTED -> STABILIZING -> STAGED -> VERIFYING -> ADMITTED ->
//   MATERIALIZING -> COMPLETED
// Degraded/terminal edges are explicit and narrow; `FAILED_RECOVERABLE` is
// resumed only through a dedicated resume authority that derives the legal
// next state from the persisted milestone timestamps (no generic
// FAILED_RECOVERABLE -> ANY).
// ---------------------------------------------------------------------------

/**
 * The ONE domain-owned capture transition graph (AUTO-01C).
 *
 * Forward edges are exactly the happy path. Degraded edges follow the
 * owner-locked minimum policy:
 *   - UNRESOLVED exits are EXPLICIT operations only (resolve via
 *     `captureResolveTarget`, escalate to FAILED_RECOVERABLE, or DISCARDED) —
 *     never automatic. There is NO static UNRESOLVED -> VERIFYING edge: the
 *     resolve target is milestone-aware (a never-staged capture must return to
 *     STABILIZING, never skip STAGING).
 *   - FAILED_RECOVERABLE exits are the derived resume targets plus DISCARDED.
 *   - COMPLETED and DISCARDED are terminal.
 *   - ADMITTED/MATERIALIZING may NOT be silently discarded: an admitted
 *     capture must fail (FAILED_RECOVERABLE) before it can be discarded, so
 *     a real managed-artifact admission is never abandoned silently.
 */
const captureTransitions: Readonly<Record<CaptureState, readonly CaptureState[]>> = {
  DETECTED: ['STABILIZING', 'UNRESOLVED', 'FAILED_RECOVERABLE', 'DISCARDED'],
  STABILIZING: ['STAGED', 'UNRESOLVED', 'FAILED_RECOVERABLE', 'DISCARDED'],
  STAGED: ['VERIFYING', 'FAILED_RECOVERABLE', 'DISCARDED'],
  VERIFYING: ['ADMITTED', 'UNRESOLVED', 'FAILED_RECOVERABLE', 'DISCARDED'],
  ADMITTED: ['MATERIALIZING', 'FAILED_RECOVERABLE'],
  MATERIALIZING: ['COMPLETED', 'FAILED_RECOVERABLE'],
  COMPLETED: [],
  // The two resolve targets are the milestone-derived outputs of
  // `captureResolveTarget` (STABILIZING when never staged, VERIFYING when
  // staged). The edges are NOT generic: `transitionCaptureState` enforces the
  // milestone precondition, so a never-staged capture can never reach
  // VERIFYING and a staged capture can never rewind to STABILIZING.
  UNRESOLVED: ['STABILIZING', 'VERIFYING', 'FAILED_RECOVERABLE', 'DISCARDED'],
  FAILED_RECOVERABLE: ['STABILIZING', 'VERIFYING', 'MATERIALIZING', 'DISCARDED'],
  DISCARDED: [],
};

/** Whether the capture may move from `from` to `to` under the locked policy. */
export function canTransitionCapture(from: CaptureState, to: CaptureState): boolean {
  return captureTransitions[from].includes(to);
}

/** The single next happy-path state, or null for non-forward states. */
const captureForwardTargets: Readonly<Record<CaptureState, CaptureState | null>> = {
  DETECTED: 'STABILIZING',
  STABILIZING: 'STAGED',
  STAGED: 'VERIFYING',
  VERIFYING: 'ADMITTED',
  ADMITTED: 'MATERIALIZING',
  MATERIALIZING: 'COMPLETED',
  COMPLETED: null,
  UNRESOLVED: null,
  FAILED_RECOVERABLE: null,
  DISCARDED: null,
};

/** The strict forward successor of `from`, or `null` when none exists. */
export function captureForwardTarget(from: CaptureState): CaptureState | null {
  return captureForwardTargets[from];
}

/**
 * Derives the deterministic resume point for a FAILED_RECOVERABLE capture from
 * persisted milestone timestamps only (no schema change; unambiguous):
 *   - admittedAt set  -> MATERIALIZING  (never re-admit / never re-create the
 *     ManagedArtifact: continue materialization of the already-admitted artifact).
 *   - stagedAt set    -> VERIFYING      (last verified pre-admission step; re-run
 *     verification before any future admission).
 *   - otherwise       -> STABILIZING    (nothing was staged/verified yet; re-run
 *     the stabilization wait before staging).
 */
export function captureResumeTarget(entry: CaptureLedgerEntry): CaptureState {
  if (entry.state !== 'FAILED_RECOVERABLE') {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Resume is only legal from FAILED_RECOVERABLE (current: ${entry.state}).`,
      409,
      { from: entry.state },
    );
  }
  if (entry.admittedAt !== null) return 'MATERIALIZING';
  if (entry.stagedAt !== null) return 'VERIFYING';
  return 'STABILIZING';
}

/**
 * Derives the deterministic EXPLICIT resolution target for an UNRESOLVED
 * capture from persisted milestone timestamps only (no schema change;
 * unambiguous). Resolution must never skip STAGING:
 *   - admittedAt set  -> fail closed. No currently allowed UNRESOLVED entry
 *     path can carry an admission (UNRESOLVED is only reachable from
 *     DETECTED/STABILIZING/VERIFYING, and VERIFYING -> UNRESOLVED happens
 *     before ADMITTED), so an admitted UNRESOLVED row is corrupt state and
 *     must not be silently routed anywhere.
 *   - stagedAt set    -> VERIFYING  (the capture was staged and verified up to
 *     the verification step; explicit resolution re-enters verification).
 *   - otherwise       -> STABILIZING (DETECTED- or STABILIZING-origin: nothing
 *     was staged yet; resolution re-enters the stabilization wait, never
 *     skipping STABILIZING/STAGED).
 */
export function captureResolveTarget(entry: CaptureLedgerEntry): CaptureState {
  if (entry.state !== 'UNRESOLVED') {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Resolution is only legal from UNRESOLVED (current: ${entry.state}).`,
      409,
      { from: entry.state },
    );
  }
  if (entry.admittedAt !== null) {
    throw new DomainError(
      'CONFLICT',
      'An UNRESOLVED capture with an admission milestone cannot be resolved; the ledger state is inconsistent.',
      409,
      { captureId: entry.captureId },
    );
  }
  if (entry.stagedAt !== null) return 'VERIFYING';
  return 'STABILIZING';
}

/** Optional fields carried by a single capture state transition. */
export interface CaptureTransitionOptions {
  /** Failure reason — REQUIRED when moving into UNRESOLVED / FAILED_RECOVERABLE. */
  error?: string | null;
  /** Final ManagedArtifact identity — REQUIRED when entering ADMITTED/COMPLETED. */
  finalArtifactId?: string | null;
  /** Final ArtifactVersion identity — REQUIRED when entering COMPLETED. */
  finalVersionId?: string | null;
  /**
   * Increment attemptCount by exactly one. TRUE ONLY on an explicit
   * recovery/resume attempt — never on ordinary forward transitions
   * (attemptCount = 0 at DETECTED; each resume adds 1).
   */
  incrementAttemptCount?: boolean;
}

/**
 * Applies a single valid capture transition (pure domain authority; never
 * persists). Invalid transitions throw `DomainError('INVALID_TRANSITION', 409)`.
 *
 * Invariants enforced here:
 *   - ADMITTED requires `finalArtifactId` (the managed identity exists by
 *     admission; the final VERSION may still be created later).
 *   - COMPLETED requires `finalArtifactId` AND `finalVersionId`.
 *   - Final identities are immutable once set (a differing value is CONFLICT).
 *   - UNRESOLVED / FAILED_RECOVERABLE require a non-empty reason (the `error`
 *     field persists the latest failure; full failure HISTORY is NOT modeled).
 *   - Leaving a failure state toward a healthy flow clears `error`; DISCARDED
 *     retains the latest reason as audit context.
 *   - Milestone timestamps are set only on FIRST entry: `stagedAt` / `admittedAt`
 *     are never rewritten by retries; `completedAt` is stamped once on COMPLETED.
 */
export function transitionCaptureState(
  entry: CaptureLedgerEntry,
  to: CaptureState,
  at: string,
  options: CaptureTransitionOptions = {},
): CaptureLedgerEntry {
  if (!canTransitionCapture(entry.state, to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Transition from ${entry.state} to ${to} is not allowed for a Capture Ledger entry.`,
      409,
      { from: entry.state, to },
    );
  }

  let finalArtifactId = entry.finalArtifactId;
  let finalVersionId = entry.finalVersionId;
  if (options.finalArtifactId !== undefined) {
    if (finalArtifactId !== null && finalArtifactId !== options.finalArtifactId) {
      throw new DomainError(
        'CONFLICT',
        'The final artifact identity of a capture is immutable once set.',
        409,
      );
    }
    finalArtifactId = options.finalArtifactId;
  }
  if (options.finalVersionId !== undefined) {
    if (finalVersionId !== null && finalVersionId !== options.finalVersionId) {
      throw new DomainError(
        'CONFLICT',
        'The final version identity of a capture is immutable once set.',
        409,
      );
    }
    finalVersionId = options.finalVersionId;
  }

  if (to === 'ADMITTED' && finalArtifactId === null) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'ADMITTED requires a finalArtifactId (the managed artifact identity exists by admission).',
      400,
    );
  }
  if (to === 'COMPLETED' && (finalArtifactId === null || finalVersionId === null)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'COMPLETED requires finalArtifactId and finalVersionId.',
      400,
    );
  }

  // UNRESOLVED resolution is milestone-aware (B1): the STABILIZING/VERIFYING
  // edges are NOT generic. A never-staged capture must resolve to STABILIZING
  // (never skipping STAGING); a staged capture resolves to VERIFYING. An
  // admitted UNRESOLVED row is corrupt state and fails closed.
  if (entry.state === 'UNRESOLVED' && (to === 'STABILIZING' || to === 'VERIFYING')) {
    const expected = captureResolveTarget(entry);
    if (to !== expected) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `An UNRESOLVED capture with ${entry.stagedAt === null ? 'no staged milestone' : 'a staged milestone'} must resolve to ${expected}, not ${to}.`,
        409,
        { from: entry.state, to, expected },
      );
    }
  }

  let error = entry.error;
  if (to === 'UNRESOLVED' || to === 'FAILED_RECOVERABLE') {
    const reason = options.error ?? '';
    if (reason.trim().length === 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `A non-empty reason is required when entering ${to}.`,
        400,
      );
    }
    error = reason;
  } else if (to === 'DISCARDED') {
    // Audit context: retain the latest failure reason unless the discard
    // explicitly provides a new one (e.g. user cancellation).
    error = options.error === undefined ? entry.error : options.error;
  } else if (
    (entry.state === 'UNRESOLVED' || entry.state === 'FAILED_RECOVERABLE') &&
    (to === 'STABILIZING' || to === 'VERIFYING' || to === 'MATERIALIZING' || to === 'COMPLETED')
  ) {
    // Healthy forward progress supersedes the previous failure. The failure is
    // no longer the CURRENT failure, and (not being event-sourced) it is not
    // pretended to be retained as history.
    error = null;
  }

  return {
    ...entry,
    state: to,
    attemptCount: options.incrementAttemptCount ? entry.attemptCount + 1 : entry.attemptCount,
    stagedAt: to === 'STAGED' ? (entry.stagedAt ?? at) : entry.stagedAt,
    admittedAt: to === 'ADMITTED' ? (entry.admittedAt ?? at) : entry.admittedAt,
    completedAt: to === 'COMPLETED' ? at : entry.completedAt,
    error,
    finalArtifactId,
    finalVersionId,
  };
}
