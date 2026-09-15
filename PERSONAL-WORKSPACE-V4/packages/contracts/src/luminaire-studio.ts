import { z } from 'zod';
export const studioGenerationFilesSchema = z.object({
  artifacts: z.array(z.object({ name: z.string(), url: z.string() })),
});

const text = z.string().max(4000);
const data = z.record(z.string().max(100), z.json());
const record = z.object({ id: z.uuid() }).catchall(z.json());
const system = record.extend({ code: text.min(1) });
const accessory = record.extend({ ref: text.min(1), systemId: z.string().optional() });
const luminaire = record.extend({ tag: text.min(1), systemId: z.string().optional() });

/** Original Studio document, scoped to an existing canonical Workspace project. */
export const studioDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    updatedAt: z.iso.datetime().optional(),
    meta: data,
    luminaires: z.array(luminaire).max(10000),
    systems: z.array(system).max(10000),
    accessories: z.array(accessory).max(10000),
    customFields: z.array(data).max(100),
    output: data,
  })
  .strict()
  .superRefine((document, context) => {
    for (const [collection, key] of [
      ['luminaires', 'tag'],
      ['systems', 'code'],
      ['accessories', 'ref'],
    ] as const) {
      const ids = new Set<string>();
      const labels = new Set<string>();
      for (const [index, item] of document[collection].entries()) {
        const label = String(item[key]).trim().toUpperCase();
        if (ids.has(item.id) || labels.has(label))
          context.addIssue({
            code: 'custom',
            path: [collection, index],
            message: `Duplicate ${key} or identity.`,
          });
        ids.add(item.id);
        labels.add(label);
      }
    }
    const systems = new Set(document.systems.map((item) => item.id));
    for (const collection of ['luminaires', 'accessories'] as const) {
      document[collection].forEach((item, index) => {
        if (item.systemId && !systems.has(item.systemId))
          context.addIssue({
            code: 'custom',
            path: [collection, index, 'systemId'],
            message: 'Select a system belonging to this project.',
          });
      });
    }
  });

export const saveStudioDocumentSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    baseFingerprint: z.string().length(64).optional(),
    deletedLuminaireIds: z.array(z.uuid()).max(10000).optional(),
    operationId: z.uuid(),
    document: studioDocumentSchema,
  })
  .strict();

export const storedStudioDocumentSchema = z
  .object({
    projectId: z.uuid(),
    version: z.number().int().positive(),
    operationId: z.uuid(),
    actorId: z.uuid(),
    actorName: text,
    savedAt: z.iso.datetime(),
    requestHash: z.string().length(64).optional(),
    document: studioDocumentSchema,
  })
  .strict();

export type StudioDocument = z.infer<typeof studioDocumentSchema>;
export type SaveStudioDocument = z.infer<typeof saveStudioDocumentSchema>;
export type StoredStudioDocument = z.infer<typeof storedStudioDocumentSchema>;

export const studioOutputRequestSchema = z
  .object({
    version: z.number().int().nonnegative(),
    operationId: z.uuid(),
    baseFingerprint: z.string().length(64),
    format: z.enum(['PDF', 'XLSX']),
    kind: z.enum(['schedule', 'boq', 'datasheets']),
    selection: z.array(z.uuid()).max(10000).default([]),
    separate: z.boolean().default(false),
    targetRevisionId: z.uuid().optional(),
  })
  .strict();

const template = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    templateVersion: z.literal(1),
    output: z.record(z.string(), z.json()),
    customFields: z.array(z.record(z.string(), z.json())).max(100),
  })
  .passthrough();
export const studioTemplatesSchema = z
  .object({ version: z.number().int().nonnegative(), templates: z.array(template).max(200) })
  .strict();
