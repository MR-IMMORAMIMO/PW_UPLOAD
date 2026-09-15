import type { DatabaseSync } from 'node:sqlite';
import { projectWizardDraftSchema, type ProjectWizardDraft } from '@scli/contracts';

/** Actor-scoped input only. This store never calls project/folder/sequence services. */
export class ProjectWizardDraftStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  read(actorId: string): ProjectWizardDraft | null {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get(`project-wizard:v1:${actorId}`);
    return row ? projectWizardDraftSchema.parse(JSON.parse(String(row.json_value))) : null;
  }
  save(actorId: string, input: ProjectWizardDraft): ProjectWizardDraft {
    const value = projectWizardDraftSchema.parse(input);
    this.database
      .prepare(
        'INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?) ON CONFLICT(state_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at',
      )
      .run(`project-wizard:v1:${actorId}`, JSON.stringify(value), this.clock().toISOString());
    return value;
  }
  remove(actorId: string): void {
    this.database
      .prepare('DELETE FROM app_state WHERE state_key = ?')
      .run(`project-wizard:v1:${actorId}`);
  }
}
