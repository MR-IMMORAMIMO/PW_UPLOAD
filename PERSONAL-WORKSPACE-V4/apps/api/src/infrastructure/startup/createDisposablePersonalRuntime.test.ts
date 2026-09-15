import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects } from '@scli/test-data';
import { createApp } from '../../app.js';
import { createDisposablePersonalRuntime } from './createDisposablePersonalRuntime.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('disposable Personal startup authority', () => {
  it('hydrates seeded Projects, owner catalogues, and production Work Session routes coherently', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-phase3d-startup-'));
    roots.push(root);
    const storageConfig = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
    });
    const appConfig = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WEB_ORIGIN: 'http://127.0.0.1:4175',
      STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
    });
    const runtime = await createDisposablePersonalRuntime(storageConfig);
    const app = await createApp({
      config: appConfig,
      provider: runtime.provider,
      personalStore: runtime.store,
    });

    try {
      const project = seedProjects[0]!;
      for (const url of [
        '/api/me',
        '/api/personal/settings',
        '/api/action-categories',
        '/api/projects',
        `/api/projects/${project.id}`,
        `/api/projects/${project.id}/workspace`,
        `/api/personal/projects/${project.id}/tool-sessions`,
        '/api/personal/work-sessions/active',
      ]) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(200);
      }

      const start = await app.inject({
        method: 'POST',
        url: '/api/personal/work-sessions/start',
        payload: { projectId: project.id, idempotencyKey: randomUUID() },
      });
      expect(start.statusCode).toBe(201);
      for (const operation of ['pause', 'resume', 'stop']) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/personal/work-sessions/${operation}`,
          payload: { idempotencyKey: randomUUID() },
        });
        expect(response.statusCode, operation).toBe(200);
      }
    } finally {
      await app.close();
      await runtime.close();
    }
  });
});
