import type {
  OutputFamily,
  OutputTemplateOverride,
  ResolvedOutputTemplate,
  TemplateOrigin,
  TemplateState,
} from './output-templates';
import type { ScheduleArtifactPresence } from './luminaire-schedule-output';

/** Durable lifecycle values reserved for P2-FND-05 prepare/finalize/recovery orchestration. */
export const outputRegistryLifecycleStates = [
  'PREPARING',
  'FINALIZED',
  'FAILED_RECOVERABLE',
  'LEGACY_IMPORTED',
] as const;
export type OutputRegistryLifecycleState = (typeof outputRegistryLifecycleStates)[number];

/** Provenance is explicit; legacy links are never upgraded by inference. */
export const outputRegistryProvenanceClassifications = [
  'CANONICAL',
  'LEGACY_VERIFIED',
  'LEGACY_UNVERIFIED',
] as const;
export type OutputRegistryProvenanceClassification =
  (typeof outputRegistryProvenanceClassifications)[number];

export const artifactLocatorKinds = [
  'PROJECT_RELATIVE',
  'LEGACY_ABSOLUTE',
  'LEGACY_UNKNOWN',
] as const;
export type ArtifactLocatorKind = (typeof artifactLocatorKinds)[number];

export interface OutputTemplateRecord {
  templateId: string;
  family: OutputFamily;
  origin: TemplateOrigin;
  state: TemplateState;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutputTemplateVersionRecord {
  templateId: string;
  versionId: string;
  definition: ResolvedOutputTemplate;
  definitionHash: string;
  createdAt: string;
  createdBy: string;
}

export interface OutputTemplateSelectionRecord {
  projectId: string | null;
  outputFamily: OutputFamily;
  templateId: string;
  versionId: string;
  config: OutputTemplateOverride;
  updatedAt: string;
}

export interface CanonicalLuminaireSnapshot {
  /** Stable historical entity identity. Tag is descriptive state at snapshot time. */
  luminaireId: string;
  tag: string;
  category: string;
  imagePath: string;
  description: string;
  manufacturer: string;
  model: string;
  productType?: string | undefined;
  variantLabel?: string | undefined;
  orderingCode?: string | undefined;
  wattage: string;
  lumens: string;
  lightColor: string;
  cri: string;
  beamAngle: string;
  ipRating: string;
  mounting: string;
  cutout: string;
  driver: string;
  control: string;
  emergency: string;
  datasheetPath: string;
  location: string;
  unit: string;
  quantity: number;
  notes: string;
  sourceName: string;
  dimensions: string;
  bodyColorFinish: string;
  attachmentReferences: string[];
}

export interface CanonicalRevisionRecord {
  revisionId: string;
  projectId: string;
  revisionSequence: number;
  revisionLabel: string;
  /** Concise canonical business/design context; nullable for historical records. */
  purpose: string | null;
  /** Revision-workspace-only multiline working information. */
  internalNote: string | null;
  lifecycleState: OutputRegistryLifecycleState;
  projectSnapshot: Record<string, unknown> | null;
  luminaireSnapshot: CanonicalLuminaireSnapshot[] | null;
  snapshotHash: string | null;
  createdById: string | null;
  createdByName: string | null;
  provenanceClassification: OutputRegistryProvenanceClassification;
  legacySourceId: string | null;
  failureReason: string | null;
  createdAt: string;
  finalizedAt: string | null;
  updatedAt: string;
}

/**
 * Package-only Revision read projection. It deliberately excludes Revision
 * workspace metadata and snapshots that the Package surface does not need.
 */
export interface PackageRevisionSummary {
  revisionId: string;
  revisionSequence: number;
  revisionLabel: string;
  purpose: string | null;
  lifecycleState: OutputRegistryLifecycleState;
  finalizedAt: string | null;
  luminaireCount: number;
}

export interface CanonicalOutputRecord {
  outputId: string;
  projectId: string;
  revisionId: string | null;
  outputFamily: OutputFamily | null;
  outputFormat: string;
  locatorKind: ArtifactLocatorKind;
  locatorValue: string | null;
  legacyAbsolutePath: string | null;
  contentHash: string | null;
  templateId: string | null;
  templateVersionId: string | null;
  resolvedTemplateSnapshot: ResolvedOutputTemplate | null;
  resolvedTemplateSnapshotHash: string | null;
  lifecycleState: OutputRegistryLifecycleState;
  provenanceClassification: OutputRegistryProvenanceClassification;
  legacySourceId: string | null;
  legacySourceField: string | null;
  templateProvenance: 'RESOLVED' | 'LEGACY_UNKNOWN';
  failureReason: string | null;
  createdAt: string;
  finalizedAt: string | null;
  updatedAt: string;
}

/**
 * Read-projection output record returned by the Revisions & Outputs owning
 * read API. Extends the canonical output with AUTHORITATIVE physical-artifact
 * presence derived from the filesystem (never locator-only inference).
 */
export interface CanonicalOutputPresenceRecord extends CanonicalOutputRecord {
  /** Physical artifact truth: Present/Missing/Unavailable. */
  artifactPresence: ScheduleArtifactPresence;
  /**
   * Safe project-scoped open path. Present ONLY when artifactPresence ===
   * 'Present'; otherwise null. Never exposes unsafe raw filesystem internals.
   */
  artifactOpenPath: string | null;
}

export interface CanonicalIssuePackageRecord {
  packageId: string;
  projectId: string;
  revisionId: string | null;
  packageSequence: number | null;
  label: string;
  artifactLocatorKind: ArtifactLocatorKind;
  artifactLocatorValue: string | null;
  legacyAbsolutePath: string | null;
  manifestLocatorKind: ArtifactLocatorKind | null;
  manifestLocatorValue: string | null;
  lifecycleState: OutputRegistryLifecycleState;
  provenanceClassification: OutputRegistryProvenanceClassification;
  legacySourceId: string | null;
  failureReason: string | null;
  /**
   * Immutable Issue audit authority (V4-ISSUE-A0). Null for Draft packages and for
   * pre-migration/legacy rows whose Issue event is unknown. Never inferred from
   * createdAt/finalizedAt and never rewritten by recovery.
   */
  issuedById: string | null;
  issuedByName: string | null;
  issuedAt: string | null;
  createdAt: string;
  finalizedAt: string | null;
  updatedAt: string;
}

export interface CanonicalPackageOutputRecord {
  packageId: string;
  outputId: string;
  revisionId: string;
  position: number;
  provenanceClassification: OutputRegistryProvenanceClassification;
  createdAt: string;
}

/**
 * B2 — generic immutable Issue Package deliverable membership.
 *
 * A Package member is an immutable Revision Deliverable of exactly one supported
 * source type: a canonical Generated Output or an immutable Document Snapshot.
 * Mutable Project Documents are NEVER package members (the snapshot copy is the
 * historical authority). A package's members all belong to the package's single
 * canonical Revision — cross-revision membership is invalid.
 */
export const packageDeliverableSourceTypes = ['GeneratedOutput', 'DocumentSnapshot'] as const;
export type PackageDeliverableSourceType = (typeof packageDeliverableSourceTypes)[number];

/** Persisted generic package membership row (v14 authority). */
export interface RevisionPackageDeliverableRecord {
  packageId: string;
  sourceType: PackageDeliverableSourceType;
  /** outputId for GeneratedOutput; snapshot deliverableId for DocumentSnapshot. */
  sourceId: string;
  revisionId: string;
  position: number;
  provenanceClassification: OutputRegistryProvenanceClassification;
  createdAt: string;
}

/**
 * REV-02A — canonical Issue History read model.
 *
 * A read-only projection over the canonical package authorities
 * (canonical_issue_packages -> revision_package_deliverables ->
 * revision_document_snapshots / canonical_outputs). It is never persisted and
 * never written; the UI consumes it to answer "what was issued, when, by whom,
 * from which Revision, with which Deliverables".
 */
export type IssueHistoryDeliverable =
  | {
      sourceType: 'DocumentSnapshot';
      deliverableId: string;
      title: string;
      contentHash: string;
      sizeBytes: number;
      locator: string;
      /** AUTO-01A (AUTO-D02) immutable ArtifactVersion provenance; null when unmanaged. */
      sourceArtifactVersionId: string | null;
    }
  | {
      sourceType: 'GeneratedOutput';
      outputId: string;
      contentHash: string;
      templateId: string | null;
      templateVersionId: string | null;
      resolvedTemplateSnapshotHash: string | null;
    };

export interface IssueHistoryRecord {
  package: {
    packageId: string;
    packageSequence: number;
    label: string;
    lifecycleState: OutputRegistryLifecycleState;
    /** Derived from issuedAt: 'Issued' when an Issue event exists, else 'Draft'. */
    businessStatus: 'Draft' | 'Issued';
    createdAt: string;
    finalizedAt: string | null;
    issuedAt: string | null;
    issuedBy: { actorId: string; actorNameSnapshot: string } | null;
  };
  revision: {
    revisionId: string;
    revisionSequence: number;
    revisionLabel: string;
    /** Context only; Internal Note is deliberately excluded from this projection. */
    purpose: string | null;
  };
  deliverables: IssueHistoryDeliverable[];
}

/** REV-02A2 — on-demand package reproducibility verification result vocabulary. */
export const packageVerificationStatuses = [
  'VERIFIED',
  'MISSING',
  'UNAVAILABLE',
  'MISMATCH',
] as const;
export type PackageVerificationStatus = (typeof packageVerificationStatuses)[number];

/**
 * Per-deliverable reproducibility result (REV-02A2).
 *
 * `sourceId` is the canonical deliverable identity: outputId for
 * GeneratedOutput; deliverableId for DocumentSnapshot. `status` is the worst of
 * the stored canonical artifact and the packaged copy checks. `expectedHash` is
 * the immutable SHA-256 authority; `actualHash` is present when bytes were read.
 * `reason` is a bounded, human-meaningful explanation when not VERIFIED.
 */
export interface DeliverableVerificationResult {
  sourceType: PackageDeliverableSourceType;
  sourceId: string;
  status: PackageVerificationStatus;
  expectedHash: string | null;
  actualHash?: string;
  reason?: string;
}

/** REV-02A2 — package-level + per-deliverable on-demand verification result. */
export interface PackageVerificationResult {
  packageId: string;
  status: PackageVerificationStatus;
  checkedAt: string;
  deliverables: DeliverableVerificationResult[];
}
