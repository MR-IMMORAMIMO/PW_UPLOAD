import { z } from 'zod';
export const localAiPreviewSchema = z.object({
  pngBase64: z.string().max(20_000_000),
  pageNumber: z.number().int().min(1).max(200),
});

export const localAiFieldSchema = z.enum([
  'manufacturer',
  'orderingCode',
  'model',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'control',
  'driver',
  'dimensions',
  'cutout',
  'mounting',
  'bodyColorFinish',
  'emergency',
]);
export const localAiPageReadingSchema = z
  .object({
    productCode: z.string().max(160),
    summary: z.string().max(1600),
    fields: z
      .array(
        z
          .object({
            field: localAiFieldSchema,
            value: z.string().min(1).max(300),
            quote: z.string().min(1).max(700),
          })
          .strict(),
      )
      .max(40),
    observations: z.array(z.string().max(500)).max(12),
  })
  .strict();
export const localAiFindingSchema = z.object({
  field: localAiFieldSchema,
  value: z.string().max(300),
  projectValue: z.string().max(1000),
  quote: z.string().max(700),
  result: z.enum(['CONSISTENT_EVIDENCE', 'DIFFERENT_EVIDENCE', 'NEEDS_REVIEW']),
  reason: z.string().max(500),
});
export const localAiReportSchema = z.object({
  stale: z.boolean().default(false),
  id: z.uuid(),
  projectId: z.uuid(),
  luminaireId: z.uuid(),
  assetVersionId: z.uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
  actorId: z.uuid(),
  model: z.literal('qwen3-vl:2b-instruct'),
  modelDigest: z.string().max(100),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  state: z.enum(['RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  totalPages: z.number().int().min(0).max(200),
  completedPages: z.number().int().min(0).max(200),
  error: z.string().max(500).nullable(),
  projectSnapshot: z.record(z.string(), z.string().max(1000)),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(200),
        summary: z.string().max(1600),
        observations: z.array(z.string().max(500)).max(12),
        productCode: z.string().max(160),
        findings: z.array(localAiFindingSchema).max(40),
      }),
    )
    .max(200),
});
export const localAiStatusSchema = z.object({
  enabled: z.boolean(),
  ready: z.boolean(),
  model: z.literal('qwen3-vl:2b-instruct'),
  reason: z.string(),
  localOnly: z.literal(true),
});
export type LocalAiReport = z.infer<typeof localAiReportSchema>;
export type LocalAiPageReading = z.infer<typeof localAiPageReadingSchema>;
export type LocalAiFinding = z.infer<typeof localAiFindingSchema>;
