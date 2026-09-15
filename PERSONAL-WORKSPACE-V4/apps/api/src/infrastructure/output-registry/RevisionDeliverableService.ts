import { randomUUID } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  AppUser,
  CanonicalOutputRecord,
  CanonicalRevisionRecord,
  DatasheetEligibilityItem,
  DatasheetIntegrityStatus,
  LuminaireAssetVersion,
  Project,
  ProjectWorkspace,
  RevisionDeliverable,
  RevisionDocumentSnapshotRecord,
} from '@scli/domain';
import { DomainError, documentSnapshotSourceId } from '@scli/domain';
import type {
  CanonicalProjectSnapshotInput,
  CreateRevisionDocumentSnapshotInput,
  PrepareRevisionInput,
  DuplicateRevisionInput,
  UpdateRevisionMetadataInput,
} from '@scli/contracts';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { VerifiedProjectRoot } from '../../project-storage-service.js';
import type { ManagedArtifactStore } from '../managed-artifact/ManagedArtifactStore.js';
import {
  CanonicalOutputRegistryStore,
  normalizeCanonicalProjectRelativePath,
} from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  resolveCanonicalArtifactPath,
  resolveCanonicalArtifactPresence,
  sha256File,
  snapshotFileExclusive,
  readVerifiedCanonicalArtifact,
} from './canonical-artifact-files.js';
import {
  discardCanonicalOutputReservation,
  finalizeProvenCanonicalOutputReservation,
  isUnprovenOutputReservationLifecycle,
  proveCanonicalOutputReservation,
  type CanonicalReservationProof,
} from './canonical-composition-reservations.js';

/**
 * One incomplete canonical Output reservation together with the classification
 * that decides its disposal. UNPROVABLE never reaches a plan: it aborts the
 * repair before any lifecycle change.
 */
interface ResolvedReservationPlanItem {
  readonly output: CanonicalOutputRecord;
  readonly proof: Exclude<CanonicalReservationProof, { kind: 'UNPROVABLE' }>;
}

/**
 * B0 — Revision Deliverable orchestration authority.
 *
 * Coordinates the canonical Output Registry store (persistence) with the
 * Personal workspace store (mutable operational Project Document source +
 * project folder root) to:
 *
 *  - create a PREPARING manual Revision through the B0 workflow;
 *  - create immutable Document Snapshot deliverables from an authorized
 *    project-local source document (never an arbitrary client path);
 *  - remove a pre-finalization Document Snapshot and its owned artifact;
 *  - finalize a PREPARING Revision through the B0 >=1-deliverable gate,
 *    freezing every ManagedArtifact whose ArtifactVersion is referenced by
 *    the Revision's immutable Document Snapshots (REV-01B);
 *  - expose a unified read projection of a Revision's deliverables.
 *
 * Generated canonical Outputs remain projected from canonical_outputs; they are
 * never duplicated into revision_document_snapshots.
 *
 * C0 adds the composition durability authority on top of that foundation:
 * Resume Revision (FAILED_RECOVERABLE -> PREPARING draft repair) and the F-1
 * physical-presence gate for attached generated Output Deliverables.
 */
export class RevisionDeliverableService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    /**
     * REV-01A — optional Managed Artifact authority. When present, a Document
     * Snapshot created from bytes identical to a managed ArtifactVersion in
     * the SAME project is linked to that version via
     * `source_artifact_version_id` (server-derived provenance; never supplied
     * by the client). When absent (legacy/test wiring), snapshots keep NULL
     * provenance exactly as before.
     */
    private readonly managedArtifacts?: ManagedArtifactStore,
  ) {}

  /** Creates a PREPARING manual Revision through the B0 workflow. */
  public prepareRevision(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    metadata: PrepareRevisionInput = {},
  ): CanonicalRevisionRecord {
    const revision = this.registry.createRevision({
      projectId: project.id,
      projectSnapshot: projectSnapshotForManual(project, workspace),
      luminaires: luminaireSnapshotList(workspace),
      purpose: metadata.purpose ?? null,
      internalNote: metadata.internalNote ?? null,
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });
    return revision;
  }

  public duplicateRevision(
    project: Project,
    sourceRevisionId: string,
    actor: AppUser,
    input: DuplicateRevisionInput,
  ): CanonicalRevisionRecord {
    return this.registry.duplicateRevision(project.id, sourceRevisionId, input, {
      actorId: actor.id,
      actorNameSnapshot: actor.displayName,
    });
  }

  public updateRevisionMetadata(
    project: Project,
    revisionId: string,
    input: UpdateRevisionMetadataInput,
  ): CanonicalRevisionRecord {
    return this.registry.updateRevisionMetadata(project.id, revisionId, input);
  }

  public async createDocumentSnapshot(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    revisionId: string,
    input: CreateRevisionDocumentSnapshotInput,
  ): Promise<RevisionDocumentSnapshotRecord> {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id || revision.provenanceClassification !== 'CANONICAL') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Document Snapshot Revision does not belong to this Project.',
        400,
      );
    }
    if (revision.lifecycleState !== 'PREPARING') {
      throw new DomainError(
        'CONFLICT',
        'A Document Snapshot can be added only while its Revision is PREPARING.',
        409,
      );
    }
    const document = this.resolveDocument(project, input.sourceDocumentId, workspace);
    const root = workspace.folderPath;
    if (!root) {
      throw new DomainError('CONFLICT', 'The Project folder is not connected.', 409);
    }
    const sourcePath = await this.resolveAuthorizedSource(root, document.filePath);
    const kind = await artifactPathKind(sourcePath);
    if (kind === 'MISSING') {
      throw new DomainError('CONFLICT', 'The source Project Document file is missing.', 409);
    }
    if (kind !== 'FILE') {
      throw new DomainError('CONFLICT', 'The source Project Document is not a regular file.', 409);
    }
    const revisionLabel =
      revision.revisionLabel ?? `REV_${String(revision.revisionSequence).padStart(2, '0')}`;
    const fileName = snapshotFileName(
      path.basename(sourcePath) ||
        (document.filePath ? path.basename(document.filePath) : 'deliverable'),
    );
    // Deterministic Revision-owned snapshot location under DELIVERABLES/<revisionLabel>.
    const relativeDir = normalizeCanonicalProjectRelativePath(
      `DELIVERABLES/${revisionLabel}/${fileName}`,
    );
    const finalPath = resolveCanonicalArtifactPath(root, relativeDir);
    // M-1: same-basename policy — never silently rename. If this Revision already
    // owns a Document Snapshot whose effective filename collides with the incoming
    // one, reject explicitly BEFORE the expensive copy/hash work. The race-safe
    // no-overwrite move remains as a final backstop.
    const fileNameConflict = this.registry
      .listDocumentSnapshotsForRevision(revision.revisionId)
      .some((existing) => existing.fileName === fileName);
    if (fileNameConflict) {
      throw new DomainError(
        'CONFLICT',
        'A Deliverable with this filename already exists in this Revision.',
        409,
      );
    }
    const deliverableId = randomUUID();
    const { contentHash, sizeBytes } = await snapshotFileExclusive(
      sourcePath,
      finalPath,
      deliverableId,
    );
    // REV-01A — server-derived snapshot provenance: when the frozen bytes are
    // identical to a managed ArtifactVersion in the SAME project, the snapshot is
    // linked to that exact version UUID. The content-hash match is the binding
    // rule (snapshot.contentHash === version.contentHash); unmanaged/manual/
    // historical files with no matching version stay NULL.
    const sourceArtifactVersionId =
      this.managedArtifacts?.findArtifactVersionByContentHash(project.id, contentHash)?.versionId ??
      null;
    try {
      return this.registry.createDocumentSnapshot({
        projectId: project.id,
        revisionId: revision.revisionId,
        sourceDocumentId: document.id,
        category: document.category,
        title: input.title?.trim() || document.title,
        fileName,
        sourceRelativePath: this.relativePath(root, sourcePath),
        locatorValue: relativeDir,
        contentHash,
        sizeBytes,
        createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
        sourceArtifactVersionId,
      });
    } catch (error) {
      // Roll back the owned artifact so we never leave a DB row claiming a snapshot
      // that has no backing file.
      await rm(finalPath, { force: true });
      throw error;
    }
  }

  /**
   * PACKAGES-E2E-05A — project/revision-scoped read authority for Datasheet
   * intake. Lists every Datasheet AssetVersion of the project and classifies
   * each for the target Revision. Read-only: never recomputes/persists a hash
   * and never creates a snapshot.
   */
  public async listDatasheetEligibility(
    project: Project,
    revisionId: string,
  ): Promise<DatasheetEligibilityItem[]> {
    const revision = this.assertCanonicalRevisionTarget(project, revisionId, true);
    const versions = this.personalStore.listProjectDatasheetAssetVersions(project.id);
    const existing = new Set<string | null>(
      this.registry
        .listDocumentSnapshotsForRevision(revision.revisionId)
        .map((snapshot) => snapshot.sourceAssetVersionId),
    );
    const items: DatasheetEligibilityItem[] = [];
    for (const version of versions) {
      items.push(await this.evaluateDatasheet(project, version, existing));
    }
    // Deterministic order: luminaire tag then version sequence.
    items.sort((a, b) => a.tag.localeCompare(b.tag) || a.versionSequence - b.versionSequence);
    return items;
  }

  /**
   * PACKAGES-E2E-05A — canonical action to admit one selected Datasheet
   * AssetVersion into a PREPARING MANUAL_DELIVERABLES Revision as an immutable
   * Datasheet DocumentSnapshot. Server re-resolves EVERYTHING at mutation time
   * (never trusts a prior eligibility read) and enforces the hash/byte truth
   * sequence before persisting.
   */
  public async addDatasheetDeliverable(
    project: Project,
    revisionId: string,
    assetVersionId: string,
    actor: AppUser,
  ): Promise<RevisionDocumentSnapshotRecord> {
    return this.addDatasheetDeliverableWithRoot(project, revisionId, assetVersionId, actor, () => {
      const root = this.personalStore.getWorkspace(project.id).folderPath;
      if (!root) {
        throw new DomainError('CONFLICT', 'The Project folder is not connected.', 409);
      }
      return root;
    });
  }

  /** HTTP mutation boundary: consumes the exact root proven by ProjectStorageService. */
  public async addDatasheetDeliverableAtVerifiedRoot(
    project: Project,
    revisionId: string,
    assetVersionId: string,
    actor: AppUser,
    verifiedRoot: VerifiedProjectRoot,
  ): Promise<RevisionDocumentSnapshotRecord> {
    return this.addDatasheetDeliverableWithRoot(
      project,
      revisionId,
      assetVersionId,
      actor,
      () => verifiedRoot,
    );
  }

  private async addDatasheetDeliverableWithRoot(
    project: Project,
    revisionId: string,
    assetVersionId: string,
    actor: AppUser,
    resolveRoot: () => string,
  ): Promise<RevisionDocumentSnapshotRecord> {
    // REVISION GATE — canonical, PREPARING, MANUAL_DELIVERABLES, same project.
    const revision = this.assertCanonicalRevisionTarget(project, revisionId, true);
    // RESOLVE asset + ownership + asset type (all from persisted authority).
    const version = this.personalStore.getLuminaireAssetVersionById(project.id, assetVersionId);
    if (version.assetType !== 'Datasheet') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Only a Datasheet asset can be admitted as a Datasheet Deliverable.',
        400,
      );
    }
    // IMMUTABLE HASH / BYTE TRUTH — full sequence, no silent hash mutation.
    const persistedHash = version.fileHash;
    if (!persistedHash) {
      throw new DomainError(
        'CONFLICT',
        'This Datasheet Asset Version has no verified file hash (legacy unverified) and cannot be admitted.',
        409,
      );
    }
    const root = resolveRoot();
    // Source path comes ONLY from the persisted row (server-side), never the client.
    const sourcePath = version.filePath;
    const kind = await artifactPathKind(sourcePath);
    if (kind === 'MISSING') {
      throw new DomainError('CONFLICT', 'The source Datasheet file is missing.', 409);
    }
    if (kind !== 'FILE') {
      throw new DomainError('CONFLICT', 'The source Datasheet file is not a regular file.', 409);
    }
    const currentHash = await sha256File(sourcePath);
    if (currentHash !== persistedHash) {
      throw new DomainError(
        'CONFLICT',
        'The Datasheet source file changed after it was hashed and cannot be admitted.',
        409,
      );
    }
    // ALREADY-ADDED idempotency: v16 unique index guards the DB row; we also
    // check before copying so a retry never creates a duplicate artifact file.
    const revisionLabel =
      revision.revisionLabel ?? `REV_${String(revision.revisionSequence).padStart(2, '0')}`;
    const fileName = snapshotFileName(
      version.fileName || path.basename(sourcePath.replaceAll('\\', '/')) || 'deliverable',
    );
    // Keep the user-facing filename frozen from the AssetVersion, while using
    // the immutable AssetVersion identity for the owned locator. Two distinct
    // Luminaires may legitimately attach identical bytes under the same
    // basename; their canonical snapshot artifacts must not collide.
    const locatorFileName = `${assetVersionId.toLowerCase()}_${fileName}`;
    const relativeDir = normalizeCanonicalProjectRelativePath(
      `DELIVERABLES/${revisionLabel}/${locatorFileName}`,
    );
    const finalPath = resolveCanonicalArtifactPath(root, relativeDir);
    const alreadyAdded = this.registry
      .listDocumentSnapshotsForRevision(revision.revisionId)
      .some((snapshot) => snapshot.sourceAssetVersionId === assetVersionId);
    if (alreadyAdded) {
      throw new DomainError(
        'CONFLICT',
        'This Datasheet is already a Deliverable of this Revision.',
        409,
      );
    }
    const deliverableId = randomUUID();
    // Copy + re-hash the copied bytes (must equal persisted hash) before persist.
    const { contentHash, sizeBytes } = await snapshotFileExclusive(
      sourcePath,
      finalPath,
      deliverableId,
    );
    if (contentHash !== persistedHash) {
      await rm(finalPath, { force: true });
      throw new DomainError(
        'CONFLICT',
        'The Datasheet snapshot copy failed byte verification and was discarded.',
        409,
      );
    }
    const luminaire = this.personalStore.getLuminaireRecord(version.luminaireId, project.id);
    try {
      return this.registry.createDocumentSnapshot({
        projectId: project.id,
        revisionId: revision.revisionId,
        sourceAssetVersionId: assetVersionId,
        sourceDocumentId: null,
        sourceArtifactVersionId: null,
        category: 'Datasheet',
        title: `${luminaire.tag || 'Datasheet'} Datasheet`,
        fileName,
        sourceRelativePath: this.relativePath(root, sourcePath),
        locatorValue: relativeDir,
        contentHash,
        sizeBytes,
        createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
      });
    } catch (error) {
      await rm(finalPath, { force: true });
      throw error;
    }
  }

  /** Evaluates one Datasheet AssetVersion against a target Revision. */
  private async evaluateDatasheet(
    project: Project,
    version: LuminaireAssetVersion,
    existing: Set<string | null>,
  ): Promise<DatasheetEligibilityItem> {
    const luminaire = this.personalStore.getLuminaireRecord(version.luminaireId, project.id);
    const alreadyInRevision = existing.has(version.id);
    const base = {
      assetVersionId: version.id,
      luminaireId: version.luminaireId,
      tag: luminaire.tag,
      manufacturer: luminaire.manufacturer,
      model: luminaire.model,
      versionSequence: version.versionSequence,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      fileHash: version.fileHash,
      alreadyInRevision,
    };
    if (alreadyInRevision) {
      return {
        ...base,
        integrityStatus: 'ALREADY_ADDED',
        eligible: false,
        reason: 'This Datasheet is already a Deliverable of this Revision.',
      };
    }
    const status = await this.datasheetIntegrityStatus(version);
    return {
      ...base,
      integrityStatus: status,
      eligible: status === 'VERIFIED',
      reason: reasonForStatus(status),
    };
  }

  /** Classifies one Datasheet AssetVersion's physical integrity (read-only). */
  private async datasheetIntegrityStatus(
    version: LuminaireAssetVersion,
  ): Promise<DatasheetIntegrityStatus> {
    if (!version.fileHash) return 'LEGACY_UNVERIFIED';
    const kind = await artifactPathKind(version.filePath);
    if (kind === 'MISSING') return 'MISSING';
    if (kind !== 'FILE') return 'MISSING';
    try {
      const current = await sha256File(version.filePath);
      return current === version.fileHash ? 'VERIFIED' : 'HASH_MISMATCH';
    } catch {
      return 'MISSING';
    }
  }

  /**
   * Asserts the target Revision is canonical + same-project. When `requirePreparing`
   * is true it also requires PREPARING lifecycle. Returns the canonical record.
   */
  private assertCanonicalRevisionTarget(
    project: Project,
    revisionId: string,
    requirePreparing: boolean,
  ): CanonicalRevisionRecord {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id || revision.provenanceClassification !== 'CANONICAL') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Revision does not belong to this Project or is not canonical.',
        400,
      );
    }
    if (revision.projectSnapshot?.canonicalOperation !== 'MANUAL_DELIVERABLES') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Datasheet intake requires a MANUAL_DELIVERABLES Revision.',
        400,
      );
    }
    if (requirePreparing && revision.lifecycleState !== 'PREPARING') {
      throw new DomainError(
        'CONFLICT',
        'A Datasheet can be added only while its Revision is PREPARING.',
        409,
      );
    }
    return revision;
  }

  public async removeDocumentSnapshot(
    project: Project,
    revisionId: string,
    deliverableId: string,
  ): Promise<void> {
    const workspace = this.personalStore.getWorkspace(project.id);
    await this.removeDocumentSnapshotFromRoot(
      project,
      revisionId,
      deliverableId,
      workspace.folderPath,
    );
  }

  /** HTTP mutation boundary: never rediscovers the root after verification. */
  public async removeDocumentSnapshotAtVerifiedRoot(
    project: Project,
    revisionId: string,
    deliverableId: string,
    verifiedRoot: VerifiedProjectRoot,
  ): Promise<void> {
    await this.removeDocumentSnapshotFromRoot(project, revisionId, deliverableId, verifiedRoot);
  }

  private async removeDocumentSnapshotFromRoot(
    project: Project,
    revisionId: string,
    deliverableId: string,
    projectRoot: string | null,
  ): Promise<void> {
    const { locatorValue } = this.registry.removeDocumentSnapshotScoped(
      project.id,
      revisionId,
      deliverableId,
    );
    const owned = projectRoot ? resolveCanonicalArtifactPath(projectRoot, locatorValue) : null;
    if (owned) await rm(owned, { force: true });
  }

  public async finalizeRevision(
    project: Project,
    revisionId: string,
  ): Promise<CanonicalRevisionRecord> {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Revision does not belong to this Project.',
        400,
      );
    }
    if (revision.lifecycleState !== 'PREPARING') {
      throw new DomainError('CONFLICT', 'Only a PREPARING Revision can be finalized.', 409);
    }
    const outputs = this.registry.listOutputsForRevision(revisionId);
    const snapshots = this.registry.listDocumentSnapshotsForRevision(revisionId);
    const finalizedOutputs = outputs.filter((output) => output.lifecycleState === 'FINALIZED');
    if (finalizedOutputs.length === 0 && snapshots.length === 0) {
      throw new DomainError(
        'CONFLICT',
        'A Revision cannot finalize with zero Deliverables. Add a generated Output or an immutable Document Snapshot first.',
        409,
      );
    }
    const workspace = this.personalStore.getWorkspace(project.id);
    const projectRoot = workspace.folderPath ?? null;
    for (const snapshot of snapshots) {
      const presence = await resolveCanonicalArtifactPresence(projectRoot, {
        locatorKind: snapshot.locatorKind,
        locatorValue: snapshot.locatorValue,
      });
      if (presence.presence !== 'Present') {
        throw new DomainError(
          'CONFLICT',
          `A Document Snapshot artifact is ${presence.presence.toLowerCase()}. Resolve it before finalizing.`,
          409,
        );
      }
    }
    // F-1 — symmetric physical-presence authority for attached canonical
    // GeneratedOutput Deliverables. A composed Revision may carry both source
    // types, so a DB lifecycle alone is not proof that the deliverable exists.
    // This gate applies ONLY to the PREPARING -> FINALIZED attempt: a
    // historically FINALIZED Revision whose file later disappears stays
    // FINALIZED and reports Missing/Unavailable through the read authority.
    if (revision.projectSnapshot?.canonicalOperation === 'MANUAL_DELIVERABLES') {
      for (const output of outputs) {
        if (output.provenanceClassification !== 'CANONICAL') continue;
        if (output.lifecycleState !== 'FINALIZED') {
          throw new DomainError(
            'CONFLICT',
            'A generated Output Deliverable on this Revision is not finalized. Resolve it before finalizing.',
            409,
          );
        }
        const presence = await resolveCanonicalArtifactPresence(projectRoot, output);
        if (presence.presence !== 'Present') {
          throw new DomainError(
            'CONFLICT',
            `A generated Output Deliverable artifact is ${presence.presence.toLowerCase()}. Resolve it before finalizing.`,
            409,
          );
        }
      }
    }
    // REV-01B — the finalization boundary is now atomic with the ManagedArtifact
    // freeze: the Revision lifecycle flip and the freeze of every artifact
    // whose ArtifactVersion is referenced by this Revision's immutable
    // Document Snapshots commit together (shared SQLite handle). A throwing
    // freeze rolls the whole boundary back, so a FINALIZED Revision is never
    // observable with a still-ACTIVE referenced artifact. When the legacy
    // constructor is used (no ManagedArtifactStore), the boundary degrades to
    // the exact pre-REV-01B finalization behavior.
    if (this.managedArtifacts) {
      return this.registry.finalizeRevisionWithArtifactFreeze(revisionId, (id, finalizedAt) => {
        for (const artifactId of this.managedArtifacts!.listArtifactsReferencedByRevision(id)) {
          this.managedArtifacts!.freezeManagedArtifact(artifactId, finalizedAt);
        }
      });
    }
    return this.registry.setRevisionLifecycle(revisionId, 'FINALIZED');
  }

  /**
   * C0 — Resume Revision.
   *
   * A narrow repair mutation for an already-damaged composed design draft:
   * FAILED_RECOVERABLE -> PREPARING for a CANONICAL MANUAL_DELIVERABLES Revision
   * of THIS Project.
   */
  public async resumeRevision(
    project: Project,
    revisionId: string,
  ): Promise<CanonicalRevisionRecord> {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id || revision.provenanceClassification !== 'CANONICAL') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Revision does not belong to this Project.',
        400,
      );
    }
    if (revision.projectSnapshot?.canonicalOperation !== 'MANUAL_DELIVERABLES') {
      throw new DomainError(
        'CONFLICT',
        'Only a manual Deliverables Revision can be resumed. Generated Revisions keep their own identity-preserving retry.',
        409,
      );
    }
    if (revision.lifecycleState !== 'FAILED_RECOVERABLE') {
      throw new DomainError(
        'CONFLICT',
        'Only a failed recoverable manual Deliverables Revision can be resumed.',
        409,
      );
    }
    const projectRoot = this.personalStore.getWorkspace(project.id).folderPath ?? null;
    const plan = await this.proveIncompleteReservations(projectRoot, revision.revisionId);
    this.registry.setRevisionLifecycle(revision.revisionId, 'PREPARING');
    for (const { output, proof } of plan) {
      if (proof.kind === 'PROVEN_FINAL') {
        finalizeProvenCanonicalOutputReservation(this.registry, output);
        continue;
      }
      await discardCanonicalOutputReservation(this.registry, output, proof);
    }
    return this.registry.getRevision(revision.revisionId);
  }

  private async proveIncompleteReservations(
    projectRoot: string | null,
    revisionId: string,
  ): Promise<ResolvedReservationPlanItem[]> {
    const plan: ResolvedReservationPlanItem[] = [];
    for (const output of this.registry.listOutputsForRevision(revisionId)) {
      if (output.provenanceClassification !== 'CANONICAL') continue;
      if (!isUnprovenOutputReservationLifecycle(output.lifecycleState)) continue;
      const proof = await proveCanonicalOutputReservation(projectRoot, output);
      if (proof.kind === 'UNPROVABLE') {
        throw new DomainError(
          'CONFLICT',
          'An incomplete generated Output on this Revision cannot be resolved while the Project folder or its artifact locator is unavailable.',
          409,
        );
      }
      plan.push({ output, proof });
    }
    return plan;
  }

  public async resolveDocumentSnapshotForOpen(
    project: Project,
    revisionId: string,
    deliverableId: string,
    root: VerifiedProjectRoot,
  ) {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id)
      throw new DomainError('NOT_FOUND', 'Revision not found in this project.', 404);
    const snapshot = this.registry
      .listDocumentSnapshotsForRevision(revisionId)
      .find((item) => item.deliverableId === deliverableId && item.projectId === project.id);
    if (!snapshot || snapshot.locatorKind !== 'PROJECT_RELATIVE' || !snapshot.locatorValue)
      throw new DomainError('NOT_FOUND', 'Snapshot not found in this Revision.', 404);
    const file = await readVerifiedCanonicalArtifact(
      root,
      snapshot.locatorValue,
      snapshot.contentHash,
    );
    return { ...file, snapshot };
  }

  public async listRevisionDeliverables(
    project: Project,
    revisionId: string,
  ): Promise<RevisionDeliverable[]> {
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== project.id) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Revision does not belong to this Project.',
        400,
      );
    }
    const projectRoot = this.personalStore.getWorkspace(project.id).folderPath ?? null;
    const outputs = this.registry.listOutputsForRevision(revisionId);
    const snapshots = this.registry.listDocumentSnapshotsForRevision(revisionId);
    const deliverables: RevisionDeliverable[] = [];
    for (const output of outputs) {
      const presence = await resolveCanonicalArtifactPresence(projectRoot, {
        locatorKind: output.locatorKind,
        locatorValue: output.locatorValue,
      });
      deliverables.push({
        sourceType: 'GeneratedOutput',
        deliverableId: output.outputId,
        sourceId: output.outputId,
        projectId: output.projectId,
        revisionId: output.revisionId ?? revisionId,
        title: outputFamilyTitle(output),
        category: outputFamilyCategory(output),
        fileName: output.locatorValue ? path.basename(output.locatorValue) : null,
        format: output.outputFormat,
        outputFamily: output.outputFamily,
        contentHash: output.contentHash,
        sizeBytes: null,
        lifecycleState: output.lifecycleState,
        presence: presence.presence,
      });
    }
    for (const snapshot of snapshots) {
      const presence = await resolveCanonicalArtifactPresence(projectRoot, {
        locatorKind: snapshot.locatorKind,
        locatorValue: snapshot.locatorValue,
      });
      deliverables.push({
        sourceType: 'DocumentSnapshot',
        deliverableId: snapshot.deliverableId,
        sourceId: documentSnapshotSourceId(snapshot),
        projectId: snapshot.projectId,
        revisionId: snapshot.revisionId,
        title: snapshot.title,
        category: snapshot.category,
        fileName: snapshot.fileName,
        format: null,
        outputFamily: null,
        contentHash: snapshot.contentHash,
        sizeBytes: snapshot.sizeBytes,
        lifecycleState: null,
        presence: presence.presence,
      });
    }
    deliverables.sort(
      (left, right) =>
        Number(right.presence === 'Present') - Number(left.presence === 'Present') ||
        left.sourceType.localeCompare(right.sourceType),
    );
    return deliverables;
  }

  /**
   * PACKAGES-E2E-02 — resolve the authorized source for a persisted ProjectDocument.
   *
   * The path always comes from the persisted ProjectDocument row (server-side),
   * never from the request. Two source shapes are authorized:
   *
   *  - project-relative: resolved under the project root WITH full containment
   *    enforcement (traversal and intermediate-link escapes are rejected);
   *  - absolute external (e.g. OneDrive outside the project root): used verbatim,
   *    NEVER rebased under the project root. This is legitimate because the path
   *    is a persisted same-project registration, not an arbitrary client path.
   *
   * The resulting source is READ-ONLY; the snapshot copy lands in canonical
   * project-controlled storage.
   */
  private async resolveAuthorizedSource(root: string, documentFilePath: string): Promise<string> {
    if (!documentFilePath || !documentFilePath.trim()) {
      throw new DomainError(
        'CONFLICT',
        'The source Project Document has no registered file path.',
        409,
      );
    }
    const normalized = documentFilePath.replaceAll('\\', '/');
    // Absolute external path (drive-letter or UNC or POSIX-absolute): use verbatim.
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
      return path.normalize(normalized);
    }
    // Project-relative source: resolve under projectRoot and enforce containment.
    const lexical = resolveCanonicalArtifactPath(root, normalized);
    // H-1: an intermediate Windows junction/reparse point (or any symlinked
    // intermediate) can resolve OUTSIDE the project root even when the lexical
    // path is contained. The final lstat already rejects a trailing symlink, but
    // an intermediate reparse would escape it. Compare REAL filesystem paths so
    // a source whose physical target leaves the project root is never trusted.
    // Windows case-insensitivity is handled by realpath casing of the real root.
    const realRoot = await realpath(root);
    let realTarget: string;
    try {
      realTarget = await realpath(lexical);
    } catch {
      // realpath fails for a missing target; let artifactPathKind report MISSING.
      return lexical;
    }
    const realRelative = path.relative(realRoot, realTarget);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new DomainError(
        'CONFLICT',
        'The source Project Document file resolves outside the Project folder through an intermediate link.',
        409,
      );
    }
    return lexical;
  }

  private relativePath(projectPath: string | null, sourcePath: string): string {
    if (!projectPath) return path.basename(sourcePath);
    const relative = path.relative(projectPath, sourcePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return path.basename(sourcePath);
    }
    return relative.replaceAll('\\', '/');
  }

  private resolveDocument(project: Project, documentId: string, workspace: ProjectWorkspace) {
    const document = workspace.documents.find((candidate) => candidate.id === documentId);
    if (!document) {
      throw new DomainError('NOT_FOUND', 'Project Document not found.', 404);
    }
    if (document.projectId !== project.id) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The Project Document does not belong to this Project.',
        400,
      );
    }
    return document;
  }
}

export function luminaireSnapshotList(workspace: ProjectWorkspace) {
  return workspace.luminaires.map((luminaire) => ({
    luminaireId: luminaire.id,
    tag: luminaire.tag,
    category: luminaire.category,
    imagePath: luminaire.imagePath,
    description: luminaire.description,
    manufacturer: luminaire.manufacturer,
    model: luminaire.model,
    wattage: luminaire.wattage,
    lumens: luminaire.lumens,
    lightColor: luminaire.lightColor,
    cri: luminaire.cri,
    beamAngle: luminaire.beamAngle,
    ipRating: luminaire.ipRating,
    mounting: luminaire.mounting,
    cutout: luminaire.cutout,
    driver: luminaire.driver,
    control: luminaire.control,
    emergency: luminaire.emergency,
    datasheetPath: luminaire.datasheetPath,
    location: luminaire.location,
    unit: luminaire.unit,
    quantity: luminaire.quantity,
    notes: luminaire.notes,
    sourceName: luminaire.sourceName,
    dimensions: luminaire.dimensions,
    bodyColorFinish: luminaire.bodyColorFinish,
    attachmentReferences: [
      ...new Set([luminaire.imagePath, luminaire.datasheetPath].filter(Boolean)),
    ],
  }));
}

export function projectSnapshotForManual(
  project: Project,
  workspace: ProjectWorkspace,
): CanonicalProjectSnapshotInput {
  return {
    id: project.id,
    projectCode: project.projectCode,
    projectName: project.projectName,
    clientName: project.clientName,
    projectType: project.projectType,
    status: project.status,
    updatedAt: project.updatedAt,
    siteLocation: project.siteLocation,
    designStage: project.designStage,
    description: project.description,
    canonicalOperation: 'MANUAL_DELIVERABLES',
    folderProfile: workspace.folderProfile,
    lightingPackage: structuredClone(workspace.lightingPackage),
    outputFolders: structuredClone(workspace.outputFolders),
  };
}

function snapshotFileName(value: string): string {
  const printable = [...value]
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127 ? '_' : character;
    })
    .join('');
  return printable.replace(/[<>:"/\\|?*]/g, '_').trim() || 'deliverable';
}

function outputFamilyLabel(output: CanonicalOutputRecord): string {
  if (output.outputFamily === 'LuminaireSchedule') return 'Luminaire Schedule';
  if (output.outputFamily === 'TechnicalBoq') return 'Technical BOQ';
  if (output.outputFamily === 'PresentationSchedule') return 'Presentation Schedule';
  return 'Canonical Output';
}

function outputFamilyTitle(output: CanonicalOutputRecord): string {
  return output.outputFormat === 'PDF'
    ? `${outputFamilyLabel(output)} PDF`
    : `${outputFamilyLabel(output)} ${output.outputFormat}`;
}

function outputFamilyCategory(output: CanonicalOutputRecord): string {
  return outputFamilyLabel(output);
}

function reasonForStatus(status: DatasheetIntegrityStatus): string {
  switch (status) {
    case 'VERIFIED':
      return 'Verified and available to add to this Revision.';
    case 'MISSING':
      return 'The source Datasheet file is missing or unreadable.';
    case 'HASH_MISMATCH':
      return 'The source Datasheet changed after it was hashed and cannot be admitted.';
    case 'LEGACY_UNVERIFIED':
      return 'This Datasheet has no verified file hash (legacy) and cannot be admitted.';
    case 'ALREADY_ADDED':
      return 'This Datasheet is already a Deliverable of this Revision.';
  }
}
