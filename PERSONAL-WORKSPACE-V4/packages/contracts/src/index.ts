import { finalProjectSetupSchema } from './final-project-setup';
export { finalProjectSetupSchema } from './final-project-setup';
import { z } from 'zod';
export * from './final-ui';
import {
  availabilityStatuses,
  captureStates,
  complexities,
  designStages,
  folderProfileSchemaVersions,
  outputFamilies,
  outputOrientations,
  outputRowDensities,
  pdfPaperSizes,
  priorities,
  projectServiceCodes,
  projectStatuses,
  roles,
  luminaireInputModes,
  templateOrigins,
  templateStates,
  timesheetStatuses,
  workCategories,
  validateProjectReferenceInput,
  type FolderProfileCatalog,
  type Project,
  type ProfileFolderNodeDraft,
  type ProfileOutputDefaultDraft,
} from '@scli/domain';
import { folderNodeSchema, projectOutputFoldersSchema } from './personal';
import { folderSnapshotSchemaVersions } from '@scli/domain';
export * from './document-intelligence';

export * from './personal';
export * from './luminaire-library';
export * from './imports';

// ===========================================================================
// P2.4B1 — Canonical project folder snapshot and output mapping contracts
// ===========================================================================

export const folderNodeV1Schema = z.object({
  folderId: z.string().trim().min(1).max(200),
  parentFolderId: z.string().trim().min(1).max(200).nullable(),
  name: z.string().trim().min(1).max(120),
  displayOrder: z.coerce.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  semanticRole: z.string().trim().max(120).nullable().default(null),
  sourceProfileFolderId: z.string().trim().max(200).nullable().optional(),
});

export const folderProfileSourceSchema = z.object({
  profileId: z.string().trim().max(200).nullable().default(null),
  profileName: z.string().trim().min(1).max(120),
  profileRevision: z.string().trim().max(200).nullable().default(null),
  structuralFingerprint: z.string().trim().min(1).max(200),
  factoryProfileKey: z.string().trim().min(1).max(200).nullable().optional(),
});
export const projectFolderSnapshotSchema = z.object({
  schemaVersion: z.enum(folderSnapshotSchemaVersions),
  sourceProfile: folderProfileSourceSchema.nullable().default(null),
  folders: z.array(folderNodeV1Schema).min(0).max(300),
});

export const outputMappingSchema = z
  .object({
    outputTypeId: z.string().trim().min(1).max(200),
    destinationFolderId: z.string().trim().min(1).max(200).nullable(),
    unresolved: z.boolean().default(false),
    legacyPath: z.string().trim().max(2_048).nullable().default(null),
  })
  .refine((mapping) => mapping.unresolved === (mapping.destinationFolderId === null), {
    message: 'Output mapping resolution state is inconsistent.',
    path: ['unresolved'],
  });

export const projectOutputMappingsSchema = z
  .object({
    schemaVersion: z.enum(folderSnapshotSchemaVersions),
    mappings: z.array(outputMappingSchema).max(300),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const mapping of value.mappings) {
      if (seen.has(mapping.outputTypeId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate output mapping for ${mapping.outputTypeId}.`,
          path: ['mappings'],
        });
      }
      seen.add(mapping.outputTypeId);
    }
  });

export type FolderNodeV1 = z.infer<typeof folderNodeV1Schema>;
export type FolderProfileSourceInput = z.infer<typeof folderProfileSourceSchema>;
export type ProjectFolderSnapshotInput = z.infer<typeof projectFolderSnapshotSchema>;
export type OutputMappingInput = z.infer<typeof outputMappingSchema>;
export type ProjectOutputMappingsInput = z.infer<typeof projectOutputMappingsSchema>;
// ===========================================================================
// P2.4B3B2A - Canonical project folder draft create contract
// ===========================================================================

export const projectFolderDraftNodeSchema = z.object({
  draftFolderId: z.string().trim().min(1).max(200),
  parentDraftFolderId: z.string().trim().min(1).max(200).nullable(),
  name: z.string().trim().min(1).max(120),
  displayOrder: z.coerce.number().int().min(0).max(10_000),
  semanticRole: z.string().trim().max(120).nullable().optional(),
  sourceProfileFolderId: z.string().trim().max(200).nullable().optional(),
});

export const projectFolderDraftOutputMappingSchema = z.object({
  outputTypeId: z.string().trim().min(1).max(200),
  destinationDraftFolderId: z.string().trim().min(1).max(200),
});

export const projectFolderDraftSchema = z.object({
  folders: z.array(projectFolderDraftNodeSchema).max(300),
  outputMappings: z.array(projectFolderDraftOutputMappingSchema).max(300),
  sourceProfile: folderProfileSourceSchema.nullable().optional(),
});

export type ProjectFolderDraftNodeInput = z.infer<typeof projectFolderDraftNodeSchema>;
export type ProjectFolderDraftOutputMappingInput = z.infer<
  typeof projectFolderDraftOutputMappingSchema
>;
export type ProjectFolderDraftInput = z.infer<typeof projectFolderDraftSchema>;

// ===========================================================================
// P2.4B2 - Controlled ID-aware folder structure action contracts
// ===========================================================================

export const folderActionFingerprintSchema = z.object({
  expectedFolderConfigurationFingerprint: z.string().trim().min(1).max(200),
});

export const addFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('add'),
  parentFolderId: z.string().trim().min(1).max(200).nullable(),
  name: z.string().min(1).max(120),
});

export const renameFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('rename'),
  folderId: z.string().trim().min(1).max(200),
  name: z.string().min(1).max(120),
});

export const moveFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('move'),
  folderId: z.string().trim().min(1).max(200),
  newParentFolderId: z.string().trim().min(1).max(200).nullable(),
});

export const reorderFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('reorder'),
  folderId: z.string().trim().min(1).max(200),
  newDisplayOrder: z.coerce.number().int().min(0).max(10_000),
});

export const disableFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('disable'),
  folderId: z.string().trim().min(1).max(200),
});

export const enableFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('enable'),
  folderId: z.string().trim().min(1).max(200),
});

export const deleteEmptyFolderActionSchema = folderActionFingerprintSchema.extend({
  action: z.literal('delete-empty'),
  folderId: z.string().trim().min(1).max(200),
});

export const folderActionSchema = z.discriminatedUnion('action', [
  addFolderActionSchema,
  renameFolderActionSchema,
  moveFolderActionSchema,
  reorderFolderActionSchema,
  disableFolderActionSchema,
  enableFolderActionSchema,
  deleteEmptyFolderActionSchema,
]);

export const folderActionPreviewSchema = z.discriminatedUnion('action', [
  renameFolderActionSchema.omit({ expectedFolderConfigurationFingerprint: true }),
  moveFolderActionSchema.omit({ expectedFolderConfigurationFingerprint: true }),
  deleteEmptyFolderActionSchema.omit({ expectedFolderConfigurationFingerprint: true }),
]);

export type FolderActionInput = z.infer<typeof folderActionSchema>;
export type FolderActionPreviewInput = z.infer<typeof folderActionPreviewSchema>;

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const crmReferenceValue = z
  .union([z.string().trim().max(200), z.null()])
  .transform((value) => (value === null || value.trim() === '' ? null : value.trim()));
const crmReferenceSchema = crmReferenceValue.optional();

const commercialValueMinorSchema = z
  .number()
  .int('Commercial value must use integer minor units.')
  .min(0, 'Commercial value cannot be negative.')
  .max(Number.MAX_SAFE_INTEGER, 'Commercial value exceeds the safe integer range.')
  .nullable()
  .optional();
const commercialCurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Commercial currency must be an uppercase three-letter code.')
  .nullable()
  .optional();

interface CommercialValuePair {
  commercialValueMinor?: number | null | undefined;
  commercialCurrency?: string | null | undefined;
}

function commercialValueState(value: unknown): 'omitted' | 'null' | 'populated' {
  if (value === undefined) return 'omitted';
  if (value === null) return 'null';
  return 'populated';
}

function validateCommercialValuePair(value: CommercialValuePair, context: z.RefinementCtx): void {
  const amountState = commercialValueState(value.commercialValueMinor);
  const currencyState = commercialValueState(value.commercialCurrency);
  if (amountState === currencyState) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      'Commercial value and currency must both be omitted, both be null, or both be populated.',
    path: [
      amountState === 'omitted' || amountState === 'null'
        ? 'commercialValueMinor'
        : 'commercialCurrency',
    ],
  });
}

const httpsUrl = z
  .string()
  .trim()
  .url('Enter a valid URL.')
  .refine((value) => value.startsWith('https://'), 'Only HTTPS links are allowed.');

export const roleSchema = z.enum(roles);
export const availabilityStatusSchema = z.enum(availabilityStatuses);
export const projectStatusSchema = z.enum(projectStatuses);
export const prioritySchema = z.enum(priorities);
export const complexitySchema = z.enum(complexities);
export const designStageSchema = z.enum(designStages);

/**
 * One entry in a project's active scope. Built-in entries carry a service
 * code; custom project-specific entries carry a label and custom: true.
 */
export const projectScopeItemInputSchema = z.object({
  code: z.enum(projectServiceCodes).nullable().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  custom: z.boolean().default(false),
});

export const createProjectSchema = z
  .object({
    projectName: requiredText('Project name', 120),
    clientName: requiredText('Client name', 120),
    crmReference: crmReferenceSchema,
    commercialValueMinor: commercialValueMinorSchema,
    commercialCurrency: commercialCurrencySchema,
    projectType: requiredText('Project type', 80),
    description: z.string().trim().max(4_000).default(''),
    salesOwnerId: z.string().uuid().optional(),
    assignedDesignerId: z.string().uuid().nullable().optional(),
    collaboratorDesignerIds: z.array(z.string().uuid()).max(12).default([]),
    siteLocation: z.string().trim().max(180).default(''),
    designStage: designStageSchema.default('Concept'),
    lightingScope: requiredText('Lighting scope', 500),
    luxRequirements: z.string().trim().max(1_000).default(''),
    drawingReference: z.string().trim().max(300).default(''),
    priority: prioritySchema.default('Normal'),
    complexity: complexitySchema.default('Medium'),
    estimatedHours: z.coerce.number().min(0).max(10_000),
    finalSetup: finalProjectSetupSchema.optional(),
    requiredDeliveryDate: z.union([z.string().date(), z.literal('')]),
    projectFolderUrl: httpsUrl.nullable().optional(),
    projectRoot: z.string().trim().min(1).max(1_024).optional(),
    connectFolderPath: z.string().trim().min(1).max(1_024).optional(),
    storageConnectIntent: z.enum(['MATCHING_MARKER', 'ADOPT_LEGACY', 'INITIAL_BINDING']).optional(),
    createFolders: z.boolean().default(false),
    folderProfile: z.string().trim().min(1).max(120).default('Full Lighting Design'),
    folderStructure: z.array(folderNodeSchema).min(1).max(100).optional(),
    outputFolders: projectOutputFoldersSchema.optional(),
    services: z
      .array(z.enum(projectServiceCodes))
      .max(projectServiceCodes.length)
      .default(['LuminaireSchedule', 'TechnicalBoq', 'Datasheets']),
    scopeItems: z.array(projectScopeItemInputSchema).max(100).optional(),
    luminaireInputMode: z.enum(luminaireInputModes).default('Later'),
    folderDraft: projectFolderDraftSchema.optional(),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (!value.finalSetup && !value.siteLocation)
      context.addIssue({
        code: 'custom',
        message: 'Site location is required.',
        path: ['siteLocation'],
      });
    if (
      value.folderDraft !== undefined &&
      (value.folderStructure !== undefined ||
        value.outputFolders !== undefined ||
        value.connectFolderPath !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Canonical folderDraft cannot be combined with legacy folderStructure, outputFolders, or connectFolderPath authority.',
        path: ['folderDraft'],
      });
    }
  })
  .superRefine(validateCommercialValuePair);

/**
 * Dedicated scope update for a personal project. Uses optimistic version
 * semantics so a stale client cannot silently overwrite a newer scope.
 */
export const updateProjectScopeSchema = z.object({
  scopeItems: z.array(projectScopeItemInputSchema).max(100),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

/**
 * Workspace setup input used by the existing workspace-setup route. Services
 * remain accepted for backward compatibility; scopeItems carries the full
 * flexible scope (built-in plus custom) when provided.
 */
export const updateProjectWorkspaceSetupInputSchema = z.object({
  services: z.array(z.enum(projectServiceCodes)).max(projectServiceCodes.length).optional(),
  scopeItems: z.array(projectScopeItemInputSchema).max(100).optional(),
  folderProfile: z.string().trim().min(1).max(120),
  folderStructure: z.array(folderNodeSchema).min(1).max(100),
  outputFolders: projectOutputFoldersSchema,
  connectFolderPath: z.string().trim().min(1).max(1_024).optional(),
  ensureFolders: z.boolean().default(false),
});

export const updateProjectSchema = z
  .object({
    projectName: requiredText('Project name', 120).optional(),
    clientName: requiredText('Client name', 120).optional(),
    crmReference: crmReferenceSchema,
    commercialValueMinor: commercialValueMinorSchema,
    commercialCurrency: commercialCurrencySchema,
    projectType: requiredText('Project type', 80).optional(),
    description: z.string().trim().max(4_000).optional(),
    siteLocation: requiredText('Site location', 180).optional(),
    designStage: designStageSchema.optional(),
    lightingScope: requiredText('Lighting scope', 500).optional(),
    luxRequirements: z.string().trim().max(1_000).optional(),
    drawingReference: z.string().trim().max(300).optional(),
    salesOwnerId: z.string().uuid().optional(),
    priority: prioritySchema.optional(),
    complexity: complexitySchema.optional(),
    estimatedHours: z.coerce.number().min(0).max(10_000).optional(),
    actualHours: z.coerce.number().min(0).max(100_000).optional(),
    progressPercent: z.coerce.number().int().min(0).max(100).optional(),
    requiredDeliveryDate: z.string().date().optional(),
    projectFolderUrl: httpsUrl.nullable().optional(),
    auditReason: z.string().trim().min(5).max(500).optional(),
    expectedVersion: z.coerce.number().int().min(1).optional(),
  })
  .superRefine(validateCommercialValuePair)
  .refine(
    (value) => Object.keys(value).some((key) => !['auditReason', 'expectedVersion'].includes(key)),
    {
      message: 'At least one editable field is required.',
    },
  );

/**
 * One Personal-workspace command for all semantically editable Project
 * configuration. Status, Project reference, and storage binding deliberately
 * remain separate workflows.
 */
export const fullProjectEditSchema = z
  .object({
    scopeStandards: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    scopeNotes: z.string().trim().max(4000).optional(),
    responsibilityNotes: z.string().trim().max(4000).optional(),
    projectName: requiredText('Project name', 120).optional(),
    clientName: requiredText('Client name', 120).optional(),
    crmReference: crmReferenceSchema,
    commercialValueMinor: commercialValueMinorSchema,
    commercialCurrency: commercialCurrencySchema,
    projectType: requiredText('Project type', 80).optional(),
    description: z.string().trim().max(4_000).optional(),
    siteLocation: z.string().trim().max(180).optional(),
    designStage: designStageSchema.optional(),
    lightingScope: requiredText('Lighting scope', 500).optional(),
    luxRequirements: z.string().trim().max(1_000).optional(),
    drawingReference: z.string().trim().max(300).optional(),
    salesOwnerId: z.string().uuid().optional(),
    priority: prioritySchema.optional(),
    complexity: complexitySchema.optional(),
    estimatedHours: z.coerce.number().min(0).max(10_000).optional(),
    requiredDeliveryDate: z.union([z.string().date(), z.literal('')]).optional(),
    scopeItems: z.array(projectScopeItemInputSchema).max(100),
    luminaireInputMode: z.enum(luminaireInputModes),
    auditReason: z.string().trim().min(5).max(500).optional(),
    expectedVersion: z.coerce.number().int().min(1),
  })
  .superRefine(validateCommercialValuePair);

export const projectStorageMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    createdAt: z.string().datetime(),
    projectCodeSnapshot: z.string().trim().min(1).max(300),
  })
  .strict();

export const projectStorageHealthSchema = z.object({
  projectId: z.string().uuid(),
  state: z.enum([
    'CONNECTED',
    'LEGACY_UNVERIFIED',
    'DISCONNECTED',
    'UNAVAILABLE',
    'NEEDS_RECONNECTION',
  ]),
  reason: z
    .enum([
      'NOT_CONFIGURED',
      'NOT_FOUND',
      'PERMISSION_DENIED',
      'IO_UNAVAILABLE',
      'PATH_DISAGREEMENT',
      'MALFORMED_MARKER',
      'WRONG_PROJECT_MARKER',
      'LEGACY_EVIDENCE_MISSING',
      'OTHER_PROJECT_BINDING',
    ])
    .nullable(),
  projectPath: z.string().nullable(),
  workspacePath: z.string().nullable(),
  canonicalPath: z.string().nullable(),
  marker: projectStorageMarkerSchema.nullable(),
  canOpenFolder: z.boolean(),
  canReconnect: z.boolean(),
  canAdoptLegacy: z.boolean(),
  checkedAt: z.string().datetime(),
});

export const reconnectProjectStorageSchema = z
  .object({
    candidatePath: z.string().trim().min(1).max(2_048),
    intent: z.enum(['MATCHING_MARKER', 'ADOPT_LEGACY', 'INITIAL_BINDING']),
    expectedVersion: z.coerce.number().int().min(1),
  })
  .strict();

export const changeProjectReferenceSchema = z.object({
  projectCode: z
    .string()
    .trim()
    .min(1, 'A project reference is required.')
    .max(80, 'The project reference is too long.')
    .superRefine((value, context) => {
      try {
        validateProjectReferenceInput(value);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error
              ? error.message
              : 'The project reference is not in the supported format.',
        });
      }
    }),
  expectedVersion: z.coerce.number().int().min(1).optional(),
  auditReason: z.string().trim().min(5).max(500).optional(),
});

export const assignProjectSchema = z.object({
  designerId: z.string().uuid(),
  collaboratorDesignerIds: z.array(z.string().uuid()).max(12).default([]),
  overrideReason: z.string().trim().min(5).max(500).optional(),
});

export const changeStatusSchema = z.object({
  status: projectStatusSchema,
  reason: z.string().trim().max(500).optional(),
  expectedCurrentStatus: projectStatusSchema.optional(),
  /**
   * Optional in B1 for backward compatibility with committed P2.5 clients that
   * do not yet send it. B2 integrates server idempotency semantics; B3 updates
   * the Personal UI to generate/reuse it. When present it becomes the durable
   * WorkflowTransitionRecord primary key / operation identity.
   */
  transitionId: z.string().uuid().optional(),
});

// ===========================================================================
// P2.6B3 — Personal workflow history read contract
// ===========================================================================
// The timeline is a projection of existing immutable records. This response
// schema exposes the canonical fields only (no presentation text, no synthetic
// timeline events, no persisted labels). The underlying WorkflowTransitionRecord
// and RevisionCycle domain records remain authoritative.

export const workflowTransitionRecordSchema = z.object({
  transitionId: z.string().uuid(),
  projectId: z.string().uuid(),
  sequence: z.number().int().positive(),
  fromStatus: projectStatusSchema,
  toStatus: projectStatusSchema,
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  revisionCycleId: z.string().uuid().nullable(),
});

export const revisionCycleSchema = z.object({
  revisionCycleId: z.string().uuid(),
  projectId: z.string().uuid(),
  cycleNumber: z.number().int().positive(),
  status: z.enum(['Open', 'ReturnedToClient', 'Cancelled']),
  openedAt: z.string(),
  openedByTransitionId: z.string().uuid(),
  feedbackSummary: z.string(),
  workStartedAt: z.string().nullable(),
  returnedToClientAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});

export const workflowHistoryResponseSchema = z.object({
  transitions: z.array(workflowTransitionRecordSchema),
  revisionCycles: z.array(revisionCycleSchema),
});

export type WorkflowHistoryResponse = z.infer<typeof workflowHistoryResponseSchema>;

export const addCommentSchema = z.object({
  body: requiredText('Comment', 2_000),
  attachmentUrl: httpsUrl.nullable().optional(),
});

export const startTimeEntrySchema = z.object({
  workCategory: z.enum(workCategories),
  note: z.string().trim().max(500).default(''),
});

export const correctTimeEntrySchema = z.object({
  workCategory: z.enum(workCategories),
  note: z.string().trim().max(500).default(''),
  durationMinutes: z.coerce.number().int().min(1).max(1_440),
  reason: z.string().trim().min(5).max(500),
});

export const reviewTimesheetSchema = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

export const timesheetQuerySchema = z.object({
  status: z.enum(timesheetStatuses).optional(),
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

export const routeIdSchema = z.object({ id: z.string().uuid() });
export const projectEntryParamsSchema = z.object({
  id: z.string().uuid(),
  entryId: z.string().uuid(),
});
export const projectUserParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export const projectQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.string().optional(),
  designerId: z.string().uuid().optional(),
  salesOwnerId: z.string().uuid().optional(),
  priority: z.string().optional(),
  projectType: z.string().trim().max(80).optional(),
  clientName: z.string().trim().max(120).optional(),
  dueFrom: z.string().date().optional(),
  dueTo: z.string().date().optional(),
  sortBy: z.enum(['priority', 'requiredDate', 'createdDate', 'salesOwner']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export const updateUserSchema = z.object({
  displayName: requiredText('Display name', 120).optional(),
  email: z.string().trim().email().max(180).optional(),
  jobTitle: requiredText('Job title', 120).optional(),
  department: requiredText('Department', 120).optional(),
  role: roleSchema.optional(),
  weeklyCapacityHours: z.coerce.number().min(0).max(168).optional(),
  availabilityStatus: availabilityStatusSchema.optional(),
  isActive: z.boolean().optional(),
});

export const createUserSchema = z.object({
  displayName: requiredText('Display name', 120),
  email: z.string().trim().email().max(180),
  jobTitle: requiredText('Job title', 120),
  department: requiredText('Department', 120).default('Lighting Solutions'),
  role: roleSchema,
  weeklyCapacityHours: z.coerce.number().min(0).max(168).default(0),
  availabilityStatus: availabilityStatusSchema.default('Available'),
  initialPassword: z.string().min(12).max(200).optional(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(12).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z.string().min(1).max(200),
});

export const updateSettingsSchema = z.object({
  companyTimezone: z.string().trim().min(1).max(100).optional(),
  teamsNotificationsEnabled: z.boolean().optional(),
  projectTypes: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: requiredText('Project type name', 80),
        isActive: z.boolean(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      }),
    )
    .optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ProjectScopeItemInput = z.infer<typeof projectScopeItemInputSchema>;
export type UpdateProjectScopeInput = z.infer<typeof updateProjectScopeSchema>;
export type UpdateProjectWorkspaceSetupInput = z.infer<
  typeof updateProjectWorkspaceSetupInputSchema
>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type FullProjectEditInput = z.infer<typeof fullProjectEditSchema>;
export type ProjectStorageMarkerInput = z.infer<typeof projectStorageMarkerSchema>;
export type ProjectStorageHealthResponse = z.infer<typeof projectStorageHealthSchema>;
export type ReconnectProjectStorageInput = z.infer<typeof reconnectProjectStorageSchema>;
export interface ReconnectProjectStorageResult {
  project: Project;
  health: ProjectStorageHealthResponse;
  markerCreated: boolean;
}
export type ChangeProjectReferenceInput = z.infer<typeof changeProjectReferenceSchema>;
export type AssignProjectInput = z.infer<typeof assignProjectSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type StartTimeEntryInput = z.infer<typeof startTimeEntrySchema>;
export type CorrectTimeEntryInput = z.infer<typeof correctTimeEntrySchema>;
export type ReviewTimesheetInput = z.infer<typeof reviewTimesheetSchema>;
export type TimesheetQueryInput = z.infer<typeof timesheetQuerySchema>;
export type ProjectQueryInput = z.infer<typeof projectQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface ApiSuccess<T> {
  data: T;
  correlationId: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: Record<string, unknown>;
  };
}

// ===========================================================================
// P2.4B3A - Folder Profile catalog and template identity contracts
// ===========================================================================

export const profileFolderNodeDraftSchema: z.ZodType<ProfileFolderNodeDraft> = z.lazy(() =>
  z.object({
    profileFolderId: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(120),
    semanticRole: z.string().trim().max(120).nullable().optional(),
    children: z.array(profileFolderNodeDraftSchema).max(100),
  }),
);

export const profileFolderNodeCreateSchema: z.ZodType<ProfileFolderNodeDraft> = z.lazy(() =>
  z.object({
    name: z.string().trim().min(1).max(120),
    semanticRole: z.string().trim().max(120).nullable().optional(),
    children: z.array(profileFolderNodeCreateSchema).max(100),
  }),
);

const profileRelativeDestinationPath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !profileDestinationPathUnsafe(value), {
    message: 'Output default destinations must be relative to the profile root.',
  });

function profileDestinationPathUnsafe(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  );
}

export const profileOutputDefaultDraftSchema: z.ZodType<ProfileOutputDefaultDraft> = z.object({
  outputTypeId: z.string().trim().min(1).max(200),
  destinationPath: profileRelativeDestinationPath,
});

export const createFolderProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  folders: z.array(profileFolderNodeCreateSchema).min(1).max(100),
  outputDefaults: z.array(profileOutputDefaultDraftSchema).max(300),
});

export const updateFolderProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  folders: z.array(profileFolderNodeDraftSchema).min(1).max(100),
  outputDefaults: z.array(profileOutputDefaultDraftSchema).max(300),
});

export const setDefaultFolderProfileSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('blank') }),
    z.object({
      kind: z.literal('factory'),
      factoryProfileKey: z.string().trim().min(1).max(200),
    }),
    z.object({ kind: z.literal('user'), profileId: z.string().uuid() }),
  ])
  .or(z.object({ profileId: z.string().uuid() }));

export const importFolderProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const folderProfileParamsSchema = z.object({
  profileId: z.string().uuid(),
});

export const profileFolderNodeSchema = z.object({
  profileFolderId: z.string().trim().min(1).max(200),
  parentProfileFolderId: z.string().trim().min(1).max(200).nullable(),
  name: z.string().trim().min(1).max(120),
  displayOrder: z.coerce.number().int().min(0).max(10_000),
  semanticRole: z.string().trim().max(120).nullable().default(null),
});

export const profileOutputDefaultSchema = z.object({
  outputTypeId: z.string().trim().min(1).max(200),
  destinationProfileFolderId: z.string().trim().min(1).max(200),
});

export const folderProfileSchema = z.object({
  schemaVersion: z.enum(folderProfileSchemaVersions),
  profileId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  folders: z.array(profileFolderNodeSchema).min(1).max(300),
  outputDefaults: z.array(profileOutputDefaultSchema).max(300),
  structuralFingerprint: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const folderProfileRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blank') }),
  z.object({
    kind: z.literal('factory'),
    factoryProfileKey: z.string().trim().min(1).max(200),
  }),
  z.object({
    kind: z.literal('user'),
    profileId: z.string().trim().min(1).max(200),
  }),
]);

/**
 * Persisted Folder Profile catalog parser. Accepts both the B3A legacy shape
 * (defaultProfileId) and the P2.4B3B1A canonical shape (defaultProfileRef) and
 * always yields an in-memory catalog with a unified defaultProfileRef. Reading
 * an old catalog never rewrites it; the next legitimate catalog mutation
 * persists the new representation.
 */
export const folderProfileCatalogSchema = z
  .object({
    schemaVersion: z.enum(folderProfileSchemaVersions),
    profiles: z.array(folderProfileSchema).max(500),
    defaultProfileRef: folderProfileRefSchema.optional(),
    defaultProfileId: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .transform((catalog): FolderProfileCatalog => ({
    schemaVersion: catalog.schemaVersion,
    profiles: catalog.profiles,
    defaultProfileRef:
      catalog.defaultProfileRef ??
      (catalog.defaultProfileId
        ? { kind: 'user', profileId: catalog.defaultProfileId }
        : { kind: 'blank' }),
  }))
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const profile of catalog.profiles) {
      if (ids.has(profile.profileId)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate profile ID: ${profile.profileId}.`,
          path: ['profiles'],
        });
      }
      ids.add(profile.profileId);
      const normalized = profile.name.trim().toLowerCase();
      if (names.has(normalized)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate profile name: ${profile.name}.`,
          path: ['profiles'],
        });
      }
      names.add(normalized);
    }
    if (
      catalog.defaultProfileRef.kind === 'user' &&
      !ids.has(catalog.defaultProfileRef.profileId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Default profile must reference an existing profile.',
        path: ['defaultProfileRef'],
      });
    }
  });

export type ProfileFolderNodeDraftInput = z.infer<typeof profileFolderNodeDraftSchema>;
export type ProfileFolderNodeCreateInput = z.infer<typeof profileFolderNodeCreateSchema>;
export type ProfileOutputDefaultDraftInput = z.infer<typeof profileOutputDefaultDraftSchema>;
export type CreateFolderProfileInput = z.infer<typeof createFolderProfileSchema>;
export type UpdateFolderProfileInput = z.infer<typeof updateFolderProfileSchema>;
export type SetDefaultFolderProfileInput = z.infer<typeof setDefaultFolderProfileSchema>;
export type ImportFolderProfileInput = z.infer<typeof importFolderProfileSchema>;
export type FolderProfileRefInput = z.infer<typeof folderProfileRefSchema>;
export type FolderProfileInput = z.infer<typeof folderProfileSchema>;
export type FolderProfileCatalogInput = z.infer<typeof folderProfileCatalogSchema>;

// ===========================================================================
// P2-FND-03 — Versioned Output Template override and snapshot contracts
// ===========================================================================
// These schemas describe the presentation-only override layers and the
// fully-resolved snapshot value that P2-FND-04 will persist. They deliberately
// carry NO durable storage and NO technical-value ownership. The resolver in
// @scli/domain is the authority; these schemas validate the wire/override
// shapes and the self-contained resolved snapshot.

export const outputTemplateSectionOverrideSchema = z.object({
  sectionId: z.string().trim().min(1).max(200),
  visible: z.boolean().optional(),
  order: z.coerce.number().int().min(0).max(10_000).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const outputTemplateColumnOverrideSchema = z.object({
  columnId: z.string().trim().min(1).max(200),
  visible: z.boolean().optional(),
  order: z.coerce.number().int().min(0).max(10_000).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  width: z.coerce.number().int().min(60).max(600).optional(),
});

export const outputTemplateColumnGroupOverrideSchema = z.object({
  groupId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200).optional(),
  order: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const outputTemplateOverrideSchema = z.object({
  sections: z.array(outputTemplateSectionOverrideSchema).max(200).optional(),
  columns: z.array(outputTemplateColumnOverrideSchema).max(200).optional(),
  columnGroups: z.array(outputTemplateColumnGroupOverrideSchema).max(100).optional(),
  paperSize: z.enum(pdfPaperSizes).optional(),
  orientation: z.enum(outputOrientations).optional(),
  rowDensity: z.enum(outputRowDensities).optional(),
  productsPerPage: z.coerce.number().int().min(1).max(12).optional(),
  imageSettings: z
    .object({
      visible: z.boolean().optional(),
      width: z.coerce.number().int().min(60).max(600).optional(),
    })
    .optional(),
  headerSettings: z.object({ visible: z.boolean().optional() }).optional(),
  footerSettings: z.object({ visible: z.boolean().optional() }).optional(),
  logoVisible: z.boolean().optional(),
});

const technicalScheduleColumnOverrideSchema = outputTemplateColumnOverrideSchema
  .omit({ label: true })
  .refine(
    (column) =>
      column.visible !== undefined || column.order !== undefined || column.width !== undefined,
    'A Schedule column override must change visibility, order, or width.',
  );

const technicalBoqColumnOverrideSchema = outputTemplateColumnOverrideSchema
  .omit({ label: true })
  .refine(
    (column) =>
      column.visible !== undefined || column.order !== undefined || column.width !== undefined,
    'A Technical BOQ column override must change visibility, order, or width.',
  );

/** Narrow Phase-2 project override; advanced template settings remain read-only. */
export const updateTechnicalScheduleConfigSchema = z
  .object({
    templateId: z.string().trim().min(1).max(200).optional(),
    templateVersionId: z.string().trim().min(1).max(200).optional(),
    columns: z.array(technicalScheduleColumnOverrideSchema).max(200).optional(),
    paperSize: z.enum(pdfPaperSizes).optional(),
  })
  .superRefine((input, context) => {
    if ((input.templateId === undefined) !== (input.templateVersionId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Template ID and Template Version ID must be supplied together.',
        path: ['templateId'],
      });
    }
    if (
      input.templateId === undefined &&
      input.columns === undefined &&
      input.paperSize === undefined
    ) {
      context.addIssue({ code: 'custom', message: 'No Schedule configuration change supplied.' });
    }
  });

export const technicalScheduleWorkspaceQuerySchema = z.object({
  revisionId: z.string().uuid().optional(),
  /**
   * Advisory composition target (C1). Read-only: it only asks the server to
   * classify one candidate target Revision. It never selects a snapshot and
   * never grants generation authority.
   */
  targetRevisionId: z.string().uuid().optional(),
});

export const generateTechnicalScheduleSchema = z
  .object({
    format: z.enum(['XLSX', 'PDF', 'Both']).optional(),
    issueStatus: z.string().trim().min(1).max(100).default('Preliminary'),
    issueDate: z
      .string()
      .date()
      .default(() => new Date().toISOString().slice(0, 10)),
    recoveryRevisionId: z.string().uuid().optional(),
    /**
     * C1 targeted generation. When present the Output is generated INTO this
     * existing PREPARING composed Revision instead of reserving a new one. The
     * client only names the target — the server re-verifies eligibility.
     */
    targetRevisionId: z.string().uuid().optional(),
  })
  .superRefine((input, context) => {
    if (!input.format && !input.recoveryRevisionId) {
      context.addIssue({
        code: 'custom',
        message: 'Schedule format is required for a new generation.',
        path: ['format'],
      });
    }
    if (input.targetRevisionId && input.recoveryRevisionId) {
      context.addIssue({
        code: 'custom',
        message:
          'Targeted generation and Output recovery are mutually exclusive: supply either targetRevisionId or recoveryRevisionId.',
        path: ['targetRevisionId'],
      });
    }
  });

/** Narrow Technical BOQ override; orientation and header/footer remain template-owned. */
export const updateTechnicalBoqConfigSchema = z
  .object({
    templateId: z.string().trim().min(1).max(200).optional(),
    templateVersionId: z.string().trim().min(1).max(200).optional(),
    columns: z.array(technicalBoqColumnOverrideSchema).max(200).optional(),
    paperSize: z.enum(pdfPaperSizes).optional(),
    reset: z.literal(true).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.templateId === undefined) !== (input.templateVersionId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Template ID and Template Version ID must be supplied together.',
        path: ['templateId'],
      });
    }
    if (
      input.templateId === undefined &&
      input.columns === undefined &&
      input.paperSize === undefined &&
      input.reset === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'No Technical BOQ configuration change supplied.',
      });
    }
    if (input.reset && (input.columns !== undefined || input.paperSize !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Reset cannot be combined with column or paper-size overrides.',
        path: ['reset'],
      });
    }
  });

export const technicalBoqWorkspaceQuerySchema = z.object({
  revisionId: z.string().uuid().optional(),
  /** Advisory composition target (C1). See technicalScheduleWorkspaceQuerySchema. */
  targetRevisionId: z.string().uuid().optional(),
});

export const generateTechnicalBoqSchema = z
  .object({
    format: z.enum(['XLSX', 'PDF', 'Both']).optional(),
    issueStatus: z.string().trim().min(1).max(100).default('Preliminary'),
    issueDate: z
      .string()
      .date()
      .default(() => new Date().toISOString().slice(0, 10)),
    recoveryRevisionId: z.string().uuid().optional(),
    /** C1 targeted generation. See generateTechnicalScheduleSchema. */
    targetRevisionId: z.string().uuid().optional(),
  })
  .superRefine((input, context) => {
    if (!input.format && !input.recoveryRevisionId) {
      context.addIssue({
        code: 'custom',
        message: 'Technical BOQ format is required for a new generation.',
        path: ['format'],
      });
    }
    if (input.targetRevisionId && input.recoveryRevisionId) {
      context.addIssue({
        code: 'custom',
        message:
          'Targeted generation and Output recovery are mutually exclusive: supply either targetRevisionId or recoveryRevisionId.',
        path: ['targetRevisionId'],
      });
    }
  });

const p4dPageOptionsSchema = z
  .object({
    pageSize: z.enum(['A4', 'A3']),
    orientation: z.enum(['Portrait', 'Landscape']),
    productsPerPage: z
      .union([z.literal(2), z.literal(3), z.literal(4)])
      .nullable()
      .optional(),
  })
  .strict();

/** Read-only P4D resolver request. Preview never allocates a Revision or Output identity. */
export const p4dOutputPreviewSchema = z
  .object({
    outputKind: z.enum(outputFamilies),
    format: z.enum(['PDF', 'XLSX']),
    templateId: z.string().trim().min(1).max(200).optional(),
    templateVersionId: z.string().trim().min(1).max(200).optional(),
    issueStatus: z.string().trim().min(1).max(100).default('Preliminary'),
    issueDate: z.string().date(),
    targetRevisionId: z.string().uuid().optional(),
    options: p4dPageOptionsSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.templateId === undefined) !== (input.templateVersionId === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Template ID and Template Version ID must be supplied together.',
        path: ['templateId'],
      });
    }
  });

/** P4D Generate is authorized only by a fresh backend Preview fingerprint. */
export const p4dOutputGenerateSchema = p4dOutputPreviewSchema.extend({
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const resolveOutputTemplateRequestSchema = z.object({
  templateId: z.string().trim().min(1).max(200),
  versionId: z.string().trim().min(1).max(200).optional(),
  requestedFamily: z.enum(outputFamilies),
  globalConfig: outputTemplateOverrideSchema.optional(),
  projectOverride: outputTemplateOverrideSchema.optional(),
  generationOverride: outputTemplateOverrideSchema.optional(),
  allowInactive: z.boolean().optional(),
});

export const outputTemplateColumnGroupSchema = z.object({
  groupId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  order: z.coerce.number().int().min(0).max(10_000),
});

export const outputTemplateColumnSchema = z.object({
  columnId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  visible: z.boolean(),
  order: z.coerce.number().int().min(0).max(10_000),
  width: z.coerce.number().int().min(60).max(600),
  fieldKey: z.string().trim().min(1).max(200),
  groupId: z.string().trim().min(1).max(200).nullable(),
});

export const outputTemplateSectionSchema = z.object({
  sectionId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  visible: z.boolean(),
  order: z.coerce.number().int().min(0).max(10_000),
  config: z.record(z.string(), z.unknown()),
  mandatory: z.boolean(),
});

export const resolvedOutputTemplateSchema = z.object({
  templateId: z.string().trim().min(1).max(200),
  versionId: z.string().trim().min(1).max(200),
  family: z.enum(outputFamilies),
  origin: z.enum(templateOrigins),
  state: z.enum(templateStates),
  displayName: z.string().trim().min(1).max(200),
  sections: z.array(outputTemplateSectionSchema).min(1).max(200),
  columnGroups: z.array(outputTemplateColumnGroupSchema).max(100),
  columns: z.array(outputTemplateColumnSchema).max(200),
  paperSize: z.enum(pdfPaperSizes),
  orientation: z.enum(outputOrientations),
  rowDensity: z.enum(outputRowDensities),
  productsPerPage: z.coerce.number().int().min(1).max(12).nullable(),
  imageSettings: z.object({
    visible: z.boolean(),
    width: z.coerce.number().int().min(60).max(600),
  }),
  headerSettings: z.object({ visible: z.boolean() }),
  footerSettings: z.object({ visible: z.boolean() }),
  logoVisible: z.boolean(),
  nonPriced: z.boolean(),
  supportedFormats: z
    .array(z.enum(['PDF', 'XLSX']))
    .max(2)
    .optional(),
  rendererIdentity: z.string().trim().min(1).max(200).optional(),
  layoutContractVersion: z.string().trim().min(1).max(100).optional(),
});

// ===========================================================================
// P2-FND-04 — Canonical Revision / Output / Package registry write contracts
// ===========================================================================

const preservedNonBlankText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'Value must not be blank.');

const canonicalUuidText = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

/** Immutable project state embedded in a new canonical Revision. */
export const canonicalProjectSnapshotSchema = z
  .object({
    id: canonicalUuidText,
    projectCode: preservedNonBlankText(120),
    projectName: preservedNonBlankText(300),
    clientName: z.string().max(300),
    projectType: z.string().max(200),
    status: preservedNonBlankText(120),
    updatedAt: z.string().datetime(),
  })
  .passthrough();

/**
 * UUID-aware historical Luminaire state. The exact Tag is preserved without
 * trimming; technical values remain project data, never template config.
 */
export const canonicalLuminaireSnapshotSchema = z.object({
  luminaireId: canonicalUuidText,
  tag: preservedNonBlankText(120),
  category: z.string().max(300),
  imagePath: z.string().max(4_000),
  description: z.string().max(8_000),
  manufacturer: z.string().max(300),
  model: z.string().max(300),
  productType: z.string().max(300).optional(),
  variantLabel: z.string().max(300).optional(),
  orderingCode: z.string().max(500).optional(),
  wattage: z.string().max(300),
  lumens: z.string().max(300),
  lightColor: z.string().max(300),
  cri: z.string().max(300),
  beamAngle: z.string().max(300),
  ipRating: z.string().max(300),
  mounting: z.string().max(300),
  cutout: z.string().max(300),
  driver: z.string().max(300),
  control: z.string().max(300),
  emergency: z.string().max(300),
  datasheetPath: z.string().max(4_000),
  location: z.string().max(2_000),
  unit: z.string().max(120),
  quantity: z.number().finite().min(0),
  notes: z.string().max(8_000),
  sourceName: z.string().max(500),
  dimensions: z.string().max(500),
  bodyColorFinish: z.string().max(500),
  attachmentReferences: z.array(z.string().max(4_000)).max(500).default([]),
});

export const createCanonicalRevisionSchema = z.object({
  projectId: canonicalUuidText,
  projectSnapshot: canonicalProjectSnapshotSchema,
  luminaires: z.array(canonicalLuminaireSnapshotSchema).max(20_000),
  purpose: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((value) => value || null)
    .default(null),
  internalNote: z
    .string()
    .trim()
    .max(8_000)
    .nullable()
    .transform((value) => value || null)
    .default(null),
  createdBy: z.object({
    actorId: preservedNonBlankText(300),
    actorNameSnapshot: preservedNonBlankText(300),
  }),
});

export const createCanonicalOutputSchema = z.object({
  revisionId: canonicalUuidText,
  outputFamily: z.enum(outputFamilies),
  outputFormat: preservedNonBlankText(40),
  relativePath: preservedNonBlankText(4_000),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .default(null),
  resolvedTemplate: resolvedOutputTemplateSchema,
});

export const createCanonicalIssuePackageSchema = z.object({
  revisionId: canonicalUuidText,
  label: preservedNonBlankText(300),
  artifactRelativePath: preservedNonBlankText(4_000).nullable().default(null),
  manifestRelativePath: preservedNonBlankText(4_000).nullable().default(null),
  /**
   * PACKAGES-E2E-04B — optional server-supplied package identity. When the
   * caller has already reserved a packageId (to derive an internal
   * package-scoped manifest path), the store honours it instead of minting a
   * fresh one. Never accepted from a client payload.
   */
  packageId: canonicalUuidText.optional(),
  /**
   * Server-derived Issue audit authority (V4-ISSUE-A0). Never accepted from a client
   * payload: the API layer derives these from the authenticated actor and the
   * canonical clock, and the service boundary requires them for Issued packages.
   * Draft packages pass null for both.
   */
  issuedBy: z
    .object({
      actorId: preservedNonBlankText(300),
      actorNameSnapshot: preservedNonBlankText(300),
    })
    .nullable()
    .default(null),
  issuedAt: z.string().datetime().nullable().default(null),
});

export const outputTemplateSelectionSchema = z.object({
  outputFamily: z.enum(outputFamilies),
  templateId: preservedNonBlankText(200),
  versionId: preservedNonBlankText(200),
  config: outputTemplateOverrideSchema.default({}),
});

export type OutputTemplateSectionOverrideInput = z.infer<
  typeof outputTemplateSectionOverrideSchema
>;
export type OutputTemplateColumnOverrideInput = z.infer<typeof outputTemplateColumnOverrideSchema>;
export type OutputTemplateColumnGroupOverrideInput = z.infer<
  typeof outputTemplateColumnGroupOverrideSchema
>;
export type OutputTemplateOverrideInput = z.infer<typeof outputTemplateOverrideSchema>;
export type UpdateTechnicalScheduleConfigInput = z.infer<
  typeof updateTechnicalScheduleConfigSchema
>;
export type TechnicalScheduleWorkspaceQueryInput = z.infer<
  typeof technicalScheduleWorkspaceQuerySchema
>;
export type GenerateTechnicalScheduleInput = z.infer<typeof generateTechnicalScheduleSchema>;
export type UpdateTechnicalBoqConfigInput = z.infer<typeof updateTechnicalBoqConfigSchema>;
export type TechnicalBoqWorkspaceQueryInput = z.infer<typeof technicalBoqWorkspaceQuerySchema>;
export type GenerateTechnicalBoqInput = z.infer<typeof generateTechnicalBoqSchema>;
export type P4dOutputPreviewInput = z.infer<typeof p4dOutputPreviewSchema>;
export type P4dOutputGenerateInput = z.infer<typeof p4dOutputGenerateSchema>;
export type ResolveOutputTemplateRequestInput = z.infer<typeof resolveOutputTemplateRequestSchema>;
export type ResolvedOutputTemplateInput = z.infer<typeof resolvedOutputTemplateSchema>;
export type CanonicalProjectSnapshotInput = z.infer<typeof canonicalProjectSnapshotSchema>;
export type CanonicalLuminaireSnapshotInput = z.infer<typeof canonicalLuminaireSnapshotSchema>;
export type CreateCanonicalRevisionInput = z.input<typeof createCanonicalRevisionSchema>;
export type CreateCanonicalOutputInput = z.infer<typeof createCanonicalOutputSchema>;
export type CreateCanonicalIssuePackageInput = z.infer<typeof createCanonicalIssuePackageSchema>;
export type OutputTemplateSelectionInput = z.infer<typeof outputTemplateSelectionSchema>;

// ===========================================================================
// B0 — Revision Deliverable Foundation (V4-REVISION-DELIVERABLE-B0)
// ===========================================================================

/**
 * Request to add an immutable Document Snapshot deliverable to a PREPARING
 * canonical Revision. The client supplies only the stable operational
 * Project Document UUID and an optional display title; the Revision is taken
 * from the route path (never from the body) and the server resolves the
 * source through existing project authority — it never accepts an arbitrary
 * absolute path.
 */
export const createRevisionDocumentSnapshotSchema = z.object({
  sourceDocumentId: canonicalUuidText,
  title: z.string().trim().max(300).optional(),
});

/**
 * Request to remove a Document Snapshot deliverable from a PREPARING canonical
 * Revision.
 */
export const removeRevisionDocumentSnapshotSchema = z.object({
  deliverableId: canonicalUuidText,
});

/**
 * Request to finalize a PREPARING canonical Revision through the B0 manual
 * workflow. At least one immutable Deliverable (a canonical generated Output OR
 * an immutable Document Snapshot) must exist.
 */
export const finalizeRevisionDeliverablesSchema = z.object({
  revisionId: canonicalUuidText,
});

const revisionPurposeInputSchema = z
  .string()
  .trim()
  .max(500, 'Revision Purpose must be 500 characters or fewer.')
  .nullable()
  .transform((value) => value || null);

const revisionInternalNoteInputSchema = z
  .string()
  .trim()
  .max(8_000, 'Internal Note must be 8000 characters or fewer.')
  .nullable()
  .transform((value) => value || null);

/** Optional metadata accepted while preparing a new manual Revision. */
export const prepareRevisionSchema = z
  .object({
    purpose: revisionPurposeInputSchema.optional().default(null),
    internalNote: revisionInternalNoteInputSchema.optional().default(null),
  })
  .strict();

/** Exact canonical metadata patch. Omitted fields retain their persisted value. */
export const updateRevisionMetadataSchema = z
  .object({
    purpose: revisionPurposeInputSchema.optional(),
    internalNote: revisionInternalNoteInputSchema.optional(),
  })
  .strict()
  .refine((input) => input.purpose !== undefined || input.internalNote !== undefined, {
    message: 'At least one Revision metadata field is required.',
  });

/** Idempotent duplication of an immutable Revision into a new composed draft. */
export const duplicateRevisionSchema = z
  .object({
    requestId: canonicalUuidText,
    expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();
export type DuplicateRevisionInput = z.infer<typeof duplicateRevisionSchema>;

export type PrepareRevisionInput = z.input<typeof prepareRevisionSchema>;
export type UpdateRevisionMetadataInput = z.input<typeof updateRevisionMetadataSchema>;

/** P2C-04 — explicit reuse claim; all Revision identity/number authority is server-derived. */
export const revisionReuseInputSchema = z
  .object({
    deleteOperationId: z.string().uuid(),
    reason: z.string().trim().min(1, 'Reason is required.').max(500, 'Reason is too long.'),
  })
  .strict();

export type RevisionReuseInput = z.infer<typeof revisionReuseInputSchema>;

export type CreateRevisionDocumentSnapshotInput = z.infer<
  typeof createRevisionDocumentSnapshotSchema
>;
export type RemoveRevisionDocumentSnapshotInput = z.infer<
  typeof removeRevisionDocumentSnapshotSchema
>;
export type FinalizeRevisionDeliverablesInput = z.infer<typeof finalizeRevisionDeliverablesSchema>;

// ===========================================================================
// PACKAGES-E2E-05A — Datasheet Eligibility + Canonical Revision Intake
// ===========================================================================

/**
 * PACKAGES-E2E-05A — admit one selected hashed Luminaire Datasheet AssetVersion
 * into a canonical PREPARING MANUAL_DELIVERABLES Revision as an immutable
 * Datasheet DocumentSnapshot. The client supplies ONLY the stable
 * LuminaireAssetVersion UUID; the server re-resolves the project, Revision,
 * asset type, Luminaire ownership, file presence, stored hash, current bytes,
 * and already-in-Revision state at mutation time. No filePath / fileHash /
 * luminaire metadata / title override is accepted (strict non-passthrough).
 */
export const addDatasheetDeliverableSchema = z
  .object({
    assetVersionId: canonicalUuidText,
  })
  .strict();

export type AddDatasheetDeliverableInput = z.infer<typeof addDatasheetDeliverableSchema>;

// ===========================================================================
// Phase 4A — Integration / Automation Context Foundation
// ===========================================================================

export const automationApplicationSchema = z.enum(['AUTOCAD', 'DIALUX']);
export const p4cArtifactTypeSchema = z.enum([
  'DIALUX_REPORT',
  'CAD_LAYOUT_PDF',
  'CAD_WORKING_DRAWING',
]);
export const desktopHandoffActionSchema = z.enum([
  'LAUNCH_TOOL',
  'OPEN_EXPORT_FOLDER',
  'TEST_LAUNCH',
  'MANUAL_FILE_PICK',
  'SELECT_IMPORT_SOURCE',
  'SELECT_DOCUMENT_PDF',
  'SELECT_PROJECT_SOURCE',
  'OPEN_CAPTURE_FILE',
  'REVEAL_CAPTURE_FILE',
  'OPEN_LUMINAIRE_ASSET',
  'OPEN_REVISION_DELIVERABLE',
  'OPEN_PACKAGE_DELIVERABLE',
  'OPEN_LIBRARY_ASSET',
  'SAVE_LUMINAIRE_ASSET_COPY',
]);

/** Opens one explicit Project-bound external-tool context. */
export const openAutomationContextSchema = z
  .object({
    application: automationApplicationSchema,
    expectedArtifactType: z.string().trim().min(1).max(100),
    targetRevisionId: canonicalUuidText.nullable().optional().default(null),
    sourceDocumentId: canonicalUuidText.nullable().optional().default(null),
  })
  .strict();

export const automationProjectParamsSchema = z.object({ projectId: canonicalUuidText }).strict();
export const automationContextParamsSchema = z
  .object({ toolContextId: canonicalUuidText })
  .strict();

export type AutomationApplication = z.infer<typeof automationApplicationSchema>;
export type OpenAutomationContextInput = z.input<typeof openAutomationContextSchema>;

// ===========================================================================
// Phase 4C — contextual workflow + opaque Desktop handoffs
// ===========================================================================

export const startToolSessionSchema = z
  .object({
    application: automationApplicationSchema,
    artifactType: p4cArtifactTypeSchema,
    targetRevisionId: canonicalUuidText.nullable().optional().default(null),
    sourceDocumentId: canonicalUuidText.nullable().optional().default(null),
  })
  .strict();

export const toolSessionReadSchema = z.object({
  toolContextId: canonicalUuidText,
  projectId: canonicalUuidText,
  application: automationApplicationSchema,
  artifactType: p4cArtifactTypeSchema,
  targetRevisionId: canonicalUuidText.nullable(),
  targetRevisionLabel: z.string().nullable(),
  sourceDocumentId: canonicalUuidText.nullable(),
  sourceFileName: z.string().nullable(),
  exportFolder: z.string().optional(),
  state: z.enum(['LIVE', 'REBOUND', 'EXPIRED', 'CLOSED']),
  startedAt: z.string().datetime(),
});

export const desktopHandoffSchema = z.object({
  handoffId: canonicalUuidText,
  action: desktopHandoffActionSchema,
  expiresAt: z.string().datetime(),
});

export const startToolSessionResponseSchema = z.object({
  toolSession: toolSessionReadSchema,
  reusedExisting: z.boolean(),
  launchHandoff: desktopHandoffSchema,
});

export const fileHandoffInputSchema = z.object({ action: z.enum(['OPEN', 'REVEAL']) }).strict();
export const testIntegrationLaunchSchema = z
  .object({ application: automationApplicationSchema })
  .strict();
export const discardCaptureSchema = z
  .object({
    reason: z.enum(['OUTPUT_NO_LONGER_REQUIRED', 'REPLACED_BY_NEW_TOOL_SESSION', 'INVALID_EXPORT']),
  })
  .strict();
export const outputMappingParamsSchema = z
  .object({
    projectId: canonicalUuidText,
    outputTypeId: z.enum(['dialuxReport', 'cadLayoutPdf', 'cadWorkingDrawing']),
  })
  .strict();
export const updateOutputMappingSchema = z
  .object({
    destinationFolderId: canonicalUuidText,
    expectedFingerprint: z.string().min(1).max(128),
  })
  .strict();
export const createManualCaptureContextSchema = z
  .object({
    artifactType: p4cArtifactTypeSchema,
    targetRevisionId: canonicalUuidText.nullable().optional().default(null),
  })
  .strict();
export const manualCaptureContextResponseSchema = z.object({
  toolSession: toolSessionReadSchema,
  pickerHandoff: desktopHandoffSchema,
});

export type P4cArtifactType = z.infer<typeof p4cArtifactTypeSchema>;
export type DesktopHandoffAction = z.infer<typeof desktopHandoffActionSchema>;
export type DesktopHandoff = z.infer<typeof desktopHandoffSchema>;
export type ToolSessionRead = z.infer<typeof toolSessionReadSchema>;
export type StartToolSessionInput = z.input<typeof startToolSessionSchema>;
export type StartToolSessionResponse = z.infer<typeof startToolSessionResponseSchema>;
export type FileHandoffInput = z.infer<typeof fileHandoffInputSchema>;
export type DiscardCaptureInput = z.infer<typeof discardCaptureSchema>;
export type UpdateOutputMappingInput = z.infer<typeof updateOutputMappingSchema>;
export type CreateManualCaptureContextInput = z.input<typeof createManualCaptureContextSchema>;
export type ManualCaptureContextResponse = z.infer<typeof manualCaptureContextResponseSchema>;

// ===========================================================================
// Phase 4B — safe capture read/retry API contracts
// ===========================================================================

export const captureListQuerySchema = z
  .object({
    toolContextId: z.string().uuid().optional(),
    state: z.enum(captureStates).optional(),
    view: z.enum(['attention', 'recent']).optional().default('attention'),
    application: automationApplicationSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    page: z.coerce.number().int().min(0).default(0),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const captureParamsSchema = z.object({ captureId: z.string().uuid() }).strict();
export const projectDocumentFileHandoffParamsSchema = z
  .object({ projectId: z.string().uuid(), documentId: z.string().uuid() })
  .strict();
export const emptyCaptureRetrySchema = z.object({}).strict();

export const captureReadModelSchema = z.object({
  captureId: z.string().uuid(),
  sourceFileName: z.string().min(1).max(260),
  project: z.object({ id: z.string().uuid(), code: z.string(), name: z.string() }),
  targetRevision: z
    .object({ id: z.string().uuid(), label: z.string().nullable(), state: z.string().nullable() })
    .nullable(),
  application: z.enum(['AUTOCAD', 'DIALUX']),
  artifactType: z.enum(['DIALUX_REPORT', 'CAD_LAYOUT_PDF', 'CAD_WORKING_DRAWING']),
  outputMappingId: z.enum(['dialuxReport', 'cadLayoutPdf', 'cadWorkingDrawing']),
  state: z.enum(captureStates),
  routingDecision: z.enum(['AUTO_APPROVED', 'USER_CONFIRMED', 'REJECTED']).nullable(),
  routingReason: z.string().nullable(),
  structuredReason: z
    .object({ code: z.string().min(1).max(100), summary: z.string().min(1).max(240) })
    .nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  milestones: z.object({
    detectedAt: z.string().datetime(),
    stagedAt: z.string().datetime().nullable(),
    admittedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    decidedAt: z.string().datetime().nullable(),
  }),
  finalProjectRelativeLocator: z.string().nullable(),
  artifactId: z.string().uuid().nullable(),
  versionId: z.string().uuid().nullable(),
  artifactVersion: z.number().int().positive().nullable(),
  reusedExisting: z.boolean(),
  allowedRecoveryActions: z.array(
    z.enum([
      'RETRY',
      'RECONNECT_STORAGE',
      'CONFIGURE_OUTPUT_FILING',
      'START_NEW_TOOL_SESSION',
      'DISCARD',
      'OPEN',
      'REVEAL',
    ]),
  ),
});

export const captureListResponseSchema = z.object({
  items: z.array(captureReadModelSchema),
  nextCursor: z.string().uuid().nullable(),
  totalCount: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  page: z.number().int().nonnegative(),
});

export type CaptureListQuery = z.infer<typeof captureListQuerySchema>;
export type CaptureReadModel = z.infer<typeof captureReadModelSchema>;
export type CaptureListResponse = z.infer<typeof captureListResponseSchema>;

// ===========================================================================
// Phase 5D — Project Intelligence & Productivity (P5D)
// ===========================================================================
// All P5D routes are Project-scoped and server-authoritative. Renderer-supplied
// filesystem paths are never accepted for mutation; source files are admitted
// through the governed desktop picker handoff and resolved/validated server-side.
// Revision selectors resolve to exact UUIDs; Revision numbers are display only.

const p5dNullableDate = z.string().date().nullable().default(null);
const p5dOptionalUuid = z.string().uuid().nullable().default(null);
const p5dLongText = z.string().trim().max(8_000).default('');

export const projectSourceFileTypeSchema = z.enum(['AUTOCAD', 'DIALUX', 'EXCEL', 'OTHER']);

/** Readiness always targets an exact Revision UUID. */
export const readinessQuerySchema = z
  .object({
    revisionId: z.string().uuid(),
  })
  .strict();

/** Revision Comparison targets two exact Revision UUIDs. */
export const revisionComparisonQuerySchema = z
  .object({
    fromRevisionId: z.string().uuid(),
    toRevisionId: z.string().uuid(),
  })
  .strict();

/** Register ONE controlled source file admitted through the desktop picker. */
export const registerProjectSourceFileSchema = z
  .object({
    sourceType: projectSourceFileTypeSchema,
    /**
     * Opaque admission id returned by the create-source-handoff route. The
     * server maps it to the picked file; no path is accepted from the renderer.
     */
    admissionId: z.string().uuid(),
  })
  .strict();

export const projectSourceParamsSchema = z
  .object({
    projectId: z.string().uuid(),
    sourceId: z.string().uuid(),
  })
  .strict();

/** Captures an immutable baseline for an exact Revision UUID. */
export const captureSourceBaselineSchema = z
  .object({
    sourceId: z.string().uuid(),
    revisionId: z.string().uuid(),
  })
  .strict();

export const sourceBaselineParamsSchema = z
  .object({
    projectId: z.string().uuid(),
    revisionId: z.string().uuid(),
  })
  .strict();

/** Sparse Action patch carrying row_version for optimistic concurrency. */
export const patchProjectActionSchema = z
  .object({
    rowVersion: z.coerce.number().int().min(1),
    title: z.string().trim().min(1).max(300).optional(),
    details: p5dLongText.optional(),
    owner: z.string().trim().max(180).optional(),
    ownerRole: z.string().trim().max(180).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    dueDate: p5dNullableDate.optional(),
    status: z.enum(['Open', 'InProgress', 'Waiting', 'Completed', 'Cancelled']).optional(),
    priority: z.enum(priorities).optional(),
    notes: p5dLongText.optional(),
    blocksIssue: z.boolean().optional(),
    area: z.string().trim().max(500).optional(),
    luminaireId: z.string().uuid().nullable().optional(),
    reviewItemId: z.string().uuid().nullable().optional(),
    revisionId: p5dOptionalUuid.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, {
    message: 'At least one Action field is required.',
  });

export type P5dReadinessQuery = z.infer<typeof readinessQuerySchema>;
export type P5dRevisionComparisonQuery = z.infer<typeof revisionComparisonQuerySchema>;
export type RegisterProjectSourceFileInput = z.infer<typeof registerProjectSourceFileSchema>;
export type CaptureSourceBaselineInput = z.infer<typeof captureSourceBaselineSchema>;
export type PatchProjectActionInput = z.infer<typeof patchProjectActionSchema>;

export * from './luminaire-studio.js';
export * from './datasheet-images.js';
export * from './local-ai.js';
export * from './datasheet-confirmation.js';
