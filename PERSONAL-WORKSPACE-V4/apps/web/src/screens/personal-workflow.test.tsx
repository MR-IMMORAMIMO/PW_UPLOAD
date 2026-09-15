// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AppUser,
  Project,
  ProjectActionItem,
  ProjectRevision,
  ProjectScopeItem,
  ProjectWorkspace,
} from '@scli/domain';
import { api, ApiError } from '../api';
import { useAppContext } from '../app-context';
import { ToastProvider } from '../components/toast';
import { PersonalProjectDetailsScreen } from './personal-project-details';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));

const timestamp = '2026-08-01T08:00:00.000Z';
const makeUser = (id: string, displayName: string, role: AppUser['role']): AppUser => ({
  id,
  entraObjectId: `entra-${id}`,
  displayName,
  email: `${id}@scli.example`,
  jobTitle: role === 'Sales' ? 'Sales Executive' : 'Design Manager',
  department: role === 'Sales' ? 'Sales' : 'Design Studio',
  role,
  weeklyCapacityHours: role === 'Designer' ? 40 : 0,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const manager = makeUser('66666666-6666-4666-8666-666666666666', 'Daniel Brooks', 'LineManager');
const sales = makeUser('11111111-1111-4111-8111-111111111111', 'Maya Hassan', 'Sales');

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    projectCode: '036_SCLI260801_UI_TEST',
    projectName: 'UI Test Project',
    clientName: 'Acme',
    crmReference: null,
    projectType: 'Lighting Layout',
    description: 'Lighting component test',
    salesOwnerId: sales.id,
    salesOwnerNameSnapshot: sales.displayName,
    salesOwnerEmailSnapshot: sales.email,
    createdById: sales.id,
    createdByNameSnapshot: sales.displayName,
    createdByEmailSnapshot: sales.email,
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting layout and luminaire coordination.',
    luxRequirements: '500 lux at working plane.',
    drawingReference: 'A-101',
    status: 'Planning',
    priority: 'Urgent',
    complexity: 'Medium',
    estimatedHours: 10,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    revisionNumber: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

const personalWorkspace: ProjectWorkspace & { scopeItems: ProjectScopeItem[] } = {
  projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
  folderPath: 'C:\\Projects\\036_SCLI260801_UI_TEST',
  folderProfile: 'Full Lighting Design',
  folderStructure: [],
  outputFolders: {
    scheduleExcel: '01_SCHEDULES',
    schedulePdf: '01_SCHEDULES',
    boqExcel: '02_BOQ',
    boqPdf: '02_BOQ',
    datasheets: '04_DATASHEETS',
  },
  services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
  scopeItems: [],
  deliverables: [],
  lightingPackage: {
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    inputMode: 'Later',
    pdfPaperSize: 'Auto',
    scheduleColumns: [],
    boqColumns: [],
    updatedAt: timestamp,
  },
  luminaires: [],
  exports: [],
  revisionPackages: [],
  requirements: [],
  tags: [],
  scopeNotes: [],
  checklist: [],
  actions: [],
  meetings: [],
  reviewItems: [],
  revisions: [],
  documents: [],
  fileCenter: [],
  contacts: [],
  communications: [],
  activity: [],
  health: {
    score: 100,
    checklistPercent: 100,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: timestamp,
};

function setActor(currentUser: AppUser): void {
  vi.mocked(useAppContext).mockReturnValue({
    currentUser,
    mockUsers: [sales, manager],
    integrationStatus: {
      mode: 'mock',
      workspaceVariant: 'personal',
      personalAutoLogin: false,
      configured: true,
      teamsSsoConfigured: false,
      sharePointConfigured: false,
      proactiveNotificationsConfigured: false,
      missing: [],
    },
    switchMockUser: vi.fn(),
    logout: vi.fn(),
    themePreference: 'light',
    resolvedTheme: 'dark',
    setThemePreference: vi.fn(),
  });
}

function renderDetails(
  project: Project,
  history: { transitions: unknown[]; revisionCycles: unknown[] } = {
    transitions: [],
    revisionCycles: [],
  },
  initialPath = `/projects/${project.id}`,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(api, 'project').mockResolvedValue(project);
  vi.spyOn(api, 'projectWorkspace').mockResolvedValue(personalWorkspace);
  vi.spyOn(api, 'salesUsers').mockResolvedValue([sales]);
  vi.spyOn(api, 'workflowHistory').mockResolvedValue(history as never);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/projects/:id" element={<PersonalProjectDetailsScreen />} />
            <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setActor(manager);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Personal Workflow Overview', () => {
  it('removes the generic Personal status select and renders the Current Status control', async () => {
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByLabelText('Project status')).not.toBeInTheDocument();
    expect(screen.getByText('Current Status')).toBeInTheDocument();
    expect(screen.getAllByText('Not Started Yet').length).toBeGreaterThan(0);
  });

  it('shows the correct primary action for each canonical status', async () => {
    const cases: Array<[Project['status'], string]> = [
      ['Planning', 'Start Work'],
      ['InProgress', 'Move to Client Review'],
      ['ClientReview', 'Client Requested Changes'],
      ['RevisionRequired', 'Start Revision Work'],
      ['OnHold', 'Resume'],
      ['Completed', 'Reopen Project'],
      ['Cancelled', 'Reopen Project'],
    ];
    for (const [status, label] of cases) {
      cleanup();
      renderDetails(makeProject({ status }));
      await screen.findByRole('heading', { name: 'UI Test Project' });
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      cleanup();
    }
  });

  it('does not show Complete for Planning, RevisionRequired or OnHold', async () => {
    for (const status of ['Planning', 'RevisionRequired', 'OnHold'] as const) {
      cleanup();
      renderDetails(makeProject({ status }));
      await screen.findByRole('heading', { name: 'UI Test Project' });
      await userEvent.click(screen.getByRole('button', { name: 'More Actions' }));
      expect(screen.queryByRole('menuitem', { name: 'Complete Project' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('shows Hold, Complete and Cancel for InProgress and ClientReview', async () => {
    for (const status of ['InProgress', 'ClientReview'] as const) {
      cleanup();
      renderDetails(makeProject({ status }));
      await screen.findByRole('heading', { name: 'UI Test Project' });
      await userEvent.click(screen.getByRole('button', { name: 'More Actions' }));
      expect(screen.getByRole('menuitem', { name: 'Put On Hold' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Complete Project' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Cancel Project' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('does not surface an invalid transition as an available action', async () => {
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'More Actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Complete Project' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Move to Client Review' }),
    ).not.toBeInTheDocument();
  });
});

describe('Personal Workflow transitions', () => {
  it('sends expectedCurrentStatus on every transition', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'InProgress' }));
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        'aaaaaaaa-0000-4000-8000-000000000001',
        expect.objectContaining({ status: 'InProgress', expectedCurrentStatus: 'Planning' }),
      ),
    );
  });

  it('blocks a duplicate transition click while pending', async () => {
    let resolve!: (value: Project) => void;
    vi.spyOn(api, 'changeStatus').mockReturnValue(
      new Promise<Project>((r) => {
        resolve = r;
      }),
    );
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const start = screen.getByRole('button', { name: 'Start Work' });
    await userEvent.click(start);
    expect(start).toBeDisabled();
    resolve(makeProject({ status: 'InProgress' }));
  });

  it('disables More Actions while a transition is pending', async () => {
    let resolve!: (value: Project) => void;
    vi.spyOn(api, 'changeStatus').mockReturnValue(
      new Promise<Project>((r) => {
        resolve = r;
      }),
    );
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    const more = screen.getByRole('button', { name: /More Actions/ });
    expect(more).toBeDisabled();
    resolve(makeProject({ status: 'InProgress' }));
  });
});

describe('Personal On Hold / Resume', () => {
  it('resumes to statusBeforeHold when present', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'InProgress' }));
    renderDetails(makeProject({ status: 'OnHold', statusBeforeHold: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText('Paused from Client Review')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'ClientReview', expectedCurrentStatus: 'OnHold' }),
      ),
    );
  });

  it('resumes to InProgress when statusBeforeHold is absent', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'InProgress' }));
    renderDetails(makeProject({ status: 'OnHold', statusBeforeHold: null }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'InProgress', expectedCurrentStatus: 'OnHold' }),
      ),
    );
  });
});

describe('Personal Cancellation', () => {
  it('opens an app-native reason dialog and blocks blank and whitespace reasons', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'Cancelled' }));
    renderDetails(makeProject({ status: 'InProgress' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'More Actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel Project' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel project' });
    const reason = within(dialog).getByLabelText('Cancellation reason');
    const submit = within(dialog).getByRole('button', { name: 'Cancel Project' });

    await userEvent.click(submit);
    expect(changeStatus).not.toHaveBeenCalled();
    expect(within(dialog).getByText('A cancellation reason is required.')).toBeInTheDocument();

    await userEvent.type(reason, '   ');
    await userEvent.click(submit);
    expect(changeStatus).not.toHaveBeenCalled();

    await userEvent.clear(reason);
    await userEvent.type(reason, 'Client cancelled the lighting package.');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'Cancelled',
          reason: 'Client cancelled the lighting package.',
          expectedCurrentStatus: 'InProgress',
        }),
      ),
    );
  });

  it('preserves the entered reason when the API rejects the cancellation', async () => {
    vi.spyOn(api, 'changeStatus').mockRejectedValue(
      new Error('A cancellation reason is required.'),
    );
    renderDetails(makeProject({ status: 'InProgress' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'More Actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel Project' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel project' });
    const reason = within(dialog).getByLabelText('Cancellation reason');
    await userEvent.type(reason, 'Client cancelled the lighting package.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel Project' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Cancellation reason')).toHaveValue(
        'Client cancelled the lighting package.',
      ),
    );
  });
});

describe('Personal Client Requested Changes feedback dialog', () => {
  it('opens an app-native Feedback Summary dialog (no window.prompt) and blocks blank/whitespace', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'RevisionRequired' }));
    const promptSpy = vi.spyOn(window, 'prompt');
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    const feedback = within(dialog).getByLabelText('Feedback summary');
    const submit = within(dialog).getByRole('button', { name: 'Confirm Changes' });

    await userEvent.click(submit);
    expect(changeStatus).not.toHaveBeenCalled();
    expect(within(dialog).getByText('A feedback summary is required.')).toBeInTheDocument();

    await userEvent.type(feedback, '   ');
    await userEvent.click(submit);
    expect(changeStatus).not.toHaveBeenCalled();

    await userEvent.clear(feedback);
    await userEvent.type(feedback, 'Adjust downlight spacing and reduce facade brightness.');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'RevisionRequired',
          reason: 'Adjust downlight spacing and reduce facade brightness.',
          expectedCurrentStatus: 'ClientReview',
        }),
      ),
    );
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('sends reason (not a feedbackSummary field) and respects the 500 max', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'RevisionRequired' }));
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    const feedback = within(dialog).getByLabelText('Feedback summary');
    expect(feedback).toHaveAttribute('maxlength', '500');
    await userEvent.type(feedback, 'Client feedback.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Changes' }));
    await waitFor(() => {
      const call = changeStatus.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.status).toBe('RevisionRequired');
      expect(call.reason).toBe('Client feedback.');
      expect('feedbackSummary' in call).toBe(false);
    });
  });

  it('preserves entered feedback when the API rejects', async () => {
    vi.spyOn(api, 'changeStatus').mockRejectedValue(new Error('A feedback summary is required.'));
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    const feedback = within(dialog).getByLabelText('Feedback summary');
    await userEvent.type(feedback, 'Client feedback.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Changes' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Feedback summary')).toHaveValue('Client feedback.'),
    );
  });

  it('cancellation/close performs no transition', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockResolvedValue(makeProject({ status: 'RevisionRequired' }));
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep in Client Review' }));
    expect(changeStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Client requested changes' })).toBeNull();
  });

  it('pending submit disables duplicate action', async () => {
    let resolve!: (value: Project) => void;
    vi.spyOn(api, 'changeStatus').mockReturnValue(
      new Promise<Project>((r) => {
        resolve = r;
      }),
    );
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    await userEvent.type(within(dialog).getByLabelText('Feedback summary'), 'Client feedback.');
    const submit = within(dialog).getByRole('button', { name: 'Confirm Changes' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    resolve(makeProject({ status: 'RevisionRequired' }));
  });

  it('does not add a Timeline or cycle list to the dialog', async () => {
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Client Requested Changes' }));
    const dialog = screen.getByRole('dialog', { name: 'Client requested changes' });
    expect(within(dialog).queryByText(/Timeline/i)).toBeNull();
    expect(within(dialog).queryByText(/Cycle \d/i)).toBeNull();
  });
});

describe('Personal stale 409 handling', () => {
  it('refreshes the project and shows a professional message without auto-retrying', async () => {
    const changeStatus = vi
      .spyOn(api, 'changeStatus')
      .mockRejectedValue(
        new ApiError('This project changed after you opened it.', 'CONFLICT', 409, 'x'),
      );
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    await waitFor(() =>
      expect(
        screen.getByText('Project status changed. The latest status has been loaded.'),
      ).toBeInTheDocument(),
    );
    expect(changeStatus).toHaveBeenCalledTimes(1);
  });
});

describe('Personal Client Review presentation', () => {
  it('renders the Client Review label and badge', async () => {
    renderDetails(makeProject({ status: 'ClientReview' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getAllByText('Client Review').length).toBeGreaterThan(0);
    expect(screen.getByText('Waiting for client feedback or approval.')).toBeInTheDocument();
  });
});

describe('Personal legacy statuses', () => {
  it('renders legacy statuses readably without an unrestricted dropdown', async () => {
    for (const status of [
      'WaitingForInformation',
      'WaitingForSales',
      'InternalReview',
      'ReadyToIssue',
      'Issued',
    ] as const) {
      cleanup();
      renderDetails(makeProject({ status }));
      await screen.findByRole('heading', { name: 'UI Test Project' });
      expect(screen.queryByLabelText('Project status')).not.toBeInTheDocument();
      expect(screen.getByText('Current Status')).toBeInTheDocument();
      cleanup();
    }
  });

  it('never labels Issued as Submission', async () => {
    renderDetails(makeProject({ status: 'Issued' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
  });

  it('exposes valid controlled transitions for a legacy project via Change Status', async () => {
    renderDetails(makeProject({ status: 'Issued' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Change Status' }));
    expect(screen.getByRole('menuitem', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'In Progress' })).toBeInTheDocument();
  });
});

describe('Personal Workflow Timeline', () => {
  const t = (
    id: string,
    fromStatus: Project['status'],
    toStatus: Project['status'],
    reason: string | null = null,
    revisionCycleId: string | null = null,
  ) => ({
    transitionId: id,
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    sequence: 1,
    fromStatus,
    toStatus,
    occurredAt: '2026-08-01T08:00:00.000Z',
    actorId: null,
    reason,
    revisionCycleId,
  });

  const cycle = (
    id: string,
    cycleNumber: number,
    status: 'Open' | 'ReturnedToClient' | 'Cancelled',
  ) => ({
    revisionCycleId: id,
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    cycleNumber,
    status,
    openedAt: '2026-08-01T08:00:00.000Z',
    openedByTransitionId: 'opening-1',
    feedbackSummary: 'Adjust downlight spacing and reduce facade brightness.',
    workStartedAt: '2026-08-01T09:00:00.000Z',
    returnedToClientAt: status === 'ReturnedToClient' ? '2026-08-01T10:00:00.000Z' : null,
    cancelledAt: status === 'Cancelled' ? '2026-08-01T11:00:00.000Z' : null,
  });

  function renderWithHistory(
    transitions: ReturnType<typeof t>[],
    cycles: ReturnType<typeof cycle>[],
  ) {
    renderDetails(makeProject({ status: 'InProgress' }), {
      transitions: transitions as never,
      revisionCycles: cycles as never,
    });
    return screen.findByRole('heading', { name: 'UI Test Project' });
  }

  it('renders the Workflow Timeline section in Overview', async () => {
    await renderWithHistory([], []);
    expect(screen.getByText('Workflow Timeline')).toBeInTheDocument();
  });

  it('shows the empty state for zero history and no fake Planning event', async () => {
    await renderWithHistory([], []);
    expect(screen.getByText('No recorded workflow transitions yet.')).toBeInTheDocument();
    expect(screen.queryByText('Started Work')).not.toBeInTheDocument();
  });

  it('renders event titles and latest-first order', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'ClientReview'),
      t(
        'c',
        'ClientReview',
        'RevisionRequired',
        'Adjust downlight spacing and reduce facade brightness.',
        'c1',
      ),
      t('d', 'RevisionRequired', 'InProgress', null, 'c1'),
      t('e', 'InProgress', 'ClientReview', null, 'c1'),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'ReturnedToClient')]);
    const list = document.querySelector('.workflow-timeline-list')!;
    const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent ?? '');
    // Latest first.
    expect(items[0]).toContain('Returned to Client');
    expect(items[1]).toContain('Revision Work Started');
    expect(items[2]).toContain('Client Requested Changes');
    expect(items[3]).toContain('Moved to Client Review');
    expect(items[4]).toContain('Started Work');
  });

  it('renders cycle badge and feedback summary once', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'ClientReview'),
      t(
        'c',
        'ClientReview',
        'RevisionRequired',
        'Adjust downlight spacing and reduce facade brightness.',
        'c1',
      ),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'Open')]);
    expect(screen.getByText('Cycle 1 · Open')).toBeInTheDocument();
    expect(
      screen.getByText('Feedback Summary: Adjust downlight spacing and reduce facade brightness.'),
    ).toBeInTheDocument();
    // Feedback text appears once.
    expect(screen.getAllByText(/Adjust downlight spacing/).length).toBe(1);
  });

  it('renders returned and cancelled cycle statuses', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'ClientReview'),
      t('c', 'ClientReview', 'RevisionRequired', 'Feedback.', 'c1'),
      t('d', 'RevisionRequired', 'InProgress', null, 'c1'),
      t('e', 'InProgress', 'ClientReview', null, 'c1'),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'ReturnedToClient')]);
    expect(screen.getAllByText('Cycle 1 · Returned to Client').length).toBeGreaterThan(0);
  });

  it('never labels a project cycle as REV-01 or Revision 1', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'ClientReview'),
      t('c', 'ClientReview', 'RevisionRequired', 'Feedback.', 'c1'),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'Open')]);
    expect(screen.queryByText(/REV-01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revision 1/)).not.toBeInTheDocument();
  });

  it('does not show raw UUIDs', async () => {
    const transitions = [
      t('aaaaaaaa-0000-4000-8000-000000000001', 'Planning', 'InProgress'),
      t('bbbbbbbb-0000-4000-8000-000000000001', 'InProgress', 'ClientReview'),
      t(
        'cccccccc-0000-4000-8000-000000000001',
        'ClientReview',
        'RevisionRequired',
        'Feedback.',
        'c1',
      ),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'Open')]);
    expect(screen.queryByText(/aaaaaaaa-0000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cccccccc-0000/)).not.toBeInTheDocument();
  });

  it('renders hold, resume, completed, cancelled, reopened, and legacy fallback labels', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'OnHold'),
      t('c', 'OnHold', 'InProgress'),
      t('d', 'InProgress', 'Completed'),
      t('e', 'Completed', 'InProgress'),
      t('f', 'InProgress', 'Cancelled'),
      t('g', 'Cancelled', 'InProgress'),
      t('h', 'WaitingForInformation', 'InProgress'),
    ];
    await renderWithHistory(transitions, []);
    expect(screen.getByText('Put On Hold')).toBeInTheDocument();
    expect(screen.getByText('Resumed Work')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByText('Reopened').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    // Legacy fallback label.
    expect(screen.getByText('Waiting for Information → In Progress')).toBeInTheDocument();
  });

  it('completed and reopen events do not inherit a previous cycle badge', async () => {
    const transitions = [
      t('a', 'Planning', 'InProgress'),
      t('b', 'InProgress', 'ClientReview'),
      t('c', 'ClientReview', 'RevisionRequired', 'Feedback.', 'c1'),
      t('d', 'RevisionRequired', 'InProgress', null, 'c1'),
      t('e', 'InProgress', 'ClientReview', null, 'c1'),
      t('f', 'ClientReview', 'Completed', null, null),
    ];
    await renderWithHistory(transitions, [cycle('c1', 1, 'ReturnedToClient')]);
    // The Completed event has no cycle badge.
    const completedItem = screen.getByText('Completed').closest('li')!;
    expect(completedItem.textContent).not.toContain('Cycle 1');
  });

  it('shows full history control when more than 8 events', async () => {
    const transitions = Array.from({ length: 10 }, (_, i) => t(`t${i}`, 'Planning', 'InProgress'));
    await renderWithHistory(transitions, []);
    expect(screen.getByText('Show full history (10)')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Show full history (10)'));
    expect(screen.getByText('Show less')).toBeInTheDocument();
  });
});

describe('P2.8C actualHours UI closure', () => {
  it('does not show an Add time manual prompt on the project overview', async () => {
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.queryByRole('button', { name: 'Add time' })).not.toBeInTheDocument();
    expect(screen.queryByText('Add time')).not.toBeInTheDocument();
  });

  it('does not expose a direct Actual Hours edit field in the metadata editor', async () => {
    renderDetails(makeProject({ status: 'Planning' }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit project details' });
    expect(within(dialog).queryByLabelText(/Actual Hours/)).not.toBeInTheDocument();
    // Other metadata edits remain available.
    expect(within(dialog).getByLabelText(/Project Name/)).toBeInTheDocument();
  });

  it('still renders Estimated hours alongside the WorkSession-tracked view', async () => {
    renderDetails(makeProject({ status: 'Planning', actualHours: 5, estimatedHours: 10 }));
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText(/5h \/ 10h/)).toBeInTheDocument();
  });
});

// ===========================================================================
// P2-UX-04A-H1 — route ownership + IA separation + timeline interaction
// ===========================================================================

function makeRevision(overrides: Partial<ProjectRevision> = {}): ProjectRevision {
  return {
    id: 'rrrrrrrr-0000-4000-8000-000000000001',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    revisionNumber: 1,
    title: 'Revision 1',
    status: 'Issued',
    receivedAt: null,
    dueDate: null,
    issuedAt: '2026-08-02T08:00:00.000Z',
    summary: 'First issue.',
    changeLog: 'Initial.',
    sourceType: 'Manual',
    sourceReference: '',
    locked: true,
    snapshotHash: '',
    reissueNumber: 0,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  };
}

function makeAction(overrides: Partial<ProjectActionItem> = {}): ProjectActionItem {
  return {
    id: 'aaaaaaa1-0000-4000-8000-000000000001',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Send layout',
    details: 'Send the layout to the client.',
    owner: 'Mohamed',
    ownerRole: '',
    dueDate: '2026-08-10',
    status: 'Open',
    priority: 'High',
    sourceType: 'Manual',
    sourceId: null,
    revisionId: null,
    categoryId: null,
    notes: '',
    completedAt: null,
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
    ...overrides,
  };
}

function withWorkspace(workspacePatch: Partial<ProjectWorkspace>): ProjectWorkspace {
  return {
    ...personalWorkspace,
    ...workspacePatch,
    health: {
      ...personalWorkspace.health,
      ...(workspacePatch.health ?? {}),
    },
  };
}

function renderWithWorkspace(
  project: Project,
  workspace: ProjectWorkspace,
  initialPath = `/projects/${project.id}`,
  history: { transitions: unknown[]; revisionCycles: unknown[] } = {
    transitions: [],
    revisionCycles: [],
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(api, 'project').mockResolvedValue(project);
  vi.spyOn(api, 'projectWorkspace').mockResolvedValue(workspace);
  vi.spyOn(api, 'salesUsers').mockResolvedValue([sales]);
  vi.spyOn(api, 'workflowHistory').mockResolvedValue(history as never);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/projects/:id" element={<PersonalProjectDetailsScreen />} />
            <Route path="/projects/:id/:section" element={<PersonalProjectDetailsScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('P2-UX-04A-H1 Summary / Workflow route ownership', () => {
  it('Summary route renders Summary surface and no full multi-source Timeline', async () => {
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      withWorkspace({ revisions: [makeRevision()] }),
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/summary',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText('Need Your Attention')).toBeInTheDocument();
    expect(screen.getByText('Project Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Next Action')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    // No full multi-source Timeline authority on Summary.
    expect(screen.queryByRole('group', { name: 'Timeline filters' })).not.toBeInTheDocument();
  });

  it('Workflow route renders Timeline and inspector, not Summary operational cards', async () => {
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      withWorkspace({ revisions: [makeRevision()] }),
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
      { transitions: [], revisionCycles: [] },
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    expect(screen.getByText('Workflow Timeline')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Timeline filters' })).toBeInTheDocument();
    // No Summary operational stack on the Workflow route.
    expect(screen.queryByText('Need Your Attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Project Snapshot')).not.toBeInTheDocument();
  });
});

describe('P2-UX-04A-UAT-FIX-01 Recent Activity preview readability', () => {
  it('renders a full-width title / detail / timestamp hierarchy without a View-All link', async () => {
    const activity = [
      {
        id: 'act-1',
        projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
        entityType: 'Revision',
        entityId: 'rev-1',
        action: 'Generated',
        title: 'REV_06',
        detail: 'Schedule, Technical BOQ and Datasheets package.',
        createdAt: '2026-08-10T08:00:00.000Z',
      },
      {
        id: 'act-2',
        projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
        entityType: 'Revision',
        entityId: 'rev-2',
        action: 'Generated',
        title: 'REV_05',
        detail: 'Updated revision package.',
        createdAt: '2026-08-09T08:00:00.000Z',
      },
    ];
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      withWorkspace({ activity }),
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/summary',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const list = document.querySelector('.recent-activity-list')!;
    expect(list).not.toBeNull();
    const items = Array.from(list.querySelectorAll('.recent-activity-item'));
    expect(items.length).toBe(2);
    // Title has its own primary element.
    expect(items[0]!.querySelector('.recent-activity-title')?.textContent).toBe('REV_06');
    // Detail has its own secondary element.
    expect(items[0]!.querySelector('.recent-activity-detail')?.textContent).toBe(
      'Schedule, Technical BOQ and Datasheets package.',
    );
    // Timestamp has a distinct metadata element.
    expect(items[0]!.querySelector('.recent-activity-time')?.textContent).toContain('Aug');
    // No View-All activity link.
    expect(screen.queryByRole('link', { name: /view all activity/i })).not.toBeInTheDocument();
  });
});

describe('P2-UX-04A-H1 Next Action routing and CTA', () => {
  it('InProgress + overdue action routes project-scoped with a destination-aware label', async () => {
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      withWorkspace({
        health: {
          ...personalWorkspace.health,
          checks: [
            {
              key: 'actions',
              label: 'Overdue actions',
              detail: '1 action(s) are overdue.',
              severity: 'Warning',
              passed: false,
            },
          ],
        },
      }),
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/summary',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const cta = screen.getByRole('link', { name: 'Open Actions' });
    expect(cta).toHaveAttribute('href', '/projects/aaaaaaaa-0000-4000-8000-000000000001/actions');
  });

  it('ClientReview routes to workflow with a View Workflow CTA', async () => {
    renderWithWorkspace(
      makeProject({ status: 'ClientReview' }),
      personalWorkspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/summary',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const cta = screen.getByRole('link', { name: 'View Workflow' });
    expect(cta).toHaveAttribute('href', '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow');
  });
});

describe('P2-UX-04A-H1 Need Attention project-scoped routing', () => {
  it('missing datasheets link is project-scoped', async () => {
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      withWorkspace({
        health: {
          ...personalWorkspace.health,
          checks: [
            {
              key: 'datasheets',
              label: 'Datasheet coverage',
              detail: '3 luminaire(s) have no datasheet.',
              severity: 'Warning',
              passed: false,
            },
          ],
        },
      }),
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/summary',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const link = screen.getByText('Datasheet coverage').closest('a')!;
    expect(link).toHaveAttribute(
      'href',
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/datasheets',
    );
  });
});

describe('P2-UX-04A-H1 Timeline filter / selection / inspector', () => {
  it('no root-level cross-link routes escape the project workspace', async () => {
    const workspace = withWorkspace({
      revisions: [makeRevision()],
      actions: [makeAction()],
    });
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      workspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    const rootLevel = [
      '/actions',
      '/scope',
      '/workflow',
      '/comments',
      '/datasheets',
      '/luminaires',
      '/revisions',
      '/meetings',
    ];
    const anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('/projects/')) continue;
      for (const bad of rootLevel) {
        expect(href.startsWith(bad)).toBe(false);
      }
    }
  });

  it('selecting an event renders its inspector details', async () => {
    const workspace = withWorkspace({
      revisions: [makeRevision()],
      actions: [makeAction()],
    });
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      workspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByText('Revision 01'));
    const inspector = screen.getByRole('complementary', { name: 'Event inspector' });
    expect(within(inspector).getAllByText('Issued').length).toBeGreaterThan(0);
    expect(within(inspector).getByText('Open Source')).toBeInTheDocument();
  });

  it('stale inspector selection clears when the selected event is filtered out and does not restore', async () => {
    const workspace = withWorkspace({
      revisions: [makeRevision()],
      actions: [makeAction()],
    });
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      workspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByText('Revision 01'));
    const inspector = screen.getByRole('complementary', { name: 'Event inspector' });
    expect(within(inspector).getAllByText('Issued').length).toBeGreaterThan(0);
    // Switch to Actions filter: Revision is hidden, so selection must clear.
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByText('Select an event to view its details.')).toBeInTheDocument();
    expect(screen.queryByText('Issued')).not.toBeInTheDocument();
    // Returning to All does NOT silently restore the previously hidden Revision.
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Select an event to view its details.')).toBeInTheDocument();
    expect(screen.queryByText('Issued')).not.toBeInTheDocument();
  });

  it('shows a filtered-zero empty state', async () => {
    const workspace = withWorkspace({
      actions: [makeAction()],
    });
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      workspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByRole('button', { name: 'Meetings' }));
    expect(screen.getByText('No meeting events yet.')).toBeInTheDocument();
  });

  it('Open Source is project-scoped', async () => {
    const workspace = withWorkspace({
      revisions: [makeRevision()],
    });
    renderWithWorkspace(
      makeProject({ status: 'InProgress' }),
      workspace,
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/workflow',
    );
    await screen.findByRole('heading', { name: 'UI Test Project' });
    await userEvent.click(screen.getByText('Revision 01'));
    const inspector = screen.getByRole('complementary', { name: 'Event inspector' });
    const openSource = within(inspector).getByRole('link', { name: 'Open Source' });
    expect(openSource).toHaveAttribute(
      'href',
      '/projects/aaaaaaaa-0000-4000-8000-000000000001/revisions',
    );
  });
});
