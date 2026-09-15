import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedUserIds } from '@scli/test-data';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMPANY_TIMEZONE: 'Asia/Dubai',
});

describe('global Action Category API', () => {
  let app: FastifyInstance;
  const admin = { 'x-mock-user-id': seedUserIds.admin };
  beforeEach(async () => {
    app = await createApp({ config, provider: new MockDataProvider() });
  });
  afterEach(async () => app.close());

  it('uses authenticated global routes with canonical validation and conflict errors', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/action-categories' })).statusCode).toBe(
      403,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/action-categories',
          headers: { 'x-mock-user-id': seedUserIds.salesOne },
          payload: { label: 'A0 API', iconKey: 'lightbulb', colorKey: 'teal' },
        })
      ).statusCode,
    ).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: '/api/action-categories',
      headers: admin,
      payload: { label: '  A0   API ', iconKey: 'lightbulb', colorKey: 'teal' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ label: 'A0 API', sortOrder: 17 });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/action-categories',
      headers: admin,
      payload: { label: 'a0 api', iconKey: 'sun', colorKey: 'blue' },
    });
    expect(duplicate.statusCode).toBe(409);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/action-categories',
      headers: admin,
      payload: { label: 'Invalid', iconKey: 'raw-lucide-name', colorKey: 'teal' },
    });
    expect(invalid.statusCode).toBe(400);
    const categoryId = created.json().data.id as string;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/action-categories/${categoryId}`,
          headers: admin,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/action-categories/${categoryId}`,
          headers: admin,
          payload: { label: 'Missing', iconKey: 'sun', colorKey: 'blue' },
        })
      ).statusCode,
    ).toBe(404);
  });
});
