import type { DatabaseSync } from 'node:sqlite';
import {
  finalUiPreferencesSchema,
  updateFinalUiPreferenceSchema,
  type FinalUiPreferences,
  type UpdateFinalUiPreference,
} from '@scli/contracts';

/** Uses the existing versioned app_state authority, isolated by server-resolved actor. */
export class FinalUiPreferenceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  read(actorId: string): FinalUiPreferences {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get(this.key(actorId));
    return row
      ? finalUiPreferencesSchema.parse(JSON.parse(String(row.json_value)))
      : { schemaVersion: 1, items: [] };
  }

  update(actorId: string, raw: UpdateFinalUiPreference): FinalUiPreferences {
    const input = updateFinalUiPreferenceSchema.parse(raw);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read(actorId);
      const current = state.items.find(
        (item) => item.kind === input.kind && item.targetId === input.targetId,
      );
      const rank = input.rank ?? current?.rank;
      const reviewedAt = input.markReviewed ? this.now() : current?.reviewedAt;
      const updated = {
        ...(reviewedAt ? { reviewedAt } : {}),
        ...(rank !== undefined ? { rank } : {}),
        kind: input.kind,
        targetId: input.targetId,
        favorite: input.favorite ?? current?.favorite ?? false,
        viewedAt: input.markViewed ? this.now() : (current?.viewedAt ?? null),
      };
      const next = finalUiPreferencesSchema.parse({
        schemaVersion: 1,
        items: [...state.items.filter((item) => item !== current), updated].sort(
          (a, b) =>
            (b.viewedAt ?? '').localeCompare(a.viewedAt ?? '') ||
            a.kind.localeCompare(b.kind) ||
            a.targetId.localeCompare(b.targetId),
        ),
      });
      this.database
        .prepare(
          'INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(state_key) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at',
        )
        .run(this.key(actorId), JSON.stringify(next), this.now());
      this.database.exec('COMMIT');
      return next;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private key(actorId: string): string {
    return `final-ui:preferences:v1:${actorId}`;
  }
}
