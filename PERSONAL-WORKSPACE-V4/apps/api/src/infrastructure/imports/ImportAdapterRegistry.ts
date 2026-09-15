import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  DomainError,
  IMPORT_ADAPTER_VERSION,
  type ImportAdapterId,
  type ImportColumnMapping,
  type ImportRawCell,
} from '@scli/domain';

export const IMPORT_SOURCE_LIMITS = Object.freeze({
  csvBytes: 10 * 1024 * 1024,
  xlsxBytes: 25 * 1024 * 1024,
  expandedXlsxBytes: 100 * 1024 * 1024,
  xlsxEntries: 5_000,
  worksheets: 50,
  rows: 10_000,
  columns: 200,
  cellText: 20_000,
  rawPayloadBytes: 50 * 1024 * 1024,
  headerScanMeaningfulRows: 50,
});

export interface ParsedImportRow {
  sourceRowNumber: number;
  rawCells: ImportRawCell[];
}

export interface ParsedImportTable {
  tableKey: string;
  tableName: string;
  sourceOrdinal: number;
  visibilityState: 'VISIBLE' | 'HIDDEN' | 'VERY_HIDDEN';
  detectedRegion: Record<string, unknown>;
  headerRow: number | null;
  selected: boolean;
  headerSignature: string;
  mapping: ImportColumnMapping[];
  rows: ParsedImportRow[];
  warnings: string[];
}

export interface ImportAdapterResult {
  adapterId: ImportAdapterId;
  adapterVersion: string;
  confidence: 'HIGH' | 'MEDIUM';
  evidence: string[];
  warnings: string[];
  detection: Record<string, unknown>;
  tables: ParsedImportTable[];
}

export interface NativeMappingSafetyIssue {
  reasonCode: 'DIALUX_ARTICLE_NUMBER_IDENTITY_CONFLICT' | 'DIALUX_ARTICLE_NAME_IDENTITY_CONFLICT';
  sourceColumnKey: string;
  sourceHeader: string;
  attemptedField: ImportColumnMapping['canonicalField'];
  recommendedField: NonNullable<ImportColumnMapping['canonicalField']>;
  humanReason: string;
  requiredNextStep: string;
}

interface CsvDecodeResult {
  text: string;
  encoding: 'UTF-8' | 'WINDOWS-1252';
  warning: string | null;
}

const exactAliases: Readonly<Record<string, ImportColumnMapping['canonicalField']>> = Object.freeze(
  {
    manufacturer: 'MANUFACTURER',
    brand: 'MANUFACTURER',
    make: 'MANUFACTURER',
    'product family': 'PRODUCT_FAMILY',
    family: 'PRODUCT_FAMILY',
    'product name': 'PRODUCT_FAMILY',
    'product type': 'PRODUCT_TYPE',
    type: 'PRODUCT_TYPE',
    variant: 'VARIANT_LABEL',
    'variant label': 'VARIANT_LABEL',
    'article number': 'ORDERING_CODE',
    'product code': 'ORDERING_CODE',
    'ordering code': 'ORDERING_CODE',
    'order code': 'ORDERING_CODE',
    sku: 'ORDERING_CODE',
    description: 'DESCRIPTION',
    power: 'WATTAGE',
    watt: 'WATTAGE',
    watts: 'WATTAGE',
    wattage: 'WATTAGE',
    'system power': 'WATTAGE',
    'connected load': 'WATTAGE',
    lumen: 'LUMENS',
    lumens: 'LUMENS',
    'luminous flux': 'LUMENS',
    'luminaire luminous flux': 'LUMENS',
    'light output': 'LUMENS',
    cct: 'CCT',
    kelvin: 'CCT',
    'color temperature': 'CCT',
    'colour temperature': 'CCT',
    cri: 'CRI',
    'colour rendering index': 'CRI',
    'color rendering index': 'CRI',
    beam: 'BEAM_OPTIC',
    optic: 'BEAM_OPTIC',
    'beam angle': 'BEAM_OPTIC',
    ip: 'IP',
    'ip rating': 'IP',
    control: 'CONTROL',
    mounting: 'MOUNTING',
    installation: 'MOUNTING',
    'cut out': 'CUTOUT',
    cutout: 'CUTOUT',
    dimensions: 'DIMENSIONS',
    'body color': 'BODY_COLOR_FINISH',
    'body colour': 'BODY_COLOR_FINISH',
    finish: 'BODY_COLOR_FINISH',
    driver: 'DRIVER',
    emergency: 'EMERGENCY',
    tag: 'TAG',
    'type tag': 'TAG',
    category: 'PROJECT_CATEGORY',
    location: 'LOCATION',
    locations: 'LOCATION',
    unit: 'UNIT',
    quantity: 'QUANTITY',
    qty: 'QUANTITY',
    notes: 'NOTES',
    'description override': 'DESCRIPTION_OVERRIDE',
    'product image': 'PRODUCT_IMAGE',
    image: 'PRODUCT_IMAGE',
    datasheet: 'DATASHEET',
    ies: 'IES',
    ldt: 'LDT',
  },
);

function normalizedHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\[[^\]]+\]|\([^)]*\)/g, ' ')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

function unitHintFromHeader(value: string): string | null {
  const match = value.match(
    /\[\s*(W\s*\/\s*m|W|lm\s*\/\s*m|lm|K|°)\s*\]|\(\s*(W\s*\/\s*m|W|lm\s*\/\s*m|lm|K|°)\s*\)/i,
  );
  if (!match) return null;
  return (match[1] ?? match[2])!.replace(/\s+/g, '').toUpperCase().replace('LM', 'lm');
}

export function suggestColumnMapping(sourceColumnKey: string, header: string): ImportColumnMapping {
  const normalized = normalizedHeader(header || sourceColumnKey);
  const unitHint = unitHintFromHeader(header);
  if (normalized === 'model') {
    return {
      sourceColumnKey,
      sourceHeader: header,
      canonicalField: 'PRODUCT_FAMILY',
      confidence: 'MEDIUM',
      unitHint,
      evidence: ['Model is not assumed to be an Ordering Code. Review Product Family intent.'],
    };
  }
  const field = exactAliases[normalized] ?? null;
  return {
    sourceColumnKey,
    sourceHeader: header,
    canonicalField: field,
    confidence: field ? 'HIGH' : 'UNMAPPED',
    unitHint,
    evidence: field ? [`Header alias matched ${field}.`] : ['No conservative field alias matched.'],
  };
}

function markMappingConflicts(mapping: ImportColumnMapping[]): ImportColumnMapping[] {
  const byField = new Map<string, number[]>();
  mapping.forEach((item, index) => {
    if (!item.canonicalField || item.confidence === 'UNMAPPED') return;
    const existing = byField.get(item.canonicalField) ?? [];
    existing.push(index);
    byField.set(item.canonicalField, existing);
  });
  const conflicts = new Set([...byField.values()].filter((items) => items.length > 1).flat());
  return mapping.map((item, index) =>
    conflicts.has(index)
      ? {
          ...item,
          confidence: 'CONFLICT',
          evidence: [...item.evidence, 'Multiple source columns target the same canonical field.'],
        }
      : item,
  );
}

export function suggestColumnMappings(headers: string[]): ImportColumnMapping[] {
  return markMappingConflicts(
    headers.map((header, index) => suggestColumnMapping(`COL_${index + 1}`, header)),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function decodeCsv(buffer: Buffer): CsvDecodeResult {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'UTF-8', warning: null };
  } catch {
    const text = new TextDecoder('windows-1252', { fatal: true }).decode(buffer);
    return {
      text,
      encoding: 'WINDOWS-1252',
      warning: 'Windows-1252 fallback was used and requires owner review.',
    };
  }
}

function parseDelimitedRecords(text: string, delimiter: string, maxRecords?: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
      continue;
    }
    if (character === delimiter) {
      row.push(value);
      value = '';
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      value = '';
      if (maxRecords && rows.length >= maxRecords) return rows;
      continue;
    }
    value += character;
  }
  if (quoted)
    throw new DomainError('VALIDATION_ERROR', 'The delimited source has an unclosed quote.', 400);
  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function delimiterScore(rows: string[][]): number {
  if (rows.length < 2) return -1;
  const widths = rows.map((row) => row.length).filter((width) => width > 1);
  if (widths.length < 2) return -1;
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  const [modalWidth, modalCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return modalCount * 20 + modalWidth - (widths.length - modalCount) * 8;
}

function detectDelimiter(text: string, extension: string): { delimiter: string; rows: string[][] } {
  const candidates = extension === '.tsv' ? ['\t', ',', ';'] : [',', ';', '\t'];
  const scored = candidates.map((delimiter) => ({
    delimiter,
    score: delimiterScore(parseDelimitedRecords(text, delimiter, 25)),
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score || candidates.indexOf(a.delimiter) - candidates.indexOf(b.delimiter),
  );
  const best = scored[0]!;
  if (best.score < 0)
    throw new DomainError('VALIDATION_ERROR', 'No stable CSV or TSV table was detected.', 400);
  return { delimiter: best.delimiter, rows: parseDelimitedRecords(text, best.delimiter) };
}

function checkedCellText(value: string): string {
  if (value.length > IMPORT_SOURCE_LIMITS.cellText)
    throw new DomainError(
      'VALIDATION_ERROR',
      'A source cell exceeds the 20,000 character limit.',
      400,
    );
  return value;
}

function rawCellsFromValues(
  values: readonly string[],
  headers: readonly string[],
  internalHeaders?: readonly string[],
): ImportRawCell[] {
  return headers.map((header, index) => ({
    sourceColumnKey: internalHeaders?.[index]?.trim() || `COL_${index + 1}`,
    internalHeader: internalHeaders?.[index]?.trim() || null,
    header,
    rawValue: checkedCellText(values[index] ?? ''),
    formula: null,
    cachedValue: null,
  }));
}

const DIALUX_INTERNAL_HEADERS = new Set([
  'TAGText',
  'NumberText',
  'ManufNameText',
  'ArticleNumberText',
  'ArticleNameText',
  'LuminaireLuminousFluxText',
  'ConnectedLoadText',
  'CCTText',
  'CRIText',
]);

function dialuxMapping(internalHeaders: string[], humanHeaders: string[]): ImportColumnMapping[] {
  const fieldByInternal: Readonly<Record<string, ImportColumnMapping['canonicalField']>> = {
    TAGText: 'TAG',
    NumberText: 'QUANTITY',
    ManufNameText: 'MANUFACTURER',
    ArticleNumberText: 'ORDERING_CODE',
    ArticleNameText: 'PRODUCT_FAMILY',
    LuminaireLuminousFluxText: 'LUMENS',
    ConnectedLoadText: 'WATTAGE',
    CCTText: 'CCT',
    CRIText: 'CRI',
  };
  return markMappingConflicts(
    internalHeaders.map((sourceColumnKey, index) => {
      const canonicalField = fieldByInternal[sourceColumnKey] ?? null;
      const articleName = sourceColumnKey === 'ArticleNameText';
      return {
        sourceColumnKey: sourceColumnKey || `COL_${index + 1}`,
        sourceHeader: humanHeaders[index] || sourceColumnKey,
        canonicalField,
        confidence: canonicalField ? (articleName ? 'MEDIUM' : 'HIGH') : 'UNMAPPED',
        unitHint: unitHintFromHeader(humanHeaders[index] ?? ''),
        evidence: canonicalField
          ? [
              articleName
                ? 'DIALux Article Name may be Product Family or Description; review before use.'
                : `DIALux internal schema maps to ${canonicalField}.`,
            ]
          : ['DIALux column is preserved as unmapped raw evidence.'],
      };
    }),
  );
}

/**
 * DIALux internal headers carry stronger semantic authority than translated display labels.
 * Keep this adapter-specific: generic CSV mappings remain Owner-reviewable and do not inherit a
 * universal value-shape heuristic.
 */
export function nativeMappingSafetyIssues(
  adapterId: ImportAdapterId | null,
  mapping: readonly ImportColumnMapping[],
): NativeMappingSafetyIssue[] {
  if (adapterId !== 'DIALUX_NATIVE_CSV') return [];
  const issues: NativeMappingSafetyIssue[] = [];
  for (const item of mapping) {
    if (item.sourceColumnKey === 'ArticleNumberText' && item.canonicalField !== 'ORDERING_CODE') {
      issues.push({
        reasonCode: 'DIALUX_ARTICLE_NUMBER_IDENTITY_CONFLICT',
        sourceColumnKey: item.sourceColumnKey,
        sourceHeader: item.sourceHeader,
        attemptedField: item.canonicalField,
        recommendedField: 'ORDERING_CODE',
        humanReason:
          'DIALux Article No. is the native ordering-code identity and cannot be reassigned silently.',
        requiredNextStep: 'Restore Article No. to Ordering Code before reinspecting.',
      });
    }
    if (item.sourceColumnKey === 'ArticleNameText' && item.canonicalField === 'ORDERING_CODE') {
      issues.push({
        reasonCode: 'DIALUX_ARTICLE_NAME_IDENTITY_CONFLICT',
        sourceColumnKey: item.sourceColumnKey,
        sourceHeader: item.sourceHeader,
        attemptedField: item.canonicalField,
        recommendedField: 'PRODUCT_FAMILY',
        humanReason:
          'DIALux Article name is descriptive product-family evidence, not ordering-code identity.',
        requiredNextStep: 'Map Article name to Product Family, Description, or Unmapped.',
      });
    }
  }
  return issues;
}

function csvAdapter(fileName: string, buffer: Buffer): ImportAdapterResult {
  const extension = fileName.toLocaleLowerCase('en').endsWith('.tsv') ? '.tsv' : '.csv';
  const decoded = decodeCsv(buffer);
  const { delimiter, rows } = detectDelimiter(decoded.text, extension);
  if (rows.length < 2)
    throw new DomainError('VALIDATION_ERROR', 'The source contains no data rows.', 400);
  const headers = rows[0]!.map((value) => checkedCellText(value.trim()));
  if (headers.length > IMPORT_SOURCE_LIMITS.columns)
    throw new DomainError('VALIDATION_ERROR', 'The source exceeds the 200 column limit.', 400);
  const recognizedDialux = headers.filter((header) => DIALUX_INTERNAL_HEADERS.has(header));
  const nativeDialux =
    delimiter === ';' && headers.includes('TAGText') && recognizedDialux.length >= 3;
  const humanHeaders = nativeDialux
    ? rows[1]!.map((value, index) =>
        checkedCellText(value.trim() || headers[index] || `Column ${index + 1}`),
      )
    : headers;
  const dataStart = nativeDialux ? 2 : 1;
  const dataRows = rows.slice(dataStart);
  if (dataRows.length > IMPORT_SOURCE_LIMITS.rows)
    throw new DomainError('VALIDATION_ERROR', 'The source exceeds the 10,000 row limit.', 400);
  const mappings = nativeDialux
    ? dialuxMapping(headers, humanHeaders)
    : markMappingConflicts(
        headers.map((header, index) => suggestColumnMapping(`COL_${index + 1}`, header)),
      );
  const commaDecimals = dataRows.some((row) =>
    row.some((value) => /^\s*\d+,\d+\s*(?:W|lm|K|°)?\s*$/i.test(value)),
  );
  const decimalConvention =
    delimiter === ';' && commaDecimals ? 'COMMA' : commaDecimals ? 'UNRESOLVED' : 'DOT';
  const warnings = [
    decoded.warning,
    decimalConvention === 'UNRESOLVED'
      ? 'Decimal comma is ambiguous with the detected delimiter.'
      : null,
  ].filter((value): value is string => Boolean(value));
  const table: ParsedImportTable = {
    tableKey: 'DELIMITED:1',
    tableName: nativeDialux ? 'DIALux Luminaires' : 'Delimited source',
    sourceOrdinal: 0,
    visibilityState: 'VISIBLE',
    detectedRegion: {
      delimiter: delimiter === '\t' ? 'TAB' : delimiter,
      encoding: decoded.encoding,
      decimalConvention,
      headerRows: nativeDialux ? [1, 2] : [1],
      dataStartRow: dataStart + 1,
    },
    headerRow: 1,
    selected: true,
    headerSignature: sha256(JSON.stringify(nativeDialux ? [headers, humanHeaders] : headers)),
    mapping: mappings,
    rows: dataRows.map((values, index) => ({
      sourceRowNumber: dataStart + index + 1,
      rawCells: rawCellsFromValues(values, humanHeaders, nativeDialux ? headers : undefined),
    })),
    warnings,
  };
  return {
    adapterId: nativeDialux ? 'DIALUX_NATIVE_CSV' : 'GENERIC_CSV',
    adapterVersion: IMPORT_ADAPTER_VERSION,
    confidence: nativeDialux ? 'HIGH' : 'MEDIUM',
    evidence: nativeDialux
      ? ['Semicolon source contains TAGText and recognized DIALux internal schema columns.']
      : ['A stable delimiter was detected across multiple logical records.'],
    warnings,
    detection: {
      delimiter: delimiter === '\t' ? 'TAB' : delimiter,
      encoding: decoded.encoding,
      decimalConvention,
      logicalRecordCount: rows.length,
    },
    tables: [table],
  };
}

type SafeCell = Pick<ImportRawCell, 'rawValue' | 'formula' | 'cachedValue'>;
function safePrimitive(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return checkedCellText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}
function safeExcelCell(value: unknown): SafeCell {
  const primitive = safePrimitive(value);
  if (primitive !== null || value === null || value === undefined)
    return { rawValue: primitive, formula: null, cachedValue: null };
  if (typeof value !== 'object') return { rawValue: null, formula: null, cachedValue: null };
  const record = value as Record<string, unknown>;
  if (typeof record.formula === 'string' || typeof record.sharedFormula === 'string') {
    const formula = String(record.formula ?? record.sharedFormula);
    const cachedValue = safePrimitive(record.result);
    return { rawValue: cachedValue, formula: checkedCellText(formula), cachedValue };
  }
  if (Array.isArray(record.richText)) {
    const text = record.richText
      .map((item) =>
        item && typeof item === 'object'
          ? String((item as Record<string, unknown>).text ?? '')
          : '',
      )
      .join('');
    return { rawValue: checkedCellText(text), formula: null, cachedValue: null };
  }
  if (typeof record.text === 'string')
    return { rawValue: checkedCellText(record.text), formula: null, cachedValue: null };
  if (record.error !== undefined)
    return { rawValue: checkedCellText(String(record.error)), formula: null, cachedValue: null };
  return { rawValue: null, formula: null, cachedValue: null };
}
function rowValues(worksheet: ExcelJS.Worksheet, rowNumber: number, width: number): SafeCell[] {
  const row = worksheet.getRow(rowNumber);
  return Array.from({ length: width }, (_, index) => safeExcelCell(row.getCell(index + 1).value));
}
function safeHeaderValue(cell: SafeCell, index: number): string {
  const value = cell.cachedValue ?? cell.rawValue;
  return value === null
    ? `Column ${index + 1}`
    : checkedCellText(String(value).trim() || `Column ${index + 1}`);
}
interface HeaderCandidate {
  rowNumber: number;
  score: number;
  width: number;
  headers: string[];
  mappings: ImportColumnMapping[];
}
function headerCandidates(worksheet: ExcelJS.Worksheet): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];
  let meaningful = 0;
  for (
    let rowNumber = 1;
    rowNumber <= worksheet.rowCount && meaningful < IMPORT_SOURCE_LIMITS.headerScanMeaningfulRows;
    rowNumber += 1
  ) {
    const width = Math.min(worksheet.getRow(rowNumber).cellCount, IMPORT_SOURCE_LIMITS.columns + 1);
    if (width === 0) continue;
    const cells = rowValues(worksheet, rowNumber, width);
    const populated = cells.filter((cell) => (cell.cachedValue ?? cell.rawValue) !== null).length;
    if (populated === 0) continue;
    meaningful += 1;
    if (width > IMPORT_SOURCE_LIMITS.columns)
      throw new DomainError('VALIDATION_ERROR', 'An XLSX table exceeds the 200 column limit.', 400);
    const headers = cells.map(safeHeaderValue);
    const mappings = suggestColumnMappings(headers);
    const recognized = mappings.filter((mapping) => mapping.canonicalField).length;
    const conflicts = mappings.filter((mapping) => mapping.confidence === 'CONFLICT').length;
    const duplicates = headers.length - new Set(headers.map(normalizedHeader)).size;
    const density = populated / Math.max(width, 1);
    const nextPopulated =
      rowNumber < worksheet.rowCount
        ? rowValues(worksheet, rowNumber + 1, width).filter(
            (cell) => (cell.cachedValue ?? cell.rawValue) !== null,
          ).length
        : 0;
    const score =
      recognized * 14 +
      density * 10 +
      (nextPopulated >= Math.max(2, populated / 2) ? 8 : 0) -
      conflicts * 10 -
      duplicates * 5;
    if (recognized > 0 || score >= 12)
      candidates.push({ rowNumber, score, width, headers, mappings });
  }
  return candidates.sort((a, b) => b.score - a.score || a.rowNumber - b.rowNumber);
}

async function preflightXlsx(buffer: Buffer): Promise<{ warnings: string[] }> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'The XLSX source is corrupt or unsafe.', 400);
  }
  const entries = Object.values(archive.files);
  if (entries.length > IMPORT_SOURCE_LIMITS.xlsxEntries)
    throw new DomainError('VALIDATION_ERROR', 'The XLSX container has too many entries.', 400);
  if (entries.some((entry) => /(?:^|\/)vbaProject\.bin$/i.test(entry.name)))
    throw new DomainError(
      'VALIDATION_ERROR',
      'Macro-enabled workbook content is not accepted.',
      400,
    );
  let expanded = 0;
  for (const entry of entries) {
    const internal = entry as unknown as { _data?: { uncompressedSize?: number } };
    expanded += internal._data?.uncompressedSize ?? 0;
  }
  if (expanded > IMPORT_SOURCE_LIMITS.expandedXlsxBytes)
    throw new DomainError('VALIDATION_ERROR', 'The expanded XLSX container exceeds 100 MiB.', 400);
  return {
    warnings: entries.some((entry) => /^xl\/externalLinks\//i.test(entry.name))
      ? ['External workbook relationships were ignored and never fetched.']
      : [],
  };
}
function worksheetVisibility(state: string): ParsedImportTable['visibilityState'] {
  return state === 'hidden' ? 'HIDDEN' : state === 'veryHidden' ? 'VERY_HIDDEN' : 'VISIBLE';
}
function xlsxRawCells(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  headers: string[],
): ImportRawCell[] {
  return rowValues(worksheet, rowNumber, headers.length).map((cell, index) => ({
    sourceColumnKey: `COL_${index + 1}`,
    internalHeader: null,
    header: headers[index]!,
    rawValue: cell.rawValue,
    formula: cell.formula,
    cachedValue: cell.cachedValue,
  }));
}

async function xlsxAdapter(buffer: Buffer): Promise<ImportAdapterResult> {
  const preflight = await preflightXlsx(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0], {
      ignoreNodes: ['dataValidations', 'drawing', 'extLst', 'legacyDrawing', 'picture'],
    });
  } catch {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The XLSX workbook could not be inspected safely.',
      400,
    );
  }
  if (workbook.worksheets.length > IMPORT_SOURCE_LIMITS.worksheets)
    throw new DomainError(
      'VALIDATION_ERROR',
      'The XLSX source exceeds the 50 worksheet limit.',
      400,
    );
  const workspaceTemplate = workbook.worksheets.some(
    (sheet) => String(sheet.getCell('A1').value ?? '') === 'SCLI_WORKSPACE_IMPORT_TEMPLATE_V1',
  );
  const outputMetadata = workbook.worksheets.find(
    (sheet) => sheet.name.trim().toLocaleLowerCase('en') === 'output metadata',
  );
  const adapterId: ImportAdapterId = workspaceTemplate
    ? 'WORKSPACE_TEMPLATE_XLSX'
    : outputMetadata
      ? 'WORKSPACE_OUTPUT_XLSX'
      : 'GENERIC_XLSX';
  const tables: ParsedImportTable[] = [];
  let totalRows = 0;
  for (const [sourceOrdinal, worksheet] of workbook.worksheets.entries()) {
    const worksheetWidth = worksheet.actualColumnCount;
    if (worksheetWidth > IMPORT_SOURCE_LIMITS.columns)
      throw new DomainError('VALIDATION_ERROR', 'An XLSX table exceeds the 200 column limit.', 400);
    const rawInspectionRows = Array.from({ length: worksheet.rowCount }, (_, index) => {
      const rowNumber = index + 1;
      return { rowNumber, cells: rowValues(worksheet, rowNumber, worksheetWidth) };
    }).filter((row) => row.cells.some((cell) => (cell.cachedValue ?? cell.rawValue) !== null));
    const candidates = headerCandidates(worksheet);
    const best = candidates[0];
    const ambiguous = Boolean(best && candidates[1] && best.score - candidates[1].score < 5);
    const metadataSheet = worksheet === outputMetadata;
    const headerRow = best?.rowNumber ?? null;
    const headers = best?.headers ?? [];
    const dataRows: ParsedImportRow[] = [];
    if (best && !metadataSheet)
      for (let rowNumber = best.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const rawCells = xlsxRawCells(worksheet, rowNumber, headers);
        const populated = rawCells.filter(
          (cell) => cell.rawValue !== null && cell.rawValue !== '',
        ).length;
        if (populated === 0) continue;
        const first = String(
          rawCells.find((cell) => cell.rawValue !== null)?.rawValue ?? '',
        ).trim();
        if (adapterId === 'WORKSPACE_OUTPUT_XLSX' && /^(?:subtotal|total|group)\b/i.test(first))
          continue;
        dataRows.push({ sourceRowNumber: rowNumber, rawCells });
      }
    totalRows += dataRows.length;
    if (totalRows > IMPORT_SOURCE_LIMITS.rows)
      throw new DomainError(
        'VALIDATION_ERROR',
        'The XLSX source exceeds the 10,000 row limit.',
        400,
      );
    const visibilityState = worksheetVisibility(worksheet.state);
    tables.push({
      tableKey: `WORKSHEET:${sourceOrdinal + 1}`,
      tableName: worksheet.name,
      sourceOrdinal,
      visibilityState,
      detectedRegion: {
        candidateHeaderRows: candidates.slice(0, 5).map((candidate) => ({
          row: candidate.rowNumber,
          score: Number(candidate.score.toFixed(2)),
        })),
        ambiguousHeader: ambiguous,
        metadataOnly: metadataSheet,
        dataStartRow: headerRow === null ? null : headerRow + 1,
        rawInspectionRows,
      },
      headerRow,
      selected: Boolean(best && !ambiguous && visibilityState === 'VISIBLE' && !metadataSheet),
      headerSignature: sha256(JSON.stringify(headers)),
      mapping: best?.mappings ?? [],
      rows: dataRows,
      warnings: [
        ...(ambiguous ? ['Multiple plausible header rows require owner selection.'] : []),
        ...(metadataSheet
          ? ['Output Metadata is provenance only and is not imported as rows.']
          : []),
        ...(visibilityState !== 'VISIBLE' ? ['Hidden worksheets are unselected by default.'] : []),
      ],
    });
  }
  if (!tables.some((table) => table.rows.length > 0))
    throw new DomainError('VALIDATION_ERROR', 'No usable XLSX data table was detected.', 400);
  return {
    adapterId,
    adapterVersion: IMPORT_ADAPTER_VERSION,
    confidence: adapterId === 'GENERIC_XLSX' ? 'MEDIUM' : 'HIGH',
    evidence:
      adapterId === 'WORKSPACE_TEMPLATE_XLSX'
        ? ['Dedicated Workspace import signature was found.']
        : adapterId === 'WORKSPACE_OUTPUT_XLSX'
          ? ['Hidden Output Metadata identifies a Workspace-generated workbook.']
          : ['A bounded XLSX table scan found candidate headers.'],
    warnings: [
      ...preflight.warnings,
      ...(adapterId === 'WORKSPACE_OUTPUT_XLSX'
        ? [
            'Workspace output workbooks are presentation exports, not lossless interchange authority.',
          ]
        : []),
    ],
    detection: {
      worksheetCount: workbook.worksheets.length,
      workspaceTemplateRecognitionReady: true,
      outputMetadataWorksheet: outputMetadata?.name ?? null,
      formulasEvaluated: false,
      externalLinksFetched: false,
    },
    tables,
  };
}

export class ImportAdapterRegistry {
  public async inspect(fileName: string, buffer: Buffer): Promise<ImportAdapterResult> {
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLocaleLowerCase('en');
    let result: ImportAdapterResult;
    if (extension === '.csv' || extension === '.tsv') result = csvAdapter(fileName, buffer);
    else if (extension === '.xlsx') result = await xlsxAdapter(buffer);
    else
      throw new DomainError(
        'VALIDATION_ERROR',
        'This source type is not supported for Smart Import.',
        400,
      );

    const rawPayloadBytes = Buffer.byteLength(
      JSON.stringify(
        result.tables.map((table) => ({
          detectedRegion: table.detectedRegion,
          rows: table.rows.map((row) => ({
            sourceRowNumber: row.sourceRowNumber,
            rawCells: row.rawCells,
          })),
        })),
      ),
      'utf8',
    );
    if (rawPayloadBytes > IMPORT_SOURCE_LIMITS.rawPayloadBytes)
      throw new DomainError(
        'VALIDATION_ERROR',
        'The parsed source exceeds the 50 MiB raw review-state limit.',
        400,
      );
    return {
      ...result,
      detection: { ...result.detection, rawPayloadBytes },
    };
  }
}
