export const importDestinationModes = ['PROJECT', 'MASTER_LIBRARY'] as const;
export type ImportDestinationMode = (typeof importDestinationModes)[number];

export const importSessionStatuses = [
  'INSPECTING',
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
  'BLOCKED',
  'COMPLETED',
  'ABANDONED',
  'FAILED',
] as const;
export type ImportSessionStatus = (typeof importSessionStatuses)[number];

export const importRowStatuses = [
  'READY',
  'NEEDS_REVIEW',
  'BLOCKED',
  'SKIPPED',
  'APPLIED',
  'FAILED',
] as const;
export type ImportRowStatus = (typeof importRowStatuses)[number];

export const importReconciliationStates = [
  'TAG_ABSENT',
  'TAG_INVALID',
  'TAG_NEW',
  'TAG_PROJECT_ONLY',
  'TAG_LIBRARY_LINKED',
  'TAG_AMBIGUOUS',
] as const;
export type ImportReconciliationState = (typeof importReconciliationStates)[number];

export const importProjectActions = [
  'PROJECT_CREATE_ONLY',
  'PROJECT_UPDATE_EXISTING',
  'PROJECT_ADD_FROM_LIBRARY',
  'SKIP',
] as const;
export type ImportProjectAction = (typeof importProjectActions)[number];

export const importLibraryActions = [
  'LIBRARY_CREATE_DRAFT',
  'LIBRARY_USE_EXISTING',
  'LIBRARY_REVIEW_EXISTING',
  'SKIP',
] as const;
export type ImportLibraryAction = (typeof importLibraryActions)[number];

export const importLibraryManufacturerStates = [
  'EXACT_ACTIVE',
  'EXACT_ARCHIVED',
  'MISSING_REQUIRES_DECISION',
  'PLANNED_CREATE',
] as const;
export type ImportLibraryManufacturerState = (typeof importLibraryManufacturerStates)[number];

export const importLibraryProductStates = [
  'EXACT_ACTIVE',
  'EXACT_ARCHIVED',
  'NEW',
  'AMBIGUOUS',
] as const;
export type ImportLibraryProductState = (typeof importLibraryProductStates)[number];

export const importLibraryVariantStates = [
  'ORDERING_CODE_AVAILABLE',
  'EXACT_ACTIVE',
  'EXACT_ARCHIVED',
  'EMPTY_ORDERING_CODE',
] as const;
export type ImportLibraryVariantState = (typeof importLibraryVariantStates)[number];

export const importLibraryMetadataStates = ['CONSISTENT', 'MISSING', 'CONFLICTING'] as const;
export type ImportLibraryMetadataState = (typeof importLibraryMetadataStates)[number];

export const importApplyAttemptStates = [
  'PENDING',
  'IN_PROGRESS',
  'SUCCEEDED',
  'PARTIALLY_APPLIED',
  'FAILED',
  'ABANDONED',
] as const;
export type ImportApplyAttemptState = (typeof importApplyAttemptStates)[number];

export const importValidationSeverities = ['BLOCKING', 'WARNING', 'INFO'] as const;
export type ImportValidationSeverity = (typeof importValidationSeverities)[number];

export const importValidationLayers = [
  'FILE',
  'TABLE',
  'MAPPING',
  'ROW',
  'RECONCILIATION',
  'APPLY',
] as const;
export type ImportValidationLayer = (typeof importValidationLayers)[number];

export const importMappingConfidences = ['HIGH', 'MEDIUM', 'UNMAPPED', 'CONFLICT'] as const;
export type ImportMappingConfidence = (typeof importMappingConfidences)[number];

export const importAdapterIds = [
  'WORKSPACE_TEMPLATE_XLSX',
  'DIALUX_NATIVE_CSV',
  'WORKSPACE_OUTPUT_XLSX',
  'GENERIC_XLSX',
  'GENERIC_CSV',
] as const;
export type ImportAdapterId = (typeof importAdapterIds)[number];

export const importCanonicalFields = [
  'MANUFACTURER',
  'PRODUCT_FAMILY',
  'PRODUCT_TYPE',
  'VARIANT_LABEL',
  'ORDERING_CODE',
  'DESCRIPTION',
  'WATTAGE',
  'LUMENS',
  'CCT',
  'CRI',
  'BEAM_OPTIC',
  'IP',
  'CONTROL',
  'MOUNTING',
  'CUTOUT',
  'DIMENSIONS',
  'BODY_COLOR_FINISH',
  'DRIVER',
  'EMERGENCY',
  'TAG',
  'PROJECT_CATEGORY',
  'LOCATION',
  'UNIT',
  'QUANTITY',
  'NOTES',
  'DESCRIPTION_OVERRIDE',
  'PRODUCT_IMAGE',
  'DATASHEET',
  'IES',
  'LDT',
] as const;
export type ImportCanonicalField = (typeof importCanonicalFields)[number];

export interface ImportValidationReason {
  code: string;
  severity: ImportValidationSeverity;
  layer: ImportValidationLayer;
  field: ImportCanonicalField | null;
  message: string;
}

export interface ImportColumnMapping {
  sourceColumnKey: string;
  sourceHeader: string;
  canonicalField: ImportCanonicalField | null;
  confidence: ImportMappingConfidence;
  unitHint: string | null;
  evidence: string[];
}

export interface ImportRawCell {
  sourceColumnKey: string;
  internalHeader: string | null;
  header: string;
  rawValue: string | number | boolean | null;
  formula: string | null;
  cachedValue: string | number | boolean | null;
}

export interface ImportNormalizationEvidence {
  canonicalField: ImportCanonicalField;
  sourceColumnKey: string;
  rawValue: string | number | boolean | null;
  normalizedValue: string | number | null;
  basis: string | null;
  unit: string | null;
  success: boolean;
  reason: string | null;
  normalizerVersion: '1';
}

export const IMPORT_ADAPTER_VERSION = '1' as const;
export const IMPORT_NORMALIZER_VERSION = '1' as const;
