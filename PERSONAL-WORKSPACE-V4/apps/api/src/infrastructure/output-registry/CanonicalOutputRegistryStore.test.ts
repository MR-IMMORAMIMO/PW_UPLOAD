import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  builtInTemplateVersions,
  type OutputFamily,
  type ResolvedOutputTemplate,
} from '@scli/domain';
import {
  PRODUCTION_CANONICAL_DDL,
  PRODUCTION_COMPATIBILITY_COLUMNS,
  PRODUCTION_V2_DDL,
  PRODUCTION_V3_DDL,
  PRODUCTION_V4_DDL,
  PRODUCTION_V14_DDL,
  applyV12IssueAuditColumns,
  applyV17RevisionDeleteTable,
  applyV21OutputPresentationFamily,
} from '../migration/registry/production-migration-registry';
import {
  CanonicalOutputRegistryStore,
  canonicalRegistryHash,
  type CanonicalRegistryAuthorityMode,
  type OutputRegistryClock,
} from './CanonicalOutputRegistryStore';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const PROJECT_A = '10000000-0000-4000-8000-000000000001';
const PROJECT_B = '10000000-0000-4000-8000-000000000002';
const LUMINAIRE_A = '20000000-0000-4000-8000-000000000001';
const FIXED_BASE_MS = Date.parse('2026-08-10T08:00:00.000Z');

const openDatabases: DatabaseSyncInstance[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

function makeClock(): OutputRegistryClock {
  let tick = 0;
  return {
    now: () => new Date(FIXED_BASE_MS + tick++ * 1_000),
  };
}

function openRegistry(authorityMode: CanonicalRegistryAuthorityMode = 'CANONICAL'): {
  database: DatabaseSyncInstance;
  store: CanonicalOutputRegistryStore;
} {
  const database = new DatabaseSync(':memory:');
  openDatabases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of PRODUCTION_CANONICAL_DDL) database.exec(statement);
  for (const operation of PRODUCTION_COMPATIBILITY_COLUMNS) {
    if (operation.alreadyInBaseCreate) continue;
    const columns = database.prepare(`PRAGMA table_info(${operation.table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === operation.column)) {
      database.exec(
        `ALTER TABLE ${operation.table} ADD COLUMN ${operation.column} ${operation.definition}`,
      );
    }
  }
  for (const statement of [...PRODUCTION_V2_DDL, ...PRODUCTION_V3_DDL, ...PRODUCTION_V4_DDL]) {
    database.exec(statement);
  }
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV17RevisionDeleteTable(database);
  applyV21OutputPresentationFamily(database, '2026-08-10T08:00:00.000Z');
  return {
    database,
    store: new CanonicalOutputRegistryStore(database, makeClock(), authorityMode),
  };
}

function projectSnapshot(projectId: string, projectCode: string) {
  return {
    id: projectId,
    projectCode,
    projectName: 'Canonical Registry Test Project',
    clientName: 'Test Client',
    projectType: 'Lighting Design',
    status: 'InProgress',
    updatedAt: '2026-08-10T07:59:00.000Z',
  };
}

function luminaireSnapshot(luminaireId: string, tag: string) {
  return {
    luminaireId,
    tag,
    category: 'Downlight',
    imagePath: 'Images/DL01.png',
    description: 'Recessed LED downlight',
    manufacturer: 'Test Manufacturer',
    model: 'TM-01',
    wattage: '12W',
    lumens: '1100lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '36deg',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '100mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: 'Datasheets/DL01.pdf',
    location: 'Lobby',
    unit: 'pcs',
    quantity: 8,
    notes: 'Historical value',
    sourceName: 'Manual',
    dimensions: '100x100x90mm',
    bodyColorFinish: 'White',
    attachmentReferences: ['Attachments/DL01-photometry.ldt'],
  };
}

function revisionInput(
  projectId: string,
  projectCode = '001_SCT260810_CANONICAL_TEST',
  tag = 'DL01',
) {
  return {
    projectId,
    projectSnapshot: projectSnapshot(projectId, projectCode),
    luminaires: [luminaireSnapshot(LUMINAIRE_A, tag)],
    createdBy: {
      actorId: 'standalone:test-admin',
      actorNameSnapshot: 'Test Admin',
    },
  };
}

function builtIn(templateId: string): ResolvedOutputTemplate {
  const definition = builtInTemplateVersions.find(
    (candidate) => candidate.templateId === templateId,
  );
  if (!definition) throw new Error(`Missing built-in template ${templateId}.`);
  return structuredClone(definition);
}

function createOutput(
  store: CanonicalOutputRegistryStore,
  revisionId: string,
  outputFamily: OutputFamily,
  outputFormat: string,
  relativePath: string,
  templateId: string,
  resolvedTemplate = builtIn(templateId),
) {
  return store.createOutput({
    revisionId,
    outputFamily,
    outputFormat,
    relativePath,
    contentHash: null,
    resolvedTemplate,
  });
}

function finalizeOutput(store: CanonicalOutputRegistryStore, outputId: string): void {
  store.setOutputContentHash(outputId, canonicalRegistryHash({ outputId }));
  store.setOutputLifecycle(outputId, 'FINALIZED');
}

function finalizeRevision(
  store: CanonicalOutputRegistryStore,
  revisionId: string,
  outputIds: string[],
): void {
  for (const outputId of outputIds) finalizeOutput(store, outputId);
  store.setRevisionLifecycle(revisionId, 'FINALIZED');
}

function insertLegacyRevision(
  database: DatabaseSyncInstance,
  projectId: string,
  revisionNumber: number,
): void {
  database
    .prepare(
      `INSERT INTO project_revisions
       (id, project_id, revision_number, reissue_number, title, status, received_at,
        due_date, issued_at, summary, change_log, source_type, source_reference,
        locked, snapshot_hash, created_at, updated_at)
       VALUES (?, ?, ?, 0, 'Legacy Revision', 'Draft', NULL, NULL, NULL, '', '',
               'Manual', '', 0, '', ?, ?)`,
    )
    .run(
      randomUUID(),
      projectId,
      revisionNumber,
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    );
}

function expectDomainError(work: () => unknown, code: 'VALIDATION_ERROR' | 'CONFLICT'): void {
  try {
    work();
    throw new Error('Expected DomainError.');
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    expect(error.code).toBe(code);
  }
}

function columnNames(database: DatabaseSyncInstance, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

describe('CanonicalOutputRegistryStore', () => {
  it('keeps canonical aggregate writes dormant until the P2-FND-05 authority cutover', () => {
    const { database, store } = openRegistry('LEGACY_COMPATIBILITY');

    expectDomainError(() => store.createRevision(revisionInput(PROJECT_A)), 'CONFLICT');
    const count = database.prepare('SELECT COUNT(*) AS count FROM canonical_revisions').get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it('allocates one server-owned project sequence above legacy and canonical revisions', () => {
    const { database, store } = openRegistry();
    insertLegacyRevision(database, PROJECT_A, 4);

    const first = store.createRevision(revisionInput(PROJECT_A));
    const second = store.createRevision(revisionInput(PROJECT_A, '001_SCT260810_RENAMED'));
    const anotherProject = store.createRevision(revisionInput(PROJECT_B, '002_SCT260810_OTHER'));

    expect(first).toMatchObject({ revisionSequence: 5, revisionLabel: 'REV_05' });
    expect(second).toMatchObject({ revisionSequence: 6, revisionLabel: 'REV_06' });
    expect(anotherProject).toMatchObject({ revisionSequence: 1, revisionLabel: 'REV_01' });
    expect(first.revisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.revisionId).not.toBe(first.revisionId);

    expect(() =>
      database
        .prepare(
          `INSERT INTO canonical_revisions
           SELECT ?, project_id, revision_sequence, revision_label, lifecycle_state,
                  project_snapshot_json, luminaire_snapshot_json, snapshot_hash,
                  created_by_id, created_by_name, provenance_classification, NULL,
                  failure_reason, created_at, finalized_at, updated_at
           FROM canonical_revisions WHERE revision_id = ?`,
        )
        .run(randomUUID(), first.revisionId),
    ).toThrow(
      /UNIQUE constraint failed: canonical_revisions\.project_id, canonical_revisions\.revision_sequence/i,
    );

    const uppercaseInput = revisionInput(PROJECT_B.toUpperCase());
    uppercaseInput.luminaires = [
      luminaireSnapshot(LUMINAIRE_A.toUpperCase(), 'DL-UPPER'),
      luminaireSnapshot(LUMINAIRE_A, 'DL-DUPLICATE'),
    ];
    expectDomainError(() => store.createRevision(uppercaseInput), 'VALIDATION_ERROR');

    const normalized = store.createRevision({
      ...revisionInput(PROJECT_B.toUpperCase()),
      luminaires: [luminaireSnapshot(LUMINAIRE_A.toUpperCase(), 'DL-UPPER')],
    });
    expect(normalized.projectId).toBe(PROJECT_B);
    expect(normalized.projectSnapshot!.id).toBe(PROJECT_B);
    expect(normalized.luminaireSnapshot![0]!.luminaireId).toBe(LUMINAIRE_A);
  });

  it('preserves Luminaire UUID identity and each exact historical Tag across a rename', () => {
    const { store } = openRegistry();
    const beforeRename = store.createRevision(revisionInput(PROJECT_A, undefined, 'DL01'));
    const afterRename = store.createRevision(
      revisionInput(PROJECT_A, '001_SCT260810_CANONICAL_TEST', 'DL-A'),
    );

    expect(beforeRename.luminaireSnapshot).toHaveLength(1);
    expect(afterRename.luminaireSnapshot).toHaveLength(1);
    expect(beforeRename.luminaireSnapshot![0]).toMatchObject({
      luminaireId: LUMINAIRE_A,
      tag: 'DL01',
    });
    expect(afterRename.luminaireSnapshot![0]).toMatchObject({
      luminaireId: LUMINAIRE_A,
      tag: 'DL-A',
    });
    expect(store.getRevision(beforeRename.revisionId).luminaireSnapshot![0]!.tag).toBe('DL01');
    expect(store.getRevision(afterRename.revisionId).luminaireSnapshot![0]!.tag).toBe('DL-A');
  });

  it('stores additive Schedule, BOQ, and Presentation output rows under one Revision UUID', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revision = store.createRevision(revisionInput(PROJECT_A));

    const outputs = [
      createOutput(
        store,
        revision.revisionId,
        'LuminaireSchedule',
        'xlsx',
        '06_LUMINAIRE_SCHEDULE/REV_01/schedule.xlsx',
        'schedule.technical-modern',
      ),
      createOutput(
        store,
        revision.revisionId,
        'LuminaireSchedule',
        'pdf',
        '06_LUMINAIRE_SCHEDULE/REV_01/schedule.pdf',
        'schedule.technical-modern',
      ),
      createOutput(
        store,
        revision.revisionId,
        'TechnicalBoq',
        'xlsx',
        '07_BOQ/REV_01/technical-boq.xlsx',
        'boq.technical-modern',
      ),
      createOutput(
        store,
        revision.revisionId,
        'PresentationSchedule',
        'pdf',
        '05_PRESENTATION/REV_01/presentation-schedule.pdf',
        'schedule.presentation',
      ),
    ];

    expect(new Set(outputs.map((output) => output.outputId))).toHaveProperty('size', 4);
    expect(outputs.every((output) => output.revisionId === revision.revisionId)).toBe(true);
    expect(outputs.map((output) => [output.outputFamily, output.outputFormat])).toEqual([
      ['LuminaireSchedule', 'XLSX'],
      ['LuminaireSchedule', 'PDF'],
      ['TechnicalBoq', 'XLSX'],
      ['PresentationSchedule', 'PDF'],
    ]);
    const count = database
      .prepare('SELECT COUNT(*) AS count FROM canonical_outputs WHERE revision_id = ?')
      .get(revision.revisionId) as { count: number };
    expect(count.count).toBe(4);
  });

  it('reads the stored resolved snapshot after defaults, overrides, and Template state change', () => {
    const { store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    store.setGlobalDefault({
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.technical-modern',
      versionId: 'v1',
      config: { rowDensity: 'Compact', logoVisible: true },
    });
    store.setProjectOverride(PROJECT_A, {
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.technical-modern',
      versionId: 'v1',
      config: {
        logoVisible: false,
        sections: [{ sectionId: 'notes', label: 'Historical Notes' }],
      },
    });
    const historicalSnapshot = store.resolveEffectiveTemplate(PROJECT_A, 'LuminaireSchedule');
    const revision = store.createRevision(revisionInput(PROJECT_A));
    const output = createOutput(
      store,
      revision.revisionId,
      'LuminaireSchedule',
      'pdf',
      '06_LUMINAIRE_SCHEDULE/REV_01/historical.pdf',
      historicalSnapshot.templateId,
      historicalSnapshot,
    );

    store.setGlobalDefault({
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.compact',
      versionId: 'v1',
      config: { rowDensity: 'Comfortable', logoVisible: true },
    });
    store.setProjectOverride(PROJECT_A, {
      outputFamily: 'LuminaireSchedule',
      templateId: 'schedule.classic-grid-pro.compact',
      versionId: 'v1',
      config: { logoVisible: true },
    });
    store.setTemplateState('schedule.technical-modern', 'inactive');
    const currentSnapshot = store.resolveEffectiveTemplate(PROJECT_A, 'LuminaireSchedule');
    expect(currentSnapshot).not.toEqual(historicalSnapshot);

    const historicalRead = store.getOutput(output.outputId);
    expect(historicalRead.resolvedTemplateSnapshot).toEqual(historicalSnapshot);
    expect(historicalRead.resolvedTemplateSnapshotHash).toBe(
      canonicalRegistryHash(historicalSnapshot),
    );
    expect(historicalRead.templateId).toBe('schedule.technical-modern');
    expect(historicalRead.resolvedTemplateSnapshot!.state).toBe('active');
  });

  it('fails closed when the same Template ID and Version ID has a different definition', () => {
    const { database, store } = openRegistry();
    const original = builtIn('schedule.technical-modern');
    const first = store.registerTemplateVersion(original, 'first-registration');
    const idempotent = store.registerTemplateVersion(
      structuredClone(original),
      'idempotent-registration',
    );
    expect(idempotent.definitionHash).toBe(first.definitionHash);

    expectDomainError(
      () =>
        store.registerTemplateVersion(
          { ...structuredClone(original), displayName: 'Changed v1 definition' },
          'forbidden-registration',
        ),
      'CONFLICT',
    );
    expect(() =>
      database
        .prepare(
          `UPDATE output_template_versions SET created_by = 'tampered'
           WHERE template_id = ? AND version_id = ?`,
        )
        .run(original.templateId, original.versionId),
    ).toThrow(/Template versions are immutable/i);
    expect(() =>
      database
        .prepare('DELETE FROM output_template_versions WHERE template_id = ? AND version_id = ?')
        .run(original.templateId, original.versionId),
    ).toThrow(/Template versions are immutable/i);
  });

  it('reserves a generation Output set atomically when any requested Output is invalid', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revision = store.createRevision(revisionInput(PROJECT_A));

    expectDomainError(
      () =>
        store.createOutputs([
          {
            revisionId: revision.revisionId,
            outputFamily: 'LuminaireSchedule',
            outputFormat: 'XLSX',
            relativePath: '06_LUMINAIRE_SCHEDULE/REV_01/schedule.xlsx',
            contentHash: null,
            resolvedTemplate: builtIn('schedule.technical-modern'),
          },
          {
            revisionId: revision.revisionId,
            outputFamily: 'TechnicalBoq',
            outputFormat: 'PDF',
            relativePath: '07_TECHNICAL_BOQ/REV_01/boq.pdf',
            contentHash: null,
            resolvedTemplate: builtIn('schedule.technical-modern'),
          },
        ]),
      'VALIDATION_ERROR',
    );
    const count = database
      .prepare('SELECT COUNT(*) AS count FROM canonical_outputs WHERE revision_id = ?')
      .get(revision.revisionId) as { count: number };
    expect(count.count).toBe(0);
  });

  it('uses relocation-safe locators without treating a path collision or move as identity', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revision = store.createRevision(revisionInput(PROJECT_A));
    const sharedPath = '06_LUMINAIRE_SCHEDULE/REV_01/shared.xlsx';
    const first = createOutput(
      store,
      revision.revisionId,
      'LuminaireSchedule',
      'xlsx',
      sharedPath,
      'schedule.technical-modern',
    );
    const second = createOutput(
      store,
      revision.revisionId,
      'LuminaireSchedule',
      'xlsx',
      sharedPath,
      'schedule.technical-modern',
    );

    expect(first.outputId).not.toBe(second.outputId);
    const collisions = database
      .prepare('SELECT COUNT(*) AS count FROM canonical_outputs WHERE locator_value = ?')
      .get(sharedPath) as { count: number };
    expect(collisions.count).toBe(2);
    expect(first.locatorKind).toBe('PROJECT_RELATIVE');
    expect(first.locatorValue).not.toContain('001_SCT260810_CANONICAL_TEST');

    const moved = store.updateOutputLocator(
      first.outputId,
      '06_LUMINAIRE_SCHEDULE\\REV_01\\renamed.xlsx',
    );
    expect(moved.outputId).toBe(first.outputId);
    expect(moved.locatorValue).toBe('06_LUMINAIRE_SCHEDULE/REV_01/renamed.xlsx');
    expect(store.getOutput(second.outputId).locatorValue).toBe(sharedPath);
    expectDomainError(
      () => store.updateOutputLocator(first.outputId, 'C:\\absolute\\schedule.xlsx'),
      'VALIDATION_ERROR',
    );
    expectDomainError(
      () => store.updateOutputLocator(first.outputId, '../outside/schedule.xlsx'),
      'VALIDATION_ERROR',
    );
    for (const unsafePath of [
      'CON/report.pdf',
      '06_LUMINAIRE_SCHEDULE/report.pdf:stream',
      '06_LUMINAIRE_SCHEDULE/report.pdf.',
      '06_LUMINAIRE_SCHEDULE/report.pdf ',
      '06_LUMINAIRE_SCHEDULE/unsafe\u0000name.pdf',
    ]) {
      expectDomainError(
        () => store.updateOutputLocator(first.outputId, unsafePath),
        'VALIDATION_ERROR',
      );
    }

    database
      .prepare('UPDATE canonical_outputs SET locator_value = ? WHERE output_id = ?')
      .run('../raw-sql-bypass.pdf', first.outputId);
    expectDomainError(() => store.getOutput(first.outputId), 'CONFLICT');
  });

  it('rejects mixed-Revision package contents at the store and direct SQLite FK boundaries', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revisionOne = store.createRevision(revisionInput(PROJECT_A));
    const revisionTwo = store.createRevision(revisionInput(PROJECT_A, undefined, 'DL-A'));
    const outputOne = createOutput(
      store,
      revisionOne.revisionId,
      'LuminaireSchedule',
      'pdf',
      '06_LUMINAIRE_SCHEDULE/REV_01/schedule.pdf',
      'schedule.technical-modern',
    );
    const outputTwo = createOutput(
      store,
      revisionTwo.revisionId,
      'LuminaireSchedule',
      'pdf',
      '06_LUMINAIRE_SCHEDULE/REV_02/schedule.pdf',
      'schedule.technical-modern',
    );
    finalizeRevision(store, revisionOne.revisionId, [outputOne.outputId]);
    finalizeRevision(store, revisionTwo.revisionId, [outputTwo.outputId]);
    const atomicPackage = store.createIssuePackage({
      revisionId: revisionOne.revisionId,
      label: 'Atomic relation set',
      artifactRelativePath: 'ISSUED/REV_01/atomic.zip',
      manifestRelativePath: 'ISSUED/REV_01/atomic-manifest.json',
      issuedBy: null,
      issuedAt: null,
    });
    expectDomainError(
      () =>
        store.addOutputsToPackage(atomicPackage.packageId, [
          outputOne.outputId,
          outputTwo.outputId,
        ]),
      'VALIDATION_ERROR',
    );
    expect(store.listPackageOutputs(atomicPackage.packageId)).toEqual([]);
    const issuePackage = store.createIssuePackage({
      revisionId: revisionOne.revisionId,
      label: 'Revision 01',
      artifactRelativePath: 'ISSUED/REV_01/package.zip',
      manifestRelativePath: 'ISSUED/REV_01/manifest.json',
      issuedBy: null,
      issuedAt: null,
    });

    expect(store.addOutputToPackage(issuePackage.packageId, outputOne.outputId).revisionId).toBe(
      revisionOne.revisionId,
    );
    expectDomainError(
      () => store.addOutputToPackage(issuePackage.packageId, outputTwo.outputId),
      'VALIDATION_ERROR',
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO canonical_package_outputs
           (package_id, output_id, revision_id, position, provenance_classification, created_at)
           VALUES (?, ?, ?, 1, 'CANONICAL', '2026-08-10T09:00:00.000Z')`,
        )
        .run(issuePackage.packageId, outputTwo.outputId, revisionOne.revisionId),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    expect(() =>
      database
        .prepare(
          `INSERT INTO canonical_package_outputs
           (package_id, output_id, revision_id, position, provenance_classification, created_at)
           VALUES (?, ?, ?, 2, 'CANONICAL', '2026-08-10T09:00:01.000Z')`,
        )
        .run(issuePackage.packageId, outputTwo.outputId, revisionTwo.revisionId),
    ).toThrow(/FOREIGN KEY constraint failed/i);

    const legacyCandidatePackage = store.createIssuePackage({
      revisionId: revisionTwo.revisionId,
      label: 'Legacy provenance candidate',
      artifactRelativePath: 'ISSUED/REV_02/package.zip',
      manifestRelativePath: null,
      issuedBy: null,
      issuedAt: null,
    });
    database
      .prepare(
        `UPDATE canonical_issue_packages
         SET provenance_classification = 'LEGACY_VERIFIED', lifecycle_state = 'LEGACY_IMPORTED'
         WHERE package_id = ?`,
      )
      .run(legacyCandidatePackage.packageId);
    database
      .prepare(
        `UPDATE canonical_outputs
         SET provenance_classification = 'LEGACY_VERIFIED', lifecycle_state = 'LEGACY_IMPORTED'
         WHERE output_id = ?`,
      )
      .run(outputTwo.outputId);
    expectDomainError(
      () => store.addOutputToPackage(legacyCandidatePackage.packageId, outputTwo.outputId),
      'VALIDATION_ERROR',
    );
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('requires only a Revision UUID from Output and Package APIs and allocates no second Revision', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revision = store.createRevision(revisionInput(PROJECT_A));
    const output = createOutput(
      store,
      revision.revisionId,
      'LuminaireSchedule',
      'pdf',
      '06_LUMINAIRE_SCHEDULE/REV_01/schedule.pdf',
      'schedule.technical-modern',
    );
    finalizeRevision(store, revision.revisionId, [output.outputId]);
    const firstPackage = store.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'First issue',
      artifactRelativePath: 'ISSUED/REV_01/package-01.zip',
      manifestRelativePath: null,
      issuedBy: null,
      issuedAt: null,
    });
    const secondPackage = store.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'Reissue',
      artifactRelativePath: 'ISSUED/REV_01/package-02.zip',
      manifestRelativePath: null,
      issuedBy: null,
      issuedAt: null,
    });

    expect(output.revisionId).toBe(revision.revisionId);
    expect(firstPackage.revisionId).toBe(revision.revisionId);
    expect(secondPackage.revisionId).toBe(revision.revisionId);
    expect([firstPackage.packageSequence, secondPackage.packageSequence]).toEqual([1, 2]);
    expect('revisionNumber' in output).toBe(false);
    expect('revisionNumber' in firstPackage).toBe(false);
    expect(columnNames(database, 'canonical_outputs')).not.toContain('revision_number');
    expect(columnNames(database, 'canonical_outputs')).not.toContain('revision_sequence');
    expect(columnNames(database, 'canonical_issue_packages')).not.toContain('revision_number');
    expect(columnNames(database, 'canonical_issue_packages')).not.toContain('revision_sequence');
    const revisionCount = database
      .prepare('SELECT COUNT(*) AS count FROM canonical_revisions WHERE project_id = ?')
      .get(PROJECT_A) as { count: number };
    expect(revisionCount.count).toBe(1);
    expect(store.getRevision(revision.revisionId).revisionSequence).toBe(1);
  });

  it('persists preparing, finalized, and recoverable-failure lifecycle fields', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    const revision = store.createRevision(revisionInput(PROJECT_A));
    const output = createOutput(
      store,
      revision.revisionId,
      'LuminaireSchedule',
      'pdf',
      '06_LUMINAIRE_SCHEDULE/REV_01/schedule.pdf',
      'schedule.technical-modern',
    );
    expect(revision).toMatchObject({
      lifecycleState: 'PREPARING',
      failureReason: null,
      finalizedAt: null,
    });
    expect(output).toMatchObject({
      lifecycleState: 'PREPARING',
      failureReason: null,
      finalizedAt: null,
    });
    expectDomainError(
      () => store.setOutputLifecycle(output.outputId, 'FAILED_RECOVERABLE'),
      'VALIDATION_ERROR',
    );
    const failedOutput = store.setOutputLifecycle(
      output.outputId,
      'FAILED_RECOVERABLE',
      'Temporary filesystem finalization failure.',
    );
    store.setOutputLifecycle(output.outputId, 'PREPARING');
    store.setOutputContentHash(output.outputId, 'a'.repeat(64));
    store.setOutputLifecycle(output.outputId, 'FINALIZED');
    const finalizedRevision = store.setRevisionLifecycle(revision.revisionId, 'FINALIZED');
    const issuePackage = store.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'Revision 01',
      artifactRelativePath: 'ISSUED/REV_01/package.zip',
      manifestRelativePath: null,
      issuedBy: null,
      issuedAt: null,
    });
    store.addOutputToPackage(issuePackage.packageId, output.outputId);
    expect(issuePackage).toMatchObject({
      lifecycleState: 'PREPARING',
      failureReason: null,
      finalizedAt: null,
    });
    const finalizedPackage = store.setPackageLifecycle(issuePackage.packageId, 'FINALIZED');

    expect(failedOutput).toMatchObject({
      lifecycleState: 'FAILED_RECOVERABLE',
      failureReason: 'Temporary filesystem finalization failure.',
      finalizedAt: null,
    });
    expect(finalizedRevision.lifecycleState).toBe('FINALIZED');
    expect(finalizedRevision.finalizedAt).toMatch(/^2026-08-10T/);
    expect(finalizedPackage.lifecycleState).toBe('FINALIZED');
    expect(finalizedPackage.finalizedAt).toMatch(/^2026-08-10T/);
    for (const table of ['canonical_revisions', 'canonical_outputs', 'canonical_issue_packages']) {
      expect(columnNames(database, table)).toEqual(
        expect.arrayContaining([
          'lifecycle_state',
          'failure_reason',
          'created_at',
          'finalized_at',
          'updated_at',
        ]),
      );
    }
  });

  it('rejects nested BOQ pricing keys before a global or project selection is persisted', () => {
    const { database, store } = openRegistry();
    store.registerBuiltInTemplateVersions();
    expectDomainError(
      () =>
        store.setGlobalDefault({
          outputFamily: 'TechnicalBoq',
          templateId: 'schedule.technical-modern',
          versionId: 'v1',
          config: {},
        }),
      'VALIDATION_ERROR',
    );
    expectDomainError(
      () =>
        store.setGlobalDefault({
          outputFamily: 'TechnicalBoq',
          templateId: 'boq.technical-modern',
          versionId: 'v1',
          config: {
            sections: [
              {
                sectionId: 'notes',
                config: { layout: { rows: [{ 'Unit Price': 125 }] } },
              },
            ],
          },
        }),
      'VALIDATION_ERROR',
    );
    const globalCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM global_output_template_defaults WHERE output_family = 'TechnicalBoq'",
      )
      .get() as { count: number };
    expect(globalCount.count).toBe(0);

    store.setGlobalDefault({
      outputFamily: 'TechnicalBoq',
      templateId: 'boq.technical-modern',
      versionId: 'v1',
      config: { rowDensity: 'Compact' },
    });
    expectDomainError(
      () =>
        store.setProjectOverride(PROJECT_A, {
          outputFamily: 'TechnicalBoq',
          templateId: 'boq.technical-modern',
          versionId: 'v1',
          config: {
            sections: [
              {
                sectionId: 'notes',
                config: { nested: [{ totals: { total_amount: 900 } }] },
              },
            ],
          },
        }),
      'VALIDATION_ERROR',
    );
    const projectCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM project_output_template_overrides WHERE project_id = ? AND output_family = 'TechnicalBoq'",
      )
      .get(PROJECT_A) as { count: number };
    expect(projectCount.count).toBe(0);
    expect(store.getGlobalDefault('TechnicalBoq')).toMatchObject({
      templateId: 'boq.technical-modern',
      versionId: 'v1',
    });

    store.setProjectOverride(PROJECT_A.toUpperCase(), {
      outputFamily: 'TechnicalBoq',
      templateId: 'boq.technical-modern',
      versionId: 'v1',
      config: { rowDensity: 'Comfortable' },
    });
    expect(store.getProjectOverride(PROJECT_A, 'TechnicalBoq')).toMatchObject({
      projectId: PROJECT_A,
      templateId: 'boq.technical-modern',
    });
    const normalizedProjectCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM project_output_template_overrides WHERE lower(project_id) = lower(?) AND output_family = 'TechnicalBoq'",
      )
      .get(PROJECT_A) as { count: number };
    expect(normalizedProjectCount.count).toBe(1);
  });
});
