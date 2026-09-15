import type { CanonicalLuminaireSnapshot } from './output-registry';
import type {
  OutputColumnDefinition,
  OutputFamily,
  OutputRowDensity,
  ResolvedOutputTemplate,
} from './output-templates';

export const outputValidationLevels = ['BLOCKING_ERROR', 'WARNING', 'INFO'] as const;
export type OutputValidationLevel = (typeof outputValidationLevels)[number];

export interface ResolvedOutputMessage {
  code: string;
  level: OutputValidationLevel;
  message: string;
  luminaireId?: string | undefined;
}

export interface ResolvedOutputAsset {
  assetVersionId: string | null;
  versionSequence: number | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  fileHash: string | null;
  status: 'VERIFIED' | 'MISSING' | 'UNAVAILABLE' | 'MISMATCH';
  /** Preview-safe representation. Never a filesystem locator. */
  dataUrl: string | null;
}

export interface ResolvedOutputProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
}

export interface ResolvedOutputRevision {
  revisionId: string | null;
  revisionLabel: string;
  revisionSequence: number | null;
  lifecycleState: string | null;
  draftPreview: boolean;
}

export interface ResolvedOutputBranding {
  companyName: string;
  designerName: string;
  logoDataUrl: string | null;
  timeZone: string;
}

export interface ResolvedTechnicalScheduleRow extends CanonicalLuminaireSnapshot {
  image: ResolvedOutputAsset;
  datasheet: ResolvedOutputAsset;
}

export interface ResolvedBoqGroup {
  category: string;
  rows: CanonicalLuminaireSnapshot[];
  totalsByUnit: Record<string, number>;
}

export interface ResolvedDatasheetRegisterRow {
  luminaireId: string;
  tag: string;
  manufacturer: string;
  model: string;
  notes: string;
  datasheet: ResolvedOutputAsset;
}

export interface ResolvedTechnicalScheduleLayoutColumn {
  columnId: string;
  label: string;
  fieldKey: string;
  width: number;
}

export interface ResolvedTechnicalScheduleLayoutGroup {
  groupId: string;
  label: string;
  order: number;
  columns: ResolvedTechnicalScheduleLayoutColumn[];
}

/**
 * Serializer-neutral Technical Schedule layout resolved once from the immutable
 * Template snapshot. Preview, PDF, and XLSX consume this exact model.
 */
export interface ResolvedTechnicalScheduleLayout {
  identityColumns: ResolvedTechnicalScheduleLayoutColumn[];
  groups: ResolvedTechnicalScheduleLayoutGroup[];
  rowDensity: OutputRowDensity;
  showImage: boolean;
  imageWidth: number;
}

function layoutColumn(column: OutputColumnDefinition): ResolvedTechnicalScheduleLayoutColumn {
  return {
    columnId: column.columnId,
    label: column.label,
    fieldKey: column.fieldKey,
    width: column.width,
  };
}

const identityFieldKeys = new Set(['tag', 'category', 'imagePath']);

export function resolveTechnicalScheduleLayout(
  template: ResolvedOutputTemplate,
): ResolvedTechnicalScheduleLayout {
  const columns = template.columns
    .filter((column) => column.visible)
    .sort((a, b) => a.order - b.order);
  const groups = template.columnGroups
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      groupId: group.groupId,
      label:
        group.groupId === 'product-identity'
          ? 'Product'
          : group.groupId === 'project'
            ? 'Application'
            : group.label,
      order: group.order,
      columns: columns
        .filter(
          (column) => column.groupId === group.groupId && !identityFieldKeys.has(column.fieldKey),
        )
        .map(layoutColumn),
    }))
    .filter((group) => group.columns.length > 0);
  return {
    identityColumns: columns
      .filter((column) => identityFieldKeys.has(column.fieldKey))
      .map(layoutColumn),
    groups,
    rowDensity: template.rowDensity,
    showImage:
      template.imageSettings.visible && columns.some((column) => column.fieldKey === 'imagePath'),
    imageWidth: template.imageSettings.width,
  };
}

export function technicalScheduleCellValue(
  row: ResolvedTechnicalScheduleRow,
  fieldKey: string,
): string | number {
  if (fieldKey === 'imagePath') return row.image.fileName ?? row.image.status;
  if (fieldKey === 'datasheetPath') return row.datasheet.fileName ?? row.datasheet.status;
  const value = row[fieldKey as keyof CanonicalLuminaireSnapshot];
  if (typeof value === 'string')
    return fieldKey === 'cri' ? value.replace(/^CRI\s*/i, '').trim() : value;
  if (typeof value === 'number') return value;
  return '';
}

export type ResolvedOutputPage =
  | {
      kind: 'LuminaireSchedule';
      pageNumber: number;
      layout: ResolvedTechnicalScheduleLayout;
      rows: ResolvedTechnicalScheduleRow[];
    }
  | {
      kind: 'PresentationSchedule';
      pageNumber: number;
      products: ResolvedTechnicalScheduleRow[];
    }
  | {
      kind: 'TechnicalBoq';
      pageNumber: number;
      groups: ResolvedBoqGroup[];
    }
  | {
      kind: 'DatasheetRegister';
      pageNumber: number;
      rows: ResolvedDatasheetRegisterRow[];
    };

export interface ResolvedOutputEnvelope {
  outputKind: OutputFamily;
  format: 'PDF' | 'XLSX';
  project: ResolvedOutputProject;
  revision: ResolvedOutputRevision;
  template: ResolvedOutputTemplate;
  branding: ResolvedOutputBranding;
  issueDate: string;
  issueStatus: string;
  sourceFingerprint: string;
  templateSnapshotHash: string;
  rendererIdentity: string;
  rendererVersion: string;
  layoutContractVersion: string;
  pageSize: 'A4' | 'A3';
  orientation: 'Portrait' | 'Landscape';
  productsPerPage: 2 | 3 | 4 | null;
  messages: ResolvedOutputMessage[];
  pages: ResolvedOutputPage[];
  rowCount: number;
  unitTotals: Record<string, number>;
}
