import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ProjectDirectoryStore } from './ProjectDirectoryStore';

describe('Project directory', () => {
  it('persists identity without accounts and reuses duplicate names or email', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    const actor = '11111111-1111-4111-8111-111111111111';
    const store = new ProjectDirectoryStore(db, () => new Date('2026-09-11T10:00:00Z'));
    const first = store.add(actor, { kind: 'Manager', name: 'Alex Smith', email: '' });
    expect(store.add(actor, { kind: 'Manager', name: 'alex  smith', email: '' }).id).toBe(first.id);
    const client = store.add(actor, {
      kind: 'Client',
      name: 'Alex Smith',
      email: 'client@example.com',
    });
    expect(client.id).not.toBe(first.id);
    expect(
      store.add(actor, { kind: 'Client', name: 'Client alias', email: 'CLIENT@example.com' }).id,
    ).toBe(client.id);
    expect(new ProjectDirectoryStore(db).list()).toEqual([first, client]);
    expect(() => store.add(actor, { kind: 'Client', name: '', email: '' })).toThrow();
    expect(store.list()).toHaveLength(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: 'app_state' },
    ]);
    db.close();
  });
});
