import { useEffect, useMemo, useState } from 'react';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  SctSuccess as CircleCheckBig,
  SctRevisions as GitBranch,
  SctRefresh as RefreshCcw,
} from '../../components/common/SctIcons';
import {
  Activity,
  CalendarDays,
  ClipboardList,
  CheckSquare,
  Clock3,
  SlidersHorizontal,
  UsersRound,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4RevisionIcon } from '../../components/common/V4RevisionIcon';
import { V4SplitPane } from '../../components/common/V4SplitPane';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import {
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  buildTimelineEvents,
  filterTimelineEvents,
  TIMELINE_PAGE_SIZE,
  timelinePageCount,
  timelinePageEvents,
  timelineEventIconRole,
  timelineEventStatusDisplay,
  timelineEventTypeDisplay,
  type TimelineCategory,
  type TimelineEvent,
} from './workflowTimelineViewModel';

const FILTERS: Array<{ id: 'all' | TimelineCategory; label: string; icon: typeof Activity }> = [
  { id: 'all', label: 'All', icon: SlidersHorizontal },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'revision', label: 'Revisions', icon: Activity },
  { id: 'meeting', label: 'Meetings', icon: CalendarDays },
  { id: 'action', label: 'Actions', icon: CheckSquare },
];
const iconFor = (event: TimelineEvent) => {
  switch (timelineEventIconRole(event)) {
    case 'client-review':
      return UsersRound;
    case 'revision-required':
      return RefreshCcw;
    case 'revision':
      return V4RevisionIcon;
    case 'meeting':
      return CalendarDays;
    case 'action':
      return CheckSquare;
    case 'scope-update':
      return ClipboardList;
    case 'workflow':
      return GitBranch;
    case 'activity':
      return Activity;
  }
};
const isCompleted = (status: string | null) => status === 'Completed';
const date = (value: string) =>
  formatBusinessDateTime(value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

export function LegacyWorkflowTimelinePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [filter, setFilter] = useState<'all' | TimelineCategory>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const projectQuery = useQuery({
    queryKey: ['v4', 'timeline', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: !!projectId,
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'timeline', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: !!projectId,
  });
  const workflowQuery = useQuery({
    queryKey: ['v4', 'timeline', 'workflow', projectId],
    queryFn: () => api.workflowHistory(projectId as string),
    enabled: !!projectId,
  });
  const revisionsQuery = useQuery({
    queryKey: ['v4', 'timeline', 'canonical-revisions', projectId],
    queryFn: () => api.projectRevisions(projectId as string),
    enabled: !!projectId,
  });
  const events = useMemo(
    () =>
      projectQuery.data && workspaceQuery.data && workflowQuery.data && revisionsQuery.data
        ? buildTimelineEvents(
            projectQuery.data,
            workspaceQuery.data,
            workflowQuery.data,
            revisionsQuery.data,
          )
        : [],
    [projectQuery.data, revisionsQuery.data, workspaceQuery.data, workflowQuery.data],
  );
  const shown = useMemo(() => filterTimelineEvents(events, filter), [events, filter]);
  const pageCount = timelinePageCount(shown);
  const pageEvents = timelinePageEvents(shown, page);
  useEffect(() => {
    const selectedIndex = shown.findIndex((event) => event.id === selectedId);
    if (selectedIndex >= 0) {
      setPage(Math.floor(selectedIndex / TIMELINE_PAGE_SIZE));
      return;
    }
    setPage(Math.max(pageCount - 1, 0));
    setSelectedId(shown.at(-1)?.id ?? null);
  }, [pageCount, selectedId, shown]);
  const selected = pageEvents.find((event) => event.id === selectedId) ?? null;
  const selectPage = (nextPage: number) => {
    const nextEvents = timelinePageEvents(shown, nextPage);
    setPage(nextPage);
    if (!nextEvents.some((event) => event.id === selectedId)) {
      setSelectedId(nextEvents.at(-1)?.id ?? null);
    }
  };
  const toggle = () =>
    setMode((current) => {
      const next = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  const loading =
    projectQuery.isLoading ||
    workspaceQuery.isLoading ||
    workflowQuery.isLoading ||
    revisionsQuery.isLoading;
  const error =
    projectQuery.isError ||
    workspaceQuery.isError ||
    workflowQuery.isError ||
    revisionsQuery.isError;
  const retrying =
    projectQuery.isFetching ||
    workspaceQuery.isFetching ||
    workflowQuery.isFetching ||
    revisionsQuery.isFetching;
  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={toggle}
      activeSectionId="workflow"
      onSelectSection={(id) => {
        if (!projectId) return;
        if (id === 'summary') {
          navigate(generatePath(ROUTE_PROJECT_SUMMARY, { projectId }));
        }
        if (id === 'workflow') {
          navigate(generatePath(ROUTE_PROJECT_WORKFLOW_TIMELINE, { projectId }));
        }
        if (id === 'comments') {
          navigate(generatePath(ROUTE_PROJECT_COMMENTS, { projectId }));
        }
        if (id === 'datasheets') {
          navigate(generatePath(ROUTE_PROJECT_DATASHEETS_IMAGES, { projectId }));
        }
        if (id === 'technical-check') {
          navigate(generatePath(ROUTE_PROJECT_TECHNICAL_CHECK, { projectId }));
        }
        if (id === 'lighting-schedule') {
          navigate(generatePath(ROUTE_PROJECT_LUMINAIRE_SCHEDULE, { projectId }));
          return;
        }
        if (id === 'technical-boq') {
          navigate(generatePath(ROUTE_PROJECT_TECHNICAL_BOQ, { projectId }));
        }
      }}
      project={
        projectQuery.data
          ? {
              projectCode: projectQuery.data.projectCode,
              projectName: projectQuery.data.projectName,
              status: projectQuery.data.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: projectQuery.data?.projectCode ?? '',
            projectName: projectQuery.data?.projectName ?? '',
            clientName: projectQuery.data?.clientName ?? null,
            projectType: projectQuery.data?.projectType ?? null,
            designStage: projectQuery.data?.designStage ?? null,
            requiredDeliveryDate: projectQuery.data?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={projectQuery.data}
              projectQueryKey={['v4', 'timeline', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <div className="v4-timeline-page-header">
          <V4PageHeader
            icon={Activity}
            title="Workflow Timeline"
            description="Track the full project journey from kickoff to latest revision activity."
          />
        </div>
      }
    >
      <div className="v4-timeline" data-testid="v4-workflow-timeline">
        <div className="v4-timeline__filters" role="toolbar" aria-label="Timeline filters">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`v4-timeline__filter${filter === id ? ' v4-timeline__filter--active' : ''}`}
              onClick={() => setFilter(id)}
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="v4-timeline__state" aria-busy="true">
            Loading timeline…
          </div>
        ) : error ? (
          <V4RouteErrorState
            title="Unable to load workflow timeline"
            message="Workflow history and project activity could not be loaded."
            retrying={retrying}
            onRetry={() =>
              void Promise.all([
                projectQuery.refetch(),
                workspaceQuery.refetch(),
                workflowQuery.refetch(),
                revisionsQuery.refetch(),
              ])
            }
          />
        ) : (
          <>
            <V4SplitPane
              collapsed={collapsed}
              timeline={
                <section
                  className="v4-timeline__ledger v4-timeline__card"
                  aria-label="Timeline events"
                >
                  {shown.length ? (
                    <>
                      <div className="v4-timeline__events">
                        {pageEvents.map((event) => {
                          const Icon = isCompleted(event.status) ? CircleCheckBig : iconFor(event);
                          return (
                            <button
                              key={event.id}
                              type="button"
                              className={`v4-timeline__row v4-timeline__row--${event.category}${isCompleted(event.status) ? ' v4-timeline__row--completed' : ''}${selected?.id === event.id ? ' v4-timeline__row--selected' : ''}`}
                              onClick={() => {
                                setSelectedId(event.id);
                                setCollapsed(false);
                              }}
                            >
                              <span
                                className="v4-timeline__node"
                                data-event-icon={
                                  isCompleted(event.status)
                                    ? 'completed'
                                    : timelineEventIconRole(event)
                                }
                              >
                                <Icon aria-hidden="true" />
                              </span>
                              <span className="v4-timeline__row-copy">
                                <strong>{event.title}</strong>
                                {event.description ? <small>{event.description}</small> : null}
                              </span>
                              <time dateTime={event.occurredAt}>{date(event.occurredAt)}</time>
                            </button>
                          );
                        })}
                      </div>
                      <V4Pagination
                        pageCount={pageCount}
                        currentPage={page}
                        onChange={selectPage}
                        ariaLabel="Timeline pages"
                      />
                    </>
                  ) : (
                    <div className="v4-timeline__empty">
                      No {filter === 'all' ? 'timeline events' : `${filter} events`} recorded
                    </div>
                  )}
                </section>
              }
              inspector={
                <aside
                  className="v4-timeline__inspector v4-timeline__card"
                  aria-label="Event details"
                >
                  {selected ? (
                    <>
                      <header>
                        <span className="v4-timeline__inspector-icon">
                          <Clock3 />
                        </span>
                        <div>
                          <strong>{selected.title}</strong>
                          {selected.id === events.at(-1)?.id ? <small>Latest Event</small> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setCollapsed(true)}
                          aria-label="Collapse event details"
                        >
                          ×
                        </button>
                      </header>
                      <dl>
                        <div>
                          <dt>Date & Time</dt>
                          <dd>{date(selected.occurredAt)}</dd>
                        </div>
                        <div>
                          <dt>Event Type</dt>
                          <dd>{timelineEventTypeDisplay(selected.category)}</dd>
                        </div>
                        {selected.status ? (
                          <div>
                            <dt>Status</dt>
                            <dd>{timelineEventStatusDisplay(selected.status)}</dd>
                          </div>
                        ) : null}
                        {selected.canonicalLifecycleState ? (
                          <div>
                            <dt>Canonical Lifecycle</dt>
                            <dd>{timelineEventStatusDisplay(selected.canonicalLifecycleState)}</dd>
                          </div>
                        ) : null}
                        {selected.compatibilityStatus ? (
                          <div>
                            <dt>Compatibility Status</dt>
                            <dd>{timelineEventStatusDisplay(selected.compatibilityStatus)}</dd>
                          </div>
                        ) : null}
                        {selected.compatibilityIssuedAt ? (
                          <div>
                            <dt>Compatibility Issued</dt>
                            <dd>{date(selected.compatibilityIssuedAt)}</dd>
                          </div>
                        ) : null}
                        {selected.notes ? (
                          <div>
                            <dt>Notes</dt>
                            <dd>{selected.notes}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </>
                  ) : (
                    <div className="v4-timeline__empty">Select an event to view details</div>
                  )}
                </aside>
              }
            />
            {collapsed ? (
              <button
                type="button"
                className="v4-timeline__reopen"
                onClick={() => setCollapsed(false)}
              >
                Show details
              </button>
            ) : null}
          </>
        )}
      </div>
    </V4AppShell>
  );
}
