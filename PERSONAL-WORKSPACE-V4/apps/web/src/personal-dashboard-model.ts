import { isActiveProject, type Project, type ProjectStatus } from '@scli/domain';

/**
 * Dashboard KPI band. These four KPIs are operational filters, not decorative
 * cards. Each id maps to a deterministic predicate over the canonical active
 * project set (see `activeProjectsByKpi`).
 */
export const DASHBOARD_KPI_IDS = [
  'active',
  'dueThisWeek',
  'revisionRequired',
  'clientReview',
] as const;
export type DashboardKpiId = (typeof DASHBOARD_KPI_IDS)[number];

export const dashboardKpiLabels: Record<DashboardKpiId, string> = {
  active: 'Active',
  dueThisWeek: 'Due This Week',
  revisionRequired: 'Revision Required',
  clientReview: 'Client Review',
};

export type DashboardKpiTone = 'accent' | 'warning' | 'danger' | 'default';

export interface DashboardKpi {
  id: DashboardKpiId;
  count: number;
  tone: DashboardKpiTone;
}

export interface DashboardWorkloadStatus {
  status: ProjectStatus;
  count: number;
}

export interface DashboardDerivedView {
  kpis: DashboardKpi[];
  needAttention: Project[];
  workload: DashboardWorkloadStatus[];
  /** All active projects, sorted by required delivery date ascending. */
  activeProjects: Project[];
  waitingExternal: Project[];
  /** Projects sorted most-recently-updated first. */
  recentlyUpdated: Project[];
}

export function isOverdue(project: Project, today: string): boolean {
  return project.requiredDeliveryDate < today;
}

/**
 * Due today through the next 7 calendar days. Because overdue is strictly
 * `requiredDeliveryDate < today`, the `>= today` bound naturally excludes
 * overdue projects from the "Due This Week" set.
 */
function dueThisWeek(active: readonly Project[], today: string, endDate: string): Project[] {
  return active.filter(
    (project) => project.requiredDeliveryDate >= today && project.requiredDeliveryDate <= endDate,
  );
}

function sortByDue(projects: readonly Project[]): Project[] {
  return [...projects].sort((a, b) => a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate));
}

/**
 * Due today through the next 2 calendar days (inclusive) — the locked urgent
 * Need-Attention window. Overdue is strictly `requiredDeliveryDate < today`, so
 * the `>= today` bound naturally excludes overdue projects. This is a calendar
 * window only; no rolling 48/72-hour timestamp semantics.
 */
function dueSoon(active: readonly Project[], today: string, soonEndDate: string): Project[] {
  return active.filter(
    (project) =>
      project.requiredDeliveryDate >= today && project.requiredDeliveryDate <= soonEndDate,
  );
}

/**
 * The Active Projects set for a selected KPI filter. `active` is the normal
 * (unfiltered) active view.
 */
export function activeProjectsByKpi(
  active: readonly Project[],
  kpi: DashboardKpiId,
  today: string,
  endDate: string,
): Project[] {
  switch (kpi) {
    case 'active':
      return [...active];
    case 'dueThisWeek':
      return dueThisWeek(active, today, endDate);
    case 'revisionRequired':
      return active.filter((project) => project.status === 'RevisionRequired');
    case 'clientReview':
      return active.filter((project) => project.status === 'ClientReview');
  }
}

/**
 * Derives the operational dashboard view from the canonical project collection.
 * This is a pure function over bounded collection data — no per-project fetches,
 * no dashboard-specific persistence.
 */
export function deriveDashboardView(
  projects: readonly Project[],
  today: string,
  endDate: string,
  soonEndDate: string,
): DashboardDerivedView {
  const active = projects.filter(isActiveProject);
  const activeSortedByDue = sortByDue(active);

  const overdue = sortByDue(active.filter((project) => isOverdue(project, today)));
  const revisionRequiredSet = active.filter((project) => project.status === 'RevisionRequired');
  const clientReviewSet = active.filter((project) => project.status === 'ClientReview');
  const dueWeek = dueThisWeek(active, today, endDate);
  const soonSet = dueSoon(active, today, soonEndDate);

  // Need Attention buckets are mutually exclusive so no project is listed twice.
  // Deterministic order: OVERDUE -> REVISION REQUIRED -> DUE SOON.
  const revisionNotOverdue = sortByDue(
    revisionRequiredSet.filter((project) => !isOverdue(project, today)),
  );
  const dueSoonSet = sortByDue(soonSet.filter((project) => project.status !== 'RevisionRequired'));
  const needAttention = [...overdue, ...revisionNotOverdue, ...dueSoonSet];

  const statuses = [...new Set(active.map((project) => project.status))];
  const workload: DashboardWorkloadStatus[] = statuses
    .map((status) => ({
      status,
      count: active.filter((project) => project.status === status).length,
    }))
    .sort((a, b) => b.count - a.count);

  const waitingExternal = active.filter(
    (project) => project.status === 'ClientReview' || project.status === 'OnHold',
  );

  const recentlyUpdated = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const kpis: DashboardKpi[] = [
    { id: 'active', count: active.length, tone: 'accent' },
    { id: 'dueThisWeek', count: dueWeek.length, tone: 'default' },
    { id: 'revisionRequired', count: revisionRequiredSet.length, tone: 'warning' },
    { id: 'clientReview', count: clientReviewSet.length, tone: 'default' },
  ];

  return {
    kpis,
    needAttention,
    workload,
    activeProjects: activeSortedByDue,
    waitingExternal,
    recentlyUpdated,
  };
}

/** The Need Attention reason bucket an item belongs to (buckets are exclusive). */
export function needAttentionReason(
  project: Project,
  today: string,
): 'overdue' | 'revision' | 'due' {
  if (isOverdue(project, today)) return 'overdue';
  if (project.status === 'RevisionRequired') return 'revision';
  return 'due';
}
