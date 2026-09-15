import { z } from 'zod';
import {
  importAdapterIds,
  importCanonicalFields,
  importDestinationModes,
  importMappingConfidences,
  importApplyAttemptStates,
  importLibraryActions,
  importLibraryManufacturerStates,
  importLibraryMetadataStates,
  importLibraryProductStates,
  importLibraryVariantStates,
  importProjectActions,
  importReconciliationStates,
  importRowStatuses,
  importSessionStatuses,
  importValidationLayers,
  importValidationSeverities,
} from '@scli/domain';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime();

const boundedText = z.string().max(2_000);
const projectLuminaireMutableFieldSchema = z.enum([
  'category',
  'description',
  'manufacturer',
  'model',
  'productType',
  'variantLabel',
  'orderingCode',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'mounting',
  'cutout',
  'driver',
  'control',
  'emergency',
  'location',
  'unit',
  'quantity',
  'notes',
  'dimensions',
  'bodyColorFinish',
]);

export const importProjectPayloadSchema = z
  .object({
    tag: z.string().trim().min(1).max(40),
    category: boundedText,
    description: boundedText,
    manufacturer: boundedText,
    model: boundedText,
    productType: boundedText,
    variantLabel: boundedText,
    orderingCode: boundedText,
    wattage: boundedText,
    lumens: boundedText,
    lightColor: boundedText,
    cri: boundedText,
    beamAngle: boundedText,
    ipRating: boundedText,
    mounting: boundedText,
    cutout: boundedText,
    driver: boundedText,
    control: boundedText,
    emergency: boundedText,
    location: boundedText,
    unit: z.string().trim().min(1).max(40),
    quantity: z.number().min(0).max(1_000_000),
    notes: boundedText,
    dimensions: boundedText,
    bodyColorFinish: boundedText,
  })
  .strict();

export const importSparseChangeSchema = z
  .object({
    field: projectLuminaireMutableFieldSchema,
    before: z.union([boundedText, z.number()]),
    after: z.union([boundedText, z.number()]),
  })
  .strict()
  .refine((value) => value.before !== value.after, 'A sparse change must change the value.');

const importActionBasisSchema = z
  .object({
    sourceRowFingerprint: sha256,
    mappingFingerprint: sha256,
    reconciliationFingerprint: sha256,
  })
  .strict();

export const importProjectRowActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('PROJECT_CREATE_ONLY'),
      canonicalTag: z.string().trim().min(1).max(40),
      payload: importProjectPayloadSchema,
      basis: importActionBasisSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PROJECT_UPDATE_EXISTING'),
      projectLuminaireId: uuid,
      expectedProjectRowVersion: z.number().int().positive(),
      expectedCanonicalTag: z.string().min(1).max(80),
      targetKind: z.enum(['PROJECT_ONLY', 'LIBRARY_LINKED']),
      expectedBindingRowVersion: z.number().int().positive().nullable(),
      changes: z.array(importSparseChangeSchema).max(28),
      descriptionOverride: z
        .object({ before: boundedText.nullable(), after: boundedText })
        .strict()
        .nullable(),
      basis: importActionBasisSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PROJECT_ADD_FROM_LIBRARY'),
      canonicalTag: z.string().trim().min(1).max(40),
      versionId: uuid,
      manufacturerId: uuid,
      productId: uuid,
      variantId: uuid,
      expectedManufacturerRowVersion: z.number().int().positive(),
      expectedProductRowVersion: z.number().int().positive(),
      expectedVariantRowVersion: z.number().int().positive(),
      project: z
        .object({
          category: boundedText,
          location: boundedText,
          unit: z.string().trim().min(1).max(40),
          quantity: z.number().min(0).max(1_000_000),
          notes: boundedText,
          descriptionOverride: boundedText,
        })
        .strict(),
      olderPublishedVersion: z.boolean(),
      basis: importActionBasisSchema,
    })
    .strict(),
  z.object({ type: z.literal('SKIP'), reason: z.string().max(500).nullable() }).strict(),
]);

const libraryExpectedEntitySchema = z
  .object({
    entityId: uuid,
    expectedStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();

export const importLibraryVariantDraftPlanSchema = z
  .object({
    plannedVariantId: uuid,
    variantLabel: z.string().trim().min(1).max(300),
    orderingCode: z.string().max(200),
    normalizedOrderingCode: z.string().max(200),
    wattage: z.string().max(200),
    wattageBasis: z.enum(['W', 'W_PER_M']).nullable(),
    lumens: z.string().max(200),
    lumensBasis: z.enum(['LM', 'LM_PER_M']).nullable(),
    lightColor: z.string().max(200),
    cri: z.string().max(200),
    beamAngle: z.string().max(200),
    ipRating: z.string().max(200),
    mounting: z.string().max(200),
    cutout: z.string().max(200),
    driver: z.string().max(200),
    control: z.string().max(200),
    emergency: z.string().max(200),
    dimensions: z.string().max(200),
    bodyColorFinish: z.string().max(200),
    assetVersionIds: z.tuple([]),
  })
  .strict();

const importLibraryPlanBasisSchema = importActionBasisSchema
  .extend({
    destinationFingerprint: sha256,
    importRowVersion: z.number().int().positive(),
  })
  .strict();

const importLibraryManufacturerPlanSchema = z
  .object({
    manufacturerGroupId: uuid,
    mode: z.enum(['EXISTING', 'CREATE']),
    manufacturerId: uuid,
    name: z.string().trim().min(1).max(200),
    normalizedName: z.string().trim().min(1).max(200),
    expected: libraryExpectedEntitySchema.nullable(),
  })
  .strict();

const importLibraryProductPlanSchema = z
  .object({
    productGroupId: uuid,
    mode: z.enum(['EXISTING', 'CREATE']),
    productId: uuid,
    family: z.string().trim().min(1).max(200),
    normalizedFamily: z.string().trim().min(1).max(200),
    productType: z.string().max(200),
    description: z.string().max(2_000),
    expected: libraryExpectedEntitySchema.nullable(),
  })
  .strict();

export const importLibraryRowActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('LIBRARY_CREATE_DRAFT'),
      manufacturer: importLibraryManufacturerPlanSchema,
      product: importLibraryProductPlanSchema,
      variant: importLibraryVariantDraftPlanSchema,
      basis: importLibraryPlanBasisSchema,
      publish: z.literal(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('LIBRARY_USE_EXISTING'),
      manufacturerId: uuid,
      productId: uuid,
      variantId: uuid,
      latestPublishedVersionId: uuid.nullable(),
      expectedManufacturer: libraryExpectedEntitySchema,
      expectedProduct: libraryExpectedEntitySchema,
      expectedVariant: libraryExpectedEntitySchema,
      basis: importLibraryPlanBasisSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('LIBRARY_REVIEW_EXISTING'),
      manufacturerId: uuid,
      productId: uuid,
      variantId: uuid,
      basis: importLibraryPlanBasisSchema,
    })
    .strict(),
  z.object({ type: z.literal('SKIP'), reason: z.string().max(500).nullable() }).strict(),
]);

export const importRowActionSchema = z.union([
  importProjectRowActionSchema,
  importLibraryRowActionSchema,
]);

export const importLibraryCandidateSchema = z
  .object({
    manufacturerId: uuid,
    manufacturerName: z.string().max(240),
    manufacturerRowVersion: z.number().int().positive(),
    productId: uuid,
    productName: z.string().max(240),
    productRowVersion: z.number().int().positive(),
    variantId: uuid,
    variantLabel: z.string().max(240),
    variantRowVersion: z.number().int().positive(),
    orderingCode: z.string().max(240),
    versionId: uuid,
    versionSequence: z.number().int().positive(),
    isLatest: z.boolean(),
    technicalSummary: z.string().max(500),
    matchReasons: z.array(z.string().max(160)).max(10),
  })
  .strict();

export const importIgnoredLinkedChangeSchema = z
  .object({
    field: z.string().trim().min(1).max(80),
    imported: z.union([z.string().max(2_000), z.number()]),
    current: z.union([z.string().max(2_000), z.number()]),
    reason: z.literal('Published Library Version owns this technical field.'),
  })
  .strict();

export const importProjectReconciliationSchema = z
  .object({
    schemaVersion: z.literal(1),
    inspectionFingerprint: sha256,
    sourceRowFingerprint: sha256,
    mappingFingerprint: sha256,
    reconciliationFingerprint: sha256,
    destinationFingerprint: sha256,
    canonicalTag: z.string().max(80).nullable(),
    projectState: z.enum(importReconciliationStates),
    projectCandidateCount: z.number().int().min(0).max(20),
    projectLuminaireId: uuid.nullable(),
    expectedProjectRowVersion: z.number().int().positive().nullable(),
    bindingId: uuid.nullable(),
    expectedBindingRowVersion: z.number().int().positive().nullable(),
    selectedLibraryVersionId: uuid.nullable(),
    exactLibraryMatch: importLibraryCandidateSchema.nullable(),
    availableLibraryVersions: z.array(importLibraryCandidateSchema).max(20),
    possibleLibraryMatches: z.array(importLibraryCandidateSchema).max(5),
    ignoredLinkedChanges: z.array(importIgnoredLinkedChangeSchema).max(28),
    allowedActions: z.array(z.enum(importProjectActions)).max(4),
    recommendedAction: z.enum(importProjectActions).nullable(),
    warnings: z.array(z.string().max(500)).max(20),
    reconciledAt: timestamp,
  })
  .strict();

export const importLibraryEntityCandidateSchema = z
  .object({
    manufacturerId: uuid,
    manufacturerName: z.string().max(200),
    manufacturerStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    manufacturerRowVersion: z.number().int().positive(),
    productId: uuid,
    productName: z.string().max(200),
    productType: z.string().max(200),
    productDescription: z.string().max(2_000),
    productStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    productRowVersion: z.number().int().positive(),
    variantId: uuid,
    variantLabel: z.string().max(300),
    orderingCode: z.string().max(200),
    variantStatus: z.enum(['ACTIVE', 'ARCHIVED']),
    variantRowVersion: z.number().int().positive(),
    latestPublishedVersionId: uuid.nullable(),
    technicalSummary: z.string().max(500),
    technical: z
      .object({
        wattage: z.string().max(200),
        lumens: z.string().max(200),
        lightColor: z.string().max(200),
        cri: z.string().max(200),
        beamAngle: z.string().max(200),
        ipRating: z.string().max(200),
        mounting: z.string().max(200),
        cutout: z.string().max(200),
        driver: z.string().max(200),
        control: z.string().max(200),
        emergency: z.string().max(200),
        dimensions: z.string().max(200),
        bodyColorFinish: z.string().max(200),
      })
      .strict(),
    technicalDifferences: z
      .array(
        z
          .object({
            field: z.string().min(1).max(80),
            imported: z.string().max(500),
            current: z.string().max(500),
          })
          .strict(),
      )
      .max(20),
    matchReasons: z.array(z.string().max(160)).max(10),
  })
  .strict();

const importLibraryMetadataFactSchema = z
  .object({
    state: z.enum(importLibraryMetadataStates),
    values: z.array(z.string().max(2_000)).max(20),
    resolvedValue: z.string().max(2_000).nullable(),
  })
  .strict();

export const importLibraryReconciliationSchema = z
  .object({
    schemaVersion: z.literal(2),
    inspectionFingerprint: sha256,
    sourceRowFingerprint: sha256,
    mappingFingerprint: sha256,
    reconciliationFingerprint: sha256,
    destinationFingerprint: sha256,
    manufacturer: z
      .object({
        manufacturerGroupId: uuid,
        state: z.enum(importLibraryManufacturerStates),
        name: z.string().max(200),
        normalizedName: z.string().max(200),
        plannedManufacturerId: uuid,
        existing: z
          .object({
            manufacturerId: uuid,
            name: z.string().max(200),
            status: z.enum(['ACTIVE', 'ARCHIVED']),
            rowVersion: z.number().int().positive(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    product: z
      .object({
        productGroupId: uuid,
        state: z.enum(importLibraryProductStates),
        family: z.string().max(200),
        normalizedFamily: z.string().max(200),
        plannedProductId: uuid,
        existing: z
          .object({
            productId: uuid,
            name: z.string().max(200),
            productType: z.string().max(200),
            description: z.string().max(2_000),
            status: z.enum(['ACTIVE', 'ARCHIVED']),
            rowVersion: z.number().int().positive(),
          })
          .strict()
          .nullable(),
        productType: importLibraryMetadataFactSchema,
        description: importLibraryMetadataFactSchema,
      })
      .strict(),
    variant: z
      .object({
        state: z.enum(importLibraryVariantStates),
        plannedVariantId: uuid,
        variantLabel: z.string().max(300),
        orderingCode: z.string().max(200),
        normalizedOrderingCode: z.string().max(200),
        exactMatch: importLibraryEntityCandidateSchema.nullable(),
        possibleMatches: z.array(importLibraryEntityCandidateSchema).max(5),
      })
      .strict(),
    facts: z
      .object({
        technical: importLibraryVariantDraftPlanSchema.omit({
          plannedVariantId: true,
          variantLabel: true,
          orderingCode: true,
          normalizedOrderingCode: true,
          assetVersionIds: true,
        }),
        excludedProjectFields: z
          .array(
            z.enum([
              'TAG',
              'PROJECT_CATEGORY',
              'LOCATION',
              'UNIT',
              'QUANTITY',
              'NOTES',
              'DESCRIPTION_OVERRIDE',
            ]),
          )
          .length(7),
        assetEvidenceOnly: z.boolean(),
      })
      .strict(),
    blockingReasons: z
      .array(z.object({ code: z.string().max(100), message: z.string().max(500) }).strict())
      .max(20),
    warnings: z.array(z.string().max(500)).max(20),
    allowedActions: z.array(z.enum(importLibraryActions)).max(4),
    recommendedAction: z.enum(importLibraryActions).nullable(),
    reconciledAt: timestamp,
  })
  .strict();

export const importReconciliationSchema = z.union([
  importProjectReconciliationSchema,
  importLibraryReconciliationSchema,
]);

export const importProjectResultIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    outcome: z.enum(['CREATED', 'UPDATED', 'LIBRARY_ADDED', 'SKIPPED', 'FAILED']),
    mutationOccurred: z.boolean(),
    projectLuminaireId: uuid.nullable(),
    libraryVersionId: uuid.nullable(),
    applyAttemptId: uuid,
    appliedAt: timestamp,
    failureCode: z.string().max(100).nullable(),
    retryEligible: z.boolean(),
  })
  .strict();

export const importLibraryResultIdentitySchema = z
  .object({
    schemaVersion: z.literal(2),
    outcome: z.enum(['DRAFT_CREATED', 'USED_EXISTING', 'SKIPPED', 'FAILED']),
    mutationOccurred: z.boolean(),
    manufacturerId: uuid.nullable(),
    productId: uuid.nullable(),
    variantId: uuid.nullable(),
    latestPublishedVersionId: uuid.nullable(),
    manufacturerCreated: z.boolean(),
    productCreated: z.boolean(),
    applyAttemptId: uuid,
    appliedAt: timestamp,
    failureCode: z.string().max(100).nullable(),
    retryEligible: z.boolean(),
  })
  .strict();

export const importResultIdentitySchema = z.union([
  importProjectResultIdentitySchema,
  importLibraryResultIdentitySchema,
]);

export const reconcileImportSessionSchema = z
  .object({
    expectedSessionRevision: z.number().int().positive(),
    expectedPreviewFingerprint: sha256,
  })
  .strict();

export const updateImportRowActionSchema = z
  .object({
    expectedSessionRevision: z.number().int().positive(),
    expectedRowVersion: z.number().int().positive(),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('PROJECT_CREATE_ONLY') }).strict(),
      z.object({ type: z.literal('PROJECT_UPDATE_EXISTING') }).strict(),
      z.object({ type: z.literal('PROJECT_ADD_FROM_LIBRARY'), versionId: uuid }).strict(),
      z.object({ type: z.literal('LIBRARY_CREATE_DRAFT') }).strict(),
      z.object({ type: z.literal('LIBRARY_USE_EXISTING') }).strict(),
      z.object({ type: z.literal('LIBRARY_REVIEW_EXISTING') }).strict(),
      z.object({ type: z.literal('SKIP'), reason: z.string().max(500).nullable() }).strict(),
    ]),
  })
  .strict();

const bulkImportRowIdentitySchema = {
  expectedSessionRevision: z.number().int().positive(),
  rowIds: z.array(uuid).min(1).max(500),
} as const;

export const bulkUpdateImportRowActionsSchema = z.union([
  z
    .object({
      ...bulkImportRowIdentitySchema,
      action: z.enum(['LIBRARY_CREATE_DRAFT', 'LIBRARY_USE_EXISTING', 'SKIP']),
    })
    .strict(),
  z
    .object({
      ...bulkImportRowIdentitySchema,
      action: z.enum(['PROJECT_CREATE_ONLY', 'PROJECT_ADD_FROM_LIBRARY', 'SKIP']),
    })
    .strict(),
  z
    .object({
      ...bulkImportRowIdentitySchema,
      projectFields: z
        .object({
          category: z.string().trim().min(1).max(100).optional(),
          location: z.string().trim().min(1).max(300).optional(),
          unit: z.string().trim().min(1).max(40).optional(),
          quantity: z.number().finite().min(0).max(1_000_000).optional(),
        })
        .strict()
        .refine((fields) => Object.keys(fields).length > 0, 'Select at least one Project field.'),
    })
    .strict(),
]);

export const importLibraryGroupDecisionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('MANUFACTURER'),
      expectedSessionRevision: z.number().int().positive(),
      manufacturerGroupId: uuid,
      decision: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('CREATE') }).strict(),
        z.object({ mode: z.literal('USE_EXISTING'), manufacturerId: uuid }).strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('PRODUCT'),
      expectedSessionRevision: z.number().int().positive(),
      productGroupId: uuid,
      decision: z
        .object({
          family: z.string().trim().min(1).max(200).optional(),
          productType: z.string().trim().max(200).optional(),
          description: z.string().trim().max(2_000).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'Provide a Product group decision.'),
    })
    .strict(),
]);

export const applyImportSessionSchema = z
  .object({
    expectedSessionRevision: z.number().int().positive(),
    previewFingerprint: sha256,
    destinationFingerprint: sha256,
    applyPlanFingerprint: sha256,
    idempotencyKey: z.string().trim().min(8).max(200),
    mode: z.enum(['ALL', 'READY_ONLY']),
    confirmPartial: z.boolean().default(false),
  })
  .strict();

export const createImportSessionSchema = z
  .object({
    destinationMode: z.enum(importDestinationModes),
    projectId: uuid.nullable().optional().default(null),
    previousSessionId: uuid.nullable().optional().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.destinationMode === 'PROJECT' && !value.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'Select an authorized Project for Project inspection.',
      });
    }
    if (value.destinationMode === 'MASTER_LIBRARY' && value.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'Master Library inspection is not Project-bound.',
      });
    }
  });

export const importSessionParamsSchema = z.object({ id: uuid }).strict();
export const importTableParamsSchema = z.object({ id: uuid, tableId: uuid }).strict();
export const importRowParamsSchema = z.object({ id: uuid, rowId: uuid }).strict();
export const importApplyAttemptParamsSchema = z.object({ id: uuid, attemptId: uuid }).strict();

export const importColumnMappingSchema = z
  .object({
    sourceColumnKey: z.string().min(1).max(200),
    sourceHeader: z.string().max(2_000),
    canonicalField: z.enum(importCanonicalFields).nullable(),
    confidence: z.enum(importMappingConfidences),
    unitHint: z.string().max(80).nullable(),
    evidence: z.array(z.string().max(240)).max(20),
  })
  .strict();

export const updateImportTableSchema = z
  .object({
    selected: z.boolean().optional(),
    headerRow: z.number().int().min(1).max(10_000).optional(),
    mapping: z.array(importColumnMappingSchema).max(200).optional(),
    expectedRowVersion: z.number().int().min(1),
    expectedSessionRevision: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) =>
      value.selected !== undefined || value.headerRow !== undefined || value.mapping !== undefined,
    'At least one table review decision is required.',
  );

export const reinspectImportSessionSchema = z
  .object({ expectedSessionRevision: z.number().int().min(1) })
  .strict();

export const importRowsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    filter: z
      .enum(['ALL', 'READY', 'NEEDS_REVIEW', 'BLOCKED', 'FAILED', 'UNMAPPED', 'MAPPING_CONFLICT'])
      .default('ALL'),
    sourceTableId: uuid.optional(),
    search: z.string().trim().max(200).optional(),
    matchQuality: z.enum(['EXACT', 'CANDIDATE', 'UNRESOLVED']).optional(),
  })
  .strict();

export const importHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const importValidationReasonSchema = z
  .object({
    code: z.string().min(1).max(100),
    severity: z.enum(importValidationSeverities),
    layer: z.enum(importValidationLayers),
    field: z.enum(importCanonicalFields).nullable(),
    message: z.string().min(1).max(500),
  })
  .strict();

export const importSessionReadSchema = z.object({
  importSessionId: uuid,
  sourceFileName: z.string().nullable(),
  sourceSha256: sha256.nullable(),
  sourceSizeBytes: z.number().int().nonnegative().nullable(),
  sourceExtension: z.enum(['.csv', '.tsv', '.xlsx']).nullable(),
  detectedAdapterId: z.enum(importAdapterIds).nullable(),
  detectedAdapterVersion: z.string().nullable(),
  destinationMode: z.enum(importDestinationModes),
  projectId: uuid.nullable(),
  sessionStatus: z.enum(importSessionStatuses),
  sessionRevision: z.number().int().positive(),
  detection: z.record(z.string(), z.unknown()),
  destinationFingerprint: z.string().nullable(),
  previewFingerprint: sha256.nullable(),
  applyPlanFingerprint: sha256.nullable(),
  applyPlan: z.object({
    createProjectOnly: z.number().int().nonnegative(),
    updateProjectOnly: z.number().int().nonnegative(),
    updateLinkedProjectFields: z.number().int().nonnegative(),
    addFromLibrary: z.number().int().nonnegative(),
    createLibraryDraft: z.number().int().nonnegative(),
    useExistingLibrary: z.number().int().nonnegative(),
    reviewExistingLibrary: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    readyMutations: z.number().int().nonnegative(),
  }),
  actorId: uuid,
  actorName: z.string(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  previousSessionId: uuid.nullable(),
});

export type CreateImportSessionInput = z.input<typeof createImportSessionSchema>;
export type UpdateImportTableInput = z.infer<typeof updateImportTableSchema>;
export type ReinspectImportSessionInput = z.infer<typeof reinspectImportSessionSchema>;
export type ImportRowsQuery = z.infer<typeof importRowsQuerySchema>;
export type ImportHistoryQuery = z.infer<typeof importHistoryQuerySchema>;
export type ImportSessionRead = z.infer<typeof importSessionReadSchema>;
export type ImportProjectPayload = z.infer<typeof importProjectPayloadSchema>;
export type ImportLibraryCandidate = z.infer<typeof importLibraryCandidateSchema>;
export type ImportLibraryEntityCandidate = z.infer<typeof importLibraryEntityCandidateSchema>;
export type ImportLibraryVariantDraftPlan = z.infer<typeof importLibraryVariantDraftPlanSchema>;
export type ImportSparseChange = z.infer<typeof importSparseChangeSchema>;
export type ImportRowAction = z.infer<typeof importRowActionSchema>;
export type ImportProjectRowAction = z.infer<typeof importProjectRowActionSchema>;
export type ImportLibraryRowAction = z.infer<typeof importLibraryRowActionSchema>;
export type ImportReconciliation = z.infer<typeof importReconciliationSchema>;
export type ImportProjectReconciliation = z.infer<typeof importProjectReconciliationSchema>;
export type ImportLibraryReconciliation = z.infer<typeof importLibraryReconciliationSchema>;
export type ImportResultIdentity = z.infer<typeof importResultIdentitySchema>;
export type ImportProjectResultIdentity = z.infer<typeof importProjectResultIdentitySchema>;
export type ImportLibraryResultIdentity = z.infer<typeof importLibraryResultIdentitySchema>;
export type ReconcileImportSessionInput = z.infer<typeof reconcileImportSessionSchema>;
export type UpdateImportRowActionInput = z.infer<typeof updateImportRowActionSchema>;
export type BulkUpdateImportRowActionsInput = z.infer<typeof bulkUpdateImportRowActionsSchema>;
export type ImportLibraryGroupDecisionInput = z.infer<typeof importLibraryGroupDecisionSchema>;
export type ApplyImportSessionInput = z.infer<typeof applyImportSessionSchema>;

export interface ImportSourceTableRead {
  sourceTableId: string;
  importSessionId: string;
  tableKey: string;
  tableName: string;
  sourceOrdinal: number;
  visibilityState: 'VISIBLE' | 'HIDDEN' | 'VERY_HIDDEN';
  detectedRegion: Record<string, unknown>;
  headerRow: number | null;
  selected: boolean;
  headerSignature: string;
  mapping: z.infer<typeof importColumnMappingSchema>[];
  mappingFingerprint: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowRead {
  importRowId: string;
  importSessionId: string;
  sourceTableId: string;
  sourceRowNumber: number;
  sourceRowKey: string;
  sourceRowFingerprint: string;
  rawCells: Array<Record<string, unknown>>;
  mappedCandidate: Record<string, unknown>;
  normalizationEvidence: Array<Record<string, unknown>>;
  validationReasons: z.infer<typeof importValidationReasonSchema>[];
  rowStatus: (typeof importRowStatuses)[number];
  reconciliation: ImportReconciliation | null;
  intendedAction: ImportRowAction | null;
  applyState: 'NOT_APPLIED' | 'PENDING' | 'APPLIED' | 'FAILED';
  resultIdentity: ImportResultIdentity | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowsPage {
  items: ImportRowRead[];
  page: number;
  pageSize: number;
  totalCount: number;
  counts: {
    all: number;
    ready: number;
    needsReview: number;
    blocked: number;
    failed: number;
    unmapped: number;
    mappingConflict: number;
    needsMapping?: number;
  };
}

export interface ImportHistoryPage {
  items: ImportSessionRead[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ImportApplyPlanSummary {
  createProjectOnly: number;
  updateProjectOnly: number;
  updateLinkedProjectFields: number;
  addFromLibrary: number;
  createLibraryDraft: number;
  useExistingLibrary: number;
  reviewExistingLibrary: number;
  skip: number;
  blocked: number;
  unresolved: number;
  readyMutations: number;
}

export interface ImportApplyAttemptRead {
  applyAttemptId: string;
  importSessionId: string;
  idempotencyKey: string;
  state: (typeof importApplyAttemptStates)[number];
  applyPlanFingerprint: string;
  destinationFingerprint: string;
  backupId: string | null;
  counts: ImportApplyPlanSummary & {
    applied: number;
    failed: number;
    created: number;
    updatedProjectOnlyResult: number;
    updatedLinkedProjectFieldsResult: number;
    addedFromLibrary: number;
    uniqueManufacturersCreated: number;
    uniqueProductsCreated: number;
    variantDraftsCreated: number;
    existingVariantsUsed: number;
    publishedVersionsCreated: 0;
    skippedResult: number;
    remainingBlocked: number;
    remainingUnresolved: number;
  };
  errorSummary: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}
