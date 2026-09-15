import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];
const nativeDialuxFixture = readFileSync(
  new URL('./test-fixtures/native-dialux.csv', import.meta.url),
  'utf8',
);

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-fix-05b-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
  });
}

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'uat-fix-05b-'));
  temporaryDirectories.push(directory);
  const root = path.join(directory, '001_MY_PROJECTS');
  mkdirSync(root, { recursive: true });
  const config = makeConfig(path.join(directory, 'reality.sqlite'), root);
  const provider = new StandaloneDataProvider(config);
  const store = new PersonalWorkspaceStore(config);
  closeables.push(provider, store);
  const app = await createApp({
    config,
    provider,
    personalStore: store,
    clock: () => new Date('2026-08-09T00:00:00.000Z'),
  });
  closeables.push(app);

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      projectName: 'UAT Fix 05B Native DIALux',
      clientName: 'UAT Client',
      projectType: 'Lighting Design',
      description: 'Native DIALux import compatibility.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'DIALux import regression.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2026-08-20',
      createFolders: false,
      services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      luminaireInputMode: 'Later',
      idempotencyKey: randomUUID(),
    },
  });
  expect(createResponse.statusCode).toBe(201);
  const projectId = createResponse.json<{ data: { project: { id: string } } }>().data.project.id;
  return { app, projectId };
}

async function getLuminaires(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workspace`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: { luminaires: Array<Record<string, unknown>> } }>().data.luminaires;
}

describe('UAT-FIX-05-B native DIALux production-style reality gate', () => {
  it('previews, adds and safely re-imports a native semicolon export', async () => {
    const { app, projectId } = await setup();

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: { source: 'DialuxCsv', csvText: nativeDialuxFixture },
    });
    expect(preview.statusCode).toBe(200);
    const previewData = preview.json<{
      data: {
        source: string;
        rows: Array<{
          status: string;
          existingId: string | null;
          changedFields: string[];
          record: Record<string, unknown>;
        }>;
      };
    }>().data;
    expect(previewData.source).toBe('DialuxCsv');
    expect(previewData.rows).toHaveLength(3);
    expect(previewData.rows.every((row) => row.status === 'Added')).toBe(true);
    expect(previewData.rows.map((row) => row.record.tag)).toEqual(['WL01', 'DL01', 'UL01']);

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'DialuxCsv',
        rows: previewData.rows.map((row) => ({
          action: 'Add',
          matchStatus: 'None',
          existingId: row.existingId,
          record: row.record,
        })),
      },
    });
    expect(commit.statusCode).toBe(201);
    expect(commit.json<{ data: { added: number } }>().data.added).toBe(3);

    const imported = await getLuminaires(app, projectId);
    expect(imported).toHaveLength(3);
    const dl01 = imported.find((record) => record.tag === 'DL01')!;
    expect(dl01).toMatchObject({
      manufacturer: 'FLOS',
      model: 'F12345',
      description: 'Coordinates modular downlight',
      lumens: '720',
      wattage: '8.5',
      lightColor: '2700K',
      cri: '90',
      quantity: 12,
      unit: 'No.',
    });

    const manualEnrichment = {
      ...dl01,
      manufacturer: 'MANUAL MANUFACTURER',
      model: 'MANUAL MODEL',
      description: 'Manually enriched description',
      wattage: 'Manual 18W',
      lumens: 'Manual 1800 lm',
      lightColor: 'Manual tunable white',
      cri: 'Manual CRI 98',
      sourceName: 'Manual project source name',
    };
    const manualUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/luminaires/${String(dl01.id)}`,
      payload: manualEnrichment,
    });
    expect(manualUpdate.statusCode).toBe(200);

    const sparseNativeDialux =
      'NumberText;ManufNameText;ArticleNumberText;ArticleNameText;' +
      'LuminaireLuminousFluxText;ConnectedLoadText;CCTText;CRIText;TAGText\n' +
      'pcs.;Manufacturer;Article No.;Article name;Lumens;P [W];CCT;CRI;TAG\n' +
      '9;–;-;;—;–;;-;DL01\n';
    const reimportPreview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: { source: 'DialuxCsv', csvText: sparseNativeDialux },
    });
    expect(reimportPreview.statusCode).toBe(200);
    const reimportRow = reimportPreview.json<{
      data: {
        rows: Array<{
          status: string;
          existingId: string;
          changedFields: string[];
          record: Record<string, unknown>;
        }>;
      };
    }>().data.rows[0]!;
    expect(reimportRow.status).toBe('Changed');
    expect(reimportRow.changedFields).toEqual(['quantity']);
    expect(reimportRow.record).toEqual({ tag: 'DL01', unit: 'No.', quantity: 9 });

    const reimportCommit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'DialuxCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: reimportRow.existingId,
            record: reimportRow.record,
          },
        ],
      },
    });
    expect(reimportCommit.statusCode).toBe(201);
    expect(reimportCommit.json<{ data: { updated: number } }>().data.updated).toBe(1);

    const updated = (await getLuminaires(app, projectId)).find((record) => record.tag === 'DL01')!;
    expect(updated).toMatchObject({
      quantity: 9,
      unit: 'No.',
      manufacturer: 'MANUAL MANUFACTURER',
      model: 'MANUAL MODEL',
      description: 'Manually enriched description',
      wattage: 'Manual 18W',
      lumens: 'Manual 1800 lm',
      lightColor: 'Manual tunable white',
      cri: 'Manual CRI 98',
      sourceName: 'Manual project source name',
    });
  });
});
