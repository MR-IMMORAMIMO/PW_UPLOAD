import { describe, expect, it } from 'vitest';
import type { Project, ProjectHealth, ProjectWorkspace, RevisionCycle } from '@scli/domain';
import {
  dueSemantic,
  needAttention,
  nextAction,
  projectContextHeader,
  projectSnapshot,
  stageRail,
} from './project-summary-model';

const timestamp = '2026-08-01T08:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    projectCode: '036_SCLI260801_UI_TEST',
    projectName: 'UI Test Project',
    clientName: 'Acme',
    crmReference: null,
    projectType: 'Lighting Layout',
    description: 'Lighting component test',
    salesOwnerId: '11111111-1111-4111-8111-111111111111',
    salesOwnerNameSnapshot: 'Maya Hassan',
    salesOwnerEmailSnapshot: 'maya@scli.example',
    createdById: '11111111-1111-4111-8111-111111111111',
    createdByNameSnapshot: 'Maya Hassan',
    createdByEmailSnapshot: 'maya@scli.example',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept',
    lightingScope: 'Interior lighting layout.',
    luxRequirements: '500 lux',
    drawingReference: 'A-101',
    status: 'Planning',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 10,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    revisionNumber: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<ProjectWorkspace> = {}): ProjectWorkspace {
  return {
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    folderPath: null,
    folderProfile: 'Full Lighting Design',
    folderStructure: [],
    outputFolders: {
      scheduleExcel: '01_SCHEDULES',
      schedulePdf: '01_SCHEDULES',
      boqExcel: '02_BOQ',
      boqPdf: '02_BOQ',
      datasheets: '04_DATASHEETS',
    },
    services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
    deliverables: [],
    lightingPackage: {
      projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
      inputMode: 'Later',
      pdfPaperSize: 'Auto',
      scheduleColumns: [],
      boqColumns: [],
      updatedAt: timestamp,
    },
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
      score: 100,
      checklistPercent: 100,
      openRequirements: 0,
      blockingRequirements: 0,
      overdueActions: 0,
      unresolvedReviews: 0,
      checks: [],
    },
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeCycle(overrides: Partial<RevisionCycle> = {}): RevisionCycle {
  return {
    revisionCycleId: 'c1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    cycleNumber: 2,
    status: 'Open',
    openedAt: timestamp,
    openedByTransitionId: 'opening-1',
    feedbackSummary: 'Adjust downlight spacing.',
    workStartedAt: null,
    returnedToClientAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe('projectContextHeader', () => {
  it('maps canonical fields and labels the design stage as Design Stage', () => {
    const header = projectContextHeader(makeProject({ designStage: 'DetailedDesign' }));
    expect(header.projectCode).toBe('036_SCLI260801_UI_TEST');
    expect(header.projectName).toBe('UI Test Project');
    expect(header.client).toBe('Acme');
    expect(header.projectType).toBe('Lighting Layout');
    expect(header.designStage).toBe('DetailedDesign');
    expect(header.dueDate).toBe('2026-08-20');
  });
});

describe('dueSemantic', () => {
  it('classifies overdue, due soon, and normal', () => {
    expect(dueSemantic('2026-08-01', '2026-08-10')).toBe('overdue');
    expect(dueSemantic('2026-08-11', '2026-08-10')).toBe('dueSoon');
    expect(dueSemantic('2026-08-12', '2026-08-10')).toBe('dueSoon');
    expect(dueSemantic('2026-08-13', '2026-08-10')).toBe('normal');
  });
});

describe('stageRail', () => {
  it('uses personalStatusLabel authority: Planning displays as Not Started Yet', () => {
    const rail = stageRail(makeProject({ status: 'Planning' }), []);
    expect(rail.nodes[0]!.label).toBe('Not Started Yet');
    expect(rail.nodes[0]!.state).toBe('current');
    expect(rail.nodes.some((n) => n.label === 'Planning')).toBe(false);
  });

  it('treats Revision Required as a loop condition, not a final stage', () => {
    const rail = stageRail(makeProject({ status: 'RevisionRequired' }), []);
    // In Progress is current; Client Review is not forced to completed.
    expect(rail.nodes.find((n) => n.id === 'inProgress')!.state).toBe('current');
    expect(rail.nodes.find((n) => n.id === 'clientReview')!.state).toBe('pending');
  });

  it('shows the actual open cycle number only when a cycle exists', () => {
    expect(stageRail(makeProject({ status: 'InProgress' }), []).cycleNumber).toBeNull();
    expect(stageRail(makeProject({ status: 'InProgress' }), [makeCycle()]).cycleNumber).toBe(2);
  });

  it('does not fabricate Technical or Issue fixed nodes', () => {
    const rail = stageRail(makeProject({ status: 'InProgress' }), []);
    const labels = rail.nodes.map((n) => n.label);
    expect(labels).not.toContain('Technical');
    expect(labels).not.toContain('Issue');
  });

  it('represents terminal/auxiliary statuses truthfully', () => {
    const completed = stageRail(makeProject({ status: 'Completed' }), []);
    expect(completed.auxiliary).toContain('Completed');
    const onHold = stageRail(makeProject({ status: 'OnHold' }), []);
    expect(onHold.auxiliary).toContain('On Hold');
  });
});

describe('needAttention', () => {
  const health: ProjectHealth = {
    score: 50,
    checklistPercent: 50,
    openRequirements: 1,
    blockingRequirements: 1,
    overdueActions: 1,
    unresolvedReviews: 1,
    checks: [
      {
        key: 'requirements',
        label: 'Blocking information',
        detail: '1 blocking item',
        severity: 'Blocking',
        passed: false,
      },
      {
        key: 'actions',
        label: 'Overdue actions',
        detail: '1 overdue',
        severity: 'Warning',
        passed: false,
      },
      {
        key: 'outputs',
        label: 'Issued outputs',
        detail: 'No output',
        severity: 'Info',
        passed: false,
      },
    ],
  };

  it('orders Blocking before Warning and excludes Info', () => {
    const items = needAttention(health);
    expect(items.map((i) => i.severity)).toEqual(['Blocking', 'Warning']);
    expect(items.some((i) => i.key === 'outputs')).toBe(false);
  });

  it('caps visible items at 4', () => {
    const many: ProjectHealth = {
      ...health,
      checks: [
        { key: 'a', label: 'A', detail: 'a', severity: 'Blocking', passed: false },
        { key: 'b', label: 'B', detail: 'b', severity: 'Blocking', passed: false },
        { key: 'c', label: 'C', detail: 'c', severity: 'Blocking', passed: false },
        { key: 'd', label: 'D', detail: 'd', severity: 'Blocking', passed: false },
        { key: 'e', label: 'E', detail: 'e', severity: 'Blocking', passed: false },
      ],
    };
    expect(needAttention(many).length).toBe(4);
  });

  it('returns empty for a healthy project', () => {
    expect(needAttention({ ...health, checks: [] })).toEqual([]);
  });
});

describe('projectSnapshot', () => {
  it('reports luminaire count, actual latest revision, due date, and open actions', () => {
    const workspace = makeWorkspace({
      luminaires: [{ id: 'l1' } as ProjectWorkspace['luminaires'][number]],
      revisions: [
        { id: 'r1', revisionNumber: 1 } as ProjectWorkspace['revisions'][number],
        { id: 'r2', revisionNumber: 2 } as ProjectWorkspace['revisions'][number],
      ],
      actions: [
        { id: 'a1', status: 'Open' } as ProjectWorkspace['actions'][number],
        { id: 'a2', status: 'Completed' } as ProjectWorkspace['actions'][number],
        { id: 'a3', status: 'Cancelled' } as ProjectWorkspace['actions'][number],
      ],
    });
    const snapshot = projectSnapshot(makeProject(), workspace);
    expect(snapshot.luminaireCount).toBe(1);
    expect(snapshot.latestRevision?.revisionNumber).toBe(2);
    expect(snapshot.openActions).toBe(1);
  });

  it('shows no revision when none exists', () => {
    const snapshot = projectSnapshot(makeProject(), makeWorkspace());
    expect(snapshot.latestRevision).toBeNull();
  });
});

describe('nextAction', () => {
  const health = (checks: ProjectHealth['checks']): ProjectHealth => ({
    score: 50,
    checklistPercent: 50,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks,
  });

  it('ClientReview -> waiting for client review', () => {
    expect(nextAction(makeProject({ status: 'ClientReview' }), health([])).title).toBe(
      'Waiting for client review',
    );
  });

  it('RevisionRequired -> client feedback requires design updates', () => {
    expect(nextAction(makeProject({ status: 'RevisionRequired' }), health([])).title).toBe(
      'Client feedback requires design updates',
    );
  });

  it('OnHold -> project is on hold', () => {
    expect(nextAction(makeProject({ status: 'OnHold' }), health([])).title).toBe(
      'Project is on hold',
    );
  });

  it('InProgress + blocking requirement -> resolve blocking information', () => {
    const action = nextAction(
      makeProject({ status: 'InProgress' }),
      health([
        {
          key: 'requirements',
          label: 'Blocking information',
          detail: '2 blocking items',
          severity: 'Blocking',
          passed: false,
        },
      ]),
    );
    expect(action.title).toBe('Resolve blocking information');
    expect(action.targetSection).toBe('scope');
    expect(action.ctaLabel).toBe('Open Scope');
  });

  it('InProgress + overdue action -> complete overdue actions', () => {
    const action = nextAction(
      makeProject({ status: 'InProgress' }),
      health([
        {
          key: 'actions',
          label: 'Overdue actions',
          detail: '1 overdue',
          severity: 'Warning',
          passed: false,
        },
      ]),
    );
    expect(action.title).toBe('Complete overdue actions');
    expect(action.targetSection).toBe('actions');
    expect(action.ctaLabel).toBe('Open Actions');
  });

  it('InProgress + missing datasheet -> add missing datasheets', () => {
    const action = nextAction(
      makeProject({ status: 'InProgress' }),
      health([
        {
          key: 'datasheets',
          label: 'Datasheet coverage',
          detail: '3 missing',
          severity: 'Warning',
          passed: false,
        },
      ]),
    );
    expect(action.title).toBe('Add missing datasheets');
    expect(action.targetSection).toBe('datasheets');
    expect(action.ctaLabel).toBe('Open Datasheets');
  });

  it('fallback -> no current internal action', () => {
    expect(nextAction(makeProject({ status: 'InProgress' }), health([])).title).toBe(
      'No current internal action',
    );
  });
});
