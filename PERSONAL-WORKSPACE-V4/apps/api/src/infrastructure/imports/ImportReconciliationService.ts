import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  importProjectPayloadSchema,
  importProjectReconciliationSchema,
  importProjectRowActionSchema,
  luminaireRecordSchema,
  type ImportLibraryCandidate,
  type ImportProjectPayload,
  type ImportProjectRowAction,
  type ImportRowAction,
  type ReconcileImportSessionInput,
  type UpdateImportRowActionInput,
  type BulkUpdateImportRowActionsInput,
} from '@scli/contracts';
import {
  canonicalizeLuminaireTag,
  DomainError,
  normalizeLuminaireOrderingCode,
  normalizeLuminaireTag,
  normalizeManufacturerName,
  type ImportCanonicalField,
  type LuminaireRecord,
} from '@scli/domain';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore.js';
import { ImportSessionStore } from './ImportSessionStore.js';

type Row = Readonly<Record<string, unknown>>;

interface CatalogueCandidate extends ImportLibraryCandidate {
  normalizedManufacturer: string;
  normalizedOrderingCode: string;
  normalizedProductName: string;
  normalizedVariantLabel: string;
}

function publicCandidate(candidate: CatalogueCandidate): ImportLibraryCandidate {
  return {
    manufacturerId: candidate.manufacturerId,
    manufacturerName: candidate.manufacturerName,
    manufacturerRowVersion: candidate.manufacturerRowVersion,
    productId: candidate.productId,
    productName: candidate.productName,
    productRowVersion: candidate.productRowVersion,
    variantId: candidate.variantId,
    variantLabel: candidate.variantLabel,
    variantRowVersion: candidate.variantRowVersion,
    orderingCode: candidate.orderingCode,
    versionId: candidate.versionId,
    versionSequence: candidate.versionSequence,
    isLatest: candidate.isLatest,
    technicalSummary: candidate.technicalSummary,
    matchReasons: candidate.matchReasons,
  };
}

const FIELD_MAP = Object.freeze({
  PROJECT_CATEGORY: 'category',
  DESCRIPTION: 'description',
  MANUFACTURER: 'manufacturer',
  PRODUCT_FAMILY: 'model',
  PRODUCT_TYPE: 'productType',
  VARIANT_LABEL: 'variantLabel',
  ORDERING_CODE: 'orderingCode',
  WATTAGE: 'wattage',
  LUMENS: 'lumens',
  CCT: 'lightColor',
  CRI: 'cri',
  BEAM_OPTIC: 'beamAngle',
  IP: 'ipRating',
  MOUNTING: 'mounting',
  CUTOUT: 'cutout',
  DRIVER: 'driver',
  CONTROL: 'control',
  EMERGENCY: 'emergency',
  LOCATION: 'location',
  UNIT: 'unit',
  QUANTITY: 'quantity',
  NOTES: 'notes',
  DIMENSIONS: 'dimensions',
  BODY_COLOR_FINISH: 'bodyColorFinish',
} as const);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function importAuthorityFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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

function valuesFrom(row: Row): Map<ImportCanonicalField, string | number> {
  const values = new Map<ImportCanonicalField, string | number>();
  const evidence = parseJson(row.normalization_evidence_json, []);
  if (!Array.isArray(evidence)) return values;
  for (const item of evidence) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.success !== true || record.normalizedValue === null) continue;
    if (typeof record.normalizedValue !== 'string' && typeof record.normalizedValue !== 'number')
      continue;
    values.set(String(record.canonicalField) as ImportCanonicalField, record.normalizedValue);
  }
  return values;
}

function text(
  values: Map<ImportCanonicalField, string | number>,
  field: ImportCanonicalField,
): string {
  const value = values.get(field);
  return value === undefined ? '' : String(value).trim();
}

function materializePayload(
  values: Map<ImportCanonicalField, string | number>,
  tag: string,
): ImportProjectPayload {
  const candidate = {
    tag,
    category: text(values, 'PROJECT_CATEGORY'),
    description: text(values, 'DESCRIPTION'),
    manufacturer: text(values, 'MANUFACTURER'),
    model: text(values, 'PRODUCT_FAMILY'),
    productType: text(values, 'PRODUCT_TYPE'),
    variantLabel: text(values, 'VARIANT_LABEL'),
    orderingCode: text(values, 'ORDERING_CODE'),
    wattage: text(values, 'WATTAGE'),
    lumens: text(values, 'LUMENS'),
    lightColor: text(values, 'CCT'),
    cri: text(values, 'CRI'),
    beamAngle: text(values, 'BEAM_OPTIC'),
    ipRating: text(values, 'IP'),
    mounting: text(values, 'MOUNTING'),
    cutout: text(values, 'CUTOUT'),
    driver: text(values, 'DRIVER'),
    control: text(values, 'CONTROL'),
    emergency: text(values, 'EMERGENCY'),
    location: text(values, 'LOCATION'),
    unit: text(values, 'UNIT') || 'No.',
    quantity: typeof values.get('QUANTITY') === 'number' ? Number(values.get('QUANTITY')) : 0,
    notes: text(values, 'NOTES'),
    dimensions: text(values, 'DIMENSIONS'),
    bodyColorFinish: text(values, 'BODY_COLOR_FINISH'),
  };
  luminaireRecordSchema.parse({
    ...candidate,
    imagePath: '',
    datasheetPath: '',
    sourceName: 'Smart Import',
  });
  return importProjectPayloadSchema.parse(candidate) satisfies ImportProjectPayload;
}

function catalogue(database: DatabaseSync): CatalogueCandidate[] {
  const rows = database
    .prepare(
      `SELECT m.manufacturer_id, m.name AS manufacturer_name, m.normalized_name AS normalized_manufacturer,
            m.row_version AS manufacturer_row_version, p.product_id, p.name AS product_name,
            p.normalized_name AS normalized_product_name, p.row_version AS product_row_version,
            v.variant_id, v.variant_label, v.normalized_label, v.ordering_code,
            v.normalized_ordering_code, v.row_version AS variant_row_version,
            v.latest_published_version_id, lv.version_id, lv.version_sequence, lv.snapshot_json
       FROM luminaire_manufacturers m
       JOIN luminaire_library_products p ON p.manufacturer_id = m.manufacturer_id
       JOIN luminaire_library_variants v ON v.product_id = p.product_id
       JOIN luminaire_library_versions lv ON lv.variant_id = v.variant_id
      WHERE m.status = 'ACTIVE' AND p.status = 'ACTIVE' AND v.status = 'ACTIVE'
      ORDER BY m.normalized_name, v.normalized_ordering_code, lv.version_sequence DESC, lv.version_id`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const snapshot = parseJson(row.snapshot_json, {}) as Record<string, unknown>;
    return {
      manufacturerId: String(row.manufacturer_id),
      manufacturerName: String(row.manufacturer_name),
      manufacturerRowVersion: Number(row.manufacturer_row_version),
      productId: String(row.product_id),
      productName: String(row.product_name),
      productRowVersion: Number(row.product_row_version),
      variantId: String(row.variant_id),
      variantLabel: String(row.variant_label),
      variantRowVersion: Number(row.variant_row_version),
      orderingCode: String(row.ordering_code),
      versionId: String(row.version_id),
      versionSequence: Number(row.version_sequence),
      isLatest: String(row.latest_published_version_id) === String(row.version_id),
      technicalSummary: [snapshot.wattage, snapshot.lumens, snapshot.lightColor, snapshot.beamAngle]
        .filter((item) => typeof item === 'string' && item)
        .join(' · ')
        .slice(0, 500),
      matchReasons: [],
      normalizedManufacturer: String(row.normalized_manufacturer),
      normalizedOrderingCode: String(row.normalized_ordering_code),
      normalizedProductName: String(row.normalized_product_name),
      normalizedVariantLabel: String(row.normalized_label),
    };
  });
}

export class ImportReconciliationService {
  private readonly database: DatabaseSync;
  private readonly writes: ProjectLuminaireWriteStore;

  public constructor(
    private readonly store: ImportSessionStore,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.database = store.getDatabase();
    this.writes = new ProjectLuminaireWriteStore(this.database, clock);
  }

  public reconcile(sessionId: string, input: ReconcileImportSessionInput) {
    const session = this.store.get(sessionId);
    if (session.destinationMode !== 'PROJECT' || !session.projectId)
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Project reconciliation is unavailable for this destination.',
        409,
      );
    if (session.sessionRevision !== input.expectedSessionRevision)
      throw new DomainError(
        'IMPORT_PREVIEW_STALE',
        'The Import Session changed after it was opened.',
        409,
      );
    if (session.previewFingerprint !== input.expectedPreviewFingerprint)
      throw new DomainError('IMPORT_PREVIEW_STALE', 'The inspection preview changed.', 409);
    const authorities = (
      this.database
        .prepare(
          `SELECT ir.*, ist.mapping_fingerprint FROM import_rows ir
       JOIN import_source_tables ist ON ist.source_table_id = ir.source_table_id
       WHERE ir.import_session_id = ? AND ist.selected = 1
       ORDER BY ist.source_ordinal, ir.source_row_number, ir.import_row_id`,
        )
        .all(sessionId) as Row[]
    )
      .filter((row) => String(row.apply_state) !== 'APPLIED')
      .map((row) => ({
        row,
        mappingFingerprint: String(row.mapping_fingerprint),
        values: valuesFrom(row),
      }));
    const tags = authorities
      .map((item) => canonicalizeLuminaireTag(text(item.values, 'TAG')))
      .filter(Boolean);
    const projectMatches = this.writes.canonicalMatches(session.projectId, tags);
    const bindings = new Map(
      (
        this.database
          .prepare('SELECT * FROM project_luminaire_library_bindings WHERE project_id = ?')
          .all(session.projectId) as Row[]
      ).map((row) => [String(row.luminaire_id), row]),
    );
    const published = catalogue(this.database);
    const drafts = authorities.map((authority) => {
      const rawTag = text(authority.values, 'TAG');
      const canonicalTag = canonicalizeLuminaireTag(rawTag);
      const matches = canonicalTag
        ? (projectMatches.get(normalizeLuminaireTag(canonicalTag)) ?? [])
        : [];
      const invalidTag = rawTag.length > 40;
      const state = !rawTag
        ? 'TAG_ABSENT'
        : invalidTag
          ? 'TAG_INVALID'
          : matches.length > 1
            ? 'TAG_AMBIGUOUS'
            : matches.length === 0
              ? 'TAG_NEW'
              : bindings.has(matches[0]!.id)
                ? 'TAG_LIBRARY_LINKED'
                : 'TAG_PROJECT_ONLY';
      const target = matches.length === 1 ? matches[0]! : null;
      const binding = target ? bindings.get(target.id) : undefined;
      const normalizedMaker = normalizeManufacturerName(text(authority.values, 'MANUFACTURER'));
      const normalizedCode = normalizeLuminaireOrderingCode(
        text(authority.values, 'ORDERING_CODE'),
      );
      const exactVersions =
        normalizedMaker && normalizedCode
          ? published.filter(
              (item) =>
                item.normalizedManufacturer === normalizedMaker &&
                item.normalizedOrderingCode === normalizedCode,
            )
          : [];
      const latest = exactVersions.find((item) => item.isLatest) ?? null;
      const productSignal = text(authority.values, 'PRODUCT_FAMILY').toLocaleLowerCase('en');
      const variantSignal = text(authority.values, 'VARIANT_LABEL').toLocaleLowerCase('en');
      const possible = latest
        ? []
        : published
            .filter((item) => item.isLatest)
            .map((item) => {
              const reasons: string[] = [];
              if (normalizedMaker && item.normalizedManufacturer === normalizedMaker)
                reasons.push('Manufacturer');
              if (productSignal && item.normalizedProductName.includes(productSignal))
                reasons.push('Product family');
              if (variantSignal && item.normalizedVariantLabel.includes(variantSignal))
                reasons.push('Variant label');
              return { ...item, matchReasons: reasons };
            })
            .filter((item) => item.matchReasons.length > 0)
            .sort(
              (a, b) =>
                b.matchReasons.length - a.matchReasons.length ||
                a.versionId.localeCompare(b.versionId),
            )
            .slice(0, 5);
      const allowed: ImportRowAction['type'][] = ['SKIP'];
      if (state === 'TAG_NEW') {
        allowed.unshift('PROJECT_CREATE_ONLY');
        if (latest) allowed.unshift('PROJECT_ADD_FROM_LIBRARY');
      }
      if (state === 'TAG_PROJECT_ONLY' || state === 'TAG_LIBRARY_LINKED')
        allowed.unshift('PROJECT_UPDATE_EXISTING');
      const recommended =
        state === 'TAG_NEW' && latest
          ? 'PROJECT_ADD_FROM_LIBRARY'
          : state === 'TAG_NEW'
            ? 'PROJECT_CREATE_ONLY'
            : state === 'TAG_PROJECT_ONLY' || state === 'TAG_LIBRARY_LINKED'
              ? 'PROJECT_UPDATE_EXISTING'
              : null;
      const warnings =
        state === 'TAG_AMBIGUOUS'
          ? ['Multiple historical Project Luminaires share this canonical Tag.']
          : state === 'TAG_ABSENT'
            ? ['A valid Project Tag is required.']
            : state === 'TAG_INVALID'
              ? ['The Project Tag is invalid.']
              : [];
      const ignoredLinkedChanges =
        state === 'TAG_LIBRARY_LINKED' && target
          ? Object.entries(FIELD_MAP).flatMap(([canonical, field]) => {
              if (['category', 'location', 'unit', 'quantity', 'notes'].includes(field)) return [];
              const imported = authority.values.get(canonical as ImportCanonicalField);
              const current = target[field as keyof LuminaireRecord];
              if (
                imported === undefined ||
                String(imported).trim() === '' ||
                String(imported) === String(current)
              )
                return [];
              return [
                {
                  field,
                  imported,
                  current: current as string | number,
                  reason: 'Published Library Version owns this technical field.' as const,
                },
              ];
            })
          : [];
      return {
        authority,
        canonicalTag: canonicalTag || null,
        state,
        matches,
        target,
        binding,
        exactVersions,
        latest,
        possible,
        allowed,
        recommended,
        warnings,
        ignoredLinkedChanges,
      };
    });
    const destinationFingerprint = importAuthorityFingerprint(
      drafts.map((item) => ({
        rowId: String(item.authority.row.import_row_id),
        canonicalTag: item.canonicalTag,
        state: item.state,
        targets: item.matches.map((match) => ({ id: match.id, rowVersion: match.rowVersion })),
        binding: item.binding
          ? {
              luminaireId: String(item.binding.luminaire_id),
              rowVersion: Number(item.binding.row_version),
              selectedVersionId: String(item.binding.selected_version_id),
            }
          : null,
        library: item.latest
          ? {
              versionId: item.latest.versionId,
              manufacturerRowVersion: item.latest.manufacturerRowVersion,
              productRowVersion: item.latest.productRowVersion,
              variantRowVersion: item.latest.variantRowVersion,
            }
          : null,
      })),
    );
    const reconciliations = drafts.map((item) => {
      const base = {
        schemaVersion: 1 as const,
        inspectionFingerprint: input.expectedPreviewFingerprint,
        sourceRowFingerprint: String(item.authority.row.source_row_fingerprint),
        mappingFingerprint: item.authority.mappingFingerprint,
        destinationFingerprint,
        canonicalTag: item.canonicalTag,
        projectState: item.state,
        projectCandidateCount: item.matches.length,
        projectLuminaireId: item.target?.id ?? null,
        expectedProjectRowVersion: item.target?.rowVersion ?? null,
        bindingId: item.binding ? String(item.binding.luminaire_id) : null,
        expectedBindingRowVersion: item.binding ? Number(item.binding.row_version) : null,
        selectedLibraryVersionId: item.latest?.versionId ?? null,
        exactLibraryMatch: item.latest ? publicCandidate(item.latest) : null,
        availableLibraryVersions: item.exactVersions.slice(0, 20).map(publicCandidate),
        possibleLibraryMatches: item.possible.map(publicCandidate),
        ignoredLinkedChanges: item.ignoredLinkedChanges,
        allowedActions: item.allowed,
        recommendedAction: item.recommended,
        warnings: item.warnings,
        reconciledAt: this.clock().toISOString(),
      };
      return importProjectReconciliationSchema.parse({
        ...base,
        reconciliationFingerprint: importAuthorityFingerprint(base),
      });
    });
    return this.store.transaction(() => {
      const current = this.store.get(sessionId);
      if (
        current.sessionRevision !== input.expectedSessionRevision ||
        current.previewFingerprint !== input.expectedPreviewFingerprint
      )
        throw new DomainError(
          'IMPORT_PREVIEW_STALE',
          'The Import Session changed during reconciliation.',
          409,
        );
      const now = this.clock().toISOString();
      const update = this.database.prepare(
        `UPDATE import_rows SET reconciliation_json = ?, intended_action = NULL,
           row_status = ?, row_version = row_version + 1, updated_at = ?
         WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      );
      reconciliations.forEach((reconciliation, index) =>
        update.run(
          JSON.stringify(reconciliation),
          ['TAG_ABSENT', 'TAG_INVALID', 'TAG_AMBIGUOUS'].includes(reconciliation.projectState) ||
            hasBlockingValidation(drafts[index]!.authority.row)
            ? 'BLOCKED'
            : 'NEEDS_REVIEW',
          now,
          sessionId,
          String(drafts[index]!.authority.row.import_row_id),
        ),
      );
      this.database
        .prepare(
          `UPDATE import_sessions SET destination_fingerprint = ?, apply_plan_fingerprint = NULL,
           session_revision = session_revision + 1, session_status = 'NEEDS_REVIEW', updated_at = ?
         WHERE import_session_id = ? AND session_revision = ?`,
        )
        .run(destinationFingerprint, now, sessionId, input.expectedSessionRevision);
      return this.store.get(sessionId);
    });
  }

  public setAction(sessionId: string, rowId: string, input: UpdateImportRowActionInput) {
    const session = this.store.get(sessionId);
    if (session.sessionRevision !== input.expectedSessionRevision)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Import review changed.', 409);
    const row = this.store.row(sessionId, rowId);
    if (
      row.rowVersion !== input.expectedRowVersion ||
      !row.reconciliation ||
      row.reconciliation.schemaVersion !== 1
    )
      throw new DomainError('IMPORT_PLAN_STALE', 'The Import row changed.', 409);
    if (row.applyState === 'APPLIED')
      throw new DomainError('IMPORT_ACTION_INVALID', 'Applied rows are immutable.', 409);
    if (
      ![
        'PROJECT_CREATE_ONLY',
        'PROJECT_UPDATE_EXISTING',
        'PROJECT_ADD_FROM_LIBRARY',
        'SKIP',
      ].includes(input.action.type) ||
      !row.reconciliation.allowedActions.includes(
        input.action.type as
          'PROJECT_CREATE_ONLY' | 'PROJECT_UPDATE_EXISTING' | 'PROJECT_ADD_FROM_LIBRARY' | 'SKIP',
      )
    )
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'This action is not allowed for the reconciled row.',
        409,
      );
    const raw = this.database
      .prepare('SELECT * FROM import_rows WHERE import_row_id = ? AND import_session_id = ?')
      .get(rowId, sessionId) as Row;
    const values = valuesFrom(raw);
    const basis = {
      sourceRowFingerprint: row.sourceRowFingerprint,
      mappingFingerprint: row.reconciliation.mappingFingerprint,
      reconciliationFingerprint: row.reconciliation.reconciliationFingerprint,
    };
    let action: ImportProjectRowAction;
    if (input.action.type === 'SKIP') action = { type: 'SKIP', reason: input.action.reason };
    else if (input.action.type === 'PROJECT_CREATE_ONLY') {
      const tag = row.reconciliation.canonicalTag!;
      action = {
        type: 'PROJECT_CREATE_ONLY',
        canonicalTag: tag,
        payload: materializePayload(values, tag),
        basis,
      };
    } else if (input.action.type === 'PROJECT_ADD_FROM_LIBRARY') {
      const selectedVersionId = input.action.versionId;
      const selected = row.reconciliation.availableLibraryVersions.find(
        (item) => item.versionId === selectedVersionId,
      );
      if (!selected)
        throw new DomainError(
          'IMPORT_LIBRARY_VERSION_UNAVAILABLE',
          'The selected Published Version is unavailable.',
          409,
        );
      action = {
        type: 'PROJECT_ADD_FROM_LIBRARY',
        canonicalTag: row.reconciliation.canonicalTag!,
        versionId: selected.versionId,
        manufacturerId: selected.manufacturerId,
        productId: selected.productId,
        variantId: selected.variantId,
        expectedManufacturerRowVersion: selected.manufacturerRowVersion,
        expectedProductRowVersion: selected.productRowVersion,
        expectedVariantRowVersion: selected.variantRowVersion,
        project: {
          category: text(values, 'PROJECT_CATEGORY'),
          location: text(values, 'LOCATION'),
          unit: text(values, 'UNIT') || 'No.',
          quantity: typeof values.get('QUANTITY') === 'number' ? Number(values.get('QUANTITY')) : 0,
          notes: text(values, 'NOTES'),
          descriptionOverride: text(values, 'DESCRIPTION_OVERRIDE'),
        },
        olderPublishedVersion: !selected.isLatest,
        basis,
      };
    } else if (input.action.type === 'PROJECT_UPDATE_EXISTING') {
      const target = this.writes.get(session.projectId!, row.reconciliation.projectLuminaireId!);
      const changes = Object.entries(FIELD_MAP).flatMap(([canonical, field]) => {
        const value = values.get(canonical as ImportCanonicalField);
        if (
          value === undefined ||
          String(value).trim() === '' ||
          target[field as keyof LuminaireRecord] === value
        )
          return [];
        if (
          row.reconciliation!.schemaVersion === 1 &&
          row.reconciliation!.projectState === 'TAG_LIBRARY_LINKED' &&
          !['category', 'location', 'unit', 'quantity', 'notes'].includes(field)
        )
          return [];
        return [
          {
            field,
            before: target[field as keyof LuminaireRecord] as string | number,
            after: value,
          },
        ];
      });
      const override =
        row.reconciliation.projectState === 'TAG_LIBRARY_LINKED'
          ? text(values, 'DESCRIPTION_OVERRIDE')
          : '';
      const currentOverride =
        row.reconciliation.projectState === 'TAG_LIBRARY_LINKED'
          ? ((
              this.database
                .prepare(
                  'SELECT description_override FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
                )
                .get(session.projectId, target.id) as
                { description_override: string | null } | undefined
            )?.description_override ?? null)
          : null;
      action = {
        type: 'PROJECT_UPDATE_EXISTING',
        projectLuminaireId: target.id,
        expectedProjectRowVersion: target.rowVersion,
        expectedCanonicalTag: row.reconciliation.canonicalTag!,
        targetKind:
          row.reconciliation.projectState === 'TAG_LIBRARY_LINKED'
            ? 'LIBRARY_LINKED'
            : 'PROJECT_ONLY',
        expectedBindingRowVersion: row.reconciliation.expectedBindingRowVersion,
        changes,
        descriptionOverride:
          override && override !== currentOverride
            ? { before: currentOverride, after: override }
            : null,
        basis,
      } as ImportProjectRowAction;
    } else
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Library actions are unavailable for Project imports.',
        409,
      );
    action = importProjectRowActionSchema.parse(action);
    return this.store.transaction(() => {
      const now = this.clock().toISOString();
      const changed = this.database
        .prepare(
          `UPDATE import_rows SET intended_action = ?, row_status = ?, row_version = row_version + 1, updated_at = ?
         WHERE import_session_id = ? AND import_row_id = ? AND row_version = ? AND apply_state <> 'APPLIED'`,
        )
        .run(
          JSON.stringify(action),
          action.type === 'SKIP' ? 'SKIPPED' : 'READY',
          now,
          sessionId,
          rowId,
          input.expectedRowVersion,
        );
      if (changed.changes !== 1)
        throw new DomainError('IMPORT_PLAN_STALE', 'The Import row changed.', 409);
      this.database
        .prepare(
          `UPDATE import_sessions SET session_revision = session_revision + 1,
           apply_plan_fingerprint = NULL, updated_at = ? WHERE import_session_id = ? AND session_revision = ?`,
        )
        .run(now, sessionId, input.expectedSessionRevision);
      this.refreshPlan(sessionId);
      return this.store.row(sessionId, rowId);
    });
  }

  public refreshPlan(sessionId: string): string | null {
    const session = this.store.get(sessionId);
    const rows = this.database
      .prepare(
        `SELECT import_row_id, row_version, intended_action FROM import_rows
       WHERE import_session_id = ? AND apply_state <> 'APPLIED' ORDER BY import_row_id`,
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

  public setBulkActions(sessionId: string, input: BulkUpdateImportRowActionsInput) {
    const session = this.store.get(sessionId);
    if (session.sessionRevision !== input.expectedSessionRevision)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Import review changed.', 409);
    if (session.destinationMode !== 'PROJECT' || !session.projectId)
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Bulk Project review is unavailable for this destination.',
        409,
      );
    const projectId = session.projectId;
    const uniqueIds = [...new Set(input.rowIds)];
    if (uniqueIds.length !== input.rowIds.length)
      throw new DomainError('IMPORT_ACTION_INVALID', 'Bulk row identities must be unique.', 400);
    const materialized = uniqueIds.map((rowId) => {
      const row = this.store.row(sessionId, rowId);
      const reconciliation = row.reconciliation;
      if (!reconciliation || reconciliation.schemaVersion !== 1 || row.applyState === 'APPLIED')
        throw new DomainError(
          'IMPORT_ACTION_INVALID',
          'A selected row is not eligible for bulk review.',
          409,
        );
      const raw = this.database
        .prepare('SELECT * FROM import_rows WHERE import_row_id = ? AND import_session_id = ?')
        .get(rowId, sessionId) as Row;
      const values = valuesFrom(raw);
      const basis = {
        sourceRowFingerprint: row.sourceRowFingerprint,
        mappingFingerprint: reconciliation.mappingFingerprint,
        reconciliationFingerprint: reconciliation.reconciliationFingerprint,
      };
      let action: ImportProjectRowAction;
      if ('action' in input) {
        if (
          !['PROJECT_CREATE_ONLY', 'PROJECT_ADD_FROM_LIBRARY', 'SKIP'].includes(input.action) ||
          !reconciliation.allowedActions.includes(
            input.action as 'PROJECT_CREATE_ONLY' | 'PROJECT_ADD_FROM_LIBRARY' | 'SKIP',
          )
        )
          throw new DomainError(
            'IMPORT_ACTION_INVALID',
            'A selected row does not allow this bulk action.',
            409,
          );
        if (input.action === 'SKIP')
          action = { type: 'SKIP', reason: 'Owner bulk-skipped during Project Apply review.' };
        else if (input.action === 'PROJECT_CREATE_ONLY') {
          action = {
            type: 'PROJECT_CREATE_ONLY',
            canonicalTag: reconciliation.canonicalTag!,
            payload: materializePayload(values, reconciliation.canonicalTag!),
            basis,
          };
        } else if (input.action === 'PROJECT_ADD_FROM_LIBRARY') {
          const selected = reconciliation.exactLibraryMatch;
          if (!selected)
            throw new DomainError(
              'IMPORT_LIBRARY_VERSION_UNAVAILABLE',
              'An exact latest Published Version is required.',
              409,
            );
          action = {
            type: 'PROJECT_ADD_FROM_LIBRARY',
            canonicalTag: reconciliation.canonicalTag!,
            versionId: selected.versionId,
            manufacturerId: selected.manufacturerId,
            productId: selected.productId,
            variantId: selected.variantId,
            expectedManufacturerRowVersion: selected.manufacturerRowVersion,
            expectedProductRowVersion: selected.productRowVersion,
            expectedVariantRowVersion: selected.variantRowVersion,
            project: {
              category: text(values, 'PROJECT_CATEGORY'),
              location: text(values, 'LOCATION'),
              unit: text(values, 'UNIT') || 'No.',
              quantity:
                typeof values.get('QUANTITY') === 'number' ? Number(values.get('QUANTITY')) : 0,
              notes: text(values, 'NOTES'),
              descriptionOverride: text(values, 'DESCRIPTION_OVERRIDE'),
            },
            olderPublishedVersion: false,
            basis,
          };
        } else
          throw new DomainError(
            'IMPORT_ACTION_INVALID',
            'Library bulk actions are unavailable for Project imports.',
            409,
          );
      } else {
        const currentAction = row.intendedAction;
        if (!currentAction || currentAction.type === 'SKIP')
          throw new DomainError(
            'IMPORT_ACTION_INVALID',
            'Select a mutation action before setting planned Project fields.',
            409,
          );
        if (currentAction.type === 'PROJECT_CREATE_ONLY') {
          const payload = { ...currentAction.payload };
          if (input.projectFields.category !== undefined)
            payload.category = input.projectFields.category;
          if (input.projectFields.location !== undefined)
            payload.location = input.projectFields.location;
          if (input.projectFields.unit !== undefined) payload.unit = input.projectFields.unit;
          if (input.projectFields.quantity !== undefined)
            payload.quantity = input.projectFields.quantity;
          action = {
            ...currentAction,
            payload,
          };
        } else if (currentAction.type === 'PROJECT_ADD_FROM_LIBRARY') {
          const project = { ...currentAction.project };
          if (input.projectFields.category !== undefined)
            project.category = input.projectFields.category;
          if (input.projectFields.location !== undefined)
            project.location = input.projectFields.location;
          if (input.projectFields.unit !== undefined) project.unit = input.projectFields.unit;
          if (input.projectFields.quantity !== undefined)
            project.quantity = input.projectFields.quantity;
          action = {
            ...currentAction,
            project,
          };
        } else if (currentAction.type === 'PROJECT_UPDATE_EXISTING') {
          const target = this.writes.get(projectId, currentAction.projectLuminaireId);
          if (target.rowVersion !== currentAction.expectedProjectRowVersion)
            throw new DomainError(
              'IMPORT_TARGET_CHANGED',
              'A selected Project Luminaire changed after planning.',
              409,
            );
          const fields = Object.entries(input.projectFields).filter(
            (entry): entry is ['category' | 'location' | 'unit' | 'quantity', string | number] =>
              entry[1] !== undefined,
          ) as Array<['category' | 'location' | 'unit' | 'quantity', string | number]>;
          const selectedFields = new Set(fields.map(([field]) => field));
          const changes = currentAction.changes.filter(
            (change) =>
              !selectedFields.has(change.field as 'category' | 'location' | 'unit' | 'quantity'),
          );
          for (const [field, after] of fields) {
            const before = target[field];
            if (before !== after) changes.push({ field, before, after });
          }
          action = { ...currentAction, changes };
        } else
          throw new DomainError(
            'IMPORT_ACTION_INVALID',
            'Persisted Library actions are invalid for Project imports.',
            409,
          );
      }
      return { row, action: importProjectRowActionSchema.parse(action) };
    });
    return this.store.transaction(() => {
      const now = this.clock().toISOString();
      const update = this.database.prepare(
        `UPDATE import_rows SET intended_action = ?, row_status = ?, row_version = row_version + 1, updated_at = ?
         WHERE import_session_id = ? AND import_row_id = ? AND row_version = ? AND apply_state <> 'APPLIED'`,
      );
      for (const item of materialized) {
        const result = update.run(
          JSON.stringify(item.action),
          item.action.type === 'SKIP' ? 'SKIPPED' : 'READY',
          now,
          sessionId,
          item.row.importRowId,
          item.row.rowVersion,
        );
        if (result.changes !== 1)
          throw new DomainError('IMPORT_PLAN_STALE', 'A selected Import row changed.', 409);
      }
      const advanced = this.database
        .prepare(
          `UPDATE import_sessions SET session_revision = session_revision + 1,
         apply_plan_fingerprint = NULL, updated_at = ? WHERE import_session_id = ? AND session_revision = ?`,
        )
        .run(now, sessionId, input.expectedSessionRevision);
      if (advanced.changes !== 1)
        throw new DomainError('IMPORT_PLAN_STALE', 'The Import review changed.', 409);
      this.refreshPlan(sessionId);
      return this.store.get(sessionId);
    });
  }
}
