import {
  getAllowedPersonalTransitions,
  priorities,
  projectStatuses,
  type Priority,
  type Project,
  type ProjectStatus,
} from '@scli/domain';
import type { V4StatusPillVariant } from '../../components/common/V4StatusPill';
import { deriveDueState, type V4DueState } from '../../components/project/dueState';
import { formatProjectStatus, projectStatusTone } from '../../components/project/statusDisplay';
import {
  addBusinessCalendarDays,
  businessCalendarDayDifference,
  businessDateKey,
  businessTodayKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
} from '../../date-time/businessDateTime';

export type ProjectsViewMode = 'table' | 'planner' | 'cards';
export type ProjectsSortKey = 'priority' | 'requiredDate' | 'createdDate' | 'salesOwner';
export type ProjectsSortDirection = 'asc' | 'desc';
export type ProjectsDueFilter = '' | 'overdue' | 'next7' | 'next30';

export const PROJECTS_VIEW_STORAGE_KEY = 'scli.v4.projects.view';

export const PROJECT_STATUS_OPTIONS = projectStatuses.map((status) => ({
  value: status,
  label: formatProjectStatus(status),
  tone: statusTone(status),
}));

export const PROJECT_PRIORITY_OPTIONS = priorities.map((priority) => ({
  value: priority,
  label: priority,
  tone: priorityTone(priority),
}));

/** Stable product order over the complete canonical status set. */
export const PLANNER_STATUS_ORDER: readonly ProjectStatus[] = [
  'Planning',
  'NewRequest',
  'UnderReview',
  'Unassigned',
  'Assigned',
  'InProgress',
  'WaitingForInformation',
  'WaitingForSales',
  'InternalReview',
  'ClientReview',
  'RevisionRequired',
  'ReadyToIssue',
  'Issued',
  'OnHold',
  'Completed',
  'Cancelled',
  'Archived',
];

export function readProjectsView(storage: Pick<Storage, 'getItem'>): ProjectsViewMode {
  const stored = storage.getItem(PROJECTS_VIEW_STORAGE_KEY);
  return stored === 'planner' || stored === 'cards' || stored === 'table' ? stored : 'table';
}

export function statusTone(status: ProjectStatus): V4StatusPillVariant {
  // Single source of truth: the shared Project.status -> semantic tone mapping.
  return projectStatusTone(status);
}

export function priorityTone(priority: Priority): V4StatusPillVariant {
  if (priority === 'Urgent') return 'danger';
  if (priority === 'High') return 'warning';
  return 'info';
}

export function formatProjectDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return (
    formatBusinessDateOnly(iso.slice(0, 10), {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }) || '—'
  );
}

export function formatProjectTimestamp(iso: string): string {
  return (
    formatBusinessDateTime(iso, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) || '—'
  );
}

export function dueCopy(
  dueDate: string | null | undefined,
  now: Date,
): { state: V4DueState; label: string; detail: string } {
  const state = deriveDueState(dueDate, now);
  const label = formatProjectDate(dueDate);
  if (!dueDate) return { state, label, detail: 'No due date' };
  const days = businessCalendarDayDifference(dueDate.slice(0, 10), businessTodayKey(now));
  if (days === null) return { state: 'neutral', label: '—', detail: 'Invalid date' };
  if (days < 0)
    return { state, label, detail: `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue` };
  if (days === 0) return { state, label, detail: 'Due today' };
  return { state, label, detail: `Due in ${days} day${days === 1 ? '' : 's'}` };
}

export function folderCopy(project: Project): {
  state: 'ready' | 'indexed' | 'missing';
  label: string;
  detail: string;
} {
  if (!project.projectFolderPath) {
    return { state: 'missing', label: 'Not Created', detail: 'No project folder path' };
  }
  if (project.folderIndexedAt) {
    return {
      state: 'indexed',
      label: 'Indexed',
      detail: `${project.folderFileCount ?? 0} file${project.folderFileCount === 1 ? '' : 's'}`,
    };
  }
  return { state: 'ready', label: 'Ready', detail: 'Folder available' };
}

export function isReasonRequiredTransition(project: Project, target: ProjectStatus): boolean {
  return (
    target === 'Cancelled' || (project.status === 'ClientReview' && target === 'RevisionRequired')
  );
}

/** Archive/restore stay specialized and reason-requiring transitions stay out of direct moves. */
export function directStatusTargets(project: Project): ProjectStatus[] {
  if (project.status === 'Archived') return [];
  return getAllowedPersonalTransitions(project).filter(
    (target) =>
      target !== 'Archived' &&
      target !== 'Cancelled' &&
      !isReasonRequiredTransition(project, target),
  );
}

/** Reason-requiring transitions that the shared status menu may offer through a dedicated form. */
export function specializedStatusTargets(project: Project): ProjectStatus[] {
  if (project.status === 'Archived') return [];
  return getAllowedPersonalTransitions(project).filter(
    (target) => target !== 'Cancelled' && isReasonRequiredTransition(project, target),
  );
}

export function canDirectlyMove(project: Project, target: ProjectStatus): boolean {
  return project.status !== target && directStatusTargets(project).includes(target);
}

export function projectsQueryFilters(input: {
  search: string;
  status: string;
  salesOwnerId: string;
  priority: string;
  projectType: string;
  due: ProjectsDueFilter;
  sortBy: ProjectsSortKey;
  sortDirection: ProjectsSortDirection;
  today: string;
}): Record<string, string | undefined> {
  const dateFrom = input.due === 'next7' || input.due === 'next30' ? input.today : undefined;
  const dueTo = input.due
    ? addDays(input.today, input.due === 'overdue' ? -1 : input.due === 'next7' ? 7 : 30)
    : undefined;
  return {
    search: input.search.trim() || undefined,
    status: input.status || undefined,
    salesOwnerId: input.salesOwnerId || undefined,
    priority: input.priority || undefined,
    projectType: input.projectType || undefined,
    dueFrom: dateFrom,
    dueTo,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
  };
}

export function todayInTimezone(now: Date, timezone: string): string {
  void timezone;
  return businessDateKey(now);
}

function addDays(isoDate: string, days: number): string {
  return addBusinessCalendarDays(isoDate, days);
}

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, page * pageSize + pageSize);
}
