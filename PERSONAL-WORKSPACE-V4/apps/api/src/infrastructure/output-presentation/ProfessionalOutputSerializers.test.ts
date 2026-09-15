import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import type {
  ResolvedOutputAsset,
  ResolvedOutputEnvelope,
  ResolvedTechnicalScheduleRow,
} from '@scli/domain';
import { p4dProfessionalTemplateVersions, resolveTechnicalScheduleLayout } from '@scli/domain';
import { serializeProfessionalPdf } from './ProfessionalPdfSerializer';
import { serializeProfessionalXlsx } from './ProfessionalXlsxSerializer';

const missingAsset: ResolvedOutputAsset = {
  assetVersionId: null,
  versionSequence: null,
  fileName: null,
  mimeType: null,
  sizeBytes: null,
  fileHash: null,
  status: 'MISSING',
  dataUrl: null,
};
const logoDataUrl = `data:image/png;base64,${readFileSync(
  new URL('../../../../web-v4/src/assets/branding/scientechnic-official-logo.png', import.meta.url),
).toString('base64')}`;

function row(id: number): ResolvedTechnicalScheduleRow {
  return {
    luminaireId: `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    tag: `DL${String(id).padStart(2, '0')}`,
    category: id % 2 ? 'Downlight' : 'Track',
    imagePath: '',
    description: 'Professional recessed luminaire with a long but bounded technical description.',
    manufacturer: 'SCLI',
    model: `MODEL-${id}`,
    wattage: `${10 + id}W`,
    lumens: `${900 + id * 100}lm`,
    lightColor: '3000K',
    cri: 'CRI 90',
    beamAngle: '36°',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '100mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '',
    location: id % 2 ? 'Lobby' : 'Corridor',
    unit: 'pcs',
    quantity: id + 1,
    notes: id === 1 ? '3000K / 36° / 150 × 90 mm / Ø 125 mm – verified.' : '',
    sourceName: 'Project',
    dimensions: '100mm',
    bodyColorFinish: 'White',
    attachmentReferences: [],
    image:
      id === 1
        ? { ...missingAsset, status: 'VERIFIED', mimeType: 'image/png', dataUrl: logoDataUrl }
        : missingAsset,
    datasheet: missingAsset,
  };
}

function envelope(
  kind: 'LuminaireSchedule' | 'TechnicalBoq' | 'PresentationSchedule' = 'LuminaireSchedule',
): ResolvedOutputEnvelope {
  const rows = [row(1), row(2), row(3), row(4)];
  const template = p4dProfessionalTemplateVersions.find((item) => item.family === kind)!;
  return {
    outputKind: kind,
    format: kind === 'PresentationSchedule' ? 'PDF' : 'XLSX',
    project: {
      projectId: '10000000-0000-4000-8000-000000000001',
      projectCode: '001_SCT_TEST',
      projectName: 'Output Presentation Test',
      clientName: 'Test Client',
    },
    revision: {
      revisionId: '30000000-0000-4000-8000-000000000001',
      revisionLabel: 'REV_01',
      revisionSequence: 1,
      lifecycleState: 'PREPARING',
      draftPreview: false,
    },
    template,
    branding: {
      companyName: 'Scientechnic Lighting',
      designerName: 'Lighting Designer',
      logoDataUrl,
      timeZone: 'Asia/Dubai',
    },
    issueDate: '2026-08-25',
    issueStatus: 'Preliminary',
    sourceFingerprint: 'a'.repeat(64),
    templateSnapshotHash: 'b'.repeat(64),
    rendererIdentity: 'scli.output-presentation',
    rendererVersion: 'p4d-2',
    layoutContractVersion: 'p4d-v1',
    pageSize: 'A3',
    orientation: 'Landscape',
    productsPerPage: kind === 'PresentationSchedule' ? 2 : null,
    messages: [],
    pages:
      kind === 'LuminaireSchedule'
        ? [{ kind, pageNumber: 1, layout: resolveTechnicalScheduleLayout(template), rows }]
        : kind === 'PresentationSchedule'
          ? [
              { kind, pageNumber: 1, products: rows.slice(0, 2) },
              { kind, pageNumber: 2, products: rows.slice(2) },
            ]
          : [
              {
                kind,
                pageNumber: 1,
                groups: [{ category: 'Downlight', rows, totalsByUnit: { pcs: 14 } }],
              },
            ],
    rowCount: rows.length,
    unitTotals: { pcs: 14 },
  };
}

describe('professional P4D serializers', () => {
  it('creates searchable multi-page PDF from the resolved presentation pages', () => {
    const pdf = serializeProfessionalPdf(envelope('PresentationSchedule'));
    const source = pdf.toString('latin1');
    expect(source.startsWith('%PDF-1.7')).toBe(true);
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(source).toContain('PRESENTATION LUMINAIRE SCHEDULE');
    expect(source).toContain('DL01');
    expect(source).toContain('Page 2 of 2');
    expect(source.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps canonical installation, documentation, BOQ description, and notes in searchable PDF text', () => {
    const scheduleSource = serializeProfessionalPdf(envelope('LuminaireSchedule')).toString(
      'latin1',
    );
    expect(scheduleSource).toContain('INSTALLATION:');
    expect(scheduleSource).toContain('DOCUMENTATION:');
    expect(scheduleSource).toContain('CRI 90');
    expect(scheduleSource).toContain('IP44');
    expect(scheduleSource).not.toContain('CRI CRI 90');
    expect(scheduleSource).not.toContain('IP IP44');
    const boqSource = serializeProfessionalPdf(envelope('TechnicalBoq')).toString('latin1');
    expect(boqSource).toContain('Description:');
    expect(boqSource).toContain('Notes:');
    expect(boqSource).toContain('Downlight subtotal: 14 pcs');
    expect(boqSource).toContain('FINAL QUANTITY TOTAL: 14 pcs');
  });

  it('encodes ordinary lighting-document characters with searchable WinAnsi text', () => {
    const source = serializeProfessionalPdf(envelope('LuminaireSchedule')).toString('latin1');
    expect(source).toContain('/Encoding /WinAnsiEncoding');
    expect(source).toContain(`36${String.fromCharCode(0xb0)}`);
    expect(source).toContain(`150 ${String.fromCharCode(0xd7)} 90 mm`);
    expect(source).toContain(`${String.fromCharCode(0xd8)} 125 mm`);
    expect(source).toContain(`${String.fromCharCode(0x96)} verified`);
    expect(source).toContain('3000K /');
  });

  it('creates native XLSX with resolved order, print geometry, and explainability metadata', async () => {
    const bytes = await serializeProfessionalXlsx(envelope());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const schedule = workbook.getWorksheet('Luminaire Schedule')!;
    expect(schedule.getCell('A6').value).toBe('DL01');
    expect(schedule.getCell('A9').value).toBe('DL04');
    expect(schedule.pageSetup.orientation).toBe('landscape');
    expect(schedule.pageSetup.printArea).toBe('A1:X9');
    const metadata = workbook.getWorksheet('Output Metadata')!;
    expect(metadata.state).toBe('veryHidden');
    expect(metadata.getColumn(2).values).toContain('schedule.technical-modern');
    expect(metadata.getColumn(2).values).toContain('a'.repeat(64));
  });

  it('keeps BOQ subtotals and final totals separated by Unit in native XLSX', async () => {
    const bytes = await serializeProfessionalXlsx(envelope('TechnicalBoq'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const boq = workbook.getWorksheet('Technical BOQ')!;
    const subtotal = boq.findRow(boq.getColumn(1).values.indexOf('Downlight subtotal'))!;
    const finalTotal = boq.findRow(boq.getColumn(1).values.indexOf('Final quantity total'))!;
    expect(subtotal.getCell(13).value).toBe(14);
    expect(subtotal.getCell(14).value).toBe('pcs');
    expect(finalTotal.getCell(13).value).toBe(14);
    expect(finalTotal.getCell(14).value).toBe('pcs');
  });
});
