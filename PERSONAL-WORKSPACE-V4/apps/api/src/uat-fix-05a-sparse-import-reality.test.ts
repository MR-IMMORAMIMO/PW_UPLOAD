import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-fix-05a-secret-that-is-longer-than-thirty-two-characters',
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

interface TestContext {
  app: Awaited<ReturnType<typeof createApp>>;
  projectId: string;
}

async function setup(): Promise<TestContext> {
  const directory = mkdtempSync(path.join(tmpdir(), 'uat-fix-05a-'));
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
      projectName: 'UAT Fix 05A Sparse Import',
      clientName: 'UAT Client',
      projectType: 'Villa Lighting Design',
      description: 'Sparse import data safety.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Sparse import regression.',
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

async function addLuminaire(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  record: Record<string, unknown>,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires`,
    payload: record,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function getLuminaire(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  tag: string,
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workspace`,
  });
  expect(response.statusCode).toBe(200);
  const luminaires = response.json<{ data: { luminaires: Array<Record<string, unknown>> } }>().data
    .luminaires;
  const found = luminaires.find((item) => item.tag === tag);
  if (!found) throw new Error(`Luminaire ${tag} not found.`);
  return found;
}

const fullDl07 = {
  tag: 'DL07',
  category: 'Spotlight',
  description: 'SPARSE BASELINE SEVEN',
  manufacturer: 'PRESERVE-MFR-07',
  model: 'PRESERVE-MODEL-07',
  wattage: '17W',
  lumens: '1700 lm',
  lightColor: '3500K',
  cri: 'CRI 95',
  beamAngle: '27°',
  ipRating: 'IP54',
  mounting: 'Surface',
  bodyColorFinish: 'White',
  control: 'DALI-2',
  location: 'Level 07',
  unit: 'No.',
  sourceName: 'SPARSE-UAT-07',
  quantity: 17,
  imagePath: '/images/dl07.png',
  datasheetPath: '/datasheets/dl07.pdf',
  notes: 'Manual enrichment note',
};

describe('UAT-FIX-05-A sparse luminaire import data safety', () => {
  it('sparse AutoCAD preview lists only source-supplied changed fields', async () => {
    const { app, projectId } = await setup();
    await addLuminaire(app, projectId, fullDl07);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\n',
      },
    });
    expect(preview.statusCode).toBe(200);
    const row = preview.json<{
      data: { rows: Array<{ status: string; changedFields: string[] }> };
    }>().data.rows[0]!;
    expect(row.status).toBe('Changed');
    // Only source-supplied fields whose values differ may be listed.
    expect(row.changedFields).toEqual(expect.arrayContaining(['description', 'quantity']));
    // Absent technical columns must never be reported as changed-to-empty.
    for (const field of [
      'category',
      'manufacturer',
      'model',
      'wattage',
      'lumens',
      'lightColor',
      'cri',
      'beamAngle',
      'ipRating',
      'mounting',
      'bodyColorFinish',
      'control',
      'location',
      'sourceName',
      'imagePath',
      'datasheetPath',
      'notes',
    ]) {
      expect(row.changedFields).not.toContain(field);
    }
  });

  it('sparse AutoCAD explicit Update preserves technical enrichment', async () => {
    const { app, projectId } = await setup();
    const luminaireId = await addLuminaire(app, projectId, fullDl07);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\n',
      },
    });
    const row = preview.json<{ data: { rows: Array<{ record: Record<string, unknown> }> } }>().data
      .rows[0]!;

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: luminaireId,
            record: row.record,
          },
        ],
      },
    });
    expect(commit.statusCode).toBe(201);
    expect(commit.json<{ data: { updated: number } }>().data.updated).toBe(1);

    const updated = await getLuminaire(app, projectId, 'DL07');
    // Supplied fields changed.
    expect(updated.description).toBe('SPARSE UPDATED SEVEN');
    expect(updated.quantity).toBe(27);
    // Absent technical fields preserved.
    expect(updated.category).toBe('Spotlight');
    expect(updated.manufacturer).toBe('PRESERVE-MFR-07');
    expect(updated.model).toBe('PRESERVE-MODEL-07');
    expect(updated.wattage).toBe('17W');
    expect(updated.lumens).toBe('1700 lm');
    expect(updated.lightColor).toBe('3500K');
    expect(updated.cri).toBe('CRI 95');
    expect(updated.beamAngle).toBe('27°');
    expect(updated.ipRating).toBe('IP54');
    expect(updated.mounting).toBe('Surface');
    expect(updated.bodyColorFinish).toBe('White');
    expect(updated.control).toBe('DALI-2');
    expect(updated.location).toBe('Level 07');
    expect(updated.sourceName).toBe('SPARSE-UAT-07');
    // imagePath / datasheetPath / notes survive when columns absent.
    expect(updated.imagePath).toBe('/images/dl07.png');
    expect(updated.datasheetPath).toBe('/datasheets/dl07.pdf');
    expect(updated.notes).toBe('Manual enrichment note');
  });

  it('explicit blank in a present column is distinguishable from an absent column', async () => {
    const { app, projectId } = await setup();
    await addLuminaire(app, projectId, { ...fullDl07, tag: 'DL08', manufacturer: 'PRESERVE-MFR' });

    // MANUFACTURER column present with an explicit blank value.
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG,MANUFACTURER,DESCRIPTION\nDL08,,Updated description\n',
      },
    });
    const row = preview.json<{ data: { rows: Array<{ changedFields: string[] }> } }>().data
      .rows[0]!;
    // The clear operation must be visible in the preview.
    expect(row.changedFields).toContain('manufacturer');
    expect(row.changedFields).toContain('description');
  });

  it('DIALux sparse import obeys the same presence semantics', async () => {
    const { app, projectId } = await setup();
    const luminaireId = await addLuminaire(app, projectId, fullDl07);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'DialuxCsv',
        csvText: 'TAG\tQUANTITY\nDL07\t27\n',
      },
    });
    const row = preview.json<{
      data: { rows: Array<{ changedFields: string[]; record: Record<string, unknown> }> };
    }>().data.rows[0]!;
    expect(row.changedFields).toEqual(['quantity']);
    expect(row.changedFields).not.toContain('manufacturer');

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'DialuxCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: luminaireId,
            record: row.record,
          },
        ],
      },
    });
    expect(commit.statusCode).toBe(201);

    const updated = await getLuminaire(app, projectId, 'DL07');
    expect(updated.quantity).toBe(27);
    expect(updated.manufacturer).toBe('PRESERVE-MFR-07');
    expect(updated.description).toBe('SPARSE BASELINE SEVEN');
  });

  it('Paste-from-Excel sparse import obeys the same presence semantics', async () => {
    const { app, projectId } = await setup();
    const luminaireId = await addLuminaire(app, projectId, fullDl07);

    // Paste-from-Excel uses the same import-preview endpoint with tab-delimited text.
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG\tDESCRIPTION\tQUANTITY\tUNIT\nDL07\tPasted update\t27\tNo.\n',
      },
    });
    const row = preview.json<{
      data: { rows: Array<{ changedFields: string[]; record: Record<string, unknown> }> };
    }>().data.rows[0]!;
    expect(row.changedFields).toEqual(expect.arrayContaining(['description', 'quantity']));
    expect(row.changedFields).not.toContain('manufacturer');

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: luminaireId,
            record: row.record,
          },
        ],
      },
    });
    expect(commit.statusCode).toBe(201);

    const updated = await getLuminaire(app, projectId, 'DL07');
    expect(updated.description).toBe('Pasted update');
    expect(updated.quantity).toBe(27);
    expect(updated.manufacturer).toBe('PRESERVE-MFR-07');
  });

  it('add-only import remains unchanged and changed rows stay untouched without explicit Update', async () => {
    const { app, projectId } = await setup();
    await addLuminaire(app, projectId, fullDl07);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText:
          'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\nDL99,New luminaire,5,No.\n',
      },
    });
    const rows = preview.json<{
      data: { rows: Array<{ status: string; record: Record<string, unknown> }> };
    }>().data.rows;
    const changedRow = rows.find((row) => row.record.tag === 'DL07')!;
    const addedRow = rows.find((row) => row.record.tag === 'DL99')!;
    expect(changedRow.status).toBe('Changed');
    expect(addedRow.status).toBe('Added');

    // Only add the new row; the changed existing row must not be mutated.
    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [{ action: 'Add', matchStatus: 'None', existingId: null, record: addedRow.record }],
      },
    });
    expect(commit.statusCode).toBe(201);
    expect(
      commit.json<{ data: { added: number; updated: number; ignored: number } }>().data,
    ).toEqual({ added: 1, updated: 0, ignored: 0 });

    const unchanged = await getLuminaire(app, projectId, 'DL07');
    expect(unchanged.description).toBe('SPARSE BASELINE SEVEN');
    expect(unchanged.quantity).toBe(17);
    expect(unchanged.manufacturer).toBe('PRESERVE-MFR-07');
  });

  it('multiple-row import applies each patch independently', async () => {
    const { app, projectId } = await setup();
    const dl07Id = await addLuminaire(app, projectId, fullDl07);
    const dl10Id = await addLuminaire(app, projectId, {
      ...fullDl07,
      tag: 'DL10',
      description: 'TEN BASELINE',
      quantity: 10,
    });

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText:
          'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\nDL10,TEN UPDATED,30,No.\n',
      },
    });
    const rows = preview.json<{ data: { rows: Array<{ record: Record<string, unknown> }> } }>().data
      .rows;

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: dl07Id,
            record: rows[0]!.record,
          },
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: dl10Id,
            record: rows[1]!.record,
          },
        ],
      },
    });
    expect(commit.statusCode).toBe(201);
    expect(commit.json<{ data: { updated: number } }>().data.updated).toBe(2);

    const dl07 = await getLuminaire(app, projectId, 'DL07');
    const dl10 = await getLuminaire(app, projectId, 'DL10');
    expect(dl07.description).toBe('SPARSE UPDATED SEVEN');
    expect(dl07.quantity).toBe(27);
    expect(dl10.description).toBe('TEN UPDATED');
    expect(dl10.quantity).toBe(30);
    // Both preserve their own technical enrichment.
    expect(dl07.manufacturer).toBe('PRESERVE-MFR-07');
    expect(dl10.manufacturer).toBe('PRESERVE-MFR-07');
  });

  it('safety backup-before-mutation remains intact', async () => {
    const { app, projectId } = await setup();
    const luminaireId = await addLuminaire(app, projectId, fullDl07);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED SEVEN,27,No.\n',
      },
    });
    const row = preview.json<{ data: { rows: Array<{ record: Record<string, unknown> }> } }>().data
      .rows[0]!;

    const commit = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Unique',
            existingId: luminaireId,
            record: row.record,
          },
        ],
      },
    });
    expect(commit.statusCode).toBe(201);

    // A PRE_IMPORT backup must have been created before the mutation.
    const backups = await app.inject({ method: 'GET', url: '/api/personal/backups' });
    expect(backups.statusCode).toBe(200);
    const records = backups.json<{ data: Array<{ reason: string }> }>().data;
    expect(records.some((item) => item.reason === 'PRE IMPORT')).toBe(true);
  });
});
