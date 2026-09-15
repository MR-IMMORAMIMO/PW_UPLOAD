/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AppUser, Project, WorkSession } from '@scli/domain';
import { V4ThemeProvider } from '../../theme/ThemeProvider';
import { cleanupV4, stubMatchMedia } from '../../test-utils/renderV4';
import { V4WorkSessionProvider } from '../../components/work-session/WorkSessionProvider';
import { ProjectsWorkspaceController as ProjectsPage } from './ProjectsWorkspaceController';

const apiMock = vi.hoisted(() => ({
  activeWorkSession: vi.fn(),
  project: vi.fn(),
  projects: vi.fn(),
  me: vi.fn(),
  settings: vi.fn(),
  salesUsers: vi.fn(),
  projectTypeCatalogue: vi.fn(),
  projectWorkspace: vi.fn(),
  projectStorageHealth: vi.fn(),
  reconnectProjectStorage: vi.fn(),
  changeStatus: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
  removeProjectFromWorkspace: vi.fn(),
  updateProjectConfiguration: vi.fn(),
}));

vi.mock('../../api/environment', () => ({ api: apiMock }));

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000001';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    projectCode: '001_SCT260809_TEST',
    projectName: 'Boutique Hotel Lighting',
    clientName: 'Boutique Hospitality',
    crmReference: 'CRM-1001',
    projectType: 'Hospitality',
    description: '',
    salesOwnerId: USER_ID,
    salesOwnerNameSnapshot: 'Mariam Sales',
    salesOwnerEmailSnapshot: 'mariam@example.com',
    createdById: USER_ID,
    createdByNameSnapshot: 'Mariam Sales',
    createdByEmailSnapshot: 'mariam@example.com',
    assignedDesignerId: USER_ID,
    assignedDesignerNameSnapshot: 'Mohamed',
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Sharjah',
    designStage: 'DetailedDesign',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'InProgress',
    priority: 'High',
    complexity: 'Medium',
    estimatedHours: 40,
    actualHours: 20,
    progressPercent: 65,
    requiredDeliveryDate: '2026-08-25',
    projectFolderUrl: null,
    projectFolderPath: 'C:\\Projects\\Boutique',
    folderIndexedAt: '2026-08-17T08:00:00.000Z',
    folderFileCount: 48,
    revisionNumber: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-16T12:15:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 3,
    ...overrides,
  };
}

const owner: AppUser = {
  id: USER_ID,
  entraObjectId: 'local-owner',
  displayName: 'Workspace Owner',
  email: 'owner@example.com',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeSession(): WorkSession {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    startedAt: '2026-08-17T08:00:00.000Z',
    endedAt: null,
    pausedAt: null,
    accumulatedPausedMs: 0,
    createdAt: '2026-08-17T08:00:00.000Z',
  };
}

function renderPage(projects = [makeProject()]) {
  apiMock.projects.mockResolvedValue(projects);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...renderWithProviders(queryClient),
  };
}

function renderWithProviders(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <MemoryRouter initialEntries={['/projects']}>
          <V4WorkSessionProvider>
            <Routes>
              <Route path="/projects" element={<ProjectsPage />} />
              <Route
                path="/projects/:projectId/summary"
                element={<div data-testid="summary-route">Summary route</div>}
              />
            </Routes>
          </V4WorkSessionProvider>
        </MemoryRouter>
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

function chooseFilter(label: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

beforeEach(() => {
  stubMatchMedia();
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => '40000000-0000-4000-8000-000000000001'),
  });
  apiMock.activeWorkSession.mockResolvedValue(null);
  apiMock.project.mockResolvedValue(makeProject());
  apiMock.me.mockResolvedValue(owner);
  apiMock.settings.mockResolvedValue({
    companyTimezone: 'Asia/Dubai',
    teamsNotificationsEnabled: false,
    projectTypes: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedById: USER_ID,
  });
  apiMock.salesUsers.mockResolvedValue([owner]);
  apiMock.projectTypeCatalogue.mockResolvedValue([
    { id: 'hospitality', name: 'Hospitality', isActive: true, sortOrder: 1 },
  ]);
  apiMock.projectWorkspace.mockResolvedValue({
    services: ['LuminaireSchedule'],
    scopeItems: [
      {
        id: 'scope-1',
        code: 'LuminaireSchedule',
        label: 'Luminaire Schedule',
        custom: false,
      },
    ],
    lightingPackage: { inputMode: 'Later' },
  });
  apiMock.projectStorageHealth.mockResolvedValue({
    projectId: PROJECT_ID,
    state: 'CONNECTED',
    reason: null,
    projectPath: 'C:\\Projects\\Boutique',
    workspacePath: 'C:\\Projects\\Boutique',
    canonicalPath: 'C:\\Projects\\Boutique',
    marker: null,
    canOpenFolder: true,
    canReconnect: false,
    canAdoptLegacy: false,
    checkedAt: '2026-08-23T00:00:00.000Z',
  });
  apiMock.changeStatus.mockImplementation((_id: string, body: { status: Project['status'] }) =>
    Promise.resolve(makeProject({ status: body.status, version: 4 })),
  );
  apiMock.archiveProject.mockResolvedValue(
    makeProject({ status: 'Archived', statusBeforeArchive: 'InProgress' }),
  );
  apiMock.restoreProject.mockResolvedValue(makeProject());
  apiMock.removeProjectFromWorkspace.mockResolvedValue({
    removed: true,
    projectCode: '001_SCT260809_TEST',
    folderUntouched: 'C:\\Projects\\Boutique',
  });
  apiMock.updateProjectConfiguration.mockResolvedValue({
    project: makeProject({ projectName: 'Updated project', version: 4 }),
    workspace: {
      services: ['LuminaireSchedule'],
      scopeItems: [],
      lightingPackage: { inputMode: 'Later' },
    },
  });
});

afterEach(() => {
  cleanup();
  cleanupV4();
  vi.clearAllMocks();
  delete window.scliDesktop;
});

describe('ProjectsPage', () => {
  it('renders the canonical global shell, truthful disabled navigation, and default Table view', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByTestId('v4-shell')).toHaveAttribute('data-context', 'global');
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Reports' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New Project' })).toBeEnabled();
    expect(await screen.findByTestId('projects-table-view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders real table hierarchy, due/progress/folder state, active session, and opens the project row', async () => {
    apiMock.activeWorkSession.mockResolvedValue(makeSession());
    renderPage();
    expect(await screen.findByText('001_SCT260809_TEST')).toBeInTheDocument();
    for (const heading of [
      'Project',
      'Client',
      'Type',
      'Status',
      'Priority',
      'Due Date',
      'Progress',
      'Folder',
      'Last Updated',
      'Actions',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(await screen.findByText('Active Session')).toBeInTheDocument();
    expect(screen.getByLabelText('Progress 65%')).toBeInTheDocument();
    expect(screen.getByText('Indexed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('row', { name: 'Open Boutique Hotel Lighting' }));
    expect(await screen.findByTestId('summary-route')).toBeInTheDocument();
  });

  it('sends the real search/filter/sort query shape and preserves it across all view switches', async () => {
    renderPage();
    await screen.findByTestId('projects-table-view');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), {
      target: { value: 'Boutique' },
    });
    chooseFilter('Status', 'In Progress');
    chooseFilter('Sales', 'Workspace Owner');
    chooseFilter('Priority', 'High');
    chooseFilter('Project Type', 'Hospitality');
    chooseFilter('Due Date', 'Next 7 Days');
    chooseFilter('Sort By', 'Priority');
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));
    await waitFor(() =>
      expect(apiMock.projects).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'Boutique',
          status: 'InProgress',
          salesOwnerId: USER_ID,
          priority: 'High',
          projectType: 'Hospitality',
          dueFrom: expect.any(String),
          dueTo: expect.any(String),
          sortBy: 'priority',
          sortDirection: 'desc',
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }));
    expect(await screen.findByTestId('projects-planner-view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(await screen.findByTestId('projects-cards-view')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveValue('Boutique');
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('In Progress');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveValue('');
  });

  it('keeps Cards distinct and ungrouped, with responsive cards and presentation pagination', async () => {
    const projects = Array.from({ length: 13 }, (_, index) =>
      makeProject({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        projectCode: `${String(index + 1).padStart(3, '0')}_SCT_TEST`,
        projectName: `Project ${index + 1}`,
        status: index % 2 ? 'Planning' : 'InProgress',
      }),
    );
    renderPage(projects);
    await screen.findByTestId('projects-table-view');
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    const cards = await screen.findByTestId('projects-cards-view');
    expect(within(cards).getAllByRole('article')).toHaveLength(12);
    expect(screen.queryByTestId('projects-planner-view')).not.toBeInTheDocument();
    expect(
      within(cards).getByRole('navigation', { name: 'Project card pages' }),
    ).toBeInTheDocument();
  });

  it('renders canonical Planner lanes and uses the authoritative status operation from the keyboard-equivalent menu', async () => {
    renderPage();
    await screen.findByTestId('projects-table-view');
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }));
    const planner = await screen.findByTestId('projects-planner-view');
    expect(planner.querySelector('[data-status="Planning"]')).not.toBeNull();
    expect(planner.querySelector('[data-status="InProgress"]')).toHaveTextContent('1');
    expect(planner.querySelector('[data-status="Archived"]')).not.toBeNull();
    expect(planner.querySelector('[data-draggable="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    const move = screen.getByRole('group', { name: 'Move to Status' });
    fireEvent.click(within(move).getByRole('menuitem', { name: 'Client Review' }));
    expect(await screen.findByTestId('projects-feedback')).toHaveTextContent(
      'moved to Client Review',
    );
    await waitFor(() =>
      expect(apiMock.changeStatus).toHaveBeenCalledWith(PROJECT_ID, {
        status: 'ClientReview',
        expectedCurrentStatus: 'InProgress',
        transitionId: expect.any(String),
      }),
    );
  });

  it('rolls back a rejected status move and reports the real failure', async () => {
    apiMock.changeStatus.mockRejectedValueOnce(new Error('Transition rejected by server.'));
    renderPage();
    await screen.findByTestId('projects-table-view');
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }));
    await screen.findByTestId('projects-planner-view');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Move to Status' })).getByRole('menuitem', {
        name: 'Client Review',
      }),
    );
    expect(
      await screen.findByText(/Transition rejected by server.*Planner was restored/),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('projects-planner-view').querySelector('[data-status="InProgress"]'),
    ).toHaveTextContent('Boutique Hotel Lighting');
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('reuses the shared edit drawer and gates folder/archive actions from real authority', async () => {
    const openPath = vi.fn().mockResolvedValue('opened');
    window.scliDesktop = { openPath };
    renderPage();
    await screen.findByTestId('projects-table-view');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Folder' }));
    expect(openPath).toHaveBeenCalledWith('C:\\Projects\\Boutique');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Project' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(apiMock.archiveProject).toHaveBeenCalledWith(PROJECT_ID));
  });

  it('offers Restore and exact-code removal only for Archived projects without deleting the folder', async () => {
    renderPage([makeProject({ status: 'Archived', statusBeforeArchive: 'InProgress' })]);
    await screen.findByTestId('projects-table-view');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Boutique Hotel Lighting' }));
    expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove archived project?' });
    expect(within(dialog).getByRole('button', { name: 'Remove Project' })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '001_SCT260809_TEST' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Project' }));
    await waitFor(() =>
      expect(apiMock.removeProjectFromWorkspace).toHaveBeenCalledWith(
        PROJECT_ID,
        '001_SCT260809_TEST',
      ),
    );
    expect(await screen.findByText(/project folder was not deleted/)).toBeInTheDocument();
  });
});
