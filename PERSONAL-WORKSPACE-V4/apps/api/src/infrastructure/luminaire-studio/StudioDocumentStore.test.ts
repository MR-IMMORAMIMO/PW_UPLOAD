import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { studioDocumentSchema, type SaveStudioDocument } from '@scli/contracts';
import { StudioDocumentStore } from './StudioDocumentStore';

const projectId = '11111111-1111-4111-8111-111111111111';
const actor = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Review owner' };
const operationId = '33333333-3333-4333-8333-333333333333';
const time = '2026-09-10T00:00:00.000Z';
const input = (): SaveStudioDocument => ({
  expectedVersion: 0,
  operationId,
  document: {
    schemaVersion: 1,
    id: projectId,
    meta: { name: 'Radio Station' },
    luminaires: [],
    systems: [],
    accessories: [],
    customFields: [],
    output: { kind: 'schedule' },
  },
});
const databases: DatabaseSync[] = [];
const setup = () => {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(
    'CREATE TABLE app_state (state_key TEXT PRIMARY KEY, json_value TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
  return { database, store: new StudioDocumentStore(database) };
};
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('Studio persisted project documents', () => {
  it('keeps earlier versions and the actor, and reopens the latest saved data', () => {
    const { database, store } = setup();
    store.save(projectId, input(), actor, time);
    const next = input();
    next.expectedVersion = 1;
    next.operationId = '44444444-4444-4444-8444-444444444444';
    next.document.output.kind = 'boq';
    store.save(projectId, next, actor, time);
    expect(new StudioDocumentStore(database).read(projectId)).toMatchObject({
      version: 2,
      actorId: actor.id,
      document: { output: { kind: 'boq' } },
    });
    expect(database.prepare('SELECT count(*) AS count FROM app_state').get()).toMatchObject({
      count: 2,
    });
  });
  it('retries a successful operation without creating a second version', () => {
    const { store } = setup();
    const first = store.save(projectId, input(), actor, time);
    expect(store.save(projectId, input(), actor, time)).toEqual(first);
    expect(store.read(projectId)?.version).toBe(1);
  });
  it('rejects stale edits, changed retries and forged project identities', () => {
    const { store } = setup();
    store.save(projectId, input(), actor, time);
    const changed = input();
    changed.document.output.kind = 'boq';
    expect(() => store.save(projectId, changed, actor, time)).toThrow('different Studio data');
    changed.operationId = '44444444-4444-4444-8444-444444444444';
    expect(() => store.save(projectId, changed, actor, time)).toThrow('another window');
    expect(() => store.save(actor.id, input(), actor, time)).toThrow('identity');
  });
  it('participates in a rollback with canonical writes', () => {
    const { database, store } = setup();
    database.exec('BEGIN');
    store.save(projectId, input(), actor, time);
    database.exec('ROLLBACK');
    expect(store.read(projectId)).toBeNull();
  });
  it('rejects orphan system references and duplicate canonical identities', () => {
    const document = input().document;
    document.accessories.push({ id: actor.id, ref: 'A1', systemId: operationId });
    expect(studioDocumentSchema.safeParse(document).success).toBe(false);
    document.systems.push({ id: operationId, code: 'TR-01' });
    expect(studioDocumentSchema.safeParse(document).success).toBe(true);
    document.systems.push({ id: operationId, code: 'TR-02' });
    expect(studioDocumentSchema.safeParse(document).success).toBe(false);
  });
});
