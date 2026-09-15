import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ProjectContact } from '@scli/domain';

const schema = z
  .object({
    group: z.string().max(120).optional(),
    notes: z.string().max(8000).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export class ContactPresentationStore {
  constructor(private readonly database: DatabaseSync) {}
  read(projectId: string, id: string): Pick<ProjectContact, 'group' | 'notes' | 'archived'> {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key=?')
      .get(`contact-presentation:v1:${projectId}:${id}`);
    return row ? schema.parse(JSON.parse(String(row.json_value))) : {};
  }
  save(
    projectId: string,
    id: string,
    input: Pick<ProjectContact, 'group' | 'notes' | 'archived'>,
    now: string,
  ) {
    const value = schema.parse({
      ...this.read(projectId, id),
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    });
    this.database
      .prepare(
        'INSERT INTO app_state(state_key,json_value,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at',
      )
      .run(`contact-presentation:v1:${projectId}:${id}`, JSON.stringify(value), now);
  }
}
