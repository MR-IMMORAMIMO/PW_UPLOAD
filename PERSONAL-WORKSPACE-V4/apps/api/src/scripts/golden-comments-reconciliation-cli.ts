/**
 * Golden-Comments-only exact reconciliation operator command.
 *
 * PLAN is the default and opens the source read-only. APPLY requires both the explicit mode and
 * the exact confirmation token. This command never starts the normal Personal runtime or invokes
 * the full GoldenUatSeeder.
 */

import path from 'node:path';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createGoldenCommentsReconciliationEntrypoint,
  type GoldenCommentsReconciliationMode,
} from '../golden-uat/comments-reconciliation/GoldenCommentsReconciliationEntrypoint';
import { GOLDEN_COMMENTS_RECONCILIATION_ID } from '../golden-uat/comments-reconciliation/golden-comments-reconciliation-manifest';

interface CliArgs {
  readonly mode: GoldenCommentsReconciliationMode;
  readonly databasePath: string | undefined;
  readonly confirmation: string | undefined;
  readonly help: boolean;
}

function valueAfterEquals(argument: string, name: string): string | undefined {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
}

export function parseGoldenCommentsReconciliationCliArgs(argv: readonly string[]): CliArgs {
  let mode: GoldenCommentsReconciliationMode = 'PLAN';
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
    const confirmValue = valueAfterEquals(argument, '--confirm');
    if (confirmValue !== undefined || argument === '--confirm') {
      confirmation = confirmValue ?? argv[++index];
      if (!confirmation) throw new Error('--confirm requires the exact reconciliation token.');
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return { mode, databasePath, confirmation, help };
}

export function assertGoldenCommentsApplyIntent(args: CliArgs): void {
  if (args.mode === 'APPLY' && args.confirmation !== GOLDEN_COMMENTS_RECONCILIATION_ID) {
    throw new Error(
      `APPLY requires --confirm=${GOLDEN_COMMENTS_RECONCILIATION_ID}. No database was opened.`,
    );
  }
}

export function resolveCanonicalGoldenCommentsDatabasePath(
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

function helpText(): string {
  return [
    'Guarded Golden Comments exact reconciliation command',
    '',
    'PLAN (default, read-only):',
    '  pnpm golden:comments:reconcile --mode=plan --db "ABSOLUTE_DATABASE_PATH"',
    '',
    'APPLY (Comments-only mutation; exact confirmation required):',
    `  pnpm golden:comments:reconcile --mode=apply --db "ABSOLUTE_DATABASE_PATH" --confirm=${GOLDEN_COMMENTS_RECONCILIATION_ID}`,
    '',
    'Production invocation accepts only the canonical Workspace Data/scli-workspace.sqlite path.',
    'The command never starts Desktop/API and never invokes the full Golden seeder.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseGoldenCommentsReconciliationCliArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  if (!args.databasePath || !path.isAbsolute(args.databasePath)) {
    throw new Error('An explicit absolute --db path is required.');
  }
  assertGoldenCommentsApplyIntent(args);
  const expectedDatabasePath = resolveCanonicalGoldenCommentsDatabasePath();
  const entrypoint = createGoldenCommentsReconciliationEntrypoint({
    databasePath: args.databasePath,
    expectedDatabasePath,
  });
  const reconciliation = await entrypoint.run(args.mode);
  process.stdout.write(`${JSON.stringify(reconciliation, null, 2)}\n`);
  if (
    reconciliation.status !== 'PLAN_READY' &&
    reconciliation.status !== 'ALREADY_RECONCILED' &&
    reconciliation.status !== 'RECONCILIATION_APPLIED_AND_VERIFIED'
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
      `Golden Comments reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
