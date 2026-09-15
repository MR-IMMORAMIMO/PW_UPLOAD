/**
 * Developer-only Revision Delete UAT preparation command.
 *
 * This source CLI is not imported by the server and is not shipped as a
 * product route or UI action. It mutates only the exact allowlisted TEST
 * project after an explicit confirmation token.
 */

import path from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@scli/config';
import { isManager } from '@scli/domain';
import { createPersonalProductionStartup } from '../infrastructure/startup/createPersonalProductionStartup';
import { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeleteService } from '../infrastructure/output-registry/RevisionDeleteService';
import { runGoldenUatPreflight } from '../golden-uat/golden-uat-preflight';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../infrastructure/migration/registry/production-migration-registry';
import {
  REVISION_DELETE_UAT_CONFIRMATION,
  REVISION_DELETE_UAT_GOLDEN_PROJECT_ID,
  REVISION_DELETE_UAT_TEST_PROJECT_ID,
  RevisionDeleteUatPreparer,
} from './revision-delete-uat-preparer';

interface CliArgs {
  readonly projectId: string | undefined;
  readonly revisionId: string | undefined;
  readonly confirmation: string | undefined;
  readonly help: boolean;
}

function valueAfterEquals(argument: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
}

export function parseRevisionDeleteUatArgs(argv: readonly string[]): CliArgs {
  let projectId: string | undefined;
  let revisionId: string | undefined;
  let confirmation: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    const projectValue = valueAfterEquals(argument, '--project-id');
    if (projectValue !== undefined || argument === '--project-id') {
      projectId = projectValue ?? argv[++index];
      continue;
    }
    const revisionValue = valueAfterEquals(argument, '--revision-id');
    if (revisionValue !== undefined || argument === '--revision-id') {
      revisionId = revisionValue ?? argv[++index];
      continue;
    }
    const confirmValue = valueAfterEquals(argument, '--confirm');
    if (confirmValue !== undefined || argument === '--confirm') {
      confirmation = confirmValue ?? argv[++index];
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return { projectId, revisionId, confirmation, help };
}

export function assertRevisionDeleteUatCliIntent(
  args: CliArgs,
  env: NodeJS.ProcessEnv = process.env,
): asserts args is CliArgs & { projectId: string; revisionId: string; confirmation: string } {
  if (env.NODE_ENV === 'production') {
    throw new Error('Revision Delete UAT preparation is unavailable under NODE_ENV=production.');
  }
  if (args.projectId === REVISION_DELETE_UAT_GOLDEN_PROJECT_ID) {
    throw new Error('Golden project is hard-rejected before the database is opened.');
  }
  if (args.projectId !== REVISION_DELETE_UAT_TEST_PROJECT_ID) {
    throw new Error(`--project-id must be exactly ${REVISION_DELETE_UAT_TEST_PROJECT_ID}.`);
  }
  if (!args.revisionId) throw new Error('--revision-id requires an exact Revision UUID.');
  if (args.confirmation !== REVISION_DELETE_UAT_CONFIRMATION) {
    throw new Error(
      `Preparation requires --confirm=${REVISION_DELETE_UAT_CONFIRMATION}. No database was opened.`,
    );
  }
}

export function resolveCanonicalWorkspaceDatabasePath(
  userProfileDirectory: string = userInfo().homedir,
): string {
  if (!path.isAbsolute(userProfileDirectory)) {
    throw new Error('The operating-system user profile directory must be absolute.');
  }
  return path.join(
    userProfileDirectory,
    'AppData',
    'Roaming',
    'scli-lighting-project-workspace',
    'Workspace Data',
    'scli-workspace.sqlite',
  );
}

export function assertRevisionDeleteUatSchema(preflight: {
  schemaAtTarget: boolean;
  detectedSchemaVersion: number;
}): void {
  if (
    !preflight.schemaAtTarget ||
    preflight.detectedSchemaVersion !== PRODUCTION_SCHEMA_TARGET_VERSION
  ) {
    throw new Error(
      `Revision Delete UAT preparation requires schema v${PRODUCTION_SCHEMA_TARGET_VERSION}; detected v${preflight.detectedSchemaVersion}.`,
    );
  }
}

function helpText(): string {
  return [
    'TEST-only Revision Delete UAT preparation',
    '',
    'Usage:',
    `  pnpm revision-delete:uat:prepare --project-id ${REVISION_DELETE_UAT_TEST_PROJECT_ID} --revision-id <UUID> --confirm=${REVISION_DELETE_UAT_CONFIRMATION}`,
    '',
    'The desktop application must be fully closed.',
    'The command stops at ARCHIVED. Restarting Desktop must perform ARCHIVED -> FAILED_RECOVERABLE.',
    'Golden and every non-TEST project are hard-rejected before the database is opened.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseRevisionDeleteUatArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  assertRevisionDeleteUatCliIntent(args);

  const databasePath = resolveCanonicalWorkspaceDatabasePath();
  const preflight = runGoldenUatPreflight(databasePath);
  if (!preflight.databaseExists)
    throw new Error('Canonical Personal workspace database not found.');
  assertRevisionDeleteUatSchema(preflight);

  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'revision-delete-uat-only-secret-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Revision Delete UAT Operator',
    STANDALONE_ADMIN_EMAIL: 'revision-delete-uat@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Revision-Delete-Uat-2026!',
  });
  const startup = createPersonalProductionStartup({ config, databasePath });
  const startupResult = await startup.start();
  if (
    startupResult.outcome === 'STARTUP_BLOCKED' ||
    startupResult.outcome === 'RECOVERY_REQUIRED'
  ) {
    await startup.shutdown();
    throw new Error(
      `Canonical startup refused UAT preparation: ${startupResult.reasonCode ?? startupResult.outcome}.`,
    );
  }

  try {
    const { provider, personalStore } = startup.runtimeDependencies();
    const project = await provider.getProject(args.projectId);
    if (!project) throw new Error('Allowlisted TEST project was not found.');
    const users = await provider.listUsers();
    const actor = users.find((candidate) => candidate.isActive && isManager(candidate));
    if (!actor) throw new Error('No active Owner/Manager actor is available for Safe Delete.');

    const registry = new CanonicalOutputRegistryStore(
      personalStore.getSharedDatabase(),
      { now: () => new Date() },
      'CANONICAL',
    );
    const service = new RevisionDeleteService(personalStore, registry, () => new Date());
    const preparer = new RevisionDeleteUatPreparer(registry, service);
    const result = await preparer.prepare(project, args.revisionId, actor);
    process.stdout.write(
      [
        'REVISION DELETE OWNER UAT PREPARED',
        `Project UUID: ${result.projectId}`,
        `Revision UUID: ${result.revisionId}`,
        `Operation ID: ${result.operationId}`,
        `Operation state: ${result.operationState}`,
        `Archived member count: ${result.archivedMemberCount}`,
        `Archive namespace: ${result.archiveNamespace}`,
        `Next required step: ${result.nextRequiredStep}`,
        '',
      ].join('\n'),
    );
  } finally {
    await startup.shutdown();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  main().catch((error) => {
    process.stderr.write(
      `Revision Delete UAT preparation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
