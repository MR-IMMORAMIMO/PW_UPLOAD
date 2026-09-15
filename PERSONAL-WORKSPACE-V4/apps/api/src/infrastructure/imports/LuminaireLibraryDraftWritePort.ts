import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportLibraryVariantDraftPlan } from '@scli/contracts';
import {
  DomainError,
  normalizeLuminaireOrderingCode,
  normalizeLuminaireTechnicalValues,
  normalizeManufacturerName,
  type AppUser,
} from '@scli/domain';

type Row = Readonly<Record<string, unknown>>;

export interface LibraryManufacturerAuthority {
  manufacturerId: string;
  name: string;
  normalizedName: string;
  status: 'ACTIVE' | 'ARCHIVED';
  rowVersion: number;
}

export interface LibraryProductAuthority {
  productId: string;
  manufacturerId: string;
  name: string;
  normalizedName: string;
  productType: string;
  description: string;
  status: 'ACTIVE' | 'ARCHIVED';
  rowVersion: number;
}

export interface LibraryVariantAuthority {
  variantId: string;
  productId: string;
  manufacturerId: string;
  variantLabel: string;
  normalizedLabel: string;
  orderingCode: string;
  normalizedOrderingCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  rowVersion: number;
  latestPublishedVersionId: string | null;
  technicalSummary: string;
  technical: {
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
  };
}

export interface LibraryDraftCatalogueAuthority {
  manufacturers: LibraryManufacturerAuthority[];
  products: LibraryProductAuthority[];
  variants: LibraryVariantAuthority[];
}

export interface LibraryDraftCreationResult {
  manufacturerId: string;
  productId: string;
  variantId: string;
  manufacturerCreated: boolean;
  productCreated: boolean;
}

export interface LuminaireLibraryDraftWritePort {
  catalogue(): LibraryDraftCatalogueAuthority;
  transaction<T>(operation: () => T): T;
  replay<T>(idempotencyKey: string): T | null;
  createManufacturer(
    id: string,
    name: string,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryManufacturerAuthority;
  createProduct(
    id: string,
    manufacturerId: string,
    family: string,
    productType: string,
    description: string,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryProductAuthority;
  createVariant(
    productId: string,
    draft: ImportLibraryVariantDraftPlan,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryVariantAuthority;
}

function manufacturer(row: Row): LibraryManufacturerAuthority {
  return {
    manufacturerId: String(row.manufacturer_id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    status: String(row.status) as LibraryManufacturerAuthority['status'],
    rowVersion: Number(row.row_version),
  };
}

function product(row: Row): LibraryProductAuthority {
  return {
    productId: String(row.product_id),
    manufacturerId: String(row.manufacturer_id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    productType: String(row.product_type),
    description: String(row.description),
    status: String(row.status) as LibraryProductAuthority['status'],
    rowVersion: Number(row.row_version),
  };
}

function variant(row: Row): LibraryVariantAuthority {
  const technical = {
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
  };
  return {
    variantId: String(row.variant_id),
    productId: String(row.product_id),
    manufacturerId: String(row.manufacturer_id),
    variantLabel: String(row.variant_label),
    normalizedLabel: String(row.normalized_label),
    orderingCode: String(row.ordering_code),
    normalizedOrderingCode: String(row.normalized_ordering_code),
    status: String(row.status) as LibraryVariantAuthority['status'],
    rowVersion: Number(row.row_version),
    latestPublishedVersionId:
      row.latest_published_version_id == null ? null : String(row.latest_published_version_id),
    technicalSummary: [
      technical.wattage,
      technical.lumens,
      technical.lightColor,
      technical.beamAngle,
    ]
      .map(String)
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500),
    technical,
  };
}

export class SqliteLuminaireLibraryDraftWritePort implements LuminaireLibraryDraftWritePort {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  public catalogue(): LibraryDraftCatalogueAuthority {
    return {
      manufacturers: (
        this.database
          .prepare(
            `SELECT manufacturer_id, name, normalized_name, status, row_version
             FROM luminaire_manufacturers ORDER BY normalized_name, manufacturer_id`,
          )
          .all() as Row[]
      ).map(manufacturer),
      products: (
        this.database
          .prepare(
            `SELECT product_id, manufacturer_id, name, normalized_name, product_type,
                    description, status, row_version
             FROM luminaire_library_products
             ORDER BY manufacturer_id, normalized_name, product_id`,
          )
          .all() as Row[]
      ).map(product),
      variants: (
        this.database
          .prepare(
            `SELECT variant_id, product_id, manufacturer_id, variant_label, normalized_label,
                    ordering_code, normalized_ordering_code, status, row_version,
                    latest_published_version_id, wattage, lumens, light_color, cri, beam_angle,
                    ip_rating, mounting, cutout, driver, control, emergency, dimensions,
                    body_color_finish
             FROM luminaire_library_variants
             ORDER BY manufacturer_id, normalized_ordering_code, variant_id`,
          )
          .all() as Row[]
      ).map(variant),
    };
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
        // Preserve the original error.
      }
      throw error;
    }
  }

  public replay<T>(idempotencyKey: string): T | null {
    const row = this.database
      .prepare('SELECT result_json FROM luminaire_library_activity WHERE idempotency_key = ?')
      .get(idempotencyKey) as Row | undefined;
    return row ? (JSON.parse(String(row.result_json)) as T) : null;
  }

  public createManufacturer(
    id: string,
    name: string,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryManufacturerAuthority {
    const replay = this.replay<LibraryManufacturerAuthority>(idempotencyKey);
    if (replay) return replay;
    const normalizedName = normalizeManufacturerName(name);
    const conflict = this.database
      .prepare('SELECT manufacturer_id FROM luminaire_manufacturers WHERE normalized_name = ?')
      .get(normalizedName) as Row | undefined;
    if (conflict)
      throw new DomainError(
        'IMPORT_DESTINATION_CHANGED',
        'A matching Manufacturer appeared after reconciliation.',
        409,
      );
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
        name,
        normalizedName,
        actor.id,
        actor.displayName,
        time,
        actor.id,
        actor.displayName,
        time,
      );
    const created = manufacturer(
      this.database
        .prepare('SELECT * FROM luminaire_manufacturers WHERE manufacturer_id = ?')
        .get(id) as Row,
    );
    this.recordActivity(
      'MANUFACTURER',
      id,
      'IMPORT_DRAFT_CREATED',
      provenance,
      created,
      actor,
      idempotencyKey,
    );
    return created;
  }

  public createProduct(
    id: string,
    manufacturerId: string,
    family: string,
    productType: string,
    description: string,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryProductAuthority {
    const replay = this.replay<LibraryProductAuthority>(idempotencyKey);
    if (replay) return replay;
    const normalizedName = normalizeManufacturerName(family);
    const conflict = this.database
      .prepare(
        `SELECT product_id FROM luminaire_library_products
         WHERE manufacturer_id = ? AND normalized_name = ?`,
      )
      .get(manufacturerId, normalizedName) as Row | undefined;
    if (conflict)
      throw new DomainError(
        'IMPORT_DESTINATION_CHANGED',
        'A matching Product appeared after reconciliation.',
        409,
      );
    const time = this.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO luminaire_library_products
         (product_id, manufacturer_id, name, normalized_name, product_type, description,
          status, row_version, created_by_id, created_by_name, created_at, updated_by_id,
          updated_by_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        manufacturerId,
        family,
        normalizedName,
        productType,
        description,
        actor.id,
        actor.displayName,
        time,
        actor.id,
        actor.displayName,
        time,
      );
    const created = product(
      this.database
        .prepare('SELECT * FROM luminaire_library_products WHERE product_id = ?')
        .get(id) as Row,
    );
    this.recordActivity(
      'PRODUCT',
      id,
      'IMPORT_DRAFT_CREATED',
      provenance,
      created,
      actor,
      idempotencyKey,
    );
    return created;
  }

  public createVariant(
    productId: string,
    draft: ImportLibraryVariantDraftPlan,
    actor: AppUser,
    idempotencyKey: string,
    provenance: unknown,
  ): LibraryVariantAuthority {
    const replay = this.replay<LibraryVariantAuthority>(idempotencyKey);
    if (replay) return replay;
    const owner = this.database
      .prepare(
        'SELECT manufacturer_id, status FROM luminaire_library_products WHERE product_id = ?',
      )
      .get(productId) as Row | undefined;
    if (!owner || String(owner.status) !== 'ACTIVE')
      throw new DomainError(
        'IMPORT_DESTINATION_CHANGED',
        'The planned Product is unavailable.',
        409,
      );
    if (draft.assetVersionIds.length !== 0)
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'Library import cannot copy asset identities.',
        409,
      );
    const normalizedOrderingCode = normalizeLuminaireOrderingCode(draft.orderingCode);
    if (normalizedOrderingCode) {
      const conflict = this.database
        .prepare(
          `SELECT variant_id FROM luminaire_library_variants
           WHERE manufacturer_id = ? AND normalized_ordering_code = ?`,
        )
        .get(String(owner.manufacturer_id), normalizedOrderingCode) as Row | undefined;
      if (conflict)
        throw new DomainError(
          'IMPORT_DESTINATION_CHANGED',
          'The planned Ordering Code is no longer available.',
          409,
        );
    }
    const technical = normalizeLuminaireTechnicalValues(draft);
    if (
      technical.wattageBasis !== draft.wattageBasis ||
      technical.lumensBasis !== draft.lumensBasis
    )
      throw new DomainError('IMPORT_PLAN_STALE', 'The planned technical basis changed.', 409);
    const time = this.now().toISOString();
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
        draft.plannedVariantId,
        productId,
        String(owner.manufacturer_id),
        draft.variantLabel,
        normalizeManufacturerName(draft.variantLabel),
        draft.orderingCode,
        technical.normalizedOrderingCode,
        draft.wattage,
        technical.wattageValue,
        technical.wattageBasis,
        draft.lumens,
        technical.lumensValue,
        technical.lumensBasis,
        draft.lightColor,
        technical.cctKelvin,
        draft.cri,
        technical.criValue,
        draft.beamAngle,
        technical.beamDegrees,
        technical.beamFacet,
        draft.ipRating,
        technical.ipFacet,
        draft.mounting,
        draft.cutout,
        draft.driver,
        draft.control,
        technical.controlFacet,
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
    const created = variant(
      this.database
        .prepare('SELECT * FROM luminaire_library_variants WHERE variant_id = ?')
        .get(draft.plannedVariantId) as Row,
    );
    this.recordActivity(
      'VARIANT',
      draft.plannedVariantId,
      'IMPORT_DRAFT_CREATED',
      provenance,
      created,
      actor,
      idempotencyKey,
    );
    return created;
  }

  private recordActivity(
    entityType: string,
    entityId: string,
    action: string,
    detail: unknown,
    result: unknown,
    actor: AppUser,
    idempotencyKey: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO luminaire_library_activity
         (activity_id, entity_type, entity_id, project_id, action, detail_json, result_json,
          idempotency_key, actor_id, actor_name, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.uuid(),
        entityType,
        entityId,
        action,
        JSON.stringify(detail),
        JSON.stringify(result),
        idempotencyKey,
        actor.id,
        actor.displayName,
        this.now().toISOString(),
      );
  }
}
