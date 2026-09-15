import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AppUser,
  LuminaireLibraryAsset,
  LuminaireLibraryAssetType,
  LuminaireLibraryAssetVersion,
  LuminaireLibraryProduct,
  LuminaireLibraryVariant,
  LuminaireLibraryVariantDraft,
  LuminaireLibraryVersion,
  LuminaireLibraryVersionSnapshot,
  LuminaireManufacturer,
  ProjectLuminaireLibraryBinding,
} from '@scli/domain';
import {
  canonicalLuminaireLibrarySnapshot,
  deriveLuminaireEfficacy,
  DomainError,
  normalizeLuminaireFacet,
  normalizeLuminaireOrderingCode,
  normalizeLuminaireTechnicalValues,
  normalizeManufacturerName,
  parseLuminaireBeamDegrees,
  parseLuminaireCctKelvin,
  parseLuminaireCri,
  parseLuminaireLumens,
  parseLuminaireWattage,
} from '@scli/domain';
import type {
  CreateLuminaireLibraryAssetInput,
  CreateLuminaireLibraryProductInput,
  CreateLuminaireLibraryVariantInput,
  CreateLuminaireManufacturerInput,
  CreateProjectLuminaireLibraryDraftInput,
  LuminaireLibraryListQuery,
  PublishLuminaireLibraryVariantInput,
  UpdateLuminaireLibraryProductDraftInput,
  UpdateLuminaireLibraryVariantDraftInput,
  UpdateLuminaireManufacturerInput,
} from '@scli/contracts';

type Row = Readonly<Record<string, unknown>>;
export interface LibraryPage<T> {
  items: T[];
  nextCursor: string | null;
  totalProducts?: number;
  totalVariants?: number;
  facets?: LibraryFacets;
}
export interface LibraryFacetOption {
  value: string;
  label: string;
  count: number;
}
export interface LibraryFacets {
  manufacturers: LibraryFacetOption[];
  productTypes: LibraryFacetOption[];
  cctKelvin: LibraryFacetOption[];
  beams: LibraryFacetOption[];
  ipRatings: LibraryFacetOption[];
  controls: LibraryFacetOption[];
  mountings: LibraryFacetOption[];
}
type LibraryFacetDimension =
  'manufacturer' | 'productType' | 'cct' | 'beam' | 'ip' | 'control' | 'mounting';
interface PublishedVariantCandidate {
  product: LuminaireLibraryProduct;
  manufacturer: LuminaireManufacturer;
  variantId: string;
  snapshot: LuminaireLibraryVersionSnapshot;
  assetTypes: ReadonlySet<LuminaireLibraryAssetType>;
}
export interface PublishedVariantResult {
  status: 'PUBLISHED' | 'NO_CHANGE';
  version: LuminaireLibraryVersion;
}
export interface LibraryProductProjection {
  product: LuminaireLibraryProduct;
  manufacturer: LuminaireManufacturer;
  variants: Array<{
    variant: LuminaireLibraryVariant;
    latestVersion: LuminaireLibraryVersion | null;
    assetAvailability: {
      hasProductImage: boolean;
      hasDatasheet: boolean;
      hasIes: boolean;
      hasLdt: boolean;
      missingPhotometry: boolean;
      productImageAssetVersionId: string | null;
    };
  }>;
  assets?: Array<{
    asset: LuminaireLibraryAsset;
    versions: LuminaireLibraryAssetVersion[];
  }>;
}
export interface DuplicateSuggestion {
  strength: 'Strong' | 'Likely' | 'Possible';
  productId: string;
  variantId: string | null;
  manufacturerName: string;
  productName: string;
  orderingCode: string;
  hardConflict: boolean;
  reason: string;
}
export interface AdmittedAssetVersionInput {
  assetVersionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  locatorValue: string;
  expectedLatestSequence: number;
  idempotencyKey: string;
}

export interface ProjectPromotionAssetAdmission {
  projectAssetVersionId: string;
  assetId: string;
  assetVersionId: string;
  assetType: LuminaireLibraryAssetType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  locatorValue: string;
}

export interface ProjectPromotionDraftResult {
  sourceProjectId: string;
  sourceLuminaireId: string;
  manufacturer: LuminaireManufacturer;
  product: LuminaireLibraryProduct;
  variant: LuminaireLibraryVariant;
  assets: Array<{
    asset: LuminaireLibraryAsset;
    version: LuminaireLibraryAssetVersion;
    sourceProjectAssetVersionId: string;
  }>;
}

export interface ProjectPromotionDraftStoreInput {
  projectId: string;
  luminaireId: string;
  expectedSourceUpdatedAt: string;
  request: CreateProjectLuminaireLibraryDraftInput;
  manufacturerId: string;
  productId: string;
  variantId: string;
  assets: ProjectPromotionAssetAdmission[];
}

function manufacturer(row: Row): LuminaireManufacturer {
  return {
    manufacturerId: String(row.manufacturer_id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    status: String(row.status) as LuminaireManufacturer['status'],
    rowVersion: Number(row.row_version),
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedById: String(row.updated_by_id),
    updatedByName: String(row.updated_by_name),
    updatedAt: String(row.updated_at),
  };
}
function product(row: Row): LuminaireLibraryProduct {
  return {
    productId: String(row.product_id),
    manufacturerId: String(row.manufacturer_id),
    name: String(row.name),
    productType: String(row.product_type),
    description: String(row.description),
    status: String(row.status) as LuminaireLibraryProduct['status'],
    rowVersion: Number(row.row_version),
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedById: String(row.updated_by_id),
    updatedByName: String(row.updated_by_name),
    updatedAt: String(row.updated_at),
  };
}
function variant(row: Row): LuminaireLibraryVariant {
  return {
    variantId: String(row.variant_id),
    productId: String(row.product_id),
    variantLabel: String(row.variant_label),
    orderingCode: String(row.ordering_code),
    wattage: String(row.wattage),
    lumens: String(row.lumens),
    lightColor: String(row.light_color),
    cri: String(row.cri),
    beamAngle: String(row.beam_angle),
    ipRating: String(row.ip_rating),
    mounting: String(row.mounting),
    cutout: String(row.cutout),
    driver: String(row.driver),
    control: String(row.control),
    emergency: String(row.emergency),
    dimensions: String(row.dimensions),
    bodyColorFinish: String(row.body_color_finish),
    status: String(row.status) as LuminaireLibraryVariant['status'],
    rowVersion: Number(row.row_version),
    latestPublishedVersionId:
      row.latest_published_version_id === null ? null : String(row.latest_published_version_id),
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedById: String(row.updated_by_id),
    updatedByName: String(row.updated_by_name),
    updatedAt: String(row.updated_at),
  };
}
function version(row: Row): LuminaireLibraryVersion {
  return {
    versionId: String(row.version_id),
    variantId: String(row.variant_id),
    versionSequence: Number(row.version_sequence),
    snapshot: JSON.parse(String(row.snapshot_json)) as LuminaireLibraryVersionSnapshot,
    contentHash: String(row.content_hash),
    publishedById: String(row.published_by_id),
    publishedByName: String(row.published_by_name),
    publishedAt: String(row.published_at),
  };
}
function asset(row: Row): LuminaireLibraryAsset {
  return {
    assetId: String(row.asset_id),
    productId: String(row.product_id),
    variantId: row.variant_id === null ? null : String(row.variant_id),
    assetType: String(row.asset_type) as LuminaireLibraryAssetType,
    label: String(row.label),
    status: String(row.status) as LuminaireLibraryAsset['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function assetVersion(row: Row): LuminaireLibraryAssetVersion {
  return {
    assetVersionId: String(row.asset_version_id),
    assetId: String(row.asset_id),
    versionSequence: Number(row.version_sequence),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    contentHash: String(row.content_hash),
    locatorValue: String(row.locator_value),
    createdById: String(row.created_by_id),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
  };
}
function binding(row: Row): ProjectLuminaireLibraryBinding {
  return {
    projectId: String(row.project_id),
    luminaireId: String(row.luminaire_id),
    manufacturerId: String(row.manufacturer_id),
    productId: String(row.product_id),
    variantId: String(row.variant_id),
    selectedVersionId: String(row.selected_version_id),
    descriptionOverride:
      row.description_override === null ? null : String(row.description_override),
    rowVersion: Number(row.row_version),
    selectedById: String(row.selected_by_id),
    selectedByName: String(row.selected_by_name),
    selectedAt: String(row.selected_at),
    updatedById: String(row.updated_by_id),
    updatedByName: String(row.updated_by_name),
    updatedAt: String(row.updated_at),
  };
}

export class LuminaireLibraryStore {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  public getDatabase(): DatabaseSync {
    return this.database;
  }

  public transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        /* preserve original failure */
      }
      throw error;
    }
  }

  public replay<T>(key: string): T | null {
    const row = this.database
      .prepare('SELECT result_json FROM luminaire_library_activity WHERE idempotency_key = ?')
      .get(key) as { result_json?: unknown } | undefined;
    return row ? (JSON.parse(String(row.result_json)) as T) : null;
  }

  public activity(
    entityType: string,
    entityId: string,
    action: string,
    detail: unknown,
    result: unknown,
    actor: AppUser,
    idempotencyKey: string | null,
    projectId: string | null = null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO luminaire_library_activity
       (activity_id, entity_type, entity_id, project_id, action, detail_json, result_json,
        idempotency_key, actor_id, actor_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.uuid(),
        entityType,
        entityId,
        projectId,
        action,
        JSON.stringify(detail),
        JSON.stringify(result),
        idempotencyKey,
        actor.id,
        actor.displayName,
        this.now().toISOString(),
      );
  }

  public createDraftFromProjectLuminaire(
    input: ProjectPromotionDraftStoreInput,
    actor: AppUser,
  ): ProjectPromotionDraftResult {
    const replay = this.replay<ProjectPromotionDraftResult>(input.request.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      const source = this.database
        .prepare('SELECT updated_at FROM project_luminaires WHERE project_id = ? AND id = ?')
        .get(input.projectId, input.luminaireId) as { updated_at?: unknown } | undefined;
      if (!source) throw new DomainError('NOT_FOUND', 'Project Luminaire not found.', 404);
      if (String(source.updated_at) !== input.expectedSourceUpdatedAt) {
        throw new DomainError(
          'CONFLICT',
          'Project Luminaire changed while the Library Draft was being created.',
          409,
        );
      }
      if (
        this.database
          .prepare(
            'SELECT 1 FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
          )
          .get(input.projectId, input.luminaireId)
      ) {
        throw new DomainError(
          'CONFLICT',
          'This Project Luminaire is already linked to the Master Library.',
          409,
        );
      }

      const time = this.now().toISOString();
      let maker: LuminaireManufacturer;
      if (input.request.manufacturer.mode === 'USE_EXISTING') {
        maker = this.getManufacturer(input.request.manufacturer.manufacturerId);
        if (maker.manufacturerId !== input.manufacturerId || maker.status !== 'ACTIVE') {
          throw new DomainError('CONFLICT', 'The selected Manufacturer is not eligible.', 409);
        }
      } else {
        const normalized = normalizeManufacturerName(input.request.manufacturer.name);
        if (
          this.database
            .prepare('SELECT 1 FROM luminaire_manufacturers WHERE normalized_name = ?')
            .get(normalized)
        ) {
          throw new DomainError(
            'CONFLICT',
            'A normalized Manufacturer match already exists. Select that Manufacturer explicitly.',
            409,
          );
        }
        this.database
          .prepare(
            `INSERT INTO luminaire_manufacturers
             (manufacturer_id, name, normalized_name, status, row_version, created_by_id,
              created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
             VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.manufacturerId,
            input.request.manufacturer.name,
            normalized,
            actor.id,
            actor.displayName,
            time,
            actor.id,
            actor.displayName,
            time,
          );
        maker = this.getManufacturer(input.manufacturerId);
      }

      let owner: LuminaireLibraryProduct;
      if (input.request.product.mode === 'USE_EXISTING') {
        owner = this.getProduct(input.request.product.productId);
        if (
          owner.productId !== input.productId ||
          owner.manufacturerId !== maker.manufacturerId ||
          owner.status !== 'ACTIVE'
        ) {
          throw new DomainError(
            'CONFLICT',
            'The selected Product is not eligible for this Manufacturer.',
            409,
          );
        }
      } else {
        const suggestions = this.duplicateSuggestions({
          manufacturerId: maker.manufacturerId,
          productName: input.request.product.name,
          orderingCode: input.request.variant.orderingCode,
        });
        if (suggestions.length > 0 && input.request.product.duplicateDecision !== 'KEEP_SEPARATE') {
          throw new DomainError(
            'CONFLICT',
            'Possible duplicate Products require an explicit Keep Separate or Use Existing choice.',
            409,
          );
        }
        this.database
          .prepare(
            `INSERT INTO luminaire_library_products
             (product_id, manufacturer_id, name, normalized_name, product_type, description,
              status, row_version, created_by_id, created_by_name, created_at, updated_by_id,
              updated_by_name, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.productId,
            maker.manufacturerId,
            input.request.product.name,
            normalizeManufacturerName(input.request.product.name),
            input.request.product.productType,
            input.request.product.description,
            actor.id,
            actor.displayName,
            time,
            actor.id,
            actor.displayName,
            time,
          );
        owner = this.getProduct(input.productId);
      }

      const draft = input.request.variant;
      this.insertVariant(input.variantId, owner, draft, actor, time);

      const promotedAssets = input.assets.map((item) => {
        const variantId =
          item.assetType === 'IES' || item.assetType === 'LDT' ? input.variantId : null;
        this.database
          .prepare(
            `INSERT INTO luminaire_library_assets
             (asset_id, product_id, variant_id, asset_type, label, status, created_by_id,
              created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.assetId,
            owner.productId,
            variantId,
            item.assetType,
            `Promoted ${item.assetType}`,
            actor.id,
            actor.displayName,
            time,
            actor.id,
            actor.displayName,
            time,
          );
        this.database
          .prepare(
            `INSERT INTO luminaire_library_asset_versions
             (asset_version_id, asset_id, version_sequence, file_name, mime_type, size_bytes,
              content_hash, locator_value, created_by_id, created_by_name, created_at)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.assetVersionId,
            item.assetId,
            item.fileName,
            item.mimeType,
            item.sizeBytes,
            item.contentHash,
            item.locatorValue,
            actor.id,
            actor.displayName,
            time,
          );
        return {
          asset: this.getAsset(item.assetId),
          version: this.getAssetVersion(item.assetVersionId),
          sourceProjectAssetVersionId: item.projectAssetVersionId,
        };
      });
      const result: ProjectPromotionDraftResult = {
        sourceProjectId: input.projectId,
        sourceLuminaireId: input.luminaireId,
        manufacturer: maker,
        product: owner,
        variant: this.getVariant(input.variantId),
        assets: promotedAssets,
      };
      this.activity(
        'VARIANT',
        input.variantId,
        'DRAFT_CREATED_FROM_PROJECT_LUMINAIRE',
        {
          sourceProjectId: input.projectId,
          sourceLuminaireId: input.luminaireId,
          sourceProjectAssetVersionIds: input.assets.map((item) => item.projectAssetVersionId),
          excludedProjectFields: ['tag', 'category', 'location', 'unit', 'quantity', 'notes'],
        },
        result,
        actor,
        input.request.idempotencyKey,
        input.projectId,
      );
      return result;
    });
  }

  public createManufacturer(
    input: CreateLuminaireManufacturerInput,
    actor: AppUser,
  ): LuminaireManufacturer {
    const replay = this.replay<LuminaireManufacturer>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      const normalized = normalizeManufacturerName(input.name);
      if (
        this.database
          .prepare('SELECT 1 FROM luminaire_manufacturers WHERE normalized_name = ?')
          .get(normalized)
      ) {
        throw new DomainError('CONFLICT', 'A Manufacturer with this normalized name exists.', 409);
      }
      const id = this.uuid();
      const time = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO luminaire_manufacturers
         (manufacturer_id, name, normalized_name, status, row_version, created_by_id,
          created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          normalized,
          actor.id,
          actor.displayName,
          time,
          actor.id,
          actor.displayName,
          time,
        );
      const created = this.getManufacturer(id);
      this.activity('MANUFACTURER', id, 'CREATED', {}, created, actor, input.idempotencyKey);
      return created;
    });
  }

  public updateManufacturer(
    id: string,
    input: UpdateLuminaireManufacturerInput,
    actor: AppUser,
  ): LuminaireManufacturer {
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE luminaire_manufacturers SET name = ?, normalized_name = ?, row_version = row_version + 1,
         updated_by_id = ?, updated_by_name = ?, updated_at = ?
         WHERE manufacturer_id = ? AND row_version = ?`,
        )
        .run(
          input.name,
          normalizeManufacturerName(input.name),
          actor.id,
          actor.displayName,
          this.now().toISOString(),
          id,
          input.expectedRowVersion,
        );
      if (result.changes !== 1) this.staleOrMissing('Manufacturer', id);
      const updated = this.getManufacturer(id);
      this.activity('MANUFACTURER', id, 'DRAFT_UPDATED', {}, updated, actor, null);
      return updated;
    });
  }

  public listManufacturers(query: {
    search: string;
    status: 'ACTIVE' | 'ARCHIVED';
    cursor?: string | undefined;
    limit: number;
  }): LibraryPage<LuminaireManufacturer> {
    const rows = this.database
      .prepare(
        `SELECT * FROM luminaire_manufacturers WHERE status = ? AND normalized_name LIKE ?
       AND (? IS NULL OR normalized_name || '|' || manufacturer_id > ?)
       ORDER BY normalized_name, manufacturer_id LIMIT ?`,
      )
      .all(
        query.status,
        `%${normalizeManufacturerName(query.search)}%`,
        query.cursor ?? null,
        query.cursor ?? null,
        query.limit + 1,
      ) as Row[];
    const items = rows.slice(0, query.limit).map(manufacturer);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last ? `${last.normalizedName}|${last.manufacturerId}` : null,
    };
  }

  public createProduct(
    input: CreateLuminaireLibraryProductInput,
    actor: AppUser,
  ): LuminaireLibraryProduct {
    const replay = this.replay<LuminaireLibraryProduct>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      if (this.getManufacturer(input.manufacturerId).status !== 'ACTIVE')
        throw new DomainError('CONFLICT', 'Manufacturer is archived.', 409);
      const id = this.uuid();
      const time = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO luminaire_library_products
         (product_id, manufacturer_id, name, normalized_name, product_type, description,
          status, row_version, created_by_id, created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.manufacturerId,
          input.name,
          normalizeManufacturerName(input.name),
          input.productType,
          input.description,
          actor.id,
          actor.displayName,
          time,
          actor.id,
          actor.displayName,
          time,
        );
      const created = this.getProduct(id);
      this.activity('PRODUCT', id, 'CREATED', {}, created, actor, input.idempotencyKey);
      return created;
    });
  }

  public updateProduct(
    id: string,
    input: UpdateLuminaireLibraryProductDraftInput,
    actor: AppUser,
  ): LuminaireLibraryProduct {
    return this.transaction(() => {
      if (this.getManufacturer(input.manufacturerId).status !== 'ACTIVE') {
        throw new DomainError(
          'CONFLICT',
          'Archived Manufacturers cannot receive Product drafts.',
          409,
        );
      }
      const result = this.database
        .prepare(
          `UPDATE luminaire_library_products SET manufacturer_id = ?, name = ?, normalized_name = ?,
         product_type = ?, description = ?, row_version = row_version + 1,
         updated_by_id = ?, updated_by_name = ?, updated_at = ? WHERE product_id = ? AND row_version = ?`,
        )
        .run(
          input.manufacturerId,
          input.name,
          normalizeManufacturerName(input.name),
          input.productType,
          input.description,
          actor.id,
          actor.displayName,
          this.now().toISOString(),
          id,
          input.expectedRowVersion,
        );
      if (result.changes !== 1) this.staleOrMissing('Product', id);
      const updated = this.getProduct(id);
      this.activity('PRODUCT', id, 'DRAFT_UPDATED', {}, updated, actor, null);
      return updated;
    });
  }

  public createVariant(
    productId: string,
    input: CreateLuminaireLibraryVariantInput,
    actor: AppUser,
  ): LuminaireLibraryVariant {
    const replay = this.replay<LuminaireLibraryVariant>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      const owner = this.getProduct(productId);
      if (owner.status !== 'ACTIVE') throw new DomainError('CONFLICT', 'Product is archived.', 409);
      if (this.getManufacturer(owner.manufacturerId).status !== 'ACTIVE') {
        throw new DomainError('CONFLICT', 'Manufacturer is archived.', 409);
      }
      const id = this.uuid();
      const time = this.now().toISOString();
      this.insertVariant(id, owner, input, actor, time);
      const created = this.getVariant(id);
      this.activity('VARIANT', id, 'CREATED', {}, created, actor, input.idempotencyKey);
      return created;
    });
  }

  public updateVariant(
    id: string,
    input: UpdateLuminaireLibraryVariantDraftInput,
    actor: AppUser,
  ): LuminaireLibraryVariant {
    return this.transaction(() => {
      const current = this.getVariant(id);
      const owner = this.getProduct(current.productId);
      this.assertOrderingCodeAvailable(owner.manufacturerId, input.orderingCode, id);
      const normalized = normalizeLuminaireTechnicalValues(input);
      const result = this.database
        .prepare(
          `UPDATE luminaire_library_variants SET variant_label = ?, normalized_label = ?, ordering_code = ?,
         normalized_ordering_code = ?, wattage = ?, wattage_value = ?, wattage_basis = ?,
         lumens = ?, lumens_value = ?, lumens_basis = ?, light_color = ?, cct_kelvin = ?,
         cri = ?, cri_value = ?, beam_angle = ?, beam_degrees = ?, beam_facet = ?,
         ip_rating = ?, ip_facet = ?, mounting = ?, cutout = ?, driver = ?, control = ?,
         control_facet = ?, emergency = ?, dimensions = ?, body_color_finish = ?,
         row_version = row_version + 1, updated_by_id = ?, updated_by_name = ?, updated_at = ?
         WHERE variant_id = ? AND row_version = ?`,
        )
        .run(
          input.variantLabel,
          normalizeManufacturerName(input.variantLabel),
          input.orderingCode,
          normalized.normalizedOrderingCode,
          input.wattage,
          normalized.wattageValue,
          normalized.wattageBasis,
          input.lumens,
          normalized.lumensValue,
          normalized.lumensBasis,
          input.lightColor,
          normalized.cctKelvin,
          input.cri,
          normalized.criValue,
          input.beamAngle,
          normalized.beamDegrees,
          normalized.beamFacet,
          input.ipRating,
          normalized.ipFacet,
          input.mounting,
          input.cutout,
          input.driver,
          input.control,
          normalized.controlFacet,
          input.emergency,
          input.dimensions,
          input.bodyColorFinish,
          actor.id,
          actor.displayName,
          this.now().toISOString(),
          id,
          input.expectedRowVersion,
        );
      if (result.changes !== 1) this.staleOrMissing('Variant', id);
      const updated = this.getVariant(id);
      this.activity('VARIANT', id, 'DRAFT_UPDATED', {}, updated, actor, null);
      return updated;
    });
  }

  public publishVariant(
    id: string,
    input: PublishLuminaireLibraryVariantInput,
    actor: AppUser,
  ): PublishedVariantResult {
    const replay = this.replay<PublishedVariantResult>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      const draft = this.getVariant(id);
      const owner = this.getProduct(draft.productId);
      const maker = this.getManufacturer(owner.manufacturerId);
      if (
        draft.rowVersion !== input.expectedVariantRowVersion ||
        owner.rowVersion !== input.expectedProductRowVersion
      ) {
        throw new DomainError(
          'CONFLICT',
          'The Product or Variant draft changed before Publish.',
          409,
        );
      }
      if ([draft.status, owner.status, maker.status].some((status) => status !== 'ACTIVE')) {
        throw new DomainError('CONFLICT', 'Archived Library entities cannot be published.', 409);
      }
      const versions = this.latestEffectiveAssetVersions(owner.productId, id);
      const snapshot: LuminaireLibraryVersionSnapshot = {
        manufacturerId: maker.manufacturerId,
        manufacturerName: maker.name,
        productId: owner.productId,
        productName: owner.name,
        productType: owner.productType,
        technicalDescription: owner.description,
        variantId: draft.variantId,
        variantLabel: draft.variantLabel,
        orderingCode: draft.orderingCode,
        wattage: draft.wattage,
        lumens: draft.lumens,
        lightColor: draft.lightColor,
        cri: draft.cri,
        beamAngle: draft.beamAngle,
        ipRating: draft.ipRating,
        mounting: draft.mounting,
        cutout: draft.cutout,
        driver: draft.driver,
        control: draft.control,
        emergency: draft.emergency,
        dimensions: draft.dimensions,
        bodyColorFinish: draft.bodyColorFinish,
        assetVersionIds: versions.map((item) => item.assetVersionId).sort(),
      };
      const snapshotJson = canonicalLuminaireLibrarySnapshot(snapshot);
      const hash = createHash('sha256').update(snapshotJson, 'utf8').digest('hex');
      const latest = draft.latestPublishedVersionId
        ? this.getVersion(draft.latestPublishedVersionId)
        : null;
      if (latest?.contentHash === hash) {
        const result: PublishedVariantResult = { status: 'NO_CHANGE', version: latest };
        this.activity('VARIANT', id, 'PUBLISH_NO_CHANGE', {}, result, actor, input.idempotencyKey);
        return result;
      }
      const versionId = this.uuid();
      const sequence = (latest?.versionSequence ?? 0) + 1;
      const time = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO luminaire_library_versions
         (version_id, manufacturer_id, product_id, variant_id, version_sequence, snapshot_json,
          content_hash, search_text, product_type, light_color, beam_angle,
          published_by_id, published_by_name, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          maker.manufacturerId,
          owner.productId,
          id,
          sequence,
          snapshotJson,
          hash,
          Object.values(snapshot).flat().join(' ').normalize('NFKC').toLocaleLowerCase('en'),
          owner.productType,
          draft.lightColor,
          draft.beamAngle,
          actor.id,
          actor.displayName,
          time,
        );
      const typeById = this.assetTypesForVersions(snapshot.assetVersionIds);
      const link = this.database.prepare(
        'INSERT INTO luminaire_library_version_assets (version_id, asset_version_id, asset_type) VALUES (?, ?, ?)',
      );
      for (const assetVersionId of snapshot.assetVersionIds)
        link.run(versionId, assetVersionId, typeById.get(assetVersionId)!);
      this.database
        .prepare(
          `UPDATE luminaire_library_variants SET latest_published_version_id = ?,
         updated_by_id = ?, updated_by_name = ?, updated_at = ? WHERE variant_id = ?`,
        )
        .run(versionId, actor.id, actor.displayName, time, id);
      const result: PublishedVariantResult = {
        status: 'PUBLISHED',
        version: this.getVersion(versionId),
      };
      this.activity('VARIANT', id, 'PUBLISHED', { sequence }, result, actor, input.idempotencyKey);
      return result;
    });
  }

  public createAsset(
    input: CreateLuminaireLibraryAssetInput,
    actor: AppUser,
  ): LuminaireLibraryAsset {
    const replay = this.replay<LuminaireLibraryAsset>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      if (this.getProduct(input.productId).status !== 'ACTIVE') {
        throw new DomainError('CONFLICT', 'Archived Products cannot receive new assets.', 409);
      }
      if ((input.assetType === 'IES' || input.assetType === 'LDT') && !input.variantId) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'IES and LDT assets must be Variant-scoped.',
          400,
        );
      }
      if (input.variantId) {
        const owner = this.getVariant(input.variantId);
        if (owner.productId !== input.productId) {
          throw new DomainError(
            'VALIDATION_ERROR',
            'Asset Variant does not belong to Product.',
            400,
          );
        }
        if (owner.status !== 'ACTIVE') {
          throw new DomainError('CONFLICT', 'Archived Variants cannot receive new assets.', 409);
        }
      }
      const id = this.uuid();
      const time = this.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO luminaire_library_assets
         (asset_id, product_id, variant_id, asset_type, label, status, created_by_id,
          created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.productId,
          input.variantId,
          input.assetType,
          input.label,
          actor.id,
          actor.displayName,
          time,
          actor.id,
          actor.displayName,
          time,
        );
      const created = this.getAsset(id);
      this.activity('ASSET', id, 'CREATED', {}, created, actor, input.idempotencyKey);
      return created;
    });
  }

  public addAssetVersion(
    assetId: string,
    input: AdmittedAssetVersionInput,
    actor: AppUser,
  ): LuminaireLibraryAssetVersion {
    const replay = this.replay<LuminaireLibraryAssetVersion>(input.idempotencyKey);
    if (replay) return replay;
    return this.transaction(() => {
      this.getAsset(assetId);
      const current = this.database
        .prepare(
          'SELECT COALESCE(MAX(version_sequence), 0) AS sequence FROM luminaire_library_asset_versions WHERE asset_id = ?',
        )
        .get(assetId) as { sequence: number };
      if (Number(current.sequence) !== input.expectedLatestSequence)
        throw new DomainError('CONFLICT', 'The Asset changed before admission.', 409);
      const sequence = Number(current.sequence) + 1;
      this.database
        .prepare(
          `INSERT INTO luminaire_library_asset_versions
         (asset_version_id, asset_id, version_sequence, file_name, mime_type, size_bytes,
          content_hash, locator_value, created_by_id, created_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.assetVersionId,
          assetId,
          sequence,
          input.fileName,
          input.mimeType,
          input.sizeBytes,
          input.contentHash,
          input.locatorValue,
          actor.id,
          actor.displayName,
          this.now().toISOString(),
        );
      const created = this.getAssetVersion(input.assetVersionId);
      this.activity(
        'ASSET',
        assetId,
        'VERSION_ADMITTED',
        { sequence },
        created,
        actor,
        input.idempotencyKey,
      );
      return created;
    });
  }

  public archive(
    kind: 'MANUFACTURER' | 'PRODUCT' | 'VARIANT',
    id: string,
    expectedRowVersion: number,
    key: string,
    actor: AppUser,
  ): unknown {
    const replay = this.replay<unknown>(key);
    if (replay) return replay;
    const config = {
      MANUFACTURER: ['luminaire_manufacturers', 'manufacturer_id'],
      PRODUCT: ['luminaire_library_products', 'product_id'],
      VARIANT: ['luminaire_library_variants', 'variant_id'],
    } as const;
    return this.transaction(() => {
      const [table, column] = config[kind];
      const result = this.database
        .prepare(
          `UPDATE ${table} SET status = 'ARCHIVED', row_version = row_version + 1,
         updated_by_id = ?, updated_by_name = ?, updated_at = ?
         WHERE ${column} = ? AND row_version = ? AND status = 'ACTIVE'`,
        )
        .run(actor.id, actor.displayName, this.now().toISOString(), id, expectedRowVersion);
      if (result.changes !== 1) this.staleOrMissing(kind, id);
      const value =
        kind === 'MANUFACTURER'
          ? this.getManufacturer(id)
          : kind === 'PRODUCT'
            ? this.getProduct(id)
            : this.getVariant(id);
      this.activity(kind, id, 'ARCHIVED', {}, value, actor, key);
      return value;
    });
  }

  public listProducts(query: LuminaireLibraryListQuery): LibraryPage<LibraryProductProjection> {
    const published = this.publishedVariantCandidates(query.status);
    const matching = published.filter((candidate) =>
      this.matchesPublishedVariant(candidate, query),
    );
    const displayed = this.isUnfilteredLibraryQuery(query)
      ? [...matching, ...this.unpublishedDraftCandidates(query.status)]
      : matching;
    if (query.includeEmptyProducts && this.isUnfilteredLibraryQuery(query)) {
      const emptyProducts = this.database
        .prepare(
          'SELECT p.* FROM luminaire_library_products p WHERE p.status = ? AND NOT EXISTS (SELECT 1 FROM luminaire_library_variants v WHERE v.product_id = p.product_id)',
        )
        .all(query.status) as Row[];
      for (const row of emptyProducts) {
        const family = this.getProduct(String(row.product_id));
        const maker = this.getManufacturer(family.manufacturerId);
        // A family row has no Variant identity; it is only a sortable catalogue projection.
        displayed.push({
          product: family,
          manufacturer: maker,
          variantId: '',
          assetTypes: new Set(),
          snapshot: {
            manufacturerId: maker.manufacturerId,
            manufacturerName: maker.name,
            productId: family.productId,
            productName: family.name,
            productType: family.productType,
            technicalDescription: family.description,
            variantId: '',
            variantLabel: '',
            orderingCode: '',
            wattage: '',
            lumens: '',
            lightColor: '',
            cri: '',
            beamAngle: '',
            ipRating: '',
            mounting: '',
            cutout: '',
            driver: '',
            control: '',
            emergency: '',
            dimensions: '',
            bodyColorFinish: '',
            assetVersionIds: [],
          },
        });
      }
    }
    const byProduct = new Map<string, PublishedVariantCandidate[]>();
    for (const candidate of displayed) {
      const current = byProduct.get(candidate.product.productId) ?? [];
      current.push(candidate);
      byProduct.set(candidate.product.productId, current);
    }
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const metric = (
      candidates: readonly PublishedVariantCandidate[],
      resolve: (candidate: PublishedVariantCandidate) => number | null,
      select: 'MIN' | 'MAX',
    ) => {
      const values = candidates.flatMap((candidate) => {
        const value = resolve(candidate);
        return value === null ? [] : [value];
      });
      if (!values.length)
        return select === 'MIN' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      return select === 'MIN' ? Math.min(...values) : Math.max(...values);
    };
    let products = [...byProduct.values()];
    products.sort((left, right) => {
      const a = left[0]!;
      const b = right[0]!;
      const productOrder = collator.compare(a.snapshot.productName, b.snapshot.productName);
      const stable = productOrder || a.product.productId.localeCompare(b.product.productId);
      switch (query.sort) {
        case 'MANUFACTURER_ASC':
          return (
            collator.compare(a.snapshot.manufacturerName, b.snapshot.manufacturerName) || stable
          );
        case 'RECENTLY_UPDATED':
          return b.product.updatedAt.localeCompare(a.product.updatedAt) || stable;
        case 'HIGHEST_LUMENS':
          return (
            metric(
              right,
              (item) => parseLuminaireLumens(item.snapshot.lumens)?.value ?? null,
              'MAX',
            ) -
              metric(
                left,
                (item) => parseLuminaireLumens(item.snapshot.lumens)?.value ?? null,
                'MAX',
              ) || stable
          );
        case 'LOWEST_WATTAGE':
          return (
            metric(
              left,
              (item) => parseLuminaireWattage(item.snapshot.wattage)?.value ?? null,
              'MIN',
            ) -
              metric(
                right,
                (item) => parseLuminaireWattage(item.snapshot.wattage)?.value ?? null,
                'MIN',
              ) || stable
          );
        case 'HIGHEST_EFFICACY':
          return (
            metric(
              right,
              (item) => deriveLuminaireEfficacy(item.snapshot.wattage, item.snapshot.lumens),
              'MAX',
            ) -
              metric(
                left,
                (item) => deriveLuminaireEfficacy(item.snapshot.wattage, item.snapshot.lumens),
                'MAX',
              ) || stable
          );
        default:
          return stable;
      }
    });
    const supportsCursor = query.sort === 'RELEVANCE' || query.sort === 'PRODUCT_ASC';
    if (query.cursor && supportsCursor) {
      products = products.filter((entries) => {
        const first = entries[0]!;
        return (
          `${normalizeManufacturerName(first.snapshot.productName)}|${first.product.productId}` >
          query.cursor!
        );
      });
    }
    const pageProducts = products.slice(0, query.limit);
    const matchingVariantIds = new Set(displayed.map((candidate) => candidate.variantId));
    const items = pageProducts.map((entries) =>
      this.getProductProjection(entries[0]!.product.productId, false, matchingVariantIds),
    );
    const last = pageProducts.at(-1)?.[0];
    return {
      items,
      nextCursor:
        supportsCursor && products.length > query.limit && last
          ? `${normalizeManufacturerName(last.snapshot.productName)}|${last.product.productId}`
          : null,
      totalProducts: byProduct.size,
      totalVariants: displayed.filter((item) => Boolean(item.variantId)).length,
      facets: this.libraryFacets(query, published),
    };
  }

  private publishedVariantCandidates(
    status: LuminaireLibraryListQuery['status'],
  ): PublishedVariantCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT p.product_id, m.manufacturer_id, v.variant_id, lv.snapshot_json
         FROM luminaire_library_variants v
         JOIN luminaire_library_products p ON p.product_id = v.product_id
         JOIN luminaire_manufacturers m ON m.manufacturer_id = p.manufacturer_id
         JOIN luminaire_library_versions lv ON lv.version_id = v.latest_published_version_id
         WHERE p.status = ? AND v.status = ?`,
      )
      .all(status, status) as Row[];
    return rows.flatMap((row) => {
      try {
        const snapshot = JSON.parse(String(row.snapshot_json)) as LuminaireLibraryVersionSnapshot;
        return [
          {
            product: this.getProduct(String(row.product_id)),
            manufacturer: this.getManufacturer(String(row.manufacturer_id)),
            variantId: String(row.variant_id),
            snapshot,
            assetTypes: new Set(this.assetTypesForVersions(snapshot.assetVersionIds).values()),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  private unpublishedDraftCandidates(
    status: LuminaireLibraryListQuery['status'],
  ): PublishedVariantCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT v.* FROM luminaire_library_variants v
         JOIN luminaire_library_products p ON p.product_id = v.product_id
         WHERE p.status = ? AND v.status = ? AND v.latest_published_version_id IS NULL`,
      )
      .all(status, status) as Row[];
    return rows.map((row) => {
      const item = variant(row);
      const product = this.getProduct(item.productId);
      const manufacturer = this.getManufacturer(product.manufacturerId);
      return {
        product,
        manufacturer,
        variantId: item.variantId,
        snapshot: {
          ...item,
          manufacturerId: manufacturer.manufacturerId,
          manufacturerName: manufacturer.name,
          productId: product.productId,
          productName: product.name,
          productType: product.productType,
          technicalDescription: product.description,
          assetVersionIds: [],
        },
        assetTypes: new Set<LuminaireLibraryAssetType>(),
      };
    });
  }

  private isUnfilteredLibraryQuery(query: LuminaireLibraryListQuery): boolean {
    return (
      !query.search &&
      !query.manufacturerId &&
      !query.manufacturerIds.length &&
      !query.productType &&
      !query.productTypes.length &&
      !query.cctKelvin.length &&
      !query.beam.length &&
      query.wattageMin === undefined &&
      query.wattageMax === undefined &&
      !query.wattageBasis &&
      query.lumensMin === undefined &&
      query.lumensMax === undefined &&
      !query.lumensBasis &&
      query.criMin === undefined &&
      !query.ip.length &&
      !query.control.length &&
      !query.mounting.length &&
      !query.hasProductImage &&
      !query.hasDatasheet &&
      !query.hasIes &&
      !query.hasLdt &&
      !query.missingPhotometry
    );
  }

  private matchesPublishedVariant(
    candidate: PublishedVariantCandidate,
    query: LuminaireLibraryListQuery,
    omit?: LibraryFacetDimension,
  ): boolean {
    const { snapshot, assetTypes } = candidate;
    if (omit !== 'manufacturer') {
      if (query.manufacturerId && snapshot.manufacturerId !== query.manufacturerId) return false;
      if (query.manufacturerIds.length && !query.manufacturerIds.includes(snapshot.manufacturerId))
        return false;
    }
    if (omit !== 'productType') {
      if (query.productType && snapshot.productType !== query.productType) return false;
      if (query.productTypes.length && !query.productTypes.includes(snapshot.productType))
        return false;
    }
    if (query.search) {
      const term = normalizeManufacturerName(query.search);
      if (
        ![
          snapshot.productName,
          snapshot.manufacturerName,
          snapshot.variantLabel,
          snapshot.orderingCode,
        ].some((value) => normalizeManufacturerName(value).includes(term))
      )
        return false;
    }
    if (omit !== 'cct' && query.cctKelvin.length) {
      const cct = parseLuminaireCctKelvin(snapshot.lightColor);
      if (cct === null || !query.cctKelvin.includes(cct)) return false;
    }
    if (omit !== 'beam') {
      const beams = query.beam.map((value) => this.beamFacet(value));
      if (beams.length && !beams.includes(this.beamFacet(snapshot.beamAngle))) return false;
    }
    const wattage = parseLuminaireWattage(snapshot.wattage);
    if (query.wattageBasis) {
      if (!wattage || wattage.basis !== query.wattageBasis) return false;
    }
    if (query.wattageMin !== undefined && (!wattage || wattage.value < query.wattageMin))
      return false;
    if (query.wattageMax !== undefined && (!wattage || wattage.value > query.wattageMax))
      return false;
    const lumens = parseLuminaireLumens(snapshot.lumens);
    if (query.lumensBasis) {
      if (!lumens || lumens.basis !== query.lumensBasis) return false;
    }
    if (query.lumensMin !== undefined && (!lumens || lumens.value < query.lumensMin)) return false;
    if (query.lumensMax !== undefined && (!lumens || lumens.value > query.lumensMax)) return false;
    const cri = parseLuminaireCri(snapshot.cri);
    if (query.criMin !== undefined && (cri === null || cri < query.criMin)) return false;
    if (omit !== 'ip') {
      const choices = query.ip.map((value) => normalizeLuminaireFacet(value));
      if (choices.length && !choices.includes(normalizeLuminaireFacet(snapshot.ipRating)))
        return false;
    }
    if (omit !== 'control') {
      const choices = query.control.map((value) => normalizeLuminaireFacet(value));
      if (choices.length && !choices.includes(normalizeLuminaireFacet(snapshot.control)))
        return false;
    }
    if (omit !== 'mounting') {
      const choices = query.mounting.map((value) => normalizeLuminaireFacet(value));
      if (choices.length && !choices.includes(normalizeLuminaireFacet(snapshot.mounting)))
        return false;
    }
    for (const [enabled, types] of [
      [query.hasProductImage, ['ProductImage']],
      [query.hasDatasheet, ['Datasheet']],
      [query.hasIes, ['IES']],
      [query.hasLdt, ['LDT']],
    ] as const) {
      if (!enabled) continue;
      if (!types.some((type) => assetTypes.has(type))) return false;
    }
    if (query.missingPhotometry && (assetTypes.has('IES') || assetTypes.has('LDT'))) return false;
    return true;
  }

  private beamFacet(value: string): string {
    const degrees = parseLuminaireBeamDegrees(value);
    return degrees === null ? normalizeLuminaireFacet(value) : `${degrees}°`;
  }

  public getProductProjection(
    id: string,
    includeAssetHistory = false,
    matchingVariantIds?: ReadonlySet<string>,
  ): LibraryProductProjection {
    const owner = this.getProduct(id);
    const maker = this.getManufacturer(owner.manufacturerId);
    const variants = (
      this.database
        .prepare(
          'SELECT * FROM luminaire_library_variants WHERE product_id = ? ORDER BY normalized_label, variant_id',
        )
        .all(id) as Row[]
    )
      .map((row) => {
        const item = variant(row);
        const latestVersion = item.latestPublishedVersionId
          ? this.getVersion(item.latestPublishedVersionId)
          : null;
        return {
          variant: item,
          latestVersion,
          assetAvailability: latestVersion
            ? this.publishedAssetAvailability(latestVersion.snapshot.assetVersionIds)
            : this.variantAssetAvailability(id, item.variantId),
        };
      })
      .filter((item) => !matchingVariantIds || matchingVariantIds.has(item.variant.variantId));
    const assets = includeAssetHistory
      ? (
          this.database
            .prepare(
              `SELECT * FROM luminaire_library_assets
           WHERE product_id = ? ORDER BY asset_type, created_at, asset_id`,
            )
            .all(id) as Row[]
        ).map((row) => {
          const logical = asset(row);
          const versions = (
            this.database
              .prepare(
                `SELECT * FROM luminaire_library_asset_versions
             WHERE asset_id = ? ORDER BY version_sequence DESC LIMIT 100`,
              )
              .all(logical.assetId) as Row[]
          ).map(assetVersion);
          return { asset: logical, versions };
        })
      : undefined;
    return { product: owner, manufacturer: maker, variants, ...(assets ? { assets } : {}) };
  }

  public listVersions(id: string): LuminaireLibraryVersion[] {
    this.getVariant(id);
    return (
      this.database
        .prepare(
          'SELECT * FROM luminaire_library_versions WHERE variant_id = ? ORDER BY version_sequence DESC',
        )
        .all(id) as Row[]
    ).map(version);
  }

  public duplicateSuggestions(input: {
    manufacturerId: string;
    productName: string;
    orderingCode?: string | undefined;
    excludeVariantId?: string | undefined;
  }): DuplicateSuggestion[] {
    const normalized = normalizeManufacturerName(input.productName);
    const normalizedCode = normalizeLuminaireOrderingCode(input.orderingCode ?? '');
    const rows = this.database
      .prepare(
        `SELECT p.product_id, p.name AS product_name, p.normalized_name, v.variant_id,
                v.ordering_code, v.normalized_ordering_code, m.name AS manufacturer_name
         FROM luminaire_library_products p
         JOIN luminaire_manufacturers m ON m.manufacturer_id = p.manufacturer_id
         LEFT JOIN luminaire_library_variants v ON v.product_id = p.product_id
         WHERE p.manufacturer_id = ?
           AND (p.normalized_name = ? OR p.normalized_name LIKE ?
             OR (? <> '' AND v.normalized_ordering_code = ?))
           AND (? IS NULL OR v.variant_id IS NULL OR v.variant_id <> ?)
         LIMIT 25`,
      )
      .all(
        input.manufacturerId,
        normalized,
        `%${normalized}%`,
        normalizedCode,
        normalizedCode,
        input.excludeVariantId ?? null,
        input.excludeVariantId ?? null,
      ) as Row[];
    return rows.map((row) => {
      const exactProduct = String(row.normalized_name) === normalized;
      const exactCode = Boolean(
        normalizedCode && String(row.normalized_ordering_code) === normalizedCode,
      );
      return {
        strength: exactProduct && exactCode ? 'Strong' : exactProduct ? 'Likely' : 'Possible',
        productId: String(row.product_id),
        variantId: row.variant_id === null ? null : String(row.variant_id),
        manufacturerName: String(row.manufacturer_name),
        productName: String(row.product_name),
        orderingCode: row.ordering_code === null ? '' : String(row.ordering_code),
        hardConflict: exactCode,
        reason: exactCode
          ? 'This Manufacturer and Ordering Code already identify an existing Variant.'
          : exactProduct
            ? 'Same Manufacturer and normalized Product name.'
            : 'Similar Product name for the same Manufacturer.',
      };
    });
  }

  public getManufacturer(id: string): LuminaireManufacturer {
    const row = this.database
      .prepare('SELECT * FROM luminaire_manufacturers WHERE manufacturer_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Manufacturer not found.', 404);
    return manufacturer(row);
  }
  public getProduct(id: string): LuminaireLibraryProduct {
    const row = this.database
      .prepare('SELECT * FROM luminaire_library_products WHERE product_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Library Product not found.', 404);
    return product(row);
  }
  public getVariant(id: string): LuminaireLibraryVariant {
    const row = this.database
      .prepare('SELECT * FROM luminaire_library_variants WHERE variant_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Library Variant not found.', 404);
    return variant(row);
  }
  public getVersion(id: string): LuminaireLibraryVersion {
    const row = this.database
      .prepare('SELECT * FROM luminaire_library_versions WHERE version_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Published Library Version not found.', 404);
    return version(row);
  }
  public getAsset(id: string): LuminaireLibraryAsset {
    const row = this.database
      .prepare('SELECT * FROM luminaire_library_assets WHERE asset_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Library Asset not found.', 404);
    return asset(row);
  }
  public getAssetVersion(id: string): LuminaireLibraryAssetVersion {
    const row = this.database
      .prepare('SELECT * FROM luminaire_library_asset_versions WHERE asset_version_id = ?')
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Library Asset Version not found.', 404);
    return assetVersion(row);
  }
  public getAssetVersionType(id: string): LuminaireLibraryAssetType {
    const row = this.database
      .prepare(
        `SELECT a.asset_type FROM luminaire_library_asset_versions av
         JOIN luminaire_library_assets a ON a.asset_id = av.asset_id
         WHERE av.asset_version_id = ?`,
      )
      .get(id) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Library Asset Version not found.', 404);
    return String(row.asset_type) as LuminaireLibraryAssetType;
  }
  public getVersionAssets(
    id: string,
  ): Array<LuminaireLibraryAssetVersion & { assetType: LuminaireLibraryAssetType }> {
    return (
      this.database
        .prepare(
          `SELECT av.*, va.asset_type FROM luminaire_library_version_assets va
       JOIN luminaire_library_asset_versions av ON av.asset_version_id = va.asset_version_id
       WHERE va.version_id = ? ORDER BY va.asset_type, av.asset_version_id`,
        )
        .all(id) as Row[]
    ).map((row) => ({
      ...assetVersion(row),
      assetType: String(row.asset_type) as LuminaireLibraryAssetType,
    }));
  }
  public getBinding(projectId: string, luminaireId: string): ProjectLuminaireLibraryBinding {
    const row = this.database
      .prepare(
        'SELECT * FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
      )
      .get(projectId, luminaireId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project Luminaire has no Library binding.', 404);
    return binding(row);
  }
  public assetTypesForVersions(ids: readonly string[]): Map<string, LuminaireLibraryAssetType> {
    const result = new Map<string, LuminaireLibraryAssetType>();
    const query = this.database.prepare(
      `SELECT av.asset_version_id, a.asset_type FROM luminaire_library_asset_versions av
       JOIN luminaire_library_assets a ON a.asset_id = av.asset_id WHERE av.asset_version_id = ?`,
    );
    for (const id of ids) {
      const row = query.get(id) as Row | undefined;
      if (!row)
        throw new DomainError(
          'CONFLICT',
          'Published Version references a missing Asset Version.',
          409,
        );
      result.set(String(row.asset_version_id), String(row.asset_type) as LuminaireLibraryAssetType);
    }
    return result;
  }

  private latestEffectiveAssetVersions(
    productId: string,
    variantId: string,
  ): LuminaireLibraryAssetVersion[] {
    return (
      this.database
        .prepare(
          `SELECT av.* FROM luminaire_library_assets a
       JOIN luminaire_library_asset_versions av ON av.asset_id = a.asset_id
       WHERE a.product_id = ? AND a.status = 'ACTIVE' AND (a.variant_id IS NULL OR a.variant_id = ?)
       AND av.version_sequence = (SELECT MAX(av2.version_sequence) FROM luminaire_library_asset_versions av2 WHERE av2.asset_id = a.asset_id)
       ORDER BY a.asset_type, a.asset_id`,
        )
        .all(productId, variantId) as Row[]
    ).map(assetVersion);
  }

  private libraryFacets(
    query: LuminaireLibraryListQuery,
    published: readonly PublishedVariantCandidate[],
  ): LibraryFacets {
    const values = (entries: Array<[string, string]>) => {
      const result = new Map<string, string>();
      for (const [value, label] of entries)
        if (value && !result.has(value)) result.set(value, label);
      return result;
    };
    const manufacturers = values(
      published.map((item) => [
        item.snapshot.manufacturerId,
        item.snapshot.manufacturerName || item.manufacturer.name,
      ]),
    );
    const productTypes = values(
      published.map((item) => {
        const label = item.snapshot.productType.trim();
        return [label, label];
      }),
    );
    const cctKelvin = values(
      published.flatMap((item): Array<[string, string]> => {
        const value = parseLuminaireCctKelvin(item.snapshot.lightColor);
        return value === null ? [] : [[String(value), `${value}K`]];
      }),
    );
    const beams = values(
      published.flatMap((item): Array<[string, string]> => {
        const display = item.snapshot.beamAngle.trim();
        if (!display) return [];
        const degrees = parseLuminaireBeamDegrees(display);
        return degrees === null
          ? [[normalizeLuminaireFacet(display), display]]
          : [[`${degrees}°`, `${degrees}°`]];
      }),
    );
    const normalizedText = (field: 'ipRating' | 'control' | 'mounting') =>
      values(
        published.flatMap((item): Array<[string, string]> => {
          const display = item.snapshot[field].trim();
          return display ? [[normalizeLuminaireFacet(display), display]] : [];
        }),
      );
    const groupedCounts = (
      dimension: LibraryFacetDimension,
      resolve: (candidate: PublishedVariantCandidate) => string,
    ) => {
      const counts = new Map<string, number>();
      for (const candidate of published) {
        if (!this.matchesPublishedVariant(candidate, query, dimension)) continue;
        const key = resolve(candidate);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    const options = (choices: ReadonlyMap<string, string>, counts: ReadonlyMap<string, number>) =>
      [...choices.entries()]
        .map(([value, label]) => ({ value, label, count: counts.get(value) ?? 0 }))
        .sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
        );
    return {
      manufacturers: options(
        manufacturers,
        groupedCounts('manufacturer', (item) => item.snapshot.manufacturerId),
      ),
      productTypes: options(
        productTypes,
        groupedCounts('productType', (item) => item.snapshot.productType.trim()),
      ),
      cctKelvin: options(
        cctKelvin,
        groupedCounts('cct', (item) =>
          String(parseLuminaireCctKelvin(item.snapshot.lightColor) ?? ''),
        ),
      ),
      beams: options(
        beams,
        groupedCounts('beam', (item) => this.beamFacet(item.snapshot.beamAngle)),
      ),
      ipRatings: options(
        normalizedText('ipRating'),
        groupedCounts('ip', (item) => normalizeLuminaireFacet(item.snapshot.ipRating)),
      ),
      controls: options(
        normalizedText('control'),
        groupedCounts('control', (item) => normalizeLuminaireFacet(item.snapshot.control)),
      ),
      mountings: options(
        normalizedText('mounting'),
        groupedCounts('mounting', (item) => normalizeLuminaireFacet(item.snapshot.mounting)),
      ),
    };
  }

  private publishedAssetAvailability(assetVersionIds: readonly string[]) {
    const types = this.assetTypesForVersions(assetVersionIds);
    const has = (type: LuminaireLibraryAssetType) => [...types.values()].includes(type);
    const hasIes = has('IES');
    const hasLdt = has('LDT');
    return {
      hasProductImage: has('ProductImage'),
      hasDatasheet: has('Datasheet'),
      hasIes,
      hasLdt,
      missingPhotometry: !hasIes && !hasLdt,
      productImageAssetVersionId:
        assetVersionIds.find((assetVersionId) => types.get(assetVersionId) === 'ProductImage') ??
        null,
    };
  }

  private variantAssetAvailability(productId: string, variantId: string) {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT a.asset_type FROM luminaire_library_assets a
         JOIN luminaire_library_asset_versions av ON av.asset_id = a.asset_id
         WHERE a.product_id = ? AND (a.variant_id IS NULL OR a.variant_id = ?)
           AND a.status = 'ACTIVE'
           AND av.version_sequence = (SELECT MAX(av2.version_sequence)
             FROM luminaire_library_asset_versions av2 WHERE av2.asset_id = a.asset_id)`,
      )
      .all(productId, variantId) as Row[];
    const types = new Set(rows.map((row) => String(row.asset_type)));
    const image = this.database
      .prepare(
        `SELECT av.asset_version_id FROM luminaire_library_assets a
         JOIN luminaire_library_asset_versions av ON av.asset_id = a.asset_id
         WHERE a.product_id = ? AND (a.variant_id IS NULL OR a.variant_id = ?)
           AND a.status = 'ACTIVE' AND a.asset_type = 'ProductImage'
           AND av.version_sequence = (SELECT MAX(av2.version_sequence)
             FROM luminaire_library_asset_versions av2 WHERE av2.asset_id = a.asset_id)
         ORDER BY CASE WHEN a.variant_id = ? THEN 0 ELSE 1 END, av.version_sequence DESC,
                  a.asset_id LIMIT 1`,
      )
      .get(productId, variantId, variantId) as Row | undefined;
    const hasIes = types.has('IES');
    const hasLdt = types.has('LDT');
    return {
      hasProductImage: types.has('ProductImage'),
      hasDatasheet: types.has('Datasheet'),
      hasIes,
      hasLdt,
      missingPhotometry: !hasIes && !hasLdt,
      productImageAssetVersionId: image ? String(image.asset_version_id) : null,
    };
  }

  private insertVariant(
    id: string,
    owner: LuminaireLibraryProduct,
    draft: LuminaireLibraryVariantDraft,
    actor: AppUser,
    time: string,
  ): void {
    this.assertOrderingCodeAvailable(owner.manufacturerId, draft.orderingCode);
    const normalized = normalizeLuminaireTechnicalValues(draft);
    this.database
      .prepare(
        `INSERT INTO luminaire_library_variants
         (variant_id, product_id, manufacturer_id, variant_label, normalized_label, ordering_code,
          normalized_ordering_code, wattage, wattage_value, wattage_basis, lumens, lumens_value,
          lumens_basis, light_color, cct_kelvin, cri, cri_value, beam_angle, beam_degrees,
          beam_facet, ip_rating, ip_facet, mounting, cutout, driver, control, control_facet,
          emergency, dimensions, body_color_finish, status, row_version, latest_published_version_id,
          created_by_id, created_by_name, created_at, updated_by_id, updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, 'ACTIVE', 1, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        owner.productId,
        owner.manufacturerId,
        draft.variantLabel,
        normalizeManufacturerName(draft.variantLabel),
        draft.orderingCode,
        normalized.normalizedOrderingCode,
        draft.wattage,
        normalized.wattageValue,
        normalized.wattageBasis,
        draft.lumens,
        normalized.lumensValue,
        normalized.lumensBasis,
        draft.lightColor,
        normalized.cctKelvin,
        draft.cri,
        normalized.criValue,
        draft.beamAngle,
        normalized.beamDegrees,
        normalized.beamFacet,
        draft.ipRating,
        normalized.ipFacet,
        draft.mounting,
        draft.cutout,
        draft.driver,
        draft.control,
        normalized.controlFacet,
        draft.emergency,
        draft.dimensions,
        draft.bodyColorFinish,
        actor.id,
        actor.displayName,
        time,
        actor.id,
        actor.displayName,
        time,
      );
  }

  private assertOrderingCodeAvailable(
    manufacturerId: string,
    orderingCode: string,
    excludeVariantId?: string,
  ): void {
    const normalized = normalizeLuminaireOrderingCode(orderingCode);
    if (!normalized) return;
    const existing = this.database
      .prepare(
        `SELECT v.variant_id, v.ordering_code, p.product_id, p.name AS product_name,
                m.name AS manufacturer_name
         FROM luminaire_library_variants v
         JOIN luminaire_library_products p ON p.product_id = v.product_id
         JOIN luminaire_manufacturers m ON m.manufacturer_id = v.manufacturer_id
         WHERE v.manufacturer_id = ? AND v.normalized_ordering_code = ?
           AND (? IS NULL OR v.variant_id <> ?)
         LIMIT 1`,
      )
      .get(manufacturerId, normalized, excludeVariantId ?? null, excludeVariantId ?? null) as
      Row | undefined;
    if (!existing) return;
    throw new DomainError(
      'CONFLICT',
      `This ${String(existing.manufacturer_name)} ordering code already exists in the Master Library.`,
      409,
      {
        conflictKind: 'DUPLICATE_ORDERING_CODE',
        manufacturerName: String(existing.manufacturer_name),
        productId: String(existing.product_id),
        productName: String(existing.product_name),
        variantId: String(existing.variant_id),
        orderingCode: String(existing.ordering_code),
      },
    );
  }

  private staleOrMissing(kind: string, id: string): never {
    const config: Readonly<Record<string, readonly [string, string]>> = {
      Manufacturer: ['luminaire_manufacturers', 'manufacturer_id'],
      MANUFACTURER: ['luminaire_manufacturers', 'manufacturer_id'],
      Product: ['luminaire_library_products', 'product_id'],
      PRODUCT: ['luminaire_library_products', 'product_id'],
      Variant: ['luminaire_library_variants', 'variant_id'],
      VARIANT: ['luminaire_library_variants', 'variant_id'],
    };
    const item = config[kind];
    if (!item || !this.database.prepare(`SELECT 1 FROM ${item[0]} WHERE ${item[1]} = ?`).get(id)) {
      throw new DomainError('NOT_FOUND', `${kind} not found.`, 404);
    }
    throw new DomainError('CONFLICT', `${kind} changed before this operation.`, 409);
  }
}
