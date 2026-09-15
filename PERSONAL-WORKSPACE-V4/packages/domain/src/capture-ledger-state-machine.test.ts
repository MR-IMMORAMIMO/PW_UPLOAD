/**
 * AUTO-01C — Capture Ledger state machine (domain authority).
 *
 * Pure domain authority proving the owner-locked capture state graph:
 *   - Strict forward chain with NO skipping (DETECTED -> STABILIZING -> STAGED ->
 *     VERIFYING -> ADMITTED -> MATERIALIZING -> COMPLETED).
 *   - Explicit degraded edges (UNRESOLVED / FAILED_RECOVERABLE / DISCARDED).
 *   - Terminal states (COMPLETED / DISCARDED) accept no outgoing transitions.
 *   - Deterministic resume derivation from persisted milestone timestamps
 *     (no generic FAILED_RECOVERABLE -> ANY).
 *   - ADMITTED requires finalArtifactId; COMPLETED requires finalArtifactId +
 *     finalVersionId; final identities are immutable.
 *   - Milestone timestamps are set only on first entry; failure reasons are
 *     required when entering failure states and cleared on healthy progress.
 *
 * Persistence and atomic transition behavior are proven separately through the
 * service layer (apps/api/src/auto01c-capture-ledger-state-machine.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  DomainError,
  canTransitionCapture,
  captureForwardTarget,
  captureResolveTarget,
  captureResumeTarget,
  transitionCaptureState,
  type CaptureLedgerEntry,
  type CaptureState,
} from './index';

const CAPTURE_ID = 'a0000000-0000-4000-8000-0000000000c1';
const PROJECT_ID = 'a0000000-0000-4000-8000-0000000000c2';
const TOOL_CONTEXT_ID = 'a0000000-0000-4000-8000-0000000000c3';
const ARTIFACT_ID = 'a0000000-0000-4000-8000-0000000000c4';
const VERSION_ID = 'a0000000-0000-4000-8000-0000000000c5';
const AT = '2026-08-20T09:00:00.000Z';

function makeEntry(overrides: Partial<CaptureLedgerEntry> = {}): CaptureLedgerEntry {
  return {
    captureId: CAPTURE_ID,
    projectId: PROJECT_ID,
    targetRevisionId: null,
    toolContextId: TOOL_CONTEXT_ID,
    sourcePath: 'C:/exports/Layout.pdf',
    sourceChannel: 'autocad-session-1',
    expectedArtifactType: 'LightingLayout',
    contentHash: null,
    sizeBytes: null,
    state: 'DETECTED',
    attemptCount: 0,
    detectedAt: AT,
    stagedAt: null,
    admittedAt: null,
    completedAt: null,
    error: null,
    finalArtifactId: null,
    finalVersionId: null,
    routingDecision: null,
    routingReason: null,
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    createdAt: AT,
    ...overrides,
  };
}

function advance(
  entry: CaptureLedgerEntry,
  to: CaptureState,
  at: string = AT,
  options: Parameters<typeof transitionCaptureState>[3] = {},
): CaptureLedgerEntry {
  return transitionCaptureState(entry, to, at, options);
}

describe('AUTO-01C capture state machine', () => {
  it('C1: forward chain is exactly DETECTED -> STABILIZING -> STAGED -> VERIFYING -> ADMITTED -> MATERIALIZING -> COMPLETED', () => {
    const chain: CaptureState[] = [
      'DETECTED',
      'STABILIZING',
      'STAGED',
      'VERIFYING',
      'ADMITTED',
      'MATERIALIZING',
      'COMPLETED',
    ];
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(canTransitionCapture(chain[i]!, chain[i + 1]!)).toBe(true);
      expect(captureForwardTarget(chain[i]!)).toBe(chain[i + 1]);
    }
    expect(captureForwardTarget('COMPLETED')).toBeNull();
  });

  it('C2: every forward hop is exactly one step (no skipping anywhere in the chain)', () => {
    const chain: CaptureState[] = [
      'DETECTED',
      'STABILIZING',
      'STAGED',
      'VERIFYING',
      'ADMITTED',
      'MATERIALIZING',
      'COMPLETED',
    ];
    for (let i = 0; i < chain.length; i += 1) {
      for (let j = i + 2; j < chain.length; j += 1) {
        expect(canTransitionCapture(chain[i]!, chain[j]!)).toBe(false);
      }
    }
    // The canonical illegal skips from the AUTO-01C spec.
    expect(canTransitionCapture('DETECTED', 'COMPLETED')).toBe(false);
    expect(canTransitionCapture('DETECTED', 'ADMITTED')).toBe(false);
    expect(canTransitionCapture('STAGED', 'COMPLETED')).toBe(false);
  });

  it('C3: terminal states accept no outgoing transitions', () => {
    for (const from of ['COMPLETED', 'DISCARDED'] as const) {
      for (const to of [
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
      ] as const) {
        expect(canTransitionCapture(from, to)).toBe(false);
      }
    }
  });

  it('C4: transitionCaptureState throws INVALID_TRANSITION for illegal edges', () => {
    expect(() => advance(makeEntry(), 'COMPLETED')).toThrow(DomainError);
    expect(() => advance(makeEntry(), 'ADMITTED')).toThrow(DomainError);
    const staged = advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING');
    expect(() => advance(staged, 'COMPLETED')).toThrow(DomainError);
    expect(() => advance(makeEntry({ state: 'COMPLETED' }), 'STABILIZING')).toThrow(DomainError);
    expect(() => advance(makeEntry({ state: 'DISCARDED' }), 'STABILIZING')).toThrow(DomainError);
  });

  it('C5: ADMITTED requires finalArtifactId; the final version may still be absent at admission', () => {
    const verifying = advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING');
    expect(() => advance(verifying, 'ADMITTED')).toThrow(DomainError);
    const admitted = advance(verifying, 'ADMITTED', AT, { finalArtifactId: ARTIFACT_ID });
    expect(admitted.state).toBe('ADMITTED');
    expect(admitted.finalArtifactId).toBe(ARTIFACT_ID);
    expect(admitted.finalVersionId).toBeNull();
    expect(admitted.admittedAt).toBe(AT);
  });

  it('C6: COMPLETED requires finalArtifactId AND finalVersionId', () => {
    const admitted = advance(
      advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING'),
      'ADMITTED',
      AT,
      { finalArtifactId: ARTIFACT_ID },
    );
    const materializing = advance(admitted, 'MATERIALIZING');
    expect(() => advance(materializing, 'COMPLETED')).toThrow(DomainError);
    expect(() => advance(materializing, 'COMPLETED', AT, { finalArtifactId: ARTIFACT_ID })).toThrow(
      DomainError,
    );
    const completed = advance(materializing, 'COMPLETED', AT, {
      finalArtifactId: ARTIFACT_ID,
      finalVersionId: VERSION_ID,
    });
    expect(completed.state).toBe('COMPLETED');
    expect(completed.finalArtifactId).toBe(ARTIFACT_ID);
    expect(completed.finalVersionId).toBe(VERSION_ID);
    expect(completed.completedAt).toBe(AT);
  });

  it('C7: final identities are immutable once set (CONFLICT)', () => {
    const otherArtifact = 'a0000000-0000-4000-8000-0000000000c6';
    const admitted = advance(
      advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING'),
      'ADMITTED',
      AT,
      { finalArtifactId: ARTIFACT_ID },
    );
    expect(() =>
      advance(admitted, 'MATERIALIZING', AT, { finalArtifactId: otherArtifact }),
    ).toThrow(DomainError);
  });

  it('C8: UNRESOLVED requires a reason; VERIFYING -> UNRESOLVED is legal and explicit', () => {
    const verifying = advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING');
    expect(() => advance(verifying, 'UNRESOLVED')).toThrow(DomainError);
    const unresolved = advance(verifying, 'UNRESOLVED', AT, { error: 'ambiguous provenance' });
    expect(unresolved.state).toBe('UNRESOLVED');
    expect(unresolved.error).toBe('ambiguous provenance');
  });

  it('C9: FAILED_RECOVERABLE requires a reason; resume target derives from milestones', () => {
    // Failed before staging -> resume at STABILIZING.
    const early = advance(makeEntry(), 'FAILED_RECOVERABLE', AT, { error: 'source vanished' });
    expect(captureResumeTarget(early)).toBe('STABILIZING');

    // Failed after staging (stagedAt set) -> resume at VERIFYING.
    const staged = advance(advance(makeEntry(), 'STABILIZING'), 'STAGED');
    const afterStaging = advance(staged, 'FAILED_RECOVERABLE', AT, { error: 'hash mismatch' });
    expect(captureResumeTarget(afterStaging)).toBe('VERIFYING');
    expect(staged.stagedAt).toBe(AT);
    expect(afterStaging.stagedAt).toBe(AT);

    // Failed after ADMITTED -> resume at MATERIALIZING (never re-admit).
    const admitted = advance(
      advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING'),
      'ADMITTED',
      AT,
      { finalArtifactId: ARTIFACT_ID },
    );
    const materializing = advance(admitted, 'MATERIALIZING');
    const afterAdmission = advance(materializing, 'FAILED_RECOVERABLE', AT, {
      error: 'disk write failed',
    });
    expect(captureResumeTarget(afterAdmission)).toBe('MATERIALIZING');
    expect(afterAdmission.finalArtifactId).toBe(ARTIFACT_ID);
  });

  it('C10: captureResumeTarget refuses non-FAILED_RECOVERABLE entries', () => {
    expect(() => captureResumeTarget(makeEntry())).toThrow(DomainError);
    expect(() => captureResumeTarget(makeEntry({ state: 'UNRESOLVED' }))).toThrow(DomainError);
  });

  it('C11: healthy recovery clears the previous failure error; retries do not rewrite milestones', () => {
    // Failure after staging -> resume at VERIFYING -> error cleared.
    const staged = advance(advance(makeEntry(), 'STABILIZING'), 'STAGED');
    const failed = advance(staged, 'FAILED_RECOVERABLE', AT, { error: 'verify failed' });
    const resumed = advance(failed, 'VERIFYING', AT);
    expect(resumed.state).toBe('VERIFYING');
    expect(resumed.error).toBeNull();
    expect(resumed.stagedAt).toBe(staged.stagedAt);

    // Re-staging after resume keeps the ORIGINAL stagedAt.
    const restaged = advance(
      advance(resumed, 'ADMITTED', AT, { finalArtifactId: ARTIFACT_ID }),
      'MATERIALIZING',
    );
    const restagedAgain = advance(restaged, 'FAILED_RECOVERABLE', AT, { error: 'again' });
    expect(restagedAgain.stagedAt).toBe(staged.stagedAt);
    expect(restagedAgain.admittedAt).toBe(AT);
  });

  it('C12: DISCARDED retains the latest error as audit context and is terminal', () => {
    const discarded = advance(makeEntry(), 'DISCARDED', AT, { error: 'duplicate event' });
    expect(discarded.state).toBe('DISCARDED');
    expect(discarded.error).toBe('duplicate event');
    expect(() => advance(discarded, 'DETECTED')).toThrow(DomainError);
    expect(() => advance(discarded, 'STABILIZING')).toThrow(DomainError);
    expect(() => advance(discarded, 'UNRESOLVED')).toThrow(DomainError);
  });

  it('C13: UNRESOLVED exits are explicit only (resolve via milestone-aware targets, escalate, or discard)', () => {
    advance(
      advance(advance(advance(makeEntry(), 'STABILIZING'), 'STAGED'), 'VERIFYING'),
      'UNRESOLVED',
      AT,
      { error: 'insufficient authority' },
    );
    // The two resolve edges are the milestone-derived outputs of
    // `captureResolveTarget` (STABILIZING when never staged, VERIFYING when
    // staged); they are NOT generic (the milestone precondition is enforced by
    // `transitionCaptureState`).
    expect(canTransitionCapture('UNRESOLVED', 'STABILIZING')).toBe(true);
    expect(canTransitionCapture('UNRESOLVED', 'VERIFYING')).toBe(true);
    expect(canTransitionCapture('UNRESOLVED', 'FAILED_RECOVERABLE')).toBe(true);
    expect(canTransitionCapture('UNRESOLVED', 'DISCARDED')).toBe(true);
    expect(canTransitionCapture('UNRESOLVED', 'ADMITTED')).toBe(false);
    expect(canTransitionCapture('UNRESOLVED', 'MATERIALIZING')).toBe(false);
    expect(canTransitionCapture('UNRESOLVED', 'COMPLETED')).toBe(false);
  });

  it('C16: milestone-aware resolution — never-staged UNRESOLVED resolves to STABILIZING, never VERIFYING', () => {
    // DETECTED-origin UNRESOLVED (stagedAt null).
    const detectedOrigin = advance(makeEntry(), 'UNRESOLVED', AT, { error: 'ambiguous' });
    expect(captureResolveTarget(detectedOrigin)).toBe('STABILIZING');
    const resolved = advance(detectedOrigin, 'STABILIZING', AT);
    expect(resolved.state).toBe('STABILIZING');
    expect(resolved.stagedAt).toBeNull();
    expect(resolved.error).toBeNull();
    // The unsafe static path is rejected by the domain authority.
    expect(() => advance(detectedOrigin, 'VERIFYING', AT)).toThrow(DomainError);

    // STABILIZING-origin UNRESOLVED (stagedAt null) also resolves to STABILIZING.
    const stabilizingOrigin = advance(advance(makeEntry(), 'STABILIZING'), 'UNRESOLVED', AT, {
      error: 'source vanished',
    });
    expect(captureResolveTarget(stabilizingOrigin)).toBe('STABILIZING');
    expect(() => advance(stabilizingOrigin, 'VERIFYING', AT)).toThrow(DomainError);
  });

  it('C17: staged VERIFYING-origin UNRESOLVED resolves to VERIFYING and preserves stagedAt', () => {
    const staged = advance(advance(makeEntry(), 'STABILIZING'), 'STAGED');
    const verifying = advance(staged, 'VERIFYING');
    const unresolved = advance(verifying, 'UNRESOLVED', AT, { error: 'provenance unclear' });
    expect(captureResolveTarget(unresolved)).toBe('VERIFYING');
    const resolved = advance(unresolved, 'VERIFYING', AT);
    expect(resolved.state).toBe('VERIFYING');
    expect(resolved.stagedAt).toBe(staged.stagedAt);
    expect(resolved.error).toBeNull();
    // A staged capture must never rewind to STABILIZING.
    expect(() => advance(unresolved, 'STABILIZING', AT)).toThrow(DomainError);
  });

  it('C18: captureResolveTarget refuses non-UNRESOLVED entries and admitted UNRESOLVED rows', () => {
    expect(() => captureResolveTarget(makeEntry())).toThrow(DomainError);
    expect(() => captureResolveTarget(makeEntry({ state: 'FAILED_RECOVERABLE' }))).toThrow(
      DomainError,
    );
    // Corrupt state: an UNRESOLVED row carrying an admission milestone fails closed.
    const corrupt = makeEntry({
      state: 'UNRESOLVED',
      admittedAt: AT,
      finalArtifactId: ARTIFACT_ID,
    });
    expect(() => captureResolveTarget(corrupt)).toThrow(DomainError);
  });

  it('C14: ADMITTED/MATERIALIZING cannot be discarded silently; failure must precede discard', () => {
    expect(canTransitionCapture('ADMITTED', 'DISCARDED')).toBe(false);
    expect(canTransitionCapture('MATERIALIZING', 'DISCARDED')).toBe(false);
    expect(canTransitionCapture('ADMITTED', 'FAILED_RECOVERABLE')).toBe(true);
    expect(canTransitionCapture('MATERIALIZING', 'FAILED_RECOVERABLE')).toBe(true);
  });

  it('C15: attemptCount increments ONLY on explicit resume (incrementAttemptCount)', () => {
    const staged = advance(advance(makeEntry(), 'STABILIZING'), 'STAGED');
    expect(staged.attemptCount).toBe(0);
    const failed = advance(staged, 'FAILED_RECOVERABLE', AT, { error: 'boom' });
    expect(failed.attemptCount).toBe(0);
    const resumed = advance(failed, 'VERIFYING', AT, { incrementAttemptCount: true });
    expect(resumed.attemptCount).toBe(1);
    // Ordinary forward transitions after recovery do NOT increment.
    const admitted = advance(resumed, 'ADMITTED', AT, { finalArtifactId: ARTIFACT_ID });
    expect(admitted.attemptCount).toBe(1);
  });
});
