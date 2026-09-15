/**
 * Phase 5D — Project Intelligence & Productivity domain types.
 *
 * Ownership boundary:
 *   - Revision Comparison reads ONLY the immutable canonical Revision snapshot
 *     authority (canonical_revisions.luminaire_snapshot_json). Nothing here
 *     reinterprets current Project or Library state as historical truth.
 *   - Readiness aggregates existing authoritative signals; every finding is
 *     deterministic and testable. No numeric gamification score.
 *   - Controlled Source Freshness tracks explicitly admitted files with
 *     server-computed SHA-256 baselines per exact Revision UUID.
 */

// ---------------------------------------------------------------------------
// Project Actions — issue-blocking semantics
// ---------------------------------------------------------------------------

export const actionIssueBlockingStatuses = ['Open', 'InProgress', 'Waiting'] as const;
export type ActionIssueBlockingStatus = (typeof actionIssueBlockingStatuses)[number];

/** An open Action that explicitly blocks Issue (Open / InProgress / Waiting + blocksIssue). */
export function actionBlocksIssue(status: string, blocksIssue: boolean): boolean {
  return (actionIssueBlockingStatuses as readonly string[]).includes(status) && blocksIssue;
}

// ---------------------------------------------------------------------------
// Controlled Project Source References
// ---------------------------------------------------------------------------

export const projectSourceFileTypes = ['AUTOCAD', 'DIALUX', 'EXCEL', 'OTHER'] as const;
export type ProjectSourceFileType = (typeof projectSourceFileTypes)[number];

export interface ProjectSourceFile {
  id: string;
  projectId: string;
  sourceType: ProjectSourceFileType;
  displayName: string;
  /** Root-relative governed locator (server-verified; never renderer-supplied). */
  originalRelativeLocator: string;
  latestHash: string;
  latestSize: number;
  latestModifiedAt: string;
  lastCheckedAt: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Revision Source Baselines (immutable historical evidence)
// ---------------------------------------------------------------------------

export interface RevisionSourceFileBaseline {
  baselineId: string;
  projectId: string;
  revisionId: string;
  sourceFileId: string;
  sha256: string;
  sizeBytes: number;
  capturedAt: string;
  capturedById: string;
  capturedByName: string;
}

export const sourceFreshnessStates = [
  'FRESH',
  'STALE',
  'MISSING',
  'NOT_BASELINED',
  'UNAVAILABLE',
] as const;
export type SourceFreshnessState = (typeof sourceFreshnessStates)[number];

/**
 * Freshness of ONE controlled source relative to ONE exact Revision baseline.
 * `baseline` is null for NOT_BASELINED / UNAVAILABLE.
 */
export interface SourceFreshnessItem {
  source: ProjectSourceFile;
  /** Exact Revision UUID the freshness is evaluated against. */
  revisionId: string;
  state: SourceFreshnessState;
  baseline: RevisionSourceFileBaseline | null;
  /** Current bytes when a baseline exists; null when the file cannot be resolved. */
  currentHash: string | null;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Revision Comparison
// ---------------------------------------------------------------------------

export const revisionDiffChangeTypes = ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'] as const;
export type RevisionDiffChangeType = (typeof revisionDiffChangeTypes)[number];

/** Engineering-relevant field families for impact classification. */
export const revisionImpactCategories = [
  'QUANTITY_BOQ_IMPACT',
  'TECHNICAL_SCHEDULE_IMPACT',
  'PRODUCT_ORDERING_CODE_IMPACT',
  'DATASHEET_VERIFICATION_IMPACT',
  'OUTPUT_COMPOSITION_IMPACT',
] as const;
export type RevisionImpactCategory = (typeof revisionImpactCategories)[number];

export interface RevisionFieldChange {
  /** Canonical snapshot field key (e.g. `wattage`, `quantity`, `orderingCode`). */
  field: string;
  label: string;
  /** Historical value from the FROM Revision snapshot. */
  before: unknown;
  /** Historical value from the TO Revision snapshot. */
  after: unknown;
  /** Impact family the field belongs to. */
  category: RevisionImpactCategory;
}

/** One Luminaire change between two exact Revision snapshots. */
export interface RevisionLuminaireDiff {
  /** Stable Project Luminaire UUID (never inferred from Tag). */
  luminaireId: string;
  tag: string;
  changeType: RevisionDiffChangeType;
  changedFields: RevisionFieldChange[];
  /** Impact families touched by this luminaire's changes. */
  impactCategories: RevisionImpactCategory[];
}

/** Compact engineering summary above the detailed diff. */
export interface RevisionImpactSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  technicalChanges: number;
  quantityChanges: number;
  orderingCodeChanges: number;
  datasheetChanges: number;
  /** Deterministic category counts (only categories with at least one change). */
  impactedCategories: RevisionImpactCategory[];
}

export interface RevisionComparison {
  projectId: string;
  fromRevisionId: string;
  toRevisionId: string;
  fromRevisionLabel: string;
  toRevisionLabel: string;
  fromFinalizedAt: string | null;
  toFinalizedAt: string | null;
  summary: RevisionImpactSummary;
  luminaires: RevisionLuminaireDiff[];
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export const readinessLevels = ['READY', 'READY_WITH_WARNINGS', 'NOT_READY'] as const;
export type ReadinessLevel = (typeof readinessLevels)[number];

export const readinessFindingSeverities = ['BLOCKER', 'WARNING', 'INFO'] as const;
export type ReadinessFindingSeverity = (typeof readinessFindingSeverities)[number];

export interface ReadinessFinding {
  /** Stable deterministic code (e.g. `ACTION_BLOCKS_ISSUE`, `SOURCE_STALE`). */
  code: string;
  severity: ReadinessFindingSeverity;
  title: string;
  detail: string;
  /** Concrete evidence/context (IDs, counts, labels) — never path noise. */
  evidence: string;
  /** Which authority produced the finding (storage / revision / verification / actions / sources / issue / assets). */
  sourceAuthority:
    | 'STORAGE'
    | 'REVISION'
    | 'TECHNICAL_VERIFICATION'
    | 'ACTIONS'
    | 'SOURCES'
    | 'ISSUE_WORKFLOW'
    | 'ASSETS';
  /** Recommended navigation/fix target (existing route concept, e.g. `technical-check`). */
  recommendedTarget: string | null;
}

export interface ReadinessResult {
  projectId: string;
  revisionId: string;
  revisionLabel: string;
  level: ReadinessLevel;
  findings: ReadinessFinding[];
  /** Deterministic counts for the summary strip. */
  counts: {
    blockers: number;
    warnings: number;
    info: number;
    openBlockingActions: number;
    staleSources: number;
    totalLuminaireChanges: number;
  };
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Project Intelligence overview (one cohesive Project-scoped surface)
// ---------------------------------------------------------------------------

/**
 * GET /projects/:projectId/intelligence payload — the route returns lightweight
 * projections (revision list, action counts, source counts) separately from the
 * readiness result, which is fetched for an exact Revision.
 */
export interface ProjectIntelligenceOverviewPayload {
  projectId: string;
  checkedAt: string;
  readiness: null;
  revisions: Array<{
    revisionId: string;
    revisionLabel: string;
    lifecycleState: string;
    finalizedAt: string | null;
  }>;
  actionCounts: {
    open: number;
    inProgress: number;
    done: number;
    cancelled: number;
    openBlocking: number;
  };
  sourceCounts: {
    total: number;
    available: number;
  };
}
