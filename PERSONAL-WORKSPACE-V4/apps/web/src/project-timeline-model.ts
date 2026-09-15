import type {
  ProjectActionItem,
  ProjectExportRecord,
  ProjectMeeting,
  ProjectRevision,
  RevisionCycle,
  WorkflowTransitionRecord,
} from '@scli/domain';
import { personalStatusLabel } from './personal-status';

/**
 * Pure normalized presentation view-model for the multi-source Project
 * Workflow Timeline.
 *
 * This module is intentionally framework-free: it maps canonical domain
 * records into a single `TimelineEvent[]` shape that the Timeline UI and the
 * generic Event Inspector both consume. It performs NO persistence, NO
 * mutation of its inputs, and NO fabrication of history. Optional fields
 * (actor, notes, related records) are omitted when the canonical source does
 * not provide them — never invented.
 */

export type TimelineEventType = 'workflow' | 'revision' | 'meeting' | 'action';

/**
 * Namespaces the normalized UI/event identity by source family so the same raw
 * UUID across two source families never collides as a React key or selection
 * id. The raw canonical `sourceId` is preserved separately for routing and
 * relationships.
 */
export function namespaceEventId(type: TimelineEventType, canonicalSourceId: string): string {
  return `${type}:${canonicalSourceId}`;
}

export interface TimelineRelatedRecord {
  label: string;
  detail: string;
  /** Semantic project section target (e.g. 'revisions'). Final href resolved at the UI boundary. */
  targetSection: string;
}

export interface TimelineEvent {
  /** Namespaced UI/event identity (e.g. 'revision:<uuid>'). Never a raw canonical id alone. */
  id: string;
  type: TimelineEventType;
  /** UTC ISO 8601 timestamp used for chronological ordering. */
  timestamp: string;
  title: string;
  /** Raw canonical source entity id (transitionId / revision id / meeting id / action id). */
  sourceId: string;
  /** Semantic project section target for "Open Source" (e.g. 'workflow'). Final href at the UI boundary. */
  sourceSection: string;
  /** Present only when the canonical source genuinely provides it. */
  actor?: string;
  /** Present only when the canonical source genuinely provides it. */
  status?: string;
  /** Present only when the canonical source genuinely provides it. */
  notes?: string;
  /** Source-specific payload for the generic Event Inspector. */
  payload: WorkflowEventPayload | RevisionEventPayload | MeetingEventPayload | ActionEventPayload;
}

export interface WorkflowEventPayload {
  kind: 'workflow';
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  revisionCycleId: string | null;
  cycleNumber: number | null;
  cycleStatus: string | null;
  feedbackSummary: string | null;
}

export interface RevisionEventPayload {
  kind: 'revision';
  revisionNumber: number;
  status: string;
  summary: string;
  changeLog: string;
  issuedAt: string | null;
  relatedOutputs: TimelineRelatedRecord[];
}

export interface MeetingEventPayload {
  kind: 'meeting';
  status: string;
  agenda: string;
  notes: string;
  decisions: string;
  attendees: string[];
  location: string;
  relatedActions: TimelineRelatedRecord[];
}

export interface ActionEventPayload {
  kind: 'action';
  status: string;
  priority: string;
  owner: string;
  dueDate: string | null;
  details: string;
  /** Revision relationship, shown only when a real canonical revisionId exists. */
  revisionId: string | null;
}

export type TimelineEventPayload =
  WorkflowEventPayload | RevisionEventPayload | MeetingEventPayload | ActionEventPayload;

export const TIMELINE_FILTERS = ['all', 'workflow', 'revisions', 'meetings', 'actions'] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const TIMELINE_FILTER_LABELS: Record<TimelineFilter, string> = {
  all: 'All',
  workflow: 'Workflow',
  revisions: 'Revisions',
  meetings: 'Meetings',
  actions: 'Actions',
};

/** Human-friendly label for a canonical action status. */
export function actionStatusLabel(status: ProjectActionItem['status']): string {
  switch (status) {
    case 'Open':
      return 'Open';
    case 'InProgress':
      return 'In Progress';
    case 'Waiting':
      return 'Waiting';
    case 'Completed':
      return 'Completed';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/** Human-friendly label for a canonical meeting status. */
export function meetingStatusLabel(status: ProjectMeeting['status']): string {
  switch (status) {
    case 'Planned':
      return 'Planned';
    case 'Held':
      return 'Held';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/** Human-friendly label for a canonical revision status. */
export function revisionStatusLabel(status: ProjectRevision['status']): string {
  switch (status) {
    case 'Draft':
      return 'Draft';
    case 'InProgress':
      return 'In Progress';
    case 'InternalReview':
      return 'Internal Review';
    case 'ReadyToIssue':
      return 'Ready to Issue';
    case 'Issued':
      return 'Issued';
    case 'Superseded':
      return 'Superseded';
    default:
      return status;
  }
}

/** Human-friendly label for a canonical revision cycle status. */
export function cycleStatusLabel(status: RevisionCycle['status']): string {
  switch (status) {
    case 'ReturnedToClient':
      return 'Returned to Client';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Open';
  }
}

/** Human-friendly label for a canonical action priority. */
export function actionPriorityLabel(priority: ProjectActionItem['priority']): string {
  return priority;
}

/**
 * Human-friendly title for a workflow transition event. Mirrors the existing
 * Overview timeline convention so the multi-source timeline does not introduce
 * a competing authority.
 */
export function workflowEventTitle(transition: WorkflowTransitionRecord): string {
  const { fromStatus, toStatus } = transition;
  if (fromStatus === 'Planning' && toStatus === 'InProgress') return 'Started Work';
  if (fromStatus === 'InProgress' && toStatus === 'ClientReview') {
    return transition.revisionCycleId ? 'Returned to Client' : 'Moved to Client Review';
  }
  if (fromStatus === 'ClientReview' && toStatus === 'RevisionRequired') {
    return 'Client Requested Changes';
  }
  if (fromStatus === 'RevisionRequired' && toStatus === 'InProgress') {
    return 'Revision Work Started';
  }
  if (toStatus === 'OnHold') return 'Put On Hold';
  if (fromStatus === 'OnHold' && toStatus === 'InProgress') return 'Resumed Work';
  if (fromStatus === 'OnHold' && toStatus === 'RevisionRequired') return 'Resumed Revision';
  if (toStatus === 'Completed') return 'Completed';
  if (toStatus === 'Cancelled') return 'Cancelled';
  if ((fromStatus === 'Completed' || fromStatus === 'Cancelled') && toStatus === 'InProgress') {
    return 'Reopened';
  }
  // Safe fallback for legal legacy statuses / transitions without a custom label.
  return `${personalStatusLabel(fromStatus)} → ${personalStatusLabel(toStatus)}`;
}

function normalizeWorkflowEvent(
  transition: WorkflowTransitionRecord,
  cycleById: Map<string, RevisionCycle>,
): TimelineEvent {
  const cycle = transition.revisionCycleId ? cycleById.get(transition.revisionCycleId) : undefined;
  const event: TimelineEvent = {
    id: namespaceEventId('workflow', transition.transitionId),
    type: 'workflow',
    timestamp: transition.occurredAt,
    title: workflowEventTitle(transition),
    sourceId: transition.transitionId,
    sourceSection: 'workflow',
    status: `${personalStatusLabel(transition.fromStatus)} → ${personalStatusLabel(transition.toStatus)}`,
    payload: {
      kind: 'workflow',
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      reason: transition.reason,
      revisionCycleId: transition.revisionCycleId,
      cycleNumber: cycle?.cycleNumber ?? null,
      cycleStatus: cycle ? cycleStatusLabel(cycle.status) : null,
      feedbackSummary: cycle?.feedbackSummary ?? null,
    },
  };
  if (transition.reason) event.notes = transition.reason;
  return event;
}

function normalizeRevisionEvent(
  revision: ProjectRevision,
  exports: ProjectExportRecord[],
): TimelineEvent {
  // HEURISTIC_SAFE: revisionNumber matching scoped to the current canonical
  // Project is the strongest currently-available revision->output relation.
  const relatedOutputs = exports
    .filter((record) => record.revision === revision.revisionNumber)
    .map((record) => ({
      label: `Revision ${String(record.revision).padStart(2, '0')} output`,
      detail: record.createdAt,
      targetSection: 'revisions',
    }));
  const event: TimelineEvent = {
    id: namespaceEventId('revision', revision.id),
    type: 'revision',
    timestamp: revision.issuedAt ?? revision.createdAt,
    title: `Revision ${String(revision.revisionNumber).padStart(2, '0')}`,
    sourceId: revision.id,
    sourceSection: 'revisions',
    status: revisionStatusLabel(revision.status),
    payload: {
      kind: 'revision',
      revisionNumber: revision.revisionNumber,
      status: revisionStatusLabel(revision.status),
      summary: revision.summary,
      changeLog: revision.changeLog,
      issuedAt: revision.issuedAt,
      relatedOutputs,
    },
  };
  if (revision.summary) event.notes = revision.summary;
  return event;
}

function normalizeMeetingEvent(
  meeting: ProjectMeeting,
  actions: ProjectActionItem[],
): TimelineEvent {
  const relatedActions = actions
    .filter((action) => action.sourceId === meeting.id)
    .map((action) => ({
      label: action.title,
      detail: actionStatusLabel(action.status),
      targetSection: 'actions',
    }));
  const event: TimelineEvent = {
    id: namespaceEventId('meeting', meeting.id),
    type: 'meeting',
    timestamp: meeting.startAt,
    title: meeting.title,
    sourceId: meeting.id,
    sourceSection: 'meetings',
    status: meetingStatusLabel(meeting.status),
    payload: {
      kind: 'meeting',
      status: meetingStatusLabel(meeting.status),
      agenda: meeting.agenda,
      notes: meeting.notes,
      decisions: meeting.decisions,
      attendees: meeting.attendees,
      location: meeting.location,
      relatedActions,
    },
  };
  if (meeting.agenda) event.notes = meeting.agenda;
  return event;
}

function normalizeActionEvent(action: ProjectActionItem): TimelineEvent {
  const event: TimelineEvent = {
    id: namespaceEventId('action', action.id),
    type: 'action',
    timestamp: action.createdAt,
    title: action.title,
    sourceId: action.id,
    sourceSection: 'actions',
    status: actionStatusLabel(action.status),
    payload: {
      kind: 'action',
      status: actionStatusLabel(action.status),
      priority: actionPriorityLabel(action.priority),
      owner: action.owner,
      dueDate: action.dueDate,
      details: action.details,
      revisionId: action.revisionId,
    },
  };
  if (action.owner) event.actor = action.owner;
  if (action.details) event.notes = action.details;
  return event;
}

export interface NormalizeProjectTimelineInput {
  transitions: WorkflowTransitionRecord[];
  revisionCycles: RevisionCycle[];
  revisions: ProjectRevision[];
  meetings: ProjectMeeting[];
  actions: ProjectActionItem[];
  exports: ProjectExportRecord[];
}

/**
 * Normalizes all canonical project history sources into a single
 * `TimelineEvent[]`, ordered most-recent-first. Deterministic stable secondary
 * order: for equal timestamps, workflow events sort before revisions before
 * meetings before actions, then by source id. Input arrays are never mutated.
 */
export function normalizeProjectTimeline(input: NormalizeProjectTimelineInput): TimelineEvent[] {
  const cycleById = new Map(input.revisionCycles.map((cycle) => [cycle.revisionCycleId, cycle]));
  const events: TimelineEvent[] = [
    ...input.transitions.map((transition) => normalizeWorkflowEvent(transition, cycleById)),
    ...input.revisions.map((revision) => normalizeRevisionEvent(revision, input.exports)),
    ...input.meetings.map((meeting) => normalizeMeetingEvent(meeting, input.actions)),
    ...input.actions.map(normalizeActionEvent),
  ];
  const typeOrder: Record<TimelineEventType, number> = {
    workflow: 0,
    revision: 1,
    meeting: 2,
    action: 3,
  };
  // Deterministic chronology: most-recent-first by timestamp. For equal
  // timestamps, preserve the canonical source order reversed (the established
  // Overview convention reverses the sequence-ascending transition list so the
  // latest transition reads first), then by type, then by source id.
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const byTime = b.event.timestamp.localeCompare(a.event.timestamp);
      if (byTime !== 0) return byTime;
      const byReverseIndex = b.index - a.index;
      if (byReverseIndex !== 0) return byReverseIndex;
      const byType = typeOrder[a.event.type] - typeOrder[b.event.type];
      if (byType !== 0) return byType;
      return a.event.sourceId.localeCompare(b.event.sourceId);
    })
    .map(({ event }) => event);
}

/** Presentation-only filter over a normalized event list. Never mutates input. */
export function filterTimelineEvents(
  events: TimelineEvent[],
  filter: TimelineFilter,
): TimelineEvent[] {
  if (filter === 'all') return events;
  const typeByFilter: Record<Exclude<TimelineFilter, 'all'>, TimelineEventType> = {
    workflow: 'workflow',
    revisions: 'revision',
    meetings: 'meeting',
    actions: 'action',
  };
  const target = typeByFilter[filter as Exclude<TimelineFilter, 'all'>];
  return events.filter((event) => event.type === target);
}
