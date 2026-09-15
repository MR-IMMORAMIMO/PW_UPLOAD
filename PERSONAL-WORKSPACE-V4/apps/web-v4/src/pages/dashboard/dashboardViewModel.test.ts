import type { Project } from '@scli/domain';
import {
  addCalendarDays,
  calendarDayDistance,
  dateKeyInTimezone,
  deriveDashboardView,
  dueDetail,
  formatDashboardDate,
  formatMeetingDateTime,
  isOverdue,
  needAttentionReason,
  projectsForKpi,
} from './dashboardViewModel';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    projectCode: '001_SCT260809_TEST',
    projectName: 'Test Project',
    clientName: 'Client',
    projectType: 'Commercial',
    description: '',
    salesOwnerId: 'u1',
    salesOwnerNameSnapshot: 'Sales',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: 'u1',
    createdByNameSnapshot: 'Sales',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: 'u2',
    assignedDesignerNameSnapshot: 'Designer',
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai',
    designStage: 'Concept',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'InProgress',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 20,
    actualHours: 5,
    progressPercent: 25,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    revisionNumber: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

const TODAY = '2026-08-17';

describe('dashboardViewModel', () => {
  it('derives the Asia/Dubai day key without browser UTC drift', () => {
    expect(dateKeyInTimezone(new Date('2026-08-16T21:30:00.000Z'))).toBe('2026-08-17');
  });

  it('adds calendar days across month boundaries', () => {
    expect(addCalendarDays('2026-08-30', 2)).toBe('2026-09-01');
  });

  it('measures signed calendar-day distance', () => {
    expect(calendarDayDistance('2026-08-17', '2026-08-20')).toBe(3);
    expect(calendarDayDistance('2026-08-17', '2026-08-15')).toBe(-2);
  });

  it('counts every non-terminal project as active', () => {
    const statuses = ['InProgress', 'Planning', 'Completed', 'Cancelled', 'Archived'] as const;
    const view = deriveDashboardView(
      statuses.map((status, index) => project({ id: `${index}`, status })),
      TODAY,
    );
    expect(view.kpis.find((kpi) => kpi.id === 'active')?.count).toBe(2);
  });

  it('counts due today through +7 days and excludes overdue', () => {
    const view = deriveDashboardView(
      ['2026-08-16', '2026-08-17', '2026-08-24', '2026-08-25'].map((date, index) =>
        project({ id: `${index}`, requiredDeliveryDate: date }),
      ),
      TODAY,
    );
    expect(view.kpis.find((kpi) => kpi.id === 'dueThisWeek')?.count).toBe(2);
  });

  it('counts canonical RevisionRequired status only', () => {
    const view = deriveDashboardView(
      [project({ revisionNumber: 5 }), project({ id: 'p2', status: 'RevisionRequired' })],
      TODAY,
    );
    expect(view.kpis.find((kpi) => kpi.id === 'revisionRequired')?.count).toBe(1);
  });

  it('counts canonical ClientReview status only', () => {
    const view = deriveDashboardView(
      [project(), project({ id: 'p2', status: 'ClientReview' })],
      TODAY,
    );
    expect(view.kpis.find((kpi) => kpi.id === 'clientReview')?.count).toBe(1);
  });

  it('orders active projects by due date then project code', () => {
    const view = deriveDashboardView(
      [
        project({ id: 'late', requiredDeliveryDate: '2026-09-01' }),
        project({ id: 'b', projectCode: 'B', requiredDeliveryDate: '2026-08-20' }),
        project({ id: 'a', projectCode: 'A', requiredDeliveryDate: '2026-08-20' }),
      ],
      TODAY,
    );
    expect(view.activeProjects.map((item) => item.id)).toEqual(['a', 'b', 'late']);
  });

  it('prioritizes overdue, then revision, then due soon', () => {
    const view = deriveDashboardView(
      [
        project({ id: 'soon', requiredDeliveryDate: '2026-08-18' }),
        project({ id: 'revision', status: 'RevisionRequired', requiredDeliveryDate: '2026-08-23' }),
        project({ id: 'overdue', requiredDeliveryDate: '2026-08-16' }),
      ],
      TODAY,
    );
    expect(view.needAttention.map((item) => item.id)).toEqual(['overdue', 'revision', 'soon']);
  });

  it('assigns one exclusive reason to an overdue revision project', () => {
    const item = project({ status: 'RevisionRequired', requiredDeliveryDate: '2026-08-16' });
    expect(needAttentionReason(item, TODAY)).toBe('overdue');
    expect(deriveDashboardView([item], TODAY).needAttention).toHaveLength(1);
  });

  it('uses the inclusive today through +2 attention window', () => {
    const view = deriveDashboardView(
      ['2026-08-17', '2026-08-19', '2026-08-20'].map((date, index) =>
        project({ id: `${index}`, requiredDeliveryDate: date }),
      ),
      TODAY,
    );
    expect(view.needAttention.map((item) => item.id)).toEqual(['0', '1']);
  });

  it('filters the active set for each KPI', () => {
    const active = [
      project({ id: 'normal', requiredDeliveryDate: '2026-09-01' }),
      project({ id: 'due', requiredDeliveryDate: '2026-08-20' }),
      project({ id: 'revision', status: 'RevisionRequired', requiredDeliveryDate: '2026-09-01' }),
      project({ id: 'review', status: 'ClientReview', requiredDeliveryDate: '2026-09-01' }),
    ];
    expect(projectsForKpi(active, 'active', TODAY)).toHaveLength(4);
    expect(projectsForKpi(active, 'dueThisWeek', TODAY).map((item) => item.id)).toEqual(['due']);
    expect(projectsForKpi(active, 'revisionRequired', TODAY).map((item) => item.id)).toEqual([
      'revision',
    ]);
    expect(projectsForKpi(active, 'clientReview', TODAY).map((item) => item.id)).toEqual([
      'review',
    ]);
  });

  it('reports overdue date state with date-only semantics', () => {
    expect(isOverdue(project({ requiredDeliveryDate: '2026-08-16' }), TODAY)).toBe(true);
    expect(isOverdue(project({ requiredDeliveryDate: TODAY }), TODAY)).toBe(false);
    expect(dueDetail('2026-08-16', TODAY)).toBe('1 day overdue');
    expect(dueDetail(TODAY, TODAY)).toBe('Due today');
    expect(dueDetail('2026-08-19', TODAY)).toBe('in 2 days');
  });

  it('formats date-only values without timezone shifting', () => {
    expect(formatDashboardDate('2026-08-17')).toBe('17 Aug 2026');
    expect(formatDashboardDate(null)).toBe('No due date');
  });

  it('formats meeting instants in Asia/Dubai', () => {
    expect(formatMeetingDateTime('2026-08-17T06:00:00.000Z')).toContain('10:00 am');
  });
});
