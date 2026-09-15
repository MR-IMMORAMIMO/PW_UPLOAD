/**
 * createPersonalProductionServer: shared production Personal bootstrap (P2-FND-A2-01).
 *
 * Single canonical production Personal assembly used by BOTH supported production entrypoints:
 *
 *   - Desktop portable app (desktop/main.cjs spawns dist/personal-server.js)
 *   - documented standalone production startup (pnpm start -> dist/personal-server.js)
 *
 * Before this slice, Desktop Personal ran through this canonical assembly while `pnpm start`
 * launched the generic apps/api/src/server.ts, which could silently fall back to the independent
 * legacy Revision/Export/Package writers. That produced two different production authorities for
 * the same codebase depending on the startup command. This module closes that gap by centralizing
 * the canonical Personal production assembly so both entrypoints delegate to one implementation.
 *
 * Every supported production Personal runtime assembled here has:
 *
 *   1. production DB startup (WorkspaceStartupCoordinator)
 *   2. interrupted-attempt + pending-restore gates
 *   3. schema migration to version 4
 *   4. CanonicalOutputRegistryStore in explicit CANONICAL mode
 *   5. CanonicalGenerationService / CanonicalIssuePackageService via createApp
 *   6. canonical artifact reconciliation (runs inside createApp when the registry is present)
 *   7. current Personal stores sharing one production DatabaseSync handle
 *
 * FAIL-CLOSED rule: production Personal assembly REQUIRES an explicit CANONICAL registry. If the
 * registry is absent or is in a non-CANONICAL authority mode, assembly throws
 * PersonalProductionAuthorityError instead of silently constructing a legacy-writer runtime. The
 * generic createApp legacy fallback remains available only to explicit test/legacy harnesses.
 *
 * The CanonicalOutputRegistryStore default (LEGACY_COMPATIBILITY) is preserved; production Personal
 * explicitly requests CANONICAL so authority selection stays visible and no migration/test utility
 * becomes a production writer by accident.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { loadConfig, type AppConfig } from '@scli/config';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../app';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore';
import { BackupManager } from '../backup/BackupManager';
import { ProductionWorkspaceBackupService } from '../backup/ProductionWorkspaceBackupService';
import { validateProductionSchemaVersion } from '../migration/registry/production-schema-validator';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../migration/registry/production-migration-registry';
import { PathResolverService } from '../path/PathResolverService';
import {
  createGracefulShutdown,
  createPersonalProductionStartup,
  PRODUCTION_APP_VERSION,
  PRODUCTION_PENDING_RESTORE_REQUEST_FILE,
  type PersonalProductionStartup,
} from './createPersonalProductionStartup';
import { registerV4Static, resolveV4DistRoot } from './v4StaticRegistration';

/** Production Personal config contract applied on top of the runtime environment. */
export const PERSONAL_PRODUCTION_CONFIG_OVERRIDES = {
  APP_MODE: 'standalone',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'true',
  NODE_ENV: 'production',
} as const;

/** Generic-server routing guard: true only for a supported PRODUCTION Personal standalone runtime. */
export function isPersonalProductionMode(env: NodeJS.ProcessEnv): boolean {
  const mode = env.APP_MODE ?? 'standalone';
  const variant = env.WORKSPACE_VARIANT ?? 'personal';
  const nodeEnv = env.NODE_ENV ?? 'development';
  return mode === 'standalone' && variant === 'personal' && nodeEnv === 'production';
}

/** Registry constructor shape kept injectable so fail-closed tests can assert non-CANONICAL rejection. */
export type PersonalProductionRegistryFactory = (
  database: DatabaseSync,
  clock: () => Date,
) => CanonicalOutputRegistryStore;

export interface PersonalProductionRuntimeOptions {
  readonly config: AppConfig;
  readonly appClock?: () => Date;
  /** Injectable registry factory. Defaults to an explicit CANONICAL registry over the shared DB. */
  readonly registryFactory?: PersonalProductionRegistryFactory;
}

export interface PersonalProductionRuntime {
  readonly startup: PersonalProductionStartup;
  readonly canonicalOutputRegistry: CanonicalOutputRegistryStore;
  readonly app: FastifyInstance;
}

/** Typed startup-gate failure (STARTUP_BLOCKED / RECOVERY_REQUIRED) so the runner can map exit codes. */
export class PersonalProductionStartupBlockedError extends Error {
  public readonly outcome: 'STARTUP_BLOCKED' | 'RECOVERY_REQUIRED';
  public readonly reasonCode: string | undefined;
  public readonly startup: PersonalProductionStartup;

  public constructor(
    outcome: 'STARTUP_BLOCKED' | 'RECOVERY_REQUIRED',
    reasonCode: string | undefined,
    startup: PersonalProductionStartup,
  ) {
    super(
      outcome === 'STARTUP_BLOCKED'
        ? `Personal production startup is blocked: ${reasonCode ?? 'UNKNOWN'}`
        : `Personal production startup requires manual recovery: ${reasonCode ?? 'UNKNOWN'}`,
    );
    this.name = 'PersonalProductionStartupBlockedError';
    this.outcome = outcome;
    this.reasonCode = reasonCode;
    this.startup = startup;
  }
}

/** Fail-closed authority assertion failure: production Personal must never run under legacy authority. */
export class PersonalProductionAuthorityError extends Error {
  public readonly authorityMode: string;

  public constructor(authorityMode: string) {
    super(
      `Personal production bootstrap requires CANONICAL authority; received '${authorityMode}'. ` +
        'Refusing to construct a legacy-writer production runtime.',
    );
    this.name = 'PersonalProductionAuthorityError';
    this.authorityMode = authorityMode;
  }
}

/**
 * Assemblies one canonical Personal production runtime: runs startup/migration, constructs the
 * explicit CANONICAL registry, fail-closed-asserts authority, and wires createApp with the
 * canonical services. Does not listen and does not serve static assets (that is the runner's job).
 * Callers own shutdown through `runtime.startup.shutdown()` (the coordinator closes the shared
 * database) and `runtime.app.close()`.
 */
export async function createPersonalProductionRuntime(
  options: PersonalProductionRuntimeOptions,
): Promise<PersonalProductionRuntime> {
  const config = options.config;
  const startup = createPersonalProductionStartup({ config });
  const result = await startup.start();
  if (result.outcome === 'STARTUP_BLOCKED' || result.outcome === 'RECOVERY_REQUIRED') {
    throw new PersonalProductionStartupBlockedError(result.outcome, result.reasonCode, startup);
  }
  const dependencies = startup.runtimeDependencies();
  const appClock = options.appClock ?? (() => new Date());
  const registry = options.registryFactory
    ? options.registryFactory(dependencies.personalStore.getSharedDatabase(), appClock)
    : new CanonicalOutputRegistryStore(
        dependencies.personalStore.getSharedDatabase(),
        { now: appClock },
        'CANONICAL',
      );
  if (!registry.isCanonicalAuthority()) {
    // FAIL-CLOSED: never silently construct a legacy-writer production runtime. The coordinator
    // already owns the startup lock and shared database, so release it before propagating so the
    // database is not left locked by a failed production bootstrap.
    try {
      startup.shutdown();
    } catch {
      // Best-effort cleanup; the authority error is the primary outcome.
    }
    throw new PersonalProductionAuthorityError(
      registry.isCanonicalAuthority() ? 'CANONICAL' : 'LEGACY_COMPATIBILITY',
    );
  }
  registry.registerTechnicalBoqTemplateVersion();
  const databasePath = path.resolve(process.cwd(), config.STANDALONE_DB_PATH);
  const dataRoot = path.dirname(databasePath);
  const backupRoot = path.join(dataRoot, 'backups');
  const sharedDatabase = dependencies.personalStore.getSharedDatabase();
  const requiredTables = (
    sharedDatabase
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const workspaceBackupService = new ProductionWorkspaceBackupService(
    new BackupManager({
      sourceDb: sharedDatabase,
      sourceDatabasePath: databasePath,
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: appClock },
      idGenerator: { generate: () => randomUUID() },
      appVersion: PRODUCTION_APP_VERSION,
      verificationPolicy: {
        requiredTables,
        validateDatabase: (database) =>
          validateProductionSchemaVersion(database, PRODUCTION_SCHEMA_TARGET_VERSION),
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
  const app = await createApp({
    config,
    provider: dependencies.provider,
    personalStore: dependencies.personalStore,
    canonicalOutputRegistry: registry,
    workspaceBackupService,
  });
  return { startup, canonicalOutputRegistry: registry, app };
}

export interface PersonalProductionServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Bind host. Desktop uses 127.0.0.1; standalone network deployment uses 0.0.0.0. */
  readonly host: string;
  /** Enable Electron parent-child IPC readiness/shutdown messages. Defaults to false. */
  readonly enableIpc?: boolean;
}

/**
 * Full production Personal server bootstrap: runs createPersonalProductionRuntime, serves the built
 * web app, installs graceful shutdown, optional Electron IPC, and listens. Never returns normally
 * for a long-running process; blocked/recovery outcomes set the documented exit codes.
 */
export async function createPersonalProductionServer(
  options: PersonalProductionServerOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  const config = loadConfig({
    ...env,
    ...PERSONAL_PRODUCTION_CONFIG_OVERRIDES,
  });

  let runtime: PersonalProductionRuntime;
  try {
    runtime = await createPersonalProductionRuntime({ config });
  } catch (error) {
    if (error instanceof PersonalProductionStartupBlockedError) {
      console.error(error.message);
      try {
        await error.startup.shutdown();
      } catch (cleanupError) {
        console.error(
          'Personal production coordinator shutdown failed after a blocked/recovery outcome.',
          cleanupError,
        );
      }
      process.exitCode = error.outcome === 'STARTUP_BLOCKED' ? 3 : 4;
      return;
    }
    throw error;
  }

  const app = runtime.app;
  try {
    // Registration order is load-bearing for the F1C parallel-runtime invariant:
    //   /api routes (already registered by createApp)
    //     -> legacy static (owns the sendFile reply decorator)
    //     -> V4 static (conditional, decorateReply:false, before legacy catch-all)
    //     -> legacy SPA catch-all (last; never swallows /v4)
    const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
    const webDist = path.resolve(currentDirectory, '../../web/dist');
    await app.register(fastifyStatic, { root: webDist, wildcard: false });

    const v4DistRoot = resolveV4DistRoot(currentDirectory);
    const v4Registered = await registerV4Static(app, v4DistRoot);
    if (v4Registered) {
      app.log.info('V4 renderer dist detected; serving under /v4 (parallel runtime).');
    } else {
      app.log.info('V4 renderer dist not present; serving legacy UI only.');
    }

    app.get('/*', async (_request, reply) => reply.sendFile('index.html'));
  } catch (error) {
    // Startup failure after the coordinator succeeded: the coordinator still owns cleanup.
    try {
      await runtime.startup.coordinator.shutdown();
    } catch (cleanupError) {
      app.log.error(
        { err: cleanupError },
        'Coordinator shutdown failed after application assembly failure.',
      );
    }
    throw error;
  }

  const shutdownController = createGracefulShutdown({
    app,
    coordinator: runtime.startup.coordinator,
  });
  shutdownController.install(['SIGINT', 'SIGTERM']);

  if (options.enableIpc) {
    // Bounded parent-child IPC shutdown: only this exact message is accepted, it reuses the same
    // idempotent graceful-shutdown path as SIGINT/SIGTERM, and the process exits only after every
    // cleanup step completes. No public HTTP shutdown endpoint is exposed.
    const isParentShutdownMessage = (message: unknown): boolean =>
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'SCLI_PERSONAL_SERVER_SHUTDOWN' &&
      (message as { version?: unknown }).version === 1;

    process.on('message', (message: unknown) => {
      if (!isParentShutdownMessage(message)) return;
      void (async () => {
        let exitCode = 0;
        try {
          await shutdownController.shutdown();
        } catch (error) {
          app.log.error(
            { err: error },
            'IPC graceful shutdown did not complete every cleanup step.',
          );
          exitCode = 1;
        }
        process.exitCode = exitCode;
        process.exit(exitCode);
      })();
    });
  }

  try {
    await app.listen({ port: config.PORT, host: options.host });
    if (options.enableIpc) {
      // Explicit IPC readiness: the Electron parent waits for this message (plus /api/health)
      // before creating the main window. READY is sent only after listen succeeds so a failed
      // listen can never look ready.
      process.send?.({ type: 'SCLI_PERSONAL_SERVER_READY', version: 1 });
    }
  } catch (error) {
    app.log.error(error, 'Personal server failed to listen.');
    // app.close() first, then coordinator.shutdown(); exit code is set only after cleanup.
    await shutdownController.shutdown();
    process.exitCode = 1;
  }
}
