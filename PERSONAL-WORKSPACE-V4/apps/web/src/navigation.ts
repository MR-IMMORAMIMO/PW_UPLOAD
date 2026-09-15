import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  CheckSquare2,
  CircleGauge,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Database,
  FileClock,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderKanban,
  FolderOpen,
  Gauge,
  Handshake,
  Lamp,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  PackageCheck,
  Send,
  Settings2,
  UserRoundSearch,
  UsersRound,
  Workflow,
} from 'lucide-react';

/**
 * Single contextual application shell.
 *
 * There is ONE physical sidebar rail. It changes content according to
 * application context (GLOBAL vs PROJECT) and user-chosen mode
 * (EXTENDED vs MINIMAL). The URL/current route is authoritative; the
 * sidebar only reflects the active route, never a second routing authority.
 */
export type SidebarContext = 'GLOBAL' | 'PROJECT';
export type SidebarMode = 'EXTENDED' | 'MINIMAL';

export interface GlobalNavItem {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Group key in GLOBAL EXTENDED mode. */
  groupId: 'workspace' | 'resources' | 'system';
  /** Treat as exact match for active highlight (e.g. the Dashboard index route). */
  end?: boolean;
}

/** WORKSPACE / RESOURCES / SYSTEM — the approved GLOBAL EXTENDED structure. */
export const GLOBAL_NAV: readonly GlobalNavItem[] = Object.freeze([
  // WORKSPACE
  Object.freeze({
    id: 'dashboard',
    label: 'Dashboard',
    to: '/',
    icon: LayoutDashboard,
    groupId: 'workspace',
    end: true,
  }),
  Object.freeze({
    id: 'projects',
    label: 'Projects',
    to: '/projects',
    icon: FolderKanban,
    groupId: 'workspace',
  }),
  Object.freeze({
    id: 'new-project',
    label: 'New Project',
    to: '/new',
    icon: CircleGauge,
    groupId: 'workspace',
  }),
  // RESOURCES
  Object.freeze({
    id: 'luminaire-library',
    label: 'Luminaire Library',
    to: '/luminaires',
    icon: Lamp,
    groupId: 'resources',
  }),
  Object.freeze({
    id: 'reports',
    label: 'Reports',
    to: '/reports',
    icon: BarChart3,
    groupId: 'resources',
  }),
  // SYSTEM
  Object.freeze({
    id: 'settings',
    label: 'Settings',
    to: '/settings',
    icon: Settings2,
    groupId: 'system',
  }),
]);

export const GLOBAL_GROUP_LABELS: Record<GlobalNavItem['groupId'], string> = Object.freeze({
  workspace: 'Workspace',
  resources: 'Resources',
  system: 'System',
});

/**
 * Build the canonical Global navigation for a workspace variant and role.
 * The approved WORKSPACE / RESOURCES / SYSTEM structure is always present.
 * The legacy team (Entra) variant retains its role-aware labels and role-only
 * destinations so team users keep the behavior the mock/team flow expects;
 * the standalone-first personal variant is canonical (My Projects → Projects).
 */
export function buildGlobalNav(
  variant: 'personal' | 'team',
  role: 'Sales' | 'Designer' | 'LineManager' | 'Admin',
): readonly GlobalNavItem[] {
  const manager = role === 'LineManager' || role === 'Admin';

  if (variant !== 'team') return GLOBAL_NAV;

  // Team (Entra) variant: reproduce the legacy role-aware global structure,
  // regrouped under the approved WORKSPACE / RESOURCES / SYSTEM headings.
  const items: GlobalNavItem[] = [
    // WORKSPACE
    {
      id: 'today',
      label: 'Today',
      to: '/',
      icon: LayoutDashboard,
      groupId: 'workspace',
      end: true,
    },
    {
      id: 'new-project',
      label: role === 'Sales' ? 'New Request' : 'New Project',
      to: '/new',
      icon: CircleGauge,
      groupId: 'workspace',
    },
    {
      id: 'projects',
      label: role === 'Sales' ? 'My Requests' : 'My Projects',
      to: '/projects',
      icon: FolderKanban,
      groupId: 'workspace',
    },
    ...(manager
      ? [
          {
            id: 'unassigned',
            label: 'Unassigned',
            to: '/unassigned',
            icon: UserRoundSearch,
            groupId: 'workspace' as const,
          },
        ]
      : []),
    // RESOURCES
    ...(manager
      ? [
          {
            id: 'lighting-team',
            label: 'Lighting Team',
            to: '/designers',
            icon: UsersRound,
            groupId: 'resources' as const,
          },
        ]
      : []),
    ...(role === 'Designer' || manager
      ? [
          {
            id: 'timesheets',
            label: manager ? 'Time Approvals' : 'Time & Timesheets',
            to: '/timesheets',
            icon: Activity,
            groupId: 'resources' as const,
          },
        ]
      : []),
    { id: 'reports', label: 'Reports', to: '/reports', icon: BarChart3, groupId: 'resources' },
    // SYSTEM
    {
      id: 'notifications',
      label: 'Notifications',
      to: '/notifications',
      icon: Bell,
      groupId: 'system',
    },
    { id: 'settings', label: 'Settings', to: '/settings', icon: Settings2, groupId: 'system' },
  ];

  return Object.freeze(items);
}

export interface ProjectNavPage {
  /** Stable identity used for route matching, tooltips, flyouts and tests. */
  id: string;
  label: string;
  /** Path segment under `/projects/:id/`. */
  to: string;
  icon: LucideIcon;
}

export interface ProjectNavGroup {
  /** Stable identity for group highlighting, tooltips, flyouts and tests. */
  id: string;
  label: string;
  icon: LucideIcon;
  pages: readonly ProjectNavPage[];
}

/**
 * The five approved PROJECT EXTENDED groups. `to` is the route path segment
 * that a page lives at; several approved pages map onto the same underlying
 * screen tab until P2-UX-04 builds deeper per-page composition.
 */
export const PROJECT_GROUPS: readonly ProjectNavGroup[] = Object.freeze([
  Object.freeze({
    id: 'overview',
    label: 'Overview',
    icon: Gauge,
    pages: Object.freeze([
      Object.freeze({ id: 'summary', label: 'Summary', to: 'summary', icon: Gauge }),
      Object.freeze({
        id: 'workflow-timeline',
        label: 'Workflow Timeline',
        to: 'workflow',
        icon: Workflow,
      }),
    ]),
  }),
  Object.freeze({
    id: 'coordination',
    label: 'Coordination',
    icon: Handshake,
    pages: Object.freeze([
      Object.freeze({
        id: 'scope',
        label: 'Scope & Services',
        to: 'scope',
        icon: ClipboardList,
      }),
      Object.freeze({ id: 'actions', label: 'Actions', to: 'actions', icon: CheckSquare2 }),
      Object.freeze({ id: 'meetings', label: 'Meetings', to: 'meetings', icon: CalendarDays }),
      Object.freeze({ id: 'comments', label: 'Comments', to: 'comments', icon: MessageSquareText }),
      Object.freeze({ id: 'contacts', label: 'Contacts', to: 'contacts', icon: Contact }),
    ]),
  }),
  Object.freeze({
    id: 'technical',
    label: 'Technical Workspace',
    icon: Boxes,
    pages: Object.freeze([
      Object.freeze({ id: 'luminaires', label: 'Luminaires', to: 'luminaires', icon: Lamp }),
      Object.freeze({
        id: 'datasheets',
        label: 'Datasheets & Images',
        to: 'datasheets',
        icon: FileSpreadsheet,
      }),
      Object.freeze({
        id: 'technical-check',
        label: 'Technical Check',
        to: 'technical-check',
        icon: ClipboardCheck,
      }),
      Object.freeze({
        id: 'luminaire-schedule',
        label: 'Luminaire Schedule',
        to: 'schedule',
        icon: ListChecks,
      }),
      Object.freeze({
        id: 'technical-boq',
        label: 'Technical BOQ',
        to: 'boq',
        icon: FileText,
      }),
    ]),
  }),
  Object.freeze({
    id: 'deliverables',
    label: 'Deliverables & Issue',
    icon: PackageCheck,
    pages: Object.freeze([
      Object.freeze({
        id: 'revisions',
        label: 'Revisions & Outputs',
        to: 'revisions',
        icon: FileUp,
      }),
      Object.freeze({
        id: 'submission-cycle',
        label: 'Submission Cycle',
        to: 'submission',
        icon: Send,
      }),
      Object.freeze({
        id: 'issue-history',
        label: 'Issue History',
        to: 'issues',
        icon: FileClock,
      }),
      Object.freeze({
        id: 'issue-packages',
        label: 'Issue Packages',
        to: 'packages',
        icon: PackageCheck,
      }),
    ]),
  }),
  Object.freeze({
    id: 'files',
    label: 'Files & History',
    icon: FolderKanban,
    pages: Object.freeze([
      Object.freeze({
        id: 'project-files',
        label: 'Project Files',
        to: 'files',
        icon: FolderOpen,
      }),
      Object.freeze({
        id: 'document-register',
        label: 'Document Register',
        to: 'documents',
        icon: Database,
      }),
      Object.freeze({
        id: 'activity-history',
        label: 'Activity History',
        to: 'activity',
        icon: Activity,
      }),
    ]),
  }),
]);

/** Flat lookup from a project page id to its group id. */
export const PROJECT_PAGE_GROUP: Record<string, string> = Object.freeze(
  PROJECT_GROUPS.reduce<Record<string, string>>((acc, group) => {
    for (const page of group.pages) acc[page.id] = group.id;
    return acc;
  }, {}),
);

/**
 * Maps an approved project child-route segment onto the existing section tab
 * rendered inside the personal project workspace screen. Several approved
 * pages share the underlying composed tab until P2-UX-04 builds deeper
 * per-page composition. Routes absent here render a structural placeholder.
 */
export const PROJECT_ROUTE_TO_SECTION: Record<string, string> = Object.freeze({
  summary: 'overview',
  workflow: 'overview',
  scope: 'scope',
  // Legacy folder/workspace management stays reachable under its own route until
  // P2-UX-04E Files takes permanent ownership. Scope moved to a dedicated section.
  workspace: 'workspace',
  actions: 'actions',
  meetings: 'meetings',
  comments: 'reviews',
  contacts: 'contacts',
  luminaires: 'luminaires',
  schedule: 'luminaires',
  boq: 'luminaires',
  datasheets: 'assets',
  'technical-check': 'intelligence',
  revisions: 'revisions',
  submission: 'outputs',
  issues: 'exports',
  packages: 'package',
  activity: 'overview',
  // Retained content that predates the single-sidebar authority. These remain
  // deep-link reachable under the URL so no existing project content is lost,
  // but they are NOT exposed as sidebar navigation (P2-UX-04 composes pages).
  information: 'information',
  deliverables: 'deliverables',
  outputs: 'outputs',
});

/** Approved destinations that render a restrained structural placeholder. */
export const PROJECT_PLACEHOLDER_TITLES: Record<string, { title: string; detail: string }> =
  Object.freeze({
    files: {
      title: 'Project Files',
      detail: 'Connected file center for this project.',
    },
    documents: {
      title: 'Document Register',
      detail: 'Register of managed project documents.',
    },
  });

/**
 * Builds a canonical project-scoped href for a semantic project section.
 * All project-internal cross-links must use this single route builder so no
 * root-level (`/actions`, `/scope`, `/workflow`, ...) route ever escapes to
 * the app catch-all. Final path resolution lives here at the navigation
 * boundary; models expose semantic section targets, never full paths.
 */
export function projectSectionHref(projectId: string, section: string): string {
  return `/projects/${projectId}/${section}`;
}
