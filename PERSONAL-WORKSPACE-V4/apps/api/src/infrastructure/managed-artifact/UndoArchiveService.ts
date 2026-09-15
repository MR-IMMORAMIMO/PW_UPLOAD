/**
 * AUTO-01E2A — Undo / Archive foundation (API/service layer).
 *
 * The controlled, reversible safe-recovery path for a COMPLETED materialized
 * capture BEFORE immutable downstream references exist. This slice builds
 * ONLY the foundation that:
 *   - validates undo eligibility (COMPLETED capture + ACTIVE artifact + no
 *     immutable downstream reference to the final version)
 *   - MOVEs (renames) the managed file into an application-owned archive root
 *   - verifies the archived bytes against the immutable ArtifactVersion proof
 *   - transitions the ManagedArtifact ACTIVE -> ARCHIVED through the domain
 *     authority
 *   - preserves audit truth: the CaptureLedger stays COMPLETED, ArtifactVersion
 *     rows are never deleted or updated, and the ledger's final identities
 *     remain the immutable record of what happened
 *
 * Explicitly OUT of scope for AUTO-01E2A (deferred to later slices):
 *   - Undo UI / API route / RBAC
 *   - Restore-from-archive (ARCHIVED is terminal here by design)
 *   - Revision / Package / Issue / Submissions integration (the freeze probe
 *     is a clean extension point — see `ManagedArtifactStore
 *     .hasImmutableVersionReference`)
 *   - Naming / Filing engines, OCR, adapters, v16
 *
 * Authority separation (owner-locked): this is the ORCHESTRATOR. It composes
 * the existing AUTO-01A (ManagedArtifactStore persistence), AUTO-01C
 * (CaptureLedgerService read authority), and AUTO-01E1 (MaterializationService
 * managed-path authority). It does NOT duplicate any of them: it never writes
 * ledger rows (no COMPLETED -> anything edge exists or is added), never deletes
 * artifacts/versions/snapshots, and never issues direct SQL state updates
 * beyond the store's narrow `archiveManagedArtifact` authority.
 *
 * Filesystem authority: the ONLY paths this service touches derive from the
 * validated captureId UUID (`<dataRoot>/managed/<captureId>/...` and
 * `<dataRoot>/managed-archive/<captureId>/...`). No user-supplied destination
 * is ever accepted; no delete, no shell execution. The original source is
 * NEVER touched (AUTO-D07).
 *
 * Crash recovery (no worker): undo is idempotent two-phase:
 *   1. Phase 1 — MOVE managed -> archive (+ verify the archived bytes against
 *      the immutable ArtifactVersion content hash).
 *   2. Phase 2 — DB transition ACTIVE -> ARCHIVED (stamps `updatedAt`).
 *   - Move succeeded, DB update failed: the archive file is already durable;
 *     a retry skips the move (archive presence + hash proof) and completes
 *     the DB transition.
 *   - Move failed: no state changed; typed UNDO_MOVE_FAILED; retry possible.
 *   - Already ARCHIVED: safe no-op (the undo already completed).
 */

import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '@scli/domain';
import { CaptureLedgerService } from './CaptureLedgerService';
import { ManagedArtifactStore } from './ManagedArtifactStore';
import { MaterializationService, safeManagedExtension } from './MaterializationService';
import { sha256FileStreaming } from './CaptureStagingService';

// ---------------------------------------------------------------------------
// Typed errors (repository convention: stable codes)
// ---------------------------------------------------------------------------

export type UndoArchiveErrorCode =
  'UNDO_MOVE_FAILED' | 'UNDO_HASH_MISMATCH' | 'UNDO_ARCHIVE_PATH_INVALID';

export class UndoArchiveError extends Error {
  public readonly code: UndoArchiveErrorCode;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: UndoArchiveErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UndoArchiveError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Filesystem port (deterministic failure injection for tests)
// ---------------------------------------------------------------------------

export interface UndoArchiveFsPort {
  exists(target: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
}

/** Real-filesystem port (default). */
export class NodeUndoArchiveFs implements UndoArchiveFsPort {
  public async exists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  public async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  public rename(source: string, destination: string): Promise<void> {
    return rename(source, destination);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface UndoArchiveServiceDeps {
  store: ManagedArtifactStore;
  /** Read-only ledger authority (undo never mutates capture state). */
  captures: CaptureLedgerService;
  /** AUTO-01E1 authority: the managed path is the single source of the managed location. */
  materialize: MaterializationService;
  /** Application-owned data root (e.g. the production dataRoot). */
  dataRoot: string;
  /** Optional filesystem port (tests). Defaults to the real filesystem. */
  fs?: UndoArchiveFsPort;
}

export class UndoArchiveService {
  private readonly store: ManagedArtifactStore;
  private readonly captures: CaptureLedgerService;
  private readonly materialize: MaterializationService;
  private readonly archiveRoot: string;
  private readonly fs: UndoArchiveFsPort;

  public constructor(deps: UndoArchiveServiceDeps) {
    this.store = deps.store;
    this.captures = deps.captures;
    this.materialize = deps.materialize;
    this.archiveRoot = path.join(deps.dataRoot, 'managed-archive');
    this.fs = deps.fs ?? new NodeUndoArchiveFs();
  }

  /** The single application-owned archive storage root. */
  public getArchiveRoot(): string {
    return this.archiveRoot;
  }

  /**
   * Deterministic archive path for a capture:
   * `<dataRoot>/managed-archive/<captureId>/source.<ext>`. Derived from the
   * captureId UUID only (never a user-supplied destination) and built from
   * the SAME sanitized extension authority as the managed path, so an undo
   * rename always targets the exact file the managed copy created.
   */
  public archivePathFor(captureId: string): string {
    const id = this.requireCaptureId(captureId);
    const entry = this.captures.get(id);
    return path.join(this.archiveRoot, id, `source${safeManagedExtension(entry.sourcePath)}`);
  }

  /**
   * The AUTO-01E2A undo path for one COMPLETED capture.
   *
   * Eligibility (all three required):
   *   1. CaptureLedger state === COMPLETED (with final identities set).
   *   2. ManagedArtifact status === ACTIVE.
   *   3. No immutable downstream reference to the final ArtifactVersion
   *      (the Revision Document Snapshot provenance probe; future
   *      Package/Issue references extend the same probe).
   *
   * Flow: Phase A (MOVE managed -> archive + hash verify) -> Phase B
   * (ACTIVE -> ARCHIVED via the domain authority, `at` stamps `updatedAt`).
   * The CaptureLedger row and every ArtifactVersion row are never touched.
   *
   * Retry/crash semantics (see header): already-ARCHIVED -> safe no-op;
   * archive already durable -> verify + complete; move failure -> typed
   * error with ACTIVE retained.
   */
  public async undoCapture(captureId: string, at: string) {
    const entry = this.captures.get(captureId);
    if (
      entry.state !== 'COMPLETED' ||
      entry.finalArtifactId === null ||
      entry.finalVersionId === null
    ) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Undo is only legal for a COMPLETED capture with final identities (current: ${entry.state}).`,
        409,
        { captureId, state: entry.state },
      );
    }
    const artifact = this.store.getManagedArtifact(entry.finalArtifactId);
    if (artifact.status === 'ARCHIVED') {
      // Retry of an already-completed undo: safe no-op.
      return artifact;
    }
    this.assertEligible(artifact, entry.finalVersionId);

    const managedPath = this.materialize.managedPathFor(captureId);
    const archivePath = this.archivePathFor(captureId);
    await this.ensureArchivedBytes(managedPath, archivePath, entry.finalVersionId, captureId);
    return this.store.archiveManagedArtifact(artifact.artifactId, at);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Eligibility: ACTIVE + no frozen downstream reference (the undo boundary). */
  private assertEligible(
    artifact: { artifactId: string; status: string },
    finalVersionId: string,
  ): void {
    if (artifact.status !== 'ACTIVE') {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Undo is only legal while the Managed Artifact is ACTIVE (current: ${artifact.status}).`,
        409,
        { artifactId: artifact.artifactId, status: artifact.status },
      );
    }
    if (this.store.hasImmutableVersionReference(finalVersionId)) {
      throw new DomainError(
        'CONFLICT',
        'Undo is forbidden: the final Artifact Version is referenced by immutable history.',
        409,
        { artifactId: artifact.artifactId, versionId: finalVersionId },
      );
    }
  }

  /**
   * Phase A: ensure the managed bytes are durably archived.
   *   - archive already present (crash after a successful move): verify the
   *     archived hash against the immutable proof, then complete.
   *   - otherwise MOVE (rename) managed -> archive and verify the archived
   *     hash. The proof is authoritative: a mismatch means the archive is not
   *     trusted and the operation fails closed (artifact stays ACTIVE; no DB
   *     change).
   */
  private async ensureArchivedBytes(
    managedPath: string,
    archivePath: string,
    finalVersionId: string,
    captureId: string,
  ): Promise<void> {
    const archivedExists = await this.fs.exists(archivePath);
    if (archivedExists) {
      await this.verifyArchivedProof(archivePath, finalVersionId, captureId);
      return;
    }
    try {
      await this.fs.mkdir(path.dirname(archivePath));
    } catch (error) {
      throw new UndoArchiveError(
        'UNDO_MOVE_FAILED',
        'Could not create the archive destination directory.',
        { captureId, archivePath, cause: String(error) },
      );
    }
    try {
      await this.fs.rename(managedPath, archivePath);
    } catch (error) {
      throw new UndoArchiveError(
        'UNDO_MOVE_FAILED',
        'The managed file could not be moved into the archive.',
        { captureId, managedPath, archivePath, cause: String(error) },
      );
    }
    await this.verifyArchivedProof(archivePath, finalVersionId, captureId);
  }

  /** Hash-proof: the archived bytes MUST match the immutable ArtifactVersion content hash. */
  private async verifyArchivedProof(
    archivePath: string,
    finalVersionId: string,
    captureId: string,
  ): Promise<void> {
    const version = this.store.getArtifactVersion(finalVersionId);
    let actual: string | null = null;
    try {
      actual = await sha256FileStreaming(archivePath);
    } catch {
      actual = null;
    }
    if (actual !== version.contentHash) {
      throw new UndoArchiveError(
        'UNDO_HASH_MISMATCH',
        'The archived bytes do not match the immutable Artifact Version proof.',
        { captureId, archivePath, expected: version.contentHash, actual },
      );
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
