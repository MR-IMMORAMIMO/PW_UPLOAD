import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type CanonicalOutputRecord } from '@scli/domain';
import { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  outputTemporaryPath,
  packageStagingPath,
  resolveCanonicalArtifactPath,
  revisionRenderTemporaryPath,
  sha256File,
} from './canonical-artifact-files.js';
import {
  discardCanonicalOutputReservation,
  finalizeProvenCanonicalOutputReservation,
  isManualCompositionDraftRevision,
  isUnprovenOutputReservationLifecycle,
  proveCanonicalOutputReservation,
} from './canonical-composition-reservations.js';
import {
  canonicalPackageManifestSchema,
  legacyCanonicalPackageManifestSchema,
  type CanonicalPackageManifest,
} from './CanonicalIssuePackageService.js';

export interface CanonicalReconciliationIssue {
  readonly entityType: 'REVISION' | 'OUTPUT' | 'PACKAGE';
  readonly entityId: string;
  readonly code:
    | 'PROJECT_ROOT_MISSING'
    | 'TEMP_ARTIFACT_REMAINS'
    | 'FINAL_ARTIFACT_MISSING'
    | 'HASH_MISMATCH'
    | 'RESERVATION_DISCARDED'
    | 'RECOVERY_ATTENTION';
  readonly message: string;
}

export interface CanonicalReconciliationReport {
  finalizedOutputs: number;
  failedOutputs: number;
  /** C0 — unproven composition Output reservations safely discarded at startup. */
  discardedOutputReservations: number;
  finalizedRevisions: number;
  failedRevisions: number;
  finalizedPackages: number;
  failedPackages: number;
  issues: CanonicalReconciliationIssue[];
}

export class CanonicalArtifactReconciler {
  public constructor(
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly projectRoot: (projectId: string) => string | null,
  ) {}

  public async reconcile(): Promise<CanonicalReconciliationReport> {
    const report = {
      finalizedOutputs: 0,
      failedOutputs: 0,
      discardedOutputReservations: 0,
      finalizedRevisions: 0,
      failedRevisions: 0,
      finalizedPackages: 0,
      failedPackages: 0,
      issues: [] as CanonicalReconciliationIssue[],
    };
    await this.reconcileOutputs(report);
    await this.reconcileRevisions(report);
    await this.reconcilePackages(report);
    return report;
  }

  private async reconcileOutputs(report: CanonicalReconciliationReport): Promise<void> {
    // C0 — a MANUAL_DELIVERABLES PREPARING Revision is a long-lived composed
    // design draft, so its Outputs get composition-safe semantics instead of the
    // generated-operation recovery semantics. Captured once before any write;
    // Output reconciliation never changes Revision lifecycles.
    const compositionDrafts = new Set(
      this.registry
        .listRevisions()
        .filter((revision) => isManualCompositionDraftRevision(revision))
        .map((revision) => revision.revisionId),
    );
    for (const output of this.registry
      .listOutputs()
      .filter((item) => item.provenanceClassification === 'CANONICAL')) {
      const root = this.projectRoot(output.projectId);
      const composed = output.revisionId !== null && compositionDrafts.has(output.revisionId);
      if (!root || !output.locatorValue) {
        report.issues.push({
          entityType: 'OUTPUT',
          entityId: output.outputId,
          code: 'PROJECT_ROOT_MISSING',
          message: 'The canonical Output Project root is unavailable.',
        });
        if (output.lifecycleState === 'PREPARING' && !composed) {
          this.registry.setOutputLifecycle(
            output.outputId,
            'FAILED_RECOVERABLE',
            'Project root is unavailable during canonical Output reconciliation.',
          );
          report.failedOutputs += 1;
        }
        continue;
      }
      if (composed && isUnprovenOutputReservationLifecycle(output.lifecycleState)) {
        await this.reconcileComposedReservation(report, output, root);
        continue;
      }
      const finalPath = resolveCanonicalArtifactPath(root, output.locatorValue);
      const temporaryPath = outputTemporaryPath(finalPath, output.outputId);
      const finalKind = await artifactPathKind(finalPath);
      const temporaryKind = await artifactPathKind(temporaryPath);
      if (output.lifecycleState === 'PREPARING') {
        if (finalKind === 'FILE' && output.contentHash) {
          if ((await sha256File(finalPath)) === output.contentHash) {
            this.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
            report.finalizedOutputs += 1;
            if (temporaryKind !== 'MISSING') {
              report.issues.push({
                entityType: 'OUTPUT',
                entityId: output.outputId,
                code: 'TEMP_ARTIFACT_REMAINS',
                message: 'A proven-owned temporary Output remains after final recovery.',
              });
            }
            continue;
          }
          report.issues.push({
            entityType: 'OUTPUT',
            entityId: output.outputId,
            code: 'HASH_MISMATCH',
            message: 'A PREPARING Output final path does not match its persisted hash.',
          });
        }
        this.registry.setOutputLifecycle(
          output.outputId,
          'FAILED_RECOVERABLE',
          temporaryKind === 'MISSING'
            ? 'Canonical Output completion could not be proven after interruption.'
            : 'Owned temporary Output requires explicit recovery after interruption.',
        );
        report.failedOutputs += 1;
        if (temporaryKind !== 'MISSING') {
          report.issues.push({
            entityType: 'OUTPUT',
            entityId: output.outputId,
            code: 'TEMP_ARTIFACT_REMAINS',
            message: 'A proven-owned temporary Output remains for explicit recovery.',
          });
        }
        continue;
      }
      if (output.lifecycleState === 'FINALIZED') {
        if (finalKind !== 'FILE') {
          report.issues.push({
            entityType: 'OUTPUT',
            entityId: output.outputId,
            code: 'FINAL_ARTIFACT_MISSING',
            message: 'A finalized canonical Output artifact is missing.',
          });
        } else if (!output.contentHash || (await sha256File(finalPath)) !== output.contentHash) {
          report.issues.push({
            entityType: 'OUTPUT',
            entityId: output.outputId,
            code: 'HASH_MISMATCH',
            message: 'A finalized canonical Output artifact failed integrity validation.',
          });
        }
        continue;
      }
      if (output.lifecycleState === 'FAILED_RECOVERABLE' && temporaryKind !== 'MISSING') {
        report.issues.push({
          entityType: 'OUTPUT',
          entityId: output.outputId,
          code: 'TEMP_ARTIFACT_REMAINS',
          message: 'A proven-owned failed Output temporary artifact remains untouched.',
        });
      }
    }
  }

  /**
   * C0 — composition-safe restart semantics for ONE unproven canonical Output
   * reservation attached to a MANUAL_DELIVERABLES PREPARING Revision (R3).
   *
   *  - hash-proven final artifact  -> FINALIZE through the existing proof authority;
   *  - unproven reservation        -> DISCARD safely (owned temp sidecar only);
   *  - either way the parent Revision stays PREPARING and its DocumentSnapshots
   *    and unrelated FINALIZED Outputs are never touched.
   *
   * No PREPARING/FAILED_RECOVERABLE Output residue is left attached, because a
   * composed Revision has no output-scoped recovery handle to resolve it with.
   */
  private async reconcileComposedReservation(
    report: CanonicalReconciliationReport,
    output: CanonicalOutputRecord,
    root: string,
  ): Promise<void> {
    const proof = await proveCanonicalOutputReservation(root, output);
    if (proof.kind === 'UNPROVABLE') {
      // Without a safe locator there is neither proof nor safe disposal. Report
      // it and leave the reservation exactly as-is: PREPARING is re-evaluated on
      // the next startup, while FAILED_RECOVERABLE residue would be terminal.
      report.issues.push({
        entityType: 'OUTPUT',
        entityId: output.outputId,
        code: 'PROJECT_ROOT_MISSING',
        message:
          'A composed Revision Output reservation has no safe artifact locator and was left untouched.',
      });
      return;
    }
    if (proof.kind === 'PROVEN_FINAL') {
      finalizeProvenCanonicalOutputReservation(this.registry, output);
      report.finalizedOutputs += 1;
      if (proof.temporaryRemains) {
        report.issues.push({
          entityType: 'OUTPUT',
          entityId: output.outputId,
          code: 'TEMP_ARTIFACT_REMAINS',
          message: 'A proven-owned temporary Output remains after final recovery.',
        });
      }
      return;
    }
    await discardCanonicalOutputReservation(this.registry, output, proof);
    report.discardedOutputReservations += 1;
    report.issues.push({
      entityType: 'OUTPUT',
      entityId: output.outputId,
      code: 'RESERVATION_DISCARDED',
      message:
        proof.reason === 'FINAL_ARTIFACT_MISSING'
          ? 'An unproven composed Revision Output reservation had no final artifact and was discarded.'
          : 'An unproven composed Revision Output reservation could not claim the file at its final path and was discarded; the file was left untouched.',
    });
  }

  private async reconcileRevisions(report: CanonicalReconciliationReport): Promise<void> {
    for (const revision of this.registry
      .listRevisions()
      .filter((item) => item.provenanceClassification === 'CANONICAL')) {
      const root = this.projectRoot(revision.projectId);
      if (
        root &&
        (await artifactPathKind(revisionRenderTemporaryPath(root, revision.revisionId))) !==
          'MISSING'
      ) {
        report.issues.push({
          entityType: 'REVISION',
          entityId: revision.revisionId,
          code: 'TEMP_ARTIFACT_REMAINS',
          message: 'A proven-owned canonical renderer staging path remains untouched.',
        });
      }
      if (revision.lifecycleState !== 'PREPARING') continue;
      // F-0 — a composed MANUAL_DELIVERABLES draft is not an interrupted
      // operation. It is a legitimate long-lived design draft and MUST survive
      // application restart as PREPARING; its reservations were already
      // finalized-or-discarded above, so no impossible residue remains.
      if (isManualCompositionDraftRevision(revision)) continue;
      const outputs = this.registry.listOutputsForRevision(revision.revisionId);
      const outputsComplete =
        outputs.length > 0 && outputs.every((output) => output.lifecycleState === 'FINALIZED');
      this.registry.setRevisionLifecycle(
        revision.revisionId,
        'FAILED_RECOVERABLE',
        outputsComplete
          ? 'Canonical Outputs are complete, but aggregate completion requires an explicit identity-preserving retry.'
          : outputs.length === 0
            ? 'Interrupted canonical Revision has no complete reserved Output set.'
            : 'One or more canonical Revision Outputs require recovery attention.',
      );
      report.failedRevisions += 1;
      report.issues.push({
        entityType: 'REVISION',
        entityId: revision.revisionId,
        code: 'RECOVERY_ATTENTION',
        message: 'Canonical Revision finalisation could not be proven.',
      });
    }
  }

  private async reconcilePackages(report: CanonicalReconciliationReport): Promise<void> {
    for (const issuePackage of this.registry
      .listIssuePackages()
      .filter((item) => item.provenanceClassification === 'CANONICAL')) {
      const root = this.projectRoot(issuePackage.projectId);
      if (!root || !issuePackage.artifactLocatorValue || !issuePackage.manifestLocatorValue) {
        report.issues.push({
          entityType: 'PACKAGE',
          entityId: issuePackage.packageId,
          code: 'PROJECT_ROOT_MISSING',
          message: 'The canonical Issue Package Project root or locator is unavailable.',
        });
        if (issuePackage.lifecycleState === 'PREPARING') {
          this.registry.setPackageLifecycle(
            issuePackage.packageId,
            'FAILED_RECOVERABLE',
            'Project root or canonical locator is unavailable during Package reconciliation.',
          );
          report.failedPackages += 1;
        }
        continue;
      }
      const artifactPath = resolveCanonicalArtifactPath(root, issuePackage.artifactLocatorValue);
      const manifestPath = resolveCanonicalArtifactPath(root, issuePackage.manifestLocatorValue);
      const artifactKind = await artifactPathKind(artifactPath);
      const manifestKind = await artifactPathKind(manifestPath);
      let manifest: CanonicalPackageManifest | null = null;
      if (manifestKind === 'FILE') {
        try {
          const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: number };
          if (raw.version === 2) {
            manifest = canonicalPackageManifestSchema.parse(raw);
          } else {
            // Historical v1 Output-only manifest (pre-B2): project it through
            // the generic shape so existing finalized packages stay readable.
            const legacy = legacyCanonicalPackageManifestSchema.parse(raw);
            manifest = {
              ...legacy,
              version: 2,
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
            };
          }
          await this.validateManifest(issuePackage.packageId, root, manifest);
        } catch {
          manifest = null;
        }
      }

      if (issuePackage.lifecycleState === 'PREPARING') {
        this.registry.setPackageLifecycle(
          issuePackage.packageId,
          'FAILED_RECOVERABLE',
          manifest?.outputMode === 'Folder' &&
            artifactKind === 'DIRECTORY' &&
            manifest.packageId === issuePackage.packageId
            ? 'Final Package evidence is valid, but compatibility completion requires an explicit identity-preserving retry.'
            : 'Canonical Issue Package completion could not be proven after interruption.',
        );
        report.failedPackages += 1;
        report.issues.push({
          entityType: 'PACKAGE',
          entityId: issuePackage.packageId,
          code: 'RECOVERY_ATTENTION',
          message: 'Issue Package finalisation requires explicit recovery attention.',
        });
        await this.reportPackageTemps(report, issuePackage.packageId, artifactPath);
        continue;
      }
      if (issuePackage.lifecycleState === 'FINALIZED') {
        const expectedArtifactKind = manifest?.outputMode === 'Folder' ? 'DIRECTORY' : 'FILE';
        if (!manifest || artifactKind !== expectedArtifactKind) {
          report.issues.push({
            entityType: 'PACKAGE',
            entityId: issuePackage.packageId,
            code: 'FINAL_ARTIFACT_MISSING',
            message: 'A finalized Issue Package artifact or manifest is missing or invalid.',
          });
        }
        continue;
      }
      if (issuePackage.lifecycleState === 'FAILED_RECOVERABLE') {
        await this.reportPackageTemps(report, issuePackage.packageId, artifactPath);
      }
    }
  }

  private async reportPackageTemps(
    report: CanonicalReconciliationReport,
    packageId: string,
    artifactPath: string,
  ): Promise<void> {
    const targetFolder = artifactPath.toLowerCase().endsWith('.zip')
      ? artifactPath.slice(0, -4)
      : artifactPath;
    if ((await artifactPathKind(packageStagingPath(targetFolder, packageId))) === 'MISSING') {
      return;
    }
    report.issues.push({
      entityType: 'PACKAGE',
      entityId: packageId,
      code: 'TEMP_ARTIFACT_REMAINS',
      message: 'A proven-owned Issue Package staging folder remains untouched.',
    });
  }

  private async validateManifest(
    packageId: string,
    projectRoot: string,
    manifest: CanonicalPackageManifest,
  ): Promise<void> {
    if (manifest.packageId !== packageId) throw new Error('Package manifest identity mismatch.');
    const relations = this.registry.listPackageDeliverables(packageId);
    if (
      relations.length !== manifest.deliverables.length ||
      relations.some((relation, index) => {
        const item = manifest.deliverables[index]!;
        if (relation.sourceType !== item.sourceType) return true;
        return item.sourceType === 'GeneratedOutput'
          ? relation.sourceId !== item.outputId
          : relation.sourceId !== item.deliverableId;
      })
    ) {
      throw new Error('Package manifest Deliverable relation mismatch.');
    }
    for (const item of manifest.deliverables) {
      if (item.sourceType === 'GeneratedOutput') {
        const output: CanonicalOutputRecord = this.registry.getOutput(item.outputId);
        if (
          output.revisionId !== manifest.revisionId ||
          output.projectId !== manifest.projectId ||
          output.lifecycleState !== 'FINALIZED' ||
          output.locatorValue !== item.storedRelativeLocator ||
          output.contentHash !== item.contentHash
        ) {
          throw new Error('Package manifest canonical Output mismatch.');
        }
        const sourcePath = resolveCanonicalArtifactPath(projectRoot, item.storedRelativeLocator);
        if ((await artifactPathKind(sourcePath)) !== 'FILE') {
          throw new Error('Package source Output is missing.');
        }
        if ((await sha256File(sourcePath)) !== item.contentHash) {
          throw new Error('Package source Output hash mismatch.');
        }
      } else {
        const snapshot = this.registry.getDocumentSnapshot(item.deliverableId);
        if (
          snapshot.revisionId !== manifest.revisionId ||
          snapshot.projectId !== manifest.projectId ||
          snapshot.locatorValue !== item.storedRelativeLocator ||
          snapshot.contentHash !== item.contentHash
        ) {
          throw new Error('Package manifest canonical Document Snapshot mismatch.');
        }
        const sourcePath = resolveCanonicalArtifactPath(projectRoot, item.storedRelativeLocator);
        if ((await artifactPathKind(sourcePath)) !== 'FILE') {
          throw new Error('Package source Document Snapshot is missing.');
        }
        if ((await sha256File(sourcePath)) !== item.contentHash) {
          throw new Error('Package source Document Snapshot hash mismatch.');
        }
      }
      if (manifest.outputMode !== 'Zip') {
        // PACKAGES-E2E-04B1 — the client package folder is the canonical
        // package record's CLIENT artifact locator, never derived from the
        // manifest locator. New packages keep the manifest under
        // INTERNAL/PACKAGE_METADATA/<packageId>/, so dirname(manifestLocator)
        // would point at the internal metadata folder, not the client tree.
        const issuePackage = this.registry.getIssuePackage(packageId);
        const folder = resolveCanonicalArtifactPath(
          projectRoot,
          issuePackage.artifactLocatorValue!,
        );
        const packagedPath = path.resolve(folder, ...item.packageRelativePath.split('/'));
        const relative = path.relative(folder, packagedPath);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error('Packaged Deliverable path escaped the package folder.');
        }
        if ((await sha256File(packagedPath)) !== item.contentHash) {
          throw new Error('Packaged Deliverable hash mismatch.');
        }
      }
    }
  }
}
