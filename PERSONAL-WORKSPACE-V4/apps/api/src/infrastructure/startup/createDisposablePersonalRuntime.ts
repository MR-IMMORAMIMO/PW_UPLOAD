import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppConfig } from '@scli/config';
import { createSeedData, type SeedData } from '@scli/test-data';
import { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { StandaloneDataProvider } from '../../standalone-data-provider.js';
import { BackupManager } from '../backup/BackupManager.js';
import {
  ProductionWorkspaceBackupService,
  type WorkspaceBackupService,
} from '../backup/ProductionWorkspaceBackupService.js';
import { validateProductionSchemaVersion } from '../migration/registry/production-schema-validator.js';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../migration/registry/production-migration-registry.js';
import { PathResolverService } from '../path/PathResolverService.js';
import {
  createPersonalProductionStartup,
  PRODUCTION_APP_VERSION,
  PRODUCTION_PENDING_RESTORE_REQUEST_FILE,
} from './createPersonalProductionStartup.js';

export interface DisposablePersonalRuntime {
  provider: StandaloneDataProvider;
  store: PersonalWorkspaceStore;
  workspaceBackupService: WorkspaceBackupService;
  close(): Promise<void>;
}

/**
 * Creates the disposable Personal authority used by browser acceptance.
 * Project metadata, project-scoped workspace state, and Work Sessions share one
 * SQLite connection, matching the production coordinator wiring without ever
 * touching a live Personal database.
 */
export async function createDisposablePersonalRuntime(
  storageConfig: AppConfig,
  seed: SeedData = createSeedData(),
): Promise<DisposablePersonalRuntime> {
  const startup = createPersonalProductionStartup({ config: storageConfig, initialSeed: seed });
  try {
    const result = await startup.start();
    if (result.outcome !== 'READY' && result.outcome !== 'READY_AFTER_MIGRATION') {
      throw new Error(
        `Disposable Personal startup was blocked: ${result.reasonCode ?? 'UNKNOWN'}.`,
      );
    }
    const { provider, personalStore: store } = startup.runtimeDependencies();

    for (const project of seed.projects) {
      store.initializeProject(
        project.id,
        [],
        'Full Lighting Design',
        'Manual',
        project.requiredDeliveryDate,
      );
    }
    const databasePath = path.resolve(storageConfig.STANDALONE_DB_PATH);
    const dataRoot = path.dirname(databasePath);
    const backupRoot = path.join(dataRoot, 'backups');
    const database = store.getSharedDatabase();
    const requiredTables = (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    const workspaceBackupService = new ProductionWorkspaceBackupService(
      new BackupManager({
        sourceDb: database,
        sourceDatabasePath: databasePath,
        backupRoot,
        pathResolver: new PathResolverService(dataRoot),
        clock: { now: () => new Date() },
        idGenerator: { generate: () => randomUUID() },
        appVersion: PRODUCTION_APP_VERSION,
        verificationPolicy: {
          requiredTables,
          validateDatabase: (candidate) =>
            validateProductionSchemaVersion(candidate, PRODUCTION_SCHEMA_TARGET_VERSION),
        },
        managedAssetRoots: [
          {
            key: 'luminaire-library',
            absolutePath: path.join(dataRoot, 'luminaire-library', 'assets'),
          },
          {
            key: 'project-luminaire-assets',
            absolutePath: path.join(dataRoot, 'project-luminaire-assets'),
          },
          {
            key: 'document-store',
            absolutePath: path.join(dataRoot, 'document-store', 'objects'),
          },
        ],
      }),
      backupRoot,
      path.join(dataRoot, PRODUCTION_PENDING_RESTORE_REQUEST_FILE),
    );

    return {
      provider,
      store,
      workspaceBackupService,
      close: () => startup.shutdown(),
    };
  } catch (error) {
    await startup.shutdown();
    throw error;
  }
}
