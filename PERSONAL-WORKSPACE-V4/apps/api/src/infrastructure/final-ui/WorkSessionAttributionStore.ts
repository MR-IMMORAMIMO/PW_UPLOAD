import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const schema = z
  .object({ actorId: z.string().uuid(), actorName: z.string().min(1).max(300) })
  .strict();
export class WorkSessionAttributionStore {
  constructor(private readonly database: DatabaseSync) {}
  read(id: string): z.infer<typeof schema> | undefined {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key=?')
      .get(`work-session-actor:v1:${id}`);
    return row ? schema.parse(JSON.parse(String(row.json_value))) : undefined;
  }
  /** Called within the session creation transaction. An existing attribution is never replaced. */
  save(id: string, value: z.infer<typeof schema>, now: string) {
    this.database
      .prepare('INSERT INTO app_state(state_key,json_value,updated_at) VALUES(?,?,?)')
      .run(`work-session-actor:v1:${id}`, JSON.stringify(schema.parse(value)), now);
  }
}
