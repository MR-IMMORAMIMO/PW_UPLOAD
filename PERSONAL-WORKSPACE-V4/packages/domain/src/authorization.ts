import { DomainError } from './errors';
import type { AppUser, Project } from './types';

export function isManager(user: AppUser): boolean {
  return user.role === 'LineManager' || user.role === 'Admin';
}

export function canCreateProjectFor(actor: AppUser, salesOwner: AppUser): boolean {
  if (!actor.isActive || !salesOwner.isActive) return false;
  if (actor.role === 'Sales') return actor.id === salesOwner.id;
  if (isManager(actor)) {
    return salesOwner.role === 'Sales' || salesOwner.id === actor.id;
  }
  return false;
}

export function canViewProject(actor: AppUser, project: Project): boolean {
  if (!actor.isActive) return false;
  if (isManager(actor)) return true;
  if (actor.role === 'Sales') return project.salesOwnerId === actor.id;
  return (
    actor.role === 'Designer' &&
    (project.assignedDesignerId === actor.id || project.collaboratorDesignerIds.includes(actor.id))
  );
}

export function isProjectDesigner(actor: AppUser, project: Project): boolean {
  return (
    actor.role === 'Designer' &&
    (project.assignedDesignerId === actor.id || project.collaboratorDesignerIds.includes(actor.id))
  );
}

export function canCommentOnProject(actor: AppUser, project: Project): boolean {
  return (
    canViewProject(actor, project) &&
    project.status !== 'Cancelled' &&
    project.status !== 'Completed' &&
    project.status !== 'Archived'
  );
}

export function canAssignProject(actor: AppUser): boolean {
  return actor.isActive && isManager(actor);
}

export function canManageSettings(actor: AppUser): boolean {
  return actor.isActive && actor.role === 'Admin';
}

export function canEditProjectCommercialValue(actor: AppUser, project: Project): boolean {
  if (!canViewProject(actor, project)) return false;
  return isManager(actor) || (actor.role === 'Sales' && project.salesOwnerId === actor.id);
}

export function canEditProjectField(
  actor: AppUser,
  project: Project,
  field: keyof Project,
): boolean {
  if (field === 'commercialValueMinor' || field === 'commercialCurrency') {
    return canEditProjectCommercialValue(actor, project);
  }
  if (!canViewProject(actor, project)) return false;
  const collaborativeFields = new Set<keyof Project>([
    'projectName',
    'clientName',
    'crmReference',
    'projectType',
    'description',
    'siteLocation',
    'designStage',
    'lightingScope',
    'luxRequirements',
    'drawingReference',
    'requiredDeliveryDate',
    'projectFolderUrl',
  ]);
  if (isManager(actor)) {
    return new Set<keyof Project>([
      ...collaborativeFields,
      'salesOwnerId',
      'assignedDesignerId',
      'collaboratorDesignerIds',
      'status',
      'priority',
      'complexity',
      'estimatedHours',
      'actualHours',
      'progressPercent',
    ]).has(field);
  }
  if (isProjectDesigner(actor, project)) {
    return new Set<keyof Project>([
      ...collaborativeFields,
      'status',
      'progressPercent',
      'actualHours',
    ]).has(field);
  }
  return actor.role === 'Sales' && collaborativeFields.has(field);
}

/**
 * Who may change a project's visible reference through the controlled
 * project-reference update. The operation also coordinates a managed folder
 * rename, so it is restricted to managers and the owning Sales user.
 */
export function canChangeProjectReference(actor: AppUser, project: Project): boolean {
  if (!actor.isActive) return false;
  if (!canViewProject(actor, project)) return false;
  return isManager(actor) || (actor.role === 'Sales' && project.salesOwnerId === actor.id);
}

export function assertPermission(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new DomainError('PERMISSION_DENIED', message, 403);
  }
}
