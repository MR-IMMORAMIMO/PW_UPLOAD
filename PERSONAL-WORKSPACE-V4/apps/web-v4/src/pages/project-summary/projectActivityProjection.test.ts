import { describe, expect, it } from 'vitest';
import type { ProjectActivity, WorkspaceActivity } from '@scli/domain';
import { projectActivityProjection } from './projectActivityProjection';
import { recentActivity } from './projectSummaryViewModel';

const audit: ProjectActivity = {
  id: 'same-id',
  projectId: 'project-1',
  actionType: 'ProjectCreated',
  fieldName: null,
  oldValue: null,
  newValue: null,
  message: 'Created from approved request.',
  changedById: 'actor-1',
  changedByNameSnapshot: 'Actual actor',
  createdAt: '2026-09-09T10:00:00Z',
};
const workspace: WorkspaceActivity = {
  id: 'same-id',
  projectId: 'project-1',
  entityType: 'Scope',
  entityId: 'scope-1',
  action: 'Updated',
  title: 'Scope updated',
  detail: 'Actual scope change',
  createdAt: '2026-09-09T11:00:00Z',
};
describe('Project activity read projection', () => {
  it('uses recorded old/new values, removes technical reference noise and recovers recorded mutation actors', () => {
    const raw = {
      ...audit,
      fieldName: 'requiredDeliveryDate',
      oldValue: '2026-09-10',
      newValue: '',
    };
    const records = projectActivityProjection(
      'project-1',
      [
        {
          ...workspace,
          detail: `Updated ${'a'.repeat(64)} | mutation actor: Recorded Owner (00000000-0000-4000-8000-000000000001)`,
        },
      ],
      [raw],
    );
    expect(records[0]?.actorName).toBe('Recorded Owner');
    expect(records[0]?.detail).toBe('Updated file fingerprint');
    expect(records[1]?.detail).toContain('10 Sept 2026');
    expect(records[1]?.detail).toContain('Not recorded');
    expect(raw.oldValue).toBe('2026-09-10');
  });
  it('preserves distinct source identities and only persisted actor snapshots', () => {
    const records = projectActivityProjection('project-1', [workspace], [audit]);
    expect(records.map((item) => item.id)).toEqual(['workspace:same-id', 'audit:same-id']);
    expect(recentActivity(records).map((item) => item.actor)).toEqual([null, 'Actual actor']);
    expect(recentActivity(records)[1]?.description).toBe(audit.message);
    expect(workspace.id).toBe('same-id');
  });
  it('excludes other projects even when source IDs match and deduplicates repeated records', () => {
    const records = projectActivityProjection(
      'project-1',
      [workspace, { ...workspace, projectId: 'project-2' }],
      [audit, audit, { ...audit, projectId: 'project-2' }],
    );
    expect(records).toHaveLength(2);
    expect(projectActivityProjection('absent', [workspace], [audit])).toEqual([]);
  });
});
