/**
 * V4AppShell — the clean professional desktop workspace composition.
 *
 * Owns:
 *   - the ONE contextual Sidebar rail (via V4Sidebar, which includes the
 *     floating edge toggle + minimal flyout)
 *   - the main application viewport
 *   - an optional Project Context Header region
 *   - the Page Header + content region
 *   - structural shell spacing
 *   - global/project context switching
 *   - stable Light/Dark/System behavior via existing V4 theme tokens
 *
 * The shell does NOT know individual product-page business logic. It renders
 * no page-specific cards. Content is supplied by each route.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import type { ShellContext } from '../navigation/navModel';
import { findGlobalNavItem, findProjectNavItem } from '../navigation/navModel';
import { V4Sidebar, type V4ProjectIdentity } from '../sidebar/V4Sidebar';
import type { SidebarMode } from '../sidebar/sidebarMode';
import { useOptionalV4WorkSession } from '../work-session/WorkSessionProvider';
import {
  V4WorkSessionAnchor,
  V4WorkSessionTrackingStrip,
} from '../work-session/WorkSessionSurfaces';
import { ROUTE_PROJECTS, ROUTE_SETTINGS } from '../../router/routes';

const NARROW_SIDEBAR_MEDIA_QUERY = '(max-width: 640px)';

function narrowSidebarMatches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_SIDEBAR_MEDIA_QUERY).matches;
}

export interface V4AppShellProps {
  /** Which shell context the rail + header present. */
  context: ShellContext;
  /** Current sidebar presentation mode. */
  sidebarMode: SidebarMode;
  /** Persist the sidebar mode (Extended <-> Minimal). */
  onToggleSidebarMode: () => void;
  /** Diagnostic active nav section id. */
  activeSectionId?: string | null;
  /** Project context: identity block (REAL canonical data). */
  project?: V4ProjectIdentity | null;
  /** Project context: project loading state. */
  projectLoading?: boolean;
  /** Project context: back-to-projects navigation. */
  onBackToProjects?: () => void;
  /** Diagnostic nav activation callback. */
  onSelectSection?: (id: string) => void;
  /** Optional Project Context Header shown in PROJECT context. */
  projectContextHeader?: ReactNode;
  /** The Page Header (title/subtitle/actions) for the active route. */
  pageHeader?: ReactNode;
  /** Opts a bounded desktop product workspace into the shell-height contract. */
  boundedPage?: boolean;
  /** The route body. */
  children?: ReactNode;
  /** Structural Work Session indicator node (reserved zone). */
  workSessionSlot?: ReactNode;
  /** Structural Profile slot. */
  profileSlot?: ReactNode;
}

export function LegacyAppShell({
  context,
  sidebarMode,
  onToggleSidebarMode,
  activeSectionId = null,
  project = null,
  projectLoading = false,
  onBackToProjects,
  onSelectSection,
  projectContextHeader,
  pageHeader,
  boundedPage = false,
  children,
  workSessionSlot,
  profileSlot,
}: V4AppShellProps) {
  const navigate = useNavigate();
  const routeParams = useParams<{ projectId?: string }>();
  const [narrowSidebar, setNarrowSidebar] = useState(narrowSidebarMatches);

  useEffect(() => {
    const media = window.matchMedia(NARROW_SIDEBAR_MEDIA_QUERY);
    const sync = () => setNarrowSidebar(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Phone compaction is an effective presentation only. The caller-owned
  // desktop preference stays untouched and is restored when the viewport grows.
  const effectiveSidebarMode: SidebarMode = narrowSidebar ? 'minimal' : sidebarMode;
  const workSession = useOptionalV4WorkSession();
  const resolvedWorkSessionSlot =
    workSessionSlot ??
    (workSession ? <V4WorkSessionAnchor mode={effectiveSidebarMode} /> : undefined);
  const resolvedBackToProjects =
    onBackToProjects ?? (context === 'project' ? () => navigate(ROUTE_PROJECTS) : undefined);
  // Centralized project navigation: resolve EVERY nav item id to its canonical
  // route via the shared nav model, so Revisions & Outputs opens from all
  // project pages without editing each closed page. Disabled items (future
  // slices) are ignored before reaching here by the Sidebar.
  const resolvedSelectSection = (id: string) => {
    if (id === 'settings') {
      navigate(ROUTE_SETTINGS);
      return;
    }
    const globalItem = findGlobalNavItem(id);
    if (globalItem && !globalItem.disabled) {
      navigate(globalItem.route);
      return;
    }
    const item = findProjectNavItem(id);
    if (item?.disabled) return;
    // Only route items whose route uses the canonical :projectId token. Future
    // groups (e.g. Files & History) are unregistered and out of scope — defer
    // them to the caller rather than generating a wrong path.
    if (
      item &&
      context === 'project' &&
      routeParams.projectId &&
      item.route.includes(':projectId')
    ) {
      navigate(generatePath(item.route, { projectId: routeParams.projectId }));
      return;
    }
    onSelectSection?.(id);
  };

  return (
    <div
      className="v4-shell"
      data-context={context}
      data-sidebar-mode={effectiveSidebarMode}
      data-sidebar-preference={sidebarMode}
      data-testid="v4-shell"
    >
      <V4Sidebar
        context={context}
        mode={effectiveSidebarMode}
        onToggleMode={onToggleSidebarMode}
        activeSectionId={activeSectionId}
        project={project}
        projectLoading={projectLoading}
        onBackToProjects={resolvedBackToProjects}
        onSelectSection={resolvedSelectSection}
        workSessionSlot={resolvedWorkSessionSlot}
        profileSlot={profileSlot}
      />
      <div className="v4-shell__main" data-testid="v4-shell-main">
        {workSession ? <V4WorkSessionTrackingStrip /> : null}
        {context === 'project' && projectContextHeader ? (
          <div className="v4-shell__context-header">{projectContextHeader}</div>
        ) : null}
        <div className={`v4-shell__content${boundedPage ? ' v4-shell__content--bounded' : ''}`}>
          {pageHeader}
          <div className={`v4-shell__page${boundedPage ? ' v4-shell__page--bounded' : ''}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
