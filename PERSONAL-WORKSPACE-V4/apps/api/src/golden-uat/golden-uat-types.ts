/**
 * Golden UAT fixture — shared types, constants, and anchor-date helpers.
 *
 * This slice builds ONE guarded canonical Golden Project ("[SCT UAT] Boutique Hotel
 * Lighting Package") through the SAME canonical stores/services used by Personal
 * Workspace. It is the source of truth for reviewing every Project Workspace page
 * against known data, and becomes the chronology reference for resuming
 * P2-UX-04A-UAT-FIX-02.
 *
 * Permanence rules (never relaxed here):
 *  - NO direct SQLite INSERT/UPDATE/DELETE.
 *  - Every entity is created through an existing canonical product path.
 *  - A desired fixture entity that cannot be created canonically is classified
 *    UNSUPPORTED_FOR_GOLDEN_NOW and reported, never fabricated.
 *  - Dry-run is the default; applying requires --apply.
 */

/** Unmistakable fixture identity marker. */
export const GOLDEN_UAT_FIXTURE_MARKER = 'GOLDEN_UAT_PROJECT' as const;

/** Human-facing fixture project name. */
export const GOLDEN_UAT_PROJECT_NAME = '[SCT UAT] Boutique Hotel Lighting Package' as const;

/** Canonical free-text field that stores the fixture marker for collision-guard lookup. */
export const GOLDEN_UAT_MARKER_FIELD = 'crmReference' as const;

/**
 * Stable fixture crmReference value. This is the collision-guard invariant: a real
 * user project that happens to share the display name but does NOT carry this marker
 * is NEVER modified.
 */
export const GOLDEN_UAT_CRM_REFERENCE = 'GOLDEN_UAT:BOUTIQUE_HOTEL_LIGHTING_PACKAGE' as const;

/**
 * Fixed idempotency key bound to the fixture. The canonical provider replays the same
 * project on retry, so a re-run cannot create a duplicate Golden project.
 */
export const GOLDEN_UAT_IDEMPOTENCY_KEY = '99999999-9999-4999-8999-999999999999' as const;

/** Default anchor date used when none is supplied. */
export const GOLDEN_UAT_DEFAULT_ANCHOR_DATE = '2026-08-11' as const;

/** Scenario identifier emitted into the manifest. */
export const GOLDEN_UAT_SCENARIO = 'BOUTIQUE_HOTEL_LIGHTING_PACKAGE' as const;

/** Manifest output file name (fixture-owned runtime area). */
export const GOLDEN_UAT_MANIFEST_FILE_NAME = 'golden-uat-manifest.json' as const;

export interface GoldenAnchorContract {
  /** Anchor date key, e.g. 2026-08-11. */
  anchorDate: string;
  overdue: string;
  dueToday: string;
  dueSoon: string;
  normalDue: string;
  pastMeetingKickoff: string;
  pastMeetingConcept: string;
  pastMeetingTechnical: string;
  upcomingMeeting: string;
}

/**
 * Builds the relative business-date contract from an anchor date.
 * All values are YYYY-MM-DD date keys (the canonical date granularity used by
 * actions, meetings, revisions, requirements, and delivery dates).
 */
export function buildAnchorContract(anchorDate: string): GoldenAnchorContract {
  return {
    anchorDate,
    overdue: addCalendarDays(anchorDate, -2),
    dueToday: anchorDate,
    dueSoon: addCalendarDays(anchorDate, 2),
    normalDue: addCalendarDays(anchorDate, 10),
    pastMeetingKickoff: addCalendarDays(anchorDate, -30),
    pastMeetingConcept: addCalendarDays(anchorDate, -18),
    pastMeetingTechnical: addCalendarDays(anchorDate, -7),
    upcomingMeeting: addCalendarDays(anchorDate, 3),
  };
}

/** Adds calendar days to a YYYY-MM-DD key (UTC noon reference avoids DST drift). */
export function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Builds a full UTC ISO timestamp at a given time on a date key. Used to give
 * meetings / workflow transitions a full timestamp that is still anchor-derived,
 * so the fixture is deterministic and never tied to the wall clock.
 */
export function dateKeyAtUtc(dateKey: string, hour: number, minute = 0): string {
  const date = new Date(
    `${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  );
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Manifest contract (read-back based)
// ---------------------------------------------------------------------------

export interface GoldenUatTimelineEvidenceEntry {
  source: string;
  sourceId: string;
  sourceTimestampField: string;
  rawTimestampValue: string;
  expectedOrder: number;
}

export interface GoldenUatRevisionEvidence {
  revisionId: string;
  revisionNumber: number;
  status: string;
  createdAtRaw: string;
  issuedAtRaw: string | null;
}

export interface GoldenUatManifest {
  schema: 'golden-uat-manifest/v1';
  fixture: {
    marker: string;
    scenario: string;
    projectId: string;
    projectCode: string;
    projectName: string;
    anchorDate: string;
  };
  expectedCounts: {
    luminaires: number;
    missingDatasheets: number;
    missingImages: number;
    openActions: number;
    overdueActions: number;
    meetings: number;
    commentsOrReviews: number;
    reviewReplies: number;
    reviewAttachments: number;
    revisions: number;
    packages: number;
    workSessions: number;
    requirements: number;
    contacts: number;
    documents: number;
  };
  health: {
    score: number;
    blockingChecks: number;
    warningChecks: number;
    readyOrInfoChecks: number;
    checks: Array<{ key: string; label: string; severity: string; passed: boolean }>;
  };
  revisions: GoldenUatRevisionEvidence[];
  comments: {
    roots: Array<{
      id: string;
      reference: string;
      origin: string | null;
      status: string;
      authorId: string | null;
      revisionId: string | null;
      luminaireId: string | null;
      createdAt: string;
    }>;
    replies: Array<{
      id: string;
      reviewItemId: string;
      origin: string;
      authorId: string;
      createdAt: string;
    }>;
    attachments: Array<{
      id: string;
      documentId: string;
      reviewItemId: string | null;
      replyId: string | null;
      createdAt: string;
    }>;
  };
  timelineEvidence: GoldenUatTimelineEvidenceEntry[];
  workflow: {
    transitions: Array<{
      transitionId: string;
      fromStatus: string;
      toStatus: string;
      occurredAt: string;
      reason: string | null;
    }>;
    revisionCycles: Array<{
      revisionCycleId: string;
      cycleNumber: number;
      status: string;
      openedAt: string;
      feedbackSummary: string;
    }>;
  };
  entityIds: {
    actions: string[];
    meetings: string[];
    reviews: string[];
    reviewReplies: string[];
    reviewAttachments: string[];
    luminaires: string[];
    revisions: string[];
    packages: string[];
    workSessions: string[];
    requirements: string[];
    contacts: string[];
    documents: string[];
  };
  activeWorkSessionAfterSeed: boolean;
  unsupportedCanonicalCapabilities: string[];
  /**
   * Truthful timestamp-source metadata for every major timestamp source in the fixture.
   * Each entry distinguishes:
   *   - declaredPrecision: the schema/contract precision (e.g. projectRevisionSchema.issuedAt
   *     is nullableDate => DATE_ONLY).
   *   - observedPrecision: the precision actually read back from persistence. In PLAN mode
   *     there is no persisted read-back, so this is UNKNOWN. In APPLY mode it is derived from
   *     the raw persisted value (never from the schema).
   *   - clockSource: where the value originates (anchor-injected vs canonical runtime wall clock).
   * The fixture never claims deterministic exact ordering for non-anchor sources, and never
   * converts or fabricates a timestamp to hide a declared-vs-observed mismatch.
   */
  timestampSources: GoldenUatTimestampSource[];
}

/** Precision vocabulary for a timestamp value. */
export type GoldenUatTimestampPrecision = 'DATE_ONLY' | 'FULL_TIMESTAMP' | 'NULL' | 'UNKNOWN';

/** Clock-source vocabulary for a timestamp value. */
export type GoldenUatClockSource =
  'ANCHOR_CONTROLLED' | 'CANONICAL_RUNTIME_WALL_CLOCK' | 'CANONICAL_OTHER' | 'UNKNOWN';

export interface GoldenUatTimestampSource {
  source: string;
  declaredPrecision: GoldenUatTimestampPrecision;
  observedPrecision: GoldenUatTimestampPrecision;
  clockSource: GoldenUatClockSource;
  note: string;
}

/**
 * Derives the observed precision of a raw persisted timestamp value. This is computed from the
 * actual value, never from the schema: a full UTC ISO timestamp yields FULL_TIMESTAMP, a bare
 * YYYY-MM-DD key yields DATE_ONLY, and a null/empty value yields NULL.
 */
export function deriveObservedPrecision(
  raw: string | null | undefined,
): GoldenUatTimestampPrecision {
  if (raw === null || raw === undefined || raw === '') {
    return 'NULL';
  }
  if (/T\d{2}:\d{2}:\d{2}/.test(raw)) {
    return 'FULL_TIMESTAMP';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return 'DATE_ONLY';
  }
  return 'UNKNOWN';
}

/**
 * Declared precision + clock source for each major timestamp source. These are the known/expected
 * contract facts (schema precision and where the value originates). observedPrecision is computed
 * at runtime per mode and is NOT part of this static table.
 */
export const GOLDEN_UAT_TIMESTAMP_SOURCES: readonly Omit<
  GoldenUatTimestampSource,
  'observedPrecision'
>[] = Object.freeze([
  {
    source: 'Project.createdAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'ANCHOR_CONTROLLED',
    note: 'Injected anchor clock via ProjectService.',
  },
  {
    source: 'Workflow.occurredAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'ANCHOR_CONTROLLED',
    note: 'Injected anchor clock via ProjectService.changeStatus.',
  },
  {
    source: 'Revision.createdAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'ANCHOR_CONTROLLED',
    note: 'Injected anchor clock via CanonicalOutputRegistryStore.',
  },
  {
    source: 'Revision.issuedAt',
    declaredPrecision: 'DATE_ONLY',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'projectRevisionSchema.issuedAt is nullableDate (date-only, z.string().date()); the canonical persistence path (applyIssuedRevision) writes new Date().toISOString(), so observed precision may be FULL_TIMESTAMP. Raw value is preserved, never converted to a fake time.',
  },
  {
    source: 'Meeting.startAt/endAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'ANCHOR_CONTROLLED',
    note: 'Explicit anchor-derived input values.',
  },
  {
    source: 'WorkSession.startedAt/endedAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'ANCHOR_CONTROLLED',
    note: 'Explicit anchor-derived input values.',
  },
  {
    source: 'Action.createdAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'PersonalOperationsStore uses new Date(); not anchor-injectable.',
  },
  {
    source: 'Luminaire.createdAt/updatedAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'PersonalWorkspaceStore uses new Date().',
  },
  {
    source: 'Document.createdAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'PersonalOperationsStore uses new Date().',
  },
  {
    source: 'FolderIndex.indexedAt',
    declaredPrecision: 'FULL_TIMESTAMP',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'PersonalWorkspaceStore uses new Date().',
  },
  {
    source: 'Health.today',
    declaredPrecision: 'DATE_ONLY',
    clockSource: 'CANONICAL_RUNTIME_WALL_CLOCK',
    note: 'calculateHealth compares due dates against the runtime wall-clock date in company timezone, not the anchor date.',
  },
]);

/**
 * Builds the manifest timestampSources for a given mode. In PLAN mode there is no persisted
 * read-back, so observedPrecision is UNKNOWN for every source. In APPLY mode the caller supplies
 * a map of observed raw values (source -> raw value) and observedPrecision is derived from each.
 */
export function buildTimestampSources(
  mode: GoldenUatMode,
  observedRaw?: ReadonlyMap<string, string | null>,
): GoldenUatTimestampSource[] {
  return GOLDEN_UAT_TIMESTAMP_SOURCES.map((source) => ({
    ...source,
    observedPrecision:
      mode === 'APPLY' && observedRaw
        ? deriveObservedPrecision(observedRaw.get(source.source) ?? null)
        : 'UNKNOWN',
  }));
}

export type GoldenUatMode = 'PLAN' | 'APPLY';

export interface GoldenUatPlanOperation {
  entity: string;
  description: string;
  mutation: boolean;
}

export interface GoldenUatSeedResult {
  mode: GoldenUatMode;
  fixtureExisted: boolean;
  manifest: GoldenUatManifest;
  operations: GoldenUatPlanOperation[];
}
