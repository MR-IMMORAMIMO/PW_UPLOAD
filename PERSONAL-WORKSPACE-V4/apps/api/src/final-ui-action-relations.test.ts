import {
  luminaireRecordSchema,
  projectReviewItemSchema,
  projectActionItemSchema,
} from '@scli/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds } from '@scli/test-data';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMPANY_TIMEZONE: 'Asia/Dubai',
});
const project = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesOne)!;
const other = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesTwo)!;
const headers = { 'x-mock-user-id': seedUserIds.salesOne };
describe('Final Action context authority', () => {
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;
  beforeEach(async () => {
    store = new PersonalWorkspaceStore(config);
    store.initializeProject(project.id, [], 'Full Lighting Design', 'Later', '2026-09-09');
    app = await createApp({ config, provider: new MockDataProvider(), personalStore: store });
  });
  afterEach(async () => {
    await app?.close();
    store?.close();
  });
  it('persists actor-owned preferences while denying foreign project and forged actor changes', async () => {
    const url = '/api/personal/ui-preferences';
    const changed = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: {
        kind: 'PROJECT',
        targetId: project.id,
        favorite: true,
        rank: 2,
        markReviewed: true,
      },
    });
    expect(changed.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url, headers });
    expect(read.json().data.items).toEqual([
      expect.objectContaining({
        targetId: project.id,
        favorite: true,
        rank: 2,
        reviewedAt: expect.any(String),
      }),
    ]);
    const otherRead = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-mock-user-id': seedUserIds.salesTwo },
    });
    expect(otherRead.json().data.items).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { kind: 'PROJECT', targetId: other.id, favorite: true },
        })
      ).statusCode,
    ).toBe(403);
    for (const extra of [{ actorId: seedUserIds.salesTwo }, { rank: -1 }, { rank: 5001 }]) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers,
            payload: { kind: 'PROJECT', targetId: project.id, favorite: false, ...extra },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url, headers })).json().data.items[0].favorite).toBe(
      true,
    );
  });
  it('rolls back Action content and row version when immutable activity cannot be recorded', () => {
    const action = store.operations.createAction(
      project.id,
      projectActionItemSchema.parse({ title: 'Original', owner: 'Owner' }),
    );
    const database = store.getSharedDatabase();
    database.exec(
      "CREATE TEMP TRIGGER deny_action_audit BEFORE INSERT ON workspace_activity BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    );
    expect(() =>
      store.operations.patchAction(
        project.id,
        action.id,
        { title: 'Should roll back' },
        action.rowVersion ?? 1,
        { id: seedUserIds.salesOne, name: 'Actor' },
      ),
    ).toThrow('audit unavailable');
    expect(store.getWorkspace(project.id).actions.find((item) => item.id === action.id)).toEqual(
      action,
    );
  });
  it('authorizes persisted technical results before accessing project records', async () => {
    const url = `/api/projects/${project.id}/local-intelligence/datasheet-results`;
    const admitted = await app.inject({ method: 'GET', url, headers });
    // This legacy in-memory fixture has no v27 extraction authority. Admission
    // reaches that capability check; foreign and inactive callers must not.
    expect(admitted.statusCode).toBe(409);
    expect(admitted.json().error.message).toContain('schema v27');
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/projects/${other.id}/local-intelligence/datasheet-results`,
      headers,
    });
    expect(foreign.statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-mock-user-id': 'inactive-user' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
  it('persists canonical same-project links and preserves them through legacy and sparse updates', async () => {
    const luminaire = store.addLuminaire(
      project.id,
      luminaireRecordSchema.parse({ tag: 'FINAL-01' }),
    );
    const review = store.operations.createReview(
      project.id,
      projectReviewItemSchema.parse({ title: 'Actual linked review', receivedAt: '2026-09-09' }),
    );
    const base = { title: 'Coordinated action', owner: 'Actual owner', priority: 'Low' };
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      headers,
      payload: { ...base, area: 'Reception', luminaireId: luminaire.id, reviewItemId: review.id },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    expect(created.json().data).toMatchObject({
      area: 'Reception',
      luminaireId: luminaire.id,
      reviewItemId: review.id,
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/actions/${id}`,
      headers,
      payload: { ...base, title: 'Renamed action' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      area: 'Reception',
      luminaireId: luminaire.id,
      reviewItemId: review.id,
      rowVersion: 2,
    });
    expect(() =>
      store.operations.patchAction(project.id, id, { area: 'Stale' }, 1, {
        id: seedUserIds.salesOne,
        name: 'Actor',
      }),
    ).toThrow('changed by another edit');
    const cleared = store.operations.patchAction(
      project.id,
      id,
      { area: '', luminaireId: null, reviewItemId: null },
      2,
      { id: seedUserIds.salesOne, name: 'Actor' },
    );
    expect(cleared).toMatchObject({
      area: '',
      luminaireId: null,
      reviewItemId: null,
      rowVersion: 3,
    });
  });
  it('accepts final editor fields through CAS and rejects stale or over-posted mutations', async () => {
    const category = store.operations.listActionCategories()[0];
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      headers,
      payload: { title: 'CAS action', owner: 'Owner', sourceType: 'Manual' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    const url = `/api/projects/${project.id}/actions/${id}/merge`;
    const changed = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: {
        rowVersion: 1,
        ownerRole: 'Lead',
        categoryId: category?.id ?? null,
        area: 'Lobby',
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data).toMatchObject({ rowVersion: 2, ownerRole: 'Lead', area: 'Lobby' });
    const stale = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { rowVersion: 1, area: 'Lost update' },
    });
    expect(stale.statusCode).toBe(409);
    const forged = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { rowVersion: 2, sourceId: project.id },
    });
    expect(forged.statusCode).toBe(400);
    expect(store.getWorkspace(project.id).actions[0]).toMatchObject({
      rowVersion: 2,
      area: 'Lobby',
      sourceId: null,
    });
  });
  it('rejects cross-project linked identities before writing an Action', async () => {
    store.initializeProject(other.id, [], 'Full Lighting Design', 'Later', '2026-09-09');
    const luminaire = store.addLuminaire(
      other.id,
      luminaireRecordSchema.parse({ tag: 'OTHER-01' }),
    );
    const review = store.operations.createReview(
      other.id,
      projectReviewItemSchema.parse({ title: 'Other review', receivedAt: '2026-09-09' }),
    );
    for (const links of [{ luminaireId: luminaire.id }, { reviewItemId: review.id }]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/actions`,
        headers,
        payload: { title: 'Must not persist', owner: 'Actual owner', ...links },
      });
      expect(response.statusCode).toBe(404);
    }
    expect(store.getWorkspace(project.id).actions).toEqual([]);
  });
});
