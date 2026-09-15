import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { PersonalPortfolioOperations, Project, WorkSession } from '@scli/domain';
import { vi } from 'vitest';
import { renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { LegacyDashboardPage as DashboardPage } from './LegacyDashboardPage';

const apiMock = vi.hoisted(() => ({
  projects: vi.fn(),
  personalOperations: vi.fn(),
}));

const workSessionMock = vi.hoisted(() => ({
  value: {
    active: null as WorkSession | null,
    activeProject: null as Project | null,
    currentProject: null as Project | null,
    currentProjectId: null as string | null,
    state: null as 'RUNNING' | 'PAUSED' | null,
    elapsedSeconds: 0,
    statusLoading: false,
    statusUnavailable: false,
    trayOpen: false,
    setTrayOpen: vi.fn(),
    error: null as string | null,
    clearError: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    startPending: false,
    pausePending: false,
    resumePending: false,
    stopPending: false,
  },
}));

vi.mock('../../api/environment', () => ({ api: apiMock }));
vi.mock('../../components/work-session/WorkSessionProvider', () => ({
  useV4WorkSession: () => workSessionMock.value,
  useOptionalV4WorkSession: () => null,
}));

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    projectCode: '001_SCT260809_TEST',
    projectName: 'Retail Showroom',
    clientName: 'Client A',
    projectType: 'Retail',
    description: '',
    salesOwnerId: 'u1',
    salesOwnerNameSnapshot: 'Sales',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: 'u1',
    createdByNameSnapshot: 'Sales',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: 'u2',
    assignedDesignerNameSnapshot: 'Designer',
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai',
    designStage: 'Concept',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'InProgress',
    priority: 'High',
    complexity: 'Medium',
    estimatedHours: 20,
    actualHours: 10,
    progressPercent: 50,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    revisionNumber: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

const EMPTY_OPERATIONS: PersonalPortfolioOperations = {
  overdueActions: [],
  upcomingActions: [],
  upcomingMeetings: [],
  blockingRequirements: [],
  openReviews: [],
};

function renderPage(path = '/dashboard') {
  return renderV4(
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/projects" element={<div>Projects destination</div>} />
      <Route path="/projects/:projectId/summary" element={<div>Summary destination</div>} />
      <Route path="/projects/:projectId/actions" element={<div>Actions destination</div>} />
      <Route path="/projects/:projectId/meetings" element={<div>Meetings destination</div>} />
      <Route path="/projects/:projectId/scope" element={<div>Scope destination</div>} />
    </Routes>,
    [path],
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    stubMatchMedia();
    apiMock.projects.mockResolvedValue([project()]);
    apiMock.personalOperations.mockResolvedValue(EMPTY_OPERATIONS);
    Object.assign(workSessionMock.value, {
      active: null,
      activeProject: null,
      state: null,
      elapsedSeconds: 0,
      statusLoading: false,
      statusUnavailable: false,
      error: null,
      startPending: false,
      pausePending: false,
      resumePending: false,
      stopPending: false,
    });
  });

  it('renders the approved page header and active Dashboard navigation', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('enables Reports, Settings and New Project', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByRole('button', { name: 'Reports' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New Project' })).toBeEnabled();
  });

  it('navigates View All and Projects nav to the real Projects route', async () => {
    renderPage();
    await screen.findByLabelText('Dashboard project filters');
    fireEvent.click(screen.getByRole('button', { name: /View All Projects/i }));
    expect(screen.getByText('Projects destination')).toBeInTheDocument();
  });

  it('keeps the global Projects navigation functional from Dashboard', async () => {
    renderPage();
    await screen.findByLabelText('Dashboard project filters');
    fireEvent.click(screen.getByRole('button', { name: /^Projects$/ }));
    expect(screen.getByText('Projects destination')).toBeInTheDocument();
  });

  it('renders all four actionable KPI buttons with selected state', async () => {
    renderPage();
    const group = await screen.findByLabelText('Dashboard project filters');
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    expect(within(group).getByRole('button', { name: /Active Projects: 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps KPI filters keyboard reachable through native button semantics', async () => {
    renderPage();
    const kpi = await screen.findByRole('button', { name: /Due This Week:/ });
    kpi.focus();
    expect(kpi.tagName).toBe('BUTTON');
    expect(document.activeElement).toBe(kpi);
  });

  it('filters Active Projects from a KPI and preserves Need Attention', async () => {
    apiMock.projects.mockResolvedValue([
      project({ id: 'normal', projectName: 'Normal Project', requiredDeliveryDate: '2026-10-01' }),
      project({
        id: 'revision',
        projectName: 'Revision Project',
        status: 'RevisionRequired',
        requiredDeliveryDate: '2026-10-02',
      }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Revision Required: 1/ }));
    const active = screen.getByLabelText('Active Projects');
    expect(within(active).getByText(/Revision Project/)).toBeInTheDocument();
    expect(within(active).queryByText(/Normal Project/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Need Attention')).toBeInTheDocument();
  });

  it('opens attention and active project rows at canonical Summary', async () => {
    apiMock.projects.mockResolvedValue([project({ requiredDeliveryDate: '2020-01-01' })]);
    renderPage();
    const attention = await screen.findByLabelText('Need Attention');
    fireEvent.click(within(attention).getByRole('button'));
    expect(screen.getByText('Summary destination')).toBeInTheDocument();
  });

  it('shows truthful positive and filtered empty states', async () => {
    apiMock.projects.mockResolvedValue([project({ requiredDeliveryDate: '2026-10-01' })]);
    renderPage();
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Client Review: 0/ }));
    expect(
      screen.getByText(/No projects match the selected Client Review filter/),
    ).toBeInTheDocument();
  });

  it('shows a truthful zero-project workspace with New Project available', async () => {
    apiMock.projects.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Your workspace is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Project' })).toBeEnabled();
  });

  it('shows bounded project loading and error states with retry', async () => {
    apiMock.projects.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([project()]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard data is unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Dashboard project filters')).toBeInTheDocument();
  });

  it('shows inactive Work Session without a global Start action', async () => {
    renderPage();
    const card = await screen.findByRole('region', { name: 'Work Session' });
    expect(within(card).getByText('No active Work Session')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Start/i })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /View Projects/i })).toBeInTheDocument();
  });

  it('renders authoritative running session identity and Pause/Stop controls', async () => {
    Object.assign(workSessionMock.value, {
      active: { id: 'ws1', projectId: 'session-project' },
      activeProject: project({
        id: 'session-project',
        projectName: 'Authoritative Session Project',
      }),
      state: 'RUNNING',
      elapsedSeconds: 68,
    });
    renderPage();
    const card = await screen.findByRole('region', { name: 'Work Session' });
    expect(within(card).getByText('Authoritative Session Project')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
    expect(workSessionMock.value.pause).toHaveBeenCalledTimes(1);
  });

  it('renders paused session with Resume and invokes shared provider actions', async () => {
    Object.assign(workSessionMock.value, {
      active: { id: 'ws1', projectId: 'p1' },
      activeProject: project(),
      state: 'PAUSED',
      elapsedSeconds: 90,
    });
    renderPage();
    const card = await screen.findByRole('region', { name: 'Work Session' });
    fireEvent.click(within(card).getByRole('button', { name: 'Resume' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Stop' }));
    expect(workSessionMock.value.resume).toHaveBeenCalledTimes(1);
    expect(workSessionMock.value.stop).toHaveBeenCalledTimes(1);
  });

  it('renders operation zero states', async () => {
    renderPage();
    expect(await screen.findByText('No overdue actions')).toBeInTheDocument();
    expect(screen.getByText('No upcoming meetings')).toBeInTheDocument();
    expect(screen.getByText('No blocking requirements')).toBeInTheDocument();
  });

  it('does not render unsupported analytics or chart surfaces', async () => {
    renderPage();
    await screen.findByLabelText('Dashboard project filters');
    expect(screen.queryByRole('img', { name: /chart|trend/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/last month|productivity|utilization|recently opened/i),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      field: 'overdueActions',
      item: { id: 'a1', projectId: 'p1', title: 'Resolve issue', dueDate: '2026-08-16' },
      text: /Resolve issue/,
      destination: 'Actions destination',
    },
    {
      field: 'upcomingMeetings',
      item: {
        id: 'm1',
        projectId: 'p1',
        title: 'Client review',
        startAt: '2026-08-18T06:00:00.000Z',
      },
      text: /Client review/,
      destination: 'Meetings destination',
    },
    {
      field: 'blockingRequirements',
      item: { id: 'r1', projectId: 'p1', title: 'Site plan' },
      text: /Site plan/,
      destination: 'Scope destination',
    },
  ])('routes $field to its owning project page', async ({ field, item, text, destination }) => {
    apiMock.personalOperations.mockResolvedValue({
      ...EMPTY_OPERATIONS,
      [field]: [item],
    });
    renderPage();
    const operations = await screen.findByLabelText('Operations');
    fireEvent.click(within(operations).getByText(text));
    expect(screen.getByText(destination)).toBeInTheDocument();
  });

  it('isolates Operations errors and retries without destroying project data', async () => {
    apiMock.personalOperations
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(EMPTY_OPERATIONS);
    renderPage();
    const activeProjects = await screen.findByLabelText('Active Projects');
    expect(within(activeProjects).getByText(/Retail Showroom/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Operations are temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No overdue actions')).toBeInTheDocument());
  });

  it('reconciles date-dependent data on window focus', async () => {
    vi.setSystemTime(new Date('2026-08-17T08:00:00.000Z'));
    renderPage();
    expect(await screen.findByText('in 3 days')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-08-18T08:00:00.000Z'));
    fireEvent.focus(window);
    expect(await screen.findByText('in 2 days')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
