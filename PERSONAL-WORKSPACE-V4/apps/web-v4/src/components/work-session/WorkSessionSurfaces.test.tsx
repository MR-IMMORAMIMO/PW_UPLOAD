/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { Project, WorkSession } from '@scli/domain';
import { V4ThemeProvider } from '../../theme/ThemeProvider';
import { cleanupV4, stubMatchMedia } from '../../test-utils/renderV4';
import { V4AppShell } from '../shell/V4AppShell';
import { V4WorkSessionProvider, useV4WorkSession } from './WorkSessionProvider';

const apiMock = vi.hoisted(() => ({
  activeWorkSession: vi.fn(),
  project: vi.fn(),
  startWorkSession: vi.fn(),
  pauseWorkSession: vi.fn(),
  resumeWorkSession: vi.fn(),
  stopWorkSession: vi.fn(),
}));

vi.mock('../../api/environment', () => ({ api: apiMock }));

const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const SESSION_ID = '10000000-0000-4000-8000-000000000001';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    projectCode: '0042_SCT260817_BHD',
    projectName: 'Boutique Hotel Downtown',
    clientName: 'Boutique Hospitality',
    projectType: 'Hospitality',
    description: '',
    salesOwnerId: 'u1',
    salesOwnerNameSnapshot: 'Sales',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: 'u1',
    createdByNameSnapshot: 'Sales',
    createdByEmailSnapshot: 'sales@example.com',
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
    estimatedHours: 0,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-09-01',
    projectFolderUrl: null,
    revisionNumber: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    startedAt: new Date(Date.now() - 5_017_000).toISOString(),
    endedAt: null,
    pausedAt: null,
    accumulatedPausedMs: 0,
    createdAt: '2026-08-17T06:00:00.000Z',
    ...overrides,
  };
}

function renderShell(
  mode: 'extended' | 'minimal' = 'extended',
  path = `/projects/${PROJECT_ID}/summary`,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <V4WorkSessionProvider>
            <V4AppShell
              context="project"
              sidebarMode={mode}
              onToggleSidebarMode={() => undefined}
              project={{
                projectCode: '0042_SCT260817_BHD',
                projectName: 'Boutique Hotel Downtown',
                status: 'InProgress',
              }}
              boundedPage
            >
              <div data-testid="dense-technical-page">Technical BOQ</div>
            </V4AppShell>
          </V4WorkSessionProvider>
        </MemoryRouter>
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('V4 Work Session shell surfaces', () => {
  beforeEach(() => {
    stubMatchMedia();
    apiMock.activeWorkSession.mockResolvedValue(null);
    apiMock.project.mockResolvedValue(makeProject());
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanupV4();
  });

  it('renders the extended inactive anchor, hides the strip, and opens/closes the inactive upward tray', async () => {
    renderShell();
    const anchor = await screen.findByRole('button', { name: 'Work Session' });
    await waitFor(() => expect(anchor).toHaveTextContent('No active session'));
    expect(screen.queryByTestId('v4-work-session-strip')).not.toBeInTheDocument();

    fireEvent.click(anchor);
    const tray = await screen.findByRole('dialog', { name: 'Work Session' });
    expect(tray).toHaveAttribute('data-state', 'INACTIVE');
    expect(tray).toHaveTextContent('No active session');
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeEnabled();
    expect(tray.style.bottom).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Close Work Session' }));
    expect(screen.queryByRole('dialog', { name: 'Work Session' })).not.toBeInTheDocument();
  });

  it('does not misrepresent a failed active-session lookup as inactive', async () => {
    apiMock.activeWorkSession.mockRejectedValue(new Error('Session authority unavailable.'));
    renderShell();
    const anchor = await screen.findByRole('button', { name: 'Work Session' });
    await waitFor(() => expect(anchor).toHaveTextContent('Session unavailable'));
    fireEvent.click(anchor);
    const tray = await screen.findByRole('dialog', { name: 'Work Session' });
    expect(tray).toHaveTextContent('Session authority unavailable.');
    expect(screen.queryByRole('button', { name: 'Start Session' })).not.toBeInTheDocument();
  });

  it('starts the real current project and reconciles the authoritative returned session', async () => {
    const started = makeSession();
    apiMock.startWorkSession.mockResolvedValue({ session: started, replayed: false });
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Work Session' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Session' }));

    await waitFor(() =>
      expect(apiMock.startWorkSession).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID }),
      ),
    );
    expect(await screen.findByTestId('v4-work-session-strip')).toHaveAttribute(
      'data-state',
      'RUNNING',
    );
  });

  it('renders running anchor, authoritative project identity, strip, tray, and Pause/Stop controls', async () => {
    apiMock.activeWorkSession.mockResolvedValue(makeSession());
    renderShell();
    const anchor = await screen.findByRole('button', { name: 'Work Session' });
    await waitFor(() => expect(anchor).toHaveAttribute('data-state', 'RUNNING'));
    const strip = await screen.findByTestId('v4-work-session-strip');
    expect(strip).toHaveAttribute('data-state', 'RUNNING');
    expect(strip).toHaveTextContent('Boutique Hotel Downtown');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(anchor);
    const tray = await screen.findByRole('dialog', { name: 'Work Session' });
    expect(tray).toHaveAttribute('data-state', 'RUNNING');
    expect(tray).toHaveTextContent('Boutique Hotel Downtown');
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(2);
  });

  it('renders paused anchor, frozen timer treatment, paused strip, tray, and Resume/Stop controls', async () => {
    apiMock.activeWorkSession.mockResolvedValue(
      makeSession({ pausedAt: new Date(Date.now() - 60_000).toISOString() }),
    );
    renderShell();
    const anchor = await screen.findByRole('button', { name: 'Work Session' });
    await waitFor(() => expect(anchor).toHaveAttribute('data-state', 'PAUSED'));
    expect(await screen.findByTestId('v4-work-session-strip')).toHaveAttribute(
      'data-state',
      'PAUSED',
    );
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    fireEvent.click(anchor);
    const tray = await screen.findByRole('dialog', { name: 'Work Session' });
    expect(tray).toHaveAttribute('data-state', 'PAUSED');
    expect(tray).toHaveTextContent('Paused');
  });

  it.each([
    ['INACTIVE', null],
    ['RUNNING', makeSession()],
    ['PAUSED', makeSession({ pausedAt: new Date().toISOString() })],
  ] as const)('keeps the minimal icon anchor available in %s', async (expectedState, session) => {
    apiMock.activeWorkSession.mockResolvedValue(session);
    renderShell('minimal');
    const anchor = await screen.findByRole('button', {
      name: `Work Session, ${expectedState.toLowerCase()}`,
    });
    expect(anchor).toHaveAttribute('data-mode', 'minimal');
    expect(anchor).toHaveAttribute('data-state', expectedState);
    fireEvent.click(anchor);
    expect(await screen.findByRole('dialog', { name: 'Work Session' })).toBeInTheDocument();
  });

  it('pauses and resumes the same server session without stop/start replacement', async () => {
    const running = makeSession();
    const paused = makeSession({ pausedAt: new Date().toISOString() });
    apiMock.activeWorkSession.mockResolvedValue(running);
    apiMock.pauseWorkSession.mockResolvedValue({ session: paused, replayed: false });
    apiMock.resumeWorkSession.mockResolvedValue({ session: running, replayed: false });
    renderShell();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(apiMock.pauseWorkSession).toHaveBeenCalledTimes(1);
    expect(apiMock.resumeWorkSession).toHaveBeenCalledTimes(1);
    expect(apiMock.stopWorkSession).not.toHaveBeenCalled();
    expect(apiMock.startWorkSession).not.toHaveBeenCalled();
  });

  it('stops authoritatively, hides the strip, and leaves an open tray in inactive state', async () => {
    apiMock.activeWorkSession.mockResolvedValue(makeSession());
    apiMock.stopWorkSession.mockResolvedValue({
      session: makeSession({ endedAt: new Date().toISOString() }),
      replayed: false,
    });
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Work Session' }));
    const tray = await screen.findByRole('dialog', { name: 'Work Session' });
    fireEvent.click(within(tray).getByRole('button', { name: 'Stop' }));

    await waitFor(() =>
      expect(screen.queryByTestId('v4-work-session-strip')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Work Session' })).toHaveAttribute(
      'data-state',
      'INACTIVE',
    );
  });

  it('supports Escape close and restores focus to the anchor without a modal focus trap', async () => {
    renderShell();
    const anchor = await screen.findByRole('button', { name: 'Work Session' });
    fireEvent.click(anchor);
    expect(await screen.findByRole('dialog', { name: 'Work Session' })).toHaveAttribute(
      'aria-modal',
      'false',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Work Session' })).not.toBeInTheDocument();
    expect(anchor).toHaveFocus();
  });

  it('coexists with a bounded dense technical page inside the shell height owner', async () => {
    apiMock.activeWorkSession.mockResolvedValue(makeSession());
    renderShell();
    expect(await screen.findByTestId('v4-work-session-strip')).toBeInTheDocument();
    expect(screen.getByTestId('dense-technical-page')).toBeInTheDocument();
    expect(screen.getByTestId('v4-shell')).toHaveAttribute('data-sidebar-mode', 'extended');
    expect(screen.getByTestId('v4-shell-main')).toContainElement(
      screen.getByTestId('dense-technical-page'),
    );
  });
});

function RouteProbe({ label, nextPath }: { label: string; nextPath?: string }) {
  const navigate = useNavigate();
  const workSession = useV4WorkSession();
  return (
    <V4AppShell context="project" sidebarMode="extended" onToggleSidebarMode={() => undefined}>
      <span data-testid="route-label">{label}</span>
      <span data-testid="session-id">{workSession.active?.id}</span>
      {nextPath ? (
        <button type="button" onClick={() => navigate(`/projects/${PROJECT_ID}/${nextPath}`)}>
          Next project page
        </button>
      ) : null}
    </V4AppShell>
  );
}

describe('V4 Work Session route persistence', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanupV4();
  });

  it('keeps one provider/session across project route unmounts without creating a session', async () => {
    stubMatchMedia();
    apiMock.activeWorkSession.mockResolvedValue(makeSession());
    apiMock.project.mockResolvedValue(makeProject());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <V4ThemeProvider>
          <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/summary`]}>
            <V4WorkSessionProvider>
              <Routes>
                <Route
                  path="/projects/:projectId/summary"
                  element={<RouteProbe label="Summary" nextPath="actions" />}
                />
                <Route
                  path="/projects/:projectId/actions"
                  element={<RouteProbe label="Actions" nextPath="luminaires" />}
                />
                <Route
                  path="/projects/:projectId/luminaires"
                  element={<RouteProbe label="Luminaires" nextPath="luminaire-schedule" />}
                />
                <Route
                  path="/projects/:projectId/luminaire-schedule"
                  element={<RouteProbe label="Luminaire Schedule" nextPath="technical-boq" />}
                />
                <Route
                  path="/projects/:projectId/technical-boq"
                  element={<RouteProbe label="Technical BOQ" />}
                />
              </Routes>
            </V4WorkSessionProvider>
          </MemoryRouter>
        </V4ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('session-id')).toHaveTextContent(SESSION_ID));
    fireEvent.click(screen.getByRole('button', { name: 'Work Session' }));
    expect(await screen.findByRole('dialog', { name: 'Work Session' })).toBeInTheDocument();
    for (const label of ['Actions', 'Luminaires', 'Luminaire Schedule', 'Technical BOQ']) {
      fireEvent.click(screen.getByRole('button', { name: 'Next project page' }));
      await waitFor(() => expect(screen.getByTestId('route-label')).toHaveTextContent(label));
      expect(screen.getByTestId('session-id')).toHaveTextContent(SESSION_ID);
      expect(screen.getByRole('dialog', { name: 'Work Session' })).toHaveAttribute(
        'data-state',
        'RUNNING',
      );
    }
    expect(apiMock.activeWorkSession).toHaveBeenCalledTimes(1);
    expect(apiMock.startWorkSession).not.toHaveBeenCalled();
  });
});
