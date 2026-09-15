import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { WorkSessionAttributionStore } from './WorkSessionAttributionStore';

describe('work session attribution', () => {
  it('persists immutable operator metadata and rolls back with its session transaction', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(
      'CREATE TABLE app_state(state_key TEXT PRIMARY KEY,json_value TEXT NOT NULL,updated_at TEXT NOT NULL)',
    );
    const store = new WorkSessionAttributionStore(database);
    const actor = { actorId: '11111111-1111-4111-8111-111111111111', actorName: 'Designer One' };
    expect(store.read('historical')).toBeUndefined();
    database.exec('BEGIN');
    store.save('rolled-back', actor, '2026-09-11T00:00:00Z');
    database.exec('ROLLBACK');
    expect(store.read('rolled-back')).toBeUndefined();
    store.save('current', actor, '2026-09-11T00:00:00Z');
    expect(new WorkSessionAttributionStore(database).read('current')).toEqual(actor);
    expect(() =>
      store.save('current', { ...actor, actorName: 'Replacement' }, '2026-09-11T01:00:00Z'),
    ).toThrow();
    expect(store.read('current')).toEqual(actor);
    database.close();
  });
});
