import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListRestart,
  Plus,
  SlidersHorizontal,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  PauseCircle,
  Undo2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DesignStage } from '@scli/domain';
import { api } from '../api';
import { addCalendarDays, workspaceDateKey } from '../local-date';
import {
  Deadline,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeading,
  StatusBadge,
  formatDate,
} from '../components/ui';
import { personalStatusLabel } from '../personal-status';
import {
  activeProjectsByKpi,
  dashboardKpiLabels,
  deriveDashboardView,
  needAttentionReason,
  type DashboardKpiId,
} from '../personal-dashboard-model';

type DashboardWidgetId = 'attention' | 'workload' | 'projects' | 'waiting' | 'recent';

const defaultDashboardWidgets: Array<{
  id: DashboardWidgetId;
  label: string;
  visible: boolean;
}> = [
  { id: 'attention', label: 'Need attention', visible: true },
  { id: 'projects', label: 'Active projects', visible: true },
  { id: 'waiting', label: 'Waiting / External', visible: true },
  { id: 'workload', label: 'Workload snapshot', visible: true },
  { id: 'recent', label: 'Recently updated', visible: true },
];

function savedDashboardWidgets(): typeof defaultDashboardWidgets {
  try {
    const value = JSON.parse(
      localStorage.getItem('scli.personalDashboard.widgets') ?? '[]',
    ) as Array<{
      id?: string;
      visible?: boolean;
    }>;
    const valid = value.filter((item) =>
      defaultDashboardWidgets.some((widget) => widget.id === item.id),
    );
    if (valid.length !== defaultDashboardWidgets.length) return defaultDashboardWidgets;
    return valid.map((item) => ({
      id: item.id as DashboardWidgetId,
      label: defaultDashboardWidgets.find((widget) => widget.id === item.id)!.label,
      visible: item.visible !== false,
    }));
  } catch {
    return defaultDashboardWidgets;
  }
}

const designStageLabels: Record<DesignStage, string> = {
  Concept: 'Concept',
  SchematicDesign: 'Schematic Design',
  DetailedDesign: 'Detailed Design',
  Tender: 'Tender',
  Construction: 'Construction',
  AsBuilt: 'As Built',
};

const needAttentionCopy: Record<'overdue' | 'revision' | 'due', { label: string; detail: string }> =
  {
    overdue: { label: 'Overdue', detail: 'Past its delivery date' },
    revision: { label: 'Revision required', detail: 'Client feedback needs design updates' },
    due: { label: 'Due soon', detail: 'Due within the next 2 days' },
  };

export function PersonalDashboardScreen() {
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpiId>('active');
  const [customizing, setCustomizing] = useState(false);
  const [widgets, setWidgets] = useState(savedDashboardWidgets);
  const saveWidgets = (next: typeof widgets) => {
    setWidgets(next);
    localStorage.setItem('scli.personalDashboard.widgets', JSON.stringify(next));
  };
  const moveWidget = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[destination]] = [next[destination]!, next[index]!];
    saveWidgets(next);
  };
  const widgetStyle = (id: DashboardWidgetId) => ({
    order: widgets.findIndex((widget) => widget.id === id),
    display: widgets.find((widget) => widget.id === id)?.visible === false ? 'none' : undefined,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', 'personal'],
    queryFn: () => api.projects(),
  });

  const projects = projectsQuery.data ?? [];
  const today = workspaceDateKey();
  const endDate = addCalendarDays(today, 7);
  const soonEndDate = addCalendarDays(today, 2);

  const view = useMemo(
    () => deriveDashboardView(projects, today, endDate, soonEndDate),
    [endDate, projects, soonEndDate, today],
  );

  const filteredActive = useMemo(
    () => activeProjectsByKpi(view.activeProjects, selectedKpi, today, endDate),
    [endDate, selectedKpi, today, view.activeProjects],
  );

  if (projectsQuery.isLoading) return <LoadingState label="Building your lighting dashboard…" />;
  if (projectsQuery.error) {
    return (
      <ErrorState
        message={(projectsQuery.error as Error).message}
        onRetry={() => projectsQuery.refetch()}
      />
    );
  }

  const emptyWorkspace = projects.length === 0;

  if (emptyWorkspace) {
    return (
      <>
        <PageHeader
          eyebrow="Dashboard"
          title="Your workspace is ready"
          description="Create your first lighting project to begin tracking work."
        />
        <EmptyState
          title="No projects yet"
          description="Create your first lighting project to begin tracking work."
          action={
            <Link className="button primary" to="/new">
              <Plus size={16} /> New Project
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Your active lighting workload and next commitments."
        description="What is moving, what is due soon, and what needs your attention right now."
        actions={
          <div className="page-header-action-group">
            <button
              className="button secondary"
              type="button"
              onClick={() => setCustomizing((value) => !value)}
            >
              <SlidersHorizontal /> Customize
            </button>
          </div>
        }
      />

      {customizing ? (
        <section className="dashboard-customizer content-card" aria-label="Customize dashboard">
          <div>
            <strong>Keep the dashboard focused</strong>
            <span>Reorder sections or hide anything you do not use. This stays on this PC.</span>
          </div>
          <div className="dashboard-customizer-list">
            {widgets.map((widget, index) => (
              <div key={widget.id}>
                <button
                  className="icon-button"
                  type="button"
                  title={widget.visible ? `Hide ${widget.label}` : `Show ${widget.label}`}
                  onClick={() =>
                    saveWidgets(
                      widgets.map((item) =>
                        item.id === widget.id ? { ...item, visible: !item.visible } : item,
                      ),
                    )
                  }
                >
                  {widget.visible ? <Eye /> : <EyeOff />}
                </button>
                <strong>{widget.label}</strong>
                <button
                  className="icon-button"
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveWidget(index, -1)}
                  title="Move up"
                >
                  <ArrowUp />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={index === widgets.length - 1}
                  onClick={() => moveWidget(index, 1)}
                  title="Move down"
                >
                  <ArrowDown />
                </button>
              </div>
            ))}
          </div>
          <button
            className="button ghost"
            type="button"
            onClick={() => saveWidgets(defaultDashboardWidgets)}
          >
            Reset layout
          </button>
        </section>
      ) : null}

      <main className="personal-dashboard-widgets">
        {/* Operational KPI band — these are filters, not decorative cards. */}
        <section className="kpi-grid four-up" aria-label="Operational overview" role="group">
          {view.kpis.map((kpi) => {
            const selected = selectedKpi === kpi.id;
            return (
              <button
                key={kpi.id}
                type="button"
                className={`kpi-card kpi-${kpi.tone} dashboard-kpi-button${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                aria-label={`${dashboardKpiLabels[kpi.id]} — ${kpi.count} project${kpi.count === 1 ? '' : 's'}${selected ? ', selected' : ''}`}
                onClick={() => setSelectedKpi(kpi.id)}
              >
                <span className="kpi-icon">
                  {kpi.id === 'active' ? (
                    <FolderKanban />
                  ) : kpi.id === 'dueThisWeek' ? (
                    <CalendarClock />
                  ) : kpi.id === 'revisionRequired' ? (
                    <Undo2 />
                  ) : (
                    <PauseCircle />
                  )}
                </span>
                <span>{dashboardKpiLabels[kpi.id]}</span>
                <strong>{kpi.count}</strong>
                <small>
                  {kpi.id === 'dueThisWeek'
                    ? 'Today through next 7 days'
                    : 'Filter active projects'}
                </small>
              </button>
            );
          })}
        </section>

        <section
          className="content-card dashboard-attention"
          aria-label="Need attention"
          style={widgetStyle('attention')}
        >
          <SectionHeading
            title="Need Attention"
            detail="Overdue first, then revisions, then upcoming work"
          />
          {view.needAttention.length ? (
            <div className="attention-list">
              {view.needAttention.slice(0, 8).map((project) => {
                const reason = needAttentionReason(project, today);
                const copy = needAttentionCopy[reason];
                return (
                  <Link to={`/projects/${project.id}`} key={project.id} className="attention-row">
                    <span
                      className={
                        reason === 'overdue' ? 'risk-marker danger' : 'risk-marker warning'
                      }
                    />
                    <div title={project.projectName}>
                      <strong>{project.projectName}</strong>
                      <span>
                        {project.projectCode} · {copy.label}
                      </span>
                    </div>
                    <StatusBadge
                      status={project.status}
                      label={personalStatusLabel(project.status)}
                    />
                    <Deadline date={project.requiredDeliveryDate} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-section-empty">
              <CheckCircle2 size={16} />
              <span>Nothing needs immediate attention.</span>
            </div>
          )}
        </section>

        <section
          className="content-card"
          aria-label="Workload snapshot"
          style={widgetStyle('workload')}
        >
          <SectionHeading title="Workload Snapshot" detail="Your active projects by status" />
          {view.workload.length ? (
            <div className="workload-strip">
              {view.workload.map((item) => (
                <div className="workload-stat" key={item.status}>
                  <StatusBadge status={item.status} label={personalStatusLabel(item.status)} />
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-section-empty">
              <CheckCircle2 size={16} />
              <span>No active projects yet.</span>
            </div>
          )}
        </section>

        <section
          className="dashboard-active-projects"
          aria-label="Active projects"
          style={widgetStyle('projects')}
        >
          <SectionHeading
            title={
              selectedKpi === 'active'
                ? 'Active Projects'
                : `Active Projects — ${dashboardKpiLabels[selectedKpi]}`
            }
            detail={
              selectedKpi === 'active'
                ? 'Everything moving through your workflow'
                : `Filtered to ${dashboardKpiLabels[selectedKpi].toLowerCase()} projects`
            }
            to="/projects"
          />
          {selectedKpi !== 'active' ? (
            <button
              className="button ghost small dashboard-filter-reset"
              type="button"
              onClick={() => setSelectedKpi('active')}
            >
              <ListRestart size={14} /> Reset to all active
            </button>
          ) : null}
          {filteredActive.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Sales Owner</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActive.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <Link
                          to={`/projects/${project.id}`}
                          className="dashboard-project-cell"
                          title={project.projectName}
                        >
                          <strong>{project.projectName}</strong>
                          <span title={project.projectCode}>{project.projectCode}</span>
                        </Link>
                      </td>
                      <td>
                        <span>{designStageLabels[project.designStage]}</span>
                      </td>
                      <td>
                        <StatusBadge
                          status={project.status}
                          label={personalStatusLabel(project.status)}
                        />
                      </td>
                      <td>
                        <Deadline date={project.requiredDeliveryDate} />
                      </td>
                      <td>
                        <strong>{project.salesOwnerNameSnapshot || 'Direct'}</strong>
                      </td>
                      <td>
                        <Link
                          className="icon-button"
                          to={`/projects/${project.id}`}
                          aria-label={`Open ${project.projectName}`}
                        >
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dashboard-section-empty">
              <CheckCircle2 size={16} />
              <span>No {dashboardKpiLabels[selectedKpi].toLowerCase()} projects right now.</span>
            </div>
          )}
        </section>

        <section
          className="content-card"
          aria-label="Waiting / External"
          style={widgetStyle('waiting')}
        >
          <SectionHeading
            title="Waiting / External"
            detail="Projects not actively progressing on your side"
          />
          {view.waitingExternal.length ? (
            <div className="attention-list">
              {view.waitingExternal.map((project) => (
                <Link to={`/projects/${project.id}`} key={project.id} className="attention-row">
                  <span className="risk-marker warning" />
                  <div title={project.projectName}>
                    <strong>{project.projectName}</strong>
                    <span>
                      {project.projectCode} · {project.clientName}
                    </span>
                  </div>
                  <StatusBadge
                    status={project.status}
                    label={personalStatusLabel(project.status)}
                  />
                  <Deadline date={project.requiredDeliveryDate} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="dashboard-section-empty">
              <CheckCircle2 size={16} />
              <span>No projects are currently waiting on external review or hold.</span>
            </div>
          )}
        </section>

        <section
          className="content-card recent-panel"
          aria-label="Recently updated projects"
          style={widgetStyle('recent')}
        >
          <SectionHeading title="Recently Updated Projects" detail="Sorted by most recent change" />
          {view.recentlyUpdated.length ? (
            <ol className="activity-compact-list">
              {view.recentlyUpdated.slice(0, 6).map((project) => (
                <li key={project.id}>
                  <span className="activity-icon">
                    <Clock3 size={14} />
                  </span>
                  <div>
                    <Link to={`/projects/${project.id}`}>{project.projectName}</Link>
                    <span>
                      {personalStatusLabel(project.status)} · Updated{' '}
                      {formatDate(project.updatedAt)}
                    </span>
                  </div>
                  <ArrowRight size={13} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="dashboard-section-empty">
              <CheckCircle2 size={16} />
              <span>Projects you update will appear here.</span>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
