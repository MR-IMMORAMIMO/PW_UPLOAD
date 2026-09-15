import { isActiveProject } from './workload';
import type { AppUser, Project, ReportSeriesItem, ReportSummary } from './types';

function countBy(values: readonly string[]): ReportSeriesItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function calculateReportSummary(
  projects: readonly Project[],
  users: readonly AppUser[],
  now = new Date(),
): ReportSummary {
  const userNames = new Map(users.map((user) => [user.id, user.displayName]));
  const today = now.toISOString().slice(0, 10);
  const completed = projects.filter((project) => project.completedAt !== null);
  const completionDurations = completed.map((project) => {
    const completedAt = new Date(project.completedAt ?? project.updatedAt).getTime();
    return Math.max((completedAt - new Date(project.createdAt).getTime()) / 86_400_000, 0);
  });
  const averageCompletionDays = completionDurations.length
    ? Math.round(
        (completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length) *
          10,
      ) / 10
    : 0;

  return {
    generatedAt: now.toISOString(),
    totalProjects: projects.length,
    activeProjects: projects.filter(isActiveProject).length,
    overdueProjects: projects.filter(
      (project) =>
        isActiveProject(project) &&
        Boolean(project.requiredDeliveryDate) &&
        project.requiredDeliveryDate < today,
    ).length,
    averageCompletionDays,
    totalEstimatedHours: projects.reduce((sum, project) => sum + project.estimatedHours, 0),
    totalActualHours: projects.reduce((sum, project) => sum + project.actualHours, 0),
    projectsByDesigner: countBy(
      projects.map((project) =>
        project.assignedDesignerId
          ? (userNames.get(project.assignedDesignerId) ??
            project.assignedDesignerNameSnapshot ??
            'Unknown')
          : 'Unassigned',
      ),
    ),
    projectsBySalesOwner: countBy(projects.map((project) => project.salesOwnerNameSnapshot)),
    projectsByStatus: countBy(projects.map((project) => project.status)),
    completedByMonth: countBy(
      completed.map((project) => (project.completedAt ?? project.updatedAt).slice(0, 7)),
    ),
    revisionCounts: projects
      .filter((project) => project.revisionNumber > 0)
      .map((project) => ({ label: project.projectCode, value: project.revisionNumber }))
      .sort((a, b) => b.value - a.value),
  };
}
