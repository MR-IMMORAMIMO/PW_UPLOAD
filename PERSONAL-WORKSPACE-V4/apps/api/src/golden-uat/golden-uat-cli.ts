/**
 * Golden UAT fixture — CLI entrypoint.
 *
 * Usage (repository-native, tsx):
 *   pnpm golden:uat --anchor-date 2026-08-11            # PLAN (dry-run, no mutation)
 *   pnpm golden:uat --anchor-date 2026-08-11 --apply    # APPLY to target DB
 *
 * PLAN mode is ZERO-mutation: it performs only read-only SQLite inspection (never runs
 * production startup, never migrates, never opens the DB read-write, never creates fixture
 * files or a manifest). Only --apply enters the canonical production startup path.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createGoldenUatHarness } from './golden-uat-harness';
import { GoldenUatSeeder } from './golden-uat-seeder';
import { runGoldenUatPreflight } from './golden-uat-preflight';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_DEFAULT_ANCHOR_DATE,
  GOLDEN_UAT_FIXTURE_MARKER,
  GOLDEN_UAT_MANIFEST_FILE_NAME,
  GOLDEN_UAT_PROJECT_NAME,
  GOLDEN_UAT_SCENARIO,
  type GoldenUatMode,
} from './golden-uat-types';

interface CliArgs {
  databasePath: string | undefined;
  anchorDate: string | undefined;
  apply: boolean;
  fixtureRoot: string | undefined;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    apply: false,
    help: false,
    databasePath: undefined,
    anchorDate: undefined,
    fixtureRoot: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--anchor-date') {
      args.anchorDate = argv[++index];
    } else if (arg === '--db') {
      args.databasePath = argv[++index];
    } else if (arg === '--fixture-root') {
      args.fixtureRoot = argv[++index];
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Golden UAT fixture seeder',
      '',
      'Usage:',
      '  pnpm golden:uat --anchor-date YYYY-MM-DD [--apply] [--db PATH] [--fixture-root PATH]',
      '',
      '  --anchor-date   Anchor date (YYYY-MM-DD). Defaults to 2026-08-11.',
      '  --apply         Apply the fixture (mutates the target DB). Default is PLAN/dry-run.',
      '  --db            Absolute database path. Defaults to the configured STANDALONE_DB_PATH.',
      '  --fixture-root  Fixture-owned folder root for synthetic assets.',
      '  --help          Show this help.',
      '',
      'Safety: PLAN mode performs ZERO mutation (read-only schema inspection only). APPLY requires',
      `the explicit --apply flag and never touches a non-fixture project (marker: ${GOLDEN_UAT_CRM_REFERENCE}).`,
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const mode: GoldenUatMode = args.apply ? 'APPLY' : 'PLAN';

  const databasePath =
    args.databasePath ??
    path.resolve(process.cwd(), process.env.STANDALONE_DB_PATH ?? './data/scli.sqlite');
  const anchorDate = args.anchorDate ?? GOLDEN_UAT_DEFAULT_ANCHOR_DATE;

  // Non-mutating preflight (read-only SQLite inspection). Runs for BOTH modes so the
  // target DB / schema / fixture identity are surfaced before any mutation.
  const preflight = runGoldenUatPreflight(databasePath);

  process.stdout.write(
    [
      'GOLDEN UAT FIXTURE',
      `  Mode:             ${mode}`,
      `  Target DB/storage: ${databasePath}`,
      `  Database exists:  ${preflight.databaseExists ? 'YES' : 'NO'}`,
      `  Detected schema:  v${preflight.detectedSchemaVersion}`,
      `  Expected schema:  v${preflight.expectedSchemaVersion}`,
      `  Apply eligibility:${preflight.applyEligibility}`,
      `  Fixture marker:   ${GOLDEN_UAT_FIXTURE_MARKER}`,
      `  Fixture identity: ${GOLDEN_UAT_CRM_REFERENCE}`,
      `  Fixture project:  ${GOLDEN_UAT_PROJECT_NAME}`,
      `  Scenario:         ${GOLDEN_UAT_SCENARIO}`,
      `  Anchor date:      ${anchorDate}`,
      mode === 'PLAN'
        ? '  (PLAN mode: ZERO mutation — read-only inspection only.)'
        : '  (APPLY mode: the fixture will be created/reconciled through canonical paths.)',
      '',
    ].join('\n'),
  );

  if (mode === 'PLAN') {
    // PLAN is ZERO-mutation: no production startup, no harness, no migration, no fixture
    // files, no manifest write. Only read-only inspection has run.
    process.stdout.write('INTENDED OPERATIONS\n');
    const seeder = new GoldenUatSeeder(null as never);
    const result = await seeder.seedPlanOnly(anchorDate, preflight);
    for (const operation of result.operations) {
      process.stdout.write(`  - [${operation.entity}] ${operation.description}\n`);
    }
    process.stdout.write('\nTIMESTAMP SOURCE CLASSIFICATION\n');
    for (const source of result.manifest.timestampSources) {
      process.stdout.write(
        `  - ${source.source}: declared=${source.declaredPrecision} observed=${source.observedPrecision} clock=${source.clockSource}\n`,
      );
    }
    process.stdout.write('\nNo mutation was performed (PLAN mode).\n');
    return;
  }

  // APPLY: enter the canonical production startup path.
  const anchoredStartMs = Date.parse(`${anchorDate}T08:00:00.000Z`);
  let clockTicks = 0;
  const harness = await createGoldenUatHarness({
    databasePath,
    clock: () => new Date(anchoredStartMs + clockTicks++ * 60_000),
  });
  try {
    const seeder = new GoldenUatSeeder(harness);
    const result = await seeder.seed({
      mode,
      anchorDate,
      ...(args.fixtureRoot !== undefined ? { fixtureRoot: args.fixtureRoot } : {}),
    });

    process.stdout.write('APPLIED FIXTURE SUMMARY\n');
    const counts = result.manifest.expectedCounts;
    process.stdout.write(
      [
        `  Project:      ${result.manifest.fixture.projectCode} (${result.manifest.fixture.projectId})`,
        `  Luminaires:   ${counts.luminaires} (missing datasheets ${counts.missingDatasheets}, missing images ${counts.missingImages})`,
        `  Open actions: ${counts.openActions} (overdue ${counts.overdueActions})`,
        `  Meetings:     ${counts.meetings}`,
        `  Reviews:      ${counts.commentsOrReviews}`,
        `  Revisions:    ${counts.revisions}`,
        `  Work sessions:${counts.workSessions} (active after seed: ${result.manifest.activeWorkSessionAfterSeed})`,
        `  Requirements: ${counts.requirements}`,
        `  Contacts:     ${counts.contacts}`,
        `  Documents:    ${counts.documents}`,
        `  Health score: ${result.manifest.health.score} (blocking ${result.manifest.health.blockingChecks}, warning ${result.manifest.health.warningChecks})`,
        '',
        'Unsupported canonical capabilities:',
        ...result.manifest.unsupportedCanonicalCapabilities.map((item) => `  - ${item}`),
        '',
      ].join('\n'),
    );

    // Emit the manifest (read-back based in APPLY mode).
    if (result.manifest.fixture.projectId) {
      const outputPath = path.resolve(process.cwd(), GOLDEN_UAT_MANIFEST_FILE_NAME);
      writeFileSync(outputPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
      process.stdout.write(`Golden UAT manifest written to ${outputPath}\n`);
    }
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `Golden UAT seeder failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
