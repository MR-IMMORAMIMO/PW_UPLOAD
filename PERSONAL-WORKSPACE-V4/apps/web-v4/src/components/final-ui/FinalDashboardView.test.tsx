/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import FinalDashboardView from './FinalDashboardView';
import { V4OverlayProvider } from '../interaction/V4OverlayProvider';
import { stubMatchMedia } from '../../test-utils/renderV4';

const mocks = vi.hoisted(() => ({ start: vi.fn(), active: false }));
vi.mock('../work-session/WorkSessionProvider', () => ({
  useV4WorkSession: () => ({
    active: mocks.active
      ? {
          projectId: 'project-a',
          startedAt: '2026-09-11T07:00:00.000Z',
          pausedAt: null,
          accumulatedPausedMs: 120_000,
        }
      : null,
    activeProject: mocks.active
      ? { projectName: 'Alpha', projectCode: 'A', status: 'Planning', designStage: 'Concept' }
      : null,
    state: mocks.active ? 'RUNNING' : null,
    elapsedSeconds: 0,
    start: mocks.start,
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('./FinalDashboardData', () => ({
  useDashboardData: () => ({
    ATTENTION: [],
    OVERDUE_ALL: [],
    MEETINGS_ALL: [],
    BLOCKING_ALL: [],
    DELIVERABLES_ALL: [],
    OPERATIONS_ALL: [
      {
        section: 'Overdue Actions',
        items: [{ key: 'action-a', primary: 'Overdue action A', open: vi.fn() }],
      },
      {
        section: 'Blocking Requirements',
        items: [{ key: 'requirement-a', primary: 'Missing drawing', open: vi.fn() }],
      },
    ],
    PROJECTS: [
      { key: 'project-a', id: 'A', status: 'Planning', pct: 0, open: vi.fn() },
      { key: 'project-b', id: 'B', status: 'Client Review', pct: 80, open: vi.fn() },
    ],
    dashboard: {
      activeProjects: [
        {
          id: 'project-a',
          projectName: 'Alpha',
          projectCode: 'A',
          status: 'Planning',
          requiredDeliveryDate: '',
        },
        {
          id: 'project-b',
          projectName: 'Beta',
          projectCode: 'B',
          status: 'ClientReview',
          requiredDeliveryDate: '',
        },
      ],
      kpis: [
        { id: 'active', label: 'Active Projects', count: 2 },
        { id: 'dueThisWeek', label: 'Due This Week', count: 0 },
        { id: 'revisionRequired', label: 'Revision Required', count: 0 },
        { id: 'clientReview', label: 'Client Review', count: 1 },
      ],
    },
  }),
}));
beforeEach(() => {
  stubMatchMedia();
  mocks.active = false;
  mocks.start.mockClear();
});
afterEach(cleanup);
function mount() {
  return render(
    <MemoryRouter>
      <V4OverlayProvider>
        <FinalDashboardView />
        <Location />
      </V4OverlayProvider>
    </MemoryRouter>,
  );
}
function Location() {
  const location = useLocation();
  return <output aria-label="Destination">{location.pathname + location.search}</output>;
}
it('hides the idle banner and starts the explicitly selected project from the Figma card', async () => {
  mount();
  expect(screen.queryByRole('button', { name: 'Collapse session banner' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Session' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Project for work session/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Alpha · A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));
  expect(mocks.start).toHaveBeenCalledWith('project-a');
});
it.each([
  [/Active Projects 2 Open projects/, 'active'],
  [/Due This Week 0 Due in 7 days/, 'dueThisWeek'],
  [/Revision Required 0 Awaiting your revisions/, 'revisionRequired'],
  [/Client Review 1 Awaiting client feedback/, 'clientReview'],
] as const)('opens Projects with its matching KPI filter: %s', async (name, filter) => {
  mount();
  fireEvent.click(screen.getByRole('button', { name }));
  expect(screen.getByLabelText('Destination')).toHaveTextContent(`/projects?dashboard=${filter}`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('retains the running session controls', () => {
  mocks.active = true;
  mount();
  expect(screen.getByRole('button', { name: 'Collapse session banner' })).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(2);
});
it('opens session details before navigating to the associated project', async () => {
  mocks.active = true;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  const dialog = await screen.findByRole('dialog', { name: 'Work Session Details' });
  expect(within(dialog).getByText('Alpha')).toBeVisible();
  expect(within(dialog).getByText('00:02:00')).toBeVisible();
  expect(screen.getByLabelText('Destination')).toHaveTextContent(/^\/$/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Open Project' }));
  expect(screen.getByLabelText('Destination')).toHaveTextContent('/projects/project-a/summary');
});
it.each(['Overdue Actions', 'Upcoming Meetings', 'Blocking Requirements', 'Upcoming Deliverables'])(
  'opens the %s group from its heading even when empty',
  async (name) => {
    mount();
    fireEvent.click(screen.getByRole('button', { name }));
    const dialog = await screen.findByRole('dialog', { name });
    expect(within(dialog).getByText('No items in this group.')).toBeVisible();
  },
);
it('filters the All Operations float by group', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'View all operations' }));
  const dialog = await screen.findByRole('dialog', { name: 'All Operations' });
  expect(within(dialog).getByText('Overdue action A')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: /Operation group/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Blocking Requirements' }));
  expect(within(dialog).getByText('Missing drawing')).toBeVisible();
  expect(within(dialog).queryByText('Overdue action A')).not.toBeInTheDocument();
});
