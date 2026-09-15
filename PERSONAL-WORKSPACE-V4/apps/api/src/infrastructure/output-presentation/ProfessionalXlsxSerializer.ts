import ExcelJS from 'exceljs';
import {
  technicalScheduleCellValue,
  type ResolvedOutputEnvelope,
  type ResolvedTechnicalScheduleLayoutColumn,
  type ResolvedTechnicalScheduleRow,
} from '@scli/domain';

const scheduleHeaders = [
  'Type / Tag',
  'Manufacturer',
  'Model / Product',
  'Description',
  'Wattage',
  'Lumens',
  'CCT / Light Color',
  'CRI',
  'Beam / Optic',
  'Installation',
  'Control',
  'IP',
  'Quantity',
  'Unit',
  'Locations',
  'Notes',
];

function boqValues(row: ResolvedTechnicalScheduleRow): Array<string | number> {
  return [
    row.tag,
    row.manufacturer,
    row.model,
    row.description,
    row.wattage,
    row.lumens,
    row.lightColor,
    row.cri,
    row.beamAngle,
    row.mounting,
    row.control,
    row.ipRating,
    row.quantity,
    row.unit,
    row.location,
    row.notes,
  ];
}

function scheduleColumns(
  envelope: ResolvedOutputEnvelope,
): ResolvedTechnicalScheduleLayoutColumn[] {
  const page = envelope.pages.find((candidate) => candidate.kind === 'LuminaireSchedule');
  if (!page || page.kind !== 'LuminaireSchedule') return [];
  return [...page.layout.identityColumns, ...page.layout.groups.flatMap((group) => group.columns)];
}

function scheduleValues(
  row: ResolvedTechnicalScheduleRow,
  columns: readonly ResolvedTechnicalScheduleLayoutColumn[],
): Array<string | number> {
  return columns.map((column) => technicalScheduleCellValue(row, column.fieldKey));
}

function excelColumnName(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result || 'A';
}

function quantitySummaryRow(label: string, unit: string, total: number): Array<string | number> {
  const values: Array<string | number> = Array.from({ length: scheduleHeaders.length }, () => '');
  values[0] = label;
  values[12] = total;
  values[13] = unit;
  return values;
}

export async function serializeProfessionalXlsx(envelope: ResolvedOutputEnvelope): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = envelope.branding.companyName || 'Scientechnic Lighting';
  workbook.created = new Date(`${envelope.issueDate}T00:00:00+04:00`);
  const sheet = workbook.addWorksheet(
    envelope.outputKind === 'TechnicalBoq' ? 'Technical BOQ' : 'Luminaire Schedule',
    {
      pageSetup: {
        paperSize: (envelope.pageSize === 'A3' ? 8 : 9) as ExcelJS.PaperSize,
        orientation: envelope.orientation.toLowerCase() as 'landscape' | 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
      views: [{ state: 'frozen', ySplit: 5 }],
    },
  );
  sheet.addRow([
    envelope.outputKind === 'TechnicalBoq'
      ? 'TECHNICAL LIGHTING BOQ / QUANTITY TAKE-OFF'
      : 'TECHNICAL LUMINAIRE SCHEDULE',
  ]);
  sheet.addRow([`${envelope.project.projectCode} · ${envelope.project.projectName}`]);
  sheet.addRow([
    `Client: ${envelope.project.clientName}`,
    `Issue: ${envelope.issueStatus}`,
    `Date: ${envelope.issueDate}`,
    envelope.revision.revisionLabel,
  ]);
  sheet.addRow([]);
  let renderedHeaders = scheduleHeaders;
  let renderedColumnWidths = scheduleHeaders.map((headerText) =>
    Math.min(42, Math.max(10, headerText.length + 4)),
  );
  if (envelope.outputKind === 'TechnicalBoq') {
    sheet.addRow(scheduleHeaders);
    for (const page of envelope.pages)
      if (page.kind === 'TechnicalBoq')
        for (const group of page.groups) {
          const groupRow = sheet.addRow([group.category]);
          groupRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          groupRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          for (const row of group.rows)
            sheet.addRow(
              boqValues({
                ...row,
                image: {
                  assetVersionId: null,
                  versionSequence: null,
                  fileName: null,
                  mimeType: null,
                  sizeBytes: null,
                  fileHash: null,
                  status: 'MISSING',
                  dataUrl: null,
                },
                datasheet: {
                  assetVersionId: null,
                  versionSequence: null,
                  fileName: null,
                  mimeType: null,
                  sizeBytes: null,
                  fileHash: null,
                  status: 'MISSING',
                  dataUrl: null,
                },
              }),
            );
          for (const [unit, total] of Object.entries(group.totalsByUnit)) {
            const subtotal = sheet.addRow(
              quantitySummaryRow(`${group.category} subtotal`, unit, total),
            );
            subtotal.font = { bold: true };
          }
        }
    for (const [unit, total] of Object.entries(envelope.unitTotals)) {
      const finalTotal = sheet.addRow(quantitySummaryRow('Final quantity total', unit, total));
      finalTotal.font = { bold: true, color: { argb: 'FF0F766E' } };
    }
  } else {
    const columns = scheduleColumns(envelope);
    renderedHeaders = columns.map((column) => column.label);
    renderedColumnWidths = columns.map((column) => Math.min(42, Math.max(10, column.width / 7)));
    sheet.addRow(renderedHeaders);
    for (const page of envelope.pages)
      if (page.kind === 'LuminaireSchedule')
        for (const row of page.rows) sheet.addRow(scheduleValues(row, columns));
  }
  const header = sheet.getRow(5);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  sheet.columns = renderedHeaders.map((_headerText, index) => ({
    key: `c${index}`,
    width: renderedColumnWidths[index] ?? 10,
  }));
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } };
    });
  });
  sheet.headerFooter.oddFooter = `&L${envelope.branding.companyName}&C${envelope.template.templateId} ${envelope.template.versionId}&RPage &P of &N`;
  sheet.pageSetup.printTitlesRow = '1:5';
  sheet.pageSetup.printArea = `A1:${excelColumnName(renderedHeaders.length)}${Math.max(5, sheet.rowCount)}`;
  const metadata = workbook.addWorksheet('Output Metadata', { state: 'veryHidden' });
  for (const [key, value] of Object.entries({
    templateId: envelope.template.templateId,
    templateVersion: envelope.template.versionId,
    templateSnapshotHash: envelope.templateSnapshotHash,
    rendererIdentity: envelope.rendererIdentity,
    rendererVersion: envelope.rendererVersion,
    layoutContractVersion: envelope.layoutContractVersion,
    sourceFingerprint: envelope.sourceFingerprint,
    sourceRevisionId: envelope.revision.revisionId ?? 'DRAFT',
    projectId: envelope.project.projectId,
    outputKind: envelope.outputKind,
    format: envelope.format,
    pageSize: envelope.pageSize,
    orientation: envelope.orientation,
  }))
    metadata.addRow([key, value]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
