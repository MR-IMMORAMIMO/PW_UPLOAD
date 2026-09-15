import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds } from '@scli/test-data';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'team',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMPANY_TIMEZONE: 'Asia/Dubai',
});

describe('HTTP authorization and validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp({
      config,
      provider: new MockDataProvider(),
      clock: () => new Date('2026-08-01T08:00:00.000Z'),
    });
  });

  afterEach(async () => app.close());

  it('denies a direct URL request to another Sales owner project', async () => {
    const unrelated = seedProjects.find((project) => project.salesOwnerId === seedUserIds.salesTwo);
    if (!unrelated) throw new Error('Missing unrelated project.');
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${unrelated.id}`,
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');
    expect(response.headers['x-correlation-id']).toBeTruthy();
  });

  it('denies Designer assignment and preserves the project', async () => {
    const project = seedProjects.find((candidate) => candidate.status === 'Unassigned');
    if (!project) throw new Error('Missing unassigned project.');
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/assign`,
      headers: { 'x-mock-user-id': seedUserIds.designerOne },
      payload: { designerId: seedUserIds.designerTwo },
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns a typed validation envelope for unsafe URLs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
      payload: {
        projectName: 'Unsafe URL',
        clientName: 'Client',
        projectType: 'Lighting Layout',
        description: '',
        priority: 'Normal',
        complexity: 'Small',
        estimatedHours: 2,
        requiredDeliveryDate: '2026-08-20',
        projectFolderUrl: 'http://example.com',
        idempotencyKey: '99999999-9999-4999-8999-999999999999',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
