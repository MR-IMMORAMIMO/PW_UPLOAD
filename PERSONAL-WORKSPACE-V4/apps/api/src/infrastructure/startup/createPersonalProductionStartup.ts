/**
 * createPersonalProductionStartup: production personal-server startup assembly (P1.8I).
 *
 * This is the first production activation of the migration foundation. The assembly builds one
 * real WorkspaceStartupCoordinator dependency graph:
 *
 * - real DatabaseStartupLock
 * - real ProductionPendingRestoreGate backed by RestoreManager
 * - real ProductionMigrationStartupGate backed by PersistentMigrationJournal
 * - real SchemaMigrationRunner using PRODUCTION_MIGRATIONS and PRODUCTION_SCHEMA_TARGET_VERSION
 * - real PersistentMigrationJournal
 * - lazy StandaloneDataProvider and PersonalWorkspaceStore factories in EXTERNALLY_MIGRATED mode
 *
 * The provider and store factories are lazy: nothing is constructed while the coordinator is
 * assembled, nothing is constructed before migration succeeds, and each factory is called
 * exactly once on successful startup. Runtime instances are obtained only through
 * runtimeDependencies() after a READY outcome; coordinator.shutdown() remains the owner of
 * store, provider, and lock cleanup.
 *
 * Every workspace-owned path is derived from the configured database path and resolved through
 * PathResolverService. No repository, user-profile, or OneDrive path is hard-coded.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AppConfig } from '@scli/config';
import type { SeedData } from '@scli/test-data';
import type { FastifyInstance } from 'fastify';
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;
import { PersonalWorkspaceStore } from '../../personal-workspace-store';
import { openStandaloneDatabase, StandaloneDataProvider } from '../../standalone-data-provider';
import { BackupManager } from '../backup/BackupManager';
import type { ManagedAssetRoot } from '../backup/ManagedAssetSnapshot';
import { RestoreManager, type BackupVerificationPort } from '../backup/RestoreManager';
import { PersistentMigrationJournal } from '../migration/journal/PersistentMigrationJournal';
import { LegacyDetector } from '../migration/legacy/LegacyDetector';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from '../migration/registry/production-migration-registry';
import { SchemaMigrationRunner } from '../migration/SchemaMigrationRunner';
import type {
  MigrationBackupFactory,
  MigrationBackupPort,
  MigrationClock,
  MigrationDatabaseFactory,
} from '../migration/types';
import { PathResolverService } from '../path/PathResolverService';
import { DatabaseStartupLock } from './DatabaseStartupLock';
import { ProductionMigrationStartupGate } from './ProductionMigrationStartupGate';
import { ProductionPendingRestoreGate } from './ProductionPendingRestoreGate';
import type {
  PersonalStoreFactory,
  RuntimeProviderFactory,
  WorkspaceStartupResult,
} from './startup-types';
import { WorkspaceStartupCoordinator } from './WorkspaceStartupCoordinator';

/** Application version stamped into migration history, journal, and backup metadata. */
export const PRODUCTION_APP_VERSION = '3.3.0' as const;

/** Production pending-restore request file name beside the database. */
export const PRODUCTION_PENDING_RESTORE_REQUEST_FILE = 'restore-pending.json' as const;

/** Legacy raw pending-restore marker that now fails closed. */
export const PRODUCTION_LEGACY_PENDING_RESTORE_FILE = 'restore-pending.sqlite' as const;

export interface PersonalProductionStartupOptions {
  readonly config: AppConfig;
  /** Absolute database path. Defaults to process.cwd()-relative STANDALONE_DB_PATH. */
  readonly databasePath?: string;
  /** Workspace data root. Defaults to the database directory. */
  readonly dataRoot?: string;
  /** App version stamped into migration records. Defaults to PRODUCTION_APP_VERSION. */
  readonly appVersion?: string;
  /** Lock busy timeout in milliseconds. Defaults to 1000 (bounded by the lock). */
  readonly lockBusyTimeoutMs?: number;
  /** Migration runner busy timeout in milliseconds. Defaults to 5000. */
  readonly runnerBusyTimeoutMs?: number;
  readonly clock?: MigrationClock;
  readonly journalIdGenerator?: { generate(): string };
  readonly backupIdGenerator?: { generate(): string };
  readonly restoreStagingNameGenerator?: { generate(): string };
  readonly journalRoot?: string;
  readonly backupRoot?: string;
  readonly pendingRestoreRequestPath?: string;
  readonly legacyPendingRestorePath?: string;
  /** Lazy factory overrides (defaults to real EXTERNALLY_MIGRATED constructors). */
  readonly providerFactory?: RuntimeProviderFactory;
  readonly storeFactory?: PersonalStoreFactory;
  /** Deterministic seed used only when a newly migrated database has no primary state row. */
  readonly initialSeed?: SeedData;
}

export interface PersonalProductionRuntimeDependencies {
  readonly provider: StandaloneDataProvider;
  readonly personalStore: PersonalWorkspaceStore;
}

export interface PersonalProductionStartup {
  readonly coordinator: WorkspaceStartupCoordinator;
  start(): Promise<WorkspaceStartupResult>;
  /** Available only after a READY or READY_AFTER_MIGRATION outcome. */
  runtimeDependencies(): PersonalProductionRuntimeDependencies;
  shutdown(): Promise<void>;
}

export interface GracefulShutdownDeps {
  readonly app: FastifyInstance;
  readonly coordinator: WorkspaceStartupCoordinator;
}

export interface GracefulShutdownController {
  /** Idempotent single-flight shutdown: app.close() first, then coordinator.shutdown(). */
  readonly shutdown: () => Promise<void>;
  /**
   * Installs process signal handlers that call shutdown() and returns a removal function.
   * Handlers are also removed automatically when shutdown() completes.
   */
  readonly install: (signals?: readonly NodeJS.Signals[]) => () => void;
}

function createProductionDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(databasePath: string): DatabaseSyncInstance {
      return new DatabaseSync(databasePath);
    },
    openReadOnly(databasePath: string): DatabaseSyncInstance {
      return new DatabaseSync(databasePath, { readOnly: true });
    },
  };
}

/**
 * Backup verification policy shared by the migration-run backup factory and the restore
 * verifier. The source may be an empty fresh database or a legacy v3.2.2 database, so the
 * policy relies on SQLite integrity verification (plus RestoreManager's pre-restore
 * reverification) rather than a fixed table list. The migration runner and the external-mode
 * constructors re-assert the complete schema after any restore or migration.
 */
function createProductionVerificationPolicy(): { requiredTables: readonly string[] } {
  return { requiredTables: [] };
}

/**
 * Builds a BackupVerificationPort bound to the production backup root. RestoreManager needs a
 * real verifier before migration, when no workspace database handle may exist yet, so the
 * BackupManager is constructed with a temporary closed source handle: BackupManager.verifyBackup
 * never touches the source handle, and production never calls createVerifiedBackup through this
 * verifier (migration-run backups go through the runner's own factory).
 */
function createProductionBackupVerifier(deps: {
  readonly backupRoot: string;
  readonly dataRoot: string;
  readonly clock: MigrationClock;
  readonly appVersion: string;
  readonly idGenerator: { generate(): string };
  readonly managedAssetRoots: readonly ManagedAssetRoot[];
}): BackupVerificationPort {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'scli-backup-verifier-'));
  const tempSourcePath = path.join(tempRoot, 'verifier-source.sqlite');
  let sourceDb: DatabaseSyncInstance | null = null;
  try {
    sourceDb = new DatabaseSync(tempSourcePath);
    sourceDb.close();
    const manager = new BackupManager({
      sourceDb,
      sourceDatabasePath: tempSourcePath,
      backupRoot: deps.backupRoot,
      pathResolver: new PathResolverService(deps.dataRoot),
      clock: deps.clock,
      idGenerator: deps.idGenerator,
      appVersion: deps.appVersion,
      verificationPolicy: createProductionVerificationPolicy(),
      managedAssetRoots: deps.managedAssetRoots,
    });
    return {
      verifyBackup: (backupId) => manager.verifyBackup(backupId),
    };
  } finally {
    try {
      if (sourceDb !== null && sourceDb.isOpen) sourceDb.close();
    } catch {
      // Best-effort cleanup; the original result is preserved.
    }
    try {
      unlinkSync(tempSourcePath);
    } catch {
      // Best-effort cleanup.
    }
    try {
      rmdirSync(tempRoot);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function createProductionBackupFactory(deps: {
  readonly backupRoot: string;
  readonly dataRoot: string;
  readonly clock: MigrationClock;
  readonly appVersion: string;
  readonly idGenerator: { generate(): string };
  readonly managedAssetRoots: readonly ManagedAssetRoot[];
}): MigrationBackupFactory {
  return {
    create(input: {
      sourceDb: DatabaseSyncInstance;
      sourceDatabasePath: string;
      sourceVersion: number;
    }): MigrationBackupPort {
      return new BackupManager({
        sourceDb: input.sourceDb,
        sourceDatabasePath: input.sourceDatabasePath,
        backupRoot: deps.backupRoot,
        pathResolver: new PathResolverService(deps.dataRoot),
        clock: deps.clock,
        idGenerator: deps.idGenerator,
        appVersion: deps.appVersion,
        verificationPolicy: createProductionVerificationPolicy(),
        managedAssetRoots: deps.managedAssetRoots,
      });
    },
  };
}

/**
 * Builds the production personal-server startup assembly. Constructing the assembly opens no
 * providers, stores, database handles, or listeners; only the coordinator, gates, journal,
 * runner, lock, and restore infrastructure are prepared. Call start() to run the full
 * lock -> restore -> interrupted-attempt gate -> migration -> provider/store sequence.
 */
export function createPersonalProductionStartup(
  options: PersonalProductionStartupOptions,
): PersonalProductionStartup {
  const config = options.config;
  const databasePath =
    options.databasePath ?? path.resolve(process.cwd(), config.STANDALONE_DB_PATH);
  const dataRoot = options.dataRoot ?? path.dirname(databasePath);
  mkdirSync(dataRoot, { recursive: true });

  const pathResolver = new PathResolverService(dataRoot);
  const backupRoot = options.backupRoot ?? path.join(dataRoot, 'backups');
  const journalRoot = options.journalRoot ?? path.join(dataRoot, 'journal');
  const pendingRestoreRequestPath =
    options.pendingRestoreRequestPath ??
    path.join(dataRoot, PRODUCTION_PENDING_RESTORE_REQUEST_FILE);
  const legacyPendingRestorePath =
    options.legacyPendingRestorePath ?? path.join(dataRoot, PRODUCTION_LEGACY_PENDING_RESTORE_FILE);
  const appVersion = options.appVersion ?? PRODUCTION_APP_VERSION;
  const clock = options.clock ?? { now: () => new Date() };
  const journalIdGenerator = options.journalIdGenerator ?? { generate: () => randomUUID() };
  const backupIdGenerator = options.backupIdGenerator ?? { generate: () => randomUUID() };
  const managedAssetRoots: readonly ManagedAssetRoot[] = [
    {
      key: 'luminaire-library',
      absolutePath: path.join(dataRoot, 'luminaire-library', 'assets'),
    },
    {
      key: 'project-luminaire-assets',
      absolutePath: path.join(dataRoot, 'project-luminaire-assets'),
    },
  ];

  const lock = new DatabaseStartupLock({
    busyTimeoutMs: options.lockBusyTimeoutMs ?? 1000,
  });
  const journal = new PersistentMigrationJournal({
    journalRoot,
    databasePath,
    pathResolver,
    clock,
    idGenerator: journalIdGenerator,
    appVersion,
    journalFormatVersion: 1 as const,
  });
  const backupVerifier = createProductionBackupVerifier({
    backupRoot,
    dataRoot,
    clock,
    appVersion,
    idGenerator: backupIdGenerator,
    managedAssetRoots,
  });
  const restoreManager = new RestoreManager({
    backupRoot,
    pathResolver,
    verifier: backupVerifier,
    stagingNameGenerator: options.restoreStagingNameGenerator ?? { generate: () => randomUUID() },
    managedAssetRoots,
  });
  const pendingRestoreGate = new ProductionPendingRestoreGate({
    targetDatabasePath: databasePath,
    requestPath: pendingRestoreRequestPath,
    legacyRequestPath: legacyPendingRestorePath,
    restoreManager,
  });
  const migrationGate = new ProductionMigrationStartupGate(journal);
  const migrationRunner = new SchemaMigrationRunner({
    migrations: [...PRODUCTION_MIGRATIONS],
    targetVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
    appVersion,
    databaseFactory: createProductionDatabaseFactory(),
    backupFactory: createProductionBackupFactory({
      backupRoot,
      dataRoot,
      clock,
      appVersion,
      idGenerator: backupIdGenerator,
      managedAssetRoots,
    }),
    journal,
    clock,
    pathResolver,
    busyTimeoutMs: options.runnerBusyTimeoutMs ?? 5000,
    legacyAdmission: new LegacyDetector(),
  });

  let createdProvider: StandaloneDataProvider | null = null;
  let createdStore: PersonalWorkspaceStore | null = null;
  // The production runtime shares ONE DatabaseSync connection between the standalone provider
  // and the personal workspace store so a future atomic workflow transaction can span both.
  // The startup assembly owns and closes that shared connection exactly once on shutdown; the
  // provider and store are injected consumers and never close a connection they do not own.
  let sharedDatabase: DatabaseSyncInstance | null = null;
  const providerFactory: RuntimeProviderFactory = {
    create() {
      sharedDatabase ??= openStandaloneDatabase(config);
      const provider = options.providerFactory
        ? options.providerFactory.create()
        : new StandaloneDataProvider(
            config,
            EXTERNALLY_MIGRATED,
            sharedDatabase,
            options.initialSeed,
          );
      createdProvider = provider as StandaloneDataProvider;
      return provider;
    },
  };
  const storeFactory: PersonalStoreFactory = {
    create() {
      sharedDatabase ??= openStandaloneDatabase(config);
      const store = options.storeFactory
        ? options.storeFactory.create()
        : new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, sharedDatabase);
      createdStore = store as PersonalWorkspaceStore;
      return store;
    },
  };

  const coordinator = new WorkspaceStartupCoordinator({
    databasePath,
    lock,
    pendingRestoreGate,
    migrationGate,
    migrationRunner,
    providerFactory,
    storeFactory,
  });

  return {
    coordinator,
    start: () => coordinator.start(),
    runtimeDependencies(): PersonalProductionRuntimeDependencies {
      if (createdProvider === null || createdStore === null) {
        throw new Error(
          'Personal production runtime dependencies are available only after a successful startup.',
        );
      }
      return { provider: createdProvider, personalStore: createdStore };
    },
    shutdown: () => {
      // The coordinator closes the provider and store synchronously when startup is not
      // in-flight. The startup assembly owns the shared runtime connection, so it is closed
      // here synchronously (exactly once) so the database file is unlocked immediately.
      const result = coordinator.shutdown();
      if (sharedDatabase !== null) {
        try {
          if (sharedDatabase.isOpen) sharedDatabase.close();
        } catch {
          // Best-effort close; the coordinator shutdown outcome is preserved.
        }
        sharedDatabase = null;
      }
      return result;
    },
  };
}

/**
 * Graceful personal-server shutdown: stop accepting requests through app.close(), then always
 * attempt coordinator.shutdown() (which closes the personal store, the provider, and the
 * startup lock). Every cleanup failure is recorded through the app logger; no failure bypasses
 * the remaining cleanup steps, and repeated calls execute exactly one shutdown sequence.
 */
export function createGracefulShutdown(deps: GracefulShutdownDeps): GracefulShutdownController {
  const app = deps.app;
  const coordinator = deps.coordinator;
  const handlers = new Map<NodeJS.Signals, () => void>();
  let inFlight: Promise<void> | null = null;
  let completed = false;

  const removeHandlers = (): void => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
    handlers.clear();
  };

  const shutdown = (): Promise<void> => {
    if (inFlight === null) {
      inFlight = (async () => {
        if (completed) return;
        const failures: unknown[] = [];
        try {
          await app.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await coordinator.shutdown();
        } catch (error) {
          failures.push(error);
        }
        completed = true;
        removeHandlers();
        for (const failure of failures) {
          app.log.error({ err: failure }, 'Graceful shutdown did not complete every cleanup step.');
        }
      })();
    }
    return inFlight;
  };

  const install = (signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM']): (() => void) => {
    for (const signal of signals) {
      const handler = (): void => {
        void shutdown();
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    return removeHandlers;
  };

  return { shutdown, install };
}
