/**
 * V4 navigation model — structural, framework-agnostic.
 *
 * Defines the ONE contextual rail model (owner-locked):
 *
 *   GLOBAL context  -> flat list of top-level items
 *   PROJECT context -> "Back to Projects" + locked project IA groups
 *
 * This module is pure (no React rendering). It stores lucide icon references so
 * the Sidebar can render a consistent structural icon grammar, while the model
 * itself stays testable for labels, ids, and the locked IA ordering.
 *
 * F2 only provides DIAGNOSTIC navigation: no product pages are implemented and
 * no fake canonical route ownership is claimed. `route` targets are descriptive
 * only and are NOT registered in the router.
 */
import type { LucideIcon } from 'lucide-react';
import {
  SctBack as ArrowLeft,
  SctLibrary as BookOpen,
  SctReports as ChartColumn,
  SctImportHistory as FolderClock,
  SctActions as ListTodo,
  SctNotes as ScrollText,
  SctSchedule as Table,
  SctTimeline as Workflow,
} from '../common/SctIcons';
import {
  Activity,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileSearch,
  FileText,
  Folder,
  FolderKanban,
  History,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Network,
  Package,
  PackageCheck,
  Send,
  Settings,
  ShieldCheck,
  Users,
} from '../common/SctIcons';
import {
  ROUTE_DASHBOARD,
  ROUTE_LUMINAIRE_LIBRARY,
  ROUTE_IMPORTS,
  ROUTE_PROJECTS,
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_FILES,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_PACKAGES,
  ROUTE_PROJECT_REVISIONS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
  ROUTE_SETTINGS,
} from '../../router/routes';

/** The two shell contexts (owner-locked: ONE contextual rail, two contexts). */
export type ShellContext = 'global' | 'project';

export interface V4NavItem {
  /** Stable identity used for active-state tracking (never a display name). */
  id: string;
  label: string;
  /** Structural icon. Final colors/effects are Phase 3. */
  icon: LucideIcon;
  /**
   * Descriptive canonical target. F2 does NOT register these routes; the
   * diagnostic screens use local/query active-section state instead.
   */
  route: string;
  /** Truthful unavailable state for product slices that do not own a page yet. */
  disabled?: boolean;
  disabledReason?: string;
}

export interface V4NavGroup {
  id: string;
  label: string;
  /** Group-level icon used for the Minimal group rail. */
  icon: LucideIcon;
  items: V4NavItem[];
}

/** Back-to-Projects anchor shown at the top of PROJECT context. */
export const BACK_TO_PROJECTS_ITEM: V4NavItem = {
  id: 'back-to-projects',
  label: 'Back to Projects',
  icon: ArrowLeft,
  route: ROUTE_PROJECTS,
};

/** GLOBAL primary navigation (Settings is NOT part of this list). */
export const GLOBAL_NAV_ITEMS: V4NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    route: ROUTE_DASHBOARD,
  },
  { id: 'projects', label: 'Projects', icon: FolderKanban, route: ROUTE_PROJECTS },
  {
    id: 'luminaire-library',
    label: 'Luminaire Library',
    icon: Lightbulb,
    route: ROUTE_LUMINAIRE_LIBRARY,
  },
  { id: 'imports', label: 'Smart Import', icon: FileSearch, route: ROUTE_IMPORTS },
  {
    id: 'reports',
    label: 'Reports',
    icon: ChartColumn,
    route: '/reports',
  },
];

/** Settings lives in the fixed BOTTOM utility zone (H2). */
export const SETTINGS_NAV_ITEM: V4NavItem = {
  id: 'settings',
  label: 'Settings',
  icon: Settings,
  route: ROUTE_SETTINGS,
};

/** PROJECT context navigation following the locked project IA. */
export const PROJECT_NAV_GROUPS: V4NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    items: [
      { id: 'summary', label: 'Summary', icon: ListTodo, route: ROUTE_PROJECT_SUMMARY },
      {
        id: 'workflow',
        label: 'Workflow Timeline',
        icon: Workflow,
        route: ROUTE_PROJECT_WORKFLOW_TIMELINE,
      },
    ],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    icon: Network,
    items: [
      { id: 'meetings', label: 'Meetings', icon: CalendarDays, route: ROUTE_PROJECT_MEETINGS },
      { id: 'scope', label: 'Scope & Services', icon: ClipboardList, route: ROUTE_PROJECT_SCOPE },
      { id: 'actions', label: 'Actions', icon: CheckSquare, route: ROUTE_PROJECT_ACTIONS },
      { id: 'comments', label: 'Comments', icon: MessageSquare, route: ROUTE_PROJECT_COMMENTS },
      { id: 'contacts', label: 'Contacts', icon: Users, route: ROUTE_PROJECT_CONTACTS },
    ],
  },
  {
    id: 'technical-workspace',
    label: 'Technical Workspace',
    icon: Lightbulb,
    items: [
      { id: 'luminaires', label: 'Luminaires', icon: Lightbulb, route: ROUTE_PROJECT_LUMINAIRES },
      {
        id: 'datasheets',
        label: 'Datasheets & Images',
        icon: FileText,
        route: ROUTE_PROJECT_DATASHEETS_IMAGES,
      },
      {
        id: 'technical-check',
        label: 'Technical Check',
        icon: ShieldCheck,
        route: ROUTE_PROJECT_TECHNICAL_CHECK,
      },
      {
        id: 'studio-systems',
        label: 'Lighting Systems',
        icon: Lightbulb,
        route: '/projects/:projectId/lighting-systems',
      },
      {
        id: 'studio-accessories',
        label: 'System Accessories',
        icon: Lightbulb,
        route: '/projects/:projectId/system-accessories',
      },
      {
        id: 'studio-output',
        label: 'Output Studio',
        icon: Table,
        route: '/projects/:projectId/output-studio',
      },
      {
        id: 'studio-datasheets',
        label: 'Datasheets',
        icon: FileText,
        route: '/projects/:projectId/studio-datasheets',
      },
    ],
  },
  {
    id: 'deliverables-issue',
    label: 'Deliverables & Issue',
    icon: PackageCheck,
    items: [
      {
        id: 'revisions',
        label: 'Revisions & Deliverables',
        icon: History,
        route: ROUTE_PROJECT_REVISIONS,
      },
      {
        id: 'packages',
        label: 'Packages',
        icon: Package,
        route: ROUTE_PROJECT_PACKAGES,
      },
      {
        id: 'submissions',
        label: 'Submissions',
        icon: Send,
        route: '/projects/:projectId/submissions',
        disabled: true,
        disabledReason: 'Submissions are not yet implemented.',
      },
      {
        id: 'issue-history',
        label: 'Issue History',
        icon: ScrollText,
        route: '/projects/:projectId/issue-history',
        disabled: true,
        disabledReason: 'Issue History is not yet implemented.',
      },
    ],
  },
  {
    id: 'files-history',
    label: 'Files & History',
    icon: FolderClock,
    items: [
      {
        id: 'files',
        label: 'Files',
        icon: Folder,
        route: ROUTE_PROJECT_FILES,
      },
      {
        id: 'register',
        label: 'Register',
        icon: BookOpen,
        route: '/projects/:projectId/register',
        disabled: true,
        disabledReason: 'Register is not yet implemented.',
      },
      {
        id: 'activity',
        label: 'Activity',
        icon: Activity,
        route: '/projects/:projectId/activity',
        disabled: true,
        disabledReason: 'Activity is not yet implemented.',
      },
    ],
  },
];

/** Flat list of every project nav item id (used by active-section lookups). */
export const PROJECT_NAV_ITEM_IDS: string[] = PROJECT_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.id),
);

/** Resolve a project nav item by id (or undefined when unknown). */
export function findProjectNavItem(id: string): V4NavItem | undefined {
  for (const group of PROJECT_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return undefined;
}

export function findGlobalNavItem(id: string): V4NavItem | undefined {
  return GLOBAL_NAV_ITEMS.find((item) => item.id === id);
}
