/**
 * Guarded migration-only CLI for the controlled live schema v9 -> v10 upgrade.
 *
 * This command never starts Fastify, providers, stores, Electron, or Golden fixture code.
 * PLAN is the default and is read-only. APPLY requires both an explicit mode and the exact
 * migration confirmation token.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createLiveV9V10MigrationEntrypoint,
  type LiveV9V10Mode,
} from '../infrastructure/migration/live-v9-v10/LiveV9V10MigrationEntrypoint';
import { PRODUCTION_V10_MIGRATION_ID } from '../infrastructure/migration/registry/production-migration-registry';

interface CliArgs {
  readonly mode: LiveV9V10Mode;
  readonly databasePath: string | undefined;
  readonly confirmation: string | undefined;
  readonly help: boolean;
}

function valueAfterEquals(argument: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
}

export function parseLiveV9V10CliArgs(argv: readonly string[]): CliArgs {
  let mode: LiveV9V10Mode = 'PLAN';
  let databasePath: string | undefined;
  let confirmation: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    const modeValue = valueAfterEquals(argument, '--mode');
    if (modeValue !== undefined || argument === '--mode') {
      const value = modeValue ?? argv[++index];
      if (value !== 'plan' && value !== 'apply') {
        throw new Error('--mode must be exactly plan or apply.');
      }
      mode = value === 'apply' ? 'APPLY' : 'PLAN';
      continue;
    }
    const dbValue = valueAfterEquals(argument, '--db');
    if (dbValue !== undefined || argument === '--db') {
      databasePath = dbValue ?? argv[++index];
      if (!databasePath) throw new Error('--db requires an absolute path.');
      continue;
    }
    const confirmationValue = valueAfterEquals(argument, '--confirm');
    if (confirmationValue !== undefined || argument === '--confirm') {
      confirmation = confirmationValue ?? argv[++index];
      if (!confirmation) throw new Error('--confirm requires the migration ID.');
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return { mode, databasePath, confirmation, help };
}

export function assertExplicitApplyIntent(args: CliArgs): void {
  if (args.mode === 'APPLY' && args.confirmation !== PRODUCTION_V10_MIGRATION_ID) {
    throw new Error(
      `APPLY requires --confirm=${PRODUCTION_V10_MIGRATION_ID}. No database was opened.`,
    );
  }
}

function helpText(): string {
  return [
    'Guarded live schema v9 -> v10 migration-only command',
    '',
    'PLAN (default, read-only):',
    '  pnpm migration:v9-v10 --mode=plan --db "ABSOLUTE_DATABASE_PATH"',
    '',
    'APPLY (mutating; requires exact confirmation token):',
    `  pnpm migration:v9-v10 --mode=apply --db "ABSOLUTE_DATABASE_PATH" --confirm=${PRODUCTION_V10_MIGRATION_ID}`,
    '',
    'The production CLI accepts only the canonical Workspace Data/scli-workspace.sqlite path',
    'under the current APPDATA directory. It never starts the normal application runtime.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseLiveV9V10CliArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  if (!args.databasePath || !path.isAbsolute(args.databasePath)) {
    throw new Error('An explicit absolute --db path is required.');
  }
  assertExplicitApplyIntent(args);

  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is required to resolve the approved live database path.');
  const expectedDatabasePath = path.join(
    appData,
    'scli-lighting-project-workspace',
    'Workspace Data',
    'scli-workspace.sqlite',
  );
  const entrypoint = createLiveV9V10MigrationEntrypoint({
    databasePath: args.databasePath,
    expectedDatabasePath,
  });
  const migrationResult = await entrypoint.run(args.mode);
  process.stdout.write(`${JSON.stringify(migrationResult, null, 2)}\n`);

  if (
    migrationResult.status !== 'PLAN_READY' &&
    migrationResult.status !== 'MIGRATION_APPLIED_AND_VERIFIED'
  ) {
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  main().catch((error) => {
    process.stderr.write(
      `Guarded migration command failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
