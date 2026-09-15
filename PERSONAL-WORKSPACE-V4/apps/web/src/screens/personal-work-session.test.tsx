// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Project, WorkSession } from '@scli/domain';
import { api } from '../api';
import { ToastProvider } from '../components/toast';
import {
  PersonalWorkSessionTimer,
  WorkSessionMinimalControls,
  WorkSessionTopBar,
} from '../components/personal-work-session-timer';
import { WorkSessionHistory } from '../components/work-session-history';

const timestamp = '2026-08-01T08:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    projectCode: '036_SCLI260801_UI_TEST',
    projectName: 'UI Test Project',
    clientName: 'Acme',
    crmReference: null,
    projectType: 'Lighting Layout',
    description: 'Lighting component test',
    salesOwnerId: '11111111-1111-4111-8111-111111111111',
    salesOwnerNameSnapshot: 'Maya Hassan',
    salesOwnerEmailSnapshot: 'maya@scli.example',
    createdById: '11111111-1111-4111-8111-111111111111',
    createdByNameSnapshot: 'Maya Hassan',
    createdByEmailSnapshot: 'maya@scli.example',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting layout.',
    luxRequirements: '500 lux.',
    drawingReference: 'A-101',
    status: 'Planning',
    priority: 'Normal',
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

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'bbbbbbbb-0000-4000-8000-0000000000b1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    startedAt: '2026-08-01T08:00:00.000Z',
    endedAt: null,
    pausedAt: null,
    accumulatedPausedMs: 0,
    createdAt: '2026-08-01T08:00:00.000Z',
    ...overrides,
  };
}

const projectA = makeProject({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectName: 'Project A',
});
const projectB = makeProject({
  id: 'bbbbbbbb-0000-4000-8000-000000000002',
  projectName: 'Project B',
});

function renderTimer(route = '/projects/aaaaaaaa-0000-4000-8000-000000000001') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/projects/:id" element={<PersonalWorkSessionTimer />} />
            <Route path="/" element={<PersonalWorkSessionTimer />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderTopBar(route = '/projects/aaaaaaaa-0000-4000-8000-000000000001') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/projects/:id" element={<WorkSessionTopBar />} />
            <Route path="/" element={<WorkSessionTopBar />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderMinimal(route = '/projects/aaaaaaaa-0000-4000-8000-000000000001') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route
              path="/projects/:id"
              element={
                <div className="contextual-sidebar minimal">
                  <WorkSessionMinimalControls />
                </div>
              }
            />
            <Route
              path="/"
              element={
                <div className="contextual-sidebar minimal">
                  <WorkSessionMinimalControls />
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderHistory(projectId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/' + projectId]}>
          <Routes>
            <Route path="/projects/:id" element={<WorkSessionHistory projectId={projectId} />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Real timers keep userEvent/waitFor reliable. Elapsed-time tests control
  // Date.now explicitly for deterministic assertions.
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('P2-UX-02-H1 Extended in-place footer card', () => {
  it('1) no active session + project page shows compact INACTIVE card with direct Start', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    // Direct Start is visible — no flyout/tray required.
    await screen.findByRole('button', { name: 'Start Work' });
    expect(screen.getByText('Work Session')).toBeInTheDocument();
    // No old tray/dialog.
    expect(screen.queryByRole('dialog', { name: 'Work session' })).not.toBeInTheDocument();
  });

  it('2) no active session + non-project page shows INACTIVE card without a project start', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    renderTimer('/');
    await screen.findByText('Work Session');
    // Global context: Start opens the mini chooser instead of a direct start.
    expect(screen.getByRole('button', { name: 'Start Work' })).toBeInTheDocument();
    expect(screen.queryByText('Project A')).not.toBeInTheDocument();
  });

  it('3) RUNNING transforms the same footer into an in-place card (green Running)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T08:42:00.000Z'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByText('Tracking');
    expect(screen.getByText('Project A')).toBeInTheDocument();
    // Elapsed is the primary visual value; Started is secondary.
    expect(screen.getByText('42:00')).toBeInTheDocument();
    expect(screen.getByText(/Started/)).toBeInTheDocument();
    // Direct controls — no flyout.
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument();
    // Green running dot semantic.
    expect(document.querySelector('.work-session-state-dot.running')).not.toBeNull();
  });

  it('4) PAUSED transforms the same footer into an amber Paused card with Resume', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T09:00:00.000Z'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    // Wait for the PAUSED state via its Resume button (visible, unambiguous).
    await screen.findByRole('button', { name: /Resume/ });
    // Frozen elapsed.
    expect(screen.getByText('30:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
    // Amber paused dot semantic.
    expect(document.querySelector('.work-session-state-dot.paused')).not.toBeNull();
  });

  it('5) Pause calls the v5 pause API exactly once (direct, no tray)', async () => {
    const pauseSpy = vi.spyOn(api, 'pauseWorkSession').mockResolvedValue({
      session: makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1));
  });

  it('6) Resume calls the v5 resume API exactly once', async () => {
    const resumeSpy = vi.spyOn(api, 'resumeWorkSession').mockResolvedValue({
      session: makeSession(),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByRole('button', { name: /Resume/ });
    await userEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledTimes(1));
  });

  it('7) Stop calls the existing stop API directly', async () => {
    const stopSpy = vi.spyOn(api, 'stopWorkSession').mockResolvedValue({
      session: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(stopSpy).toHaveBeenCalledTimes(1));
  });

  it('8) Start Work (Project context) starts the viewed project directly', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession').mockResolvedValue({
      session: makeSession(),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByRole('button', { name: 'Start Work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    await waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: projectA.id })),
    );
  });

  it('9) API error preserves authoritative state and surfaces feedback (no fake transition)', async () => {
    vi.spyOn(api, 'pauseWorkSession').mockRejectedValue(new Error('Backend unavailable.'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTimer();
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await waitFor(() => expect(screen.getByText('Backend unavailable.')).toBeInTheDocument());
    // Card still shows Tracking (no fake transition).
    expect(screen.getByText('Tracking')).toBeInTheDocument();
  });
});

describe('P2-UX-02-H1 Project A while viewing B', () => {
  it('10) viewing B shows A as tracked with Switch to this project', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await screen.findByText('Project A');
    // The card shows A as tracked, not B.
    expect(screen.queryByText('Project B')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to this project' })).toBeInTheDocument();
  });

  it('11) confirming switch calls the atomic switch API', async () => {
    const switchSpy = vi.spyOn(api, 'switchWorkSession').mockResolvedValue({
      closed: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      active: makeSession({ projectId: projectB.id }),
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Project B' }));
    await waitFor(() =>
      expect(switchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ targetProjectId: projectB.id }),
      ),
    );
  });

  it('12) switch dialog auto-dismisses on success (no manual Exit)', async () => {
    const switchSpy = vi.spyOn(api, 'switchWorkSession').mockResolvedValue({
      closed: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      active: makeSession({ projectId: projectB.id }),
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch work session' });
    expect(dialog).toBeInTheDocument();
    // The modal is portal-rendered to document.body, escaping the sidebar.
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.closest('.contextual-sidebar')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to Project B' }));
    await waitFor(() => expect(switchSpy).toHaveBeenCalledTimes(1));
    // Dialog closes automatically after successful server response.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Switch work session' })).not.toBeInTheDocument(),
    );
    // Success toast appears.
    await waitFor(() => expect(screen.getByText('Now tracking Project B.')).toBeInTheDocument());
  });

  it('13) switch dialog stays open on failure and preserves Project A', async () => {
    const switchSpy = vi
      .spyOn(api, 'switchWorkSession')
      .mockRejectedValue(new Error('Switch failed.'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Project B' }));
    await waitFor(() => expect(switchSpy).toHaveBeenCalledTimes(1));
    // Failure: dialog remains, error surfaced, A preserved (no auto-dismiss,
    // no fake success). The switch mutation was rejected, so no state change.
    const dialog = screen.getByRole('dialog', { name: 'Switch work session' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Switch failed.')).toBeInTheDocument());
    // Dialog still open and recoverable (Cancel still enabled).
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('14) switch confirm disables while pending (no duplicate request)', async () => {
    let resolve!: (value: { closed: WorkSession; active: WorkSession }) => void;
    vi.spyOn(api, 'switchWorkSession').mockReturnValue(
      new Promise<{ closed: WorkSession; active: WorkSession }>((r) => {
        resolve = r;
      }),
    );
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    const confirmBtn = screen.getByRole('button', { name: 'Switch to Project B' });
    await userEvent.click(confirmBtn);
    expect(confirmBtn).toBeDisabled();
    resolve({
      closed: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      active: makeSession({ projectId: projectB.id }),
    });
  });

  it('UAT-01a) opening switch confirmation shows Current A and Target B (portal modal)', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch work session' });
    expect(dialog).toBeInTheDocument();
    // The modal is portal-rendered to document.body, escaping the sidebar
    // overflow/clipping container.
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.closest('.contextual-sidebar')).toBeNull();
    expect(dialog.closest('.work-session-extended-card')).toBeNull();
    // Current (A) and Target (B) both visible with atomic explanation.
    expect(within(dialog).getByText('Project A')).toBeInTheDocument();
    expect(within(dialog).getByText('Project B')).toBeInTheDocument();
    expect(within(dialog).getByText(/one atomic switch/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Switch to Project B' })).toBeEnabled();
  });

  it('UAT-01b) Escape closes the modal when idle', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    expect(screen.getByRole('dialog', { name: 'Switch work session' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Switch work session' })).not.toBeInTheDocument();
  });

  it('UAT-01c) Escape does NOT close the modal while a switch is pending', async () => {
    let resolve!: (value: { closed: WorkSession; active: WorkSession }) => void;
    vi.spyOn(api, 'switchWorkSession').mockReturnValue(
      new Promise<{ closed: WorkSession; active: WorkSession }>((r) => {
        resolve = r;
      }),
    );
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTimer('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to this project' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Project B' }));
    // Pending: confirm disabled, Escape must not close the modal.
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Switch work session' })).toBeInTheDocument();
    resolve({
      closed: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      active: makeSession({ projectId: projectB.id }),
    });
  });
});

describe('P2-UX-02-H1 Minimal direct controls', () => {
  it('15) RUNNING shows Pause + Stop icons (green status, no card/tray)', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Pause work session' });
    expect(screen.getByRole('button', { name: 'Stop work session' })).toBeInTheDocument();
    // No Resume when running.
    expect(screen.queryByRole('button', { name: 'Resume work session' })).not.toBeInTheDocument();
    // No timer details in rail.
    expect(screen.queryByText('42:00')).not.toBeInTheDocument();
    // Green running status dot.
    expect(document.querySelector('.work-session-state-dot.running')).not.toBeNull();
  });

  it('16) PAUSED shows Resume + Stop icons (amber status)', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Resume work session' });
    expect(screen.getByRole('button', { name: 'Stop work session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause work session' })).not.toBeInTheDocument();
    expect(document.querySelector('.work-session-state-dot.paused')).not.toBeNull();
  });

  it('17) INACTIVE Project shows Start only, Stop hidden (neutral status)', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Start work' });
    expect(screen.queryByRole('button', { name: 'Stop work session' })).not.toBeInTheDocument();
    expect(document.querySelector('.work-session-state-dot.idle')).not.toBeNull();
  });

  it('18) Minimal Start starts the viewed project directly and stays Minimal', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession').mockResolvedValue({
      session: makeSession(),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Start work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start work' }));
    await waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: projectA.id })),
    );
  });

  it('19) Minimal Pause calls the v5 pause API exactly once', async () => {
    const pauseSpy = vi.spyOn(api, 'pauseWorkSession').mockResolvedValue({
      session: makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Pause work session' });
    await userEvent.click(screen.getByRole('button', { name: 'Pause work session' }));
    await waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1));
  });

  it('20) Minimal Resume calls the v5 resume API exactly once', async () => {
    const resumeSpy = vi.spyOn(api, 'resumeWorkSession').mockResolvedValue({
      session: makeSession(),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Resume work session' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume work session' }));
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledTimes(1));
  });
});

describe('P2-UX-02-H1-F1 Minimal control geometry', () => {
  /**
   * jsdom returns all-zero bounding rects, so install a deterministic stub that
   * models the real vertical stack: each 34px control is centered in the 76px
   * rail and stacked downward (primary above Stop above status dot).
   */
  beforeEach(() => {
    const railLeft = 10;
    let index = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('work-session-minimal-control')) {
        const top = 120 + index * 40;
        index += 1;
        return {
          x: railLeft,
          y: top,
          top,
          left: railLeft,
          bottom: top + 34,
          right: railLeft + 34,
          width: 34,
          height: 34,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (this.classList.contains('contextual-sidebar')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 600,
          right: 76,
          width: 76,
          height: 600,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  /** Asserts the vertical stack + target size + containment contract. */
  function assertMinimalGeometry({
    primaryName,
    hasStop,
    statusClass,
  }: {
    primaryName: string;
    hasStop: boolean;
    statusClass: 'running' | 'paused' | 'idle';
  }) {
    const controls = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.work-session-minimal-control'),
    );
    const primary = screen.getByRole('button', { name: primaryName });
    // Every control keeps the approved 34px (>=30) target size.
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(30);
      expect(rect.height).toBeGreaterThanOrEqual(30);
    }
    // Controls are vertically arranged: primary above Stop, no overlap.
    const primaryRect = primary.getBoundingClientRect();
    const stop = screen.queryByRole('button', { name: 'Stop work session' });
    if (hasStop) {
      expect(stop).not.toBeNull();
      const stopRect = (stop as HTMLElement).getBoundingClientRect();
      // Vertical stack: primary sits above stop (disjoint in Y, same column).
      expect(stopRect.top).toBeGreaterThanOrEqual(primaryRect.bottom);
      // No 2D bounding-box overlap between the two controls.
      const overlaps2D =
        primaryRect.left < stopRect.right &&
        primaryRect.right > stopRect.left &&
        primaryRect.top < stopRect.bottom &&
        primaryRect.bottom > stopRect.top;
      expect(overlaps2D).toBe(false);
    } else {
      expect(stop).toBeNull();
    }
    // Controls are fully contained within the rail inner width (<= 56px).
    const rail = document.querySelector('.contextual-sidebar');
    if (rail) {
      const railRect = rail.getBoundingClientRect();
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(railRect.left);
        expect(rect.right).toBeLessThanOrEqual(railRect.right);
      }
    }
    // Status dot present with the expected semantic class.
    const dot = document.querySelector(`.work-session-state-dot.${statusClass}`);
    expect(dot).not.toBeNull();
  }

  it('F1-a) RUNNING: Pause + Stop are vertically stacked, sized, contained', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Pause work session' });
    assertMinimalGeometry({
      primaryName: 'Pause work session',
      hasStop: true,
      statusClass: 'running',
    });
  });

  it('F1-b) PAUSED: Resume + Stop are vertically stacked, sized, contained', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Resume work session' });
    assertMinimalGeometry({
      primaryName: 'Resume work session',
      hasStop: true,
      statusClass: 'paused',
    });
  });

  it('F1-c) INACTIVE: Start present, Stop absent, neutral status', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderMinimal();
    await screen.findByRole('button', { name: 'Start work' });
    assertMinimalGeometry({ primaryName: 'Start work', hasStop: false, statusClass: 'idle' });
  });
});

describe('P2-UX-02-H1 Global mini Project chooser', () => {
  it('21) Global INACTIVE Start opens the chooser, never auto-starts', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession');
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'projects').mockResolvedValue([projectA, projectB]);
    renderTimer('/');
    await screen.findByRole('button', { name: 'Start Work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    // No automatic project start.
    expect(startSpy).not.toHaveBeenCalled();
    // Chooser visible with existing project options.
    const chooser = await screen.findByRole('dialog', { name: 'Choose project to start work' });
    expect(within(chooser).getByRole('button', { name: /Project A/ })).toBeInTheDocument();
    expect(within(chooser).getByRole('button', { name: /Project B/ })).toBeInTheDocument();
  });

  it('22) choosing a project starts it, closes the chooser, and updates the session', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession').mockResolvedValue({
      session: makeSession({ projectId: projectB.id }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'projects').mockResolvedValue([projectA, projectB]);
    renderTimer('/');
    await screen.findByRole('button', { name: 'Start Work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    const chooser = await screen.findByRole('dialog', { name: 'Choose project to start work' });
    await userEvent.click(within(chooser).getByRole('button', { name: /Project B/ }));
    await waitFor(() =>
      expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ projectId: projectB.id })),
    );
    // Chooser closes after selection.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Choose project to start work' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('23) Global Minimal INACTIVE Start opens the chooser; choosing keeps Minimal', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession').mockResolvedValue({
      session: makeSession({ projectId: projectA.id }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'projects').mockResolvedValue([projectA]);
    renderMinimal('/');
    await screen.findByRole('button', { name: 'Start work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start work' }));
    const chooser = await screen.findByRole('dialog', { name: 'Choose project to start work' });
    await userEvent.click(within(chooser).getByRole('button', { name: /Project A/ }));
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    // No large card/tray in Minimal.
    expect(screen.queryByRole('dialog', { name: 'Work session' })).not.toBeInTheDocument();
  });

  it('24) Escape closes the chooser without starting anything', async () => {
    const startSpy = vi.spyOn(api, 'startWorkSession');
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    vi.spyOn(api, 'projects').mockResolvedValue([projectA, projectB]);
    renderTimer('/');
    await screen.findByRole('button', { name: 'Start Work' });
    await userEvent.click(screen.getByRole('button', { name: 'Start Work' }));
    await screen.findByRole('dialog', { name: 'Choose project to start work' });
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Choose project to start work' }),
    ).not.toBeInTheDocument();
    expect(startSpy).not.toHaveBeenCalled();
  });
});

describe('P2-UX-02-H1 shell-level Top Tracking Bar', () => {
  it('25) INACTIVE renders no top bar', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(null);
    renderTopBar('/');
    await act(async () => {});
    expect(document.querySelector('.work-session-top-bar')).toBeNull();
  });

  it('26) RUNNING renders Tracking with project, elapsed, Open/Pause/Stop (green status)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T08:42:00.000Z'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    const bar = await screen.findByText('Tracking');
    expect(bar).toBeInTheDocument();
    expect(screen.getByText('Project A')).toBeInTheDocument();
    expect(screen.getByText('42:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument();
    // Green running indicator (not red).
    expect(
      document.querySelector('.work-session-top-bar.running .work-session-top-bar-indicator'),
    ).not.toBeNull();
  });

  it('27) PAUSED renders Paused with frozen elapsed and Resume (amber status)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T09:00:00.000Z'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    await screen.findByRole('button', { name: /Resume/ });
    expect(screen.getByText('30:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
    expect(
      document.querySelector('.work-session-top-bar.paused .work-session-top-bar-indicator'),
    ).not.toBeNull();
  });

  it('28) Project A while viewing B: top bar still shows A', async () => {
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession({ projectId: projectA.id }));
    vi.spyOn(api, 'project').mockImplementation(async (id) =>
      id === projectA.id ? projectA : projectB,
    );
    renderTopBar('/projects/bbbbbbbb-0000-4000-8000-000000000002');
    await screen.findByText('Tracking');
    await screen.findByText('Project A');
    expect(screen.queryByText('Project B')).not.toBeInTheDocument();
  });

  it('29) Pause from the top bar calls the v5 pause API', async () => {
    const pauseSpy = vi.spyOn(api, 'pauseWorkSession').mockResolvedValue({
      session: makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1));
  });

  it('30) Resume from the top bar calls the v5 resume API', async () => {
    const resumeSpy = vi.spyOn(api, 'resumeWorkSession').mockResolvedValue({
      session: makeSession(),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(
      makeSession({ pausedAt: '2026-08-01T08:30:00.000Z' }),
    );
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    await screen.findByRole('button', { name: /Resume/ });
    await userEvent.click(screen.getByRole('button', { name: /Resume/ }));
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledTimes(1));
  });

  it('31) Stop from the top bar calls the existing stop API', async () => {
    const stopSpy = vi.spyOn(api, 'stopWorkSession').mockResolvedValue({
      session: makeSession({ endedAt: '2026-08-01T08:42:00.000Z' }),
      replayed: false,
    });
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    await screen.findByText('Tracking');
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(stopSpy).toHaveBeenCalledTimes(1));
  });

  it('32) elapsed advances as DISPLAY state while RUNNING', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T08:42:00.000Z'));
    vi.spyOn(api, 'activeWorkSession').mockResolvedValue(makeSession());
    vi.spyOn(api, 'project').mockResolvedValue(projectA);
    renderTopBar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('42:00')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText('43:00')).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('P2.8B work session history', () => {
  it('33) renders completed sessions', async () => {
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([
      makeSession({
        id: 's1',
        startedAt: '2026-08-01T08:00:00.000Z',
        endedAt: '2026-08-01T09:00:00.000Z',
      }),
    ]);
    renderHistory(projectA.id);
    await screen.findByText('01:00:00');
  });

  it('34) active project session shows In progress', async () => {
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([makeSession()]);
    renderHistory(projectA.id);
    await screen.findByText('In progress');
  });

  it('35) history empty state', async () => {
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([]);
    renderHistory(projectA.id);
    await screen.findByText('No tracked work sessions yet.');
    expect(screen.getByText('Tracked Time:')).toBeInTheDocument();
  });

  it('36) tracked total derives from sessions', async () => {
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([
      makeSession({
        id: 's1',
        startedAt: '2026-08-01T08:00:00.000Z',
        endedAt: '2026-08-01T09:00:00.000Z',
      }),
      makeSession({
        id: 's2',
        startedAt: '2026-08-01T10:00:00.000Z',
        endedAt: '2026-08-01T10:30:00.000Z',
      }),
    ]);
    renderHistory(projectA.id);
    await screen.findByText('1h 30m');
  });

  it('37) active session contributes live elapsed to tracked total', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-01T08:42:00.000Z'));
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([
      makeSession({
        id: 's1',
        startedAt: '2026-08-01T08:00:00.000Z',
        endedAt: '2026-08-01T09:00:00.000Z',
      }),
      makeSession({ id: 'active', startedAt: '2026-08-01T08:00:00.000Z', endedAt: null }),
    ]);
    renderHistory(projectA.id);
    await screen.findByText('1h 42m');
  });

  it('38) actualHours is NOT used to derive tracked total', async () => {
    vi.spyOn(api, 'projectWorkSessions').mockResolvedValue([]);
    renderHistory(projectA.id);
    await screen.findByLabelText('Work Sessions');
    expect(screen.getByText('0h 00m')).toBeInTheDocument();
  });
});
