import { describe, expect, it } from 'vitest';
import type {
  LuminaireRecord,
  OutputColumnDefinition,
  TechnicalBoqOutputHistoryItem,
} from '@scli/domain';
import {
  artifactAbsolutePath,
  boqCellValue,
  effectiveBoqColumns,
  latestAvailableBoqOutputId,
  orderedBoqColumns,
  outputAvailabilityLabel,
} from './technicalBoqViewModel';

const row: LuminaireRecord = {
  id: 'l1',
  projectId: 'p1',
  tag: 'DL01',
  category: 'Downlight',
  imagePath: '',
  description: 'Stored description only',
  manufacturer: 'Scientechnic',
  model: 'DLX Pro',
  wattage: '18W',
  lumens: '1800 lm',
  lightColor: '3000K',
  cri: '>90',
  beamAngle: '40°',
  ipRating: 'IP20',
  mounting: 'Recessed',
  cutout: '100 mm',
  driver: 'Remote',
  control: 'DALI',
  emergency: 'No',
  datasheetPath: '',
  location: 'Level 01',
  unit: 'm',
  quantity: 2.5,
  notes: 'General areas',
  sourceName: 'DIALux',
  dimensions: '120 x 80 mm',
  bodyColorFinish: 'White',
  rowVersion: 1,
  createdAt: '2026-08-17T08:00:00.000Z',
  updatedAt: '2026-08-17T08:00:00.000Z',
};

const historyItem = (
  outputId: string,
  lifecycleState: 'FINALIZED' | 'FAILED_RECOVERABLE',
  artifactPresence: 'Present' | 'Missing' | 'Unavailable',
): TechnicalBoqOutputHistoryItem => ({
  output: {
    outputId,
    projectId: 'p1',
    revisionId: '11111111-1111-4111-8111-111111111111',
    outputFamily: 'TechnicalBoq',
    outputFormat: 'PDF',
    locatorKind: 'PROJECT_RELATIVE',
    locatorValue: '04_TECHNICAL/BOQ/REV_01/boq.pdf',
    legacyAbsolutePath: null,
    contentHash: lifecycleState === 'FINALIZED' ? 'a'.repeat(64) : null,
    templateId: 'boq.technical-approved',
    templateVersionId: 'v1',
    resolvedTemplateSnapshot: {
      templateId: 'boq.technical-approved',
      versionId: 'v1',
      family: 'TechnicalBoq',
      origin: 'builtin',
      state: 'active',
      displayName: 'Technical Approved',
      sections: [],
      columnGroups: [],
      columns: [],
      paperSize: 'A4',
      orientation: 'Landscape',
      rowDensity: 'Compact',
      productsPerPage: null,
      imageSettings: { visible: false, width: 0 },
      headerSettings: { visible: true },
      footerSettings: { visible: true },
      logoVisible: true,
      nonPriced: true,
    },
    resolvedTemplateSnapshotHash: 'hash',
    lifecycleState,
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    legacySourceField: null,
    templateProvenance: 'RESOLVED',
    failureReason: lifecycleState === 'FAILED_RECOVERABLE' ? 'Interrupted' : null,
    createdAt: '2026-08-17T08:00:00.000Z',
    finalizedAt: lifecycleState === 'FINALIZED' ? '2026-08-17T08:01:00.000Z' : null,
    updatedAt: '2026-08-17T08:01:00.000Z',
  },
  revisionLabel: 'REV_01',
  revisionSequence: 1,
  templateName: 'Technical Approved',
  createdById: 'u1',
  createdByName: 'Mohamed Ali',
  artifactPresence,
});

describe('technicalBoqViewModel', () => {
  it('renders canonical description, decimal quantity, and per-row unit without synthesis', () => {
    expect(boqCellValue(row, 'description')).toBe('Stored description only');
    expect(boqCellValue(row, 'quantity')).toBe('2.5');
    expect(boqCellValue(row, 'unit')).toBe('m');
  });

  it('applies canonical visibility and order while retaining every column for configuration', () => {
    const columns: OutputColumnDefinition[] = [
      {
        columnId: 'notes',
        fieldKey: 'notes',
        label: 'Notes',
        visible: false,
        order: 9,
        width: 180,
        groupId: 'project',
      },
      {
        columnId: 'tag',
        fieldKey: 'tag',
        label: 'Tag',
        visible: true,
        order: 1,
        width: 90,
        groupId: 'identity',
      },
      {
        columnId: 'unit',
        fieldKey: 'unit',
        label: 'Unit',
        visible: true,
        order: 6,
        width: 80,
        groupId: 'project',
      },
    ];
    expect(effectiveBoqColumns(columns).map((column) => column.columnId)).toEqual(['tag', 'unit']);
    expect(orderedBoqColumns(columns).map((column) => column.columnId)).toEqual([
      'tag',
      'unit',
      'notes',
    ]);
  });

  it('distinguishes present, missing, and recoverable output authority', () => {
    const present = historyItem('present', 'FINALIZED', 'Present');
    const missing = historyItem('missing', 'FINALIZED', 'Missing');
    const failed = historyItem('failed', 'FAILED_RECOVERABLE', 'Missing');
    expect(outputAvailabilityLabel(present)).toBe('Present');
    expect(outputAvailabilityLabel(missing)).toBe('Missing Artifact');
    expect(outputAvailabilityLabel(failed)).toBe('Failed · Recoverable');
    expect(latestAvailableBoqOutputId([missing, failed, present])).toBe('present');
  });

  it('resolves only project-relative artifacts against the supplied physical root', () => {
    expect(artifactAbsolutePath('C:\\Projects\\TEST', '04_TECHNICAL/BOQ/boq.pdf')).toBe(
      'C:\\Projects\\TEST\\04_TECHNICAL\\BOQ\\boq.pdf',
    );
    expect(artifactAbsolutePath(null, '04_TECHNICAL/BOQ/boq.pdf')).toBeNull();
  });
});
