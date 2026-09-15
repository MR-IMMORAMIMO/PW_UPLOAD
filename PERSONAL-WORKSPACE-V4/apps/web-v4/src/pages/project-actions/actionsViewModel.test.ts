import { describe, expect, it } from 'vitest';
import type { ProjectActionItem } from '@scli/domain';
import {
  actionDueState,
  actionDueLabel,
  actionKpis,
  actionUpdateInput,
  effectiveActionPage,
  filterActions,
} from './actionsViewModel';

const action = (overrides: Partial<ProjectActionItem>): ProjectActionItem => ({
  id: 'a',
  projectId: 'p',
  title: 'Action',
  details: '',
  owner: '',
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
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  ...overrides,
});

describe('Actions view model', () => {
  it('derives active date-only KPIs without timezone conversion', () => {
    const today = '2026-08-15';
    const actions = [
      action({ dueDate: '2026-08-14' }),
      action({ id: 'b', dueDate: '2026-08-15' }),
      action({ id: 'c', dueDate: '2026-08-22' }),
      action({ id: 'd', dueDate: '2026-08-01', status: 'Completed' }),
      action({ id: 'e', dueDate: '2026-08-01', status: 'Cancelled' }),
    ];
    expect(actionKpis(actions, today)).toEqual({ open: 3, dueSoon: 2, overdue: 1, completed: 1 });
    expect(actionDueState(actions[3]!, today)).toBe('later');
    expect(actionDueState(actions[4]!, today)).toBe('later');
  });

  it('clamps a shrinking result set in the same render', () => {
    expect(effectiveActionPage(3, 7)).toBe(1);
    expect(effectiveActionPage(1, 0)).toBe(0);
  });

  it('formats relative due dates by calendar day without timestamp drift', () => {
    expect(actionDueLabel('today', '2026-08-15', '2026-08-15')).toBe('Today');
    expect(actionDueLabel('soon', '2026-08-18', '2026-08-15')).toBe('in 3 days');
    expect(actionDueLabel('overdue', '2026-08-12', '2026-08-15')).toBe('3 days overdue');
  });

  it('preserves hidden canonical fields for visible and lifecycle updates', () => {
    const original = action({
      sourceType: 'Meeting',
      sourceId: '11111111-1111-4111-8111-111111111111',
      revisionId: '22222222-2222-4222-8222-222222222222',
      categoryId: '33333333-3333-4333-8333-333333333333',
      ownerRole: 'Lighting Designer',
      notes: 'First line\nSecond line',
    });
    const edited = actionUpdateInput(original, { title: 'Edited' });
    const completed = actionUpdateInput(original, { status: 'Completed' });
    for (const payload of [edited, completed])
      expect(payload).toMatchObject({
        sourceType: 'Meeting',
        sourceId: original.sourceId,
        revisionId: original.revisionId,
        categoryId: original.categoryId,
        ownerRole: original.ownerRole,
        notes: original.notes,
      });
  });

  it('projects search and combined canonical filters by category UUID', () => {
    const items = [
      action({
        id: 'a',
        title: 'Layout review',
        details: 'Plan check',
        owner: 'Sarah',
        categoryId: 'cat-a',
        ownerRole: 'Lighting Designer',
      }),
      action({
        id: 'b',
        title: 'Schedule',
        owner: '',
        status: 'Waiting',
        priority: 'Urgent',
        categoryId: null,
      }),
    ];
    expect(
      filterActions(items, { query: 'plan', status: '', owner: '', priority: '', category: '' }),
    ).toEqual([items[0]]);
    expect(
      filterActions(items, {
        query: '',
        status: 'Waiting',
        owner: '__unassigned__',
        priority: 'Urgent',
        category: '__uncategorized__',
      }),
    ).toEqual([items[1]]);
    expect(
      filterActions(items, {
        query: 'designer',
        status: '',
        owner: '',
        priority: '',
        category: '',
      }),
    ).toEqual([items[0]]);
  });

  it('matches normalized Owner filter options against legacy padded owner values', () => {
    const item = action({ owner: '  Sarah  ' });
    expect(
      filterActions([item], { query: '', status: '', owner: 'Sarah', priority: '', category: '' }),
    ).toEqual([item]);
  });
});
