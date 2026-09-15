import { z } from 'zod';
import { finalProjectSetupSchema } from './final-project-setup';

export const projectBrowseStateSchema = z
  .object({
    search: z.string().max(200),
    filters: z
      .object({
        Status: z.string().max(80).optional(),
        Priority: z.string().max(80).optional(),
        'Project Type': z.string().max(200).optional(),
        'Due Date': z.string().max(80).optional(),
        'Sort By': z.string().max(80).optional(),
      })
      .strict(),
    page: z.number().int().min(1).max(100000),
    pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
    group: z.enum(['status', 'priority', 'client']),
  })
  .strict();
export type ProjectBrowseState = z.infer<typeof projectBrowseStateSchema>;

export const projectDirectoryInputSchema = z
  .object({
    kind: z.enum(['Client', 'Manager']),
    name: z.string().trim().min(1).max(200),
    email: z.union([z.string().trim().email().max(254), z.literal('')]).default(''),
  })
  .strict();
export const projectDirectoryEntrySchema = projectDirectoryInputSchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  createdById: z.string().uuid(),
});
export const projectDirectorySchema = z.array(projectDirectoryEntrySchema);
export type ProjectDirectoryEntry = z.infer<typeof projectDirectoryEntrySchema>;
export type ProjectDirectoryInput = z.infer<typeof projectDirectoryInputSchema>;

/** Unsubmitted wizard input: no Project identity or sequence is allocated. */
export const projectWizardDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    step: z.number().int().min(1).max(5),
    fields: z
      .record(z.string().max(80), z.string().max(4000))
      .refine((fields) => Object.keys(fields).length <= 60),
    description: z.string().max(4000),
    scopeSummary: z.string().max(4000),
    setup: finalProjectSetupSchema,
  })
  .strict();
export type ProjectWizardDraft = z.infer<typeof projectWizardDraftSchema>;

/** Presentation identity for the local owner; never changes authentication or historical actors. */
export const personalProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    photo: z
      .string()
      .max(400_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
      .nullable(),
  })
  .strict();
export type PersonalProfile = z.infer<typeof personalProfileSchema>;

export const finalUiPreferenceKindSchema = z.enum([
  'PROJECT',
  'LIBRARY_PRODUCT',
  'LIBRARY_VARIANT',
]);
export const finalUiPreferenceSchema = z
  .object({
    kind: finalUiPreferenceKindSchema,
    targetId: z.string().uuid(),
    favorite: z.boolean(),
    rank: z.number().int().min(0).max(5000).optional(),
    viewedAt: z.string().datetime().nullable(),
    reviewedAt: z.string().datetime().optional(),
  })
  .strict();
export const finalUiPreferencesSchema = z
  .object({ schemaVersion: z.literal(1), items: z.array(finalUiPreferenceSchema).max(5000) })
  .strict();
export const updateFinalUiPreferenceSchema = z
  .object({
    kind: finalUiPreferenceKindSchema,
    targetId: z.string().uuid(),
    favorite: z.boolean().optional(),
    rank: z.number().int().min(0).max(5000).optional(),
    markViewed: z.literal(true).optional(),
    markReviewed: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.favorite !== undefined ||
      value.markViewed === true ||
      value.rank !== undefined ||
      value.markReviewed === true,
    'Choose a preference change.',
  );
export type FinalUiPreferences = z.infer<typeof finalUiPreferencesSchema>;
export type UpdateFinalUiPreference = z.infer<typeof updateFinalUiPreferenceSchema>;
