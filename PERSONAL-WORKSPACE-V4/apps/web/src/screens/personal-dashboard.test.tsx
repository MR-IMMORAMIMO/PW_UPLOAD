// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Project } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { PersonalDashboardScreen } from './personal-dashboard';
import { deriveDashboardView, needAttentionReason } from '../personal-dashboard-model';

vi.mock('../app-context', () => ({ useAppContext: vi.fn() }));

// Pin the workspace date helpers so the windows are deterministically:
//   Due This Week: 2026-08-01 .. 2026-08-08  (+7)
//   Due Soon:      2026-08-01 .. 2026-08-03  (+2)
// without fake timers (which hang @testing-library's findBy* / userEvent). The
// component imports these from ../local-date, so mocking the module is the safe seam.
vi.mock('../local-date', () => ({
  workspaceDateKey: () => '2026-08-01',
  addCalendarDays: (_dateKey: string, days: number) => {
    const base = new Date('2026-08-01T12:00:00.000Z');
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  },
}));

const timestamp = '2026-07-15T08:00:00.000Z';

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

// Canonical fixture set relative to TODAY=2026-08-01 / window ends 2026-08-08.
const overdue = makeProject({
  id: 'overdue-0000-4000-8000-000000000001',
  projectName: 'Overdue Project',
  status: 'InProgress',
  requiredDeliveryDate: '2026-07-30',
  updatedAt: '2026-07-30T08:00:00.000Z',
});
const dueThisWeek = makeProject({
  id: 'dueweek-0000-4000-8000-000000000002',
  projectName: 'Due This Week Project',
  status: 'InProgress',
  requiredDeliveryDate: '2026-08-03',
  updatedAt: '2026-08-03T08:00:00.000Z',
});
const dueBoundary = makeProject({
  id: 'boundary-0000-4000-8000-000000000003',
  projectName: 'Due Boundary Project',
  status: 'InProgress',
  requiredDeliveryDate: '2026-08-08',
  updatedAt: '2026-08-08T08:00:00.000Z',
});
const revision = makeProject({
  id: 'revision-0000-4000-8000-000000000004',
  projectName: 'Revision Project',
  status: 'RevisionRequired',
  requiredDeliveryDate: '2026-08-20',
  updatedAt: '2026-08-06T08:00:00.000Z',
});
const clientReview = makeProject({
  id: 'clientreview-0000-4000-8000-000000000005',
  projectName: 'Client Review Project',
  status: 'ClientReview',
  requiredDeliveryDate: '2026-08-15',
  updatedAt: '2026-08-07T08:00:00.000Z',
});
const onHold = makeProject({
  id: 'onhold-0000-4000-8000-000000000006',
  projectName: 'On Hold Project',
  status: 'OnHold',
  requiredDeliveryDate: '2026-08-10',
  updatedAt: '2026-08-05T08:00:00.000Z',
});
const completed = makeProject({
  id: 'completed-0000-4000-8000-000000000007',
  projectName: 'Completed Project',
  status: 'Completed',
  requiredDeliveryDate: '2026-08-05',
  updatedAt: '2026-08-04T08:00:00.000Z',
});

const ALL = [overdue, dueThisWeek, dueBoundary, revision, clientReview, onHold, completed];

function renderDashboard(projects: Project[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(api, 'projects').mockResolvedValue(projects);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <PersonalDashboardScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setActor() {
  vi.mocked(useAppContext).mockReturnValue({
    currentUser: {
      id: '66666666-6666-4666-8666-666666666666',
      entraObjectId: 'entra-66666666-6666-4666-8666-666666666666',
      displayName: 'Mohamed',
      email: 'mohamed@scientechnic.local',
      jobTitle: 'Lighting Designer',
      department: 'Design Studio',
      role: 'Admin',
      weeklyCapacityHours: 40,
      availabilityStatus: 'Available',
      avatarUrl: null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    mockUsers: [],
    integrationStatus: {
      mode: 'standalone',
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
    themePreference: 'dark',
    resolvedTheme: 'dark',
    setThemePreference: vi.fn(),
  });
}

describe('Personal Dashboard — KPI derivation', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('counts Active as all non-terminal projects', async () => {
    renderDashboard(ALL);
    const activeKpi = await screen.findByRole('button', { name: /^Active — 6 projects/ });
    expect(activeKpi).toHaveAttribute('aria-pressed', 'true');
  });

  it('counts Due This Week for today through the next 7 days', async () => {
    renderDashboard(ALL);
    const dueKpi = await screen.findByRole('button', { name: /^Due This Week — 2 projects/ });
    expect(dueKpi).toBeInTheDocument();
    expect(dueKpi).toHaveAttribute('aria-pressed', 'false');
  });

  it('excludes overdue projects from Due This Week', async () => {
    renderDashboard(ALL);
    await screen.findByRole('button', { name: /^Active — 6 projects/ });
    // Only dueThisWeek (08-03) and dueBoundary (08-08) count; overdue (07-30) is excluded.
    expect(screen.getByRole('button', { name: /^Due This Week — 2 projects/ })).toBeInTheDocument();
  });

  it('counts Revision Required using only the canonical status', async () => {
    renderDashboard(ALL);
    await screen.findByRole('button', { name: /^Active — 6 projects/ });
    expect(
      screen.getByRole('button', { name: /^Revision Required — 1 project/ }),
    ).toBeInTheDocument();
  });

  it('counts Client Review using only the canonical status', async () => {
    renderDashboard(ALL);
    await screen.findByRole('button', { name: /^Active — 6 projects/ });
    expect(screen.getByRole('button', { name: /^Client Review — 1 project/ })).toBeInTheDocument();
  });
});

describe('Personal Dashboard — Need Attention ordering', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('orders overdue before revision before due-soon', async () => {
    renderDashboard(ALL);
    const section = await screen.findByLabelText('Need attention');
    const rows = within(section).getAllByRole('link');
    const names = rows.map((row) => within(row).getByText(/Project/).textContent ?? '');
    // overdue first, then revision (not overdue), then due-soon by date.
    expect(names.indexOf('Overdue Project')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Overdue Project')).toBeLessThan(names.indexOf('Revision Project'));
    expect(names.indexOf('Revision Project')).toBeLessThan(names.indexOf('Due This Week Project'));
  });

  it('shows a positive empty state when nothing needs attention', async () => {
    renderDashboard([completed]);
    await screen.findByLabelText('Need attention');
    expect(await screen.findByText('Nothing needs immediate attention.')).toBeInTheDocument();
  });
});

describe('Personal Dashboard — KPI filtering', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('selected KPI filters the Active Projects table', async () => {
    renderDashboard(ALL);
    await screen.findByLabelText('Need attention');
    const user = userEvent.setup();
    const dueKpi = screen.getByRole('button', { name: /^Due This Week — 2 projects/ });
    await user.click(dueKpi);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Due This Week Project')).toBeInTheDocument();
    expect(within(table).getByText('Due Boundary Project')).toBeInTheDocument();
    expect(within(table).queryByText('Overdue Project')).not.toBeInTheDocument();
  });

  it('reset returns to the normal Active Projects view', async () => {
    renderDashboard(ALL);
    await screen.findByLabelText('Need attention');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Revision Required — 1 project/ }));

    const filteredTable = await screen.findByRole('table');
    expect(within(filteredTable).getByText('Revision Project')).toBeInTheDocument();
    expect(within(filteredTable).queryByText('Overdue Project')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reset to all active/ }));
    const resetTable = screen.getByRole('table');
    expect(within(resetTable).getByText('Overdue Project')).toBeInTheDocument();
    expect(within(resetTable).getByText('Due This Week Project')).toBeInTheDocument();
  });
});

describe('Personal Dashboard — sections', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the Workload Snapshot with canonical statuses', async () => {
    renderDashboard(ALL);
    await screen.findByLabelText('Workload snapshot');
    const workload = screen.getByLabelText('Workload snapshot');
    expect(within(workload).getByText('3')).toBeInTheDocument();
    expect(within(workload).getByText('Client Review')).toBeInTheDocument();
    expect(within(workload).getByText('Revision Required')).toBeInTheDocument();
  });

  it('renders Waiting / External from canonical On Hold and Client Review states', async () => {
    renderDashboard(ALL);
    const section = await screen.findByLabelText('Waiting / External');
    expect(within(section).getByText('On Hold Project')).toBeInTheDocument();
    expect(within(section).getByText('Client Review Project')).toBeInTheDocument();
    expect(within(section).queryByText('Overdue Project')).not.toBeInTheDocument();
  });

  it('shows a Waiting / External empty state when none exist', async () => {
    renderDashboard([overdue, dueThisWeek]);
    const section = await screen.findByLabelText('Waiting / External');
    expect(
      within(section).getByText(/No projects are currently waiting on external review or hold/),
    ).toBeInTheDocument();
  });

  it('orders Recently Updated Projects most recently updated first', async () => {
    renderDashboard(ALL);
    const section = await screen.findByLabelText('Recently updated projects');
    const links = within(section).getAllByRole('link');
    const names = links.map((link) => link.textContent ?? '');
    // updatedAt desc: boundary (08-08), clientReview (08-07), revision (08-06),
    // onHold (08-05), completed (08-04), dueThisWeek (08-03).
    expect(names[0]).toContain('Due Boundary Project');
    expect(names[1]).toContain('Client Review Project');
    expect(names[2]).toContain('Revision Project');
  });
});

describe('Personal Dashboard — empty, loading and error states', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a coherent empty workspace with a New Project CTA for zero projects', async () => {
    renderDashboard([]);
    expect(await screen.findByText('Your workspace is ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Project' })).toBeInTheDocument();
    // Do not render six empty dashboard sections around the empty state.
    expect(screen.queryByLabelText('Workload snapshot')).not.toBeInTheDocument();
  });

  it('shows a loading state before project data resolves', () => {
    vi.spyOn(api, 'projects').mockReturnValue(new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <PersonalDashboardScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Building your lighting dashboard…')).toBeInTheDocument();
  });

  it('shows an error state with retry when loading fails', async () => {
    vi.spyOn(api, 'projects').mockRejectedValue(new Error('Network failure'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <PersonalDashboardScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Network failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});

describe('Personal Dashboard — navigation and data integrity', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('navigates projects by the canonical project UUID, not the display name', async () => {
    renderDashboard(ALL);
    await screen.findByLabelText('Need attention');
    const openAction = screen.getByRole('link', { name: `Open ${overdue.projectName}` });
    expect(openAction).toHaveAttribute('href', `/projects/${overdue.id}`);
  });

  it('uses the canonical UUID for the Need Attention row link', async () => {
    renderDashboard(ALL);
    const section = await screen.findByLabelText('Need attention');
    const rowLink = within(section).getByRole('link', { name: /Overdue Project/ });
    expect(rowLink).toHaveAttribute('href', `/projects/${overdue.id}`);
  });
});

describe('Personal Dashboard — H1 Due Soon boundary + Active ordering (model)', () => {
  const TODAY = '2026-08-01';
  const END_DATE = '2026-08-08'; // +7 (Due This Week)
  const SOON_END = '2026-08-03'; // +2 (Due Soon)

  const dueAt = (date: string, status: Project['status'] = 'InProgress', name = 'Project') =>
    makeProject({ projectName: name, status, requiredDeliveryDate: date });

  it('A) yesterday is overdue, not due soon', () => {
    const p = dueAt('2026-07-31', 'InProgress', 'Yesterday');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    expect(needAttentionReason(p, TODAY)).toBe('overdue');
    expect(view.needAttention.map((x) => x.projectName)).toEqual(['Yesterday']);
    // yesterday is not in Due This Week either.
    expect(view.kpis.find((k) => k.id === 'dueThisWeek')!.count).toBe(0);
  });

  it('B) today is due soon', () => {
    const p = dueAt('2026-08-01', 'InProgress', 'Today');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    expect(needAttentionReason(p, TODAY)).toBe('due');
    expect(view.needAttention.map((x) => x.projectName)).toEqual(['Today']);
  });

  it('C) today + 1 is due soon', () => {
    const p = dueAt('2026-08-02', 'InProgress', 'Tomorrow');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    expect(needAttentionReason(p, TODAY)).toBe('due');
    expect(view.needAttention.map((x) => x.projectName)).toEqual(['Tomorrow']);
  });

  it('D) today + 2 is due soon', () => {
    const p = dueAt('2026-08-03', 'InProgress', 'PlusTwo');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    expect(needAttentionReason(p, TODAY)).toBe('due');
    expect(view.needAttention.map((x) => x.projectName)).toEqual(['PlusTwo']);
  });

  it('E) today + 3 is NOT due soon but still Due This Week', () => {
    const p = dueAt('2026-08-04', 'InProgress', 'PlusThree');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    // +3 is outside the +2 window, so it is NOT in Need Attention.
    expect(view.needAttention.map((x) => x.projectName)).toEqual([]);
    // But it IS in Due This Week.
    expect(view.kpis.find((k) => k.id === 'dueThisWeek')!.count).toBe(1);
  });

  it('F) today + 7 is Due This Week but NOT Due Soon', () => {
    const p = dueAt('2026-08-08', 'InProgress', 'PlusSeven');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    expect(view.needAttention.map((x) => x.projectName)).toEqual([]);
    expect(view.kpis.find((k) => k.id === 'dueThisWeek')!.count).toBe(1);
  });

  it('G) Revision Required + overdue appears once as OVERDUE with Revision badge', () => {
    const p = dueAt('2026-07-30', 'RevisionRequired', 'RevOverdue');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    const entries = view.needAttention.filter((x) => x.projectName === 'RevOverdue');
    expect(entries).toHaveLength(1);
    expect(needAttentionReason(entries[0]!, TODAY)).toBe('overdue');
    expect(entries[0]!.status).toBe('RevisionRequired'); // secondary info preserved
  });

  it('H) Revision Required + tomorrow appears once as REVISION, not a duplicate Due Soon', () => {
    const p = dueAt('2026-08-02', 'RevisionRequired', 'RevTomorrow');
    const view = deriveDashboardView([p], TODAY, END_DATE, SOON_END);
    const entries = view.needAttention.filter((x) => x.projectName === 'RevTomorrow');
    expect(entries).toHaveLength(1);
    expect(needAttentionReason(entries[0]!, TODAY)).toBe('revision');
    expect(entries[0]!.status).toBe('RevisionRequired');
  });

  it('I) activeProjects returns delivery dates ascending', () => {
    const c = dueAt('2026-08-08', 'InProgress', 'C');
    const a = dueAt('2026-08-01', 'InProgress', 'A');
    const b = dueAt('2026-08-03', 'InProgress', 'B');
    const view = deriveDashboardView([c, a, b], TODAY, END_DATE, SOON_END);
    expect(view.activeProjects.map((x) => x.projectName)).toEqual(['A', 'B', 'C']);
  });

  it('J) derived ordering does not mutate the source collection order', () => {
    const c = dueAt('2026-08-08', 'InProgress', 'C');
    const a = dueAt('2026-08-01', 'InProgress', 'A');
    const b = dueAt('2026-08-03', 'InProgress', 'B');
    const source = [c, a, b];
    const view = deriveDashboardView(source, TODAY, END_DATE, SOON_END);
    expect(view.activeProjects.map((x) => x.projectName)).toEqual(['A', 'B', 'C']);
    // Source array order is untouched.
    expect(source.map((x) => x.projectName)).toEqual(['C', 'A', 'B']);
  });
});

describe('Personal Dashboard — UAT-FIX-01 status consistency', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses the same canonical user-facing status label in Active Projects and Workload Snapshot', async () => {
    // Planning is the real-UAT mismatch case: domain statusLabels says "Planning",
    // but the canonical Personal UI authority (personalStatusLabel) says "Not Started Yet".
    const planning = makeProject({
      id: 'planning-0000-4000-8000-000000000001',
      projectName: 'Planning Project',
      status: 'Planning',
      requiredDeliveryDate: '2026-08-05',
    });
    const inProgress = makeProject({
      id: 'inprogress-0000-4000-8000-000000000002',
      projectName: 'In Progress Project',
      status: 'InProgress',
      requiredDeliveryDate: '2026-08-06',
    });
    renderDashboard([planning, inProgress]);

    await screen.findByLabelText('Active projects');
    const table = screen.getByRole('table');
    // Active Projects renders the canonical Personal label.
    expect(within(table).getByText('Not Started Yet')).toBeInTheDocument();
    expect(within(table).getByText('In Progress')).toBeInTheDocument();

    const workload = screen.getByLabelText('Workload snapshot');
    // Workload Snapshot renders the SAME canonical label, not the raw enum label.
    expect(within(workload).getByText('Not Started Yet')).toBeInTheDocument();
    expect(within(workload).getByText('In Progress')).toBeInTheDocument();
    // The divergent raw label must not appear anywhere on the dashboard.
    expect(screen.queryByText('Planning')).not.toBeInTheDocument();
  });

  it('keeps Workload Snapshot totals equal to the Active KPI', async () => {
    const planning = makeProject({
      id: 'planning-0000-4000-8000-000000000001',
      projectName: 'Planning Project',
      status: 'Planning',
      requiredDeliveryDate: '2026-08-05',
    });
    const inProgress = makeProject({
      id: 'inprogress-0000-4000-8000-000000000002',
      projectName: 'In Progress Project',
      status: 'InProgress',
      requiredDeliveryDate: '2026-08-06',
    });
    renderDashboard([planning, inProgress]);

    await screen.findByRole('button', { name: /^Active — 2 projects/ });
    const workload = screen.getByLabelText('Workload snapshot');
    // 1 Planning + 1 In Progress = 2 Active. Each stat shows a count of 1.
    const counts = within(workload).getAllByText('1');
    expect(counts).toHaveLength(2);
    // No stat shows a count of 2 (which would over-count the Active total).
    expect(within(workload).queryByText('2')).not.toBeInTheDocument();
  });
});

describe('Personal Dashboard — UAT-FIX-01 project cell readability', () => {
  beforeEach(() => setActor());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Project Name as the primary identity and Project Code as the secondary identity', async () => {
    const project = makeProject({
      id: 'cell-0000-4000-8000-000000000001',
      projectName: 'TIMER SWITCH TEST B',
      projectCode: '002_SCT260809_TIMER_SWITCH_TEST_B',
      clientName: 'Some Client',
      status: 'InProgress',
      requiredDeliveryDate: '2026-08-05',
    });
    renderDashboard([project]);

    await screen.findByLabelText('Active projects');
    // The cell link is the only link whose accessible name contains the project code.
    const cell = screen.getByRole('link', { name: /002_SCT260809_TIMER_SWITCH_TEST_B/ });
    // Primary identity element holds the name.
    const primary = within(cell).getByText('TIMER SWITCH TEST B');
    expect(primary.tagName).toBe('STRONG');
    // Secondary identity element holds the code.
    const secondary = within(cell).getByText('002_SCT260809_TIMER_SWITCH_TEST_B');
    expect(secondary.tagName).toBe('SPAN');
    // Full code remains available via the secondary element's title.
    expect(secondary).toHaveAttribute('title', '002_SCT260809_TIMER_SWITCH_TEST_B');
  });

  it('removes the redundant run-on client identity from the project cell', async () => {
    const project = makeProject({
      id: 'cell-0000-4000-8000-000000000001',
      projectName: 'TIMER SWITCH TEST B',
      projectCode: '002_SCT260809_TIMER_SWITCH_TEST_B',
      clientName: 'Some Client',
      status: 'InProgress',
      requiredDeliveryDate: '2026-08-05',
    });
    renderDashboard([project]);

    await screen.findByLabelText('Active projects');
    const cell = screen.getByRole('link', { name: /002_SCT260809_TIMER_SWITCH_TEST_B/ });
    // The old concatenated "code · client" run-on must be gone.
    expect(cell.textContent).not.toContain('·');
    expect(cell.textContent).not.toContain('Some Client');
  });

  it('keeps row navigation on the canonical project UUID', async () => {
    const project = makeProject({
      id: 'cell-0000-4000-8000-000000000001',
      projectName: 'TIMER SWITCH TEST B',
      projectCode: '002_SCT260809_TIMER_SWITCH_TEST_B',
      status: 'InProgress',
      requiredDeliveryDate: '2026-08-05',
    });
    renderDashboard([project]);

    await screen.findByLabelText('Active projects');
    const cell = screen.getByRole('link', { name: /002_SCT260809_TIMER_SWITCH_TEST_B/ });
    expect(cell).toHaveAttribute('href', `/projects/${project.id}`);
  });
});
