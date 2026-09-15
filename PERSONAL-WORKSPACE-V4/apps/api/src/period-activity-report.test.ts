import { describe, expect, it } from 'vitest';
import type { ProjectActivity, ProjectWorkspace } from '@scli/domain';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import { buildPeriodActivityReport } from './period-activity-report';

function activity(
  projectId: string,
  input: Partial<ProjectActivity> & Pick<ProjectActivity, 'actionType' | 'createdAt'>,
): ProjectActivity {
  return {
    id: `${projectId}-${input.actionType}-${input.createdAt}`,
    projectId,
    fieldName: null,
    oldValue: null,
    newValue: null,
    message: input.actionType,
    changedById: seedUserIds.designerOne,
    changedByNameSnapshot: 'Lina Mansour',
    ...input,
  };
}

describe('period activity report', () => {
  it('uses canonical package identities, finalized outputs and revision readiness instead of legacy package rows', () => {
    const project = { ...seedProjects[0]!, createdAt: '2026-07-01T08:00:00.000Z' };
    const workspace = {
      actions: [],
      luminaires: [],
      requirements: [],
      meetings: [],
      activity: [],
      deliverables: [],
      health: { unresolvedReviews: 0, checks: [{ passed: false }, { passed: true }] },
      revisionPackages: [{ id: 'legacy', createdAt: '2026-08-01T10:00:00.000Z' }],
    } as unknown as ProjectWorkspace;
    const report = buildPeriodActivityReport({
      projects: [project],
      activities: new Map(),
      workspaces: new Map([[project.id, workspace]]),
      users: seedUsers,
      from: '2026-08-01',
      to: '2026-08-01',
      timeZone: 'Asia/Dubai',
      canonicalPackages: new Map([
        [
          project.id,
          [
            {
              packageId: 'issued',
              createdAt: '2026-08-01T12:00:00.000Z',
              issuedAt: '2026-08-01T13:00:00.000Z',
            },
            { packageId: 'draft', createdAt: '2026-08-01T14:00:00.000Z', issuedAt: null },
          ],
        ],
      ]),
      canonicalOutputs: new Map([
        [
          project.id,
          [
            { outputId: 'saved', lifecycleState: 'FINALIZED' },
            { outputId: 'pending', lifecycleState: 'DRAFT' },
          ],
        ],
      ]),
      canonicalRevisions: new Map([
        [project.id, [{ revisionId: 'rev', createdAt: '2026-08-01T10:00:00.000Z' }]],
      ]),
      readiness: new Map([
        [
          project.id,
          {
            revisionId: 'rev',
            revisionLabel: 'REV_01',
            level: 'BLOCKED',
            blockers: 2,
            warnings: 1,
          },
        ],
      ]),
    });
    expect(report.packagesCreated).toBe(2);
    expect(report.currentProjects?.[0]).toMatchObject({
      revisions: 1,
      generatedOutputs: 1,
      issuedPackages: 1,
      failedQualityChecks: 1,
      readiness: { level: 'BLOCKED', blockers: 2 },
    });
    expect(
      buildPeriodActivityReport({
        projects: [project],
        activities: new Map(),
        workspaces: new Map([[project.id, workspace]]),
        users: seedUsers,
        from: '2026-08-01',
        to: '2026-08-01',
        timeZone: 'Asia/Dubai',
        canonicalPackages: new Map(),
      }).packagesCreated,
    ).toBe(0);
  });

  it('includes an ongoing pause in pause details while leaving open session time out of closed totals', () => {
    const project = { ...seedProjects[0]!, createdAt: '2026-07-01T08:00:00.000Z' };
    const report = buildPeriodActivityReport({
      projects: [project],
      activities: new Map(),
      workspaces: new Map(),
      users: seedUsers,
      from: '2026-08-01',
      to: '2026-08-01',
      timeZone: 'Asia/Dubai',
      now: new Date('2026-08-01T10:30:00.000Z'),
      workSessions: new Map([
        [
          project.id,
          [
            {
              id: 'paused',
              projectId: project.id,
              startedAt: '2026-08-01T09:00:00.000Z',
              createdAt: '2026-08-01T09:00:00.000Z',
              endedAt: null,
              pausedAt: '2026-08-01T10:00:00.000Z',
              accumulatedPausedMs: 600_000,
            },
          ],
        ],
      ]),
    });
    expect(report.sessions?.[0]).toMatchObject({
      pausedSeconds: 2400,
      netSeconds: null,
      state: 'PAUSED',
    });
    expect(report.projects[0]).toMatchObject({ workSeconds: 0, openWorkSessionCount: 1 });
  });
  it('uses the period-end owner/status and counts work, lifecycle events and workspace output', () => {
    const base = seedProjects[0]!;
    const project = {
      ...base,
      createdAt: '2026-07-31T22:30:00.000Z',
      status: 'InProgress' as const,
    };
    const activities = [
      activity(project.id, {
        actionType: 'ProjectCreated',
        createdAt: project.createdAt,
        newValue: 'NotStarted',
      }),
      activity(project.id, {
        actionType: 'SalesOwnerChanged',
        fieldName: 'salesOwnerId',
        oldValue: seedUserIds.salesOne,
        newValue: seedUserIds.salesTwo,
        createdAt: '2026-08-01T04:00:00.000Z',
      }),
      activity(project.id, {
        actionType: 'ProjectCompleted',
        fieldName: 'status',
        oldValue: 'InProgress',
        newValue: 'Completed',
        createdAt: '2026-08-01T10:00:00.000Z',
      }),
      activity(project.id, {
        actionType: 'ProjectReopened',
        fieldName: 'status',
        oldValue: 'Completed',
        newValue: 'InProgress',
        createdAt: '2026-08-01T11:00:00.000Z',
      }),
    ];
    const workspace = {
      actions: [],
      luminaires: [],
      requirements: [],
      meetings: [],
      health: { unresolvedReviews: 0 },
      activity: [
        {
          id: 'wa-1',
          projectId: project.id,
          entityType: 'Revision',
          entityId: 'revision-1',
          action: 'Created',
          title: 'REV_01',
          detail: 'Created revision',
          createdAt: '2026-08-01T12:00:00.000Z',
        },
      ],
      revisionPackages: [{ id: 'package-1', createdAt: '2026-08-01T13:00:00.000Z' }],
      deliverables: [
        { id: 'deliverable-1', status: 'Completed', updatedAt: '2026-08-01T14:00:00.000Z' },
      ],
    } as unknown as ProjectWorkspace;

    const report = buildPeriodActivityReport({
      projects: [project],
      activities: new Map([[project.id, activities]]),
      workspaces: new Map([[project.id, workspace]]),
      users: seedUsers,
      from: '2026-08-01',
      to: '2026-08-01',
      timeZone: 'Asia/Dubai',
    });

    expect(report).toMatchObject({
      projectsWorkedOn: 1,
      newProjects: 1,
      completedProjects: 1,
      reopenedProjects: 1,
      activeAtEnd: 1,
      revisionsCreated: 1,
      packagesCreated: 1,
      deliverablesCompleted: 1,
    });
    expect(report.projects[0]).toMatchObject({
      salesOwnerId: seedUserIds.salesTwo,
      salesOwnerName: 'Omar Khalid',
      statusAtPeriodEnd: 'InProgress',
      activityCount: 6,
    });
  });

  it('counts canonical creations once and ignores legacy revision edits in canonical mode', () => {
    const project = { ...seedProjects[0]!, createdAt: '2026-07-01T08:00:00.000Z' };
    const report = buildPeriodActivityReport({
      projects: [project],
      activities: new Map(),
      workspaces: new Map(),
      users: seedUsers,
      canonicalRevisions: new Map([
        [
          project.id,
          [
            { revisionId: 'r1', createdAt: '2026-08-01T12:00:00.000Z' },
            { revisionId: 'r1', createdAt: '2026-08-01T12:00:00.000Z' },
            { revisionId: 'older', createdAt: '2026-07-01T12:00:00.000Z' },
          ],
        ],
      ]),
      from: '2026-08-01',
      to: '2026-08-01',
      timeZone: 'Asia/Dubai',
    });
    expect(report.revisionsCreated).toBe(1);
    expect(report.projectsWorkedOn).toBe(1);
    expect(report.projects[0]?.lastActivityAt).toBe('2026-08-01T12:00:00.000Z');
  });

  it('does not treat legacy imports as work and preserves cancellation reasons', () => {
    const legacy = {
      ...seedProjects[1]!,
      isLegacyProject: true,
      createdAt: '2026-08-01T08:00:00.000Z',
    };
    const cancelled = { ...seedProjects[2]!, createdAt: '2026-07-01T08:00:00.000Z' };
    const legacyEvents = [
      activity(legacy.id, {
        actionType: 'LegacyImported',
        createdAt: '2026-08-01T09:00:00.000Z',
      }),
    ];
    const cancelledEvents = [
      activity(cancelled.id, {
        actionType: 'ProjectCancelled',
        fieldName: 'status',
        newValue: 'Cancelled',
        message: 'Project cancelled. Reason: Client stopped the development',
        createdAt: '2026-08-01T10:00:00.000Z',
      }),
    ];

    const report = buildPeriodActivityReport({
      projects: [legacy, cancelled],
      activities: new Map([
        [legacy.id, legacyEvents],
        [cancelled.id, cancelledEvents],
      ]),
      workspaces: new Map(),
      users: seedUsers,
      from: '2026-08-01',
      to: '2026-08-01',
      timeZone: 'Asia/Dubai',
    });

    expect(report.projects).toHaveLength(1);
    expect(report.cancelledProjects).toBe(1);
    expect(report.projects[0]).toMatchObject({
      projectId: cancelled.id,
      cancelledInPeriod: true,
      cancellationReason: 'Client stopped the development',
    });
  });
});

it('separates net closed work time, open sessions and tool usage within the local-date cohort', () => {
  const project = { ...seedProjects[0]!, createdAt: '2026-07-01T00:00:00.000Z' };
  const startedAt = '2026-07-31T21:00:00.000Z'; // August 1 in Dubai
  const base = {
    id: 'work-1',
    projectId: project.id,
    startedAt,
    endedAt: '2026-07-31T23:00:00.000Z',
    pausedAt: null,
    accumulatedPausedMs: 30 * 60_000,
    createdAt: startedAt,
  };
  const report = buildPeriodActivityReport({
    projects: [project],
    activities: new Map(),
    workspaces: new Map(),
    users: seedUsers,
    from: '2026-08-01',
    to: '2026-08-01',
    timeZone: 'Asia/Dubai',
    workSessions: new Map([
      [
        project.id,
        [
          {
            ...base,
            attribution: { actorId: seedUsers[0]!.id, actorName: seedUsers[0]!.displayName },
          },
          { ...base, id: 'work-2', endedAt: null },
          { ...base, id: 'older', startedAt: '2026-07-30T21:00:00.000Z' },
        ],
      ],
    ]),
    toolSessions: new Map([[project.id, [{ startedAt }]]]),
  });
  expect(report.projects[0]).toMatchObject({
    workSeconds: 5400,
    workSessionCount: 2,
    openWorkSessionCount: 1,
    toolSessionCount: 1,
    workedOn: true,
  });
  expect(report.sessions).toHaveLength(2);
  expect(report.sessions?.find((s) => s.id === 'work-1')?.actorId).toBe(seedUsers[0]!.id);
  expect(report.sessions?.find((s) => s.id === 'work-2')?.actorId).toBeUndefined();
  expect(report.sessions?.find((s) => s.id === 'work-1')).toMatchObject({
    day: '2026-08-01',
    netSeconds: 5400,
    pausedSeconds: 1800,
    state: 'STOPPED',
  });
  expect(report.sessions?.find((s) => s.id === 'work-2')?.netSeconds).toBeNull();
});

it('reports current technical and follow-up state independently of historical activity dates', () => {
  const project = { ...seedProjects[0]!, createdAt: '2026-09-01T00:00:00.000Z' };
  const workspace = {
    actions: [
      { status: 'Open', dueDate: '2026-09-10' },
      { status: 'Completed', dueDate: '2026-09-09' },
    ],
    luminaires: [
      {
        datasheetPath: '',
        imagePath: 'managed-image',
        wattage: '10',
        lumens: '900',
        lightColor: '3000K',
      },
      { datasheetPath: 'managed-pdf', imagePath: '', wattage: '', lumens: '', lightColor: '' },
    ],
    requirements: [{ status: 'Received' }, { status: 'Pending' }],
    meetings: [{ startAt: '2026-09-12T10:00:00.000Z', status: 'Scheduled' }],
    health: { unresolvedReviews: 2 },
    deliverables: [{ status: 'Completed' }, { status: 'NotRequired' }],
  } as unknown as ProjectWorkspace;
  const input = {
    projects: [project],
    workspaces: new Map([[project.id, workspace]]),
    activities: new Map(),
    users: seedUsers,
    from: '2026-08-01',
    to: '2026-08-31',
    timeZone: 'Asia/Dubai',
    now: new Date('2026-09-11T12:00:00.000Z'),
  };
  const report = buildPeriodActivityReport(input);
  expect(report.projects).toEqual([]);
  expect(report.currentProjects).toEqual([
    expect.objectContaining({
      luminaires: 2,
      missingDatasheets: 1,
      missingImages: 1,
      incompleteTechnical: 1,
      openRequirements: 1,
      openActions: 1,
      overdueActions: 1,
      unresolvedReviews: 2,
      upcomingMeetings: 1,
      deliverables: 1,
      completedDeliverables: 1,
    }),
  ]);
  expect(
    buildPeriodActivityReport({ ...input, salesOwnerId: 'another-owner' }).currentProjects,
  ).toEqual([]);
});
