import { rm } from 'node:fs/promises';
import type {
  CanonicalOutputRecord,
  CanonicalRevisionRecord,
  OutputRegistryLifecycleState,
} from '@scli/domain';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  outputTemporaryPath,
  resolveCanonicalArtifactPath,
  sha256File,
} from './canonical-artifact-files.js';

/**
 * C0 — Revision composition reservation proof authority.
 *
 * ONE shared proof + disposal boundary reused by BOTH composition callers:
 *
 *  - CanonicalArtifactReconciler (crash/restart survival), and
 *  - RevisionDeliverableService Resume Revision (explicit draft repair),
 *
 * so a MANUAL_DELIVERABLES composition draft can never be repaired through two
 * divergent semantics.
 *
 * Responsibility split is deliberate and must stay clean:
 *
 *  - filesystem/hash PROOF lives here (service/reconciler layer);
 *  - DB invariants live in CanonicalOutputRegistryStore.
 *
 * The Store never pretends it can prove filesystem state, and this module never
 * pretends it can authorize a DB mutation.
 */

/**
 * The canonical Output lifecycles that may still hold an UNPROVEN reservation.
 * FINALIZED is proven and LEGACY_IMPORTED is historical; neither is a reservation.
 */
const unprovenReservationLifecycles: readonly OutputRegistryLifecycleState[] = [
  'PREPARING',
  'FAILED_RECOVERABLE',
];

export function isUnprovenOutputReservationLifecycle(state: OutputRegistryLifecycleState): boolean {
  return unprovenReservationLifecycles.includes(state);
}

/**
 * A composed design draft: exactly ONE canonical Revision whose creation
 * provenance is MANUAL_DELIVERABLES and which is still PREPARING.
 *
 * canonicalOperation is creation provenance and a recovery discriminator — NOT
 * an exclusive content type. Such a Revision may legitimately carry immutable
 * DocumentSnapshots AND canonical GeneratedOutputs.
 */
export function isManualCompositionDraftRevision(revision: CanonicalRevisionRecord): boolean {
  return (
    revision.provenanceClassification === 'CANONICAL' &&
    revision.lifecycleState === 'PREPARING' &&
    revision.projectSnapshot?.canonicalOperation === 'MANUAL_DELIVERABLES'
  );
}

export type CanonicalReservationProof =
  | {
      /** The final artifact exists and matches the Output's persisted SHA-256. */
      readonly kind: 'PROVEN_FINAL';
      readonly finalPath: string;
      readonly temporaryPath: string;
      readonly temporaryRemains: boolean;
    }
  | {
      /** No legitimate final artifact can be proven for this reservation. */
      readonly kind: 'UNPROVEN';
      readonly reason: 'FINAL_ARTIFACT_MISSING' | 'FINAL_ARTIFACT_UNPROVEN';
      readonly temporaryPath: string;
      readonly temporaryRemains: boolean;
    }
  | {
      /** Neither proof nor safe disposal is possible (no Project root / no safe locator). */
      readonly kind: 'UNPROVABLE';
    };

/**
 * Proves whether a canonical Output reservation owns a complete final artifact.
 *
 * Never mutates the database and never deletes anything. A reservation is proven
 * ONLY by a real FILE at its safe project-scoped locator whose bytes hash to the
 * persisted content hash — an existing but unhashed/mismatched file is never
 * claimed as this Output's artifact.
 */
export async function proveCanonicalOutputReservation(
  projectRoot: string | null,
  output: CanonicalOutputRecord,
): Promise<CanonicalReservationProof> {
  if (!projectRoot || output.locatorKind !== 'PROJECT_RELATIVE' || !output.locatorValue) {
    return { kind: 'UNPROVABLE' };
  }
  let finalPath: string;
  try {
    finalPath = resolveCanonicalArtifactPath(projectRoot, output.locatorValue);
  } catch {
    // An escaping/unsafe locator is never opened and never disposed of blindly.
    return { kind: 'UNPROVABLE' };
  }
  const temporaryPath = outputTemporaryPath(finalPath, output.outputId);
  const finalKind = await artifactPathKind(finalPath);
  const temporaryRemains = (await artifactPathKind(temporaryPath)) !== 'MISSING';
  if (finalKind === 'FILE' && output.contentHash) {
    if ((await sha256File(finalPath)) === output.contentHash) {
      return { kind: 'PROVEN_FINAL', finalPath, temporaryPath, temporaryRemains };
    }
  }
  return {
    kind: 'UNPROVEN',
    reason: finalKind === 'FILE' ? 'FINAL_ARTIFACT_UNPROVEN' : 'FINAL_ARTIFACT_MISSING',
    temporaryPath,
    temporaryRemains,
  };
}

/**
 * Finalizes a hash-proven canonical Output reservation through the EXISTING
 * store lifecycle authority.
 *
 * FAILED_RECOVERABLE -> FINALIZED is not a permitted single hop, so a proven
 * failed reservation is first returned to PREPARING through the store's existing
 * repair transition rather than weakening that authority.
 */
export function finalizeProvenCanonicalOutputReservation(
  registry: CanonicalOutputRegistryStore,
  output: CanonicalOutputRecord,
): void {
  if (output.lifecycleState === 'FAILED_RECOVERABLE') {
    registry.setOutputLifecycle(output.outputId, 'PREPARING');
  }
  registry.setOutputLifecycle(output.outputId, 'FINALIZED');
}

/**
 * Discards ONE proven-unproven canonical Output reservation.
 *
 * The DB authority runs FIRST so a forbidden discard surfaces its authority
 * error and is never masked by filesystem cleanup. Only the outputId-keyed temp
 * sidecar this Output provably owns is then removed, through the existing
 * bounded best-effort cleanup convention. The final artifact path is NEVER
 * touched: an unproven file there is not ours to delete.
 */
export async function discardCanonicalOutputReservation(
  registry: CanonicalOutputRegistryStore,
  output: CanonicalOutputRecord,
  proof: Extract<CanonicalReservationProof, { kind: 'UNPROVEN' }>,
): Promise<void> {
  registry.discardUnprovenOutputReservation({
    outputId: output.outputId,
    projectId: output.projectId,
    revisionId: output.revisionId ?? '',
  });
  await rm(proof.temporaryPath, { force: true }).catch(() => undefined);
}
