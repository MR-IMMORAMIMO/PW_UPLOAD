import { describe, expect, it } from 'vitest';
import type {
  LocalIntelligenceOverview,
  LuminaireDatasheetAnalysis,
  LuminaireRecord,
  OutputColumn,
} from '@scli/domain';
import {
  buildTechnicalCheckRows,
  filterTechnicalCheckRows,
  groupTechnicalCheckRows,
  technicalCheckCounts,
  technicalCheckGroupSections,
} from './technicalCheckViewModel';

const luminaire = (id: string, patch: Partial<LuminaireRecord> = {}): LuminaireRecord => ({
  id,
  projectId: 'p1',
  tag: id.toUpperCase(),
  category: 'Downlight',
  imagePath: '',
  description: '',
  manufacturer: '',
  model: 'Model 1',
  wattage: '12W',
  lumens: '',
  lightColor: '',
  cri: '',
  beamAngle: '',
  ipRating: '',
  mounting: '',
  cutout: '',
  driver: '',
  control: '',
  emergency: '',
  datasheetPath: '',
  location: 'Lobby',
  unit: 'No.',
  quantity: 2,
  notes: '',
  sourceName: '',
  dimensions: '',
  bodyColorFinish: '',
  rowVersion: 1,
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
  ...patch,
});

const requiredManufacturer: OutputColumn = {
  fieldKey: 'manufacturer',
  header: 'Manufacturer',
  visible: true,
  sortOrder: 1,
  width: 120,
  compareInRevision: true,
  requiredForIssue: true,
  internalOnly: false,
};

const overview: LocalIntelligenceOverview = {
  projectId: 'p1',
  generatedAt: '2026-08-16T08:00:00.000Z',
  engine: 'SCLI Local Intelligence 1.0',
  privacyMode: 'LocalOnly',
  readinessScore: 70,
  checks: [
    {
      key: 'local-datasheets',
      label: 'Official datasheets linked',
      detail: '1 missing',
      severity: 'Warning',
      passed: false,
    },
    {
      key: 'local-required-fields',
      label: 'Required schedule values are complete',
      detail: '1 missing',
      severity: 'Blocking',
      passed: false,
    },
  ],
  brief: { headline: '', summary: '', nextActions: [], warnings: [] },
  fileClassifications: [],
  stats: {
    luminaireCount: 1,
    linkedDatasheets: 0,
    missingDatasheets: 1,
    indexedFiles: 0,
    classificationsNeedingReview: 0,
  },
};

function analysis(item: LuminaireRecord): LuminaireDatasheetAnalysis {
  return {
    luminaireId: item.id,
    tag: item.tag,
    datasheetPath: item.datasheetPath,
    fileName: 'DL01.pdf',
    analyzedAt: '2026-08-16T17:51:00.000Z',
    engine: 'SCLI Local Intelligence 1.0',
    privacyMode: 'LocalOnly',
    status: 'Ready',
    message: 'Three technical fields were found locally.',
    pageCount: 2,
    textAvailable: true,
    comparisons: [
      {
        fieldKey: 'manufacturer',
        label: 'Manufacturer',
        value: 'LumenWorks',
        alternatives: ['LumenWorks'],
        confidence: 95,
        pageNumber: 1,
        evidence: 'Manufacturer: LumenWorks',
        ambiguous: false,
        scheduleValue: '',
        status: 'MissingSchedule',
      },
      {
        fieldKey: 'model',
        label: 'Model',
        value: 'Model 1',
        alternatives: ['Model 1'],
        confidence: 92,
        pageNumber: 1,
        evidence: 'Model: Model 1',
        ambiguous: false,
        scheduleValue: 'Model 1',
        status: 'Matched',
      },
      {
        fieldKey: 'wattage',
        label: 'Wattage',
        value: '15W',
        alternatives: ['15W'],
        confidence: 93,
        pageNumber: 2,
        evidence: 'Power: 15W',
        ambiguous: false,
        scheduleValue: '12W',
        status: 'Mismatch',
      },
    ],
    counts: { Matched: 1, Mismatch: 1, MissingSchedule: 1, MissingDatasheet: 0, NeedsReview: 0 },
  };
}

describe('technicalCheckViewModel', () => {
  it('derives truthful missing Datasheet, Image, and configured field issues before analysis', () => {
    const item = luminaire('dl01');
    const rows = buildTechnicalCheckRows({
      luminaires: [item],
      assets: [{ luminaireId: item.id, datasheet: null, productImage: null }],
      scheduleColumns: [requiredManufacturer],
      overview,
      analyses: null,
    });

    expect(rows.map((row) => row.resultLabel)).toEqual([
      'Missing Datasheet',
      'Missing Image',
      'Required Value Missing',
    ]);
    expect(rows.some((row) => row.status === 'Mismatch')).toBe(false);
    expect(rows.find((row) => row.fieldKey === 'datasheet')?.severity).toBe('Warning');
    expect(rows.find((row) => row.fieldKey === 'manufacturer')?.severity).toBe('Blocking');
    expect(technicalCheckCounts(rows, null, 1)).toMatchObject({ matched: null, analyzed: null });
  });

  it('projects real comparison statuses, evidence, confidence, alternatives, and safe updates', () => {
    const item = luminaire('dl01', {
      datasheetPath: 'C:\\fixtures\\DL01.pdf',
      imagePath: 'C:\\fixtures\\DL01.png',
    });
    const rows = buildTechnicalCheckRows({
      luminaires: [item],
      assets: [],
      scheduleColumns: [],
      analyses: [analysis(item)],
    });

    expect(rows.map((row) => row.status)).toEqual(['MissingSchedule', 'Matched', 'Mismatch']);
    expect(rows[0]).toMatchObject({
      fileName: 'DL01.pdf',
      pageNumber: 1,
      confidence: 95,
      evidence: 'Manufacturer: LumenWorks',
      alternatives: ['LumenWorks'],
      canUseDatasheetValue: true,
    });
    expect(rows[1]?.canUseDatasheetValue).toBe(false);
    expect(
      technicalCheckCounts(
        rows,
        [
          {
            luminaireId: item.id,
            tag: item.tag,
            status: 'VERIFIED',
            reasonCode: 'NONE',
            message: 'Verified.',
            analysis: analysis(item),
          },
        ],
        1,
      ),
    ).toMatchObject({
      needsAttention: 2,
      matched: 1,
      analyzed: 1,
    });
  });

  it('covers search, result, field, and Hide Matched filters', () => {
    const item = luminaire('dl01', {
      datasheetPath: 'C:\\fixtures\\DL01.pdf',
      imagePath: 'C:\\fixtures\\DL01.png',
    });
    const rows = buildTechnicalCheckRows({
      luminaires: [item],
      assets: [],
      scheduleColumns: [],
      analyses: [analysis(item)],
    });

    expect(filterTechnicalCheckRows(rows, 'power: 15w', 'all', '', false)).toHaveLength(1);
    expect(filterTechnicalCheckRows(rows, '', 'mismatch', '', false)[0]?.fieldKey).toBe('wattage');
    expect(filterTechnicalCheckRows(rows, '', 'all', 'model', false)).toHaveLength(1);
    expect(
      filterTechnicalCheckRows(rows, '', 'all', '', true).map((row) => row.status),
    ).not.toContain('Matched');
  });

  it('retains successful, needs-adoption, and failed luminaires in one partial batch view', () => {
    const managed = luminaire('dl01', { datasheetPath: 'managed.pdf' });
    const legacy = luminaire('dl02', { datasheetPath: 'legacy.pdf' });
    const failed = luminaire('dl03', { datasheetPath: 'failed.pdf' });
    const verified = analysis(managed);
    const outcomes = [
      {
        luminaireId: managed.id,
        tag: managed.tag,
        status: 'VERIFIED' as const,
        reasonCode: 'NONE' as const,
        message: verified.message,
        analysis: verified,
      },
      {
        luminaireId: legacy.id,
        tag: legacy.tag,
        status: 'NEEDS_ADOPTION' as const,
        reasonCode: 'LEGACY_DATASHEET_REQUIRES_ADOPTION' as const,
        message: 'The legacy Datasheet must be adopted.',
        analysis: null,
      },
      {
        luminaireId: failed.id,
        tag: failed.tag,
        status: 'PROCESSING_FAILED' as const,
        reasonCode: 'SOURCE_HASH_MISMATCH' as const,
        message: 'The managed bytes do not match.',
        analysis: null,
      },
    ];
    const rows = buildTechnicalCheckRows({
      luminaires: [managed, legacy, failed],
      assets: [],
      scheduleColumns: [],
      analyses: [verified],
      outcomes,
    });
    expect(groupTechnicalCheckRows(rows).map((group) => group.id)).toEqual([
      managed.id,
      legacy.id,
      failed.id,
    ]);
    expect(rows.map((row) => row.status)).toEqual(
      expect.arrayContaining(['NeedsAdoption', 'ProcessingFailed', 'Matched']),
    );
    expect(technicalCheckCounts(rows, outcomes, 3)).toMatchObject({
      analyzed: 1,
      needsAdoption: 1,
      failed: 1,
    });
  });

  it('groups DL01/DL02/DL03 by luminaire while retaining matching child checks', () => {
    const dl01 = luminaire('dl01', {
      datasheetPath: 'C:\\fixtures\\DL01.pdf',
      imagePath: 'C:\\fixtures\\DL01.png',
    });
    const dl02 = luminaire('dl02');
    const dl03 = luminaire('dl03', {
      datasheetPath: 'C:\\fixtures\\DL03.pdf',
      imagePath: 'C:\\fixtures\\DL03.png',
    });
    const dl03Analysis = {
      ...analysis(dl03),
      comparisons: analysis(dl03).comparisons.filter((row) => row.status === 'Matched'),
    };
    const rows = buildTechnicalCheckRows({
      luminaires: [dl01, dl02, dl03],
      assets: [{ luminaireId: dl02.id, datasheet: null, productImage: null }],
      scheduleColumns: [requiredManufacturer],
      analyses: [analysis(dl01), dl03Analysis],
    });
    const groups = groupTechnicalCheckRows(rows);

    expect(groups.map((group) => group.luminaire.tag)).toEqual(['DL02', 'DL03', 'DL01']);
    expect(groups.find((group) => group.id === 'dl01')).toMatchObject({
      findingCount: 2,
      overallStatus: 'Mismatch',
      affectedFields: ['Manufacturer', 'Wattage'],
    });
    expect(
      technicalCheckGroupSections(groups.find((group) => group.id === 'dl01')!.checks).map(
        (section) => section.label,
      ),
    ).toEqual(['Missing / Incomplete', 'Mismatch', 'Matched']);

    const searchedGroups = groupTechnicalCheckRows(
      filterTechnicalCheckRows(rows, 'Power: 15W', 'all', '', false),
    );
    expect(searchedGroups).toHaveLength(1);
    expect(searchedGroups[0]).toMatchObject({ id: 'dl01', findingCount: 1 });
    expect(searchedGroups[0]?.checks.map((check) => check.fieldLabel)).toEqual(['Wattage']);
  });

  it('surfaces unavailable, unsupported, and scanned-PDF outcomes without fake values', () => {
    const items = [
      luminaire('a', { datasheetPath: 'C:\\a.pdf' }),
      luminaire('b', { datasheetPath: 'https://example.test/b.pdf' }),
      luminaire('c', { datasheetPath: 'C:\\c.pdf' }),
    ];
    const outcomes = ['Unavailable', 'Unsupported', 'NeedsReview'] as const;
    const analyses = items.map<LuminaireDatasheetAnalysis>((item, index) => ({
      ...analysis(item),
      status: outcomes[index]!,
      message: index === 2 ? 'No selectable text was found.' : 'File cannot be analyzed.',
      comparisons: [],
      counts: { Matched: 0, Mismatch: 0, MissingSchedule: 0, MissingDatasheet: 0, NeedsReview: 0 },
    }));
    const rows = buildTechnicalCheckRows({
      luminaires: items,
      assets: [],
      scheduleColumns: [],
      analyses,
    });
    const outcomeRows = rows.filter((row) => row.fieldKey === 'analysis');
    expect(outcomeRows.map((row) => row.status)).toEqual(outcomes);
    expect(outcomeRows.every((row) => !row.datasheetValue && row.confidence === null)).toBe(true);
  });
});
