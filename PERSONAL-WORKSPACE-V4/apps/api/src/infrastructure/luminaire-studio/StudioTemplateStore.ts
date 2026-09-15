import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DomainError, type AppUser } from '@scli/domain';

import { studioTemplatesSchema } from '@scli/contracts';
export { studioTemplatesSchema } from '@scli/contracts';
const persisted = studioTemplatesSchema.extend({
  actorId: z.uuid(),
  actorName: z.string(),
  savedAt: z.iso.datetime(),
});

export class StudioTemplateStore {
  constructor(private readonly database: DatabaseSync) {}
  public read(): z.infer<typeof studioTemplatesSchema> {
    const row = this.database
      .prepare(
        "SELECT json_value FROM app_state WHERE state_key LIKE 'luminaire-studio-templates:%' ORDER BY state_key DESC LIMIT 1",
      )
      .get() as { json_value: string } | undefined;
    if (!row) return { version: 0, templates: [] };
    const data = persisted.parse(JSON.parse(row.json_value));
    return { version: data.version, templates: data.templates };
  }
  public save(input: z.infer<typeof studioTemplatesSchema>, actor: AppUser) {
    if (this.read().version !== input.version)
      throw new DomainError(
        'CONFLICT',
        'Templates changed in another window. Reload before editing the shared templates.',
        409,
      );
    if (new Set(input.templates.map((item) => item.id)).size !== input.templates.length)
      throw new DomainError('VALIDATION_ERROR', 'Template identities must be unique.', 400);
    const data = persisted.parse({
      ...input,
      version: input.version + 1,
      actorId: actor.id,
      actorName: actor.displayName,
      savedAt: new Date().toISOString(),
    });
    this.database
      .prepare('INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)')
      .run(
        `luminaire-studio-templates:${String(data.version).padStart(12, '0')}`,
        JSON.stringify(data),
        data.savedAt,
      );
    return { version: data.version, templates: data.templates };
  }
}
