import { DomainError } from './errors';
import type { Project, ProjectStatus, Role } from './types';

export const allowedStatusTransitions: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  Planning: ['InProgress', 'WaitingForInformation', 'OnHold', 'Cancelled'],
  NewRequest: ['UnderReview', 'Unassigned', 'Cancelled'],
  UnderReview: ['Unassigned', 'Assigned', 'OnHold', 'Cancelled'],
  Unassigned: ['Assigned', 'UnderReview', 'OnHold', 'Cancelled'],
  Assigned: ['InProgress', 'WaitingForInformation', 'OnHold', 'Cancelled'],
  InProgress: [
    'WaitingForInformation',
    'WaitingForSales',
    'InternalReview',
    'RevisionRequired',
    'ReadyToIssue',
    'OnHold',
    'Completed',
    'Cancelled',
  ],
  ClientReview: ['RevisionRequired', 'OnHold', 'Cancelled'],
  WaitingForInformation: ['InProgress', 'WaitingForSales', 'OnHold', 'Cancelled'],
  WaitingForSales: ['InProgress', 'RevisionRequired', 'OnHold', 'Cancelled'],
  InternalReview: [
    'InProgress',
    'RevisionRequired',
    'ReadyToIssue',
    'Completed',
    'OnHold',
    'Cancelled',
  ],
  RevisionRequired: [
    'InProgress',
    'WaitingForSales',
    'InternalReview',
    'ReadyToIssue',
    'OnHold',
    'Cancelled',
  ],
  ReadyToIssue: ['Issued', 'RevisionRequired', 'InProgress', 'OnHold', 'Cancelled'],
  Issued: ['Completed', 'RevisionRequired', 'InProgress', 'Archived'],
  OnHold: ['Planning', 'UnderReview', 'Unassigned', 'Assigned', 'InProgress', 'Cancelled'],
  Completed: ['Archived', 'RevisionRequired', 'InProgress'],
  Archived: ['InProgress'],
  Cancelled: ['Unassigned', 'Assigned'],
};

const designerStatuses = new Set<ProjectStatus>([
  'InProgress',
  'Planning',
  'WaitingForInformation',
  'WaitingForSales',
  'InternalReview',
  'ReadyToIssue',
  'Issued',
  'Completed',
]);

export function isTransitionAllowed(from: ProjectStatus, to: ProjectStatus): boolean {
  return from === to || allowedStatusTransitions[from].includes(to);
}

export function canRoleSetStatus(role: Role, from: ProjectStatus, to: ProjectStatus): boolean {
  if (!isTransitionAllowed(from, to)) return false;
  if (role === 'Admin' || role === 'LineManager') return true;
  if (role === 'Designer') return designerStatuses.has(to);
  return role === 'Sales' && from === 'Completed' && to === 'RevisionRequired';
}

export function assertStatusTransition(role: Role, from: ProjectStatus, to: ProjectStatus): void {
  if (!canRoleSetStatus(role, from, to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Transition from ${from} to ${to} is not allowed for ${role}.`,
      409,
      { from, to, role },
    );
  }
}

/**
 * Personal workflow transition policy. Unlike the shared Team graph, this is
 * project-context-aware: OnHold resume depends on the recorded statusBeforeHold
 * and terminal reopen is explicit. It preserves the legacy Personal-compatible
 * statuses (WaitingForInformation, WaitingForSales, InternalReview,
 * ReadyToIssue, Issued) so historical projects remain safe and the existing
 * Personal UI keeps working, while adding the P2.5 primary workflow
 * (Planning -> InProgress -> ClientReview -> RevisionRequired -> ...).
 */
export function getAllowedPersonalTransitions(project: Project): ProjectStatus[] {
  const from = project.status;
  if (from === 'OnHold') {
    const resumeTarget = project.statusBeforeHold ?? 'InProgress';
    return [resumeTarget, 'Cancelled'];
  }
  if (from === 'Completed') {
    return ['InProgress', 'Archived', 'RevisionRequired'];
  }
  if (from === 'Cancelled') {
    return ['InProgress', 'Unassigned', 'Assigned'];
  }
  switch (from) {
    case 'Planning':
      return ['InProgress', 'WaitingForInformation', 'OnHold', 'Cancelled'];
    case 'InProgress':
      return [
        'ClientReview',
        'WaitingForInformation',
        'WaitingForSales',
        'InternalReview',
        'RevisionRequired',
        'ReadyToIssue',
        'OnHold',
        'Completed',
        'Cancelled',
      ];
    case 'ClientReview':
      return ['RevisionRequired', 'OnHold', 'Completed', 'Cancelled'];
    case 'WaitingForInformation':
      return ['InProgress', 'WaitingForSales', 'OnHold', 'Cancelled'];
    case 'WaitingForSales':
      return ['InProgress', 'RevisionRequired', 'OnHold', 'Cancelled'];
    case 'InternalReview':
      return ['InProgress', 'RevisionRequired', 'ReadyToIssue', 'Completed', 'OnHold', 'Cancelled'];
    case 'RevisionRequired':
      return [
        'InProgress',
        'WaitingForSales',
        'InternalReview',
        'ReadyToIssue',
        'OnHold',
        'Cancelled',
      ];
    case 'ReadyToIssue':
      return ['Issued', 'RevisionRequired', 'InProgress', 'OnHold', 'Cancelled'];
    case 'Issued':
      return ['Completed', 'RevisionRequired', 'InProgress', 'Archived'];
    case 'Archived':
      return ['InProgress'];
    default:
      return [];
  }
}

export function canPersonalTransition(project: Project, target: ProjectStatus): boolean {
  return getAllowedPersonalTransitions(project).includes(target);
}

export const statusLabels: Record<ProjectStatus, string> = {
  Planning: 'Planning',
  NewRequest: 'New Request',
  UnderReview: 'Under Review',
  Unassigned: 'Unassigned',
  Assigned: 'Assigned',
  InProgress: 'In Progress',
  ClientReview: 'Client Review',
  WaitingForInformation: 'Waiting for Information',
  WaitingForSales: 'Waiting for Sales',
  InternalReview: 'Internal Review',
  RevisionRequired: 'Revision Required',
  ReadyToIssue: 'Ready to Issue',
  Issued: 'Issued',
  OnHold: 'On Hold',
  Completed: 'Completed',
  Archived: 'Archived',
  Cancelled: 'Cancelled',
};
