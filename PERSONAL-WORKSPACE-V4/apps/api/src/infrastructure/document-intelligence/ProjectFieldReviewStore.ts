import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { keepProjectFieldSchema } from '@scli/contracts';
import { DomainError } from '@scli/domain';
const schema = keepProjectFieldSchema
  .extend({
    projectId: z.uuid(),
    luminaireId: z.uuid(),
    assetVersionId: z.uuid(),
    projectValue: z.string(),
    actorId: z.string().min(1),
    actorName: z.string().min(1),
    at: z.string().datetime(),
  })
  .strict();
type Review = z.infer<typeof schema>;
/** Review metadata only: it must never turn a conflict into a match or change extracted evidence. */
export class ProjectFieldReviewStore {
  constructor(private readonly db: DatabaseSync) {}
  private prefix(project: string, luminaire: string, fingerprint: string) {
    return `project-field-keep:v1:${project}:${luminaire}:${fingerprint}:`;
  }
  append(input: Review) {
    const record = schema.parse(input);
    const key =
      this.prefix(record.projectId, record.luminaireId, record.verificationFingerprint) +
      record.fieldKey +
      ':' +
      record.operationId;
    const existing = this.db.prepare('SELECT json_value FROM app_state WHERE state_key=?').get(key);
    if (existing) {
      const previous = schema.parse(JSON.parse(String(existing.json_value)));
      if (
        previous.projectValue !== record.projectValue ||
        previous.assetVersionId !== record.assetVersionId
      )
        throw new DomainError('CONFLICT', 'This review operation was already used.', 409);
      return;
    }
    this.db
      .prepare('INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?)')
      .run(key, JSON.stringify(record), record.at);
  }
  list(project: string, luminaire: string, fingerprint: string) {
    return this.db
      .prepare('SELECT json_value FROM app_state WHERE state_key LIKE ? ORDER BY updated_at, rowid')
      .all(this.prefix(project, luminaire, fingerprint) + '%')
      .map((row) => schema.parse(JSON.parse(String(row.json_value))));
  }
}
