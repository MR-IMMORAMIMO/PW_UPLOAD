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

import type { ShellContext } from '../navigation/navModel';

import type { V4ProjectIdentity } from '../sidebar/V4Sidebar';
import { FinalSidebar } from '../final-ui/FinalSidebar';
import { FinalProjectHeader } from '../final-ui/ProjectHeader';
import type { SidebarMode } from '../sidebar/sidebarMode';
import { useOptionalV4WorkSession } from '../work-session/WorkSessionProvider';
import { V4WorkSessionTrackingStrip } from '../work-session/WorkSessionSurfaces';

const NARROW_SIDEBAR_MEDIA_QUERY = '(max-width: 640px)';

function narrowSidebarMatches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_SIDEBAR_MEDIA_QUERY).matches;
}

export interface V4AppShellProps {
  finalContacts?: boolean;
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

export function V4AppShell({
  context,
  finalContacts = false,
  sidebarMode,
  onToggleSidebarMode,
  projectContextHeader,
  pageHeader,
  boundedPage = false,
  children,
}: V4AppShellProps) {
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

  return (
    <div
      className="v4-shell"
      data-context={context}
      data-sidebar-mode={effectiveSidebarMode}
      data-sidebar-preference={sidebarMode}
      data-testid="v4-shell"
    >
      <FinalSidebar mode={effectiveSidebarMode} onToggleMode={onToggleSidebarMode} />
      {finalContacts ? (
        children
      ) : (
        <div className="v4-shell__main" data-testid="v4-shell-main">
          {workSession ? <V4WorkSessionTrackingStrip /> : null}
          {context === 'project' && projectContextHeader ? (
            <div className="final-ui-reference" style={{ flex: '0 0 auto', height: 'auto' }}>
              <FinalProjectHeader />
            </div>
          ) : null}
          <div className={`v4-shell__content${boundedPage ? ' v4-shell__content--bounded' : ''}`}>
            {pageHeader}
            <div className={`v4-shell__page${boundedPage ? ' v4-shell__page--bounded' : ''}`}>
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
