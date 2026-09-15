import type {
  Project,
  ProjectHealth,
  ProjectRevision,
  ProjectWorkspace,
  RevisionCycle,
  WorkspaceActivity,
} from '@scli/domain';
import { personalStatusLabel } from './personal-status';
import { addCalendarDays, workspaceDateKey } from './local-date';

/**
 * Pure presentation view-model for the Project Summary (P2-UX-04A).
 *
 * Framework-free derivation over canonical Project + ProjectWorkspace +
 * ProjectHealth + RevisionCycle data. No persistence, no mutation of inputs,
 * no fabricated history. Due-date semantics reuse the Personal Workspace
 * calendar conventions already established by the Dashboard.
 */

export type DueSemantic = 'overdue' | 'dueSoon' | 'normal';

/** Deterministic due-date semantic for a project delivery date. */
export function dueSemantic(date: string, today = workspaceDateKey()): DueSemantic {
  if (date < today) return 'overdue';
  if (date <= addCalendarDays(today, 2)) return 'dueSoon';
  return 'normal';
}

export const DUE_SEMANTIC_LABEL: Record<DueSemantic, string> = {
  overdue: 'Overdue',
  dueSoon: 'Due Soon',
  normal: '',
};

export interface ProjectContextHeader {
  projectCode: string;
  projectName: string;
  client: string;
  projectType: string;
  designStage: string;
  dueDate: string;
  dueSemantic: DueSemantic;
}

export function projectContextHeader(project: Project): ProjectContextHeader {
  return {
    projectCode: project.projectCode,
    projectName: project.projectName,
    client: project.clientName,
    projectType: project.projectType,
    designStage: project.designStage,
    dueDate: project.requiredDeliveryDate,
    dueSemantic: dueSemantic(project.requiredDeliveryDate),
  };
}

export type RailNodeState = 'completed' | 'current' | 'pending';

export interface StageRailNode {
  id: 'notStarted' | 'inProgress' | 'clientReview';
  label: string;
  state: RailNodeState;
}

export interface StageRail {
  nodes: StageRailNode[];
  /** Present only when an actual open/current RevisionCycle exists. */
  cycleNumber: number | null;
  /** Auxiliary / terminal status conditions, shown truthfully when present. */
  auxiliary: string[];
}

/**
 * Truthful status + revision-cycle rail. Revision Required is a loop condition,
 * not a final linear stage. Planning displays as "Not Started Yet". No
 * fabricated Setup / Technical / Issue fixed nodes.
 */
export function stageRail(project: Project, cycles: RevisionCycle[]): StageRail {
  const status = project.status;
  const openCycle = cycles.find((cycle) => cycle.status === 'Open') ?? null;

  const nodes: StageRailNode[] = [
    { id: 'notStarted', label: 'Not Started Yet', state: 'pending' },
    { id: 'inProgress', label: 'In Progress', state: 'pending' },
    { id: 'clientReview', label: 'Client Review', state: 'pending' },
  ];

  const mark = (id: StageRailNode['id'], state: RailNodeState) => {
    const node = nodes.find((n) => n.id === id);
    if (node) node.state = state;
  };

  if (status === 'Planning') {
    mark('notStarted', 'current');
  } else if (status === 'InProgress' || status === 'RevisionRequired') {
    mark('notStarted', 'completed');
    mark('inProgress', 'current');
  } else if (status === 'ClientReview') {
    mark('notStarted', 'completed');
    mark('inProgress', 'completed');
    mark('clientReview', 'current');
  } else if (status === 'OnHold') {
    // On Hold is an auxiliary condition; reflect the last active node as current.
    mark('notStarted', 'completed');
    mark('inProgress', 'current');
  } else if (status === 'Completed' || status === 'Cancelled') {
    mark('notStarted', 'completed');
    mark('inProgress', 'completed');
    mark('clientReview', 'completed');
  }

  const auxiliary: string[] = [];
  if (status === 'OnHold') auxiliary.push('On Hold');
  if (status === 'Completed') auxiliary.push('Completed');
  if (status === 'Cancelled') auxiliary.push('Cancelled');
  // Legacy-compatible actual statuses shown only when genuinely present.
  if (status === 'ReadyToIssue') auxiliary.push('Ready to Issue');
  if (status === 'Issued') auxiliary.push('Issued');

  return {
    nodes,
    cycleNumber: openCycle?.cycleNumber ?? null,
    auxiliary,
  };
}

export interface AttentionItem {
  key: string;
  severity: 'Blocking' | 'Warning';
  reason: string;
  detail: string;
  /** Semantic project section target (e.g. 'actions'). Final href resolved at the UI boundary. */
  targetSection: string;
}

const ATTENTION_TARGETS: Record<string, string> = {
  folder: 'workspace',
  requirements: 'scope',
  actions: 'actions',
  reviews: 'comments',
  datasheets: 'datasheets',
  specification: 'luminaires',
  outputs: 'revisions',
};

/**
 * Need Your Attention from canonical ProjectHealth checks. Blocking first, then
 * Warning. Info items are excluded. Deterministic order within each severity.
 * Max 4 visible.
 */
export function needAttention(health: ProjectHealth): AttentionItem[] {
  const blocking = health.checks
    .filter((check) => check.severity === 'Blocking' && !check.passed)
    .map((check) => ({
      key: check.key,
      severity: 'Blocking' as const,
      reason: check.label,
      detail: check.detail,
      targetSection: ATTENTION_TARGETS[check.key] ?? 'summary',
    }));
  const warning = health.checks
    .filter((check) => check.severity === 'Warning' && !check.passed)
    .map((check) => ({
      key: check.key,
      severity: 'Warning' as const,
      reason: check.label,
      detail: check.detail,
      targetSection: ATTENTION_TARGETS[check.key] ?? 'summary',
    }));
  return [...blocking, ...warning].slice(0, 4);
}

export interface ProjectSnapshot {
  luminaireCount: number;
  latestRevision: ProjectRevision | null;
  dueDate: string;
  dueSemantic: DueSemantic;
  openActions: number;
}

export function projectSnapshot(project: Project, workspace: ProjectWorkspace): ProjectSnapshot {
  const openActions = workspace.actions.filter(
    (action) => action.status !== 'Completed' && action.status !== 'Cancelled',
  ).length;
  const latestRevision =
    workspace.revisions.length > 0
      ? [...workspace.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber)[0]!
      : null;
  return {
    luminaireCount: workspace.luminaires.length,
    latestRevision,
    dueDate: project.requiredDeliveryDate,
    dueSemantic: dueSemantic(project.requiredDeliveryDate),
    openActions,
  };
}

export interface NextAction {
  title: string;
  detail: string;
  /** Semantic project section target (e.g. 'workflow'). Final href resolved at the UI boundary. */
  targetSection: string;
  /** Destination-aware CTA label (e.g. 'Open Actions'). */
  ctaLabel: string;
}

/**
 * Deterministic Next Action over canonical status + ProjectHealth checks.
 * Status is the primary discriminator; health checks only disambiguate
 * appropriate active-work cases. No AI, no urgency score, no fake estimate.
 * CTA labels are destination-aware: they name the section the action routes to.
 */
export function nextAction(project: Project, health: ProjectHealth): NextAction {
  const status = project.status;
  if (status === 'ClientReview') {
    return {
      title: 'Waiting for client review',
      detail: 'No internal action is required right now.',
      targetSection: 'workflow',
      ctaLabel: 'View Workflow',
    };
  }
  if (status === 'RevisionRequired') {
    return {
      title: 'Client feedback requires design updates',
      detail: 'Start revision work to address the client feedback.',
      targetSection: 'workflow',
      ctaLabel: 'View Workflow',
    };
  }
  if (status === 'OnHold') {
    return {
      title: 'Project is on hold',
      detail: 'Resume the project when work can continue.',
      targetSection: 'workflow',
      ctaLabel: 'View Workflow',
    };
  }
  if (status === 'InProgress') {
    const blocking = health.checks.find(
      (check) => check.key === 'requirements' && check.severity === 'Blocking' && !check.passed,
    );
    if (blocking) {
      return {
        title: 'Resolve blocking information',
        detail: blocking.detail,
        targetSection: 'scope',
        ctaLabel: 'Open Scope',
      };
    }
    const overdue = health.checks.find(
      (check) => check.key === 'actions' && check.severity === 'Warning' && !check.passed,
    );
    if (overdue) {
      return {
        title: 'Complete overdue actions',
        detail: overdue.detail,
        targetSection: 'actions',
        ctaLabel: 'Open Actions',
      };
    }
    const datasheets = health.checks.find(
      (check) => check.key === 'datasheets' && check.severity === 'Warning' && !check.passed,
    );
    if (datasheets) {
      return {
        title: 'Add missing datasheets',
        detail: datasheets.detail,
        targetSection: 'datasheets',
        ctaLabel: 'Open Datasheets',
      };
    }
  }
  return {
    title: 'No current internal action',
    detail: 'Review the workflow to see where the project stands.',
    targetSection: 'workflow',
    ctaLabel: 'View Workflow',
  };
}

export interface RecentActivityItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
}

/**
 * Recent Activity preview from actual WorkspaceActivity records. No fabricated
 * descriptions, no invented actor (the canonical source has no actor column).
 */
export function recentActivity(activity: WorkspaceActivity[], limit = 5): RecentActivityItem[] {
  return [...activity]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.detail || `${item.entityType} · ${item.action}`,
      timestamp: item.createdAt,
    }));
}

export { personalStatusLabel };
