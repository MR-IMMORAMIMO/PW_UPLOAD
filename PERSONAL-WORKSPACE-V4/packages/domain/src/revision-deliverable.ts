import type { ScheduleArtifactPresence } from './luminaire-schedule-output';
import type { ArtifactLocatorKind, OutputRegistryLifecycleState } from './output-registry';
import type { OutputFamily } from './output-templates';

/**
 * B0 — Revision Deliverable Foundation.
 *
 * A Project Revision is a broad immutable design/issue milestone. Its deliverables
 * are either:
 *
 *  A. a canonical Generated Output (Luminaire Schedule / Technical BOQ /
 *     PresentationSchedule) — projected live from `canonical_outputs`; never
 *     duplicated into a second persistence row; and
 *  B. an immutable Document Snapshot — a durable copy of a registered
 *     project document/file, with its own stable UUID, its own copied artifact,
 *     and SHA-256 content identity.
 */
export const revisionDeliverableSourceTypes = ['GeneratedOutput', 'DocumentSnapshot'] as const;
export type RevisionDeliverableSourceType = (typeof revisionDeliverableSourceTypes)[number];

/**
 * Structured primary-source discriminator for an immutable Revision Document
 * Snapshot (PACKAGES-E2E-05F). A snapshot is sourced from exactly ONE of:
 *
 *   - 'ProjectDocument':        the mutable operational project_documents UUID;
 *   - 'LuminaireAssetVersion':  an immutable luminaire_asset_versions UUID.
 *
 * Downstream code MUST branch on `sourceType` to access the correct source id;
 * it must never guess the source from title/category/fileName.
 */
export type DocumentSnapshotSourceType = 'ProjectDocument' | 'LuminaireAssetVersion';

/**
 * Immutable Document Snapshot deliverable bound to one canonical Revision.
 *
 * The snapshot is a durable, self-contained copy of a mutable operational
 * Project Document or Luminaire asset at attach time. It must never be a bare
 * pointer to the mutable source: replacing/renaming/deleting the source must
 * not change the snapshot. `contentHash` is the SHA-256 of the snapshot file
 * bytes and is immutable. `locatorValue` is a deterministic project-relative
 * artifact path.
 *
 * The primary source is a discriminated union: every record carries exactly one
 * of `sourceDocumentId` / `sourceAssetVersionId` and the other is null. Luminaire
 * identity is DERIVED structurally (sourceAssetVersionId ->
 * luminaire_asset_versions.luminaire_id -> project_luminaires.id); there is no
 * duplicated source_luminaire_id.
 */
export type RevisionDocumentSnapshotRecord = RevisionDocumentSnapshotRecordBase &
  (
    | {
        sourceType: 'ProjectDocument';
        sourceDocumentId: string;
        sourceAssetVersionId: null;
      }
    | {
        sourceType: 'LuminaireAssetVersion';
        sourceDocumentId: null;
        sourceAssetVersionId: string;
      }
  );

interface RevisionDocumentSnapshotRecordBase {
  deliverableId: string;
  projectId: string;
  revisionId: string;
  /** Reused existing document-category authority (Drawing, LuxReport, Visualization, ...). */
  category: string;
  title: string;
  fileName: string;
  /** Project-relative source path snapshot (informational provenance). */
  sourceRelativePath: string;
  locatorKind: ArtifactLocatorKind;
  /** Deterministic project-relative snapshot artifact path. */
  locatorValue: string;
  contentHash: string;
  sizeBytes: number;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  /**
   * AUTO-01A (AUTO-D02) — optional immutable provenance link to the exact
   * ArtifactVersion UUID from which this snapshot was created. It is the
   * REV-01A ManagedArtifact provenance authority and is NOT a replacement for
   * `sourceAssetVersionId`. For LuminaireAssetVersion-sourced snapshots it is
   * normally null (no invented ManagedArtifact relationship).
   */
  sourceArtifactVersionId: string | null;
}

/**
 * The single effective primary-source UUID for a Revision Document Snapshot,
 * regardless of which source authority (ProjectDocument or LuminaireAssetVersion)
 * produced it. A well-formed record (the DB XOR invariant guarantees exactly one
 * source) always has a non-null source id.
 */
export function documentSnapshotSourceId(snapshot: RevisionDocumentSnapshotRecord): string {
  return snapshot.sourceType === 'ProjectDocument'
    ? snapshot.sourceDocumentId
    : snapshot.sourceAssetVersionId;
}

/**
 * Unified Revision Deliverable read model.
 *
 * Exposes both generated outputs and immutable document snapshots behind one
 * shape so later UI / package code cannot confuse the two sources. `sourceType`
 * is always present and truthful.
 */
export interface RevisionDeliverable {
  sourceType: RevisionDeliverableSourceType;
  /** Stable deliverable identity: outputId for GeneratedOutput; deliverableId for DocumentSnapshot. */
  deliverableId: string;
  /** Source identity: outputId for GeneratedOutput; sourceDocumentId for DocumentSnapshot. */
  sourceId: string;
  projectId: string;
  revisionId: string;
  title: string | null;
  /** Document category (DocumentSnapshot) or canonical family label (GeneratedOutput). */
  category: string | null;
  fileName: string | null;
  /** output format (XLSX/PDF) or file extension-derived label. */
  format: string | null;
  outputFamily: OutputFamily | null;
  contentHash: string | null;
  sizeBytes: number | null;
  lifecycleState: OutputRegistryLifecycleState | null;
  presence: ScheduleArtifactPresence;
}

/**
 * PACKAGES-E2E-05A — integrity classification for a Luminaire Datasheet
 * AssetVersion under review for intake into a canonical Revision.
 *
 * - VERIFIED:         file_hash present, source file present, and current bytes
 *                     hash exactly match the persisted hash.
 * - MISSING:          the persisted source file is absent (or not a regular
 *         readable file).
 * - HASH_MISMATCH:    the current source bytes do NOT hash to the persisted
 *         file_hash (file changed after attach).
 * - LEGACY_UNVERIFIED: the AssetVersion has a NULL file_hash (pre-hash attach).
 * - ALREADY_ADDED:    this exact assetVersion is already a DocumentSnapshot of
 *         the target Revision.
 */
export const datasheetIntegrityStatuses = [
  'VERIFIED',
  'MISSING',
  'HASH_MISMATCH',
  'LEGACY_UNVERIFIED',
  'ALREADY_ADDED',
] as const;
export type DatasheetIntegrityStatus = (typeof datasheetIntegrityStatuses)[number];

/**
 * PACKAGES-E2E-05A — read-model item for Datasheet intake eligibility. The
 * server derives every field structurally from the persisted LuminaireAssetVersion
 * and its Luminaire lineage; no filesystem path is exposed (no client path
 * authority). `eligible` is the conjunction of the integrity status and the
 * target Revision being a canonical PREPARING MANUAL_DELIVERABLES Revision.
 */
export interface DatasheetEligibilityItem {
  assetVersionId: string;
  luminaireId: string;
  tag: string;
  manufacturer: string;
  model: string;
  versionSequence: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  fileHash: string | null;
  integrityStatus: DatasheetIntegrityStatus;
  alreadyInRevision: boolean;
  eligible: boolean;
  reason: string;
}
