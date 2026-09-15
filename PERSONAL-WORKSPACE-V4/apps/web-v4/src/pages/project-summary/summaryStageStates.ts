import type { ProjectStatus } from '@scli/domain';
import type { WorkflowHistoryResponse } from '@scli/contracts';

/** Presentation groups only. They never replace canonical statuses or synthesize history. */
export function summaryStageForStatus(status: ProjectStatus): string | null {
  const groups: Partial<Record<ProjectStatus, string>> = {
    Planning: 'setup',
    NewRequest: 'setup',
    UnderReview: 'setup',
    Unassigned: 'setup',
    Assigned: 'setup',
    InProgress: 'design',
    WaitingForInformation: 'design',
    WaitingForSales: 'design',
    InternalReview: 'technical',
    ReadyToIssue: 'technical',
    Issued: 'issue',
    Completed: 'issue',
    ClientReview: 'client-review',
    RevisionRequired: 'revision',
  };
  return groups[status] ?? null;
}
export function summaryStageStates(
  status: ProjectStatus,
  transitions: WorkflowHistoryResponse['transitions'],
) {
  const visited = new Set(
    transitions.flatMap((transition) => [
      summaryStageForStatus(transition.fromStatus),
      summaryStageForStatus(transition.toStatus),
    ]),
  );
  const active = summaryStageForStatus(status);
  return Object.fromEntries(
    ['setup', 'design', 'technical', 'issue', 'client-review', 'revision'].map((stage) => [
      stage,
      stage === active ? 'active' : visited.has(stage) ? 'completed' : 'pending',
    ]),
  ) as Record<string, 'active' | 'completed' | 'pending'>;
}
