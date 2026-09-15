import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { FinalUiPreferenceStore } from './FinalUiPreferenceStore';

const databases: DatabaseSync[] = [];
function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(
    'CREATE TABLE app_state(state_key TEXT PRIMARY KEY,json_value TEXT NOT NULL,updated_at TEXT NOT NULL)',
  );
  return {
    database,
    store: new FinalUiPreferenceStore(database, () => '2026-09-09T10:00:00.000Z'),
  };
}
afterEach(() => databases.splice(0).forEach((database) => database.close()));
const input = { kind: 'PROJECT' as const, targetId: '12345678-1234-4123-8123-123456789abc' };
describe('Final UI persisted preferences', () => {
  it('isolates actors and preserves favorites when recording a later visit', () => {
    const { database, store } = setup();
    store.update('actor-a', { ...input, favorite: true });
    store.update('actor-a', { ...input, markViewed: true });
    expect(new FinalUiPreferenceStore(database).read('actor-a').items).toEqual([
      { ...input, favorite: true, viewedAt: '2026-09-09T10:00:00.000Z' },
    ]);
    expect(store.read('actor-b').items).toEqual([]);
    store.update('actor-a', { ...input, favorite: false });
    expect(store.read('actor-a').items[0]).toMatchObject({
      favorite: false,
      viewedAt: '2026-09-09T10:00:00.000Z',
    });
  });
  it('does not overwrite other application state or another entity kind', () => {
    const { database, store } = setup();
    database
      .prepare('INSERT INTO app_state VALUES(?,?,?)')
      .run('primary', '{"history":"preserved"}', 'original');
    store.update('actor', { ...input, favorite: true });
    store.update('actor', { ...input, kind: 'LIBRARY_PRODUCT', favorite: true });
    expect(store.read('actor').items).toHaveLength(2);
    expect(
      database.prepare('SELECT json_value FROM app_state WHERE state_key = ?').get('primary')
        ?.json_value,
    ).toBe('{"history":"preserved"}');
  });
  it('rejects extra identity fields and malformed persisted data without losing history', () => {
    const { database, store } = setup();
    expect(() =>
      store.update('actor', { ...input, favorite: true, actorId: 'forged' } as never),
    ).toThrow();
    database
      .prepare('INSERT INTO app_state VALUES(?,?,?)')
      .run('final-ui:preferences:v1:actor', '{"broken":true}', 'original');
    expect(() => store.update('actor', { ...input, favorite: true })).toThrow();
    expect(
      database
        .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
        .get('final-ui:preferences:v1:actor')?.json_value,
    ).toBe('{"broken":true}');
    expect(database.isTransaction).toBe(false);
  });
});
