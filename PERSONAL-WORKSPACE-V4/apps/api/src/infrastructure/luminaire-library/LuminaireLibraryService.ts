import { randomUUID } from 'node:crypto';
import { readVerifiedCanonicalArtifact } from '../output-registry/canonical-artifact-files.js';
import type {
  AddProjectLuminaireFromLibraryInput,
  CreateProjectLuminaireLibraryDraftInput,
  CreateLuminaireLibraryAssetVersionInput,
  UpdateProjectLuminaireFromLibraryInput,
  UpdateProjectLuminaireDescriptionOverrideInput,
} from '@scli/contracts';
import type {
  AppUser,
  LuminaireLibraryAssetType,
  LuminaireLibraryVariantDraft,
  LuminaireManufacturer,
  LuminaireLibraryBindingStatus,
  LuminaireLibraryVersionComparison,
  ProjectLuminaireLibraryBinding,
} from '@scli/domain';
import {
  compareLuminaireLibraryVersions,
  DomainError,
  effectiveProjectLuminaireDescription,
  normalizeManufacturerName,
} from '@scli/domain';
import {
  LuminaireLibraryAssetStorage,
  type ManagedAssetWrite,
} from './LuminaireLibraryAssetStorage.js';
import { LuminaireLibraryStore } from './LuminaireLibraryStore.js';
import type { ProjectPromotionDraftResult } from './LuminaireLibraryStore.js';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore.js';

export interface ProjectLibraryStatus {
  binding: ProjectLuminaireLibraryBinding;
  status: LuminaireLibraryBindingStatus;
  selectedVersionId: string;
  selectedVersionSequence: number;
  latestVersionId: string;
  latestVersionSequence: number;
}

export interface ProjectLibrarySelectionResult {
  projectId: string;
  luminaireId: string;
  binding: ProjectLuminaireLibraryBinding;
}

export interface ProjectLibraryComparison extends LuminaireLibraryVersionComparison {
  currentPublishedAt: string;
  targetPublishedAt: string;
  currentVersionSequence: number;
  targetVersionSequence: number;
}

export interface ProjectLuminaireLibraryDraftCandidate {
  eligibility: {
    eligible: boolean;
    reasonCode: 'ELIGIBLE' | 'ALREADY_LINKED';
    reason: string;
  };
  source: {
    projectId: string;
    luminaireId: string;
    manufacturerName: string;
    productName: string;
    productType: string;
    description: string;
    variant: LuminaireLibraryVariantDraft;
  };
  excludedProjectFields: Array<{
    field: 'tag' | 'category' | 'location' | 'unit' | 'quantity' | 'notes';
    label: string;
    value: string;
  }>;
  manufacturerMatches: LuminaireManufacturer[];
  duplicateSuggestions: Array<{
    strength: 'Strong' | 'Likely' | 'Possible';
    productId: string;
    productName: string;
    variantId: string | null;
    variantLabel: string | null;
    reason: string;
  }>;
  assets: Array<{
    assetType: LuminaireLibraryAssetType;
    present: boolean;
    projectAssetVersionId: string | null;
    fileName: string | null;
    storedHash: string | null;
  }>;
}

interface ProjectAssetRow {
  id: string;
  asset_type: string;
  file_name: string;
  file_hash: string | null;
  locator_kind: string;
  locator_value: string;
}

export class LuminaireLibraryService {
  public constructor(
    private readonly store: LuminaireLibraryStore,
    private readonly storage: LuminaireLibraryAssetStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  public async assetContent(assetVersionId: string, dataRoot: string) {
    const version = this.store.getAssetVersion(assetVersionId);
    const file = await readVerifiedCanonicalArtifact(
      dataRoot,
      version.locatorValue,
      version.contentHash,
    );
    return {
      ...file,
      mimeType: version.mimeType,
      fileName: version.fileName,
      contentHash: version.contentHash,
    };
  }

  public productImageContent(assetVersionId: string): {
    absolutePath: string;
    mimeType: string;
    contentHash: string;
  } {
    if (this.store.getAssetVersionType(assetVersionId) !== 'ProductImage') {
      throw new DomainError('NOT_FOUND', 'Product image not found.', 404);
    }
    const version = this.store.getAssetVersion(assetVersionId);
    return {
      absolutePath: this.storage.resolveLocator(version.locatorValue),
      mimeType: version.mimeType,
      contentHash: version.contentHash,
    };
  }

  public async admitAssetVersion(
    assetId: string,
    input: CreateLuminaireLibraryAssetVersionInput,
    actor: AppUser,
  ) {
    const replay = this.store.replay<ReturnType<LuminaireLibraryStore['getAssetVersion']>>(
      input.idempotencyKey,
    );
    if (replay) return replay;
    const logical = this.store.getAsset(assetId);
    const managed = await this.storage.admitLibraryAsset(input.sourceFilePath, logical.assetType);
    try {
      return this.store.addAssetVersion(
        assetId,
        {
          assetVersionId: managed.assetVersionId,
          fileName: managed.fileName,
          mimeType: managed.mimeType,
          sizeBytes: managed.sizeBytes,
          contentHash: managed.contentHash,
          locatorValue: managed.locatorValue,
          expectedLatestSequence: input.expectedLatestSequence,
          idempotencyKey: input.idempotencyKey,
        },
        actor,
      );
    } catch (error) {
      await managed.cleanup();
      throw error;
    }
  }

  public draftCandidate(
    projectId: string,
    luminaireId: string,
  ): ProjectLuminaireLibraryDraftCandidate {
    const database = this.store.getDatabase();
    const row = database
      .prepare('SELECT * FROM project_luminaires WHERE project_id = ? AND id = ?')
      .get(projectId, luminaireId) as Readonly<Record<string, unknown>> | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project Luminaire not found.', 404);
    const linked = Boolean(
      database
        .prepare(
          'SELECT 1 FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
        )
        .get(projectId, luminaireId),
    );
    const manufacturerName = String(row.manufacturer).trim();
    const projectModel = String(row.model).trim();
    const explicitOrderingCode = String(row.ordering_code ?? '').trim();
    const productName =
      explicitOrderingCode &&
      normalizeManufacturerName(projectModel) !== normalizeManufacturerName(explicitOrderingCode)
        ? projectModel
        : '';
    const orderingCode = explicitOrderingCode || projectModel;
    const manufacturerMatches = (
      database
        .prepare(
          `SELECT * FROM luminaire_manufacturers
           WHERE normalized_name = ? ORDER BY status, manufacturer_id`,
        )
        .all(normalizeManufacturerName(manufacturerName)) as Array<
        Readonly<Record<string, unknown>>
      >
    ).map((candidate) => this.store.getManufacturer(String(candidate.manufacturer_id)));
    const activeMatch = manufacturerMatches.find((candidate) => candidate.status === 'ACTIVE');
    const duplicateSuggestions = activeMatch
      ? this.store
          .duplicateSuggestions({
            manufacturerId: activeMatch.manufacturerId,
            productName,
            orderingCode,
          })
          .map((suggestion) => ({
            ...suggestion,
            productName: this.store.getProduct(suggestion.productId).name,
            variantLabel: suggestion.variantId
              ? this.store.getVariant(suggestion.variantId).variantLabel
              : null,
          }))
      : [];
    const latestAssets = this.projectAssetRows(projectId, luminaireId);
    const sourceVariant: LuminaireLibraryVariantDraft = {
      variantLabel:
        String(row.variant_label ?? '').trim() ||
        [
          row.wattage,
          row.lumens,
          row.light_color,
          row.cri,
          row.beam_angle,
          row.body_color_finish,
          row.control,
        ]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
          .join(' / ') ||
        'Project Luminaire',
      orderingCode,
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
      eligibility: linked
        ? {
            eligible: false,
            reasonCode: 'ALREADY_LINKED',
            reason: 'This Project Luminaire already has an active Master Library binding.',
          }
        : {
            eligible: true,
            reasonCode: 'ELIGIBLE',
            reason: 'Project-only Luminaire is eligible to create a mutable Library Draft.',
          },
      source: {
        projectId,
        luminaireId,
        manufacturerName,
        productName,
        productType: String(row.product_type ?? ''),
        description: String(row.description),
        variant: sourceVariant,
      },
      excludedProjectFields: [
        { field: 'tag', label: 'Tag', value: String(row.tag) },
        { field: 'category', label: 'Project Category', value: String(row.category) },
        { field: 'location', label: 'Location', value: String(row.location) },
        { field: 'unit', label: 'Unit', value: String(row.unit) },
        { field: 'quantity', label: 'Quantity', value: String(row.quantity) },
        { field: 'notes', label: 'Project Notes', value: String(row.notes) },
      ],
      manufacturerMatches,
      duplicateSuggestions,
      assets: (['ProductImage', 'Datasheet', 'IES', 'LDT'] as const).map((assetType) => {
        const item = latestAssets.find((candidate) => candidate.asset_type === assetType);
        return {
          assetType,
          present: Boolean(item),
          projectAssetVersionId: item?.id ?? null,
          fileName: item?.file_name ?? null,
          storedHash: item?.file_hash ?? null,
        };
      }),
    };
  }

  public async createDraftFromProjectLuminaire(
    projectId: string,
    luminaireId: string,
    input: CreateProjectLuminaireLibraryDraftInput,
    actor: AppUser,
  ): Promise<ProjectPromotionDraftResult> {
    const replay = this.store.replay<ProjectPromotionDraftResult>(input.idempotencyKey);
    if (replay) return replay;
    const candidate = this.draftCandidate(projectId, luminaireId);
    if (!candidate.eligibility.eligible) {
      throw new DomainError('CONFLICT', candidate.eligibility.reason, 409);
    }
    const activeManufacturerMatch = candidate.manufacturerMatches.find(
      (item) => item.status === 'ACTIVE',
    );
    if (
      input.manufacturer.mode === 'USE_EXISTING' &&
      input.manufacturer.manufacturerId !== activeManufacturerMatch?.manufacturerId
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Select the normalized Manufacturer candidate returned by the server.',
        400,
      );
    }
    if (
      input.manufacturer.mode === 'CREATE_NEW' &&
      activeManufacturerMatch &&
      normalizeManufacturerName(input.manufacturer.name) === activeManufacturerMatch.normalizedName
    ) {
      throw new DomainError(
        'CONFLICT',
        'A normalized Manufacturer match already exists. Use that Manufacturer.',
        409,
      );
    }
    if (input.product.mode === 'USE_EXISTING') {
      const selectedProductId = input.product.productId;
      const selected = candidate.duplicateSuggestions.find(
        (item) => item.productId === selectedProductId,
      );
      if (!selected) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Use Existing Product requires an explicit server-suggested Product identity.',
          400,
        );
      }
    }

    const source = this.store
      .getDatabase()
      .prepare('SELECT updated_at FROM project_luminaires WHERE project_id = ? AND id = ?')
      .get(projectId, luminaireId) as { updated_at: string };
    const sourceAssets = this.projectAssetRows(projectId, luminaireId);
    const writes: Array<{
      sourceAsset: ProjectAssetRow;
      assetId: string;
      write: ManagedAssetWrite;
    }> = [];
    try {
      for (const sourceAsset of sourceAssets) {
        const assetType = sourceAsset.asset_type as LuminaireLibraryAssetType;
        const assetId = this.uuid();
        const assetVersionId = this.uuid();
        const write = await this.storage.promoteProjectAsset({
          locatorKind: sourceAsset.locator_kind as 'LEGACY_PATH' | 'DATA_ROOT_RELATIVE',
          locatorValue: sourceAsset.locator_value,
          storedHash: sourceAsset.file_hash,
          assetType,
          libraryAssetVersionId: assetVersionId,
        });
        writes.push({ sourceAsset, assetId, write });
      }
      return this.store.createDraftFromProjectLuminaire(
        {
          projectId,
          luminaireId,
          expectedSourceUpdatedAt: source.updated_at,
          request: input,
          manufacturerId:
            input.manufacturer.mode === 'USE_EXISTING'
              ? input.manufacturer.manufacturerId
              : this.uuid(),
          productId: input.product.mode === 'USE_EXISTING' ? input.product.productId : this.uuid(),
          variantId: this.uuid(),
          assets: writes.map(({ sourceAsset, assetId, write }) => ({
            projectAssetVersionId: sourceAsset.id,
            assetId,
            assetVersionId: write.assetVersionId,
            assetType: sourceAsset.asset_type as LuminaireLibraryAssetType,
            fileName: write.fileName,
            mimeType: write.mimeType,
            sizeBytes: write.sizeBytes,
            contentHash: write.contentHash,
            locatorValue: write.locatorValue,
          })),
        },
        actor,
      );
    } catch (error) {
      await Promise.allSettled(writes.map((item) => item.write.cleanup()));
      throw error;
    }
  }

  public async addProjectLuminaire(
    projectId: string,
    input: AddProjectLuminaireFromLibraryInput,
    actor: AppUser,
  ): Promise<ProjectLibrarySelectionResult> {
    const replay = this.store.replay<ProjectLibrarySelectionResult>(input.idempotencyKey);
    if (replay) return replay;
    const database = this.store.getDatabase();
    const published = this.store.getVersion(input.versionId);
    const variant = this.store.getVariant(published.variantId);
    const product = this.store.getProduct(variant.productId);
    const maker = this.store.getManufacturer(product.manufacturerId);
    if ([variant.status, product.status, maker.status].some((status) => status !== 'ACTIVE')) {
      throw new DomainError(
        'CONFLICT',
        'Only an active published Library Variant may be selected.',
        409,
      );
    }
    const luminaireId = this.uuid();
    const copies = await this.copyVersionAssets(published.versionId, projectId, luminaireId);
    try {
      return this.store.transaction(() => {
        const snapshot = published.snapshot;
        const time = this.now().toISOString();
        const paths = this.effectivePaths(copies);
        new ProjectLuminaireWriteStore(database, this.now, () => luminaireId).create(
          projectId,
          {
            tag: input.tag,
            category: input.category,
            imagePath: paths.ProductImage ?? '',
            description: effectiveProjectLuminaireDescription(
              snapshot.technicalDescription,
              input.descriptionOverride,
            ),
            manufacturer: snapshot.manufacturerName,
            model: snapshot.productName,
            productType: snapshot.productType,
            variantLabel: snapshot.variantLabel,
            orderingCode: snapshot.orderingCode,
            wattage: snapshot.wattage,
            lumens: snapshot.lumens,
            lightColor: snapshot.lightColor,
            cri: snapshot.cri,
            beamAngle: snapshot.beamAngle,
            ipRating: snapshot.ipRating,
            mounting: snapshot.mounting,
            cutout: snapshot.cutout,
            driver: snapshot.driver,
            control: snapshot.control,
            emergency: snapshot.emergency,
            datasheetPath: paths.Datasheet ?? '',
            location: input.location,
            unit: input.unit,
            quantity: input.quantity,
            notes: input.notes,
            sourceName: `Master Library v${published.versionSequence}`,
            dimensions: snapshot.dimensions,
            bodyColorFinish: snapshot.bodyColorFinish,
          },
          { id: luminaireId, createdAt: time },
        );
        this.insertProjectAssetRows(projectId, luminaireId, copies, actor, time);
        database
          .prepare(
            `INSERT INTO project_luminaire_library_bindings
           (project_id, luminaire_id, manufacturer_id, product_id, variant_id, selected_version_id,
            description_override, row_version, selected_by_id, selected_by_name, selected_at,
            updated_by_id, updated_by_name, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            projectId,
            luminaireId,
            snapshot.manufacturerId,
            snapshot.productId,
            snapshot.variantId,
            published.versionId,
            input.descriptionOverride,
            actor.id,
            actor.displayName,
            time,
            actor.id,
            actor.displayName,
            time,
          );
        const result: ProjectLibrarySelectionResult = {
          projectId,
          luminaireId,
          binding: this.store.getBinding(projectId, luminaireId),
        };
        this.store.activity(
          'PROJECT_LUMINAIRE',
          luminaireId,
          'SELECTED_FROM_LIBRARY',
          { versionId: published.versionId },
          result,
          actor,
          input.idempotencyKey,
          projectId,
        );
        return result;
      });
    } catch (error) {
      await this.cleanup(copies);
      throw error;
    }
  }

  public status(projectId: string, luminaireId: string): ProjectLibraryStatus {
    const binding = this.store.getBinding(projectId, luminaireId);
    const variant = this.store.getVariant(binding.variantId);
    const product = this.store.getProduct(binding.productId);
    const latest = variant.latestPublishedVersionId
      ? this.store.getVersion(variant.latestPublishedVersionId)
      : this.store.getVersion(binding.selectedVersionId);
    const status: LuminaireLibraryBindingStatus =
      variant.status === 'ARCHIVED'
        ? 'LIBRARY_VARIANT_ARCHIVED'
        : product.status === 'ARCHIVED'
          ? 'LIBRARY_PRODUCT_ARCHIVED'
          : binding.selectedVersionId === latest.versionId
            ? 'CURRENT'
            : 'UPDATE_AVAILABLE';
    const selected = this.store.getVersion(binding.selectedVersionId);
    return {
      binding,
      status,
      selectedVersionId: binding.selectedVersionId,
      selectedVersionSequence: selected.versionSequence,
      latestVersionId: latest.versionId,
      latestVersionSequence: latest.versionSequence,
    };
  }

  public compare(
    projectId: string,
    luminaireId: string,
    targetVersionId?: string,
  ): ProjectLibraryComparison {
    const currentStatus = this.status(projectId, luminaireId);
    const current = this.store.getVersion(currentStatus.selectedVersionId);
    const target = this.store.getVersion(targetVersionId ?? currentStatus.latestVersionId);
    if (target.variantId !== current.variantId)
      throw new DomainError(
        'VALIDATION_ERROR',
        'Target Version is outside this Variant lineage.',
        400,
      );
    const ids = [
      ...new Set([...current.snapshot.assetVersionIds, ...target.snapshot.assetVersionIds]),
    ];
    return {
      ...compareLuminaireLibraryVersions(current, target, this.store.assetTypesForVersions(ids)),
      currentPublishedAt: current.publishedAt,
      targetPublishedAt: target.publishedAt,
      currentVersionSequence: current.versionSequence,
      targetVersionSequence: target.versionSequence,
    };
  }

  public updateDescriptionOverride(
    projectId: string,
    luminaireId: string,
    input: UpdateProjectLuminaireDescriptionOverrideInput,
    actor: AppUser,
  ): ProjectLuminaireLibraryBinding {
    const current = this.store.getBinding(projectId, luminaireId);
    if (current.rowVersion !== input.expectedBindingRowVersion) {
      throw new DomainError(
        'CONFLICT',
        'Project Library binding changed before Description was saved.',
        409,
      );
    }
    const selected = this.store.getVersion(current.selectedVersionId);
    return this.store.transaction(() => {
      const time = this.now().toISOString();
      const database = this.store.getDatabase();
      const result = database
        .prepare(
          `UPDATE project_luminaire_library_bindings SET description_override = ?,
         row_version = row_version + 1, updated_by_id = ?, updated_by_name = ?, updated_at = ?
         WHERE project_id = ? AND luminaire_id = ? AND row_version = ?`,
        )
        .run(
          input.descriptionOverride,
          actor.id,
          actor.displayName,
          time,
          projectId,
          luminaireId,
          input.expectedBindingRowVersion,
        );
      if (result.changes !== 1)
        throw new DomainError(
          'CONFLICT',
          'Project Library binding changed before Description was saved.',
          409,
        );
      database
        .prepare(
          'UPDATE project_luminaires SET description = ?, row_version = row_version + 1, updated_at = ? WHERE project_id = ? AND id = ?',
        )
        .run(
          effectiveProjectLuminaireDescription(
            selected.snapshot.technicalDescription,
            input.descriptionOverride,
          ),
          time,
          projectId,
          luminaireId,
        );
      const updated = this.store.getBinding(projectId, luminaireId);
      this.store.activity(
        'PROJECT_LUMINAIRE',
        luminaireId,
        'DESCRIPTION_OVERRIDE_UPDATED',
        { overridden: input.descriptionOverride !== null },
        updated,
        actor,
        null,
        projectId,
      );
      return updated;
    });
  }

  public async updateProjectLuminaire(
    projectId: string,
    luminaireId: string,
    input: UpdateProjectLuminaireFromLibraryInput,
    actor: AppUser,
  ): Promise<ProjectLibrarySelectionResult> {
    const replay = this.store.replay<ProjectLibrarySelectionResult>(input.idempotencyKey);
    if (replay) return replay;
    const current = this.store.getBinding(projectId, luminaireId);
    if (
      current.selectedVersionId !== input.expectedSelectedVersionId ||
      current.rowVersion !== input.expectedBindingRowVersion
    ) {
      throw new DomainError('CONFLICT', 'Project Library binding changed before Update.', 409);
    }
    const target = this.store.getVersion(input.targetVersionId);
    if (target.variantId !== current.variantId)
      throw new DomainError(
        'VALIDATION_ERROR',
        'Target Version is outside this Variant lineage.',
        400,
      );
    const targetVariant = this.store.getVariant(target.variantId);
    const targetProduct = this.store.getProduct(targetVariant.productId);
    if (targetVariant.status !== 'ACTIVE' || targetProduct.status !== 'ACTIVE') {
      throw new DomainError(
        'CONFLICT',
        'Archived Products or Variants cannot be updated into a Project.',
        409,
      );
    }
    const copies = await this.copyVersionAssets(target.versionId, projectId, luminaireId);
    const database = this.store.getDatabase();
    try {
      return this.store.transaction(() => {
        const snapshot = target.snapshot;
        const time = this.now().toISOString();
        const paths = this.effectivePaths(copies);
        const result = database
          .prepare(
            `UPDATE project_luminaires SET image_path = ?, description = ?, manufacturer = ?, model = ?,
           product_type = ?, variant_label = ?, ordering_code = ?, wattage = ?, lumens = ?,
           light_color = ?, cri = ?, beam_angle = ?, ip_rating = ?, mounting = ?, cutout = ?,
           driver = ?, control = ?, emergency = ?, datasheet_path = ?, source_name = ?, dimensions = ?,
           body_color_finish = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND project_id = ?`,
          )
          .run(
            paths.ProductImage ?? '',
            effectiveProjectLuminaireDescription(
              snapshot.technicalDescription,
              current.descriptionOverride,
            ),
            snapshot.manufacturerName,
            snapshot.productName,
            snapshot.productType,
            snapshot.variantLabel,
            snapshot.orderingCode,
            snapshot.wattage,
            snapshot.lumens,
            snapshot.lightColor,
            snapshot.cri,
            snapshot.beamAngle,
            snapshot.ipRating,
            snapshot.mounting,
            snapshot.cutout,
            snapshot.driver,
            snapshot.control,
            snapshot.emergency,
            paths.Datasheet ?? '',
            `Master Library v${target.versionSequence}`,
            snapshot.dimensions,
            snapshot.bodyColorFinish,
            time,
            luminaireId,
            projectId,
          );
        if (result.changes !== 1)
          throw new DomainError('NOT_FOUND', 'Project Luminaire not found.', 404);
        this.insertProjectAssetRows(projectId, luminaireId, copies, actor, time);
        const advanced = database
          .prepare(
            `UPDATE project_luminaire_library_bindings SET selected_version_id = ?, row_version = row_version + 1,
           updated_by_id = ?, updated_by_name = ?, updated_at = ?
           WHERE project_id = ? AND luminaire_id = ? AND selected_version_id = ? AND row_version = ?`,
          )
          .run(
            target.versionId,
            actor.id,
            actor.displayName,
            time,
            projectId,
            luminaireId,
            input.expectedSelectedVersionId,
            input.expectedBindingRowVersion,
          );
        if (advanced.changes !== 1)
          throw new DomainError('CONFLICT', 'Project Library binding changed before Update.', 409);
        const response: ProjectLibrarySelectionResult = {
          projectId,
          luminaireId,
          binding: this.store.getBinding(projectId, luminaireId),
        };
        this.store.activity(
          'PROJECT_LUMINAIRE',
          luminaireId,
          'UPDATED_FROM_LIBRARY',
          { before: current.selectedVersionId, after: target.versionId },
          response,
          actor,
          input.idempotencyKey,
          projectId,
        );
        return response;
      });
    } catch (error) {
      await this.cleanup(copies);
      throw error;
    }
  }

  private async copyVersionAssets(versionId: string, projectId: string, luminaireId: string) {
    const result: Array<{
      sourceLibraryAssetVersionId: string;
      type: string;
      write: ManagedAssetWrite;
    }> = [];
    try {
      for (const source of this.store.getVersionAssets(versionId)) {
        const write = await this.storage.copyLibraryAssetToProject({
          locatorValue: source.locatorValue,
          projectId,
          luminaireId,
        });
        if (write.contentHash !== source.contentHash) {
          await write.cleanup();
          throw new DomainError('CONFLICT', 'Library asset copy hash mismatch.', 409);
        }
        result.push({
          sourceLibraryAssetVersionId: source.assetVersionId,
          type: source.assetType,
          write,
        });
      }
      return result;
    } catch (error) {
      await this.cleanup(result);
      throw error;
    }
  }

  private projectAssetRows(projectId: string, luminaireId: string): ProjectAssetRow[] {
    return this.store
      .getDatabase()
      .prepare(
        `SELECT v.id, v.asset_type, v.file_name, v.file_hash, v.locator_kind, v.locator_value
         FROM luminaire_asset_versions v
         JOIN (
           SELECT asset_type, MAX(version_sequence) AS version_sequence
           FROM luminaire_asset_versions
           WHERE project_id = ? AND luminaire_id = ?
           GROUP BY asset_type
         ) latest ON latest.asset_type = v.asset_type
           AND latest.version_sequence = v.version_sequence
         WHERE v.project_id = ? AND v.luminaire_id = ?
         ORDER BY v.asset_type`,
      )
      .all(projectId, luminaireId, projectId, luminaireId) as unknown as ProjectAssetRow[];
  }

  private effectivePaths(
    copies: Array<{ type: string; write: ManagedAssetWrite }>,
  ): Record<string, string> {
    return Object.fromEntries(copies.map((copy) => [copy.type, copy.write.absolutePath]));
  }

  private insertProjectAssetRows(
    projectId: string,
    luminaireId: string,
    copies: Array<{ sourceLibraryAssetVersionId: string; type: string; write: ManagedAssetWrite }>,
    actor: AppUser,
    time: string,
  ): void {
    const database = this.store.getDatabase();
    const sequence = database.prepare(
      'SELECT COALESCE(MAX(version_sequence), 0) AS value FROM luminaire_asset_versions WHERE luminaire_id = ? AND asset_type = ?',
    );
    const insert = database.prepare(
      `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
        attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'DATA_ROOT_RELATIVE', ?, ?)`,
    );
    for (const copy of copies) {
      const current = sequence.get(luminaireId, copy.type) as { value: number };
      insert.run(
        copy.write.assetVersionId,
        projectId,
        luminaireId,
        copy.type,
        Number(current.value) + 1,
        copy.write.absolutePath,
        copy.write.fileName,
        copy.write.mimeType,
        copy.write.sizeBytes,
        copy.write.contentHash,
        time,
        actor.id,
        actor.displayName,
        copy.write.locatorValue,
        copy.sourceLibraryAssetVersionId,
      );
    }
  }

  private async cleanup(copies: Array<{ write: ManagedAssetWrite }>): Promise<void> {
    await Promise.all(
      copies.map(async (copy) => {
        try {
          await copy.write.cleanup();
        } catch {
          /* reconciliation detects remnants */
        }
      }),
    );
  }
}
