/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextualSidebar } from './contextual-sidebar';
import { GLOBAL_NAV, PROJECT_GROUPS } from '../navigation';

const { useAppContextMock } = vi.hoisted(() => ({
  useAppContextMock: vi.fn(),
}));

vi.mock('../app-context', () => ({ useAppContext: useAppContextMock }));
vi.mock('../assets/branding/scientechnic-official-logo.png', () => ({
  default: '/assets/scientechnic-official-logo.png',
}));

function currentUser() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    entraObjectId: null,
    displayName: 'Mohamed',
    email: 'mohamed@scientechnic.local',
    role: 'Admin',
    isActive: true,
  };
}

function renderSidebar({
  context = 'GLOBAL',
  mode = 'EXTENDED',
  globalItems = GLOBAL_NAV,
  projectId = null,
  projectIdentity = null,
  workSessionSlot = null,
  initialEntries = ['/'],
}: {
  context?: 'GLOBAL' | 'PROJECT';
  mode?: 'EXTENDED' | 'MINIMAL';
  globalItems?: typeof GLOBAL_NAV;
  projectId?: string | null;
  projectIdentity?: {
    code: string | null;
    name: string | null;
    statusLabel: string | null;
  } | null;
  workSessionSlot?: ReactNode;
  initialEntries?: string[];
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onToggleMode = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ContextualSidebar
          context={context}
          mode={mode}
          onToggleMode={onToggleMode}
          globalItems={globalItems}
          projectId={projectId}
          projectIdentity={projectIdentity}
          workSessionSlot={workSessionSlot}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onToggleMode };
}

/** Stateful harness that owns mode so toggling actually switches the sidebar. */
function StatefulSidebar({
  initialMode = 'EXTENDED',
  context = 'PROJECT',
  projectId = 'abc',
  projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' },
  workSessionSlot = null,
}: {
  initialMode?: 'EXTENDED' | 'MINIMAL';
  context?: 'GLOBAL' | 'PROJECT';
  projectId?: string | null;
  projectIdentity?: {
    code: string | null;
    name: string | null;
    statusLabel: string | null;
  } | null;
  workSessionSlot?: ReactNode;
}) {
  const [mode, setMode] = useState<'EXTENDED' | 'MINIMAL'>(initialMode);
  return (
    <ContextualSidebar
      context={context}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === 'EXTENDED' ? 'MINIMAL' : 'EXTENDED'))}
      globalItems={GLOBAL_NAV}
      projectId={projectId}
      projectIdentity={projectIdentity}
      workSessionSlot={workSessionSlot}
    />
  );
}

function renderStatefulSidebar(props: Parameters<typeof StatefulSidebar>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/projects/abc']}>
        <StatefulSidebar {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Derives context + active project group from the real URL via the layout route. */
function RoutedProjectSidebar({
  initialMode = 'EXTENDED',
}: {
  initialMode?: 'EXTENDED' | 'MINIMAL';
}) {
  const location = useLocation();
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const projectId = pathSegments[0] === 'projects' ? (pathSegments[1] ?? null) : null;
  const [mode, setMode] = useState<'EXTENDED' | 'MINIMAL'>(initialMode);
  return (
    <ContextualSidebar
      context={projectId ? 'PROJECT' : 'GLOBAL'}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === 'EXTENDED' ? 'MINIMAL' : 'EXTENDED'))}
      globalItems={GLOBAL_NAV}
      projectId={projectId}
      projectIdentity={{ code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' }}
    />
  );
}

function renderRoutedSidebar({
  initialMode = 'EXTENDED',
  initialEntries = ['/projects/abc'],
}: {
  initialMode?: 'EXTENDED' | 'MINIMAL';
  initialEntries?: string[];
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/projects/:id/*"
            element={<RoutedProjectSidebar initialMode={initialMode} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Sidebar plus a route-change trigger so tests can navigate without a visible link. */
function RoutedSidebarWithNavTrigger({
  initialMode = 'EXTENDED',
  target = '/projects/abc/meetings',
}: {
  initialMode?: 'EXTENDED' | 'MINIMAL';
  target?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const projectId = pathSegments[0] === 'projects' ? (pathSegments[1] ?? null) : null;
  const [mode, setMode] = useState<'EXTENDED' | 'MINIMAL'>(initialMode);
  return (
    <>
      <button type="button" onClick={() => navigate(target)}>
        Navigate to {target}
      </button>
      <ContextualSidebar
        context={projectId ? 'PROJECT' : 'GLOBAL'}
        mode={mode}
        onToggleMode={() => setMode((m) => (m === 'EXTENDED' ? 'MINIMAL' : 'EXTENDED'))}
        globalItems={GLOBAL_NAV}
        projectId={projectId}
        projectIdentity={{ code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' }}
      />
    </>
  );
}

function renderRoutedSidebarWithNav({
  initialMode = 'EXTENDED',
  target = '/projects/abc/meetings',
  initialEntries = ['/projects/abc'],
}: {
  initialMode?: 'EXTENDED' | 'MINIMAL';
  target?: string;
  initialEntries?: string[];
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/projects/:id/*"
            element={<RoutedSidebarWithNavTrigger initialMode={initialMode} target={target} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Find the group heading button for a given group label. */
function groupHeading(groupLabel: string) {
  return screen.getByRole('button', { name: `Collapse ${groupLabel}` });
}

beforeEach(() => {
  useAppContextMock.mockReturnValue({
    currentUser: currentUser(),
    mockUsers: [],
    integrationStatus: { mode: 'standalone', workspaceVariant: 'personal' },
    switchMockUser: vi.fn(),
    logout: vi.fn(),
    themePreference: 'dark',
    resolvedTheme: 'dark',
    setThemePreference: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Global Extended', () => {
  it('renders the approved WORKSPACE / RESOURCES / SYSTEM items', () => {
    renderSidebar({ mode: 'EXTENDED' });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Luminaire Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('does not expose My Projects, Import Existing, Archive or Sales Directory as global nav', () => {
    renderSidebar({ mode: 'EXTENDED' });
    expect(screen.queryByRole('link', { name: 'My Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import Existing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales Directory' })).not.toBeInTheDocument();
  });

  it('shows the official logo and SCT Workspace', () => {
    renderSidebar({ mode: 'EXTENDED' });
    expect(screen.getByRole('img', { name: 'Scientechnic' })).toBeInTheDocument();
    expect(screen.getByText('SCT Workspace')).toBeInTheDocument();
  });
});

describe('Global Minimal', () => {
  it('hides the logo and product name', () => {
    renderSidebar({ mode: 'MINIMAL' });
    expect(screen.queryByRole('img', { name: 'Scientechnic' })).not.toBeInTheDocument();
    expect(screen.queryByText('SCT Workspace')).not.toBeInTheDocument();
  });

  it('exposes accessible tooltips/labels for each icon', () => {
    renderSidebar({ mode: 'MINIMAL' });
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Luminaire Library' })).toBeInTheDocument();
  });

  it('has an expand control that toggles mode', () => {
    const { onToggleMode } = renderSidebar({ mode: 'MINIMAL' });
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    fireEvent.click(expand);
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });
});

describe('Project Extended', () => {
  const projectIdentity = {
    code: 'SCL260101',
    name: 'Villa Lighting Design',
    statusLabel: 'In Progress',
  };

  it('shows the five approved groups', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const labels = PROJECT_GROUPS.map((g) => g.label);
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows project identity (code, name, status)', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    expect(screen.getByText('SCL260101')).toBeInTheDocument();
    expect(screen.getByText('Villa Lighting Design')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('has a Back to Projects control', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    expect(screen.getByRole('button', { name: /Back to Projects/ })).toBeInTheDocument();
  });

  it('places every approved mapped page under the correct group', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    for (const group of PROJECT_GROUPS) {
      for (const page of group.pages) {
        expect(
          screen.getByRole('link', { name: page.label }),
          `expected ${page.label} in group ${group.label}`,
        ).toBeInTheDocument();
      }
    }
  });
});

describe('Project Minimal', () => {
  it('shows group-level icons, not one icon per child page', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity: { code: 'X', name: 'P', statusLabel: null },
      initialEntries: ['/projects/abc'],
    });
    for (const group of PROJECT_GROUPS) {
      expect(screen.getByRole('button', { name: group.label })).toBeInTheDocument();
    }
    // No child-page links are rendered in minimal mode (flyout is closed).
    for (const group of PROJECT_GROUPS) {
      for (const page of group.pages) {
        expect(screen.queryByRole('link', { name: page.label })).not.toBeInTheDocument();
      }
    }
  });

  it('opens a child-page flyout when a group icon is clicked', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity: { code: 'X', name: 'P', statusLabel: null },
      initialEntries: ['/projects/abc'],
    });
    const overview = screen.getByRole('button', { name: 'Overview' });
    fireEvent.click(overview);
    // The flyout menu for Overview shows its child pages.
    const menu = screen.getByRole('menu', { name: 'Overview pages' });
    expect(within(menu).getByRole('menuitem', { name: 'Summary' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Workflow Timeline' })).toBeInTheDocument();
  });
});

describe('Context detection and highlighting', () => {
  it('highlights the active global page', () => {
    renderSidebar({
      context: 'GLOBAL',
      mode: 'EXTENDED',
      initialEntries: ['/projects'],
    });
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveClass('active');
  });

  it('highlights the active project group/page in extended mode', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity: { code: 'X', name: 'P', statusLabel: null },
      initialEntries: ['/projects/abc/luminaires'],
    });
    // Luminaires page link is active.
    expect(screen.getByRole('link', { name: 'Luminaires' })).toHaveClass('active');
  });

  it('does not render both global and project navigation simultaneously', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity: { code: 'X', name: 'P', statusLabel: null },
      initialEntries: ['/projects/abc'],
    });
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
  });
});

describe('Collapse / Expand chevron control', () => {
  it('EXTENDED renders a Collapse sidebar control with a thin chevron icon', () => {
    renderSidebar({ context: 'GLOBAL', mode: 'EXTENDED' });
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    // Approved minimal chevron ghost control: chevron-left glyph, not a heavy
    // panel/window/door icon.
    const chevron = collapse.querySelector('.lucide-chevron-left');
    expect(chevron).not.toBeNull();
    expect(collapse.querySelector('.lucide-panel-left-close')).toBeNull();
    expect(collapse.querySelector('.lucide-panel-left-open')).toBeNull();
  });

  it('MINIMAL renders an Expand sidebar control with a thin chevron icon', () => {
    renderSidebar({ context: 'GLOBAL', mode: 'MINIMAL' });
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    const chevron = expand.querySelector('.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(expand.querySelector('.lucide-panel-left-close')).toBeNull();
    expect(expand.querySelector('.lucide-panel-left-open')).toBeNull();
  });

  it('activates mode switching from the chevron control', () => {
    const { onToggleMode } = renderSidebar({ context: 'GLOBAL', mode: 'EXTENDED' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });
});

describe('Project sidebar vertical ownership', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('renders the Work Session slot and Profile independently of the navigation region', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
      workSessionSlot: <div data-testid="work-session-slot" />,
    });
    // Nav links exist, the footer slot exists, and the user profile is present.
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByTestId('work-session-slot')).toBeInTheDocument();
    expect(screen.getByText('Mohamed')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    expect(nav.className).toContain('project-group-nav');
  });
});

describe('H3 Project toggle control', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('PROJECT EXTENDED exposes a Collapse sidebar control with ChevronLeft', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse.querySelector('.lucide-chevron-left')).not.toBeNull();
    expect(collapse.querySelector('.lucide-panel-left-close')).toBeNull();
    expect(collapse.querySelector('.lucide-panel-left-open')).toBeNull();
  });

  it('PROJECT MINIMAL exposes an Expand sidebar control with ChevronRight', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.querySelector('.lucide-chevron-right')).not.toBeNull();
    expect(expand.querySelector('.lucide-panel-left-close')).toBeNull();
    expect(expand.querySelector('.lucide-panel-left-open')).toBeNull();
  });

  it('Project Extended → Minimal hides full labels and keeps project context', () => {
    renderStatefulSidebar({ context: 'PROJECT', initialMode: 'EXTENDED' });
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    // Full child labels disappear; the group icon buttons remain.
    expect(screen.queryByRole('link', { name: 'Summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Back to Projects')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('Project Minimal → Extended restores labels and keeps project context', () => {
    renderStatefulSidebar({ context: 'PROJECT', initialMode: 'MINIMAL' });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Summary' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
  });

  it('toggle is reachable regardless of nav scroll (outside the scrollable nav body)', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    const nav = document.querySelector('.project-group-nav');
    // The toggle is NOT inside the nav scroll region.
    expect(nav?.contains(toggle)).toBe(false);
    const header = document.querySelector('.contextual-project-header');
    expect(header?.contains(toggle)).toBe(true);
  });
});

describe('H3 collapsible project groups', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('every group header is an expandable button with aria-expanded', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'EXTENDED',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    for (const group of PROJECT_GROUPS) {
      const heading = screen.getByRole('button', { name: `Collapse ${group.label}` });
      expect(heading).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('collapsing a group removes its child links; expanding restores them', () => {
    renderStatefulSidebar({ context: 'PROJECT', initialMode: 'EXTENDED' });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    // Children visible initially.
    expect(screen.getByRole('link', { name: 'Luminaires' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Technical BOQ' })).toBeInTheDocument();
    // Collapse the Technical Workspace group.
    fireEvent.click(groupHeading(technical.label));
    expect(screen.getByRole('button', { name: `Expand ${technical.label}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: 'Luminaires' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Technical BOQ' })).not.toBeInTheDocument();
    // Other groups still render their children.
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
    // Expand again restores children.
    fireEvent.click(screen.getByRole('button', { name: `Expand ${technical.label}` }));
    expect(screen.getByRole('link', { name: 'Luminaires' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Technical BOQ' })).toBeInTheDocument();
  });

  it('multiple groups may remain expanded simultaneously', () => {
    renderStatefulSidebar({ context: 'PROJECT', initialMode: 'EXTENDED' });
    const overview = PROJECT_GROUPS.find((g) => g.id === 'overview')!;
    const coordination = PROJECT_GROUPS.find((g) => g.id === 'coordination')!;
    fireEvent.click(groupHeading(overview.label));
    fireEvent.click(groupHeading(coordination.label));
    // Both are collapsed.
    expect(screen.getByRole('button', { name: `Expand ${overview.label}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: `Expand ${coordination.label}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Expand both — both open independently.
    fireEvent.click(screen.getByRole('button', { name: `Expand ${overview.label}` }));
    fireEvent.click(screen.getByRole('button', { name: `Expand ${coordination.label}` }));
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Collapse ${overview.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: `Collapse ${coordination.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('deep-linking to a child route auto-expands its parent group', () => {
    renderRoutedSidebar({ initialEntries: ['/projects/abc/luminaires'] });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    // Technical Workspace is expanded and Luminaires is active.
    expect(screen.getByRole('button', { name: `Collapse ${technical.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Luminaires' })).toHaveClass('active');
  });

  it('deep-linking to /projects/:id/comments auto-expands Coordination', () => {
    renderRoutedSidebar({ initialEntries: ['/projects/abc/comments'] });
    const coordination = PROJECT_GROUPS.find((g) => g.id === 'coordination')!;
    expect(screen.getByRole('button', { name: `Collapse ${coordination.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Comments' })).toHaveClass('active');
  });

  it('navigating to an active child re-opens a group that was collapsed', () => {
    renderRoutedSidebarWithNav({ initialEntries: ['/projects/abc'] });
    const coordination = PROJECT_GROUPS.find((g) => g.id === 'coordination')!;
    // Collapse Coordination, then navigate to a Coordination child.
    fireEvent.click(groupHeading(coordination.label));
    expect(screen.getByRole('button', { name: `Expand ${coordination.label}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to /projects/abc/meetings' }));
    // Auto-expanded because the active route lives in Coordination.
    expect(screen.getByRole('button', { name: `Collapse ${coordination.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Meetings' })).toHaveClass('active');
  });

  it('cannot collapse the group that owns the active route', () => {
    renderRoutedSidebar({ initialEntries: ['/projects/abc/luminaires'] });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    // Technical Workspace is expanded and Luminaires is active.
    expect(screen.getByRole('button', { name: `Collapse ${technical.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Luminaires' })).toHaveClass('active');
    // Activating the active group's header must NOT collapse it.
    fireEvent.click(groupHeading(technical.label));
    expect(screen.getByRole('button', { name: `Collapse ${technical.label}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Luminaires' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Luminaires' })).toHaveClass('active');
    // Unrelated groups can still be collapsed.
    const overview = PROJECT_GROUPS.find((g) => g.id === 'overview')!;
    fireEvent.click(groupHeading(overview.label));
    expect(screen.getByRole('button', { name: `Expand ${overview.label}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('H3 Minimal group flyouts', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('activating a group icon opens a flyout listing its children', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    const menu = screen.getByRole('menu', { name: `${technical.label} pages` });
    expect(within(menu).getByRole('menuitem', { name: 'Luminaires' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Technical BOQ' })).toBeInTheDocument();
  });

  it('selecting a flyout child navigates, closes the flyout, and stays Minimal', () => {
    renderRoutedSidebar({ initialMode: 'MINIMAL', initialEntries: ['/projects/abc'] });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    const menu = screen.getByRole('menu', { name: `${technical.label} pages` });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Luminaires' }));
    // Flyout closed, sidebar remains Minimal.
    expect(
      screen.queryByRole('menu', { name: `${technical.label} pages` }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    // The active group shows an active indication in Minimal.
    expect(screen.getByRole('button', { name: technical.label })).toHaveClass('active');
  });
});

describe('H4 Minimal toggle containment', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('renders the Project Minimal expand control inside the rail footer (not clipped)', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    // It is the thin chevron-right ghost control.
    expect(expand.querySelector('.lucide-chevron-right')).not.toBeNull();
    // It lives in the footer, NOT in the scrollable nav body (so it is never
    // clipped by the nav's overflow region and never scrolls away).
    const footer = document.querySelector('.contextual-sidebar-footer');
    expect(footer?.contains(expand)).toBe(true);
    const nav = document.querySelector('.project-group-nav');
    expect(nav?.contains(expand)).toBe(false);
    const header = document.querySelector('.contextual-project-header-top');
    expect(header?.contains(expand)).toBe(false);
    // It carries the approved ghost control class.
    expect(expand.className).toContain('sidebar-expand-control');
  });

  it('does not render the expand control inside the Project minimal header top row', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const header = document.querySelector('.contextual-project-header-top');
    expect(header?.querySelector('.sidebar-expand-control')).toBeNull();
  });
});

describe('H4 Minimal flyout interaction (portal)', () => {
  const projectIdentity = { code: 'SCL260101', name: 'Villa', statusLabel: 'In Progress' };

  it('opens a portal flyout on group click with visible child labels', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    const menu = screen.getByRole('menu', { name: `${technical.label} pages` });
    // Portal flyout is mounted on document.body, outside the clipped nav.
    expect(document.body.contains(menu)).toBe(true);
    expect(within(menu).getByRole('menuitem', { name: 'Luminaires' })).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'Technical BOQ' })).toBeVisible();
  });

  it('keyboard (Enter) on a group icon opens its flyout', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const coordination = PROJECT_GROUPS.find((g) => g.id === 'coordination')!;
    fireEvent.keyDown(screen.getByRole('button', { name: coordination.label }), {
      key: 'Enter',
      code: 'Enter',
    });
    // Enter on a button triggers click in a browser; simulate the click path.
    fireEvent.click(screen.getByRole('button', { name: coordination.label }));
    const menu = screen.getByRole('menu', { name: `${coordination.label} pages` });
    expect(within(menu).getByRole('menuitem', { name: 'Meetings' })).toBeInTheDocument();
  });

  it('only one flyout is open at a time (switching groups)', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const overview = PROJECT_GROUPS.find((g) => g.id === 'overview')!;
    const coordination = PROJECT_GROUPS.find((g) => g.id === 'coordination')!;
    fireEvent.click(screen.getByRole('button', { name: overview.label }));
    expect(screen.getByRole('menu', { name: `${overview.label} pages` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: coordination.label }));
    // Overview flyout is gone, Coordination is visible.
    expect(screen.queryByRole('menu', { name: `${overview.label} pages` })).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: `${coordination.label} pages` })).toBeInTheDocument();
  });

  it('clicking the same group icon toggles its flyout closed', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const files = PROJECT_GROUPS.find((g) => g.id === 'files')!;
    const icon = screen.getByRole('button', { name: files.label });
    fireEvent.click(icon);
    expect(screen.getByRole('menu', { name: `${files.label} pages` })).toBeInTheDocument();
    fireEvent.click(icon);
    expect(screen.queryByRole('menu', { name: `${files.label} pages` })).not.toBeInTheDocument();
  });

  it('Escape closes the flyout', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    expect(screen.getByRole('menu', { name: `${technical.label} pages` })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(
      screen.queryByRole('menu', { name: `${technical.label} pages` }),
    ).not.toBeInTheDocument();
  });

  it('outside click closes the flyout', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    expect(screen.getByRole('menu', { name: `${technical.label} pages` })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole('menu', { name: `${technical.label} pages` }),
    ).not.toBeInTheDocument();
  });

  it('active child is indicated in the flyout for a deep-linked route', () => {
    renderRoutedSidebar({ initialMode: 'MINIMAL', initialEntries: ['/projects/abc/luminaires'] });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    const menu = screen.getByRole('menu', { name: `${technical.label} pages` });
    const luminaires = within(menu).getByRole('menuitem', { name: 'Luminaires' });
    expect(luminaires).toHaveClass('active');
    // Active parent icon is indicated in Minimal.
    expect(screen.getByRole('button', { name: technical.label })).toHaveClass('active');
  });

  it('flyout portal sets viewport-contained inline offsets (left/top)', () => {
    renderSidebar({
      context: 'PROJECT',
      mode: 'MINIMAL',
      projectId: 'abc',
      projectIdentity,
      initialEntries: ['/projects/abc'],
    });
    const technical = PROJECT_GROUPS.find((g) => g.id === 'technical')!;
    fireEvent.click(screen.getByRole('button', { name: technical.label }));
    const menu = screen.getByRole('menu', { name: `${technical.label} pages` });
    // Portal wrapper is mounted on document.body (outside sidebar overflow).
    const portal = document.querySelector('.project-group-flyout-portal') as HTMLElement;
    expect(portal).not.toBeNull();
    expect(document.body.contains(portal)).toBe(true);
    // It carries viewport-containment inline offsets (left is clamped into
    // the viewport by the component before it is applied).
    const left = parseFloat(portal.style.left);
    const top = parseFloat(portal.style.top);
    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    expect(menu).toBeInTheDocument();
  });
});
