import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { LuminaireRecord, Project, ProjectFolderIndex, ProjectWorkspace } from '@scli/domain';
import {
  compareLuminaireWithDatasheet,
  extractDatasheetFields,
  LocalIntelligenceService,
} from './local-intelligence-service.js';

const temporaryFolders: string[] = [];

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function luminaire(overrides: Partial<LuminaireRecord> = {}): LuminaireRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '',
    description: '',
    manufacturer: 'Arkos',
    model: 'A100',
    wattage: '12 W',
    lumens: '',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '24°',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '75 mm',
    driver: '',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '',
    location: '',
    unit: 'No.',
    quantity: 8,
    notes: '',
    sourceName: '',
    dimensions: '',
    bodyColorFinish: '',
    rowVersion: 1,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

const pages = [
  {
    pageNumber: 2,
    text: [
      'Manufacturer: Arkos',
      'Model: A100',
      'Input power: 15 W',
      'Luminous flux: 1050 lm',
      'CCT: 3000 K',
      'CRI: >90',
      'Beam angle: 24° / 36°',
      'IP rating: IP44',
      'Mounting: Recessed',
      'Cut-out: Ø 75 mm',
      'Dimming: DALI',
    ].join('\n'),
  },
];

describe('local datasheet intelligence', () => {
  it('extracts technical values with page evidence and compares them without guessing variants', () => {
    const extracted = extractDatasheetFields(pages);
    const result = compareLuminaireWithDatasheet(luminaire(), extracted);

    expect(extracted.find((field) => field.fieldKey === 'lightColor')).toMatchObject({
      value: '3000 K',
      pageNumber: 2,
      confidence: 97,
    });
    expect(result.comparisons.find((field) => field.fieldKey === 'lightColor')?.status).toBe(
      'Matched',
    );
    expect(result.comparisons.find((field) => field.fieldKey === 'wattage')?.status).toBe(
      'Mismatch',
    );
    expect(result.comparisons.find((field) => field.fieldKey === 'lumens')?.status).toBe(
      'MissingSchedule',
    );
    expect(result.comparisons.find((field) => field.fieldKey === 'beamAngle')).toMatchObject({
      status: 'NeedsReview',
      alternatives: ['24°', '36°'],
      ambiguous: true,
    });
  });

  it('analyzes a linked PDF through an injected local parser and never calls a cloud service', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'scli-local-intelligence-'));
    temporaryFolders.push(folder);
    const pdfPath = path.join(folder, 'DL01.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 local test');
    const service = new LocalIntelligenceService(async () => ({ pageCount: 2, pages }));

    const analysis = await service.analyzeDatasheet(luminaire({ datasheetPath: pdfPath }));

    expect(analysis).toMatchObject({
      tag: 'DL01',
      privacyMode: 'LocalOnly',
      engine: 'SCLI Local Intelligence 1.0',
      status: 'NeedsReview',
      pageCount: 2,
      textAvailable: true,
    });
    expect(analysis.counts.Mismatch).toBeGreaterThan(0);
    expect(analysis.counts.NeedsReview).toBe(1);
  });

  it('builds a concise readiness brief from existing project data', async () => {
    const projectFolder = 'C:\\Projects\\Villa';
    const project = {
      id: '22222222-2222-4222-8222-222222222222',
      projectCode: 'SCLI260802',
      projectName: 'Villa Lighting',
      progressPercent: 45,
    } as Project;
    const workspace = {
      projectId: project.id,
      folderPath: projectFolder,
      luminaires: [luminaire({ datasheetPath: '' })],
      lightingPackage: {
        scheduleColumns: [
          {
            fieldKey: 'wattage',
            header: 'Wattage',
            visible: true,
            sortOrder: 0,
            width: 120,
            compareInRevision: true,
            requiredForIssue: true,
            internalOnly: false,
          },
        ],
      },
      health: {
        score: 100,
        checklistPercent: 100,
        openRequirements: 0,
        blockingRequirements: 0,
        overdueActions: 0,
        unresolvedReviews: 0,
        checks: [],
      },
    } as unknown as ProjectWorkspace;
    const folderIndex = {
      projectId: project.id,
      folderPath: projectFolder,
      indexedAt: null,
      fileCount: 0,
      totalBytes: 0,
      oneDriveManaged: false,
      truncated: false,
      counts: {
        Drawings: 0,
        Dialux: 0,
        Renderings: 0,
        Schedules: 0,
        TechnicalBoq: 0,
        Datasheets: 0,
        MeetingMinutes: 0,
        Other: 0,
      },
      items: [],
    } satisfies ProjectFolderIndex;
    const service = new LocalIntelligenceService(async () => ({ pageCount: 0, pages: [] }));

    const overview = await service.overview(project, workspace, folderIndex);

    expect(overview.privacyMode).toBe('LocalOnly');
    expect(overview.stats).toMatchObject({
      luminaireCount: 1,
      linkedDatasheets: 0,
      missingDatasheets: 1,
      indexedFiles: 0,
    });
    expect(overview.brief.nextActions).toContain('Link 1 missing official datasheet(s).');
    expect(overview.checks.find((item) => item.key === 'local-datasheets')?.passed).toBe(false);
  });
});
