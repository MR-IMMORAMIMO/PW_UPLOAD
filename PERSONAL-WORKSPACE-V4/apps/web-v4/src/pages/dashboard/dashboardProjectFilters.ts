import type { DashboardKpiId } from './dashboardViewModel';

/** The Projects page exposes the same contributing records as each Dashboard KPI. */
export function dashboardProjectFilters(kpi: string | null): Record<string, string> {
  switch (kpi as DashboardKpiId) {
    case 'active':
      return { Status: 'Active Projects' };
    case 'dueThisWeek':
      return { Status: 'Active Projects', 'Due Date': 'This Week' };
    case 'revisionRequired':
      return { Status: 'Revision Required' };
    case 'clientReview':
      return { Status: 'Client Review' };
    default:
      return {};
  }
}
