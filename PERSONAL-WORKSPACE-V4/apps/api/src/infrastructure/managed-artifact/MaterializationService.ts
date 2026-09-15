/**
 * AUTO-01E1 — Materialization foundation (API/service layer).
 *
 * The FIRST controlled transformation of ALREADY-TRUSTED staged bytes into a
 * managed working artifact. This slice builds ONLY the foundation that:
 *   - consumes AUTO-01D trusted staged bytes (hash + size proof already on the
 *     ledger; this service never re-stabilizes or re-hashes the source)
 *   - creates OR resolves a ManagedArtifact at the ADMITTED boundary
 *   - creates OR reuses an ArtifactVersion during MATERIALIZING
 *   - COPYs the staged bytes into application-controlled managed storage
 *   - advances the CaptureLedger through ADMITTED -> MATERIALIZING -> COMPLETED
 *     entirely through the AUTO-01C authority (never direct SQL state updates)
 *
 * Explicitly OUT of scope for AUTO-01E1 (deferred to later slices/engines):
 *   - Undo UX / hard deletion / logical-archive lifecycle
 *   - Filing Engine (destination folder decisions) and Naming Engine (final
 *     filenames) — this slice writes a deterministic TEMPORARY managed path
 *     that those future engines replace
 *   - Revision / Package / Issue / Submissions integration
 *   - AutoCAD / DIALux adapters
 *
 * Authority separation (owner-locked): this is the ORCHESTRATOR. It composes
 * the existing AUTO-01A (ManagedArtifactStore persistence), AUTO-01C
 * (CaptureLedgerService transitions), and AUTO-01D (CaptureStagingService
 * dedup decisions + staged-path authority). It does NOT duplicate any of them:
 * it never writes ManagedArtifact/ArtifactVersion/ledger rows directly beyond
 * what those authorities already own.
 *
 * Source preservation (AUTO-D07): the original source file is NEVER touched.
 * This slice copies the already-staged managed bytes (which themselves are a
 * non-destructive copy of the source); the source is never renamed, moved,
 * deleted, or written.
 *
 * Managed storage: ONE application-owned managed root (default
 * `<dataRoot>/managed`), parallel to `<dataRoot>/capture-stage`. Managed paths
 * derive from the captureId UUID only (never from a user-supplied destination),
 * so two captures can never collide and no component can escape the managed
 * root. The persisted `canonical_path` is a project-relative placeholder
 * (`_managed/<captureId>/source.<ext>`) that satisfies the existing
 * PROJECT_RELATIVE_PATH_PATTERN and will be rewritten by the future Filing /
 * Naming engines.
 *
 * Dedup consumption (AUTO-01D, never reinterpreted):
 *   - `decideDedup` is consumed ONCE per materialization run. A
 *     `DUPLICATE_CONTENT_SAME_ARTIFACT` decision reuses the existing
 *     ArtifactVersion (no duplicate version). Any other decision creates a new
 *     ManagedArtifact for an untargeted capture and a new version under that
 *     artifact (identity is never merged for SAME_BYTES_DIFFERENT_ARTIFACT).
 *   - A `DUPLICATE_EVENT` decision (a live sibling capture owns the same event)
 *     is an UPSTREAM event-dedup concern, not a content-identity concern; it is
 *     not reachable on the AUTO-01E1 content path and is treated as a fresh
 *     working artifact if it somehow arrives.
 */

import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '@scli/domain';
import type { CaptureLedgerEntry } from '@scli/domain';
import { CaptureLedgerService } from './CaptureLedgerService';
import { ManagedArtifactStore } from './ManagedArtifactStore';
import { CaptureStagingService, sha256FileStreaming } from './CaptureStagingService';
import type { CaptureDedupDecision } from './CaptureStagingService';

// ---------------------------------------------------------------------------
// Typed errors (repository convention: DomainError with stable codes)
// ---------------------------------------------------------------------------

export type MaterializationErrorCode =
  'MATERIALIZATION_COPY_FAILED' | 'MATERIALIZATION_HASH_MISMATCH' | 'MANAGED_PATH_INVALID';

export class MaterializationError extends Error {
  public readonly code: MaterializationErrorCode;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: MaterializationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MaterializationError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Filesystem port (deterministic failure injection for tests)
// ---------------------------------------------------------------------------

export interface MaterializationFsPort {
  mkdir(dir: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  accessReadable(path: string): Promise<boolean>;
}

/** Real-filesystem port (default). */
export class NodeMaterializationFs implements MaterializationFsPort {
  public async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  public copyFile(source: string, destination: string): Promise<void> {
    return copyFile(source, destination);
  }

  public async accessReadable(target: string): Promise<boolean> {
    try {
      await access(target, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MaterializationServiceDeps {
  store: ManagedArtifactStore;
  captures: CaptureLedgerService;
  /** AUTO-01D authority: staged-path derivation + dedup decisions (consumed, not duplicated). */
  staging: CaptureStagingService;
  /** Application-owned data root (e.g. the production dataRoot). */
  dataRoot: string;
  /** Optional managed-root override (tests). Defaults to `<dataRoot>/managed`. */
  managedRootOverride?: string;
  /** Optional filesystem port (tests). Defaults to the real filesystem. */
  fs?: MaterializationFsPort;
}

/** The states a materialization run may be called from (forward/terminal only). */
const MATERIALIZABLE_STATES: ReadonlySet<string> = new Set<string>([
  'STAGED',
  'VERIFYING',
  'ADMITTED',
  'MATERIALIZING',
  'COMPLETED',
]);

export class MaterializationService {
  private readonly store: ManagedArtifactStore;
  private readonly captures: CaptureLedgerService;
  private readonly staging: CaptureStagingService;
  private readonly managedRoot: string;
  private readonly fs: MaterializationFsPort;

  public constructor(deps: MaterializationServiceDeps) {
    this.store = deps.store;
    this.captures = deps.captures;
    this.staging = deps.staging;
    this.managedRoot = deps.managedRootOverride ?? path.join(deps.dataRoot, 'managed');
    this.fs = deps.fs ?? new NodeMaterializationFs();
  }

  /** The single application-owned managed storage root. */
  public getManagedRoot(): string {
    return this.managedRoot;
  }

  /**
   * Deterministic project-relative placeholder `canonical_path` for a capture:
   * `_managed/<captureId>/source.<ext>`. Derived from the captureId UUID only —
   * never from a user-supplied destination — so it is traversal-safe, cannot
   * collide, and satisfies the existing PROJECT_RELATIVE_PATH_PATTERN. This is
   * a TEMPORARY path: the future Filing/Naming engines own the final layout.
   */
  public canonicalPathFor(captureId: string): string {
    const id = this.requireCaptureId(captureId);
    const entry = this.captures.get(id);
    return `_managed/${id}/source${safeManagedExtension(entry.sourcePath)}`;
  }

  /** Deterministic physical managed destination for a capture. */
  public managedPathFor(captureId: string): string {
    const id = this.requireCaptureId(captureId);
    return path.join(
      this.managedRoot,
      id,
      `source${safeManagedExtension(this.captures.get(id).sourcePath)}`,
    );
  }

  /**
   * The AUTO-01E1 happy path for one ALREADY-TRUSTED capture:
   *   STAGED/VERIFYING -> (create/resolve ManagedArtifact) -> ADMITTED ->
   *   MATERIALIZING -> (COPY staged bytes + verify + create/reuse
   *   ArtifactVersion) -> COMPLETED
   *
   * All state changes go through the AUTO-01C authority (`CaptureLedgerService`);
   * no direct SQL state updates. The source is never touched.
   *
   * Recovery/retry semantics:
   *   - COMPLETED call on an already-completed capture = safe idempotent no-op.
   *   - A resume from MATERIALIZING (admittedAt set) reuses the already-admitted
   *     artifact (never re-admits) and reuses the already-created version when
   *     the same artifact already carries the same content hash.
   *   - A divergent identity on a retry is a CONFLICT (the ledger's final
   *     identities are immutable).
   *   - Copy failure or a copied-bytes hash mismatch marks the capture
   *     FAILED_RECOVERABLE (staged bytes retained for recovery) and throws.
   */
  public async materializeCapture(captureId: string, at: string): Promise<CaptureLedgerEntry> {
    const entry = this.captures.get(captureId);
    if (entry.state === 'COMPLETED') return entry; // safe idempotent no-op
    if (!MATERIALIZABLE_STATES.has(entry.state)) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Materialization may only run from STAGED/VERIFYING/ADMITTED/MATERIALIZING (current: ${entry.state}).`,
        409,
        { captureId, state: entry.state },
      );
    }
    this.assertContentProof(entry);

    // Consume the AUTO-01D dedup decision ONCE for this run (never reinterpreted,
    // never bypassed).
    const decision = this.staging.decideDedup(captureId);

    // Phase A/B: resolve/create the ManagedArtifact identity and ensure ADMITTED.
    const artifactId = this.ensureAdmitted(entry, at);

    // Phase C: ADMITTED -> MATERIALIZING (already MATERIALIZING on a resume).
    let current = this.captures.get(captureId);
    if (current.state === 'ADMITTED') {
      current = this.captures.advance(captureId, at).entry;
    }

    // Phase D: materialize bytes into managed storage + create/reuse the version.
    const versionId = await this.materializeManagedBytes(current, artifactId, at, decision);

    // Phase E: MATERIALIZING -> COMPLETED (re-asserts same-project/artifact lineage).
    return this.captures.complete(captureId, artifactId, versionId, at);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Ensures the capture has reached ADMITTED with a persisted finalArtifactId.
   * On a resume (already admitted) it returns the immutable finalArtifactId and
   * never re-runs admission or re-creates the artifact. On a fresh STAGED/
   * VERIFYING capture it creates a new ManagedArtifact in the ledger's project
   * (an untargeted capture has no artifact to dedup against), then advances to
   * ADMITTED with that identity.
   */
  private ensureAdmitted(entry: CaptureLedgerEntry, at: string): string {
    if (entry.finalArtifactId !== null) return entry.finalArtifactId;

    // An untargeted capture has no artifact to dedup against: whatever the
    // AUTO-01D decision said, a new ManagedArtifact is created in the ledger's
    // project. `DUPLICATE_CONTENT_SAME_ARTIFACT` only ever arrives with a
    // pre-set finalArtifactId (returned above); SAME_BYTES_DIFFERENT_ARTIFACT
    // explicitly must NOT merge identity, and DUPLICATE_EVENT is an upstream
    // event-dedup concern, not a content-identity concern.
    const artifact = this.store.createManagedArtifact({
      projectId: entry.projectId,
      artifactType: entry.expectedArtifactType,
      sourceTool: this.resolveSourceTool(entry),
      canonicalPath: this.canonicalPathFor(entry.captureId),
    });

    let current = entry;
    if (current.state === 'STAGED') {
      current = this.captures.advance(current.captureId, at).entry;
    }
    // current.state is now VERIFYING.
    const admitted = this.captures.advance(current.captureId, at, {
      finalArtifactId: artifact.artifactId,
    });
    return admitted.entry.finalArtifactId!;
  }

  /**
   * COPYs the trusted staged bytes into managed storage, verifies the copied
   * bytes' hash against the persisted proof, then creates-or-reuses the
   * ArtifactVersion. Never MOVE: staged bytes are the recovery/undo source and
   * must survive until COMPLETED is durable. Source never touched.
   */
  private async materializeManagedBytes(
    entry: CaptureLedgerEntry,
    artifactId: string,
    at: string,
    decision: CaptureDedupDecision,
  ): Promise<string> {
    const captureId = entry.captureId;
    const stagedPath = this.staging.finalStagedPathFor(captureId);
    const managedPath = this.managedPathFor(captureId);
    const relPath = this.canonicalPathFor(captureId);

    try {
      await this.fs.mkdir(path.dirname(managedPath));
    } catch (error) {
      this.markFailedRecoverable(
        captureId,
        'MATERIALIZATION_COPY_FAILED: could not create the managed destination directory.',
        at,
      );
      throw new MaterializationError(
        'MATERIALIZATION_COPY_FAILED',
        'Could not create the managed destination directory.',
        { captureId, managedPath, cause: String(error) },
      );
    }

    try {
      await this.fs.copyFile(stagedPath, managedPath);
    } catch (error) {
      this.markFailedRecoverable(
        captureId,
        'MATERIALIZATION_COPY_FAILED: the staged bytes could not be copied into managed storage.',
        at,
      );
      throw new MaterializationError(
        'MATERIALIZATION_COPY_FAILED',
        'The staged bytes could not be copied into managed storage.',
        { captureId, stagedPath, managedPath, cause: String(error) },
      );
    }

    // Verify the COPIED bytes hash against the persisted AUTO-01D proof. The
    // content hash is authoritative; a mismatch means the managed copy is not
    // truthful and must fail closed (never trusted).
    const copiedHash = await sha256FileStreaming(managedPath);
    if (entry.contentHash !== null && copiedHash !== entry.contentHash) {
      this.markFailedRecoverable(
        captureId,
        'MATERIALIZATION_HASH_MISMATCH: the copied managed bytes do not match the staged content proof.',
        at,
      );
      throw new MaterializationError(
        'MATERIALIZATION_HASH_MISMATCH',
        'The copied managed bytes do not match the staged content proof.',
        { captureId, managedPath, expected: entry.contentHash, actual: copiedHash },
      );
    }

    // Create-or-reuse the ArtifactVersion. The content hash is authoritative;
    // version numbers are ordering only (version_id UUID is identity).
    return this.resolveVersion(entry, artifactId, relPath, copiedHash, at, decision);
  }

  /**
   * Creates a new ArtifactVersion OR reuses an existing one:
   *   - `DUPLICATE_CONTENT_SAME_ARTIFACT` (AUTO-01D) on the same artifact:
   *     reuse the existing version_id — no duplicate version.
   *   - The same artifact already carries these bytes (a resume where the
   *     decision was computed while untargeted but finalArtifactId is now set):
   *     reuse the existing version via the content-hash query.
   *   - Different bytes, or same bytes under a DIFFERENT artifact: create a NEW
   *     version under this artifact; identity is never merged.
   */
  private resolveVersion(
    entry: CaptureLedgerEntry,
    artifactId: string,
    relPath: string,
    contentHash: string,
    at: string,
    decision: CaptureDedupDecision,
  ): string {
    if (
      decision.kind === 'DUPLICATE_CONTENT_SAME_ARTIFACT' &&
      decision.artifactId === artifactId &&
      decision.versionId
    ) {
      return decision.versionId;
    }
    const existing = this.store.findArtifactVersionByContentHash(entry.projectId, contentHash);
    if (existing !== null && existing.artifactId === artifactId) {
      return existing.versionId;
    }
    const artifact = this.store.getManagedArtifact(artifactId);
    const version = this.store.createArtifactVersion({
      artifactId,
      version: artifact.currentWorkingVersion + 1,
      contentHash,
      sizeBytes: entry.sizeBytes,
      locatorKind: 'PROJECT_RELATIVE',
      locatorValue: relPath,
      captureId: entry.captureId,
      now: at,
    });
    return version.versionId;
  }

  /** Resolves the ManagedArtifact sourceTool from the ledger's ToolContext (or channel fallback). */
  private resolveSourceTool(entry: CaptureLedgerEntry): string {
    if (entry.toolContextId) {
      try {
        return this.store.getToolContext(entry.toolContextId).tool;
      } catch {
        // Fall through to the channel fallback.
      }
    }
    return entry.sourceChannel;
  }

  private assertContentProof(entry: CaptureLedgerEntry): void {
    if (entry.contentHash === null || entry.sizeBytes === null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Materialization requires a persisted staged content proof (contentHash + sizeBytes).',
        400,
        { captureId: entry.captureId, state: entry.state },
      );
    }
  }

  private markFailedRecoverable(captureId: string, reason: string, at: string): void {
    // Synchronous (no await, no .catch) — matches the AUTO-01D pattern.
    try {
      this.captures.markFailedRecoverable(captureId, reason, at);
    } catch {
      // Preserve the original materialization error; the ledger stays readable.
    }
  }

  private requireCaptureId(captureId: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)
    ) {
      throw new DomainError('VALIDATION_ERROR', 'Capture ID must be a UUID.', 400);
    }
    return captureId;
  }
}

/**
 * Sanitized extension derived from the ledger source path (safe alphanumeric
 * suffix only). Shared authority: the managed path and the archive path must
 * derive the extension identically so an undo rename always targets the exact
 * file the managed copy created.
 */
export function safeManagedExtension(sourcePath: string): string {
  const base = path.basename(sourcePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot + 1);
  return /^[A-Za-z0-9]{1,16}$/.test(ext) ? `.${ext.toLowerCase()}` : '';
}
