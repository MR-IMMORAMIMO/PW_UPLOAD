import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportSparseChange, LuminaireRecordInput } from '@scli/contracts';
import {
  canonicalizeLuminaireTag,
  DomainError,
  normalizeLuminaireTag,
  type LuminaireRecord,
} from '@scli/domain';

type Row = Readonly<Record<string, unknown>>;

const FIELD_COLUMNS = Object.freeze({
  category: 'category',
  description: 'description',
  manufacturer: 'manufacturer',
  model: 'model',
  productType: 'product_type',
  variantLabel: 'variant_label',
  orderingCode: 'ordering_code',
  wattage: 'wattage',
  lumens: 'lumens',
  lightColor: 'light_color',
  cri: 'cri',
  beamAngle: 'beam_angle',
  ipRating: 'ip_rating',
  mounting: 'mounting',
  cutout: 'cutout',
  driver: 'driver',
  control: 'control',
  emergency: 'emergency',
  location: 'location',
  unit: 'unit',
  quantity: 'quantity',
  notes: 'notes',
  dimensions: 'dimensions',
  bodyColorFinish: 'body_color_finish',
} satisfies Record<ImportSparseChange['field'], string>);

export const PROJECT_OWNED_LINKED_FIELDS = Object.freeze(
  new Set<ImportSparseChange['field']>(['category', 'location', 'unit', 'quantity', 'notes']),
);

function read(row: Row): LuminaireRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    tag: String(row.tag),
    category: String(row.category),
    imagePath: String(row.image_path),
    description: String(row.description),
    manufacturer: String(row.manufacturer),
    model: String(row.model),
    productType: String(row.product_type ?? ''),
    variantLabel: String(row.variant_label ?? ''),
    orderingCode: String(row.ordering_code ?? ''),
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
    datasheetPath: String(row.datasheet_path),
    location: String(row.location),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    notes: String(row.notes),
    sourceName: String(row.source_name),
    dimensions: String(row.dimensions),
    bodyColorFinish: String(row.body_color_finish),
    rowVersion: Number(row.row_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ProjectLuminaireWriteStore {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  public get(projectId: string, luminaireId: string): LuminaireRecord {
    const row = this.database
      .prepare('SELECT * FROM project_luminaires WHERE project_id = ? AND id = ?')
      .get(projectId, luminaireId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project Luminaire not found.', 404);
    return read(row);
  }

  public canonicalMatches(
    projectId: string,
    tags: readonly string[],
  ): Map<string, LuminaireRecord[]> {
    const wanted = new Set(tags.map(normalizeLuminaireTag).filter(Boolean));
    const matches = new Map<string, LuminaireRecord[]>();
    for (const row of this.database
      .prepare('SELECT * FROM project_luminaires WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId) as Row[]) {
      const key = normalizeLuminaireTag(String(row.tag));
      if (!wanted.has(key)) continue;
      const list = matches.get(key) ?? [];
      list.push(read(row));
      matches.set(key, list);
    }
    return matches;
  }

  public create(
    projectId: string,
    input: LuminaireRecordInput,
    options: { id?: string; createdAt?: string } = {},
  ): LuminaireRecord {
    const tag = canonicalizeLuminaireTag(input.tag);
    if (!tag)
      throw new DomainError('IMPORT_PROJECT_TAG_CONFLICT', 'A Project Tag is required.', 409);
    this.assertTagAvailable(projectId, tag);
    const id = options.id ?? this.uuid();
    const now = options.createdAt ?? this.clock().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_luminaires (
        id, project_id, tag, category, image_path, description, manufacturer, model,
        product_type, variant_label, ordering_code, wattage, lumens, light_color, cri,
        beam_angle, ip_rating, mounting, cutout, driver, control, emergency, datasheet_path,
        location, unit, quantity, notes, source_name, dimensions, body_color_finish,
        row_version, created_at, updated_at
      ) VALUES (${Array.from({ length: 33 }, () => '?').join(', ')})`,
      )
      .run(
        id,
        projectId,
        tag,
        input.category,
        input.imagePath,
        input.description,
        input.manufacturer,
        input.model,
        input.productType ?? '',
        input.variantLabel ?? '',
        input.orderingCode ?? '',
        input.wattage,
        input.lumens,
        input.lightColor,
        input.cri,
        input.beamAngle,
        input.ipRating,
        input.mounting,
        input.cutout,
        input.driver,
        input.control,
        input.emergency,
        input.datasheetPath,
        input.location,
        input.unit,
        input.quantity,
        input.notes,
        input.sourceName,
        input.dimensions,
        input.bodyColorFinish,
        1,
        now,
        now,
      );
    return this.get(projectId, id);
  }

  public patch(
    projectId: string,
    luminaireId: string,
    expectedRowVersion: number,
    expectedCanonicalTag: string,
    changes: readonly ImportSparseChange[],
    linked: boolean,
  ): LuminaireRecord {
    const current = this.get(projectId, luminaireId);
    if (normalizeLuminaireTag(current.tag) !== normalizeLuminaireTag(expectedCanonicalTag))
      throw new DomainError('IMPORT_TARGET_CHANGED', 'The Project Luminaire Tag changed.', 409);
    if (current.rowVersion !== expectedRowVersion)
      throw new DomainError(
        'IMPORT_TARGET_CHANGED',
        'The Project Luminaire changed after review.',
        409,
      );
    const effective = changes.filter((change) => {
      if (linked && !PROJECT_OWNED_LINKED_FIELDS.has(change.field))
        throw new DomainError(
          'IMPORT_ACTION_INVALID',
          'A Library-linked technical field cannot be changed by Smart Import.',
          409,
        );
      return current[change.field] !== change.after;
    });
    if (effective.length === 0) return current;
    if (new Set(effective.map((change) => change.field)).size !== effective.length)
      throw new DomainError(
        'IMPORT_ACTION_INVALID',
        'The sparse patch contains duplicate fields.',
        400,
      );
    const now = this.clock().toISOString();
    const result = this.database
      .prepare(
        `UPDATE project_luminaires SET ${effective.map((change) => `${FIELD_COLUMNS[change.field]} = ?`).join(', ')},
       row_version = row_version + 1, updated_at = ?
       WHERE id = ? AND project_id = ? AND row_version = ?`,
      )
      .run(
        ...effective.map((change) => change.after),
        now,
        luminaireId,
        projectId,
        expectedRowVersion,
      );
    if (result.changes !== 1)
      throw new DomainError(
        'IMPORT_TARGET_CHANGED',
        'The Project Luminaire changed after review.',
        409,
      );
    return this.get(projectId, luminaireId);
  }

  private assertTagAvailable(projectId: string, tag: string): void {
    const existing = this.database
      .prepare(
        'SELECT 1 FROM project_luminaires WHERE project_id = ? AND LOWER(TRIM(tag)) = ? LIMIT 1',
      )
      .get(projectId, normalizeLuminaireTag(tag));
    if (existing)
      throw new DomainError(
        'IMPORT_PROJECT_TAG_CONFLICT',
        'The Project Tag is already used in this Project.',
        409,
      );
  }
}
