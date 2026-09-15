import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  ClipboardCheck,
  Plus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project } from '@scli/domain';
import { isActiveProject } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { AssignmentDrawer } from '../components/assignment-drawer';
import { LiveTimerCard } from '../components/live-timer';
import { PersonalDashboardScreen } from './personal-dashboard';
import { ProjectCard } from '../components/project-card';
import {
  Avatar,
  Deadline,
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingState,
  PageHeader,
  ProgressBar,
  SectionHeading,
  StatusBadge,
} from '../components/ui';

export function DashboardScreen() {
  const { integrationStatus } = useAppContext();
  if (integrationStatus.workspaceVariant === 'personal') return <PersonalDashboardScreen />;
  return <TeamDashboardScreen />;
}

function TeamDashboardScreen() {
  const { currentUser, integrationStatus } = useAppContext();
  const manager = currentUser.role === 'LineManager' || currentUser.role === 'Admin';
  const [assigning, setAssigning] = useState<Project | null>(null);
  const projectsQuery = useQuery({
    queryKey: ['projects', currentUser.id],
    queryFn: () => api.projects(),
  });
  const workloadsQuery = useQuery({
    queryKey: ['workloads'],
    queryFn: api.workloads,
    enabled: manager || currentUser.role === 'Designer',
  });
  const timeTrackingQuery = useQuery({
    queryKey: ['time-tracking', currentUser.id],
    queryFn: api.timeTrackingOverview,
    enabled: manager || currentUser.role === 'Designer',
    refetchInterval: 30_000,
  });
  const projects = projectsQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekText = nextWeek.toISOString().slice(0, 10);

  const data = useMemo(() => {
    const active = projects.filter(isActiveProject);
    const unassigned = projects.filter(
      (project) => project.assignedDesignerId === null && isActiveProject(project),
    );
    const overdue = active.filter((project) => project.requiredDeliveryDate < today);
    const dueThisWeek = active.filter(
      (project) =>
        project.requiredDeliveryDate >= today && project.requiredDeliveryDate <= nextWeekText,
    );
    const urgent = active
      .filter((project) => project.priority === 'Urgent' || project.requiredDeliveryDate < today)
      .sort((a, b) => a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate));
    const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    const waitingForSales = active.filter((project) =>
      ['WaitingForSales', 'WaitingForInformation'].includes(project.status),
    );
    const review = active.filter((project) =>
      ['InternalReview', 'ReadyToIssue', 'Issued'].includes(project.status),
    );
    return { active, unassigned, overdue, dueThisWeek, urgent, recent, waitingForSales, review };
  }, [nextWeekText, projects, today]);

  if (projectsQuery.isLoading) return <LoadingState label="Building your dashboard…" />;
  if (projectsQuery.error) {
    return (
      <ErrorState
        message={(projectsQuery.error as Error).message}
        onRetry={() => projectsQuery.refetch()}
      />
    );
  }

  const greeting = new Intl.DateTimeFormat('en-AE', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <>
      <PageHeader
        eyebrow={`Today · ${greeting}`}
        title={`Good morning, ${currentUser.displayName.split(' ')[0]}`}
        description={
          manager
            ? 'Here is the studio workload and what needs your attention today.'
            : currentUser.role === 'Designer'
              ? 'Your priorities, deadlines and workload are ready.'
              : 'Track every request from submission through delivery.'
        }
        actions={
          <div className="live-pill">
            <span /> {integrationStatus.mode === 'mock' ? 'Live mock workspace' : 'Local workspace'}
          </div>
        }
      />

      <section className="role-focus-strip" aria-label="Today’s priority actions">
        {manager ? (
          <>
            <Link to="/unassigned" className="role-focus-card warning">
              <UsersRound size={20} />
              <span>
                <small>Assign next</small>
                <strong>{data.unassigned.length} requests</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/timesheets" className="role-focus-card accent">
              <ClipboardCheck size={20} />
              <span>
                <small>Approval queue</small>
                <strong>{timeTrackingQuery.data?.pendingApprovals ?? 0} timesheets</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/projects?preset=overdue" className="role-focus-card danger">
              <AlertTriangle size={20} />
              <span>
                <small>Delivery risk</small>
                <strong>{data.overdue.length} overdue</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
          </>
        ) : currentUser.role === 'Sales' ? (
          <>
            <Link to="/new" className="role-focus-card accent">
              <Plus size={20} />
              <span>
                <small>Quick action</small>
                <strong>New request</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/projects?preset=waiting-sales" className="role-focus-card warning">
              <Clock3 size={20} />
              <span>
                <small>Needs information</small>
                <strong>{data.waitingForSales.length} requests</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/projects?status=InternalReview" className="role-focus-card">
              <CheckCircle2 size={20} />
              <span>
                <small>Review & issue</small>
                <strong>{data.review.length} requests</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
          </>
        ) : (
          <>
            <Link to="/projects" className="role-focus-card accent">
              <FolderKanban size={20} />
              <span>
                <small>My active work</small>
                <strong>{data.active.length} projects</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/timesheets" className="role-focus-card">
              <ClipboardCheck size={20} />
              <span>
                <small>Tracked this week</small>
                <strong>
                  {Math.round((timeTrackingQuery.data?.weekMinutes ?? 0) / 6) / 10} hours
                </strong>
              </span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/projects?preset=due-week" className="role-focus-card warning">
              <CalendarClock size={20} />
              <span>
                <small>Due soon</small>
                <strong>{data.dueThisWeek.length} projects</strong>
              </span>
              <ArrowRight size={17} />
            </Link>
          </>
        )}
      </section>

      {currentUser.role === 'Designer' ? <LiveTimerCard compact /> : null}

      <section className="kpi-grid" aria-label="Project overview">
        <KpiCard
          icon={<FolderKanban />}
          label="Active projects"
          value={data.active.length}
          detail={`${projects.length} total requests`}
          tone="accent"
        />
        {manager ? (
          <KpiCard
            icon={<UsersRound />}
            label="Unassigned"
            value={data.unassigned.length}
            detail="Waiting for a Lighting Designer"
            tone="warning"
            delay={0.04}
          />
        ) : null}
        {manager ? (
          <KpiCard
            icon={<ClipboardCheck />}
            label="Timesheets to approve"
            value={timeTrackingQuery.data?.pendingApprovals ?? 0}
            detail="Submitted by Lighting Designers"
            tone="accent"
            delay={0.14}
          />
        ) : null}
        <KpiCard
          icon={<AlertTriangle />}
          label="Overdue"
          value={data.overdue.length}
          detail={data.overdue.length ? 'Needs immediate attention' : 'Everything is on track'}
          tone={data.overdue.length ? 'danger' : 'default'}
          delay={0.08}
        />
        {manager ? (
          <KpiCard
            icon={<UserRoundCheck />}
            label="Available Lighting Designers"
            value={
              workloadsQuery.data?.filter((item) => item.classification === 'Available').length ??
              '—'
            }
            detail={`${workloadsQuery.data?.length ?? 0} active Lighting Designers`}
            delay={0.12}
          />
        ) : null}
        <KpiCard
          icon={<CalendarClock />}
          label="Due next 7 days"
          value={data.dueThisWeek.length}
          detail="Across active work"
          delay={0.16}
        />
      </section>

      {manager ? (
        <div className="dashboard-grid">
          <section className="dashboard-main-section">
            <SectionHeading
              title="Unassigned requests"
              detail="Sorted by deadline and priority"
              to="/unassigned"
            />
            <div className="project-grid project-grid-two">
              {data.unassigned.slice(0, 4).map((project) => (
                <ProjectCard key={project.id} project={project} onAssign={setAssigning} compact />
              ))}
            </div>
            {!data.unassigned.length ? (
              <EmptyState
                title="Assignment queue is clear"
                description="Every active request has a Lighting Designer."
              />
            ) : null}
          </section>

          <aside className="dashboard-side-section">
            <SectionHeading
              title="Studio availability"
              detail="Recommended order"
              to="/designers"
            />
            <div className="compact-designer-list">
              {workloadsQuery.data?.map((workload) => (
                <article key={workload.designer.id} className="compact-designer-card">
                  <Avatar user={workload.designer} />
                  <div>
                    <div className="designer-title-line">
                      <strong>{workload.designer.displayName}</strong>
                      <span
                        className={`availability-dot availability-${workload.classification}`}
                        title={workload.classification}
                      />
                    </div>
                    <span>
                      {workload.activeProjectCount} projects · {workload.activeEstimatedHours}h /{' '}
                      {workload.weeklyCapacityHours}h
                    </span>
                    <ProgressBar
                      value={Math.min(workload.utilizationPercent, 100)}
                      label={`${workload.availabilityPercent}% available`}
                    />
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <section>
          <SectionHeading
            title={currentUser.role === 'Sales' ? 'My latest requests' : 'My active projects'}
            detail="The work that matters most right now"
            to="/projects"
          />
          <div className="project-grid project-grid-three">
            {data.active.slice(0, 6).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
          {!data.active.length ? (
            <EmptyState
              title="No active projects"
              description="New work will appear here when it is ready."
            />
          ) : null}
        </section>
      )}

      <div className="dashboard-grid lower-dashboard">
        <section className="dashboard-main-section">
          <SectionHeading title="Urgent & overdue" detail="Delivery risks to resolve next" />
          <div className="attention-list">
            {data.urgent.slice(0, 5).map((project) => (
              <Link to={`/projects/${project.id}`} key={project.id} className="attention-row">
                <span
                  className={
                    project.requiredDeliveryDate < today
                      ? 'risk-marker danger'
                      : 'risk-marker warning'
                  }
                />
                <div>
                  <strong>{project.projectName}</strong>
                  <span>
                    {project.clientName} · {project.assignedDesignerNameSnapshot ?? 'Unassigned'}
                  </span>
                </div>
                <StatusBadge status={project.status} />
                <Deadline date={project.requiredDeliveryDate} />
              </Link>
            ))}
            {!data.urgent.length ? (
              <EmptyState
                title="No delivery risks"
                description="Nothing urgent or overdue right now."
              />
            ) : null}
          </div>
        </section>

        <aside className="dashboard-side-section recent-panel">
          <SectionHeading title="Recent activity" detail="Latest project movement" />
          <ol className="activity-compact-list">
            {data.recent.map((project) => (
              <li key={project.id}>
                <span className="activity-icon">
                  <CheckCircle2 size={14} />
                </span>
                <div>
                  <Link to={`/projects/${project.id}`}>{project.projectName}</Link>
                  <span>
                    {project.status} · {project.progressPercent}% complete
                  </span>
                </div>
                <Clock3 size={13} />
              </li>
            ))}
          </ol>
          <div className="insight-card">
            <Sparkles size={18} />
            <div>
              <strong>Studio insight</strong>
              <span>
                {data.unassigned.length
                  ? `${data.unassigned.length} requests can be assigned now.`
                  : 'The assignment queue is balanced.'}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <AssignmentDrawer project={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}
