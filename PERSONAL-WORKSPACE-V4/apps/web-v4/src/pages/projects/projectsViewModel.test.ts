import { describe, expect, it } from 'vitest';
import type { Project } from '@scli/domain';
import {
  PLANNER_STATUS_ORDER,
  canDirectlyMove,
  directStatusTargets,
  folderCopy,
  pageSlice,
  projectsQueryFilters,
  readProjectsView,
  specializedStatusTargets,
  todayInTimezone,
} from './projectsViewModel';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    projectCode: '001_SCT260809_TEST',
    projectName: 'Test project',
    clientName: 'Client',
    projectType: 'Hospitality',
    description: '',
    salesOwnerId: '20000000-0000-4000-8000-000000000001',
    salesOwnerNameSnapshot: 'Sales Owner',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: '20000000-0000-4000-8000-000000000001',
    createdByNameSnapshot: 'Sales Owner',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai',
    designStage: 'DetailedDesign',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'InProgress',
    priority: 'High',
    complexity: 'Medium',
    estimatedHours: 20,
    actualHours: 8,
    progressPercent: 40,
    requiredDeliveryDate: '2026-08-25',
    projectFolderUrl: null,
    projectFolderPath: 'C:\\Projects\\Test',
    revisionNumber: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

describe('Projects view model', () => {
  it('defaults presentation state to Table and accepts only the three canonical views', () => {
    expect(readProjectsView({ getItem: () => null })).toBe('table');
    expect(readProjectsView({ getItem: () => 'planner' })).toBe('planner');
    expect(readProjectsView({ getItem: () => 'board' })).toBe('table');
  });

  it('builds only real server query keys, including explicit sort direction and due range', () => {
    expect(
      projectsQueryFilters({
        search: ' Boutique ',
        status: 'InProgress',
        salesOwnerId: 'sales-1',
        priority: 'High',
        projectType: 'Hospitality',
        due: 'next7',
        sortBy: 'requiredDate',
        sortDirection: 'asc',
        today: '2026-08-17',
      }),
    ).toEqual({
      search: 'Boutique',
      status: 'InProgress',
      salesOwnerId: 'sales-1',
      priority: 'High',
      projectType: 'Hospitality',
      dueFrom: '2026-08-17',
      dueTo: '2026-08-24',
      sortBy: 'requiredDate',
      sortDirection: 'asc',
    });
  });

  it('uses the configured timezone for date-only filtering', () => {
    expect(todayInTimezone(new Date('2026-08-16T21:30:00.000Z'), 'Asia/Dubai')).toBe('2026-08-17');
  });

  it('derives Planner lanes from every canonical status in a stable order', () => {
    expect(new Set(PLANNER_STATUS_ORDER).size).toBe(PLANNER_STATUS_ORDER.length);
    expect(PLANNER_STATUS_ORDER).toEqual(
      expect.arrayContaining([
        'Planning',
        'InProgress',
        'ClientReview',
        'RevisionRequired',
        'OnHold',
        'Completed',
        'Archived',
      ]),
    );
  });

  it('keeps archive and reason-required transitions out of direct status moves', () => {
    expect(directStatusTargets(project({ status: 'Completed' }))).not.toContain('Archived');
    expect(directStatusTargets(project({ status: 'ClientReview' }))).not.toContain(
      'RevisionRequired',
    );
    expect(canDirectlyMove(project({ status: 'Planning' }), 'InProgress')).toBe(true);
    expect(canDirectlyMove(project({ status: 'Planning' }), 'Completed')).toBe(false);
    expect(directStatusTargets(project({ status: 'Archived' }))).toEqual([]);
    expect(specializedStatusTargets(project({ status: 'ClientReview' }))).toEqual([
      'RevisionRequired',
    ]);
    expect(specializedStatusTargets(project({ status: 'RevisionRequired' }))).toEqual([]);
  });

  it('reports folder readiness only from a real path and keeps pagination presentation-only', () => {
    expect(folderCopy(project({ projectFolderPath: null }))).toMatchObject({
      state: 'missing',
      label: 'Not Created',
    });
    expect(
      folderCopy(project({ folderIndexedAt: '2026-08-17T00:00:00.000Z', folderFileCount: 32 })),
    ).toEqual({ state: 'indexed', label: 'Indexed', detail: '32 files' });
    expect(pageSlice([1, 2, 3, 4, 5], 1, 2)).toEqual([3, 4]);
  });
});
