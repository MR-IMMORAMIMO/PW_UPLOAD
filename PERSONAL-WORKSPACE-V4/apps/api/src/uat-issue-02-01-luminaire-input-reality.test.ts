/**
 * UAT-ISSUE-02-01 project-level Luminaire Input reality gate.
 *
 * The explicit project value lives in passthrough app_state JSON. The older
 * project_workspaces.input_mode remains the lighting-package workflow value,
 * so historical Project records can keep the new property genuinely absent.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;
type Api = Awaited<ReturnType<typeof createApp>>;

const FIXED_TIME = '2026-08-09T08:00:00.000Z';
const temporaryDirectories: string[] = [];
const liveRuntimes: Runtime[] = [];

interface AppStateDocument extends Record<string, unknown> {
  projects: Array<Record<string, unknown>>;
}

interface Runtime {
  app: Api;
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  stopped: boolean;
}

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'uat-issue-02-01-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'UAT Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'uat-reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'UAT-Reality-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

async function startRuntime(config: AppConfig): Promise<Runtime> {
  const provider = new StandaloneDataProvider(config);
  const store = new PersonalWorkspaceStore(config);
  const app = await createApp({
    config,
    provider,
    personalStore: store,
    clock: () => new Date(FIXED_TIME),
  });
  const runtime = { app, provider, store, stopped: false };
  liveRuntimes.push(runtime);
  return runtime;
}

async function stopRuntime(runtime: Runtime): Promise<void> {
  if (runtime.stopped) return;
  await runtime.app.close();
  runtime.store.close();
  runtime.provider.close();
  runtime.stopped = true;
}

function projectPayload(inputMode: string): Record<string, unknown> {
  return {
    projectName: 'Luminaire Input Reality Project',
    clientName: 'Reality Client',
    crmReference: 'CRM-UAT-02-01',
    commercialValueMinor: 12_500_000,
    commercialCurrency: 'AED',
    projectType: 'Villa Lighting Design',
    description: 'Project-level Luminaire Input persistence check.',
    siteLocation: 'Dubai Hills',
    designStage: 'Concept',
    lightingScope: 'Interior and landscape lighting design.',
    luxRequirements: '300 lux general target.',
    drawingReference: 'L-101',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: '2026-08-20',
    createFolders: false,
    folderProfile: 'Full Lighting Design',
    services: ['LightingLayout', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
    luminaireInputMode: inputMode,
    idempotencyKey: randomUUID(),
  };
}

function readAppState(database: DatabaseSyncInstance): AppStateDocument {
  const row = database
    .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
    .get() as { json_value: string } | undefined;
  if (!row) throw new Error('Missing primary app_state record.');
  const parsed = JSON.parse(row.json_value) as AppStateDocument;
  if (!Array.isArray(parsed.projects)) throw new Error('Invalid primary app_state record.');
  return parsed;
}

function readPrimaryJson(databasePath: string): string {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as { json_value: string } | undefined;
    if (!row) throw new Error('Missing primary app_state record.');
    return row.json_value;
  } finally {
    database.close();
  }
}

afterEach(async () => {
  for (const runtime of liveRuntimes.splice(0).reverse()) await stopRuntime(runtime);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('UAT-ISSUE-02-01 project-level Luminaire Input', () => {
  it('validates, persists, reopens, remains independent from Settings, and preserves history', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'scli-uat-issue-02-01-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'scli.sqlite');
    const projectRoot = path.join(directory, 'projects');
    mkdirSync(projectRoot, { recursive: true });
    const config = makeConfig(databasePath, projectRoot);

    const first = await startRuntime(config);
    const invalid = await first.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: projectPayload('Spreadsheet'),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    expect(await first.provider.listProjects()).toHaveLength(0);

    const create = await first.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: projectPayload('Manual'),
    });
    expect(create.statusCode).toBe(201);
    const created = create.json<{
      data: {
        project: {
          id: string;
          projectCode: string;
          luminaireInputMode: string;
          crmReference: string | null;
          commercialValueMinor: number | null;
          commercialCurrency: string | null;
        };
      };
    }>().data.project;
    expect(created).toMatchObject({
      luminaireInputMode: 'Manual',
      crmReference: 'CRM-UAT-02-01',
      commercialValueMinor: 12_500_000,
      commercialCurrency: 'AED',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.projectCode).toContain('_SCT');

    const settingsChange = await first.app.inject({
      method: 'PATCH',
      url: '/api/personal/settings',
      payload: { defaultInputMode: 'DialuxCsv' },
    });
    expect(settingsChange.statusCode).toBe(200);
    expect(
      settingsChange.json<{ data: { defaultInputMode: string } }>().data.defaultInputMode,
    ).toBe('DialuxCsv');

    const afterSettingsChange = await first.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    });
    expect(afterSettingsChange.statusCode).toBe(200);
    expect(
      afterSettingsChange.json<{ data: { luminaireInputMode: string } }>().data.luminaireInputMode,
    ).toBe('Manual');

    await stopRuntime(first);
    const second = await startRuntime(config);
    const reopened = await second.app.inject({ method: 'GET', url: `/api/projects/${created.id}` });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json<{ data: { luminaireInputMode: string } }>().data.luminaireInputMode).toBe(
      'Manual',
    );
    const reopenedWorkspace = await second.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}/workspace`,
    });
    expect(reopenedWorkspace.statusCode).toBe(200);
    expect(
      reopenedWorkspace.json<{ data: { lightingPackage: { inputMode: string } } }>().data
        .lightingPackage.inputMode,
    ).toBe('Manual');

    await stopRuntime(second);
    const database = new DatabaseSync(databasePath);
    const state = readAppState(database);
    const historical = state.projects.find((project) => project.id === created.id);
    if (!historical) throw new Error('Missing project selected for historical compatibility test.');
    delete historical.luminaireInputMode;
    database
      .prepare("UPDATE app_state SET json_value = ?, updated_at = ? WHERE state_key = 'primary'")
      .run(JSON.stringify(state), FIXED_TIME);
    database.close();
    const historicalJsonBeforeOpen = readPrimaryJson(databasePath);

    const third = await startRuntime(config);
    const historicalProject = await third.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    });
    expect(historicalProject.statusCode).toBe(200);
    expect(historicalProject.json<{ data: Record<string, unknown> }>().data).not.toHaveProperty(
      'luminaireInputMode',
    );
    const historicalWorkspace = await third.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}/workspace`,
    });
    expect(historicalWorkspace.statusCode).toBe(200);
    expect(
      historicalWorkspace.json<{ data: { lightingPackage: { inputMode: string } } }>().data
        .lightingPackage.inputMode,
    ).toBe('Manual');
    await stopRuntime(third);

    expect(readPrimaryJson(databasePath)).toBe(historicalJsonBeforeOpen);
  });
});
