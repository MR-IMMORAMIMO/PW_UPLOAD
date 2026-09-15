import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    STANDALONE_SESSION_SECRET: 'p2-fnd-01-secret-that-is-longer-than-thirty-two-characters',
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

function recordInput(record: LuminaireRecord): LuminaireRecordInput {
  const {
    id: _id,
    projectId: _projectId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = record;
  void _id;
  void _projectId;
  void _createdAt;
  void _updatedAt;
  return input;
}

function makeStore(): { store: PersonalWorkspaceStore; databasePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'p2-fnd-01-store-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'reality.sqlite');
  const config = makeConfig(databasePath, path.join(directory, 'projects'));
  const store = new PersonalWorkspaceStore(config);
  closeables.push(store);
  return { store, databasePath };
}

function makeProject(store: PersonalWorkspaceStore): string {
  const projectId = randomUUID();
  store.initializeProject(
    projectId,
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Manual',
    '2026-08-20',
  );
  return projectId;
}

function findLuminaire(
  store: PersonalWorkspaceStore,
  projectId: string,
  id: string,
): LuminaireRecord {
  const found = store.getWorkspace(projectId).luminaires.find((record) => record.id === id);
  if (!found) throw new Error(`Luminaire ${id} not found.`);
  return found;
}

describe('P2-FND-01 relation-safe Luminaire updates', () => {
  it('preserves UUID, createdAt, and project ownership while updating mutable fields', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const created = store.addLuminaire(projectId, baseLuminaire);

    const updated = store.updateLuminaire(projectId, created.id, {
      ...recordInput(created),
      wattage: '12W',
      lightColor: '4000K',
      manufacturer: 'Zumtobel',
      model: 'MODEL-02',
      notes: 'Enriched note',
    });

    // Entity continuity invariants.
    expect(updated.id).toBe(created.id);
    expect(updated.projectId).toBe(projectId);
    expect(updated.createdAt).toBe(created.createdAt);
    // Mutable technical fields updated.
    expect(updated.wattage).toBe('12W');
    expect(updated.lightColor).toBe('4000K');
    expect(updated.manufacturer).toBe('Zumtobel');
    expect(updated.model).toBe('MODEL-02');
    expect(updated.notes).toBe('Enriched note');
    // updatedAt changes appropriately.
    expect(updated.updatedAt).not.toBe(created.updatedAt);

    // Exactly one row exists; no second row was created.
    const rows = store
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(rows.count).toBe(1);
  });

  it('fails closed on a missing UUID and does not silently insert or upsert', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const missingId = randomUUID();
    expect(() =>
      store.updateLuminaire(projectId, missingId, { ...baseLuminaire, tag: 'DL99' }),
    ).toThrow('Luminaire not found.');
    const rows = store
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(rows.count).toBe(0);
  });

  it('cannot mutate a Luminaire belonging to another project', () => {
    const { store } = makeStore();
    const projectA = makeProject(store);
    const projectB = makeProject(store);
    const created = store.addLuminaire(projectA, baseLuminaire);

    // Updating through project B with project A's UUID must fail closed.
    expect(() =>
      store.updateLuminaire(projectB, created.id, { ...recordInput(created), wattage: '99W' }),
    ).toThrow('Luminaire not found.');

    // The original row is untouched.
    const after = findLuminaire(store, projectA, created.id);
    expect(after.wattage).toBe(baseLuminaire.wattage);
    expect(after.projectId).toBe(projectA);
  });

  it('explicit Tag edit still canonicalizes uppercase', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const created = store.addLuminaire(projectId, baseLuminaire);
    const updated = store.updateLuminaire(projectId, created.id, {
      ...recordInput(created),
      tag: ' dl02 ',
    });
    expect(updated.tag).toBe('DL02');
    expect(updated.id).toBe(created.id);
  });

  it('explicit canonical collision remains blocked', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const dl01 = store.addLuminaire(projectId, baseLuminaire);
    const dl02 = store.addLuminaire(projectId, { ...baseLuminaire, tag: 'DL02' });
    expect(() =>
      store.updateLuminaire(projectId, dl02.id, {
        ...recordInput(dl02),
        tag: ' dl01 ',
      }),
    ).toThrow('Type / Tag "DL01" already exists in this project.');
    expect(findLuminaire(store, projectId, dl01.id).tag).toBe('DL01');
    expect(findLuminaire(store, projectId, dl02.id).tag).toBe('DL02');
  });

  it('historical duplicate non-Tag edit still succeeds and preserves exact Tag casing', () => {
    const { store, databasePath } = makeStore();
    const projectId = makeProject(store);
    const original = store.addLuminaire(projectId, baseLuminaire);
    const storeIndex = closeables.indexOf(store);
    if (storeIndex !== -1) closeables.splice(storeIndex, 1);
    store.close();

    // Inject a historical mixed-case duplicate directly, bypassing the store.
    const database = new DatabaseSync(databasePath);
    const historicalId = randomUUID();
    database
      .prepare(
        `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
          body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
      )
      .run(historicalId, 'Dl01', original.id);
    database.close();

    const reopened = new PersonalWorkspaceStore(
      loadConfig({
        APP_MODE: 'standalone',
        WORKSPACE_VARIANT: 'personal',
        PERSONAL_AUTO_LOGIN: 'true',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        STANDALONE_DB_PATH: databasePath,
        STANDALONE_SESSION_SECRET: 'p2-fnd-01-secret-that-is-longer-than-thirty-two-characters',
        STANDALONE_ADMIN_NAME: 'Reality Admin',
        STANDALONE_ADMIN_EMAIL: 'reality@local.test',
        STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
        PERSONAL_PROJECT_ROOT: path.join(path.dirname(databasePath), 'projects'),
      }),
    );
    closeables.push(reopened);

    const historical = findLuminaire(reopened, projectId, historicalId);
    // Unrelated edit (Wattage only) must preserve exact historical casing.
    const safeEdit = reopened.updateLuminaire(projectId, historicalId, {
      ...recordInput(historical),
      wattage: '12W',
    });
    expect(safeEdit.tag).toBe('Dl01');
    expect(safeEdit.wattage).toBe('12W');
    expect(safeEdit.id).toBe(historicalId);
    // The canonical sibling is untouched.
    expect(findLuminaire(reopened, projectId, original.id).tag).toBe('DL01');
    // No collision was triggered and no row was deleted.
    const rows = reopened
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(rows.count).toBe(2);
  });

  it('attachment and datasheet path fields remain intact through unrelated updates', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const created = store.addLuminaire(projectId, baseLuminaire);
    const updated = store.updateLuminaire(projectId, created.id, {
      ...recordInput(created),
      wattage: '15W',
    });
    expect(updated.imagePath).toBe(baseLuminaire.imagePath);
    expect(updated.datasheetPath).toBe(baseLuminaire.datasheetPath);
  });

  it('add still uses INSERT semantics and never reuses an existing UUID', () => {
    const { store } = makeStore();
    const projectId = makeProject(store);
    const first = store.addLuminaire(projectId, baseLuminaire);
    const second = store.addLuminaire(projectId, { ...baseLuminaire, tag: 'DL02' });
    expect(second.id).not.toBe(first.id);
    expect(second.createdAt).not.toBe(first.createdAt);
    const rows = store
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(rows.count).toBe(2);
  });

  it('sparse import update preserves absent technical fields and attachment paths', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p2-fnd-01-api-'));
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
        projectName: 'P2 FND 01 Sparse',
        clientName: 'UAT Client',
        projectType: 'Lighting Design',
        description: 'Sparse import safety.',
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'Sparse regression.',
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

    const add = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: baseLuminaire,
    });
    expect(add.statusCode).toBe(201);
    const luminaireId = add.json<{ data: { id: string } }>().data.id;

    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION,QUANTITY,UNIT\nDL01,SPARSE UPDATED,27,No.\n',
      },
    });
    expect(preview.statusCode).toBe(200);
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

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const updated = workspace
      .json<{ data: { luminaires: LuminaireRecord[] } }>()
      .data.luminaires.find((record) => record.id === luminaireId)!;
    expect(updated.description).toBe('SPARSE UPDATED');
    expect(updated.quantity).toBe(27);
    // Absent technical fields preserved.
    expect(updated.manufacturer).toBe(baseLuminaire.manufacturer);
    expect(updated.wattage).toBe(baseLuminaire.wattage);
    // Attachment / datasheet paths preserved.
    expect(updated.imagePath).toBe(baseLuminaire.imagePath);
    expect(updated.datasheetPath).toBe(baseLuminaire.datasheetPath);
    // Entity continuity preserved through the import update path.
    expect(updated.id).toBe(luminaireId);
    expect(updated.projectId).toBe(projectId);
  });

  it('native DIALux missing sentinel remains a no-op and preserves the row', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p2-fnd-01-dialux-'));
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
        projectName: 'P2 FND 01 Dialux',
        clientName: 'UAT Client',
        projectType: 'Lighting Design',
        description: 'Native DIALux no-op.',
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'DIALux regression.',
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

    const add = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires`,
      payload: baseLuminaire,
    });
    expect(add.statusCode).toBe(201);
    const luminaireId = add.json<{ data: { id: string } }>().data.id;

    // DIALux import with only a quantity column; all other technical columns absent.
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaires/import-preview`,
      payload: {
        source: 'DialuxCsv',
        csvText: 'TAG\tQUANTITY\nDL01\t27\n',
      },
    });
    expect(preview.statusCode).toBe(200);
    const row = preview.json<{ data: { rows: Array<{ record: Record<string, unknown> }> } }>().data
      .rows[0]!;

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

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    const updated = workspace
      .json<{ data: { luminaires: LuminaireRecord[] } }>()
      .data.luminaires.find((record) => record.id === luminaireId)!;
    expect(updated.quantity).toBe(27);
    // Absent DIALux technical fields preserved (no-op semantics).
    expect(updated.manufacturer).toBe(baseLuminaire.manufacturer);
    expect(updated.wattage).toBe(baseLuminaire.wattage);
    expect(updated.description).toBe(baseLuminaire.description);
    expect(updated.id).toBe(luminaireId);
  });
});
