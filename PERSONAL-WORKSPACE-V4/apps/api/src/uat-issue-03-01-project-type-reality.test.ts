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
const now = '2026-08-07T00:00:00.000Z';

function makeConfig(databasePath: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-issue-03-01-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
  });
}

function typeEntry(id: string, name: string, isActive: boolean) {
  return { id, name, isActive, createdAt: now, updatedAt: now };
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('UAT-ISSUE-03-01 catalogue-controlled Project Type editing', () => {
  it('preserves historical truth and validates explicit changes through the real API', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'uat-issue-03-01-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(path.join(directory, 'reality.sqlite'));
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date(now),
    });
    closeables.push(app);

    const villaId = randomUUID();
    const residentialId = randomUUID();
    const commercialId = randomUUID();
    const initialCatalogue = [
      typeEntry(villaId, 'Villa', true),
      typeEntry(residentialId, 'Residential', true),
      typeEntry(commercialId, 'Commercial', true),
    ];
    const configure = await app.inject({
      method: 'PATCH',
      url: '/api/personal/project-types',
      payload: initialCatalogue,
    });
    expect(configure.statusCode).toBe(200);

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Historical Villa Project',
        clientName: 'Original Client',
        projectType: 'Villa',
        description: 'Catalogue-control reality fixture.',
        siteLocation: 'Dubai, UAE',
        lightingScope: 'Interior lighting design.',
        estimatedHours: 16,
        requiredDeliveryDate: '2026-08-20',
        idempotencyKey: randomUUID(),
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<{
      data: { project: { id: string; projectCode: string; projectType: string; version: number } };
    }>().data.project;
    const originalId = created.id;
    const originalCode = created.projectCode;

    const luminaireResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${originalId}/luminaires`,
      payload: { tag: 'DL01', category: 'Downlight', quantity: 4 },
    });
    expect(luminaireResponse.statusCode).toBe(201);
    const luminaireId = luminaireResponse.json<{ data: { id: string } }>().data.id;

    const fullCatalogue = await app.inject({
      method: 'GET',
      url: '/api/project-types/catalog',
    });
    expect(fullCatalogue.statusCode).toBe(200);
    expect(fullCatalogue.json<{ data: unknown[] }>().data).toHaveLength(3);

    const commercialSeenActive = await app.inject({ method: 'GET', url: '/api/project-types' });
    expect(
      commercialSeenActive
        .json<{ data: Array<{ name: string }> }>()
        .data.some((type) => type.name === 'Commercial'),
    ).toBe(true);

    const deactivatedCatalogue = initialCatalogue.map((type) =>
      type.id === villaId || type.id === commercialId ? { ...type, isActive: false } : type,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/personal/project-types',
          payload: deactivatedCatalogue,
        })
      ).statusCode,
    ).toBe(200);

    const afterDeactivate = await app.inject({
      method: 'GET',
      url: `/api/projects/${originalId}`,
    });
    expect(afterDeactivate.json<{ data: { projectType: string } }>().data.projectType).toBe(
      'Villa',
    );

    const unrelatedEdit = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: {
        clientName: 'Updated Historical Client',
        projectType: 'Villa',
        expectedVersion: created.version,
      },
    });
    expect(unrelatedEdit.statusCode).toBe(200);
    const historical = unrelatedEdit.json<{
      data: {
        id: string;
        projectCode: string;
        clientName: string;
        projectType: string;
        version: number;
      };
    }>().data;
    expect(historical).toMatchObject({
      id: originalId,
      projectCode: originalCode,
      clientName: 'Updated Historical Client',
      projectType: 'Villa',
    });

    const arbitrary = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: {
        projectType: 'RANDOM_UNCONFIGURED_TYPE',
        expectedVersion: historical.version,
      },
    });
    expect(arbitrary.statusCode).toBe(400);
    expect(arbitrary.json<{ error: { message: string } }>().error.message).toContain(
      'active Project Type',
    );

    const staleCommercial = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: { projectType: 'Commercial', expectedVersion: historical.version },
    });
    expect(staleCommercial.statusCode).toBe(400);
    expect(staleCommercial.json<{ error: { message: string } }>().error.message).toContain(
      'no longer active',
    );

    const renamedCatalogue = deactivatedCatalogue.map((type) =>
      type.id === villaId ? { ...type, name: 'Villa / Residential' } : type,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/personal/project-types',
          payload: renamedCatalogue,
        })
      ).statusCode,
    ).toBe(200);
    const afterRename = await app.inject({
      method: 'GET',
      url: `/api/projects/${originalId}`,
    });
    expect(afterRename.json<{ data: { projectType: string } }>().data.projectType).toBe('Villa');
    const catalogueAfterRename = await app.inject({
      method: 'GET',
      url: '/api/personal/project-types',
    });
    expect(
      catalogueAfterRename
        .json<{ data: Array<{ name: string }> }>()
        .data.some((type) => type.name === 'Villa'),
    ).toBe(false);

    const missingHistoricalEdit = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: { description: 'Unrelated edit after rename.', expectedVersion: historical.version },
    });
    expect(missingHistoricalEdit.statusCode).toBe(200);
    const missingHistorical = missingHistoricalEdit.json<{
      data: { projectType: string; version: number };
    }>().data;
    expect(missingHistorical.projectType).toBe('Villa');

    const explicitActiveChange = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: {
        projectType: 'Residential',
        expectedVersion: missingHistorical.version,
      },
    });
    expect(explicitActiveChange.statusCode).toBe(200);
    const changed = explicitActiveChange.json<{
      data: { id: string; projectCode: string; projectType: string; version: number };
    }>().data;
    expect(changed).toMatchObject({
      id: originalId,
      projectCode: originalCode,
      projectType: 'Residential',
    });

    const inactiveReplacement = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${originalId}`,
      payload: { projectType: 'Villa / Residential', expectedVersion: changed.version },
    });
    expect(inactiveReplacement.statusCode).toBe(400);

    await app.close();
    closeables.pop();
    const reopenedProvider = new StandaloneDataProvider(config);
    const reopenedStore = new PersonalWorkspaceStore(config);
    closeables.push(reopenedProvider, reopenedStore);
    const reopened = await createApp({
      config,
      provider: reopenedProvider,
      personalStore: reopenedStore,
      clock: () => new Date(now),
    });
    closeables.push(reopened);

    const persisted = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${originalId}`,
    });
    expect(persisted.statusCode).toBe(200);
    expect(
      persisted.json<{ data: { id: string; projectCode: string; projectType: string } }>().data,
    ).toMatchObject({ id: originalId, projectCode: originalCode, projectType: 'Residential' });
    const reopenedWorkspace = await reopened.inject({
      method: 'GET',
      url: `/api/projects/${originalId}/workspace`,
    });
    expect(reopenedWorkspace.statusCode).toBe(200);
    expect(
      reopenedWorkspace
        .json<{ data: { luminaires: Array<{ id: string }> } }>()
        .data.luminaires.some((item) => item.id === luminaireId),
    ).toBe(true);
  });
});
