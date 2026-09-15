import { createHash, randomUUID } from 'node:crypto';
import {
  DomainError,
  IMPORT_NORMALIZER_VERSION,
  normalizeLuminaireFacet,
  parseLuminaireBeamDegrees,
  parseLuminaireCctKelvin,
  parseLuminaireCri,
  parseLuminaireLumens,
  parseLuminaireWattage,
  type ImportColumnMapping,
  type ImportNormalizationEvidence,
  type ImportRawCell,
  type ImportValidationReason,
} from '@scli/domain';
import type { AppUser } from '@scli/domain';
import type {
  CreateImportSessionInput,
  ImportSessionRead,
  ImportSourceTableRead,
  UpdateImportTableInput,
} from '@scli/contracts';
import {
  ImportAdapterRegistry,
  nativeMappingSafetyIssues,
  suggestColumnMappings,
  type ParsedImportRow,
  type ParsedImportTable,
} from './ImportAdapterRegistry.js';
import {
  ImportSessionStore,
  type ImportInspectionPersistence,
  type ImportRowPersistence,
  type ImportTablePersistence,
} from './ImportSessionStore.js';
import { ImportSourceAdmission, type AdmittedImportSource } from './ImportSourceAdmission.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function sourceValue(cell: ImportRawCell): string | number | boolean | null {
  return cell.cachedValue ?? cell.rawValue;
}
function reason(
  code: string,
  severity: ImportValidationReason['severity'],
  layer: ImportValidationReason['layer'],
  field: ImportValidationReason['field'],
  message: string,
): ImportValidationReason {
  return { code, severity, layer, field, message };
}

function decimalText(value: string, decimalConvention: unknown): string {
  const trimmed = value.normalize('NFKC').trim();
  if (decimalConvention === 'COMMA' && /^\d+,\d+(?:\s|$)/.test(trimmed))
    return trimmed.replace(',', '.');
  return trimmed;
}

function normalizedEvidence(
  mapping: ImportColumnMapping,
  cell: ImportRawCell,
  decimalConvention: unknown,
): { evidence: ImportNormalizationEvidence; validation: ImportValidationReason[] } {
  const raw = sourceValue(cell);
  const text = raw === null ? '' : decimalText(String(raw), decimalConvention);
  const field = mapping.canonicalField!;
  const base = {
    canonicalField: field,
    sourceColumnKey: mapping.sourceColumnKey,
    rawValue: raw,
    normalizerVersion: IMPORT_NORMALIZER_VERSION,
  } as const;
  if (cell.formula && cell.cachedValue === null)
    return {
      evidence: {
        ...base,
        normalizedValue: null,
        basis: null,
        unit: null,
        success: false,
        reason: 'Formula has no safe cached value.',
      },
      validation: [
        reason(
          'FORMULA_RESULT_UNAVAILABLE',
          'BLOCKING',
          'ROW',
          field,
          'A mapped formula has no safe cached value; formulas are never calculated.',
        ),
      ],
    };
  if (text === '')
    return {
      evidence: {
        ...base,
        normalizedValue: null,
        basis: null,
        unit: mapping.unitHint,
        success: true,
        reason: null,
      },
      validation: [],
    };
  const withHint = (units: string[]) =>
    units.some((unit) => new RegExp(`${unit.replace('/', '\\/')}\\s*$`, 'i').test(text)) ||
    !mapping.unitHint
      ? text
      : `${text} ${mapping.unitHint}`;
  if (field === 'WATTAGE') {
    const candidate = withHint(['W', 'W/m']);
    const parsed = parseLuminaireWattage(candidate);
    if (parsed)
      return {
        evidence: {
          ...base,
          normalizedValue: parsed.value,
          basis: parsed.basis,
          unit: parsed.basis === 'W_PER_M' ? 'W/m' : 'W',
          success: true,
          reason: null,
        },
        validation: [],
      };
    if (/^\d+(?:\.\d+)?$/.test(text) && !mapping.unitHint)
      return {
        evidence: {
          ...base,
          normalizedValue: Number(text),
          basis: null,
          unit: null,
          success: true,
          reason: 'Numeric value retained with unresolved power basis.',
        },
        validation: [
          reason(
            'POWER_BASIS_UNRESOLVED',
            'WARNING',
            'ROW',
            field,
            'Wattage is numeric but no source unit proves W or W/m.',
          ),
        ],
      };
    return {
      evidence: {
        ...base,
        normalizedValue: null,
        basis: null,
        unit: mapping.unitHint,
        success: false,
        reason: 'Unsafe wattage or basis.',
      },
      validation: [
        reason(
          'WATTAGE_PARSE_UNSAFE',
          'BLOCKING',
          'ROW',
          field,
          'Wattage could not be normalized safely.',
        ),
      ],
    };
  }
  if (field === 'LUMENS') {
    const candidate = withHint(['lm', 'lm/m']);
    const parsed = parseLuminaireLumens(candidate);
    if (parsed)
      return {
        evidence: {
          ...base,
          normalizedValue: parsed.value,
          basis: parsed.basis,
          unit: parsed.basis === 'LM_PER_M' ? 'lm/m' : 'lm',
          success: true,
          reason: null,
        },
        validation: [],
      };
    if (/^\d+(?:\.\d+)?$/.test(text) && !mapping.unitHint)
      return {
        evidence: {
          ...base,
          normalizedValue: Number(text),
          basis: null,
          unit: null,
          success: true,
          reason: 'Numeric value retained with unresolved lumen basis.',
        },
        validation: [
          reason(
            'LUMEN_BASIS_UNRESOLVED',
            'WARNING',
            'ROW',
            field,
            'Lumens are numeric but no source unit proves lm or lm/m.',
          ),
        ],
      };
    return {
      evidence: {
        ...base,
        normalizedValue: null,
        basis: null,
        unit: mapping.unitHint,
        success: false,
        reason: 'Unsafe lumen value or basis.',
      },
      validation: [
        reason(
          'LUMENS_PARSE_UNSAFE',
          'BLOCKING',
          'ROW',
          field,
          'Lumens could not be normalized safely.',
        ),
      ],
    };
  }
  if (field === 'CCT') {
    const candidate = /K\s*$/i.test(text) ? text : `${text} K`;
    const parsed = parseLuminaireCctKelvin(candidate);
    return parsed === null
      ? {
          evidence: {
            ...base,
            normalizedValue: null,
            basis: null,
            unit: 'K',
            success: false,
            reason: 'Unsafe Kelvin value.',
          },
          validation: [
            reason(
              'CCT_PARSE_UNSAFE',
              'BLOCKING',
              'ROW',
              field,
              'CCT could not be normalized safely.',
            ),
          ],
        }
      : {
          evidence: {
            ...base,
            normalizedValue: parsed,
            basis: null,
            unit: 'K',
            success: true,
            reason: null,
          },
          validation: [],
        };
  }
  if (field === 'CRI') {
    const parsed = parseLuminaireCri(text);
    return parsed === null
      ? {
          evidence: {
            ...base,
            normalizedValue: null,
            basis: null,
            unit: null,
            success: false,
            reason: 'Unsafe CRI value.',
          },
          validation: [
            reason('CRI_PARSE_UNSAFE', 'BLOCKING', 'ROW', field, 'CRI must be between 0 and 100.'),
          ],
        }
      : {
          evidence: {
            ...base,
            normalizedValue: parsed,
            basis: null,
            unit: null,
            success: true,
            reason: null,
          },
          validation: [],
        };
  }
  if (field === 'BEAM_OPTIC') {
    const degrees = parseLuminaireBeamDegrees(text);
    const categorical = normalizeLuminaireFacet(text);
    return {
      evidence: {
        ...base,
        normalizedValue: degrees ?? categorical,
        basis: degrees === null ? 'CATEGORICAL' : 'DEGREES',
        unit: degrees === null ? null : '°',
        success: categorical !== '',
        reason: categorical === '' ? 'Empty beam/optic.' : null,
      },
      validation: [],
    };
  }
  if (field === 'IP' || field === 'CONTROL' || field === 'MOUNTING') {
    return {
      evidence: {
        ...base,
        normalizedValue: normalizeLuminaireFacet(text),
        basis: null,
        unit: null,
        success: true,
        reason: null,
      },
      validation: [],
    };
  }
  if (field === 'QUANTITY') {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0)
      return {
        evidence: {
          ...base,
          normalizedValue: null,
          basis: null,
          unit: null,
          success: false,
          reason: 'Unsafe quantity.',
        },
        validation: [
          reason(
            'QUANTITY_PARSE_UNSAFE',
            'BLOCKING',
            'ROW',
            field,
            'Quantity must be a non-negative number.',
          ),
        ],
      };
    return {
      evidence: {
        ...base,
        normalizedValue: parsed,
        basis: null,
        unit: mapping.unitHint,
        success: true,
        reason: null,
      },
      validation: [],
    };
  }
  return {
    evidence: {
      ...base,
      normalizedValue: text.trim(),
      basis: null,
      unit: mapping.unitHint,
      success: true,
      reason: null,
    },
    validation: [],
  };
}

function inspectRow(
  row: ParsedImportRow,
  mapping: ImportColumnMapping[],
  destinationMode: ImportSessionRead['destinationMode'],
  decimalConvention: unknown,
): ImportRowPersistence {
  const mappedCandidate: Record<string, unknown> = {};
  const evidence: ImportNormalizationEvidence[] = [];
  const reasons: ImportValidationReason[] = [];
  const cells = new Map(row.rawCells.map((cell) => [cell.sourceColumnKey, cell]));
  for (const item of mapping) {
    const cell = cells.get(item.sourceColumnKey);
    if (!cell || !item.canonicalField) continue;
    const normalized = normalizedEvidence(item, cell, decimalConvention);
    evidence.push(normalized.evidence);
    reasons.push(...normalized.validation);
    mappedCandidate[item.canonicalField] = {
      sourceColumnKey: item.sourceColumnKey,
      rawValue: sourceValue(cell),
      normalizedValue: normalized.evidence.normalizedValue,
      basis: normalized.evidence.basis,
      unit: normalized.evidence.unit,
      confidence: item.confidence,
    };
    if (item.confidence === 'CONFLICT')
      reasons.push(
        reason(
          'MAPPING_CONFLICT',
          'WARNING',
          'MAPPING',
          item.canonicalField,
          `Multiple columns compete for ${item.canonicalField}.`,
        ),
      );
    if (item.confidence === 'MEDIUM')
      reasons.push(
        reason(
          'MAPPING_REVIEW_REQUIRED',
          'WARNING',
          'MAPPING',
          item.canonicalField,
          `${item.sourceHeader} needs mapping review.`,
        ),
      );
  }
  const nonEmptyUnmapped = mapping
    .filter((item) => item.confidence === 'UNMAPPED')
    .some((item) => {
      const value = sourceValue(
        cells.get(item.sourceColumnKey) ?? ({ rawValue: null, cachedValue: null } as ImportRawCell),
      );
      return value !== null && String(value).trim() !== '';
    });
  if (nonEmptyUnmapped)
    reasons.push(
      reason(
        'UNMAPPED_SOURCE_DATA',
        'INFO',
        'MAPPING',
        null,
        'Unmapped source values are retained as raw evidence.',
      ),
    );
  const required = destinationMode === 'PROJECT' ? ['TAG'] : ['MANUFACTURER', 'PRODUCT_FAMILY'];
  for (const field of required)
    if (!mappedCandidate[field])
      reasons.push(
        reason(
          'DESTINATION_IDENTITY_MISSING',
          'WARNING',
          'MAPPING',
          field as ImportValidationReason['field'],
          `${field.replaceAll('_', ' ')} is not mapped for this destination.`,
        ),
      );
  if (destinationMode === 'MASTER_LIBRARY')
    for (const field of [
      'TAG',
      'QUANTITY',
      'UNIT',
      'LOCATION',
      'PROJECT_CATEGORY',
      'NOTES',
      'DESCRIPTION_OVERRIDE',
    ]) {
      if (mappedCandidate[field])
        reasons.push(
          reason(
            'PROJECT_ONLY_FIELD',
            'INFO',
            'MAPPING',
            field as ImportValidationReason['field'],
            `${field.replaceAll('_', ' ')} is Project-only and is excluded from Library Apply.`,
          ),
        );
    }
  const rowStatus = reasons.some((item) => item.severity === 'BLOCKING')
    ? 'BLOCKED'
    : reasons.some((item) => item.severity === 'WARNING')
      ? 'NEEDS_REVIEW'
      : 'READY';
  const sourceRowFingerprint = fingerprint(row.rawCells);
  const sourceRowKey = `${row.sourceRowNumber}:${sourceRowFingerprint.slice(0, 16)}`;
  return {
    importRowId: randomUUID(),
    sourceRowNumber: row.sourceRowNumber,
    sourceRowKey,
    sourceRowFingerprint,
    rawCells: row.rawCells,
    mappedCandidate,
    normalizationEvidence: evidence,
    validationReasons: reasons,
    rowStatus,
  };
}

function tablePersistence(
  table: ParsedImportTable,
  destinationMode: ImportSessionRead['destinationMode'],
  decimalConvention: unknown,
  existingRows?: Array<{
    importRowId: string;
    sourceRowNumber: number;
    rawCells: Array<Record<string, unknown>>;
  }>,
): ImportTablePersistence {
  const mappingFingerprint = fingerprint(table.mapping);
  const rows = (existingRows ?? table.rows).map((row) => {
    const parsed: ParsedImportRow = {
      sourceRowNumber: row.sourceRowNumber,
      rawCells: row.rawCells as unknown as ImportRawCell[],
    };
    const inspected = inspectRow(parsed, table.mapping, destinationMode, decimalConvention);
    return existingRows
      ? {
          ...inspected,
          importRowId: 'importRowId' in row ? row.importRowId : inspected.importRowId,
        }
      : inspected;
  });
  return {
    sourceTableId: randomUUID(),
    tableKey: table.tableKey,
    tableName: table.tableName,
    sourceOrdinal: table.sourceOrdinal,
    visibilityState: table.visibilityState,
    detectedRegion: { ...table.detectedRegion, warnings: table.warnings },
    headerRow: table.headerRow,
    selected: table.selected,
    headerSignature: table.headerSignature,
    mapping: table.mapping,
    mappingFingerprint,
    rows,
  };
}

interface StoredInspectionCell {
  rawValue: string | number | boolean | null;
  formula: string | null;
  cachedValue: string | number | boolean | null;
}

function rowsForPersistedHeader(table: ImportSourceTableRead): ParsedImportRow[] | null {
  const value = table.detectedRegion.rawInspectionRows;
  if (!Array.isArray(value) || table.headerRow === null) return null;
  const grid = value as Array<{ rowNumber?: unknown; cells?: unknown }>;
  const header = grid.find((row) => Number(row.rowNumber) === table.headerRow);
  if (!header || !Array.isArray(header.cells)) return null;
  const headers = (header.cells as StoredInspectionCell[]).map((cell, index) => {
    const raw = cell.cachedValue ?? cell.rawValue;
    return raw === null || String(raw).trim() === '' ? `Column ${index + 1}` : String(raw).trim();
  });
  return grid
    .filter((row) => Number(row.rowNumber) > table.headerRow! && Array.isArray(row.cells))
    .map((row) => ({
      sourceRowNumber: Number(row.rowNumber),
      rawCells: (row.cells as StoredInspectionCell[]).map((cell, index) => ({
        sourceColumnKey: `COL_${index + 1}`,
        internalHeader: null,
        header: headers[index] ?? `Column ${index + 1}`,
        rawValue: cell.rawValue,
        formula: cell.formula,
        cachedValue: cell.cachedValue,
      })),
    }))
    .filter((row) => row.rawCells.some((cell) => (cell.cachedValue ?? cell.rawValue) !== null));
}

export class ImportInspectionService {
  public constructor(
    private readonly store: ImportSessionStore,
    private readonly admission: ImportSourceAdmission,
    private readonly adapters = new ImportAdapterRegistry(),
  ) {}
  public create(input: CreateImportSessionInput, actor: AppUser): ImportSessionRead {
    return this.store.create(input, actor);
  }
  public async inspectBuffer(
    id: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<ImportSessionRead> {
    return this.inspect(id, this.admission.stageBuffer(id, fileName, buffer));
  }
  public async inspectDesktopSelection(id: string): Promise<ImportSessionRead> {
    return this.inspect(id, this.admission.admitDesktopSelection(id));
  }
  private async inspect(id: string, source: AdmittedImportSource): Promise<ImportSessionRead> {
    try {
      const session = this.store.get(id);
      if (session.sourceSha256)
        throw new DomainError(
          'CONFLICT',
          'This Import Session already has an admitted source.',
          409,
        );
      const parsed = await this.adapters.inspect(source.displayFileName, source.buffer);
      const decimalConvention = parsed.detection.decimalConvention;
      const tables = parsed.tables.map((table) =>
        tablePersistence(table, session.destinationMode, decimalConvention),
      );
      const selected = tables.filter((table) => table.selected);
      const selectedRows = selected.flatMap((table) => table.rows);
      const blockedByTable = selected.length === 0;
      const blocked = selectedRows.filter((row) => row.rowStatus === 'BLOCKED').length;
      const review = selectedRows.filter((row) => row.rowStatus === 'NEEDS_REVIEW').length;
      const status =
        blockedByTable || (selectedRows.length > 0 && blocked === selectedRows.length)
          ? 'BLOCKED'
          : blocked > 0 || review > 0
            ? 'NEEDS_REVIEW'
            : 'READY_FOR_REVIEW';
      const destinationFingerprint = fingerprint({
        destinationMode: session.destinationMode,
        projectId: session.projectId,
      });
      const previewFingerprint = fingerprint({
        sourceSha256: source.sha256,
        selectedTables: selected.map((table) => table.tableKey),
        mappings: selected.map((table) => table.mappingFingerprint),
        normalization: IMPORT_NORMALIZER_VERSION,
        destinationMode: session.destinationMode,
        projectId: session.projectId,
        sessionRevision: session.sessionRevision + 1,
      });
      const persistence: ImportInspectionPersistence = {
        sourceFileName: source.displayFileName,
        sourceSha256: source.sha256,
        sourceSizeBytes: source.sizeBytes,
        sourceExtension: source.extension,
        detectedAdapterId: parsed.adapterId,
        detectedAdapterVersion: parsed.adapterVersion,
        detection: {
          ...parsed.detection,
          confidence: parsed.confidence,
          evidence: parsed.evidence,
          warnings: parsed.warnings,
          sourceBytesRetained: false,
        },
        destinationFingerprint,
        previewFingerprint,
        status,
        tables,
      };
      const result = this.store.persistInspection(id, persistence);
      this.admission.removeStagedSource(source);
      return result;
    } catch (error) {
      try {
        this.admission.removeStagedSource(source);
      } catch {
        /* scoped cleanup failure remains recoverable by orphan reconciliation */
      }
      throw error;
    }
  }
  public updateTable(id: string, tableId: string, input: UpdateImportTableInput) {
    const session = this.store.get(id);
    const current = this.store.tables(id).find((table) => table.sourceTableId === tableId);
    if (!current) throw new DomainError('NOT_FOUND', 'Import source table not found.', 404);
    let nextInput = input;
    let nextHeaderSignature: string | undefined;
    if (input.headerRow !== undefined && input.headerRow !== current.headerRow) {
      const rawRows = current.detectedRegion.rawInspectionRows;
      const header = Array.isArray(rawRows)
        ? (rawRows as Array<{ rowNumber?: unknown; cells?: unknown }>).find(
            (row) => Number(row.rowNumber) === input.headerRow,
          )
        : undefined;
      if (!header || !Array.isArray(header.cells))
        throw new DomainError('VALIDATION_ERROR', 'The selected header row is unavailable.', 400);
      const headers = (header.cells as StoredInspectionCell[]).map((cell, index) => {
        const value = cell.cachedValue ?? cell.rawValue;
        return value === null || String(value).trim() === ''
          ? `Column ${index + 1}`
          : String(value).trim();
      });
      nextInput = { ...input, mapping: suggestColumnMappings(headers) };
      nextHeaderSignature = fingerprint(headers);
    }
    const mapping = nextInput.mapping ?? current.mapping;
    const nativeIssues = nativeMappingSafetyIssues(session.detectedAdapterId, mapping);
    if (nativeIssues.length > 0) {
      const issue = nativeIssues[0]!;
      throw new DomainError(
        'VALIDATION_ERROR',
        `Native mapping conflict [${issue.reasonCode}] for ${issue.sourceHeader || issue.sourceColumnKey}: ${issue.humanReason} Next: ${issue.requiredNextStep}`,
        409,
        {
          reasonCode: 'IMPORT_NATIVE_MAPPING_CONFLICT',
          adapterId: session.detectedAdapterId,
          issues: nativeIssues,
          requiredNextStep: issue.requiredNextStep,
        },
      );
    }
    return this.store.updateTable(
      id,
      tableId,
      nextInput,
      fingerprint(mapping),
      nextHeaderSignature,
    );
  }
  public reinspect(id: string, expectedSessionRevision: number): ImportSessionRead {
    const session = this.store.get(id);
    if (session.sessionRevision !== expectedSessionRevision)
      throw new DomainError(
        'CONFLICT',
        'Import Session changed. Refresh before reinspecting.',
        409,
        { latestSessionRevision: session.sessionRevision },
      );
    const decimalConvention = session.detection.decimalConvention;
    const tables = this.store.tables(id).map((table) => {
      const parsed: ParsedImportTable = {
        tableKey: table.tableKey,
        tableName: table.tableName,
        sourceOrdinal: table.sourceOrdinal,
        visibilityState: table.visibilityState,
        detectedRegion: table.detectedRegion,
        headerRow: table.headerRow,
        selected: table.selected,
        headerSignature: table.headerSignature,
        mapping: table.mapping,
        rows: [],
        warnings: [],
      };
      const rebuiltRows = rowsForPersistedHeader(table);
      const existingRows = this.store.allRowsForTable(id, table.sourceTableId);
      const persisted = tablePersistence(
        { ...parsed, rows: rebuiltRows ?? [] },
        session.destinationMode,
        decimalConvention,
        rebuiltRows === null ? existingRows : undefined,
      );
      return {
        ...persisted,
        sourceTableId: table.sourceTableId,
        rows: persisted.rows.map((row) => ({
          ...row,
          importRowId:
            existingRows.find((existing) => existing.sourceRowNumber === row.sourceRowNumber)
              ?.importRowId ?? row.importRowId,
        })),
      };
    });
    const selectedRows = tables.filter((table) => table.selected).flatMap((table) => table.rows);
    const blocked = selectedRows.filter((row) => row.rowStatus === 'BLOCKED').length;
    const review = selectedRows.filter((row) => row.rowStatus === 'NEEDS_REVIEW').length;
    const status =
      tables.every((table) => !table.selected) ||
      (selectedRows.length > 0 && blocked === selectedRows.length)
        ? 'BLOCKED'
        : blocked > 0 || review > 0
          ? 'NEEDS_REVIEW'
          : 'READY_FOR_REVIEW';
    const previewFingerprint = fingerprint({
      sourceSha256: session.sourceSha256,
      selectedTables: tables.filter((table) => table.selected).map((table) => table.tableKey),
      mappings: tables.filter((table) => table.selected).map((table) => table.mappingFingerprint),
      normalization: IMPORT_NORMALIZER_VERSION,
      destinationMode: session.destinationMode,
      projectId: session.projectId,
      sessionRevision: session.sessionRevision + 1,
    });
    return this.store.replaceReviewRows(id, tables, previewFingerprint, status);
  }
}
