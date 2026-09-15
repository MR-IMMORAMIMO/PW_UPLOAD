import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];

function makeConfig(databasePath: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p29a-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
  });
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('P2.9A Personal project-type catalogue reality', () => {
  it('Personal write persists the canonical catalogue and GET /api/project-types reflects it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p29a-reality-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(path.join(directory, 'reality.sqlite'));

    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    // The canonical catalogue is seeded with defaults (no separate Personal copy).
    const initial = await app.inject({ method: 'GET', url: '/api/personal/project-types' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json<{ data: unknown[] }>().data.length).toBeGreaterThan(0);

    // Personal write persists a canonical catalogue.
    const now = '2026-08-07T00:00:00.000Z';
    const catalogue = [
      {
        id: randomUUID(),
        name: 'Healthcare',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        name: 'Hospital',
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const write = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: catalogue,
    });
    expect(write.statusCode).toBe(200);
    expect(write.json<{ data: unknown[] }>().data).toHaveLength(2);

    // GET /api/project-types (the shared New Project source) returns only active.
    const shared = await app.inject({ method: 'GET', url: '/api/project-types' });
    expect(shared.statusCode).toBe(200);
    const active = shared.json<{ data: Array<{ name: string; isActive: boolean }> }>().data;
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Healthcare');

    // The Personal read returns the same canonical catalogue (no second copy).
    const personalRead = await app.inject({ method: 'GET', url: '/api/personal/project-types' });
    expect(personalRead.json<{ data: unknown[] }>().data).toHaveLength(2);

    // Reopen: the persisted canonical catalogue survives.
    await app.close();
    closeables.pop();
    const reopenedProvider = new StandaloneDataProvider(config);
    const reopenedStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenedProvider, reopenedStore);
    const reopened = await createApp({
      config,
      provider: reopenedProvider,
      personalStore: reopenedStore,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(reopened);
    const reopenedRead = await reopened.inject({
      method: 'GET',
      url: '/api/personal/project-types',
    });
    expect(reopenedRead.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('rejects duplicate, case-variant, and zero-active catalogue payloads', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p29a-reality-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(path.join(directory, 'reality.sqlite'));

    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    const now = '2026-08-07T00:00:00.000Z';
    const entry = (name: string, isActive = true) => ({
      id: randomUUID(),
      name,
      isActive,
      createdAt: now,
      updatedAt: now,
    });

    // Exact duplicate rejected.
    const dup = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: [entry('Hospital'), entry('Hospital')],
    });
    expect(dup.statusCode).toBe(400);

    // Case-variant duplicate rejected.
    const caseDup = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: [entry('Hospital'), entry('hospital')],
    });
    expect(caseDup.statusCode).toBe(400);

    // Zero-active catalogue rejected.
    const zeroActive = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: [entry('Hospital', false), entry('Healthcare', false)],
    });
    expect(zeroActive.statusCode).toBe(400);

    // A valid unique catalogue still parses.
    const valid = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: [entry('Hospital'), entry('Healthcare')],
    });
    expect(valid.statusCode).toBe(200);
  });
});
