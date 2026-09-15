import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, Moon, Plus, Search, Sun, X } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { statusLabels } from '@scli/domain';
import { workspaceDateKey } from '../local-date';
import { Avatar, formatDate } from './ui';
import {
  PersonalWorkSessionTimer,
  WorkSessionMinimalControls,
  WorkSessionTopBar,
} from './personal-work-session-timer';
import { buildGlobalNav, type SidebarContext, type SidebarMode } from '../navigation';
import {
  ContextualSidebar,
  persistSidebarMode,
  readPersistedSidebarMode,
} from './contextual-sidebar';

const titles: Record<string, string> = {
  '/': 'Today',
  '/new': 'New Project',
  '/unassigned': 'Unassigned Projects',
  '/projects': 'My Projects',
  '/archive': 'Project Archive',
  '/sales': 'Sales Directory',
  '/import-projects': 'Import Existing Projects',
  '/designers': 'Lighting Designer Workload',
  '/reports': 'Reports',
  '/search': 'Workspace Search',
  '/settings': 'Settings',
  '/timesheets': 'Time & Timesheets',
  '/notifications': 'Notifications',
};

const roleLabels = {
  Sales: 'Sales',
  Designer: 'Lighting Designer',
  LineManager: 'Line Manager',
  Admin: 'Admin',
} as const;

export function AppLayout() {
  const {
    currentUser,
    mockUsers,
    integrationStatus,
    switchMockUser,
    logout,
    themePreference,
    setThemePreference,
  } = useAppContext();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => readPersistedSidebarMode());
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const personal = integrationStatus.workspaceVariant === 'personal';

  // The shell route has no `:id` param; derive the project id from the pathname
  // (`/projects/:id/...`). This is the canonical URL authority for context.
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const projectId = pathSegments[0] === 'projects' ? (pathSegments[1] ?? null) : null;

  const notificationsQuery = useQuery({
    queryKey: ['notifications', currentUser.id],
    queryFn: api.notifications,
    refetchInterval: 45_000,
  });
  const personalOperationsQuery = useQuery({
    queryKey: ['personal-operations'],
    queryFn: api.personalOperations,
    enabled: personal,
    refetchInterval: 45_000,
  });

  // Resolve the active project identity for the PROJECT sidebar context.
  const projectQuery = useQuery({
    queryKey: ['project', projectId, currentUser.id],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const toggleMode = () => {
    setSidebarMode((current) => {
      const next = current === 'EXTENDED' ? 'MINIMAL' : 'EXTENDED';
      persistSidebarMode(next);
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const globalItems = useMemo(
    () => buildGlobalNav(integrationStatus.workspaceVariant, currentUser.role),
    [integrationStatus.workspaceVariant, currentUser.role],
  );

  // URL/route is authoritative for the sidebar context.
  const context: SidebarContext = projectId ? 'PROJECT' : 'GLOBAL';

  const nativeUnread =
    notificationsQuery.data?.filter((notification) => !notification.isRead).length ?? 0;
  const personalAlerts = useMemo(() => {
    if (!personal || !personalOperationsQuery.data) return [];
    const operations = personalOperationsQuery.data;
    return [
      ...operations.blockingRequirements.map((item) => ({
        id: `requirement-${item.id}`,
        projectId: item.projectId,
        title: 'Blocking information',
        message: item.title,
        createdAt: item.updatedAt,
      })),
      ...operations.overdueActions.map((item) => ({
        id: `action-${item.id}`,
        projectId: item.projectId,
        title: 'Overdue action',
        message: item.title,
        createdAt: item.dueDate ?? item.updatedAt,
      })),
      ...operations.openReviews
        .filter((item) => item.dueDate && item.dueDate < workspaceDateKey())
        .map((item) => ({
          id: `review-${item.id}`,
          projectId: item.projectId,
          title: 'Overdue client comment',
          message: item.title,
          createdAt: item.dueDate ?? item.updatedAt,
        })),
    ].slice(0, 8);
  }, [personal, personalOperationsQuery.data]);
  const unread = nativeUnread + personalAlerts.length;
  const pageTitle = projectId ? 'Project Details' : (titles[location.pathname] ?? 'SCT Workspace');

  const projectIdentity = projectId
    ? {
        code: projectQuery.data?.projectCode ?? null,
        name: projectQuery.data?.projectName ?? null,
        statusLabel: projectQuery.data ? statusLabels[projectQuery.data.status] : null,
      }
    : null;

  return (
    <div className={`app-shell${sidebarMode === 'MINIMAL' ? ' app-shell-minimal' : ''}`}>
      <ContextualSidebar
        context={context}
        mode={sidebarMode}
        onToggleMode={toggleMode}
        globalItems={globalItems}
        projectId={projectId}
        projectIdentity={projectIdentity}
        devCard={
          integrationStatus.mode === 'mock' && integrationStatus.workspaceVariant !== 'personal' ? (
            <div className="dev-mode-card">
              <div className="dev-mode-title">
                <span /> Development mode
              </div>
              <label htmlFor="mock-user">View as</label>
              <div className="select-wrap">
                <select
                  id="mock-user"
                  value={currentUser.id}
                  onChange={(event) => switchMockUser(event.target.value)}
                >
                  {mockUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName} — {roleLabels[user.role]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </div>
            </div>
          ) : null
        }
        workSessionSlot={personal ? <PersonalWorkSessionTimer /> : null}
        minimalWorkSessionSlot={personal ? <WorkSessionMinimalControls /> : null}
      />

      <div className="app-main">
        <div className="app-sticky-header">
          {personal ? <WorkSessionTopBar /> : null}
          <header className="topbar">
            <div className="topbar-title">
              <div>
                <span>Workspace</span>
                <strong>{pageTitle}</strong>
              </div>
            </div>
            <form
              className="global-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                navigate(
                  search.trim()
                    ? personal
                      ? `/search?q=${encodeURIComponent(search.trim())}`
                      : `/projects?search=${encodeURIComponent(search.trim())}`
                    : '/projects',
                );
              }}
            >
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the whole workspace…"
                aria-label="Global workspace search"
              />
              <kbd>Ctrl K</kbd>
            </form>
            <div className="topbar-actions">
              {integrationStatus.workspaceVariant === 'personal' ||
              currentUser.role !== 'Designer' ? (
                <button
                  className="button primary topbar-new"
                  type="button"
                  onClick={() => navigate('/new')}
                >
                  <Plus size={17} /> New Project
                </button>
              ) : null}
              <div className="notification-wrap">
                <button
                  className="icon-button notification-button"
                  type="button"
                  aria-label={`${unread} unread notifications`}
                  aria-expanded={notificationsOpen}
                  onClick={() => setNotificationsOpen((open) => !open)}
                >
                  <Bell size={19} />
                  {unread ? <span>{unread > 9 ? '9+' : unread}</span> : null}
                </button>
                {notificationsOpen ? (
                  <div className="notification-popover">
                    <div className="popover-heading">
                      <div>
                        <strong>Notifications</strong>
                        <span>{personal ? `${unread} need attention` : `${unread} unread`}</span>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setNotificationsOpen(false)}
                        aria-label="Close notifications"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="notification-list">
                      {personalAlerts.map((item) => (
                        <button
                          type="button"
                          className="notification-item unread"
                          key={item.id}
                          onClick={() => {
                            navigate(`/projects/${item.projectId}`);
                            setNotificationsOpen(false);
                          }}
                        >
                          <span className="notification-indicator" />
                          <span>
                            <strong>{item.title}</strong>
                            <span>{item.message}</span>
                            <small>{formatDate(item.createdAt)}</small>
                          </span>
                        </button>
                      ))}
                      {notificationsQuery.data?.length ? (
                        notificationsQuery.data.slice(0, 8).map((item) => (
                          <button
                            type="button"
                            className={`notification-item${item.isRead ? '' : ' unread'}`}
                            key={item.id}
                            onClick={() => {
                              if (!item.isRead) markRead.mutate(item.id);
                              if (item.projectId) navigate(`/projects/${item.projectId}`);
                              setNotificationsOpen(false);
                            }}
                          >
                            <span className="notification-indicator" />
                            <span>
                              <strong>{item.title}</strong>
                              <span>{item.message}</span>
                              <small>
                                {formatDate(item.createdAt, { hour: '2-digit', minute: '2-digit' })}
                              </small>
                            </span>
                          </button>
                        ))
                      ) : !personalAlerts.length ? (
                        <p className="popover-empty">You’re all caught up.</p>
                      ) : null}
                    </div>
                    {!personal ? (
                      <button
                        type="button"
                        className="notification-view-all"
                        onClick={() => {
                          navigate('/notifications');
                          setNotificationsOpen(false);
                        }}
                      >
                        View all notifications
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <button
                className="icon-button theme-toggle"
                type="button"
                aria-label={`Switch to ${themePreference === 'light' ? 'dark' : 'light'} mode`}
                title={`Switch to ${themePreference === 'light' ? 'dark' : 'light'} mode`}
                onClick={() => setThemePreference(themePreference === 'light' ? 'dark' : 'light')}
              >
                {themePreference === 'light' ? <Moon size={19} /> : <Sun size={19} />}
              </button>
              <div className="topbar-user">
                <Avatar user={currentUser} size="sm" />
                <span>{currentUser.displayName.split(' ')[0]}</span>
              </div>
              {integrationStatus.mode === 'standalone' && !integrationStatus.personalAutoLogin ? (
                <button
                  className="icon-button"
                  type="button"
                  onClick={logout}
                  aria-label="Sign out"
                >
                  <LogOut size={17} />
                </button>
              ) : null}
            </div>
          </header>
        </div>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
