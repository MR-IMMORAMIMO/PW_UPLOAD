import {
  isActiveProject,
  projectStatuses,
  statusLabels,
  type AppUser,
  type PeriodActivityProject,
  type PeriodActivityReport,
  type Project,
  type ProjectActivity,
  type ProjectStatus,
  type ProjectWorkspace,
  type WorkSession,
  workSessionState,
} from '@scli/domain';

function dateKey(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function inPeriod(value: string, from: string, to: string, timeZone: string): boolean {
  const key = dateKey(value, timeZone);
  return key >= from && key <= to;
}

function atOrBefore(value: string, to: string, timeZone: string): boolean {
  return dateKey(value, timeZone) <= to;
}

function isProjectStatus(value: string | null): value is ProjectStatus {
  return Boolean(value && projectStatuses.includes(value as ProjectStatus));
}

function statusAtEnd(
  project: Project,
  activities: ProjectActivity[],
  to: string,
  timeZone: string,
): ProjectStatus {
  const statusEvents = activities
    .filter(
      (activity) =>
        atOrBefore(activity.createdAt, to, timeZone) &&
        (activity.fieldName === 'status' || activity.actionType === 'ProjectCreated') &&
        isProjectStatus(activity.newValue),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (statusEvents.at(-1)?.newValue as ProjectStatus | undefined) ?? project.status;
}

function ownerAtEnd(
  project: Project,
  activities: ProjectActivity[],
  users: Map<string, AppUser>,
  to: string,
  timeZone: string,
): { id: string; name: string } {
  const ownerEvents = activities
    .filter(
      (activity) =>
        atOrBefore(activity.createdAt, to, timeZone) &&
        activity.fieldName === 'salesOwnerId' &&
        activity.newValue,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ownerId = ownerEvents.at(-1)?.newValue ?? project.salesOwnerId;
  return {
    id: ownerId,
    name:
      users.get(ownerId)?.displayName ??
      (ownerId === project.salesOwnerId ? project.salesOwnerNameSnapshot : 'Former Sales contact'),
  };
}

function cancellationReason(activity: ProjectActivity | undefined): string {
  if (!activity) return '';
  const marker = 'Reason:';
  const index = activity.message.indexOf(marker);
  return index >= 0 ? activity.message.slice(index + marker.length).trim() : '';
}

export function buildPeriodActivityReport(input: {
  projects: Project[];
  activities: Map<string, ProjectActivity[]>;
  workspaces: Map<string, ProjectWorkspace>;
  workSessions?: Map<string, WorkSession[]>;
  toolSessions?: Map<string, Array<{ startedAt: string }>>;
  canonicalRevisions?: Map<string, Array<{ revisionId: string; createdAt: string }>>;
  canonicalPackages?: Map<
    string,
    Array<{ packageId: string; createdAt: string; issuedAt: string | null }>
  >;
  canonicalOutputs?: Map<string, Array<{ outputId: string; lifecycleState: string }>>;
  readiness?: Map<
    string,
    NonNullable<PeriodActivityReport['currentProjects']>[number]['readiness']
  >;
  users: AppUser[];
  from: string;
  to: string;
  salesOwnerId?: string;
  timeZone: string;
  now?: Date;
}): PeriodActivityReport {
  const now = input.now ?? new Date();
  const today = dateKey(now.toISOString(), input.timeZone);
  const currentProjects: NonNullable<PeriodActivityReport['currentProjects']> = [];
  const sessionRows: NonNullable<PeriodActivityReport['sessions']> = [];
  const users = new Map(input.users.map((user) => [user.id, user]));
  const rows: PeriodActivityProject[] = [];
  let deliverablesCompleted = 0;

  for (const project of input.projects) {
    const currentWorkspace = input.workspaces.get(project.id);
    if ((!input.salesOwnerId || project.salesOwnerId === input.salesOwnerId) && currentWorkspace) {
      const openActions = currentWorkspace.actions.filter(
        (item) => !['Completed', 'Cancelled'].includes(item.status),
      );
      currentProjects.push({
        projectId: project.id,
        projectName: project.projectName,
        projectCode: project.projectCode,
        clientName: project.clientName,
        salesOwnerName:
          users.get(project.salesOwnerId)?.displayName ?? project.salesOwnerNameSnapshot,
        status: project.status,
        designerName: project.assignedDesignerNameSnapshot ?? 'Unassigned',
        stage: project.designStage,
        dueDate: project.requiredDeliveryDate,
        revisions: new Set(
          (input.canonicalRevisions?.get(project.id) ?? []).map((item) => item.revisionId),
        ).size,
        generatedOutputs:
          input.canonicalOutputs
            ?.get(project.id)
            ?.filter((item) => item.lifecycleState === 'FINALIZED').length ?? 0,
        issuedPackages:
          input.canonicalPackages?.get(project.id)?.filter((item) => item.issuedAt !== null)
            .length ?? 0,
        readiness: input.readiness?.get(project.id) ?? null,
        failedQualityChecks:
          currentWorkspace.health.checks?.filter((check) => !check.passed).length ?? 0,
        luminaires: currentWorkspace.luminaires.length,
        missingDatasheets: currentWorkspace.luminaires.filter((item) => !item.datasheetPath).length,
        missingImages: currentWorkspace.luminaires.filter((item) => !item.imagePath).length,
        incompleteTechnical: currentWorkspace.luminaires.filter(
          (item) => !item.wattage.trim() || !item.lumens.trim() || !item.lightColor.trim(),
        ).length,
        openRequirements: currentWorkspace.requirements.filter(
          (item) => !['Received', 'NotRequired'].includes(item.status),
        ).length,
        openActions: openActions.length,
        overdueActions: openActions.filter((item) => item.dueDate && item.dueDate < today).length,
        unresolvedReviews: currentWorkspace.health.unresolvedReviews,
        upcomingMeetings: currentWorkspace.meetings.filter(
          (item) =>
            Date.parse(item.startAt) >= now.getTime() &&
            !['Cancelled', 'Held'].includes(item.status),
        ).length,
        deliverables: currentWorkspace.deliverables.filter((item) => item.status !== 'NotRequired')
          .length,
        completedDeliverables: currentWorkspace.deliverables.filter(
          (item) => item.status === 'Completed',
        ).length,
      });
    }
    if (!atOrBefore(project.createdAt, input.to, input.timeZone)) continue;
    const activities = input.activities.get(project.id) ?? [];
    const workspace = input.workspaces.get(project.id);
    const sessions = (input.workSessions?.get(project.id) ?? []).filter((session) =>
      inPeriod(session.startedAt, input.from, input.to, input.timeZone),
    );
    const toolSessions = (input.toolSessions?.get(project.id) ?? []).filter((session) =>
      inPeriod(session.startedAt, input.from, input.to, input.timeZone),
    );
    const workSeconds = sessions.reduce(
      (total, session) =>
        session.endedAt
          ? total +
            Math.max(
              0,
              Math.floor(
                (Date.parse(session.endedAt) -
                  Date.parse(session.startedAt) -
                  session.accumulatedPausedMs) /
                  1000,
              ),
            )
          : total,
      0,
    );
    const owner = ownerAtEnd(project, activities, users, input.to, input.timeZone);
    if (input.salesOwnerId && owner.id !== input.salesOwnerId) continue;
    for (const session of sessions)
      sessionRows.push({
        ...(session.attribution ?? {}),
        id: session.id,
        projectId: project.id,
        projectName: project.projectName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        day: dateKey(session.startedAt, input.timeZone),
        state: workSessionState(session),
        pausedSeconds: Math.floor(
          (session.accumulatedPausedMs +
            (session.pausedAt && !session.endedAt
              ? Math.max(0, now.getTime() - Date.parse(session.pausedAt))
              : 0)) /
            1000,
        ),
        netSeconds: session.endedAt
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(session.endedAt) -
                  Date.parse(session.startedAt) -
                  session.accumulatedPausedMs) /
                  1000,
              ),
            )
          : null,
      });
    const periodActivities = activities.filter(
      (activity) =>
        activity.actionType !== 'LegacyImported' &&
        inPeriod(activity.createdAt, input.from, input.to, input.timeZone),
    );
    const workspaceActivities =
      workspace?.activity.filter((activity) =>
        inPeriod(activity.createdAt, input.from, input.to, input.timeZone),
      ) ?? [];
    const packageRecords = input.canonicalPackages
      ? [
          ...new Map(
            (input.canonicalPackages.get(project.id) ?? []).map((record) => [
              record.packageId,
              record,
            ]),
          ).values(),
        ]
      : (workspace?.revisionPackages ?? []);
    const periodPackages = packageRecords.filter((record) =>
      inPeriod(record.createdAt, input.from, input.to, input.timeZone),
    );
    const packageCount = periodPackages.length;
    const revisionIds = new Set(
      workspaceActivities
        .filter((activity) => activity.entityType === 'Revision')
        .map((activity) => activity.entityId ?? activity.id),
    );
    const canonicalInPeriod = input.canonicalRevisions
      ?.get(project.id)
      ?.filter((record) => inPeriod(record.createdAt, input.from, input.to, input.timeZone));
    const revisionCount = input.canonicalRevisions
      ? new Set((canonicalInPeriod ?? []).map((record) => record.revisionId)).size
      : revisionIds.size;
    const completedDeliverables =
      workspace?.deliverables.filter(
        (deliverable) =>
          deliverable.status === 'Completed' &&
          inPeriod(deliverable.updatedAt, input.from, input.to, input.timeZone),
      ).length ?? 0;
    deliverablesCompleted += completedDeliverables;
    // Legacy folders are historical reference records, not proof that work happened in a report
    // period. Their import audit is also excluded above, so onboarding never inflates activity.
    const createdInPeriod =
      !project.isLegacyProject && inPeriod(project.createdAt, input.from, input.to, input.timeZone);
    const completedEvent = periodActivities.find(
      (activity) => activity.actionType === 'ProjectCompleted',
    );
    const cancelledEvent = periodActivities.find(
      (activity) => activity.actionType === 'ProjectCancelled',
    );
    const reopenedEvent = periodActivities.find(
      (activity) => activity.actionType === 'ProjectReopened',
    );
    const activityDates = [
      ...(canonicalInPeriod ?? []).map((record) => record.createdAt),
      ...periodActivities.map((activity) => activity.createdAt),
      ...workspaceActivities.map((activity) => activity.createdAt),
      ...periodPackages.map((record) => record.createdAt),
    ].sort();
    const workedOn =
      sessions.length > 0 ||
      toolSessions.length > 0 ||
      createdInPeriod ||
      revisionCount > 0 ||
      periodActivities.length > 0 ||
      workspaceActivities.length > 0 ||
      packageCount > 0;
    if (!workedOn) continue;
    rows.push({
      ...(input.workSessions
        ? {
            workSeconds,
            workSessionCount: sessions.length,
            openWorkSessionCount: sessions.filter((session) => !session.endedAt).length,
          }
        : {}),
      ...(input.toolSessions ? { toolSessionCount: toolSessions.length } : {}),
      projectId: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      clientName: project.clientName,
      salesOwnerId: owner.id,
      salesOwnerName: owner.name,
      statusAtPeriodEnd: statusAtEnd(project, activities, input.to, input.timeZone),
      workedOn,
      createdInPeriod,
      completedInPeriod: Boolean(completedEvent),
      cancelledInPeriod: Boolean(cancelledEvent),
      reopenedInPeriod: Boolean(reopenedEvent),
      revisionCount,
      completedDeliverableCount: completedDeliverables,
      packageCount,
      activityCount: periodActivities.length + workspaceActivities.length + packageCount,
      cancellationReason: cancellationReason(cancelledEvent),
      lastActivityAt: activityDates.at(-1) ?? null,
    });
  }

  rows.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
  const bySales = new Map<string, number>();
  const byStatus = new Map<ProjectStatus, number>();
  for (const row of rows) {
    bySales.set(row.salesOwnerName, (bySales.get(row.salesOwnerName) ?? 0) + 1);
    byStatus.set(row.statusAtPeriodEnd, (byStatus.get(row.statusAtPeriodEnd) ?? 0) + 1);
  }
  const activeRows = rows.filter((row) =>
    isActiveProject({ status: row.statusAtPeriodEnd } as Project),
  );
  return {
    from: input.from,
    to: input.to,
    generatedAt: now.toISOString(),
    currentProjects,
    sessions: sessionRows.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    projectsWorkedOn: rows.length,
    newProjects: rows.filter((row) => row.createdInPeriod).length,
    completedProjects: rows.filter((row) => row.completedInPeriod).length,
    activeAtEnd: activeRows.length,
    waitingAtEnd: rows.filter((row) =>
      ['WaitingForInformation', 'WaitingForSales'].includes(row.statusAtPeriodEnd),
    ).length,
    onHoldAtEnd: rows.filter((row) => row.statusAtPeriodEnd === 'OnHold').length,
    cancelledProjects: rows.filter((row) => row.cancelledInPeriod).length,
    reopenedProjects: rows.filter((row) => row.reopenedInPeriod).length,
    revisionsCreated: rows.reduce((sum, row) => sum + row.revisionCount, 0),
    packagesCreated: rows.reduce((sum, row) => sum + row.packageCount, 0),
    deliverablesCompleted,
    bySales: [...bySales].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
    byStatus: [...byStatus]
      .sort((a, b) => b[1] - a[1])
      .map(([status, value]) => ({ label: statusLabels[status], value })),
    projects: rows,
  };
}
