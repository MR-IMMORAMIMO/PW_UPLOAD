import type { ProjectActionItem } from '@scli/domain';
import type { ProjectActionItemInput } from '@scli/contracts';
import {
  addBusinessCalendarDays,
  businessCalendarDayDifference,
} from '../../date-time/businessDateTime';

export const ACTIONS_PER_PAGE = 6;
export type ActionDueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function addCalendarDays(dateOnly: string, days: number): string {
  return addBusinessCalendarDays(dateOnly, days);
}

export function isActiveAction(action: ProjectActionItem): boolean {
  return action.status !== 'Completed' && action.status !== 'Cancelled';
}

export function actionDueState(action: ProjectActionItem, today: string): ActionDueState {
  if (!action.dueDate) return 'none';
  if (!isActiveAction(action)) return 'later';
  if (action.dueDate < today) return 'overdue';
  if (action.dueDate === today) return 'today';
  if (action.dueDate <= addCalendarDays(today, 7)) return 'soon';
  return 'later';
}

export function actionKpis(actions: readonly ProjectActionItem[], today: string) {
  return {
    open: actions.filter(isActiveAction).length,
    dueSoon: actions.filter(
      (action) =>
        actionDueState(action, today) === 'today' || actionDueState(action, today) === 'soon',
    ).length,
    overdue: actions.filter((action) => actionDueState(action, today) === 'overdue').length,
    completed: actions.filter((action) => action.status === 'Completed').length,
  };
}

export function effectiveActionPage(page: number, total: number): number {
  return Math.min(Math.max(page, 0), Math.max(0, Math.ceil(total / ACTIONS_PER_PAGE) - 1));
}

export function actionStatusLabel(status: ProjectActionItem['status']): string {
  return status === 'InProgress' ? 'In Progress' : status;
}

export function actionDueLabel(
  state: ActionDueState,
  dueDate: string | null,
  today: string,
): string {
  if (!dueDate || state === 'none') return 'No due date';
  const difference = businessCalendarDayDifference(dueDate, today) ?? 0;
  if (state === 'today') return 'Today';
  if (state === 'overdue')
    return `${Math.abs(difference)} day${difference === -1 ? '' : 's'} overdue`;
  if (state === 'soon') return `in ${difference} day${difference === 1 ? '' : 's'}`;
  if (state === 'later') {
    return difference >= 0
      ? `in ${difference} day${difference === 1 ? '' : 's'}`
      : `${Math.abs(difference)} day${difference === -1 ? '' : 's'} ago`;
  }
  return '';
}

/**
 * The Action PATCH contract is complete-payload. Start from the server's
 * canonical entity so view-only edits never erase source/revision provenance.
 */
export function actionUpdateInput(
  action: ProjectActionItem,
  overrides: Partial<ProjectActionItemInput>,
): ProjectActionItemInput {
  return {
    title: action.title,
    details: action.details,
    owner: action.owner,
    ownerRole: action.ownerRole,
    dueDate: action.dueDate,
    status: action.status,
    priority: action.priority,
    sourceType: action.sourceType,
    sourceId: action.sourceId,
    revisionId: action.revisionId,
    categoryId: action.categoryId,
    notes: action.notes,
    ...(action.area === undefined ? {} : { area: action.area }),
    ...(action.luminaireId === undefined ? {} : { luminaireId: action.luminaireId }),
    ...(action.reviewItemId === undefined ? {} : { reviewItemId: action.reviewItemId }),
    ...overrides,
  };
}

export interface ActionFilters {
  query: string;
  status: string;
  owner: string;
  priority: string;
  category: string;
}

export function filterActions(actions: readonly ProjectActionItem[], filters: ActionFilters) {
  const needle = filters.query.trim().toLowerCase();
  return actions.filter(
    (item) =>
      (!needle ||
        [item.title, item.details, item.owner, item.ownerRole, item.notes].some((value) =>
          value.toLowerCase().includes(needle),
        )) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.priority || item.priority === filters.priority) &&
      (!filters.owner ||
        (filters.owner === '__unassigned__'
          ? !item.owner.trim()
          : item.owner.trim() === filters.owner)) &&
      (!filters.category ||
        (filters.category === '__uncategorized__'
          ? !item.categoryId
          : item.categoryId === filters.category)),
  );
}
