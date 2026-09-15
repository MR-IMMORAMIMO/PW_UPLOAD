import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { personalProfileSchema, type PersonalProfile } from '@scli/contracts';

export class PersonalProfileStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  read(actorId: string): PersonalProfile | null {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get(`profile:v1:${actorId}`);
    return row ? personalProfileSchema.parse(JSON.parse(String(row.json_value))) : null;
  }
  save(actorId: string, input: PersonalProfile): PersonalProfile {
    const profile = personalProfileSchema.parse(input);
    const now = this.clock().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          'INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?) ON CONFLICT(state_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at',
        )
        .run(`profile:v1:${actorId}`, JSON.stringify(profile), now);
      this.database
        .prepare('INSERT INTO app_state (state_key,json_value,updated_at) VALUES (?,?,?)')
        .run(
          `profile-audit:v1:${randomUUID()}`,
          JSON.stringify({
            actorId,
            actorName: profile.name,
            action: 'PROFILE_UPDATED',
            occurredAt: now,
          }),
          now,
        );
      this.database.exec('COMMIT');
      return profile;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
