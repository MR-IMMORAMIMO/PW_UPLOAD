import { z } from 'zod';
export const confirmDatasheetFieldSchema = z
  .object({
    fieldKey: z.enum([
      'manufacturer',
      'model',
      'orderingCode',
      'wattage',
      'lumens',
      'lightColor',
      'cri',
      'beamAngle',
      'ipRating',
      'cutout',
      'dimensions',
      'bodyColorFinish',
      'control',
      'driver',
      'emergency',
    ]),
    acceptIdentityMismatch: z.boolean().optional(),
    value: z.string().trim().min(1).max(200),
    pageNumber: z.number().int().min(1).max(200),
    note: z.string().trim().min(1).max(500),
    verificationFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    operationId: z.string().uuid(),
  })
  .strict();
export type ConfirmDatasheetFieldInput = z.infer<typeof confirmDatasheetFieldSchema>;
export const keepProjectFieldSchema = confirmDatasheetFieldSchema
  .pick({
    fieldKey: true,
    verificationFingerprint: true,
    operationId: true,
  })
  .strict();
export type KeepProjectFieldInput = z.infer<typeof keepProjectFieldSchema>;

export const editProjectTechnicalFieldSchema = z
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
    value: z.string().max(500),
    expectedRowVersion: z.number().int().positive(),
  })
  .strict();
export type EditProjectTechnicalFieldInput = z.infer<typeof editProjectTechnicalFieldSchema>;
