/**
 * AUTO-01D — Capture byte-staging service authority (API/service layer).
 *
 * The FIRST controlled handling of real file bytes in the Auto-Capture
 * pipeline. It owns, for an ALREADY-AUTHORIZED (AUTO-01B) and ALREADY-DETECTED
 * (AUTO-01C) CaptureLedger entry:
 *   - write stabilization (bounded, deterministic, probabilistic)
 *   - non-destructive controlled staging (COPY, never move)
 *   - SHA-256 hashing of the staged bytes (streaming)
 *   - duplicate-event / content-dedup DECISIONS (typed; no version creation)
 *   - cleanup of its own staging directory
 *   - deterministic staging-path derivation + restart re-verification
 *
 * It does NOT: create Tool Contexts, authorize captures, create
 * ManagedArtifacts, create ArtifactVersions, materialize final canonical
 * files, complete captures, watch the filesystem, or run adapters. Those
 * authorities remain separate (AUTO-01B / AUTO-01C / AUTO-01E / adapters).
 *
 * Source preservation (AUTO-D07): the original source file is NEVER renamed,
 * moved, deleted, truncated, or written. The only read-side operations are
 * stat / open / read / copy.
 *
 * Staging root: ONE application-owned managed root (default
 * `<dataRoot>/capture-stage`), excluded from future capture loops via
 * `isInternalCapturePath`. Staging paths derive from the captureId UUID only
 * (never from the source filename), so captures can never collide and no
 * user-controlled component can escape the staging directory.
 *
 * Atomic staging finalization: bytes are copied to `<captureId>/source.partial`,
 * the staged copy is hashed and proven against the stabilized source, and only
 * then renamed (same-directory, atomic on the managed root) to
 * `<captureId>/source.<ext>`; the ledger transitions to STAGED only after the
 * final staged file is proven complete.
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DomainError } from '@scli/domain';
import type { CaptureLedgerEntry, CaptureState } from '@scli/domain';
import { CaptureLedgerService } from './CaptureLedgerService';
import { ManagedArtifactStore } from './ManagedArtifactStore';

// ---------------------------------------------------------------------------
// Typed errors (repository convention: DomainError with stable codes)
// ---------------------------------------------------------------------------

export type CaptureStagingErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_STABLE'
  | 'SOURCE_CHANGED_DURING_COPY'
  | 'STAGING_COPY_FAILED'
  | 'STAGED_HASH_MISMATCH'
  | 'INVALID_STAGING_PATH'
  | 'STAGING_ALREADY_FINALIZED'
  | 'STAGING_NOT_FINALIZED'
  | 'STAGING_PROOF_MISSING'
  | 'STAGING_CLEANUP_FAILED';

export class CaptureStagingError extends Error {
  public readonly code: CaptureStagingErrorCode;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: CaptureStagingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CaptureStagingError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Deterministic policy (centralized, test-friendly)
// ---------------------------------------------------------------------------

export interface CaptureStabilizationPolicy {
  /** Consecutive stable observations required before a source is considered stable. */
  requiredStableSamples: number;
  /** Delay between samples (ms). Tests inject tiny values; production defaults are centralized here. */
  sampleIntervalMs: number;
  /** Total stabilization budget (ms). */
  timeoutMs: number;
}

export const DEFAULT_STABILIZATION_POLICY: CaptureStabilizationPolicy = {
  requiredStableSamples: 3,
  sampleIntervalMs: 250,
  timeoutMs: 10_000,
};

// ---------------------------------------------------------------------------
// Filesystem port (deterministic failure injection for tests)
// ---------------------------------------------------------------------------

export interface FileSnapshot {
  exists: boolean;
  isFile: boolean;
  size: number;
  mtimeMs: number;
}

export interface CaptureStagingFsPort {
  snapshot(path: string): Promise<FileSnapshot>;
  copyFile(source: string, destination: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  rm(path: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  accessReadable(path: string): Promise<boolean>;
}

/** Real-filesystem port (default). */
export class NodeCaptureStagingFs implements CaptureStagingFsPort {
  public async snapshot(filePath: string): Promise<FileSnapshot> {
    try {
      const s = await stat(filePath);
      return { exists: true, isFile: s.isFile(), size: s.size, mtimeMs: s.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false, isFile: false, size: 0, mtimeMs: 0 };
      }
      throw error;
    }
  }

  public copyFile(source: string, destination: string): Promise<void> {
    return copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  }

  public rename(from: string, to: string): Promise<void> {
    return rename(from, to);
  }

  public async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  public rm(target: string): Promise<void> {
    return rm(target, { recursive: true, force: true });
  }

  public readFile(target: string): Promise<Buffer> {
    return readFile(target);
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

/** Streaming SHA-256 of a file (bounded memory; safe for large DWG/PDF files). */
export async function sha256FileStreaming(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Typed dedup decisions
// ---------------------------------------------------------------------------

export type CaptureDedupDecision =
  | { kind: 'NEW_CONTENT' }
  | { kind: 'DUPLICATE_EVENT'; existingCaptureId: string }
  | { kind: 'DUPLICATE_CONTENT_SAME_ARTIFACT'; artifactId: string; versionId: string }
  | { kind: 'SAME_BYTES_DIFFERENT_ARTIFACT'; artifactId: string; versionId: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CaptureStagingServiceDeps {
  store: ManagedArtifactStore;
  captures: CaptureLedgerService;
  /** Application-owned data root (e.g. the production dataRoot). */
  dataRoot: string;
  /** Optional staging-root override (tests). Defaults to `<dataRoot>/capture-stage`. */
  stagingRootOverride?: string;
  /** Optional stabilization policy override (tests). */
  stabilizationPolicy?: CaptureStabilizationPolicy;
  /** Optional filesystem port (tests). Defaults to the real filesystem. */
  fs?: CaptureStagingFsPort;
  /** Optional sleep function (tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export class CaptureStagingService {
  private readonly store: ManagedArtifactStore;
  private readonly captures: CaptureLedgerService;
  private readonly stagingRoot: string;
  private readonly policy: CaptureStabilizationPolicy;
  private readonly fs: CaptureStagingFsPort;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(deps: CaptureStagingServiceDeps) {
    this.store = deps.store;
    this.captures = deps.captures;
    this.stagingRoot = deps.stagingRootOverride ?? path.join(deps.dataRoot, 'capture-stage');
    this.policy = deps.stabilizationPolicy ?? DEFAULT_STABILIZATION_POLICY;
    this.fs = deps.fs ?? new NodeCaptureStagingFs();
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The single managed staging root (application-owned; never a user folder). */
  public getStagingRoot(): string {
    return this.stagingRoot;
  }

  /**
   * Deterministic staging directory for a capture: `<stagingRoot>/<captureId>`.
   * Derived from the captureId UUID ONLY — never from the source filename or
   * any user-controlled metadata — so two captures can never collide and no
   * component can escape the staging directory.
   */
  public stagingDirFor(captureId: string): string {
    const id = this.requireCaptureId(captureId);
    return path.join(this.stagingRoot, id);
  }

  /** Deterministic partial path (bytes being written; never trusted as final). */
  public partialPathFor(captureId: string): string {
    return path.join(this.stagingDirFor(captureId), 'source.partial');
  }

  /**
   * Deterministic final staged path. The extension is derived from the ledger
   * source path and sanitized to a safe alphanumeric suffix (never used as a
   * directory component, so traversal is impossible).
   */
  public finalStagedPathFor(captureId: string): string {
    const entry = this.captures.get(captureId);
    return path.join(this.stagingDirFor(captureId), `source${safeExtension(entry.sourcePath)}`);
  }

  /**
   * AUTO-01D loop protection: classifies a path as internal when it is inside
   * the managed staging root (lexical containment). Future watcher/worker code
   * must never treat an internal path as an external source candidate. This is
   * path-based (the staging root is the authority), never filename-based.
   */
  public isInternalCapturePath(candidate: string): boolean {
    const rel = path.relative(this.stagingRoot, candidate);
    if (rel === '') return true;
    if (rel === '..') return false;
    if (rel.startsWith('..' + path.sep)) return false;
    if (path.isAbsolute(rel)) return false;
    return true;
  }

  /**
   * P4B pre-ledger observation: baseline plus the configured count of matching
   * readable size/mtime observations, followed by a streaming SHA-256. This is
   * used only to make duplicate filesystem events converge before durable
   * DETECTED find-or-create; stageCapture still performs the authoritative
   * A/B/C proof.
   */
  public async proveStableCandidate(sourcePath: string): Promise<{
    contentHash: string;
    sizeBytes: number;
  }> {
    const snapshot = await this.waitForStableSource(sourcePath);
    return { contentHash: await this.hashFile(sourcePath), sizeBytes: snapshot.size };
  }

  /**
   * Bounded, deterministic write-stabilization wait. A source is stable when
   * its size AND modified time are unchanged across N consecutive observations
   * AND the file is readable. This is a probabilistic write-completion signal
   * (stable observable metadata + successful read), NOT a universal OS-level
   * transactional file lock — Windows applications may keep files open while
   * writing, so exclusive locking is deliberately not depended on.
   *
   * Throws SOURCE_NOT_FOUND when the source disappears, SOURCE_NOT_STABLE on
   * timeout, and STAGING_COPY_FAILED when the file is not a regular readable
   * file.
   */
  public async stabilizeCaptureSource(captureId: string, at?: string): Promise<CaptureLedgerEntry> {
    const entry = this.captures.get(captureId);
    this.assertSourcePath(entry);
    const sourcePath = entry.sourcePath;
    const now = at ?? new Date().toISOString();

    let previous: FileSnapshot | null = null;
    let stableCount = 0;
    const deadline = Date.now() + this.policy.timeoutMs;
    // Bounded sampling: the loop is capped by the timeout budget (a
    // deterministic maximum number of samples), so it can never spin forever.
    const maxSamples = Math.max(
      1,
      Math.ceil(this.policy.timeoutMs / this.policy.sampleIntervalMs) + 2,
    );

    for (let sample = 0; sample < maxSamples; sample += 1) {
      const current = await this.fs.snapshot(sourcePath);
      if (!current.exists) {
        // A known authorized source that disappeared is a truthful
        // FAILED_RECOVERABLE (never healthy, never UNRESOLVED): enough
        // authority exists to retry safely, and the ledger row is never
        // deleted. No empty staged file is ever created.
        try {
          this.captures.markFailedRecoverable(
            captureId,
            'SOURCE_NOT_FOUND: the capture source file disappeared before staging.',
            now,
          );
        } catch {
          // Preserve the original staging error; the ledger transition is
          // best-effort here (the row remains readable either way).
        }
        throw new CaptureStagingError('SOURCE_NOT_FOUND', 'The capture source file disappeared.', {
          captureId,
          sourcePath,
        });
      }
      if (!current.isFile) {
        throw new CaptureStagingError(
          'STAGING_COPY_FAILED',
          'The capture source is not a regular file.',
          { captureId, sourcePath },
        );
      }
      const readable = await this.fs.accessReadable(sourcePath);
      if (!readable) {
        stableCount = 0;
      } else if (
        previous !== null &&
        previous.size === current.size &&
        previous.mtimeMs === current.mtimeMs
      ) {
        stableCount += 1;
        if (stableCount >= this.policy.requiredStableSamples) {
          return entry;
        }
      } else {
        stableCount = 0;
      }
      previous = current;
      if (Date.now() >= deadline) {
        throw new CaptureStagingError(
          'SOURCE_NOT_STABLE',
          'The capture source did not stabilize within the bounded timeout.',
          { captureId, sourcePath, timeoutMs: this.policy.timeoutMs },
        );
      }
      await this.sleep(this.policy.sampleIntervalMs);
    }
    throw new CaptureStagingError(
      'SOURCE_NOT_STABLE',
      'The capture source did not stabilize within the bounded timeout.',
      { captureId, sourcePath, timeoutMs: this.policy.timeoutMs },
    );
  }

  private async waitForStableSource(sourcePath: string): Promise<FileSnapshot> {
    let previous: FileSnapshot | null = null;
    let stableCount = 0;
    const deadline = Date.now() + this.policy.timeoutMs;
    const maxSamples = Math.max(
      1,
      Math.ceil(this.policy.timeoutMs / this.policy.sampleIntervalMs) + 2,
    );
    for (let sample = 0; sample < maxSamples; sample += 1) {
      const current = await this.fs.snapshot(sourcePath);
      if (!current.exists) {
        throw new CaptureStagingError('SOURCE_NOT_FOUND', 'The capture source file disappeared.');
      }
      if (!current.isFile) {
        throw new CaptureStagingError(
          'STAGING_COPY_FAILED',
          'The capture source is not a regular file.',
        );
      }
      const readable = await this.fs.accessReadable(sourcePath);
      if (
        readable &&
        previous !== null &&
        previous.size === current.size &&
        previous.mtimeMs === current.mtimeMs
      ) {
        stableCount += 1;
        if (stableCount >= this.policy.requiredStableSamples) return current;
      } else {
        stableCount = 0;
      }
      previous = current;
      if (Date.now() >= deadline) {
        throw new CaptureStagingError(
          'SOURCE_NOT_STABLE',
          'The capture source did not stabilize within the bounded timeout.',
        );
      }
      await this.sleep(this.policy.sampleIntervalMs);
    }
    throw new CaptureStagingError(
      'SOURCE_NOT_STABLE',
      'The capture source did not stabilize within the bounded timeout.',
    );
  }

  /**
   * The full AUTO-01D happy path for one capture:
   *   DETECTED -> STABILIZING (AUTO-01C authority)
   *   stabilize -> content proof (source hash A -> copy to
   *   `<captureId>/source.partial` -> staged hash B -> source hash C, requiring
   *   A === B === C) -> atomic rename to the final staged path -> record proof
   *   (narrow store authority) -> STABILIZING -> STAGED (AUTO-01C authority,
   *   stamps stagedAt) -> STAGED -> VERIFYING (AUTO-01C authority)
   *
   * The source is NEVER moved/deleted/modified. A source that changes during
   * the copy — including a SAME-SIZE in-place mutation that metadata cannot
   * detect — fails closed (SOURCE_CHANGED_DURING_COPY) via the hash
   * A === B === C proof; the ledger is marked FAILED_RECOVERABLE with a
   * precise reason and never advances to STAGED; the partial staged file is
   * removed so it is never trusted.
   */
  public async stageCapture(captureId: string, at: string): Promise<CaptureLedgerEntry> {
    const entry = this.captures.get(captureId);
    this.assertSourcePath(entry);
    if (entry.state !== 'DETECTED' && entry.state !== 'STABILIZING') {
      throw new DomainError(
        'INVALID_TRANSITION',
        `stageCapture may only run from DETECTED or STABILIZING (current: ${entry.state}).`,
        409,
        { captureId, state: entry.state },
      );
    }
    const sourcePath = entry.sourcePath;
    const dir = this.stagingDirFor(captureId);
    const partialPath = this.partialPathFor(captureId);
    const finalPath = this.finalStagedPathFor(captureId);

    // DETECTED -> STABILIZING through the AUTO-01C authority (never a direct
    // ledger UPDATE).
    let current = entry;
    if (current.state === 'DETECTED') {
      current = this.captures.advance(captureId, at).entry;
    }

    // Bounded stabilization wait (probabilistic write completion).
    await this.stabilizeCaptureSource(captureId, at);

    // Byte-truth content proof (B1): source hash A, staged hash B, source hash
    // C, requiring A === B === C. A same-size in-place mutation during the
    // copy is DETECTED by the hashes even when size/mtime metadata is
    // unchanged (metadata alone is insufficient). All hashes are streaming
    // SHA-256; no file is ever loaded fully into memory.
    const sourceHashA = await this.hashFile(sourcePath);

    await this.fs.mkdir(dir);
    // These are exact capture-owned paths. Removing interrupted pre-milestone
    // remnants is safe and preserves the exclusive-copy guarantee.
    await this.fs.rm(partialPath).catch(() => undefined);
    if (current.stagedAt === null) await this.fs.rm(finalPath).catch(() => undefined);
    try {
      await this.fs.copyFile(sourcePath, partialPath);
    } catch (error) {
      throw new CaptureStagingError(
        'STAGING_COPY_FAILED',
        'The capture source could not be copied into staging.',
        { captureId, sourcePath, partialPath, cause: String(error) },
      );
    }

    // Hash the STAGED bytes (the bytes the pipeline will continue to use).
    const stagedHashB = await this.hashFile(partialPath);
    const stagedSize = (await this.fs.snapshot(partialPath)).size;

    // Post-copy source hash C: if the source changed during the copy — even
    // with identical size and metadata — the staged copy is NOT a truthful
    // version; fail closed.
    const sourceHashC = await this.hashFile(sourcePath);
    if (sourceHashA !== stagedHashB || stagedHashB !== sourceHashC) {
      await this.fs.rm(partialPath).catch(() => undefined);
      await this.captures.markFailedRecoverable(
        captureId,
        'SOURCE_CHANGED_DURING_COPY: the source file changed while it was being staged (hash proof A !== B !== C).',
        at,
      );
      throw new CaptureStagingError(
        'SOURCE_CHANGED_DURING_COPY',
        'The capture source changed while it was being copied; the staged copy was discarded.',
        { captureId, sourcePath, sourceHashA, stagedHashB, sourceHashC },
      );
    }

    // Atomic finalization: same-directory rename of the proven partial file.
    try {
      await this.fs.rename(partialPath, finalPath);
    } catch (error) {
      await this.fs.rm(partialPath).catch(() => undefined);
      throw new CaptureStagingError(
        'STAGING_COPY_FAILED',
        'The proven staged file could not be finalized.',
        { captureId, finalPath, cause: String(error) },
      );
    }

    // Persist the PROVEN staged proof through the narrow store authority, then
    // advance STABILIZING -> STAGED (stamps stagedAt) -> STAGED -> VERIFYING.
    this.store.recordStagedContentProof(captureId, stagedHashB, stagedSize);
    const staged = this.captures.advance(captureId, at).entry;
    return this.captures.advance(staged.captureId, at).entry;
  }

  /**
   * Restart-safe re-verification of an already-staged capture: derives the
   * deterministic staging path, re-hashes the final staged bytes, and compares
   * against the persisted proof. Returns the entry when the staged bytes still
   * verify; throws STAGED_HASH_MISMATCH / STAGING_NOT_FINALIZED otherwise.
   * Never touches the source.
   */
  public async verifyStagedCapture(captureId: string): Promise<CaptureLedgerEntry> {
    const entry = this.captures.get(captureId);
    if (entry.stagedAt === null) {
      throw new CaptureStagingError(
        'STAGING_NOT_FINALIZED',
        'The capture has no staged milestone; there is no final staged content to verify.',
        { captureId, state: entry.state },
      );
    }
    const finalPath = this.finalStagedPathFor(captureId);
    const snapshot = await this.fs.snapshot(finalPath);
    if (!snapshot.exists || !snapshot.isFile) {
      throw new CaptureStagingError(
        'STAGING_NOT_FINALIZED',
        'The final staged file is missing; the capture must be re-staged.',
        { captureId, finalPath },
      );
    }
    const hash = await this.hashFile(finalPath);
    if (entry.contentHash !== null && hash !== entry.contentHash) {
      throw new CaptureStagingError(
        'STAGED_HASH_MISMATCH',
        'The staged bytes no longer match the persisted proof.',
        { captureId, expected: entry.contentHash, actual: hash },
      );
    }
    return entry;
  }

  /**
   * Typed dedup decision for a proven staged capture (AUTO-01D decisions only;
   * no version is created — AUTO-01E owns that):
   *   - DUPLICATE_EVENT: another ACTIVE ledger capture already owns the same
   *     project + source path + source channel + content hash. Active rows are
   *     DETECTED / STABILIZING / STAGED / VERIFYING / ADMITTED /
   *     MATERIALIZING. Terminal/history rows (COMPLETED / DISCARDED /
   *     FAILED_RECOVERABLE / UNRESOLVED) are EXCLUDED: a finished or abandoned
   *     capture occurrence is history, not a live duplicate event.
   *   - DUPLICATE_CONTENT_SAME_ARTIFACT: an ArtifactVersion in the SAME
   *     project with the same hash belongs to the SAME ManagedArtifact as the
   *     capture's admitted/final artifact (or the artifact the capture is
   *     expected to produce).
   *   - SAME_BYTES_DIFFERENT_ARTIFACT: same hash exists in the project but
   *     under a DIFFERENT ManagedArtifact — identity is NOT merged.
   *   - NEW_CONTENT: no duplicate signal.
   *
   * Duplicate EVENT is deliberately separate from duplicate CONTENT: a new
   * capture of the same bytes as an old completed capture is new event content
   * for the ledger (content dedup, not event dedup, may then apply).
   */
  public decideDedup(captureId: string): CaptureDedupDecision {
    const entry = this.captures.get(captureId);
    if (entry.contentHash === null) {
      throw new CaptureStagingError(
        'STAGING_PROOF_MISSING',
        'A dedup decision requires a persisted staged content proof.',
        { captureId, state: entry.state },
      );
    }
    const hash = entry.contentHash;

    // A. Duplicate filesystem event: same project + source path + channel +
    // hash already owned by another ACTIVE ledger capture. Terminal/history
    // states (COMPLETED / DISCARDED / FAILED_RECOVERABLE / UNRESOLVED) are
    // excluded — they represent a finished or abandoned occurrence, not a live
    // duplicate event.
    const activeStates = new Set<CaptureState>([
      'DETECTED',
      'STABILIZING',
      'STAGED',
      'VERIFYING',
      'ADMITTED',
      'MATERIALIZING',
    ]);
    const siblings = this.store
      .listCaptureLedgerEntries(entry.projectId)
      .filter(
        (other) =>
          other.captureId !== captureId &&
          activeStates.has(other.state) &&
          other.sourcePath === entry.sourcePath &&
          other.sourceChannel === entry.sourceChannel &&
          other.contentHash === hash,
      );
    if (siblings.length > 0) {
      return { kind: 'DUPLICATE_EVENT', existingCaptureId: siblings[0]!.captureId };
    }

    // B/C. Content dedup within the project (project identity authoritative;
    // hashes are never globally deduped across projects in AUTO-01D).
    const existing = this.store.findArtifactVersionByContentHash(entry.projectId, hash);
    if (existing !== null) {
      const expectedArtifactId = entry.finalArtifactId;
      if (expectedArtifactId !== null && expectedArtifactId === existing.artifactId) {
        return {
          kind: 'DUPLICATE_CONTENT_SAME_ARTIFACT',
          artifactId: existing.artifactId,
          versionId: existing.versionId,
        };
      }
      return {
        kind: 'SAME_BYTES_DIFFERENT_ARTIFACT',
        artifactId: existing.artifactId,
        versionId: existing.versionId,
      };
    }

    return { kind: 'NEW_CONTENT' };
  }

  /**
   * Safe cleanup of the capture's OWN staging directory. Legal for DISCARDED
   * captures and failed pre-admission operations. FAILED_RECOVERABLE staging
   * bytes are RETAINED (recovery may require them). The original source is
   * never touched. COMPLETED final materialization is not cleaned here
   * (AUTO-01E owns that).
   */
  public async cleanupStaging(captureId: string): Promise<void> {
    const entry = this.captures.get(captureId);
    if (entry.state === 'FAILED_RECOVERABLE') {
      throw new CaptureStagingError(
        'STAGING_CLEANUP_FAILED',
        'FAILED_RECOVERABLE staging bytes are retained for recovery.',
        { captureId, state: entry.state },
      );
    }
    if (entry.state === 'COMPLETED') {
      throw new CaptureStagingError(
        'STAGING_CLEANUP_FAILED',
        'COMPLETED captures are not cleaned by AUTO-01D (final materialization is owned by AUTO-01E).',
        { captureId, state: entry.state },
      );
    }
    const dir = this.stagingDirFor(captureId);
    try {
      await this.fs.rm(dir);
    } catch (error) {
      throw new CaptureStagingError(
        'STAGING_CLEANUP_FAILED',
        'The capture staging directory could not be removed.',
        { captureId, dir, cause: String(error) },
      );
    }
  }

  /** Streaming SHA-256 of a file (bounded memory; safe for large DWG/PDF files). */
  public async hashFile(filePath: string): Promise<string> {
    return sha256FileStreaming(filePath);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireCaptureId(captureId: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)
    ) {
      throw new DomainError('VALIDATION_ERROR', 'Capture ID must be a UUID.', 400);
    }
    return captureId;
  }

  /**
   * Source-path authority: AUTO-01D processes ONLY the source path already
   * owned by the authorized CaptureLedger entry. No caller may submit an
   * arbitrary path; the ledger sourcePath is the identity rule.
   */
  private assertSourcePath(entry: CaptureLedgerEntry): void {
    if (typeof entry.sourcePath !== 'string' || entry.sourcePath.length === 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The capture ledger has no source path; staging is impossible.',
        400,
        { captureId: entry.captureId },
      );
    }
  }
}

/** Sanitized extension derived from the ledger source path (safe alphanumeric suffix only). */
function safeExtension(sourcePath: string): string {
  const base = path.basename(sourcePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot + 1);
  return /^[A-Za-z0-9]{1,16}$/.test(ext) ? `.${ext.toLowerCase()}` : '';
}
