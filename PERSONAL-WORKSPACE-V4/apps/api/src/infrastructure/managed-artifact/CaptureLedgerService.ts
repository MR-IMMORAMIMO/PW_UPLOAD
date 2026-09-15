/**
 * AUTO-01C — Capture Ledger service authority (API/service layer).
 *
 * The ONE narrow service authority that owns product lifecycle semantics for
 * the durable capture ledger / stateful audit-recovery record:
 *   - create a detected capture (DETECTED only; no caller may create directly
 *     into ADMITTED/COMPLETED/FAILED_RECOVERABLE/...)
 *   - get / list (no delete)
 *   - advance one strict forward step
 *   - mark unresolved / mark failed recoverable / resolve / resume / discard /
 *     complete
 *
 * It wraps the existing `ManagedArtifactStore` persistence (no duplicate
 * storage) and delegates every transition decision to the domain state
 * machine (`transitionCaptureState` / `captureResumeTarget`). Callers must NOT
 * reach for low-level `store.transitionCaptureState(...)` to drive lifecycle
 * semantics — this service is the canonical owner of those transitions.
 *
 * Scope (owner-locked):
 *   - No filesystem watcher, stabilization, staging, hashing, materialization,
 *     ManagedArtifact admission, ArtifactVersion creation, recovery worker,
 *     adapters, or UI lives here. Tests may seed ManagedArtifact/ArtifactVersion
 *     rows only to prove the final-lineage invariants.
 *   - No new-capture authorization is re-implemented here: AUTO-01B's
 *     `authorizeNewCapture` remains authoritative BEFORE a new capture ledger
 *     row is created (future flow: authorizeNewCapture -> AUTHORIZED ->
 *     createDetectedCapture). This service contains NO allow-list rules.
 *   - Recovery of an already-owned ledger capture does NOT call new-capture
 *     authorization; it verifies the ledger owns the capture and that the
 *     historical ToolContext identity matches (AUTO-01B relationship).
 */

import {
  DomainError,
  captureForwardTarget,
  captureResolveTarget,
  captureResumeTarget,
} from '@scli/domain';
import type { CaptureLedgerEntry, CaptureRoutingDecisionInput, CaptureState } from '@scli/domain';
import { ManagedArtifactStore } from './ManagedArtifactStore';
import type { ProvenDetectedCaptureInput } from './ManagedArtifactStore';

/** Inputs to create a new detected capture (always starts DETECTED). */
export interface CreateDetectedCaptureInput {
  projectId: string;
  targetRevisionId?: string | null;
  toolContextId?: string | null;
  sourcePath: string;
  sourceChannel: string;
  expectedArtifactType: string;
  detectedAt: string;
}

/** Result of a forward/advance transition (safe replay awareness). */
export interface CaptureAdvanceResult {
  entry: CaptureLedgerEntry;
  /** False when the entry was already at the requested target (idempotent replay). */
  transitioned: boolean;
}

/**
 * One narrow service authority for the CaptureLedger lifecycle. Wraps the
 * existing `ManagedArtifactStore` persistence; it does NOT duplicate storage.
 */
export class CaptureLedgerService {
  private readonly store: ManagedArtifactStore;

  public constructor(store: ManagedArtifactStore) {
    this.store = store;
  }

  /** Get a single ledger entry (readable for audit; never deleted). */
  public get(captureId: string): CaptureLedgerEntry {
    return this.store.getCaptureLedgerEntry(captureId);
  }

  /** List ledger entries, optionally filtered by project. */
  public list(projectId?: string): CaptureLedgerEntry[] {
    return this.store.listCaptureLedgerEntries(projectId);
  }

  /**
   * Create a new capture. ALWAYS starts DETECTED with attemptCount 0 — no
   * caller may create directly into ADMITTED/COMPLETED/FAILED_RECOVERABLE/...
   * through this product service.
   */
  public createDetectedCapture(input: CreateDetectedCaptureInput): CaptureLedgerEntry {
    return this.store.createCaptureLedgerEntry({ ...input, state: 'DETECTED' });
  }

  public findOrCreateProvenDetectedCapture(input: ProvenDetectedCaptureInput): {
    entry: CaptureLedgerEntry;
    created: boolean;
  } {
    return this.store.findOrCreateProvenDetectedCapture(input);
  }

  /** Record the one immutable routing decision and its audit provenance. */
  public recordRoutingDecision(
    captureId: string,
    input: CaptureRoutingDecisionInput,
  ): CaptureLedgerEntry {
    return this.store.recordCaptureRoutingDecision(captureId, input);
  }

  /**
   * Advance exactly ONE strict forward step (DETECTED -> STABILIZING -> STAGED
   * -> VERIFYING -> ADMITTED -> MATERIALIZING -> COMPLETED). No skipping.
   * Safe replay: if the entry is ALREADY at the requested target (a
   * lost-response retry), it is returned unchanged with `transitioned: false`.
   * Ordinary advance NEVER moves a FAILED_RECOVERABLE or UNRESOLVED capture
   * (dedicated resume/resolve operations own those exits).
   */
  public advance(
    captureId: string,
    at: string,
    options: { finalArtifactId?: string | null; finalVersionId?: string | null } = {},
  ): CaptureAdvanceResult {
    const current = this.store.getCaptureLedgerEntry(captureId);
    const target = captureForwardTarget(current.state);
    if (target === null) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Capture ${current.state} has no forward advance target.`,
        409,
        { from: current.state },
      );
    }
    // Whenever the final artifact identity is (first) set, it must already
    // belong to the ledger project — a cross-project identity can never be
    // persisted, so admission/finalization can never produce an impossible
    // lineage.
    if (options.finalArtifactId !== undefined && options.finalArtifactId !== null) {
      this.assertFinalArtifactOwnership(current, options.finalArtifactId);
    }
    return this.applyTransition(current, target, at, options);
  }

  /**
   * Explicit failure: move to UNRESOLVED (fail-closed, non-destructive; no
   * automatic continuation). A non-empty reason is required.
   */
  public markUnresolved(captureId: string, reason: string, at: string): CaptureLedgerEntry {
    return this.store.transitionCaptureState(captureId, 'UNRESOLVED', at, { error: reason });
  }

  /**
   * Explicit failure: move to FAILED_RECOVERABLE, preserving enough ledger
   * state (milestone timestamps + final identities) to resume safely. A
   * non-empty reason is required.
   */
  public markFailedRecoverable(captureId: string, reason: string, at: string): CaptureLedgerEntry {
    return this.store.transitionCaptureState(captureId, 'FAILED_RECOVERABLE', at, {
      error: reason,
    });
  }

  /**
   * The ONLY operation that moves a FAILED_RECOVERABLE capture forward again.
   * Ordinary `advance` refuses FAILED_RECOVERABLE; this dedicated operation
   * derives the deterministic resume target from the recorded milestone
   * timestamps (STABILIZING / VERIFYING / MATERIALIZING) and increments
   * attemptCount exactly once per explicit resume attempt.
   */
  public resume(captureId: string, at: string): CaptureLedgerEntry {
    const current = this.store.getCaptureLedgerEntry(captureId);
    const target = captureResumeTarget(current);
    return this.store.transitionCaptureState(captureId, target, at, {
      incrementAttemptCount: true,
    });
  }

  /**
   * Explicit resolution of an UNRESOLVED capture (manual, future workflow).
   * UNRESOLVED never auto-advances; only this explicit operation may move it.
   * The target is milestone-aware (domain `captureResolveTarget`): a
   * never-staged capture resolves to STABILIZING (never skipping STAGING), a
   * staged capture resolves to VERIFYING. The current unresolved error is
   * cleared only by the successful healthy transition; prior milestone
   * timestamps are preserved.
   */
  public resolve(captureId: string, at: string): CaptureLedgerEntry {
    const current = this.store.getCaptureLedgerEntry(captureId);
    const target = captureResolveTarget(current);
    return this.store.transitionCaptureState(captureId, target, at);
  }

  /**
   * Explicit discard. Terminal: no reactivation, no row deletion, no source
   * deletion. Admitted/materializing captures may not be silently discarded;
   * they must first fail (FAILED_RECOVERABLE) so an admitted operation is
   * never abandoned without a record.
   */
  public discard(captureId: string, at: string, reason?: string | null): CaptureLedgerEntry {
    // When no reason is supplied, omit the option entirely so the domain
    // retains the latest failure reason as audit context (never silently
    // clears it).
    return this.store.transitionCaptureState(
      captureId,
      'DISCARDED',
      at,
      reason === undefined ? {} : { error: reason },
    );
  }

  /**
   * Complete a capture. Requires finalArtifactId + finalVersionId and proves
   * the final lineage BEFORE persisting:
   *   - the ArtifactVersion belongs to finalArtifactId,
   *   - the final artifact belongs to the ledger project,
   *   - the final version therefore belongs to the ledger project via artifact
   *     ownership.
   * Cross-project / cross-artifact completions reject truthfully. `completedAt`
   * is stamped once; the ledger row is never deleted on completion.
   *
   * Idempotent replay (H3): a retried complete on an already-COMPLETED capture
   * with the SAME identities is a safe no-op returning the current entry; a
   * retry with a DIVERGENT identity is a CONFLICT and never silently swallowed.
   */
  public complete(
    captureId: string,
    finalArtifactId: string,
    finalVersionId: string,
    at: string,
  ): CaptureLedgerEntry {
    const current = this.store.getCaptureLedgerEntry(captureId);
    if (current.state === 'COMPLETED') {
      if (
        current.finalArtifactId === finalArtifactId &&
        current.finalVersionId === finalVersionId
      ) {
        return current;
      }
      throw new DomainError(
        'CONFLICT',
        'The final identity of a completed capture is immutable.',
        409,
        { captureId: current.captureId },
      );
    }
    this.assertFinalLineage(current, finalArtifactId, finalVersionId);
    return this.store.transitionCaptureState(captureId, 'COMPLETED', at, {
      finalArtifactId,
      finalVersionId,
    });
  }

  /**
   * Recovery relationship with the Tool Context (AUTO-01B / AUTO-D06):
   *
   * An EXPIRED (or CLOSED) Tool Context can never authorize a NEW capture, but
   * a capture already DETECTED while the context was authorized may continue
   * and recover even after the context expires. Recovery verifies only that
   * the ledger already OWNS the capture (it exists) and that the historical
   * ToolContext identity recorded on the ledger matches the caller's claim.
   * It never calls `authorizeNewCapture` again (that would wrongly require a
   * LIVE/REBOUND context), and it never requires reopening/rebinding the
   * context merely to recover. An unknown or mismatched historical context
   * fails truthfully.
   */
  public assertOwnedRecoveryContext(
    captureId: string,
    toolContextId: string | null,
  ): CaptureLedgerEntry {
    const entry = this.store.getCaptureLedgerEntry(captureId);
    if (entry.toolContextId !== toolContextId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The historical Tool Context identity does not match the ledger capture.',
        400,
        { captureId: entry.captureId },
      );
    }
    return entry;
  }

  /** No delete operation exists: the ledger is audit truth and rows are never deleted. */

  private assertFinalLineage(
    entry: CaptureLedgerEntry,
    finalArtifactId: string,
    finalVersionId: string,
  ): void {
    this.assertFinalArtifactOwnership(entry, finalArtifactId);
    const version = this.store.getArtifactVersion(finalVersionId);
    if (version.artifactId !== finalArtifactId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The final version must belong to the final artifact.',
        400,
        { artifactId: finalArtifactId, versionArtifactId: version.artifactId },
      );
    }
    // Same-artifact + same-project lineage is now proven: the artifact belongs
    // to the ledger project and the version belongs to that artifact.
  }

  /** The final ManagedArtifact must belong to the ledger project (same-project rule). */
  private assertFinalArtifactOwnership(entry: CaptureLedgerEntry, finalArtifactId: string): void {
    const artifact = this.store.getManagedArtifact(finalArtifactId);
    if (artifact.projectId !== entry.projectId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The final artifact must belong to the ledger project.',
        400,
        { projectId: entry.projectId, artifactProjectId: artifact.projectId },
      );
    }
  }

  /**
   * Applies a transition through the domain authority, with safe replay: when
   * the entry is ALREADY at the requested target, it is returned unchanged
   * (`transitioned: false`) — a lost-response retry must not re-stamp
   * timestamps or bump attempts. A replay is a no-op ONLY when its payload is
   * consistent with the persisted identity: a divergent finalArtifactId /
   * finalVersionId on a same-state replay is a CONFLICT, never silently
   * swallowed. Otherwise the transition is applied atomically via the store.
   */
  private applyTransition(
    current: CaptureLedgerEntry,
    to: CaptureState,
    at: string,
    options: { finalArtifactId?: string | null; finalVersionId?: string | null } = {},
  ): CaptureAdvanceResult {
    if (current.state === to) {
      this.assertReplayIdentityConsistent(current, options);
      return { entry: current, transitioned: false };
    }
    const next = this.store.transitionCaptureState(current.captureId, to, at, options);
    return { entry: next, transitioned: true };
  }

  /**
   * H3 — a same-state replay must never diverge from the persisted final
   * identity. When the replay supplies an identity and the persisted identity
   * is already set to a DIFFERENT value, the retry is a divergent request and
   * fails closed with CONFLICT (the persisted identity remains untouched).
   */
  private assertReplayIdentityConsistent(
    current: CaptureLedgerEntry,
    options: { finalArtifactId?: string | null; finalVersionId?: string | null },
  ): void {
    if (
      options.finalArtifactId !== undefined &&
      options.finalArtifactId !== null &&
      current.finalArtifactId !== null &&
      current.finalArtifactId !== options.finalArtifactId
    ) {
      throw new DomainError(
        'CONFLICT',
        'The final artifact identity of a capture is immutable once set.',
        409,
        { captureId: current.captureId, persisted: current.finalArtifactId },
      );
    }
    if (
      options.finalVersionId !== undefined &&
      options.finalVersionId !== null &&
      current.finalVersionId !== null &&
      current.finalVersionId !== options.finalVersionId
    ) {
      throw new DomainError(
        'CONFLICT',
        'The final version identity of a capture is immutable once set.',
        409,
        { captureId: current.captureId, persisted: current.finalVersionId },
      );
    }
  }
}
