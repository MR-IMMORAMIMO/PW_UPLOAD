import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { PersonalProfileStore } from './PersonalProfileStore';

describe('personal profile presentation authority', () => {
  it('persists independently per actor, records each update and rejects invalid payloads', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    const store = new PersonalProfileStore(db, () => new Date('2026-09-11T00:00:00.000Z'));
    const profile = { name: 'Mohamed Ali', email: 'm@example.com', photo: null };
    store.save('owner-a', profile);
    expect(store.read('owner-a')).toEqual(profile);
    expect(store.read('owner-b')).toBeNull();
    expect(() => store.save('owner-a', { ...profile, email: 'invalid' })).toThrow();
    expect(store.read('owner-a')).toEqual(profile);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM app_state WHERE state_key LIKE 'profile-audit:%'").get()
        ?.n,
    ).toBe(1);
    expect(
      db.prepare("SELECT updated_at FROM app_state WHERE state_key = 'profile:v1:owner-a'").get()
        ?.updated_at,
    ).toBe('2026-09-11T00:00:00.000Z');
    db.close();
  });
});
