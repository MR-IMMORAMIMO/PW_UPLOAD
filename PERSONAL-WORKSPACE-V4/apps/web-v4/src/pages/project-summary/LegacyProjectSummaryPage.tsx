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
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  SctWarning as AlertTriangle,
  SctNext as ArrowRight,
  SctReports as BarChart3,
  SctDeadline as Bell,
  SctSuccess as CheckCircle2,
  SctSuccess as CircleCheckBig,
  SctFiles as FileStack,
  SctActions as ListTodo,
  SctPause as PauseCircle,
  SctRefresh as RefreshCcw,
  SctTimeline as Route,
  SctWarning as ShieldAlert,
  SctGenerate as Sparkles,
  SctError as XCircle,
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
  Send,
  Settings2,
  Target,
  TriangleAlert,
  UsersRound,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4Drawer } from '../../components/common/V4Drawer';
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
  ATTENTION_PREVIEW_CAPACITY,
  buildProjectSummaryModel,
  type ActivityCategory,
  type ActivityEvent,
  type AttentionItem,
  type NextAction,
  type ProjectSummaryModel,
  type SummaryMetric,
  type V4IconRole,
  type WorkflowCycleModel,
  type WorkflowCycleNode,
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
function HeaderIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: V4IconRole }) {
  return (
    <span className={`v4-card__header-icon v4-card__header-icon--${tone}`} aria-hidden="true">
      <Icon strokeWidth={1.75} />
    </span>
  );
}

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

function AttentionList({ items }: { items: AttentionItem[] }) {
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
            <span className="v4-summary__list-item-title">{item.message}</span>
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

const METRIC_ICONS: Record<SummaryMetric['key'], LucideIcon> = {
  luminaires: Lightbulb,
  currentRevision: FileStack,
  dueDate: CalendarDays,
  openActions: ListChecks,
};

function Metric({ metric }: { metric: SummaryMetric }) {
  const MetricIcon = metric.key === 'currentRevision' ? V4RevisionIcon : METRIC_ICONS[metric.key];
  return (
    <div
      className={`v4-summary__metric v4-summary__metric--${metric.role} v4-summary__metric--value-${metric.valueRole ?? 'neutral'}`}
      data-testid={`v4-summary-metric-${metric.key}`}
    >
      <TintedIcon
        tone="info"
        icon={MetricIcon}
        {...(metric.key === 'currentRevision' ? { className: 'v4-summary__revision-icon' } : {})}
      />
      <div className="v4-summary__metric-value">{metric.value}</div>
      <div className="v4-summary__metric-label">{metric.label}</div>
    </div>
  );
}

function NextActionCard({
  action,
  actionRef,
  disabled,
  onActivate,
}: {
  action: NextAction;
  actionRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onActivate: () => void;
}) {
  const ActionIcon = action.role === 'success' ? CircleCheckBig : Target;
  const visualRole = action.role === 'success' ? 'success' : 'info';
  const actionable = Boolean(action.targetSection || action.targetStatus);
  return (
    <div
      className={`v4-summary__next-action v4-summary__next-action--${visualRole}`}
      data-testid="v4-next-action"
    >
      <TintedIcon tone={visualRole} icon={ActionIcon} />
      <div className="v4-summary__next-action-body">
        <span className="v4-summary__next-action-title">{action.title}</span>
        {action.description ? (
          <span className="v4-summary__next-action-meta">{action.description}</span>
        ) : null}
      </div>
      {actionable ? (
        <V4Button
          ref={actionRef}
          variant="primary"
          size="compact"
          disabled={disabled}
          aria-busy={disabled || undefined}
          onClick={onActivate}
        >
          {action.title} <ArrowRight aria-hidden="true" />
        </V4Button>
      ) : null}
    </div>
  );
}

export function LegacyProjectSummaryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [attentionOpen, setAttentionOpen] = useState(false);
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

  const model = useMemo<ProjectSummaryModel | null>(() => {
    if (!projectQuery.data || !workspaceQuery.data || !workflowQuery.data || !revisionsQuery.data)
      return null;
    return buildProjectSummaryModel({
      project: projectQuery.data,
      workspace: workspaceQuery.data,
      workflow: workflowQuery.data,
      canonicalRevisions: revisionsQuery.data,
    });
  }, [projectQuery.data, revisionsQuery.data, workspaceQuery.data, workflowQuery.data]);

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

  const showAttentionViewAll = (model?.attentionAll.length ?? 0) > ATTENTION_PREVIEW_CAPACITY;
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
    if (!action.targetStatus) return;
    if (action.requiresReason) {
      setRevisionReasonOpen(true);
      setRevisionReason('');
      setRevisionReasonError(null);
      return;
    }
    statusController.changeStatus(project, action.targetStatus);
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
        <div className="v4-summary-page-header">
          <V4PageHeader icon={BarChart3} title="Project Overview" />
        </div>
      }
      boundedPage
    >
      <div className="v4-summary v4-bounded-page" data-testid="v4-project-summary">
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
              ])
            }
          />
        ) : null}

        {model ? (
          <>
            <WorkflowCycle cycle={model.workflowCycle} />

            <div className="v4-summary__row">
              <section className="v4-card" data-testid="v4-card-attention">
                <header className="v4-card__header">
                  <span className="v4-card__title-row">
                    <HeaderIcon icon={Bell} tone="info" />
                    <h3 className="v4-card__title">Need Your Attention</h3>
                  </span>
                  {showAttentionViewAll ? (
                    <button
                      type="button"
                      className="v4-card__view-all"
                      data-testid="v4-attention-view-all"
                      onClick={() => setAttentionOpen(true)}
                    >
                      View all <ArrowRight aria-hidden="true" />
                    </button>
                  ) : null}
                </header>
                <AttentionList items={model.attention} />
              </section>

              <section className="v4-card v4-card--snapshot" data-testid="v4-card-snapshot">
                <header className="v4-card__header">
                  <span className="v4-card__title-row">
                    <HeaderIcon icon={BarChart3} tone="brandTeal" />
                    <h3 className="v4-card__title">Project Snapshot</h3>
                  </span>
                </header>
                <div className="v4-summary__snapshot" data-testid="v4-snapshot-metrics">
                  {model.snapshot.metrics.map((metric) => (
                    <Metric key={metric.key} metric={metric} />
                  ))}
                </div>
              </section>
            </div>

            <div className="v4-summary__row">
              <section className="v4-card v4-card--next-action" data-testid="v4-card-next-action">
                <header className="v4-card__header">
                  <span className="v4-card__title-row">
                    <HeaderIcon icon={Target} tone="brandGold" />
                    <h3 className="v4-card__title">Next Action</h3>
                  </span>
                </header>
                <NextActionCard
                  action={model.nextAction}
                  actionRef={nextActionRef}
                  disabled={statusController.isPending}
                  onActivate={activateNextAction}
                />
              </section>

              <section className="v4-card" data-testid="v4-card-activity">
                <header className="v4-card__header">
                  <span className="v4-card__title-row">
                    <HeaderIcon icon={Activity} tone="brandPurple" />
                    <h3 className="v4-card__title">Recent Activity</h3>
                  </span>
                </header>
                <ActivityList events={model.activity} />
              </section>
            </div>

            <V4Drawer
              open={attentionOpen}
              onClose={() => setAttentionOpen(false)}
              title="Attention"
              aria-label="All attention items"
            >
              <AttentionList items={model.attentionAll} />
            </V4Drawer>
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
const WORKFLOW_STATUS_ICON: Record<string, { icon: LucideIcon; name: string }> = {
  Planning: { icon: ClipboardCheck, name: 'ClipboardCheck' },
  NewRequest: { icon: Sparkles, name: 'Sparkles' },
  UnderReview: { icon: UsersRound, name: 'UsersRound' },
  Unassigned: { icon: ListTodo, name: 'ListTodo' },
  Assigned: { icon: CheckCircle2, name: 'CheckCircle2' },
  InProgress: { icon: Settings2, name: 'Settings2' },
  ClientReview: { icon: UsersRound, name: 'UsersRound' },
  WaitingForInformation: { icon: Info, name: 'Info' },
  WaitingForSales: { icon: Info, name: 'Info' },
  InternalReview: { icon: UsersRound, name: 'UsersRound' },
  RevisionRequired: { icon: RefreshCcw, name: 'RefreshCcw' },
  ReadyToIssue: { icon: PackageCheck, name: 'PackageCheck' },
  Issued: { icon: Send, name: 'Send' },
  OnHold: { icon: PauseCircle, name: 'PauseCircle' },
  Completed: { icon: CircleCheckBig, name: 'CircleCheckBig' },
  Archived: { icon: FileStack, name: 'FileStack' },
  Cancelled: { icon: XCircle, name: 'XCircle' },
};

function WorkflowNode({ node }: { node: WorkflowCycleNode }) {
  const iconSpec = WORKFLOW_STATUS_ICON[node.key] ?? { icon: Activity, name: 'Activity' };
  const Icon = iconSpec.icon;
  return (
    <span
      className={`v4-summary__cycle-node v4-summary__cycle-node--${node.state}`}
      data-testid={`v4-stage-${node.key}`}
      data-workflow-icon={iconSpec.name}
    >
      <span className="v4-summary__cycle-icon" aria-hidden="true">
        <Icon strokeWidth={1.75} />
      </span>
      <span className="v4-summary__cycle-copy">
        <strong>{node.label}</strong>
        <small>{node.meta}</small>
      </span>
    </span>
  );
}

function WorkflowCycle({ cycle }: { cycle: WorkflowCycleModel }) {
  return (
    <section className="v4-summary__workflow-cycle" aria-label="Project workflow cycle">
      <ol className="v4-summary__cycle-main" data-testid="v4-stage-strip" aria-label="Main flow">
        {cycle.main.map((node) => (
          <li key={node.key}>
            <WorkflowNode node={node} />
          </li>
        ))}
      </ol>
      <div className="v4-summary__cycle-branches">
        <div className="v4-summary__cycle-path" data-testid="v4-revision-loop">
          <span className="v4-summary__cycle-path-label">
            <RefreshCcw aria-hidden="true" /> Revision loop
          </span>
          <span>Client Review</span>
          <ArrowRight aria-hidden="true" />
          <WorkflowNode node={cycle.revisionRequired} />
          <ArrowRight aria-hidden="true" />
          <span>In Progress</span>
          <ArrowRight aria-hidden="true" />
          <span>Client Review</span>
        </div>
        <div className="v4-summary__cycle-path" data-testid="v4-on-hold-branch">
          <span className="v4-summary__cycle-path-label">
            <PauseCircle aria-hidden="true" /> Interrupt
          </span>
          <WorkflowNode node={cycle.onHold} />
          <ArrowRight aria-hidden="true" />
          <span>
            {cycle.onHoldResumeLabel
              ? `Resume to ${cycle.onHoldResumeLabel}`
              : 'Resume to the recorded active state'}
          </span>
        </div>
        {cycle.currentOutsideCycle ? (
          <div className="v4-summary__cycle-path" data-testid="v4-outside-cycle-current">
            <span className="v4-summary__cycle-path-label">Current state</span>
            <WorkflowNode node={cycle.currentOutsideCycle} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

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
