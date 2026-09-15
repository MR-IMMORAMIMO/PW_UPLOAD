/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ApiError } from '@scli/api-client';
import type {
  CanonicalOutputPresenceRecord,
  IssueHistoryRecord,
  PackageRevisionSummary,
  PackageVerificationResult,
  Project,
  ProjectWorkspace,
  RevisionPackageCatalog,
  RevisionPackageRecord,
} from '@scli/domain';
import { api } from '../../api/environment';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { ProjectPackagesWorkspace as ProjectPackagesPage } from './ProjectPackagesWorkspace';
import { ProjectPackagesPage as FinalPackagesPage } from './ProjectPackagesPage';

vi.mock('../../api/environment', () => ({
  api: {
    project: vi.fn(),
    projectWorkspace: vi.fn(),
    packageRevisions: vi.fn(),
    projectOutputs: vi.fn(),
    revisionPackageCatalog: vi.fn(),
    createRevisionPackage: vi.fn(),
    issueHistory: vi.fn(),
    verifyIssuePackage: vi.fn(),
    activeWorkSession: vi.fn(),
  },
}));

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const REVISION_ID = '00000000-0000-4000-8000-000000000010';
const OUTPUT_ID = '00000000-0000-4000-8000-000000000020';
const PACKAGE_ID = '00000000-0000-4000-8000-000000000030';
const RECOVERY_ID = '00000000-0000-4000-8000-000000000040';
const SNAPSHOT_ONLY_REVISION_ID = '00000000-0000-4000-8000-000000000019';

const project = {
  id: PROJECT_ID,
  projectCode: 'P-001',
  projectName: 'Packages Test',
  clientName: 'SCLI',
  projectType: 'Lighting',
  designStage: 'Detailed Design',
  requiredDeliveryDate: null,
  status: 'InProgress',
} as unknown as Project;

const revision = {
  revisionId: REVISION_ID,
  revisionSequence: 3,
  revisionLabel: 'Rev 03',
  purpose: 'Tender issue',
  lifecycleState: 'FINALIZED',
  finalizedAt: '2026-08-18T10:01:00.000Z',
  luminaireCount: 0,
} satisfies PackageRevisionSummary;

const output = {
  outputId: OUTPUT_ID,
  projectId: PROJECT_ID,
  revisionId: REVISION_ID,
  outputFamily: 'LuminaireSchedule',
  outputFormat: 'PDF',
  locatorKind: 'PROJECT_RELATIVE',
  locatorValue: 'OUTPUTS/schedule.pdf',
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

const missingOutput = {
  ...output,
  outputId: '00000000-0000-4000-8000-000000000021',
  outputFormat: 'XLSX',
  locatorValue: 'OUTPUTS/schedule.xlsx',
  artifactPresence: 'Missing',
  artifactOpenPath: null,
} satisfies CanonicalOutputPresenceRecord;

const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000070';
const SNAPSHOT_TITLE = 'Lighting Layout DWG';
const REPORT_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000071';
const REPORT_SNAPSHOT_TITLE = 'DIALux Lux Report';
const DATASHEET_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000072';

const catalog = {
  revisionId: REVISION_ID,
  suggestedRevision: 3,
  suggestedOutputFolder: 'ISSUED/REV_03',
  checks: [],
  items: [
    {
      id: OUTPUT_ID,
      group: 'SchedulePdf',
      label: 'Luminaire Schedule PDF',
      fileName: 'schedule.pdf',
      filePath: 'C:/private/project/schedule.pdf',
      available: true,
      outdated: false,
      sizeBytes: 120,
      modifiedAt: '2026-08-18T10:01:00.000Z',
      note: '',
    },
    {
      id: missingOutput.outputId,
      group: 'ScheduleExcel',
      label: 'Luminaire Schedule Excel',
      fileName: 'schedule.xlsx',
      filePath: 'C:/private/project/schedule.xlsx',
      available: false,
      outdated: false,
      sizeBytes: 0,
      modifiedAt: null,
      note: 'Artifact missing',
    },
    {
      id: SNAPSHOT_ID,
      group: 'Documents',
      label: SNAPSHOT_TITLE,
      fileName: 'layout.dwg',
      filePath: 'DELIVERABLES/REV_03/Documents/layout.dwg',
      available: true,
      outdated: false,
      sizeBytes: 2048,
      modifiedAt: '2026-08-18T10:02:00.000Z',
      note: '',
    },
    {
      id: REPORT_SNAPSHOT_ID,
      group: 'Documents',
      label: REPORT_SNAPSHOT_TITLE,
      fileName: 'lux-report.pdf',
      filePath: 'DELIVERABLES/REV_03/Documents/lux-report.pdf',
      available: true,
      outdated: false,
      sizeBytes: 4096,
      modifiedAt: '2026-08-18T10:03:00.000Z',
      note: '',
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

const issueHistoryRecord: IssueHistoryRecord = {
  package: {
    packageId: PACKAGE_ID,
    packageSequence: 1,
    label: 'Issue Package 03',
    lifecycleState: 'FINALIZED',
    businessStatus: 'Issued',
    createdAt: '2026-08-19T05:00:00.000Z',
    finalizedAt: '2026-08-19T05:00:00.000Z',
    issuedAt: '2026-08-19T05:00:00.000Z',
    issuedBy: { actorId: 'actor-1', actorNameSnapshot: 'Ahmed Dev' },
  },
  revision: {
    revisionId: REVISION_ID,
    revisionSequence: 3,
    revisionLabel: 'Rev 03',
    purpose: 'Tender issue',
  },
  deliverables: [
    {
      sourceType: 'GeneratedOutput',
      outputId: OUTPUT_ID,
      contentHash: 'b'.repeat(64),
      templateId: 'template-1',
      templateVersionId: 'version-1',
      resolvedTemplateSnapshotHash: 'e'.repeat(64),
    },
  ],
};

const draftHistoryRecord: IssueHistoryRecord = {
  ...issueHistoryRecord,
  package: {
    ...issueHistoryRecord.package,
    packageSequence: 2,
    label: 'Draft Package 03',
    lifecycleState: 'FINALIZED',
    businessStatus: 'Draft',
    issuedAt: null,
    issuedBy: null,
  },
};

const createPackageResponse: RevisionPackageRecord = {
  id: PACKAGE_ID,
  projectId: PROJECT_ID,
  revisionNumber: 3,
  reissueNumber: 0,
  label: 'Issue Package 03',
  status: 'Issued',
  outputMode: 'Folder',
  folderPath: 'C:/private/ISSUED/REV_03',
  zipPath: '',
  itemCount: 1,
  totalBytes: 120,
  packageHash: 'c'.repeat(64),
  warningOverrideReason: '',
  manifest: [],
  luminaireSnapshot: [],
  issuedById: 'actor-1',
  issuedByName: 'Ahmed Dev',
  issuedAt: '2026-08-19T05:00:00.000Z',
  createdAt: '2026-08-19T05:00:00.000Z',
} satisfies RevisionPackageRecord;

function workspace(): ProjectWorkspace {
  return {
    projectId: PROJECT_ID,
    folderPath: 'C:/private/project',
    revisionPackages: [],
  } as unknown as ProjectWorkspace;
}

function mockReadAuthority(options?: {
  historyRecords?: IssueHistoryRecord[];
  packageCatalog?: RevisionPackageCatalog;
  revisions?: PackageRevisionSummary[];
  outputs?: CanonicalOutputPresenceRecord[];
}) {
  vi.mocked(api.project).mockResolvedValue(project);
  vi.mocked(api.projectWorkspace).mockResolvedValue(workspace());
  vi.mocked(api.packageRevisions).mockResolvedValue(options?.revisions ?? [revision]);
  vi.mocked(api.projectOutputs).mockResolvedValue(options?.outputs ?? [output, missingOutput]);
  vi.mocked(api.revisionPackageCatalog).mockResolvedValue(options?.packageCatalog ?? catalog);
  vi.mocked(api.issueHistory).mockResolvedValue({
    items: options?.historyRecords ?? [],
  });
}

function renderPage(final = false) {
  renderV4(
    <Routes>
      <Route
        path="/projects/:projectId/packages"
        element={final ? <FinalPackagesPage /> : <ProjectPackagesPage />}
      />
    </Routes>,
    [`/projects/${PROJECT_ID}/packages`],
  );
}

describe('ProjectPackagesPage', () => {
  beforeEach(() => {
    stubMatchMedia();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.clearAllMocks();
  });

  afterEach(() => cleanupV4());

  it('binds the final package cards to canonical contents and opens the existing builder', async () => {
    mockReadAuthority();
    renderPage(true);
    expect(await screen.findByText('1. Select Finalized Revision')).toBeInTheDocument();
    expect(screen.queryByText('Financial Modules Redesign')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change Revision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Package Builder' });
    expect(within(dialog).getByRole('combobox', { name: 'Finalized Revision' })).toHaveValue(
      REVISION_ID,
    );
    expect(
      within(dialog).getByRole('checkbox', { name: 'Include Luminaire Schedule PDF' }),
    ).toBeChecked();
    expect(api.createRevisionPackage).not.toHaveBeenCalled();
  });

  it('opens readiness reasons without entering the package builder', async () => {
    mockReadAuthority();
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: 'View Details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Package Readiness' });
    expect(within(dialog).getByText(/Blocking/)).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Package Builder' })).not.toBeInTheDocument();
    expect(api.createRevisionPackage).not.toHaveBeenCalled();
  });

  it('renders loading and controlled read-failure states', async () => {
    vi.mocked(api.project).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.projectWorkspace).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.packageRevisions).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.projectOutputs).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.revisionPackageCatalog).mockRejectedValue(new Error('read failed'));
    vi.mocked(api.issueHistory).mockRejectedValue(new Error('read failed'));
    renderPage();
    expect(screen.getByLabelText('Loading Packages')).toBeInTheDocument();
    expect(await screen.findByText(/Package authority could not be loaded/)).toBeInTheDocument();
  });

  it('keeps generated-output FINALIZED Revisions visible and excludes PREPARING Revisions', async () => {
    const preparing = {
      ...revision,
      revisionId: 'preparing',
      revisionLabel: 'Draft 04',
      lifecycleState: 'PREPARING',
    } as PackageRevisionSummary;
    mockReadAuthority({ revisions: [preparing, revision] });
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Eligible Deliverables' }),
    ).toBeInTheDocument();
    const revisionSelect = screen.getByRole('combobox', { name: 'Finalized Revision' });
    expect(revisionSelect).toHaveDisplayValue('Rev 03');
    expect(screen.queryByText('Draft 04')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include Luminaire Schedule PDF' })).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: 'Include Luminaire Schedule Excel' }),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId('v4-project-packages')).queryByText('Datasheets'),
    ).not.toBeInTheDocument();
  });

  it('selects a snapshot-only FINALIZED Revision by UUID and exposes its catalog Deliverable', async () => {
    const snapshotOnlyRevision = {
      ...revision,
      revisionId: SNAPSHOT_ONLY_REVISION_ID,
      revisionSequence: 19,
      revisionLabel: 'REV_19',
      purpose: 'Client comments — courtyard lighting coordination',
    } satisfies PackageRevisionSummary;
    const snapshotOnlyCatalog = {
      ...catalog,
      revisionId: SNAPSHOT_ONLY_REVISION_ID,
      suggestedRevision: 19,
      suggestedOutputFolder: 'ISSUED/REV_19',
      items: catalog.items.filter((item) => item.id === SNAPSHOT_ID),
    } satisfies RevisionPackageCatalog;

    mockReadAuthority({
      revisions: [revision, snapshotOnlyRevision],
      outputs: [],
      packageCatalog: snapshotOnlyCatalog,
    });
    renderPage();

    await screen.findByRole('heading', { name: 'Eligible Deliverables' });
    const revisionSelect = screen.getByRole('combobox', { name: 'Finalized Revision' });
    await waitFor(() => expect(revisionSelect).toHaveValue(SNAPSHOT_ONLY_REVISION_ID));
    expect(revisionSelect).toHaveDisplayValue('REV_19');
    expect(
      screen.getByText('Client comments — courtyard lighting coordination'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Include ${SNAPSHOT_TITLE}` })).toBeEnabled();
    expect(screen.queryByText('Internal Note')).not.toBeInTheDocument();
    expect(screen.queryByText('Private working note')).not.toBeInTheDocument();
  });

  it('creates a Draft from selected valid item IDs without client Issue audit fields', async () => {
    mockReadAuthority({ historyRecords: [draftHistoryRecord] });
    vi.mocked(api.createRevisionPackage).mockResolvedValue({
      ...createPackageResponse,
      status: 'Draft',
      issuedById: null,
      issuedByName: null,
      issuedAt: null,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    // The auto-select effect runs after data resolves; wait for the snapshot
    // rows to be selected before deselecting them so this draft carries only
    // the single GeneratedOutput id (a plain Output-only request).
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: `Include ${SNAPSHOT_TITLE}` })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: `Include ${SNAPSHOT_TITLE}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Include ${REPORT_SNAPSHOT_TITLE}` }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Draft package' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      revisionNumber: 3,
      label: 'Draft package',
      status: 'Draft',
      // PACKAGES-E2E-04B — a Draft never defaults under ISSUED.
      relativeOutputFolder: 'DRAFT/REV_03',
      selectedItemIds: [OUTPUT_ID],
      warningOverrideReason: '',
    });
    expect(body).not.toHaveProperty('issuedBy');
    expect(body).not.toHaveProperty('issuedAt');
    expect(body).not.toHaveProperty('packageId');
    // The Draft package renders with null Issue audit (not inferred client-side).
    expect(await screen.findAllByText('Not issued')).not.toHaveLength(0);
  });

  it('PACKAGES-E2E-04B1: the DISPLAYED folder matches the actual request for a Draft (never display ISSUED while sending DRAFT)', async () => {
    vi.mocked(api.createRevisionPackage).mockResolvedValue({
      ...createPackageResponse,
      status: 'Draft',
      issuedById: null,
      issuedByName: null,
      issuedAt: null,
    });
    mockReadAuthority();
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    const folderInput = screen.getByLabelText('Relative Output Folder');
    // The untouched auto-derived default is DRAFT for a Draft build.
    await waitFor(() => expect(folderInput).toHaveValue('DRAFT/REV_03'));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Draft display truth' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    // The displayed value and the sent request are the SAME folder.
    expect(folderInput).toHaveValue('DRAFT/REV_03');
    expect(body.relativeOutputFolder).toBe('DRAFT/REV_03');
    expect(body.status).toBe('Draft');
  });

  it('PACKAGES-E2E-04B1: the DISPLAYED folder matches the actual request for an Issued package', async () => {
    vi.mocked(api.createRevisionPackage).mockResolvedValue(createPackageResponse);
    mockReadAuthority();
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    const folderInput = screen.getByLabelText('Relative Output Folder');
    // The untouched auto-derived default starts at the Draft root (the default
    // pending status) and only becomes ISSUED once the Owner prepares an Issue.
    await waitFor(() => expect(folderInput).toHaveValue('DRAFT/REV_03'));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Issued display truth' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Issue Package' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    // The request is ISSUED, and the displayed folder updates to match it.
    expect(body.relativeOutputFolder).toBe('ISSUED/REV_03');
    expect(body.status).toBe('Issued');
    await waitFor(() => expect(folderInput).toHaveValue('ISSUED/REV_03'));
  });

  it('requires a warning reason for Issue, then renders immutable server audit separately from lifecycle', async () => {
    vi.mocked(api.createRevisionPackage).mockResolvedValue(createPackageResponse);
    mockReadAuthority({
      historyRecords: [issueHistoryRecord],
      packageCatalog: {
        ...catalog,
        checks: [
          {
            key: 'actions',
            label: 'Actions',
            detail: 'Open actions',
            severity: 'Warning',
            passed: false,
          },
        ],
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    const builder = screen.getByLabelText('Package builder inspector');
    expect(within(builder).getByText('Warnings').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Actions: Open actions')).toBeInTheDocument();
    const warningReason = await screen.findByLabelText('Warning Override Reason');
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Issued package' } });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Issue Package' })[0]).toBeEnabled(),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Issue Package' })[0]!);
    expect(api.createRevisionPackage).not.toHaveBeenCalled();
    expect(warningReason).toHaveFocus();
    fireEvent.change(warningReason, { target: { value: 'Reviewed with project lead' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Issue Package' })[0]!);
    await screen.findByRole('heading', { name: 'Issue Audit (Read-only)' });
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'Issued',
      warningOverrideReason: 'Reviewed with project lead',
    });
    expect(body).not.toHaveProperty('issuedBy');
    expect(body).not.toHaveProperty('issuedAt');
    expect(screen.getAllByText('Ahmed Dev').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Edit.*audit/i })).not.toBeInTheDocument();
  });

  it('keeps Blocking separate, blocks Issue, and permits Draft when hard guards pass', async () => {
    mockReadAuthority({
      packageCatalog: {
        ...catalog,
        checks: [
          {
            key: 'requirements',
            label: 'Requirements',
            detail: 'Missing',
            severity: 'Blocking',
            passed: false,
          },
        ],
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    expect(screen.getAllByRole('button', { name: 'Issue Package' })[0]).toBeDisabled();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Create Draft' })[0]).toBeEnabled(),
    );
    expect(screen.getByText('Requirements: Missing')).toBeInTheDocument();
  });

  it('retries an EXPORT_FAILED attempt with the same recoveryPackageId and no spoofed audit', async () => {
    mockReadAuthority();
    vi.mocked(api.createRevisionPackage)
      .mockRejectedValueOnce(
        new ApiError('Export failed safely.', 'EXPORT_FAILED', 500, 'corr', {
          packageId: RECOVERY_ID,
        }),
      )
      .mockResolvedValueOnce(createPackageResponse);
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Recover me' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    const retry = await screen.findByRole('button', { name: 'Retry Package Creation' });
    expect(screen.getByText(/does not create a new Issue/)).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(2));
    const retryBody = vi.mocked(api.createRevisionPackage).mock.calls[1]?.[1] as Record<
      string,
      unknown
    >;
    expect(retryBody).toMatchObject({ recoveryPackageId: RECOVERY_ID, status: 'Draft' });
    expect(retryBody).not.toHaveProperty('issuedBy');
    expect(retryBody).not.toHaveProperty('issuedAt');
  });

  it('shows contextual package details, deliverables, and starts reissue without identity inputs', async () => {
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    const deliverables = screen
      .getByRole('heading', { name: 'Deliverables' })
      .closest('section') as HTMLElement;
    expect(within(deliverables).getByText('Luminaire Schedule')).toBeInTheDocument();
    expect(within(deliverables).getByText('GeneratedOutput')).toBeInTheDocument();
    const packageIdentity = screen
      .getByRole('heading', { name: 'Package Identity' })
      .closest('section') as HTMLElement;
    expect(within(packageIdentity).getByText('Issue Package 03')).toBeInTheDocument();
    expect(within(packageIdentity).getByText('Rev 03')).toBeInTheDocument();
    expect(within(packageIdentity).getByText('Tender issue')).toBeInTheDocument();
    expect(within(packageIdentity).getByText('Issued')).toBeInTheDocument();
    expect(within(packageIdentity).getByText('Files saved')).toBeInTheDocument();
    expect(screen.queryByText('Content Hash')).not.toBeInTheDocument();
    expect(screen.queryByText('Template')).not.toBeInTheDocument();
    expect(screen.queryByText('Template Version')).not.toBeInTheDocument();
    expect(screen.queryByText('Template Snapshot Hash')).not.toBeInTheDocument();
    expect(screen.queryByText(PACKAGE_ID)).not.toBeInTheDocument();
    expect(screen.queryByText('Private working note')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Note')).not.toBeInTheDocument();
    const issueAudit = screen
      .getByRole('heading', { name: 'Issue Audit (Read-only)' })
      .closest('section') as HTMLElement;
    expect(within(issueAudit).getByText('Ahmed Dev')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View file details' }));
    expect(screen.getByText('Content Hash')).toBeInTheDocument();
    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByText('Template Version')).toBeInTheDocument();
    expect(screen.getByText('Template Snapshot Hash')).toBeInTheDocument();
    expect(screen.getByText(PACKAGE_ID)).toBeInTheDocument();
    expect(screen.queryByLabelText(/reissue number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/package sequence/i)).not.toBeInTheDocument();
    const page = within(screen.getByTestId('v4-project-packages'));
    expect(page.queryByText(/Recipient|Compare Package|Pricing/)).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByLabelText('Selected package details')).getByRole('button', {
        name: 'Start Reissue',
      }),
    );
    expect(screen.getByText(/same Revision/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Finalized Revision' })).toHaveDisplayValue(
      'Rev 03',
    );
  });

  it('joins the catalog to the selected Revision by canonical UUID, not display sequence', async () => {
    const sameSequenceDifferentRevision = {
      ...revision,
      revisionId: '00000000-0000-4000-8000-0000000000ff',
      revisionLabel: 'Rev 03 (imported)',
    } as PackageRevisionSummary;
    mockReadAuthority({
      revisions: [sameSequenceDifferentRevision, revision],
      packageCatalog: { ...catalog, revisionId: REVISION_ID },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eligible Deliverables' });
    // The catalog points at REVISION_ID; a legacy row sharing sequence 3 must
    // not steal the catalog authority.
    expect(screen.getByRole('combobox', { name: 'Finalized Revision' })).toHaveDisplayValue(
      'Rev 03',
    );
    expect(screen.getByText('Rev 03 (imported)')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include Luminaire Schedule PDF' })).toBeEnabled();
  });

  it('fails closed when the catalog carries no canonical revisionId — no sequence fallback, no REV_01 bind', async () => {
    mockReadAuthority({
      packageCatalog: { ...catalog, revisionId: null },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eligible Deliverables' });
    // Even though the display sequence (3) matches the FINALIZED Revision, the
    // catalog without a canonical UUID must NOT bind it: selecting Rev 03
    // yields the authority-gap note and NO selectable Output row at all.
    fireEvent.change(screen.getByRole('combobox', { name: 'Finalized Revision' }), {
      target: { value: REVISION_ID },
    });
    expect(await screen.findByText(/only exposes/)).toBeInTheDocument();
    expect(screen.getByText('Catalog unavailable for this Revision')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Finalized Revision' })).toHaveDisplayValue(
      'Rev 03',
    );
    expect(
      screen.queryByRole('checkbox', { name: 'Include Luminaire Schedule PDF' }),
    ).not.toBeInTheDocument();
  });

  it('does not bind a Revision when the catalog revisionId matches no finalized Revision', async () => {
    mockReadAuthority({
      packageCatalog: {
        ...catalog,
        revisionId: '99999999-9999-4999-8999-999999999999',
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Eligible Deliverables' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Finalized Revision' }), {
      target: { value: REVISION_ID },
    });
    expect(await screen.findByText(/only exposes/)).toBeInTheDocument();
    expect(screen.getByText('Catalog unavailable for this Revision')).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Include Luminaire Schedule PDF' }),
    ).not.toBeInTheDocument();
  });

  it('does not verify automatically on page load — verification is on-demand only', async () => {
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    renderPage();
    await screen.findByText('Issue Package 03');
    // Selecting a history row must NOT trigger a verification call.
    fireEvent.click(screen.getByText('Issue Package 03'));
    await screen.findByRole('heading', { name: 'Reproducibility' });
    expect(api.verifyIssuePackage).not.toHaveBeenCalled();
  });

  it('runs an on-demand VERIFIED verification with a compact human-readable summary', async () => {
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    vi.mocked(api.verifyIssuePackage).mockResolvedValue({
      packageId: PACKAGE_ID,
      status: 'VERIFIED',
      checkedAt: '2026-08-20T12:00:00.000Z',
      deliverables: [
        {
          sourceType: 'GeneratedOutput',
          sourceId: OUTPUT_ID,
          status: 'VERIFIED',
          expectedHash: 'b'.repeat(64),
        },
      ],
    });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Package' }));
    await waitFor(() => expect(api.verifyIssuePackage).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText('VERIFIED')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 / 1 Deliverables verified')).toBeInTheDocument();
    const reproducibility = screen
      .getByRole('heading', { name: 'Reproducibility' })
      .closest('section') as HTMLElement;
    expect(within(reproducibility).queryByText('Luminaire Schedule PDF')).not.toBeInTheDocument();
    fireEvent.click(
      within(reproducibility).getByRole('button', { name: 'View verification details' }),
    );
    expect(within(reproducibility).getByText('Luminaire Schedule PDF')).toBeInTheDocument();
    expect(within(reproducibility).getByText('GeneratedOutput').tagName).toBe('SMALL');
    expect(screen.getByText(/Checked/)).toBeInTheDocument();
  });

  it('uses canonical snapshot and structured Datasheet names for verification rows', async () => {
    const semanticCatalog = {
      ...catalog,
      items: [
        ...catalog.items.map((item) =>
          item.id === REPORT_SNAPSHOT_ID ? { ...item, label: 'LUX REPORT' } : item,
        ),
        {
          id: DATASHEET_SNAPSHOT_ID,
          group: 'Documents',
          label: 'Datasheet source title',
          fileName: 'datasheet.pdf',
          filePath: 'DELIVERABLES/REV_03/Documents/datasheet.pdf',
          available: true,
          outdated: false,
          sizeBytes: 1024,
          modifiedAt: '2026-08-18T10:04:00.000Z',
          note: '',
          datasheet: { tag: 'DL03', manufacturer: 'ERCO', model: 'Light Board' },
        },
      ],
    } satisfies RevisionPackageCatalog;
    const semanticHistory: IssueHistoryRecord = {
      ...issueHistoryRecord,
      deliverables: [
        {
          sourceType: 'DocumentSnapshot',
          deliverableId: REPORT_SNAPSHOT_ID,
          title: 'LUX REPORT',
          contentHash: 'f'.repeat(64),
          sizeBytes: 4096,
          locator: 'DELIVERABLES/REV_03/Documents/lux-report.pdf',
          sourceArtifactVersionId: null,
        },
        {
          sourceType: 'DocumentSnapshot',
          deliverableId: DATASHEET_SNAPSHOT_ID,
          title: 'Datasheet source title',
          contentHash: 'd'.repeat(64),
          sizeBytes: 1024,
          locator: 'DELIVERABLES/REV_03/Documents/datasheet.pdf',
          sourceArtifactVersionId: null,
        },
        issueHistoryRecord.deliverables[0]!,
      ],
    };
    mockReadAuthority({ historyRecords: [semanticHistory], packageCatalog: semanticCatalog });
    vi.mocked(api.verifyIssuePackage).mockResolvedValue({
      packageId: PACKAGE_ID,
      status: 'VERIFIED',
      checkedAt: '2026-08-20T12:00:00.000Z',
      deliverables: [
        {
          sourceType: 'DocumentSnapshot',
          sourceId: REPORT_SNAPSHOT_ID,
          status: 'VERIFIED',
          expectedHash: 'f'.repeat(64),
        },
        {
          sourceType: 'DocumentSnapshot',
          sourceId: DATASHEET_SNAPSHOT_ID,
          status: 'VERIFIED',
          expectedHash: 'd'.repeat(64),
        },
        {
          sourceType: 'GeneratedOutput',
          sourceId: OUTPUT_ID,
          status: 'VERIFIED',
          expectedHash: 'b'.repeat(64),
        },
      ],
    });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    const compactDeliverables = screen
      .getByRole('heading', { name: 'Deliverables' })
      .closest('section')
      ?.querySelector('.v4-packages__deliverable-list');
    expect(compactDeliverables).not.toBeNull();
    expect(
      within(compactDeliverables as HTMLElement).getByText('DL03 Datasheet', {
        selector: 'strong',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify Package' }));
    const reproducibility = (
      await screen.findByRole('heading', {
        name: 'Reproducibility',
      })
    ).closest('section') as HTMLElement;
    expect(within(reproducibility).getByText('3 / 3 Deliverables verified')).toBeInTheDocument();
    expect(within(reproducibility).queryByText('LUX REPORT')).not.toBeInTheDocument();
    expect(within(reproducibility).queryByText('DL03 Datasheet')).not.toBeInTheDocument();
    fireEvent.click(
      within(reproducibility).getByRole('button', { name: 'View verification details' }),
    );
    expect(
      within(reproducibility).getByText('LUX REPORT', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(
      within(reproducibility).getByText('DL03 Datasheet', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(
      within(reproducibility).getByText('Luminaire Schedule PDF', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(within(reproducibility).getAllByText('DocumentSnapshot')[0]?.tagName).toBe('SMALL');
  });

  it('surfaces a non-verified canonical member without expanding healthy verification details', async () => {
    const semanticCatalog = {
      ...catalog,
      items: [
        ...catalog.items,
        {
          id: DATASHEET_SNAPSHOT_ID,
          group: 'Documents',
          label: 'Datasheet source title',
          fileName: 'datasheet.pdf',
          filePath: 'DELIVERABLES/REV_03/Documents/datasheet.pdf',
          available: true,
          outdated: false,
          sizeBytes: 1024,
          modifiedAt: '2026-08-18T10:04:00.000Z',
          note: '',
          datasheet: { tag: 'DL04', manufacturer: 'ERCO', model: 'Light Board' },
        },
      ],
    } satisfies RevisionPackageCatalog;
    const semanticHistory: IssueHistoryRecord = {
      ...issueHistoryRecord,
      deliverables: [
        {
          sourceType: 'DocumentSnapshot',
          deliverableId: DATASHEET_SNAPSHOT_ID,
          title: 'Datasheet source title',
          contentHash: 'd'.repeat(64),
          sizeBytes: 1024,
          locator: 'DELIVERABLES/REV_03/Documents/datasheet.pdf',
          sourceArtifactVersionId: null,
        },
        issueHistoryRecord.deliverables[0]!,
      ],
    };
    mockReadAuthority({ historyRecords: [semanticHistory], packageCatalog: semanticCatalog });
    vi.mocked(api.verifyIssuePackage).mockResolvedValue({
      packageId: PACKAGE_ID,
      status: 'MISMATCH',
      checkedAt: '2026-08-20T12:00:00.000Z',
      deliverables: [
        {
          sourceType: 'DocumentSnapshot',
          sourceId: DATASHEET_SNAPSHOT_ID,
          status: 'MISMATCH',
          expectedHash: 'd'.repeat(64),
          reason: 'The packaged copy does not match its canonical hash.',
        },
        {
          sourceType: 'GeneratedOutput',
          sourceId: OUTPUT_ID,
          status: 'VERIFIED',
          expectedHash: 'b'.repeat(64),
        },
      ],
    });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Package' }));
    const reproducibility = (
      await screen.findByRole('heading', {
        name: 'Reproducibility',
      })
    ).closest('section') as HTMLElement;
    expect(
      within(reproducibility).getByText('1 of 2 Deliverable needs attention'),
    ).toBeInTheDocument();
    expect(
      within(reproducibility).getByText('DL04 Datasheet', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(within(reproducibility).getAllByText('MISMATCH')).toHaveLength(2);
    expect(within(reproducibility).queryByText('Luminaire Schedule PDF')).not.toBeInTheDocument();
  });

  it('shows a loading state while verification is in flight', async () => {
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    let resolveVerify: (value: PackageVerificationResult) => void = () => undefined;
    vi.mocked(api.verifyIssuePackage).mockImplementation(
      () =>
        new Promise<PackageVerificationResult>((resolve) => {
          resolveVerify = resolve;
        }),
    );
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Package' }));
    expect(await screen.findByRole('button', { name: 'Verifying…' })).toBeInTheDocument();
    resolveVerify({
      packageId: PACKAGE_ID,
      status: 'VERIFIED',
      checkedAt: '2026-08-20T12:00:00.000Z',
      deliverables: [],
    });
    expect(await screen.findByRole('button', { name: 'Verify Package' })).toBeInTheDocument();
  });

  it.each([
    ['MISSING', 'MISSING'],
    ['MISMATCH', 'MISMATCH'],
    ['UNAVAILABLE', 'UNAVAILABLE'],
  ] as const)('renders the %s verification state distinctly', async (status, expected) => {
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    vi.mocked(api.verifyIssuePackage).mockResolvedValue({
      packageId: PACKAGE_ID,
      status,
      checkedAt: '2026-08-20T12:00:00.000Z',
      deliverables: [],
    });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Package' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('renders mixed DocumentSnapshot and GeneratedOutput deliverables with provenance', async () => {
    const mixed: IssueHistoryRecord = {
      ...issueHistoryRecord,
      deliverables: [
        {
          sourceType: 'DocumentSnapshot',
          deliverableId: '00000000-0000-4000-8000-000000000050',
          title: 'Layout DWG',
          contentHash: 'f'.repeat(64),
          sizeBytes: 2048,
          locator: 'DELIVERABLES/REV_03/Documents/Layout.dwg',
          sourceArtifactVersionId: '00000000-0000-4000-8000-000000000051',
        },
        {
          sourceType: 'GeneratedOutput',
          outputId: OUTPUT_ID,
          contentHash: 'b'.repeat(64),
          templateId: 'template-1',
          templateVersionId: 'version-1',
          resolvedTemplateSnapshotHash: 'e'.repeat(64),
        },
      ],
    };
    mockReadAuthority({ historyRecords: [mixed] });
    renderPage();
    await screen.findByText('Issue Package 03');
    fireEvent.click(screen.getByText('Issue Package 03'));
    expect(await screen.findByText('Layout DWG')).toBeInTheDocument();
    expect(screen.queryByText('Source Artifact Version')).not.toBeInTheDocument();
    expect(screen.queryByText('Locator')).not.toBeInTheDocument();
    expect(screen.queryByText('template-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View file details' }));
    expect(screen.getByText('Source Artifact Version')).toBeInTheDocument();
    expect(screen.getByText('Locator')).toBeInTheDocument();
    expect(screen.getAllByText('template-1').length).toBeGreaterThan(0);
    expect(screen.getByText(/Datasheets are included as canonical/)).toBeInTheDocument();
  });

  it('exposes DocumentSnapshot rows as selectable Eligible Deliverables', async () => {
    mockReadAuthority();
    renderPage();
    await screen.findByRole('heading', { name: 'Eligible Deliverables' });
    // Both the Schedule PDF GeneratedOutput and the two DocumentSnapshots render.
    expect(screen.getByRole('checkbox', { name: 'Include Luminaire Schedule PDF' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: `Include ${SNAPSHOT_TITLE}` })).toBeEnabled();
    expect(
      screen.getByRole('checkbox', { name: `Include ${REPORT_SNAPSHOT_TITLE}` }),
    ).toBeEnabled();
    expect(screen.getByText(SNAPSHOT_TITLE)).toBeInTheDocument();
    expect(screen.getByText(REPORT_SNAPSHOT_TITLE)).toBeInTheDocument();
    // DocumentSnapshot rows show truthful type info (no invented family/format).
    expect(screen.getAllByText('Documents').length).toBeGreaterThan(0);
  });

  it('sends a single mixed package request with canonical GeneratedOutput AND DocumentSnapshot IDs', async () => {
    mockReadAuthority();
    vi.mocked(api.createRevisionPackage).mockResolvedValue({
      ...createPackageResponse,
      status: 'Draft',
      issuedById: null,
      issuedByName: null,
      issuedAt: null,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Mixed package' } });
    // All three available rows are pre-selected by default (auto-select effect).
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    // The request must carry BOTH canonical source types by their catalog item
    // identity — never a ProjectDocument id or a sequence.
    expect((body.selectedItemIds as string[]).sort()).toEqual(
      [OUTPUT_ID, SNAPSHOT_ID, REPORT_SNAPSHOT_ID].sort(),
    );
    expect(body.selectedItemIds).not.toContain(undefined);
  });

  it('does not substitute a ProjectDocument id for a DocumentSnapshot deliverable id', async () => {
    mockReadAuthority();
    vi.mocked(api.createRevisionPackage).mockResolvedValue({
      ...createPackageResponse,
      status: 'Draft',
      issuedById: null,
      issuedByName: null,
      issuedAt: null,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Mixed draft' } });
    // Deselect the GeneratedOutput so only DocumentSnapshots are selected.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Luminaire Schedule PDF' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    // Only canonical snapshot deliverableIds remain; no ProjectDocument is substituted.
    expect((body.selectedItemIds as string[]).sort()).toEqual(
      [SNAPSHOT_ID, REPORT_SNAPSHOT_ID].sort(),
    );
  });

  it('PACKAGES-E2E-04B: an Issued package defaults to the ISSUED root, not DRAFT', async () => {
    vi.mocked(api.createRevisionPackage).mockResolvedValue(createPackageResponse);
    mockReadAuthority({ historyRecords: [issueHistoryRecord] });
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Issued default' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Issue Package' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.relativeOutputFolder).toBe('ISSUED/REV_03');
    expect(body.status).toBe('Issued');
  });

  it('PACKAGES-E2E-04B: an explicit custom output folder is honored verbatim and not overwritten', async () => {
    vi.mocked(api.createRevisionPackage).mockResolvedValue({
      ...createPackageResponse,
      status: 'Draft',
      issuedById: null,
      issuedByName: null,
      issuedAt: null,
    });
    mockReadAuthority();
    renderPage();
    await screen.findByRole('heading', { name: 'Package Setup' });
    const folderInput = screen.getByLabelText('Relative Output Folder');
    // Wait for the auto-derived default to settle before editing, so the later
    // explicit edit is the last word (and is preserved). The untouched default
    // is the Draft root (the default pending status).
    await waitFor(() => expect(folderInput).toHaveValue('DRAFT/REV_03'));
    fireEvent.change(folderInput, { target: { value: 'CUSTOM/REV_01' } });
    await waitFor(() => expect(folderInput).toHaveValue('CUSTOM/REV_01'));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Custom folder' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Draft' })[0]!);
    await waitFor(() => expect(api.createRevisionPackage).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.createRevisionPackage).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.relativeOutputFolder).toBe('CUSTOM/REV_01');
    expect(body.status).toBe('Draft');
  });
});
