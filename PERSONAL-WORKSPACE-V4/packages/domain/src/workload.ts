import type { AppUser, AvailabilityStatus, Project, WorkloadMetrics } from './types';

export function isActiveProject(project: Project): boolean {
  return (
    project.status !== 'Completed' &&
    project.status !== 'Archived' &&
    project.status !== 'Cancelled'
  );
}

export function classifyAvailability(
  availabilityPercent: number,
  configuredStatus: AvailabilityStatus,
): AvailabilityStatus {
  if (configuredStatus === 'Unavailable') return 'Unavailable';
  if (configuredStatus === 'FullyLoaded') return 'FullyLoaded';
  if (availabilityPercent >= 50) return 'Available';
  if (availabilityPercent >= 20) return 'Limited';
  return 'FullyLoaded';
}

export function calculateDesignerWorkload(
  designer: AppUser,
  projects: readonly Project[],
  now = new Date(),
): WorkloadMetrics {
  const activeProjects = projects.filter(
    (project) => project.assignedDesignerId === designer.id && isActiveProject(project),
  );
  const activeEstimatedHours = activeProjects.reduce(
    (sum, project) => sum + project.estimatedHours,
    0,
  );
  const activeActualHours = activeProjects.reduce((sum, project) => sum + project.actualHours, 0);
  const remainingCapacity = Math.max(designer.weeklyCapacityHours - activeEstimatedHours, 0);
  const availabilityPercent =
    designer.weeklyCapacityHours > 0
      ? Math.round((remainingCapacity / designer.weeklyCapacityHours) * 100)
      : 0;
  const utilizationPercent =
    designer.weeklyCapacityHours > 0
      ? Math.round((activeEstimatedHours / designer.weeklyCapacityHours) * 100)
      : 0;
  const today = now.toISOString().slice(0, 10);
  const overdueProjectCount = activeProjects.filter(
    (project) => Boolean(project.requiredDeliveryDate) && project.requiredDeliveryDate < today,
  ).length;
  const nextDeadline =
    activeProjects
      .map((project) => project.requiredDeliveryDate)
      .sort((a, b) => a.localeCompare(b))[0] ?? null;

  return {
    designer,
    activeProjectCount: activeProjects.length,
    activeEstimatedHours,
    activeActualHours,
    weeklyCapacityHours: designer.weeklyCapacityHours,
    remainingCapacity,
    utilizationPercent,
    availabilityPercent,
    overdueProjectCount,
    nextDeadline,
    classification: classifyAvailability(availabilityPercent, designer.availabilityStatus),
    activeProjects: [...activeProjects].sort((a, b) =>
      a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate),
    ),
  };
}

export function calculateAllDesignerWorkloads(
  users: readonly AppUser[],
  projects: readonly Project[],
  now = new Date(),
): WorkloadMetrics[] {
  return users
    .filter((user) => user.role === 'Designer' && user.isActive)
    .map((designer) => calculateDesignerWorkload(designer, projects, now))
    .sort((a, b) => {
      const unavailableDifference =
        Number(a.classification === 'Unavailable') - Number(b.classification === 'Unavailable');
      if (unavailableDifference !== 0) return unavailableDifference;
      if (b.availabilityPercent !== a.availabilityPercent) {
        return b.availabilityPercent - a.availabilityPercent;
      }
      if (a.overdueProjectCount !== b.overdueProjectCount) {
        return a.overdueProjectCount - b.overdueProjectCount;
      }
      return a.designer.displayName.localeCompare(b.designer.displayName);
    });
}
