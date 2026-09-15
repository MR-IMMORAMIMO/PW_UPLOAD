import type { ProjectActivityView } from './projectActivityProjection';
import { activityOperation } from './activityPresentation';
/**
 * Project Summary view-model (PW-V4-F3-P1).
 *
 * PURE, framework-agnostic derivation layer for the Project Summary page. It
 * has NO React imports and never touches persistence. It derives presentation
 * truth from the canonical data the route loads (Project, ProjectWorkspace,
 * WorkflowHistoryResponse) using deterministic rules only — never AI, never
 * arbitrary ordering, never fabricated values.
 *
 * Data sources (all canonical, read-only):
 *   - Project               api.project(id)
 *   - ProjectWorkspace      api.projectWorkspace(id)  (luminaires, actions,
 *                             reviewItems, activity, health)
 *   - WorkflowHistory       api.workflowHistory(id)   (transitions)
 *   - CanonicalRevision[]   api.projectRevisions(id)  (Revision authority)
 *
 * The model keeps the four Summary cards honest:
 *   - Attention      deterministic ranked candidates (bounded preview 4)
 *   - Snapshot       4 canonical metrics
 *   - Next Action    one deterministic focus
 *   - Recent Activity latest 4 canonical activity events
 */
import type { CanonicalRevisionRecord, Project, ProjectStatus } from '@scli/domain';
import type { ProjectActionItem, ProjectWorkspace } from '@scli/domain';
import type { WorkflowHistoryResponse } from '@scli/contracts';
import { deriveDueState } from '../../components/project/dueState';
import { formatProjectStatus } from '../../components/project/statusDisplay';
import { businessTodayKey, formatBusinessDateOnly } from '../../date-time/businessDateTime';

/* ---------------------------------------------------------------------------
 * Semantic roles for the colored-icon grammar
 * ------------------------------------------------------------------------- */

/** Semantic color roles the page maps to tinted icon containers. */
export type V4IconRole =
  'success' | 'warning' | 'danger' | 'info' | 'brandTeal' | 'brandPurple' | 'brandGold' | 'neutral';

/**
 * Deterministic semantic -> brand mapping for the four Snapshot metrics.
 * (The page applies the actual color/tint via CSS; the model fixes the role.)
 */
export const SNAPSHOT_METRIC_ROLE: Record<SummaryMetricKey, V4IconRole> = {
  luminaires: 'info',
  currentRevision: 'info',
  dueDate: 'info',
  openActions: 'info',
};

/* ---------------------------------------------------------------------------
 * Snapshot
 * ------------------------------------------------------------------------- */

export type SummaryMetricKey = 'luminaires' | 'currentRevision' | 'dueDate' | 'openActions';

export interface SummaryMetric {
  key: SummaryMetricKey;
  label: string;
  value: string;
  role: V4IconRole;
  /** The date value alone carries canonical due-state emphasis. */
  valueRole?: 'neutral' | 'warning' | 'danger';
  /** Canonical underlying count when the metric is numeric (for determinism). */
  count: number | null;
}

/** Open action statuses per canonical workspace-item semantics. */
const OPEN_ACTION_STATUSES: ReadonlySet<string> = new Set(['Open', 'InProgress', 'Waiting']);

export function isOpenAction(action: ProjectActionItem): boolean {
  return OPEN_ACTION_STATUSES.has(action.status);
}

/** Current Revision: the highest existing canonical revisionSequence. */
export function latestRevision(
  revisions: readonly CanonicalRevisionRecord[],
): CanonicalRevisionRecord | null {
  if (!revisions.length) return null;
  return revisions.reduce((latest, candidate) =>
    candidate.revisionSequence > latest.revisionSequence ? candidate : latest,
  );
}

export interface SummarySnapshot {
  luminaireCount: number;
  currentRevisionLabel: string;
  dueDate: string | null;
  dueState: 'neutral' | 'soon' | 'overdue';
  openActionsCount: number;
  metrics: SummaryMetric[];
}

/** Format a canonical ISO due date for display (truthful; no fabrication). */
export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return (
    formatBusinessDateOnly(iso.slice(0, 10), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) || '—'
  );
}

/* ---------------------------------------------------------------------------
 * Attention
 * ------------------------------------------------------------------------- */

export type AttentionSeverity = 'blocking' | 'high' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  message: string;
  supporting: string | null;
  severity: AttentionSeverity;
  role: V4IconRole;
  /** Valid destination section id ONLY when the route is implemented. */
  targetSection: string | null;
}

/** Default preview capacity for the Attention card. */
export const ATTENTION_PREVIEW_CAPACITY = 4;

/**
 * Grammatical singular/plural helper for production attention copy.
 * e.g. "1 luminaire has no datasheet" vs "2 luminaires have no datasheet".
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Correct legacy health-check grammar in this presentation layer without
 * changing the canonical health authority or its persisted/API shape.
 */
function healthCheckDetail(
  checkKey: string,
  fallback: string,
  workspace: ProjectWorkspace,
): string {
  if (checkKey === 'datasheets') {
    const count = workspace.luminaires.filter((item) => !item.datasheetPath.trim()).length;
    if (count > 0) {
      return `${count} ${pluralize(count, 'luminaire has', 'luminaires have')} no datasheet.`;
    }
  }

  if (checkKey === 'specification') {
    const count = workspace.luminaires.filter(
      (item) => !item.manufacturer.trim() || !item.model.trim(),
    ).length;
    if (count > 0) {
      return `${count} ${pluralize(count, 'luminaire is', 'luminaires are')} missing manufacturer or model.`;
    }
  }

  return fallback;
}

/**
 * Deterministic rank weight: lower wins.
 *   blocking/critical -> overdue high -> other overdue -> warning -> info
 */
function severityWeight(severity: AttentionSeverity): number {
  switch (severity) {
    case 'blocking':
      return 0;
    case 'high':
      return 1;
    case 'warning':
      return 2;
    case 'info':
      return 3;
  }
}

/**
 * Deterministic attention ordering. Items are never AI-chosen; this is a pure
 * comparator over canonical state.
 */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const w = severityWeight(a.severity) - severityWeight(b.severity);
    if (w !== 0) return w;
    // Stable tiebreak by id so identical severities always sort deterministically.
    return a.id.localeCompare(b.id);
  });
}

/* ---------------------------------------------------------------------------
 * Stage strip
 * ------------------------------------------------------------------------- */

export interface StageStripNode {
  key: string;
  label: string;
  state: 'completed' | 'current' | 'pending';
  /** Truthful secondary line for the compact presentation node. */
  meta: 'Completed' | 'Previously' | 'Current' | 'Pending';
}

export type WorkflowCycleNodeState = 'historical' | 'current' | 'pending';

export interface WorkflowCycleNode {
  key: ProjectStatus;
  label: string;
  state: WorkflowCycleNodeState;
  meta: string;
}

export interface WorkflowCycleModel {
  main: WorkflowCycleNode[];
  revisionRequired: WorkflowCycleNode;
  onHold: WorkflowCycleNode;
  onHoldResumeLabel: string | null;
  currentOutsideCycle: WorkflowCycleNode | null;
}

/**
 * PRESENTATION-ONLY ordered workflow display sequence over canonical
 * ProjectStatus values (owner-approved for the Summary visual grammar). This is
 * NOT database/domain/backend authority — canonical history and project.status
 * are never mutated.
 *
 * The normal forward workflow excludes non-forward / optional side states that
 * are not truthful future milestones (Cancelled, OnHold, Archived, and the
 * pre-assignment request states) unless they were actually visited or are the
 * current status — they are then shown truthfully.
 */
export const PROJECT_LIFECYCLE_SEQUENCE: readonly ProjectStatus[] = [
  'InProgress',
  'OnHold',
  'ClientReview',
  'RevisionRequired',
  'ReadyToIssue',
  'Issued',
  'Completed',
];

const SUMMARY_WORKFLOW_SEQUENCE: readonly ProjectStatus[] = PROJECT_LIFECYCLE_SEQUENCE.filter(
  (status) => status !== 'OnHold',
);

export const SUMMARY_MAIN_WORKFLOW_SEQUENCE: readonly ProjectStatus[] = [
  'InProgress',
  'ClientReview',
  'ReadyToIssue',
  'Issued',
  'Completed',
];

const SUMMARY_WORKFLOW_STATUSES: ReadonlySet<string> = new Set([
  'Planning',
  ...SUMMARY_WORKFLOW_SEQUENCE,
]);

/** Human-readable label for a workflow status (never the raw enum in UI). */
export function workflowLabel(status: string): string {
  return formatProjectStatus(status);
}

/** Build the truthful visited progression from recorded history (deduplicated, first-occurrence). */
function visitedStatuses(transitions: WorkflowHistoryResponse['transitions']): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const transition of transitions) {
    if (!seen.has(transition.toStatus)) {
      seen.add(transition.toStatus);
      ordered.push(transition.toStatus);
    }
  }
  return ordered;
}

/**
 * Build the owner-facing workflow cycle without treating a revision loop or an
 * On Hold interruption as a linear completed milestone. Only structured
 * workflow history can mark a node historical; project.status alone marks the
 * single current node.
 */
export function buildWorkflowCycle(
  project: Pick<Project, 'status' | 'statusBeforeHold'>,
  transitions: WorkflowHistoryResponse['transitions'],
): WorkflowCycleModel {
  const visited = new Set(visitedStatuses(transitions));
  const node = (status: ProjectStatus, pendingMeta: string): WorkflowCycleNode => ({
    key: status,
    label: workflowLabel(status),
    state: project.status === status ? 'current' : visited.has(status) ? 'historical' : 'pending',
    meta:
      project.status === status
        ? 'Current'
        : visited.has(status)
          ? 'Previously visited'
          : pendingMeta,
  });

  const cycleStatuses = new Set<ProjectStatus>([
    ...SUMMARY_MAIN_WORKFLOW_SEQUENCE,
    'RevisionRequired',
    'OnHold',
  ]);

  return {
    main: SUMMARY_MAIN_WORKFLOW_SEQUENCE.map((status) => node(status, 'Main flow')),
    revisionRequired: node('RevisionRequired', 'Feedback loop'),
    onHold: node('OnHold', 'Interrupt branch'),
    onHoldResumeLabel:
      project.status === 'OnHold' ? workflowLabel(project.statusBeforeHold ?? 'InProgress') : null,
    currentOutsideCycle: cycleStatuses.has(project.status)
      ? null
      : {
          key: project.status,
          label: workflowLabel(project.status),
          state: 'current',
          meta: 'Current outside primary cycle',
        },
  };
}

/**
 * Build the Summary workflow strip as [visited][visited] → [CURRENT] → [pending].
 *
 * - visited historical nodes: recorded transitions, deduplicated, chronological
 *   first-occurrence, EXCLUDING project.status (shown before Current)
 * - current node: canonical project.status, exactly once, BLUE
 * - pending nodes: canonical forward-workflow statuses not yet visited and not
 *   current, EXCLUDING non-forward exceptional states (gray)
 * - non-forward/visited exceptional states (e.g. OnHold, Cancelled) are shown
 *   truthfully when visited or current, never fabricated as pending
 */
export function buildStageStrip(
  projectStatus: Project['status'] | undefined,
  transitions: WorkflowHistoryResponse['transitions'],
): StageStripNode[] {
  const visited = visitedStatuses(transitions);
  const visitedSet = new Set(visited);

  // Historical visited nodes before current (exclude the current status).
  const historical = visited
    .filter((status) => status !== projectStatus)
    .map((status) => ({
      key: status,
      label: workflowLabel(status),
      state: 'completed' as const,
      meta: SUMMARY_WORKFLOW_STATUSES.has(status)
        ? ('Completed' as const)
        : ('Previously' as const),
    }));

  // Current node (only when a project.status exists).
  const current = projectStatus
    ? [
        {
          key: projectStatus,
          label: workflowLabel(projectStatus),
          state: 'current' as const,
          meta: 'Current' as const,
        },
      ]
    : [];

  // Pending forward statuses AFTER current in the presentation sequence: future
  // milestones not yet visited and not current. Non-forward exceptional states
  // (NON_FORWARD_STATUSES) are NEVER fabricated as pending milestones — they
  // are only shown truthfully when visited or current (handled above).
  const currentIndex = projectStatus ? SUMMARY_WORKFLOW_SEQUENCE.indexOf(projectStatus) : -1;
  const pending = SUMMARY_WORKFLOW_SEQUENCE.filter((status, index) => {
    if (status === projectStatus) return false;
    if (visitedSet.has(status)) return false;
    // Only forward statuses that come AFTER the current status are truthful
    // pending milestones; earlier unvisited statuses are not shown.
    return currentIndex >= 0 && index > currentIndex;
  }).map((status) => ({
    key: status,
    label: workflowLabel(status),
    state: 'pending' as const,
    meta: 'Pending' as const,
  }));

  if (!projectStatus && !historical.length) {
    // No current status and no history: truthful empty strip.
    return [];
  }

  return [...historical, ...current, ...pending];
}

/* ---------------------------------------------------------------------------
 * Next action
 * ------------------------------------------------------------------------- */

export interface NextAction {
  title: string;
  description: string | null;
  role: V4IconRole;
  severity: AttentionSeverity | null;
  /** Valid destination section id ONLY when the route is implemented. */
  targetSection: string | null;
  /** Existing lifecycle action when guidance should perform a status transition. */
  targetStatus: ProjectStatus | null;
  /** Specialized Revision Required transition must capture an owner reason. */
  requiresReason: boolean;
  /** Never an estimated duration (no canonical duration authority in P1). */
}

/**
 * Deterministic next-action resolver.
 *
 * Conceptual precedence (refined to canonical types present in this domain):
 *   1. blocking technical/integrity condition (health checks)
 *   2. overdue high-priority action
 *   3. overdue action
 *   4. open high-priority action
 *   5. canonical status guidance or a truthful review route
 */
export function resolveNextAction(input: {
  project: Pick<Project, 'status' | 'statusBeforeHold'>;
  workspace: ProjectWorkspace;
  now: Date;
}): NextAction {
  const { project, workspace, now } = input;

  if (project.status === 'Planning')
    return {
      title: 'Start Project',
      description:
        'Start delivery and record the start date if it is not already set. Work sessions are started separately.',
      role: 'brandTeal',
      severity: null,
      targetSection: null,
      targetStatus: 'InProgress',
      requiresReason: false,
    };

  // 1. Blocking health checks (technical/integrity).
  const blockingCheck = workspace.health.checks.find(
    (check) => check.severity === 'Blocking' && !check.passed,
  );
  if (blockingCheck) {
    return {
      title: blockingCheck.label,
      description: blockingCheck.detail || null,
      role: 'danger',
      severity: 'blocking',
      targetSection: 'technical-check',
      targetStatus: null,
      requiresReason: false,
    };
  }

  const today = businessTodayKey(now);
  const overdue = workspace.actions.filter(
    (a) => isOpenAction(a) && a.dueDate !== null && a.dueDate < today,
  );
  const highOverdue = overdue.filter((a) => a.priority === 'Urgent' || a.priority === 'High');
  const openHigh = workspace.actions.filter(
    (a) => isOpenAction(a) && (a.priority === 'Urgent' || a.priority === 'High'),
  );

  // 2. Overdue high-priority action.
  const candidate = highOverdue[0] ?? overdue[0] ?? openHigh[0];
  if (candidate) {
    return {
      title: candidate.title,
      description: candidate.details || null,
      role: highOverdue.includes(candidate) || overdue.includes(candidate) ? 'danger' : 'brandGold',
      severity: highOverdue.includes(candidate) || overdue.includes(candidate) ? 'high' : 'info',
      targetSection: 'actions',
      targetStatus: null,
      requiresReason: false,
    };
  }

  const statusGuidance: Partial<Record<ProjectStatus, NextAction>> = {
    Planning: {
      title: 'Start Project',
      description: 'Move the project into active delivery.',
      role: 'brandTeal',
      severity: null,
      targetSection: null,
      targetStatus: 'InProgress',
      requiresReason: false,
    },
    InProgress: {
      title: 'Review delivery readiness',
      description:
        'Review technical information and outstanding requirements before continuing to client review.',
      role: 'brandTeal',
      severity: null,
      targetSection: 'technical-check',
      targetStatus: null,
      requiresReason: false,
    },
    ClientReview: {
      title: 'Revision Required',
      description: 'Capture the client feedback reason and begin another revision cycle.',
      role: 'brandGold',
      severity: null,
      targetSection: null,
      targetStatus: 'RevisionRequired',
      requiresReason: true,
    },
    RevisionRequired: {
      title: 'Start Revision',
      description: 'Return the project to active work for the requested changes.',
      role: 'brandPurple',
      severity: null,
      targetSection: null,
      targetStatus: 'InProgress',
      requiresReason: false,
    },
    OnHold: {
      title: `Resume ${formatProjectStatus(project.statusBeforeHold ?? 'InProgress')}`,
      description: 'Resume the recorded workflow state from before the hold.',
      role: 'brandTeal',
      severity: null,
      targetSection: null,
      targetStatus: project.statusBeforeHold ?? 'InProgress',
      requiresReason: false,
    },
    ReadyToIssue: {
      title: 'Issue Project',
      description: 'Record the approved project as issued.',
      role: 'brandTeal',
      severity: null,
      targetSection: null,
      targetStatus: 'Issued',
      requiresReason: false,
    },
    Issued: {
      title: 'Complete Project',
      description: 'Close delivery after the issued work is complete.',
      role: 'success',
      severity: null,
      targetSection: null,
      targetStatus: 'Completed',
      requiresReason: false,
    },
    Completed: {
      title: 'No further action required',
      description: 'This project is complete.',
      role: 'success',
      severity: null,
      targetSection: null,
      targetStatus: null,
      requiresReason: false,
    },
  };

  return (
    statusGuidance[project.status] ?? {
      title: 'Review Project Workflow',
      description: `Confirm the next valid step from ${formatProjectStatus(project.status)}.`,
      role: 'info',
      severity: null,
      targetSection: 'workflow-timeline',
      targetStatus: null,
      requiresReason: false,
    }
  );
}

/* ---------------------------------------------------------------------------
 * Recent activity
 * ------------------------------------------------------------------------- */

export const RECENT_ACTIVITY_CAPACITY = 4;

export interface ActivityEvent {
  id: string;
  title: string;
  description: string | null;
  timestamp: string;
  role: V4IconRole;
  /** Presentation category key used to pick a distinct icon (deterministic). */
  category: ActivityCategory;
  /** Actor display name when canonical data provides it; otherwise null. */
  actor: string | null;
  operation?: ReturnType<typeof activityOperation>;
}

/** Deterministic activity-category keys driving distinct icons/colors. */
export type ActivityCategory =
  | 'revision'
  | 'meeting'
  | 'action'
  | 'issue'
  | 'comment'
  | 'review'
  | 'luminaire'
  | 'technical'
  | 'package'
  | 'status'
  | 'unknown';

/**
 * Conservative PRESENTATION classifier over the canonical WorkspaceActivity
 * entityType/action/title fields. There is NO structured category field in the
 * canonical shape, so this is a presentation fallback that never fabricates
 * meaning — unknown/ambiguous activity falls back to `unknown`.
 */
export function classifyActivity(
  entityType: string,
  action: string,
  title: string,
): ActivityCategory {
  const hay = `${entityType} ${action} ${title}`.toLowerCase();
  if (/(revision|revision cycle)/.test(hay)) return 'revision';
  if (/(meeting|minutes)/.test(hay)) return 'meeting';
  if (/(action|task)/.test(hay)) return 'action';
  if (/(issue|warning|error|problem)/.test(hay)) return 'issue';
  if (/(comment|message|conversation)/.test(hay)) return 'comment';
  if (/(review|client review)/.test(hay)) return 'review';
  if (/(luminaire)/.test(hay)) return 'luminaire';
  if (/(technical|quality check|datasheet)/.test(hay)) return 'technical';
  if (/(package|output|submission|transmittal)/.test(hay)) return 'package';
  if (/(status|workflow|transition)/.test(hay)) return 'status';
  return 'unknown';
}

/** Deterministic category -> role mapping for Recent Activity. */
export function activityCategoryRole(category: ActivityCategory): V4IconRole {
  switch (category) {
    case 'revision':
    case 'review':
    case 'package':
      return 'brandPurple';
    case 'meeting':
    case 'status':
      return 'info';
    case 'action':
    case 'comment':
      return 'brandGold';
    case 'issue':
      return 'danger';
    case 'luminaire':
    case 'technical':
      return 'brandTeal';
    default:
      return 'info';
  }
}

/**
 * Deterministic event-category -> role mapping for Recent Activity. One mapping,
 * never per-row random colors. Preserved for compatibility; category-driven
 * mapping above is the primary authority.
 */
export function activityRole(entityType: string): V4IconRole {
  return activityCategoryRole(classifyActivity(entityType, '', ''));
}

/** Latest `capacity` activity events, newest first (deterministic). */
export function recentActivity(
  activity: ProjectActivityView[],
  capacity = RECENT_ACTIVITY_CAPACITY,
): ActivityEvent[] {
  const sorted = [...activity].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
  return sorted.slice(0, capacity).map((event) => {
    const category = classifyActivity(event.entityType, event.action, event.title);
    return {
      id: event.id,
      title: event.title || event.action,
      description: event.detail || null,
      timestamp: event.createdAt,
      role: activityCategoryRole(category),
      category,
      actor: event.actorName || null,
      operation: activityOperation(event.action),
    };
  });
}

/* ---------------------------------------------------------------------------
 * Page aggregate
 * ------------------------------------------------------------------------- */

export interface ProjectSummaryModel {
  snapshot: SummarySnapshot;
  attention: AttentionItem[];
  /** Full attention collection (for the View-all drawer). */
  attentionAll: AttentionItem[];
  nextAction: NextAction;
  activity: ActivityEvent[];
  stageStrip: StageStripNode[];
  workflowCycle: WorkflowCycleModel;
}

export interface SummaryInput {
  project: Project;
  workspace: ProjectWorkspace;
  workflow: WorkflowHistoryResponse;
  canonicalRevisions: readonly CanonicalRevisionRecord[];
  now?: Date;
}

/** Derive the full Summary presentation model from canonical inputs. */
export function buildProjectSummaryModel(input: SummaryInput): ProjectSummaryModel {
  const now = input.now ?? new Date();
  const workspace = input.workspace;
  const project = input.project;

  const openActions = workspace.actions.filter(isOpenAction);
  const rev = latestRevision(input.canonicalRevisions);
  const dueState = deriveDueState(project.requiredDeliveryDate, now);
  const currentRevisionLabel = rev?.revisionLabel ?? 'No revision';

  const snapshot: SummarySnapshot = {
    luminaireCount: workspace.luminaires.length,
    currentRevisionLabel,
    dueDate: project.requiredDeliveryDate || null,
    dueState,
    openActionsCount: openActions.length,
    metrics: [
      {
        key: 'luminaires',
        label: 'Luminaires',
        value: String(workspace.luminaires.length),
        role: SNAPSHOT_METRIC_ROLE.luminaires,
        count: workspace.luminaires.length,
      },
      {
        key: 'currentRevision',
        label: 'Current Revision',
        value: currentRevisionLabel,
        role: SNAPSHOT_METRIC_ROLE.currentRevision,
        count: rev?.revisionSequence ?? null,
      },
      {
        key: 'dueDate',
        label: 'Due Date',
        value: formatDueDate(project.requiredDeliveryDate),
        role: SNAPSHOT_METRIC_ROLE.dueDate,
        valueRole: dueState === 'overdue' ? 'danger' : dueState === 'soon' ? 'warning' : 'neutral',
        count: null,
      },
      {
        key: 'openActions',
        label: 'Open Actions',
        value: String(openActions.length),
        role: SNAPSHOT_METRIC_ROLE.openActions,
        count: openActions.length,
      },
    ],
  };

  const attentionAll = deriveAttention({ project, workspace, now });
  const attention = rankAttention(attentionAll);

  const nextAction = resolveNextAction({ project, workspace, now });
  const activity = recentActivity(workspace.activity);
  const stageStrip = buildStageStrip(project.status, input.workflow.transitions);
  const workflowCycle = buildWorkflowCycle(project, input.workflow.transitions);

  return {
    snapshot,
    attention: attention.slice(0, ATTENTION_PREVIEW_CAPACITY),
    attentionAll: attention,
    nextAction,
    activity,
    stageStrip,
    workflowCycle,
  };
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/**
 * Derive deterministic attention candidates from canonical data. No fabricated
 * counts — every candidate is proven by a concrete canonical record.
 */
function deriveAttention(input: {
  project: Project;
  workspace: ProjectWorkspace;
  now: Date;
}): AttentionItem[] {
  const { workspace, now } = input;
  const items: AttentionItem[] = [];

  // Blocking health checks.
  for (const check of workspace.health.checks) {
    if (check.severity === 'Blocking' && !check.passed) {
      items.push({
        id: `check:${check.key}`,
        message: check.label,
        supporting: check.detail || null,
        severity: 'blocking',
        role: 'danger',
        targetSection: null,
      });
    }
  }

  // Overdue open actions.
  const today = businessTodayKey(now);
  for (const action of workspace.actions) {
    if (isOpenAction(action) && action.dueDate !== null && action.dueDate < today) {
      items.push({
        id: `action:${action.id}`,
        message: action.title,
        supporting: action.priority === 'Urgent' ? 'Urgent' : 'Overdue',
        severity: action.priority === 'Urgent' || action.priority === 'High' ? 'high' : 'warning',
        role: action.priority === 'Urgent' || action.priority === 'High' ? 'danger' : 'warning',
        targetSection: null,
      });
    }
  }

  // Technical health warnings (Warning severity, not passed).
  for (const check of workspace.health.checks) {
    if (check.severity === 'Warning' && !check.passed) {
      items.push({
        id: `check:${check.key}`,
        message: check.label,
        supporting: healthCheckDetail(check.key, check.detail, workspace) || null,
        severity: 'warning',
        role: 'warning',
        targetSection: null,
      });
    }
  }

  // Open review items requiring response.
  for (const review of workspace.reviewItems) {
    if (review.status === 'Open') {
      items.push({
        id: `review:${review.id}`,
        message: review.title || 'Open review requires response',
        supporting: 'Awaiting response',
        severity: 'info',
        role: 'brandGold',
        targetSection: null,
      });
    }
  }

  return items;
}
