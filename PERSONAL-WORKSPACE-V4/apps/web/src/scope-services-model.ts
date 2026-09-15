import type {
  Project,
  ProjectDeliverable,
  ProjectRequirement,
  ProjectScopeItem,
} from '@scli/domain';

/**
 * Pure normalized presentation view-model for the Scope & Services project page.
 *
 * This module is intentionally framework-free: it maps canonical domain records
 * (`Project` + `ProjectWorkspace` with its embedded `scopeItems`, `deliverables`
 * and `requirements`) into a single `ScopeServicesView` shape the Scope & Services
 * UI consumes. It performs NO persistence, NO mutation of its inputs, and NO
 * fabrication of data. Optional fields (Lux Requirements, CRM Reference, etc.)
 * are omitted when the canonical source does not provide them — never invented.
 */

/** A scope item grouped for presentation. */
export interface ScopeServiceView {
  id: string;
  label: string;
  /** true when this is a project-specific custom scope item, false for a built-in service. */
  custom: boolean;
}

/** Project Brief fields that belong to Scope / coordination. */
export interface ProjectBriefView {
  crmReference: string | null;
  commercialValue: string | null;
  drawingReference: string | null;
  estimatedHours: number | null;
  /** Amount + currency pair preserved verbatim for canonical formatting. */
  commercialValueMinor: number | null;
  commercialCurrency: string | null;
}

export interface ScopeSummaryView {
  /** Canonical Project.lightingScope. Absent when empty. */
  lightingScope: string | null;
  /** Canonical Project.luxRequirements. Absent when empty. */
  luxRequirements: string | null;
}

/** A requirement grouped for presentation. */
export interface RequirementView {
  id: string;
  category: string;
  title: string;
  status: ProjectRequirement['status'];
  impact: ProjectRequirement['impact'];
  notes: string;
  dueDate: string | null;
}

/** Requirements & Exclusions presentation group. */
export interface RequirementsView {
  /** Active / in-flight requirements (status !== 'NotRequired'). */
  active: RequirementView[];
  /** Exclusion-style requirements (status === 'NotRequired'). */
  exclusions: RequirementView[];
}

export interface ScopeServicesView {
  /** Narrative scope text + lux requirements from Project. */
  scopeSummary: ScopeSummaryView;
  /** Built-in service selections, in canonical order. */
  builtInServices: ScopeServiceView[];
  /** Project-specific custom scope items, in canonical order. */
  customServices: ScopeServiceView[];
  /** Current required canonical deliverables derived from selected services. */
  deliverables: ProjectDeliverable[];
  /** Project Brief fields belonging to Scope & coordination. */
  projectBrief: ProjectBriefView;
  /** Requirements & NotRequired exclusions. */
  requirements: RequirementsView;
  /** Whether the project has any configured scope. */
  hasScope: boolean;
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when the requirement is an exclusion-style (NotRequired) record. */
export function isExclusion(requirement: ProjectRequirement): boolean {
  return requirement.status === 'NotRequired';
}

/**
 * Builds the Scope & Services view from canonical project + workspace data.
 * Requirements and deliverables are read from the workspace payload (they ride
 * on the project-workspace query) — this model adds NO extra data fetch.
 */
export function scopeServicesView(
  project: Project,
  workspace: {
    scopeItems: ProjectScopeItem[];
    deliverables: ProjectDeliverable[];
    requirements: ProjectRequirement[];
  },
): ScopeServicesView {
  const scopeItems = workspace.scopeItems ?? [];
  const builtInServices = scopeItems.filter((item) => !item.custom);
  const customServices = scopeItems.filter((item) => item.custom);

  const requirements = [...workspace.requirements].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  return {
    scopeSummary: {
      lightingScope: isNonEmpty(project.lightingScope) ? project.lightingScope.trim() : null,
      luxRequirements: isNonEmpty(project.luxRequirements) ? project.luxRequirements.trim() : null,
    },
    builtInServices: builtInServices.map((item) => ({
      id: item.id,
      label: item.label,
      custom: false,
    })),
    customServices: customServices.map((item) => ({
      id: item.id,
      label: item.label,
      custom: true,
    })),
    deliverables: [...workspace.deliverables]
      .filter((item) => item.required === true)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    projectBrief: {
      crmReference: isNonEmpty(project.crmReference) ? project.crmReference : null,
      commercialValueMinor: project.commercialValueMinor ?? null,
      commercialCurrency: isNonEmpty(project.commercialCurrency)
        ? project.commercialCurrency
        : null,
      commercialValue:
        project.commercialValueMinor !== null &&
        project.commercialValueMinor !== undefined &&
        isNonEmpty(project.commercialCurrency)
          ? `${project.commercialCurrency}:${project.commercialValueMinor}`
          : null,
      drawingReference: isNonEmpty(project.drawingReference) ? project.drawingReference : null,
      estimatedHours:
        typeof project.estimatedHours === 'number' && Number.isFinite(project.estimatedHours)
          ? project.estimatedHours
          : null,
    },
    requirements: {
      active: requirements.filter((item) => !isExclusion(item)).map(toRequirementView),
      exclusions: requirements.filter(isExclusion).map(toRequirementView),
    },
    hasScope: scopeItems.length > 0,
  };
}

function toRequirementView(item: ProjectRequirement): RequirementView {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    status: item.status,
    impact: item.impact,
    notes: item.notes,
    dueDate: item.dueDate,
  };
}
