vi.mock('../pages/luminaire-studio/LuminaireStudioPage', () => ({
  LuminaireStudioPage: () => <div data-testid="v4-studio-route">Luminaire Studio route</div>,
}));
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { generatePath, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { V4Router } from './V4Router';
import { V4_ROUTER_BASENAME } from './base-path';
import {
  ROUTE_DASHBOARD,
  ROUTE_NEW_PROJECT,
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECTS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_PACKAGES,
  ROUTE_PROJECT_FILES,
  ROUTE_PROJECT_REVISIONS,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_SETTINGS,
} from './routes';
import { V4ThemeProvider } from '../theme/ThemeProvider';

vi.mock('../pages/project-actions/ProjectActionsPage', () => ({
  ProjectActionsPage: () => <div data-testid="v4-actions-route">Actions route</div>,
}));
vi.mock('../pages/projects/ProjectsPage', () => ({
  ProjectsPage: () => <div data-testid="v4-projects-route">Projects route</div>,
}));
vi.mock('../pages/dashboard/DashboardPage', () => ({
  DashboardPage: () => <div data-testid="v4-dashboard-route">Dashboard route</div>,
}));
vi.mock('../pages/new-project/NewProjectPage', () => ({
  NewProjectPage: () => <div data-testid="v4-new-project-route">New Project route</div>,
}));
vi.mock('../pages/settings/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="v4-settings-route">Settings route</div>,
}));
vi.mock('../pages/project-comments/ProjectCommentsPage', () => ({
  ProjectCommentsPage: () => <div data-testid="v4-comments-route">Comments route</div>,
}));
vi.mock('../pages/project-contacts/ProjectContactsPage', () => ({
  ProjectContactsPage: () => <div data-testid="v4-contacts-route">Contacts route</div>,
}));
vi.mock('../pages/project-luminaires/ProjectLuminairesPage', () => ({
  ProjectLuminairesPage: () => <div data-testid="v4-luminaires-route">Luminaires route</div>,
}));
vi.mock('../pages/technical-check/ProjectTechnicalCheckPage', () => ({
  ProjectTechnicalCheckPage: () => (
    <div data-testid="v4-technical-check-route">Technical Check route</div>
  ),
}));
vi.mock('../pages/luminaire-schedule/ProjectLuminaireSchedulePage', () => ({
  ProjectLuminaireSchedulePage: () => (
    <div data-testid="v4-luminaire-schedule-route">Luminaire Schedule route</div>
  ),
}));
vi.mock('../pages/technical-boq/ProjectTechnicalBoqPage', () => ({
  ProjectTechnicalBoqPage: () => (
    <div data-testid="v4-technical-boq-route">Technical BOQ route</div>
  ),
}));
vi.mock('../pages/project-revisions/ProjectRevisionsPage', () => ({
  ProjectRevisionsPage: () => <div data-testid="v4-revisions-route">Revisions route</div>,
}));
vi.mock('../pages/project-packages/ProjectPackagesPage', () => ({
  ProjectPackagesPage: () => <div data-testid="v4-packages-route">Packages route</div>,
}));
vi.mock('../pages/project-files/ProjectFilesPage', () => ({
  ProjectFilesPage: () => <div data-testid="v4-files-route">Files route</div>,
}));

/**
 * Focused router-foundation tests.
 *
 *   B. Router renders Foundation route.
 *   C. Unknown route renders a controlled not-found state (no blank screen).
 */
function renderRouter(initialEntries: string[], basename?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <MemoryRouter initialEntries={initialEntries} {...(basename ? { basename } : {})}>
          <V4Router />
        </MemoryRouter>
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('V4Router', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('v4-reduced-motion');
  });

  it('launches the Dashboard from the root route', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderRouter(['/']);
    expect(screen.getByTestId('v4-dashboard-route')).toHaveTextContent('Dashboard route');
  });

  it('resolves the canonical Dashboard deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    expect(ROUTE_DASHBOARD).toBe('/dashboard');
    renderRouter(['/dashboard']);
    expect(screen.getByTestId('v4-dashboard-route')).toBeInTheDocument();
  });

  it('resolves the canonical New Project deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    expect(ROUTE_NEW_PROJECT).toBe('/new');
    renderRouter(['/new']);
    expect(screen.getByTestId('v4-new-project-route')).toBeInTheDocument();
  });

  it('resolves the canonical based Settings deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    expect(ROUTE_SETTINGS).toBe('/settings');
    expect(`${V4_ROUTER_BASENAME}${ROUTE_SETTINGS}`).toBe('/v4/settings');
    renderRouter(['/v4/settings'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-settings-route')).toHaveTextContent('Settings route');
  });

  it('renders the Foundation screen at the diagnostic route', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderRouter(['/diagnostic']);
    expect(screen.getByTestId('v4-foundation')).toBeInTheDocument();
  });

  it('renders a controlled not-found state for an unknown route', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderRouter(['/projects/does-not-exist']);
    expect(screen.getByTestId('v4-not-found')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('resolves the canonical based Projects deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    expect(ROUTE_PROJECTS).toBe('/projects');
    expect(`${V4_ROUTER_BASENAME}${ROUTE_PROJECTS}`).toBe('/v4/projects');
    renderRouter(['/v4/projects'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-projects-route')).toHaveTextContent('Projects route');
  });

  it('resolves the based Actions URL from the canonical navigation route helper', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_ACTIONS, { projectId: 'p1' });
    expect(ROUTE_PROJECT_ACTIONS).toBe('/projects/:projectId/actions');
    expect(canonicalPath).toBe('/projects/p1/actions');
    expect(`${V4_ROUTER_BASENAME}${canonicalPath}`).toBe('/v4/projects/p1/actions');
    renderRouter(['/v4/projects/p1/actions'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-actions-route')).toHaveTextContent('Actions route');
  });

  it('resolves the direct based Luminaires deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/luminaires');
    renderRouter(['/v4/projects/p1/luminaires'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-luminaires-route')).toHaveTextContent('Luminaires route');
  });

  it('resolves the direct based Technical Check deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_TECHNICAL_CHECK, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/technical-check');
    renderRouter(['/v4/projects/p1/technical-check'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-technical-check-route')).toHaveTextContent(
      'Technical Check route',
    );
  });

  it('resolves the direct based Luminaire Schedule deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_LUMINAIRE_SCHEDULE, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/luminaire-schedule');
    renderRouter(['/v4/projects/p1/luminaire-schedule'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-studio-route')).toHaveTextContent('Luminaire Studio route');
  });

  it('resolves the direct based Technical BOQ deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_TECHNICAL_BOQ, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/technical-boq');
    renderRouter(['/v4/projects/p1/technical-boq'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-studio-route')).toHaveTextContent('Luminaire Studio route');
  });

  it('resolves the direct based Revisions & Deliverables deep link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_REVISIONS, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/revisions');
    renderRouter(['/v4/projects/p1/revisions'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-revisions-route')).toHaveTextContent('Revisions route');
  });

  it('resolves the canonical Packages route while preserving projectId', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_PACKAGES, { projectId: 'project-42' });
    expect(ROUTE_PROJECT_PACKAGES).toBe('/projects/:projectId/packages');
    expect(canonicalPath).toBe('/projects/project-42/packages');
    renderRouter([`${V4_ROUTER_BASENAME}${canonicalPath}`], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-packages-route')).toHaveTextContent('Packages route');
  });

  it('resolves the canonical Files route while preserving projectId', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_FILES, { projectId: 'project-42' });
    expect(ROUTE_PROJECT_FILES).toBe('/projects/:projectId/files');
    expect(canonicalPath).toBe('/projects/project-42/files');
    renderRouter([`${V4_ROUTER_BASENAME}${canonicalPath}`], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-files-route')).toHaveTextContent('Files route');
  });

  it('resolves the direct based Comments deep-link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_COMMENTS, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/comments');
    renderRouter(['/v4/projects/p1/comments'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-comments-route')).toHaveTextContent('Comments route');
  });

  it('resolves the direct based Contacts deep-link', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const canonicalPath = generatePath(ROUTE_PROJECT_CONTACTS, { projectId: 'p1' });
    expect(canonicalPath).toBe('/projects/p1/contacts');
    renderRouter(['/v4/projects/p1/contacts'], V4_ROUTER_BASENAME);
    expect(screen.getByTestId('v4-contacts-route')).toHaveTextContent('Contacts route');
  });
});
