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
  imagePath: '',
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
  datasheetPath: '',
  location: 'Ground Floor',
  unit: 'No.',
  quantity: 1,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
};

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-fix-05c-secret-that-is-longer-than-thirty-two-characters',
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

async function setupApi() {
  const directory = mkdtempSync(path.join(tmpdir(), 'uat-fix-05c-api-'));
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
  return { app, store };
}

async function createProject(
  app: Awaited<ReturnType<typeof createApp>>,
  projectName: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      projectName,
      clientName: 'UAT Client',
      projectType: 'Lighting Design',
      description: 'Luminaire Tag identity reality gate.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Tag identity regression.',
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
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { project: { id: string } } }>().data.project.id;
}

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

describe('UAT-FIX-05-C project-scoped luminaire Tag identity reality gate', () => {
  it('enforces manual API writes per project and matches every import entry path', async () => {
    const { app, store } = await setupApi();
    const projectA = await createProject(app, 'Tag Identity Project A');
    const projectB = await createProject(app, 'Tag Identity Project B');

    const create = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectA}/luminaires`,
      payload: { ...baseLuminaire, tag: 'dl01' },
    });
    expect(create.statusCode).toBe(201);
    const dl01 = create.json<{ data: LuminaireRecord }>().data;
    expect(dl01.tag).toBe('DL01');

    for (const tag of ['DL01', 'dl01', 'Dl01', ' DL01 ']) {
      const duplicate = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectA}/luminaires`,
        payload: { ...baseLuminaire, tag },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json<{ error: { code: string; message: string } }>().error).toMatchObject({
        code: 'CONFLICT',
        message: 'Type / Tag "DL01" already exists in this project.',
      });
    }

    const otherProject = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectB}/luminaires`,
      payload: { ...baseLuminaire, tag: ' dl01 ' },
    });
    expect(otherProject.statusCode).toBe(201);
    expect(otherProject.json<{ data: LuminaireRecord }>().data.tag).toBe('DL01');
    const trimmedDisplayTag = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectB}/luminaires`,
      payload: { ...baseLuminaire, tag: ' MiX01 ' },
    });
    expect(trimmedDisplayTag.statusCode).toBe(201);
    expect(trimmedDisplayTag.json<{ data: LuminaireRecord }>().data.tag).toBe('MIX01');

    const unchangedSelfEdit = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectA}/luminaires/${dl01.id}`,
      payload: recordInput(dl01),
    });
    expect(unchangedSelfEdit.statusCode).toBe(200);

    const casingOnlySelfEdit = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectA}/luminaires/${dl01.id}`,
      payload: { ...recordInput(dl01), tag: 'dl01' },
    });
    expect(casingOnlySelfEdit.statusCode).toBe(200);
    expect(casingOnlySelfEdit.json<{ data: LuminaireRecord }>().data.tag).toBe('DL01');

    const restoreDisplayCase = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectA}/luminaires/${dl01.id}`,
      payload: recordInput(dl01),
    });
    expect(restoreDisplayCase.statusCode).toBe(200);

    const createDl02 = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectA}/luminaires`,
      payload: { ...baseLuminaire, tag: 'DL02' },
    });
    expect(createDl02.statusCode).toBe(201);
    const dl02 = createDl02.json<{ data: LuminaireRecord }>().data;
    const editCollision = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectA}/luminaires/${dl02.id}`,
      payload: { ...recordInput(dl02), tag: ' Dl01 ' },
    });
    expect(editCollision.statusCode).toBe(409);
    expect(editCollision.json<{ error: { message: string } }>().error.message).toBe(
      'Type / Tag "DL01" already exists in this project.',
    );

    const importCases = [
      {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION\ndl01,AutoCAD update\n',
      },
      {
        source: 'AutoCadCsv',
        csvText: 'TAG\tDESCRIPTION\ndl01\tPasted update\n',
      },
      {
        source: 'DialuxCsv',
        csvText: 'NumberText;ManufNameText;TAGText\n' + 'pcs.;Manufacturer;TAG\n' + '1;ERCO;dl01\n',
      },
    ] as const;
    for (const importCase of importCases) {
      const preview = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectA}/luminaires/import-preview`,
        payload: importCase,
      });
      expect(preview.statusCode).toBe(200);
      const row = preview.json<{
        data: { rows: Array<{ status: string; existingId: string | null }> };
      }>().data.rows[0]!;
      expect(row.status).not.toBe('Added');
      expect(row.existingId).toBe(dl01.id);
    }

    const newImportCases = [
      {
        source: 'AutoCadCsv',
        csvText: 'TAG,DESCRIPTION\nwl01,AutoCAD add\n',
        expectedTag: 'WL01',
      },
      {
        source: 'AutoCadCsv',
        csvText: 'TAG\tDESCRIPTION\neM01\tPasted add\n',
        expectedTag: 'EM01',
      },
      {
        source: 'DialuxCsv',
        csvText: 'NumberText;ManufNameText;TAGText\n' + 'pcs.;Manufacturer;TAG\n' + '1;ERCO;sP01\n',
        expectedTag: 'SP01',
      },
    ] as const;
    for (const importCase of newImportCases) {
      const preview = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectA}/luminaires/import-preview`,
        payload: { source: importCase.source, csvText: importCase.csvText },
      });
      expect(preview.statusCode).toBe(200);
      const row = preview.json<{
        data: {
          rows: Array<{
            status: string;
            existingId: string | null;
            record: Record<string, unknown>;
          }>;
        };
      }>().data.rows[0]!;
      expect(row).toMatchObject({ status: 'Added', existingId: null });

      const commit = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectA}/luminaires/import-commit`,
        payload: {
          source: importCase.source,
          rows: [{ action: 'Add', matchStatus: 'None', existingId: null, record: row.record }],
        },
      });
      expect(commit.statusCode).toBe(201);
      expect(
        store
          .getWorkspace(projectA)
          .luminaires.some((record) => record.tag === importCase.expectedTag),
      ).toBe(true);
    }

    const bypassAdd = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectA}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Add',
            matchStatus: 'None',
            existingId: null,
            record: { tag: 'dL01', description: 'Direct commit bypass attempt' },
          },
        ],
      },
    });
    expect(bypassAdd.statusCode).toBe(409);
    expect(
      bypassAdd.json<{
        error: { code: string; message: string; details: Record<string, unknown> };
      }>().error,
    ).toMatchObject({
      code: 'CONFLICT',
      message: 'Type / Tag "DL01" already exists in this project.',
      details: { field: 'tag', normalizedTag: 'dl01', projectId: projectA },
    });

    const historicalImportTargetId = randomUUID();
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
      .run(historicalImportTargetId, 'Dl01', dl01.id);
    const historicalImportUpdate = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectA}/luminaires/import-commit`,
      payload: {
        source: 'AutoCadCsv',
        rows: [
          {
            action: 'Update',
            matchStatus: 'Ambiguous',
            existingId: historicalImportTargetId,
            record: { tag: 'dl01', wattage: '12W' },
          },
        ],
      },
    });
    expect(historicalImportUpdate.statusCode).toBe(201);
    const afterHistoricalImport = store.getWorkspace(projectA).luminaires;
    expect(
      afterHistoricalImport.find((record) => record.id === historicalImportTargetId),
    ).toMatchObject({
      tag: 'Dl01',
      wattage: '12W',
      description: baseLuminaire.description,
    });
    expect(afterHistoricalImport.find((record) => record.id === dl01.id)).toMatchObject({
      tag: 'DL01',
      wattage: baseLuminaire.wattage,
    });
  });

  it('serializes logically concurrent API writes through the synchronous shared store handle', async () => {
    const { app, store } = await setupApi();
    const projectId = await createProject(app, 'Concurrent Tag Identity Project');
    let activeStoreWrites = 0;
    let maximumActiveStoreWrites = 0;
    const callBoundaries: string[] = [];
    const originalAdd = store.addLuminaire.bind(store);
    store.addLuminaire = (targetProjectId, input) => {
      activeStoreWrites += 1;
      maximumActiveStoreWrites = Math.max(maximumActiveStoreWrites, activeStoreWrites);
      callBoundaries.push(`enter:${input.tag}`);
      try {
        return originalAdd(targetProjectId, input);
      } finally {
        callBoundaries.push(`exit:${input.tag}`);
        activeStoreWrites -= 1;
      }
    };

    // Promise.all makes both HTTP requests logically concurrent. The observed
    // store boundaries, rather than Promise syntax, prove whether the actual
    // DatabaseSync check/write call stacks can overlap.
    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/luminaires`,
        payload: { ...baseLuminaire, tag: 'DL77' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/luminaires`,
        payload: { ...baseLuminaire, tag: ' dl77 ' },
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(maximumActiveStoreWrites).toBe(1);
    expect(callBoundaries).toHaveLength(4);
    for (let index = 0; index < callBoundaries.length; index += 2) {
      expect(callBoundaries[index]).toMatch(/^enter:/);
      expect(callBoundaries[index + 1]).toMatch(/^exit:/);
    }
    const persisted = store
      .getWorkspace(projectId)
      .luminaires.filter((record) => record.tag === 'DL77');
    expect(persisted).toHaveLength(1);
  });

  it('loads historical case-variant duplicates without deleting or merging them', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'uat-fix-05c-history-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'historical.sqlite');
    const config = makeConfig(databasePath, path.join(directory, 'projects'));
    const projectId = '11111111-1111-4111-8111-111111111111';
    const store = new PersonalWorkspaceStore(config);
    store.initializeProject(
      projectId,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      '2026-08-20',
    );
    const original = store.addLuminaire(projectId, baseLuminaire);
    expect(() => store.addLuminaire(projectId, { ...baseLuminaire, tag: ' dl01 ' })).toThrow(
      'Type / Tag "DL01" already exists in this project.',
    );
    store.close();

    const database = new DatabaseSync(databasePath);
    const insertHistorical = database.prepare(
      `INSERT INTO project_luminaires
        SELECT ?, project_id, ?, category, image_path, description, manufacturer, model, wattage,
          lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout, driver, control,
          emergency, datasheet_path, location, unit, quantity, notes, source_name, dimensions,
        body_color_finish, created_at, updated_at, '', '', '', 1
        FROM project_luminaires WHERE id = ?`,
    );
    const historicalDuplicateId = randomUUID();
    const historicalMixedCaseId = randomUUID();
    insertHistorical.run(historicalDuplicateId, 'Dl01', original.id);
    insertHistorical.run(historicalMixedCaseId, 'mX03', original.id);
    database.close();

    const reopened = new PersonalWorkspaceStore(config);
    const before = reopened.getWorkspace(projectId).luminaires;
    expect(before.map((record) => record.tag).sort()).toEqual(['DL01', 'Dl01', 'mX03']);
    expect(() => reopened.addLuminaire(projectId, { ...baseLuminaire, tag: 'dL01' })).toThrow(
      'Type / Tag "DL01" already exists in this project.',
    );
    const historicalDuplicate = before.find((record) => record.id === historicalDuplicateId)!;
    const safeEdit = reopened.updateLuminaire(projectId, historicalDuplicate.id, {
      ...recordInput(historicalDuplicate),
      wattage: '12W',
    });
    expect(safeEdit).toMatchObject({ tag: 'Dl01', wattage: '12W' });
    expect(
      reopened.getWorkspace(projectId).luminaires.find((record) => record.id === original.id),
    ).toMatchObject({
      tag: 'DL01',
      wattage: baseLuminaire.wattage,
    });
    expect(() =>
      reopened.updateLuminaire(projectId, historicalDuplicate.id, {
        ...recordInput(historicalDuplicate),
        tag: 'dL01',
        description: 'Attempted casing-only historical tag edit',
      }),
    ).toThrow('Type / Tag "DL01" already exists in this project.');
    const historicalMixedCase = before.find((record) => record.id === historicalMixedCaseId)!;
    const canonicalized = reopened.updateLuminaire(projectId, historicalMixedCase.id, {
      ...recordInput(historicalMixedCase),
      tag: 'mx03',
    });
    expect(canonicalized.tag).toBe('MX03');
    expect(
      reopened
        .getWorkspace(projectId)
        .luminaires.map((record) => record.tag)
        .sort(),
    ).toEqual(['DL01', 'Dl01', 'MX03']);
    reopened.close();

    const verify = new DatabaseSync(databasePath);
    const count = verify
      .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
      .get(projectId) as { count: number };
    expect(count.count).toBe(3);
    verify.close();
  });
});
