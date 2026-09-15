import { statusLabels, type ProjectStatus } from '@scli/domain';

export function personalStatusLabel(status: ProjectStatus): string {
  return status === 'Planning' ? 'Not Started Yet' : statusLabels[status];
}

/**
 * Concise professional context for the canonical Personal workflow statuses.
 * Legacy Personal-compatible statuses have no dedicated description and return
 * null so the UI can fall back to a neutral presentation.
 */
export function personalStatusDescription(status: ProjectStatus): string | null {
  switch (status) {
    case 'Planning':
      return 'Work has not started yet.';
    case 'InProgress':
      return 'Design work is currently active.';
    case 'ClientReview':
      return 'Waiting for client feedback or approval.';
    case 'RevisionRequired':
      return 'Client feedback requires design updates.';
    case 'OnHold':
      return 'Project workflow is temporarily paused.';
    case 'Completed':
      return 'Project work is complete.';
    case 'Cancelled':
      return 'Project has been cancelled.';
    default:
      return null;
  }
}
