/**
 * Pure presentation derivation for the V4 Scope & Services page.
 *
 * The page deliberately exposes only the canonical workspace scope, its
 * deliverables, and requirements. It does not infer notes, exclusions, or
 * cross-record links that the workspace model does not own.
 */
import type { ProjectDeliverable, ProjectRequirement, ProjectScopeItem } from '@scli/domain';

export interface ScopeSummary {
  serviceCount: number;
  deliverableCount: number;
  requiredDeliverableCount: number;
  openRequirementCount: number;
}

export function buildScopeSummary(input: {
  scopeItems: readonly ProjectScopeItem[];
  deliverables: readonly ProjectDeliverable[];
  requirements: readonly ProjectRequirement[];
}): ScopeSummary {
  return {
    serviceCount: input.scopeItems.length,
    deliverableCount: input.deliverables.length,
    requiredDeliverableCount: input.deliverables.filter((item) => item.required).length,
    openRequirementCount: input.requirements.filter(
      (item) => item.status !== 'Received' && item.status !== 'NotRequired',
    ).length,
  };
}

export function deliverableStatusLabel(deliverable: ProjectDeliverable): string {
  return deliverable.status.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function requirementSupportingText(requirement: ProjectRequirement): string | null {
  if (requirement.details.trim()) return requirement.details;
  if (requirement.requestedFrom.trim()) return `Requested from ${requirement.requestedFrom}`;
  return null;
}
