import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { createApp } from './app';
import { StandaloneDataProvider } from './standalone-data-provider';

const temporaryDirectories: string[] = [];

function testSetup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'scli-standalone-'));
  temporaryDirectories.push(directory);
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'team',
    PERSONAL_AUTO_LOGIN: 'false',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: path.join(directory, 'scli.sqlite'),
    STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Local Admin',
    STANDALONE_ADMIN_EMAIL: 'admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
  });
  return { config, provider: new StandaloneDataProvider(config) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('standalone deployment mode', () => {
  it('authenticates locally and protects API routes with a signed session', async () => {
    const { config, provider } = testSetup();
    const app = await createApp({ config, provider });

    const denied = await app.inject({ method: 'GET', url: '/api/me' });
    expect(denied.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@local.test', password: 'A-Strong-Local-Password-2026!' },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json<{ data: { token: string } }>().data.token;
    const adminId = login.json<{ data: { user: { id: string } } }>().data.user.id;

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ data: { email: string; role: string } }>().data).toMatchObject({
      email: 'admin@local.test',
      role: 'Admin',
    });

    const createdUser = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        displayName: 'New Sales User',
        email: 'sales@local.test',
        jobTitle: 'Sales Executive',
        department: 'Lighting Solutions',
        role: 'Sales',
        weeklyCapacityHours: 0,
        availabilityStatus: 'Available',
        initialPassword: 'Sales-Password-2026!',
      },
    });
    expect(createdUser.statusCode).toBe(201);
    const userLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sales@local.test', password: 'Sales-Password-2026!' },
    });
    expect(userLogin.statusCode).toBe(200);
    expect(userLogin.json<{ data: { user: { role: string } } }>().data.user.role).toBe('Sales');

    const preventLastAdminDemotion = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${adminId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'Sales' },
    });
    expect(preventLastAdminDemotion.statusCode).toBe(400);

    const resetAdminPassword = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId}/password`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'Replacement-Admin-Password-2026!' },
    });
    expect(resetAdminPassword.statusCode).toBe(200);
    const staleSession = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(staleSession.statusCode).toBe(401);

    await app.close();
    provider.close();
  });

  it('persists users and password hashes across restarts', async () => {
    const { config, provider } = testSetup();
    const now = '2026-08-01T08:00:00.000Z';
    const user = await provider.createUser({
      id: '88888888-8888-4888-8888-888888888888',
      entraObjectId: 'standalone:88888888-8888-4888-8888-888888888888',
      displayName: 'Local Lighting Designer',
      email: 'designer@local.test',
      jobTitle: 'Lighting Designer',
      department: 'Lighting Solutions',
      role: 'Designer',
      weeklyCapacityHours: 40,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await provider.setPassword(user.id, 'Designer-Password-2026!');
    provider.close();

    const reopened = new StandaloneDataProvider(config);
    await expect(
      reopened.verifyCredentials('designer@local.test', 'Designer-Password-2026!'),
    ).resolves.toMatchObject({ id: user.id, role: 'Designer' });
    await expect(
      reopened.verifyCredentials('designer@local.test', 'wrong-password'),
    ).resolves.toBeNull();
    reopened.close();
  });
});
