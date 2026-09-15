import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  importLibraryReconciliationSchema,
  importLibraryRowActionSchema,
  importRowActionSchema,
  type BulkUpdateImportRowActionsInput,
  type ImportLibraryEntityCandidate,
  type ImportLibraryGroupDecisionInput,
  type ImportLibraryReconciliation,
  type ImportLibraryRowAction,
  type ReconcileImportSessionInput,
  type UpdateImportRowActionInput,
} from '@scli/contracts';
import {
  DomainError,
  compareTechnicalValue,
  normalizeLuminaireOrderingCode,
  normalizeManufacturerName,
  type ImportCanonicalField,
} from '@scli/domain';
import { importAuthorityFingerprint } from './ImportReconciliationService.js';
import { ImportSessionStore } from './ImportSessionStore.js';
import type {
  LibraryDraftCatalogueAuthority,
  LibraryVariantAuthority,
  LuminaireLibraryDraftWritePort,
} from './LuminaireLibraryDraftWritePort.js';

type Row = Readonly<Record<string, unknown>>;
interface Evidence {
  value: string | number;
  basis: string | null;
  unit: string | null;
}

const EXCLUDED_PROJECT_FIELDS = [
  'TAG',
  'PROJECT_CATEGORY',
  'LOCATION',
  'UNIT',
  'QUANTITY',
  'NOTES',
  'DESCRIPTION_OVERRIDE',
] as const;

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function evidenceFrom(row: Row): Map<ImportCanonicalField, Evidence> {
  const result = new Map<ImportCanonicalField, Evidence>();
  const evidence = parseJson(row.normalization_evidence_json, []);
  if (!Array.isArray(evidence)) return result;
  for (const item of evidence) {
    if (!item || typeof item !== 'object') continue;
    const fact = item as Record<string, unknown>;
    if (
      fact.success !== true ||
      fact.normalizedValue == null ||
      (typeof fact.normalizedValue !== 'string' && typeof fact.normalizedValue !== 'number')
    )
      continue;
    result.set(String(fact.canonicalField) as ImportCanonicalField, {
      value: fact.normalizedValue,
      basis: fact.basis == null ? null : String(fact.basis),
      unit: fact.unit == null ? null : String(fact.unit),
    });
  }
  return result;
}

function text(values: Map<ImportCanonicalField, Evidence>, field: ImportCanonicalField): string {
  const value = values.get(field)?.value;
  return value == null ? '' : String(value).trim();
}

function technicalText(
  values: Map<ImportCanonicalField, Evidence>,
  field: 'WATTAGE' | 'LUMENS',
): { text: string; basis: 'W' | 'W_PER_M' | 'LM' | 'LM_PER_M' | null; unresolved: boolean } {
  const evidence = values.get(field);
  if (!evidence) return { text: '', basis: null, unresolved: false };
  const numeric = typeof evidence.value === 'number';
  const basis = evidence.basis ?? evidence.unit;
  if (field === 'WATTAGE') {
    const resolved =
      basis === 'W_PER_M' || basis === 'W/m' ? 'W_PER_M' : basis === 'W' ? 'W' : null;
    return {
      text: numeric
        ? `${evidence.value} ${resolved === 'W_PER_M' ? 'W/m' : 'W'}`
        : String(evidence.value),
      basis: resolved,
      unresolved: numeric && resolved === null,
    };
  }
  const resolved =
    basis === 'LM_PER_M' || basis === 'lm/m'
      ? 'LM_PER_M'
      : basis === 'LM' || basis === 'lm'
        ? 'LM'
        : null;
  return {
    text: numeric
      ? `${evidence.value} ${resolved === 'LM_PER_M' ? 'lm/m' : 'lm'}`
      : String(evidence.value),
    basis: resolved,
    unresolved: numeric && resolved === null,
  };
}

type LibraryActionRow = ReturnType<ImportSessionStore['row']>;

function unavailableLibraryAction(row: LibraryActionRow, attemptedAction: string): DomainError {
  const reconciliation = row.reconciliation?.schemaVersion === 2 ? row.reconciliation : null;
  let reasonCode = 'LIBRARY_ACTION_NOT_ELIGIBLE';
  let humanReason = 'The requested action is not eligible for this reconciled Library row.';
  let requiredNextStep = reconciliation
    ? `Choose an eligible action: ${reconciliation.allowedActions.join(', ') || 'none available'}.`
    : 'Reconcile Library before choosing an action.';

  if (!reconciliation) {
    reasonCode = 'LIBRARY_RECONCILIATION_REQUIRED';
    humanReason = 'Current Library reconciliation does not exist for this row.';
  } else if (row.applyState === 'APPLIED') {
    reasonCode = 'LIBRARY_ROW_ALREADY_APPLIED';
    humanReason = 'Applied rows are immutable.';
    requiredNextStep = 'Review the persisted Apply result or start a new Import Session.';
  } else if (attemptedAction === 'LIBRARY_CREATE_DRAFT' && reconciliation.variant.exactMatch) {
    reasonCode = 'LIBRARY_EXACT_VARIANT_CREATE_DRAFT_FORBIDDEN';
    humanReason = 'An exact existing Variant cannot create a parallel Draft.';
    requiredNextStep = 'Choose Use Existing Variant, Review Existing Variant, or Skip Row.';
  } else if (attemptedAction === 'LIBRARY_USE_EXISTING' && !reconciliation.variant.exactMatch) {
    reasonCode = 'LIBRARY_EXACT_VARIANT_REQUIRED';
    humanReason = 'Use Existing Variant requires an exact ordering-code match.';
    requiredNextStep = 'Choose Create Library Draft when eligible, or Skip Row.';
  } else if (reconciliation.blockingReasons[0]) {
    reasonCode = reconciliation.blockingReasons[0].code;
    humanReason = reconciliation.blockingReasons[0].message;
    requiredNextStep = 'Resolve the highlighted Manufacturer or Product group decision first.';
  }

  const rowIdentity = `source row ${row.sourceRowNumber} (${row.importRowId})`;
  return new DomainError(
    'IMPORT_ACTION_INVALID',
    `Library action unavailable for ${rowIdentity}. Attempted: ${attemptedAction}. Reason [${reasonCode}]: ${humanReason} Next: ${requiredNextStep}`,
    409,
    {
      importRowId: row.importRowId,
      sourceRowNumber: row.sourceRowNumber,
      attemptedAction,
      reasonCode,
      humanReason,
      requiredNextStep,
    },
  );
}

function stableUuid(seed: string): string {
  const hash = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ['8', '9', 'a', 'b'][Number.parseInt(hash[16]!, 16) % 4]!;
  return `${hash.slice(0, 8).join('')}-${hash.slice(8, 12).join('')}-${hash.slice(12, 16).join('')}-${hash.slice(16, 20).join('')}-${hash.slice(20).join('')}`;
}

function hasBlockingValidation(row: Row): boolean {
  const reasons = parseJson(row.validation_reasons_json, []);
  return (
    Array.isArray(reasons) &&
    reasons.some(
      (reason) =>
        reason &&
        typeof reason === 'object' &&
        (reason as Record<string, unknown>).severity === 'BLOCKING',
    )
  );
}

function metadata(values: string[]) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return {
    state:
      unique.length === 0
        ? ('MISSING' as const)
        : unique.length === 1
          ? ('CONSISTENT' as const)
          : ('CONFLICTING' as const),
    values: unique,
    resolvedValue: unique.length === 1 ? unique[0]! : unique.length === 0 ? '' : null,
  };
}

function candidate(
  catalogue: LibraryDraftCatalogueAuthority,
  variant: LibraryVariantAuthority,
  reasons: string[] = [],
  importedTechnical?: LibraryVariantAuthority['technical'],
): ImportLibraryEntityCandidate {
  const product = catalogue.products.find((item) => item.productId === variant.productId)!;
  const maker = catalogue.manufacturers.find(
    (item) => item.manufacturerId === variant.manufacturerId,
  )!;
  return {
    manufacturerId: maker.manufacturerId,
    manufacturerName: maker.name,
    manufacturerStatus: maker.status,
    manufacturerRowVersion: maker.rowVersion,
    productId: product.productId,
    productName: product.name,
    productType: product.productType,
    productDescription: product.description,
    productStatus: product.status,
    productRowVersion: product.rowVersion,
    variantId: variant.variantId,
    variantLabel: variant.variantLabel,
    orderingCode: variant.orderingCode,
    variantStatus: variant.status,
    variantRowVersion: variant.rowVersion,
    latestPublishedVersionId: variant.latestPublishedVersionId,
    technicalSummary: variant.technicalSummary,
    technical: variant.technical,
    technicalDifferences: importedTechnical
      ? Object.entries(importedTechnical)
          .filter(([, imported]) => imported.trim().length > 0)
          .filter(([field, imported]) => {
            const current = variant.technical[field as keyof typeof variant.technical];
            return compareTechnicalValue(field, current, imported) === 'Different';
          })
          .map(([field, imported]) => ({
            field,
            imported,
            current: variant.technical[field as keyof typeof variant.technical],
          }))
      : [],
    matchReasons: reasons,
  };
}

function safeVariantLabel(values: Map<ImportCanonicalField, Evidence>): string {
  const explicit = text(values, 'VARIANT_LABEL');
  if (explicit) return explicit;
  return [
    text(values, 'WATTAGE'),
    text(values, 'LUMENS'),
    text(values, 'CCT'),
    text(values, 'CRI') ? `CRI ${text(values, 'CRI')}` : '',
    text(values, 'BEAM_OPTIC'),
    text(values, 'CONTROL'),
    text(values, 'BODY_COLOR_FINISH'),
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 300);
}

export class ImportLibraryReconciliationService {
  private readonly database: DatabaseSync;

  public constructor(
    private readonly store: ImportSessionStore,
    private readonly library: LuminaireLibraryDraftWritePort,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.database = store.getDatabase();
  }

  public reconcile(sessionId: string, input: ReconcileImportSessionInput) {
    const session = this.store.get(sessionId);
    if (session.destinationMode !== 'MASTER_LIBRARY')
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Library reconciliation is unavailable for this destination.',
        409,
      );
    if (
      session.sessionRevision !== input.expectedSessionRevision ||
      session.previewFingerprint !== input.expectedPreviewFingerprint
    )
      throw new DomainError('IMPORT_PREVIEW_STALE', 'The Import preview changed.', 409);
    const rawRows = this.database
      .prepare(
        `SELECT ir.*, ist.mapping_fingerprint FROM import_rows ir
         JOIN import_source_tables ist ON ist.source_table_id = ir.source_table_id
         WHERE ir.import_session_id = ? AND ist.selected = 1 AND ir.apply_state <> 'APPLIED'
         ORDER BY ist.source_ordinal, ir.source_row_number, ir.import_row_id`,
      )
      .all(sessionId) as Row[];
    const catalogue = this.library.catalogue();
    const rows = rawRows.map((row) => ({
      row,
      values: evidenceFrom(row),
      mappingFingerprint: String(row.mapping_fingerprint),
    }));
    const groupValues = new Map<string, { productTypes: string[]; descriptions: string[] }>();
    for (const item of rows) {
      const makerKey = normalizeManufacturerName(text(item.values, 'MANUFACTURER'));
      const familyKey = normalizeManufacturerName(text(item.values, 'PRODUCT_FAMILY'));
      const key = `${makerKey}|${familyKey}`;
      const values = groupValues.get(key) ?? { productTypes: [], descriptions: [] };
      values.productTypes.push(text(item.values, 'PRODUCT_TYPE'));
      values.descriptions.push(text(item.values, 'DESCRIPTION'));
      groupValues.set(key, values);
    }
    const groupMetadata = new Map<
      string,
      { productType: ReturnType<typeof metadata>; description: ReturnType<typeof metadata> }
    >();
    for (const [key, values] of groupValues) {
      groupMetadata.set(key, {
        productType: metadata(values.productTypes),
        description: metadata(values.descriptions),
      });
    }
    const manufacturersByName = new Map<string, (typeof catalogue.manufacturers)[number][]>();
    const productsByManufacturerAndName = new Map<string, (typeof catalogue.products)[number][]>();
    const variantsByManufacturerAndCode = new Map<string, (typeof catalogue.variants)[number][]>();
    const variantsByManufacturer = new Map<string, (typeof catalogue.variants)[number][]>();
    for (const maker of catalogue.manufacturers) {
      const bucket = manufacturersByName.get(maker.normalizedName) ?? [];
      bucket.push(maker);
      manufacturersByName.set(maker.normalizedName, bucket);
    }
    for (const product of catalogue.products) {
      const key = `${product.manufacturerId}|${product.normalizedName}`;
      const bucket = productsByManufacturerAndName.get(key) ?? [];
      bucket.push(product);
      productsByManufacturerAndName.set(key, bucket);
    }
    for (const variant of catalogue.variants) {
      const manufacturerBucket = variantsByManufacturer.get(variant.manufacturerId) ?? [];
      manufacturerBucket.push(variant);
      variantsByManufacturer.set(variant.manufacturerId, manufacturerBucket);
      const key = `${variant.manufacturerId}|${variant.normalizedOrderingCode}`;
      const codeBucket = variantsByManufacturerAndCode.get(key) ?? [];
      codeBucket.push(variant);
      variantsByManufacturerAndCode.set(key, codeBucket);
    }
    const relevantAuthority = rows.map((item) => {
      const makerKey = normalizeManufacturerName(text(item.values, 'MANUFACTURER'));
      const familyKey = normalizeManufacturerName(text(item.values, 'PRODUCT_FAMILY'));
      const orderingCode = normalizeLuminaireOrderingCode(text(item.values, 'ORDERING_CODE'));
      const manufacturers = manufacturersByName.get(makerKey) ?? [];
      return {
        makerKey,
        familyKey,
        orderingCode,
        manufacturers,
        products: manufacturers.flatMap(
          (maker) =>
            productsByManufacturerAndName.get(`${maker.manufacturerId}|${familyKey}`) ?? [],
        ),
        variants: orderingCode
          ? manufacturers.flatMap(
              (maker) =>
                variantsByManufacturerAndCode.get(`${maker.manufacturerId}|${orderingCode}`) ?? [],
            )
          : [],
      };
    });
    const destinationFingerprint = importAuthorityFingerprint(relevantAuthority);
    const reconciliations = rows.map((item, index) => {
      const authority = relevantAuthority[index]!;
      const maker = authority.manufacturers[0] ?? null;
      const family = text(item.values, 'PRODUCT_FAMILY');
      const makerName = text(item.values, 'MANUFACTURER');
      const manufacturerGroupId = stableUuid(
        `${sessionId}:manufacturer:${authority.makerKey || String(item.row.import_row_id)}`,
      );
      const productGroupId = stableUuid(
        `${sessionId}:product:${manufacturerGroupId}:${authority.familyKey || String(item.row.import_row_id)}`,
      );
      const plannedManufacturerId =
        maker?.manufacturerId ?? stableUuid(`${manufacturerGroupId}:planned`);
      const products = authority.products;
      const exactProduct = products.length === 1 ? products[0]! : null;
      const plannedProductId = exactProduct?.productId ?? stableUuid(`${productGroupId}:planned`);
      const exactVariant = authority.variants.length === 1 ? authority.variants[0]! : null;
      const groupFacts = groupMetadata.get(`${authority.makerKey}|${authority.familyKey}`)!;
      const wattage = technicalText(item.values, 'WATTAGE');
      const lumens = technicalText(item.values, 'LUMENS');
      const variantLabel = safeVariantLabel(item.values);
      const importedTechnical: LibraryVariantAuthority['technical'] = {
        wattage: wattage.text,
        lumens: lumens.text,
        lightColor: text(item.values, 'CCT'),
        cri: text(item.values, 'CRI'),
        beamAngle: text(item.values, 'BEAM_OPTIC'),
        ipRating: text(item.values, 'IP'),
        mounting: text(item.values, 'MOUNTING'),
        cutout: text(item.values, 'CUTOUT'),
        driver: text(item.values, 'DRIVER'),
        control: text(item.values, 'CONTROL'),
        emergency: text(item.values, 'EMERGENCY'),
        dimensions: text(item.values, 'DIMENSIONS'),
        bodyColorFinish: text(item.values, 'BODY_COLOR_FINISH'),
      };
      const exactProductAuthority = exactVariant
        ? catalogue.products.find((product) => product.productId === exactVariant.productId)!
        : null;
      const exactTechnicalDifferences = exactVariant
        ? candidate(catalogue, exactVariant, [], importedTechnical).technicalDifferences
        : [];
      const blockingReasons: Array<{ code: string; message: string }> = [];
      if (!makerName)
        blockingReasons.push({
          code: 'LIBRARY_MANUFACTURER_REQUIRED',
          message: 'Manufacturer is required.',
        });
      else if (!maker)
        blockingReasons.push({
          code: 'LIBRARY_MANUFACTURER_DECISION_REQUIRED',
          message: 'Choose Create Manufacturer for this group.',
        });
      else if (maker.status === 'ARCHIVED')
        blockingReasons.push({
          code: 'LIBRARY_MANUFACTURER_ARCHIVED',
          message: 'The exact Manufacturer is archived.',
        });
      if (!family)
        blockingReasons.push({
          code: 'LIBRARY_PRODUCT_FAMILY_REQUIRED',
          message: 'Product Family is required.',
        });
      if (products.length > 1)
        blockingReasons.push({
          code: 'LIBRARY_PRODUCT_AMBIGUOUS',
          message: 'More than one exact Product exists under this Manufacturer.',
        });
      if (exactProduct?.status === 'ARCHIVED')
        blockingReasons.push({
          code: 'LIBRARY_PRODUCT_ARCHIVED',
          message: 'The exact Product is archived.',
        });
      if (groupFacts.productType.state === 'CONFLICTING')
        blockingReasons.push({
          code: 'LIBRARY_PRODUCT_TYPE_CONFLICT',
          message: 'Product Type conflicts within this Product group.',
        });
      if (groupFacts.description.state === 'CONFLICTING')
        blockingReasons.push({
          code: 'LIBRARY_PRODUCT_DESCRIPTION_CONFLICT',
          message: 'Product Description conflicts within this Product group.',
        });
      if (!variantLabel)
        blockingReasons.push({
          code: 'LIBRARY_VARIANT_LABEL_REQUIRED',
          message: 'Enter a useful Variant Label.',
        });
      if (wattage.unresolved || lumens.unresolved)
        blockingReasons.push({
          code: 'LIBRARY_TECHNICAL_BASIS_REQUIRED',
          message: 'Resolve W versus W/m and lm versus lm/m before Apply.',
        });
      if (authority.variants.length > 1)
        blockingReasons.push({
          code: 'LIBRARY_ORDERING_CODE_AMBIGUOUS',
          message: 'Ordering Code resolves to multiple Variants.',
        });
      if (hasBlockingValidation(item.row))
        blockingReasons.push({
          code: 'IMPORT_ROW_BLOCKED',
          message: 'Resolve blocking inspection findings.',
        });
      const possibleMatches = exactVariant
        ? []
        : (variantsByManufacturer.get(plannedManufacturerId) ?? [])
            .map((variant) => {
              const reasons: string[] = [];
              if (variant.productId === plannedProductId) reasons.push('Product family');
              if (
                variant.normalizedLabel === normalizeManufacturerName(variantLabel) &&
                variantLabel
              )
                reasons.push('Variant label');
              return { variant, reasons };
            })
            .filter((entry) => entry.reasons.length > 0)
            .sort(
              (left, right) =>
                right.reasons.length - left.reasons.length ||
                left.variant.variantId.localeCompare(right.variant.variantId),
            )
            .slice(0, 5)
            .map((entry) => candidate(catalogue, entry.variant, entry.reasons));
      const allowedActions: ImportLibraryReconciliation['allowedActions'] = ['SKIP'];
      if (exactVariant?.status === 'ACTIVE')
        allowedActions.unshift('LIBRARY_REVIEW_EXISTING', 'LIBRARY_USE_EXISTING');
      else if (exactVariant) allowedActions.unshift('LIBRARY_REVIEW_EXISTING');
      else if (blockingReasons.length === 0) allowedActions.unshift('LIBRARY_CREATE_DRAFT');
      const base = {
        schemaVersion: 2 as const,
        inspectionFingerprint: input.expectedPreviewFingerprint,
        sourceRowFingerprint: String(item.row.source_row_fingerprint),
        mappingFingerprint: item.mappingFingerprint,
        destinationFingerprint,
        manufacturer: {
          manufacturerGroupId,
          state: maker
            ? maker.status === 'ACTIVE'
              ? ('EXACT_ACTIVE' as const)
              : ('EXACT_ARCHIVED' as const)
            : ('MISSING_REQUIRES_DECISION' as const),
          name: makerName,
          normalizedName: authority.makerKey,
          plannedManufacturerId,
          existing: maker
            ? {
                manufacturerId: maker.manufacturerId,
                name: maker.name,
                status: maker.status,
                rowVersion: maker.rowVersion,
              }
            : null,
        },
        product: {
          productGroupId,
          state:
            products.length > 1
              ? ('AMBIGUOUS' as const)
              : exactProduct
                ? exactProduct.status === 'ACTIVE'
                  ? ('EXACT_ACTIVE' as const)
                  : ('EXACT_ARCHIVED' as const)
                : ('NEW' as const),
          family,
          normalizedFamily: authority.familyKey,
          plannedProductId,
          existing: exactProduct
            ? {
                productId: exactProduct.productId,
                name: exactProduct.name,
                productType: exactProduct.productType,
                description: exactProduct.description,
                status: exactProduct.status,
                rowVersion: exactProduct.rowVersion,
              }
            : null,
          productType: groupFacts.productType,
          description: groupFacts.description,
        },
        variant: {
          state: exactVariant
            ? exactVariant.status === 'ACTIVE'
              ? ('EXACT_ACTIVE' as const)
              : ('EXACT_ARCHIVED' as const)
            : authority.orderingCode
              ? ('ORDERING_CODE_AVAILABLE' as const)
              : ('EMPTY_ORDERING_CODE' as const),
          plannedVariantId: stableUuid(`${sessionId}:variant:${String(item.row.import_row_id)}`),
          variantLabel,
          orderingCode: text(item.values, 'ORDERING_CODE'),
          normalizedOrderingCode: authority.orderingCode,
          exactMatch: exactVariant
            ? candidate(
                catalogue,
                exactVariant,
                ['Exact Manufacturer and Ordering Code'],
                importedTechnical,
              )
            : null,
          possibleMatches,
        },
        facts: {
          technical: {
            wattage: wattage.text,
            wattageBasis: wattage.basis,
            lumens: lumens.text,
            lumensBasis: lumens.basis,
            lightColor: text(item.values, 'CCT'),
            cri: text(item.values, 'CRI'),
            beamAngle: text(item.values, 'BEAM_OPTIC'),
            ipRating: text(item.values, 'IP'),
            mounting: text(item.values, 'MOUNTING'),
            cutout: text(item.values, 'CUTOUT'),
            driver: text(item.values, 'DRIVER'),
            control: text(item.values, 'CONTROL'),
            emergency: text(item.values, 'EMERGENCY'),
            dimensions: text(item.values, 'DIMENSIONS'),
            bodyColorFinish: text(item.values, 'BODY_COLOR_FINISH'),
          },
          excludedProjectFields: EXCLUDED_PROJECT_FIELDS,
          assetEvidenceOnly: true,
        },
        blockingReasons,
        warnings: [
          ...(exactProductAuthority && exactProductAuthority.normalizedName !== authority.familyKey
            ? [
                `PRODUCT FAMILY CONFLICT: exact Ordering Code belongs to ${exactProductAuthority.name}; imported ${family || 'empty Product Family'}. Hard identity wins.`,
              ]
            : []),
          ...(exactTechnicalDifferences.length > 0
            ? [
                `TECHNICAL DIFFERENCE: ${exactTechnicalDifferences
                  .map(
                    (difference) =>
                      `${difference.field} ${difference.current || 'empty'} → ${difference.imported}`,
                  )
                  .join('; ')}`,
              ]
            : []),
          ...(possibleMatches.length > 0
            ? ['Possible matches are advisory. No existing Draft will be changed.']
            : []),
        ],
        allowedActions,
        recommendedAction:
          exactVariant?.status === 'ACTIVE'
            ? exactTechnicalDifferences.length > 0 ||
              exactProductAuthority?.normalizedName !== authority.familyKey
              ? ('LIBRARY_REVIEW_EXISTING' as const)
              : ('LIBRARY_USE_EXISTING' as const)
            : blockingReasons.length === 0
              ? ('LIBRARY_CREATE_DRAFT' as const)
              : null,
        reconciledAt: this.clock().toISOString(),
      };
      return importLibraryReconciliationSchema.parse({
        ...base,
        reconciliationFingerprint: importAuthorityFingerprint(base),
      });
    });
    return this.persistReconciliation(
      sessionId,
      input.expectedSessionRevision,
      input.expectedPreviewFingerprint,
      destinationFingerprint,
      rawRows,
      reconciliations,
    );
  }

  public setAction(sessionId: string, rowId: string, input: UpdateImportRowActionInput) {
    const session = this.store.get(sessionId);
    if (
      session.destinationMode !== 'MASTER_LIBRARY' ||
      session.sessionRevision !== input.expectedSessionRevision
    )
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library Import review changed.', 409);
    const row = this.store.row(sessionId, rowId);
    const reconciliation = row.reconciliation;
    if (row.rowVersion !== input.expectedRowVersion)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library Import row changed.', 409);
    if (!reconciliation || reconciliation.schemaVersion !== 2 || row.applyState === 'APPLIED')
      throw unavailableLibraryAction(row, input.action.type);
    if (!reconciliation.allowedActions.includes(input.action.type as never))
      throw unavailableLibraryAction(row, input.action.type);
    const basis = {
      sourceRowFingerprint: row.sourceRowFingerprint,
      mappingFingerprint: reconciliation.mappingFingerprint,
      reconciliationFingerprint: reconciliation.reconciliationFingerprint,
      destinationFingerprint: reconciliation.destinationFingerprint,
      importRowVersion: row.rowVersion + 1,
    };
    let action: ImportLibraryRowAction;
    if (input.action.type === 'SKIP') action = { type: 'SKIP', reason: input.action.reason };
    else if (input.action.type === 'LIBRARY_USE_EXISTING') {
      const exact = reconciliation.variant.exactMatch!;
      action = {
        type: 'LIBRARY_USE_EXISTING',
        manufacturerId: exact.manufacturerId,
        productId: exact.productId,
        variantId: exact.variantId,
        latestPublishedVersionId: exact.latestPublishedVersionId,
        expectedManufacturer: {
          entityId: exact.manufacturerId,
          expectedStatus: exact.manufacturerStatus,
          expectedRowVersion: exact.manufacturerRowVersion,
        },
        expectedProduct: {
          entityId: exact.productId,
          expectedStatus: exact.productStatus,
          expectedRowVersion: exact.productRowVersion,
        },
        expectedVariant: {
          entityId: exact.variantId,
          expectedStatus: exact.variantStatus,
          expectedRowVersion: exact.variantRowVersion,
        },
        basis,
      };
    } else if (input.action.type === 'LIBRARY_REVIEW_EXISTING') {
      const exact = reconciliation.variant.exactMatch!;
      action = {
        type: 'LIBRARY_REVIEW_EXISTING',
        manufacturerId: exact.manufacturerId,
        productId: exact.productId,
        variantId: exact.variantId,
        basis,
      };
    } else if (input.action.type === 'LIBRARY_CREATE_DRAFT') {
      action = {
        type: 'LIBRARY_CREATE_DRAFT',
        manufacturer: {
          manufacturerGroupId: reconciliation.manufacturer.manufacturerGroupId,
          mode: reconciliation.manufacturer.existing ? 'EXISTING' : 'CREATE',
          manufacturerId: reconciliation.manufacturer.plannedManufacturerId,
          name: reconciliation.manufacturer.name,
          normalizedName: reconciliation.manufacturer.normalizedName,
          expected: reconciliation.manufacturer.existing
            ? {
                entityId: reconciliation.manufacturer.existing.manufacturerId,
                expectedStatus: reconciliation.manufacturer.existing.status,
                expectedRowVersion: reconciliation.manufacturer.existing.rowVersion,
              }
            : null,
        },
        product: {
          productGroupId: reconciliation.product.productGroupId,
          mode: reconciliation.product.existing ? 'EXISTING' : 'CREATE',
          productId: reconciliation.product.plannedProductId,
          family: reconciliation.product.family,
          normalizedFamily: reconciliation.product.normalizedFamily,
          productType: reconciliation.product.productType.resolvedValue ?? '',
          description: reconciliation.product.description.resolvedValue ?? '',
          expected: reconciliation.product.existing
            ? {
                entityId: reconciliation.product.existing.productId,
                expectedStatus: reconciliation.product.existing.status,
                expectedRowVersion: reconciliation.product.existing.rowVersion,
              }
            : null,
        },
        variant: {
          plannedVariantId: reconciliation.variant.plannedVariantId,
          variantLabel: reconciliation.variant.variantLabel,
          orderingCode: reconciliation.variant.orderingCode,
          normalizedOrderingCode: reconciliation.variant.normalizedOrderingCode,
          ...reconciliation.facts.technical,
          assetVersionIds: [],
        },
        basis,
        publish: false,
      };
    } else
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Project actions are unavailable for Library imports.',
        409,
      );
    const parsedAction = importRowActionSchema.parse(action);
    return this.store.transaction(() => {
      const now = this.clock().toISOString();
      const status =
        action.type === 'SKIP'
          ? 'SKIPPED'
          : action.type === 'LIBRARY_REVIEW_EXISTING'
            ? 'NEEDS_REVIEW'
            : 'READY';
      const changed = this.database
        .prepare(
          `UPDATE import_rows SET intended_action = ?, row_status = ?, row_version = row_version + 1, updated_at = ? WHERE import_session_id = ? AND import_row_id = ? AND row_version = ? AND apply_state <> 'APPLIED'`,
        )
        .run(JSON.stringify(parsedAction), status, now, sessionId, rowId, input.expectedRowVersion);
      if (changed.changes !== 1)
        throw new DomainError('IMPORT_PLAN_STALE', 'The Library Import row changed.', 409);
      this.advanceSession(sessionId, input.expectedSessionRevision, now);
      this.refreshPlan(sessionId);
      return this.store.row(sessionId, rowId);
    });
  }

  public setBulkActions(sessionId: string, input: BulkUpdateImportRowActionsInput) {
    if (
      !('action' in input) ||
      !['LIBRARY_CREATE_DRAFT', 'LIBRARY_USE_EXISTING', 'SKIP'].includes(input.action)
    )
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Only safe Library bulk actions are accepted.',
        409,
      );
    const session = this.store.get(sessionId);
    if (
      session.destinationMode !== 'MASTER_LIBRARY' ||
      session.sessionRevision !== input.expectedSessionRevision
    )
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library Import review changed.', 409);
    const uniqueIds = [...new Set(input.rowIds)];
    if (uniqueIds.length !== input.rowIds.length)
      throw new DomainError('IMPORT_ACTION_INVALID', 'Bulk row identities must be unique.', 400);
    const materialized = uniqueIds.map((rowId) => {
      const row = this.store.row(sessionId, rowId);
      const action =
        input.action === 'SKIP'
          ? ({ type: 'SKIP', reason: 'Owner bulk-skipped during Library review.' } as const)
          : input.action === 'LIBRARY_CREATE_DRAFT'
            ? ({ type: 'LIBRARY_CREATE_DRAFT' } as const)
            : ({ type: 'LIBRARY_USE_EXISTING' } as const);
      return { row, action: this.materializeAction(row, action) };
    });
    return this.store.transaction(() => {
      const now = this.clock().toISOString();
      const update = this.database.prepare(
        `UPDATE import_rows SET intended_action = ?, row_status = ?, row_version = row_version + 1,
         updated_at = ? WHERE import_session_id = ? AND import_row_id = ? AND row_version = ?
         AND apply_state <> 'APPLIED'`,
      );
      for (const item of materialized) {
        const changed = update.run(
          JSON.stringify(item.action),
          item.action.type === 'SKIP' ? 'SKIPPED' : 'READY',
          now,
          sessionId,
          item.row.importRowId,
          item.row.rowVersion,
        );
        if (changed.changes !== 1)
          throw new DomainError('IMPORT_PLAN_STALE', 'A selected Library Import row changed.', 409);
      }
      this.advanceSession(sessionId, input.expectedSessionRevision, now);
      this.refreshPlan(sessionId);
      return this.store.get(sessionId);
    });
  }

  public decideGroup(sessionId: string, input: ImportLibraryGroupDecisionInput) {
    const session = this.store.get(sessionId);
    if (
      session.destinationMode !== 'MASTER_LIBRARY' ||
      session.sessionRevision !== input.expectedSessionRevision
    )
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library group review changed.', 409);
    const rows = this.database
      .prepare(
        "SELECT import_row_id, reconciliation_json FROM import_rows WHERE import_session_id = ? AND apply_state <> 'APPLIED'",
      )
      .all(sessionId) as Row[];
    const catalogue = this.library.catalogue();
    const updates: Array<{ rowId: string; reconciliation: ImportLibraryReconciliation }> = [];
    const manufacturerDecision = input.kind === 'MANUFACTURER' ? input.decision : null;
    for (const row of rows) {
      const parsed = importLibraryReconciliationSchema.safeParse(
        parseJson(row.reconciliation_json, null),
      );
      if (!parsed.success) continue;
      const reconciliation = structuredClone(parsed.data);
      if (
        input.kind === 'MANUFACTURER' &&
        reconciliation.manufacturer.manufacturerGroupId === input.manufacturerGroupId
      ) {
        if (manufacturerDecision!.mode === 'CREATE') {
          reconciliation.manufacturer.state = 'PLANNED_CREATE';
          reconciliation.manufacturer.existing = null;
          reconciliation.blockingReasons = reconciliation.blockingReasons.filter(
            (reason) => reason.code !== 'LIBRARY_MANUFACTURER_DECISION_REQUIRED',
          );
        } else {
          const manufacturerId = (
            manufacturerDecision as { mode: 'USE_EXISTING'; manufacturerId: string }
          ).manufacturerId;
          const maker = catalogue.manufacturers.find(
            (candidateMaker) => candidateMaker.manufacturerId === manufacturerId,
          );
          if (!maker || maker.status !== 'ACTIVE')
            throw new DomainError(
              'IMPORT_DESTINATION_CHANGED',
              'The selected Manufacturer is unavailable.',
              409,
            );
          reconciliation.manufacturer = {
            ...reconciliation.manufacturer,
            state: 'EXACT_ACTIVE',
            plannedManufacturerId: maker.manufacturerId,
            existing: {
              manufacturerId: maker.manufacturerId,
              name: maker.name,
              status: maker.status,
              rowVersion: maker.rowVersion,
            },
          };
          reconciliation.blockingReasons = reconciliation.blockingReasons.filter(
            (reason) => reason.code !== 'LIBRARY_MANUFACTURER_DECISION_REQUIRED',
          );
        }
      } else if (
        input.kind === 'PRODUCT' &&
        reconciliation.product.productGroupId === input.productGroupId
      ) {
        if (input.decision.family !== undefined) {
          reconciliation.product.family = input.decision.family;
          reconciliation.product.normalizedFamily = normalizeManufacturerName(
            input.decision.family,
          );
        }
        if (input.decision.productType !== undefined)
          reconciliation.product.productType = {
            state: input.decision.productType ? 'CONSISTENT' : 'MISSING',
            values: input.decision.productType ? [input.decision.productType] : [],
            resolvedValue: input.decision.productType,
          };
        if (input.decision.description !== undefined)
          reconciliation.product.description = {
            state: input.decision.description ? 'CONSISTENT' : 'MISSING',
            values: input.decision.description ? [input.decision.description] : [],
            resolvedValue: input.decision.description,
          };
        if (input.decision.productType !== undefined)
          reconciliation.blockingReasons = reconciliation.blockingReasons.filter(
            (reason) => reason.code !== 'LIBRARY_PRODUCT_TYPE_CONFLICT',
          );
        if (input.decision.description !== undefined)
          reconciliation.blockingReasons = reconciliation.blockingReasons.filter(
            (reason) => reason.code !== 'LIBRARY_PRODUCT_DESCRIPTION_CONFLICT',
          );
      } else continue;
      if (!reconciliation.variant.exactMatch && reconciliation.blockingReasons.length === 0) {
        reconciliation.allowedActions = ['LIBRARY_CREATE_DRAFT', 'SKIP'];
        reconciliation.recommendedAction = 'LIBRARY_CREATE_DRAFT';
      }
      const basis = {
        ...reconciliation,
        reconciliationFingerprint: undefined,
        reconciledAt: this.clock().toISOString(),
      };
      reconciliation.reconciliationFingerprint = importAuthorityFingerprint(basis);
      reconciliation.reconciledAt = this.clock().toISOString();
      updates.push({
        rowId: String(row.import_row_id),
        reconciliation: importLibraryReconciliationSchema.parse(reconciliation),
      });
    }
    if (updates.length === 0)
      throw new DomainError('NOT_FOUND', 'Library Import group not found.', 404);
    return this.store.transaction(() => {
      const now = this.clock().toISOString();
      const update = this.database.prepare(
        `UPDATE import_rows SET reconciliation_json = ?, intended_action = NULL, row_status = ?, row_version = row_version + 1, updated_at = ? WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      );
      for (const item of updates)
        update.run(
          JSON.stringify(item.reconciliation),
          item.reconciliation.blockingReasons.length ? 'BLOCKED' : 'NEEDS_REVIEW',
          now,
          sessionId,
          item.rowId,
        );
      this.advanceSession(sessionId, input.expectedSessionRevision, now);
      return this.store.get(sessionId);
    });
  }

  public refreshPlan(sessionId: string): string | null {
    const session = this.store.get(sessionId);
    const rows = this.database
      .prepare(
        `SELECT import_row_id, row_version, intended_action FROM import_rows WHERE import_session_id = ? AND apply_state <> 'APPLIED' ORDER BY import_row_id`,
      )
      .all(sessionId) as Row[];
    const planned = rows.filter((row) => row.intended_action !== null);
    const fingerprint =
      planned.length === 0 || !session.previewFingerprint || !session.destinationFingerprint
        ? null
        : importAuthorityFingerprint({
            previewFingerprint: session.previewFingerprint,
            destinationFingerprint: session.destinationFingerprint,
            sessionRevision: session.sessionRevision,
            rows: planned.map((row) => ({
              rowId: row.import_row_id,
              rowVersion: row.row_version,
              action: parseJson(row.intended_action, null),
            })),
          });
    this.database
      .prepare('UPDATE import_sessions SET apply_plan_fingerprint = ? WHERE import_session_id = ?')
      .run(fingerprint, sessionId);
    return fingerprint;
  }

  private materializeAction(
    row: ReturnType<ImportSessionStore['row']>,
    requested:
      | { type: 'LIBRARY_CREATE_DRAFT' }
      | { type: 'LIBRARY_USE_EXISTING' }
      | { type: 'SKIP'; reason: string | null },
  ): ImportLibraryRowAction {
    const reconciliation = row.reconciliation;
    if (
      !reconciliation ||
      reconciliation.schemaVersion !== 2 ||
      row.applyState === 'APPLIED' ||
      !reconciliation.allowedActions.includes(requested.type)
    )
      throw unavailableLibraryAction(row, requested.type);
    if (requested.type === 'SKIP') return requested;
    const basis = {
      sourceRowFingerprint: row.sourceRowFingerprint,
      mappingFingerprint: reconciliation.mappingFingerprint,
      reconciliationFingerprint: reconciliation.reconciliationFingerprint,
      destinationFingerprint: reconciliation.destinationFingerprint,
      importRowVersion: row.rowVersion + 1,
    };
    if (requested.type === 'LIBRARY_USE_EXISTING') {
      const exact = reconciliation.variant.exactMatch;
      if (!exact)
        throw new DomainError(
          'IMPORT_DESTINATION_CHANGED',
          'The exact Variant is unavailable.',
          409,
        );
      return importLibraryRowActionSchema.parse({
        type: 'LIBRARY_USE_EXISTING',
        manufacturerId: exact.manufacturerId,
        productId: exact.productId,
        variantId: exact.variantId,
        latestPublishedVersionId: exact.latestPublishedVersionId,
        expectedManufacturer: {
          entityId: exact.manufacturerId,
          expectedStatus: exact.manufacturerStatus,
          expectedRowVersion: exact.manufacturerRowVersion,
        },
        expectedProduct: {
          entityId: exact.productId,
          expectedStatus: exact.productStatus,
          expectedRowVersion: exact.productRowVersion,
        },
        expectedVariant: {
          entityId: exact.variantId,
          expectedStatus: exact.variantStatus,
          expectedRowVersion: exact.variantRowVersion,
        },
        basis,
      });
    }
    return importLibraryRowActionSchema.parse({
      type: 'LIBRARY_CREATE_DRAFT',
      manufacturer: {
        manufacturerGroupId: reconciliation.manufacturer.manufacturerGroupId,
        mode: reconciliation.manufacturer.existing ? 'EXISTING' : 'CREATE',
        manufacturerId: reconciliation.manufacturer.plannedManufacturerId,
        name: reconciliation.manufacturer.name,
        normalizedName: reconciliation.manufacturer.normalizedName,
        expected: reconciliation.manufacturer.existing
          ? {
              entityId: reconciliation.manufacturer.existing.manufacturerId,
              expectedStatus: reconciliation.manufacturer.existing.status,
              expectedRowVersion: reconciliation.manufacturer.existing.rowVersion,
            }
          : null,
      },
      product: {
        productGroupId: reconciliation.product.productGroupId,
        mode: reconciliation.product.existing ? 'EXISTING' : 'CREATE',
        productId: reconciliation.product.plannedProductId,
        family: reconciliation.product.family,
        normalizedFamily: reconciliation.product.normalizedFamily,
        productType: reconciliation.product.productType.resolvedValue ?? '',
        description: reconciliation.product.description.resolvedValue ?? '',
        expected: reconciliation.product.existing
          ? {
              entityId: reconciliation.product.existing.productId,
              expectedStatus: reconciliation.product.existing.status,
              expectedRowVersion: reconciliation.product.existing.rowVersion,
            }
          : null,
      },
      variant: {
        plannedVariantId: reconciliation.variant.plannedVariantId,
        variantLabel: reconciliation.variant.variantLabel,
        orderingCode: reconciliation.variant.orderingCode,
        normalizedOrderingCode: reconciliation.variant.normalizedOrderingCode,
        ...reconciliation.facts.technical,
        assetVersionIds: [],
      },
      basis,
      publish: false,
    });
  }

  private persistReconciliation(
    sessionId: string,
    expectedRevision: number,
    previewFingerprint: string,
    destinationFingerprint: string,
    rows: Row[],
    reconciliations: ImportLibraryReconciliation[],
  ) {
    return this.store.transaction(() => {
      const current = this.store.get(sessionId);
      if (
        current.sessionRevision !== expectedRevision ||
        current.previewFingerprint !== previewFingerprint
      )
        throw new DomainError(
          'IMPORT_PREVIEW_STALE',
          'The Import Session changed during reconciliation.',
          409,
        );
      const now = this.clock().toISOString();
      const update = this.database.prepare(
        `UPDATE import_rows SET reconciliation_json = ?, intended_action = NULL, row_status = ?, row_version = row_version + 1, updated_at = ? WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      );
      reconciliations.forEach((reconciliation, index) =>
        update.run(
          JSON.stringify(reconciliation),
          reconciliation.blockingReasons.length ? 'BLOCKED' : 'NEEDS_REVIEW',
          now,
          sessionId,
          String(rows[index]!.import_row_id),
        ),
      );
      const advanced = this.database
        .prepare(
          `UPDATE import_sessions SET destination_fingerprint = ?, apply_plan_fingerprint = NULL, session_revision = session_revision + 1, session_status = 'NEEDS_REVIEW', updated_at = ? WHERE import_session_id = ? AND session_revision = ?`,
        )
        .run(destinationFingerprint, now, sessionId, expectedRevision);
      if (advanced.changes !== 1)
        throw new DomainError(
          'IMPORT_PREVIEW_STALE',
          'The Import Session changed during reconciliation.',
          409,
        );
      return this.store.get(sessionId);
    });
  }

  private advanceSession(sessionId: string, expectedRevision: number, now: string): void {
    const advanced = this.database
      .prepare(
        `UPDATE import_sessions SET session_revision = session_revision + 1, apply_plan_fingerprint = NULL, updated_at = ? WHERE import_session_id = ? AND session_revision = ?`,
      )
      .run(now, sessionId, expectedRevision);
    if (advanced.changes !== 1)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library Import review changed.', 409);
  }
}
