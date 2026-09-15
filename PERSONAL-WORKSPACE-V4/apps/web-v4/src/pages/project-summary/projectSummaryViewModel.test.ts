/**
 * Project Summary view-model tests (PW-V4-F3-P1).
 *
 * Protects canonical derivation, deterministic ordering, bounded previews,
 * empty states, next-action resolver, stage authority fallback, colored-icon
 * semantic mapping, and no-fabrication behavior — all PURE (no React).
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalRevisionRecord, Project } from '@scli/domain';
import type { ProjectActionItem, ProjectWorkspace, WorkspaceActivity } from '@scli/domain';
import type { WorkflowHistoryResponse } from '@scli/contracts';
import {
  ATTENTION_PREVIEW_CAPACITY,
  activityCategoryRole,
  activityRole,
  buildProjectSummaryModel,
  buildStageStrip,
  buildWorkflowCycle,
  classifyActivity,
  isOpenAction,
  latestRevision,
  rankAttention,
  RECENT_ACTIVITY_CAPACITY,
  recentActivity,
  resolveNextAction,
  workflowLabel,
  type AttentionItem,
} from './projectSummaryViewModel';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectCode: '001_SCT260809_TEST',
    projectName: 'Test Project',
    clientName: 'Acme',
    projectType: 'Commercial',
    description: '',
    salesOwnerId: 'u1',
    salesOwnerNameSnapshot: 'Sales',
    salesOwnerEmailSnapshot: 's@t',
    createdById: 'u1',
    createdByNameSnapshot: 'Sales',
    createdByEmailSnapshot: 's@t',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: '',
    designStage: 'DetailedDesign',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'InProgress',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 0,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-09-01',
    projectFolderUrl: null,
    revisionNumber: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<ProjectWorkspace> = {}): ProjectWorkspace {
  return {
    projectId: 'p1',
    folderPath: null,
    folderProfile: 'default',
    folderStructure: [],
    outputFolders: {} as ProjectWorkspace['outputFolders'],
    services: [],
    deliverables: [],
    lightingPackage: {} as ProjectWorkspace['lightingPackage'],
    luminaires: [],
    exports: [],
    revisionPackages: [],
    requirements: [],
    tags: [],
    scopeNotes: [],
    checklist: [],
    actions: [],
    meetings: [],
    reviewItems: [],
    revisions: [],
    documents: [],
    fileCenter: [],
    contacts: [],
    communications: [],
    activity: [],
    health: {
      score: 0,
      checklistPercent: 0,
      openRequirements: 0,
      blockingRequirements: 0,
      overdueActions: 0,
      unresolvedReviews: 0,
      checks: [],
    },
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowHistoryResponse> = {}): WorkflowHistoryResponse {
  return { transitions: [], revisionCycles: [], ...overrides };
}

function makeAction(overrides: Partial<ProjectActionItem> = {}): ProjectActionItem {
  return {
    id: 'a1',
    projectId: 'p1',
    title: 'Action',
    details: '',
    owner: 'Mohamed',
    ownerRole: '',
    dueDate: null,
    status: 'Open',
    priority: 'Normal',
    sourceType: 'Manual',
    sourceId: null,
    revisionId: null,
    categoryId: null,
    notes: '',
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCanonicalRevision(
  overrides: Partial<CanonicalRevisionRecord> = {},
): CanonicalRevisionRecord {
  return {
    revisionId: 'r1',
    projectId: 'p1',
    revisionSequence: 1,
    revisionLabel: 'REV_01',
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
    createdAt: '2026-08-01T00:00:00.000Z',
    finalizedAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLuminaire(
  overrides: Partial<ProjectWorkspace['luminaires'][number]> = {},
): ProjectWorkspace['luminaires'][number] {
  return {
    id: 'l1',
    projectId: 'p1',
    tag: 'DL01',
    category: '',
    imagePath: '',
    description: '',
    manufacturer: 'Maker',
    model: 'Model',
    wattage: '',
    lumens: '',
    lightColor: '',
    cri: '',
    beamAngle: '',
    ipRating: '',
    mounting: '',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    datasheetPath: 'DL01.pdf',
    location: '',
    unit: '',
    quantity: 1,
    notes: '',
    sourceName: '',
    dimensions: '',
    bodyColorFinish: '',
    rowVersion: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const NOW = new Date('2026-08-10T00:00:00.000Z');

describe('Summary snapshot (I/J/K/L)', () => {
  it('I: luminaire count comes from canonical workspace luminaires', () => {
    const workspace = makeWorkspace({
      luminaires: [
        {
          id: 'l1',
          projectId: 'p1',
          tag: 'A',
          category: '',
          imagePath: '',
          description: '',
          manufacturer: '',
          model: '',
          wattage: '',
          lumens: '',
          lightColor: '',
          cri: '',
          beamAngle: '',
          ipRating: '',
          mounting: '',
          cutout: '',
          driver: '',
          control: '',
          emergency: '',
          datasheetPath: '',
          location: '',
          unit: '',
          quantity: 1,
          notes: '',
          sourceName: '',
          dimensions: '',
          bodyColorFinish: '',
          rowVersion: 1,
          createdAt: '',
          updatedAt: '',
        } as ProjectWorkspace['luminaires'][number],
      ],
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace,
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.snapshot.luminaireCount).toBe(1);
    expect(model.snapshot.metrics.find((m) => m.key === 'luminaires')?.value).toBe('1');
  });

  it('J: revision metric handles no-revision truthfully', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.snapshot.currentRevisionLabel).toBe('No revision');
  });

  it('J: compatibility REV_10 cannot hide canonical REV_19', () => {
    const canonical = makeCanonicalRevision({
      revisionId: 'canonical-19',
      revisionSequence: 19,
      revisionLabel: 'REV_19',
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace({
        revisions: [
          {
            id: 'compat-10',
            revisionNumber: 10,
          } as ProjectWorkspace['revisions'][number],
        ],
      }),
      workflow: makeWorkflow(),
      canonicalRevisions: [canonical],
      now: NOW,
    });
    expect(model.snapshot.currentRevisionLabel).toBe('REV_19');
    expect(latestRevision([canonical])?.revisionId).toBe('canonical-19');
  });

  it('J: highest canonical sequence wins across lifecycle, gaps, and shuffled input', () => {
    const rev18 = makeCanonicalRevision({ revisionSequence: 18, revisionLabel: 'REV_18' });
    const rev19 = makeCanonicalRevision({
      revisionId: 'canonical-19',
      revisionSequence: 19,
      revisionLabel: 'REV_19',
      lifecycleState: 'FINALIZED',
    });
    const rev20 = makeCanonicalRevision({
      revisionId: 'canonical-20',
      revisionSequence: 20,
      revisionLabel: 'REV_20',
      lifecycleState: 'PREPARING',
      finalizedAt: null,
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [rev20, rev18, rev19],
      now: NOW,
    });
    expect(model.snapshot.currentRevisionLabel).toBe('REV_20');
    expect(latestRevision([rev20, rev18, rev19])?.revisionId).toBe('canonical-20');
    expect(latestRevision([rev18, rev20])?.revisionSequence).toBe(20);
  });

  it('J: finalized-only canonical state remains current', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [
        makeCanonicalRevision({ revisionSequence: 19, revisionLabel: 'REV_19' }),
      ],
      now: NOW,
    });
    expect(model.snapshot.currentRevisionLabel).toBe('REV_19');
  });

  it('J: compatibility history never supplies a no-canonical fallback', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace({
        revisions: [
          {
            id: 'compat-10',
            revisionNumber: 10,
          } as ProjectWorkspace['revisions'][number],
        ],
      }),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.snapshot.currentRevisionLabel).toBe('No revision');
  });

  it('K: due date metric uses canonical project due date / due-state semantics', () => {
    const overdue = buildProjectSummaryModel({
      project: makeProject({ requiredDeliveryDate: '2026-08-01' }),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(overdue.snapshot.dueState).toBe('overdue');
    const overdueMetric = overdue.snapshot.metrics.find((metric) => metric.key === 'dueDate');
    expect(overdueMetric?.role).toBe('info');
    expect(overdueMetric?.valueRole).toBe('danger');

    const soon = buildProjectSummaryModel({
      project: makeProject({ requiredDeliveryDate: '2026-08-15' }),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(soon.snapshot.dueState).toBe('soon');
    const soonMetric = soon.snapshot.metrics.find((metric) => metric.key === 'dueDate');
    expect(soonMetric?.role).toBe('info');
    expect(soonMetric?.valueRole).toBe('warning');
  });

  it('renders exactly the four owner-locked canonical Snapshot metrics', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.snapshot.metrics.map((metric) => metric.key)).toEqual([
      'luminaires',
      'currentRevision',
      'dueDate',
      'openActions',
    ]);
  });

  it('L: open actions count uses canonical action-status semantics', () => {
    const workspace = makeWorkspace({
      actions: [
        makeAction({ id: 'a1', status: 'Open' }),
        makeAction({ id: 'a2', status: 'InProgress' }),
        makeAction({ id: 'a3', status: 'Waiting' }),
        makeAction({ id: 'a4', status: 'Completed' }),
        makeAction({ id: 'a5', status: 'Cancelled' }),
      ],
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace,
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.snapshot.openActionsCount).toBe(3);
    expect(isOpenAction(makeAction({ status: 'Completed' }))).toBe(false);
  });
});

describe('Attention (D/E/F/G)', () => {
  it('D: attention preview is capped at 4', () => {
    const workspace = makeWorkspace({
      reviewItems: [1, 2, 3, 4, 5, 6].map((n) => ({
        id: `rev${n}`,
        projectId: 'p1',
        reference: '',
        title: `Review ${n}`,
        description: '',
        area: '',
        luminaireTag: '',
        drawingReference: '',
        sourceType: 'Manual' as const,
        sourceId: null,
        status: 'Open' as const,
        response: '',
        revisionId: null,
        origin: null,
        authorId: null,
        authorNameSnapshot: null,
        authorRoleSnapshot: null,
        luminaireId: null,
        receivedAt: '2026-08-01',
        dueDate: null,
        createdAt: '',
        updatedAt: '',
      })),
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace,
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.attention.length).toBe(ATTENTION_PREVIEW_CAPACITY);
    expect(model.attentionAll.length).toBe(6);
  });

  it('E: attention ordering is deterministic by severity weight', () => {
    const items: AttentionItem[] = [
      {
        id: 'x',
        message: 'info',
        supporting: null,
        severity: 'info',
        role: 'info',
        targetSection: null,
      },
      {
        id: 'a',
        message: 'blocking',
        supporting: null,
        severity: 'blocking',
        role: 'danger',
        targetSection: null,
      },
      {
        id: 'b',
        message: 'high',
        supporting: null,
        severity: 'high',
        role: 'danger',
        targetSection: null,
      },
      {
        id: 'c',
        message: 'warning',
        supporting: null,
        severity: 'warning',
        role: 'warning',
        targetSection: null,
      },
    ];
    const ranked = rankAttention(items).map((i) => i.severity);
    expect(ranked).toEqual(['blocking', 'high', 'warning', 'info']);
  });

  it('F: attention empty state works', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.attention.length).toBe(0);
    expect(model.attentionAll.length).toBe(0);
  });

  it('G: attention does not fabricate candidates from empty data', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    expect(model.attentionAll).toEqual([]);
  });

  it('uses grammatical singular and plural technical-health copy', () => {
    const health = {
      ...makeWorkspace().health,
      checks: [
        {
          key: 'datasheets',
          label: 'Datasheet coverage',
          detail: '1 luminaire(s) have no datasheet.',
          severity: 'Warning' as const,
          passed: false,
        },
        {
          key: 'specification',
          label: 'Luminaire specification',
          detail: '2 luminaire(s) are missing manufacturer or model.',
          severity: 'Warning' as const,
          passed: false,
        },
      ],
    };
    const workspace = makeWorkspace({
      luminaires: [
        makeLuminaire({ id: 'l1', datasheetPath: '', manufacturer: '' }),
        makeLuminaire({ id: 'l2', model: '' }),
      ],
      health,
    });
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace,
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });

    expect(model.attentionAll.find((item) => item.id === 'check:datasheets')?.supporting).toBe(
      '1 luminaire has no datasheet.',
    );
    expect(model.attentionAll.find((item) => item.id === 'check:specification')?.supporting).toBe(
      '2 luminaires are missing manufacturer or model.',
    );
  });
});

describe('Stage strip (C / H2 presentation)', () => {
  it('marks the node equal to project.status as CURRENT (not last distinct position)', () => {
    const transitions = [
      { toStatus: 'Planning' },
      { toStatus: 'InProgress' },
      { toStatus: 'ClientReview' },
    ] as WorkflowHistoryResponse['transitions'];
    const strip = buildStageStrip('InProgress', transitions);
    // No fabricated future "Revision" node.
    const visited = strip.filter((n) => n.state !== 'pending').map((n) => n.key);
    expect(visited).toEqual(['Planning', 'ClientReview', 'InProgress']);
    expect(strip.every((n) => n.key !== 'RevisionRequired' || n.state === 'pending')).toBe(true);
    // InProgress is authoritative current; ClientReview (last visited) is NOT.
    const current = strip.filter((n) => n.state === 'current');
    expect(current.map((n) => n.key)).toEqual(['InProgress']);
    expect(current.length).toBe(1);
    expect(strip.find((n) => n.key === 'ClientReview')?.state).toBe('completed');
  });

  it('keeps a revisited project.status current even when it is not the last distinct status', () => {
    const transitions = [
      { toStatus: 'Planning' },
      { toStatus: 'InProgress' },
      { toStatus: 'ClientReview' },
      { toStatus: 'InProgress' },
    ] as WorkflowHistoryResponse['transitions'];
    const strip = buildStageStrip('InProgress', transitions);
    // Historical visited nodes before current (deduplicated) + current after.
    const visited = strip.filter((n) => n.state !== 'pending').map((n) => n.key);
    expect(visited).toEqual(['Planning', 'ClientReview', 'InProgress']);
    // Exactly one current node, and it is InProgress.
    const current = strip.filter((n) => n.state === 'current');
    expect(current.length).toBe(1);
    expect(current[0]?.key).toBe('InProgress');
    expect(new Set(strip.map((node) => node.key)).size).toBe(strip.length);
    // ClientReview remains truthfully visited/completed (not pending, not current).
    expect(strip.find((n) => n.key === 'ClientReview')?.state).toBe('completed');
  });

  it('marks project.status current when absent from recorded history', () => {
    const transitions = [{ toStatus: 'Planning' }] as WorkflowHistoryResponse['transitions'];
    const strip = buildStageStrip('InProgress', transitions);
    // Planning visited (completed), InProgress current.
    expect(strip.find((n) => n.key === 'Planning')?.state).toBe('completed');
    const current = strip.filter((n) => n.state === 'current');
    expect(current.length).toBe(1);
    expect(current[0]?.key).toBe('InProgress');
  });

  it('adds truthful unvisited Pending nodes after Current, excluding exceptional states', () => {
    const strip = buildStageStrip('InProgress', []);
    // No history: only InProgress current + forward pending nodes after it.
    expect(strip.find((n) => n.key === 'InProgress')?.state).toBe('current');
    const pending = strip.filter((n) => n.state === 'pending');
    // Exceptional side states (OnHold, Cancelled, Archived) must NOT be pending.
    expect(pending.map((n) => n.key)).not.toContain('OnHold');
    expect(pending.map((n) => n.key)).not.toContain('Cancelled');
    expect(pending.map((n) => n.key)).not.toContain('Archived');
    // Forward milestones after InProgress appear as pending.
    expect(pending.map((n) => n.key)).toEqual([
      'ClientReview',
      'RevisionRequired',
      'ReadyToIssue',
      'Issued',
      'Completed',
    ]);
  });

  it('shows exceptional side states truthfully when they are the current status', () => {
    const strip = buildStageStrip('OnHold', []);
    expect(strip.find((n) => n.key === 'OnHold')?.state).toBe('current');
    // No resume target is proven by this presentation input, so future nodes
    // are not fabricated after an exceptional current status.
    const pending = strip.filter((n) => n.state === 'pending');
    expect(pending).toEqual([]);
  });

  it('labels visited exceptional states as Previously, not Completed', () => {
    const transitions = [
      { toStatus: 'Planning' },
      { toStatus: 'OnHold' },
      { toStatus: 'InProgress' },
    ] as WorkflowHistoryResponse['transitions'];
    const strip = buildStageStrip('InProgress', transitions);
    expect(strip.find((node) => node.key === 'Planning')?.meta).toBe('Completed');
    expect(strip.find((node) => node.key === 'OnHold')?.meta).toBe('Previously');
  });

  it('humanizes raw enum labels', () => {
    expect(workflowLabel('ClientReview')).toBe('Client Review');
    expect(workflowLabel('RevisionRequired')).toBe('Revision Required');
    expect(workflowLabel('ReadyToIssue')).toBe('Ready to Issue');
    expect(workflowLabel('OnHold')).toBe('On Hold');
    expect(workflowLabel('InProgress')).toBe('In Progress');
  });

  it('falls back to a truthful single current node when no history exists', () => {
    const strip = buildStageStrip('Planning', []);
    expect(strip.find((n) => n.key === 'Planning')?.state).toBe('current');
  });

  it('returns empty when neither status nor history exists (no fabrication)', () => {
    const strip = buildStageStrip(undefined, []);
    expect(strip).toEqual([]);
  });
});

describe('Workflow cycle (final owner hardening)', () => {
  const revisionTransitions = [
    { toStatus: 'InProgress' },
    { toStatus: 'ClientReview' },
    { toStatus: 'RevisionRequired' },
  ] as WorkflowHistoryResponse['transitions'];

  it('shows the primary flow and the structured revision loop without false completion', () => {
    const cycle = buildWorkflowCycle(
      makeProject({ status: 'RevisionRequired' }),
      revisionTransitions,
    );
    expect(cycle.main.map((node) => node.key)).toEqual([
      'InProgress',
      'ClientReview',
      'ReadyToIssue',
      'Issued',
      'Completed',
    ]);
    expect(cycle.main.find((node) => node.key === 'ClientReview')?.state).toBe('historical');
    expect(cycle.revisionRequired).toMatchObject({ state: 'current', meta: 'Current' });
    expect(cycle.main.some((node) => node.state === 'current')).toBe(false);
  });

  it('shows On Hold as the current interrupt and preserves its recorded resume target', () => {
    const cycle = buildWorkflowCycle(
      makeProject({ status: 'OnHold', statusBeforeHold: 'ClientReview' }),
      [
        { toStatus: 'ClientReview' },
        { toStatus: 'OnHold' },
      ] as WorkflowHistoryResponse['transitions'],
    );
    expect(cycle.onHold.state).toBe('current');
    expect(cycle.onHoldResumeLabel).toBe('Client Review');
    expect(cycle.main.some((node) => node.state === 'current')).toBe(false);
  });

  it('uses only structured workflow history to mark previously visited nodes', () => {
    const cycle = buildWorkflowCycle(makeProject({ status: 'InProgress' }), []);
    expect(cycle.main.find((node) => node.key === 'InProgress')?.state).toBe('current');
    expect(cycle.main.filter((node) => node.state === 'historical')).toEqual([]);
    expect(cycle.revisionRequired.state).toBe('pending');
    expect(cycle.onHold.state).toBe('pending');
  });
});

describe('Next Action (M/N/O)', () => {
  it('M: resolver is deterministic and blocks on blocking health checks', () => {
    const workspace = makeWorkspace({
      health: {
        ...makeWorkspace().health,
        checks: [
          {
            key: 'c1',
            label: 'Missing datasheet',
            detail: 'Blocking',
            severity: 'Blocking',
            passed: false,
          },
        ],
      },
    });
    const action = resolveNextAction({ project: makeProject(), workspace, now: NOW });
    expect(action.title).toBe('Missing datasheet');
    expect(action.severity).toBe('blocking');
    expect(action.targetSection).toBe('technical-check');
  });

  it('M: picks overdue high-priority action before normal overdue', () => {
    const workspace = makeWorkspace({
      actions: [
        makeAction({
          id: 'a1',
          title: 'Overdue normal',
          dueDate: '2026-08-01',
          priority: 'Normal',
        }),
        makeAction({
          id: 'a2',
          title: 'Overdue urgent',
          dueDate: '2026-08-01',
          priority: 'Urgent',
        }),
      ],
    });
    const action = resolveNextAction({ project: makeProject(), workspace, now: NOW });
    expect(action.title).toBe('Overdue urgent');
    expect(action.targetSection).toBe('actions');
  });

  it.each([
    ['InProgress', null, 'Review delivery readiness', null, false],
    ['ClientReview', null, 'Revision Required', 'RevisionRequired', true],
    ['RevisionRequired', null, 'Start Revision', 'InProgress', false],
    ['OnHold', 'ClientReview', 'Resume Client Review', 'ClientReview', false],
    ['ReadyToIssue', null, 'Issue Project', 'Issued', false],
    ['Issued', null, 'Complete Project', 'Completed', false],
    ['Completed', null, 'No further action required', null, false],
  ] as const)(
    'M: derives truthful %s guidance',
    (status, statusBeforeHold, title, targetStatus, requiresReason) => {
      const action = resolveNextAction({
        project: makeProject({ status, statusBeforeHold }),
        workspace: makeWorkspace(),
        now: NOW,
      });
      expect(action.title).toBe(title);
      expect(action.targetStatus).toBe(targetStatus);
      expect(action.requiresReason).toBe(requiresReason);
      expect(Boolean(action.targetSection || action.targetStatus)).toBe(status !== 'Completed');
      if (status === 'Completed') expect(action.severity).toBeNull();
    },
  );

  it('M: uses the safe In Progress fallback for a legacy On Hold record', () => {
    const action = resolveNextAction({
      project: makeProject({ status: 'OnHold', statusBeforeHold: null }),
      workspace: makeWorkspace(),
      now: NOW,
    });
    expect(action.title).toBe('Resume In Progress');
    expect(action.targetStatus).toBe('InProgress');
  });

  it('N: never renders an estimated duration', () => {
    const action = resolveNextAction({
      project: makeProject(),
      workspace: makeWorkspace(),
      now: NOW,
    });
    expect('estimatedMinutes' in action).toBe(false);
  });

  it('O: routes an outstanding Action to the production Actions route', () => {
    const workspace = makeWorkspace({
      actions: [makeAction({ id: 'a1', title: 'X', dueDate: '2026-08-01' })],
    });
    const action = resolveNextAction({ project: makeProject(), workspace, now: NOW });
    expect(action.targetSection).toBe('actions');
  });
});

describe('Recent Activity (P/Q/R)', () => {
  it('P: preview is capped at 4 newest events', () => {
    const activity = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `ev${n}`,
      projectId: 'p1',
      entityType: 'revision',
      entityId: null,
      action: 'Updated',
      title: `Event ${n}`,
      detail: '',
      createdAt: `2026-08-0${n}T00:00:00.000Z`,
    }));
    const events = recentActivity(activity as unknown as WorkspaceActivity[]);
    expect(events.length).toBe(RECENT_ACTIVITY_CAPACITY);
    // Newest first.
    expect(events[0]?.id).toBe('ev6');
  });

  it('Q: does not fabricate actor data (actor stays null when canonical data has none)', () => {
    const events = recentActivity([
      {
        id: 'ev1',
        projectId: 'p1',
        entityType: 'revision',
        entityId: null,
        action: 'Issued',
        title: 'REV',
        detail: '',
        createdAt: '2026-08-01T00:00:00.000Z',
      } as unknown as WorkspaceActivity,
    ]);
    expect(events[0]?.actor).toBeNull();
  });

  it('R: colored-icon mapping is deterministic by category role', () => {
    expect(activityRole('revision_cycle')).toBe('brandPurple');
    expect(activityRole('luminaire')).toBe('brandTeal');
    expect(activityRole('comment')).toBe('brandGold');
    expect(activityRole('meeting')).toBe('info');
  });

  it('R2: activity categories map to distinct icons deterministically (H2)', () => {
    expect(classifyActivity('revision', 'Generated', 'REV 02')).toBe('revision');
    expect(classifyActivity('meeting', 'Held', 'Site meeting')).toBe('meeting');
    expect(classifyActivity('action', 'Created', 'Task')).toBe('action');
    expect(classifyActivity('comment', 'Added', 'Client comment')).toBe('comment');
    expect(classifyActivity('review', 'Opened', 'Client review')).toBe('review');
    expect(classifyActivity('luminaire', 'Updated', 'Luminaire tag')).toBe('luminaire');
    expect(classifyActivity('technical', 'Check', 'Datasheet check')).toBe('technical');
    expect(classifyActivity('package', 'Created', 'Output package')).toBe('package');
    expect(classifyActivity('status', 'Changed', 'Workflow')).toBe('status');
  });

  it('R3: unknown activity category has a safe generic fallback (H2)', () => {
    expect(classifyActivity('misc', 'N/A', 'Something unrelated')).toBe('unknown');
    expect(activityCategoryRole('unknown')).toBe('info');
  });
});

describe('Colored icon grammar (R)', () => {
  it('snapshot metric icon roles are a deterministic shared blue family', () => {
    const model = buildProjectSummaryModel({
      project: makeProject(),
      workspace: makeWorkspace(),
      workflow: makeWorkflow(),
      canonicalRevisions: [],
      now: NOW,
    });
    const roles = model.snapshot.metrics.map((m) => m.role);
    expect(roles).toEqual(['info', 'info', 'info', 'info']);
  });
});
