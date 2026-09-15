/**
 * Golden UAT fixture — canonical runtime harness.
 *
 * Assembles the SAME canonical Personal runtime used by production startup:
 *   - production migration to the current target schema (via createPersonalProductionStartup)
 *   - ONE shared DatabaseSync connection between provider and store
 *   - PersonalWorkflowTransitionCoordinator + PersonalWorkSessionCoordinator
 *   - ProjectService (personal variant, injectable clock)
 *   - CanonicalOutputRegistryStore in explicit CANONICAL mode + CanonicalGenerationService
 *
 * The seeder drives every mutation through these canonical services/stores. It never
 * writes SQLite directly.
 */

import { loadConfig, type AppConfig } from '@scli/config';
import type { AppUser } from '@scli/domain';
import path from 'node:path';
import { StandaloneDataProvider } from '../standalone-data-provider';
import { PersonalWorkspaceStore } from '../personal-workspace-store';
import { PersonalWorkflowTransitionCoordinator } from '../personal-workflow-transition-coordinator';
import { PersonalWorkSessionCoordinator } from '../personal-work-session-coordinator';
import { ProjectService } from '../project-service';
import { LuminaireExportService } from '../luminaire-export-service';
import { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore';
import { CanonicalGenerationService } from '../infrastructure/output-registry/CanonicalGenerationService';
import { createPersonalProductionStartup } from '../infrastructure/startup/createPersonalProductionStartup';

export interface GoldenUatHarness {
  config: AppConfig;
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  workflowCoordinator: PersonalWorkflowTransitionCoordinator;
  workSessionCoordinator: PersonalWorkSessionCoordinator;
  service: ProjectService;
  canonicalRegistry: CanonicalOutputRegistryStore;
  canonicalGeneration: CanonicalGenerationService;
  admin: AppUser;
  /** Closes the shared connection and releases the startup lock. */
  close(): Promise<void>;
}

export interface GoldenUatHarnessOptions {
  /** Absolute database path. */
  databasePath: string;
  /** Workspace data root (defaults to the database directory). */
  dataRoot?: string;
  /** Injectable clock used by ProjectService and the canonical registry. */
  clock?: () => Date;
  /** Company timezone. Defaults to Asia/Dubai. */
  companyTimezone?: string;
}

/**
 * Opens (and migrates to the current production target) a Personal database and assembles the canonical
 * runtime. Uses the real production startup assembly so the seeder behaves exactly like
 * the production server against the same database.
 */
export async function createGoldenUatHarness(
  options: GoldenUatHarnessOptions,
): Promise<GoldenUatHarness> {
  const databasePath = path.resolve(options.databasePath);
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'golden-uat-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Golden UAT Admin',
    STANDALONE_ADMIN_EMAIL: 'golden-uat@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Golden-Uat-Password-2026!',
    COMPANY_TIMEZONE: options.companyTimezone ?? 'Asia/Dubai',
  });

  const startup = createPersonalProductionStartup({
    config,
    databasePath,
    ...(options.dataRoot !== undefined ? { dataRoot: options.dataRoot } : {}),
  });
  const result = await startup.start();
  if (result.outcome === 'STARTUP_BLOCKED' || result.outcome === 'RECOVERY_REQUIRED') {
    await startup.shutdown();
    throw new Error(
      `Golden UAT startup blocked: ${result.reasonCode ?? 'UNKNOWN'} (${result.outcome}).`,
    );
  }
  const { provider, personalStore } = startup.runtimeDependencies();

  const clock = options.clock ?? (() => new Date());
  const workflowCoordinator = new PersonalWorkflowTransitionCoordinator(provider, personalStore);
  const workSessionCoordinator = new PersonalWorkSessionCoordinator(provider, personalStore);
  const service = new ProjectService(
    provider,
    config.COMPANY_TIMEZONE,
    clock,
    'personal',
    workflowCoordinator,
  );

  const canonicalRegistry = new CanonicalOutputRegistryStore(
    personalStore.getSharedDatabase(),
    { now: clock },
    'CANONICAL',
  );
  const exportService = new LuminaireExportService(config);
  const canonicalGeneration = new CanonicalGenerationService(
    personalStore,
    canonicalRegistry,
    exportService,
  );

  const users = await provider.listUsers();
  const admin = users.find((user) => user.role === 'Admin' && user.isActive);
  if (!admin) {
    await startup.shutdown();
    throw new Error('Golden UAT bootstrap Admin missing.');
  }

  return {
    config,
    provider,
    store: personalStore,
    workflowCoordinator,
    workSessionCoordinator,
    service,
    canonicalRegistry,
    canonicalGeneration,
    admin,
    close: () => startup.shutdown(),
  };
}
