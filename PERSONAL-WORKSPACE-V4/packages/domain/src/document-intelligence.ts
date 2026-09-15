export const documentStorageModes = ['DOCUMENT_STORE', 'MANAGED_ARTIFACT_VERSION'] as const;
export type DocumentStorageMode = (typeof documentStorageModes)[number];

export const documentSourceStates = ['STAGING', 'AVAILABLE', 'MISSING'] as const;
export type DocumentSourceState = (typeof documentSourceStates)[number];

export const documentLifecycles = [
  'ADMITTED',
  'NEEDS_REVIEW',
  'ACCEPTED',
  'SUPERSEDED',
  'EXCLUDED',
  'TOMBSTONED',
] as const;
export type DocumentLifecycle = (typeof documentLifecycles)[number];

export const documentProcessingStates = [
  'QUEUED',
  'VALIDATING',
  'NATIVE_EXTRACTION',
  'OCR',
  'CLASSIFICATION',
  'ASSOCIATION',
  'STRUCTURED_EXTRACTION',
  'RELATIONSHIPS',
  'QUALITY',
  'COMPLETE',
  'INCOMPLETE',
  'FAILED_RETRYABLE',
  'CANCELLED',
  'INTERRUPTED',
] as const;
export type DocumentProcessingState = (typeof documentProcessingStates)[number];

export const documentClassifications = [
  'DIALUX_CALCULATION_REPORT',
  'LIGHTING_LAYOUT',
  'LUMINAIRE_SCHEDULE',
  'BOQ_QTO',
  'PRODUCT_DATASHEET',
  'TECHNICAL_SUBMITTAL',
  'CLIENT_COMMENT_MARKUP',
  'REFERENCE_DOCUMENT',
  'MEETING_DOCUMENT',
  'COMMERCIAL_RECEIPT',
  'REVISION_REGISTER',
  'TRANSMITTAL',
  'COVER_SHEET',
  'VISUALIZATION_RENDERING',
  'UNKNOWN',
] as const;
export type DocumentClassification = (typeof documentClassifications)[number];

export const projectAssociationStates = [
  'CONFIRMED',
  'LIKELY',
  'AMBIGUOUS',
  'CONFLICTING',
  'UNRESOLVED',
] as const;
export type ProjectAssociationState = (typeof projectAssociationStates)[number];
export const evidenceStrengths = ['STRONG', 'MEDIUM', 'WEAK'] as const;
export type EvidenceStrength = (typeof evidenceStrengths)[number];

export const documentRelationshipTypes = [
  'EXACT_DUPLICATE',
  'POSSIBLE_REVISION',
  'RELATED_DOCUMENT',
  'UNRELATED',
  'AMBIGUOUS_RELATIONSHIP',
] as const;
export type DocumentRelationshipType = (typeof documentRelationshipTypes)[number];
export const documentRelationshipStates = [
  'PROPOSED',
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type DocumentRelationshipState = (typeof documentRelationshipStates)[number];

export const documentFindingSeverities = ['INFO', 'WARNING', 'BLOCKING'] as const;
export type DocumentFindingSeverity = (typeof documentFindingSeverities)[number];
export const documentFindingStates = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'DISMISSED_WITH_REASON',
  'SUPERSEDED',
] as const;
export type DocumentFindingState = (typeof documentFindingStates)[number];

export const documentFindingCodes = [
  'PDF_SIGNATURE_MISMATCH',
  'DOCUMENT_TOO_LARGE',
  'PAGE_LIMIT_REACHED',
  'PARSER_FAILED',
  'OCR_REQUIRED',
  'OCR_LOW_CONFIDENCE',
  'OCR_LIMIT_REACHED',
  'NATIVE_TEXT_UNREADABLE',
  'EXTRACTION_INCOMPLETE',
  'PROJECT_ASSOCIATION_AMBIGUOUS',
  'PROJECT_ASSOCIATION_CONFLICT',
  'EXACT_DUPLICATE_DOCUMENT',
  'POSSIBLE_DOCUMENT_REVISION',
  'UNSUPPORTED_DOCUMENT_TYPE',
  'EXPECTED_DIALUX_RESULTS_MISSING',
  'MAINTENANCE_FACTOR_MISSING',
  'LUMINAIRE_SCHEDULE_MISSING',
  'LUMINAIRE_QUANTITY_CONFLICT',
  'ORDERING_CODE_CONFLICT',
  'MANUFACTURER_CONFLICT',
  'WATTAGE_CONFLICT',
  'CCT_CONFLICT',
  'BEAM_CONFLICT',
  'VALUE_BASIS_CONFLICT',
  'ROUTING_PROPOSAL_STALE',
] as const;
export type DocumentFindingCode = (typeof documentFindingCodes)[number];

export const documentDecisionTypes = [
  'OVERRIDE_CLASSIFICATION',
  'CONFIRM_PROJECT_ASSOCIATION',
  'REJECT_PROJECT_ASSOCIATION',
  'CONFIRM_RELATIONSHIP',
  'REJECT_RELATIONSHIP',
  'ACCEPT_DOCUMENT',
  'EXCLUDE_DOCUMENT',
  'INCLUDE_COMPARISON',
  'EXCLUDE_COMPARISON',
  'ACKNOWLEDGE_FINDING',
  'RESOLVE_FINDING',
  'DISMISS_FINDING',
  'SUPERSEDE_VERSION',
  'ACCEPT_INCOMPLETE_INTELLIGENCE',
  'APPROVE_ROUTING',
  'RETRY_PROCESSING',
  'CANCEL_PROCESSING',
] as const;
export type DocumentDecisionType = (typeof documentDecisionTypes)[number];

export const documentRoutingStates = [
  'PROPOSED',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'STALE',
  'REJECTED',
  'FAILED',
] as const;
export type DocumentRoutingState = (typeof documentRoutingStates)[number];

export const DOCUMENT_INTELLIGENCE_LIMITS = Object.freeze({
  pdfBytes: 50 * 1024 * 1024,
  nativePages: 200,
  automaticOcrPages: 20,
  manualOcrPagesPerRequest: 10,
  lifetimeOcrPages: 40,
  ocrPageTimeoutMs: 30_000,
  processingAttemptMs: 6 * 60_000,
  previewWidth: 1_800,
  previewHeight: 2_500,
  previewPixels: 5_000_000,
  documentPageSize: 50,
  evidencePageSize: 100,
  comparisonDocuments: 500,
  comparisonValues: 50_000,
} as const);

const allowedDocumentTransitions: Readonly<
  Record<DocumentLifecycle, readonly DocumentLifecycle[]>
> = {
  ADMITTED: ['NEEDS_REVIEW', 'ACCEPTED', 'EXCLUDED', 'TOMBSTONED'],
  NEEDS_REVIEW: ['ACCEPTED', 'EXCLUDED', 'TOMBSTONED'],
  ACCEPTED: ['NEEDS_REVIEW', 'SUPERSEDED', 'EXCLUDED'],
  SUPERSEDED: ['ACCEPTED'],
  EXCLUDED: ['NEEDS_REVIEW', 'ACCEPTED', 'TOMBSTONED'],
  TOMBSTONED: [],
};

export function canTransitionDocumentLifecycle(
  from: DocumentLifecycle,
  to: DocumentLifecycle,
): boolean {
  return from === to || allowedDocumentTransitions[from].includes(to);
}

export function evidenceCanConfirmProject(strength: EvidenceStrength): boolean {
  return strength === 'STRONG';
}

export function compatibleTechnicalBasis(
  leftUnit: string | null,
  leftBasis: string | null,
  rightUnit: string | null,
  rightBasis: string | null,
): boolean {
  const normalize = (value: string | null) => value?.trim().toLocaleUpperCase('en') ?? null;
  return (
    normalize(leftUnit) === normalize(rightUnit) && normalize(leftBasis) === normalize(rightBasis)
  );
}

export function canonicalRelationshipEndpoints(leftVersionId: string, rightVersionId: string) {
  return leftVersionId.localeCompare(rightVersionId) < 0
    ? { leftVersionId, rightVersionId }
    : { leftVersionId: rightVersionId, rightVersionId: leftVersionId };
}

export interface DocumentAssociationEvidence {
  id: string;
  candidateProjectId: string | null;
  strength: EvidenceStrength;
  evidenceType: string;
  normalizedValue: string;
  pageNumber: number | null;
  reason: string;
  contradictory: boolean;
}

export interface DocumentExtractionValue {
  id: string;
  versionId: string;
  pageNumber: number;
  region: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  rawValue: string;
  normalizedValue: string | number | null;
  canonicalField: string;
  unit: string | null;
  basis: string | null;
  method: 'NATIVE_TEXT' | 'NATIVE_TABLE' | 'OCR';
  confidence: number;
  adapterId: string;
  extractorVersion: string;
  warnings: readonly string[];
}

export interface DocumentActor {
  id: string;
  name: string;
}

export function associationStateFromEvidence(
  evidence: readonly DocumentAssociationEvidence[],
): ProjectAssociationState {
  const strong = evidence.filter((item) => item.strength === 'STRONG');
  if (strong.some((item) => item.contradictory)) return 'CONFLICTING';
  const strongCandidates = new Set(
    strong
      .map((item) => item.candidateProjectId)
      .filter((value): value is string => value !== null),
  );
  if (strongCandidates.size > 1) return 'CONFLICTING';
  // Machine evidence may be strong, but only the audited Owner decision may
  // establish canonical confirmed_project_id authority.
  if (strongCandidates.size === 1) return 'LIKELY';
  const candidates = new Set(
    evidence
      .filter((item) => !item.contradictory && item.strength !== 'WEAK')
      .map((item) => item.candidateProjectId)
      .filter((value): value is string => value !== null),
  );
  if (candidates.size > 1) return 'AMBIGUOUS';
  if (candidates.size === 1) return 'LIKELY';
  return 'UNRESOLVED';
}
