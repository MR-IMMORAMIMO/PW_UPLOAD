import type {
  DatasheetComparisonStatus,
  LocalIntelligenceFieldKey,
  LocalIntelligenceOverview,
  LuminaireAssetSummary,
  LuminaireDatasheetBatchOutcome,
  LuminaireDatasheetAnalysis,
  LuminaireRecord,
  OutputColumn,
  ProjectQualityCheck,
} from '@scli/domain';

export type TechnicalCheckStatus =
  | DatasheetComparisonStatus
  | 'MissingImage'
  | 'MissingRequired'
  | 'NeedsAdoption'
  | 'ProcessingFailed'
  | 'Unavailable'
  | 'Unsupported';

export type TechnicalResultFilter =
  | 'missing-incomplete'
  | 'analyzed'
  | 'needs-attention'
  | 'mismatch'
  | 'missing-schedule'
  | 'missing-datasheet'
  | 'needs-review'
  | 'matched'
  | 'all';

export interface TechnicalCheckRow {
  groupSummary?: {
    checks: number;
    conflicts: number;
    missing: number;
    review: number;
    label: string;
  };
  id: string;
  luminaire: LuminaireRecord;
  fieldKey: LocalIntelligenceFieldKey | 'datasheet' | 'productImage' | 'analysis';
  fieldLabel: string;
  scheduleValue: string;
  datasheetValue: string;
  status: TechnicalCheckStatus;
  resultLabel: string;
  fileName: string;
  pageNumber: number | null;
  evidence: string;
  confidence: number | null;
  alternatives: string[];
  analysisStatus: LuminaireDatasheetAnalysis['status'] | null;
  analysisMessage: string;
  analyzedAt: string | null;
  engine: LuminaireDatasheetAnalysis['engine'] | null;
  privacyMode: LuminaireDatasheetAnalysis['privacyMode'] | null;
  severity: ProjectQualityCheck['severity'] | null;
  canUseDatasheetValue: boolean;
  verificationFingerprint: string | null;
  verificationResult: string | null;
  method: 'NATIVE_TEXT' | 'NATIVE_TABLE' | 'OCR' | null;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  unit: string | null;
  basis: string | null;
  libraryLinked: boolean;
  documentId: string | null;
  region?: { x: number; y: number; width: number; height: number } | null;
  reviewNotes?: string[];
}

export interface TechnicalCheckGroup {
  id: string;
  luminaire: LuminaireRecord;
  checks: TechnicalCheckRow[];
  findingCount: number;
  affectedFields: string[];
  overallStatus: TechnicalCheckStatus;
  overallLabel: string;
  severity: ProjectQualityCheck['severity'] | null;
}

export interface TechnicalCheckGroupSection {
  key: 'missing-incomplete' | 'mismatch' | 'needs-review' | 'matched';
  label: string;
  checks: TechnicalCheckRow[];
}

export const technicalFieldLabels: Record<LocalIntelligenceFieldKey, string> = {
  manufacturer: 'Manufacturer',
  model: 'Model',
  orderingCode: 'Ordering Code',
  variantLabel: 'Variant',
  wattage: 'Wattage',
  lumens: 'Lumens',
  lightColor: 'CCT / Light Color',
  cri: 'CRI',
  beamAngle: 'Beam Angle / Distribution',
  ipRating: 'IP Rating',
  mounting: 'Mounting',
  cutout: 'Cut-out',
  driver: 'Driver',
  control: 'Control / Dimming',
  emergency: 'Emergency',
  dimensions: 'Dimensions',
  bodyColorFinish: 'Body Color / Finish',
};

export const technicalFieldOptions = Object.entries(technicalFieldLabels).map(([value, label]) => ({
  value: value as LocalIntelligenceFieldKey,
  label,
}));

const resultLabels: Record<TechnicalCheckStatus, string> = {
  Matched: 'Matched',
  Mismatch: 'Mismatch',
  MissingSchedule: 'Missing in Schedule',
  MissingDatasheet: 'Missing in Datasheet',
  NeedsReview: 'Needs Review',
  MissingImage: 'Missing Image',
  MissingRequired: 'Required Value Missing',
  NeedsAdoption: 'Legacy Datasheet Needs Adoption',
  ProcessingFailed: 'Processing Failed',
  Unavailable: 'Unavailable',
  Unsupported: 'Unsupported',
};

const verificationResultLabels: Readonly<Record<string, string>> = {
  MATCH: 'Match',
  CONFLICT: 'Conflict',
  MISSING_IN_TABLE: 'Missing in Table',
  MISSING_IN_DATASHEET: 'Missing in Datasheet',
  UNVERIFIED: 'Unverified',
  POSSIBLE_WRONG_DATASHEET: 'Possible Wrong Datasheet',
};

const supportedKeys = new Set(Object.keys(technicalFieldLabels));

function checkSeverity(
  overview: LocalIntelligenceOverview | undefined,
  key: string,
): ProjectQualityCheck['severity'] | null {
  return overview?.checks.find((check) => check.key === key && !check.passed)?.severity ?? null;
}

function assetByLuminaireId(summaries: readonly LuminaireAssetSummary[]) {
  return new Map(summaries.map((summary) => [summary.luminaireId, summary]));
}

function derivedRows(
  luminaires: readonly LuminaireRecord[],
  summaries: readonly LuminaireAssetSummary[],
  scheduleColumns: readonly OutputColumn[],
  overview?: LocalIntelligenceOverview,
): TechnicalCheckRow[] {
  const assets = assetByLuminaireId(summaries);
  const requiredKeys = scheduleColumns
    .filter((column) => column.requiredForIssue && supportedKeys.has(column.fieldKey))
    .map((column) => column.fieldKey as LocalIntelligenceFieldKey);
  const rows: TechnicalCheckRow[] = [];

  for (const luminaire of luminaires) {
    const summary = assets.get(luminaire.id);
    if (!summary?.datasheet && !luminaire.datasheetPath.trim()) {
      rows.push({
        id: `${luminaire.id}:asset:datasheet`,
        luminaire,
        fieldKey: 'datasheet',
        fieldLabel: 'Datasheet',
        scheduleValue: '',
        datasheetValue: '',
        status: 'MissingDatasheet',
        resultLabel: 'Missing Datasheet',
        fileName: '',
        pageNumber: null,
        evidence: '',
        confidence: null,
        alternatives: [],
        analysisStatus: null,
        analysisMessage: 'No official datasheet is linked.',
        analyzedAt: null,
        engine: null,
        privacyMode: null,
        severity: checkSeverity(overview, 'local-datasheets'),
        canUseDatasheetValue: false,
        verificationFingerprint: null,
        verificationResult: null,
        method: null,
        confidenceBand: null,
        unit: null,
        basis: null,
        libraryLinked: false,
        documentId: null,
      });
    }
    if (!summary?.productImage && !luminaire.imagePath.trim()) {
      rows.push({
        id: `${luminaire.id}:asset:productImage`,
        luminaire,
        fieldKey: 'productImage',
        fieldLabel: 'Product Image',
        scheduleValue: '',
        datasheetValue: '',
        status: 'MissingImage',
        resultLabel: 'Missing Image',
        fileName: '',
        pageNumber: null,
        evidence: '',
        confidence: null,
        alternatives: [],
        analysisStatus: null,
        analysisMessage: 'No product image is linked.',
        analyzedAt: null,
        engine: null,
        privacyMode: null,
        severity: null,
        canUseDatasheetValue: false,
        verificationFingerprint: null,
        verificationResult: null,
        method: null,
        confidenceBand: null,
        unit: null,
        basis: null,
        libraryLinked: false,
        documentId: null,
      });
    }
    for (const fieldKey of requiredKeys) {
      if (String(luminaire[fieldKey] ?? '').trim()) continue;
      rows.push({
        id: `${luminaire.id}:required:${fieldKey}`,
        luminaire,
        fieldKey,
        fieldLabel: technicalFieldLabels[fieldKey],
        scheduleValue: '',
        datasheetValue: '',
        status: 'MissingRequired',
        resultLabel: 'Required Value Missing',
        fileName: '',
        pageNumber: null,
        evidence: '',
        confidence: null,
        alternatives: [],
        analysisStatus: null,
        analysisMessage: 'This configured issue field is empty in the luminaire schedule.',
        analyzedAt: null,
        engine: null,
        privacyMode: null,
        severity: checkSeverity(overview, 'local-required-fields'),
        canUseDatasheetValue: false,
        verificationFingerprint: null,
        verificationResult: null,
        method: null,
        confidenceBand: null,
        unit: null,
        basis: null,
        libraryLinked: false,
        documentId: null,
      });
    }
  }
  return rows;
}

function analysisRows(
  luminaires: readonly LuminaireRecord[],
  analyses: readonly LuminaireDatasheetAnalysis[],
): TechnicalCheckRow[] {
  const luminairesById = new Map(luminaires.map((luminaire) => [luminaire.id, luminaire]));
  return analyses.flatMap((analysis) => {
    const luminaire = luminairesById.get(analysis.luminaireId);
    if (!luminaire) return [];
    if (analysis.comparisons.length) {
      return analysis.comparisons.map<TechnicalCheckRow>((comparison) => ({
        id: `${luminaire.id}:comparison:${comparison.fieldKey}`,
        luminaire,
        fieldKey: comparison.fieldKey,
        fieldLabel: comparison.label || technicalFieldLabels[comparison.fieldKey],
        scheduleValue: comparison.scheduleValue,
        datasheetValue: comparison.value,
        status: comparison.status,
        resultLabel:
          verificationResultLabels[comparison.verificationResult ?? ''] ??
          resultLabels[comparison.status],
        fileName: analysis.fileName,
        pageNumber: comparison.pageNumber || null,
        evidence: comparison.evidence,
        confidence: comparison.confidence || null,
        alternatives: comparison.alternatives,
        analysisStatus: analysis.status,
        analysisMessage: analysis.message,
        analyzedAt: analysis.analyzedAt,
        engine: analysis.engine,
        privacyMode: analysis.privacyMode,
        severity: null,
        canUseDatasheetValue:
          comparison.canUseDatasheetValue ??
          (Boolean(comparison.value.trim()) &&
            !comparison.ambiguous &&
            comparison.alternatives.length <= 1 &&
            ['Mismatch', 'MissingSchedule'].includes(comparison.status)),
        verificationFingerprint: analysis.verificationFingerprint ?? null,
        verificationResult: comparison.verificationResult ?? null,
        method: comparison.method ?? null,
        confidenceBand: comparison.confidenceBand ?? null,
        unit: comparison.unit ?? null,
        basis: comparison.basis ?? null,
        libraryLinked: analysis.libraryLinked ?? false,
        documentId: analysis.documentId ?? null,
        region: comparison.region ?? null,
        reviewNotes: comparison.reviewNotes ?? [],
      }));
    }
    if (!luminaire.datasheetPath.trim()) return [];
    const status: TechnicalCheckStatus =
      analysis.status === 'Unsupported'
        ? 'Unsupported'
        : analysis.status === 'Unavailable'
          ? 'Unavailable'
          : 'NeedsReview';
    return [
      {
        id: `${luminaire.id}:analysis:${status}`,
        luminaire,
        fieldKey: 'analysis',
        fieldLabel: 'Datasheet Analysis',
        scheduleValue: '',
        datasheetValue: '',
        status,
        resultLabel: resultLabels[status],
        fileName: analysis.fileName,
        pageNumber: null,
        evidence: analysis.message,
        confidence: null,
        alternatives: [],
        analysisStatus: analysis.status,
        analysisMessage: analysis.message,
        analyzedAt: analysis.analyzedAt,
        engine: analysis.engine,
        privacyMode: analysis.privacyMode,
        severity: null,
        canUseDatasheetValue: false,
        verificationFingerprint: analysis.verificationFingerprint ?? null,
        verificationResult: analysis.identityResult ?? null,
        method: null,
        confidenceBand: null,
        unit: null,
        basis: null,
        libraryLinked: analysis.libraryLinked ?? false,
        documentId: analysis.documentId ?? null,
      },
    ];
  });
}

function outcomeRows(
  luminaires: readonly LuminaireRecord[],
  outcomes: readonly LuminaireDatasheetBatchOutcome[],
): TechnicalCheckRow[] {
  const byId = new Map(luminaires.map((luminaire) => [luminaire.id, luminaire]));
  return outcomes.flatMap((outcome): TechnicalCheckRow[] => {
    if (outcome.analysis) return [];
    const luminaire = byId.get(outcome.luminaireId);
    if (!luminaire) return [];
    const status: TechnicalCheckStatus =
      outcome.status === 'NEEDS_ADOPTION'
        ? 'NeedsAdoption'
        : outcome.status === 'MISSING_DATASHEET'
          ? 'MissingDatasheet'
          : 'ProcessingFailed';
    return [
      {
        id: `${luminaire.id}:outcome:${outcome.status}`,
        luminaire,
        fieldKey: 'analysis',
        fieldLabel: 'Datasheet Analysis',
        scheduleValue: '',
        datasheetValue: '',
        status,
        resultLabel: resultLabels[status],
        fileName: '',
        pageNumber: null,
        evidence: outcome.message,
        confidence: null,
        alternatives: [],
        analysisStatus: null,
        analysisMessage: outcome.message,
        analyzedAt: null,
        engine: null,
        privacyMode: null,
        severity: status === 'ProcessingFailed' ? 'Blocking' : 'Warning',
        canUseDatasheetValue: false,
        verificationFingerprint: null,
        verificationResult: outcome.reasonCode,
        method: null,
        confidenceBand: null,
        unit: null,
        basis: null,
        libraryLinked: false,
        documentId: null,
      },
    ];
  });
}

export function buildTechnicalCheckRows(input: {
  luminaires: readonly LuminaireRecord[];
  assets: readonly LuminaireAssetSummary[];
  scheduleColumns: readonly OutputColumn[];
  overview?: LocalIntelligenceOverview;
  analyses: readonly LuminaireDatasheetAnalysis[] | null;
  outcomes?: readonly LuminaireDatasheetBatchOutcome[];
}): TechnicalCheckRow[] {
  const compared = input.analyses ? analysisRows(input.luminaires, input.analyses) : [];
  const terminal = input.outcomes ? outcomeRows(input.luminaires, input.outcomes) : [];
  const terminalLuminaires = new Set(terminal.map((row) => row.luminaire.id));
  const comparedFields = new Set(
    compared
      .filter((row) => !['analysis', 'datasheet', 'productImage'].includes(row.fieldKey))
      .map((row) => `${row.luminaire.id}:${row.fieldKey}`),
  );
  const derived = derivedRows(
    input.luminaires,
    input.assets,
    input.scheduleColumns,
    input.overview,
  ).filter((row) => {
    if (terminalLuminaires.has(row.luminaire.id) && row.status === 'MissingDatasheet') return false;
    return (
      row.status !== 'MissingRequired' || !comparedFields.has(`${row.luminaire.id}:${row.fieldKey}`)
    );
  });
  return [...derived, ...terminal, ...compared];
}

export function filterTechnicalCheckRows(
  rows: readonly TechnicalCheckRow[],
  query: string,
  result: TechnicalResultFilter,
  field: string,
  hideMatched: boolean,
): TechnicalCheckRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (hideMatched && row.status === 'Matched') return false;
    if (field && row.fieldKey !== field) return false;
    if (result === 'needs-attention' && row.status === 'Matched') return false;
    if (
      result === 'missing-incomplete' &&
      ![
        'MissingSchedule',
        'MissingDatasheet',
        'MissingImage',
        'MissingRequired',
        'NeedsAdoption',
        'ProcessingFailed',
        'Unavailable',
      ].includes(row.status)
    )
      return false;
    if (result === 'analyzed' && !row.analyzedAt) return false;
    if (result === 'mismatch' && row.status !== 'Mismatch') return false;
    if (result === 'missing-schedule' && row.status !== 'MissingSchedule') return false;
    if (result === 'missing-datasheet' && row.status !== 'MissingDatasheet') return false;
    if (result === 'needs-review' && row.status !== 'NeedsReview') return false;
    if (result === 'matched' && row.status !== 'Matched') return false;
    if (!needle) return true;
    return [
      row.luminaire.tag,
      row.luminaire.manufacturer,
      row.luminaire.model,
      row.fieldLabel,
      row.scheduleValue,
      row.datasheetValue,
      row.evidence,
      row.fileName,
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

const statusPriority: TechnicalCheckStatus[] = [
  'Mismatch',
  'MissingSchedule',
  'MissingDatasheet',
  'MissingRequired',
  'MissingImage',
  'NeedsAdoption',
  'ProcessingFailed',
  'NeedsReview',
  'Unavailable',
  'Unsupported',
  'Matched',
];

const severityPriority: Array<ProjectQualityCheck['severity']> = ['Blocking', 'Warning', 'Info'];

/** Groups child checks by canonical luminaire identity while preserving source order. */
export function groupTechnicalCheckRows(rows: readonly TechnicalCheckRow[]): TechnicalCheckGroup[] {
  const byLuminaire = new Map<string, TechnicalCheckRow[]>();
  for (const row of rows) {
    const current = byLuminaire.get(row.luminaire.id) ?? [];
    current.push(row);
    byLuminaire.set(row.luminaire.id, current);
  }
  return Array.from(byLuminaire.entries()).map(([id, checks]) => {
    const findingChecks = checks.filter((check) => check.status !== 'Matched');
    const overallStatus =
      statusPriority.find((status) => checks.some((check) => check.status === status)) ?? 'Matched';
    const severity =
      severityPriority.find((candidate) => checks.some((check) => check.severity === candidate)) ??
      null;
    const affectedSource = findingChecks.length ? findingChecks : checks;
    return {
      id,
      luminaire: checks[0]!.luminaire,
      checks,
      findingCount: findingChecks.length,
      affectedFields: Array.from(new Set(affectedSource.map((check) => check.fieldLabel))),
      overallStatus,
      overallLabel: resultLabels[overallStatus],
      severity,
    };
  });
}

/** Stable inspector sections; empty result categories are omitted. */
export function technicalCheckGroupSections(
  checks: readonly TechnicalCheckRow[],
): TechnicalCheckGroupSection[] {
  const definitions: Array<{
    key: TechnicalCheckGroupSection['key'];
    label: string;
    statuses: TechnicalCheckStatus[];
  }> = [
    {
      key: 'missing-incomplete',
      label: 'Missing / Incomplete',
      statuses: [
        'MissingSchedule',
        'MissingDatasheet',
        'MissingImage',
        'MissingRequired',
        'NeedsAdoption',
        'ProcessingFailed',
        'Unavailable',
        'Unsupported',
      ],
    },
    { key: 'mismatch', label: 'Mismatch', statuses: ['Mismatch'] },
    { key: 'needs-review', label: 'Needs Review', statuses: ['NeedsReview'] },
    { key: 'matched', label: 'Matched', statuses: ['Matched'] },
  ];
  return definitions
    .map((definition) => ({
      key: definition.key,
      label: definition.label,
      checks: checks.filter((check) => definition.statuses.includes(check.status)),
    }))
    .filter((section) => section.checks.length > 0);
}

export function technicalCheckCounts(
  rows: readonly TechnicalCheckRow[],
  outcomes: readonly LuminaireDatasheetBatchOutcome[] | null,
  luminaireCount: number,
) {
  return {
    needsAttention: rows.filter((row) => row.status !== 'Matched').length,
    missingIncomplete: rows.filter((row) =>
      [
        'MissingSchedule',
        'MissingDatasheet',
        'MissingImage',
        'MissingRequired',
        'NeedsAdoption',
        'ProcessingFailed',
        'Unavailable',
      ].includes(row.status),
    ).length,
    matched: outcomes ? rows.filter((row) => row.status === 'Matched').length : null,
    analyzed: outcomes ? outcomes.filter((outcome) => outcome.analysis !== null).length : null,
    needsAdoption: outcomes
      ? outcomes.filter((outcome) => outcome.status === 'NEEDS_ADOPTION').length
      : 0,
    failed: outcomes
      ? outcomes.filter((outcome) => outcome.status === 'PROCESSING_FAILED').length
      : 0,
    luminaireCount,
  };
}

export function confidenceBand(confidence: number | null): 'high' | 'medium' | 'low' | 'none' {
  if (confidence === null) return 'none';
  if (confidence >= 85) return 'high';
  if (confidence >= 65) return 'medium';
  return 'low';
}
