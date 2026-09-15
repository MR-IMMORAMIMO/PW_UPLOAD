import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { generatePath, useNavigate } from 'react-router-dom';
import type {
  PersonalPortfolioOperations,
  Project,
  ProjectActionItem,
  ProjectMeeting,
  ProjectRequirement,
} from '@scli/domain';
import {
  SctNext as ArrowRight,
  SctDeadline as BellRing,
  SctProjects as BriefcaseBusiness,
  SctWarning as CircleAlert,
  SctWarning as ShieldAlert,
} from '../../components/common/SctIcons';
import {
  AlarmClock,
  CalendarDays,
  ChevronRight,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  UsersRound,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { formatProjectStatus } from '../../components/project/statusDisplay';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { useV4WorkSession } from '../../components/work-session/WorkSessionProvider';
import { formatWorkSessionElapsed } from '../../components/work-session/workSessionTime';
import {
  ROUTE_PROJECTS,
  ROUTE_NEW_PROJECT,
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
} from '../../router/routes';
import { statusTone } from '../projects/projectsViewModel';
import {
  DASHBOARD_TIMEZONE,
  dateKeyInTimezone,
  deriveDashboardView,
  dueDetail,
  formatDashboardDate,
  formatMeetingDateTime,
  needAttentionReason,
  projectsForKpi,
  type AttentionReason,
  type DashboardKpiId,
} from './dashboardViewModel';

const KPI_ICONS = {
  active: BriefcaseBusiness,
  dueThisWeek: CalendarDays,
  revisionRequired: RefreshCw,
  clientReview: UsersRound,
} as const;

const ATTENTION_COPY: Record<AttentionReason, string> = {
  overdue: 'Overdue',
  revision: 'Revision Required',
  due: 'Due Soon',
};

function projectRoute(route: string, projectId: string): string {
  return generatePath(route, { projectId });
}

function projectById(projects: readonly Project[]): Map<string, Project> {
  return new Map(projects.map((project) => [project.id, project]));
}

function ProjectIdentity({
  project,
  fallback,
}: {
  project: Project | undefined;
  fallback: string;
}) {
  return (
    <span className="v4-dashboard__identity">
      <strong>{project?.projectCode ?? fallback}</strong>
      <span>
        {project ? `${project.projectName} · ${project.clientName}` : 'Project unavailable'}
      </span>
    </span>
  );
}

function SectionCard({
  title,
  icon: Icon,
  action,
  className = '',
  children,
}: {
  title: string;
  icon: typeof BellRing;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`v4-dashboard-card ${className}`} aria-label={title}>
      <header className="v4-dashboard-card__header">
        <span className="v4-dashboard-card__title">
          <Icon aria-hidden="true" />
          <h2>{title}</h2>
        </span>
        {action}
      </header>
      {children}
    </section>
  );
}

function DashboardLoading() {
  return (
    <div className="v4-dashboard__loading" role="status" aria-label="Loading Dashboard">
      {Array.from({ length: 4 }, (_, index) => (
        <span key={index} />
      ))}
      <span className="v4-dashboard__loading-main" />
      <span className="v4-dashboard__loading-main" />
    </div>
  );
}

function WorkSessionCard({ onViewProjects }: { onViewProjects: () => void }) {
  const workSession = useV4WorkSession();
  const pending = workSession.pausePending || workSession.resumePending || workSession.stopPending;

  return (
    <SectionCard title="Work Session" icon={Clock3} className="v4-dashboard-session">
      {workSession.statusLoading ? (
        <p className="v4-dashboard__compact-state">Checking Work Session…</p>
      ) : workSession.statusUnavailable ? (
        <p className="v4-dashboard__compact-state" role="alert">
          Work Session status is unavailable.
        </p>
      ) : workSession.active ? (
        <div className="v4-dashboard-session__body">
          <div className="v4-dashboard-session__project">
            <strong>{workSession.activeProject?.projectName ?? 'Active project'}</strong>
            <span>{workSession.activeProject?.projectCode ?? workSession.active.projectId}</span>
            <span>{formatProjectStatus(workSession.activeProject?.status)}</span>
          </div>
          <span className="v4-dashboard-session__state" data-state={workSession.state}>
            <i aria-hidden="true" /> {workSession.state === 'RUNNING' ? 'Running for' : 'Paused at'}
          </span>
          <strong
            className="v4-dashboard-session__timer"
            aria-label={`Elapsed ${formatWorkSessionElapsed(workSession.elapsedSeconds)}`}
          >
            {formatWorkSessionElapsed(workSession.elapsedSeconds)}
          </strong>
          <div className="v4-dashboard-session__controls">
            {workSession.state === 'RUNNING' ? (
              <button type="button" onClick={workSession.pause} disabled={pending}>
                <Pause aria-hidden="true" /> {workSession.pausePending ? 'Pausing…' : 'Pause'}
              </button>
            ) : (
              <button type="button" onClick={workSession.resume} disabled={pending}>
                <Play aria-hidden="true" /> {workSession.resumePending ? 'Resuming…' : 'Resume'}
              </button>
            )}
            <button
              type="button"
              className="v4-dashboard-session__stop"
              onClick={workSession.stop}
              disabled={pending}
            >
              <Square aria-hidden="true" /> {workSession.stopPending ? 'Stopping…' : 'Stop'}
            </button>
            <button
              type="button"
              aria-label="View active Work Session project"
              onClick={() => workSession.active && onViewProjects()}
            >
              <ArrowRight aria-hidden="true" /> View
            </button>
          </div>
          {workSession.error ? <p role="alert">{workSession.error}</p> : null}
        </div>
      ) : (
        <div className="v4-dashboard-session__empty">
          <Clock3 aria-hidden="true" />
          <strong>No active Work Session</strong>
          <p>Open a project to start tracking time.</p>
          <button type="button" onClick={onViewProjects}>
            <FolderKanban aria-hidden="true" /> View Projects
          </button>
        </div>
      )}
    </SectionCard>
  );
}

function OperationGroup<T extends ProjectActionItem | ProjectMeeting | ProjectRequirement>({
  title,
  icon: Icon,
  items,
  empty,
  projects,
  route,
  detail,
  onOpen,
}: {
  title: string;
  icon: typeof ListChecks;
  items: readonly T[];
  empty: string;
  projects: Map<string, Project>;
  route: string;
  detail: (item: T) => string;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="v4-dashboard-operation" aria-label={title}>
      <header>
        <span>
          <Icon aria-hidden="true" /> {title}
        </span>
        <b>{items.length}</b>
      </header>
      {items.length ? (
        <ul>
          {items.slice(0, 2).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(projectRoute(route, item.projectId))}>
                <ProjectIdentity project={projects.get(item.projectId)} fallback={item.projectId} />
                <span className="v4-dashboard-operation__detail">
                  {detail(item)} <ChevronRight aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="v4-dashboard__compact-state">{empty}</p>
      )}
      {items.length > 2 ? (
        <span className="v4-dashboard-operation__more">+{items.length - 2} more</span>
      ) : null}
    </section>
  );
}

export function LegacyDashboardPage() {
  const navigate = useNavigate();
  const workSession = useV4WorkSession();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpiId>('active');
  const [now, setNow] = useState(() => new Date());
  const projectsQuery = useQuery({
    queryKey: ['v4', 'dashboard', 'projects'],
    queryFn: () => api.projects(),
    staleTime: 30_000,
  });
  const operationsQuery = useQuery({
    queryKey: ['v4', 'dashboard', 'operations'],
    queryFn: api.personalOperations,
    staleTime: 30_000,
  });

  useEffect(() => {
    const refreshDate = () => setNow(new Date());
    window.addEventListener('focus', refreshDate);
    return () => window.removeEventListener('focus', refreshDate);
  }, []);

  const today = dateKeyInTimezone(now, DASHBOARD_TIMEZONE);
  const projects = projectsQuery.data ?? [];
  const dashboard = useMemo(() => deriveDashboardView(projects, today), [projects, today]);
  const filteredProjects = useMemo(
    () => projectsForKpi(dashboard.activeProjects, selectedKpi, today),
    [dashboard.activeProjects, selectedKpi, today],
  );
  const projectsMap = useMemo(() => projectById(projects), [projects]);
  const openProject = (projectId: string) =>
    navigate(projectRoute(ROUTE_PROJECT_SUMMARY, projectId));
  const activeSessionProjectPath = workSession.active
    ? projectRoute(ROUTE_PROJECT_SUMMARY, workSession.active.projectId)
    : ROUTE_PROJECTS;

  const operations: PersonalPortfolioOperations = operationsQuery.data ?? {
    overdueActions: [],
    upcomingActions: [],
    upcomingMeetings: [],
    blockingRequirements: [],
    openReviews: [],
  };

  const handleGlobalNav = (id: string) => {
    if (id === 'dashboard') navigate('/dashboard');
    if (id === 'projects') navigate(ROUTE_PROJECTS);
  };

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      onToggleSidebarMode={() =>
        setSidebarMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="dashboard"
      onSelectSection={handleGlobalNav}
      boundedPage
      pageHeader={
        <div className="v4-dashboard-page-header">
          <V4PageHeader
            title="Dashboard"
            description="Your command center for today's lighting design priorities and workload."
            icon={LayoutDashboard}
            actions={
              <div className="v4-dashboard__header-actions">
                <button type="button" onClick={() => navigate(ROUTE_PROJECTS)}>
                  <FolderKanban aria-hidden="true" /> View All Projects
                </button>
                <button
                  type="button"
                  className="v4-dashboard__new-project"
                  onClick={() => navigate(ROUTE_NEW_PROJECT)}
                >
                  <Plus aria-hidden="true" /> New Project
                </button>
              </div>
            }
          />
        </div>
      }
    >
      <main className="v4-dashboard" data-testid="v4-dashboard">
        {projectsQuery.isLoading ? (
          <DashboardLoading />
        ) : projectsQuery.isError ? (
          <section className="v4-dashboard__error" role="alert">
            <CircleAlert aria-hidden="true" />
            <h2>Dashboard data is unavailable</h2>
            <p>The project portfolio could not be loaded.</p>
            <button type="button" onClick={() => projectsQuery.refetch()}>
              Retry
            </button>
          </section>
        ) : (
          <>
            <section className="v4-dashboard-kpis" aria-label="Dashboard project filters">
              {dashboard.kpis.map((kpi) => {
                const Icon = KPI_ICONS[kpi.id];
                return (
                  <button
                    key={kpi.id}
                    type="button"
                    className="v4-dashboard-kpi"
                    data-tone={kpi.id}
                    aria-pressed={selectedKpi === kpi.id}
                    aria-label={`${kpi.label}: ${kpi.count} projects`}
                    onClick={() => setSelectedKpi(kpi.id)}
                  >
                    <span className="v4-dashboard-kpi__icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="v4-dashboard-kpi__copy">
                      <b>{kpi.label}</b>
                      <strong>{kpi.count}</strong>
                      <small>{kpi.supportingCopy}</small>
                    </span>
                    <span className="v4-dashboard-kpi__arrow">
                      <ChevronRight aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </section>

            {projects.length === 0 ? (
              <section className="v4-dashboard__empty-portfolio">
                <FolderKanban aria-hidden="true" />
                <h2>Your workspace is ready.</h2>
                <p>Create your first lighting project from the New Project workspace.</p>
              </section>
            ) : (
              <div className="v4-dashboard__command-grid">
                <SectionCard
                  title="Need Attention"
                  icon={BellRing}
                  action={
                    <span className="v4-dashboard-card__count">
                      {dashboard.needAttention.length}
                    </span>
                  }
                  className="v4-dashboard-attention"
                >
                  {dashboard.needAttention.length ? (
                    <ul className="v4-dashboard-attention__list">
                      {dashboard.needAttention.slice(0, 4).map((project) => {
                        const reason = needAttentionReason(project, today);
                        const ReasonIcon =
                          reason === 'overdue'
                            ? AlarmClock
                            : reason === 'revision'
                              ? RefreshCw
                              : CalendarDays;
                        return (
                          <li key={project.id}>
                            <button type="button" onClick={() => openProject(project.id)}>
                              <span className="v4-dashboard-attention__icon" data-reason={reason}>
                                <ReasonIcon aria-hidden="true" />
                              </span>
                              <ProjectIdentity project={project} fallback={project.id} />
                              <span className="v4-dashboard-attention__state" data-reason={reason}>
                                <strong>{ATTENTION_COPY[reason]}</strong>
                                <small>{formatDashboardDate(project.requiredDeliveryDate)}</small>
                              </span>
                              <ChevronRight aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="v4-dashboard__positive-state">
                      You’re all caught up. No projects need immediate attention.
                    </p>
                  )}
                </SectionCard>

                <SectionCard
                  title="Active Projects"
                  icon={BriefcaseBusiness}
                  action={
                    <button
                      type="button"
                      className="v4-dashboard-card__link"
                      onClick={() => navigate(ROUTE_PROJECTS)}
                    >
                      View all ({filteredProjects.length})
                    </button>
                  }
                  className="v4-dashboard-projects"
                >
                  <div className="v4-dashboard-projects__head" aria-hidden="true">
                    <span>Project</span>
                    <span>Status</span>
                    <span>Due date</span>
                    <span>Progress</span>
                    <span />
                  </div>
                  {filteredProjects.length ? (
                    <ul className="v4-dashboard-projects__list">
                      {filteredProjects.slice(0, 5).map((project) => (
                        <li key={project.id}>
                          <button type="button" onClick={() => openProject(project.id)}>
                            <ProjectIdentity project={project} fallback={project.id} />
                            <V4StatusPill variant={statusTone(project.status)}>
                              {formatProjectStatus(project.status)}
                            </V4StatusPill>
                            <span
                              className="v4-dashboard-projects__due"
                              data-state={
                                project.requiredDeliveryDate < today ? 'overdue' : 'upcoming'
                              }
                            >
                              <strong>{formatDashboardDate(project.requiredDeliveryDate)}</strong>
                              <small>{dueDetail(project.requiredDeliveryDate, today)}</small>
                            </span>
                            <span className="v4-dashboard-projects__progress">
                              <strong>{project.progressPercent}%</strong>
                              <i>
                                <b
                                  style={{
                                    width: `${Math.max(0, Math.min(100, project.progressPercent))}%`,
                                  }}
                                />
                              </i>
                            </span>
                            <ChevronRight aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="v4-dashboard__compact-state">
                      No projects match the selected{' '}
                      {dashboard.kpis.find((kpi) => kpi.id === selectedKpi)?.label} filter.
                    </p>
                  )}
                </SectionCard>

                <WorkSessionCard onViewProjects={() => navigate(activeSessionProjectPath)} />
              </div>
            )}

            <SectionCard
              title="Operations"
              icon={ListChecks}
              className="v4-dashboard-operations"
              action={
                operationsQuery.isFetching ? (
                  <span className="v4-dashboard-card__count">Refreshing…</span>
                ) : undefined
              }
            >
              {operationsQuery.isLoading ? (
                <p className="v4-dashboard__compact-state">Loading portfolio operations…</p>
              ) : operationsQuery.isError ? (
                <div className="v4-dashboard-operations__error" role="alert">
                  <span>Operations are temporarily unavailable.</span>
                  <button type="button" onClick={() => operationsQuery.refetch()}>
                    Retry
                  </button>
                </div>
              ) : (
                <div className="v4-dashboard-operations__grid">
                  <OperationGroup
                    title="Overdue Actions"
                    icon={ListChecks}
                    items={operations.overdueActions}
                    empty="No overdue actions"
                    projects={projectsMap}
                    route={ROUTE_PROJECT_ACTIONS}
                    detail={(item) => `${item.title} · ${formatDashboardDate(item.dueDate)}`}
                    onOpen={navigate}
                  />
                  <OperationGroup
                    title="Upcoming Meetings"
                    icon={CalendarDays}
                    items={operations.upcomingMeetings}
                    empty="No upcoming meetings"
                    projects={projectsMap}
                    route={ROUTE_PROJECT_MEETINGS}
                    detail={(item) => `${item.title} · ${formatMeetingDateTime(item.startAt)}`}
                    onOpen={navigate}
                  />
                  <OperationGroup
                    title="Blocking Requirements"
                    icon={ShieldAlert}
                    items={operations.blockingRequirements}
                    empty="No blocking requirements"
                    projects={projectsMap}
                    route={ROUTE_PROJECT_SCOPE}
                    detail={(item) => item.title}
                    onOpen={navigate}
                  />
                </div>
              )}
            </SectionCard>

            <p className="v4-dashboard__timezone-note">
              <Clock3 aria-hidden="true" /> All dates are based on {DASHBOARD_TIMEZONE} timezone.
              Keep project information and due dates up to date.
            </p>
          </>
        )}
      </main>
    </V4AppShell>
  );
}
