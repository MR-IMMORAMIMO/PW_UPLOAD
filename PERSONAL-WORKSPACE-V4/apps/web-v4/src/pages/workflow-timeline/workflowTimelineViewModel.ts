import type { WorkflowHistoryResponse } from '@scli/contracts';
import type {
  CanonicalRevisionRecord,
  OutputRegistryLifecycleState,
  Project,
  ProjectWorkspace,
} from '@scli/domain';
import { formatProjectStatus } from '../../components/project/statusDisplay';
import { buildCompatibilitySummary } from '../project-revisions/revisionsViewModel';

export type TimelineCategory = 'workflow' | 'revision' | 'meeting' | 'action' | 'activity';
export type TimelineIconRole =
  | 'workflow'
  | 'client-review'
  | 'revision-required'
  | 'revision'
  | 'meeting'
  | 'action'
  | 'scope-update'
  | 'activity';
export const TIMELINE_PAGE_SIZE = 9;
export interface TimelineEvent {
  id: string;
  category: TimelineCategory;
  title: string;
  description: string | null;
  occurredAt: string;
  status: string | null;
  notes: string | null;
  actor: string | null;
  revisionSequence: number | null;
  canonicalLifecycleState: OutputRegistryLifecycleState | null;
  compatibilityStatus: string | null;
  compatibilityIssuedAt: string | null;
  activityEntityType: string | null;
  activityEntityId?: string | null;
}

const time = (value: string | null | undefined) =>
  value && !Number.isNaN(Date.parse(value)) ? value : null;
const actorName = (event: ProjectWorkspace['activity'][number] | undefined): string | null =>
  event && 'actorName' in event && typeof event.actorName === 'string' ? event.actorName : null;
const compare = (a: TimelineEvent, b: TimelineEvent) =>
  a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);
const isCreatedSourceMirror = (
  entityType: string,
  entityId: string | null,
  action: string,
  representedRevisionIds: ReadonlySet<string>,
  representedMeetingIds: ReadonlySet<string>,
  representedActionIds: ReadonlySet<string>,
) =>
  action === 'Created' &&
  entityId !== null &&
  ((entityType === 'Revision' && representedRevisionIds.has(entityId)) ||
    (entityType === 'Meeting' && representedMeetingIds.has(entityId)) ||
    (entityType === 'Action' && representedActionIds.has(entityId)));

/**
 * Pure, read-only event projection. Canonical Revisions provide Revision
 * existence/identity; compatibility records can only enrich by persisted ID.
 * IDs are source-qualified and repeated cycles survive.
 */
export function buildTimelineEvents(
  project: Project,
  workspace: ProjectWorkspace,
  workflow: WorkflowHistoryResponse,
  canonicalRevisions: readonly CanonicalRevisionRecord[],
): TimelineEvent[] {
  void project;
  const events: TimelineEvent[] = [];
  const representedRevisionIds = new Set<string>();
  const representedMeetingIds = new Set<string>();
  const representedActionIds = new Set<string>();
  for (const item of workflow.transitions)
    events.push({
      id: `workflow:${item.transitionId}`,
      category: 'workflow',
      title: `Stage changed to ${formatProjectStatus(item.toStatus)}`,
      description: item.reason || null,
      occurredAt: item.occurredAt,
      status: item.toStatus,
      notes: item.reason || null,
      actor: actorName(
        workspace.activity.find(
          (event) =>
            event.createdAt === item.occurredAt && event.entityType.toLowerCase() === 'project',
        ),
      ),
      revisionSequence: null,
      canonicalLifecycleState: null,
      compatibilityStatus: null,
      compatibilityIssuedAt: null,
      activityEntityType: null,
    });
  for (const item of canonicalRevisions) {
    const compatibility = buildCompatibilitySummary(item, workspace);
    const occurredAt = time(item.finalizedAt) ?? time(item.createdAt);
    if (occurredAt) representedRevisionIds.add(item.revisionId);
    if (occurredAt)
      events.push({
        id: `revision:${item.revisionId}`,
        category: 'revision',
        title: item.revisionLabel,
        description: compatibility?.title ?? item.purpose,
        occurredAt,
        status: null,
        notes: compatibility?.summary ?? compatibility?.changes ?? null,
        actor: time(item.finalizedAt)
          ? actorName(
              workspace.activity.find(
                (event) =>
                  event.entityId === item.revisionId && event.createdAt === item.finalizedAt,
              ),
            )
          : item.createdByName,
        revisionSequence: item.revisionSequence,
        canonicalLifecycleState: item.lifecycleState,
        compatibilityStatus: compatibility?.status ?? null,
        compatibilityIssuedAt: time(compatibility?.issuedAt),
        activityEntityType: null,
      });
  }
  for (const item of workspace.meetings) {
    const occurredAt = time(item.startAt);
    if (occurredAt) representedMeetingIds.add(item.id);
    if (occurredAt)
      events.push({
        id: `meeting:${item.id}`,
        category: 'meeting',
        title: item.title,
        description: item.agenda || null,
        occurredAt,
        status: item.status,
        notes: item.notes || item.decisions || null,
        actor: null,
        revisionSequence: null,
        canonicalLifecycleState: null,
        compatibilityStatus: null,
        compatibilityIssuedAt: null,
        activityEntityType: null,
      });
  }
  for (const item of workspace.actions) {
    const occurredAt = time(item.completedAt) ?? time(item.createdAt);
    if (occurredAt) representedActionIds.add(item.id);
    if (occurredAt)
      events.push({
        id: `action:${item.id}`,
        category: 'action',
        title: item.title,
        description: item.details || null,
        occurredAt,
        status: item.status,
        notes: item.details || null,
        actor: null,
        revisionSequence: null,
        canonicalLifecycleState: null,
        compatibilityStatus: null,
        compatibilityIssuedAt: null,
        activityEntityType: null,
      });
  }
  for (const item of workspace.activity) {
    if (
      isCreatedSourceMirror(
        item.entityType,
        item.entityId,
        item.action,
        representedRevisionIds,
        representedMeetingIds,
        representedActionIds,
      )
    )
      continue;
    events.push({
      id: `activity:${item.id}`,
      category: 'activity',
      title: item.title,
      description: item.detail || null,
      occurredAt: item.createdAt,
      status: item.action || null,
      notes: item.detail || null,
      actor: 'actorName' in item && typeof item.actorName === 'string' ? item.actorName : null,
      revisionSequence: null,
      canonicalLifecycleState: null,
      compatibilityStatus: null,
      compatibilityIssuedAt: null,
      activityEntityType: item.entityType || null,
      activityEntityId: item.entityId,
    });
  }
  return events.sort(compare);
}

export function timelineEventTypeDisplay(category: TimelineCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function timelineEventStatusDisplay(status: string): string {
  return formatProjectStatus(status);
}

/** Maps only canonical category/entity/action fields; titles and descriptions never classify icons. */
export function timelineEventIconRole(event: TimelineEvent): TimelineIconRole {
  if (event.category === 'workflow') {
    if (event.status === 'ClientReview') return 'client-review';
    if (event.status === 'RevisionRequired') return 'revision-required';
    return 'workflow';
  }
  if (event.category === 'revision') return 'revision';
  if (event.category === 'meeting') return 'meeting';
  if (event.category === 'action') return 'action';
  if (event.activityEntityType === 'workspace' && event.status === 'ScopeUpdated') {
    return 'scope-update';
  }
  return 'activity';
}

export function filterTimelineEvents(
  events: TimelineEvent[],
  filter: 'all' | TimelineCategory,
): TimelineEvent[] {
  return filter === 'all' ? events : events.filter((event) => event.category === filter);
}

export function timelinePageCount(events: readonly TimelineEvent[]): number {
  return Math.ceil(events.length / TIMELINE_PAGE_SIZE);
}

export function timelinePageEvents(
  events: readonly TimelineEvent[],
  page: number,
): TimelineEvent[] {
  const pageCount = timelinePageCount(events);
  if (!pageCount) return [];
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const start = safePage * TIMELINE_PAGE_SIZE;
  return events.slice(start, start + TIMELINE_PAGE_SIZE);
}

export function timelinePaginationWindow(
  pageCount: number,
  currentPage: number,
): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const current = Math.max(0, Math.min(currentPage, pageCount - 1));
  const start = Math.max(1, Math.min(current - 2, pageCount - 6));
  const middle = Array.from({ length: 5 }, (_, index) => start + index);
  return [
    0,
    ...(middle[0]! > 1 ? ['ellipsis' as const] : []),
    ...middle,
    ...(middle.at(-1)! < pageCount - 2 ? ['ellipsis' as const] : []),
    pageCount - 1,
  ];
}
