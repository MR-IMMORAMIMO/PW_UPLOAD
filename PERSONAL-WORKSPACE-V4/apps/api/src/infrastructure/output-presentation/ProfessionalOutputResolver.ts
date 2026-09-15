import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { P4dOutputPreviewInput } from '@scli/contracts';
import {
  DomainError,
  resolveOutputTemplate,
  resolveTechnicalScheduleLayout,
  type CanonicalLuminaireSnapshot,
  type CanonicalRevisionRecord,
  type LuminaireAssetType,
  type LuminaireAssetVersion,
  type LuminaireRecord,
  type OutputFamily,
  type OutputTemplateOverride,
  type Project,
  type ProjectWorkspace,
  type ResolvedBoqGroup,
  type ResolvedDatasheetRegisterRow,
  type ResolvedOutputAsset,
  type ResolvedOutputEnvelope,
  type ResolvedOutputMessage,
  type ResolvedOutputPage,
  type ResolvedOutputTemplate,
  type ResolvedTechnicalScheduleRow,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore.js';
import { sha256File } from '../output-registry/canonical-artifact-files.js';

const RENDERER_IDENTITY = 'scli.output-presentation';
const RENDERER_VERSION = 'p4d-2';
const LAYOUT_CONTRACT_VERSION = 'p4d-v1';
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
  );
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function currentLuminaireSnapshot(luminaire: LuminaireRecord): CanonicalLuminaireSnapshot {
  return {
    luminaireId: luminaire.id,
    tag: luminaire.tag,
    category: luminaire.category,
    imagePath: luminaire.imagePath,
    description: luminaire.description,
    manufacturer: luminaire.manufacturer,
    model: luminaire.model,
    productType: luminaire.productType ?? '',
    variantLabel: luminaire.variantLabel ?? '',
    orderingCode: luminaire.orderingCode ?? '',
    wattage: luminaire.wattage,
    lumens: luminaire.lumens,
    lightColor: luminaire.lightColor,
    cri: luminaire.cri,
    beamAngle: luminaire.beamAngle,
    ipRating: luminaire.ipRating,
    mounting: luminaire.mounting,
    cutout: luminaire.cutout,
    driver: luminaire.driver,
    control: luminaire.control,
    emergency: luminaire.emergency,
    datasheetPath: luminaire.datasheetPath,
    location: luminaire.location,
    unit: luminaire.unit,
    quantity: luminaire.quantity,
    notes: luminaire.notes,
    sourceName: luminaire.sourceName,
    dimensions: luminaire.dimensions,
    bodyColorFinish: luminaire.bodyColorFinish,
    attachmentReferences: [
      ...new Set([luminaire.imagePath, luminaire.datasheetPath].filter(Boolean)),
    ],
  };
}

function emptyAsset(status: ResolvedOutputAsset['status']): ResolvedOutputAsset {
  return {
    assetVersionId: null,
    versionSequence: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    fileHash: null,
    status,
    dataUrl: null,
  };
}

function safeProjectAssetPath(projectRoot: string | null, filePath: string): string | null {
  if (!projectRoot || !filePath.trim()) return null;
  const root = path.resolve(projectRoot);
  const target = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, ...filePath.replaceAll('\\', '/').split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

async function dataUrlFor(
  pathValue: string,
  mimeType: string,
  sizeBytes: number,
): Promise<string | null> {
  if (!['image/png', 'image/jpeg'].includes(mimeType) || sizeBytes > 5_000_000) {
    return null;
  }
  return `data:${mimeType};base64,${(await readFile(pathValue)).toString('base64')}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages.length ? pages : [[]];
}

function totalsByUnit(rows: readonly CanonicalLuminaireSnapshot[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const unit = row.unit.trim() || 'unit not provided';
    totals[unit] = (totals[unit] ?? 0) + row.quantity;
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) => natural.compare(left, right)),
  );
}

function pageGroups(
  rows: readonly CanonicalLuminaireSnapshot[],
  pageSize: number,
): ResolvedBoqGroup[][] {
  const pages = chunk(rows, pageSize);
  return pages.map((pageRows) => {
    const categories = new Map<string, CanonicalLuminaireSnapshot[]>();
    for (const row of pageRows) {
      const category = row.category.trim() || 'Uncategorized';
      const values = categories.get(category) ?? [];
      values.push(row);
      categories.set(category, values);
    }
    return [...categories.entries()].map(([category, values]) => ({
      category,
      rows: values,
      totalsByUnit: totalsByUnit(values),
    }));
  });
}

function assertSafeCombination(input: P4dOutputPreviewInput): void {
  const { outputKind, format, options } = input;
  if (format === 'XLSX' && outputKind !== 'LuminaireSchedule' && outputKind !== 'TechnicalBoq') {
    throw new DomainError('VALIDATION_ERROR', `${outputKind} supports PDF only in P4D.`, 400);
  }
  if (options.orientation !== 'Landscape') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The selected professional P4D template supports Landscape orientation only.',
      400,
    );
  }
  if (outputKind === 'PresentationSchedule' && options.pageSize !== 'A3') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Presentation Schedule currently supports A3 Landscape only.',
      400,
    );
  }
  if (outputKind === 'PresentationSchedule' && ![2, 3, 4].includes(options.productsPerPage ?? 0)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Presentation Schedule density must be 2, 3, or 4 products per page.',
      400,
    );
  }
}

export class ProfessionalOutputResolver {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
  ) {}

  public async resolve(
    project: Project,
    workspace: ProjectWorkspace,
    input: P4dOutputPreviewInput,
  ): Promise<ResolvedOutputEnvelope> {
    assertSafeCombination(input);
    const revision = this.sourceRevision(project.id, input.targetRevisionId);
    const exactRevision = revision !== null;
    const luminaires = (
      exactRevision
        ? structuredClone(revision.luminaireSnapshot ?? [])
        : workspace.luminaires.map(currentLuminaireSnapshot)
    ).sort(
      (left, right) =>
        natural.compare(left.category || 'Uncategorized', right.category || 'Uncategorized') ||
        natural.compare(left.tag, right.tag) ||
        left.luminaireId.localeCompare(right.luminaireId),
    );
    const settings = this.personalStore.getSettings();
    const messages: ResolvedOutputMessage[] = [];
    if (!luminaires.length) {
      messages.push({
        code: 'EMPTY_OUTPUT',
        level: 'BLOCKING_ERROR',
        message: 'Add at least one luminaire before previewing or generating this output.',
      });
    }
    const resolvedRows = await Promise.all(
      luminaires.map(async (luminaire) => {
        const [image, datasheet] = await Promise.all([
          this.resolveAsset(
            project.id,
            workspace.folderPath,
            luminaire,
            'ProductImage',
            exactRevision,
          ),
          this.resolveAsset(
            project.id,
            workspace.folderPath,
            luminaire,
            'Datasheet',
            exactRevision,
          ),
        ]);
        if (!luminaire.manufacturer.trim() || !luminaire.model.trim()) {
          messages.push({
            code: 'MISSING_PRODUCT_IDENTITY',
            level: 'WARNING',
            message: `${luminaire.tag} is missing manufacturer or model information.`,
            luminaireId: luminaire.luminaireId,
          });
        }
        if (!Number.isFinite(luminaire.quantity) || luminaire.quantity <= 0) {
          messages.push({
            code: 'MISSING_QUANTITY',
            level: 'WARNING',
            message: `${luminaire.tag} has no positive quantity for this output.`,
            luminaireId: luminaire.luminaireId,
          });
        }
        if (image.status !== 'VERIFIED' || !image.dataUrl) {
          messages.push({
            code: 'MISSING_PRODUCT_IMAGE',
            level: 'WARNING',
            message: `${luminaire.tag} will use the neutral image placeholder.`,
            luminaireId: luminaire.luminaireId,
          });
        }
        if (datasheet.status !== 'VERIFIED') {
          messages.push({
            code: 'MISSING_DATASHEET',
            level: 'WARNING',
            message: `${luminaire.tag} has no verified Datasheet asset for this source state.`,
            luminaireId: luminaire.luminaireId,
          });
        }
        if (luminaire.description.length > 120 || luminaire.notes.length > 120) {
          messages.push({
            code: 'LONG_TEXT',
            level: 'WARNING',
            message: `${luminaire.tag} contains long text that will wrap across its output area.`,
            luminaireId: luminaire.luminaireId,
          });
        }
        return { ...luminaire, image, datasheet } satisfies ResolvedTechnicalScheduleRow;
      }),
    );
    const generationOverride: OutputTemplateOverride = {
      paperSize: input.options.pageSize,
      orientation: input.options.orientation,
      ...(input.outputKind === 'PresentationSchedule'
        ? { productsPerPage: input.options.productsPerPage ?? 3 }
        : {}),
    };
    const baseTemplate = this.resolveTemplate(project.id, input, generationOverride);
    const logoDataUrl = await this.brandingLogoDataUrl(settings.companyLogoPath);
    const assetAuthority = resolvedRows.map((row) => ({
      luminaireId: row.luminaireId,
      image: {
        assetVersionId: row.image.assetVersionId,
        fileHash: row.image.fileHash,
        status: row.image.status,
      },
      datasheet: {
        assetVersionId: row.datasheet.assetVersionId,
        fileHash: row.datasheet.fileHash,
        status: row.datasheet.status,
      },
    }));
    const sourceFingerprint = fingerprint({
      outputKind: input.outputKind,
      format: input.format,
      project: {
        projectId: project.id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        clientName: project.clientName,
      },
      luminaires,
      assetAuthority,
      template: baseTemplate,
      branding: {
        companyName: settings.companyName,
        designerName: settings.designerName,
        logoConfigured: Boolean(settings.companyLogoPath),
      },
      issueDate: input.issueDate,
      issueStatus: input.issueStatus,
    });
    const generationMetadata = baseTemplate.sections.some(
      (section) => section.sectionId === 'generationMetadata',
    )
      ? {
          sections: [
            {
              sectionId: 'generationMetadata',
              config: {
                rendererIdentity: RENDERER_IDENTITY,
                rendererVersion: RENDERER_VERSION,
                layoutContractVersion: LAYOUT_CONTRACT_VERSION,
                sourceFingerprint,
                sourceRevisionId: revision?.revisionId ?? null,
                brandingSnapshot: {
                  companyName: settings.companyName,
                  designerName: settings.designerName,
                  timeZone: settings.timeZone || 'Asia/Dubai',
                },
              },
            },
          ],
        }
      : {};
    const template = this.resolveTemplate(project.id, input, {
      ...generationOverride,
      ...generationMetadata,
    });
    const templateSnapshotHash = fingerprint(template);
    const pages = this.pages(input.outputKind, template, resolvedRows);
    messages.push({
      code: 'OUTPUT_SUMMARY',
      level: 'INFO',
      message: `${pages.length} page(s), ${resolvedRows.length} luminaire(s), ${template.displayName} ${template.versionId}.`,
    });
    return {
      outputKind: input.outputKind,
      format: input.format,
      project: {
        projectId: project.id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        clientName: project.clientName,
      },
      revision: revision
        ? {
            revisionId: revision.revisionId,
            revisionLabel: revision.revisionLabel,
            revisionSequence: revision.revisionSequence,
            lifecycleState: revision.lifecycleState,
            draftPreview: false,
          }
        : {
            revisionId: null,
            revisionLabel: 'DRAFT PREVIEW',
            revisionSequence: null,
            lifecycleState: null,
            draftPreview: true,
          },
      template,
      branding: {
        companyName: settings.companyName,
        designerName: settings.designerName,
        logoDataUrl,
        timeZone: settings.timeZone || 'Asia/Dubai',
      },
      issueDate: input.issueDate,
      issueStatus: input.issueStatus,
      sourceFingerprint,
      templateSnapshotHash,
      rendererIdentity: RENDERER_IDENTITY,
      rendererVersion: RENDERER_VERSION,
      layoutContractVersion: LAYOUT_CONTRACT_VERSION,
      pageSize: template.paperSize === 'Auto' ? input.options.pageSize : template.paperSize,
      orientation: template.orientation,
      productsPerPage:
        input.outputKind === 'PresentationSchedule'
          ? (template.productsPerPage as 2 | 3 | 4)
          : null,
      messages,
      pages,
      rowCount: resolvedRows.length,
      unitTotals: totalsByUnit(luminaires),
    };
  }

  private resolveTemplate(
    projectId: string,
    input: P4dOutputPreviewInput,
    generationOverride: OutputTemplateOverride,
  ): ResolvedOutputTemplate {
    if (!input.templateId || !input.templateVersionId) {
      return this.registry.resolveEffectiveTemplate(
        projectId,
        input.outputKind,
        generationOverride,
      );
    }
    const templateRecord = this.registry.getTemplate(input.templateId);
    const version = this.registry.getTemplateVersion(input.templateId, input.templateVersionId);
    const global = this.registry.getGlobalDefault(input.outputKind);
    const project = this.registry.getProjectOverride(projectId, input.outputKind);
    const globalMatches =
      global?.templateId === input.templateId && global.versionId === input.templateVersionId;
    const projectMatches =
      project?.templateId === input.templateId && project.versionId === input.templateVersionId;
    return resolveOutputTemplate({
      templateId: input.templateId,
      versionId: input.templateVersionId,
      requestedFamily: input.outputKind,
      globalConfig: globalMatches ? global.config : undefined,
      projectOverride: projectMatches ? project.config : undefined,
      generationOverride,
      registry: [{ ...version.definition, state: templateRecord.state }],
    });
  }

  private sourceRevision(projectId: string, revisionId?: string): CanonicalRevisionRecord | null {
    if (!revisionId) return null;
    const revision = this.registry.getRevision(revisionId);
    if (revision.projectId !== projectId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Preview Revision does not belong to this Project.',
        400,
      );
    }
    return revision;
  }

  private async resolveAsset(
    projectId: string,
    projectRoot: string | null,
    luminaire: CanonicalLuminaireSnapshot,
    assetType: LuminaireAssetType,
    exactRevision: boolean,
  ): Promise<ResolvedOutputAsset> {
    const expectedPath =
      assetType === 'ProductImage' ? luminaire.imagePath : luminaire.datasheetPath;
    const versions = this.personalStore.listLuminaireAssetVersions(
      projectId,
      luminaire.luminaireId,
      assetType,
    );
    const version = exactRevision
      ? versions.find((candidate) => candidate.filePath === expectedPath)
      : versions[0];
    if (!version) return emptyAsset(expectedPath ? 'UNAVAILABLE' : 'MISSING');
    return this.inspectAsset(projectRoot, version, assetType === 'ProductImage');
  }

  private async inspectAsset(
    projectRoot: string | null,
    version: LuminaireAssetVersion,
    includeDataUrl: boolean,
  ): Promise<ResolvedOutputAsset> {
    const base = {
      assetVersionId: version.id,
      versionSequence: version.versionSequence,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      fileHash: version.fileHash,
      dataUrl: null,
    };
    const safePath = safeProjectAssetPath(projectRoot, version.filePath);
    if (!safePath) return { ...base, status: 'UNAVAILABLE' };
    try {
      const file = await stat(safePath);
      if (!file.isFile()) return { ...base, status: 'UNAVAILABLE' };
      const actualHash = await sha256File(safePath);
      if (version.fileHash && actualHash !== version.fileHash)
        return { ...base, status: 'MISMATCH' };
      return {
        ...base,
        status: 'VERIFIED',
        sizeBytes: file.size,
        fileHash: actualHash,
        dataUrl: includeDataUrl ? await dataUrlFor(safePath, version.mimeType, file.size) : null,
      };
    } catch {
      return { ...base, status: 'UNAVAILABLE' };
    }
  }

  private async brandingLogoDataUrl(filePath: string): Promise<string | null> {
    if (!filePath.trim()) return null;
    try {
      const file = await stat(filePath);
      if (!file.isFile() || file.size > 5_000_000) return null;
      const extension = path.extname(filePath).toLowerCase();
      const mimeType =
        extension === '.png'
          ? 'image/png'
          : extension === '.jpg' || extension === '.jpeg'
            ? 'image/jpeg'
            : null;
      if (!mimeType) return null;
      return await dataUrlFor(filePath, mimeType, file.size);
    } catch {
      return null;
    }
  }

  private pages(
    outputKind: OutputFamily,
    template: ResolvedOutputTemplate,
    rows: readonly ResolvedTechnicalScheduleRow[],
  ): ResolvedOutputPage[] {
    if (outputKind === 'LuminaireSchedule') {
      const rowsPerPage =
        template.rowDensity === 'Compact'
          ? template.paperSize === 'A3'
            ? 8
            : 6
          : template.rowDensity === 'Comfortable'
            ? template.paperSize === 'A3'
              ? 4
              : 3
            : template.paperSize === 'A3'
              ? 4
              : 3;
      const layout = resolveTechnicalScheduleLayout(template);
      return chunk(rows, rowsPerPage).map((pageRows, index) => ({
        kind: 'LuminaireSchedule',
        pageNumber: index + 1,
        layout,
        rows: pageRows,
      }));
    }
    if (outputKind === 'PresentationSchedule') {
      return chunk(rows, template.productsPerPage ?? 3).map((products, index) => ({
        kind: 'PresentationSchedule',
        pageNumber: index + 1,
        products,
      }));
    }
    if (outputKind === 'TechnicalBoq') {
      return pageGroups(rows, template.paperSize === 'A3' ? 15 : 10).map((groups, index) => ({
        kind: 'TechnicalBoq',
        pageNumber: index + 1,
        groups,
      }));
    }
    const registerRows: ResolvedDatasheetRegisterRow[] = rows.map((row) => ({
      luminaireId: row.luminaireId,
      tag: row.tag,
      manufacturer: row.manufacturer,
      model: row.model,
      notes: row.notes,
      datasheet: row.datasheet,
    }));
    return chunk(registerRows, template.paperSize === 'A3' ? 18 : 12).map((pageRows, index) => ({
      kind: 'DatasheetRegister',
      pageNumber: index + 1,
      rows: pageRows,
    }));
  }
}
