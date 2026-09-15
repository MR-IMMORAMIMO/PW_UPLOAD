import { describe, expect, it } from 'vitest';
import type { CanonicalRevisionRecord, Project, ProjectWorkspace } from '@scli/domain';
import type { WorkflowHistoryResponse } from '@scli/contracts';
import {
  buildTimelineEvents,
  filterTimelineEvents,
  timelinePageCount,
  timelinePageEvents,
  timelineEventIconRole,
  timelineEventStatusDisplay,
  timelineEventTypeDisplay,
  timelinePaginationWindow,
  type TimelineEvent,
} from './workflowTimelineViewModel';

const project = { id: 'p1', projectCode: 'P', projectName: 'Project' } as Project;
const workspace = {
  revisions: [
    {
      id: 'r1',
      revisionNumber: 2,
      title: 'Issue',
      status: 'Issued',
      issuedAt: '2026-01-02T00:00:00.000Z',
      summary: '',
      changeLog: '',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  meetings: [
    {
      id: 'm1',
      title: 'Coordination',
      startAt: '2026-01-03T00:00:00.000Z',
      agenda: '',
      notes: '',
      decisions: '',
      status: 'Held',
    },
  ],
  actions: [
    {
      id: 'a1',
      title: 'Check',
      details: '',
      status: 'Open',
      completedAt: null,
      createdAt: '2026-01-04T00:00:00.000Z',
    },
  ],
  activity: [
    {
      id: 'x1',
      title: 'Recorded activity',
      detail: '',
      action: 'Updated',
      createdAt: '2026-01-05T00:00:00.000Z',
    },
  ],
} as unknown as ProjectWorkspace;
const canonicalRevision = (
  overrides: Partial<CanonicalRevisionRecord> = {},
): CanonicalRevisionRecord => ({
  revisionId: 'r1',
  projectId: 'p1',
  revisionSequence: 2,
  revisionLabel: 'REV_02',
  purpose: null,
  internalNote: null,
  lifecycleState: 'FINALIZED',
  projectSnapshot: null,
  luminaireSnapshot: null,
  snapshotHash: null,
  createdById: null,
  createdByName: null,
  provenanceClassification: 'CANONICAL',
  legacySourceId: null,
  failureReason: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  finalizedAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});
const canonicalRevisions = [canonicalRevision()];
const workflow = {
  transitions: [
    {
      transitionId: 'w1',
      toStatus: 'Planning',
      occurredAt: '2026-01-01T00:00:00.000Z',
      reason: null,
    },
    {
      transitionId: 'w2',
      toStatus: 'Planning',
      occurredAt: '2026-01-06T00:00:00.000Z',
      reason: null,
    },
  ],
  revisionCycles: [],
} as unknown as WorkflowHistoryResponse;

const paginationEvents = (count: number): TimelineEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `activity:${index + 1}`,
    category: 'activity',
    title: `Event ${index + 1}`,
    description: null,
    occurredAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    status: null,
    notes: null,
    actor: null,
    revisionSequence: null,
    canonicalLifecycleState: null,
    compatibilityStatus: null,
    compatibilityIssuedAt: null,
    activityEntityType: null,
  }));

describe('workflow timeline view model', () => {
  it('uses the recorded revision creator only for the creation event, never for finalization', () => {
    const revision = canonicalRevision({ createdByName: 'Original designer', finalizedAt: null });
    const history = { transitions: [] } as unknown as WorkflowHistoryResponse;
    expect(
      buildTimelineEvents(project, workspace, history, [revision]).find(
        (event) => event.category === 'revision',
      )?.actor,
    ).toBe('Original designer');
    expect(
      buildTimelineEvents(project, workspace, history, [
        { ...revision, finalizedAt: '2026-02-01T00:00:00.000Z' },
      ]).find((event) => event.category === 'revision')?.actor,
    ).toBeNull();
  });
  it('projects every canonical source chronologically with source-qualified stable IDs', () => {
    const events = buildTimelineEvents(project, workspace, workflow, canonicalRevisions);
    expect(events.map((event) => event.id)).toEqual([
      'workflow:w1',
      'revision:r1',
      'meeting:m1',
      'action:a1',
      'activity:x1',
      'workflow:w2',
    ]);
    expect(events.every((event) => event.actor === null)).toBe(true);
    expect(events.filter((event) => event.category === 'workflow')).toHaveLength(2);
  });

  it('shows manual canonical Revisions without compatibility and never fabricates state', () => {
    const preparing = canonicalRevision({
      revisionId: 'manual-20',
      revisionSequence: 20,
      revisionLabel: 'REV_20',
      purpose: 'Manual coordination revision',
      lifecycleState: 'PREPARING',
      finalizedAt: null,
    });
    const finalized = canonicalRevision({
      revisionId: 'manual-19',
      revisionSequence: 19,
      revisionLabel: 'REV_19',
      lifecycleState: 'FINALIZED',
    });
    const events = buildTimelineEvents(
      project,
      { ...workspace, revisions: [] },
      { transitions: [], revisionCycles: [] },
      [preparing, finalized],
    ).filter((event) => event.category === 'revision');

    expect(events.map((event) => event.id).sort()).toEqual([
      'revision:manual-19',
      'revision:manual-20',
    ]);
    expect(events.find((event) => event.id === 'revision:manual-20')).toMatchObject({
      title: 'REV_20',
      description: 'Manual coordination revision',
      canonicalLifecycleState: 'PREPARING',
      compatibilityStatus: null,
      notes: null,
    });
    expect(events.find((event) => event.id === 'revision:manual-19')).toMatchObject({
      canonicalLifecycleState: 'FINALIZED',
      compatibilityStatus: null,
      status: null,
      notes: null,
    });
  });

  it('enriches by exact UUID and keeps canonical lifecycle separate', () => {
    const events = buildTimelineEvents(
      project,
      workspace,
      { transitions: [], revisionCycles: [] },
      canonicalRevisions,
    );
    expect(events.find((event) => event.id === 'revision:r1')).toMatchObject({
      description: 'Issue',
      canonicalLifecycleState: 'FINALIZED',
      compatibilityStatus: 'Issued',
      compatibilityIssuedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('uses legacySourceId only as an explicit fallback', () => {
    const legacy = canonicalRevision({ revisionId: 'canonical-r1', legacySourceId: 'r1' });
    const event = buildTimelineEvents(project, workspace, { transitions: [], revisionCycles: [] }, [
      legacy,
    ]).find((item) => item.category === 'revision');
    expect(event).toMatchObject({
      id: 'revision:canonical-r1',
      description: 'Issue',
      compatibilityStatus: 'Issued',
    });
  });

  it('prefers exact UUID over legacy fallback', () => {
    const exact = {
      ...workspace.revisions[0]!,
      id: 'canonical-r1',
      title: 'Exact title',
      status: 'ReadyToIssue' as const,
    };
    const legacy = {
      ...workspace.revisions[0]!,
      id: 'legacy-r1',
      title: 'Legacy title',
      status: 'InternalReview' as const,
    };
    const event = buildTimelineEvents(
      project,
      { ...workspace, revisions: [legacy, exact] },
      { transitions: [], revisionCycles: [] },
      [canonicalRevision({ revisionId: 'canonical-r1', legacySourceId: 'legacy-r1' })],
    ).find((item) => item.category === 'revision');
    expect(event).toMatchObject({
      description: 'Exact title',
      compatibilityStatus: 'ReadyToIssue',
    });
  });

  it('never joins compatibility by revision sequence or number', () => {
    const event = buildTimelineEvents(
      project,
      {
        ...workspace,
        revisions: [{ ...workspace.revisions[0]!, id: 'different-id', revisionNumber: 2 }],
      },
      { transitions: [], revisionCycles: [] },
      [canonicalRevision({ revisionId: 'canonical-r2', revisionSequence: 2 })],
    ).find((item) => item.category === 'revision');
    expect(event).toMatchObject({
      id: 'revision:canonical-r2',
      compatibilityStatus: null,
      compatibilityIssuedAt: null,
      notes: null,
    });
  });

  it('projects the full canonical Revision set despite sparse compatibility', () => {
    const revisions = [
      canonicalRevision({ revisionId: 'r1', revisionSequence: 10, revisionLabel: 'REV_10' }),
      canonicalRevision({ revisionId: 'r19', revisionSequence: 19, revisionLabel: 'REV_19' }),
      canonicalRevision({
        revisionId: 'r20',
        revisionSequence: 20,
        revisionLabel: 'REV_20',
        lifecycleState: 'PREPARING',
        finalizedAt: null,
      }),
    ];
    const revisionEvents = buildTimelineEvents(
      project,
      workspace,
      { transitions: [], revisionCycles: [] },
      revisions,
    ).filter((event) => event.category === 'revision');
    expect(revisionEvents.map((event) => event.id)).toEqual([
      'revision:r1',
      'revision:r19',
      'revision:r20',
    ]);
  });

  it('uses deterministic ID ordering for equal timestamps and never invents events', () => {
    const equal = {
      ...workspace,
      activity: [
        { id: 'z', title: 'Z', detail: '', action: '', createdAt: '2026-01-10T00:00:00.000Z' },
        { id: 'a', title: 'A', detail: '', action: '', createdAt: '2026-01-10T00:00:00.000Z' },
      ],
    } as ProjectWorkspace;
    expect(
      buildTimelineEvents(project, equal, { transitions: [], revisionCycles: [] }, [])
        .filter((event) => event.occurredAt === '2026-01-10T00:00:00.000Z')
        .map((event) => event.id),
    ).toEqual(['activity:a', 'activity:z']);
  });

  it('filters only the requested canonical category', () => {
    const events = buildTimelineEvents(project, workspace, workflow, canonicalRevisions);
    expect(filterTimelineEvents(events, 'all')).toHaveLength(6);
    expect(filterTimelineEvents(events, 'revision').map((event) => event.id)).toEqual([
      'revision:r1',
    ]);
    expect(filterTimelineEvents(events, 'meeting').map((event) => event.id)).toEqual([
      'meeting:m1',
    ]);
    expect(filterTimelineEvents(events, 'action').map((event) => event.id)).toEqual(['action:a1']);
  });

  it('omits only exact created mirrors while source revision, meeting, and action events remain filterable', () => {
    const mirrored = {
      ...workspace,
      activity: [
        {
          id: 'mirror-r1',
          entityType: 'Revision',
          entityId: 'r1',
          action: 'Created',
          title: 'Revision activity',
          detail: '',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'mirror-m1',
          entityType: 'Meeting',
          entityId: 'm1',
          action: 'Created',
          title: 'Meeting activity',
          detail: '',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'mirror-a1',
          entityType: 'Action',
          entityId: 'a1',
          action: 'Created',
          title: 'Action activity',
          detail: '',
          createdAt: '2026-01-04T00:00:00.000Z',
        },
      ],
    } as ProjectWorkspace;
    const events = buildTimelineEvents(
      project,
      mirrored,
      { transitions: [], revisionCycles: [] },
      canonicalRevisions,
    );
    expect(events.map((event) => event.id)).toEqual(['revision:r1', 'meeting:m1', 'action:a1']);
    expect(filterTimelineEvents(events, 'revision').map((event) => event.id)).toEqual([
      'revision:r1',
    ]);
    expect(filterTimelineEvents(events, 'meeting').map((event) => event.id)).toEqual([
      'meeting:m1',
    ]);
    expect(filterTimelineEvents(events, 'action').map((event) => event.id)).toEqual(['action:a1']);
  });

  it('preserves orphan, unrelated, and same-looking activity without the exact created relation', () => {
    const preserved = {
      ...workspace,
      activity: [
        {
          id: 'orphan',
          entityType: 'Revision',
          entityId: 'missing-revision',
          action: 'Created',
          title: 'Orphan revision activity',
          detail: '',
          createdAt: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'unrelated',
          entityType: 'Document',
          entityId: 'd1',
          action: 'Created',
          title: 'Document activity',
          detail: '',
          createdAt: '2026-01-06T00:00:00.000Z',
        },
        {
          id: 'same-looking',
          entityType: 'Revision',
          entityId: null,
          action: 'Created',
          title: 'REV 02',
          detail: 'Issue',
          createdAt: '2026-01-07T00:00:00.000Z',
        },
      ],
    } as ProjectWorkspace;
    expect(
      buildTimelineEvents(
        project,
        preserved,
        { transitions: [], revisionCycles: [] },
        canonicalRevisions,
      ).map((event) => event.id),
    ).toEqual([
      'revision:r1',
      'meeting:m1',
      'action:a1',
      'activity:orphan',
      'activity:unrelated',
      'activity:same-looking',
    ]);
  });

  it('preserves same-entity historical updates and distinct repeated source records', () => {
    const repeated = {
      ...workspace,
      revisions: [...workspace.revisions, { ...workspace.revisions[0], id: 'r2' }],
      activity: [
        {
          id: 'revision-update',
          entityType: 'Revision',
          entityId: 'r1',
          action: 'Issued',
          title: 'Issue',
          detail: '',
          createdAt: '2026-01-05T00:00:00.000Z',
        },
      ],
    } as ProjectWorkspace;
    const repeatedWorkflow = {
      transitions: [
        {
          transitionId: 'w1',
          toStatus: 'Planning',
          occurredAt: '2026-01-01T00:00:00.000Z',
          reason: null,
        },
        {
          transitionId: 'w2',
          toStatus: 'Planning',
          occurredAt: '2026-01-06T00:00:00.000Z',
          reason: null,
        },
      ],
      revisionCycles: [],
    } as unknown as WorkflowHistoryResponse;
    const events = buildTimelineEvents(project, repeated, repeatedWorkflow, [
      canonicalRevision(),
      canonicalRevision({ revisionId: 'r2' }),
    ]);
    expect(
      events.filter((event) => event.category === 'revision').map((event) => event.id),
    ).toEqual(['revision:r1', 'revision:r2']);
    expect(events).toContainEqual(expect.objectContaining({ id: 'activity:revision-update' }));
    expect(events.filter((event) => event.category === 'workflow')).toHaveLength(2);
  });

  it('paginates chronologically in fixed nine-event pages', () => {
    expect(timelinePageCount(paginationEvents(9))).toBe(1);
    expect(timelinePageCount(paginationEvents(10))).toBe(2);
    expect(timelinePageCount(paginationEvents(19))).toBe(3);
    expect(timelinePageCount([])).toBe(0);
    expect(timelinePageEvents(paginationEvents(10), 1).map((event) => event.id)).toEqual([
      'activity:10',
    ]);
    expect(timelinePageEvents(paginationEvents(19), 1)).toHaveLength(9);
    expect(timelinePageEvents(paginationEvents(19), 2).map((event) => event.id)).toEqual([
      'activity:19',
    ]);
  });

  it('uses a bounded deterministic page-number window', () => {
    expect(timelinePaginationWindow(3, 2)).toEqual([0, 1, 2]);
    expect(timelinePaginationWindow(12, 5)).toEqual([0, 'ellipsis', 3, 4, 5, 6, 7, 'ellipsis', 11]);
  });

  it('humanizes presentation values and maps icons from structured canonical metadata', () => {
    const scopeUpdate: TimelineEvent = {
      id: 'activity:scope',
      category: 'activity',
      title: 'Project scope updated',
      description: null,
      occurredAt: '2026-01-10T00:00:00.000Z',
      status: 'ScopeUpdated',
      notes: null,
      actor: null,
      revisionSequence: null,
      canonicalLifecycleState: null,
      compatibilityStatus: null,
      compatibilityIssuedAt: null,
      activityEntityType: 'workspace',
    };
    const unknownActivity = { ...scopeUpdate, status: 'Updated', activityEntityType: 'Document' };
    const clientReview = { ...scopeUpdate, category: 'workflow' as const, status: 'ClientReview' };
    const revisionRequired = {
      ...scopeUpdate,
      category: 'workflow' as const,
      status: 'RevisionRequired',
    };

    expect(timelineEventTypeDisplay('workflow')).toBe('Workflow');
    expect(timelineEventTypeDisplay('revision')).toBe('Revision');
    expect(timelineEventStatusDisplay('InProgress')).toBe('In Progress');
    expect(timelineEventStatusDisplay('ScopeUpdated')).toBe('Scope Updated');
    expect(scopeUpdate.status).toBe('ScopeUpdated');
    expect(timelineEventIconRole({ ...scopeUpdate, category: 'revision' })).toBe('revision');
    expect(timelineEventIconRole({ ...scopeUpdate, category: 'meeting' })).toBe('meeting');
    expect(timelineEventIconRole({ ...scopeUpdate, category: 'action' })).toBe('action');
    expect(timelineEventIconRole(scopeUpdate)).toBe('scope-update');
    expect(timelineEventIconRole(unknownActivity)).toBe('activity');
    expect(timelineEventIconRole(clientReview)).toBe('client-review');
    expect(timelineEventIconRole(revisionRequired)).toBe('revision-required');
  });
});
