import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DomainError,
  captureRoutingDecisions,
  transitionCaptureState,
  transitionManagedArtifact,
  validateCaptureRoutingDecision,
} from '@scli/domain';
import type {
  ArtifactVersion,
  ArtifactVersionLocatorKind,
  CaptureLedgerEntry,
  CaptureRoutingDecision,
  CaptureRoutingDecisionInput,
  CaptureState,
  CaptureTransitionOptions,
  ManagedArtifact,
  ManagedArtifactStatus,
  ToolContext,
  ToolContextState,
} from '@scli/domain';

/**
 * AUTO-01A — Managed Artifact persistence authority (owner-locked AUTO-00).
 *
 * Operates on the shared `DatabaseSync` handle (same pattern as
 * `CanonicalOutputRegistryStore`). This slice provides persistence/domain
 * identity ONLY:
 *   - create/get/list ManagedArtifact
 *   - create/get/list ArtifactVersion
 *   - create/get/list ToolContext
 *   - create/get/list CaptureLedger record
 *
 * No filesystem watcher, no capture service, no staging, no hashing pipeline,
 * no tool launching. The operational Auto-Capture pipeline is out of scope.
 *
 * The v15 tables are created by the production migration (or by the
 * non-production harness). This store asserts their presence at construction
 * (fail closed), mirroring the canonical registry.
 */

type Row = Record<string, unknown>;

/** Project-relative canonical managed path pattern (forward-slash relative paths; spaces allowed). */
const PROJECT_RELATIVE_PATH_PATTERN = /^[A-Za-z0-9_ ./()-]+$/;

const VALID_MANAGED_STATUSES = new Set<ManagedArtifactStatus>(['ACTIVE', 'FROZEN', 'ARCHIVED']);
const VALID_LOCATOR_KINDS = new Set<ArtifactVersionLocatorKind>([
  'PROJECT_RELATIVE',
  'LEGACY_ABSOLUTE',
  'LEGACY_UNKNOWN',
]);
const VALID_TOOL_CONTEXT_STATES = new Set<ToolContextState>([
  'LIVE',
  'REBOUND',
  'EXPIRED',
  'CLOSED',
]);
const VALID_CAPTURE_STATES = new Set<CaptureState>([
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
]);
const VALID_ROUTING_DECISIONS = new Set<CaptureRoutingDecision>(captureRoutingDecisions);

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError('CONFLICT', `Persisted ${label} is invalid.`, 409);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : requireUuid(value, label);
}

function requireUuid(value: unknown, label: string): string {
  const text = requireText(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new DomainError('VALIDATION_ERROR', `${label} must be a UUID.`, 400);
  }
  return text;
}

function requireSha256(value: unknown, label: string): string {
  const text = requireText(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new DomainError('VALIDATION_ERROR', `${label} must be a SHA-256 hex digest.`, 400);
  }
  return text;
}

function requireSafeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DomainError('VALIDATION_ERROR', `${label} must be a non-negative integer.`, 400);
  }
  return parsed;
}

function nullableSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function notFound(message: string): DomainError {
  return new DomainError('NOT_FOUND', message, 404);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed|constraint failed/i.test(error.message)
  );
}

function managedArtifactFromRow(row: Row): ManagedArtifact {
  const status = requireText(row.status, 'Managed Artifact status') as ManagedArtifactStatus;
  if (!VALID_MANAGED_STATUSES.has(status)) {
    throw new DomainError('CONFLICT', 'Persisted Managed Artifact status is invalid.', 409);
  }
  return {
    artifactId: requireUuid(row.artifact_id, 'Managed Artifact ID'),
    projectId: requireUuid(row.project_id, 'Managed Artifact project'),
    artifactType: requireText(row.artifact_type, 'Managed Artifact type'),
    sourceTool: requireText(row.source_tool, 'Managed Artifact source tool'),
    canonicalPath: requireText(row.canonical_path, 'Managed Artifact canonical path'),
    status,
    currentWorkingVersion: requireSafeInteger(
      row.current_working_version,
      'Managed Artifact working version',
    ),
    projectDocumentId: nullableText(row.project_document_id),
    createdAt: requireText(row.created_at, 'Managed Artifact created timestamp'),
    updatedAt: requireText(row.updated_at, 'Managed Artifact updated timestamp'),
  };
}

function artifactVersionFromRow(row: Row): ArtifactVersion {
  const locatorKind = requireText(row.locator_kind, 'locator kind') as ArtifactVersionLocatorKind;
  if (!VALID_LOCATOR_KINDS.has(locatorKind)) {
    throw new DomainError('CONFLICT', 'Persisted Artifact Version locator kind is invalid.', 409);
  }
  return {
    versionId: requireUuid(row.version_id, 'Artifact Version ID'),
    artifactId: requireUuid(row.artifact_id, 'Artifact Version artifact'),
    version: requireSafeInteger(row.version, 'Artifact Version sequence'),
    contentHash: requireSha256(row.content_hash, 'Artifact Version content hash'),
    sizeBytes: nullableSafeInteger(row.size_bytes),
    locatorKind,
    locatorValue: requireText(row.locator_value, 'Artifact Version locator'),
    captureId: nullableText(row.capture_id),
    createdAt: requireText(row.created_at, 'Artifact Version created timestamp'),
  };
}

function toolContextFromRow(row: Row): ToolContext {
  const state = requireText(row.state, 'state') as ToolContextState;
  if (!VALID_TOOL_CONTEXT_STATES.has(state)) {
    throw new DomainError('CONFLICT', 'Persisted Tool Context state is invalid.', 409);
  }
  return {
    toolContextId: requireUuid(row.tool_context_id, 'Tool Context ID'),
    projectId: requireUuid(row.project_id, 'Tool Context project'),
    targetRevisionId: nullableUuid(row.target_revision_id, 'Tool Context target Revision'),
    sourceDocumentId: nullableUuid(row.source_document_id, 'Tool Context source document'),
    tool: requireText(row.tool, 'Tool Context tool'),
    expectedArtifactType: requireText(
      row.expected_artifact_type,
      'Tool Context expected artifact type',
    ),
    mode: requireText(row.mode, 'Tool Context mode'),
    channel: requireText(row.channel, 'Tool Context channel'),
    state,
    openedAt: requireText(row.opened_at, 'Tool Context opened timestamp'),
    closedAt: nullableText(row.closed_at),
    expiredAt: nullableText(row.expired_at),
    createdAt: requireText(row.created_at, 'Tool Context created timestamp'),
  };
}

function captureLedgerFromRow(row: Row): CaptureLedgerEntry {
  const state = requireText(row.state, 'state') as CaptureState;
  if (!VALID_CAPTURE_STATES.has(state)) {
    throw new DomainError('CONFLICT', 'Persisted Capture state is invalid.', 409);
  }
  const rawRoutingDecision = nullableText(row.routing_decision);
  const routingDecision = rawRoutingDecision as CaptureRoutingDecision | null;
  if (routingDecision !== null && !VALID_ROUTING_DECISIONS.has(routingDecision)) {
    throw new DomainError('CONFLICT', 'Persisted Capture routing decision is invalid.', 409);
  }
  return {
    captureId: requireUuid(row.capture_id, 'Capture ID'),
    projectId: requireUuid(row.project_id, 'Capture project'),
    targetRevisionId: nullableUuid(row.target_revision_id, 'Capture target Revision'),
    toolContextId: nullableText(row.tool_context_id),
    sourcePath: requireText(row.source_path, 'Capture source path'),
    sourceChannel: requireText(row.source_channel, 'Capture source channel'),
    expectedArtifactType: requireText(row.expected_artifact_type, 'Capture expected artifact type'),
    contentHash: nullableText(row.content_hash),
    sizeBytes: nullableSafeInteger(row.size_bytes),
    state,
    attemptCount: requireSafeInteger(row.attempt_count, 'Capture attempt count'),
    detectedAt: requireText(row.detected_at, 'Capture detected timestamp'),
    stagedAt: nullableText(row.staged_at),
    admittedAt: nullableText(row.admitted_at),
    completedAt: nullableText(row.completed_at),
    error: nullableText(row.error),
    finalArtifactId: nullableText(row.final_artifact_id),
    finalVersionId: nullableText(row.final_version_id),
    routingDecision,
    routingReason: nullableText(row.routing_reason),
    decidedAt: nullableText(row.decided_at),
    decidedById: nullableText(row.decided_by_id),
    decidedByName: nullableText(row.decided_by_name),
    createdAt: requireText(row.created_at, 'Capture created timestamp'),
  };
}

export interface ManagedArtifactInput {
  projectId: string;
  artifactType: string;
  sourceTool: string;
  canonicalPath: string;
  projectDocumentId?: string | null;
  status?: ManagedArtifactStatus;
}

export interface ArtifactVersionInput {
  artifactId: string;
  version: number;
  contentHash: string;
  sizeBytes?: number | null;
  locatorKind?: ArtifactVersionLocatorKind;
  locatorValue: string;
  captureId?: string | null;
  now?: string;
}

export interface CaptureManagedArtifactInput extends ManagedArtifactInput {
  artifactId: string;
  now: string;
}

export interface IdempotentArtifactVersionInput {
  artifactId: string;
  contentHash: string;
  sizeBytes: number;
  locatorValue: string;
  captureId: string;
  now: string;
}

export interface ToolContextInput {
  projectId: string;
  targetRevisionId?: string | null;
  sourceDocumentId?: string | null;
  tool: string;
  expectedArtifactType: string;
  mode: string;
  channel: string;
  state?: ToolContextState;
  openedAt: string;
}

/**
 * Production creation input for a CaptureLedger row. A NEW capture starts ONLY
 * as DETECTED — the optional `state` field exists for compatibility and
 * permits ONLY the literal 'DETECTED'. Any other value is rejected at runtime
 * (never silently coerced), so it is impossible to seed another initial state
 * through the normal creation operation.
 */
export interface CaptureLedgerInput {
  projectId: string;
  targetRevisionId?: string | null;
  toolContextId?: string | null;
  sourcePath: string;
  sourceChannel: string;
  expectedArtifactType: string;
  state?: 'DETECTED';
  detectedAt: string;
}

/**
 * TEST/INTERNAL seeding input — same fields but with an arbitrary locked
 * CaptureState. Used ONLY by fixture tests (AUTO-01A persistence proofs,
 * AUTO-01C inconsistent-shape proofs); never by production code.
 */
export interface CaptureLedgerTestInput extends Omit<CaptureLedgerInput, 'state'> {
  state?: CaptureState;
}

export interface ProvenDetectedCaptureInput extends CaptureLedgerInput {
  contentHash: string;
  sizeBytes: number;
}

/**
 * AUTO-01A persistence authority for the owner-locked Managed Artifact
 * foundation. Operates directly on the shared `DatabaseSync` handle. This is
 * persistence/domain identity ONLY — no operational capture behavior.
 */
export class ManagedArtifactStore {
  private readonly database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.database = database;
    for (const table of [
      'managed_artifacts',
      'artifact_versions',
      'tool_contexts',
      'capture_ledger',
    ]) {
      const row = this.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name?: string } | undefined;
      if (!row) {
        throw new DomainError(
          'INTEGRATION_UNAVAILABLE',
          `Managed Artifact schema is not available (missing ${table}).`,
          503,
        );
      }
    }
  }

  // ------------------------------------------------------------------ ManagedArtifact

  public createManagedArtifact(input: ManagedArtifactInput): ManagedArtifact {
    const artifactId = randomUUID();
    const projectId = requireUuid(input.projectId, 'Managed Artifact project');
    const canonicalPath = input.canonicalPath.replaceAll('\\', '/');
    if (!PROJECT_RELATIVE_PATH_PATTERN.test(canonicalPath)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Managed Artifact canonical path must be a project-relative managed path.',
        400,
      );
    }
    let projectDocumentId: string | null = null;
    if (input.projectDocumentId) {
      projectDocumentId = requireUuid(input.projectDocumentId, 'Managed Artifact source document');
      // Same-project ownership (AUTO-D01): the linked ProjectDocument must belong
      // to the SAME project as the ManagedArtifact.
      const doc = this.database
        .prepare('SELECT project_id FROM project_documents WHERE id = ?')
        .get(projectDocumentId) as { project_id?: unknown } | undefined;
      if (!doc) {
        throw new DomainError('VALIDATION_ERROR', 'Linked Project Document not found.', 400);
      }
      if (doc.project_id !== projectId) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A Managed Artifact may only link to a Project Document in the same project.',
          400,
        );
      }
    }
    const now = new Date().toISOString();
    try {
      this.database
        .prepare(
          `INSERT INTO managed_artifacts
           (artifact_id, project_id, artifact_type, source_tool, canonical_path, status,
            current_working_version, project_document_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          artifactId,
          projectId,
          input.artifactType,
          input.sourceTool,
          canonicalPath,
          input.status ?? 'ACTIVE',
          projectDocumentId,
          now,
          now,
        );
    } catch (error) {
      if (isUniqueConstraint(error)) {
        if (
          projectDocumentId &&
          this.database
            .prepare('SELECT artifact_id FROM managed_artifacts WHERE project_document_id = ?')
            .get(projectDocumentId)
        ) {
          throw new DomainError(
            'CONFLICT',
            'A Managed Artifact already exists for this Project Document.',
            409,
          );
        }
        throw new DomainError(
          'CONFLICT',
          'A Managed Artifact already exists for this project at the canonical path.',
          409,
        );
      }
      throw error;
    }
    return this.getManagedArtifact(artifactId);
  }

  /**
   * P4B exact-lineage admission. The caller supplies a deterministic UUID
   * derived from Project + artifact type + exact Revision UUID (or Project
   * lineage for project-level outputs). BEGIN IMMEDIATE makes concurrent first
   * admission converge on one ManagedArtifact without storing a second lineage
   * state machine or adding schema v21.
   */
  public upsertCaptureManagedArtifact(input: CaptureManagedArtifactInput): ManagedArtifact {
    const artifactId = requireUuid(input.artifactId, 'Managed Artifact ID');
    const projectId = requireUuid(input.projectId, 'Managed Artifact project');
    const projectDocumentId = input.projectDocumentId
      ? requireUuid(input.projectDocumentId, 'Managed Artifact source document')
      : null;
    const canonicalPath = input.canonicalPath.replaceAll('\\', '/');
    if (!PROJECT_RELATIVE_PATH_PATTERN.test(canonicalPath)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Managed Artifact canonical path must be a project-relative managed path.',
        400,
      );
    }
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const existing = this.database
        .prepare('SELECT * FROM managed_artifacts WHERE artifact_id = ?')
        .get(artifactId) as Row | undefined;
      if (existing) {
        const artifact = managedArtifactFromRow(existing);
        if (
          artifact.projectId !== projectId ||
          artifact.artifactType !== input.artifactType ||
          artifact.projectDocumentId !== projectDocumentId ||
          artifact.status !== 'ACTIVE'
        ) {
          throw new DomainError('CONFLICT', 'Managed Artifact lineage is incompatible.', 409);
        }
        this.database
          .prepare(
            `UPDATE managed_artifacts SET canonical_path = ?, source_tool = ?, updated_at = ?
             WHERE artifact_id = ?`,
          )
          .run(canonicalPath, input.sourceTool, input.now, artifactId);
      } else {
        this.database
          .prepare(
            `INSERT INTO managed_artifacts
             (artifact_id, project_id, artifact_type, source_tool, canonical_path, status,
              current_working_version, project_document_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?, ?)`,
          )
          .run(
            artifactId,
            projectId,
            input.artifactType,
            input.sourceTool,
            canonicalPath,
            projectDocumentId,
            input.now,
            input.now,
          );
      }
      this.database.exec('COMMIT');
      return this.getManagedArtifact(artifactId);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  public getManagedArtifact(artifactId: string): ManagedArtifact {
    const row = this.database
      .prepare('SELECT * FROM managed_artifacts WHERE artifact_id = ?')
      .get(requireUuid(artifactId, 'Managed Artifact ID')) as Row | undefined;
    if (!row) throw notFound('Managed Artifact not found.');
    return managedArtifactFromRow(row);
  }

  public listManagedArtifacts(projectId?: string): ManagedArtifact[] {
    const rows = projectId
      ? (this.database
          .prepare(
            'SELECT * FROM managed_artifacts WHERE project_id = ? ORDER BY created_at, artifact_id',
          )
          .all(requireUuid(projectId, 'Managed Artifact project')) as Row[])
      : (this.database
          .prepare('SELECT * FROM managed_artifacts ORDER BY created_at, artifact_id')
          .all() as Row[]);
    return rows.map(managedArtifactFromRow);
  }

  /**
   * AUTO-01E2A — narrow archive authority: ACTIVE -> ARCHIVED through the
   * domain transition authority, stamping `updatedAt`. Returns the next
   * artifact state. The domain rejects any non-ACTIVE source (FROZEN /
   * ARCHIVED never silently re-archives), and the UPDATE is confined to the
   * status + updated_at columns — identity and version fields are never
   * rewritten.
   */
  public archiveManagedArtifact(artifactId: string, at: string): ManagedArtifact {
    const id = requireUuid(artifactId, 'Managed Artifact ID');
    const current = this.getManagedArtifact(id);
    const next = transitionManagedArtifact(current, 'ARCHIVED', at);
    this.database
      .prepare('UPDATE managed_artifacts SET status = ?, updated_at = ? WHERE artifact_id = ?')
      .run(next.status, next.updatedAt, id);
    return this.getManagedArtifact(id);
  }

  /**
   * REV-01B — narrow freeze authority: ACTIVE -> FROZEN through the domain
   * transition authority, stamping `updatedAt`. Called when immutable history
   * (a FINALIZED Revision's Document Snapshots) references this artifact's
   * versions. Returns the next artifact state. The domain rejects any
   * non-ACTIVE source (FROZEN / ARCHIVED never silently re-freeze), and the
   * UPDATE is confined to the status + updated_at columns — identity and
   * version fields are never rewritten.
   */
  public freezeManagedArtifact(artifactId: string, at: string): ManagedArtifact {
    const id = requireUuid(artifactId, 'Managed Artifact ID');
    const current = this.getManagedArtifact(id);
    const next = transitionManagedArtifact(current, 'FROZEN', at);
    this.database
      .prepare('UPDATE managed_artifacts SET status = ?, updated_at = ? WHERE artifact_id = ?')
      .run(next.status, next.updatedAt, id);
    return this.getManagedArtifact(id);
  }

  /**
   * REV-01B — freeze discovery: the DISTINCT ManagedArtifact IDs whose
   * lineage is referenced by a Revision's immutable Document Snapshots
   * (revision_document_snapshots -> source_artifact_version_id ->
   * artifact_versions -> managed_artifacts). Never a ProjectDocument
   * mapping. Deterministic ordering; dangling version references are simply
   * not covered by the join.
   */
  public listArtifactsReferencedByRevision(revisionId: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT ma.artifact_id AS artifact_id
         FROM revision_document_snapshots rds
         INNER JOIN artifact_versions av ON av.version_id = rds.source_artifact_version_id
         INNER JOIN managed_artifacts ma ON ma.artifact_id = av.artifact_id
         WHERE rds.revision_id = ? AND rds.source_artifact_version_id IS NOT NULL
         ORDER BY ma.artifact_id`,
      )
      .all(requireUuid(revisionId, 'Revision ID')) as Array<{ artifact_id: string }>;
    return rows.map((row) => row.artifact_id);
  }

  /**
   * AUTO-01E2A — immutable-reference probe: whether ANY persisted downstream
   * immutable record already references the given ArtifactVersion. This is
   * the undo freeze check. Today the ONLY consumer is the Revision Document
   * Snapshot provenance column (AUTO-D02, `revision_document_snapshots
   * .source_artifact_version_id`). Future Package / Issue reference tables
   * MUST be added to this probe when they are introduced — an undo must
   * never be permitted once issued history references the version.
   */
  public hasImmutableVersionReference(versionId: string): boolean {
    const id = requireUuid(versionId, 'Artifact Version ID');
    const row = this.database
      .prepare(
        `SELECT 1 AS referenced FROM revision_document_snapshots
         WHERE source_artifact_version_id = ? LIMIT 1`,
      )
      .get(id) as Row | undefined;
    return row !== undefined;
  }

  // ------------------------------------------------------------ ArtifactVersion

  public createArtifactVersion(input: ArtifactVersionInput): ArtifactVersion {
    const versionId = randomUUID();
    const artifactId = requireUuid(input.artifactId, 'Artifact Version artifact');
    const artifact = this.getManagedArtifact(artifactId);
    // REV-01B — a FROZEN artifact is terminal: immutable history (a FINALIZED
    // Revision's Document Snapshots) references its versions, so no new
    // working version may ever be created on top of it.
    if (artifact.status === 'FROZEN') {
      throw new DomainError(
        'CONFLICT',
        'Cannot create an Artifact Version on a FROZEN Managed Artifact.',
        409,
        { artifactId, status: artifact.status },
      );
    }
    const version = requireSafeInteger(input.version, 'Artifact Version sequence');
    if (version < 1) {
      throw new DomainError('VALIDATION_ERROR', 'Artifact Version sequence must be >= 1.', 400);
    }
    const contentHash = requireSha256(input.contentHash, 'Artifact Version content hash');
    const locatorKind = input.locatorKind ?? 'PROJECT_RELATIVE';
    if (!VALID_LOCATOR_KINDS.has(locatorKind)) {
      throw new DomainError('VALIDATION_ERROR', 'Invalid Artifact Version locator kind.', 400);
    }
    const now = input.now ?? new Date().toISOString();
    // Atomicity (AUTO-01A): the ArtifactVersion INSERT and the companion
    // current_working_version UPDATE must succeed together or not at all.
    try {
      this.database.exec('BEGIN IMMEDIATE');
      this.database
        .prepare(
          `INSERT INTO artifact_versions
           (version_id, artifact_id, version, content_hash, size_bytes, locator_kind,
            locator_value, capture_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          artifactId,
          version,
          contentHash,
          input.sizeBytes ?? null,
          locatorKind,
          input.locatorValue,
          input.captureId ?? null,
          now,
        );
      this.database
        .prepare(
          `UPDATE managed_artifacts SET current_working_version = ?, updated_at = ?
           WHERE artifact_id = ?`,
        )
        .run(Math.max(artifact.currentWorkingVersion, version), now, artifactId);
      this.database.exec('COMMIT');
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original error if rollback fails.
      }
      if (isUniqueConstraint(error)) {
        throw new DomainError(
          'CONFLICT',
          'This version sequence already exists for the artifact.',
          409,
        );
      }
      throw error;
    }
    return this.getArtifactVersion(versionId);
  }

  /** P4B idempotent exact-version admission with atomic sequence allocation. */
  public admitArtifactVersion(input: IdempotentArtifactVersionInput): ArtifactVersion {
    const artifactId = requireUuid(input.artifactId, 'Artifact Version artifact');
    const hash = requireSha256(input.contentHash, 'Artifact Version content hash');
    const captureId = requireUuid(input.captureId, 'Artifact Version capture');
    const size = requireSafeInteger(input.sizeBytes, 'Artifact Version size');
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const artifactRow = this.database
        .prepare('SELECT * FROM managed_artifacts WHERE artifact_id = ?')
        .get(artifactId) as Row | undefined;
      if (!artifactRow) throw notFound('Managed Artifact not found.');
      const artifact = managedArtifactFromRow(artifactRow);
      if (artifact.status !== 'ACTIVE') {
        throw new DomainError(
          'CONFLICT',
          'Artifact Version admission requires an ACTIVE artifact.',
          409,
        );
      }
      const existing = this.database
        .prepare(
          `SELECT * FROM artifact_versions
           WHERE artifact_id = ? AND content_hash = ?
           ORDER BY version LIMIT 1`,
        )
        .get(artifactId, hash) as Row | undefined;
      if (existing) {
        this.database.exec('COMMIT');
        return artifactVersionFromRow(existing);
      }
      const latest = this.database
        .prepare(
          'SELECT COALESCE(MAX(version), 0) AS version FROM artifact_versions WHERE artifact_id = ?',
        )
        .get(artifactId) as { version?: number } | undefined;
      const version = Number(latest?.version ?? 0) + 1;
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new DomainError(
          'CONFLICT',
          'Artifact Version sequence is outside its safe range.',
          409,
        );
      }
      const versionId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO artifact_versions
           (version_id, artifact_id, version, content_hash, size_bytes, locator_kind,
            locator_value, capture_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'PROJECT_RELATIVE', ?, ?, ?)`,
        )
        .run(
          versionId,
          artifactId,
          version,
          hash,
          size,
          input.locatorValue.replaceAll('\\', '/'),
          captureId,
          input.now,
        );
      this.database
        .prepare(
          'UPDATE managed_artifacts SET current_working_version = ?, updated_at = ? WHERE artifact_id = ?',
        )
        .run(version, input.now, artifactId);
      this.database.exec('COMMIT');
      return this.getArtifactVersion(versionId);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  public getArtifactVersion(versionId: string): ArtifactVersion {
    const row = this.database
      .prepare('SELECT * FROM artifact_versions WHERE version_id = ?')
      .get(requireUuid(versionId, 'Artifact Version ID')) as Row | undefined;
    if (!row) throw notFound('Artifact Version not found.');
    return artifactVersionFromRow(row);
  }

  public listArtifactVersions(artifactId: string): ArtifactVersion[] {
    return (
      this.database
        .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version')
        .all(requireUuid(artifactId, 'Artifact Version artifact')) as Row[]
    ).map(artifactVersionFromRow);
  }

  /**
   * AUTO-01D — dedup authority: finds the first ArtifactVersion carrying the
   * given content hash WITHIN a project (project/artifact identity remains
   * authoritative; hashes are never globally deduped across projects here).
   * Returns null when no version in the project has the hash.
   */
  public findArtifactVersionByContentHash(
    projectId: string,
    contentHash: string,
  ): ArtifactVersion | null {
    const pid = requireUuid(projectId, 'Capture project');
    const hash = requireSha256(contentHash, 'Artifact Version content hash');
    const row = this.database
      .prepare(
        `SELECT v.* FROM artifact_versions v
         JOIN managed_artifacts a ON a.artifact_id = v.artifact_id
         WHERE a.project_id = ? AND v.content_hash = ?
         ORDER BY v.created_at, v.version_id LIMIT 1`,
      )
      .get(pid, hash) as Row | undefined;
    return row ? artifactVersionFromRow(row) : null;
  }

  /**
   * AUTO-01D — narrow authority that persists the PROVEN staged content proof
   * (SHA-256 + size) onto a CaptureLedger row.
   *
   * Legal only at the correct lifecycle point: the capture must be in
   * STABILIZING (proof recorded before entering STAGED) or STAGED (recovery
   * re-verification). It never changes state — the AUTO-01C transition
   * authority owns state. It validates the hash format, the size, and the
   * capture's project ownership, and it never rewrites an already-persisted
   * proof with a DIFFERENT value (a divergent proof is a CONFLICT — the
   * persisted proof is immutable once recorded).
   */
  public recordStagedContentProof(
    captureId: string,
    contentHash: string,
    sizeBytes: number,
  ): CaptureLedgerEntry {
    const id = requireUuid(captureId, 'Capture ID');
    const hash = requireSha256(contentHash, 'Capture staged content hash');
    const size = requireSafeInteger(sizeBytes, 'Capture staged size');
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const row = this.database
        .prepare('SELECT * FROM capture_ledger WHERE capture_id = ?')
        .get(id) as Row | undefined;
      if (!row) {
        throw notFound('Capture Ledger entry not found.');
      }
      const current = captureLedgerFromRow(row);
      if (current.state !== 'STABILIZING' && current.state !== 'STAGED') {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Staged content proof may only be recorded while STABILIZING or STAGED (current: ${current.state}).`,
          409,
          { captureId: id, state: current.state },
        );
      }
      if (current.contentHash !== null && current.contentHash !== hash) {
        throw new DomainError(
          'CONFLICT',
          'The staged content proof of a capture is immutable once recorded.',
          409,
          { captureId: id, persisted: current.contentHash },
        );
      }
      if (current.sizeBytes !== null && current.sizeBytes !== size) {
        throw new DomainError(
          'CONFLICT',
          'The staged size proof of a capture is immutable once recorded.',
          409,
          { captureId: id, persisted: current.sizeBytes },
        );
      }
      this.database
        .prepare('UPDATE capture_ledger SET content_hash = ?, size_bytes = ? WHERE capture_id = ?')
        .run(hash, size, id);
      this.database.exec('COMMIT');
      return this.getCaptureLedgerEntry(id);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original error if rollback fails.
      }
      throw error;
    }
  }

  // ----------------------------------------------------------------- ToolContext

  public createToolContext(input: ToolContextInput): ToolContext {
    const toolContextId = randomUUID();
    const projectId = requireUuid(input.projectId, 'Tool Context project');
    const targetRevisionId = nullableUuid(input.targetRevisionId, 'Tool Context target Revision');
    const sourceDocumentId = nullableUuid(input.sourceDocumentId, 'Tool Context source document');
    const state = input.state ?? 'LIVE';
    if (!VALID_TOOL_CONTEXT_STATES.has(state)) {
      throw new DomainError('VALIDATION_ERROR', 'Invalid Tool Context state.', 400);
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO tool_contexts
         (tool_context_id, project_id, target_revision_id, source_document_id,
          tool, expected_artifact_type, mode, channel,
          state, opened_at, closed_at, expired_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        toolContextId,
        projectId,
        targetRevisionId,
        sourceDocumentId,
        input.tool,
        input.expectedArtifactType,
        input.mode,
        input.channel,
        state,
        input.openedAt,
        now,
      );
    return this.getToolContext(toolContextId);
  }

  public getToolContext(toolContextId: string): ToolContext {
    const row = this.database
      .prepare('SELECT * FROM tool_contexts WHERE tool_context_id = ?')
      .get(requireUuid(toolContextId, 'Tool Context ID')) as Row | undefined;
    if (!row) throw notFound('Tool Context not found.');
    return toolContextFromRow(row);
  }

  public listToolContexts(projectId?: string): ToolContext[] {
    const rows = projectId
      ? (this.database
          .prepare(
            'SELECT * FROM tool_contexts WHERE project_id = ? ORDER BY created_at, tool_context_id',
          )
          .all(requireUuid(projectId, 'Tool Context project')) as Row[])
      : (this.database
          .prepare('SELECT * FROM tool_contexts ORDER BY created_at, tool_context_id')
          .all() as Row[]);
    return rows.map(toolContextFromRow);
  }

  /** Narrowly sets a Tool Context state (LIVE/REBOUND/EXPIRED/CLOSED). */
  public setToolContextState(
    toolContextId: string,
    state: ToolContextState,
    at: string,
  ): ToolContext {
    const context = this.getToolContext(toolContextId);
    if (state === context.state) return context;
    if (state === 'EXPIRED') {
      this.database
        .prepare('UPDATE tool_contexts SET state = ?, expired_at = ? WHERE tool_context_id = ?')
        .run(state, at, toolContextId);
    } else if (state === 'CLOSED') {
      this.database
        .prepare('UPDATE tool_contexts SET state = ?, closed_at = ? WHERE tool_context_id = ?')
        .run(state, at, toolContextId);
    } else {
      this.database
        .prepare('UPDATE tool_contexts SET state = ? WHERE tool_context_id = ?')
        .run(state, toolContextId);
    }
    return this.getToolContext(toolContextId);
  }

  // ------------------------------------------------------------ CaptureLedger

  /**
   * Production creation of a CaptureLedger row. The product authority (AUTO-01C)
   * says a NEW capture starts ONLY as DETECTED — no caller may seed
   * ADMITTED/COMPLETED/FAILED_RECOVERABLE/... directly. The optional `state`
   * input permits ONLY the literal 'DETECTED'; any other value FAILS
   * TRUTHFULLY (never silently coerced), so caller bugs are never hidden.
   * Tests that need arbitrary-state rows for invariant proofs must use the
   * clearly test/internal `createCaptureLedgerEntryForTest` helper.
   */
  public createCaptureLedgerEntry(input: CaptureLedgerInput): CaptureLedgerEntry {
    if (input.state !== undefined && input.state !== 'DETECTED') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A new Capture Ledger entry may only be created in DETECTED state.',
        400,
      );
    }
    return this.createCaptureLedgerEntryForTest({ ...input, state: 'DETECTED' });
  }

  /**
   * P4B duplicate-event authority. A short BEGIN IMMEDIATE transaction finds
   * or creates the one durable capture for exact Tool Context + normalized
   * source locator + stable hash. The stability/hash filesystem proof is
   * completed before this method; no filesystem work occurs in the transaction.
   */
  public findOrCreateProvenDetectedCapture(input: ProvenDetectedCaptureInput): {
    entry: CaptureLedgerEntry;
    created: boolean;
  } {
    const projectId = requireUuid(input.projectId, 'Capture project');
    const toolContextId = input.toolContextId
      ? requireUuid(input.toolContextId, 'Capture Tool Context')
      : null;
    const targetRevisionId = nullableUuid(input.targetRevisionId, 'Capture target Revision');
    const hash = requireSha256(input.contentHash, 'Capture stable content hash');
    const size = requireSafeInteger(input.sizeBytes, 'Capture stable size');
    const sourcePath = input.sourcePath;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const existing = this.database
        .prepare(
          `SELECT * FROM capture_ledger
           WHERE project_id = ?
             AND tool_context_id IS ?
             AND lower(source_path) = lower(?)
             AND content_hash = ?
           ORDER BY detected_at, capture_id LIMIT 1`,
        )
        .get(projectId, toolContextId, sourcePath, hash) as Row | undefined;
      if (existing) {
        this.database.exec('COMMIT');
        return { entry: captureLedgerFromRow(existing), created: false };
      }
      if (toolContextId) {
        const context = this.getToolContext(toolContextId);
        if (context.projectId !== projectId || context.targetRevisionId !== targetRevisionId) {
          throw new DomainError(
            'VALIDATION_ERROR',
            'Capture identity must match its exact Tool Context Project and Revision snapshots.',
            400,
          );
        }
      }
      const captureId = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO capture_ledger
           (capture_id, project_id, target_revision_id, tool_context_id, source_path, source_channel,
            expected_artifact_type, content_hash, size_bytes, state, attempt_count,
            detected_at, staged_at, admitted_at, completed_at, error,
            final_artifact_id, final_version_id, routing_decision, routing_reason,
            decided_at, decided_by_id, decided_by_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DETECTED', 0, ?, NULL, NULL, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
        )
        .run(
          captureId,
          projectId,
          targetRevisionId,
          toolContextId,
          sourcePath,
          input.sourceChannel,
          input.expectedArtifactType,
          hash,
          size,
          input.detectedAt,
          now,
        );
      const row = this.database
        .prepare('SELECT * FROM capture_ledger WHERE capture_id = ?')
        .get(captureId) as Row;
      this.database.exec('COMMIT');
      return { entry: captureLedgerFromRow(row), created: true };
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  /**
   * TEST/INTERNAL ONLY — creates a CaptureLedger row with an explicit state.
   *
   * This exists so AUTO-01A persistence tests can seed every locked state and
   * AUTO-01C tests can construct inconsistent milestone shapes to prove the
   * state machine fails closed. It is NOT part of the product surface: the
   * production `createCaptureLedgerEntry` always starts DETECTED, and the
   * product service (`CaptureLedgerService.createDetectedCapture`) is the
   * canonical creation authority. Do NOT call this from production code.
   */
  public createCaptureLedgerEntryForTest(input: CaptureLedgerTestInput): CaptureLedgerEntry {
    const captureId = randomUUID();
    const projectId = requireUuid(input.projectId, 'Capture project');
    let toolContextId: string | null = null;
    let targetRevisionId = nullableUuid(input.targetRevisionId, 'Capture target Revision');
    if (input.toolContextId) {
      toolContextId = requireUuid(input.toolContextId, 'Capture tool context');
      // Same-project ownership: a CaptureLedger row must never reference a
      // ToolContext belonging to a different project.
      const context = this.getToolContext(toolContextId);
      if (context.projectId !== projectId) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A Capture Ledger entry may only reference a Tool Context in the same project.',
          400,
        );
      }
      if (
        targetRevisionId !== null &&
        context.targetRevisionId !== null &&
        targetRevisionId !== context.targetRevisionId
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A Capture Ledger target Revision must match its Tool Context snapshot.',
          400,
        );
      }
      targetRevisionId ??= context.targetRevisionId;
    }
    const state = input.state ?? 'DETECTED';
    if (!VALID_CAPTURE_STATES.has(state)) {
      throw new DomainError('VALIDATION_ERROR', 'Invalid Capture state.', 400);
    }
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO capture_ledger
        (capture_id, project_id, target_revision_id, tool_context_id, source_path, source_channel,
         expected_artifact_type, content_hash, size_bytes, state, attempt_count,
         detected_at, staged_at, admitted_at, completed_at, error,
         final_artifact_id, final_version_id, routing_decision, routing_reason,
         decided_at, decided_by_id, decided_by_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, NULL, NULL, NULL, NULL,
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(
        captureId,
        projectId,
        targetRevisionId,
        toolContextId,
        input.sourcePath,
        input.sourceChannel,
        input.expectedArtifactType,
        state,
        input.detectedAt,
        now,
      );
    return this.getCaptureLedgerEntry(captureId);
  }

  public getCaptureLedgerEntry(captureId: string): CaptureLedgerEntry {
    const row = this.database
      .prepare('SELECT * FROM capture_ledger WHERE capture_id = ?')
      .get(requireUuid(captureId, 'Capture ID')) as Row | undefined;
    if (!row) throw notFound('Capture Ledger entry not found.');
    return captureLedgerFromRow(row);
  }

  public listCaptureLedgerEntries(projectId?: string): CaptureLedgerEntry[] {
    const rows = projectId
      ? (this.database
          .prepare(
            'SELECT * FROM capture_ledger WHERE project_id = ? ORDER BY detected_at, capture_id',
          )
          .all(requireUuid(projectId, 'Capture project')) as Row[])
      : (this.database
          .prepare('SELECT * FROM capture_ledger ORDER BY detected_at, capture_id')
          .all() as Row[]);
    return rows.map(captureLedgerFromRow);
  }

  /** Records the one durable routing decision; a persisted decision is immutable. */
  public recordCaptureRoutingDecision(
    captureId: string,
    input: CaptureRoutingDecisionInput,
  ): CaptureLedgerEntry {
    const id = requireUuid(captureId, 'Capture ID');
    const decision = validateCaptureRoutingDecision(input);
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const current = this.getCaptureLedgerEntry(id);
      if (current.routingDecision !== null) {
        throw new DomainError(
          'CONFLICT',
          'The routing decision of a capture is immutable once recorded.',
          409,
          { captureId: id },
        );
      }
      this.database
        .prepare(
          `UPDATE capture_ledger
           SET routing_decision = ?, routing_reason = ?, decided_at = ?,
               decided_by_id = ?, decided_by_name = ?
           WHERE capture_id = ? AND routing_decision IS NULL`,
        )
        .run(
          decision.decision,
          decision.reason ?? null,
          decision.decidedAt,
          decision.decidedById ?? null,
          decision.decidedByName ?? null,
          id,
        );
      this.database.exec('COMMIT');
      return this.getCaptureLedgerEntry(id);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original error if rollback fails.
      }
      throw error;
    }
  }

  /**
   * AUTO-01C — atomically applies ONE capture state transition (AUTO-01C).
   *
   * The transition is validated and applied inside a single `BEGIN IMMEDIATE`
   * transaction on the one ledger row: read current state -> validate through
   * the domain authority -> update state + timestamps/fields -> COMMIT. A
   * stale-state race cannot interleave (this is a local single-user product,
   * but the state authority stays coherent), and a failed validation leaves
   * the row untouched.
   *
   * Timestamps update rules (mirror the domain authority):
   *   - `stagedAt`/`admittedAt` are set only when entering that milestone and
   *     never rewritten on retry;
   *   - `completedAt` is stamped once on COMPLETED;
   *   - `error` persists the latest failure (required into UNRESOLVED /
   *     FAILED_RECOVERABLE) and is cleared on healthy progress.
   *
   * Final-identity lineage invariants for ADMITTED/COMPLETED are enforced by
   * the service layer, which loads the real ManagedArtifact/ArtifactVersion
   * rows before persisting (`admittedAt`/`completedAt` are only stamped here
   * after those ownership checks pass). This store primitive never creates a
   * ManagedArtifact or ArtifactVersion.
   */
  public transitionCaptureState(
    captureId: string,
    to: CaptureState,
    at: string,
    options: CaptureTransitionOptions = {},
  ): CaptureLedgerEntry {
    const id = requireUuid(captureId, 'Capture ID');
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const row = this.database
        .prepare('SELECT * FROM capture_ledger WHERE capture_id = ?')
        .get(id) as Row | undefined;
      if (!row) {
        throw notFound('Capture Ledger entry not found.');
      }
      const current = captureLedgerFromRow(row);
      const next = transitionCaptureState(current, to, at, options);
      // next.stagedAt/admittedAt/completedAt are ALWAYS the same as the
      // persisted values when the transition does not enter the milestone.
      this.database
        .prepare(
          `UPDATE capture_ledger
           SET state = ?, attempt_count = ?, staged_at = ?, admitted_at = ?,
               completed_at = ?, error = ?, final_artifact_id = ?,
               final_version_id = ?
           WHERE capture_id = ?`,
        )
        .run(
          next.state,
          next.attemptCount,
          next.stagedAt,
          next.admittedAt,
          next.completedAt,
          next.error,
          next.finalArtifactId,
          next.finalVersionId,
          id,
        );
      this.database.exec('COMMIT');
      return next;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original error if rollback fails.
      }
      throw error;
    }
  }
}
