import type {
  CanonicalOutputPresenceRecord,
  IssueHistoryRecord,
  PackageRevisionSummary,
  ProjectQualityCheck,
  ProjectWorkspace,
  RevisionPackageCatalog,
  RevisionPackageGroup,
  RevisionPackageItem,
  RevisionPackageRecord,
} from '@scli/domain';

export type PackageArtifactState = 'Present' | 'Missing' | 'Unavailable' | 'Not generated';

export interface PackageHistoryRow {
  packageId: string;
  packageSequence: number;
  label: string;
  businessStatus: 'Draft' | 'Issued';
  lifecycleState: string;
  issuedByName: string | null;
  issuedAt: string | null;
  deliverableCount: number;
}

/** Builds compact canonical history rows for a selected Revision's issue history. */
export function historyForRevision(
  history: readonly IssueHistoryRecord[],
  revisionId: string | null,
): IssueHistoryRecord[] {
  if (!revisionId) return [];
  return history.filter((record) => record.revision.revisionId === revisionId);
}

export interface PackageOutputRow {
  id: string;
  label: string;
  group: RevisionPackageGroup;
  family: string;
  format: string;
  fileName: string;
  artifactState: PackageArtifactState;
  available: boolean;
  outdated: boolean;
  modifiedAt: string | null;
  note: string;
  /**
   * PACKAGES-E2E-05B — structured Luminaire metadata for a Datasheet row.
   * Present only for Datasheet DocumentSnapshots; derived structurally by the
   * server (sourceAssetVersionId -> Luminaire), never from title/fileName.
   */
  datasheet?: { tag: string; manufacturer: string; model: string };
}

export interface PackageReadiness {
  blocking: ProjectQualityCheck[];
  warnings: ProjectQualityCheck[];
  info: ProjectQualityCheck[];
  hardGuards: string[];
  outdatedOutputCount: number;
  /** PACKAGES-E2E-05B — available Datasheets deliberately deselected from the Package. */
  deselectedDatasheetCount: number;
  state: 'Ready' | 'Warnings' | 'Blocked';
}

const supportedPresentation = new Map<string, { group: RevisionPackageGroup; label: string }>([
  ['LuminaireSchedule:PDF', { group: 'SchedulePdf', label: 'Luminaire Schedule PDF' }],
  ['LuminaireSchedule:XLSX', { group: 'ScheduleExcel', label: 'Luminaire Schedule Excel' }],
  ['TechnicalBoq:PDF', { group: 'TechnicalBoqPdf', label: 'Technical BOQ PDF' }],
  ['TechnicalBoq:XLSX', { group: 'TechnicalBoqExcel', label: 'Technical BOQ Excel' }],
  ['PresentationSchedule:PDF', { group: 'SchedulePdf', label: 'Presentation Schedule PDF' }],
  ['DatasheetRegister:PDF', { group: 'Datasheets', label: 'Datasheet Register PDF' }],
]);

const supportedGroups = new Set<RevisionPackageGroup>([
  'SchedulePdf',
  'ScheduleExcel',
  'TechnicalBoqPdf',
  'TechnicalBoqExcel',
  'Documents',
  'Datasheets',
]);

const groupFallback: Partial<
  Record<RevisionPackageGroup, { family: string; format: string; label: string }>
> = {
  SchedulePdf: { family: 'Luminaire Schedule', format: 'PDF', label: 'Luminaire Schedule PDF' },
  ScheduleExcel: {
    family: 'Luminaire Schedule',
    format: 'XLSX',
    label: 'Luminaire Schedule Excel',
  },
  TechnicalBoqPdf: { family: 'Technical BOQ', format: 'PDF', label: 'Technical BOQ PDF' },
  TechnicalBoqExcel: {
    family: 'Technical BOQ',
    format: 'XLSX',
    label: 'Technical BOQ Excel',
  },
  Datasheets: { family: 'Datasheet Register', format: 'PDF', label: 'Datasheet Register PDF' },
};

export function isSupportedCanonicalOutput(output: CanonicalOutputPresenceRecord): boolean {
  return supportedPresentation.has(`${output.outputFamily ?? ''}:${output.outputFormat}`);
}

export function eligiblePackageRevisions(
  revisions: readonly PackageRevisionSummary[],
): PackageRevisionSummary[] {
  return revisions
    .filter((revision) => revision.lifecycleState === 'FINALIZED')
    .sort((left, right) => right.revisionSequence - left.revisionSequence);
}

function artifactState(
  item: RevisionPackageItem,
  output: CanonicalOutputPresenceRecord | undefined,
  isSnapshotGroup: boolean,
): PackageArtifactState {
  if (item.id.startsWith('missing:')) return 'Not generated';
  if (isSnapshotGroup) {
    // DocumentSnapshot rows carry no GeneratedOutput record. Their artifact
    // presence is authoritative in the catalog item's `available` flag (the
    // server derived it from the immutable snapshot locator presence).
    return item.available ? 'Present' : 'Missing';
  }
  if (item.available && output?.artifactPresence === 'Present') return 'Present';
  if (output?.artifactPresence === 'Missing') return 'Missing';
  return 'Unavailable';
}

function displayFamily(value: string | null | undefined): string {
  if (value === 'LuminaireSchedule' || value === 'PresentationSchedule') {
    return value === 'PresentationSchedule' ? 'Presentation Schedule' : 'Luminaire Schedule';
  }
  if (value === 'TechnicalBoq') return 'Technical BOQ';
  return 'Canonical Output';
}

/** PACKAGES-E2E-05B — file extension (with dot) of a Datasheet copy name. */
function pathExt(value: string): string {
  const index = value.lastIndexOf('.');
  return index > 0 ? value.slice(index) : '—';
}

/**
 * The current catalog is authoritative for one server-selected Revision. It
 * intentionally includes legacy missing groups; A1 removes those permanent
 * non-renderer groups rather than presenting them as product defects.
 */
export function buildCatalogOutputRows(
  catalog: RevisionPackageCatalog | null,
  outputs: readonly CanonicalOutputPresenceRecord[],
): PackageOutputRow[] {
  if (!catalog) return [];
  const outputsById = new Map(outputs.map((output) => [output.outputId, output]));
  return catalog.items
    .filter((item) => supportedGroups.has(item.group))
    .map((item) => {
      const output = outputsById.get(item.id);
      const isSnapshotGroup = item.group === 'Documents';
      const fallback = groupFallback[item.group];
      const state = artifactState(item, output, isSnapshotGroup);
      const available = isSnapshotGroup
        ? state === 'Present'
        : state === 'Present' &&
          output?.lifecycleState === 'FINALIZED' &&
          isSupportedCanonicalOutput(output);
      return {
        id: item.id,
        label: output
          ? (supportedPresentation.get(`${output.outputFamily ?? ''}:${output.outputFormat}`)
              ?.label ?? item.label)
          : isSnapshotGroup
            ? item.label
            : (fallback?.label ?? item.label),
        group: item.group,
        // PACKAGES-E2E-05B — a Datasheet DocumentSnapshot is labeled truthfully
        // as "Datasheet" (family) with its file extension as the format, and
        // carries structured Luminaire metadata. Never inferred from title.
        family: isSnapshotGroup
          ? item.datasheet
            ? 'Datasheet'
            : 'Documents'
          : output
            ? displayFamily(output.outputFamily)
            : (fallback?.family ?? 'Canonical Output'),
        format: isSnapshotGroup
          ? item.datasheet
            ? item.fileName
              ? pathExt(item.fileName)
              : '—'
            : '—'
          : (output?.outputFormat ?? fallback?.format ?? '—'),
        fileName: item.fileName,
        artifactState: state,
        available,
        outdated: item.outdated,
        modifiedAt: item.modifiedAt,
        note: item.note,
        ...(item.datasheet ? { datasheet: item.datasheet } : {}),
      };
    });
}

export function packagesForRevision(
  workspace: ProjectWorkspace | null,
  revision: PackageRevisionSummary | null,
): RevisionPackageRecord[] {
  if (!workspace || !revision) return [];
  return workspace.revisionPackages
    .filter((record) => record.revisionNumber === revision.revisionSequence)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function deriveReadiness(input: {
  catalog: RevisionPackageCatalog | null;
  workspace: ProjectWorkspace | null;
  selectedRevision: PackageRevisionSummary | null;
  catalogOwnsSelectedRevision: boolean;
  outputRows: readonly PackageOutputRow[];
  selectedRows: readonly PackageOutputRow[];
  relativeOutputFolder: string;
}): PackageReadiness {
  const failedChecks = (input.catalog?.checks ?? []).filter((check) => !check.passed);
  const blocking = failedChecks.filter((check) => check.severity === 'Blocking');
  const warnings = failedChecks.filter((check) => check.severity === 'Warning');
  const info = failedChecks.filter((check) => check.severity === 'Info');
  const hardGuards: string[] = [];

  if (!input.workspace?.folderPath) hardGuards.push('Connect the project folder before packaging.');
  if (!input.selectedRevision) hardGuards.push('Select a finalized Revision.');
  if (input.selectedRevision && !input.catalogOwnsSelectedRevision) {
    hardGuards.push('The package catalog is not available for this Revision.');
  }
  if (input.selectedRows.length === 0)
    hardGuards.push('Select at least one available Deliverable.');
  if (!input.relativeOutputFolder.trim()) {
    hardGuards.push('Provide a project-relative output folder.');
  }
  const outdatedOutputCount = input.selectedRows.filter((row) => row.outdated).length;
  // PACKAGES-E2E-05B — when an available Datasheet snapshot exists in the
  // Revision but the Owner deliberately deselects it, warn that the Package
  // will omit an available Datasheet. Never auto-force selection; the Owner
  // may proceed with the existing Warning Override flow.
  const deselectedDatasheets = input.outputRows.filter(
    (row) => row.datasheet && row.available && !input.selectedRows.some((s) => s.id === row.id),
  ).length;
  const warningCount =
    warnings.length + (outdatedOutputCount > 0 ? 1 : 0) + (deselectedDatasheets > 0 ? 1 : 0);
  return {
    blocking,
    warnings,
    info,
    hardGuards,
    outdatedOutputCount,
    deselectedDatasheetCount: deselectedDatasheets,
    state:
      hardGuards.length > 0 || blocking.length > 0
        ? 'Blocked'
        : warningCount > 0
          ? 'Warnings'
          : 'Ready',
  };
}

export function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The package request could not be completed.';
}

/**
 * PACKAGES-E2E-04B — derives a truthful status-aware client output folder from
 * the server-suggested default.
 *
 * Business Status drives the root segment: a Draft must never default under
 * `ISSUED/` and an Issued package must never default under `DRAFT/`. The
 * suggested folder's remaining segments (REV_XX, _REISSUE_N) are preserved.
 */
export function statusOutputFolder(input: {
  status: 'Draft' | 'Issued';
  suggestedOutputFolder: string;
  revisionSequence: number;
}): string {
  const parts = input.suggestedOutputFolder.trim().split('/').filter(Boolean);
  const root = input.status === 'Draft' ? 'DRAFT' : 'ISSUED';
  // Prefer the suggestion's revision segment when present; else fall back to
  // the canonical sequence. Keeps the entire remaining path (REISSUE suffix).
  const revisionIndex = parts.findIndex((part) => /^REV_\d/i.test(part));
  const revisionLabel =
    revisionIndex >= 0
      ? parts.slice(revisionIndex).join('/')
      : `REV_${String(input.revisionSequence).padStart(2, '0')}`;
  return normalizeOutputFolder(`${root}/${revisionLabel}`);
}

function normalizeOutputFolder(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
}
