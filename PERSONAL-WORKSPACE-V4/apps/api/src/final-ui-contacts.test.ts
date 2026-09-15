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
describe('Final Contacts persisted fields', () => {
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
  it('persists phone and primary while old callers preserve omitted fields and explicit clears work', async () => {
    const base = {
      name: 'Actual contact',
      email: 'contact@example.test',
      company: 'Actual company',
      role: 'Consultant',
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/contacts`,
      headers,
      payload: { ...base, phone: '+971 50 1234567', isPrimary: true },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    expect(created.json().data).toMatchObject({
      phone: '+971 50 1234567',
      isPrimary: true,
      projectId: project.id,
    });
    const compatible = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/contacts/${id}`,
      headers,
      payload: { ...base, name: 'Renamed contact' },
    });
    expect(compatible.statusCode).toBe(200);
    expect(compatible.json().data).toMatchObject({ phone: '+971 50 1234567', isPrimary: true });
    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/contacts/${id}`,
      headers,
      payload: { ...base, phone: '', isPrimary: false },
    });
    expect(clear.statusCode).toBe(200);
    expect(store.getWorkspace(project.id).contacts.find((item) => item.id === id)).toMatchObject({
      phone: '',
      isPrimary: false,
    });
  });
  it('rejects forged identity, cross-project writes, and invalid persisted values', async () => {
    const base = { name: 'Contact', email: 'contact@example.test', company: '', role: '' };
    for (const payload of [
      { ...base, id: project.id },
      { ...base, projectId: other.id },
      { ...base, phone: 'x'.repeat(65) },
      { ...base, isPrimary: 'true' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/projects/${project.id}/contacts`,
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${other.id}/contacts`,
          headers,
          payload: base,
        })
      ).statusCode,
    ).toBe(403);
    expect(store.getWorkspace(project.id).contacts).toEqual([]);
  });
});
