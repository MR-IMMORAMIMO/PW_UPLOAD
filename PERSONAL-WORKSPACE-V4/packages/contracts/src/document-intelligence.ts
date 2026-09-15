import { z } from 'zod';
import {
  documentClassifications,
  documentDecisionTypes,
  documentFindingCodes,
  documentFindingSeverities,
  documentFindingStates,
  documentLifecycles,
  documentProcessingStates,
  documentRelationshipStates,
  documentRelationshipTypes,
  documentRoutingStates,
  evidenceStrengths,
  projectAssociationStates,
} from '@scli/domain';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const safeText = z.string().trim().min(1).max(2_000);

export const documentParamsSchema = z.object({ documentId: uuid }).strict();
export const documentAdmissionParamsSchema = z.object({ admissionId: uuid }).strict();
export const documentVersionParamsSchema = z.object({ documentId: uuid, versionId: uuid }).strict();
export const processingAttemptParamsSchema = z
  .object({ documentId: uuid, attemptId: uuid })
  .strict();
export const documentRelationshipParamsSchema = z
  .object({ documentId: uuid, relationshipId: uuid })
  .strict();
export const documentFindingParamsSchema = z.object({ documentId: uuid, findingId: uuid }).strict();
export const documentRoutingParamsSchema = z
  .object({ documentId: uuid, proposalId: uuid })
  .strict();

export const createDocumentAdmissionSchema = z
  .object({
    originalFileName: z.string().trim().min(1).max(260),
    projectContextId: uuid.optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const completeDocumentHandoffSchema = z.object({ token: uuid }).strict();
export const completeDocumentAdmissionSchema = z
  .object({
    projectContextId: uuid.optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const admitArtifactVersionSchema = z
  .object({
    artifactVersionId: uuid,
    projectContextId: uuid.optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();

export const documentListQuerySchema = z
  .object({
    projectId: uuid.optional(),
    lifecycle: z.enum(documentLifecycles).optional(),
    processingState: z.enum(documentProcessingStates).optional(),
    associationState: z.enum(projectAssociationStates).optional(),
    classification: z.enum(documentClassifications).optional(),
    findingSeverity: z.enum(documentFindingSeverities).optional(),
    findingCode: z.enum(documentFindingCodes).optional(),
    search: z.string().trim().max(160).optional(),
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();

export const documentEvidenceQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export const documentPreviewQuerySchema = z
  .object({ pageNumber: z.coerce.number().int().min(1).max(200) })
  .strict();
export const manualOcrSchema = z
  .object({
    pageNumbers: z.array(z.number().int().min(1).max(200)).min(1).max(10),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();

export const ownerDocumentDecisionSchema = z
  .object({
    action: z.enum(documentDecisionTypes),
    expectedRowVersion: z.number().int().positive(),
    reason: safeText,
    classification: z.enum(documentClassifications).optional(),
    projectId: uuid.optional(),
    relationshipId: uuid.optional(),
    findingId: uuid.optional(),
    fingerprint: sha256.optional(),
  })
  .strict();

export const retryDocumentProcessingSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const cancelDocumentProcessingSchema = z
  .object({ expectedRowVersion: z.number().int().positive() })
  .strict();
export const recomputeConsistencySchema = z
  .object({ projectId: uuid, idempotencyKey: z.string().trim().min(8).max(120) })
  .strict();
export const createRoutingProposalSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    destinationMappingId: z.string().trim().min(1).max(80),
  })
  .strict();
export const approveRoutingProposalSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    expectedEligibilityFingerprint: sha256,
    reason: safeText,
  })
  .strict();
export const executeRoutingProposalSchema = z
  .object({ expectedRowVersion: z.number().int().positive() })
  .strict();

export const documentAssociationEvidenceSchema = z.object({
  id: uuid,
  candidateProjectId: uuid.nullable(),
  strength: z.enum(evidenceStrengths),
  evidenceType: z.string(),
  normalizedValue: z.string(),
  pageNumber: z.number().int().positive().nullable(),
  reason: z.string(),
  contradictory: z.boolean(),
});

export const documentConflictSourceValueReadSchema = z.object({
  documentId: uuid,
  versionId: uuid,
  field: z.string(),
  value: z.union([z.string(), z.number()]).nullable(),
  unit: z.string().nullable(),
  basis: z.string().nullable(),
  tag: z.union([z.string(), z.number()]).nullable(),
});

export const documentConsistencyResultReadSchema = z.object({
  fingerprint: sha256,
  findings: z.number().int().nonnegative(),
  eligibleDocuments: z.number().int().nonnegative(),
  affectedDocumentIds: z.array(uuid),
});

export const intelligenceDocumentReadSchema = z.object({
  id: uuid,
  originalFileName: z.string(),
  lifecycle: z.enum(documentLifecycles),
  processingState: z.enum(documentProcessingStates),
  classification: z.enum(documentClassifications),
  classificationConfidence: z.number().min(0).max(100),
  associationState: z.enum(projectAssociationStates),
  confirmedProjectId: uuid.nullable(),
  activeVersionId: uuid,
  activeVersionSequence: z.number().int().positive(),
  comparisonEnabled: z.boolean(),
  rowVersion: z.number().int().positive(),
  blockingFindings: z.number().int().nonnegative(),
  warningFindings: z.number().int().nonnegative(),
  admittedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const documentAdmissionReadSchema = z.object({
  documentId: uuid,
  documentVersionId: uuid,
  sourceId: uuid,
  processingAttemptId: uuid,
  processingState: z.enum(documentProcessingStates),
  duplicateSource: z.boolean(),
});

export const documentVersionReadSchema = z.object({
  id: uuid,
  documentId: uuid,
  sequence: z.number().int().positive(),
  sourceId: uuid,
  sourceSha256: sha256,
  sourceSizeBytes: z.number().int().positive(),
  originalFileName: z.string(),
  admissionMechanism: z.enum(['GLOBAL_SELECT', 'PROJECT_SELECT', 'PHASE4_ARTIFACT']),
  initialProjectContextId: uuid.nullable(),
  processingState: z.enum(documentProcessingStates),
  admittedAt: z.string().datetime(),
});

export const processingAttemptReadSchema = z.object({
  id: uuid,
  versionId: uuid,
  state: z.enum(documentProcessingStates),
  stageCheckpoint: z.string(),
  completedPages: z.number().int().nonnegative(),
  ocrPages: z.number().int().nonnegative(),
  cancelRequested: z.boolean(),
  extractorFingerprint: sha256,
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const documentExtractionValueReadSchema = z.object({
  id: uuid,
  versionId: uuid,
  pageNumber: z.number().int().positive(),
  region: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  rawValue: z.string(),
  normalizedValue: z.union([z.string(), z.number()]).nullable(),
  canonicalField: z.string(),
  unit: z.string().nullable(),
  basis: z.string().nullable(),
  method: z.enum(['NATIVE_TEXT', 'NATIVE_TABLE', 'OCR']),
  confidence: z.number().min(0).max(100),
  adapterId: z.string(),
  extractorVersion: z.string(),
  warnings: z.array(z.string()),
});

export const documentRelationshipReadSchema = z.object({
  id: uuid,
  leftVersionId: uuid,
  rightVersionId: uuid,
  type: z.enum(documentRelationshipTypes),
  state: z.enum(documentRelationshipStates),
  evidence: z.array(z.string()),
  confidence: z.number().min(0).max(100),
  rowVersion: z.number().int().positive(),
});
export const documentFindingReadSchema = z.object({
  id: uuid,
  documentId: uuid,
  versionId: uuid.nullable(),
  code: z.enum(documentFindingCodes),
  severity: z.enum(documentFindingSeverities),
  state: z.enum(documentFindingStates),
  title: z.string(),
  explanation: z.string(),
  recommendedAction: z.string(),
  generationFingerprint: sha256,
  rowVersion: z.number().int().positive(),
  competingValues: z.array(documentConflictSourceValueReadSchema).optional(),
});
export const documentDecisionReadSchema = z.object({
  id: uuid,
  documentId: uuid,
  action: z.enum(documentDecisionTypes),
  actorId: z.string(),
  actorName: z.string(),
  reason: z.string(),
  beforeProjection: z.record(z.string(), z.unknown()),
  afterProjection: z.record(z.string(), z.unknown()),
  decidedAt: z.string().datetime(),
});
export const documentRoutingProposalReadSchema = z.object({
  id: uuid,
  documentId: uuid,
  versionId: uuid,
  state: z.enum(documentRoutingStates),
  destinationMappingId: z.string(),
  eligibilityFingerprint: sha256,
  rowVersion: z.number().int().positive(),
  projectDocumentId: uuid.nullable(),
  artifactVersionId: uuid.nullable(),
});

export type CreateDocumentAdmissionInput = z.infer<typeof createDocumentAdmissionSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export type OwnerDocumentDecisionInput = z.infer<typeof ownerDocumentDecisionSchema>;
export type DocumentAssociationEvidenceRead = z.infer<typeof documentAssociationEvidenceSchema>;
export type DocumentConflictSourceValueRead = z.infer<typeof documentConflictSourceValueReadSchema>;
export type DocumentConsistencyResultRead = z.infer<typeof documentConsistencyResultReadSchema>;
export type IntelligenceDocumentRead = z.infer<typeof intelligenceDocumentReadSchema>;
export type DocumentAdmissionRead = z.infer<typeof documentAdmissionReadSchema>;
export type DocumentVersionRead = z.infer<typeof documentVersionReadSchema>;
export type ProcessingAttemptRead = z.infer<typeof processingAttemptReadSchema>;
export type DocumentExtractionValueRead = z.infer<typeof documentExtractionValueReadSchema>;
export type DocumentRelationshipRead = z.infer<typeof documentRelationshipReadSchema>;
export type DocumentFindingRead = z.infer<typeof documentFindingReadSchema>;
export type DocumentDecisionRead = z.infer<typeof documentDecisionReadSchema>;
export type DocumentRoutingProposalRead = z.infer<typeof documentRoutingProposalReadSchema>;
