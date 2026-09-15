import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';

export type GoldenV19XlsxKind = 'SCHEDULE' | 'TECHNICAL_BOQ';

interface GoldenV19XlsxCellProjection {
  address: string;
  valueKind: 'string' | 'number' | 'boolean' | 'date' | 'null' | 'complex';
  value: string | number | boolean | null;
  formula: string | null;
  result: string | number | boolean | null;
  numberFormat: string | null;
}

interface GoldenV19XlsxWorksheetProjection {
  name: string;
  state: string;
  rowCount: number;
  columnCount: number;
  actualRowCount: number;
  actualColumnCount: number;
  views: unknown;
  autoFilter: unknown;
  cells: GoldenV19XlsxCellProjection[][];
}

export interface GoldenV19XlsxSemanticProjection {
  contract: 'SCLI_GOLDEN_V19_XLSX_SEMANTICS_V1';
  workbook: {
    creator: string;
    lastModifiedBy: string;
    created: string | null;
    modified: string | null;
    lastPrinted: string | null;
    company: string;
    manager: string;
    subject: string;
    title: string;
    description: string;
    keywords: string;
    category: string;
    worksheetCount: number;
  };
  worksheets: GoldenV19XlsxWorksheetProjection[];
}

export interface GoldenV19XlsxSemanticResult {
  matches: boolean;
  actualFingerprint: string;
  expectedFingerprint: string;
  actual: GoldenV19XlsxSemanticProjection;
  expected: GoldenV19XlsxSemanticProjection;
}

const FIXED_DATE = '2026-08-12T08:00:00.000Z';

const EXPECTED_ROWS: Readonly<Record<GoldenV19XlsxKind, readonly (readonly string[])[]>> = {
  SCHEDULE: [
    ['Tag', 'Description', 'Manufacturer', 'Model'],
    ['Tag fixture 1', 'Description fixture 2', 'Manufacturer fixture 3', 'Model fixture 4'],
  ],
  TECHNICAL_BOQ: [
    ['Tag', 'Description', 'Unit', 'Quantity'],
    ['Tag fixture 1', 'Description fixture 2', 'Unit fixture 3', 'Quantity fixture 4'],
  ],
};

const EXPECTED_SHEET_NAMES: Readonly<Record<GoldenV19XlsxKind, string>> = {
  SCHEDULE: 'Luminaire Schedule',
  TECHNICAL_BOQ: 'Technical BOQ',
};

function isoDate(value: Date | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? String(value);
}

function valueKind(value: unknown): GoldenV19XlsxCellProjection['valueKind'] {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'complex';
}

function projectWorkbook(workbook: ExcelJS.Workbook): GoldenV19XlsxSemanticProjection {
  return {
    contract: 'SCLI_GOLDEN_V19_XLSX_SEMANTICS_V1',
    workbook: {
      creator: workbook.creator,
      lastModifiedBy: workbook.lastModifiedBy,
      created: isoDate(workbook.created),
      modified: isoDate(workbook.modified),
      lastPrinted: isoDate(workbook.lastPrinted),
      company: workbook.company,
      manager: workbook.manager,
      subject: workbook.subject,
      title: workbook.title,
      description: workbook.description,
      keywords: workbook.keywords,
      category: workbook.category,
      worksheetCount: workbook.worksheets.length,
    },
    worksheets: workbook.worksheets.map((worksheet) => ({
      name: worksheet.name,
      state: worksheet.state,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      actualRowCount: worksheet.actualRowCount,
      actualColumnCount: worksheet.actualColumnCount,
      views: worksheet.views ?? null,
      autoFilter: worksheet.autoFilter ?? null,
      cells: Array.from({ length: worksheet.rowCount }, (_, rowIndex) =>
        Array.from({ length: worksheet.columnCount }, (_, columnIndex) => {
          const cell = worksheet.getCell(rowIndex + 1, columnIndex + 1);
          return {
            address: cell.address,
            valueKind: valueKind(cell.value),
            value: scalar(cell.value),
            formula: cell.formula ?? null,
            result: scalar(cell.result),
            numberFormat: cell.numFmt ?? null,
          };
        }),
      ),
    })),
  };
}

function expectedProjection(kind: GoldenV19XlsxKind): GoldenV19XlsxSemanticProjection {
  const rows = EXPECTED_ROWS[kind];
  return {
    contract: 'SCLI_GOLDEN_V19_XLSX_SEMANTICS_V1',
    workbook: {
      creator: 'SCLI Golden v19 Fixture',
      lastModifiedBy: 'Unknown',
      created: FIXED_DATE,
      modified: FIXED_DATE,
      lastPrinted: FIXED_DATE,
      company: '',
      manager: '',
      subject: '',
      title: '',
      description: '',
      keywords: '',
      category: '',
      worksheetCount: 1,
    },
    worksheets: [
      {
        name: EXPECTED_SHEET_NAMES[kind],
        state: 'visible',
        rowCount: rows.length,
        columnCount: rows[0]!.length,
        actualRowCount: rows.length,
        actualColumnCount: rows[0]!.length,
        views: null,
        autoFilter: null,
        cells: rows.map((row, rowIndex) =>
          row.map((value, columnIndex) => ({
            address: `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`,
            valueKind: 'string',
            value,
            formula: null,
            result: null,
            numberFormat: null,
          })),
        ),
      },
    ],
  };
}

function fingerprint(projection: GoldenV19XlsxSemanticProjection): string {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

export async function inspectGoldenV19XlsxSemantics(
  bytes: Buffer,
  kind: GoldenV19XlsxKind,
): Promise<GoldenV19XlsxSemanticResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const actual = projectWorkbook(workbook);
  const expected = expectedProjection(kind);
  const actualFingerprint = fingerprint(actual);
  const expectedFingerprint = fingerprint(expected);
  return {
    matches: actualFingerprint === expectedFingerprint,
    actualFingerprint,
    expectedFingerprint,
    actual,
    expected,
  };
}
