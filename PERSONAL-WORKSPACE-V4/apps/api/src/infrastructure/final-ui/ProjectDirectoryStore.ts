import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  projectDirectorySchema,
  projectDirectoryInputSchema,
  type ProjectDirectoryInput,
  type ProjectDirectoryEntry,
} from '@scli/contracts';

/** Shared project labels/contacts. Entries grant no login or authorization role. */
export class ProjectDirectoryStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  list(): ProjectDirectoryEntry[] {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get('project-directory:v1');
    return row ? projectDirectorySchema.parse(JSON.parse(String(row.json_value))) : [];
  }
  add(actorId: string, raw: ProjectDirectoryInput): ProjectDirectoryEntry {
    const input = projectDirectoryInputSchema.parse(raw);
    // Synchronous read/write on the shared SQLite connection keeps duplicate admission atomic.
    const entries = this.list();
    const existing = entries.find(
      (entry) =>
        entry.kind === input.kind &&
        entry.isActive &&
        (entry.name.toLocaleLowerCase('en').replace(/\s+/g, ' ') ===
          input.name.toLocaleLowerCase('en').replace(/\s+/g, ' ') ||
          (input.email && entry.email.toLowerCase() === input.email.toLowerCase())),
    );
    if (existing) return existing;
    const entry = {
      ...input,
      email: input.email.toLowerCase(),
      id: randomUUID(),
      isActive: true,
      createdAt: this.clock().toISOString(),
      createdById: actorId,
    };
    const value = projectDirectorySchema.parse([...entries, entry]);
    this.database
      .prepare(
        'INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?) ON CONFLICT(state_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at',
      )
      .run('project-directory:v1', JSON.stringify(value), entry.createdAt);
    return entry;
  }
}
