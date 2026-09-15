import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from '@scli/domain';
import {
  saveStudioDocumentSchema,
  storedStudioDocumentSchema,
  type SaveStudioDocument,
  type StoredStudioDocument,
} from '@scli/contracts';

/** Uses the existing backed-up app_state store; every saved version is immutable. */
export class StudioDocumentStore {
  public constructor(private readonly database: DatabaseSync) {}

  private prefix(projectId: string): string {
    return `luminaire-studio:v1:${projectId}:`;
  }

  public read(projectId: string): StoredStudioDocument | null {
    const row = this.database
      .prepare(
        'SELECT json_value FROM app_state WHERE state_key LIKE ? ORDER BY state_key DESC LIMIT 1',
      )
      .get(`${this.prefix(projectId)}%`) as { json_value: string } | undefined;
    if (!row) return null;
    const stored = storedStudioDocumentSchema.parse(JSON.parse(row.json_value));
    if (stored.projectId !== projectId || stored.document.id !== projectId)
      throw new DomainError(
        'CONFLICT',
        'Studio project identity does not match its storage key.',
        409,
      );
    return stored;
  }

  public operation(projectId: string, operationId: string): StoredStudioDocument | null {
    const row = this.database
      .prepare(
        "SELECT json_value FROM app_state WHERE state_key LIKE ? AND json_extract(json_value, '$.operationId') = ? LIMIT 1",
      )
      .get(`${this.prefix(projectId)}%`, operationId) as { json_value: string } | undefined;
    return row ? storedStudioDocumentSchema.parse(JSON.parse(row.json_value)) : null;
  }

  /** Caller owns the transaction together with canonical luminaire writes. */
  public save(
    projectId: string,
    raw: SaveStudioDocument,
    actor: { id: string; displayName: string },
    savedAt: string,
    requestHash?: string,
  ): StoredStudioDocument {
    const input = saveStudioDocumentSchema.parse(raw);
    if (input.document.id !== projectId)
      throw new DomainError('CONFLICT', 'Studio cannot change the current project identity.', 409);
    const previousOperation = this.database
      .prepare(
        "SELECT json_value FROM app_state WHERE state_key LIKE ? AND json_extract(json_value, '$.operationId') = ? LIMIT 1",
      )
      .get(`${this.prefix(projectId)}%`, input.operationId) as { json_value: string } | undefined;
    if (previousOperation) {
      const previous = storedStudioDocumentSchema.parse(JSON.parse(previousOperation.json_value));
      if (
        JSON.stringify(previous.document) !== JSON.stringify(input.document) ||
        previous.version !== input.expectedVersion + 1
      )
        throw new DomainError(
          'CONFLICT',
          'This save operation was already used for different Studio data.',
          409,
        );
      return previous;
    }
    const current = this.read(projectId);
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new DomainError(
        'CONFLICT',
        'Studio changed in another window. Reload before saving.',
        409,
      );
    const stored = storedStudioDocumentSchema.parse({
      projectId,
      version: input.expectedVersion + 1,
      operationId: input.operationId,
      actorId: actor.id,
      actorName: actor.displayName,
      savedAt,
      ...(requestHash ? { requestHash } : {}),
      document: input.document,
    });
    this.database
      .prepare('INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)')
      .run(
        `${this.prefix(projectId)}${String(stored.version).padStart(12, '0')}`,
        JSON.stringify(stored),
        savedAt,
      );
    return stored;
  }
}
