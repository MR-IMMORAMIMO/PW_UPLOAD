import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import scientechnicLogo from '../assets/branding/scientechnic-official-logo.png';
import { useAppContext } from '../app-context';
import { Avatar } from './ui';
import {
  GLOBAL_GROUP_LABELS,
  PROJECT_GROUPS,
  type GlobalNavItem,
  type ProjectNavGroup,
  type ProjectNavPage,
  type SidebarContext,
  type SidebarMode,
} from '../navigation';

const SIDEBAR_MODE_STORAGE_KEY = 'scli.sidebarMode';

export function readPersistedSidebarMode(): SidebarMode {
  return window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY) === 'minimal'
    ? 'MINIMAL'
    : 'EXTENDED';
}

export function persistSidebarMode(mode: SidebarMode): void {
  window.localStorage.setItem(
    SIDEBAR_MODE_STORAGE_KEY,
    mode === 'MINIMAL' ? 'minimal' : 'extended',
  );
}

interface ProjectIdentity {
  code: string | null;
  name: string | null;
  statusLabel: string | null;
}

export interface ContextualSidebarProps {
  context: SidebarContext;
  mode: SidebarMode;
  onToggleMode: () => void;
  /** The global nav items to render (role/variant filtered by the shell). */
  globalItems: readonly GlobalNavItem[];
  /** Active project id (URL authority) used to build absolute project nav paths. */
  projectId?: string | null;
  /** Rendered in the project identity header slot (restrained project identity). */
  projectIdentity?: ProjectIdentity | null;
  /** Optional dev-mode mock-user card, shown at the top of the GLOBAL rail. */
  devCard?: ReactNode;
  /** Optional Work Session anchor slot, rendered above the user profile. */
  workSessionSlot?: ReactNode;
  /** Optional Minimal Work Session status indicator, rendered above the profile. */
  minimalWorkSessionSlot?: ReactNode;
}

/** Render a single EXTENDED global nav item with active highlighting. */
function GlobalExtendedItem({ item }: { item: GlobalNavItem }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} {...(item.end ? { end: true } : {})}>
      <Icon size={18} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

/** Render a single EXTENDED project page under its group. */
function ProjectExtendedPage({ page, projectPath }: { page: ProjectNavPage; projectPath: string }) {
  const Icon = page.icon;
  return (
    <NavLink to={`${projectPath}/${page.to}`} end={page.id === 'summary'}>
      <Icon size={16} aria-hidden="true" />
      <span>{page.label}</span>
    </NavLink>
  );
}

/** A flyout of child pages opened from a MINIMAL project group icon. */
function ProjectGroupFlyout({
  group,
  projectPath,
  onSelect,
}: {
  group: ProjectNavGroup;
  projectPath: string;
  onSelect: () => void;
}) {
  const location = useLocation();
  return (
    <div
      className="project-group-flyout"
      role="menu"
      aria-label={`${group.label} pages`}
      data-group={group.id}
    >
      <div className="project-group-flyout-heading">
        <group.icon size={16} aria-hidden="true" />
        <span>{group.label}</span>
      </div>
      {group.pages.map((page) => {
        const Icon = page.icon;
        const to = `${projectPath}/${page.to}`;
        const active = location.pathname === to;
        return (
          <NavLink
            key={page.id}
            to={to}
            role="menuitem"
            onClick={onSelect}
            className={active ? 'active' : ''}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{page.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

function GlobalNavBody({ mode, items }: { mode: SidebarMode; items: readonly GlobalNavItem[] }) {
  if (mode === 'MINIMAL') {
    return (
      <nav className="contextual-nav minimal" aria-label="Workspace navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              {...(item.end ? { end: true } : {})}
              aria-label={item.label}
              title={item.label}
            >
              <Icon size={19} aria-hidden="true" />
            </NavLink>
          );
        })}
      </nav>
    );
  }

  const groups = (['workspace', 'resources', 'system'] as const).map((groupId) => ({
    id: groupId,
    label: GLOBAL_GROUP_LABELS[groupId],
    items: items.filter((item) => item.groupId === groupId),
  }));

  return (
    <nav className="contextual-nav extended" aria-label="Workspace navigation">
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.id} className="global-nav-group">
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <GlobalExtendedItem key={item.id} item={item} />
              ))}
            </section>
          ),
      )}
    </nav>
  );
}

function ProjectNavBody({
  mode,
  groupId,
  projectPath,
}: {
  mode: SidebarMode;
  groupId: string | null;
  projectPath: string;
}) {
  const [openGroup, setOpenGroup] = useState<ProjectNavGroup | null>(null);
  // Collapsed group ids. UI state only — never persisted to project data.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  // Viewport coords (left/top) for the portal-rendered MINIMAL flyout.
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // Close the flyout whenever the route changes.
  useEffect(() => {
    setOpenGroup(null);
    setFlyoutPos(null);
  }, [location.pathname]);

  // Auto-expand the group that owns the active child route. This makes deep
  // links boot straight into the correct group and never hides the active
  // page behind stale collapsed state, without forcing every group open.
  useEffect(() => {
    if (!groupId) return;
    setCollapsedGroups((current) => {
      if (current.has(groupId)) {
        const next = new Set(current);
        next.delete(groupId);
        return next;
      }
      return current;
    });
  }, [groupId]);

  useEffect(() => {
    if (!openGroup) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroup(null);
        setFlyoutPos(null);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (flyoutRef.current?.contains(event.target as Node)) return;
      if (sidebarRef.current?.contains(event.target as Node)) return;
      setOpenGroup(null);
      setFlyoutPos(null);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openGroup]);

  const toggleGroup = useCallback((group: ProjectNavGroup, anchor: HTMLElement | null) => {
    setOpenGroup((current) => (current?.id === group.id ? null : group));
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setFlyoutPos({
        left: Math.min(rect.left + 44 + 8, window.innerWidth - 236),
        top: rect.top,
      });
    }
  }, []);

  const selectPage = useCallback(() => {
    setOpenGroup(null);
    setFlyoutPos(null);
  }, []);

  // The active child route must always remain visible in Extended mode: the
  // group that owns the active route can never be collapsed. Only unrelated
  // groups are collapsible. UI-only guard — no route change, no persistence.
  const toggleCollapsed = useCallback(
    (group: ProjectNavGroup) => {
      if (group.id === groupId) return;
      setCollapsedGroups((current) => {
        const next = new Set(current);
        if (next.has(group.id)) {
          next.delete(group.id);
        } else {
          next.add(group.id);
        }
        return next;
      });
    },
    [groupId],
  );

  if (mode === 'MINIMAL') {
    return (
      <nav ref={sidebarRef} className="project-group-nav minimal" aria-label="Project navigation">
        {PROJECT_GROUPS.map((group) => {
          const Icon = group.icon;
          const active = group.id === groupId;
          return (
            <button
              key={group.id}
              type="button"
              className={`project-group-button${active ? ' active' : ''}`}
              aria-label={group.label}
              title={group.label}
              aria-haspopup="menu"
              aria-expanded={openGroup?.id === group.id}
              onClick={(event) => toggleGroup(group, event.currentTarget)}
            >
              <Icon size={19} aria-hidden="true" />
            </button>
          );
        })}
        {openGroup && flyoutPos
          ? createPortal(
              <div
                ref={flyoutRef}
                className="project-group-flyout-portal"
                style={{ left: flyoutPos.left, top: flyoutPos.top }}
                data-open-group={openGroup.id}
              >
                <ProjectGroupFlyout
                  group={openGroup}
                  projectPath={projectPath}
                  onSelect={selectPage}
                />
              </div>,
              document.body,
            )
          : null}
      </nav>
    );
  }

  return (
    <nav className="project-group-nav extended" aria-label="Project navigation">
      {PROJECT_GROUPS.map((group) => {
        const collapsed = collapsedGroups.has(group.id);
        const actionLabel = collapsed ? 'Expand' : 'Collapse';
        const expandedLabel = `${actionLabel} ${group.label}`;
        return (
          <section key={group.id} className="project-nav-group" data-group={group.id}>
            <button
              type="button"
              className="project-nav-group-heading"
              aria-expanded={!collapsed}
              aria-label={expandedLabel}
              onClick={() => toggleCollapsed(group)}
            >
              <group.icon size={15} aria-hidden="true" />
              <span>{group.label}</span>
              <span className="project-nav-group-chevron" aria-hidden="true">
                {collapsed ? (
                  <ChevronRight size={14} strokeWidth={1.75} />
                ) : (
                  <ChevronDown size={14} strokeWidth={1.75} />
                )}
              </span>
            </button>
            {!collapsed
              ? group.pages.map((page) => (
                  <ProjectExtendedPage key={page.id} page={page} projectPath={projectPath} />
                ))
              : null}
          </section>
        );
      })}
    </nav>
  );
}

/** Derive the active project group from the route without a second authority. */
function projectGroupIdFromPathname(pathname: string): string | null {
  const segment = pathname.split('/').filter(Boolean)[2];
  if (!segment) return null;
  for (const group of PROJECT_GROUPS) {
    if (group.pages.some((page) => page.to === segment)) return group.id;
  }
  return null;
}

/** The single physical sidebar rail. Content switches by context and mode. */
export function ContextualSidebar({
  context,
  mode,
  onToggleMode,
  globalItems,
  projectId,
  projectIdentity,
  devCard,
  workSessionSlot,
  minimalWorkSessionSlot,
}: ContextualSidebarProps) {
  const { currentUser } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();

  const projectPath = projectId ? `/projects/${projectId}` : null;
  const projectGroupId = projectGroupIdFromPathname(location.pathname);
  const minimal = mode === 'MINIMAL';
  const toggleLabel = minimal ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <aside
      className={`contextual-sidebar ${context.toLowerCase()} ${minimal ? 'minimal' : 'extended'}`}
    >
      {context === 'GLOBAL' ? (
        <div className="contextual-brand-row">
          {minimal ? (
            <button
              className="icon-button sidebar-expand-control"
              type="button"
              onClick={onToggleMode}
              aria-label={toggleLabel}
              title={toggleLabel}
            >
              <ChevronRight size={18} strokeWidth={1.75} />
            </button>
          ) : (
            <>
              <div className="personal-branding contextual-global-brand">
                <img className="sidebar-brand-logo" src={scientechnicLogo} alt="Scientechnic" />
                <strong>SCT Workspace</strong>
              </div>
              <button
                className="icon-button sidebar-collapse-control"
                type="button"
                onClick={onToggleMode}
                aria-label={toggleLabel}
                title={toggleLabel}
              >
                <ChevronLeft size={18} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="contextual-project-header">
          <div className="contextual-project-header-top">
            <button
              className="project-back-button"
              type="button"
              onClick={() => navigate('/projects')}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              {!minimal ? <span>Back to Projects</span> : null}
            </button>
            {!minimal ? (
              <button
                className="icon-button sidebar-collapse-control"
                type="button"
                onClick={onToggleMode}
                aria-label={toggleLabel}
                title={toggleLabel}
              >
                <ChevronLeft size={18} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
          {projectIdentity && !minimal ? (
            <div className="project-identity">
              <span className="project-identity-code" title={projectIdentity.code ?? undefined}>
                {projectIdentity.code ?? 'Project'}
              </span>
              <strong className="project-identity-name" title={projectIdentity.name ?? undefined}>
                {projectIdentity.name ?? 'Untitled project'}
              </strong>
              {projectIdentity.statusLabel ? (
                <span className="project-identity-status">{projectIdentity.statusLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* Dev-mode mock-user switcher stays reachable in every context so mock
          E2E can switch identity while on project pages too. */}
      {!minimal && devCard ? <div className="contextual-dev-card">{devCard}</div> : null}

      {context === 'GLOBAL' ? (
        <GlobalNavBody mode={mode} items={globalItems} />
      ) : projectPath ? (
        <ProjectNavBody mode={mode} groupId={projectGroupId} projectPath={projectPath} />
      ) : null}

      <div className="contextual-sidebar-footer">
        {!minimal && workSessionSlot ? (
          <div className="contextual-work-session">{workSessionSlot}</div>
        ) : null}
        {minimal && minimalWorkSessionSlot ? (
          <div className="contextual-work-session-minimal">{minimalWorkSessionSlot}</div>
        ) : null}
        <div className="sidebar-user">
          <Avatar user={currentUser} />
          {!minimal ? (
            <div>
              <strong>{currentUser.displayName}</strong>
              <span>{currentUser.role}</span>
            </div>
          ) : null}
        </div>
        {context === 'PROJECT' && minimal ? (
          <button
            className="icon-button sidebar-expand-control"
            type="button"
            onClick={onToggleMode}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
