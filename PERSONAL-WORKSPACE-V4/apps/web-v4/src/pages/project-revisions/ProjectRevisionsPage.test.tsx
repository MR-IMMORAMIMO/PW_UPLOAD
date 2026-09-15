/**
 * Project Revisions & Deliverables page integration tests (B1).
 *
 * Mocks the API environment module so the page runs against deterministic
 * canonical fixtures. Covers the owner-visible behavior of the B1 evolution:
 * exactly four KPIs with real captions, exactly three tabs (Revisions /
 * Deliverables / Recovery — no Outputs tab), the manual PREPARING Revision
 * workflow (Create / Add Deliverable / Remove / Finalize), the unified
 * Deliverables read model (GeneratedOutput + DocumentSnapshot), truthful
 * artifact presence, page-local filters, and Generate Output remaining a
 * navigation-only Schedule/BOQ CTA.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalOutputPresenceRecord,
  CanonicalRevisionRecord,
  DatasheetEligibilityItem,
  Project,
  ProjectRevision,
  ProjectWorkspace,
  RevisionDeliverable,
} from '@scli/domain';
import { api } from '../../api/environment';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import {
  acknowledgeRevisionDetailsFocusRequest,
  ProjectRevisionsWorkspace as ProjectRevisionsPage,
} from './ProjectRevisionsWorkspace';
import { ProjectRevisionsPage as FinalProjectRevisionsPage } from './ProjectRevisionsPage';

vi.mock('../../api/environment', () => ({
  api: {
    project: vi.fn(),
    projectWorkspace: vi.fn(),
    projectRevisions: vi.fn(),
    projectOutputs: vi.fn(),
    revisionDeliverables: vi.fn(),
    datasheetEligibility: vi.fn(),
    addDatasheetDeliverable: vi.fn(),
    prepareRevision: vi.fn(),
    updateRevisionMetadata: vi.fn(),
    addRevisionDeliverable: vi.fn(),
    removeRevisionDeliverable: vi.fn(),
    finalizeRevision: vi.fn(),
    resumeRevision: vi.fn(),
    revisionDeleteEligibility: vi.fn(),
    deleteRevision: vi.fn(),
    revisionReuseEligibility: vi.fn(),
    reuseRevisionNumber: vi.fn(),
    generateLuminaireSchedule: vi.fn(),
    generateTechnicalBoq: vi.fn(),
    projectTypeCatalogue: vi.fn(),
    updateProject: vi.fn(),
  },
  apiRequest: vi.fn(),
}));

/* ---------------------------------------------------------------------------
   Canonical fixtures.
   ------------------------------------------------------------------------- */

const PROJECT: Project = {
  id: 'p1',
  projectCode: 'P-001',
  projectName: 'Test Project',
  clientName: 'Acme',
  projectType: 'Hospitality',
  description: 'fixture',
  salesOwnerId: 'u1',
  salesOwnerNameSnapshot: 'Owner',
  salesOwnerEmailSnapshot: 'o@x.test',
  createdById: 'u1',
  createdByNameSnapshot: 'Owner',
  createdByEmailSnapshot: 'o@x.test',
  assignedDesignerId: null,
  assignedDesignerNameSnapshot: null,
  collaboratorDesignerIds: [],
  collaboratorDesignerNameSnapshots: [],
  siteLocation: '',
  designStage: 'DetailedDesign',
  lightingScope: '',
  luxRequirements: '',
  drawingReference: '',
  status: 'InProgress',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 10,
  actualHours: 0,
  progressPercent: 10,
  requiredDeliveryDate: '2026-12-01',
  projectFolderUrl: null,
  revisionNumber: 1,
  createdAt: '2026-08-01T09:00:00Z',
  updatedAt: '2026-08-01T09:00:00Z',
  completedAt: null,
  cancelledAt: null,
  version: 1,
};

const WORKSPACE = {
  projectId: 'p1',
  revisions: [],
  documents: [],
} as unknown as ProjectWorkspace;

function compatibilityRevision(
  id: string,
  overrides: Partial<ProjectRevision> = {},
): ProjectRevision {
  return {
    id,
    projectId: 'p1',
    revisionNumber: 1,
    reissueNumber: 0,
    title: '',
    status: 'Draft',
    receivedAt: null,
    dueDate: null,
    issuedAt: null,
    summary: '',
    changeLog: '',
    sourceType: 'Manual',
    sourceReference: '',
    locked: false,
    snapshotHash: 'compatibility-only-hash',
    createdAt: '2026-08-20T08:00:00.000Z',
    updatedAt: '2026-08-20T08:00:00.000Z',
    ...overrides,
  };
}

function revision(
  n: number,
  overrides: Partial<CanonicalRevisionRecord> = {},
): CanonicalRevisionRecord {
  return {
    revisionId: `rev-${n}`,
    projectId: 'p1',
    revisionSequence: n,
    revisionLabel: `R${String(n).padStart(2, '0')}`,
    purpose: null,
    internalNote: null,
    lifecycleState: 'FINALIZED',
    projectSnapshot: { canonicalOperation: 'Initial Generation' },
    luminaireSnapshot: [],
    snapshotHash: `hash-${n}`,
    createdById: 'u1',
    createdByName: 'Maha',
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    failureReason: null,
    createdAt: new Date(2026, 7, 10 + n, 9, 0, 0).toISOString(),
    finalizedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    updatedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    ...overrides,
  };
}

function output(
  n: number,
  overrides: Partial<CanonicalOutputPresenceRecord> = {},
): CanonicalOutputPresenceRecord {
  return {
    outputId: `out-${n}`,
    projectId: 'p1',
    revisionId: `rev-${n}`,
    outputFamily: 'LuminaireSchedule',
    outputFormat: 'XLSX',
    locatorKind: 'PROJECT_RELATIVE',
    locatorValue: `artifacts/R0${n}.xlsx`,
    legacyAbsolutePath: null,
    contentHash: `content-${n}`,
    templateId: 'tmpl-schedule',
    templateVersionId: 'v1',
    resolvedTemplateSnapshot: null,
    resolvedTemplateSnapshotHash: null,
    lifecycleState: 'FINALIZED',
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    legacySourceField: null,
    templateProvenance: 'RESOLVED',
    failureReason: null,
    createdAt: new Date(2026, 7, 10 + n, 9, 0, 0).toISOString(),
    finalizedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    updatedAt: new Date(2026, 7, 10 + n, 10, 0, 0).toISOString(),
    artifactPresence: 'Present',
    artifactOpenPath: `/projects/p1/out/R0${n}.xlsx`,
    ...overrides,
  };
}

function deliverable(n: number, overrides: Partial<RevisionDeliverable> = {}): RevisionDeliverable {
  return {
    sourceType: 'GeneratedOutput',
    deliverableId: `dlv-${n}`,
    sourceId: `out-${n}`,
    projectId: 'p1',
    revisionId: 'rev-1',
    title: `Schedule ${n}`,
    category: 'Luminaire Schedule',
    fileName: `R01-schedule-${n}.xlsx`,
    format: 'XLSX',
    outputFamily: 'LuminaireSchedule',
    contentHash: `hash-${n}`,
    sizeBytes: 1024,
    lifecycleState: 'FINALIZED',
    presence: 'Present',
    ...overrides,
  };
}

/** Rich fixture set exercising every state the page can present. */
function richRevisions(): CanonicalRevisionRecord[] {
  return [
    revision(1),
    revision(2),
    revision(3, {
      lifecycleState: 'FAILED_RECOVERABLE',
      failureReason: 'Template resolution failed: unknown version',
      projectSnapshot: { canonicalOperation: 'Scheduled Regeneration' },
    }),
    // Register-only FAILED revision: no owning outputs → no fake Retry.
    revision(4, {
      lifecycleState: 'FAILED_RECOVERABLE',
      failureReason: 'Registration failed: no template selected',
      projectSnapshot: { canonicalOperation: 'Register Only' },
    }),
  ];
}

function richOutputs(): CanonicalOutputPresenceRecord[] {
  return [
    output(1, {
      revisionId: 'rev-3',
      lifecycleState: 'FAILED_RECOVERABLE',
      failureReason: 'Generation failed: driver mismatch',
      artifactPresence: 'Present',
      artifactOpenPath: '/projects/p1/out/R03-schedule.xlsx',
    }),
    output(2, {
      revisionId: 'rev-2',
      outputFamily: 'TechnicalBoq',
      outputFormat: 'PDF',
      artifactPresence: 'Missing',
      artifactOpenPath: null,
    }),
    output(3, { revisionId: 'rev-1', artifactPresence: 'Present' }),
  ];
}

function seedApi(options?: {
  revisions?: CanonicalRevisionRecord[];
  outputs?: CanonicalOutputPresenceRecord[];
  deliverables?: RevisionDeliverable[];
  datasheets?: DatasheetEligibilityItem[];
  project?: Project;
  workspace?: ProjectWorkspace;
}): void {
  const {
    revisions = richRevisions(),
    outputs = richOutputs(),
    deliverables = [],
    datasheets = [],
    project = PROJECT,
    workspace = WORKSPACE,
  } = options ?? {};
  vi.mocked(api.project).mockResolvedValue(project);
  vi.mocked(api.projectWorkspace).mockResolvedValue(workspace);
  vi.mocked(api.projectRevisions).mockResolvedValue(revisions);
  vi.mocked(api.projectOutputs).mockResolvedValue(outputs);
  vi.mocked(api.revisionDeliverables).mockResolvedValue(deliverables);
  vi.mocked(api.datasheetEligibility).mockResolvedValue(datasheets);
  vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
    revisionId: '',
    deleteAction: 'NONE',
    canDelete: false,
    blockedReasons: [],
    counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
  });
  vi.mocked(api.revisionReuseEligibility).mockResolvedValue({ candidate: null });
  vi.mocked(api.projectTypeCatalogue).mockResolvedValue([]);
  const generationResult = {
    revision: revision(1),
    outputs: [],
    files: { xlsxPath: null, pdfPath: null },
  };
  vi.mocked(api.generateLuminaireSchedule).mockResolvedValue(generationResult);
  vi.mocked(api.generateTechnicalBoq).mockResolvedValue(generationResult);
}

/**
 * Landing stub for a generation workspace route. Exposes the address query so a
 * test can assert exactly what the Generate Output menu navigated with — the URL
 * is the only carrier of the composition target.
 */
function NavProbe({ testId }: { testId: string }) {
  const location = useLocation();
  return <div data-testid={testId} data-search={location.search} />;
}

function renderPage() {
  stubMatchMedia();
  return renderV4(
    <Routes>
      <Route path="/projects/:projectId/revisions" element={<ProjectRevisionsPage />} />
      <Route
        path="/projects/:projectId/luminaire-schedule"
        element={<NavProbe testId="v4-nav-luminaire-schedule" />}
      />
      <Route
        path="/projects/:projectId/technical-boq"
        element={<NavProbe testId="v4-nav-technical-boq" />}
      />
    </Routes>,
    ['/projects/p1/revisions'],
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  seedApi();
});

afterEach(() => {
  cleanup();
  cleanupV4();
});

/* ---------------------------------------------------------------------------
   Page identity: title, tabs, no Outputs tab.
   ------------------------------------------------------------------------- */

describe('page identity', () => {
  it('renders page title Revisions & Deliverables and exactly three tabs', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    expect(screen.getByRole('heading', { name: 'Revisions & Deliverables' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Revisions', 'Deliverables', 'Recovery3']);
    // No Outputs tab label anywhere.
    expect(screen.queryByRole('tab', { name: 'Outputs' })).not.toBeInTheDocument();
  });

  it('renders exactly four KPIs including Generated Outputs', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    expect(screen.getAllByTestId(/^v4-kpi-/)).toHaveLength(4);
    const total = screen.getByTestId('v4-kpi-total-revisions');
    expect(total.textContent).toMatch(/Total Revisions\s*4\s*2 finalized/);
    const outputs = screen.getByTestId('v4-kpi-generated-outputs');
    expect(outputs.textContent).toMatch(/Generated Outputs\s*3\s*2 present · project-wide/);
    // No misleading "Registered Deliverables" KPI remains.
    expect(screen.queryByTestId('v4-kpi-registered-deliverables')).not.toBeInTheDocument();
  });

  it('Generate Output still exists and menu lists Schedule + BOQ only', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    const trigger = screen.getByTestId('v4-generate-output-trigger');
    expect(trigger).toHaveTextContent('Generate Output');
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    const menu = screen.getByTestId('v4-generate-output-menu');
    expect(screen.getByTestId('v4-generate-output-option-schedule')).toHaveTextContent(
      'Luminaire Schedule',
    );
    expect(screen.getByTestId('v4-generate-output-option-boq')).toHaveTextContent('Technical BOQ');
    expect(menu.querySelectorAll('button')).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------------------
   Revisions tab: Create Revision + historical zero-deliverable compatibility.
   ------------------------------------------------------------------------- */

describe('revisions tab / create revision', () => {
  it('Create Revision action exists in the Revisions workspace', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    expect(screen.getByTestId('v4-create-revision')).toHaveTextContent('Create Revision');
  });

  it('creates a PREPARING manual Revision via the B0 prepare method and selects it on the Deliverables tab', async () => {
    const preparing = revision(5, {
      lifecycleState: 'PREPARING',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    vi.mocked(api.prepareRevision).mockResolvedValue(preparing);
    vi.mocked(api.revisionDeliverables).mockResolvedValue([]);

    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-create-revision'));
    const dialog = screen.getByTestId('v4-create-revision-dialog');
    fireEvent.change(screen.getByRole('textbox', { name: /Revision Purpose/ }), {
      target: { value: 'Client comments' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Internal Note/ }), {
      target: { value: 'Waiting for updated IES.' },
    });
    fireEvent.click(screen.getByTestId('v4-confirm-create-revision'));

    expect(dialog).toHaveTextContent('Optional');
    await waitFor(() =>
      expect(api.prepareRevision).toHaveBeenCalledWith('p1', {
        purpose: 'Client comments',
        internalNote: 'Waiting for updated IES.',
      }),
    );
    // Switches to the Deliverables tab and selects the new PREPARING Revision.
    await waitFor(() => {
      expect(screen.getByTestId('v4-revisions-tab-deliverables')).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    // The Revision inspector shows the selected PREPARING Revision with Add Deliverable.
    await screen.findByTestId('v4-deliverables-inspector-empty');
  });

  it('allows Create Revision with both optional metadata fields empty', async () => {
    vi.mocked(api.prepareRevision).mockResolvedValue(
      revision(5, {
        lifecycleState: 'PREPARING',
        projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-create-revision'));
    fireEvent.click(screen.getByTestId('v4-confirm-create-revision'));
    await waitFor(() =>
      expect(api.prepareRevision).toHaveBeenCalledWith('p1', {
        purpose: '',
        internalNote: '',
      }),
    );
  });

  it('historical register-only zero-deliverable Revision is valid and never flagged as error', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    // rev-2 is a FINALIZED register-only revision with no deliverables.
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-2'));
    const inspector = await screen.findByTestId('v4-revision-inspector');
    expect(inspector).toHaveTextContent('FINALIZED');
    // No error/warning solely for a zero-deliverable historical revision.
    expect(screen.queryByTestId('v4-revision-failure')).not.toBeInTheDocument();
    expect(inspector).not.toHaveTextContent('Incomplete');
    expect(inspector).not.toHaveTextContent('Needs Attention');
  });
});

describe('Revision details action and Compatibility summary', () => {
  it('consumes Chevron focus before close so an ordinary row reopen cannot replay it', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    const action = screen.getByTestId('v4-revision-details-rev-2');
    expect(action).toHaveAttribute('title', 'View Revision details');
    expect(action).toHaveAccessibleName('View Revision details for R02');
    fireEvent.click(action);

    const inspector = await screen.findByTestId('v4-revision-inspector');
    const heading = within(inspector).getByRole('heading', { name: 'Revision Details' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(inspector).toHaveTextContent('R02');

    fireEvent.click(screen.getByTestId('v4-revision-inspector-close'));
    expect(screen.queryByTestId('v4-revision-inspector')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));

    const reopenedInspector = await screen.findByTestId('v4-revision-inspector');
    const reopenedHeading = within(reopenedInspector).getByRole('heading', {
      name: 'Revision Details',
    });
    expect(reopenedInspector).toHaveTextContent('R01');
    expect(reopenedHeading).not.toHaveFocus();
    reopenedInspector.scrollTop = 140;
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    expect(reopenedInspector.scrollTop).toBe(140);
  });

  it('does not replay consumed details focus after switching context and returning', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-details-rev-1'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Revision Details' })).toHaveFocus(),
    );

    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    expect(await screen.findByTestId('v4-deliverables-inspector-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('v4-revisions-tab-revisions'));

    const heading = await screen.findByRole('heading', { name: 'Revision Details' });
    expect(heading).not.toHaveFocus();
  });

  it('same-selection details activation resets only Inspector scroll and preserves its state', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    const action = screen.getByTestId('v4-revision-details-rev-1');
    fireEvent.click(action);

    const inspector = await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-advanced-toggle'));
    expect(screen.getByTestId('v4-revision-advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const tableScroll = document.querySelector<HTMLElement>('.v4-revisions__table-scroll');
    expect(tableScroll).not.toBeNull();
    if (tableScroll) tableScroll.scrollTop = 80;
    inspector.scrollTop = 240;
    vi.mocked(window.scrollTo).mockClear();
    action.focus();
    fireEvent.click(action);

    await waitFor(() => expect(inspector.scrollTop).toBe(0));
    expect(within(inspector).getByRole('heading', { name: 'Revision Details' })).toHaveFocus();
    expect(screen.getByTestId('v4-revision-advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(tableScroll?.scrollTop).toBe(80);
    expect(window.scrollTo).not.toHaveBeenCalled();

    inspector.scrollTop = 180;
    screen.getByTestId('v4-create-revision').focus();
    expect(within(inspector).getByRole('heading', { name: 'Revision Details' })).not.toHaveFocus();
    fireEvent.click(action);
    await waitFor(() =>
      expect(within(inspector).getByRole('heading', { name: 'Revision Details' })).toHaveFocus(),
    );
    expect(inspector.scrollTop).toBe(0);
  });

  it('ordinary row click selects and opens without moving details focus', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    const inspector = await screen.findByTestId('v4-revision-inspector');
    expect(inspector).toHaveTextContent('R01');
    expect(within(inspector).getByRole('heading', { name: 'Revision Details' })).not.toHaveFocus();
  });

  it('supports native Enter and Space activation through the explicit details action', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    const action = screen.getByTestId('v4-revision-details-rev-1');
    action.focus();
    await user.keyboard('{Enter}');
    const heading = await screen.findByRole('heading', { name: 'Revision Details' });
    await waitFor(() => expect(heading).toHaveFocus());
    action.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('acknowledging request N cannot clear a newer pending request N+1', () => {
    const newerRequest = { id: 2, revisionId: 'rev-2' };

    expect(acknowledgeRevisionDetailsFocusRequest(newerRequest, 1)).toBe(newerRequest);
    expect(acknowledgeRevisionDetailsFocusRequest(newerRequest, 2)).toBeNull();
  });

  it('shows persisted Compatibility fields separately without inventing history', async () => {
    const workspace = {
      projectId: 'p1',
      revisions: [
        compatibilityRevision('rev-1', {
          status: 'InternalReview',
          issuedAt: null,
          locked: false,
          title: 'Tender Issue',
          summary: 'Current coordination summary',
          changeLog: 'Adjusted lobby quantities',
          receivedAt: '2026-08-18',
          dueDate: '2026-08-25',
          sourceType: 'Meeting',
          reissueNumber: 2,
        }),
      ],
      documents: [],
    } as unknown as ProjectWorkspace;
    seedApi({ revisions: [revision(1)], outputs: [], workspace });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-1'));

    const section = await screen.findByTestId('v4-revision-compatibility');
    expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('FINALIZED');
    expect(section).toHaveTextContent('Internal Review');
    expect(section).toHaveTextContent('Not issued');
    expect(within(section).getByText('Locked').parentElement).toHaveTextContent('No');
    expect(section).toHaveTextContent('Tender Issue');
    expect(section).toHaveTextContent('Current coordination summary');
    expect(section).toHaveTextContent('Adjusted lobby quantities');
    expect(section).toHaveTextContent('Meeting');
    expect(within(section).getByText('Reissue').parentElement).toHaveTextContent('2');
    expect(section).not.toHaveTextContent('History');
    expect(section).not.toHaveTextContent('compatibility-only-hash');
  });

  it('shows persisted issuance and hides empty optional Compatibility fields', async () => {
    const workspace = {
      projectId: 'p1',
      revisions: [
        compatibilityRevision('rev-1', {
          status: 'Issued',
          issuedAt: '2026-08-20T08:00:00.000Z',
          locked: true,
        }),
      ],
      documents: [],
    } as unknown as ProjectWorkspace;
    seedApi({ revisions: [revision(1)], outputs: [], workspace });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-1'));

    const section = await screen.findByTestId('v4-revision-compatibility');
    expect(section).toHaveTextContent('Issued');
    expect(within(section).getByText('Locked').parentElement).toHaveTextContent('Yes');
    expect(section).not.toHaveTextContent('Not issued');
    expect(within(section).queryByText('Title')).not.toBeInTheDocument();
    expect(within(section).queryByText('Summary')).not.toBeInTheDocument();
    expect(within(section).queryByText('Changes')).not.toBeInTheDocument();
    expect(within(section).queryByText('Reissue')).not.toBeInTheDocument();
  });

  it('shows a quiet empty state when no compatibility record exists', async () => {
    seedApi({ revisions: [revision(1)], outputs: [], workspace: WORKSPACE });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-1'));

    expect(await screen.findByTestId('v4-revision-compatibility')).toHaveTextContent(
      'No compatibility record',
    );
  });
});

describe('P2C-07 Revision Purpose and Internal Note', () => {
  const preparingMetadata = () =>
    revision(5, {
      lifecycleState: 'PREPARING',
      finalizedAt: null,
      purpose: 'Client comments',
      internalNote: 'Line one\nLine two',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });

  it('displays multiline metadata and updates the exact selected Revision', async () => {
    const preparing = preparingMetadata();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.updateRevisionMetadata).mockResolvedValue({
      ...preparing,
      purpose: 'Tender issue',
    });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-5'));
    expect(await screen.findByTestId('v4-revision-internal-note')).toHaveTextContent(
      'Line one Line two',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Revision Purpose' }));
    const purpose = screen.getByRole('textbox', { name: 'Revision Purpose' });
    fireEvent.change(purpose, { target: { value: 'Tender issue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.updateRevisionMetadata).toHaveBeenCalledWith('p1', 'rev-5', {
        purpose: 'Tender issue',
      }),
    );
    expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('Tender issue');
  });

  it('clears Internal Note through the normal PREPARING metadata path', async () => {
    const preparing = preparingMetadata();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.updateRevisionMetadata).mockResolvedValue({
      ...preparing,
      internalNote: null,
    });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-5'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Internal Note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Internal Note' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateRevisionMetadata).toHaveBeenCalledWith('p1', 'rev-5', {
        internalNote: '',
      }),
    );
    expect(screen.getByTestId('v4-revision-internal-note')).toHaveTextContent('Not added');
  });

  it('shows FINALIZED and FAILED_RECOVERABLE metadata as read-only', async () => {
    seedApi({
      revisions: [
        revision(1, { purpose: 'Frozen purpose', internalNote: 'Frozen note' }),
        revision(2, {
          lifecycleState: 'FAILED_RECOVERABLE',
          purpose: 'Failed purpose',
          internalNote: 'Failed note',
        }),
      ],
      outputs: [],
    });
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-1'));
    expect(screen.getByText('Frozen purpose')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Revision Purpose/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-2'));
    expect(await screen.findByText('Failed purpose')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Internal Note/ })).not.toBeInTheDocument();
  });

  it('surfaces a server rejection without replacing persisted metadata', async () => {
    const preparing = preparingMetadata();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.updateRevisionMetadata).mockRejectedValue(
      new Error('Revision metadata can be edited only while the Revision is PREPARING.'),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-revision-row-rev-5'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Revision Purpose' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Revision Purpose' }), {
      target: { value: 'Stale edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('v4-revisions-notice')).toHaveTextContent(
      'only while the Revision is PREPARING',
    );
    expect(screen.getByRole('textbox', { name: 'Revision Purpose' })).toHaveValue('Stale edit');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('Client comments');
  });
});

describe('P2C-04 explicit Revision number reuse', () => {
  const candidate = {
    deleteOperationId: 'a0000000-0000-4000-8000-000000000201',
    revisionSequence: 5,
    revisionLabel: 'REV_05',
    deletedRevisionId: 'a0000000-0000-4000-8000-000000000202',
    deletedAt: '2026-08-22T08:00:00.000Z',
  };

  it('shows no disabled reuse control when the server reports no candidate', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    expect(screen.queryByTestId('v4-reuse-revision')).not.toBeInTheDocument();
    expect(screen.getByTestId('v4-create-revision')).toBeInTheDocument();
  });

  it('keeps normal Create separate and requires a reason before explicit reuse', async () => {
    vi.mocked(api.revisionReuseEligibility).mockResolvedValue({ candidate });
    const replacement = revision(5, {
      revisionId: 'a0000000-0000-4000-8000-000000000203',
      revisionSequence: 5,
      revisionLabel: 'REV_05',
      lifecycleState: 'PREPARING',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      finalizedAt: null,
    });
    vi.mocked(api.reuseRevisionNumber).mockResolvedValue(replacement);

    renderPage();
    const reuse = await screen.findByTestId('v4-reuse-revision');
    expect(reuse).toHaveTextContent('Reuse REV_05');
    expect(screen.getByTestId('v4-create-revision')).toHaveTextContent('Create Revision');
    fireEvent.click(reuse);

    const dialog = screen.getByTestId('v4-reuse-confirm');
    expect(dialog).toHaveTextContent('Reuse deleted Revision number REV_05?');
    expect(dialog).toHaveTextContent('The deleted Revision history remains preserved.');
    const confirm = screen.getByTestId('v4-confirm-reuse');
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), {
      target: { value: '  Accidental duplicate Revision created  ' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.reuseRevisionNumber).toHaveBeenCalledWith('p1', {
        deleteOperationId: candidate.deleteOperationId,
        reason: '  Accidental duplicate Revision created  ',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('v4-revisions-tab-deliverables')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.queryByTestId('v4-reuse-confirm')).not.toBeInTheDocument();
  });

  it('surfaces a stale server rejection and refreshes the candidate instead of choosing another number', async () => {
    vi.mocked(api.revisionReuseEligibility).mockResolvedValue({ candidate });
    vi.mocked(api.reuseRevisionNumber).mockRejectedValue(
      new Error('The deleted Revision number is no longer reusable.'),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId('v4-reuse-revision'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'Stale candidate test' },
    });
    fireEvent.click(screen.getByTestId('v4-confirm-reuse'));
    await waitFor(() =>
      expect(screen.getByTestId('v4-revisions-notice')).toHaveTextContent('no longer reusable'),
    );
    expect(api.prepareRevision).not.toHaveBeenCalled();
    expect(screen.queryByTestId('v4-reuse-confirm')).not.toBeInTheDocument();
    expect(api.revisionReuseEligibility).toHaveBeenCalledTimes(2);
  });
});

/* ---------------------------------------------------------------------------
   Deliverables tab: unified read model, presence, discrimination.
   ------------------------------------------------------------------------- */

describe('deliverables tab', () => {
  it('shows a purposeful empty state when no Revision is selected', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-empty');
  });

  it('renders a mixed GeneratedOutput + DocumentSnapshot read with distinct source chips', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        sourceId: 'out-1',
        title: 'Luminaire Schedule',
        category: 'Luminaire Schedule',
        format: 'XLSX',
        outputFamily: 'LuminaireSchedule',
        presence: 'Present',
      }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        sourceId: 'doc-1',
        title: 'Lighting Layout',
        category: 'Drawing',
        fileName: 'Layout.dwg',
        format: null,
        outputFamily: null,
        presence: 'Missing',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    const table = await screen.findByTestId('v4-deliverables-table');

    expect(screen.getByTestId('v4-deliverable-row-gen-1')).toBeInTheDocument();
    expect(screen.getByTestId('v4-deliverable-row-snap-1')).toBeInTheDocument();
    // Source chips visually distinguish provenance.
    expect(table).toHaveTextContent('Generated Output');
    expect(table).toHaveTextContent('Registered File');
    // outputId identity retained for GeneratedOutput.
    expect(table).toHaveTextContent('hash-1');
    expect(table).toHaveTextContent('hash-2');
  });

  it('presence states Present/Missing/Unavailable render truthfully', async () => {
    const deliverables = [
      deliverable(1, { deliverableId: 'p1', presence: 'Present' }),
      deliverable(2, { deliverableId: 'm1', presence: 'Missing' }),
      deliverable(3, { deliverableId: 'u1', presence: 'Unavailable' }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    const table = await screen.findByTestId('v4-deliverables-table');
    expect(table).toHaveTextContent('Present');
    expect(table).toHaveTextContent('Missing');
    expect(table).toHaveTextContent('Unavailable');
  });

  it('a Missing deliverable row remains visible as historical metadata', async () => {
    const deliverables = [deliverable(1, { deliverableId: 'm1', presence: 'Missing' })];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');
    // Row stays visible (not hidden because the artifact is missing).
    expect(screen.getByTestId('v4-deliverable-row-m1')).toBeInTheDocument();
  });

  it('opens the Deliverable inspector with source-specific sections', async () => {
    const deliverables = [
      deliverable(1, { sourceType: 'GeneratedOutput', deliverableId: 'gen-1' }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        category: 'Drawing',
        contentHash: 'sha256-content',
        sizeBytes: 2048,
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');

    // GeneratedOutput inspector.
    fireEvent.click(screen.getByTestId('v4-deliverable-row-gen-1'));
    const genInspector = await screen.findByTestId('v4-deliverable-inspector');
    expect(genInspector).toHaveTextContent('Output');
    expect(genInspector).toHaveTextContent('Luminaire Schedule');

    // DocumentSnapshot inspector — SHA-256 truthful label + sections.
    fireEvent.click(screen.getByTestId('v4-deliverable-row-snap-1'));
    const snapInspector = await screen.findByTestId('v4-deliverable-inspector');
    expect(snapInspector).toHaveTextContent('Document Snapshot');
    expect(snapInspector).toHaveTextContent('Content Integrity');
    expect(snapInspector).toHaveTextContent('SHA-256');
    expect(snapInspector).toHaveTextContent('sha256-content');
    expect(snapInspector).toHaveTextContent('Provenance');
    // No raw JSON by default, no unsafe absolute path as primary UI.
    expect(snapInspector).not.toHaveTextContent(/"revisionId"/);
  });

  it('never offers Open for a DocumentSnapshot (no server-authoritative open path in B1)', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        presence: 'Present',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');
    fireEvent.click(screen.getByTestId('v4-deliverable-row-snap-1'));
    await screen.findByTestId('v4-deliverable-inspector');
    expect(screen.queryByTestId('v4-deliverable-artifact-open')).not.toBeInTheDocument();
  });

  it('keeps deliverables inspector horizontally safe and Advanced Metadata collapsed by default', async () => {
    const deliverables = [deliverable(1, { deliverableId: 'gen-1' })];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');
    fireEvent.click(screen.getByTestId('v4-deliverable-row-gen-1'));
    await screen.findByTestId('v4-deliverable-inspector');

    const toggle = screen.getByTestId('v4-deliverable-advanced-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('v4-deliverable-advanced-body')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('v4-deliverable-advanced-body')).toHaveTextContent('Content Hash');
  });
});

/* ---------------------------------------------------------------------------
   Add / Remove / Finalize workflow (B0 authority).
   ------------------------------------------------------------------------- */

function renderPreparingRevision(
  deliverables: RevisionDeliverable[] = [],
  datasheets: DatasheetEligibilityItem[] = [],
) {
  const preparing = revision(5, {
    lifecycleState: 'PREPARING',
    projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
  });
  const workspace = {
    projectId: 'p1',
    revisions: [],
    documents: [
      {
        id: 'doc-1',
        projectId: 'p1',
        category: 'Drawing',
        documentNumber: 'D-01',
        title: 'Lighting Layout',
        revision: 'A',
        status: 'Current',
        filePath: 'drawings/Layout.dwg',
        issuedTo: '',
        issueDate: null,
        notes: '',
        createdAt: '2026-08-01T09:00:00Z',
        updatedAt: '2026-08-01T09:00:00Z',
      },
    ],
  } as unknown as ProjectWorkspace;
  seedApi({ revisions: [preparing], outputs: [], deliverables, datasheets, workspace });
  return preparing;
}

/** Datasheet eligibility fixture. */
function datasheetItem(
  id: string,
  overrides: Partial<DatasheetEligibilityItem> = {},
): DatasheetEligibilityItem {
  return {
    assetVersionId: id,
    luminaireId: `lum-${id}`,
    tag: 'DL01',
    manufacturer: 'Scientechnic',
    model: 'DLX',
    versionSequence: 1,
    fileName: 'datasheet-DL01.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    fileHash: `hash-${id}`,
    integrityStatus: 'VERIFIED',
    alreadyInRevision: false,
    eligible: true,
    reason: 'Verified and available to add to this Revision.',
    ...overrides,
  };
}

describe('manual workflow', () => {
  it('shows Add Deliverable and Finalize disabled only for PREPARING revisions', async () => {
    renderPreparingRevision();
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    const inspector = await screen.findByTestId('v4-revision-inspector');
    expect(inspector).toHaveTextContent('PREPARING');
    expect(screen.getByTestId('v4-revision-add-deliverable')).toBeInTheDocument();
    // Zero Deliverables → Finalize disabled with understandable reason.
    expect(screen.getByTestId('v4-revision-finalize-disabled')).toHaveTextContent(
      'Add at least one Deliverable before finalizing.',
    );
  });

  it('Add Deliverable drawer offers registered Project Documents and sends sourceDocumentId only', async () => {
    const preparing = renderPreparingRevision();
    const snapshot = {
      deliverableId: 'snap-new',
      projectId: 'p1',
      revisionId: preparing.revisionId,
      sourceType: 'ProjectDocument' as const,
      sourceDocumentId: 'doc-1',
      category: 'Drawing',
      title: 'Lighting Layout',
      fileName: 'Lighting Layout.dwg',
      sourceRelativePath: 'drawings/Layout.dwg',
      locatorKind: 'PROJECT_RELATIVE' as const,
      locatorValue: 'DELIVERABLES/REV_05/Lighting Layout.dwg',
      contentHash: 'snap-hash',
      sizeBytes: 2048,
      sourceAssetVersionId: null,
      sourceArtifactVersionId: null,
      createdById: 'u1',
      createdByName: 'Maha',
      createdAt: new Date().toISOString(),
    };
    vi.mocked(api.addRevisionDeliverable).mockResolvedValue(snapshot);

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));

    const drawer = await screen.findByRole('dialog', { name: 'Add Deliverable' });
    expect(drawer).toHaveTextContent('Add Deliverable');
    // Registered document offered as a source option.
    expect(screen.getByRole('checkbox', { name: 'Select Lighting Layout' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lighting Layout' }));
    // The optional display-title textbox is valid; no arbitrary filesystem
    // path input is offered.
    expect(screen.getByRole('textbox', { name: /Display title/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /file path/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('v4-add-deliverable-submit'));

    await waitFor(() =>
      expect(api.addRevisionDeliverable).toHaveBeenCalledWith(
        'p1',
        preparing.revisionId,
        expect.objectContaining({ sourceDocumentId: 'doc-1' }),
      ),
    );
    // Body must not carry a client-provided revisionId.
    const call = vi.mocked(api.addRevisionDeliverable).mock.calls[0]!;
    expect(call[2]).not.toHaveProperty('revisionId');
  });

  it('surfaces the same-basename conflict from the server truthfully', async () => {
    renderPreparingRevision();
    vi.mocked(api.addRevisionDeliverable).mockRejectedValue(
      new Error('A Deliverable with this filename already exists in this Revision.'),
    );

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('checkbox', { name: 'Select Lighting Layout' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lighting Layout' }));
    fireEvent.click(screen.getByTestId('v4-add-deliverable-submit'));

    // The conflict is surfaced; no success is claimed.
    expect(
      await within(screen.getByRole('dialog', { name: 'Add Deliverable' })).findByText(
        'A Deliverable with this filename already exists in this Revision.',
      ),
    ).toBeInTheDocument();
  });

  it('Remove is offered only for PREPARING DocumentSnapshots and never for GeneratedOutput', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        revisionId: 'rev-5',
      }),
      deliverable(2, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        revisionId: 'rev-5',
      }),
    ];
    renderPreparingRevision(deliverables);
    vi.mocked(api.removeRevisionDeliverable).mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    // DocumentSnapshot has Remove (await the async Deliverables read).
    expect(await screen.findByTestId('v4-remove-deliverable-snap-1')).toBeInTheDocument();
    // GeneratedOutput has NO Remove through this path.
    expect(screen.queryByTestId('v4-remove-deliverable-gen-1')).not.toBeInTheDocument();
  });

  it('removes a PREPARING DocumentSnapshot after confirmation, without implying source deletion', async () => {
    const preparing = renderPreparingRevision([
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        revisionId: 'rev-5',
      }),
    ]);
    vi.mocked(api.removeRevisionDeliverable).mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(await screen.findByTestId('v4-remove-deliverable-snap-1'));

    const confirm = await screen.findByTestId('v4-remove-confirm');
    expect(confirm).toHaveTextContent('does not delete the original registered project document');
    fireEvent.click(screen.getByTestId('v4-confirm-remove'));

    await waitFor(() =>
      expect(api.removeRevisionDeliverable).toHaveBeenCalledWith(
        'p1',
        preparing.revisionId,
        'snap-1',
      ),
    );
  });

  it('FINALIZED Revision has no Add/Remove/Finalize workflow', async () => {
    seedApi({
      revisions: [revision(1, { lifecycleState: 'FINALIZED' })],
      outputs: [],
      deliverables: [],
    });
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    expect(screen.queryByTestId('v4-revision-add-deliverable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-revision-finalize')).not.toBeInTheDocument();
    expect(screen.getByTestId('v4-revision-finalized-readonly')).toHaveTextContent(
      'finalized and immutable',
    );
    // No remove controls for finalized deliverables.
    expect(screen.queryByTestId(/v4-remove-deliverable-/)).not.toBeInTheDocument();
  });

  it('finalizes a PREPARING Revision with >=1 Deliverable via the B0 method', async () => {
    const finalized = revision(5, {
      lifecycleState: 'FINALIZED',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    renderPreparingRevision([
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        revisionId: 'rev-5',
      }),
    ]);
    vi.mocked(api.finalizeRevision).mockResolvedValue(finalized);

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');

    const finalize = await screen.findByTestId('v4-revision-finalize');
    expect(finalize).toBeEnabled();
    fireEvent.click(finalize);
    expect(api.finalizeRevision).not.toHaveBeenCalled();
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Finalize Revision' })).getByRole('button', {
        name: 'Finalize',
      }),
    );

    await waitFor(() => expect(api.finalizeRevision).toHaveBeenCalledWith('p1', 'rev-5'));
    // Inspector reflects immutability after finalization.
    await waitFor(() =>
      expect(screen.getByTestId('v4-revision-finalized-readonly')).toBeInTheDocument(),
    );
    expect(api.prepareRevision).not.toHaveBeenCalled();
  });

  it('never issues a Package or Submission side effect during any workflow', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    // No Package/Submission/Issue package creation is invoked or offered as a
    // Revision action (the sidebar may still label navigation to other pages).
    expect(api.prepareRevision).not.toHaveBeenCalled();
    expect(screen.queryByText('Create Package')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Submission')).not.toBeInTheDocument();
    expect(screen.queryByText('Issue Package')).not.toBeInTheDocument();
  });

  it('create Revision rejection surfaces a UI error without an unhandled rejection', async () => {
    vi.mocked(api.prepareRevision).mockRejectedValue(
      new Error('Failed to prepare the manual Revision.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-create-revision'));
    fireEvent.click(screen.getByTestId('v4-confirm-create-revision'));

    expect(await screen.findByText('Failed to prepare the manual Revision.')).toBeInTheDocument();
    // No false success: still on the Revisions tab, no new revision selected.
    expect(screen.getByTestId('v4-revisions-tab-revisions')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('finalize rejection surfaces a UI error without an unhandled rejection', async () => {
    renderPreparingRevision([
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        revisionId: 'rev-5',
      }),
    ]);
    vi.mocked(api.finalizeRevision).mockRejectedValue(
      new Error('Finalize was refused by the server.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');

    fireEvent.click(await screen.findByTestId('v4-revision-finalize'));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Finalize Revision' })).getByRole('button', {
        name: 'Finalize',
      }),
    );

    expect(await screen.findByText('Finalize was refused by the server.')).toBeInTheDocument();
    // Still PREPARING (no false success).
    expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('PREPARING');
  });

  it('remove rejection surfaces a UI error without an unhandled rejection', async () => {
    renderPreparingRevision([
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        revisionId: 'rev-5',
      }),
    ]);
    vi.mocked(api.removeRevisionDeliverable).mockRejectedValue(
      new Error('Remove failed: snapshot is already finalized.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(await screen.findByTestId('v4-remove-deliverable-snap-1'));
    await screen.findByTestId('v4-remove-confirm');
    fireEvent.click(screen.getByTestId('v4-confirm-remove'));

    expect(
      await screen.findByText('Remove failed: snapshot is already finalized.'),
    ).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   PACKAGES-E2E-05A — Datasheet intake UI (source tabs, eligibility, mutation).
   ------------------------------------------------------------------------- */

describe('datasheet intake UI', () => {
  it('Datasheets section appears in Add Deliverable drawer and shows Tag / Manufacturer / Model / Version / Status', async () => {
    renderPreparingRevision(
      [],
      [datasheetItem('ds-1', { tag: 'DL01' }), datasheetItem('ds-2', { tag: 'DL02' })],
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('dialog', { name: 'Add Deliverable' });

    // Tab exists and is selectable.
    const datasheetTab = screen.getByTestId('v4-add-deliverable-tab-datasheets');
    expect(datasheetTab).toHaveTextContent('Datasheets');
    fireEvent.click(datasheetTab);

    const list = await screen.findByRole('group', { name: 'Datasheets' });
    expect(list).toHaveTextContent('DL01');
    expect(list).toHaveTextContent('DL02');
    expect(list).toHaveTextContent('Scientechnic');
    expect(list).toHaveTextContent('DLX');
    expect(list).toHaveTextContent('v1');
  });

  it('eligible item is enabled; Legacy Unverified / Missing / Hash Mismatch / Already Added are disabled', async () => {
    renderPreparingRevision(
      [],
      [
        datasheetItem('ds-ok', { tag: 'DL01' }),
        datasheetItem('ds-legacy', {
          tag: 'DL02',
          fileHash: null,
          integrityStatus: 'LEGACY_UNVERIFIED',
          eligible: false,
        }),
        datasheetItem('ds-missing', {
          tag: 'DL03',
          integrityStatus: 'MISSING',
          eligible: false,
        }),
        datasheetItem('ds-changed', {
          tag: 'DL04',
          integrityStatus: 'HASH_MISMATCH',
          eligible: false,
        }),
        datasheetItem('ds-added', {
          tag: 'DL05',
          integrityStatus: 'ALREADY_ADDED',
          eligible: false,
          alreadyInRevision: true,
        }),
      ],
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('dialog', { name: 'Add Deliverable' });
    fireEvent.click(screen.getByTestId('v4-add-deliverable-tab-datasheets'));
    await screen.findByRole('group', { name: 'Datasheets' });

    expect(screen.getByTestId('v4-datasheet-item-ds-ok')).toBeEnabled();
    expect(screen.getByTestId('v4-datasheet-item-ds-legacy')).toBeDisabled();
    expect(screen.getByTestId('v4-datasheet-item-ds-missing')).toBeDisabled();
    expect(screen.getByTestId('v4-datasheet-item-ds-changed')).toBeDisabled();
    expect(screen.getByTestId('v4-datasheet-item-ds-added')).toBeDisabled();
    // Status labels render truthfully.
    expect(screen.getByTestId('v4-datasheet-status-ds-ok')).toHaveTextContent('Available');
    expect(screen.getByTestId('v4-datasheet-status-ds-legacy')).toHaveTextContent(
      'Legacy Unverified',
    );
    expect(screen.getByTestId('v4-datasheet-status-ds-missing')).toHaveTextContent('Missing');
    expect(screen.getByTestId('v4-datasheet-status-ds-changed')).toHaveTextContent('Hash Mismatch');
    expect(screen.getByTestId('v4-datasheet-status-ds-added')).toHaveTextContent('Already Added');
  });

  it('add mutation sends assetVersionId only and updates Revision Deliverables without manual Refresh', async () => {
    const preparing = renderPreparingRevision([], [datasheetItem('ds-ok', { tag: 'DL01' })]);
    const snapshot = {
      deliverableId: 'snap-ds',
      projectId: 'p1',
      revisionId: preparing.revisionId,
      sourceType: 'LuminaireAssetVersion' as const,
      sourceDocumentId: null,
      sourceAssetVersionId: 'ds-ok',
      sourceArtifactVersionId: null,
      category: 'Datasheet',
      title: 'DL01 Datasheet',
      fileName: 'datasheet-DL01.pdf',
      sourceRelativePath: 'datasheet-DL01.pdf',
      locatorKind: 'PROJECT_RELATIVE' as const,
      locatorValue: 'DELIVERABLES/REV_05/datasheet-DL01.pdf',
      contentHash: 'hash-ds-ok',
      sizeBytes: 2048,
      createdById: 'u1',
      createdByName: 'Maha',
      createdAt: new Date().toISOString(),
    };
    vi.mocked(api.addDatasheetDeliverable).mockResolvedValue(snapshot);

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('dialog', { name: 'Add Deliverable' });
    fireEvent.click(screen.getByTestId('v4-add-deliverable-tab-datasheets'));
    fireEvent.click(await screen.findByTestId('v4-datasheet-item-ds-ok'));
    fireEvent.click(screen.getByTestId('v4-add-deliverable-submit'));

    await waitFor(() =>
      expect(api.addDatasheetDeliverable).toHaveBeenCalledWith(
        'p1',
        preparing.revisionId,
        expect.objectContaining({ assetVersionId: 'ds-ok' }),
      ),
    );
    // Body carries ONLY assetVersionId — no revisionId/path/hash/metadata.
    const call = vi.mocked(api.addDatasheetDeliverable).mock.calls[0]!;
    expect(call[2]).toEqual({ assetVersionId: 'ds-ok' });
    // The Deliverables read is refreshed (no manual Refresh).
    await waitFor(() => expect(api.revisionDeliverables).toHaveBeenCalled());
  });

  it('uses the exact selected Revision UUID for intake', async () => {
    const prepared = renderPreparingRevision([], [datasheetItem('ds-ok', { tag: 'DL01' })]);
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('dialog', { name: 'Add Deliverable' });
    fireEvent.click(screen.getByTestId('v4-add-deliverable-tab-datasheets'));
    fireEvent.click(await screen.findByTestId('v4-datasheet-item-ds-ok'));
    fireEvent.click(screen.getByTestId('v4-add-deliverable-submit'));

    await waitFor(() =>
      expect(api.addDatasheetDeliverable).toHaveBeenCalledWith(
        'p1',
        prepared.revisionId,
        expect.any(Object),
      ),
    );
  });
});

/* ---------------------------------------------------------------------------
   Deliverables filters.
   ------------------------------------------------------------------------- */

describe('deliverables filters', () => {
  it('filters by source, type, format, and artifact state with specific All labels', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        category: 'Luminaire Schedule',
        format: 'XLSX',
        presence: 'Present',
      }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        category: 'Drawing',
        format: null,
        fileName: 'Layout.dwg',
        presence: 'Missing',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');

    // Specific "All Sources" label.
    const sourceTrigger = screen.getByRole('button', { name: 'Filter by source' });
    expect(sourceTrigger).toHaveTextContent('All Sources');

    // Source filter → DocumentSnapshot only.
    fireEvent.click(sourceTrigger);
    fireEvent.click(screen.getByRole('option', { name: 'DocumentSnapshot' }));
    await waitFor(() => {
      expect(screen.getByTestId('v4-deliverable-row-snap-1')).toBeInTheDocument();
      expect(screen.queryByTestId('v4-deliverable-row-gen-1')).not.toBeInTheDocument();
    });

    // Clear and filter by format.
    fireEvent.click(screen.getByTestId('v4-filters-clear'));
    fireEvent.click(screen.getByRole('button', { name: 'Filter by format' }));
    fireEvent.click(screen.getByRole('option', { name: 'XLSX' }));
    await waitFor(() => {
      expect(screen.getByTestId('v4-deliverable-row-gen-1')).toBeInTheDocument();
      expect(screen.queryByTestId('v4-deliverable-row-snap-1')).not.toBeInTheDocument();
    });
  });

  it('shows the filtered-empty state when filters match nothing', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        format: 'XLSX',
        presence: 'Present',
      }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-1',
        format: null,
        fileName: 'Layout.dwg',
        presence: 'Present',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');

    // Narrow to the DocumentSnapshot source, then to a format only the
    // GeneratedOutput carries → no row matches both filters.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by source' }));
    fireEvent.click(screen.getByRole('option', { name: 'DocumentSnapshot' }));
    await waitFor(() =>
      expect(screen.getByTestId('v4-deliverable-row-snap-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter by format' }));
    fireEvent.click(screen.getByRole('option', { name: 'XLSX' }));
    expect(await screen.findByTestId('v4-deliverables-filtered-empty')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   Recovery tab: GeneratedOutput recovery retained, no fake snapshot recovery.
   ------------------------------------------------------------------------- */

describe('recovery tab', () => {
  it('retains GeneratedOutput recovery and never fabricates DocumentSnapshot recovery', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-recovery'));

    const table = await screen.findByTestId('v4-recovery-table');
    // Existing canonical Output recovery remains.
    expect(screen.getByTestId('v4-recovery-retry-rev-3')).toBeInTheDocument();
    // No DocumentSnapshot recovery lifecycle is fabricated.
    expect(table).not.toHaveTextContent('DocumentSnapshot');
  });
});

/* ---------------------------------------------------------------------------
   Viewport / scroll contract preserved (structural, no document X overflow).
   ------------------------------------------------------------------------- */

describe('viewport', () => {
  it('keeps the bounded main card and inspector (no document X overflow ownership)', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-main');
    expect(screen.getByTestId('v4-revisions-main')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   Selected-Revision scoping (Owner UAT Finding 1).
   ------------------------------------------------------------------------- */

describe('deliverables selected-revision scoping', () => {
  it('select REV_02 → Deliverables displays only REV_02 rows', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-2',
        revisionId: 'rev-2',
        title: 'Schedule 02',
      }),
      deliverable(2, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        revisionId: 'rev-1',
        title: 'Schedule 01',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-2'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    const table = await screen.findByTestId('v4-deliverables-table');
    expect(screen.getByTestId('v4-deliverable-row-gen-2')).toBeInTheDocument();
    // REV_01's row must NOT appear under REV_02 selection.
    expect(screen.queryByTestId('v4-deliverable-row-gen-1')).not.toBeInTheDocument();
    expect(table).not.toHaveTextContent('Schedule 01');
  });

  it('select REV_07 with zero Deliverables → REV_02 rows disappear, no project-wide fallback', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-2',
        revisionId: 'rev-2',
        title: 'Schedule 02',
      }),
      deliverable(2, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        revisionId: 'rev-1',
        title: 'Schedule 01',
      }),
    ];
    // REV_07 is PREPARING manual with zero Deliverables.
    const rev7 = revision(7, {
      lifecycleState: 'PREPARING',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    seedApi({ revisions: [rev7, revision(2)], deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-7'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    // REV_02 rows must not appear under REV_07 selection.
    expect(await screen.findByTestId('v4-deliverables-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('v4-deliverable-row-gen-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-deliverable-row-gen-1')).not.toBeInTheDocument();
    // Actionable PREPARING empty state with Add Deliverable.
    expect(
      screen.getByText('No Deliverables have been added to this Revision yet.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('v4-deliverables-empty-add')).toBeInTheDocument();
  });

  it('every displayed Deliverable row revisionId matches the selected Revision', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-2a',
        revisionId: 'rev-2',
        title: 'Schedule A',
      }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-2',
        revisionId: 'rev-2',
        title: 'Drawing B',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-2'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    const table = await screen.findByTestId('v4-deliverables-table');
    for (const id of ['gen-2a', 'snap-2']) {
      const row = screen.getByTestId(`v4-deliverable-row-${id}`);
      expect(row).toBeInTheDocument();
      // The Revision column shows REV_02 for every row.
      expect(row).toHaveTextContent('R02');
    }
    expect(table).not.toHaveTextContent('R01');
  });

  it('changing selected Revision updates the deliverables query key', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        revisionId: 'rev-1',
        title: 'Schedule 01',
      }),
      deliverable(2, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-2',
        revisionId: 'rev-2',
        title: 'Schedule 02',
      }),
    ];
    seedApi({ deliverables });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');

    // Switch back to Revisions and select REV_02.
    fireEvent.click(screen.getByTestId('v4-revisions-tab-revisions'));
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-2'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    // Only REV_02 row remains.
    await waitFor(() => {
      expect(screen.getByTestId('v4-deliverable-row-gen-2')).toBeInTheDocument();
      expect(screen.queryByTestId('v4-deliverable-row-gen-1')).not.toBeInTheDocument();
    });
  });

  it('no project-wide outputs fallback when the selected Revision read returns []', async () => {
    // deliverables query returns [] for the selected revision; a project-wide
    // GeneratedOutput (richOutputs) exists but must NOT leak into the table.
    const deliverables: RevisionDeliverable[] = [];
    seedApi({ deliverables, outputs: richOutputs() });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    // REV_01 is FINALIZED historical zero-deliverable → valid historical empty.
    expect(await screen.findByTestId('v4-deliverables-empty')).toBeInTheDocument();
    expect(
      screen.getByText('This Revision has no registered Deliverables — a valid historical state.'),
    ).toBeInTheDocument();
    // No GeneratedOutput rows leak from the project-wide outputs read.
    expect(screen.queryByTestId(/v4-deliverable-row-/)).not.toBeInTheDocument();
  });

  it('FINALIZED historical zero-deliverable shows valid historical empty state', async () => {
    seedApi({ revisions: [revision(1)], outputs: [], deliverables: [] });

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));

    expect(
      await screen.findByText(
        'This Revision has no registered Deliverables — a valid historical state.',
      ),
    ).toBeInTheDocument();
    // No Add Deliverable action for a FINALIZED revision.
    expect(screen.queryByTestId('v4-deliverables-empty-add')).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   Recovery error ownership (Owner UAT Finding 2).
   ------------------------------------------------------------------------- */

describe('recovery error ownership', () => {
  it('malformed Schedule recovery metadata does not produce a global banner on Revisions tab', async () => {
    vi.mocked(api.generateLuminaireSchedule).mockRejectedValue(
      new Error('Stored Schedule recovery format is missing or invalid.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    // Trigger a schedule recovery from the Revisions tab retry.
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-3'));
    await screen.findByTestId('v4-revision-inspector');
    const retry = screen.getByTestId('v4-revision-retry-rev-3');
    fireEvent.click(retry);

    await waitFor(() => expect(api.generateLuminaireSchedule).toHaveBeenCalled());
    // No global banner on the Revisions tab.
    expect(screen.queryByTestId('v4-revisions-notice')).not.toBeInTheDocument();
    // Page still usable.
    expect(screen.getByTestId('v4-revisions-table')).toBeInTheDocument();
  });

  it('same condition does not produce a global banner on Deliverables tab', async () => {
    vi.mocked(api.generateLuminaireSchedule).mockRejectedValue(
      new Error('Stored Schedule recovery format is missing or invalid.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-empty');

    expect(screen.queryByTestId('v4-revisions-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-recovery-error')).not.toBeInTheDocument();
  });

  it('Recovery tab exposes the specific recovery problem truthfully', async () => {
    vi.mocked(api.generateLuminaireSchedule).mockRejectedValue(
      new Error('Stored Schedule recovery format is missing or invalid.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-revisions-tab-recovery'));
    await screen.findByTestId('v4-recovery-table');
    // Trigger the retry on the recovery row for rev-3 (owns LuminaireSchedule).
    fireEvent.click(screen.getByTestId('v4-recovery-retry-rev-3'));

    await waitFor(() => expect(api.generateLuminaireSchedule).toHaveBeenCalled());
    // Recovery-scoped error surfaces on the Recovery tab.
    expect(await screen.findByTestId('v4-recovery-error')).toHaveTextContent(
      'Stored Schedule recovery format is missing or invalid.',
    );
  });

  it('normal revision and deliverable reads remain usable after a recovery error', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        revisionId: 'rev-1',
        title: 'Schedule 01',
      }),
    ];
    seedApi({ deliverables });
    vi.mocked(api.generateLuminaireSchedule).mockRejectedValue(
      new Error('Stored Schedule recovery format is missing or invalid.'),
    );

    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
    await screen.findByTestId('v4-deliverables-table');
    expect(screen.getByTestId('v4-deliverable-row-gen-1')).toBeInTheDocument();
  });

  it('mutation errors still render correctly after recovery scoping', async () => {
    renderPreparingRevision();
    vi.mocked(api.addRevisionDeliverable).mockRejectedValue(
      new Error('A Deliverable with this filename already exists in this Revision.'),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-5'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-revision-add-deliverable'));
    await screen.findByRole('checkbox', { name: 'Select Lighting Layout' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lighting Layout' }));
    fireEvent.click(screen.getByTestId('v4-add-deliverable-submit'));

    // Mutation operation error still surfaces via the global operation notice.
    expect(
      await within(screen.getByRole('dialog', { name: 'Add Deliverable' })).findByText(
        'A Deliverable with this filename already exists in this Revision.',
      ),
    ).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   Artifact Open gating (Owner UAT Finding 3).
   ------------------------------------------------------------------------- */

describe('deliverables artifact open gating', () => {
  function openDeliverablesTab() {
    return (async () => {
      await screen.findByTestId('v4-revisions-table');
      fireEvent.click(screen.getByTestId('v4-revision-row-rev-1'));
      await screen.findByTestId('v4-revision-inspector');
      fireEvent.click(screen.getByTestId('v4-revisions-tab-deliverables'));
      await screen.findByTestId('v4-deliverables-table');
    })();
  }

  it('GeneratedOutput Present + valid open path → Open exists', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        sourceId: 'gen-1',
        presence: 'Present',
        outputFamily: 'LuminaireSchedule',
      }),
    ];
    seedApi({
      deliverables,
      outputs: [
        output(1, {
          outputId: 'gen-1',
          revisionId: 'rev-1',
          artifactPresence: 'Present',
          artifactOpenPath: '/p/out.xlsx',
        }),
      ],
    });
    renderPage();
    await openDeliverablesTab();
    expect(screen.getByTestId('v4-open-deliverable-gen-1')).toBeInTheDocument();
  });

  it('GeneratedOutput Missing → Open absent', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        sourceId: 'gen-1',
        presence: 'Missing',
        outputFamily: 'LuminaireSchedule',
      }),
    ];
    seedApi({
      deliverables,
      outputs: [
        output(1, {
          outputId: 'gen-1',
          revisionId: 'rev-1',
          artifactPresence: 'Missing',
          artifactOpenPath: null,
        }),
      ],
    });
    renderPage();
    await openDeliverablesTab();
    expect(screen.queryByTestId('v4-open-deliverable-gen-1')).not.toBeInTheDocument();
  });

  it('GeneratedOutput Unavailable → Open absent', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        sourceId: 'gen-1',
        presence: 'Unavailable',
        outputFamily: 'LuminaireSchedule',
      }),
    ];
    seedApi({
      deliverables,
      outputs: [
        output(1, {
          outputId: 'gen-1',
          revisionId: 'rev-1',
          artifactPresence: 'Unavailable',
          artifactOpenPath: null,
        }),
      ],
    });
    renderPage();
    await openDeliverablesTab();
    expect(screen.queryByTestId('v4-open-deliverable-gen-1')).not.toBeInTheDocument();
  });

  it('GeneratedOutput Present but no safe open path → Open absent', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'GeneratedOutput',
        deliverableId: 'gen-1',
        sourceId: 'gen-1',
        presence: 'Present',
        outputFamily: 'LuminaireSchedule',
      }),
    ];
    seedApi({
      deliverables,
      outputs: [
        output(1, {
          outputId: 'gen-1',
          revisionId: 'rev-1',
          artifactPresence: 'Present',
          artifactOpenPath: null,
        }),
      ],
    });
    renderPage();
    await openDeliverablesTab();
    expect(screen.queryByTestId('v4-open-deliverable-gen-1')).not.toBeInTheDocument();
  });

  it('DocumentSnapshot opens only when its saved artifact is Present', async () => {
    const deliverables = [
      deliverable(1, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-p',
        presence: 'Present',
      }),
      deliverable(2, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-m',
        presence: 'Missing',
      }),
      deliverable(3, {
        sourceType: 'DocumentSnapshot',
        deliverableId: 'snap-u',
        presence: 'Unavailable',
      }),
    ];
    seedApi({ deliverables, outputs: [] });
    renderPage();
    await openDeliverablesTab();
    for (const id of ['snap-p', 'snap-m', 'snap-u']) {
      expect(screen.getByTestId(`v4-deliverable-row-${id}`)).toBeInTheDocument();
      if (id === 'snap-p') expect(screen.getByTestId(`v4-open-deliverable-${id}`)).toBeEnabled();
      else expect(screen.queryByTestId(`v4-open-deliverable-${id}`)).not.toBeInTheDocument();
    }
  });
});

/* ---------------------------------------------------------------------------
   Revisions table header + Create Revision double-submit.
   ------------------------------------------------------------------------- */

describe('revisions table label + create double-submit', () => {
  it('header is "Generated Outputs" and no plain "Outputs" header remains', async () => {
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    const table = screen.getByTestId('v4-revisions-table');
    expect(table).toHaveTextContent('Generated Outputs');
    // No standalone Outputs column header.
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).not.toContain('Outputs');
  });

  it('one confirmation issues exactly one prepareRevision call', async () => {
    const preparing = revision(6, {
      lifecycleState: 'PREPARING',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    vi.mocked(api.prepareRevision).mockResolvedValue(preparing);
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-create-revision'));
    fireEvent.click(screen.getByTestId('v4-confirm-create-revision'));
    await waitFor(() => expect(api.prepareRevision).toHaveBeenCalledTimes(1));
  });

  it('repeated click while creation is pending cannot issue a second request', async () => {
    const preparing = revision(6, {
      lifecycleState: 'PREPARING',
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    // Hold the promise so the mutation stays pending.
    let resolvePrepare!: (value: CanonicalRevisionRecord) => void;
    vi.mocked(api.prepareRevision).mockImplementation(
      () => new Promise<CanonicalRevisionRecord>((resolve) => (resolvePrepare = resolve)),
    );
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    const btn = screen.getByTestId('v4-create-revision');
    fireEvent.click(btn);
    const confirm = screen.getByTestId('v4-confirm-create-revision');
    fireEvent.click(confirm);
    // While pending the button is disabled; a second click is a no-op.
    await waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.click(confirm);
    expect(api.prepareRevision).toHaveBeenCalledTimes(1);

    resolvePrepare(preparing);
    await waitFor(() => expect(api.prepareRevision).toHaveBeenCalledTimes(1));
  });
});

/* ---------------------------------------------------------------------------
   C1 — Generate Output navigates INTO the selected composed Revision.
   ------------------------------------------------------------------------- */

const COMPOSED_PREPARING = () =>
  revision(7, {
    revisionId: 'rev-7',
    lifecycleState: 'PREPARING',
    finalizedAt: null,
    projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
  });

async function selectRevisionRow(revisionId: string) {
  await screen.findByTestId('v4-revisions-table');
  fireEvent.click(screen.getByTestId(`v4-revision-row-${revisionId}`));
  await screen.findByTestId('v4-revision-inspector');
}

describe('composition target navigation (C1)', () => {
  it('carries the selected PREPARING composed Revision to the Schedule workspace', async () => {
    seedApi({ revisions: [revision(1), COMPOSED_PREPARING()], outputs: [] });
    renderPage();
    await selectRevisionRow('rev-7');

    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    // The menu states the target instead of silently changing what the items do.
    expect(screen.getByTestId('v4-generate-output-scope')).toHaveTextContent('Generating into R07');
    fireEvent.click(screen.getByTestId('v4-generate-output-option-schedule'));

    const landed = await screen.findByTestId('v4-nav-luminaire-schedule');
    expect(landed).toHaveAttribute('data-search', '?targetRevisionId=rev-7');
  });

  it('carries the same target to the BOQ workspace', async () => {
    seedApi({ revisions: [revision(1), COMPOSED_PREPARING()], outputs: [] });
    renderPage();
    await selectRevisionRow('rev-7');

    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    fireEvent.click(screen.getByTestId('v4-generate-output-option-boq'));

    const landed = await screen.findByTestId('v4-nav-technical-boq');
    expect(landed).toHaveAttribute('data-search', '?targetRevisionId=rev-7');
  });

  it('offers exactly the same two options when a target is selected', async () => {
    seedApi({ revisions: [revision(1), COMPOSED_PREPARING()], outputs: [] });
    renderPage();
    await selectRevisionRow('rev-7');

    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    const menu = screen.getByTestId('v4-generate-output-menu');
    expect(menu.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByTestId('v4-generate-output-option-schedule')).toHaveTextContent(
      'Luminaire Schedule',
    );
    expect(screen.getByTestId('v4-generate-output-option-boq')).toHaveTextContent('Technical BOQ');
  });

  it('defaults to the single PREPARING composed Revision when nothing is selected', async () => {
    seedApi({ revisions: [revision(1), COMPOSED_PREPARING()], outputs: [] });
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    // The single composable target is the default even with no row selected.
    expect(screen.getByTestId('v4-generate-output-scope')).toHaveTextContent('Generating into R07');
    fireEvent.click(screen.getByTestId('v4-generate-output-option-schedule'));

    const landed = await screen.findByTestId('v4-nav-luminaire-schedule');
    expect(landed).toHaveAttribute('data-search', '?targetRevisionId=rev-7');
  });

  it('never targets a FINALIZED, generated-output, or register-only Revision', async () => {
    const ineligible: CanonicalRevisionRecord[] = [
      // FINALIZED composed Revision: immutable.
      revision(11, {
        revisionId: 'rev-11',
        lifecycleState: 'FINALIZED',
        projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      }),
      // PREPARING, but owned by a generation run, not a composition.
      revision(12, {
        revisionId: 'rev-12',
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' },
      }),
      revision(13, {
        revisionId: 'rev-13',
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        projectSnapshot: { canonicalOperation: 'REGISTER_ONLY' },
      }),
      // Composed and PREPARING, but not canonical provenance.
      revision(14, {
        revisionId: 'rev-14',
        lifecycleState: 'PREPARING',
        finalizedAt: null,
        provenanceClassification: 'LEGACY_VERIFIED',
        projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
      }),
    ];
    seedApi({ revisions: ineligible, outputs: [] });
    renderPage();
    await screen.findByTestId('v4-revisions-table');
    for (const revisionId of ['rev-11', 'rev-12', 'rev-13', 'rev-14']) {
      fireEvent.click(screen.getByTestId(`v4-revision-row-${revisionId}`));
      await screen.findByTestId('v4-revision-inspector');
      fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
      expect(screen.queryByTestId('v4-generate-output-scope')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    }

    // No composable target exists, so the menu shows guidance and the option is
    // disabled — it never navigates to a standalone generation.
    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    expect(screen.getByTestId('v4-generate-output-empty')).toHaveTextContent(
      'Create or select a PREPARING Revision before generating outputs.',
    );
    expect(screen.getByTestId('v4-generate-output-option-schedule')).toBeDisabled();
    fireEvent.click(screen.getByTestId('v4-generate-output-option-schedule'));
    expect(screen.queryByTestId('v4-nav-luminaire-schedule')).not.toBeInTheDocument();
  });

  it('allows explicit selection among multiple PREPARING composed Revisions by exact UUID', async () => {
    const revA = COMPOSED_PREPARING();
    const revB = revision(8, {
      revisionId: 'rev-8',
      lifecycleState: 'PREPARING',
      finalizedAt: null,
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    seedApi({ revisions: [revision(1), revA, revB], outputs: [] });
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    // Select rev-8 explicitly; the menu must carry rev-8's exact UUID.
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-8'));
    await screen.findByTestId('v4-revision-inspector');
    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    expect(screen.getByTestId('v4-generate-output-scope')).toHaveTextContent('Generating into R08');
    fireEvent.click(screen.getByTestId('v4-generate-output-option-schedule'));

    const landed = await screen.findByTestId('v4-nav-luminaire-schedule');
    expect(landed).toHaveAttribute('data-search', '?targetRevisionId=rev-8');
  });

  it('shows truthful guidance and does not navigate when no PREPARING target exists', async () => {
    seedApi({ revisions: [revision(1)], outputs: [] });
    renderPage();
    await screen.findByTestId('v4-revisions-table');

    fireEvent.click(screen.getByTestId('v4-generate-output-trigger'));
    // No scope chip (no target), and the menu states the requirement.
    expect(screen.queryByTestId('v4-generate-output-scope')).not.toBeInTheDocument();
    expect(screen.getByTestId('v4-generate-output-menu')).toHaveTextContent(
      'Create or select a PREPARING Revision before generating outputs.',
    );
    // The options are not navigable without a target.
    fireEvent.click(screen.getByTestId('v4-generate-output-option-schedule'));
    expect(screen.queryByTestId('v4-nav-luminaire-schedule')).not.toBeInTheDocument();
  });

  it('shows the truthful display Source for each canonical operation', async () => {
    seedApi({
      revisions: [
        COMPOSED_PREPARING(),
        revision(15, {
          revisionId: 'rev-15',
          projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' },
        }),
        revision(16, {
          revisionId: 'rev-16',
          projectSnapshot: { canonicalOperation: 'REGISTER_ONLY' },
        }),
      ],
      outputs: [],
    });
    renderPage();
    const table = await screen.findByTestId('v4-revisions-table');

    expect(table).toHaveTextContent('Composed / Manual Revision');
    expect(table).toHaveTextContent('Generated Output Revision');
    expect(table).toHaveTextContent('Registered Revision');
    // The internal discriminator is never shown to the owner.
    expect(table).not.toHaveTextContent('MANUAL_DELIVERABLES');
    expect(table).not.toHaveTextContent('GENERATED_OUTPUTS');
    expect(table).not.toHaveTextContent('REGISTER_ONLY');
  });
});

/* ---------------------------------------------------------------------------
   C1 / B1 — Resume a failed composed Revision.
   ------------------------------------------------------------------------- */

const FAILED_COMPOSED = () =>
  revision(8, {
    revisionId: 'rev-8',
    lifecycleState: 'FAILED_RECOVERABLE',
    finalizedAt: null,
    failureReason: 'Deliverable registration was interrupted.',
    projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
  });

describe('resume composed revision (C1 §19)', () => {
  it('offers Resume Revision for a FAILED_RECOVERABLE composed Revision and returns it to Preparing', async () => {
    seedApi({ revisions: [FAILED_COMPOSED()], outputs: [] });
    const resumed = revision(8, {
      revisionId: 'rev-8',
      lifecycleState: 'PREPARING',
      finalizedAt: null,
      failureReason: null,
      projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
    });
    vi.mocked(api.resumeRevision).mockImplementation(async () => {
      // The read authority only reports PREPARING once the resume has happened.
      vi.mocked(api.projectRevisions).mockResolvedValue([resumed]);
      return resumed;
    });

    renderPage();
    await selectRevisionRow('rev-8');
    const panel = await screen.findByTestId('v4-revision-resume-panel');
    // Truthful scope: no Output is regenerated by resuming.
    expect(panel).toHaveTextContent('No Output is regenerated.');

    fireEvent.click(screen.getByTestId('v4-revision-resume'));
    await waitFor(() => expect(api.resumeRevision).toHaveBeenCalledWith('p1', 'rev-8'));
    await waitFor(() =>
      expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('PREPARING'),
    );
    // Resumed: the affordance is gone because the Revision is no longer failed.
    expect(screen.queryByTestId('v4-revision-resume')).not.toBeInTheDocument();
  });

  it('does not offer Resume for a failed Revision that is not a composed draft', async () => {
    seedApi({
      revisions: [
        revision(9, {
          revisionId: 'rev-9',
          lifecycleState: 'FAILED_RECOVERABLE',
          failureReason: 'Generation failed.',
          projectSnapshot: { canonicalOperation: 'GENERATED_OUTPUTS' },
        }),
      ],
      outputs: [],
    });
    renderPage();
    await selectRevisionRow('rev-9');
    expect(screen.queryByTestId('v4-revision-resume')).not.toBeInTheDocument();
  });

  it('does not offer Resume for a PREPARING or FINALIZED composed Revision', async () => {
    seedApi({
      revisions: [
        COMPOSED_PREPARING(),
        revision(10, {
          revisionId: 'rev-10',
          lifecycleState: 'FINALIZED',
          projectSnapshot: { canonicalOperation: 'MANUAL_DELIVERABLES' },
        }),
      ],
      outputs: [],
    });
    renderPage();
    await selectRevisionRow('rev-7');
    expect(screen.queryByTestId('v4-revision-resume')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('v4-revision-row-rev-10'));
    await screen.findByTestId('v4-revision-inspector');
    expect(screen.queryByTestId('v4-revision-resume')).not.toBeInTheDocument();
  });

  it('surfaces a refused resume verbatim and leaves the Revision failed', async () => {
    seedApi({ revisions: [FAILED_COMPOSED()], outputs: [] });
    vi.mocked(api.resumeRevision).mockRejectedValue(
      new Error('R08 cannot be resumed: it holds a finalized Output.'),
    );

    renderPage();
    await selectRevisionRow('rev-8');
    fireEvent.click(screen.getByTestId('v4-revision-resume'));

    expect(await screen.findByTestId('v4-revisions-notice')).toHaveTextContent(
      'R08 cannot be resumed: it holds a finalized Output.',
    );
    expect(screen.getByTestId('v4-revision-inspector')).toHaveTextContent('FAILED_RECOVERABLE');
    expect(screen.getByTestId('v4-revision-resume')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   P2C-03 — Safe Revision Delete UI.
   ------------------------------------------------------------------------- */

describe('safe revision delete (P2C-03)', () => {
  it('offers the Delete Revision action in the Inspector when the server reports eligibility', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 1, datasheetSnapshots: 0, generatedOutputs: 2 },
    });
    renderPage();
    await selectRevisionRow('rev-7');

    expect(await screen.findByTestId('v4-revision-delete')).toHaveTextContent('Delete Revision');
    expect(screen.queryByTestId('v4-revision-delete-blocked')).not.toBeInTheDocument();
  });

  it('never offers a Delete action for a FINALIZED Revision (no Danger Zone)', async () => {
    const finalized = revision(1);
    seedApi({ revisions: [finalized], outputs: [] });
    renderPage();
    await selectRevisionRow('rev-1');

    // The delete-eligibility read is PREPARING-scoped; a FINALIZED Revision has no Danger Zone.
    expect(api.revisionDeleteEligibility).not.toHaveBeenCalled();
    expect(screen.queryByTestId('v4-revision-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-revision-delete-panel')).not.toBeInTheDocument();
  });

  it('shows a readable Package-history block and no delete action', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'NONE',
      canDelete: false,
      blockedReasons: ['PACKAGE_HISTORY_EXISTS'],
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
    });
    renderPage();
    await selectRevisionRow('rev-7');

    expect(await screen.findByTestId('v4-revision-delete-blocked')).toHaveTextContent(
      'This Revision has Package history and cannot be deleted.',
    );
    expect(screen.queryByTestId('v4-revision-delete')).not.toBeInTheDocument();
  });

  it('confirmation shows counts + source-preservation text; Cancel leaves state unchanged', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 1, datasheetSnapshots: 1, generatedOutputs: 2 },
    });
    renderPage();
    await selectRevisionRow('rev-7');
    fireEvent.click(await screen.findByTestId('v4-revision-delete'));

    const confirm = screen.getByTestId('v4-revision-delete-confirm');
    expect(confirm).toBeInTheDocument();
    expect(screen.getByTestId('v4-revision-delete-safety')).toHaveTextContent(
      'Original Project Documents and Datasheet source files will not be deleted.',
    );
    expect(confirm).toHaveTextContent('Delete Revision');
    // The confirmation renders the EXACT server-derived values for every field:
    // totalDeliverables = generated + documents + datasheets = 4.
    expect(confirm).toHaveTextContent('Deliverables');
    expect(confirm).toHaveTextContent('Generated Outputs');
    expect(confirm).toHaveTextContent('Document Snapshots');
    expect(confirm).toHaveTextContent('Datasheets');
    expect(confirm).toHaveTextContent('4');
    expect(confirm).toHaveTextContent('2'); // Generated Outputs
    expect(confirm).toHaveTextContent('1'); // Document Snapshots and Datasheets

    // Cancel leaves state unchanged and does not mutate.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('v4-revision-delete-confirm')).not.toBeInTheDocument();
    expect(api.deleteRevision).not.toHaveBeenCalled();
    expect(screen.getByTestId('v4-revision-delete')).toBeInTheDocument();
  });

  it('confirms the delete, clears selection without a refresh, and refetches reads', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
    });
    vi.mocked(api.deleteRevision).mockResolvedValue({
      outcome: 'DELETED',
      operation: {
        operationId: 'op-1',
        projectId: 'p1',
        revisionId: preparing.revisionId,
        revisionSequence: 7,
        revisionLabel: 'R07',
        actorId: 'u1',
        actorNameSnapshot: 'Maha',
        state: 'COMPLETED',
        failureReason: null,
        artifactManifest: { revisionId: preparing.revisionId, items: [] },
        documentSnapshotCount: 0,
        datasheetSnapshotCount: 0,
        generatedOutputCount: 0,
        createdAt: '2026-08-22T08:00:00.000Z',
        archiveStartedAt: null,
        dbCommittedAt: null,
        completedAt: '2026-08-22T08:00:01.000Z',
        reusedByRevisionId: null,
        reusedAt: null,
        reusedByActorId: null,
        reusedByActorName: null,
        reuseReason: null,
        updatedAt: '2026-08-22T08:00:01.000Z',
      },
    });
    renderPage();
    await selectRevisionRow('rev-7');
    fireEvent.click(await screen.findByTestId('v4-revision-delete'));
    fireEvent.click(screen.getByTestId('v4-confirm-delete-revision'));

    await waitFor(() => expect(api.deleteRevision).toHaveBeenCalledWith('p1', 'rev-7'));
    // Selection cleared: inspector returns to its empty state without a browser refresh.
    await waitFor(() =>
      expect(screen.getByTestId('v4-revisions-inspector-empty')).toBeInTheDocument(),
    );
    // Reads were refetched.
    expect(api.projectRevisions).toHaveBeenCalled();
  });

  it('renders contextual Retry Delete only for the explicit recovery projection', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'RETRY_DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 1, datasheetSnapshots: 0, generatedOutputs: 0 },
    });
    vi.mocked(api.deleteRevision).mockImplementation(() => new Promise<never>(() => undefined));
    renderPage();
    await selectRevisionRow('rev-7');

    expect(await screen.findByTestId('v4-revision-delete-recovery')).toHaveTextContent(
      'The previous Revision Delete was interrupted.',
    );
    expect(screen.getByTestId('v4-revision-retry-delete')).toHaveTextContent('Retry Delete');
    expect(screen.queryByTestId('v4-revision-delete')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('v4-revision-retry-delete'));
    expect(screen.getByTestId('v4-revision-delete-confirm')).toHaveTextContent('Retry Delete');
    fireEvent.click(screen.getByTestId('v4-confirm-delete-revision'));

    await waitFor(() => expect(api.deleteRevision).toHaveBeenCalledWith('p1', 'rev-7'));
  });

  it('a recoverable failure keeps the Revision visible and surfaces Retry guidance', async () => {
    const preparing = COMPOSED_PREPARING();
    seedApi({ revisions: [preparing], outputs: [] });
    vi.mocked(api.revisionDeleteEligibility).mockResolvedValue({
      revisionId: preparing.revisionId,
      deleteAction: 'DELETE',
      canDelete: true,
      blockedReasons: [],
      counts: { documentSnapshots: 0, datasheetSnapshots: 0, generatedOutputs: 0 },
    });
    vi.mocked(api.deleteRevision).mockResolvedValue({
      outcome: 'RETRYABLE',
      operation: {
        operationId: 'op-1',
        projectId: 'p1',
        revisionId: preparing.revisionId,
        revisionSequence: 7,
        revisionLabel: 'R07',
        actorId: 'u1',
        actorNameSnapshot: 'Maha',
        state: 'FAILED_RECOVERABLE',
        failureReason: 'locked file',
        artifactManifest: { revisionId: preparing.revisionId, items: [] },
        documentSnapshotCount: 0,
        datasheetSnapshotCount: 0,
        generatedOutputCount: 0,
        createdAt: '2026-08-22T08:00:00.000Z',
        archiveStartedAt: null,
        dbCommittedAt: null,
        completedAt: null,
        reusedByRevisionId: null,
        reusedAt: null,
        reusedByActorId: null,
        reusedByActorName: null,
        reuseReason: null,
        updatedAt: '2026-08-22T08:00:01.000Z',
      },
    });
    renderPage();
    await selectRevisionRow('rev-7');
    fireEvent.click(await screen.findByTestId('v4-revision-delete'));
    fireEvent.click(screen.getByTestId('v4-confirm-delete-revision'));

    // The Revision is NOT cleared and an actionable retry message is surfaced.
    await waitFor(() =>
      expect(screen.getByTestId('v4-revisions-notice')).toHaveTextContent(
        'Retry Delete to converge safely.',
      ),
    );
    expect(screen.getByTestId('v4-revision-inspector')).toBeInTheDocument();
  });
});

describe('final reference Revisions view', () => {
  it('keeps the filter panel open when a portaled option is selected, then clears it', async () => {
    stubMatchMedia();
    const user = userEvent.setup();
    renderV4(
      <Routes>
        <Route path="/projects/:projectId/revisions" element={<FinalProjectRevisionsPage />} />
      </Routes>,
      ['/projects/p1/revisions'],
    );
    await screen.findByRole('heading', { name: 'Revisions & Outputs' });
    await user.click(screen.getByRole('button', { name: 'Revision filters' }));
    const filters = screen.getByRole('dialog', { name: 'Revision filters' });
    await user.click(within(filters).getByRole('button', { name: 'Author filter' }));
    await user.click(
      within(screen.getByRole('listbox', { name: 'Author filter' })).getByRole('option', {
        name: 'Maha',
      }),
    );
    expect(filters).toBeVisible();
    expect(within(filters).getByRole('button', { name: 'Author filter' })).toHaveTextContent(
      'Maha',
    );
    await user.click(within(filters).getByRole('button', { name: 'Clear filters' }));
    expect(within(filters).getByRole('button', { name: 'Author filter' })).toHaveTextContent(
      'All Authors',
    );
    expect(api.prepareRevision).not.toHaveBeenCalled();
  });
  it('projects the five real KPIs and opens canonical revision details without changing history', async () => {
    stubMatchMedia();
    renderV4(
      <Routes>
        <Route path="/projects/:projectId/revisions" element={<FinalProjectRevisionsPage />} />
      </Routes>,
      ['/projects/p1/revisions'],
    );
    expect(await screen.findByRole('heading', { name: 'Revisions & Outputs' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Revisions',
      'Outputs',
      'Recovery',
    ]);
    expect(screen.getByText('Completed Revisions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Revision details for R01' }));
    const details = await screen.findByRole('dialog', { name: 'Revision Details' });
    expect(within(details).getAllByText('R01').length).toBeGreaterThan(0);
    expect(api.prepareRevision).not.toHaveBeenCalled();
  });
  it('rejects a foreign or unavailable revision deep link without substituting the latest revision', async () => {
    stubMatchMedia();
    renderV4(
      <Routes>
        <Route path="/projects/:projectId/revisions" element={<FinalProjectRevisionsPage />} />
      </Routes>,
      ['/projects/p1/revisions?revisionId=foreign'],
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The requested Revision is unavailable in this Project.',
    );
    expect(
      screen.queryByRole('button', { name: 'Close Revision Details' }),
    ).not.toBeInTheDocument();
  });
});
