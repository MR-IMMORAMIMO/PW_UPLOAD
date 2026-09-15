import { z } from 'zod';
export type DatasheetImageSelection = z.infer<typeof datasheetImageSelectionSchema>;
export type DatasheetImages = z.infer<typeof datasheetImagesSchema>;
export const datasheetImageSelectionSchema = z
  .object({
    pageNumber: z.number().int().min(1).max(200),
    sourceAssetVersionId: z.uuid(),
    currentImageVersionId: z.uuid().nullable(),
    imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const datasheetImagesSchema = z.object({
  sourceAssetVersionId: z.uuid(),
  currentImageVersionId: z.uuid().nullable(),
  images: z
    .array(
      z.object({
        pageNumber: z.number().int(),
        width: z.number().positive(),
        height: z.number().positive(),
        hash: z.string().length(64),
        pngBase64: z.string().max(7_000_000),
      }),
    )
    .max(12),
});
