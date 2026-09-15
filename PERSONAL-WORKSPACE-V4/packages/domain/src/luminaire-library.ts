export const luminaireLibraryLifecycleStatuses = ['ACTIVE', 'ARCHIVED'] as const;
export type LuminaireLibraryLifecycleStatus = (typeof luminaireLibraryLifecycleStatuses)[number];

export const luminaireLibraryAssetTypes = ['ProductImage', 'Datasheet', 'IES', 'LDT'] as const;
export type LuminaireLibraryAssetType = (typeof luminaireLibraryAssetTypes)[number];

export const luminaireLibraryDuplicateStrengths = ['Strong', 'Likely', 'Possible'] as const;
export type LuminaireLibraryDuplicateStrength = (typeof luminaireLibraryDuplicateStrengths)[number];

export const luminaireLibraryBindingStatuses = [
  'CURRENT',
  'UPDATE_AVAILABLE',
  'LIBRARY_VARIANT_ARCHIVED',
  'LIBRARY_PRODUCT_ARCHIVED',
] as const;
export type LuminaireLibraryBindingStatus = (typeof luminaireLibraryBindingStatuses)[number];

export interface LuminaireManufacturer {
  manufacturerId: string;
  name: string;
  normalizedName: string;
  status: LuminaireLibraryLifecycleStatus;
  rowVersion: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

export interface LuminaireLibraryProduct {
  productId: string;
  manufacturerId: string;
  name: string;
  productType: string;
  description: string;
  status: LuminaireLibraryLifecycleStatus;
  rowVersion: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

export interface LuminaireLibraryVariantDraft {
  variantLabel: string;
  orderingCode: string;
  wattage: string;
  lumens: string;
  lightColor: string;
  cri: string;
  beamAngle: string;
  ipRating: string;
  mounting: string;
  cutout: string;
  driver: string;
  control: string;
  emergency: string;
  dimensions: string;
  bodyColorFinish: string;
}

export const luminaireTechnicalPowerBases = ['W', 'W_PER_M'] as const;
export type LuminaireTechnicalPowerBasis = (typeof luminaireTechnicalPowerBases)[number];
export const luminaireTechnicalLumenBases = ['LM', 'LM_PER_M'] as const;
export type LuminaireTechnicalLumenBasis = (typeof luminaireTechnicalLumenBases)[number];

export interface LuminaireLibraryNormalizedTechnicalValues {
  normalizedOrderingCode: string;
  wattageValue: number | null;
  wattageBasis: LuminaireTechnicalPowerBasis | null;
  lumensValue: number | null;
  lumensBasis: LuminaireTechnicalLumenBasis | null;
  cctKelvin: number | null;
  criValue: number | null;
  beamDegrees: number | null;
  beamFacet: string;
  ipFacet: string;
  controlFacet: string;
}

export interface LuminaireLibraryVariant extends LuminaireLibraryVariantDraft {
  variantId: string;
  productId: string;
  status: LuminaireLibraryLifecycleStatus;
  rowVersion: number;
  latestPublishedVersionId: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

export interface LuminaireLibraryVersionSnapshot extends LuminaireLibraryVariantDraft {
  manufacturerId: string;
  manufacturerName: string;
  productId: string;
  productName: string;
  productType: string;
  technicalDescription: string;
  variantId: string;
  assetVersionIds: string[];
}

export interface LuminaireLibraryVersion {
  versionId: string;
  variantId: string;
  versionSequence: number;
  snapshot: LuminaireLibraryVersionSnapshot;
  contentHash: string;
  publishedById: string;
  publishedByName: string;
  publishedAt: string;
}

export interface LuminaireLibraryAsset {
  assetId: string;
  productId: string;
  variantId: string | null;
  assetType: LuminaireLibraryAssetType;
  label: string;
  status: LuminaireLibraryLifecycleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LuminaireLibraryAssetVersion {
  assetVersionId: string;
  assetId: string;
  versionSequence: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  locatorValue: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface ProjectLuminaireLibraryBinding {
  projectId: string;
  luminaireId: string;
  manufacturerId: string;
  productId: string;
  variantId: string;
  selectedVersionId: string;
  descriptionOverride: string | null;
  rowVersion: number;
  selectedById: string;
  selectedByName: string;
  selectedAt: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

export interface LuminaireLibraryFieldChange {
  field: keyof Omit<LuminaireLibraryVersionSnapshot, 'assetVersionIds'>;
  before: string;
  after: string;
}

export interface LuminaireLibraryAssetChange {
  assetType: LuminaireLibraryAssetType;
  beforeAssetVersionIds: string[];
  afterAssetVersionIds: string[];
}

export interface LuminaireLibraryVersionComparison {
  currentVersionId: string;
  targetVersionId: string;
  fieldChanges: LuminaireLibraryFieldChange[];
  assetChanges: LuminaireLibraryAssetChange[];
}

export function normalizeManufacturerName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function normalizeLuminaireOrderingCode(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en');
}

export function normalizeLuminaireFacet(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function finitePositive(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseLuminaireWattage(
  value: string,
): { value: number; basis: LuminaireTechnicalPowerBasis } | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(W(?:\s*\/\s*M)?)$/i);
  if (!match) return null;
  const numeric = finitePositive(match[1]!);
  if (numeric === null) return null;
  return {
    value: numeric,
    basis: /\/\s*M$/i.test(match[2]!) ? 'W_PER_M' : 'W',
  };
}

export function parseLuminaireLumens(
  value: string,
): { value: number; basis: LuminaireTechnicalLumenBasis } | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(LM(?:\s*\/\s*M)?)$/i);
  if (!match) return null;
  const numeric = finitePositive(match[1]!);
  if (numeric === null) return null;
  return {
    value: numeric,
    basis: /\/\s*M$/i.test(match[2]!) ? 'LM_PER_M' : 'LM',
  };
}

export function parseLuminaireCctKelvin(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d{3,5})\s*K$/i);
  if (!match) return null;
  const kelvin = Number(match[1]);
  return Number.isInteger(kelvin) && kelvin > 0 ? kelvin : null;
}

export function parseLuminaireCri(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(?:CRI\s*)?(\d{1,3}(?:\.\d+)?)$/i);
  if (!match) return null;
  const cri = Number(match[1]);
  return Number.isFinite(cri) && cri >= 0 && cri <= 100 ? cri : null;
}

export function parseLuminaireBeamDegrees(value: string): number | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:°|DEG(?:REES?)?)?$/i);
  if (!match) return null;
  const degrees = Number(match[1]);
  return Number.isFinite(degrees) && degrees > 0 && degrees <= 360 ? degrees : null;
}

export function normalizeLuminaireTechnicalValues(
  draft: LuminaireLibraryVariantDraft,
): LuminaireLibraryNormalizedTechnicalValues {
  const wattage = parseLuminaireWattage(draft.wattage);
  const lumens = parseLuminaireLumens(draft.lumens);
  const beamDegrees = parseLuminaireBeamDegrees(draft.beamAngle);
  return {
    normalizedOrderingCode: normalizeLuminaireOrderingCode(draft.orderingCode),
    wattageValue: wattage?.value ?? null,
    wattageBasis: wattage?.basis ?? null,
    lumensValue: lumens?.value ?? null,
    lumensBasis: lumens?.basis ?? null,
    cctKelvin: parseLuminaireCctKelvin(draft.lightColor),
    criValue: parseLuminaireCri(draft.cri),
    beamDegrees,
    beamFacet: beamDegrees === null ? normalizeLuminaireFacet(draft.beamAngle) : `${beamDegrees}°`,
    ipFacet: normalizeLuminaireFacet(draft.ipRating),
    controlFacet: normalizeLuminaireFacet(draft.control),
  };
}

export function deriveLuminaireEfficacy(wattageText: string, lumensText: string): number | null {
  const wattage = parseLuminaireWattage(wattageText);
  const lumens = parseLuminaireLumens(lumensText);
  if (!wattage || !lumens || wattage.value <= 0) return null;
  const compatible =
    (wattage.basis === 'W' && lumens.basis === 'LM') ||
    (wattage.basis === 'W_PER_M' && lumens.basis === 'LM_PER_M');
  return compatible ? lumens.value / wattage.value : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalLuminaireLibrarySnapshot(
  snapshot: LuminaireLibraryVersionSnapshot,
): string {
  return canonicalJson(snapshot);
}

export function compareLuminaireLibraryVersions(
  current: LuminaireLibraryVersion,
  target: LuminaireLibraryVersion,
  assetTypes: ReadonlyMap<string, LuminaireLibraryAssetType>,
): LuminaireLibraryVersionComparison {
  const fields = Object.keys(current.snapshot).filter(
    (field): field is keyof Omit<LuminaireLibraryVersionSnapshot, 'assetVersionIds'> =>
      field !== 'assetVersionIds',
  );
  const fieldChanges = fields.flatMap((field) => {
    const before = current.snapshot[field];
    const after = target.snapshot[field];
    return before === after ? [] : [{ field, before, after }];
  });
  const assetChanges = luminaireLibraryAssetTypes.flatMap((assetType) => {
    const beforeAssetVersionIds = current.snapshot.assetVersionIds
      .filter((id) => assetTypes.get(id) === assetType)
      .sort();
    const afterAssetVersionIds = target.snapshot.assetVersionIds
      .filter((id) => assetTypes.get(id) === assetType)
      .sort();
    return beforeAssetVersionIds.join('|') === afterAssetVersionIds.join('|')
      ? []
      : [{ assetType, beforeAssetVersionIds, afterAssetVersionIds }];
  });
  return {
    currentVersionId: current.versionId,
    targetVersionId: target.versionId,
    fieldChanges,
    assetChanges,
  };
}

export function effectiveProjectLuminaireDescription(
  snapshotDescription: string,
  descriptionOverride: string | null,
): string {
  return descriptionOverride ?? snapshotDescription;
}
