import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    STANDALONE_SESSION_SECRET: 'p2-fnd-a2-02-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
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

async function setup(projectName = 'P2 FND A2 02 Import Transaction'): Promise<TestContext> {
  const directory = mkdtempSync(path.join(tmpdir(), 'p2-fnd-a2-02-'));
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
      description: 'Import transaction reality gate.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Transactional import regression.',
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

async function getInputMode(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/projects/${projectId}/workspace`,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ data: { lightingPackage: { inputMode: string } } }>().data.lightingPackage
    .inputMode;
}

function commitPayload(
  rows: Array<{
    action: 'Add' | 'Update' | 'Ignore' | 'ManualReview';
    matchStatus: 'None' | 'Unique' | 'Ambiguous';
    existingId: string | null;
    record: Record<string, unknown>;
  }>,
  source: 'AutoCadCsv' | 'DialuxCsv' = 'AutoCadCsv',
): { source: 'AutoCadCsv' | 'DialuxCsv'; rows: typeof rows } {
  return { source, rows };
}

async function commit(
  app: Awaited<ReturnType<typeof createApp>>,
  projectId: string,
  rows: Parameters<typeof commitPayload>[0],
  source: 'AutoCadCsv' | 'DialuxCsv' = 'AutoCadCsv',
): Promise<{ statusCode: number; body: { error?: { code: string; message: string } } }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/luminaires/import-commit`,
    payload: commitPayload(rows, source),
  });
  return { statusCode: response.statusCode, body: response.json() };
}

/** Injects a historical mixed-case duplicate Luminaire row directly, bypassing the store. */
function injectHistoricalDuplicate(
  store: PersonalWorkspaceStore,
  templateId: string,
  duplicateTag: string,
): string {
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
    .run(historicalId, duplicateTag, templateId);
  return historicalId;
}

describe('P2-FND-A2-02 import contract matrix and transactional commit', () => {
  it('1. valid None / zero-candidate Add succeeds', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      {
        action: 'Add',
        matchStatus: 'None',
        existingId: null,
        record: { tag: 'wl01', description: 'New wall light' },
      },
    ]);
    expect(result.statusCode).toBe(201);
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.tag).toBe('WL01');
  });

  it('2. Add + existingId is rejected', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    void dl01;
    void store;
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: dl01.id, record: { tag: 'DL01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(app, projectId)).toHaveLength(1);
  });

  it('3. Add + Ambiguous status is rejected', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'Ambiguous', existingId: null, record: { tag: 'wl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(app, projectId)).toHaveLength(0);
  });

  it('4. Add + Unique status is rejected', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'Unique', existingId: null, record: { tag: 'wl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(app, projectId)).toHaveLength(0);
  });

  it('5. Add whose current candidate set became non-empty after preview is rejected', async () => {
    const { app, projectId } = await setup();
    // A matching Luminaire appears after the preview would have run.
    await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Add',
        matchStatus: 'None',
        existingId: null,
        record: { tag: 'dl01', description: 'Stale add' },
      },
    ]);
    expect(result.statusCode).toBe(409);
    expect(result.body.error?.message).toContain('already exists in this project');
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.description).toBe(baseLuminaire.description);
  });

  it('6. Add with a forged same-project existing UUID is rejected', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    void store;
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: dl01.id, record: { tag: 'wl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(app, projectId)).toHaveLength(1);
  });

  it('7. Add with cross-project UUID is rejected', async () => {
    const { app: appA, projectId: projectA } = await setup('Project A');
    const { app: appB, projectId: projectB } = await setup('Project B');
    const dlB = await addLuminaire(appB, projectB, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(appA, projectA, [
      { action: 'Add', matchStatus: 'None', existingId: dlB.id, record: { tag: 'wl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(appA, projectA)).toHaveLength(0);
  });

  it('8. two Add rows with same normalized Tag are rejected', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: null, record: { tag: 'DL01' } },
      { action: 'Add', matchStatus: 'None', existingId: null, record: { tag: 'DL01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('Multiple import rows would add');
    expect(await getLuminaires(app, projectId)).toHaveLength(0);
  });

  it('9. Add DL01 + Add dl01 is rejected (mixed-case duplicate normalized Tag)', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: null, record: { tag: 'DL01' } },
      { action: 'Add', matchStatus: 'None', existingId: null, record: { tag: 'dl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('Multiple import rows would add');
    expect(await getLuminaires(app, projectId)).toHaveLength(0);
  });

  it('10. valid Unique Update succeeds', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Updated' },
      },
    ]);
    expect(result.statusCode).toBe(201);
    const updated = (await getLuminaires(app, projectId)).find((r) => r.id === dl01.id)!;
    expect(updated.description).toBe('Updated');
  });

  it('11. Unique Update with wrong UUID is rejected', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const wrong = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: wrong.id,
        record: { tag: 'dl01', description: 'Wrong' },
      },
    ]);
    expect(result.statusCode).toBe(400);
    void dl01;
    expect((await getLuminaires(app, projectId)).find((r) => r.id === wrong.id)!.description).toBe(
      baseLuminaire.description,
    );
  });

  it('12. Unique preview that becomes Ambiguous is rejected', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    // A historical duplicate appears after the preview would have run.
    injectHistoricalDuplicate(store, dl01.id, 'Dl01');
    const result = await commit(app, projectId, [
      { action: 'Update', matchStatus: 'Unique', existingId: dl01.id, record: { tag: 'dl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('matches multiple existing luminaires');
  });

  it('13. valid manual Ambiguous Update succeeds and preserves exact historical Tag casing', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const historicalId = injectHistoricalDuplicate(store, dl01.id, 'Dl01');
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Ambiguous',
        existingId: historicalId,
        record: { tag: 'dl01', description: 'Ambiguous update' },
      },
    ]);
    expect(result.statusCode).toBe(201);
    const luminaires = await getLuminaires(app, projectId);
    const historical = luminaires.find((r) => r.id === historicalId)!;
    const canonical = luminaires.find((r) => r.id === dl01.id)!;
    expect(historical.tag).toBe('Dl01');
    expect(historical.description).toBe('Ambiguous update');
    expect(canonical.tag).toBe('DL01');
    expect(canonical.description).toBe(baseLuminaire.description);
    expect(luminaires).toHaveLength(2);
  });

  it('14. Ambiguous Update without selected existingId is rejected', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    injectHistoricalDuplicate(store, dl01.id, 'Dl01');
    const result = await commit(app, projectId, [
      { action: 'Update', matchStatus: 'Ambiguous', existingId: null, record: { tag: 'dl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(await getLuminaires(app, projectId)).toHaveLength(2);
  });

  it('15. selected UUID not in current ambiguous candidate set is rejected', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    injectHistoricalDuplicate(store, dl01.id, 'Dl01');
    const other = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });
    const result = await commit(app, projectId, [
      { action: 'Update', matchStatus: 'Ambiguous', existingId: other.id, record: { tag: 'dl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('does not match the selected luminaire');
    void dl01;
  });

  it('16. repeated Update target is rejected BEFORE any write', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'First' },
      },
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Second' },
      },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('Multiple import rows target the same luminaire');
    expect((await getLuminaires(app, projectId)).find((r) => r.id === dl01.id)!.description).toBe(
      baseLuminaire.description,
    );
  });

  it('17. contradictory Add + Update for same normalized Tag fails closed', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    // An Add row and an Update row both target the same normalized Tag DL01.
    const result = await commit(app, projectId, [
      { action: 'Add', matchStatus: 'None', existingId: null, record: { tag: 'DL01' } },
      { action: 'Update', matchStatus: 'Unique', existingId: dl01.id, record: { tag: 'DL01' } },
    ]);
    // The Add is rejected first (a candidate exists for DL01), so the whole
    // commit fails closed and the Update never applies.
    expect(result.statusCode).toBe(409);
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.description).toBe(baseLuminaire.description);
  });

  it('18. Skip (Ignore) rows are non-mutating and do not create targets or affect the mutation count', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(app, projectId, [
      // A real mutation is required; the Ignore row must not write, must not
      // become an update target, and must not inflate the ignored count.
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Changed' },
      },
      {
        action: 'Ignore',
        matchStatus: 'None',
        existingId: null,
        record: { tag: 'wl01', description: 'Skipped' },
      },
    ]);
    expect(result.statusCode).toBe(201);
    expect(result.body.error).toBeUndefined();
    const luminaires = await getLuminaires(app, projectId);
    // Only the pre-existing DL01 exists; the Ignore row created nothing.
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.id).toBe(dl01.id);
    expect(luminaires[0]!.description).toBe('Changed');
  });

  it('18b. an import with only Skip rows is rejected (product requires at least one mutating row)', async () => {
    const { app, projectId } = await setup();
    const result = await commit(app, projectId, [
      { action: 'Ignore', matchStatus: 'None', existingId: null, record: { tag: 'wl01' } },
    ]);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toContain('Choose at least one row to add or update');
    expect(await getLuminaires(app, projectId)).toHaveLength(0);
  });

  // ---- TRANSACTION ATOMICITY ----------------------------------------------

  it('19. valid Update first + stale invalid Add second -> first Update rolled back', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Valid first row' },
      },
      // Row 2: stale Add whose normalized Tag already exists in the DB.
      {
        action: 'Add',
        matchStatus: 'None',
        existingId: null,
        record: { tag: 'DL01', description: 'Stale add' },
      },
    ]);
    expect(result.statusCode).toBe(409);
    // Both the first Update and the second Add were rolled back.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.id).toBe(dl01.id);
    expect(luminaires[0]!.description).toBe(baseLuminaire.description);
  });

  it('20. valid Add first + invalid Update second -> Add rolled back', async () => {
    const { app, projectId } = await setup();
    const wl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });
    const result = await commit(app, projectId, [
      {
        action: 'Add',
        matchStatus: 'None',
        existingId: null,
        record: { tag: 'DL01', description: 'New add' },
      },
      // Row 2: forged Update (WL01 UUID targeted for a DL01 normalized Tag).
      { action: 'Update', matchStatus: 'Unique', existingId: wl01.id, record: { tag: 'DL01' } },
    ]);
    expect(result.statusCode).toBe(400);
    const luminaires = await getLuminaires(app, projectId);
    // The DL01 Add was rolled back; only the pre-existing WL01 remains unchanged.
    expect(luminaires).toHaveLength(1);
    expect(luminaires[0]!.id).toBe(wl01.id);
    expect(luminaires[0]!.description).toBe(baseLuminaire.description);
  });

  it('21. two valid row writes then forced input-mode update failure -> both row writes rolled back', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const wl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });

    // Force the input-mode write to fail inside the transaction.
    const spy = vi.spyOn(store, 'updateLightingPackage').mockImplementationOnce(() => {
      throw new Error('forced input-mode failure');
    });

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Changed DL01' },
      },
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: wl01.id,
        record: { tag: 'wl01', description: 'Changed WL01' },
      },
    ]);
    expect(result.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    // Both row writes rolled back.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires).toHaveLength(2);
    expect(luminaires.find((r) => r.id === dl01.id)!.description).toBe(baseLuminaire.description);
    expect(luminaires.find((r) => r.id === wl01.id)!.description).toBe(baseLuminaire.description);
  });

  it('22. input-mode would update but later row failure -> input mode unchanged', async () => {
    const { app, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    expect(await getInputMode(app, projectId)).toBe('Later');

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'Valid' },
      },
      // Row 2: forged Update (DL01 tag targeting WL01 nonexistent-in-this-context).
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: randomUUID(),
        record: { tag: 'dl01' },
      },
    ]);
    expect(result.statusCode).toBe(400);
    // Input mode unchanged because the whole transaction rolled back.
    expect(await getInputMode(app, projectId)).toBe('Later');
    expect((await getLuminaires(app, projectId)).find((r) => r.id === dl01.id)!.description).toBe(
      baseLuminaire.description,
    );
  });

  it('23. DB failure on second mutation -> first mutation rolled back', async () => {
    const { app, store, projectId } = await setup();
    const dl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'DL01' });
    const wl01 = await addLuminaire(app, projectId, { ...baseLuminaire, tag: 'WL01' });

    // Force the SECOND row's Update (a distinct target) to throw inside the
    // transaction, simulating a DB failure after the first write succeeded.
    const spy = vi.spyOn(store, 'updateLuminaire').mockImplementationOnce(() => {
      throw new Error('forced second-write DB failure');
    });

    const result = await commit(app, projectId, [
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: dl01.id,
        record: { tag: 'dl01', description: 'DL01 changed' },
      },
      {
        action: 'Update',
        matchStatus: 'Unique',
        existingId: wl01.id,
        record: { tag: 'wl01', description: 'WL01 changed' },
      },
    ]);
    expect(result.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    // First write rolled back; neither target changed.
    const luminaires = await getLuminaires(app, projectId);
    expect(luminaires.find((r) => r.id === dl01.id)!.description).toBe(baseLuminaire.description);
    expect(luminaires.find((r) => r.id === wl01.id)!.description).toBe(baseLuminaire.description);
    // Input mode unchanged.
    expect(await getInputMode(app, projectId)).toBe('Later');
  });
});
