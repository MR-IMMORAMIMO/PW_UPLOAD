import type { ProjectActivity, WorkspaceActivity } from '@scli/domain';
import { activityDisplayText, activityDisplayValue } from './activityPresentation';

export type ProjectActivityView = WorkspaceActivity & { actorName?: string };

/** Read projection only: source-qualified IDs prevent unrelated audit stores colliding. */
export function projectActivityProjection(
  projectId: string,
  workspace: readonly WorkspaceActivity[],
  audit: readonly ProjectActivity[],
): ProjectActivityView[] {
  const records: ProjectActivityView[] = workspace
    .filter((item) => item.projectId === projectId)
    .map((item) => {
      const actor = / \| mutation actor: (.+) \([0-9a-f-]{36}\)$/.exec(item.detail);
      return {
        ...item,
        id: `workspace:${item.id}`,
        title: activityDisplayText(item.title),
        detail: activityDisplayText(actor ? item.detail.slice(0, actor.index) : item.detail),
        ...(actor ? { actorName: actor[1]! } : {}),
      };
    });
  for (const item of audit) {
    if (item.projectId !== projectId) continue;
    records.push({
      id: `audit:${item.id}`,
      projectId,
      entityType: 'Project',
      entityId: projectId,
      action: item.actionType,
      title: item.actionType.replace(/([a-z])([A-Z])/g, '$1 $2'),
      detail: item.fieldName
        ? `${item.fieldName.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${activityDisplayValue(item.oldValue)} → ${activityDisplayValue(item.newValue)}`
        : activityDisplayText(item.message),
      createdAt: item.createdAt,
      actorName: item.changedByNameSnapshot,
    });
  }
  return [...new Map(records.map((item) => [item.id, item])).values()];
}
