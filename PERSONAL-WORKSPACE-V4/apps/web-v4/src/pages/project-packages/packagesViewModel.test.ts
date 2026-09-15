import { describe, expect, it } from 'vitest';
import type {
  CanonicalOutputPresenceRecord,
  IssueHistoryRecord,
  PackageRevisionSummary,
  ProjectWorkspace,
  RevisionPackageCatalog,
} from '@scli/domain';
import {
  buildCatalogOutputRows,
  deriveReadiness,
  eligiblePackageRevisions,
  historyForRevision,
  packagesForRevision,
  statusOutputFolder,
} from './packagesViewModel';

const REVISION = {
  revisionId: '00000000-0000-4000-8000-000000000010',
  revisionSequence: 3,
  revisionLabel: 'Rev 03',
  purpose: null,
  lifecycleState: 'FINALIZED',
  finalizedAt: '2026-08-18T10:01:00.000Z',
  luminaireCount: 0,
} satisfies PackageRevisionSummary;

const OUTPUT = {
  outputId: '00000000-0000-4000-8000-000000000020',
  projectId: '00000000-0000-4000-8000-000000000001',
  revisionId: REVISION.revisionId,
  outputFamily: 'LuminaireSchedule',
  outputFormat: 'PDF',
  locatorKind: 'PROJECT_RELATIVE',
  locatorValue: 'OUT/schedule.pdf',
  legacyAbsolutePath: null,
  contentHash: 'b'.repeat(64),
  templateId: null,
  templateVersionId: null,
  resolvedTemplateSnapshot: null,
  resolvedTemplateSnapshotHash: null,
  lifecycleState: 'FINALIZED',
  provenanceClassification: 'CANONICAL',
  legacySourceId: null,
  legacySourceField: null,
  templateProvenance: 'RESOLVED',
  failureReason: null,
  createdAt: '2026-08-18T10:00:00.000Z',
  finalizedAt: '2026-08-18T10:01:00.000Z',
  updatedAt: '2026-08-18T10:01:00.000Z',
  artifactPresence: 'Present',
  artifactOpenPath: '/api/projects/p/outputs/o/open',
} satisfies CanonicalOutputPresenceRecord;

const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000070';
const SNAPSHOT_TITLE = 'Lighting Layout DWG';

const MIXED_CATALOG = {
  revisionId: REVISION.revisionId,
  suggestedRevision: 3,
  suggestedOutputFolder: 'ISSUED/REV_03',
  checks: [],
  items: [
    {
      id: OUTPUT.outputId,
      group: 'SchedulePdf' as const,
      label: 'Luminaire Schedule PDF',
      fileName: 'schedule.pdf',
      filePath: 'private absolute path',
      available: true,
      outdated: false,
      sizeBytes: 42,
      modifiedAt: '2026-08-18T10:01:00.000Z',
      note: '',
    },
    {
      id: SNAPSHOT_ID,
      group: 'Documents' as const,
      label: SNAPSHOT_TITLE,
      fileName: 'layout.dwg',
      filePath: 'DELIVERABLES/REV_03/Documents/layout.dwg',
      available: true,
      outdated: false,
      sizeBytes: 2048,
      modifiedAt: '2026-08-18T10:02:00.000Z',
      note: '',
    },
  ],
} satisfies RevisionPackageCatalog;

const CATALOG = {
  revisionId: REVISION.revisionId,
  suggestedRevision: 3,
  suggestedOutputFolder: 'ISSUED/REV_03',
  checks: [
    {
      key: 'requirements',
      label: 'Requirements',
      detail: 'One missing',
      severity: 'Blocking',
      passed: false,
    },
    { key: 'actions', label: 'Actions', detail: 'One open', severity: 'Warning', passed: false },
    { key: 'outputs', label: 'Outputs', detail: 'Output context', severity: 'Info', passed: false },
  ],
  items: [
    {
      id: OUTPUT.outputId,
      group: 'SchedulePdf',
      label: 'Luminaire Schedule PDF',
      fileName: 'schedule.pdf',
      filePath: 'private absolute path',
      available: true,
      outdated: true,
      sizeBytes: 42,
      modifiedAt: '2026-08-18T10:01:00.000Z',
      note: '',
    },
    {
      id: 'missing:ScheduleExcel',
      group: 'ScheduleExcel',
      label: 'ScheduleExcel',
      fileName: '',
      filePath: '',
      available: false,
      outdated: false,
      sizeBytes: 0,
      modifiedAt: null,
      note: 'Missing',
    },
    {
      id: 'missing:Datasheets',
      group: 'Datasheets',
      label: 'Datasheets',
      fileName: '',
      filePath: '',
      available: false,
      outdated: false,
      sizeBytes: 0,
      modifiedAt: null,
      note: 'Legacy-only group',
    },
  ],
} satisfies RevisionPackageCatalog;

describe('packagesViewModel', () => {
  it('shows every FINALIZED Revision without duplicating catalog Deliverable eligibility', () => {
    const preparing = {
      ...REVISION,
      revisionId: 'preparing',
      lifecycleState: 'PREPARING',
    } as PackageRevisionSummary;
    const snapshotOnly = {
      ...REVISION,
      revisionId: '00000000-0000-4000-8000-000000000019',
      revisionSequence: 19,
      revisionLabel: 'REV_19',
      purpose: 'Courtyard lighting coordination',
    } satisfies PackageRevisionSummary;

    expect(eligiblePackageRevisions([preparing, REVISION, snapshotOnly])).toEqual([
      snapshotOnly,
      REVISION,
    ]);
  });

  it('keeps NULL Purpose valid for a FINALIZED Package Revision summary', () => {
    expect(eligiblePackageRevisions([REVISION])).toEqual([REVISION]);
  });

  it('keeps Present selectable, Missing non-selectable, and recognizes the P4D Datasheet Register group', () => {
    const rows = buildCatalogOutputRows(CATALOG, [OUTPUT]);
    expect(rows.map((row) => row.group)).toEqual(['SchedulePdf', 'ScheduleExcel', 'Datasheets']);
    expect(rows[0]).toMatchObject({ artifactState: 'Present', available: true });
    expect(rows[1]).toMatchObject({ artifactState: 'Not generated', available: false });
    expect(rows[2]).toMatchObject({ artifactState: 'Not generated', available: false });
  });

  it('exposes DocumentSnapshot rows as selectable Eligible Deliverables with canonical item identity', () => {
    const rows = buildCatalogOutputRows(MIXED_CATALOG, [OUTPUT]);
    const snapshotRow = rows.find((row) => row.group === 'Documents');
    expect(snapshotRow).toBeDefined();
    expect(snapshotRow).toMatchObject({
      id: SNAPSHOT_ID,
      label: SNAPSHOT_TITLE,
      group: 'Documents',
      artifactState: 'Present',
      available: true,
    });
    // GeneratedOutput row must remain present with its canonical output id.
    expect(rows.map((row) => row.id)).toContain(OUTPUT.outputId);
  });

  it('renders DocumentSnapshot without inventing outputFamily or outputFormat', () => {
    const rows = buildCatalogOutputRows(MIXED_CATALOG, []);
    const snapshotRow = rows.find((row) => row.group === 'Documents');
    expect(snapshotRow).toMatchObject({ family: 'Documents', format: '—' });
  });

  it('keeps a Missing DocumentSnapshot non-packageable', () => {
    const catalog = {
      ...MIXED_CATALOG,
      items: MIXED_CATALOG.items.map((item) =>
        item.group === 'Documents' ? { ...item, available: false, note: 'Artifact missing' } : item,
      ),
    };
    const rows = buildCatalogOutputRows(catalog, []);
    const snapshotRow = rows.find((row) => row.group === 'Documents');
    expect(snapshotRow).toMatchObject({ artifactState: 'Missing', available: false });
  });

  it('fails closed for unknown unsupported catalog groups', () => {
    const catalog = {
      ...MIXED_CATALOG,
      items: [
        ...MIXED_CATALOG.items,
        {
          id: 'future-id',
          group: 'SomeFutureGroup',
          label: 'Future',
          fileName: '',
          filePath: '',
          available: true,
          outdated: false,
          sizeBytes: 0,
          modifiedAt: null,
          note: '',
        },
      ],
    } as unknown as RevisionPackageCatalog;
    const rows = buildCatalogOutputRows(catalog, []);
    expect(rows.some((row) => row.id === 'future-id')).toBe(false);
    expect(rows.map((row) => row.group)).not.toContain('SomeFutureGroup');
  });

  it('counts a selected DocumentSnapshot toward selected deliverable readiness', () => {
    const rows = buildCatalogOutputRows(MIXED_CATALOG, []);
    const snapshotRow = rows.find((row) => row.group === 'Documents');
    // The DocumentSnapshot must actually be present and selectable, not silently
    // dropped; otherwise this test would pass for the wrong reason.
    expect(snapshotRow).toBeDefined();
    const readiness = deriveReadiness({
      catalog: MIXED_CATALOG,
      workspace: { folderPath: 'C:/project' } as ProjectWorkspace,
      selectedRevision: REVISION,
      catalogOwnsSelectedRevision: true,
      outputRows: [snapshotRow!],
      selectedRows: [snapshotRow!],
      relativeOutputFolder: 'ISSUED/REV_03',
    });
    expect(readiness.hardGuards).toEqual([]);
    expect(readiness.state).toBe('Ready');
  });

  it('separates hard guards, Blocking, Warning, Info, and outdated advisory truth', () => {
    const rows = buildCatalogOutputRows(CATALOG, [OUTPUT]);
    const readiness = deriveReadiness({
      catalog: CATALOG,
      workspace: { folderPath: 'C:/project' } as ProjectWorkspace,
      selectedRevision: REVISION,
      catalogOwnsSelectedRevision: true,
      outputRows: [rows[0]!],
      selectedRows: [rows[0]!],
      relativeOutputFolder: 'ISSUED/REV_03',
    });
    expect(readiness.blocking).toHaveLength(1);
    expect(readiness.warnings).toHaveLength(1);
    expect(readiness.info).toHaveLength(1);
    expect(readiness.outdatedOutputCount).toBe(1);
    expect(readiness.state).toBe('Blocked');
  });

  it('fails closed when the selected Revision is outside current catalog authority', () => {
    const readiness = deriveReadiness({
      catalog: { ...CATALOG, checks: [] },
      workspace: { folderPath: 'C:/project' } as ProjectWorkspace,
      selectedRevision: REVISION,
      catalogOwnsSelectedRevision: false,
      outputRows: [],
      selectedRows: [],
      relativeOutputFolder: '',
    });
    expect(readiness.hardGuards).toEqual(
      expect.arrayContaining([
        'The package catalog is not available for this Revision.',
        'Select at least one available Deliverable.',
        'Provide a project-relative output folder.',
      ]),
    );
  });

  it('limits contextual packages to the selected Revision sequence', () => {
    const matching = { id: 'match', revisionNumber: 3, createdAt: '2026-08-18T10:00:00Z' };
    const other = { id: 'other', revisionNumber: 2, createdAt: '2026-08-18T11:00:00Z' };
    const workspace = { revisionPackages: [other, matching] } as unknown as ProjectWorkspace;
    expect(packagesForRevision(workspace, REVISION).map((record) => record.id)).toEqual(['match']);
  });

  it('filters canonical issue history by the exact canonical Revision UUID, not sequence', () => {
    const sameRevision: IssueHistoryRecord = {
      package: {
        packageId: 'a',
        packageSequence: 1,
        label: 'A',
        lifecycleState: 'FINALIZED',
        businessStatus: 'Issued',
        createdAt: '2026-08-18T10:00:00.000Z',
        finalizedAt: '2026-08-18T10:01:00.000Z',
        issuedAt: '2026-08-18T10:01:00.000Z',
        issuedBy: null,
      },
      revision: {
        revisionId: REVISION.revisionId,
        revisionSequence: 3,
        revisionLabel: 'Rev 03',
        purpose: null,
      },
      deliverables: [],
    };
    const otherRevision: IssueHistoryRecord = {
      ...sameRevision,
      package: { ...sameRevision.package, packageId: 'b' },
      revision: {
        revisionId: 'other-rev',
        revisionSequence: 3,
        revisionLabel: 'Rev 03',
        purpose: null,
      },
    };
    expect(
      historyForRevision([sameRevision, otherRevision], REVISION.revisionId).map(
        (record) => record.package.packageId,
      ),
    ).toEqual(['a']);
  });

  it('returns an empty history projection when no canonical Revision is selected', () => {
    expect(historyForRevision([], null)).toEqual([]);
    const record: IssueHistoryRecord = {
      package: {
        packageId: 'a',
        packageSequence: 1,
        label: 'A',
        lifecycleState: 'FINALIZED',
        businessStatus: 'Issued',
        createdAt: '2026-08-18T10:00:00.000Z',
        finalizedAt: '2026-08-18T10:01:00.000Z',
        issuedAt: '2026-08-18T10:01:00.000Z',
        issuedBy: null,
      },
      revision: { revisionId: 'x', revisionSequence: 1, revisionLabel: 'Rev 01', purpose: null },
      deliverables: [],
    };
    expect(historyForRevision([record], null)).toEqual([]);
  });

  it('PACKAGES-E2E-04B: Draft defaults to a DRAFT root, never ISSUED', () => {
    expect(
      statusOutputFolder({
        status: 'Draft',
        suggestedOutputFolder: 'ISSUED/REV_03',
        revisionSequence: 3,
      }),
    ).toBe('DRAFT/REV_03');
    expect(
      statusOutputFolder({
        status: 'Draft',
        suggestedOutputFolder: 'ISSUED/REV_07',
        revisionSequence: 7,
      }),
    ).toBe('DRAFT/REV_07');
  });

  it('PACKAGES-E2E-04B: Issued maps to an ISSUED root, never DRAFT', () => {
    expect(
      statusOutputFolder({
        status: 'Issued',
        suggestedOutputFolder: 'DRAFT/REV_03',
        revisionSequence: 3,
      }),
    ).toBe('ISSUED/REV_03');
  });

  it('PACKAGES-E2E-04B: preserves the REISSUE suffix under the status root', () => {
    expect(
      statusOutputFolder({
        status: 'Issued',
        suggestedOutputFolder: 'ISSUED/REV_03_REISSUE_2',
        revisionSequence: 3,
      }),
    ).toBe('ISSUED/REV_03_REISSUE_2');
  });

  it('PACKAGES-E2E-04B: falls back to canonical sequence when suggestion has no revision segment', () => {
    expect(
      statusOutputFolder({
        status: 'Issued',
        suggestedOutputFolder: 'ISSUED/',
        revisionSequence: 5,
      }),
    ).toBe('ISSUED/REV_05');
  });

  it('PACKAGES-E2E-05B: Datasheet row is labeled truthfully as Datasheet with structured metadata', () => {
    const catalog = {
      ...MIXED_CATALOG,
      items: [
        ...MIXED_CATALOG.items,
        {
          id: 'datasheet-id',
          group: 'Documents' as const,
          label: 'DL01 Datasheet',
          fileName: 'datasheet.pdf',
          filePath: 'DELIVERABLES/REV_03/datasheet.pdf',
          available: true,
          outdated: false,
          sizeBytes: 1024,
          modifiedAt: '2026-08-18T10:03:00.000Z',
          note: '',
          datasheet: { tag: 'DL01', manufacturer: 'ERCO', model: '12345' },
        },
      ],
    };
    const rows = buildCatalogOutputRows(catalog, []);
    const datasheetRow = rows.find((row) => row.id === 'datasheet-id');
    expect(datasheetRow).toMatchObject({
      family: 'Datasheet',
      format: '.pdf',
      available: true,
      datasheet: { tag: 'DL01', manufacturer: 'ERCO', model: '12345' },
    });
  });

  it('PACKAGES-E2E-05B: a non-Datasheet DocumentSnapshot stays labeled Documents', () => {
    const rows = buildCatalogOutputRows(MIXED_CATALOG, []);
    const snapshotRow = rows.find((row) => row.group === 'Documents');
    expect(snapshotRow).toMatchObject({ family: 'Documents', format: '—' });
    expect(snapshotRow?.datasheet).toBeUndefined();
  });

  it('PACKAGES-E2E-05B: a deselected available Datasheet produces a Warning, not a blocker', () => {
    const catalog = {
      ...MIXED_CATALOG,
      checks: [],
      items: [
        ...MIXED_CATALOG.items,
        {
          id: 'datasheet-id',
          group: 'Documents' as const,
          label: 'DL01 Datasheet',
          fileName: 'datasheet.pdf',
          filePath: 'DELIVERABLES/REV_03/datasheet.pdf',
          available: true,
          outdated: false,
          sizeBytes: 1024,
          modifiedAt: '2026-08-18T10:03:00.000Z',
          note: '',
          datasheet: { tag: 'DL01', manufacturer: 'ERCO', model: '12345' },
        },
      ],
    };
    const rows = buildCatalogOutputRows(catalog, []);
    // Owner deliberately deselects the available Datasheet.
    const readiness = deriveReadiness({
      catalog,
      workspace: { folderPath: 'C:/project' } as ProjectWorkspace,
      selectedRevision: REVISION,
      catalogOwnsSelectedRevision: true,
      outputRows: rows,
      selectedRows: rows.filter((row) => row.id !== 'datasheet-id'),
      relativeOutputFolder: 'ISSUED/REV_03',
    });
    expect(readiness.deselectedDatasheetCount).toBe(1);
    expect(readiness.hardGuards).toEqual([]);
    expect(readiness.state).toBe('Warnings');
  });

  it('PACKAGES-E2E-05B: selecting the available Datasheet clears the deselected warning', () => {
    const catalog = {
      ...MIXED_CATALOG,
      checks: [],
      items: [
        ...MIXED_CATALOG.items,
        {
          id: 'datasheet-id',
          group: 'Documents' as const,
          label: 'DL01 Datasheet',
          fileName: 'datasheet.pdf',
          filePath: 'DELIVERABLES/REV_03/datasheet.pdf',
          available: true,
          outdated: false,
          sizeBytes: 1024,
          modifiedAt: '2026-08-18T10:03:00.000Z',
          note: '',
          datasheet: { tag: 'DL01', manufacturer: 'ERCO', model: '12345' },
        },
      ],
    };
    const rows = buildCatalogOutputRows(catalog, []);
    const readiness = deriveReadiness({
      catalog,
      workspace: { folderPath: 'C:/project' } as ProjectWorkspace,
      selectedRevision: REVISION,
      catalogOwnsSelectedRevision: true,
      outputRows: rows,
      selectedRows: rows,
      relativeOutputFolder: 'ISSUED/REV_03',
    });
    expect(readiness.deselectedDatasheetCount).toBe(0);
    expect(readiness.state).toBe('Ready');
  });
});
