import { DomainError } from './errors';
import type { PdfPaperSize } from './personal';

// ===========================================================================
// P2-FND-03 — Versioned Output Template Contract and Resolver
// ===========================================================================
// This module establishes the canonical, durable-first-class contract for
// Schedule / BOQ output templates WITHOUT introducing any durable storage.
//
// It defines:
//   - stable Template ID identity (independent of display label)
//   - immutable Template Version identity
//   - output family / type (LuminaireSchedule, TechnicalBoq, PresentationSchedule,
//     DatasheetRegister)
//   - built-in vs custom classification
//   - active / inactive state
//   - ordered optional sections
//   - ordered columns / column groups
//   - a mandatory traceability core that cannot be disabled
//   - a deterministic, deep, field-aware resolver
//   - a fully-resolved, self-contained snapshot contract
//   - the presentation-only invariant (templates never own technical values)
//
// Durable registry tables, defaults/overrides persistence, and revision/output
// provenance persistence belong to P2-FND-04. This slice is contract/domain
// foundation only.

// ---------------------------------------------------------------------------
// Output family / type
// ---------------------------------------------------------------------------
export const outputFamilies = [
  'LuminaireSchedule',
  'TechnicalBoq',
  'PresentationSchedule',
  'DatasheetRegister',
] as const;
export type OutputFamily = (typeof outputFamilies)[number];

/** Schedule-type families (LuminaireSchedule and PresentationSchedule). */
export function isScheduleFamily(family: OutputFamily): boolean {
  return family === 'LuminaireSchedule' || family === 'PresentationSchedule';
}

/**
 * A template family is compatible with a requested family when they are the
 * same family, or both are schedule-type outputs. A BOQ template can never be
 * resolved for a Schedule request and vice versa.
 */
export function familiesCompatible(requested: OutputFamily, template: OutputFamily): boolean {
  if (requested === template) return true;
  return isScheduleFamily(requested) && isScheduleFamily(template);
}

// ---------------------------------------------------------------------------
// Classification and state
// ---------------------------------------------------------------------------
export const templateOrigins = ['builtin', 'custom'] as const;
export type TemplateOrigin = (typeof templateOrigins)[number];

export const templateStates = ['active', 'inactive'] as const;
export type TemplateState = (typeof templateStates)[number];

export const outputOrientations = ['Portrait', 'Landscape'] as const;
export type OutputOrientation = (typeof outputOrientations)[number];

export const outputRowDensities = ['Compact', 'Normal', 'Comfortable'] as const;
export type OutputRowDensity = (typeof outputRowDensities)[number];

// ---------------------------------------------------------------------------
// Mandatory traceability core
// ---------------------------------------------------------------------------
/**
 * Regardless of template, an issued output must retain these elements. They
 * cannot be disabled by optional section configuration. The resolver enforces
 * that every resolved output keeps them visible.
 */
export const mandatoryTraceabilitySectionIds = [
  'documentTitle',
  'projectCode',
  'revision',
  'issueDate',
  'pageTraceability',
] as const;
export type MandatoryTraceabilitySectionId = (typeof mandatoryTraceabilitySectionIds)[number];

// ---------------------------------------------------------------------------
// Canonical data value keys (presentation-only invariant)
// ---------------------------------------------------------------------------
/**
 * Canonical project / luminaire technical data. A template may select, format,
 * or display these fields (as column fieldKey REFERENCES), but it must never
 * OWN their values. Template configuration must not define these as owned
 * values.
 *
 * This set is the COMPLETE current canonical data surface derived from the
 * authoritative `canonicalLuminaireSnapshotSchema` / `canonicalProjectSnapshotSchema`
 * (contracts) and the `CanonicalLuminaireSnapshot` domain record — NOT a
 * hand-picked subset. A future canonical field added to the snapshot should be
 * mirrored here; see the drift regression in the domain/contract tests.
 */
export const canonicalDataValueKeys = [
  // Identity / project
  'id',
  'projectId',
  'projectCode',
  'projectName',
  'clientName',
  'projectType',
  'status',
  'updatedAt',
  // Luminaire identity
  'luminaireId',
  'tag',
  'category',
  'imagePath',
  // Product
  'description',
  'manufacturer',
  'model',
  'productType',
  'variantLabel',
  'orderingCode',
  'dimensions',
  'bodyColorFinish',
  // Photometric / technical
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'mounting',
  'cutout',
  'driver',
  'control',
  'emergency',
  // Project / installation
  'quantity',
  'unit',
  'location',
  'notes',
  'sourceName',
  // Documentation
  'datasheetPath',
  'attachmentReferences',
] as const;
export type CanonicalDataValueKey = (typeof canonicalDataValueKeys)[number];

/**
 * Backward-compatible alias retaining the pre-A2-03 export name. This subset
 * covers the technical owned-value fields; the comprehensive set is
 * `canonicalDataValueKeys`. Both are compared after deterministic normalization.
 */
export const canonicalTechnicalValueKeys: readonly string[] = [...canonicalDataValueKeys];

/**
 * Commercial pricing / currency field keys. A template is presentation-only and
 * must never own or reference commercial pricing values (the Technical BOQ is
 * strictly non-priced). These are rejected as column fieldKeys globally (no
 * family may present pricing) and as section config keys (no template may own a
 * pricing value). Literals follow the repository camelCase convention (see
 * `commercialValueMinor` / `commercialCurrency` on Project) and are compared
 * after deterministic normalization so `unit_price` / `Unit Price` cannot
 * bypass the rule.
 *
 * Includes `currency` / `commercialCurrency` (A2-03 closure): the locked product
 * decision excludes pricing/commercial data from Technical BOQ / template
 * ownership, and Currency is the unit of a commercial value, so it must never
 * become a template-owned value either.
 */
export const commercialPricingFieldKeys = [
  'currency',
  'commercialCurrency',
  'currencyCode',
  'unitPrice',
  'unitRate',
  'rate',
  'price',
  'subtotal',
  'vat',
  'tax',
  'total',
  'totalAmount',
  'amount',
  'cost',
  'commercialValue',
  'commercialValueMinor',
] as const;
export type CommercialPricingFieldKey = (typeof commercialPricingFieldKeys)[number];

/**
 * Deterministic normalization for forbidden-key comparison. Lowercases, trims,
 * and strips non-alphanumeric separators so formatting variants collapse onto
 * the same canonical key. No fuzzy matching.
 */
export function normalizeForbiddenKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// ---------------------------------------------------------------------------
// Structural definition types
// ---------------------------------------------------------------------------
export interface OutputColumnGroup {
  groupId: string;
  label: string;
  order: number;
}

export interface OutputColumnDefinition {
  /** Stable identity independent of the display label. */
  columnId: string;
  label: string;
  visible: boolean;
  order: number;
  width: number;
  /** References a canonical data field / presentation selector, never a value. */
  fieldKey: string;
  groupId: string | null;
}

export interface OutputSectionDefinition {
  sectionId: string;
  label: string;
  visible: boolean;
  order: number;
  /** Presentation-only configuration. Must never own technical values. */
  config: Record<string, unknown>;
  /** Mandatory traceability sections cannot be disabled. */
  mandatory: boolean;
}

export interface OutputTemplateDefinition {
  templateId: string;
  versionId: string;
  family: OutputFamily;
  origin: TemplateOrigin;
  state: TemplateState;
  displayName: string;
  sections: OutputSectionDefinition[];
  columnGroups: OutputColumnGroup[];
  columns: OutputColumnDefinition[];
  paperSize: PdfPaperSize;
  orientation: OutputOrientation;
  rowDensity: OutputRowDensity;
  /** Presentation-card density (Presentation Schedule). Null when not applicable. */
  productsPerPage: number | null;
  imageSettings: { visible: boolean; width: number };
  headerSettings: { visible: boolean };
  footerSettings: { visible: boolean };
  logoVisible: boolean;
  /** BOQ templates are strictly non-priced. */
  nonPriced: boolean;
  /** Bounded serializer matrix. Omitted on immutable historical definitions. */
  supportedFormats?: ('PDF' | 'XLSX')[] | undefined;
  /** Stable implementation identity for historically explainable new outputs. */
  rendererIdentity?: string | undefined;
  /** Version of the resolved page/layout contract, independent of Template Version. */
  layoutContractVersion?: string | undefined;
}

/**
 * The fully-resolved, immutable value suitable for future snapshotting. It is
 * structurally identical to a definition but every effective value is explicit
 * and self-contained — no inheritance, no "use current global setting later".
 */
export type ResolvedOutputTemplate = OutputTemplateDefinition;

// ---------------------------------------------------------------------------
// Override layers
// ---------------------------------------------------------------------------
export interface SectionOverride {
  sectionId: string;
  visible?: boolean | undefined;
  order?: number | undefined;
  label?: string | undefined;
  config?: Record<string, unknown> | undefined;
}

export interface ColumnOverride {
  columnId: string;
  visible?: boolean | undefined;
  order?: number | undefined;
  label?: string | undefined;
  width?: number | undefined;
}

export interface ColumnGroupOverride {
  groupId: string;
  label?: string | undefined;
  order?: number | undefined;
}

export interface OutputTemplateOverride {
  sections?: SectionOverride[] | undefined;
  columns?: ColumnOverride[] | undefined;
  columnGroups?: ColumnGroupOverride[] | undefined;
  paperSize?: PdfPaperSize | undefined;
  orientation?: OutputOrientation | undefined;
  rowDensity?: OutputRowDensity | undefined;
  productsPerPage?: number | undefined;
  imageSettings?: { visible?: boolean | undefined; width?: number | undefined } | undefined;
  headerSettings?: { visible?: boolean | undefined } | undefined;
  footerSettings?: { visible?: boolean | undefined } | undefined;
  logoVisible?: boolean | undefined;
}

export interface ResolveOutputTemplateInput {
  templateId: string;
  versionId?: string | undefined;
  requestedFamily: OutputFamily;
  /** TemplateVersion defaults -> global config -> project override -> generation override. */
  globalConfig?: OutputTemplateOverride | undefined;
  projectOverride?: OutputTemplateOverride | undefined;
  generationOverride?: OutputTemplateOverride | undefined;
  /**
   * Historical-resolution path. When true, an inactive template/version may be
   * resolved so already-issued outputs remain representable. Defaults to false
   * (new generation must fail closed on inactive templates).
   */
  allowInactive?: boolean | undefined;
  /**
   * Optional template registry. Defaults to the built-in registry. This is a
   * domain-level seam for tests and future custom templates; it is NOT durable
   * storage (P2-FND-04).
   */
  registry?: readonly OutputTemplateDefinition[] | undefined;
}

// ---------------------------------------------------------------------------
// Built-in definitions
// ---------------------------------------------------------------------------
const productIdentityGroup: OutputColumnGroup = {
  groupId: 'product-identity',
  label: 'Product Identity',
  order: 1,
};
const lightOutputGroup: OutputColumnGroup = {
  groupId: 'light-output',
  label: 'Light Output',
  order: 2,
};
const installationGroup: OutputColumnGroup = {
  groupId: 'installation',
  label: 'Installation',
  order: 3,
};
const projectGroup: OutputColumnGroup = {
  groupId: 'project',
  label: 'Project',
  order: 4,
};
const documentationGroup: OutputColumnGroup = {
  groupId: 'documentation',
  label: 'Documentation',
  order: 5,
};

const standardColumnGroups: OutputColumnGroup[] = [
  productIdentityGroup,
  lightOutputGroup,
  installationGroup,
  projectGroup,
  documentationGroup,
];

function col(
  columnId: string,
  label: string,
  fieldKey: string,
  groupId: string | null,
  order: number,
  width = 140,
  visible = true,
): OutputColumnDefinition {
  return { columnId, label, fieldKey, groupId, order, width, visible };
}

function section(
  sectionId: string,
  label: string,
  order: number,
  config: Record<string, unknown> = {},
  mandatory = false,
  visible = true,
): OutputSectionDefinition {
  return { sectionId, label, order, config, mandatory, visible };
}

const mandatoryCore: OutputSectionDefinition[] = [
  section('documentTitle', 'Document Title', 1, {}, true),
  section('projectCode', 'Project Code', 2, {}, true),
  section('revision', 'Revision', 3, {}, true),
  section('issueDate', 'Issue Date', 4, {}, true),
  section('pageTraceability', 'Page Traceability', 5, {}, true),
];

const optionalSections: OutputSectionDefinition[] = [
  section('notes', 'Notes', 6, { maxLength: 2_000 }),
  section('kpiSummary', 'KPI Summary', 7, { showTotals: true }),
  section('categorySummary', 'Category Percentage Summary', 8, { showPercentages: true }),
  section('warnings', 'Warnings', 9),
  section('quantitySummary', 'Quantity Summary', 10, { showTotals: true }),
  section('legend', 'Legend', 11),
  section('documentStatus', 'Document Status', 12),
  section('productImages', 'Product Images', 13),
  section('datasheetReferences', 'Datasheet References', 14),
  section('locations', 'Locations', 15),
  section('footer', 'Footer', 16),
];

const technicalModernColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('category', 'Category', 'category', 'product-identity', 2, 120),
  col('description', 'Description', 'description', 'product-identity', 3, 200),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 4, 140),
  col('model', 'Model', 'model', 'product-identity', 5, 140),
  col('image', 'Image', 'imagePath', 'product-identity', 6, 80),
  col('wattage', 'Wattage', 'wattage', 'light-output', 7, 90),
  col('lumens', 'Lumens', 'lumens', 'light-output', 8, 90),
  col('lightColor', 'Light Color', 'lightColor', 'light-output', 9, 100),
  col('cri', 'CRI', 'cri', 'light-output', 10, 70),
  col('beamAngle', 'Beam Angle', 'beamAngle', 'light-output', 11, 90),
  col('ipRating', 'IP Rating', 'ipRating', 'installation', 12, 80),
  col('mounting', 'Mounting', 'mounting', 'installation', 13, 120),
  col('cutout', 'Cutout', 'cutout', 'installation', 14, 100),
  col('driver', 'Driver', 'driver', 'installation', 15, 120),
  col('control', 'Control', 'control', 'installation', 16, 120),
  col('emergency', 'Emergency', 'emergency', 'installation', 17, 90),
  col('location', 'Location', 'location', 'project', 18, 140),
  col('unit', 'Unit', 'unit', 'project', 19, 60),
  col('quantity', 'Quantity', 'quantity', 'project', 20, 80),
  col('datasheet', 'Datasheet', 'datasheetPath', 'documentation', 21, 120),
  col('notes', 'Notes', 'notes', 'documentation', 22, 160),
  col('dimensions', 'Dimensions', 'dimensions', 'product-identity', 23, 120),
  col('bodyColorFinish', 'Body / Finish', 'bodyColorFinish', 'product-identity', 24, 120),
];

const consultantColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('description', 'Description', 'description', 'product-identity', 2, 200),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 3, 140),
  col('model', 'Model', 'model', 'product-identity', 4, 140),
  col('wattage', 'Wattage', 'wattage', 'light-output', 5, 90),
  col('lumens', 'Lumens', 'lumens', 'light-output', 6, 90),
  col('lightColor', 'Light Color', 'lightColor', 'light-output', 7, 100),
  col('cri', 'CRI', 'cri', 'light-output', 8, 70),
  col('beamAngle', 'Beam Angle', 'beamAngle', 'light-output', 9, 90),
  col('location', 'Location', 'location', 'project', 10, 140),
  col('quantity', 'Quantity', 'quantity', 'project', 11, 80),
  col('notes', 'Notes', 'notes', 'documentation', 12, 160),
];

const compactColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('description', 'Description', 'description', 'product-identity', 2, 200),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 3, 140),
  col('model', 'Model', 'model', 'product-identity', 4, 140),
  col('wattage', 'Wattage', 'wattage', 'light-output', 5, 90),
  col('lumens', 'Lumens', 'lumens', 'light-output', 6, 90),
  col('location', 'Location', 'location', 'project', 7, 140),
  col('quantity', 'Quantity', 'quantity', 'project', 8, 80),
];

const presentationColumns: OutputColumnDefinition[] = [
  col('image', 'Image', 'imagePath', 'product-identity', 1, 120),
  col('tag', 'Tag', 'tag', 'product-identity', 2, 90),
  col('description', 'Description', 'description', 'product-identity', 3, 220),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 4, 140),
  col('model', 'Model', 'model', 'product-identity', 5, 140),
  col('wattage', 'Wattage', 'wattage', 'light-output', 6, 90),
  col('lumens', 'Lumens', 'lumens', 'light-output', 7, 90),
  col('quantity', 'Quantity', 'quantity', 'project', 8, 80),
];

const presentationProfessionalColumns: OutputColumnDefinition[] = [
  ...presentationColumns.slice(0, -1),
  col('lightColor', 'Light Color', 'lightColor', 'light-output', 8, 100),
  col('beamAngle', 'Beam / Optic', 'beamAngle', 'light-output', 9, 100),
  col('location', 'Location', 'location', 'project', 10, 140),
  col('quantity', 'Quantity', 'quantity', 'project', 11, 80),
];

const boqColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('description', 'Description', 'description', 'product-identity', 2, 220),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 3, 140),
  col('model', 'Model', 'model', 'product-identity', 4, 140),
  col('location', 'Location', 'location', 'project', 5, 140),
  col('unit', 'Unit', 'unit', 'project', 6, 60),
  col('quantity', 'Quantity', 'quantity', 'project', 7, 80),
  col('notes', 'Notes', 'notes', 'documentation', 8, 160),
];

const technicalBoqColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('category', 'Category', 'category', 'product-identity', 2, 120),
  col('description', 'Description', 'description', 'product-identity', 3, 220),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 4, 140),
  col('model', 'Model', 'model', 'product-identity', 5, 140),
  col('unit', 'Unit', 'unit', 'project', 6, 60),
  col('quantity', 'Quantity', 'quantity', 'project', 7, 80),
  col('location', 'Location', 'location', 'project', 8, 140),
  col('notes', 'Notes', 'notes', 'documentation', 9, 160),
];

const datasheetRegisterColumns: OutputColumnDefinition[] = [
  col('tag', 'Tag', 'tag', 'product-identity', 1, 90),
  col('manufacturer', 'Manufacturer', 'manufacturer', 'product-identity', 2, 140),
  col('model', 'Model', 'model', 'product-identity', 3, 140),
  col('datasheetFile', 'Datasheet File', 'datasheetPath', 'documentation', 4, 220),
  col('assetVersion', 'Asset Version', 'assetVersion', 'documentation', 5, 90),
  col('integrity', 'Availability / Integrity', 'integrity', 'documentation', 6, 130),
  col('notes', 'Notes', 'notes', 'documentation', 7, 180),
];

const generationMetadataSection = section(
  'generationMetadata',
  'Generation Metadata',
  17,
  {
    rendererIdentity: 'scli.output-presentation',
    layoutContractVersion: 'p4d-v1',
  },
  false,
  false,
);

interface DefineTemplateInput {
  templateId: string;
  versionId: string;
  family: OutputFamily;
  displayName: string;
  sections: OutputSectionDefinition[];
  columnGroups: OutputColumnGroup[];
  columns: OutputColumnDefinition[];
  paperSize?: PdfPaperSize;
  orientation?: OutputOrientation;
  rowDensity?: OutputRowDensity;
  productsPerPage?: number | null;
  imageSettings?: { visible: boolean; width: number };
  headerSettings?: { visible: boolean };
  footerSettings?: { visible: boolean };
  logoVisible?: boolean;
  nonPriced?: boolean;
}

function defineTemplate(input: DefineTemplateInput): OutputTemplateDefinition {
  return {
    templateId: input.templateId,
    versionId: input.versionId,
    family: input.family,
    origin: 'builtin',
    state: 'active',
    displayName: input.displayName,
    sections: input.sections,
    columnGroups: input.columnGroups,
    columns: input.columns,
    paperSize: input.paperSize ?? 'A3',
    orientation: input.orientation ?? 'Landscape',
    rowDensity: input.rowDensity ?? 'Normal',
    productsPerPage: input.productsPerPage ?? null,
    imageSettings: input.imageSettings ?? { visible: true, width: 80 },
    headerSettings: input.headerSettings ?? { visible: true },
    footerSettings: input.footerSettings ?? { visible: true },
    logoVisible: input.logoVisible ?? true,
    nonPriced: input.nonPriced ?? false,
  };
}

/**
 * First canonical built-in TemplateVersion definitions. These are
 * foundation-level structural presets only — no final renderers.
 */
export const builtInTemplateVersions: readonly OutputTemplateDefinition[] = [
  defineTemplate({
    templateId: 'schedule.technical-modern',
    versionId: 'v1',
    family: 'LuminaireSchedule',
    displayName: 'Technical Modern',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: technicalModernColumns,
  }),
  defineTemplate({
    templateId: 'schedule.classic-grid-pro.full-technical',
    versionId: 'v1',
    family: 'LuminaireSchedule',
    displayName: 'Classic Grid Pro — Full Technical',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: technicalModernColumns,
  }),
  defineTemplate({
    templateId: 'schedule.classic-grid-pro.consultant',
    versionId: 'v1',
    family: 'LuminaireSchedule',
    displayName: 'Classic Grid Pro — Consultant',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: consultantColumns,
  }),
  defineTemplate({
    templateId: 'schedule.classic-grid-pro.compact',
    versionId: 'v1',
    family: 'LuminaireSchedule',
    displayName: 'Classic Grid Pro — Compact',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: compactColumns,
    rowDensity: 'Compact',
  }),
  defineTemplate({
    templateId: 'schedule.presentation',
    versionId: 'v1',
    family: 'PresentationSchedule',
    displayName: 'Presentation Schedule',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: presentationColumns,
    rowDensity: 'Comfortable',
    productsPerPage: 3,
  }),
  defineTemplate({
    templateId: 'boq.technical-modern',
    versionId: 'v1',
    family: 'TechnicalBoq',
    displayName: 'Technical BOQ — Modern',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: boqColumns,
    nonPriced: true,
  }),
  defineTemplate({
    templateId: 'boq.classic-grid-pro',
    versionId: 'v1',
    family: 'TechnicalBoq',
    displayName: 'Classic Grid Pro BOQ',
    sections: [...mandatoryCore, ...optionalSections],
    columnGroups: standardColumnGroups,
    columns: boqColumns,
    nonPriced: true,
  }),
];

/** Additive current registry definition; intentionally excluded from the immutable v4 migration. */
export const technicalBoqTemplateVersion: OutputTemplateDefinition = defineTemplate({
  templateId: 'boq.technical-approved',
  versionId: 'v1',
  family: 'TechnicalBoq',
  displayName: 'Technical BOQ — Approved',
  sections: [...mandatoryCore, ...optionalSections],
  columnGroups: standardColumnGroups,
  columns: technicalBoqColumns,
  nonPriced: true,
});

/** P4D professional versions are additive; immutable v1 definitions remain byte-for-byte stable. */
export const p4dProfessionalTemplateVersions: readonly OutputTemplateDefinition[] = [
  defineTemplate({
    templateId: 'schedule.technical-modern',
    versionId: 'v2',
    family: 'LuminaireSchedule',
    displayName: 'Technical Luminaire Schedule — Professional',
    sections: [...mandatoryCore, ...optionalSections, generationMetadataSection],
    columnGroups: standardColumnGroups,
    columns: technicalModernColumns,
    paperSize: 'A3',
    orientation: 'Landscape',
  }),
  defineTemplate({
    templateId: 'schedule.presentation',
    versionId: 'v2',
    family: 'PresentationSchedule',
    displayName: 'Presentation Luminaire Schedule — Professional',
    sections: [...mandatoryCore, ...optionalSections, generationMetadataSection],
    columnGroups: standardColumnGroups,
    columns: presentationProfessionalColumns,
    paperSize: 'A3',
    orientation: 'Landscape',
    rowDensity: 'Comfortable',
    productsPerPage: 3,
  }),
  defineTemplate({
    templateId: 'boq.technical-approved',
    versionId: 'v2',
    family: 'TechnicalBoq',
    displayName: 'Technical Lighting BOQ — Professional',
    sections: [...mandatoryCore, ...optionalSections, generationMetadataSection],
    columnGroups: standardColumnGroups,
    columns: technicalBoqColumns,
    paperSize: 'A3',
    orientation: 'Landscape',
    nonPriced: true,
  }),
  defineTemplate({
    templateId: 'datasheet.register',
    versionId: 'v1',
    family: 'DatasheetRegister',
    displayName: 'Datasheet Register — Professional',
    sections: [...mandatoryCore, ...optionalSections, generationMetadataSection],
    columnGroups: standardColumnGroups,
    columns: datasheetRegisterColumns,
    paperSize: 'A4',
    orientation: 'Landscape',
  }),
].map((definition) => ({
  ...definition,
  supportedFormats:
    definition.family === 'LuminaireSchedule' || definition.family === 'TechnicalBoq'
      ? ['PDF', 'XLSX']
      : ['PDF'],
  rendererIdentity: 'scli.output-presentation',
  layoutContractVersion: 'p4d-v1',
}));

export const currentBuiltInTemplateVersions: readonly OutputTemplateDefinition[] = [
  ...builtInTemplateVersions,
  technicalBoqTemplateVersion,
  ...p4dProfessionalTemplateVersions,
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------
export function findTemplateVersion(
  templateId: string,
  versionId?: string,
  registry: readonly OutputTemplateDefinition[] = currentBuiltInTemplateVersions,
): OutputTemplateDefinition | undefined {
  const versions = registry.filter((version) => version.templateId === templateId);
  if (versions.length === 0) return undefined;
  if (versionId !== undefined) {
    return versions.find((version) => version.versionId === versionId);
  }
  const active = versions.filter((version) => version.state === 'active');
  const pool = active.length > 0 ? active : versions;
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function assertUnique(ids: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new DomainError('VALIDATION_ERROR', `Duplicate ${kind} ID "${id}".`, 400);
    }
    seen.add(id);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deterministic, safe deep clone for the JSON-compatible template data model.
 *
 * Objects and arrays are copied recursively; primitives and null are retained.
 * The clone is fully detached from the input at every depth, so mutating the
 * clone (including nested objects / arrays and untouched siblings) never
 * mutates the source, and mutating the source never mutates the clone.
 *
 * The template data model is defined as JSON-compatible, so non-JSON values
 * (functions, symbols, `undefined`) fail closed rather than being silently
 * sanitized — consistent with the persisted-registry JSON contract.
 */
function deepCloneJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Template config values must be JSON-compatible; undefined is not permitted.',
        400,
      );
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Template config values must be JSON-compatible; functions and symbols are not permitted.',
        400,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneJson(item));
  }
  if (!isPlainObject(value)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Template config values must be JSON-compatible; unsupported object encountered.',
      400,
    );
  }
  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = deepCloneJson(nestedValue);
  }
  return result;
}

/** Typed deep clone for config maps, preserving the declared map shape. */
function deepCloneConfig(value: Record<string, unknown>): Record<string, unknown> {
  return deepCloneJson(value) as Record<string, unknown>;
}

function assertConfigValuePresentationOnly(
  sectionId: string,
  value: unknown,
  normalizedTechnicalKeys: ReadonlySet<string>,
  normalizedPricingKeys: ReadonlySet<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertConfigValuePresentationOnly(
        sectionId,
        item,
        normalizedTechnicalKeys,
        normalizedPricingKeys,
      );
    }
    return;
  }
  if (!isPlainObject(value)) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = normalizeForbiddenKey(key);
    if (normalizedTechnicalKeys.has(normalized)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Section "${sectionId}" config must not own technical value "${key}".`,
        400,
      );
    }
    if (normalizedPricingKeys.has(normalized)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Section "${sectionId}" config must not own commercial pricing value "${key}".`,
        400,
      );
    }
    assertConfigValuePresentationOnly(
      sectionId,
      nestedValue,
      normalizedTechnicalKeys,
      normalizedPricingKeys,
    );
  }
}

function assertPresentationOnly(definition: OutputTemplateDefinition): void {
  // Unified forbidden-key model (P2-FND-03-H1 / P2-FND-A2-03):
  //  - canonical technical/project value keys are forbidden as OWNED values
  //    (section config) but remain valid as column fieldKey REFERENCES
  //    (columns select/format canonical data).
  //  - commercial pricing / currency keys are forbidden EVERYWHERE: never a
  //    valid presentation field (Technical BOQ is strictly non-priced) and
  //    never an owned config value.
  const normalizedTechnicalKeys = new Set(canonicalDataValueKeys.map(normalizeForbiddenKey));
  const normalizedPricingKeys = new Set(commercialPricingFieldKeys.map(normalizeForbiddenKey));

  for (const column of definition.columns) {
    const normalized = normalizeForbiddenKey(column.fieldKey);
    if (normalizedPricingKeys.has(normalized)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Column "${column.columnId}" fieldKey "${column.fieldKey}" must not reference a commercial pricing value.`,
        400,
      );
    }
  }

  for (const section of definition.sections) {
    assertConfigValuePresentationOnly(
      section.sectionId,
      section.config,
      normalizedTechnicalKeys,
      normalizedPricingKeys,
    );
  }
}

/**
 * Validates a TemplateVersion definition. Enforces unique IDs, the mandatory
 * traceability core, valid group references, the BOQ non-priced invariant, and
 * the presentation-only invariant.
 */
export function validateTemplateVersion(definition: OutputTemplateDefinition): void {
  if (!definition.templateId.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'Template ID is required.', 400);
  }
  if (!definition.versionId.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'Template version ID is required.', 400);
  }
  assertUnique(
    definition.sections.map((item) => item.sectionId),
    'section',
  );
  assertUnique(
    definition.columns.map((item) => item.columnId),
    'column',
  );
  assertUnique(
    definition.columnGroups.map((item) => item.groupId),
    'column group',
  );
  for (const id of mandatoryTraceabilitySectionIds) {
    const found = definition.sections.find((item) => item.sectionId === id);
    if (!found) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Mandatory traceability section "${id}" is missing.`,
        400,
      );
    }
    if (!found.mandatory) {
      throw new DomainError('VALIDATION_ERROR', `Section "${id}" must be marked mandatory.`, 400);
    }
    if (!found.visible) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Mandatory traceability section "${id}" must be visible.`,
        400,
      );
    }
  }
  const groupIds = new Set(definition.columnGroups.map((group) => group.groupId));
  for (const column of definition.columns) {
    if (column.groupId !== null && !groupIds.has(column.groupId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Column "${column.columnId}" references unknown group "${column.groupId}".`,
        400,
      );
    }
  }
  if (definition.family === 'TechnicalBoq' && !definition.nonPriced) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `BOQ template "${definition.templateId}" must be non-priced.`,
      400,
    );
  }
  assertPresentationOnly(definition);
}

/** Validates every built-in TemplateVersion definition. */
export function validateBuiltInTemplates(): void {
  for (const definition of currentBuiltInTemplateVersions) {
    validateTemplateVersion(definition);
  }
}

// ---------------------------------------------------------------------------
// Deep, field-aware resolution
// ---------------------------------------------------------------------------
function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  // Deep-clone the base so untouched nested values are detached from their
  // source layer, then merge override values with a deep clone of each.
  const result: Record<string, unknown> = deepCloneConfig(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeConfig(existing, deepCloneConfig(value));
    } else {
      result[key] = deepCloneJson(value);
    }
  }
  return result;
}

function applySectionOverrides(
  base: readonly OutputSectionDefinition[],
  overrides: SectionOverride[] | undefined,
): OutputSectionDefinition[] {
  if (!overrides || overrides.length === 0) return base.map((item) => cloneSection(item));
  const seen = new Set<string>();
  const byId = new Map(base.map((item) => [item.sectionId, item]));
  const result = base.map((item) => cloneSection(item));
  for (const override of overrides) {
    if (seen.has(override.sectionId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate section override for "${override.sectionId}".`,
        400,
      );
    }
    seen.add(override.sectionId);
    const target = byId.get(override.sectionId);
    if (!target) {
      throw new DomainError('VALIDATION_ERROR', `Unknown section "${override.sectionId}".`, 400);
    }
    const index = result.findIndex((item) => item.sectionId === override.sectionId);
    const current = result[index];
    if (!current) continue;
    result[index] = {
      ...current,
      visible: override.visible ?? current.visible,
      order: override.order ?? current.order,
      label: override.label ?? current.label,
      config: override.config
        ? deepMergeConfig(current.config, deepCloneConfig(override.config))
        : current.config,
    };
  }
  return result.sort((a, b) => a.order - b.order);
}

/** Fully detached copy of a section (deep-clones its config). */
function cloneSection(item: OutputSectionDefinition): OutputSectionDefinition {
  return { ...item, config: deepCloneConfig(item.config) };
}

function applyColumnOverrides(
  base: readonly OutputColumnDefinition[],
  overrides: ColumnOverride[] | undefined,
): OutputColumnDefinition[] {
  if (!overrides || overrides.length === 0) return [...base];
  const seen = new Set<string>();
  const byId = new Map(base.map((item) => [item.columnId, item]));
  const result = base.map((item) => ({ ...item }));
  for (const override of overrides) {
    if (seen.has(override.columnId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate column override for "${override.columnId}".`,
        400,
      );
    }
    seen.add(override.columnId);
    const target = byId.get(override.columnId);
    if (!target) {
      throw new DomainError('VALIDATION_ERROR', `Unknown column "${override.columnId}".`, 400);
    }
    const index = result.findIndex((item) => item.columnId === override.columnId);
    const current = result[index];
    if (!current) continue;
    result[index] = {
      ...current,
      visible: override.visible ?? current.visible,
      order: override.order ?? current.order,
      label: override.label ?? current.label,
      width: override.width ?? current.width,
    };
  }
  return result.sort((a, b) => a.order - b.order);
}

function applyColumnGroupOverrides(
  base: readonly OutputColumnGroup[],
  overrides: ColumnGroupOverride[] | undefined,
): OutputColumnGroup[] {
  if (!overrides || overrides.length === 0) return [...base];
  const seen = new Set<string>();
  const byId = new Map(base.map((item) => [item.groupId, item]));
  const result = base.map((item) => ({ ...item }));
  for (const override of overrides) {
    if (seen.has(override.groupId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Duplicate column group override for "${override.groupId}".`,
        400,
      );
    }
    seen.add(override.groupId);
    const target = byId.get(override.groupId);
    if (!target) {
      throw new DomainError('VALIDATION_ERROR', `Unknown column group "${override.groupId}".`, 400);
    }
    const index = result.findIndex((item) => item.groupId === override.groupId);
    const current = result[index];
    if (!current) continue;
    result[index] = {
      ...current,
      label: override.label ?? current.label,
      order: override.order ?? current.order,
    };
  }
  return result.sort((a, b) => a.order - b.order);
}

function applyOverride(
  base: ResolvedOutputTemplate,
  override: OutputTemplateOverride,
): ResolvedOutputTemplate {
  return {
    ...base,
    sections: applySectionOverrides(base.sections, override.sections),
    columns: applyColumnOverrides(base.columns, override.columns),
    columnGroups: applyColumnGroupOverrides(base.columnGroups, override.columnGroups),
    paperSize: override.paperSize ?? base.paperSize,
    orientation: override.orientation ?? base.orientation,
    rowDensity: override.rowDensity ?? base.rowDensity,
    productsPerPage: override.productsPerPage ?? base.productsPerPage,
    imageSettings: {
      visible: override.imageSettings?.visible ?? base.imageSettings.visible,
      width: override.imageSettings?.width ?? base.imageSettings.width,
    },
    headerSettings: { visible: override.headerSettings?.visible ?? base.headerSettings.visible },
    footerSettings: { visible: override.footerSettings?.visible ?? base.footerSettings.visible },
    logoVisible: override.logoVisible ?? base.logoVisible,
  };
}

function enforceMandatoryTraceability(resolved: ResolvedOutputTemplate): void {
  for (const section of resolved.sections) {
    if (section.mandatory && !section.visible) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Mandatory traceability section "${section.sectionId}" cannot be disabled.`,
        400,
      );
    }
  }
  for (const id of mandatoryTraceabilitySectionIds) {
    if (!resolved.sections.some((item) => item.sectionId === id)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `Mandatory traceability section "${id}" is missing from the resolved output.`,
        400,
      );
    }
  }
}

/**
 * Resolves a TemplateVersion into a fully-resolved, self-contained snapshot.
 *
 * Precedence: TemplateVersion defaults -> global config -> project override ->
 * generation-time presentation override. Only presentation-safe fields may be
 * overridden; canonical project / luminaire technical data, revision identity,
 * project ownership, and output provenance identity are never overridable.
 *
 * Fails closed on: unknown template/version, incompatible output family,
 * inactive template for new generation (unless allowInactive), attempts to
 * disable mandatory traceability, duplicate/unknown override IDs, and malformed
 * configuration.
 */
export function resolveOutputTemplate(input: ResolveOutputTemplateInput): ResolvedOutputTemplate {
  const registry = input.registry ?? currentBuiltInTemplateVersions;
  const version = findTemplateVersion(input.templateId, input.versionId, registry);
  if (!version) {
    const suffix = input.versionId ? ` version "${input.versionId}"` : '';
    throw new DomainError(
      'VALIDATION_ERROR',
      `Unknown output template "${input.templateId}"${suffix}.`,
      400,
    );
  }
  if (!familiesCompatible(input.requestedFamily, version.family)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Output template "${version.templateId}" (${version.family}) is not compatible with requested family "${input.requestedFamily}".`,
      400,
    );
  }
  if (version.state === 'inactive' && !input.allowInactive) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Output template "${version.templateId}" version "${version.versionId}" is inactive and cannot be selected for new generation.`,
      400,
    );
  }
  validateTemplateVersion(version);

  let resolved: ResolvedOutputTemplate = {
    ...version,
    sections: version.sections.map((item) => cloneSection(item)),
    columnGroups: version.columnGroups.map((item) => ({ ...item })),
    columns: version.columns.map((item) => ({ ...item })),
  };
  if (input.globalConfig) resolved = applyOverride(resolved, input.globalConfig);
  if (input.projectOverride) resolved = applyOverride(resolved, input.projectOverride);
  if (input.generationOverride) resolved = applyOverride(resolved, input.generationOverride);
  enforceMandatoryTraceability(resolved);
  validateTemplateVersion(resolved);
  return resolved;
}
