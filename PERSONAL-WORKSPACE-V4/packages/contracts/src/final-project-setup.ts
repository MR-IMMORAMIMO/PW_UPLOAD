import { z } from 'zod';
import type { FinalProjectSetup } from '@scli/domain';
const text = z.string().trim().max(200);
const items = z.array(text.min(1)).max(100);
export const finalProjectSetupSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceLead: text,
    contractReference: text,
    managerId: z.string().uuid().nullable(),
    probability: z.number().int().min(0).max(100).nullable(),
    category: text,
    discipline: text,
    projectNature: text,
    packageType: text,
    deliverables: items,
    designServices: items,
    documentation: items,
    coordination: z.enum(['standard', 'extensive', 'none']),
    standards: items,
    notes: z.string().trim().max(4000),
    schedule: z
      .object({
        startDate: z.union([z.string().date(), z.literal('')]),
        completionDate: z.union([z.string().date(), z.literal('')]),
        designDurationDays: z.number().int().min(0).max(36500),
        constructionDurationDays: z.number().int().min(0).max(36500),
        milestones: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                name: text.min(1),
                description: z.string().max(1000),
                targetDate: z.string().date(),
                phase: z.enum(['Design', 'Documentation', 'Procurement', 'Construction']),
              })
              .strict(),
          )
          .max(200),
      })
      .strict()
      .refine(
        (schedule) =>
          !schedule.startDate ||
          !schedule.completionDate ||
          schedule.completionDate >= schedule.startDate,
        'Completion must follow the start date.',
      ),
    structure: z
      .object({
        enabledGroups: items,
        documentCategory: text,
        sequenceDigits: z.number().int().min(1).max(8),
        separator: z.enum(['-', '_']),
        extension: z.enum(['.pdf', '.docx', '.xlsx', '.dwg']),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<FinalProjectSetup>;
