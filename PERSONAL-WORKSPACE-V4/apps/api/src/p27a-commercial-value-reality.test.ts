/**
 * P2.7A optional project commercial value production-path reality gate.
 *
 * Proves the shared contracts, ProjectService, generic project routes, and
 * passthrough app_state JSON persistence work together without a new table,
 * migration, BOQ pricing model, or currency-conversion behavior.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import { createApp } from './app';
import {
  createPersonalProductionStartup,
  type PersonalProductionStartup,
} from './infrastructure/startup/createPersonalProductionStartup';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from './infrastructure/migration/registry/production-migration-registry';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;
type Api = Awaited<ReturnType<typeof createApp>>;

const FIXED_TIME = '2026-08-07T00:00:00.000Z';
const LEGACY_PROJECT_ID = '77777777-0000-4000-8000-000000000027';
const temporaryDirectories: string[] = [];

interface Runtime {
  app: Api;
  startup: PersonalProductionStartup;
  stopped: boolean;
}

interface AppStateDocument extends Record<string, unknown> {
  projects: Array<Record<string, unknown>>;
}

const runtimes: Runtime[] = [];

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p27a-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

async function startRuntime(
  config: AppConfig,
  databasePath: string,
  dataRoot: string,
): Promise<{
  runtime: Runtime;
  startupResult: Awaited<ReturnType<PersonalProductionStartup['start']>>;
}> {
  const startup = createPersonalProductionStartup({
    config,
    databasePath,
    dataRoot,
    clock: { now: () => new Date(FIXED_TIME) },
    lockBusyTimeoutMs: 200,
    runnerBusyTimeoutMs: 5_000,
  });
  const startupResult = await startup.start();
  const dependencies = startup.runtimeDependencies();
  const app = await createApp({
    config,
    provider: dependencies.provider,
    personalStore: dependencies.personalStore,
    clock: () => new Date(FIXED_TIME),
  });
  const runtime = { app, startup, stopped: false };
  runtimes.push(runtime);
  return { runtime, startupResult };
}

async function stopRuntime(runtime: Runtime): Promise<void> {
  if (runtime.stopped) return;
  await runtime.app.close();
  await runtime.startup.shutdown();
  runtime.stopped = true;
}

function projectPayload(name: string): Record<string, unknown> {
  return {
    projectName: name,
    clientName: 'Reality Client',
    crmReference: 'CRM-P27A-001',
    projectType: 'Villa Lighting Design',
    description: 'P2.7A commercial value reality check.',
    siteLocation: 'Dubai Hills',
    designStage: 'Concept',
    lightingScope: 'Complete villa lighting design and documentation.',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 24,
    requiredDeliveryDate: '2026-08-20',
    createFolders: false,
    folderProfile: 'Full Lighting Design',
    services: ['LightingDesign', 'TechnicalBoq'],
    luminaireInputMode: 'Later',
    idempotencyKey: randomUUID(),
  };
}

function readAppState(database: DatabaseSyncInstance): AppStateDocument {
  const row = database
    .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
    .get() as { json_value: string } | undefined;
  if (!row) throw new Error('Missing primary app_state record.');
  const parsed: unknown = JSON.parse(row.json_value);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('projects' in parsed) ||
    !Array.isArray(parsed.projects)
  ) {
    throw new Error('Invalid primary app_state record.');
  }
  return parsed as AppStateDocument;
}

function userVersion(database: DatabaseSyncInstance): number {
  const row = database.prepare('PRAGMA user_version').get() as
    { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function appStateColumns(database: DatabaseSyncInstance): string[] {
  return (database.prepare('PRAGMA table_info(app_state)').all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) await stopRuntime(runtime);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('P2.7A optional project commercial value reality', () => {
  it('validates, persists, reopens, and clears the pair without new pricing or schema behavior', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'scli-p27a-reality-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'scli.sqlite');
    const projectRoot = path.join(directory, 'projects');
    mkdirSync(projectRoot, { recursive: true });
    new DatabaseSync(databasePath).close();
    const config = makeConfig(databasePath, projectRoot);

    const first = await startRuntime(config, databasePath, directory);
    expect(first.startupResult).toMatchObject({
      outcome: 'READY_AFTER_MIGRATION',
      migrated: true,
      fromVersion: 0,
      toVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    });

    const invalidCreate = await first.runtime.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { ...projectPayload('Invalid Half Pair'), commercialValueMinor: 250_000 },
    });
    expect(invalidCreate.statusCode).toBe(400);
    expect(invalidCreate.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');

    const createResponse = await first.runtime.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        ...projectPayload('Commercial Reality Project'),
        commercialValueMinor: 2_500_000,
        commercialCurrency: 'AED',
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      data: {
        project: {
          id: string;
          projectCode: string;
          crmReference: string | null;
          commercialValueMinor: number | null;
          commercialCurrency: string | null;
          version: number;
        };
      };
    }>().data.project;
    expect(created).toMatchObject({
      crmReference: 'CRM-P27A-001',
      commercialValueMinor: 2_500_000,
      commercialCurrency: 'AED',
      version: 1,
    });

    const invalidUpdate = await first.runtime.app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: {
        commercialValueMinor: 3_000_000,
        commercialCurrency: 'usd',
        expectedVersion: created.version,
      },
    });
    expect(invalidUpdate.statusCode).toBe(400);

    const updateResponse = await first.runtime.app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: {
        commercialValueMinor: 3_000_000,
        commercialCurrency: 'USD',
        expectedVersion: created.version,
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json<{
      data: {
        id: string;
        projectCode: string;
        crmReference: string | null;
        commercialValueMinor: number | null;
        commercialCurrency: string | null;
        version: number;
      };
    }>().data;
    expect(updated).toMatchObject({
      id: created.id,
      projectCode: created.projectCode,
      crmReference: created.crmReference,
      commercialValueMinor: 3_000_000,
      commercialCurrency: 'USD',
      version: 2,
    });

    const activityResponse = await first.runtime.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}/activity`,
    });
    const commercialActivities = activityResponse
      .json<{
        data: Array<{
          projectId: string;
          actionType: string;
          fieldName: string | null;
        }>;
      }>()
      .data.filter((activity) => activity.fieldName?.startsWith('commercial'));
    expect(commercialActivities).toHaveLength(2);
    expect(commercialActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: created.id,
          actionType: 'ProjectUpdated',
          fieldName: 'commercialValueMinor',
        }),
        expect.objectContaining({
          projectId: created.id,
          actionType: 'ProjectUpdated',
          fieldName: 'commercialCurrency',
        }),
      ]),
    );

    await stopRuntime(first.runtime);

    const database = new DatabaseSync(databasePath);
    expect(userVersion(database)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(appStateColumns(database)).toEqual(['state_key', 'json_value', 'updated_at']);
    const state = readAppState(database);
    const persisted = state.projects.find((project) => project.id === created.id);
    if (!persisted) throw new Error('Missing persisted commercial project.');
    expect(persisted).toMatchObject({
      id: created.id,
      projectCode: created.projectCode,
      crmReference: created.crmReference,
      commercialValueMinor: 3_000_000,
      commercialCurrency: 'USD',
    });

    const legacyProject: Record<string, unknown> = {
      ...persisted,
      id: LEGACY_PROJECT_ID,
      projectCode: '777_SCLI260101_LEGACY_COMMERCIAL_FREE_PROJECT',
      projectName: 'Legacy Commercial-Free Project',
      version: 1,
    };
    delete legacyProject.commercialValueMinor;
    delete legacyProject.commercialCurrency;
    state.projects.push(legacyProject);
    database
      .prepare("UPDATE app_state SET json_value = ?, updated_at = ? WHERE state_key = 'primary'")
      .run(JSON.stringify(state), FIXED_TIME);
    database.close();

    const second = await startRuntime(config, databasePath, directory);
    expect(second.startupResult).toMatchObject({
      outcome: 'READY',
      migrated: false,
      fromVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      toVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      appliedMigrationIds: [],
    });

    const reopenedResponse = await second.runtime.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    });
    expect(reopenedResponse.statusCode).toBe(200);
    const reopened = reopenedResponse.json<{ data: Record<string, unknown> }>().data;
    expect(reopened).toMatchObject({
      id: created.id,
      projectCode: created.projectCode,
      crmReference: created.crmReference,
      commercialValueMinor: 3_000_000,
      commercialCurrency: 'USD',
      version: 2,
    });
    for (const excludedField of [
      'unitPriceMinor',
      'commercialBoqTotalMinor',
      'exchangeRate',
      'convertedValueMinor',
      'baseCurrency',
    ]) {
      expect(reopened).not.toHaveProperty(excludedField);
    }

    const legacyResponse = await second.runtime.app.inject({
      method: 'GET',
      url: `/api/projects/${LEGACY_PROJECT_ID}`,
    });
    expect(legacyResponse.statusCode).toBe(200);
    const legacy = legacyResponse.json<{ data: Record<string, unknown> }>().data;
    expect(legacy.id).toBe(LEGACY_PROJECT_ID);
    expect(legacy).not.toHaveProperty('commercialValueMinor');
    expect(legacy).not.toHaveProperty('commercialCurrency');

    const clearResponse = await second.runtime.app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}`,
      payload: {
        commercialValueMinor: null,
        commercialCurrency: null,
        expectedVersion: 2,
      },
    });
    expect(clearResponse.statusCode).toBe(200);
    expect(clearResponse.json<{ data: Record<string, unknown> }>().data).toMatchObject({
      id: created.id,
      projectCode: created.projectCode,
      crmReference: created.crmReference,
      commercialValueMinor: null,
      commercialCurrency: null,
      version: 3,
    });

    await stopRuntime(second.runtime);
    const finalDatabase = new DatabaseSync(databasePath, { readOnly: true });
    expect(userVersion(finalDatabase)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(appStateColumns(finalDatabase)).toEqual(['state_key', 'json_value', 'updated_at']);
    const finalState = readAppState(finalDatabase);
    expect(finalState.projects.find((project) => project.id === created.id)).toMatchObject({
      id: created.id,
      commercialValueMinor: null,
      commercialCurrency: null,
      version: 3,
    });
    expect(
      finalState.projects.find((project) => project.id === LEGACY_PROJECT_ID),
    ).not.toHaveProperty('commercialValueMinor');
    finalDatabase.close();
  });
});
