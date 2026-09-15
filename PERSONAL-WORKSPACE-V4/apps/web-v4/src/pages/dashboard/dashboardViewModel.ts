import { isActiveProject, type Project } from '@scli/domain';
import {
  addBusinessCalendarDays,
  businessCalendarDayDifference,
  businessDateKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
} from '../../date-time/businessDateTime';

export const DASHBOARD_TIMEZONE = 'Asia/Dubai';

export const DASHBOARD_KPI_IDS = [
  'active',
  'dueThisWeek',
  'revisionRequired',
  'clientReview',
] as const;

export type DashboardKpiId = (typeof DASHBOARD_KPI_IDS)[number];
export type AttentionReason = 'overdue' | 'revision' | 'due';

export interface DashboardKpi {
  id: DashboardKpiId;
  label: string;
  count: number;
  supportingCopy: string;
}

export interface DashboardView {
  kpis: DashboardKpi[];
  activeProjects: Project[];
  needAttention: Project[];
}

export function dateKeyInTimezone(now: Date, timezone = DASHBOARD_TIMEZONE): string {
  void timezone;
  return businessDateKey(now);
}

export function addCalendarDays(dateKey: string, days: number): string {
  return addBusinessCalendarDays(dateKey, days);
}

export function calendarDayDistance(fromDateKey: string, toDateKey: string): number {
  return businessCalendarDayDifference(toDateKey, fromDateKey) ?? 0;
}

export function isOverdue(project: Project, today: string): boolean {
  return Boolean(project.requiredDeliveryDate) && project.requiredDeliveryDate < today;
}

function sortByDue(projects: readonly Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate) ||
      a.projectCode.localeCompare(b.projectCode),
  );
}

export function projectsForKpi(
  active: readonly Project[],
  kpi: DashboardKpiId,
  today: string,
): Project[] {
  const weekEnd = addCalendarDays(today, 7);
  switch (kpi) {
    case 'active':
      return [...active];
    case 'dueThisWeek':
      return active.filter(
        (project) =>
          project.requiredDeliveryDate >= today && project.requiredDeliveryDate <= weekEnd,
      );
    case 'revisionRequired':
      return active.filter((project) => project.status === 'RevisionRequired');
    case 'clientReview':
      return active.filter((project) => project.status === 'ClientReview');
  }
}

export function needAttentionReason(project: Project, today: string): AttentionReason {
  if (isOverdue(project, today)) return 'overdue';
  if (project.status === 'RevisionRequired') return 'revision';
  return 'due';
}

export function deriveDashboardView(projects: readonly Project[], today: string): DashboardView {
  const active = projects.filter(isActiveProject);
  const activeProjects = sortByDue(active);
  const dueThisWeek = projectsForKpi(active, 'dueThisWeek', today);
  const revisionRequired = projectsForKpi(active, 'revisionRequired', today);
  const clientReview = projectsForKpi(active, 'clientReview', today);
  const dueSoonEnd = addCalendarDays(today, 2);

  const overdue = sortByDue(active.filter((project) => isOverdue(project, today)));
  const revisionNotOverdue = sortByDue(
    revisionRequired.filter((project) => !isOverdue(project, today)),
  );
  const dueSoon = sortByDue(
    active.filter(
      (project) =>
        project.status !== 'RevisionRequired' &&
        project.requiredDeliveryDate >= today &&
        project.requiredDeliveryDate <= dueSoonEnd,
    ),
  );

  return {
    activeProjects,
    needAttention: [...overdue, ...revisionNotOverdue, ...dueSoon],
    kpis: [
      {
        id: 'active',
        label: 'Active Projects',
        count: active.length,
        supportingCopy: 'In progress',
      },
      {
        id: 'dueThisWeek',
        label: 'Due This Week',
        count: dueThisWeek.length,
        supportingCopy: 'Due in 7 days',
      },
      {
        id: 'revisionRequired',
        label: 'Revision Required',
        count: revisionRequired.length,
        supportingCopy: 'Awaiting your revisions',
      },
      {
        id: 'clientReview',
        label: 'Client Review',
        count: clientReview.length,
        supportingCopy: 'Awaiting client feedback',
      },
    ],
  };
}

export function formatDashboardDate(dateKey: string | null): string {
  if (!dateKey) return 'No due date';
  return (
    formatBusinessDateOnly(dateKey.slice(0, 10), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) || 'Invalid date'
  );
}

export function dueDetail(dateKey: string, today: string): string {
  const days = calendarDayDistance(today, dateKey);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function formatMeetingDateTime(iso: string): string {
  return (
    formatBusinessDateTime(iso, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) || 'Date unavailable'
  );
}
