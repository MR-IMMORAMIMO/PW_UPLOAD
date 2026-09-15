import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { confirmDatasheetFieldSchema, type ConfirmDatasheetFieldInput } from '@scli/contracts';
import { DomainError } from '@scli/domain';

const recordSchema = confirmDatasheetFieldSchema
  .extend({
    schemaVersion: z.literal(1),
    projectId: z.string().uuid(),
    luminaireId: z.string().uuid(),
    assetVersionId: z.string().uuid(),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/),
    actorId: z.string().min(1),
    actorName: z.string().min(1),
    at: z.string().datetime(),
  })
  .strict();
export type DatasheetConfirmation = z.infer<typeof recordSchema>;

/** Append-only review decisions, scoped to an immutable attached AssetVersion. */
export class DatasheetConfirmationStore {
  constructor(private readonly db: DatabaseSync) {}
  private prefix(project: string, luminaire: string, asset: string, field: string) {
    return `datasheet-confirmation:v1:${project}:${luminaire}:${asset}:${field}:`;
  }
  latest(
    project: string,
    luminaire: string,
    asset: string,
    hash: string,
    field: string,
  ): DatasheetConfirmation | null {
    const row = this.db
      .prepare(
        'SELECT json_value FROM app_state WHERE state_key LIKE ? ORDER BY updated_at DESC, rowid DESC LIMIT 1',
      )
      .get(`${this.prefix(project, luminaire, asset, field)}%`);
    if (!row) return null;
    const record = recordSchema.parse(JSON.parse(String(row.json_value)));
    return record.fileHash === hash ? record : null;
  }
  existing(input: ConfirmDatasheetFieldInput, project: string, luminaire: string, asset: string) {
    const key = this.prefix(project, luminaire, asset, input.fieldKey) + input.operationId;
    const row = this.db.prepare('SELECT json_value FROM app_state WHERE state_key=?').get(key);
    if (!row) return null;
    const record = recordSchema.parse(JSON.parse(String(row.json_value)));
    if (
      Boolean(record.acceptIdentityMismatch) !== Boolean(input.acceptIdentityMismatch) ||
      record.value !== input.value ||
      record.note !== input.note ||
      record.pageNumber !== input.pageNumber ||
      record.verificationFingerprint !== input.verificationFingerprint
    )
      throw new DomainError(
        'CONFLICT',
        'The confirmation operation was already used with different content.',
        409,
      );
    return record;
  }
  append(record: DatasheetConfirmation) {
    const checked = recordSchema.parse(record);
    this.db
      .prepare('INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?)')
      .run(
        this.prefix(
          checked.projectId,
          checked.luminaireId,
          checked.assetVersionId,
          checked.fieldKey,
        ) + checked.operationId,
        JSON.stringify(checked),
        checked.at,
      );
  }
}
