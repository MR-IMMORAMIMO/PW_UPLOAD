/**
 * Revisions & Deliverables page — pure derivation logic.
 *
 * KPIs, filtering, revision/deliverable grouping, and recovery detection.
 * No React, no side effects.
 */
import type {
  CanonicalRevisionRecord,
  CanonicalOutputPresenceRecord,
  OutputRegistryLifecycleState,
  ProjectRevision,
  ProjectWorkspace,
  RevisionDeliverable,
} from '@scli/domain';
import {
  canonicalRevisionSourceDisplay,
  isComposableTargetRevision,
} from '../../components/revisions/canonicalRevisionDisplay';
import {
  businessCalendarDayDifference,
  businessDateKey,
  businessTodayKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
} from '../../date-time/businessDateTime';

export type RevisionsTab = 'revisions' | 'deliverables' | 'recovery';

export interface RevisionKpi {
  totalRevisions: number;
  latestRevisionLabel: string | null;
  generatedOutputs: number;
  needsAttention: number;
  /** Real derived captions — always computed from loaded canonical data. */
  captions: {
    totalRevisions: string;
    latestRevision: string;
    generatedOutputs: string;
    needsAttention: string;
  };
}

export interface RevisionRow {
  revision: CanonicalRevisionRecord;
  outputsCount: number;
  compatibilityStatus: string | null;
  /**
   * Owning canonical family of this revision's outputs (if any). Used to wire
   * the RevisionsTable retry control to a REAL recovery target — a FAILED
   * revision only shows Retry when this resolves to a Schedule/BOQ authority.
   */
  recoverableFamily: string | null;
}

/** Owner-facing fields from the persisted compatibility record only. */
export interface RevisionCompatibilitySummary {
  status: ProjectRevision['status'];
  statusLabel: string;
  issuedAt: string | null;
  locked: boolean;
  title: string | null;
  summary: string | null;
  changes: string | null;
  receivedAt: string | null;
  dueDate: string | null;
  sourceType: ProjectRevision['sourceType'];
  reissueNumber: number | null;
}

export interface DeliverableRow {
  deliverable: RevisionDeliverable;
  revisionLabel: string | null;
  revisionSequence: number | null;
  artifactState: ArtifactState;
}

export type ArtifactState = 'Present' | 'Missing' | 'Unavailable';

export interface RecoveryItem {
  kind: 'revision' | 'output';
  id: string;
  label: string;
  family: string | null;
  failureReason: string | null;
  createdAt: string;
  /** Canonical revision id used to invoke the existing schedule/BOQ retry authority. */
  recoveryRevisionId: string | null;
  /** Canonical output family used to select the schedule vs BOQ retry authority. */
  outputFamily: string | null;
  /** Display fields for the recovery inspector (all real, never fabricated). */
  lifecycle: OutputRegistryLifecycleState;
  /** Owning revision label, when determinable (output items). */
  revisionLabel: string | null;
  /** Backend-projected artifact state for output items; null for revision items. */
  artifactState: ArtifactState | null;
  /** Registered output count for revision items; 0 for output items. */
  outputCount: number;
  /** Canonical output format (output items). */
  outputFormat: string | null;
}

/**
 * Whether a recovery item can be retried through an EXISTING canonical
 * authority. Schedule/BOQ outputs (and revisions with a resolvable owning
 * family) retry via the shared recoveryRevisionId contract. A FAILED revision
 * with no owning family (e.g. register-only) has NO generic revision retry API
 * and must be surfaced truthfully instead of with a fake Retry.
 */
export function recoveryItemCanRetry(item: RecoveryItem): boolean {
  return (
    item.recoveryRevisionId !== null &&
    (item.outputFamily === 'LuminaireSchedule' || item.outputFamily === 'TechnicalBoq')
  );
}

/**
 * Whether a recovery item resolves to a REAL canonical owning workspace. Used to
 * label the fallback action truthfully: when the owning family is not
 * determinable the control must not claim to know the owner.
 */
export function hasDeterminableOwningFamily(item: RecoveryItem): boolean {
  return item.outputFamily === 'LuminaireSchedule' || item.outputFamily === 'TechnicalBoq';
}

/**
 * Humanized display label for a canonical output family.
 *
 * Maps ONLY the two real canonical families. Any other value is surfaced
 * verbatim so an unrecognized authority value is never silently relabelled or
 * hidden behind a fabricated display name.
 */
export function outputFamilyLabel(family: string | null | undefined): string | null {
  if (!family) return null;
  if (family === 'LuminaireSchedule') return 'Luminaire Schedule';
  if (family === 'TechnicalBoq') return 'Technical BOQ';
  return family;
}

export function buildRevisionKpis(
  revisions: CanonicalRevisionRecord[],
  outputs: CanonicalOutputPresenceRecord[],
): RevisionKpi {
  const totalRevisions = revisions.length;
  const latest =
    revisions.length > 0
      ? revisions.reduce((latestSoFar, r) =>
          r.revisionSequence > latestSoFar.revisionSequence ? r : latestSoFar,
        )
      : null;
  const latestRevisionLabel = latest?.revisionLabel ?? null;
  // Truthful project-wide metric from already-loaded read authority: canonical
  // Generated Outputs only. DocumentSnapshot deliverables are counted
  // per-Revision (they require a per-Revision read) and are never aggregated
  // via N+1 reads across every Revision.
  const generatedOutputs = outputs.length;
  const failedRevisions = revisions.filter((r) => r.lifecycleState === 'FAILED_RECOVERABLE').length;
  const missingArtifactOutputs = outputs.filter((o) => o.artifactPresence === 'Missing').length;
  const needsAttention = failedRevisions + missingArtifactOutputs;
  const finalized = revisions.filter((r) => r.lifecycleState === 'FINALIZED').length;
  const presentOutputs = outputs.filter((o) => o.artifactPresence === 'Present').length;
  const attentionParts = [
    failedRevisions > 0 ? `${failedRevisions} failed revisions` : null,
    missingArtifactOutputs > 0 ? `${missingArtifactOutputs} missing artifacts` : null,
  ].filter(Boolean);
  return {
    totalRevisions,
    latestRevisionLabel,
    generatedOutputs,
    needsAttention,
    captions: {
      totalRevisions: `${finalized} finalized`,
      latestRevision: latest ? formatIsoDateTime(latest.createdAt) : 'No revisions yet',
      generatedOutputs: `${presentOutputs} present · project-wide`,
      needsAttention: attentionParts.length > 0 ? attentionParts.join(' · ') : 'No action required',
    },
  };
}

export function deriveArtifactState(output: CanonicalOutputPresenceRecord): ArtifactState {
  // The frontend FORMATS the authoritative server projection; it does NOT
  // decide file existence. Physical presence is computed backend-side.
  return output.artifactPresence;
}

function meaningfulText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function compatibilityStatusLabel(status: ProjectRevision['status']): string {
  if (status === 'InProgress') return 'In Progress';
  if (status === 'InternalReview') return 'Internal Review';
  if (status === 'ReadyToIssue') return 'Ready to Issue';
  return status;
}

export function compatibilityTone(status: ProjectRevision['status']): string {
  if (status === 'Issued') return 'success';
  if (status === 'InternalReview') return 'warning';
  if (status === 'InProgress' || status === 'ReadyToIssue') return 'info';
  return 'neutral';
}

/**
 * Resolve compatibility by persisted identity only. Current canonical UUID
 * equality wins; an explicit legacySourceId is the sole safe fallback.
 */
export function buildCompatibilitySummary(
  revision: CanonicalRevisionRecord,
  workspace: ProjectWorkspace | null,
): RevisionCompatibilitySummary | null {
  const records = workspace?.revisions ?? [];
  const record =
    records.find((candidate) => candidate.id === revision.revisionId) ??
    (revision.legacySourceId
      ? records.find((candidate) => candidate.id === revision.legacySourceId)
      : undefined);
  if (!record) return null;

  return {
    status: record.status,
    statusLabel: compatibilityStatusLabel(record.status),
    issuedAt: record.issuedAt,
    locked: record.locked,
    title: meaningfulText(record.title),
    summary: meaningfulText(record.summary),
    changes: meaningfulText(record.changeLog),
    receivedAt: record.receivedAt,
    dueDate: record.dueDate,
    sourceType: record.sourceType,
    reissueNumber: record.reissueNumber > 0 ? record.reissueNumber : null,
  };
}

export function buildRevisionRows(
  revisions: CanonicalRevisionRecord[],
  outputs: CanonicalOutputPresenceRecord[],
  workspace: ProjectWorkspace | null,
): RevisionRow[] {
  const outputsByRevision = new Map<string, CanonicalOutputPresenceRecord[]>();
  for (const output of outputs) {
    if (!output.revisionId) continue;
    const list = outputsByRevision.get(output.revisionId) ?? [];
    list.push(output);
    outputsByRevision.set(output.revisionId, list);
  }

  return revisions.map((revision) => {
    const compat = buildCompatibilitySummary(revision, workspace);
    const compatibilityStatus = compat
      ? `${compat.statusLabel}${compat.locked ? ' (Locked)' : ''}`
      : null;
    const revOutputs = outputsByRevision.get(revision.revisionId) ?? [];
    return {
      revision,
      outputsCount: revOutputs.length,
      compatibilityStatus,
      recoverableFamily: revOutputs.find((o) => o.outputFamily)?.outputFamily ?? null,
    };
  });
}

export function buildDeliverableRows(
  deliverables: RevisionDeliverable[],
  revisions: CanonicalRevisionRecord[],
): DeliverableRow[] {
  const revisionById = new Map(revisions.map((r) => [r.revisionId, r]));
  return deliverables.map((deliverable) => {
    const rev = revisionById.get(deliverable.revisionId);
    return {
      deliverable,
      revisionLabel: rev?.revisionLabel ?? null,
      revisionSequence: rev?.revisionSequence ?? null,
      artifactState: deliverable.presence,
    };
  });
}

/**
 * Humanized, truthful display label for a unified Deliverable's primary
 * identity. GeneratedOutput uses its real output-family label; DocumentSnapshot
 * uses its immutable title (falling back to its snapshot filename).
 */
export function deliverableTitle(deliverable: RevisionDeliverable): string {
  if (deliverable.sourceType === 'GeneratedOutput') {
    return outputFamilyLabel(deliverable.outputFamily) ?? deliverable.title ?? 'Generated Output';
  }
  return deliverable.title ?? deliverable.fileName ?? 'Document Snapshot';
}

/**
 * Truthful Source label for a unified Deliverable. This is a NON-semantic
 * provenance distinction (Generated Output vs Registered File) and must never
 * be confused with artifact presence state.
 */
export function deliverableSourceLabel(deliverable: RevisionDeliverable): string {
  return deliverable.sourceType === 'GeneratedOutput' ? 'Generated Output' : 'Registered File';
}

/** Truthful display Format: output format verbatim, or an extension-derived label only when real. */
export function deliverableFormat(deliverable: RevisionDeliverable): string | null {
  if (deliverable.sourceType === 'GeneratedOutput') return deliverable.format;
  const fileName = deliverable.fileName;
  if (!fileName) return deliverable.format;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toUpperCase();
}

export function buildRecoveryItems(
  revisions: CanonicalRevisionRecord[],
  outputs: CanonicalOutputPresenceRecord[],
): RecoveryItem[] {
  const outputsByRevision = new Map<string, CanonicalOutputPresenceRecord[]>();
  for (const output of outputs) {
    if (!output.revisionId) continue;
    const list = outputsByRevision.get(output.revisionId) ?? [];
    list.push(output);
    outputsByRevision.set(output.revisionId, list);
  }
  const owningFamilyByRevision = new Map<string, string | null>();
  for (const [revisionId, revOutputs] of outputsByRevision) {
    const family = revOutputs.find((o) => o.outputFamily)?.outputFamily ?? null;
    owningFamilyByRevision.set(revisionId, family);
  }
  const revisionById = new Map(revisions.map((r) => [r.revisionId, r]));

  const revItems: RecoveryItem[] = revisions
    .filter((r) => r.lifecycleState === 'FAILED_RECOVERABLE')
    .map((r) => ({
      kind: 'revision' as const,
      id: r.revisionId,
      label: r.revisionLabel,
      family: null,
      failureReason: r.failureReason,
      createdAt: r.createdAt,
      recoveryRevisionId: r.revisionId,
      outputFamily: owningFamilyByRevision.get(r.revisionId) ?? null,
      lifecycle: r.lifecycleState,
      revisionLabel: null,
      artifactState: null,
      outputCount: (outputsByRevision.get(r.revisionId) ?? []).length,
      outputFormat: null,
    }));

  const outItems: RecoveryItem[] = outputs
    .filter((o) => o.lifecycleState === 'FAILED_RECOVERABLE')
    .map((o) => ({
      kind: 'output' as const,
      id: o.outputId,
      label: `${outputFamilyLabel(o.outputFamily) ?? 'Output'} (${o.outputFormat})`,
      family: o.outputFamily,
      failureReason: o.failureReason,
      createdAt: o.createdAt,
      recoveryRevisionId: o.revisionId,
      outputFamily: o.outputFamily,
      lifecycle: o.lifecycleState,
      revisionLabel: o.revisionId ? (revisionById.get(o.revisionId)?.revisionLabel ?? null) : null,
      artifactState: o.artifactPresence,
      outputCount: 0,
      outputFormat: o.outputFormat,
    }));

  return [...revItems, ...outItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * The owner-facing Source of a Revision.
 *
 * Delegates to the ONE shared display mapping (C1 §20) so the Revisions table,
 * the inspector, and the Source filter all say the same thing. Because the
 * filter options are derived from this same function, the filter values and the
 * rendered cells cannot drift apart.
 */
export function sourceDisplay(revision: CanonicalRevisionRecord): string {
  return canonicalRevisionSourceDisplay(revision);
}

export function formatIsoDateTime(iso: string): string {
  return (
    formatBusinessDateTime(iso, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) || '—'
  );
}

export function formatCompatibilityDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateOnly) return formatIsoDateTime(value);
  return (
    formatBusinessDateOnly(value, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) || '—'
  );
}

export function lifecycleTone(state: OutputRegistryLifecycleState): string {
  switch (state) {
    case 'FINALIZED':
      return 'success';
    case 'PREPARING':
      return 'info';
    case 'FAILED_RECOVERABLE':
      return 'danger';
    case 'LEGACY_IMPORTED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/* ==========================================================================
   View-model filters (pure presentation — never mutates authority).
   ========================================================================== */

export type DateFilterKey = 'all' | 'today' | 'last7' | 'last30';

export const DATE_FILTER_OPTIONS: Array<{ value: DateFilterKey; label: string }> = [
  { value: 'all', label: 'All Dates' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
];

export interface RevisionFilters {
  search: string;
  lifecycle: string;
  source: string;
  createdBy: string;
  date: DateFilterKey;
}

export interface DeliverableFilters {
  source: string;
  type: string;
  format: string;
  artifactState: string;
}

export function emptyRevisionFilters(): RevisionFilters {
  return { search: '', lifecycle: '', source: '', createdBy: '', date: 'all' };
}

export function emptyDeliverableFilters(): DeliverableFilters {
  return { source: '', type: '', format: '', artifactState: '' };
}

export function isRevisionFilterActive(filters: RevisionFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.lifecycle !== '' ||
    filters.source !== '' ||
    filters.createdBy !== '' ||
    filters.date !== 'all'
  );
}

export function isDeliverableFilterActive(filters: DeliverableFilters): boolean {
  return (
    filters.source !== '' ||
    filters.type !== '' ||
    filters.format !== '' ||
    filters.artifactState !== ''
  );
}

/** A revision row matches the free-text search across the real displayed fields only. */
export function revisionRowMatchesSearch(row: RevisionRow, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const haystack = [
    row.revision.revisionLabel,
    sourceDisplay(row.revision),
    row.revision.lifecycleState,
    row.revision.createdByName,
    row.compatibilityStatus,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

function revisionInDateRange(createdAt: string, key: DateFilterKey, now: Date): boolean {
  if (key === 'all') return true;
  const createdKey = businessDateKey(createdAt);
  if (!createdKey) return false;
  const age = businessCalendarDayDifference(businessTodayKey(now), createdKey);
  if (age === null || age < 0) return false;
  return age <= (key === 'today' ? 0 : key === 'last7' ? 7 : 30);
}

/** Pure local-presentation filter over the loaded revision rows. */
export function filterRevisionRows(
  rows: RevisionRow[],
  filters: RevisionFilters,
  now: Date = new Date(),
): RevisionRow[] {
  return rows.filter((row) => {
    if (!revisionRowMatchesSearch(row, filters.search)) return false;
    if (filters.lifecycle && row.revision.lifecycleState !== filters.lifecycle) return false;
    if (filters.source && sourceDisplay(row.revision) !== filters.source) return false;
    if (filters.createdBy && (row.revision.createdByName ?? '') !== filters.createdBy) return false;
    if (!revisionInDateRange(row.revision.createdAt, filters.date, now)) return false;
    return true;
  });
}

/**
 * Pure local-presentation filter over the loaded deliverable rows.
 *
 * source compares the truthful sourceType provenance ('GeneratedOutput' |
 * 'DocumentSnapshot'); type compares the real display type/category label
 * (canonical family label for GeneratedOutput, document category for
 * DocumentSnapshot); format compares the derived display format; artifactState
 * compares physical presence.
 */
export function filterDeliverableRows(
  rows: DeliverableRow[],
  filters: DeliverableFilters,
): DeliverableRow[] {
  return rows.filter((row) => {
    const d = row.deliverable;
    if (filters.source && d.sourceType !== filters.source) return false;
    if (filters.type && deliverableTypeLabel(d) !== filters.type) return false;
    if (filters.format && (deliverableFormat(d) ?? '') !== filters.format) return false;
    if (filters.artifactState && row.artifactState !== filters.artifactState) return false;
    return true;
  });
}

/**
 * Truthful display Type for a unified Deliverable: the canonical family label
 * for GeneratedOutput, or the document category for DocumentSnapshot. Never
 * fabricated.
 */
export function deliverableTypeLabel(deliverable: RevisionDeliverable): string | null {
  if (deliverable.sourceType === 'GeneratedOutput') {
    return outputFamilyLabel(deliverable.outputFamily);
  }
  return deliverable.category ?? null;
}

/** Derive filter options from the LOADED revision rows (real values only). */
export function deriveRevisionFilterOptions(rows: RevisionRow[]): {
  lifecycles: string[];
  sources: string[];
  createdBy: string[];
} {
  const lifecycles = [...new Set(rows.map((row) => row.revision.lifecycleState))].sort();
  const sources = [...new Set(rows.map((row) => sourceDisplay(row.revision)))].sort();
  const createdBy = [
    ...new Set(
      rows.map((row) => row.revision.createdByName).filter((n): n is string => Boolean(n)),
    ),
  ].sort();
  return { lifecycles, sources, createdBy };
}

/** Derive filter options from the LOADED deliverable rows (real values only). */
export function deriveDeliverableFilterOptions(rows: DeliverableRow[]): {
  sources: string[];
  types: string[];
  formats: string[];
  artifactStates: string[];
} {
  const sources = [...new Set(rows.map((row) => row.deliverable.sourceType))].sort();
  const types = [
    ...new Set(
      rows
        .map((row) => deliverableTypeLabel(row.deliverable))
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const formats = [
    ...new Set(
      rows
        .map((row) => deliverableFormat(row.deliverable))
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const artifactStates = [...new Set(rows.map((row) => row.artifactState))].sort();
  return { sources, types, formats, artifactStates };
}

/** Paginate a filtered list; returns the slice for the requested page. */
export function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)));
  return rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
}

/**
 * The PREPARING composed Revisions that may currently receive a generated Output.
 *
 * PACKAGES-E2E-01 — the explicit target set for Generate Output. Only CANONICAL
 * MANUAL_DELIVERABLES PREPARING Revisions are composable; FINALIZED, FAILED,
 * generated-output, register-only, and legacy Revisions are never targets.
 * Ordered newest-first by sequence (presentation only — identity is the UUID).
 */
export function composableTargetRevisions(
  revisions: readonly CanonicalRevisionRecord[],
): CanonicalRevisionRecord[] {
  return revisions
    .filter((revision) => isComposableTargetRevision(revision))
    .sort((left, right) => right.revisionSequence - left.revisionSequence);
}
