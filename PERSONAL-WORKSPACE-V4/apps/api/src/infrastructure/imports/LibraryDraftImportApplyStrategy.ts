import type { DatabaseSync } from 'node:sqlite';
import {
  importLibraryResultIdentitySchema,
  importLibraryRowActionSchema,
  type ImportLibraryResultIdentity,
} from '@scli/contracts';
import { DomainError, type AppUser } from '@scli/domain';
import { ImportSessionStore } from './ImportSessionStore.js';
import type { LuminaireLibraryDraftWritePort } from './LuminaireLibraryDraftWritePort.js';

type Row = Readonly<Record<string, unknown>>;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface ImportDestinationApplyResult {
  applied: number;
  failed: number;
  errorSummary: string | null;
}

export interface ImportDestinationApplyStrategy {
  validate(rows: Row[]): void;
  execute(
    sessionId: string,
    attemptId: string,
    rows: Row[],
    actor: AppUser,
  ): ImportDestinationApplyResult;
}

export class LibraryDraftImportApplyStrategy implements ImportDestinationApplyStrategy {
  private readonly database: DatabaseSync;

  public constructor(
    private readonly store: ImportSessionStore,
    private readonly library: LuminaireLibraryDraftWritePort,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.database = store.getDatabase();
  }

  public validate(rows: Row[]): void {
    const catalogue = this.library.catalogue();
    const makerById = new Map(catalogue.manufacturers.map((item) => [item.manufacturerId, item]));
    const productById = new Map(catalogue.products.map((item) => [item.productId, item]));
    const variantById = new Map(catalogue.variants.map((item) => [item.variantId, item]));
    const makerNames = new Set(catalogue.manufacturers.map((item) => item.normalizedName));
    const productKeys = new Set(
      catalogue.products.map((item) => `${item.manufacturerId}|${item.normalizedName}`),
    );
    const variantCodeKeys = new Set(
      catalogue.variants
        .filter((item) => item.normalizedOrderingCode)
        .map((item) => `${item.manufacturerId}|${item.normalizedOrderingCode}`),
    );
    const sessionIds = [...new Set(rows.map((row) => String(row.import_session_id)))];
    if (sessionIds.length > 1)
      throw new DomainError('IMPORT_PLAN_STALE', 'Library Apply rows cross sessions.', 409);
    const destinationFingerprint =
      sessionIds.length === 0
        ? null
        : String(
            (
              this.database
                .prepare(
                  'SELECT destination_fingerprint FROM import_sessions WHERE import_session_id = ?',
                )
                .get(sessionIds[0]!) as Row
            ).destination_fingerprint,
          );
    const groupParents = new Map<string, string>();
    for (const row of rows) {
      const action = importLibraryRowActionSchema.parse(json(row.intended_action, null));
      if (action.type === 'SKIP' || action.type === 'LIBRARY_REVIEW_EXISTING') continue;
      const reconciliation = json<{ reconciliationFingerprint?: string }>(
        row.reconciliation_json,
        {},
      );
      if (
        action.basis.sourceRowFingerprint !== String(row.source_row_fingerprint) ||
        action.basis.mappingFingerprint !== String(row.current_mapping_fingerprint) ||
        action.basis.reconciliationFingerprint !== reconciliation.reconciliationFingerprint ||
        action.basis.importRowVersion !== Number(row.row_version) ||
        action.basis.destinationFingerprint !== destinationFingerprint
      )
        throw new DomainError(
          'IMPORT_PLAN_STALE',
          'Persisted Library row authority changed after planning.',
          409,
        );
      if (action.type === 'LIBRARY_USE_EXISTING') {
        const maker = makerById.get(action.manufacturerId);
        const product = productById.get(action.productId);
        const variant = variantById.get(action.variantId);
        if (
          !maker ||
          !product ||
          !variant ||
          maker.status !== 'ACTIVE' ||
          product.status !== 'ACTIVE' ||
          variant.status !== 'ACTIVE' ||
          maker.rowVersion !== action.expectedManufacturer.expectedRowVersion ||
          product.rowVersion !== action.expectedProduct.expectedRowVersion ||
          variant.rowVersion !== action.expectedVariant.expectedRowVersion ||
          variant.latestPublishedVersionId !== action.latestPublishedVersionId
        )
          throw new DomainError(
            'IMPORT_DESTINATION_CHANGED',
            'The selected existing Variant changed.',
            409,
          );
        continue;
      }
      const parentKey = `${action.manufacturer.manufacturerId}|${action.product.productId}`;
      const prior = groupParents.get(action.product.productGroupId);
      if (prior && prior !== parentKey)
        throw new DomainError(
          'IMPORT_PLAN_STALE',
          'A Product group contains inconsistent planned identities.',
          409,
        );
      groupParents.set(action.product.productGroupId, parentKey);
      if (action.publish !== false || action.variant.assetVersionIds.length !== 0)
        throw new DomainError(
          'IMPORT_ACTION_INVALID',
          'Library Draft Apply cannot publish or copy assets.',
          409,
        );
      if (action.manufacturer.mode === 'EXISTING') {
        const maker = makerById.get(action.manufacturer.manufacturerId);
        if (
          !maker ||
          maker.status !== 'ACTIVE' ||
          maker.rowVersion !== action.manufacturer.expected?.expectedRowVersion
        )
          throw new DomainError(
            'IMPORT_DESTINATION_CHANGED',
            'The planned Manufacturer changed.',
            409,
          );
      } else if (makerNames.has(action.manufacturer.normalizedName))
        throw new DomainError(
          'IMPORT_DESTINATION_CHANGED',
          'A matching Manufacturer appeared after planning.',
          409,
        );
      if (action.product.mode === 'EXISTING') {
        const product = productById.get(action.product.productId);
        if (
          !product ||
          product.status !== 'ACTIVE' ||
          product.manufacturerId !== action.manufacturer.manufacturerId ||
          product.rowVersion !== action.product.expected?.expectedRowVersion
        )
          throw new DomainError('IMPORT_DESTINATION_CHANGED', 'The planned Product changed.', 409);
      } else if (
        productKeys.has(`${action.manufacturer.manufacturerId}|${action.product.normalizedFamily}`)
      )
        throw new DomainError(
          'IMPORT_DESTINATION_CHANGED',
          'A matching Product appeared after planning.',
          409,
        );
      if (
        action.variant.normalizedOrderingCode &&
        variantCodeKeys.has(
          `${action.manufacturer.manufacturerId}|${action.variant.normalizedOrderingCode}`,
        )
      )
        throw new DomainError(
          'IMPORT_DESTINATION_CHANGED',
          'The planned Ordering Code is no longer available.',
          409,
        );
    }
  }

  public execute(
    sessionId: string,
    attemptId: string,
    rows: Row[],
    actor: AppUser,
  ): ImportDestinationApplyResult {
    let applied = 0;
    let failed = 0;
    const nonMutating = rows.filter((row) => {
      const action = importLibraryRowActionSchema.parse(json(row.intended_action, null));
      return action.type !== 'LIBRARY_CREATE_DRAFT' && action.type !== 'LIBRARY_REVIEW_EXISTING';
    });
    for (const row of nonMutating) {
      try {
        this.store.transaction(() => {
          const action = importLibraryRowActionSchema.parse(json(row.intended_action, null));
          if (action.type === 'SKIP')
            this.markResult(sessionId, attemptId, row, {
              outcome: 'SKIPPED',
              mutationOccurred: false,
              manufacturerId: null,
              productId: null,
              variantId: null,
              latestPublishedVersionId: null,
              manufacturerCreated: false,
              productCreated: false,
            });
          else if (action.type === 'LIBRARY_USE_EXISTING')
            this.markResult(sessionId, attemptId, row, {
              outcome: 'USED_EXISTING',
              mutationOccurred: false,
              manufacturerId: action.manufacturerId,
              productId: action.productId,
              variantId: action.variantId,
              latestPublishedVersionId: action.latestPublishedVersionId,
              manufacturerCreated: false,
              productCreated: false,
            });
          else
            throw new DomainError(
              'IMPORT_ACTION_INVALID',
              'Review Existing is not an Apply action.',
              409,
            );
        });
        applied += 1;
      } catch (error) {
        failed += 1;
        this.recordFailure(sessionId, attemptId, row, error);
      }
    }
    const createRows = rows.filter(
      (row) =>
        importLibraryRowActionSchema.parse(json(row.intended_action, null)).type ===
        'LIBRARY_CREATE_DRAFT',
    );
    const groups = new Map<string, Row[]>();
    for (const row of createRows) {
      const action = importLibraryRowActionSchema.parse(json(row.intended_action, null));
      if (action.type !== 'LIBRARY_CREATE_DRAFT') continue;
      const bucket = groups.get(action.product.productGroupId) ?? [];
      bucket.push(row);
      groups.set(action.product.productGroupId, bucket);
    }
    const createdManufacturers = new Set<string>();
    const createdProducts = new Set<string>();
    for (const [productGroupId, groupRows] of [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      for (let offset = 0; offset < groupRows.length; offset += 100) {
        const batch = groupRows.slice(offset, offset + 100);
        try {
          this.library.transaction(() => {
            const first = importLibraryRowActionSchema.parse(json(batch[0]!.intended_action, null));
            if (first.type !== 'LIBRARY_CREATE_DRAFT')
              throw new DomainError('IMPORT_ACTION_INVALID', 'Invalid Library create batch.', 409);
            const provenanceBase = this.provenance(sessionId, first.product.productGroupId, null);
            let manufacturerCreated = false;
            if (first.manufacturer.mode === 'CREATE') {
              this.library.createManufacturer(
                first.manufacturer.manufacturerId,
                first.manufacturer.name,
                actor,
                `import:${sessionId}:manufacturer:${first.manufacturer.manufacturerGroupId}`,
                provenanceBase,
              );
              manufacturerCreated = !createdManufacturers.has(first.manufacturer.manufacturerId);
              createdManufacturers.add(first.manufacturer.manufacturerId);
            }
            let productCreated = false;
            if (first.product.mode === 'CREATE') {
              this.library.createProduct(
                first.product.productId,
                first.manufacturer.manufacturerId,
                first.product.family,
                first.product.productType,
                first.product.description,
                actor,
                `import:${sessionId}:product:${first.product.productGroupId}`,
                provenanceBase,
              );
              productCreated = !createdProducts.has(first.product.productId);
              createdProducts.add(first.product.productId);
            }
            batch.forEach((row, rowIndex) => {
              const action = importLibraryRowActionSchema.parse(json(row.intended_action, null));
              if (
                action.type !== 'LIBRARY_CREATE_DRAFT' ||
                action.product.productGroupId !== productGroupId
              )
                throw new DomainError('IMPORT_PLAN_STALE', 'A Library Product group changed.', 409);
              this.library.createVariant(
                action.product.productId,
                action.variant,
                actor,
                `import:${sessionId}:variant:${String(row.import_row_id)}:${action.basis.reconciliationFingerprint}`,
                this.provenance(sessionId, productGroupId, String(row.import_row_id)),
              );
              this.markResult(sessionId, attemptId, row, {
                outcome: 'DRAFT_CREATED',
                mutationOccurred: true,
                manufacturerId: action.manufacturer.manufacturerId,
                productId: action.product.productId,
                variantId: action.variant.plannedVariantId,
                latestPublishedVersionId: null,
                manufacturerCreated: rowIndex === 0 && manufacturerCreated,
                productCreated: rowIndex === 0 && productCreated,
              });
            });
          });
          applied += batch.length;
        } catch (error) {
          failed += batch.length;
          for (const row of batch) this.recordFailure(sessionId, attemptId, row, error);
        }
      }
    }
    return {
      applied,
      failed,
      errorSummary: failed
        ? `${failed} Library row(s) failed; each failed Product batch was rolled back.`
        : null,
    };
  }

  private provenance(sessionId: string, groupId: string, rowId: string | null) {
    const session = this.store.get(sessionId);
    return {
      importSessionId: sessionId,
      importRowId: rowId,
      groupId,
      sourceSha256: session.sourceSha256,
      sourceFileName: session.sourceFileName,
      publish: false,
      assetVersionIds: [],
    };
  }

  private markResult(
    sessionId: string,
    attemptId: string,
    row: Row,
    value: Omit<
      ImportLibraryResultIdentity,
      'schemaVersion' | 'applyAttemptId' | 'appliedAt' | 'failureCode' | 'retryEligible'
    >,
  ): void {
    const result = importLibraryResultIdentitySchema.parse({
      schemaVersion: 2,
      ...value,
      applyAttemptId: attemptId,
      appliedAt: this.clock().toISOString(),
      failureCode: null,
      retryEligible: false,
    });
    const changed = this.database
      .prepare(
        `UPDATE import_rows SET apply_state = 'APPLIED', row_status = ?, result_identity_json = ?,
         row_version = row_version + 1, updated_at = ?
         WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      )
      .run(
        value.outcome === 'SKIPPED' ? 'SKIPPED' : 'APPLIED',
        JSON.stringify(result),
        this.clock().toISOString(),
        sessionId,
        String(row.import_row_id),
      );
    if (changed.changes !== 1)
      throw new DomainError('IMPORT_PLAN_STALE', 'The Library row was already applied.', 409);
  }

  private recordFailure(sessionId: string, attemptId: string, row: Row, error: unknown): void {
    const domain =
      error instanceof DomainError
        ? error
        : new DomainError('CONFLICT', 'Library Draft Apply failed.', 409);
    const result = importLibraryResultIdentitySchema.parse({
      schemaVersion: 2,
      outcome: 'FAILED',
      mutationOccurred: false,
      manufacturerId: null,
      productId: null,
      variantId: null,
      latestPublishedVersionId: null,
      manufacturerCreated: false,
      productCreated: false,
      applyAttemptId: attemptId,
      appliedAt: this.clock().toISOString(),
      failureCode: domain.code,
      retryEligible: ['IMPORT_DESTINATION_CHANGED', 'IMPORT_PLAN_STALE'].includes(domain.code),
    });
    this.database
      .prepare(
        `UPDATE import_rows SET apply_state = 'FAILED', row_status = 'FAILED', result_identity_json = ?,
         row_version = row_version + 1, updated_at = ?
         WHERE import_session_id = ? AND import_row_id = ? AND apply_state <> 'APPLIED'`,
      )
      .run(
        JSON.stringify(result),
        this.clock().toISOString(),
        sessionId,
        String(row.import_row_id),
      );
  }
}
