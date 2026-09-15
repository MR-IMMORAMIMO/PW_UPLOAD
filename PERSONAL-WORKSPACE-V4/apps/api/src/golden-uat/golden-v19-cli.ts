import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGoldenUatHarness } from './golden-uat-harness.js';
import { applyGoldenV19Reality } from './golden-v19-upgrade.js';
import { defaultGoldenV19SourceRoot } from './golden-v19-fixture.js';
import { planGoldenV19Reality, verifyGoldenV19Reality } from './golden-v19-verifier.js';

interface Args {
  apply: boolean;
  verify: boolean;
  databasePath: string;
  sourceRoot: string;
  help: boolean;
}

function parse(argv: readonly string[]): Args {
  let apply = false;
  let verify = false;
  let help = false;
  let databasePath = path.resolve(
    process.cwd(),
    process.env.STANDALONE_DB_PATH ?? './data/scli.sqlite',
  );
  let sourceRoot = defaultGoldenV19SourceRoot();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--apply') apply = true;
    else if (argument === '--verify') verify = true;
    else if (argument === '--help' || argument === '-h') help = true;
    else if (argument === '--db') databasePath = path.resolve(argv[++index] ?? '');
    else if (argument.startsWith('--db=')) databasePath = path.resolve(argument.slice(5));
    else if (argument === '--fixture-root') sourceRoot = path.resolve(argv[++index] ?? '');
    else if (argument.startsWith('--fixture-root=')) sourceRoot = path.resolve(argument.slice(15));
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  if (apply && verify) throw new Error('Choose either --apply or --verify; PLAN is the default.');
  return { apply, verify, databasePath, sourceRoot, help };
}

function printChecks(checks: readonly { code: string; status: string; detail: string }[]): void {
  for (const check of checks)
    process.stdout.write(`  [${check.status}] ${check.code}: ${check.detail}\n`);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        'Golden v19 reality fixture + read-only verifier',
        '',
        'PLAN (default, read-only):',
        '  pnpm golden:v19 --db <absolute.sqlite> --fixture-root <absolute-source-root>',
        '',
        'VERIFY (strict read-only):',
        '  pnpm golden:v19:verify --db <absolute.sqlite> --fixture-root <absolute-source-root>',
        '',
        'APPLY (explicitly authorized target only):',
        '  pnpm golden:v19 --apply --db <absolute.sqlite> --fixture-root <absolute-source-root>',
        '',
      ].join('\n'),
    );
    return;
  }
  if (args.verify) {
    const report = await verifyGoldenV19Reality(args.databasePath, args.sourceRoot);
    process.stdout.write(`GOLDEN v19 VERIFY: ${report.status}\n`);
    printChecks(report.checks);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return;
  }
  const plan = await planGoldenV19Reality(args.databasePath, args.sourceRoot);
  process.stdout.write(`GOLDEN v19 PLAN: ${plan.status}\n`);
  printChecks(plan.checks);
  for (const operation of plan.operations) process.stdout.write(`  -> ${operation}\n`);
  if (!args.apply) {
    process.stdout.write('No mutation was performed (PLAN mode).\n');
    process.exitCode = plan.status === 'CONFLICT' ? 1 : 0;
    return;
  }
  if (plan.status === 'CONFLICT')
    throw new Error('APPLY refused because the current PLAN conflicts.');
  if (plan.status === 'NO_CHANGES') {
    process.stdout.write('No mutation required.\n');
    return;
  }

  const harness = await createGoldenUatHarness({ databasePath: args.databasePath });
  try {
    const result = await applyGoldenV19Reality(harness, args.sourceRoot);
    process.stdout.write(
      `GOLDEN v19 APPLY: ${result.changed ? 'APPLIED' : 'NO_CHANGES'} revision=${result.revisionId}\n`,
    );
  } finally {
    await harness.close();
  }
  const verified = await verifyGoldenV19Reality(args.databasePath, args.sourceRoot);
  process.stdout.write(`GOLDEN v19 POST-APPLY VERIFY: ${verified.status}\n`);
  printChecks(verified.checks);
  if (verified.status !== 'PASS') process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  main().catch((error) => {
    process.stderr.write(
      `Golden v19 command failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
