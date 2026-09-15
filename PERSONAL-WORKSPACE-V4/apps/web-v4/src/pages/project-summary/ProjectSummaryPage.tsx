import { summaryStageDetails } from './summaryStageDetails';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { projectActivityProjection } from './projectActivityProjection';
/**
 * Project Summary page (PW-V4-F3-P1) — the FIRST real V4 Project product page.
 *
 * Owner-locked composition (H2 visual alignment):
 *   PROJECT CONTEXT HEADER (F2 shell, preserved)
 *   PROJECT OVERVIEW (page title)
 *   FULL-WIDTH CONNECTED WORKFLOW STRIP (green/blue/gray stage cards)
 *   ROW 1: Need Your Attention (43%) | Project Snapshot (57%)
 *   ROW 2: Next Action (43%)         | Recent Activity (57%)
 *
 * Read/derived only. No mutations, no Inspector, no estimated time, no dead
 * links. Colored icons are MANDATORY and use a deterministic semantic/category
 * mapping (see projectSummaryViewModel). Presentation-only workflow sequence
 * never mutates canonical history or project.status.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  SctWarning as AlertTriangle,
  SctReports as BarChart3,
  SctSuccess as CheckCircle2,
  SctFiles as FileStack,
  SctActions as ListTodo,
  SctTimeline as Route,
  SctWarning as ShieldAlert,
} from '../../components/common/SctIcons';
import { type LucideIcon } from 'lucide-react';
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  Info,
  Lightbulb,
  ListChecks,
  MessageSquare,
  PackageCheck,
  TriangleAlert,
  UsersRound,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import FinalProjectSummaryView from '../../components/final-ui/FinalProjectSummaryView';
import { summaryStageStates } from './summaryStageStates';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4Button } from '../../components/common/V4Button';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4ModalLayer } from '../../components/interaction/V4ModalLayer';
import { useProjectStatusController } from '../../components/project/useProjectStatusController';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import { V4RevisionIcon } from '../../components/common/V4RevisionIcon';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  buildProjectSummaryModel,
  recentActivity,
  type ActivityCategory,
  type ActivityEvent,
  type AttentionItem,
  type ProjectSummaryModel,
  type V4IconRole,
} from './projectSummaryViewModel';

/** Deterministic semantic role -> Lucide icon mapping (module-level static). */
const ROLE_ICONS: Record<V4IconRole, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: ShieldAlert,
  info: Info,
  brandPurple: FileStack,
  brandGold: ListTodo,
  brandTeal: Lightbulb,
  neutral: Info,
};

function TintedIcon({
  tone,
  icon: Icon,
  className,
}: {
  tone: V4IconRole;
  icon?: LucideIcon | typeof V4RevisionIcon;
  className?: string;
}) {
  // Static module-level mapping lookup (never a component defined in render).
  const Content = Icon ?? ROLE_ICONS[tone] ?? Info;
  return (
    <span
      className={`v4-icon-chip v4-icon-chip--${tone}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <Content strokeWidth={1.75} />
    </span>
  );
}

/** Small colored header icon (reference-style: next to the card title). */
/** Format an ISO timestamp for display (truthful UTC). */
function formatTimestamp(iso: string): string {
  return formatBusinessDateTime(iso, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function AttentionList({
  items,
  onOpen,
}: {
  items: AttentionItem[];
  onOpen: (section: string) => void;
}) {
  if (!items.length) {
    return (
      <p className="v4-summary__empty" data-testid="v4-attention-empty">
        No items need your attention
      </p>
    );
  }
  return (
    <ul className="v4-summary__list" data-testid="v4-attention-list">
      {items.map((item) => (
        <li key={item.id} className="v4-summary__list-item">
          <TintedIcon tone={item.role} />
          <div className="v4-summary__list-item-body">
            {item.targetSection ? (
              <button
                type="button"
                className="v4-summary__list-item-title"
                onClick={() => onOpen(item.targetSection!)}
              >
                {item.message}
              </button>
            ) : (
              <span className="v4-summary__list-item-title">{item.message}</span>
            )}
            {item.supporting ? (
              <span className="v4-summary__list-item-meta">{item.supporting}</span>
            ) : null}
          </div>
          <span className={`v4-summary__severity v4-summary__severity--${item.role}`}>
            {item.severity === 'blocking'
              ? 'Blocking'
              : item.severity === 'high'
                ? 'High'
                : item.severity === 'warning'
                  ? 'Warning'
                  : 'Info'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectSummaryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState<string | null>(null);
  const [revisionReasonOpen, setRevisionReasonOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionReasonError, setRevisionReasonError] = useState<string | null>(null);
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const revisionReasonRef = useRef<HTMLTextAreaElement>(null);
  const revisionReasonHelpId = useId();

  const projectQuery = useQuery({
    queryKey: ['v4', 'summary', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });

  const workspaceQuery = useQuery({
    queryKey: ['v4', 'summary', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });

  const workflowQuery = useQuery({
    queryKey: ['v4', 'summary', 'workflow', projectId],
    queryFn: () => api.workflowHistory(projectId as string),
    enabled: Boolean(projectId),
  });

  const revisionsQuery = useQuery({
    queryKey: ['v4', 'summary', 'canonical-revisions', projectId],
    queryFn: () => api.projectRevisions(projectId as string),
    enabled: Boolean(projectId),
  });

  const auditQuery = useQuery({
    queryKey: ['v4', 'summary', 'audit', projectId],
    queryFn: () => api.activities(projectId as string),
    enabled: Boolean(projectId),
  });
  const mergedWorkspace = useMemo(
    () =>
      workspaceQuery.data
        ? {
            ...workspaceQuery.data,
            activity: projectActivityProjection(
              projectId ?? '',
              workspaceQuery.data.activity,
              Array.isArray(auditQuery.data) ? auditQuery.data : [],
            ),
          }
        : undefined,
    [workspaceQuery.data, auditQuery.data, projectId],
  );
  const model = useMemo<ProjectSummaryModel | null>(() => {
    if (!projectQuery.data || !workspaceQuery.data || !workflowQuery.data || !revisionsQuery.data)
      return null;
    return buildProjectSummaryModel({
      project: projectQuery.data,
      workspace: mergedWorkspace ?? workspaceQuery.data,
      workflow: workflowQuery.data,
      canonicalRevisions: revisionsQuery.data,
    });
  }, [
    projectQuery.data,
    revisionsQuery.data,
    workspaceQuery.data,
    workflowQuery.data,
    mergedWorkspace,
  ]);

  const project = projectQuery.data;
  const statusController = useProjectStatusController({
    onSuccess: () => {
      setRevisionReasonOpen(false);
      setRevisionReason('');
      setRevisionReasonError(null);
    },
  });

  // The browser document is the shell scroll surface. Reset only when the
  // Summary route's project identity changes so a newly opened project never
  // inherits a previous route's vertical position.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [projectId]);

  const handleToggleMode = () => {
    setMode((current) => {
      const next: SidebarMode = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  };

  const loading =
    projectQuery.isLoading ||
    workspaceQuery.isLoading ||
    workflowQuery.isLoading ||
    revisionsQuery.isLoading ||
    auditQuery.isLoading;
  const error =
    projectQuery.isError ||
    workspaceQuery.isError ||
    workflowQuery.isError ||
    revisionsQuery.isError ||
    auditQuery.isError;
  const retrying =
    projectQuery.isFetching ||
    workspaceQuery.isFetching ||
    workflowQuery.isFetching ||
    revisionsQuery.isFetching ||
    auditQuery.isFetching;

  const activateNextAction = () => {
    if (!projectId || !project || !model) return;
    const action = model.nextAction;
    const routeBySection: Record<string, string> = {
      actions: ROUTE_PROJECT_ACTIONS,
      'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
      'workflow-timeline': ROUTE_PROJECT_WORKFLOW_TIMELINE,
    };
    const targetRoute = action.targetSection ? routeBySection[action.targetSection] : undefined;
    if (targetRoute) {
      navigate(generatePath(targetRoute, { projectId }));
      return;
    }
    if (project.status === 'Planning' && action.targetStatus === 'InProgress') {
      statusController.changeStatus(project, 'InProgress');
      return;
    }
    // Guidance opens the work area. Lifecycle changes remain explicit actions.
    if (action.targetStatus) navigate(generatePath(ROUTE_PROJECT_WORKFLOW_TIMELINE, { projectId }));
  };

  const confirmRevisionRequired = () => {
    const reason = revisionReason.trim();
    if (!project || !reason) {
      setRevisionReasonError('Reason is required.');
      revisionReasonRef.current?.focus();
      return;
    }
    statusController.changeStatus(project, 'RevisionRequired', reason);
  };

  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={handleToggleMode}
      activeSectionId="summary"
      onSelectSection={(id) => {
        if (id === 'lighting-schedule' && projectId) {
          navigate(generatePath(ROUTE_PROJECT_LUMINAIRE_SCHEDULE, { projectId }));
          return;
        }
        if (id === 'technical-boq' && projectId) {
          navigate(generatePath(ROUTE_PROJECT_TECHNICAL_BOQ, { projectId }));
        }
      }}
      project={
        project
          ? {
              projectCode: project.projectCode,
              projectName: project.projectName,
              status: project.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: project?.projectCode ?? '',
            projectName: project?.projectName ?? '',
            clientName: project?.clientName ?? null,
            projectType: project?.projectType ?? null,
            designStage: project?.designStage ?? null,
            requiredDeliveryDate: project?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={project}
              projectQueryKey={['v4', 'summary', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <div className="v4-summary-page-header" hidden={Boolean(model)}>
          <V4PageHeader icon={BarChart3} title="Project Overview" />
        </div>
      }
      boundedPage
    >
      <div
        className="v4-bounded-page"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        data-testid="v4-project-summary"
      >
        {loading && !model ? <SummarySkeleton /> : null}

        {!loading && error ? (
          <V4RouteErrorState
            title="Unable to load project summary"
            message="Project overview data could not be loaded."
            retrying={retrying}
            onRetry={() =>
              void Promise.all([
                projectQuery.refetch(),
                workspaceQuery.refetch(),
                workflowQuery.refetch(),
                revisionsQuery.refetch(),
                auditQuery.refetch(),
              ])
            }
          />
        ) : null}

        {model ? (
          <>
            <FinalProjectSummaryView
              binding={{
                project: project!,
                model,
                stages: summaryStageStates(project!.status, workflowQuery.data!.transitions),
                pending: statusController.isPending,
                next: activateNextAction,
                openStage: setStageOpen,
                lastUpdatedActor:
                  [...(Array.isArray(auditQuery.data) ? auditQuery.data : [])]
                    .filter((item) => item.createdAt === project!.updatedAt)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
                    ?.changedByNameSnapshot ??
                  model.activity.find((item) => item.timestamp === project!.updatedAt)?.actor ??
                  null,
                openAttention: () => setAttentionOpen(true),
                openActivity: () => setActivityOpen(true),
                openSection: (section) => navigate(`/projects/${projectId}/${section}`),
              }}
            />
            {stageOpen && summaryStageDetails[stageOpen] && (
              <V4FloatingWorkspace
                open
                title={summaryStageDetails[stageOpen].title}
                onRequestClose={() => setStageOpen(null)}
                panelClassName="v4-editor-float"
                footer={
                  <>
                    <V4Button onClick={() => setStageOpen(null)}>Close</V4Button>
                    <V4Button
                      variant="primary"
                      onClick={() =>
                        navigate(
                          `/projects/${projectId}/${summaryStageDetails[stageOpen]!.section}`,
                        )
                      }
                    >
                      Open {summaryStageDetails[stageOpen].destination}
                    </V4Button>
                  </>
                }
              >
                <p>
                  Status:{' '}
                  {summaryStageStates(project!.status, workflowQuery.data!.transitions)[
                    stageOpen
                  ] ?? 'pending'}
                </p>
                <p>{summaryStageDetails[stageOpen].description}</p>
              </V4FloatingWorkspace>
            )}
            <V4FloatingWorkspace
              open={activityOpen}
              onRequestClose={() => setActivityOpen(false)}
              footer={<V4Button onClick={() => setActivityOpen(false)}>Close</V4Button>}
              title="Recent Activity"
            >
              <ActivityList
                events={recentActivity(mergedWorkspace!.activity, mergedWorkspace!.activity.length)}
              />
            </V4FloatingWorkspace>
            <V4FloatingWorkspace
              open={attentionOpen}
              onRequestClose={() => setAttentionOpen(false)}
              footer={<V4Button onClick={() => setAttentionOpen(false)}>Close</V4Button>}
              title="Attention"
              ariaLabel="All attention items"
            >
              <AttentionList
                items={model.attentionAll}
                onOpen={(section) => navigate(`/projects/${projectId}/${section}`)}
              />
            </V4FloatingWorkspace>
          </>
        ) : null}
      </div>
      <V4ModalLayer
        open={revisionReasonOpen}
        kind="nested-dialog"
        dismissible={!statusController.isPending}
        className="v4-confirm-dialog__layer"
        backdropClassName="v4-confirm-dialog__backdrop"
        panelClassName="v4-confirm-dialog v4-status-reason-dialog"
        initialFocusRef={revisionReasonRef}
        returnFocusRef={nextActionRef}
        onRequestClose={() => {
          if (!statusController.isPending) setRevisionReasonOpen(false);
        }}
        role="dialog"
        ariaLabel="Revision Required"
        ariaDescribedBy={revisionReasonHelpId}
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            confirmRevisionRequired();
          }}
        >
          <h3>Revision Required</h3>
          <p id={revisionReasonHelpId}>
            Capture why the client review needs another revision before changing status.
          </p>
          <label className="v4-status-reason-dialog__field">
            <span>Reason</span>
            <textarea
              ref={revisionReasonRef}
              required
              maxLength={500}
              value={revisionReason}
              disabled={statusController.isPending}
              aria-invalid={Boolean(revisionReasonError)}
              onChange={(event) => {
                setRevisionReason(event.target.value);
                setRevisionReasonError(null);
              }}
            />
          </label>
          {revisionReasonError ? (
            <p role="alert" className="v4-status-reason-dialog__error">
              {revisionReasonError}
            </p>
          ) : null}
          {statusController.error ? (
            <p role="alert" className="v4-status-reason-dialog__error">
              {statusController.error instanceof Error
                ? statusController.error.message
                : 'The status change was rejected.'}
            </p>
          ) : null}
          <div className="v4-confirm-dialog__actions">
            <V4Button
              variant="secondary"
              disabled={statusController.isPending}
              onClick={() => setRevisionReasonOpen(false)}
            >
              Keep Current Status
            </V4Button>
            <V4Button type="submit" variant="primary" disabled={statusController.isPending}>
              Confirm Revision Required
            </V4Button>
          </div>
        </form>
      </V4ModalLayer>
    </V4AppShell>
  );
}

/** Deterministic activity-category -> distinct icon mapping (owner requirement). */
const ACTIVITY_CATEGORY_ICON: Record<ActivityCategory, { icon: LucideIcon; name: string }> = {
  revision: { icon: FileStack, name: 'FileStack' },
  meeting: { icon: CalendarDays, name: 'CalendarDays' },
  action: { icon: ListChecks, name: 'ListChecks' },
  issue: { icon: TriangleAlert, name: 'TriangleAlert' },
  comment: { icon: MessageSquare, name: 'MessageSquare' },
  review: { icon: UsersRound, name: 'UsersRound' },
  luminaire: { icon: Lightbulb, name: 'Lightbulb' },
  technical: { icon: ClipboardCheck, name: 'ClipboardCheck' },
  package: { icon: PackageCheck, name: 'PackageCheck' },
  status: { icon: Route, name: 'Route' },
  unknown: { icon: Activity, name: 'Activity' },
};

function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (!events.length) {
    return (
      <p className="v4-summary__empty" data-testid="v4-activity-empty">
        No recent activity
      </p>
    );
  }
  return (
    <ul className="v4-summary__list" data-testid="v4-activity-list">
      {events.map((event) => (
        <li
          key={event.id}
          className="v4-summary__activity-item"
          data-activity-category={event.category}
          data-activity-icon={ACTIVITY_CATEGORY_ICON[event.category].name}
        >
          <TintedIcon tone={event.role} icon={ACTIVITY_CATEGORY_ICON[event.category].icon} />
          <div className="v4-summary__activity-body">
            <span className="v4-summary__activity-title">{event.title}</span>
            {event.description ? (
              <span className="v4-summary__activity-desc">{event.description}</span>
            ) : null}
          </div>
          <time className="v4-summary__activity-time" dateTime={event.timestamp}>
            {formatTimestamp(event.timestamp)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** Deterministic workflow status -> distinct icon mapping (owner requirement). */
function SummarySkeleton() {
  return (
    <div className="v4-summary__skeleton" data-testid="v4-summary-skeleton" aria-busy="true">
      <div className="v4-summary__skeleton-strip" />
      <div className="v4-summary__row">
        <div className="v4-card v4-skeleton-card" />
        <div className="v4-card v4-skeleton-card" />
      </div>
      <div className="v4-summary__row">
        <div className="v4-card v4-skeleton-card" />
        <div className="v4-card v4-skeleton-card" />
      </div>
    </div>
  );
}
