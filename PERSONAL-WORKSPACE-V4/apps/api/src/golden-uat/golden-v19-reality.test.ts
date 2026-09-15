import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { seedProjects } from '@scli/test-data';
import ExcelJS from 'exceljs';
import { createGoldenUatHarness } from './golden-uat-harness.js';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_IDEMPOTENCY_KEY,
  GOLDEN_UAT_PROJECT_NAME,
} from './golden-uat-types.js';
import {
  GOLDEN_V19_IDS,
  GOLDEN_V19_INTERNAL_NOTE,
  GOLDEN_V19_PROJECT_CODE,
  GOLDEN_V19_PROJECT_ID,
  GOLDEN_V19_PURPOSE,
  goldenV19SourceFiles,
} from './golden-v19-fixture.js';
import { applyGoldenV19Reality } from './golden-v19-upgrade.js';
import { planGoldenV19Reality, verifyGoldenV19Reality } from './golden-v19-verifier.js';
import { inspectGoldenV19XlsxSemantics } from './golden-v19-xlsx-semantics.js';
import { writeGoldenFixtureFile } from './golden-uat-assets.js';
import { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore.js';
import { RevisionDeliverableService } from '../infrastructure/output-registry/RevisionDeliverableService.js';
import { REVISION_DELETE_UAT_TEST_PROJECT_ID } from '../scripts/revision-delete-uat-preparer.js';

const roots: string[] = [];

interface FixturePaths {
  root: string;
  databasePath: string;
  projectRoot: string;
  sourceRoot: string;
}

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-golden-v19-'));
  roots.push(root);
  return root;
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function generatedXlsxFromFreshProcess(): { schedule: Buffer; boq: Buffer } {
  const script = [
    "import { goldenV19GeneratedOutputFiles } from './apps/api/src/golden-uat/golden-v19-fixture.ts';",
    'const files = await goldenV19GeneratedOutputFiles();',
    "const schedule = files.find((file) => file.logicalId === 'output-schedule-xlsx');",
    "const boq = files.find((file) => file.logicalId === 'output-boq-xlsx');",
    "process.stdout.write(JSON.stringify({ schedule: schedule.bytes.toString('base64'), boq: boq.bytes.toString('base64') }));",
  ].join(' ');
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(output) as { schedule: string; boq: string };
  return {
    schedule: Buffer.from(parsed.schedule, 'base64'),
    boq: Buffer.from(parsed.boq, 'base64'),
  };
}

function verifyInFreshProcess(paths: FixturePaths): { status: string; checks: unknown[] } {
  const script = [
    "import { verifyGoldenV19Reality } from './apps/api/src/golden-uat/golden-v19-verifier.ts';",
    'const report = await verifyGoldenV19Reality(process.argv[1], process.argv[2]);',
    'process.stdout.write(JSON.stringify(report));',
  ].join(' ');
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, paths.databasePath, paths.sourceRoot],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(output) as { status: string; checks: unknown[] };
}

function treeInventory(root: string): string[] {
  if (!existsSync(root)) return [];
  const entries: string[] = [];
  const visit = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) visit(absolute);
      else if (item.isFile()) {
        entries.push(
          `${path.relative(root, absolute).replaceAll('\\', '/')}:${hashFile(absolute)}`,
        );
      } else entries.push(`${path.relative(root, absolute).replaceAll('\\', '/')}:NON_FILE`);
    }
  };
  visit(root);
  return entries.sort();
}

function mutatePersistedProject(databasePath: string, patch: Record<string, string | null>): void {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as { json_value: string };
    const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
    Object.assign(state.projects[0]!, patch);
    db.prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'").run(
      JSON.stringify(state),
    );
  } finally {
    db.close();
  }
}

type HiddenAuthority = 'compatibility' | 'project-export' | 'legacy-package' | 'delete-tombstone';

function insertHiddenSequence(databasePath: string, authority: HiddenAuthority): void {
  const db = new DatabaseSync(databasePath);
  const id = randomUUID();
  const timestamp = '2026-08-12T07:30:00.000Z';
  try {
    if (authority === 'compatibility') {
      db.prepare(
        `INSERT INTO project_revisions
          (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
           summary, change_log, source_type, source_reference, locked, snapshot_hash,
           reissue_number, created_at, updated_at)
         SELECT ?, project_id, 3, title, status, received_at, due_date, issued_at,
                summary, change_log, source_type, source_reference, locked, snapshot_hash,
                reissue_number, ?, ?
           FROM project_revisions WHERE project_id = ? AND revision_number = 2`,
      ).run(id, timestamp, timestamp, GOLDEN_V19_PROJECT_ID);
      return;
    }
    if (authority === 'project-export') {
      db.prepare(
        `INSERT INTO project_exports
          (id, project_id, revision, excel_path, pdf_path, datasheet_folder, created_at)
         VALUES (?, ?, 3, '', '', '', ?)`,
      ).run(id, GOLDEN_V19_PROJECT_ID, timestamp);
      return;
    }
    if (authority === 'legacy-package') {
      db.prepare(
        `INSERT INTO revision_packages
          (id, project_id, revision_number, reissue_number, label, status, output_mode,
           folder_path, zip_path, item_count, total_bytes, package_hash,
           warning_override_reason, manifest_json, created_at)
         VALUES (?, ?, 3, 0, 'Hidden REV_03', 'Draft', 'Folder', '', '', 0, 0,
                 'fixture-hidden', '', '[]', ?)`,
      ).run(id, GOLDEN_V19_PROJECT_ID, timestamp);
      return;
    }
    const revisionId = randomUUID();
    db.prepare(
      `INSERT INTO revision_delete_operations
        (operation_id, project_id, revision_id, revision_sequence, revision_label,
         actor_id, actor_name_snapshot, state, failure_reason, artifact_manifest_json,
         document_snapshot_count, datasheet_snapshot_count, generated_output_count,
         created_at, archive_started_at, db_committed_at, completed_at, updated_at)
       VALUES (?, ?, ?, 3, 'REV_03', ?, 'Golden UAT Admin', 'COMPLETED', NULL, ?,
               0, 0, 0, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      GOLDEN_V19_PROJECT_ID,
      revisionId,
      randomUUID(),
      JSON.stringify({ revisionId, items: [] }),
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
  } finally {
    db.close();
  }
}

function insertForeignCompatibilityRevision(databasePath: string): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(
      `INSERT INTO project_revisions
        (id, project_id, revision_number, title, status, received_at, due_date, issued_at,
         summary, change_log, source_type, source_reference, locked, snapshot_hash,
         reissue_number, created_at, updated_at)
       SELECT ?, ?, 19, title, status, received_at, due_date, issued_at,
              summary, change_log, source_type, source_reference, locked, snapshot_hash,
              reissue_number, created_at, updated_at
         FROM project_revisions WHERE project_id = ? AND revision_number = 2`,
    ).run(randomUUID(), randomUUID(), GOLDEN_V19_PROJECT_ID);
  } finally {
    db.close();
  }
}

function insertPartialLastingRevision(databasePath: string): void {
  const db = new DatabaseSync(databasePath);
  const timestamp = '2026-08-12T07:45:00.000Z';
  try {
    db.prepare(
      `INSERT INTO canonical_revisions
        (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
         project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
         created_by_name, provenance_classification, legacy_source_id, failure_reason,
         created_at, finalized_at, updated_at, purpose, internal_note)
       SELECT ?, project_id, 3, 'REV_03', 'PREPARING', project_snapshot_json,
              luminaire_snapshot_json, snapshot_hash, created_by_id, created_by_name,
              provenance_classification, NULL, NULL, ?, NULL, ?, NULL, NULL
         FROM canonical_revisions WHERE project_id = ? AND revision_sequence = 2`,
    ).run(GOLDEN_V19_IDS.lastingRevision, timestamp, timestamp, GOLDEN_V19_PROJECT_ID);
  } finally {
    db.close();
  }
}

async function expectPlanAndApplyConflictWithoutMutation(paths: FixturePaths): Promise<void> {
  const databaseBeforePlan = hashFile(paths.databasePath);
  const sourceBeforePlan = treeInventory(paths.sourceRoot);
  const projectBeforePlan = treeInventory(paths.projectRoot);
  const plan = await planGoldenV19Reality(paths.databasePath, paths.sourceRoot);
  expect(plan.status).toBe('CONFLICT');
  expect(plan.operations).toEqual([]);
  expect(plan.checks.some((check) => check.code === 'allocation-authority')).toBe(true);
  expect(hashFile(paths.databasePath)).toBe(databaseBeforePlan);
  expect(treeInventory(paths.sourceRoot)).toEqual(sourceBeforePlan);
  expect(treeInventory(paths.projectRoot)).toEqual(projectBeforePlan);

  const harness = await createGoldenUatHarness({
    databasePath: paths.databasePath,
    dataRoot: paths.root,
  });
  try {
    const databaseBeforeApply = hashFile(paths.databasePath);
    const sourceBeforeApply = treeInventory(paths.sourceRoot);
    const projectBeforeApply = treeInventory(paths.projectRoot);
    await expect(applyGoldenV19Reality(harness, paths.sourceRoot)).rejects.toThrow(/CONFLICT/i);
    expect(hashFile(paths.databasePath)).toBe(databaseBeforeApply);
    expect(treeInventory(paths.sourceRoot)).toEqual(sourceBeforeApply);
    expect(treeInventory(paths.projectRoot)).toEqual(projectBeforeApply);
  } finally {
    await harness.close();
  }
}

function luminaireInput() {
  return {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '',
    description: 'Golden v19 representative luminaire.',
    manufacturer: 'SCLI Fixture Manufacturer',
    model: 'G19-DL01',
    wattage: '12 W',
    lumens: '1000 lm',
    lightColor: '3000 K',
    cri: '90',
    beamAngle: '36°',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '100 mm',
    driver: 'DALI',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '',
    location: 'Guest Room',
    unit: 'No.',
    quantity: 1,
    notes: 'Fixture-owned.',
    sourceName: 'Golden v19 baseline',
    dimensions: '120 mm',
    bodyColorFinish: 'White',
  };
}

async function createBaseline(): Promise<FixturePaths> {
  const root = tempRoot();
  const databasePath = path.join(root, 'golden.sqlite');
  const projectRoot = path.join(root, 'project-files');
  const sourceRoot = path.join(root, 'fixture-sources');
  mkdirSync(projectRoot);
  const harness = await createGoldenUatHarness({
    databasePath,
    dataRoot: root,
    clock: () => new Date('2026-08-12T07:00:00.000Z'),
  });
  try {
    const project = {
      ...structuredClone(seedProjects[0]!),
      id: GOLDEN_V19_PROJECT_ID,
      projectCode: GOLDEN_V19_PROJECT_CODE,
      projectName: GOLDEN_UAT_PROJECT_NAME,
      crmReference: GOLDEN_UAT_CRM_REFERENCE,
      createdAt: '2026-08-12T07:00:00.000Z',
      updatedAt: '2026-08-12T07:00:00.000Z',
    };
    await harness.provider.createProject({
      project,
      activities: [],
      notifications: [],
      idempotencyKey: GOLDEN_UAT_IDEMPOTENCY_KEY,
    });
    harness.store.initializeProject(
      project.id,
      ['LightingLayout', 'DialuxCalculation', 'LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Manual',
      project.requiredDeliveryDate,
    );
    harness.store.setFolderPath(project.id, projectRoot);
    harness.store.upsertLuminaire(project.id, luminaireInput());
    const revisionInput = (number: number) => ({
      revisionNumber: number,
      reissueNumber: 0,
      title: `REV0${number} — Historical Golden baseline`,
      status: number === 1 ? ('Issued' as const) : ('InProgress' as const),
      receivedAt: null,
      dueDate: null,
      issuedAt: null,
      summary: `Preserved historical REV_0${number}.`,
      changeLog: 'Historical compatibility example.',
      sourceType: 'Manual' as const,
      sourceReference: '',
    });
    harness.canonicalGeneration.createRegisterOnlyRevision(
      project,
      harness.store.getWorkspace(project.id),
      harness.admin,
      revisionInput(1),
    );
    harness.canonicalGeneration.createRegisterOnlyRevision(
      project,
      harness.store.getWorkspace(project.id),
      harness.admin,
      revisionInput(2),
    );
  } finally {
    await harness.close();
  }
  return { root, databasePath, projectRoot, sourceRoot };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('P2C-11 Golden v19 reality fixture', () => {
  it('uses stable XLSX semantics across byte-distinct fresh processes', async () => {
    const first = generatedXlsxFromFreshProcess();
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const second = generatedXlsxFromFreshProcess();

    expect(createHash('sha256').update(first.schedule).digest('hex')).not.toBe(
      createHash('sha256').update(second.schedule).digest('hex'),
    );
    expect(createHash('sha256').update(first.boq).digest('hex')).not.toBe(
      createHash('sha256').update(second.boq).digest('hex'),
    );

    const firstSchedule = await inspectGoldenV19XlsxSemantics(first.schedule, 'SCHEDULE');
    const secondSchedule = await inspectGoldenV19XlsxSemantics(second.schedule, 'SCHEDULE');
    const firstBoq = await inspectGoldenV19XlsxSemantics(first.boq, 'TECHNICAL_BOQ');
    const secondBoq = await inspectGoldenV19XlsxSemantics(second.boq, 'TECHNICAL_BOQ');
    expect(firstSchedule.matches).toBe(true);
    expect(secondSchedule.actualFingerprint).toBe(firstSchedule.actualFingerprint);
    expect(firstBoq.matches).toBe(true);
    expect(secondBoq.actualFingerprint).toBe(firstBoq.actualFingerprint);
    expect((await inspectGoldenV19XlsxSemantics(first.schedule, 'TECHNICAL_BOQ')).matches).toBe(
      false,
    );
    expect((await inspectGoldenV19XlsxSemantics(first.boq, 'SCHEDULE')).matches).toBe(false);
  });

  it('PLAN is read-only, APPLY constructs the real graph, and a second APPLY is idempotent', async () => {
    const paths = await createBaseline();
    const databaseBefore = hashFile(paths.databasePath);
    const treeBefore = treeInventory(paths.root);
    const plan = await planGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(plan.status).toBe('READY');
    expect(plan.operations).toHaveLength(5);
    expect(hashFile(paths.databasePath)).toBe(databaseBefore);
    expect(treeInventory(paths.root)).toEqual(treeBefore);

    let harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      const applied = await applyGoldenV19Reality(harness, paths.sourceRoot);
      expect(applied.changed).toBe(true);
      expect(applied.deletedRevisionId).toBe(GOLDEN_V19_IDS.deletedRevision);
      expect(applied.revisionId).toBe(GOLDEN_V19_IDS.lastingRevision);
    } finally {
      await harness.close();
    }

    const databaseBeforeVerify = hashFile(paths.databasePath);
    const treeBeforeVerify = treeInventory(paths.root);
    const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(report.status).toBe('PASS');
    expect(report.checks.every((check) => check.status === 'PASS')).toBe(true);
    expect(
      report.checks.filter(
        (check) => check.code.startsWith('package:') && check.code.endsWith(':verification'),
      ),
    ).toHaveLength(2);
    expect(
      report.ownershipManifest.some(
        (item) => item.ownershipClass === 'REVISION_DELETE_ARCHIVED_MEMBER',
      ),
    ).toBe(true);
    expect(
      report.ownershipManifest.filter(
        (item) => item.ownershipClass === 'PACKAGE_MEMBER_MATERIALIZATION',
      ),
    ).toHaveLength(14);
    expect(hashFile(paths.databasePath)).toBe(databaseBeforeVerify);
    expect(treeInventory(paths.root)).toEqual(treeBeforeVerify);
    const freshProcessReport = verifyInFreshProcess(paths);
    expect(freshProcessReport.status).toBe('PASS');

    harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      const second = await applyGoldenV19Reality(harness, paths.sourceRoot);
      expect(second.changed).toBe(false);
      expect(harness.canonicalRegistry.listRevisions(GOLDEN_V19_PROJECT_ID)).toHaveLength(3);
      expect(harness.canonicalRegistry.listIssuePackages(GOLDEN_V19_PROJECT_ID)).toHaveLength(2);
      expect(
        harness.canonicalRegistry.listRevisionDeleteOperations(GOLDEN_V19_PROJECT_ID),
      ).toHaveLength(1);
    } finally {
      await harness.close();
    }
  }, 15_000);

  it.each<HiddenAuthority>([
    'compatibility',
    'project-export',
    'legacy-package',
    'delete-tombstone',
  ])('refuses hidden Golden sequence 3 in the %s authority before mutation', async (authority) => {
    const paths = await createBaseline();
    insertHiddenSequence(paths.databasePath, authority);
    await expectPlanAndApplyConflictWithoutMutation(paths);
  });

  it('keeps allocation high-water project-scoped when another project has REV_19', async () => {
    const paths = await createBaseline();
    insertForeignCompatibilityRevision(paths.databasePath);
    const databaseBefore = hashFile(paths.databasePath);
    const treeBefore = treeInventory(paths.root);
    const plan = await planGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(plan.status).toBe('READY');
    expect(hashFile(paths.databasePath)).toBe(databaseBefore);
    expect(treeInventory(paths.root)).toEqual(treeBefore);
  });

  it('refuses a partial deterministic sequence-3 state as CONFLICT, not COMPLETE', async () => {
    const paths = await createBaseline();
    insertPartialLastingRevision(paths.databasePath);
    await expectPlanAndApplyConflictWithoutMutation(paths);
  });

  it('the read-only verifier fails closed after isolated Package-member tampering', async () => {
    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const before = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(before.checks.filter((check) => check.status !== 'PASS')).toEqual([]);
    const member = before.ownershipManifest.find(
      (item) => item.ownershipClass === 'PACKAGE_MEMBER_MATERIALIZATION',
    );
    expect(member).toBeDefined();
    writeFileSync(
      path.join(paths.projectRoot, member!.relativePath),
      Buffer.from('tampered fixture copy'),
    );
    const after = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(after.status).toBe('HASH_MISMATCH');
    expect(
      after.checks.some(
        (check) => check.code.includes('verification') && check.status === 'HASH_MISMATCH',
      ),
    ).toBe(true);
  });

  it('separately rejects persisted XLSX bytes whose hash no longer matches the canonical record', async () => {
    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const schedulePath = path.join(
      paths.projectRoot,
      'OUTPUTS/REV_03/Golden_Luminaire_Schedule.xlsx',
    );
    writeFileSync(schedulePath, Buffer.concat([readFileSync(schedulePath), Buffer.from('tamper')]));

    const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(
      report.checks.find((check) => check.code === 'output:output-schedule-xlsx:persistence')
        ?.status,
    ).toBe('HASH_MISMATCH');
    expect(report.checks.find((check) => check.code === 'file:output-schedule-xlsx')?.status).toBe(
      'PASS',
    );
  });

  it('keeps generated PDFs under exact-byte fixture verification', async () => {
    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const pdfPath = path.join(paths.projectRoot, 'OUTPUTS/REV_03/Golden_Luminaire_Schedule.pdf');
    writeFileSync(pdfPath, Buffer.concat([readFileSync(pdfPath), Buffer.from('tamper')]));

    const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(report.checks.find((check) => check.code === 'file:output-schedule-pdf')?.status).toBe(
      'HASH_MISMATCH',
    );
  });

  it('rejects a DB-consistent XLSX with wrong fixture semantics', async () => {
    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const schedulePath = path.join(
      paths.projectRoot,
      'OUTPUTS/REV_03/Golden_Luminaire_Schedule.xlsx',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      readFileSync(schedulePath) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    workbook.getWorksheet('Luminaire Schedule')!.getCell('A1').value = 'Wrong fixture header';
    const wrongBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    writeFileSync(schedulePath, wrongBytes);
    const wrongHash = createHash('sha256').update(wrongBytes).digest('hex');
    const db = new DatabaseSync(paths.databasePath);
    try {
      db.prepare('UPDATE canonical_outputs SET content_hash = ? WHERE output_id = ?').run(
        wrongHash,
        GOLDEN_V19_IDS.scheduleXlsx,
      );
    } finally {
      db.close();
    }

    const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(
      report.checks.find((check) => check.code === 'output:output-schedule-xlsx:persistence')
        ?.status,
    ).toBe('PASS');
    expect(report.checks.find((check) => check.code === 'file:output-schedule-xlsx')?.status).toBe(
      'HASH_MISMATCH',
    );
  });

  it('fails closed instead of silently repairing a conflicting partial v19 graph', async () => {
    const paths = await createBaseline();
    let harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const db = new DatabaseSync(paths.databasePath);
    try {
      db.prepare(
        'UPDATE canonical_issue_packages SET lifecycle_state = ? WHERE package_id = ?',
      ).run('PREPARING', GOLDEN_V19_IDS.reissuePackage);
    } finally {
      db.close();
    }
    harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await expect(applyGoldenV19Reality(harness, paths.sourceRoot)).rejects.toThrow(
        /partial or conflicting/i,
      );
    } finally {
      await harness.close();
    }
  });

  it('refuses hash-before-overwrite conflicts and foreign-project deterministic ID collisions', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    const source = goldenV19SourceFiles()[0]!;
    const target = path.join(root, source.relativePath);
    writeGoldenFixtureFile(root, target, source.bytes);
    expect(() => writeGoldenFixtureFile(root, target, Buffer.from('foreign bytes'))).toThrow(
      /HASH_MISMATCH/,
    );

    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      const foreign = {
        ...structuredClone(seedProjects[1]!),
        id: randomUUID(),
        projectCode: '999_SCT260812_FOREIGN',
      };
      await harness.provider.createProject({
        project: foreign,
        activities: [],
        notifications: [],
        idempotencyKey: randomUUID(),
      });
      harness.store.initializeProject(
        foreign.id,
        ['LuminaireSchedule'],
        'Full Lighting Design',
        'Manual',
        foreign.requiredDeliveryDate,
      );
      const registry = new CanonicalOutputRegistryStore(
        harness.store.getSharedDatabase(),
        undefined,
        'CANONICAL',
        {
          revisionId: () => GOLDEN_V19_IDS.lastingRevision,
          outputId: randomUUID,
          documentSnapshotId: randomUUID,
        },
      );
      new RevisionDeliverableService(harness.store, registry).prepareRevision(
        foreign,
        harness.store.getWorkspace(foreign.id),
        harness.admin,
      );
    } finally {
      await harness.close();
    }
    const plan = await planGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    expect(plan.status).toBe('CONFLICT');
  });

  it(
    'fails closed for wrong Golden UUID, code, name, marker, and explicit TEST identity',
    { timeout: 30_000 },
    async () => {
      const variants: Array<Record<string, string | null>> = [
        { id: randomUUID() },
        { projectCode: '999_SCT260812_WRONG' },
        { projectName: '[SCT UAT] Wrong Golden' },
        { crmReference: 'NOT_THE_GOLDEN_MARKER' },
        { id: REVISION_DELETE_UAT_TEST_PROJECT_ID },
      ];
      for (const patch of variants) {
        const paths = await createBaseline();
        mutatePersistedProject(paths.databasePath, patch);
        const plan = await planGoldenV19Reality(paths.databasePath, paths.sourceRoot);
        expect(plan.status).toBe('CONFLICT');
        const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
        expect(report.checks.find((check) => check.code === 'golden-identity')?.status).toBe(
          'IDENTITY_MISMATCH',
        );
      }
    },
  );

  it('keeps Purpose public and Internal Note private at serialized read-model boundaries', async () => {
    const paths = await createBaseline();
    const harness = await createGoldenUatHarness({
      databasePath: paths.databasePath,
      dataRoot: paths.root,
    });
    try {
      await applyGoldenV19Reality(harness, paths.sourceRoot);
    } finally {
      await harness.close();
    }
    const report = await verifyGoldenV19Reality(paths.databasePath, paths.sourceRoot);
    const privacy = report.checks.filter((check) =>
      ['issue-history', 'package-revision-privacy'].includes(check.code),
    );
    expect(privacy).toHaveLength(2);
    expect(privacy.every((check) => check.status === 'PASS')).toBe(true);
    expect(JSON.stringify(privacy)).toContain(GOLDEN_V19_PURPOSE);
    expect(JSON.stringify(privacy)).not.toContain(GOLDEN_V19_INTERNAL_NOTE);
  });
});
