import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import type { LuminaireRecordInput } from '@scli/contracts';
import type { LuminaireRecord } from '@scli/domain';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const closeables: Array<{ close(): Promise<void> | void }> = [];
const temporaryDirectories: string[] = [];

const baseLuminaire: LuminaireRecordInput = {
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '/images/dl01.png',
  description: 'Project downlight',
  manufacturer: 'ERCO',
  model: 'MODEL-01',
  wattage: '8W',
  lumens: '720 lm',
  lightColor: '3000K',
  cri: '90',
  beamAngle: '24 deg',
  ipRating: 'IP44',
  mounting: 'Recessed',
  cutout: '85 mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: '/datasheets/dl01.pdf',
  location: 'Ground Floor',
  unit: 'No.',
  quantity: 1,
  notes: 'Initial note',
  sourceName: 'MANUAL',
  dimensions: '100x100',
  bodyColorFinish: 'White',
};

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p2-fnd-02-secret-that-is-longer-than-thirty-two-characters',
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
  store: PersonalWorkspaceStore;
  projectId: string;
}

async function setup(projectName = 'P2 FND 02 Import Binding'): Promise<TestContext> {
  const directory = mkdtempSync(path.join(tmpdir(), 'p2-fnd-02-'));
  temporaryDirectories.push(directory);
  const root = path.join(directory, '001_MY_PROJECTS');
  mkdirSync(root, { recursive: true });
  const config = makeConfig(path.join(directory, 'reality.sqlite'), root);
  const store = new PersonalWorkspaceStore(config);
  const provider = new StandaloneDataProvider(config, undefined, store.getSharedDatabase());
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
      projectName,
      clientName: 'UAT Client',
      projectType: 'Lighting Design',
      description: 'Import target binding reality gate.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Target binding regression.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2026-08-20',
      createFolders: false,
      services: ['LuminaireSchedule'],
      luminaireInputMode: 'Later',
      idempotencyKey: randomUUID(),
    },
  });
  expect(createResponse.statusCode).toBe(201);
  const projectId = createResponse.json<{ data: { project: { id: string } } }>().data.project.id;
  return { app, store, projectId };
}

async function addLuminaire(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  record: Record<string, unknown>,
): Promise<LuminaireRecord> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires`,
    payload: record,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: LuminaireRecord }>().data;
}

async function getLuminaires(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
): Promise<LuminaireRecord[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workspace`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: { luminaires: LuminaireRecord[] } }>().data.luminaires;
}

interface PreviewRow {
  status: string;
  matchStatus: string;
  existingId: string | null;
  candidates: Array<{ id: string; tag: string }>;
  changedFields: string[];
  record: Record<string, unknown>;
}

async function preview(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  csvText: string,
  source: 'AutoCadCsv' | 'DialuxCsv' = 'AutoCadCsv',
): Promise<PreviewRow[]> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires/import-preview`,
    payload: { source, csvText },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: { rows: PreviewRow[] } }>().data.rows;
}

async function commit(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  rows: Array<{
    action: 'Add' | 'Update' | 'Ignore' | 'ManualReview';
    matchStatus: 'None' | 'Unique' | 'Ambiguous';
    existingId: string | null;
    record: Record<string, unknown>;
  }>,
  source: 'AutoCadCsv' | 'DialuxCsv' = 'AutoCadCsv',
): Promise<{ statusCode: number; body: { error?: { code: string; message: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires/import-commit`,
    payload: { source, rows },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('P2-FND-02 import target binding and ambiguity rejection', () => {
  it('zero candidates -> normal ADD behavior, new Tags persist uppercase', async () => {
    const { app, projectId } = await setup();
    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\nwl01,New wall light\n');
    expect(rows[0]).toMatchObject({ status: 'Added', matchStatus: 'None', existingId: null });
    expect(rows[0]!.candidates).toEqual([]);

    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: null, record: rows[0]!.record },
    ]);
    expect(result.statusCode).toBe(201);

    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.tag).toBe('WL01');
  });

  it('one candidate -> unique automatic UPDATE works', async () => {
    const { app, projectId } = await setup();
    const dl02 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL02' });

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl02,Updated description\n');
    expect(rows[0]).toMatchObject({
      status: 'Changed',
      matchStatus: 'Unique',
      existingId: dl02.id,
    });
    expect(rows[0]!.candidates).toHaveLength(1);
    expect(rows[0]!.candidates[0]!.id).toBe(dl02.id);

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl02.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(201);

    const updated = (await getLuminaires(app, projectId)).find((r) => r.id === dl02.id)!;
    expect(updated.description).toBe('Updated description');
    expect(updated.id).toBe(dl02.id);
  });

  it('two historical normalized duplicates -> preview is AMBIGUOUS / MANUAL REVIEW REQUIRED', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    // Inject a historical mixed-case duplicate directly, bypassing the store.
    const historicalId = randomUUID();
    store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
          body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
      )
      .run(historicalId, 'Dl01', dl01.id);

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Ambiguous update\n');
    expect(rows[0]!.status).toBe('Ambiguous');
    expect(rows[0]!.matchStatus).toBe('Ambiguous');
    // Ambiguous preview must NOT auto-select a target.
    expect(rows[0]!.existingId).toBeNull();
    // Both same-project normalized matches are candidates.
    const candidateIds = rows[0]!.candidates.map((c) => c.id).sort();
    expect(candidateIds).toEqual([dl01.id, historicalId].sort());
  });

  it('same normalized Tag in a DIFFERENT project is not a candidate', async () => {
    const { app, projectId } = await setup('Project A');
    const { app: appB, projectId: projectB } = await setup('Project B');
    const dlA = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const dlB = await addLuminaire(appB, projectB, { ...baseLuminaire, tag: 'DL01' });

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update A\n');
    expect(rows[0]!.matchStatus).toBe('Unique');
    expect(rows[0]!.existingId).toBe(dlA.id);
    expect(rows[0]!.candidates.map((c) => c.id)).toEqual([dlA.id]);
    expect(rows[0]!.candidates.map((c) => c.id)).not.toContain(dlB.id);
  });

  it('ambiguous row cannot commit unresolved', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const historicalId = randomUUID();
    store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
          body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
      )
      .run(historicalId, 'Dl01', dl01.id);

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Ambiguous update\n');
    // Attempt to commit the ambiguous row with no explicit selection.
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Ambiguous',
        existingId: null,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('no update target');
  });

  it('explicit manual selection of one real ambiguous candidate succeeds and preserves exact historical Tag casing', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const historicalId = randomUUID();
    store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
          body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
      )
      .run(historicalId, 'Dl01', dl01.id);

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Ambiguous update\n');
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Ambiguous',
        existingId: historicalId,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(201);

    const luminaires = await getLuminaires(app, projectId);
    const historical = luminaires.find((r) => r.id === historicalId)!;
    const canonical = luminaires.find((r) => r.id === dl01.id)!;
    // Selected historical candidate updated, exact historical casing preserved.
    expect(historical.tag).toBe('Dl01');
    expect(historical.description).toBe('Ambiguous update');
    // Unselected historical sibling unchanged.
    expect(canonical.tag).toBe('DL01');
    expect(canonical.description).toBe(baseLuminaire.description);
    // Both UUIDs preserved, no duplicate, row count unchanged.
    expect(luminaires).toHaveLength(2);
  });

  it('forged in-project UUID with wrong normalized Tag is rejected', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const wl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });

    // Incoming row is DL01 but the forged/stale commit targets WL01's UUID.
    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update\n');
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: wl01.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('does not match the selected luminaire');
    // No mutation occurred.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires.find((r) => r.id === dl01.id)!.description).toBe(baseLuminaire.description);
    expect(luminaires.find((r) => r.id === wl01.id)!.description).toBe(baseLuminaire.description);
  });

  it('cross-project UUID is rejected', async () => {
    const { app, projectId } = await setup('Project A');
    const { app: appB, projectId: projectB } = await setup('Project B');
    const dlA = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const dlB = await addLuminaire(appB, projectB, { ...baseLuminaire, tag: 'DL01' });

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update A\n');
    // Try to update Project A's DL01 using Project B's UUID.
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dlB.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('no valid update target');
    expect((await getLuminaires(app, projectId)).find((r) => r.id === dlA.id)!.description).toBe(
      baseLuminaire.description,
    );
  });

  it('missing/deleted UUID is rejected', async () => {
    const { app, projectId } = await setup();
    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update\n');
    const missingId = randomUUID();
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: missingId,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('no valid update target');
  });

  it('stale target whose Tag changed after preview is rejected', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update\n');
    // Between preview and commit, the target's Tag changes to WL01.
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/luminaires/${dl01.id}`,
      payload: { ...baseLuminaire, tag: 'WL01' },
    });

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('does not match the selected luminaire');
  });

  it('unique auto-target that becomes ambiguous before commit is rejected rather than guessed', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });

    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Update\n');
    expect(rows[0]!.matchStatus).toBe('Unique');

    // Between preview and commit, a historical duplicate appears.
    const historicalId = randomUUID();
    store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
          body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
      )
      .run(historicalId, 'Dl01', dl01.id);

    // The client still thinks it is Unique; the server must reject rather than guess.
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('matches multiple existing luminaires');
  });

  it('same existing UUID targeted by two import rows is rejected BEFORE any write', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'First row' },
      },
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Second row' },
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('Multiple import rows target the same luminaire');
    // No partial mutation occurred.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires.find((r) => r.id === dl01.id)!.description).toBe(baseLuminaire.description);
  });

  it('no partial mutation occurs when target-binding preflight fails', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const wl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });

    // Row 1 is valid (updates DL01), row 2 is forged (targets WL01 for DL01).
    // The preflight must reject the whole import before any write.
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Valid first row' },
      },
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: wl01.id,
        record: { tag: 'dl01', description: 'Forged second row' },
      },
    ]);
    expect(result.statusCode).toBe(400);
    // Neither row was applied.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires.find((r) => r.id === dl01.id)!.description).toBe(baseLuminaire.description);
    expect(luminaires.find((r) => r.id === wl01.id)!.description).toBe(baseLuminaire.description);
  });

  it('sparse AutoCAD update preserved through the new binding contract', async () => {
    const { app, projectId } = await setup();
    const dl07 = await addLuminaire(app, projectId, {
      ...baseLuminaire,
      tag: 'DL07',
      manufacturer: 'PRESERVE-MFR',
      wattage: '17W',
      imagePath: '/images/dl07.png',
      datasheetPath: '/datasheets/dl07.pdf',
    });

    const rows = await preview(
      app,
      projectId,
      'TAG,DESCRIPTION,QUANTITY,UNIT\nDL07,SPARSE UPDATED,27,No.\n',
    );
    expect(rows[0]!.changedFields).toEqual(expect.arrayContaining(['description', 'quantity']));
    expect(rows[0]!.changedFields).not.toContain('manufacturer');

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl07.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(201);

    const updated = (await getLuminaires(app, projectId)).find((r) => r.id === dl07.id)!;
    expect(updated.description).toBe('SPARSE UPDATED');
    expect(updated.quantity).toBe(27);
    // Absent technical fields preserved.
    expect(updated.manufacturer).toBe('PRESERVE-MFR');
    expect(updated.wattage).toBe('17W');
    // Attachment / datasheet paths preserved.
    expect(updated.imagePath).toBe('/images/dl07.png');
    expect(updated.datasheetPath).toBe('/datasheets/dl07.pdf');
  });

  it('native DIALux missing sentinel preserved through the new binding contract', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, {
      ...baseLuminaire,
      tag: 'DL01',
      manufacturer: 'PRESERVE-MFR',
      wattage: '8W',
    });

    const rows = await preview(
      app,
      projectId,
      'NumberText;ManufNameText;TAGText\npcs.;Manufacturer;TAG\n9;–;DL01\n',
      'DialuxCsv',
    );
    expect(rows[0]!.changedFields).toEqual(['quantity']);

    const result = await commit(
      app,
      projectId,
      [
        {
          action: 'Update',
          matchStatus: 'Unique',
          existingId: dl01.id,
          record: rows[0]!.record,
        },
      ],
      'DialuxCsv',
    );
    expect(result.statusCode).toBe(201);

    const updated = (await getLuminaires(app, projectId)).find((r) => r.id === dl01.id)!;
    expect(updated.quantity).toBe(9);
    expect(updated.manufacturer).toBe('PRESERVE-MFR');
    expect(updated.wattage).toBe('8W');
  });

  it('P2-FND-01 stable UUID/update semantics preserved', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const rows = await preview(app, projectId, 'TAG,DESCRIPTION\ndl01,Updated\n');
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: rows[0]!.record,
      },
    ]);
    expect(result.statusCode).toBe(201);
    const updated = (await getLuminaires(app, projectId)).find((r) => r.id === dl01.id)!;
    expect(updated.id).toBe(dl01.id);
    expect(updated.projectId).toBe(projectId);
    expect(updated.createdAt).toBe(dl01.createdAt);
    // Exactly one row.
    expect(await getLuminaires(app, projectId)).toHaveLength(1);
  });

  it('ordinary non-ambiguous project preview/count behavior remains correct', async () => {
    const { app, projectId } = await setup();
    await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL02' });

    const rows = await preview(
      app,
      projectId,
      'TAG,DESCRIPTION\nDL01,Changed one\nDL02,Changed two\nWL01,New one\n',
    );
    const statuses = rows.map((r) => r.status);
    expect(statuses).toEqual(['Changed', 'Changed', 'Added']);
    expect(rows.map((r) => r.matchStatus)).toEqual(['Unique', 'Unique', 'None']);
    expect(rows.map((r) => r.existingId)).toEqual([expect.any(String), expect.any(String), null]);
  });
});
