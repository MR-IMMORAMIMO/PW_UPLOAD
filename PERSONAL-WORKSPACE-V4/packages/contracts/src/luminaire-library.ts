import { z } from 'zod';
import {
  luminaireLibraryAssetTypes,
  luminaireLibraryLifecycleStatuses,
  luminaireTechnicalLumenBases,
  luminaireTechnicalPowerBases,
} from '@scli/domain';

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(160);
const rowVersion = z.coerce.number().int().min(1);
const shortText = z.string().trim().max(200);
const technicalText = z.string().trim().max(200).default('');
const csvText = z
  .string()
  .trim()
  .max(1_000)
  .transform((value) =>
    [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, 30),
  );
const csvIntegers = z
  .string()
  .trim()
  .max(1_000)
  .transform((value, context) => {
    const parsed = [...new Set(value.split(',').map((item) => Number(item.trim())))];
    if (parsed.some((item) => !Number.isInteger(item) || item <= 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Facet values must be positive integers.',
      });
      return z.NEVER;
    }
    return parsed.slice(0, 30);
  });
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

export const createLuminaireManufacturerSchema = z
  .object({ name: z.string().trim().min(1).max(200), idempotencyKey })
  .strict();

export const updateLuminaireManufacturerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    expectedRowVersion: rowVersion,
  })
  .strict();

export const archiveLuminaireLibraryEntitySchema = z
  .object({ expectedRowVersion: rowVersion, idempotencyKey })
  .strict();

export const createLuminaireLibraryProductSchema = z
  .object({
    manufacturerId: uuid,
    name: z.string().trim().min(1).max(200),
    productType: shortText.default(''),
    description: z.string().trim().max(2_000).default(''),
    idempotencyKey,
  })
  .strict();

export const updateLuminaireLibraryProductDraftSchema = z
  .object({
    manufacturerId: uuid,
    name: z.string().trim().min(1).max(200),
    productType: shortText,
    description: z.string().trim().max(2_000),
    expectedRowVersion: rowVersion,
  })
  .strict();

export const luminaireLibraryVariantDraftSchema = z
  .object({
    variantLabel: z.string().trim().min(1).max(300),
    orderingCode: technicalText,
    wattage: technicalText,
    lumens: technicalText,
    lightColor: technicalText,
    cri: technicalText,
    beamAngle: technicalText,
    ipRating: technicalText,
    mounting: technicalText,
    cutout: technicalText,
    driver: technicalText,
    control: technicalText,
    emergency: technicalText,
    dimensions: technicalText,
    bodyColorFinish: technicalText,
  })
  .strict();

export const createLuminaireLibraryVariantSchema = luminaireLibraryVariantDraftSchema.extend({
  idempotencyKey,
});

export const updateLuminaireLibraryVariantDraftSchema = luminaireLibraryVariantDraftSchema.extend({
  expectedRowVersion: rowVersion,
});

export const publishLuminaireLibraryVariantSchema = z
  .object({
    expectedProductRowVersion: rowVersion,
    expectedVariantRowVersion: rowVersion,
    idempotencyKey,
  })
  .strict();

export const createLuminaireLibraryAssetSchema = z
  .object({
    productId: uuid,
    variantId: uuid.nullable().default(null),
    assetType: z.enum(luminaireLibraryAssetTypes),
    label: shortText.default(''),
    idempotencyKey,
  })
  .strict();

export const createLuminaireLibraryAssetVersionSchema = z
  .object({
    sourceFilePath: z.string().trim().min(1).max(1_024),
    expectedLatestSequence: z.coerce.number().int().min(0),
    idempotencyKey,
  })
  .strict();

export const luminaireLibraryListQuerySchema = z
  .object({
    includeEmptyProducts: queryBoolean.optional().default(false),
    search: z.string().trim().max(200).default(''),
    manufacturerId: uuid.optional(),
    manufacturerIds: csvText.optional().default([]),
    productType: shortText.optional(),
    productTypes: csvText.optional().default([]),
    cctKelvin: csvIntegers.optional().default([]),
    beam: csvText.optional().default([]),
    wattageMin: z.coerce.number().nonnegative().optional(),
    wattageMax: z.coerce.number().nonnegative().optional(),
    wattageBasis: z.enum(luminaireTechnicalPowerBases).optional(),
    lumensMin: z.coerce.number().nonnegative().optional(),
    lumensMax: z.coerce.number().nonnegative().optional(),
    lumensBasis: z.enum(luminaireTechnicalLumenBases).optional(),
    criMin: z.coerce.number().min(0).max(100).optional(),
    ip: csvText.optional().default([]),
    control: csvText.optional().default([]),
    mounting: csvText.optional().default([]),
    hasProductImage: queryBoolean.optional().default(false),
    hasDatasheet: queryBoolean.optional().default(false),
    hasIes: queryBoolean.optional().default(false),
    hasLdt: queryBoolean.optional().default(false),
    missingPhotometry: queryBoolean.optional().default(false),
    status: z.enum(luminaireLibraryLifecycleStatuses).default('ACTIVE'),
    sort: z
      .enum([
        'RELEVANCE',
        'MANUFACTURER_ASC',
        'PRODUCT_ASC',
        'RECENTLY_UPDATED',
        'HIGHEST_LUMENS',
        'LOWEST_WATTAGE',
        'HIGHEST_EFFICACY',
      ])
      .default('RELEVANCE'),
    cursor: z.string().trim().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.wattageMin !== undefined || value.wattageMax !== undefined) && !value.wattageBasis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wattageBasis'],
        message: 'Wattage basis is required for a numeric range.',
      });
    }
    if ((value.lumensMin !== undefined || value.lumensMax !== undefined) && !value.lumensBasis) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lumensBasis'],
        message: 'Lumens basis is required for a numeric range.',
      });
    }
    if (
      value.wattageMin !== undefined &&
      value.wattageMax !== undefined &&
      value.wattageMin > value.wattageMax
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wattageMax'],
        message: 'Wattage maximum must be at least the minimum.',
      });
    }
    if (
      value.lumensMin !== undefined &&
      value.lumensMax !== undefined &&
      value.lumensMin > value.lumensMax
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lumensMax'],
        message: 'Lumens maximum must be at least the minimum.',
      });
    }
  });

export const luminaireManufacturerListQuerySchema = z
  .object({
    search: z.string().trim().max(200).default(''),
    status: z.enum(luminaireLibraryLifecycleStatuses).default('ACTIVE'),
    cursor: z.string().trim().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .strict();

export const addProjectLuminaireFromLibrarySchema = z
  .object({
    versionId: uuid,
    tag: z.string().trim().min(1).max(40),
    category: z.string().trim().max(100).default(''),
    location: z.string().trim().max(300).default(''),
    unit: z.string().trim().min(1).max(40).default('No.'),
    quantity: z.coerce.number().min(0).max(1_000_000).default(0),
    notes: z.string().trim().max(1_000).default(''),
    descriptionOverride: z.string().trim().max(1_000).nullable().default(null),
    idempotencyKey,
  })
  .strict();

export const compareProjectLuminaireLibrarySchema = z
  .object({ targetVersionId: uuid.optional() })
  .strict();

export const updateProjectLuminaireFromLibrarySchema = z
  .object({
    expectedSelectedVersionId: uuid,
    targetVersionId: uuid,
    expectedBindingRowVersion: rowVersion,
    idempotencyKey,
  })
  .strict();

export const updateProjectLuminaireDescriptionOverrideSchema = z
  .object({
    descriptionOverride: z.string().trim().max(1_000).nullable(),
    expectedBindingRowVersion: rowVersion,
  })
  .strict();

const projectLuminairePromotionManufacturerChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('USE_EXISTING'), manufacturerId: uuid }).strict(),
  z.object({ mode: z.literal('CREATE_NEW'), name: z.string().trim().min(1).max(200) }).strict(),
]);

const projectLuminairePromotionProductChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('USE_EXISTING'), productId: uuid }).strict(),
  z
    .object({
      mode: z.literal('CREATE_NEW'),
      name: z.string().trim().min(1).max(200),
      productType: shortText,
      description: z.string().trim().max(2_000),
      duplicateDecision: z.enum(['NO_MATCHES', 'KEEP_SEPARATE']),
    })
    .strict(),
]);

export const createProjectLuminaireLibraryDraftSchema = z
  .object({
    manufacturer: projectLuminairePromotionManufacturerChoiceSchema,
    product: projectLuminairePromotionProductChoiceSchema,
    variant: luminaireLibraryVariantDraftSchema,
    idempotencyKey,
  })
  .strict();

export const luminaireLibraryManufacturerParamsSchema = z.object({ manufacturerId: uuid }).strict();
export const luminaireLibraryProductParamsSchema = z.object({ productId: uuid }).strict();
export const luminaireLibraryVariantParamsSchema = z.object({ variantId: uuid }).strict();
export const luminaireLibraryAssetParamsSchema = z.object({ assetId: uuid }).strict();
export const luminaireLibraryAssetVersionParamsSchema = z.object({ assetVersionId: uuid }).strict();
export const projectLuminaireLibraryParamsSchema = z
  .object({ projectId: uuid, luminaireId: uuid })
  .strict();
export const projectLuminaireLibraryCreateParamsSchema = z.object({ projectId: uuid }).strict();
export const duplicateLuminaireLibraryQuerySchema = z
  .object({
    manufacturerId: uuid,
    productName: z.string().trim().min(1).max(200),
    orderingCode: technicalText.optional(),
    excludeVariantId: uuid.optional(),
  })
  .strict();

export type CreateLuminaireManufacturerInput = z.infer<typeof createLuminaireManufacturerSchema>;
export type UpdateLuminaireManufacturerInput = z.infer<typeof updateLuminaireManufacturerSchema>;
export type CreateLuminaireLibraryProductInput = z.infer<
  typeof createLuminaireLibraryProductSchema
>;
export type UpdateLuminaireLibraryProductDraftInput = z.infer<
  typeof updateLuminaireLibraryProductDraftSchema
>;
export type CreateLuminaireLibraryVariantInput = z.infer<
  typeof createLuminaireLibraryVariantSchema
>;
export type UpdateLuminaireLibraryVariantDraftInput = z.infer<
  typeof updateLuminaireLibraryVariantDraftSchema
>;
export type PublishLuminaireLibraryVariantInput = z.infer<
  typeof publishLuminaireLibraryVariantSchema
>;
export type CreateLuminaireLibraryAssetInput = z.infer<typeof createLuminaireLibraryAssetSchema>;
export type CreateLuminaireLibraryAssetVersionInput = z.infer<
  typeof createLuminaireLibraryAssetVersionSchema
>;
export type LuminaireLibraryListQuery = z.infer<typeof luminaireLibraryListQuerySchema>;
export type AddProjectLuminaireFromLibraryInput = z.infer<
  typeof addProjectLuminaireFromLibrarySchema
>;
export type UpdateProjectLuminaireFromLibraryInput = z.infer<
  typeof updateProjectLuminaireFromLibrarySchema
>;
export type UpdateProjectLuminaireDescriptionOverrideInput = z.infer<
  typeof updateProjectLuminaireDescriptionOverrideSchema
>;
export type CreateProjectLuminaireLibraryDraftInput = z.infer<
  typeof createProjectLuminaireLibraryDraftSchema
>;
