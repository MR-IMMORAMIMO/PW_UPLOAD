import { z } from 'zod';
import {
  communicationKinds,
  deliverableStatuses,
  documentCategories,
  documentStatuses,
  luminaireInputModes,
  luminaireAssetTypes,
  meetingStatuses,
  meetingActionRelationTypes,
  pdfPaperSizes,
  priorities,
  projectServiceCodes,
  projectStatuses,
  designStages,
  requirementImpacts,
  requirementStatuses,
  projectTagColorKeys,
  actionCategoryIconKeys,
  v4PaletteColorKeys,
  scopeNoteTypes,
  revisionPackageOutputModes,
  revisionPackageStatuses,
  revisionStatuses,
  reviewItemStatuses,
  workspaceItemStatuses,
  workspaceSourceTypes,
  outputRegistryLifecycleStates,
  type FolderNodePreset,
} from '@scli/domain';

const optionalDate = z.string().date().nullable();
const safeLocalPath = z.string().trim().min(1).max(1_024);
const relativeFolderPath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !pathIsUnsafe(value), {
    message: 'Output folders must be relative to the project folder.',
  });

function pathIsUnsafe(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  );
}

export const folderNodeSchema: z.ZodType<FolderNodePreset> = z.lazy(() =>
  z.object({
    name: z.string().trim().min(1).max(120),
    children: z.array(folderNodeSchema).max(100),
  }),
);

export const projectOutputFoldersSchema = z.object({
  scheduleExcel: relativeFolderPath,
  schedulePdf: relativeFolderPath,
  boqExcel: relativeFolderPath,
  boqPdf: relativeFolderPath,
  datasheets: relativeFolderPath,
});

export const saveFolderProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default('Custom project folder structure.'),
  folders: z.array(folderNodeSchema).min(1).max(100),
  outputFolders: projectOutputFoldersSchema,
});

export const personalSettingsSchema = z.object({
  projectRoot: safeLocalPath.optional(),
  defaultFolderProfile: z.string().trim().min(1).max(120).optional(),
  defaultInputMode: z.enum(luminaireInputModes).optional(),
  autoOpenProjectFolder: z.boolean().optional(),
  designerName: z.string().trim().min(1).max(120).optional(),
  companyName: z.string().trim().min(1).max(160).optional(),
  companyLogoPath: z.string().trim().max(1_024).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  backupRetention: z.coerce.number().int().min(3).max(100).optional(),
});

export const personalSalesContactSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(180).optional(),
});

export const scheduleRestoreSchema = z.object({
  backupPath: safeLocalPath,
});

export const legacyProjectPreviewSchema = z.object({
  rootPath: z.string().trim().min(1).max(2_048),
});

export const legacyProjectFolderScanSchema = z.object({
  folderPaths: z.array(z.string().trim().min(1).max(2_048)).min(1).max(100),
});

export const legacyProjectImportSchema = z
  .object({
    rootPath: z.string().trim().min(1).max(2_048),
    projects: z
      .array(
        z.object({
          folderName: z.string().trim().min(1).max(300),
          folderPath: z.string().trim().min(1).max(2_048),
          projectCode: z.string().trim().min(1).max(300),
          projectName: z.string().trim().min(1).max(180),
          clientName: z.string().trim().min(1).max(180).default('Not recorded'),
          projectType: z.string().trim().min(1).max(120).default('Legacy Project'),
          crmReference: z
            .union([z.string().trim().max(200), z.null()])
            .transform((value) => (value === null || value.trim() === '' ? null : value.trim()))
            .optional(),
          commercialValueMinor: z
            .number()
            .int('Commercial value must use integer minor units.')
            .min(0, 'Commercial value cannot be negative.')
            .max(Number.MAX_SAFE_INTEGER, 'Commercial value exceeds the safe integer range.')
            .nullable()
            .optional(),
          commercialCurrency: z
            .string()
            .regex(/^[A-Z]{3}$/, 'Commercial currency must be an uppercase three-letter code.')
            .nullable()
            .optional(),
          actualHours: z.coerce.number().min(0).max(100_000).optional(),
          salesOwnerId: z.string().uuid().nullable().default(null),
          status: z.enum(projectStatuses).default('Archived'),
          services: z
            .array(z.enum(projectServiceCodes))
            .min(1)
            .max(projectServiceCodes.length)
            .default(['LuminaireSchedule', 'TechnicalBoq', 'Datasheets']),
          siteLocation: z.string().trim().min(1).max(180).default('Not recorded'),
          designStage: z.enum(designStages).default('AsBuilt'),
          lightingScope: z.string().trim().min(1).max(500).default('Legacy lighting project'),
          priority: z.enum(priorities).default('Normal'),
          createdDate: z.string().date(),
          requiredDeliveryDate: z.string().date(),
          indexFiles: z.boolean().default(true),
        }),
      )
      .min(1)
      .max(250),
  })
  .superRefine((value, context) => {
    for (const [index, project] of value.projects.entries()) {
      const amountState =
        project.commercialValueMinor === undefined
          ? 'omitted'
          : project.commercialValueMinor === null
            ? 'null'
            : 'populated';
      const currencyState =
        project.commercialCurrency === undefined
          ? 'omitted'
          : project.commercialCurrency === null
            ? 'null'
            : 'populated';
      if (amountState !== currencyState) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Commercial value and currency must both be omitted, both be null, or both be populated.',
          path: ['projects', index, 'commercialValueMinor'],
        });
      }
    }
  });

export const removeProjectFromWorkspaceSchema = z.object({
  confirmation: z.string().trim().min(1).max(300),
});

export const initializeProjectWorkspaceSchema = z.object({
  services: z.array(z.enum(projectServiceCodes)).min(1).max(projectServiceCodes.length),
  folderProfile: z.string().trim().min(1).max(120),
  inputMode: z.enum(luminaireInputModes).default('Later'),
  createFolders: z.boolean().default(true),
  projectRoot: safeLocalPath.optional(),
  folderStructure: z.array(folderNodeSchema).min(1).max(100).optional(),
  outputFolders: projectOutputFoldersSchema.optional(),
});

export const createProjectFoldersSchema = z.object({
  projectRoot: safeLocalPath.optional(),
  folderProfile: z.string().trim().min(1).max(120).optional(),
  folderStructure: z.array(folderNodeSchema).min(1).max(100).optional(),
  outputFolders: projectOutputFoldersSchema.optional(),
});

export const updateProjectWorkspaceSetupSchema = z.object({
  services: z.array(z.enum(projectServiceCodes)).min(1).max(projectServiceCodes.length),
  folderProfile: z.string().trim().min(1).max(120),
  folderStructure: z.array(folderNodeSchema).min(1).max(100),
  outputFolders: projectOutputFoldersSchema,
  connectFolderPath: safeLocalPath.optional(),
  ensureFolders: z.boolean().default(false),
});

export const updateDeliverableSchema = z.object({
  status: z.enum(deliverableStatuses).optional(),
  progressPercent: z.coerce.number().int().min(0).max(100).optional(),
  dueDate: optionalDate.optional(),
});

export const luminaireRecordSchema = z.object({
  tag: z.string().trim().min(1).max(40),
  category: z.string().trim().max(100).default(''),
  imagePath: z.string().trim().max(1_024).default(''),
  description: z.string().trim().max(1_000).default(''),
  manufacturer: z.string().trim().max(200).default(''),
  model: z.string().trim().max(200).default(''),
  productType: z.string().trim().max(200).optional(),
  variantLabel: z.string().trim().max(200).optional(),
  orderingCode: z.string().trim().max(300).optional(),
  wattage: z.string().trim().max(80).default(''),
  lumens: z.string().trim().max(80).default(''),
  lightColor: z.string().trim().max(80).default(''),
  cri: z.string().trim().max(80).default(''),
  beamAngle: z.string().trim().max(80).default(''),
  ipRating: z.string().trim().max(80).default(''),
  mounting: z.string().trim().max(120).default(''),
  cutout: z.string().trim().max(120).default(''),
  driver: z.string().trim().max(120).default(''),
  control: z.string().trim().max(120).default(''),
  emergency: z.string().trim().max(80).default(''),
  datasheetPath: z.string().trim().max(1_024).default(''),
  location: z.string().trim().max(300).default(''),
  unit: z.string().trim().min(1).max(40).default('No.'),
  quantity: z.coerce.number().min(0).max(1_000_000).default(0),
  notes: z.string().trim().max(1_000).default(''),
  sourceName: z.string().trim().max(300).default(''),
  dimensions: z.string().trim().max(200).default(''),
  bodyColorFinish: z.string().trim().max(200).default(''),
});

export const attachLuminaireAssetSchema = z
  .object({
    assetType: z.enum(luminaireAssetTypes),
    filePath: safeLocalPath,
  })
  .strict();

export const legacyDatasheetAdoptionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            luminaireId: z.string().uuid(),
            assetVersionId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(250)
      .refine(
        (items) => new Set(items.map((item) => item.luminaireId)).size === items.length,
        'Each Luminaire may appear only once in an adoption batch.',
      ),
  })
  .strict();

export const resolveLuminaireDatasheetFieldSchema = z
  .object({
    fieldKey: z.enum([
      'manufacturer',
      'model',
      'orderingCode',
      'variantLabel',
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
      'dimensions',
      'bodyColorFinish',
    ]),
    expectedRowVersion: z.number().int().positive(),
    verificationFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

/**
 * Presence-aware luminaire import patch.
 *
 * Unlike `luminaireRecordSchema`, this schema applies NO defaults. A field is
 * present in the patch ONLY when the corresponding column existed in the
 * imported source (AutoCAD / DIALux / Paste-from-Excel). Absent columns are
 * simply omitted, so an import update can never clear a field the source did
 * not supply. An explicitly blank value in a present column is preserved as an
 * empty string so it remains distinguishable from an absent column.
 */
export const luminaireImportPatchSchema = z
  .object({
    category: z.string().trim().max(100),
    imagePath: z.string().trim().max(1_024),
    description: z.string().trim().max(1_000),
    manufacturer: z.string().trim().max(200),
    model: z.string().trim().max(200),
    productType: z.string().trim().max(200),
    variantLabel: z.string().trim().max(200),
    orderingCode: z.string().trim().max(300),
    wattage: z.string().trim().max(80),
    lumens: z.string().trim().max(80),
    lightColor: z.string().trim().max(80),
    cri: z.string().trim().max(80),
    beamAngle: z.string().trim().max(80),
    ipRating: z.string().trim().max(80),
    mounting: z.string().trim().max(120),
    cutout: z.string().trim().max(120),
    driver: z.string().trim().max(120),
    control: z.string().trim().max(120),
    emergency: z.string().trim().max(80),
    datasheetPath: z.string().trim().max(1_024),
    location: z.string().trim().max(300),
    unit: z.string().trim().min(1).max(40),
    quantity: z.coerce.number().min(0).max(1_000_000),
    notes: z.string().trim().max(1_000),
    sourceName: z.string().trim().max(300),
    dimensions: z.string().trim().max(200),
    bodyColorFinish: z.string().trim().max(200),
  })
  .partial()
  .extend({
    tag: z.string().trim().min(1).max(40),
  });

export type LuminaireImportPatch = z.infer<typeof luminaireImportPatchSchema>;

export const outputColumnSchema = z.object({
  fieldKey: z.string().trim().min(1).max(80),
  header: z.string().trim().min(1).max(120),
  visible: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(200),
  width: z.coerce.number().int().min(60).max(600).default(140),
  compareInRevision: z.boolean().default(true),
  requiredForIssue: z.boolean().default(false),
  internalOnly: z.boolean().default(false),
});

export const updateLightingPackageSchema = z.object({
  inputMode: z.enum(luminaireInputModes).optional(),
  pdfPaperSize: z.enum(pdfPaperSizes).optional(),
  scheduleColumns: z.array(outputColumnSchema).max(80).optional(),
  boqColumns: z.array(outputColumnSchema).max(80).optional(),
});

export const exportLightingPackageSchema = z.object({
  revision: z.string().trim().min(1).max(20).default('00'),
  issueStatus: z.string().trim().min(1).max(100).default('Preliminary'),
  issueDate: z
    .string()
    .date()
    .default(() => new Date().toISOString().slice(0, 10)),
  /** Explicit recovery reuses the reserved canonical identity; normal generation omits this. */
  recoveryRevisionId: z.string().uuid().optional(),
});

export const importLuminaireCsvSchema = z.object({
  source: z.enum(['AutoCadCsv', 'DialuxCsv']),
  csvText: z.string().min(1).max(5_000_000),
});

/**
 * A concise, user-facing summary of one existing Luminaire that is a candidate
 * for an incoming import row. The UUID is carried internally so the commit can
 * bind a selection, but the friendly fields (exact stored Tag, Manufacturer,
 * Model, Description, Wattage) are what distinguish historical duplicates.
 */
export const luminaireImportCandidateSchema = z.object({
  id: z.string().uuid(),
  tag: z.string().trim().min(1).max(40),
  manufacturer: z.string().trim().max(200),
  model: z.string().trim().max(200),
  description: z.string().trim().max(1_000),
  wattage: z.string().trim().max(80),
});
export type LuminaireImportCandidate = z.infer<typeof luminaireImportCandidateSchema>;

/**
 * How an incoming import row resolves against the CURRENT project Luminaires.
 * - `None`: zero candidates -> normal ADD behavior.
 * - `Unique`: exactly one candidate -> automatic UPDATE target.
 * - `Ambiguous`: two or more historical normalized duplicates -> MANUAL REVIEW.
 */
export const luminaireImportMatchStatus = ['None', 'Unique', 'Ambiguous'] as const;
export type LuminaireImportMatchStatus = (typeof luminaireImportMatchStatus)[number];
export const luminaireImportMatchStatusSchema = z.enum(luminaireImportMatchStatus);

export const commitLuminaireImportRowSchema = z.object({
  action: z.enum(['Add', 'Update', 'Ignore', 'ManualReview']),
  /**
   * The client's resolution intent for this row. The server recomputes the
   * current candidates and revalidates this independently; it is never trusted
   * blindly. `Ambiguous` requires an explicit `existingId` selection.
   */
  matchStatus: luminaireImportMatchStatusSchema,
  /**
   * The target Luminaire UUID. For a `Unique` row this is the auto-resolved
   * candidate. For an `Ambiguous` row this is the user's explicit selection and
   * MUST be one of the current candidates. Null for `Add`/`Ignore`.
   */
  existingId: z.string().uuid().nullable(),
  record: luminaireImportPatchSchema,
});
export type CommitLuminaireImportRow = z.infer<typeof commitLuminaireImportRowSchema>;

export const commitLuminaireImportSchema = z
  .object({
    source: z.enum(['AutoCadCsv', 'DialuxCsv']),
    rows: z.array(commitLuminaireImportRowSchema).min(1).max(20_000),
  })
  .superRefine((value, context) => {
    // Harden the action/status/target matrix structurally so impossible
    // combinations are rejected as early as practical. Server DB-state
    // revalidation is still mandatory; this only closes the structurally
    // impossible states the schema would otherwise admit.
    value.rows.forEach((row, index) => {
      const path = ['rows', index] as const;
      if (row.action === 'Add') {
        // An Add creates a brand-new Luminaire: it must never carry a selected
        // existing target and its preview match state must be "no match".
        if (row.existingId !== null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'An Add row must not carry an existing target.',
            path: [...path, 'existingId'],
          });
        }
        if (row.matchStatus !== 'None') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `An Add row requires matchStatus "None".`,
            path: [...path, 'matchStatus'],
          });
        }
      }
      // Update / Ignore / ManualReview structural semantics are enforced by the
      // server preflight against current DB state, not by the shared schema.
    });
  });

export const createRevisionPackageSchema = z.object({
  revisionNumber: z.coerce.number().int().min(0).max(9_999),
  reissueNumber: z.coerce.number().int().min(0).max(99).default(0),
  label: z.string().trim().min(1).max(120),
  status: z.enum(revisionPackageStatuses).default('Draft'),
  outputMode: z.enum(revisionPackageOutputModes),
  relativeOutputFolder: relativeFolderPath,
  selectedItemIds: z.array(z.string().trim().min(1).max(500)).min(1).max(1_000),
  warningOverrideReason: z.string().trim().max(2_000).default(''),
  /** Explicit recovery reuses one FAILED_RECOVERABLE canonical Package UUID. */
  recoveryPackageId: z.string().uuid().optional(),
});

export const revisionPackageCatalogQuerySchema = z
  .object({ revisionId: z.string().uuid().optional() })
  .strict();

export const revisionPackageComparisonQuerySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
});

/**
 * REV-02A — canonical Issue History response schema.
 *
 * Read-only projection over canonical_issue_packages and its immutable
 * Deliverable authorities. There is deliberately NO request body: the endpoint
 * takes only the project id path parameter and never mutates state.
 */
export const issueHistoryDeliverableSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('DocumentSnapshot'),
    deliverableId: z.string().uuid(),
    title: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    locator: z.string().min(1),
    sourceArtifactVersionId: z.string().uuid().nullable(),
  }),
  z.object({
    sourceType: z.literal('GeneratedOutput'),
    outputId: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    templateId: z.string().uuid().nullable(),
    templateVersionId: z.string().uuid().nullable(),
    resolvedTemplateSnapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  }),
]);

export const issueHistoryRecordSchema = z.object({
  package: z.object({
    packageId: z.string().uuid(),
    packageSequence: z.number().int().positive(),
    label: z.string().min(1),
    lifecycleState: z.enum(outputRegistryLifecycleStates),
    businessStatus: z.enum(['Draft', 'Issued']),
    createdAt: z.string().datetime(),
    finalizedAt: z.string().datetime().nullable(),
    issuedAt: z.string().datetime().nullable(),
    issuedBy: z
      .object({
        actorId: z.string().min(1).max(300),
        actorNameSnapshot: z.string().min(1).max(300),
      })
      .nullable(),
  }),
  revision: z.object({
    revisionId: z.string().uuid(),
    revisionSequence: z.number().int().positive(),
    revisionLabel: z.string().min(1),
    purpose: z.string().max(500).nullable(),
  }),
  deliverables: z.array(issueHistoryDeliverableSchema),
});

export const issueHistoryResponseSchema = z.object({
  items: z.array(issueHistoryRecordSchema),
});

const nullableDate = z.string().date().nullable().default(null);
const optionalUuid = z.string().uuid().nullable().default(null);
const shortText = z.string().trim().max(300).default('');
const longText = z.string().trim().max(8_000).default('');

export const projectRequirementSchema = z.object({
  category: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  details: longText,
  requestedFrom: shortText,
  requestedAt: nullableDate,
  dueDate: nullableDate,
  status: z.enum(requirementStatuses).default('Missing'),
  impact: z.enum(requirementImpacts).default('Medium'),
  sourceType: z.enum(workspaceSourceTypes).default('Manual'),
  sourceReference: z.string().trim().max(1_000).default(''),
  notes: longText,
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});

const scopeMetadataText = z.string().trim().min(1).max(1_000);
export const createProjectTagSchema = z.object({
  label: scopeMetadataText.max(80),
  colorKey: z.enum(projectTagColorKeys),
});
export const updateProjectTagSchema = z.object({ colorKey: z.enum(projectTagColorKeys) });
export const createScopeNoteSchema = z.object({
  type: z.enum(scopeNoteTypes),
  text: scopeMetadataText,
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});
export const updateScopeNoteSchema = createScopeNoteSchema;

export const projectChecklistItemSchema = z.object({
  category: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  serviceCode: z.enum(projectServiceCodes).nullable().default(null),
  required: z.boolean().default(true),
  completed: z.boolean().default(false),
  waived: z.boolean().default(false),
  waiverReason: z.string().trim().max(1_000).default(''),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const projectActionItemSchema = z.object({
  title: z.string().trim().min(1).max(300),
  details: longText,
  owner: z.string().trim().max(180).default('Mohamed'),
  ownerRole: z.string().trim().max(180).default(''),
  dueDate: nullableDate,
  status: z.enum(workspaceItemStatuses).default('Open'),
  priority: z.enum(priorities).default('Normal'),
  sourceType: z.enum(workspaceSourceTypes).default('Manual'),
  sourceId: optionalUuid,
  revisionId: optionalUuid,
  categoryId: optionalUuid,
  notes: longText,
  // P5D — explicit issue-blocking semantics. Opt-in; absent means "preserve
  // existing value on update, false on create" so legacy callers never reset it.
  blocksIssue: z.boolean().optional(),
  area: z.string().trim().max(500).optional(),
  luminaireId: z.string().uuid().nullable().optional(),
  reviewItemId: z.string().uuid().nullable().optional(),
});

export const actionCategorySchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  iconKey: z.enum(actionCategoryIconKeys),
  colorKey: z.enum(v4PaletteColorKeys),
  sortOrder: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const createActionCategorySchema = z.object({
  label: z.string().trim().min(1).max(80),
  iconKey: z.enum(actionCategoryIconKeys),
  colorKey: z.enum(v4PaletteColorKeys),
});
export const updateActionCategorySchema = createActionCategorySchema;

export const projectMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    // Omission is meaningful on legacy-compatible Meeting updates: preserve stored purpose.
    purpose: longText.optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    location: shortText,
    attendees: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
    agenda: longText,
    notes: longText,
    decisions: longText,
    onlineMeetingUrl: z.string().trim().max(2_000).default(''),
    externalEventId: z.string().trim().max(500).nullable().default(null),
    status: z.enum(meetingStatuses).default('Planned'),
    participants: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(300),
          role: z.string().trim().max(300).default(''),
          sortOrder: z.coerce.number().int().min(0).max(10_000),
        }),
      )
      .max(100)
      .optional(),
    agendaItems: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          content: longText,
          sortOrder: z.coerce.number().int().min(0).max(10_000),
        }),
      )
      .max(100)
      .optional(),
  })
  .refine((value) => value.endAt > value.startAt, {
    message: 'Meeting end time must be after the start time.',
    path: ['endAt'],
  });

export const meetingNoteInputSchema = z.object({
  content: longText,
  authorName: z.string().trim().min(1).max(300),
});

export const meetingActionLinkSchema = z.object({
  actionId: z.string().uuid(),
  relationType: z.enum(meetingActionRelationTypes).default('Linked'),
});

/** Normal Link Existing requests never own relation provenance. */
export const linkMeetingActionSchema = z.object({
  actionId: z.string().uuid(),
});

export const createActionFromMeetingSchema = projectActionItemSchema.omit({
  sourceType: true,
  sourceId: true,
});

export const projectReviewItemSchema = z.object({
  reference: z.string().trim().max(80).default(''),
  title: z.string().trim().min(1).max(300),
  description: longText,
  area: shortText,
  luminaireTag: z.string().trim().max(80).default(''),
  drawingReference: shortText,
  sourceType: z.enum(workspaceSourceTypes).default('Manual'),
  sourceId: optionalUuid,
  status: z.enum(reviewItemStatuses).default('Open'),
  response: longText,
  revisionId: optionalUuid,
  /** Omission preserves the stored stable relation on legacy-compatible updates. */
  luminaireId: z.string().uuid().nullable().optional(),
  receivedAt: z.string().date(),
  dueDate: nullableDate,
});

const authoredClientSnapshotSchema = z.object({
  origin: z.literal('Client'),
  authorName: z.string().trim().min(1).max(300),
  authorRole: z.string().trim().min(1).max(300),
});
const authoredInternalSnapshotSchema = z.object({ origin: z.literal('Internal') });
const newClientReplySnapshotSchema = authoredClientSnapshotSchema.extend({
  existingClientAuthorId: z.undefined().optional(),
});
const existingClientReplySnapshotSchema = z.object({
  origin: z.literal('Client'),
  existingClientAuthorId: z.string().uuid(),
});

/** Explicit authored root contract; legacy root callers continue to use projectReviewItemSchema. */
export const createProjectReviewThreadSchema = z.intersection(
  projectReviewItemSchema,
  z.discriminatedUnion('origin', [authoredClientSnapshotSchema, authoredInternalSnapshotSchema]),
);

export const createProjectReviewReplySchema = z.intersection(
  z.object({ body: z.string().trim().min(1).max(8_000) }),
  z.union([
    authoredInternalSnapshotSchema,
    newClientReplySnapshotSchema,
    existingClientReplySnapshotSchema,
  ]),
);

export const linkProjectReviewDocumentSchema = z.object({ documentId: z.string().uuid() });
export const updateProjectReviewReplySchema = z
  .object({
    body: z.string().trim().min(1).max(8_000),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();
export type UpdateProjectReviewReplyInput = z.infer<typeof updateProjectReviewReplySchema>;

export const projectRevisionSchema = z.object({
  revisionNumber: z.coerce.number().int().min(0).max(9_999),
  reissueNumber: z.coerce.number().int().min(0).max(99).default(0),
  title: z.string().trim().min(1).max(300),
  status: z.enum(revisionStatuses).default('Draft'),
  receivedAt: nullableDate,
  dueDate: nullableDate,
  issuedAt: nullableDate,
  summary: longText,
  changeLog: longText,
  sourceType: z.enum(workspaceSourceTypes).default('Manual'),
  sourceReference: z.string().trim().max(1_000).default(''),
  /** Explicit recovery reuses one failed canonical register-only Revision UUID. */
  recoveryRevisionId: z.string().uuid().optional(),
});

export const projectDocumentSchema = z.object({
  category: z.enum(documentCategories),
  documentNumber: z.string().trim().max(120).default(''),
  title: z.string().trim().min(1).max(300),
  revision: z.string().trim().max(40).default(''),
  status: z.enum(documentStatuses).default('Working'),
  filePath: z.string().trim().max(1_024).default(''),
  issuedTo: shortText,
  issueDate: nullableDate,
  notes: longText,
});

export const projectContactSchema = z
  .object({
    group: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(8000).optional(),
    archived: z.boolean().optional(),
    name: z.string().trim().min(1).max(180),
    email: z.union([z.literal(''), z.string().trim().email().max(320)]).default(''),
    company: shortText,
    role: z.string().trim().max(120).default(''),
    phone: z.string().trim().max(64).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const microsoftConnectionSettingsSchema = z.object({
  tenantId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Enter a valid tenant ID or verified tenant domain.'),
  clientId: z.string().trim().uuid(),
  mailSyncEnabled: z.boolean().default(true),
  calendarSyncEnabled: z.boolean().default(true),
  syncIntervalMinutes: z.coerce.number().int().min(5).max(240).default(15),
});

export const microsoftDeviceCodeCompleteSchema = z.object({
  flowId: z.string().uuid(),
});

export const communicationLinkSchema = z.object({
  projectId: z.string().uuid().nullable(),
});

export const communicationQuerySchema = z.object({
  kind: z.enum(communicationKinds).optional(),
  projectId: z.string().uuid().optional(),
  linked: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
});

export const workspaceSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
});

export const periodActivityReportQuerySchema = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    salesOwnerId: z.string().uuid().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.to >= value.from, {
    message: 'Report end date must be on or after the start date.',
    path: ['to'],
  });

export const microsoftCalendarEventSchema = z
  .object({
    projectId: z.string().uuid(),
    subject: z.string().trim().min(1).max(300),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    location: shortText,
    attendees: z.array(z.string().trim().email().max(320)).max(100).default([]),
    agenda: longText,
  })
  .refine((value) => value.endAt > value.startAt, {
    message: 'Meeting end time must be after the start time.',
    path: ['endAt'],
  });

export type PersonalSettingsInput = z.infer<typeof personalSettingsSchema>;

// ===========================================================================
// P2.9A — Personal project-type catalogue contracts
// ===========================================================================
// The Personal workspace manages the SAME canonical AppSettings.projectTypes
// catalogue that Team Admin manages. There is deliberately no second Personal
// storage model. A catalogue entry is a ProjectType (id, name, isActive,
// createdAt, updatedAt); deactivation is expressed as isActive=false and never
// rewrites existing Project.projectType metadata.
export const personalProjectTypeSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, 'Project type name is required.')
    .max(80, 'Project type name is too long.'),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// P2.9A-H1 — the Personal catalogue payload must deterministically reject
// case-insensitive duplicate names (across active AND inactive entries) and a
// zero-active catalogue, keeping the API invariant aligned with the UI. This is
// Personal-route validation only; it does not alter the canonical shared
// AppSettings storage or the Team/Admin contract.
export const personalProjectTypesSchema = z
  .array(personalProjectTypeSchema)
  .refine((types) => types.some((type) => type.isActive), {
    message: 'At least one project type must remain active.',
  })
  .refine((types) => {
    const seen = new Set<string>();
    for (const type of types) {
      const normalized = type.name.trim().toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
    }
    return true;
  }, 'Project type names must be unique.');
export type PersonalProjectTypesInput = z.infer<typeof personalProjectTypesSchema>;
export type LegacyProjectImportInput = z.infer<typeof legacyProjectImportSchema>;
export type SaveFolderProfileInput = z.infer<typeof saveFolderProfileSchema>;
export type InitializeProjectWorkspaceInput = z.infer<typeof initializeProjectWorkspaceSchema>;
export type UpdateDeliverableInput = z.infer<typeof updateDeliverableSchema>;
export type LuminaireRecordInput = z.infer<typeof luminaireRecordSchema>;
export type AttachLuminaireAssetInput = z.infer<typeof attachLuminaireAssetSchema>;
export type LegacyDatasheetAdoptionInput = z.infer<typeof legacyDatasheetAdoptionSchema>;
export type ResolveLuminaireDatasheetFieldInput = z.infer<
  typeof resolveLuminaireDatasheetFieldSchema
>;
export type UpdateLightingPackageInput = z.infer<typeof updateLightingPackageSchema>;
export type CreateRevisionPackageInput = z.infer<typeof createRevisionPackageSchema>;
export type ProjectRequirementInput = z.infer<typeof projectRequirementSchema>;
export type CreateProjectTagInput = z.infer<typeof createProjectTagSchema>;
export type UpdateProjectTagInput = z.infer<typeof updateProjectTagSchema>;
export type CreateScopeNoteInput = z.infer<typeof createScopeNoteSchema>;
export type UpdateScopeNoteInput = z.infer<typeof updateScopeNoteSchema>;
export type ProjectChecklistItemInput = z.infer<typeof projectChecklistItemSchema>;
/** categoryId is optional at legacy call sites; parsed API payloads always default it to null. */
export type ProjectActionItemInput = Omit<z.infer<typeof projectActionItemSchema>, 'categoryId'> & {
  categoryId?: string | null;
};
export type CreateActionCategoryInput = z.infer<typeof createActionCategorySchema>;
export type UpdateActionCategoryInput = z.infer<typeof updateActionCategorySchema>;
/** Base Meeting writers predate structured authority; omitted children deliberately preserve rows. */
export type ProjectMeetingInput = Omit<z.infer<typeof projectMeetingSchema>, 'purpose'> & {
  purpose?: string | undefined;
};
export type MeetingNoteInput = z.infer<typeof meetingNoteInputSchema>;
export type MeetingActionLinkInput = z.infer<typeof meetingActionLinkSchema>;
export type CreateActionFromMeetingInput = z.infer<typeof createActionFromMeetingSchema>;
export type ProjectReviewItemInput = z.infer<typeof projectReviewItemSchema>;
export type CreateProjectReviewThreadInput = z.infer<typeof createProjectReviewThreadSchema>;
export type CreateProjectReviewReplyInput = z.infer<typeof createProjectReviewReplySchema>;
export type LinkProjectReviewDocumentInput = z.infer<typeof linkProjectReviewDocumentSchema>;
export type ProjectRevisionInput = z.infer<typeof projectRevisionSchema>;
export type ProjectDocumentInput = z.infer<typeof projectDocumentSchema>;
export type ProjectContactInput = z.infer<typeof projectContactSchema>;
export type MicrosoftConnectionSettingsInput = z.infer<typeof microsoftConnectionSettingsSchema>;
export type MicrosoftCalendarEventInput = z.infer<typeof microsoftCalendarEventSchema>;

// ===========================================================================
// P2.8A — Personal WorkSession contracts
// ===========================================================================
// The WorkSession is a durable structured-row model for actual work performed
// by the local Personal designer. It is NOT the Team TimeTrackingService and
// must never change project.status. Duration is derived, never persisted.

export const workSessionSchema = z.object({
  attribution: z
    .object({ actorId: z.string().uuid(), actorName: z.string().min(1).max(300) })
    .optional(),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  pausedAt: z.string().nullable(),
  accumulatedPausedMs: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const startWorkSessionSchema = z.object({
  projectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

export const stopWorkSessionSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

export const switchWorkSessionSchema = z.object({
  targetProjectId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});

export const pauseWorkSessionSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

export const resumeWorkSessionSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

export const workSessionParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export type WorkSessionInput = z.infer<typeof workSessionSchema>;
export type StartWorkSessionInput = z.infer<typeof startWorkSessionSchema>;
export type StopWorkSessionInput = z.infer<typeof stopWorkSessionSchema>;
export type SwitchWorkSessionInput = z.infer<typeof switchWorkSessionSchema>;
export type PauseWorkSessionInput = z.infer<typeof pauseWorkSessionSchema>;
export type ResumeWorkSessionInput = z.infer<typeof resumeWorkSessionSchema>;
