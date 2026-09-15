import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DomainError,
  type AppUser,
  type CanonicalLuminaireSnapshot,
  type CanonicalRevisionRecord,
  type Project,
  type ProjectSourceFile,
  type ProjectSourceFileType,
  type ProjectStorageHealth,
  type ProjectWorkspace,
  type ReadinessFinding,
  type ReadinessLevel,
  type ReadinessResult,
  type RevisionComparison,
  type RevisionFieldChange,
  type RevisionImpactCategory,
  type RevisionLuminaireDiff,
  type RevisionSourceFileBaseline,
  type SourceFreshnessItem,
  actionBlocksIssue,
} from '@scli/domain';
import type { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore.js';
import { ProjectIntelligenceStore } from './ProjectIntelligenceStore.js';

/**
 * P5D — Project Intelligence & Productivity orchestration service.
 *
 * Server-side product policy only. The renderer receives projections and never
 * interprets verification/readiness semantics itself. All reads are bounded:
 * readiness aggregates existing authorities (no filesystem scanning), Revision
 * Comparison reads exactly two immutable snapshots, source freshness hashes only
 * explicit registered files on user request.
 */

/** Controlled source file bound. Sources may be large CAD/Dialux files. */
export const MAX_CONTROLLED_SOURCE_BYTES = 200 * 1024 * 1024;

const fieldLabels: Readonly<Record<string, string>> = {
  tag: 'Tag',
  category: 'Category',
  location: 'Location',
  quantity: 'Quantity',
  unit: 'Unit',
  notes: 'Notes',
  description: 'Description',
  manufacturer: 'Manufacturer',
  orderingCode: 'Ordering Code',
  model: 'Model',
  wattage: 'Wattage / System Power',
  lumens: 'Flux',
  lightColor: 'CCT',
  cri: 'CRI',
  beamAngle: 'Beam / Distribution',
  ipRating: 'IP',
  mounting: 'Mounting',
  cutout: 'Cutout',
  driver: 'Driver',
  control: 'Control',
  emergency: 'Emergency',
  datasheetPath: 'Datasheet',
  bodyColorFinish: 'Finish',
  dimensions: 'Dimensions',
  productType: 'Product Type',
  variantLabel: 'Variant',
};

/** Canonical engineering impact families (locked P5D taxonomy). */
function impactCategoryFor(field: string): RevisionImpactCategory {
  switch (field) {
    case 'quantity':
    case 'unit':
      return 'QUANTITY_BOQ_IMPACT';
    case 'manufacturer':
    case 'orderingCode':
    case 'model':
      return 'PRODUCT_ORDERING_CODE_IMPACT';
    case 'datasheetPath':
    case 'datasheetAssetVersionId':
      return 'DATASHEET_VERIFICATION_IMPACT';
    case 'imagePath':
    case 'libraryVersionId':
      return 'OUTPUT_COMPOSITION_IMPACT';
    default:
      return 'TECHNICAL_SCHEDULE_IMPACT';
  }
}

/** Snapshot fields that are compared for equality (UUID identity already handled). */
const SNAPSHOT_COMPARE_FIELDS: readonly (keyof CanonicalLuminaireSnapshot)[] = [
  'tag',
  'category',
  'location',
  'quantity',
  'unit',
  'notes',
  'description',
  'manufacturer',
  'orderingCode',
  'model',
  'wattage',
  'lumens',
  'lightColor',
  'cri',
  'beamAngle',
  'ipRating',
  'mounting',
  'cutout',
  'driver',
  'control',
  'emergency',
  'datasheetPath',
  'bodyColorFinish',
  'dimensions',
  'productType',
  'variantLabel',
];

function sameValue(a: unknown, b: unknown): boolean {
  return String(a ?? '') === String(b ?? '');
}

function deterministicSnapshotSort(
  snapshots: readonly CanonicalLuminaireSnapshot[],
): CanonicalLuminaireSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const byTag = a.tag.localeCompare(b.tag);
    return byTag !== 0 ? byTag : a.luminaireId.localeCompare(b.luminaireId);
  });
}

export interface ProjectIntelligenceServiceDeps {
  personalStore: {
    getWorkspace(projectId: string): ProjectWorkspace;
  };
  registry: CanonicalOutputRegistryStore | undefined;
  sourceStore: ProjectIntelligenceStore;
  storageHealth: (project: Project) => Promise<ProjectStorageHealth>;
  /**
   * Existing Local Intelligence authority (same projection the Technical Check
   * page consumes). Its `checks` already encode the locked severity policy
   * (Blocking/Warning/Info) — readiness never upgrades or invents policy.
   */
  localIntelligence: (input: { project: Project; workspace: ProjectWorkspace }) => Promise<{
    checks: Array<{
      key: string;
      label: string;
      detail: string;
      severity: 'Info' | 'Warning' | 'Blocking';
      passed: boolean;
    }>;
  }>;
  clock: (() => Date) | undefined;
}

export class ProjectIntelligenceService {
  public constructor(private readonly deps: ProjectIntelligenceServiceDeps) {}

  private now(): string {
    return (this.deps.clock ?? (() => new Date()))().toISOString();
  }

  // =======================================================================
  // Source admission / freshness
  // =======================================================================

  /**
   * Registers a controlled source from a governed, server-validated picker
   * result. The server resolves/validates the picked file and computes the
   * SHA-256 itself — the renderer never supplies a hash or a path.
   */
  public async registerSourceFile(
    project: Project,
    input: { sourceType: ProjectSourceFileType; pickedFileAbsolutePath: string },
  ): Promise<ProjectSourceFile> {
    const root = await this.verifiedProjectRoot(project);
    const absolute = path.resolve(input.pickedFileAbsolutePath);
    const relative = path.relative(root, absolute);
    const originalRelativeLocator = relative.split(path.sep).join('/');
    if (relative.startsWith('..') || path.isAbsolute(relative) || !originalRelativeLocator.trim()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A controlled source must reside inside the verified Project root.',
        400,
      );
    }
    if (
      !existsSync(absolute) ||
      !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink()
    ) {
      throw new DomainError('VALIDATION_ERROR', 'The selected file is not a regular file.', 400);
    }
    const real = realpathSync.native(absolute);
    if (real.toLowerCase() !== absolute.toLowerCase()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Symlink or reparse-point source files are not allowed.',
        400,
      );
    }
    const stats = lstatSync(absolute);
    if (stats.size <= 0 || stats.size > MAX_CONTROLLED_SOURCE_BYTES) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected source is empty or exceeds the 200 MiB bound.',
        400,
      );
    }
    const sha256 = await sha256File(absolute);
    const at = this.now();
    return this.deps.sourceStore.registerSourceFile({
      projectId: project.id,
      sourceType: input.sourceType,
      displayName: path.basename(absolute),
      originalRelativeLocator,
      sha256,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      now: at,
    });
  }

  /** On-demand freshness check for ONE registered source (hash-only; no scan). */
  public async checkSourceFreshness(
    project: Project,
    sourceId: string,
    revisionId: string,
    revisionLabelForDisplay?: string | null,
  ): Promise<{ item: SourceFreshnessItem; revisionLabel: string | null }> {
    const source = this.deps.sourceStore.getSourceFile(project.id, sourceId);
    const baseline = this.deps.sourceStore.getBaseline(project.id, sourceId, revisionId);
    const item = await this.computeSourceFreshnessItem(project, source, revisionId, baseline);
    return { item, revisionLabel: revisionLabelForDisplay ?? null };
  }

  /** Freshness for every registered source against one exact Revision. */
  public async listSourceFreshness(
    project: Project,
    revisionId: string,
  ): Promise<SourceFreshnessItem[]> {
    const sources = this.deps.sourceStore.listSourceFiles(project.id);
    return Promise.all(
      sources.map(async (source) => {
        const baseline = this.deps.sourceStore.getBaseline(project.id, source.id, revisionId);
        return this.computeSourceFreshnessItem(project, source, revisionId, baseline);
      }),
    );
  }

  private async computeSourceFreshnessItem(
    project: Project,
    source: ProjectSourceFile,
    revisionId: string,
    baseline: RevisionSourceFileBaseline | null,
  ): Promise<SourceFreshnessItem> {
    const checkedAt = this.now();
    let currentHash: string | null = null;

    let health: ProjectStorageHealth;
    try {
      health = await this.deps.storageHealth(project);
    } catch {
      health = { state: 'UNAVAILABLE' } as ProjectStorageHealth;
    }
    if (health.state !== 'CONNECTED') {
      return {
        source,
        revisionId,
        state: 'UNAVAILABLE',
        baseline,
        currentHash: null,
        checkedAt,
      };
    }
    const root = this.deps.personalStore.getWorkspace(project.id).folderPath;
    if (!root)
      return { source, revisionId, state: 'UNAVAILABLE', baseline, currentHash: null, checkedAt };
    const absolute = path.resolve(root, source.originalRelativeLocator);
    if (
      !existsSync(absolute) ||
      !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink()
    ) {
      return {
        source,
        revisionId,
        state: 'MISSING',
        baseline,
        currentHash: null,
        checkedAt,
      };
    }
    currentHash = await sha256File(absolute);
    if (!baseline) {
      return { source, revisionId, state: 'NOT_BASELINED', baseline: null, currentHash, checkedAt };
    }
    const state = currentHash === baseline.sha256 ? 'FRESH' : 'STALE';
    return { source, revisionId, state, baseline, currentHash, checkedAt };
  }

  /** Capture an immutable baseline for an exact Revision UUID (append-only). */
  public captureSourceBaseline(
    project: Project,
    sourceId: string,
    revisionId: string,
    actor: AppUser,
    revisionLabelForDisplay?: string | null,
  ): { baseline: RevisionSourceFileBaseline; revisionLabel: string | null } {
    const source = this.deps.sourceStore.getSourceFile(project.id, sourceId);
    const existing = this.deps.sourceStore.getBaseline(project.id, sourceId, revisionId);
    const at = this.now();
    if (existing) {
      throw new DomainError(
        'CONFLICT',
        'A source baseline already exists for this Revision. Baselines are immutable evidence.',
        409,
      );
    }
    const baseline = this.deps.sourceStore.captureBaseline({
      projectId: project.id,
      revisionId,
      sourceFileId: source.id,
      sha256: source.latestHash,
      sizeBytes: source.latestSize,
      capturedAt: at,
      capturedById: actor.id,
      capturedByName: actor.displayName,
    });
    return { baseline, revisionLabel: revisionLabelForDisplay ?? null };
  }

  // =======================================================================
  // Revision comparison (immutable snapshot authority only)
  // =======================================================================

  public compareRevisions(
    project: Project,
    fromRevisionId: string,
    toRevisionId: string,
  ): RevisionComparison {
    if (!this.deps.registry) {
      throw new DomainError('CONFLICT', 'Canonical Revision authority is unavailable.', 503);
    }
    const from = this.resolveRevisionAuthorized(project.id, fromRevisionId);
    const to = this.resolveRevisionAuthorized(project.id, toRevisionId);
    if (from.revisionId === to.revisionId) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Revision Comparison requires two different Revisions.',
        400,
      );
    }
    const fromSnapshots = deterministicSnapshotSort(from.luminaireSnapshot ?? []);
    const toSnapshots = deterministicSnapshotSort(to.luminaireSnapshot ?? []);
    const toById = new Map(toSnapshots.map((snapshot) => [snapshot.luminaireId, snapshot]));
    const fromById = new Map(fromSnapshots.map((snapshot) => [snapshot.luminaireId, snapshot]));

    const luminaires: RevisionLuminaireDiff[] = [];
    let technicalChanges = 0;
    let quantityChanges = 0;
    let orderingCodeChanges = 0;
    let datasheetChanges = 0;
    const impactedCategories = new Set<RevisionImpactCategory>();

    for (const fromSnapshot of fromSnapshots) {
      const toSnapshot = toById.get(fromSnapshot.luminaireId);
      if (!toSnapshot) {
        luminaires.push({
          luminaireId: fromSnapshot.luminaireId,
          tag: fromSnapshot.tag,
          changeType: 'REMOVED',
          changedFields: [],
          impactCategories: ['QUANTITY_BOQ_IMPACT'],
        });
        impactedCategories.add('QUANTITY_BOQ_IMPACT');
        continue;
      }
      const changedFields: RevisionFieldChange[] = [];
      for (const field of SNAPSHOT_COMPARE_FIELDS) {
        const before = fromSnapshot[field];
        const after = (toSnapshot as CanonicalLuminaireSnapshot)[field];
        if (!sameValue(before, after)) {
          const category = impactCategoryFor(field);
          changedFields.push({
            field,
            label: fieldLabels[field] ?? field,
            before,
            after,
            category,
          });
        }
      }
      if (changedFields.length === 0) {
        luminaires.push({
          luminaireId: fromSnapshot.luminaireId,
          tag: fromSnapshot.tag,
          changeType: 'UNCHANGED',
          changedFields: [],
          impactCategories: [],
        });
        continue;
      }
      for (const change of changedFields) {
        if (change.category === 'QUANTITY_BOQ_IMPACT' && change.field === 'quantity')
          quantityChanges += 1;
        if (change.category === 'PRODUCT_ORDERING_CODE_IMPACT' && change.field === 'orderingCode')
          orderingCodeChanges += 1;
        if (change.category === 'DATASHEET_VERIFICATION_IMPACT') datasheetChanges += 1;
        if (change.category === 'TECHNICAL_SCHEDULE_IMPACT') technicalChanges += 1;
        impactedCategories.add(change.category);
      }
      luminaires.push({
        luminaireId: fromSnapshot.luminaireId,
        tag: fromSnapshot.tag,
        changeType: 'CHANGED',
        changedFields,
        impactCategories: Array.from(new Set(changedFields.map((change) => change.category))),
      });
    }
    for (const toSnapshot of toSnapshots) {
      if (!fromById.has(toSnapshot.luminaireId)) {
        luminaires.push({
          luminaireId: toSnapshot.luminaireId,
          tag: toSnapshot.tag,
          changeType: 'ADDED',
          changedFields: [],
          impactCategories: ['QUANTITY_BOQ_IMPACT'],
        });
        impactedCategories.add('QUANTITY_BOQ_IMPACT');
      }
    }

    luminaires.sort((a, b) => {
      const order: Record<RevisionLuminaireDiff['changeType'], number> = {
        CHANGED: 0,
        ADDED: 1,
        REMOVED: 2,
        UNCHANGED: 3,
      };
      const byChange = order[a.changeType] - order[b.changeType];
      return byChange !== 0 ? byChange : a.tag.localeCompare(b.tag);
    });

    const summary = {
      added: luminaires.filter((item) => item.changeType === 'ADDED').length,
      removed: luminaires.filter((item) => item.changeType === 'REMOVED').length,
      changed: luminaires.filter((item) => item.changeType === 'CHANGED').length,
      unchanged: luminaires.filter((item) => item.changeType === 'UNCHANGED').length,
      technicalChanges,
      quantityChanges,
      orderingCodeChanges,
      datasheetChanges,
      impactedCategories: Array.from(impactedCategories),
    };

    return {
      projectId: project.id,
      fromRevisionId: from.revisionId,
      toRevisionId: to.revisionId,
      fromRevisionLabel: from.revisionLabel,
      toRevisionLabel: to.revisionLabel,
      fromFinalizedAt: from.finalizedAt,
      toFinalizedAt: to.finalizedAt,
      summary,
      luminaires,
    };
  }

  // =======================================================================
  // Readiness
  // =======================================================================

  public async readiness(project: Project, revisionId: string): Promise<ReadinessResult> {
    const workspace = this.deps.personalStore.getWorkspace(project.id);
    const findings: ReadinessFinding[] = [];

    // A. PROJECT STORAGE
    let storageConnected = false;
    try {
      const health = await this.deps.storageHealth(project);
      storageConnected = health.state === 'CONNECTED';
      if (!storageConnected) {
        findings.push({
          code: 'STORAGE_NOT_VERIFIED',
          severity: 'BLOCKER',
          title: 'Project storage is not connected and verified',
          detail:
            'Issue requires the connected, verified Project folder. Reconnect or verify Project storage first.',
          evidence: `storageState=${health.state}`,
          sourceAuthority: 'STORAGE',
          recommendedTarget: 'files',
        });
      }
    } catch {
      findings.push({
        code: 'STORAGE_UNAVAILABLE',
        severity: 'BLOCKER',
        title: 'Project storage could not be checked',
        detail: 'The connected Project folder could not be verified right now.',
        evidence: 'storageHealthCheckFailed',
        sourceAuthority: 'STORAGE',
        recommendedTarget: 'files',
      });
    }

    // B. REVISION
    let revision: CanonicalRevisionRecord | null = null;
    if (this.deps.registry) {
      try {
        revision = this.resolveRevisionAuthorized(project.id, revisionId);
        if (revision.lifecycleState !== 'FINALIZED') {
          findings.push({
            code: 'REVISION_NOT_FINALIZED',
            severity: 'BLOCKER',
            title: 'Target Revision is not finalized',
            detail: 'Issue Packages require a finalized canonical Revision.',
            evidence: `lifecycleState=${revision.lifecycleState}`,
            sourceAuthority: 'REVISION',
            recommendedTarget: 'revisions',
          });
        }
        if (!revision.luminaireSnapshot || revision.luminaireSnapshot.length === 0) {
          findings.push({
            code: 'REVISION_NO_SNAPSHOT',
            severity: 'WARNING',
            title: 'Target Revision has no Luminaire snapshot',
            detail:
              'The Revision snapshot is empty; comparison and composition projections may be incomplete.',
            evidence: 'luminaireSnapshot=empty',
            sourceAuthority: 'REVISION',
            recommendedTarget: 'revisions',
          });
        }
      } catch (error) {
        if (error instanceof DomainError && error.code === 'NOT_FOUND') {
          throw error;
        }
        findings.push({
          code: 'REVISION_UNAVAILABLE',
          severity: 'BLOCKER',
          title: 'Target Revision cannot be resolved',
          detail: 'The selected Revision is not available in the canonical authority.',
          evidence: `revisionId=${revisionId}`,
          sourceAuthority: 'REVISION',
          recommendedTarget: 'revisions',
        });
      }
    }

    // C. TECHNICAL VERIFICATION — existing Local Intelligence authority (the
    // same projection the Technical Check page consumes). Its checks already
    // encode the locked severity policy; readiness never upgrades or invents
    // severity and never reinterpretes semantic evidence.
    if (this.deps.localIntelligence) {
      try {
        const overview = await this.deps.localIntelligence({
          project,
          workspace,
        });
        const failedChecks = overview.checks.filter((check) => !check.passed);
        const blocking = failedChecks.find((check) => check.severity === 'Blocking');
        const warnings = failedChecks.filter((check) => check.severity === 'Warning');
        if (blocking) {
          findings.push({
            code: 'TECHNICAL_BLOCKING_CHECK',
            severity: 'BLOCKER',
            title: blocking.label,
            detail: blocking.detail,
            evidence: `check=${blocking.key}`,
            sourceAuthority: 'TECHNICAL_VERIFICATION',
            recommendedTarget: 'technical-check',
          });
        }
        for (const warning of warnings) {
          findings.push({
            code: 'TECHNICAL_WARNING_CHECK',
            severity: 'WARNING',
            title: warning.label,
            detail: warning.detail,
            evidence: `check=${warning.key}`,
            sourceAuthority: 'TECHNICAL_VERIFICATION',
            recommendedTarget: 'technical-check',
          });
        }
      } catch {
        findings.push({
          code: 'TECHNICAL_CHECK_UNAVAILABLE',
          severity: 'WARNING',
          title: 'Technical verification could not be evaluated',
          detail:
            'The existing Technical Check authority was unavailable during this readiness run. Run Technical Check before Issue.',
          evidence: 'localIntelligenceUnavailable',
          sourceAuthority: 'TECHNICAL_VERIFICATION',
          recommendedTarget: 'technical-check',
        });
      }
    }

    // D. PROJECT ACTIONS
    const openBlocking = workspace.actions.filter((action) =>
      actionBlocksIssue(action.status, action.blocksIssue === true),
    );
    if (openBlocking.length > 0) {
      findings.push({
        code: 'ACTION_BLOCKS_ISSUE',
        severity: 'BLOCKER',
        title: `${openBlocking.length} open Action(s) block Issue`,
        detail: openBlocking
          .slice(0, 5)
          .map((action) => action.title)
          .join('; '),
        evidence: `openBlockingActions=${openBlocking.length}`,
        sourceAuthority: 'ACTIONS',
        recommendedTarget: 'actions',
      });
    }
    const openNonBlockingHigh = workspace.actions.filter(
      (action) =>
        action.status !== 'Completed' &&
        action.status !== 'Cancelled' &&
        action.blocksIssue !== true &&
        action.priority === 'High',
    );
    if (openNonBlockingHigh.length > 0) {
      findings.push({
        code: 'ACTION_OPEN_NON_BLOCKING',
        severity: 'WARNING',
        title: `${openNonBlockingHigh.length} high-priority open Action(s)`,
        detail: 'Open non-blocking Actions do not block Issue but may indicate open work.',
        evidence: `openHighActions=${openNonBlockingHigh.length}`,
        sourceAuthority: 'ACTIONS',
        recommendedTarget: 'actions',
      });
    }

    // E. SOURCE FRESHNESS — only when storage is connected (else MISSING/UNAVAILABLE already surfaced).
    let staleSources = 0;
    if (storageConnected && revision) {
      const sources = this.deps.sourceStore.listSourceFiles(project.id);
      const workspaceRoot = this.deps.personalStore.getWorkspace(project.id).folderPath;
      for (const source of sources) {
        const baseline = this.deps.sourceStore.getBaseline(project.id, source.id, revisionId);
        if (!workspaceRoot) {
          findings.push({
            code: 'SOURCES_UNAVAILABLE',
            severity: 'BLOCKER',
            title: 'Controlled sources are unavailable',
            detail: 'The Project folder is not connected, so source freshness cannot be proven.',
            evidence: 'workspaceFolderPath=null',
            sourceAuthority: 'SOURCES',
            recommendedTarget: 'files',
          });
          continue;
        }
        const absolute = path.resolve(workspaceRoot, source.originalRelativeLocator);
        if (
          !existsSync(absolute) ||
          !lstatSync(absolute).isFile() ||
          lstatSync(absolute).isSymbolicLink()
        ) {
          findings.push({
            code: 'SOURCE_MISSING',
            severity: 'BLOCKER',
            title: `Controlled source is missing: ${source.displayName}`,
            detail: 'The registered source file cannot be resolved in the verified Project root.',
            evidence: `source=${source.originalRelativeLocator}`,
            sourceAuthority: 'SOURCES',
            recommendedTarget: 'files',
          });
          continue;
        }
        const currentHash = await sha256File(absolute);
        if (baseline) {
          if (currentHash !== baseline.sha256) {
            staleSources += 1;
            findings.push({
              code: 'SOURCE_STALE',
              severity: 'BLOCKER',
              title: `Controlled source changed: ${source.displayName}`,
              detail:
                'The source file no longer matches the Revision baseline. Refresh the source or capture a new baseline.',
              evidence: `source=${source.originalRelativeLocator}`,
              sourceAuthority: 'SOURCES',
              recommendedTarget: 'files',
            });
          } else {
            const sameHash = source.latestHash === currentHash;
            if (!sameHash) {
              const at = this.now();
              // Keep the persisted fingerprint honest after an on-demand check.
              this.deps.sourceStore.updateSourceFingerprint({
                projectId: project.id,
                sourceId: source.id,
                sha256: currentHash,
                sizeBytes: lstatSync(absolute).size,
                modifiedAt: lstatSync(absolute).mtime.toISOString(),
                checkedAt: at,
                expectedRowVersion: source.rowVersion,
              });
            }
          }
        } else {
          findings.push({
            code: 'SOURCE_NOT_BASELINED',
            severity: 'WARNING',
            title: `Controlled source has no baseline: ${source.displayName}`,
            detail: 'Capture a Source Baseline for this Revision to prove freshness for Issue.',
            evidence: `source=${source.originalRelativeLocator}`,
            sourceAuthority: 'SOURCES',
            recommendedTarget: 'files',
          });
        }
      }
    }

    // F. AUTOMATION / ISSUE WORKFLOW — Phase 4 authority (existing checks only).
    // The Phase 4 package gate remains authoritative at Issue time; readiness
    // surfaces its Warning-policy signals but never guesses stronger severity.

    // G. ASSETS / DOCUMENT INTEGRITY — existing P5C signals only, surfaced above.

    const counts = {
      blockers: findings.filter((finding) => finding.severity === 'BLOCKER').length,
      warnings: findings.filter((finding) => finding.severity === 'WARNING').length,
      info: findings.filter((finding) => finding.severity === 'INFO').length,
      openBlockingActions: openBlocking.length,
      staleSources,
      totalLuminaireChanges: revision ? this.changeCountFor(revision) : 0,
    };

    const level: ReadinessLevel =
      counts.blockers > 0 ? 'NOT_READY' : counts.warnings > 0 ? 'READY_WITH_WARNINGS' : 'READY';

    return {
      projectId: project.id,
      revisionId,
      revisionLabel: revision?.revisionLabel ?? '',
      level,
      findings,
      counts,
      checkedAt: this.now(),
    };
  }

  private changeCountFor(revision: CanonicalRevisionRecord): number {
    // No from-revision available here; the summary strip's totalLuminaireChanges
    // is only meaningful in comparison context. Return snapshot count as a
    // bounded proxy for "composition size".
    return revision.luminaireSnapshot?.length ?? 0;
  }

  // =======================================================================
  // Shared helpers
  // =======================================================================

  private resolveRevisionAuthorized(
    projectId: string,
    revisionId: string,
  ): CanonicalRevisionRecord {
    if (!this.deps.registry) {
      throw new DomainError('CONFLICT', 'Canonical Revision authority is unavailable.', 503);
    }
    const revision = this.deps.registry.getRevision(revisionId);
    if (revision.projectId !== projectId) {
      throw new DomainError('NOT_FOUND', 'Canonical Revision not found.', 404);
    }
    return revision;
  }

  private async verifiedProjectRoot(project: Project): Promise<string> {
    const health = await this.deps.storageHealth(project);
    if (health.state !== 'CONNECTED' || !health.canonicalPath) {
      throw new DomainError(
        'CONFLICT',
        'This file operation requires a connected, verified Project folder.',
        409,
        { storageState: health.state },
      );
    }
    return health.canonicalPath;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}
