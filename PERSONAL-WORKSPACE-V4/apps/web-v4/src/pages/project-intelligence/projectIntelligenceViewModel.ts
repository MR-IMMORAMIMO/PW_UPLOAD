import type {
  ProjectSourceFileType,
  ReadinessFindingSeverity,
  ReadinessLevel,
  RevisionImpactCategory,
  RevisionLuminaireDiff,
  SourceFreshnessState,
} from '@scli/domain';

/** P5D pure presentation helpers — no product policy, no I/O. */

export function readinessLevelLabel(level: ReadinessLevel): string {
  switch (level) {
    case 'READY':
      return 'Ready to Issue';
    case 'READY_WITH_WARNINGS':
      return 'Ready with Warnings';
    case 'NOT_READY':
      return 'Not Ready';
  }
}

export type ReadinessPillVariant = 'success' | 'warning' | 'danger';

export function readinessLevelVariant(level: ReadinessLevel): 'success' | 'warning' | 'danger' {
  switch (level) {
    case 'READY':
      return 'success';
    case 'READY_WITH_WARNINGS':
      return 'warning';
    case 'NOT_READY':
      return 'danger';
  }
}

export type SeverityPillVariant = 'danger' | 'warning' | 'neutral';

export function findingSeverityVariant(severity: ReadinessFindingSeverity): SeverityPillVariant {
  switch (severity) {
    case 'BLOCKER':
      return 'danger';
    case 'WARNING':
      return 'warning';
    case 'INFO':
      return 'neutral';
  }
}

export function sourceFreshnessLabel(state: SourceFreshnessState): string {
  switch (state) {
    case 'FRESH':
      return 'Fresh';
    case 'STALE':
      return 'Stale';
    case 'MISSING':
      return 'Missing';
    case 'NOT_BASELINED':
      return 'Not Baselined';
    case 'UNAVAILABLE':
      return 'Unavailable';
  }
}

export type SourceFreshnessPillVariant = 'success' | 'danger' | 'warning' | 'neutral';

export function sourceFreshnessVariant(
  state: SourceFreshnessState,
): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (state) {
    case 'FRESH':
      return 'success';
    case 'STALE':
    case 'MISSING':
      return 'danger';
    case 'NOT_BASELINED':
      return 'warning';
    case 'UNAVAILABLE':
      return 'neutral';
  }
}

export function impactCategoryLabel(category: RevisionImpactCategory): string {
  switch (category) {
    case 'QUANTITY_BOQ_IMPACT':
      return 'Quantity / BOQ';
    case 'TECHNICAL_SCHEDULE_IMPACT':
      return 'Technical Schedule';
    case 'PRODUCT_ORDERING_CODE_IMPACT':
      return 'Ordering Code';
    case 'DATASHEET_VERIFICATION_IMPACT':
      return 'Datasheet / Verification';
    case 'OUTPUT_COMPOSITION_IMPACT':
      return 'Output Composition';
  }
}

export function sourceTypeLabel(sourceType: ProjectSourceFileType): string {
  switch (sourceType) {
    case 'AUTOCAD':
      return 'AutoCAD';
    case 'DIALUX':
      return 'DIALux';
    case 'EXCEL':
      return 'Excel';
    case 'OTHER':
      return 'Other';
  }
}

/** Deterministic comparison grouping: changed first, then added/removed, then unchanged. */
export function sortedDiffLuminaires(
  items: readonly RevisionLuminaireDiff[],
): RevisionLuminaireDiff[] {
  const order: Record<RevisionLuminaireDiff['changeType'], number> = {
    CHANGED: 0,
    ADDED: 1,
    REMOVED: 2,
    UNCHANGED: 3,
  };
  return [...items].sort((a, b) => {
    const byType = order[a.changeType] - order[b.changeType];
    return byType !== 0 ? byType : a.tag.localeCompare(b.tag);
  });
}

export const diffChangeLabel: Record<RevisionLuminaireDiff['changeType'], string> = {
  ADDED: 'Added',
  REMOVED: 'Removed',
  CHANGED: 'Changed',
  UNCHANGED: 'Unchanged',
};

export type DiffPillVariant = 'success' | 'danger' | 'warning' | 'neutral';

export function diffChangeVariant(
  changeType: RevisionLuminaireDiff['changeType'],
): DiffPillVariant {
  switch (changeType) {
    case 'ADDED':
      return 'success';
    case 'REMOVED':
      return 'danger';
    case 'CHANGED':
      return 'warning';
    case 'UNCHANGED':
      return 'neutral';
  }
}
