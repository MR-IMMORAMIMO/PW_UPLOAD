import { createHash, randomUUID } from 'node:crypto';
import { constants, createWriteStream, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as archiverModule from 'archiver';
import { z } from 'zod';
import type { CreateRevisionPackageInput } from '@scli/contracts';
import {
  DomainError,
  documentSnapshotSourceId,
  revisionPackageGroups,
  type AppUser,
  type CanonicalIssuePackageRecord,
  type CanonicalOutputRecord,
  type CanonicalRevisionRecord,
  type Project,
  type ProjectQualityCheck,
  type ProjectWorkspace,
  type RevisionDeliverable,
  type RevisionDocumentSnapshotRecord,
  type RevisionLuminaireSnapshot,
  type RevisionPackageCatalog,
  type RevisionPackageGroup,
  type RevisionPackageItem,
  type RevisionPackageManifestItem,
  type RevisionPackageRecord,
} from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import {
  CanonicalOutputRegistryStore,
  canonicalRegistryJson,
  normalizeCanonicalProjectRelativePath,
} from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  assertReadableFile,
  boundedArtifactFailure,
  ensureArtifactParent,
  moveArtifactNoReplace,
  packageArtifactTemporaryPath,
  packageStagingPath,
  resolveCanonicalArtifactPath,
  resolveCanonicalArtifactPresence,
  sha256File,
} from './canonical-artifact-files.js';

interface ZipArchiveInstance {
  on(event: 'warning' | 'error', listener: (error: Error) => void): this;
  pipe(destination: NodeJS.WritableStream): NodeJS.WritableStream;
  directory(source: string, destination: string | false): this;
  finalize(): Promise<void>;
}

const { ZipArchive } = archiverModule as unknown as {
  ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveInstance;
};

const packageGroupSchema = z.enum(revisionPackageGroups);
const packageOutputModeSchema = z.enum(['Folder', 'Zip', 'Both']);
const packageStatusSchema = z.enum(['Draft', 'Issued']);

export const canonicalPackageManifestSchema = z.object({
  version: z.literal(2),
  packageId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionSequence: z.number().int().positive(),
  revisionLabel: z.string().min(1),
  packageSequence: z.number().int().positive(),
  label: z.string().min(1),
  status: packageStatusSchema,
  outputMode: packageOutputModeSchema,
  warningOverrideReason: z.string(),
  /**
   * Issue audit authority (V4-ISSUE-A0). Null for Draft packages; a Draft manifest
   * must never claim a real Issue event. Backward-compatible: pre-A0 manifests
   * always carried a string here and remain readable.
   */
  issuedAt: z.string().datetime().nullable(),
  /**
   * Immutable actor snapshot of the Issue action (V4-ISSUE-A0). Null for Draft
   * packages and for pre-A0 manifests that predate this authority. Optional so
   * existing manifests remain readable.
   */
  issuedBy: z
    .object({
      actorId: z.string().min(1).max(300),
      actorNameSnapshot: z.string().min(1).max(300),
    })
    .nullable()
    .default(null),
  /**
   * Compatibility projection for pre-B2 consumers. Derived from the selected
   * GeneratedOutput members only; the canonical B2 authority is `deliverables`.
   */
  outputs: z.array(
    z.object({
      outputId: z.string().uuid(),
      outputFamily: z.enum([
        'LuminaireSchedule',
        'TechnicalBoq',
        'PresentationSchedule',
        'DatasheetRegister',
      ]),
      outputFormat: z.string().min(1),
      group: packageGroupSchema,
      label: z.string().min(1),
      storedRelativeLocator: z.string().min(1),
      packageRelativePath: z.string().min(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
  /**
   * B2 — canonical generic immutable deliverable membership. Every package
   * member is a discriminated immutable source: a canonical Generated Output or
   * an immutable Document Snapshot. All members belong to the package's single
   * canonical Revision; mutable ProjectDocuments are never members.
   */
  deliverables: z.array(
    z.discriminatedUnion('sourceType', [
      z.object({
        sourceType: z.literal('GeneratedOutput'),
        outputId: z.string().uuid(),
        outputFamily: z.enum([
          'LuminaireSchedule',
          'TechnicalBoq',
          'PresentationSchedule',
          'DatasheetRegister',
        ]),
        outputFormat: z.string().min(1),
        group: packageGroupSchema,
        label: z.string().min(1),
        storedRelativeLocator: z.string().min(1),
        packageRelativePath: z.string().min(1),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().nonnegative(),
      }),
      z.object({
        sourceType: z.literal('DocumentSnapshot'),
        deliverableId: z.string().uuid(),
        title: z.string().min(1),
        category: z.string().min(1),
        group: packageGroupSchema,
        fileName: z.string().min(1),
        storedRelativeLocator: z.string().min(1),
        packageRelativePath: z.string().min(1),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().nonnegative(),
      }),
    ]),
  ),
  luminaires: z.array(
    z.object({
      luminaireId: z.string().uuid(),
      tag: z.string().min(1),
      values: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  ),
});

export type CanonicalPackageManifest = z.infer<typeof canonicalPackageManifestSchema>;

/**
 * v1 manifest shape (pre-B2 Output-only). Retained ONLY for recovery of
 * historical FAILED_RECOVERABLE packages whose on-disk manifest predates B2.
 */
export const legacyCanonicalPackageManifestSchema = z.object({
  version: z.literal(1),
  packageId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revisionSequence: z.number().int().positive(),
  revisionLabel: z.string().min(1),
  packageSequence: z.number().int().positive(),
  label: z.string().min(1),
  status: packageStatusSchema,
  outputMode: packageOutputModeSchema,
  warningOverrideReason: z.string(),
  issuedAt: z.string().datetime().nullable(),
  issuedBy: z
    .object({
      actorId: z.string().min(1).max(300),
      actorNameSnapshot: z.string().min(1).max(300),
    })
    .nullable()
    .default(null),
  outputs: z.array(
    z.object({
      outputId: z.string().uuid(),
      outputFamily: z.enum(['LuminaireSchedule', 'TechnicalBoq', 'PresentationSchedule']),
      outputFormat: z.string().min(1),
      group: packageGroupSchema,
      label: z.string().min(1),
      storedRelativeLocator: z.string().min(1),
      packageRelativePath: z.string().min(1),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
  luminaires: z.array(
    z.object({
      luminaireId: z.string().uuid(),
      tag: z.string().min(1),
      values: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  ),
});

export type LegacyCanonicalPackageManifest = z.infer<typeof legacyCanonicalPackageManifestSchema>;

/**
 * OWNER-LOCKED client package taxonomy (PACKAGES-E2E-04A).
 *
 * GeneratedOutput groups map to the numbered client folders. DocumentSnapshots
 * are classified by their STRUCTURED category (never filename/title/path).
 */
const groupDirectories: Partial<Record<RevisionPackageGroup, string>> = {
  SchedulePdf: '03_LUMINAIRE_SCHEDULE',
  ScheduleExcel: '03_LUMINAIRE_SCHEDULE',
  TechnicalBoqPdf: '04_TECHNICAL_BOQ',
  TechnicalBoqExcel: '04_TECHNICAL_BOQ',
  Documents: '07_SUPPORTING_DOCUMENTS',
};

/**
 * DocumentSnapshot category -> client folder (PACKAGES-E2E-04A). Structured
 * `snapshot.category` is the sole authority; unsupported/unknown categories
 * fall back to the safe supporting-documents folder.
 */
const snapshotDirectories: Record<string, string> = {
  Drawing: '01_LIGHTING_LAYOUT',
  LuxReport: '02_DIALUX_REPORT',
  Datasheet: '05_DATASHEETS',
};

function snapshotDirectory(category: string | null | undefined): string {
  return (category && snapshotDirectories[category]) || '07_SUPPORTING_DOCUMENTS';
}

/**
 * PACKAGES-E2E-04B — internal (app-owned) package metadata manifest locator.
 *
 * New package manifests live OUTSIDE the client-facing package tree, in a
 * project-contained, package-identity-scoped path. The persisted
 * `manifestLocatorValue` remains the single reader authority, so historical
 * packages whose locator points into the old client folder still resolve.
 */
function internalPackageManifestLocator(packageId: string): string {
  return normalizeCanonicalProjectRelativePath(
    `INTERNAL/PACKAGE_METADATA/${packageId}/SCLI_PACKAGE_MANIFEST.json`,
  );
}

/**
 * PACKAGES-E2E-05B — deterministic fallbacks for a missing Luminaire
 * manufacturer / model in a Datasheet client-copy name. Truthful repository
 * placeholders, never filename/title guessing.
 */
const UNKNOWN_MANUFACTURER = 'UNKNOWN_MANUFACTURER';
const UNKNOWN_MODEL = 'UNKNOWN_MODEL';

/**
 * PACKAGES-E2E-05B — deterministic CLIENT COPY base name for a Datasheet
 * DocumentSnapshot package copy: `<Tag>_<Manufacturer>_<Model>`. Every field
 * is derived structurally from the canonical Luminaire (tag / manufacturer /
 * model); a missing manufacturer or model uses the truthful fallback. A
 * missing tag uses a deterministic repository-native fallback based on the
 * Luminaire identity (`LUMINAIRE_<short-id>`). The original stored/source
 * artifact is NEVER renamed — only the package copy.
 */
function datasheetClientCopyBaseName(opts: {
  tag: string;
  manufacturer: string;
  model: string;
  luminaireId?: string;
}): string {
  const tag = safeFileName(
    opts.tag.trim() ||
      (opts.luminaireId ? `LUMINAIRE_${opts.luminaireId.slice(0, 8)}` : 'LUMINAIRE'),
  );
  const manufacturer = safeFileName(opts.manufacturer.trim() || UNKNOWN_MANUFACTURER);
  const model = safeFileName(opts.model.trim() || UNKNOWN_MODEL);
  return safeFileName(`${tag}_${manufacturer}_${model}`);
}

/**
 * Deterministic CLIENT COPY base name for a DocumentSnapshot package copy.
 *
 * Lighting Layout and DIALux / Lux Report snapshots receive a normalized
 * professional client-facing name from canonical project + revision authority.
 * Datasheet snapshots receive the structured `<Tag>_<Manufacturer>_<Model>`
 * name from the canonical Luminaire. Other categories keep their source
 * basename. The original stored/source artifact is NEVER renamed — only the
 * package copy.
 */
function clientCopyBaseName(opts: {
  projectCode: string;
  revisionLabel: string;
  category: string | null | undefined;
  originalBase: string;
  datasheet?: { tag: string; manufacturer: string; model: string; luminaireId: string };
}): string {
  if (opts.category === 'Drawing') {
    return safeFileName(`${opts.projectCode}_LIGHTING_LAYOUT_${opts.revisionLabel}`);
  }
  if (opts.category === 'LuxReport') {
    return safeFileName(`${opts.projectCode}_DIALUX_REPORT_${opts.revisionLabel}`);
  }
  if (opts.category === 'Datasheet' && opts.datasheet) {
    return datasheetClientCopyBaseName(opts.datasheet);
  }
  return opts.originalBase;
}

function outputPresentation(output: {
  outputFamily: CanonicalOutputRecord['outputFamily'];
  outputFormat: string;
}): {
  group: RevisionPackageGroup;
  label: string;
} {
  if (output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'PDF') {
    return { group: 'SchedulePdf', label: 'Luminaire Schedule PDF' };
  }
  if (output.outputFamily === 'LuminaireSchedule' && output.outputFormat === 'XLSX') {
    return { group: 'ScheduleExcel', label: 'Luminaire Schedule Excel' };
  }
  if (output.outputFamily === 'TechnicalBoq' && output.outputFormat === 'PDF') {
    return { group: 'TechnicalBoqPdf', label: 'Technical BOQ PDF' };
  }
  if (output.outputFamily === 'TechnicalBoq' && output.outputFormat === 'XLSX') {
    return { group: 'TechnicalBoqExcel', label: 'Technical BOQ Excel' };
  }
  if (output.outputFamily === 'PresentationSchedule' && output.outputFormat === 'PDF') {
    return { group: 'SchedulePdf', label: 'Presentation Schedule PDF' };
  }
  if (output.outputFamily === 'DatasheetRegister' && output.outputFormat === 'PDF') {
    return { group: 'Datasheets', label: 'Datasheet Register PDF' };
  }
  throw new DomainError(
    'VALIDATION_ERROR',
    'This canonical Output type is not supported by the current Issue Package renderer.',
    400,
  );
}

function safeFileName(value: string): string {
  const printable = [...value].filter((character) => character.charCodeAt(0) >= 32).join('');
  const sanitized = printable.replaceAll(/[<>:"/\\|?*]/g, '_').trim();
  return sanitized || 'SCT_File';
}

function outputFamilyLabel(family: CanonicalOutputRecord['outputFamily']): string {
  if (family === 'LuminaireSchedule') return 'Luminaire Schedule';
  if (family === 'TechnicalBoq') return 'Technical BOQ';
  if (family === 'PresentationSchedule') return 'Presentation Schedule';
  if (family === 'DatasheetRegister') return 'Datasheet Register';
  return 'Canonical Output';
}

function outputFamilyTitle(output: CanonicalOutputRecord): string {
  return output.outputFormat === 'PDF'
    ? `${outputFamilyLabel(output.outputFamily)} PDF`
    : `${outputFamilyLabel(output.outputFamily)} ${output.outputFormat}`;
}

function outputFamilyCategory(output: CanonicalOutputRecord): string {
  return outputFamilyLabel(output.outputFamily);
}

async function createZip(sourceFolder: string, zipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath, { flags: 'wx' });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reject(error);
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceFolder, false);
    void archive.finalize();
  });
}

function luminaireManifestSnapshot(
  outputRevision: ReturnType<CanonicalOutputRegistryStore['getRevision']>,
): RevisionLuminaireSnapshot[] {
  return (outputRevision.luminaireSnapshot ?? []).map((luminaire) => ({
    luminaireId: luminaire.luminaireId,
    tag: luminaire.tag,
    values: {
      tag: luminaire.tag,
      category: luminaire.category,
      imagePath: luminaire.imagePath,
      description: luminaire.description,
      manufacturer: luminaire.manufacturer,
      model: luminaire.model,
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
    },
  }));
}

export class CanonicalIssuePackageService {
  public constructor(
    private readonly personalStore: PersonalWorkspaceStore,
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly now: () => Date = () => new Date(),
    private readonly packageId: () => string = randomUUID,
  ) {}

  /**
   * PACKAGES-E2E-05B — resolve the canonical Luminaire for a Datasheet
   * DocumentSnapshot. Identity is DERIVED structurally:
   * sourceAssetVersionId -> luminaire_asset_versions -> luminaireId ->
   * project_luminaires. Returns null when the snapshot is not a Datasheet or
   * its structured provenance is unexpectedly missing (fail closed — never
   * guess from title/fileName/path).
   */
  private datasheetLuminaire(
    projectId: string,
    snapshot: RevisionDocumentSnapshotRecord,
  ): { tag: string; manufacturer: string; model: string; luminaireId: string } | null {
    if (snapshot.category !== 'Datasheet' || snapshot.sourceType !== 'LuminaireAssetVersion') {
      return null;
    }
    try {
      const version = this.personalStore.getLuminaireAssetVersionById(
        projectId,
        snapshot.sourceAssetVersionId,
      );
      const luminaire = this.personalStore.getLuminaireRecord(version.luminaireId, projectId);
      return {
        tag: luminaire.tag,
        manufacturer: luminaire.manufacturer,
        model: luminaire.model,
        luminaireId: luminaire.id,
      };
    } catch {
      return null;
    }
  }

  public async catalog(
    project: Project,
    workspace: ProjectWorkspace,
    checks: ProjectQualityCheck[],
    requestedRevisionId?: string,
  ): Promise<RevisionPackageCatalog> {
    const candidates = this.registry
      .listRevisions(project.id)
      .filter((revision) => revision.lifecycleState === 'FINALIZED');
    let revision: CanonicalRevisionRecord | null = null;
    if (requestedRevisionId) {
      revision =
        candidates.find((candidate) => candidate.revisionId === requestedRevisionId) ?? null;
      if (!revision)
        throw new DomainError('NOT_FOUND', 'Finalized Revision not found in this Project.', 404);
    } else {
      for (const candidate of candidates) {
        if ((await this.eligibleDeliverablesForRevision(project.id, candidate.revisionId)).length) {
          revision = candidate;
          break;
        }
      }
    }
    const latestLuminaireUpdate = workspace.luminaires.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      '',
    );
    const outdated = Boolean(revision && latestLuminaireUpdate > revision.createdAt);
    const items: RevisionPackageItem[] = [];
    if (revision) {
      // B2 — the catalog sources eligible contents from the unified immutable
      // Revision Deliverables read (GeneratedOutput + DocumentSnapshot), always
      // scoped to catalog.revisionId. It never selects a Revision by sequence
      // and never reads the mutable ProjectDocument register.
      for (const deliverable of await this.eligibleDeliverablesForRevision(
        project.id,
        revision.revisionId,
      )) {
        const group =
          deliverable.sourceType === 'GeneratedOutput'
            ? this.outputGroup(deliverable)
            : 'Documents';
        if (!group) continue;
        // PACKAGES-E2E-05B — a Datasheet DocumentSnapshot carries structured
        // Luminaire metadata (tag / manufacturer / model) derived structurally
        // from sourceAssetVersionId. Never inferred from title/fileName/path.
        let datasheet: { tag: string; manufacturer: string; model: string } | null = null;
        if (deliverable.sourceType === 'DocumentSnapshot' && deliverable.category === 'Datasheet') {
          try {
            const snapshot = this.registry.getDocumentSnapshot(deliverable.deliverableId);
            const resolved = this.datasheetLuminaire(project.id, snapshot);
            if (resolved) {
              datasheet = {
                tag: resolved.tag,
                manufacturer: resolved.manufacturer,
                model: resolved.model,
              };
            }
          } catch {
            datasheet = null;
          }
        }
        items.push({
          id: deliverable.deliverableId,
          group,
          label: deliverable.title ?? deliverable.fileName ?? group,
          fileName: deliverable.fileName ?? '',
          filePath: '',
          available: deliverable.presence === 'Present',
          outdated,
          sizeBytes: deliverable.sizeBytes ?? 0,
          modifiedAt: null,
          note:
            deliverable.presence === 'Present'
              ? outdated
                ? 'This canonical deliverable predates current Luminaire edits.'
                : ''
              : 'The finalized canonical artifact is missing or unavailable.',
          ...(datasheet ? { datasheet } : {}),
        });
      }
    }
    for (const group of revisionPackageGroups) {
      if (items.some((item) => item.group === group)) continue;
      items.push({
        id: `missing:${group}`,
        group,
        label: group,
        fileName: '',
        filePath: '',
        available: false,
        outdated: false,
        sizeBytes: 0,
        modifiedAt: null,
        note: 'No canonical Deliverable from the selected Revision is available for this group.',
      });
    }
    const suggestedRevision = revision?.revisionSequence ?? 1;
    const existingPackages = revision
      ? this.registry
          .listIssuePackages(project.id)
          .filter((item) => item.revisionId === revision.revisionId).length
      : 0;
    // PACKAGES-E2E-05B — Revision-scoped missing-Datasheet readiness. A
    // Warning (never Blocking) when one or more project Luminaires lack an
    // eligible verified Datasheet snapshot in the target Revision. Truthful
    // count only — never a per-luminaire inline list.
    const missingDatasheetCheck = revision
      ? this.missingDatasheetReadinessCheck(project.id, revision.revisionId, workspace)
      : null;
    const catalogChecks = checks.map((check) =>
      check.key === 'outputs'
        ? {
            ...check,
            passed: Boolean(
              revision && items.some((item) => item.available && item.group !== 'Documents'),
            ),
            detail:
              revision && items.some((item) => item.available && item.group !== 'Documents')
                ? 'Finalized canonical outputs are available in the selected Revision.'
                : 'No finalized canonical output is available in the selected Revision.',
          }
        : check,
    );
    return {
      items,
      checks: missingDatasheetCheck ? [...catalogChecks, missingDatasheetCheck] : catalogChecks,
      revisionId: revision?.revisionId ?? null,
      suggestedRevision,
      suggestedOutputFolder:
        existingPackages === 0
          ? `ISSUED/REV_${String(suggestedRevision).padStart(2, '0')}`
          : `ISSUED/REV_${String(suggestedRevision).padStart(2, '0')}_PACKAGE_${existingPackages + 1}`,
    };
  }

  /**
   * PACKAGES-E2E-05B — Revision-scoped missing-Datasheet readiness Warning.
   *
   * A project Luminaire is considered "covered" only when the target Revision
   * contains a Datasheet DocumentSnapshot whose sourceAssetVersionId resolves
   * to that Luminaire AND the snapshot artifact is Present (eligible). Any
   * Luminaire without such a snapshot is counted as missing a verified
   * Datasheet in this Revision. The check is a Warning, never Blocking, and
   * reports a truthful count — not a per-luminaire inline list.
   */
  private missingDatasheetReadinessCheck(
    projectId: string,
    revisionId: string,
    workspace: ProjectWorkspace,
  ): ProjectQualityCheck {
    const coveredLuminaireIds = new Set<string>();
    for (const snapshot of this.registry.listDocumentSnapshotsForRevision(revisionId)) {
      if (snapshot.projectId !== projectId) continue;
      if (snapshot.category !== 'Datasheet' || snapshot.sourceType !== 'LuminaireAssetVersion') {
        continue;
      }
      try {
        const version = this.personalStore.getLuminaireAssetVersionById(
          projectId,
          snapshot.sourceAssetVersionId,
        );
        coveredLuminaireIds.add(version.luminaireId);
      } catch {
        // Unresolvable provenance — the Luminaire is not covered.
      }
    }
    const missing = workspace.luminaires.filter(
      (luminaire) => !coveredLuminaireIds.has(luminaire.id),
    ).length;
    return {
      key: 'missing-verified-datasheets',
      label: 'Verified Datasheets in this Revision',
      detail: missing
        ? `${missing} luminaire(s) are missing verified Datasheets in this Revision.`
        : 'Every project Luminaire has a verified Datasheet in this Revision.',
      severity: 'Warning',
      passed: missing === 0,
    };
  }

  /**
   * B2 — eligible immutable deliverables of ONE canonical Revision.
   *
   * GeneratedOutput eligibility preserves the canonical package rules
   * (FINALIZED + proven hash + PROJECT_RELATIVE locator). DocumentSnapshot
   * eligibility requires the immutable snapshot authority plus Present artifact
   * presence. Missing/unproven artifacts are never eligible issue contents.
   */
  private async eligibleDeliverablesForRevision(
    projectId: string,
    revisionId: string,
  ): Promise<RevisionDeliverable[]> {
    const projectRoot = this.personalStore.getProjectFolderPath(projectId) ?? null;
    const deliverables: RevisionDeliverable[] = [];
    for (const output of this.registry.listOutputsForRevision(revisionId)) {
      if (output.projectId !== projectId) continue;
      if (output.lifecycleState !== 'FINALIZED' || !output.contentHash) continue;
      if (output.locatorKind !== 'PROJECT_RELATIVE' || !output.locatorValue) continue;
      let presence: 'Present' | 'Missing' | 'Unavailable';
      let sizeBytes: number | null = null;
      try {
        const artifact = await resolveCanonicalArtifactPresence(projectRoot, {
          locatorKind: output.locatorKind,
          locatorValue: output.locatorValue,
        });
        presence = artifact.presence;
        // The catalog reports the actual local artifact size, never a fabricated
        // zero for a generated Output. Paths remain backend-owned and root-checked.
        if (artifact.presence === 'Present' && artifact.openPath)
          sizeBytes = statSync(artifact.openPath).size;
      } catch {
        presence = 'Unavailable';
      }
      if (presence !== 'Present') continue;
      deliverables.push({
        sourceType: 'GeneratedOutput',
        deliverableId: output.outputId,
        sourceId: output.outputId,
        projectId: output.projectId,
        revisionId: output.revisionId ?? revisionId,
        title: outputFamilyTitle(output),
        category: outputFamilyCategory(output),
        fileName: output.locatorValue ? path.basename(output.locatorValue) : null,
        format: output.outputFormat,
        outputFamily: output.outputFamily,
        contentHash: output.contentHash,
        sizeBytes,
        lifecycleState: output.lifecycleState,
        presence: 'Present',
      });
    }
    for (const snapshot of this.registry.listDocumentSnapshotsForRevision(revisionId)) {
      if (snapshot.projectId !== projectId) continue;
      let presence: 'Present' | 'Missing' | 'Unavailable';
      try {
        presence = (
          await resolveCanonicalArtifactPresence(projectRoot, {
            locatorKind: snapshot.locatorKind,
            locatorValue: snapshot.locatorValue,
          })
        ).presence;
      } catch {
        presence = 'Unavailable';
      }
      if (presence !== 'Present') continue;
      deliverables.push({
        sourceType: 'DocumentSnapshot',
        deliverableId: snapshot.deliverableId,
        sourceId: documentSnapshotSourceId(snapshot),
        projectId: snapshot.projectId,
        revisionId: snapshot.revisionId,
        title: snapshot.title,
        category: snapshot.category,
        fileName: snapshot.fileName,
        format: null,
        outputFamily: null,
        contentHash: snapshot.contentHash,
        sizeBytes: snapshot.sizeBytes,
        lifecycleState: null,
        presence: 'Present',
      });
    }
    deliverables.sort(
      (left, right) =>
        left.sourceType.localeCompare(right.sourceType) ||
        left.deliverableId.localeCompare(right.deliverableId),
    );
    return deliverables;
  }

  private outputGroup(deliverable: RevisionDeliverable): RevisionPackageGroup | null {
    if (!deliverable.outputFamily || !deliverable.format) return null;
    try {
      return outputPresentation({
        outputFamily: deliverable.outputFamily,
        outputFormat: deliverable.format,
      }).group;
    } catch {
      return null;
    }
  }

  /**
   * B2 — resolves selected immutable Deliverable identities against the unified
   * Revision Deliverable authority for ONE canonical Revision.
   *
   * Every selected ID is resolved as a deliverable of the selected Revision:
   * GeneratedOutput IDs are canonical outputIds; DocumentSnapshot IDs are
   * immutable snapshot deliverableIds. A mutable ProjectDocument UUID is never a
   * deliverableId and therefore rejects. Each resolved member carries its
   * immutable snapshot record (null for GeneratedOutput) so materialization and
   * recovery never touch the mutable ProjectDocument register.
   */
  private resolveSelectedDeliverables(
    projectId: string,
    selectedIds: readonly string[],
  ): Array<{
    deliverable: RevisionDeliverable;
    snapshot: RevisionDocumentSnapshotRecord | null;
  }> {
    return selectedIds.map((selectedId) => {
      let deliverable: RevisionDeliverable | null = null;
      let snapshot: RevisionDocumentSnapshotRecord | null = null;
      try {
        const output = this.registry.getOutput(selectedId);
        if (output.projectId === projectId) {
          deliverable = {
            sourceType: 'GeneratedOutput',
            deliverableId: output.outputId,
            sourceId: output.outputId,
            projectId: output.projectId,
            revisionId: output.revisionId ?? '',
            title: outputFamilyTitle(output),
            category: outputFamilyCategory(output),
            fileName: output.locatorValue ? path.basename(output.locatorValue) : null,
            format: output.outputFormat,
            outputFamily: output.outputFamily,
            contentHash: output.contentHash,
            sizeBytes: null,
            lifecycleState: output.lifecycleState,
            presence: 'Present',
          };
        }
      } catch {
        deliverable = null;
      }
      if (!deliverable) {
        try {
          const record = this.registry.getDocumentSnapshot(selectedId);
          if (record.projectId === projectId) {
            snapshot = record;
            deliverable = {
              sourceType: 'DocumentSnapshot',
              deliverableId: record.deliverableId,
              sourceId: documentSnapshotSourceId(record),
              projectId: record.projectId,
              revisionId: record.revisionId,
              title: record.title,
              category: record.category,
              fileName: record.fileName,
              format: null,
              outputFamily: null,
              contentHash: record.contentHash,
              sizeBytes: record.sizeBytes,
              lifecycleState: null,
              presence: 'Present',
            };
          }
        } catch {
          deliverable = null;
        }
      }
      if (!deliverable) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'One or more selected Deliverables no longer exist in the immutable Revision authority.',
          400,
        );
      }
      return { deliverable, snapshot };
    });
  }

  public async create(
    project: Project,
    workspace: ProjectWorkspace,
    actor: AppUser,
    input: CreateRevisionPackageInput,
    checks: ProjectQualityCheck[],
  ): Promise<RevisionPackageRecord> {
    if (!workspace.folderPath) {
      throw new DomainError('VALIDATION_ERROR', 'Create or connect the project folder first.', 400);
    }
    const uniqueIds = new Set(input.selectedItemIds);
    if (uniqueIds.size !== input.selectedItemIds.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Issue Package Deliverable UUIDs must be unique.',
        400,
      );
    }
    // B2 — resolve every selected ID against the unified immutable Revision
    // Deliverable read (GeneratedOutput deliverableId = outputId;
    // DocumentSnapshot deliverableId = snapshot deliverableId). A mutable
    // ProjectDocument UUID is never a deliverableId, so it cannot resolve here.
    const resolvedMembers = this.resolveSelectedDeliverables(project.id, input.selectedItemIds);
    const revisionId = resolvedMembers[0]?.deliverable.revisionId;
    if (
      !revisionId ||
      resolvedMembers.some(
        (member) =>
          member.deliverable.revisionId !== revisionId ||
          member.deliverable.projectId !== project.id,
      )
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'An Issue Package cannot mix Deliverables from different Revisions or Projects.',
        400,
      );
    }
    const revision = this.registry.getRevision(revisionId);
    if (revision.lifecycleState !== 'FINALIZED') {
      throw new DomainError(
        'CONFLICT',
        'Issue Packages require a finalized canonical Revision.',
        409,
      );
    }
    const blocking = checks.filter((check) => !check.passed && check.severity === 'Blocking');
    if (input.status === 'Issued' && blocking.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Ready-to-Issue checks contain blocking items. Resolve them before creating the issue package.',
        400,
        { checks: blocking.map((check) => check.label) },
      );
    }
    const latestLuminaireUpdate = workspace.luminaires.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      '',
    );
    const warnings = [
      ...checks.filter((check) => !check.passed && check.severity === 'Warning'),
      ...(latestLuminaireUpdate > revision.createdAt
        ? [{ label: 'Canonical Outputs are outdated' }]
        : []),
    ];
    if (input.status === 'Issued' && warnings.length && !input.warningOverrideReason.trim()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Warnings must be resolved or overridden with a reason before issue.',
        400,
      );
    }
    if (input.status === 'Issued' && !input.recoveryPackageId) {
      this.personalStore.createBackup('PRE_ISSUE');
    }

    const root = path.resolve(workspace.folderPath);
    const targetRelative = normalizeCanonicalProjectRelativePath(input.relativeOutputFolder);
    const artifactRelative =
      input.outputMode === 'Folder' ? targetRelative : `${targetRelative}.zip`;
    // PACKAGES-E2E-04B — the technical manifest is INTERNAL system metadata and
    // must NOT appear inside the client-facing package tree. New packages store
    // it under an app-owned, package-identity-scoped, project-contained path.
    // Recovery reuses the PERSISTED manifestLocatorValue, so a historical
    // package whose locator points into the old client folder still resolves.
    const reservedPackageId = input.recoveryPackageId ?? this.packageId();
    const manifestRelative = input.recoveryPackageId
      ? (this.registry.getIssuePackage(input.recoveryPackageId).manifestLocatorValue ??
        internalPackageManifestLocator(input.recoveryPackageId))
      : internalPackageManifestLocator(reservedPackageId);
    // V4-ISSUE-A0: derive the Issue audit authority exactly once for this package
    // operation. A new Issued package captures the authenticated actor and ONE
    // server timestamp; recovery preserves the original persisted values; Draft
    // packages carry nulls. The same logical values flow into the canonical
    // record, the read projection, and the manifest — never independent now()
    // calls that could drift.
    let issuePackage: CanonicalIssuePackageRecord;
    let issueAudit: {
      issuedBy: { actorId: string; actorNameSnapshot: string } | null;
      issuedAt: string | null;
    };
    if (input.recoveryPackageId) {
      issuePackage = this.preparePackageRetry(
        input.recoveryPackageId,
        project.id,
        revisionId,
        input.label,
        artifactRelative,
        manifestRelative,
      );
      issueAudit = {
        issuedBy:
          issuePackage.issuedById && issuePackage.issuedByName
            ? {
                actorId: issuePackage.issuedById,
                actorNameSnapshot: issuePackage.issuedByName,
              }
            : null,
        issuedAt: issuePackage.issuedAt,
      };
    } else {
      issueAudit =
        input.status === 'Issued'
          ? {
              issuedBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
              issuedAt: this.now().toISOString(),
            }
          : { issuedBy: null, issuedAt: null };
      issuePackage = this.registry.createIssuePackage({
        revisionId,
        label: input.label,
        artifactRelativePath: artifactRelative,
        manifestRelativePath: manifestRelative,
        // PACKAGES-E2E-04B — the manifest path is package-identity-scoped, so
        // the reserved packageId is supplied so the internal manifest locator
        // matches the persisted package identity.
        packageId: reservedPackageId,
        issuedBy: issueAudit.issuedBy,
        issuedAt: issueAudit.issuedAt,
      });
    }
    let canonicalFinalized = false;
    try {
      // B2 — validate EVERY member's immutable source before any package
      // materialization: source exists in authority, artifact locator is safe
      // and present, and SHA-256 matches the immutable proof. GeneratedOutput
      // sources are proven canonical Output artifacts; DocumentSnapshot sources
      // are the immutable snapshot copies (never the mutable ProjectDocument).
      for (const { deliverable, snapshot } of resolvedMembers) {
        if (deliverable.sourceType === 'GeneratedOutput') {
          const output = this.registry.getOutput(deliverable.deliverableId);
          if (
            output.lifecycleState !== 'FINALIZED' ||
            !output.contentHash ||
            output.locatorKind !== 'PROJECT_RELATIVE' ||
            !output.locatorValue
          ) {
            throw new DomainError(
              'VALIDATION_ERROR',
              'Issue Packages may contain only finalized, hashed canonical Outputs.',
              400,
            );
          }
          const sourcePath = resolveCanonicalArtifactPath(root, output.locatorValue);
          await assertReadableFile(sourcePath, 'Canonical source Output');
          if ((await sha256File(sourcePath)) !== output.contentHash) {
            throw new DomainError(
              'CONFLICT',
              'A canonical source Output failed SHA-256 integrity validation.',
              409,
            );
          }
        } else {
          if (!snapshot) {
            throw new DomainError(
              'VALIDATION_ERROR',
              'A selected Document Snapshot no longer exists in the immutable authority.',
              400,
            );
          }
          if (snapshot.locatorKind !== 'PROJECT_RELATIVE' || !snapshot.locatorValue) {
            throw new DomainError(
              'VALIDATION_ERROR',
              'A Document Snapshot lacks a safe project-relative artifact locator.',
              400,
            );
          }
          const sourcePath = resolveCanonicalArtifactPath(root, snapshot.locatorValue);
          await assertReadableFile(sourcePath, 'Canonical source Document Snapshot');
          if ((await sha256File(sourcePath)) !== snapshot.contentHash) {
            throw new DomainError(
              'CONFLICT',
              'A Document Snapshot artifact failed SHA-256 integrity validation.',
              409,
            );
          }
        }
      }
      const members = resolvedMembers.map((member) => ({
        sourceType: member.deliverable.sourceType as 'GeneratedOutput' | 'DocumentSnapshot',
        sourceId:
          member.deliverable.sourceType === 'GeneratedOutput'
            ? member.deliverable.deliverableId
            : member.deliverable.deliverableId,
      }));
      const existingRelations = this.registry.listPackageDeliverables(issuePackage.packageId);
      if (existingRelations.length === 0) {
        this.registry.addPackageDeliverables(issuePackage.packageId, members);
      } else if (
        existingRelations.length !== members.length ||
        existingRelations.some(
          (relation, index) =>
            relation.sourceType !== members[index]?.sourceType ||
            relation.sourceId !== members[index]?.sourceId,
        )
      ) {
        throw new DomainError(
          'CONFLICT',
          'Recovery Deliverable identities do not match the reserved Issue Package.',
          409,
        );
      }

      const targetFolder = resolveCanonicalArtifactPath(root, targetRelative);
      const zipFinalPath = `${targetFolder}.zip`;
      const manifestFinalPath = resolveCanonicalArtifactPath(root, manifestRelative);
      const artifactFinalPath = resolveCanonicalArtifactPath(root, artifactRelative);
      const stagingFolder = packageStagingPath(targetFolder, issuePackage.packageId);
      const zipTemporaryPath = packageArtifactTemporaryPath(zipFinalPath, issuePackage.packageId);
      if (input.recoveryPackageId) {
        await this.removeOwnedRecoveryTemps([stagingFolder, zipTemporaryPath]);
        if (input.outputMode === 'Folder') {
          const recovered = await this.recoverFinalFolder(
            issuePackage,
            revision,
            resolvedMembers,
            root,
            targetFolder,
            manifestFinalPath,
            input,
          );
          if (recovered) {
            canonicalFinalized = true;
            return recovered;
          }
        }
      }
      for (const collisionPath of [
        artifactFinalPath,
        manifestFinalPath,
        stagingFolder,
        ...(input.outputMode === 'Both' ? [targetFolder] : []),
        ...(input.outputMode === 'Zip' || input.outputMode === 'Both' ? [zipTemporaryPath] : []),
      ]) {
        if ((await artifactPathKind(collisionPath)) !== 'MISSING') {
          throw new DomainError(
            'CONFLICT',
            'The canonical Issue Package target is already occupied.',
            409,
          );
        }
      }
      await ensureArtifactParent(stagingFolder);
      await mkdir(stagingFolder);
      const usedNames = new Set<string>();
      const manifestOutputs: CanonicalPackageManifest['outputs'] = [];
      const manifestDeliverables: CanonicalPackageManifest['deliverables'] = [];
      const legacyManifest: RevisionPackageManifestItem[] = [];
      for (const { deliverable, snapshot } of resolvedMembers) {
        if (deliverable.sourceType === 'GeneratedOutput') {
          const output = this.registry.getOutput(deliverable.deliverableId);
          const presentation = outputPresentation(output);
          const directoryName = groupDirectories[presentation.group];
          if (!directoryName || !output.locatorValue || !output.contentHash) {
            throw new DomainError(
              'VALIDATION_ERROR',
              'Output cannot be placed in this package.',
              400,
            );
          }
          const directory = path.join(stagingFolder, directoryName);
          await mkdir(directory, { recursive: true });
          const sourcePath = resolveCanonicalArtifactPath(root, output.locatorValue);
          const extension = path.extname(sourcePath);
          const base = safeFileName(path.basename(sourcePath, extension));
          let fileName = `${base}${extension}`;
          let suffix = 2;
          while (usedNames.has(`${presentation.group}:${fileName.toLowerCase()}`)) {
            fileName = `${base}_${suffix}${extension}`;
            suffix += 1;
          }
          usedNames.add(`${presentation.group}:${fileName.toLowerCase()}`);
          const packageRelativePath = path.posix.join(directoryName, fileName);
          const copiedPath = path.join(directory, fileName);
          await copyFile(sourcePath, copiedPath, constants.COPYFILE_EXCL);
          const copiedHash = await sha256File(copiedPath);
          if (copiedHash !== output.contentHash) {
            throw new DomainError(
              'CONFLICT',
              'Copied package Output failed integrity validation.',
              409,
            );
          }
          const sizeBytes = statSync(copiedPath).size;
          manifestOutputs.push({
            outputId: output.outputId,
            outputFamily: output.outputFamily!,
            outputFormat: output.outputFormat,
            group: presentation.group,
            label: presentation.label,
            storedRelativeLocator: output.locatorValue,
            packageRelativePath,
            contentHash: output.contentHash,
            sizeBytes,
          });
          manifestDeliverables.push({
            sourceType: 'GeneratedOutput',
            outputId: output.outputId,
            outputFamily: output.outputFamily!,
            outputFormat: output.outputFormat,
            group: presentation.group,
            label: presentation.label,
            storedRelativeLocator: output.locatorValue,
            packageRelativePath,
            contentHash: output.contentHash,
            sizeBytes,
          });
          legacyManifest.push({
            itemId: output.outputId,
            group: presentation.group,
            label: presentation.label,
            fileName: packageRelativePath,
            sourcePath,
            sizeBytes,
            sha256: output.contentHash,
            sourceType: 'GeneratedOutput',
            sourceId: output.outputId,
          });
          continue;
        }
        if (!snapshot) {
          throw new DomainError(
            'VALIDATION_ERROR',
            'A selected Document Snapshot no longer exists in the immutable authority.',
            400,
          );
        }
        // PACKAGES-E2E-04A — file the snapshot copy under its client taxonomy
        // folder (structured category authority), and give Lighting Layout /
        // DIALux copies a deterministic professional client-facing name.
        // PACKAGES-E2E-05B — a Datasheet copy gets the structured
        // `<Tag>_<Manufacturer>_<Model>` name from the canonical Luminaire.
        const directoryName = snapshotDirectory(snapshot.category);
        const directory = path.join(stagingFolder, directoryName);
        await mkdir(directory, { recursive: true });
        const sourcePath = resolveCanonicalArtifactPath(root, snapshot.locatorValue);
        const extension = path.extname(snapshot.fileName || sourcePath);
        const originalBase = safeFileName(
          path.basename(snapshot.fileName || sourcePath, extension),
        );
        const datasheetLuminaire = this.datasheetLuminaire(project.id, snapshot);
        const copyBase = clientCopyBaseName({
          projectCode: project.projectCode,
          revisionLabel:
            revision.revisionLabel ?? `REV_${String(revision.revisionSequence).padStart(2, '0')}`,
          category: snapshot.category,
          originalBase,
          ...(datasheetLuminaire ? { datasheet: datasheetLuminaire } : {}),
        });
        let fileName = `${copyBase}${extension}`;
        let suffix = 2;
        while (usedNames.has(`${directoryName}:${fileName.toLowerCase()}`)) {
          fileName = `${copyBase}_${suffix}${extension}`;
          suffix += 1;
        }
        usedNames.add(`${directoryName}:${fileName.toLowerCase()}`);
        const packageRelativePath = path.posix.join(directoryName, fileName);
        const copiedPath = path.join(directory, fileName);
        await copyFile(sourcePath, copiedPath, constants.COPYFILE_EXCL);
        const copiedHash = await sha256File(copiedPath);
        if (copiedHash !== snapshot.contentHash) {
          throw new DomainError(
            'CONFLICT',
            'Copied package Document Snapshot failed integrity validation.',
            409,
          );
        }
        const sizeBytes = statSync(copiedPath).size;
        manifestDeliverables.push({
          sourceType: 'DocumentSnapshot',
          deliverableId: snapshot.deliverableId,
          title: snapshot.title,
          category: snapshot.category,
          group: 'Documents',
          fileName: snapshot.fileName,
          storedRelativeLocator: snapshot.locatorValue,
          packageRelativePath,
          contentHash: snapshot.contentHash,
          sizeBytes,
        });
        legacyManifest.push({
          itemId: snapshot.deliverableId,
          group: 'Documents',
          label: snapshot.title,
          fileName: packageRelativePath,
          sourcePath,
          sizeBytes,
          sha256: snapshot.contentHash,
          sourceType: 'DocumentSnapshot',
          sourceId: snapshot.deliverableId,
        });
      }
      const legacyLuminaireSnapshot = luminaireManifestSnapshot(revision);
      const manifest: CanonicalPackageManifest = {
        version: 2,
        packageId: issuePackage.packageId,
        projectId: project.id,
        revisionId,
        revisionSequence: revision.revisionSequence,
        revisionLabel: revision.revisionLabel,
        packageSequence: issuePackage.packageSequence!,
        label: input.label,
        status: input.status,
        outputMode: input.outputMode,
        warningOverrideReason: input.warningOverrideReason,
        issuedAt: issueAudit.issuedAt,
        issuedBy: issueAudit.issuedBy,
        outputs: manifestOutputs,
        deliverables: manifestDeliverables,
        luminaires: legacyLuminaireSnapshot.map((item) => ({
          luminaireId: item.luminaireId!,
          tag: item.tag,
          values: item.values,
        })),
      };
      const manifestJson = canonicalRegistryJson(canonicalPackageManifestSchema.parse(manifest));
      // PACKAGES-E2E-04B — the technical manifest is internal metadata and must
      // NOT be written into the staging folder (which becomes the client-facing
      // package). It is written directly to the app-owned internal path.
      await ensureArtifactParent(manifestFinalPath);
      await writeFile(manifestFinalPath, manifestJson, { encoding: 'utf8', flag: 'wx' });
      if (input.outputMode === 'Zip' || input.outputMode === 'Both') {
        await createZip(stagingFolder, zipTemporaryPath);
      }
      if (input.outputMode === 'Zip') {
        await moveArtifactNoReplace(zipTemporaryPath, zipFinalPath);
      } else if (input.outputMode === 'Both') {
        await moveArtifactNoReplace(zipTemporaryPath, zipFinalPath);
        await moveArtifactNoReplace(stagingFolder, targetFolder);
      } else {
        await moveArtifactNoReplace(stagingFolder, targetFolder);
      }
      if (input.outputMode !== 'Folder') {
        await assertReadableFile(zipFinalPath, 'Final Issue Package ZIP');
      }
      await assertReadableFile(manifestFinalPath, 'Final Issue Package manifest');
      const persistedManifest = canonicalPackageManifestSchema.parse(
        JSON.parse(await readFile(manifestFinalPath, 'utf8')),
      );
      if (persistedManifest.packageId !== issuePackage.packageId) {
        throw new DomainError('CONFLICT', 'Final Issue Package manifest identity is invalid.', 409);
      }
      if (input.outputMode === 'Zip' && (await artifactPathKind(stagingFolder)) === 'DIRECTORY') {
        await rm(stagingFolder, { recursive: true, force: true });
      }
      const packageHash = createHash('sha256').update(manifestJson, 'utf8').digest('hex');
      const record: RevisionPackageRecord = {
        id: issuePackage.packageId,
        projectId: project.id,
        revisionNumber: revision.revisionSequence,
        reissueNumber: issuePackage.packageSequence! - 1,
        label: input.label,
        status: input.status,
        outputMode: input.outputMode,
        folderPath: input.outputMode === 'Zip' ? '' : targetFolder,
        zipPath: input.outputMode === 'Folder' ? '' : zipFinalPath,
        itemCount: legacyManifest.length,
        totalBytes: legacyManifest.reduce((total, item) => total + item.sizeBytes, 0),
        packageHash,
        warningOverrideReason: input.warningOverrideReason,
        manifest: legacyManifest,
        luminaireSnapshot: legacyLuminaireSnapshot,
        issuedById: issueAudit.issuedBy?.actorId ?? null,
        issuedByName: issueAudit.issuedBy?.actorNameSnapshot ?? null,
        issuedAt: issueAudit.issuedAt,
        createdAt: issuePackage.createdAt,
      };
      const projection = this.personalStore.recordCanonicalRevisionPackageProjection(record);
      this.registry.setPackageLifecycle(issuePackage.packageId, 'FINALIZED');
      canonicalFinalized = true;
      return projection;
    } catch (error) {
      if (!canonicalFinalized) {
        try {
          const current = this.registry.getIssuePackage(issuePackage.packageId);
          if (current.lifecycleState === 'PREPARING') {
            this.registry.setPackageLifecycle(
              issuePackage.packageId,
              'FAILED_RECOVERABLE',
              boundedArtifactFailure(error, 'Issue Package finalisation failed.'),
            );
          }
        } catch {
          // Preserve the primary error; reconciliation will inspect exact canonical evidence.
        }
      }
      if (error instanceof DomainError) {
        throw new DomainError(error.code, error.message, error.statusCode, {
          ...(error.details ?? {}),
          packageId: issuePackage.packageId,
        });
      }
      throw new DomainError(
        'EXPORT_FAILED',
        'The Issue Package could not be finalized safely. Its canonical identity is recoverable.',
        500,
        { packageId: issuePackage.packageId },
      );
    }
  }

  private preparePackageRetry(
    packageId: string,
    projectId: string,
    revisionId: string,
    label: string,
    artifactRelativePath: string,
    manifestRelativePath: string,
  ) {
    const issuePackage = this.registry.getIssuePackage(packageId);
    if (
      issuePackage.projectId !== projectId ||
      issuePackage.revisionId !== revisionId ||
      issuePackage.provenanceClassification !== 'CANONICAL'
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Recovery Issue Package does not belong to this Project and Revision.',
        400,
      );
    }
    if (issuePackage.lifecycleState !== 'FAILED_RECOVERABLE') {
      throw new DomainError(
        'CONFLICT',
        'Only a recoverable canonical Issue Package can be retried explicitly.',
        409,
      );
    }
    if (
      issuePackage.label !== label ||
      issuePackage.artifactLocatorValue !== artifactRelativePath ||
      issuePackage.manifestLocatorValue !== manifestRelativePath
    ) {
      throw new DomainError(
        'CONFLICT',
        'Recovery Package label and locators must match the reserved canonical identity.',
        409,
      );
    }
    return this.registry.setPackageLifecycle(packageId, 'PREPARING');
  }

  private async recoverFinalFolder(
    issuePackage: CanonicalIssuePackageRecord,
    revision: CanonicalRevisionRecord,
    resolvedMembers: Array<{
      deliverable: RevisionDeliverable;
      snapshot: RevisionDocumentSnapshotRecord | null;
    }>,
    projectRoot: string,
    targetFolder: string,
    manifestPath: string,
    input: CreateRevisionPackageInput,
  ): Promise<RevisionPackageRecord | null> {
    if (
      (await artifactPathKind(targetFolder)) === 'MISSING' &&
      (await artifactPathKind(manifestPath)) === 'MISSING'
    ) {
      return null;
    }
    if (
      (await artifactPathKind(targetFolder)) !== 'DIRECTORY' ||
      (await artifactPathKind(manifestPath)) !== 'FILE'
    ) {
      throw new DomainError(
        'CONFLICT',
        'Final Issue Package recovery evidence is incomplete or ambiguous.',
        409,
      );
    }
    let manifest: CanonicalPackageManifest;
    let legacyManifest: RevisionPackageManifestItem[];
    const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version?: number;
    };
    if (rawManifest.version === 2) {
      const parsed = canonicalPackageManifestSchema.parse(rawManifest);
      manifest = parsed;
      legacyManifest = [];
    } else {
      // Historical v1 Output-only manifest (pre-B2). Recover it through the
      // legacy schema and project its outputs; the reserved canonical identity
      // remains Output-only.
      const legacy = legacyCanonicalPackageManifestSchema.parse(rawManifest);
      if (legacy.packageId !== issuePackage.packageId) {
        throw new DomainError(
          'CONFLICT',
          'Final Issue Package manifest does not match the reserved canonical identity.',
          409,
        );
      }
      manifest = {
        version: 2,
        packageId: legacy.packageId,
        projectId: legacy.projectId,
        revisionId: legacy.revisionId,
        revisionSequence: legacy.revisionSequence,
        revisionLabel: legacy.revisionLabel,
        packageSequence: legacy.packageSequence,
        label: legacy.label,
        status: legacy.status,
        outputMode: legacy.outputMode,
        warningOverrideReason: legacy.warningOverrideReason,
        issuedAt: legacy.issuedAt,
        issuedBy: legacy.issuedBy,
        outputs: legacy.outputs,
        deliverables: legacy.outputs.map((item) => ({
          sourceType: 'GeneratedOutput',
          outputId: item.outputId,
          outputFamily: item.outputFamily,
          outputFormat: item.outputFormat,
          group: item.group,
          label: item.label,
          storedRelativeLocator: item.storedRelativeLocator,
          packageRelativePath: item.packageRelativePath,
          contentHash: item.contentHash,
          sizeBytes: item.sizeBytes,
        })),
        luminaires: legacy.luminaires,
      };
      legacyManifest = [];
    }
    if (
      manifest.packageId !== issuePackage.packageId ||
      manifest.projectId !== issuePackage.projectId ||
      manifest.revisionId !== revision.revisionId ||
      manifest.revisionSequence !== revision.revisionSequence ||
      manifest.packageSequence !== issuePackage.packageSequence ||
      manifest.label !== input.label ||
      manifest.status !== input.status ||
      manifest.outputMode !== 'Folder' ||
      manifest.warningOverrideReason !== input.warningOverrideReason
    ) {
      throw new DomainError(
        'CONFLICT',
        'Final Issue Package manifest does not match the reserved canonical identity.',
        409,
      );
    }
    // B2 — the recovered membership must exactly match the reserved generic
    // membership (same members, same order). Snapshot members are identified by
    // their immutable deliverableId — never the mutable ProjectDocument.
    const expectedMembers = resolvedMembers.map((member) => ({
      sourceType: member.deliverable.sourceType as 'GeneratedOutput' | 'DocumentSnapshot',
      sourceId:
        member.deliverable.sourceType === 'GeneratedOutput'
          ? member.deliverable.deliverableId
          : member.deliverable.deliverableId,
    }));
    if (
      manifest.deliverables.length !== expectedMembers.length ||
      manifest.deliverables.some((item, index) => {
        const expected = expectedMembers[index];
        if (!expected) return true;
        if (item.sourceType !== expected.sourceType) return true;
        return item.sourceType === 'GeneratedOutput'
          ? item.outputId !== expected.sourceId
          : item.deliverableId !== expected.sourceId;
      })
    ) {
      throw new DomainError(
        'CONFLICT',
        'Final Issue Package Deliverable evidence does not match the reserved canonical identity.',
        409,
      );
    }
    const expectedLuminaires = luminaireManifestSnapshot(revision).map((item) => ({
      luminaireId: item.luminaireId!,
      tag: item.tag,
      values: item.values,
    }));
    if (canonicalRegistryJson(manifest.luminaires) !== canonicalRegistryJson(expectedLuminaires)) {
      throw new DomainError(
        'CONFLICT',
        'Final Issue Package Luminaire snapshot does not match the source Revision.',
        409,
      );
    }
    for (let index = 0; index < manifest.deliverables.length; index += 1) {
      const item = manifest.deliverables[index]!;
      const member = resolvedMembers[index]!;
      const snapshot = member.snapshot;
      if (item.sourceType === 'GeneratedOutput') {
        const output = this.registry.getOutput(item.outputId);
        if (
          output.revisionId !== revision.revisionId ||
          output.projectId !== issuePackage.projectId ||
          output.lifecycleState !== 'FINALIZED' ||
          output.locatorValue !== item.storedRelativeLocator ||
          output.contentHash !== item.contentHash ||
          item.outputFamily !== output.outputFamily ||
          item.outputFormat !== output.outputFormat
        ) {
          throw new DomainError(
            'CONFLICT',
            'Final Issue Package Output evidence does not match canonical history.',
            409,
          );
        }
      } else if (!snapshot) {
        throw new DomainError(
          'CONFLICT',
          'A recovered Document Snapshot no longer exists in the immutable authority.',
          409,
        );
      } else if (
        snapshot.revisionId !== revision.revisionId ||
        snapshot.projectId !== issuePackage.projectId ||
        snapshot.locatorValue !== item.storedRelativeLocator ||
        snapshot.contentHash !== item.contentHash ||
        snapshot.title !== item.title ||
        snapshot.category !== item.category
      ) {
        throw new DomainError(
          'CONFLICT',
          'Final Issue Package Document Snapshot evidence does not match canonical history.',
          409,
        );
      }
      const packagedPath = path.resolve(targetFolder, ...item.packageRelativePath.split('/'));
      const relative = path.relative(targetFolder, packagedPath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new DomainError('CONFLICT', 'Recovered Package path escaped its folder.', 409);
      }
      await assertReadableFile(packagedPath, 'Recovered package Deliverable');
      if (
        (await sha256File(packagedPath)) !== item.contentHash ||
        statSync(packagedPath).size !== item.sizeBytes
      ) {
        throw new DomainError(
          'CONFLICT',
          'Recovered Package Deliverable failed integrity validation.',
          409,
        );
      }
      if (item.sourceType === 'GeneratedOutput') {
        legacyManifest.push({
          itemId: item.outputId,
          group: item.group,
          label: item.label,
          fileName: item.packageRelativePath,
          sourcePath: resolveCanonicalArtifactPath(projectRoot, item.storedRelativeLocator),
          sizeBytes: item.sizeBytes,
          sha256: item.contentHash,
          sourceType: 'GeneratedOutput',
          sourceId: item.outputId,
        });
      } else {
        legacyManifest.push({
          itemId: item.deliverableId,
          group: item.group,
          label: item.title,
          fileName: item.packageRelativePath,
          sourcePath: resolveCanonicalArtifactPath(projectRoot, item.storedRelativeLocator),
          sizeBytes: item.sizeBytes,
          sha256: item.contentHash,
          sourceType: 'DocumentSnapshot',
          sourceId: item.deliverableId,
        });
      }
    }
    const manifestJson = canonicalRegistryJson(manifest);
    const record: RevisionPackageRecord = {
      id: issuePackage.packageId,
      projectId: issuePackage.projectId,
      revisionNumber: revision.revisionSequence,
      reissueNumber: issuePackage.packageSequence! - 1,
      label: input.label,
      status: input.status,
      outputMode: 'Folder',
      folderPath: targetFolder,
      zipPath: '',
      itemCount: legacyManifest.length,
      totalBytes: legacyManifest.reduce((total, item) => total + item.sizeBytes, 0),
      packageHash: createHash('sha256').update(manifestJson, 'utf8').digest('hex'),
      warningOverrideReason: input.warningOverrideReason,
      manifest: legacyManifest,
      luminaireSnapshot: luminaireManifestSnapshot(revision),
      issuedById: issuePackage.issuedById,
      issuedByName: issuePackage.issuedByName,
      issuedAt: issuePackage.issuedAt,
      createdAt: issuePackage.createdAt,
    };
    const projection = this.personalStore.recordCanonicalRevisionPackageProjection(record);
    this.registry.setPackageLifecycle(issuePackage.packageId, 'FINALIZED');
    return projection;
  }

  private async removeOwnedRecoveryTemps(paths: readonly string[]): Promise<void> {
    for (const candidate of new Set(paths)) {
      const kind = await artifactPathKind(candidate);
      if (kind === 'MISSING') continue;
      if (kind === 'FILE') {
        await rm(candidate, { force: true });
        continue;
      }
      if (kind === 'DIRECTORY') {
        await rm(candidate, { recursive: true, force: true });
        continue;
      }
      throw new DomainError(
        'CONFLICT',
        'An owned Issue Package recovery path has an unsafe filesystem type.',
        409,
      );
    }
  }
}
