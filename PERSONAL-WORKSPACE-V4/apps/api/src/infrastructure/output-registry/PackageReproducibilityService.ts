import { readFile } from 'node:fs/promises';
import type {
  DeliverableVerificationResult,
  PackageDeliverableSourceType,
  PackageVerificationResult,
  PackageVerificationStatus,
} from '@scli/domain';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import {
  artifactPathKind,
  resolveCanonicalArtifactPath,
  sha256File,
  type ArtifactPathKind,
} from './canonical-artifact-files.js';
import {
  canonicalPackageManifestSchema,
  type CanonicalPackageManifest,
} from './CanonicalIssuePackageService.js';

/** Worst-first ordering for aggregating a package from its deliverables. */
const severityRank: Record<PackageVerificationStatus, number> = {
  MISMATCH: 0,
  MISSING: 1,
  UNAVAILABLE: 2,
  VERIFIED: 3,
};

function worstStatus(statuses: readonly PackageVerificationStatus[]): PackageVerificationStatus {
  return (
    [...statuses].sort((left, right) => severityRank[left] - severityRank[right])[0] ?? 'VERIFIED'
  );
}

function verifiedStatus(
  expectedHash: string | null,
  actualHash: string | null | undefined,
): DeliverableVerificationResult['status'] {
  if (!expectedHash) return 'UNAVAILABLE';
  if (!actualHash) return 'UNAVAILABLE';
  return actualHash === expectedHash ? 'VERIFIED' : 'MISMATCH';
}

/**
 * REV-02A2 — read-only, on-demand package reproducibility verification.
 *
 * Answers "can this exact historical package still be reproduced?" by checking,
 * WITHOUT any mutation:
 *   - package manifest identity and presence,
 *   - canonical membership (from the immutable manifest),
 *   - stored canonical artifact bytes (source Output / Document Snapshot), and
 *   - the packaged copy bytes (Folder output mode).
 *
 * It NEVER sets package/revision/output lifecycle, never marks
 * FAILED_RECOVERABLE, never rewrites a manifest, never repairs/copies/deletes a
 * file, never updates a DB timestamp, and never persists the result. It only
 * reports truth.
 *
 * The canonical Artifact Reconciler is deliberately NOT used: it mutates
 * lifecycle state and is forbidden from the GET path.
 */
export class PackageReproducibilityService {
  public constructor(
    private readonly registry: CanonicalOutputRegistryStore,
    private readonly projectRoot: (projectId: string) => string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Verifies one canonical Issue Package of a project. The caller must have
   * already authorized the project; this method additionally confirms the
   * package belongs to that project and returns `null` when it does not, so
   * there is no global verify-by-package-UUID surface.
   */
  public async verify(
    projectId: string,
    packageId: string,
  ): Promise<PackageVerificationResult | null> {
    let issuePackage;
    try {
      issuePackage = this.registry.getIssuePackage(packageId);
    } catch {
      return null;
    }
    if (issuePackage.projectId !== projectId) return null;
    const root = this.projectRoot(projectId);
    if (!root || !issuePackage.artifactLocatorValue || !issuePackage.manifestLocatorValue) {
      return this.unavailableProject(packageId);
    }

    const artifactPath = resolveCanonicalArtifactPath(root, issuePackage.artifactLocatorValue);
    const manifestPath = resolveCanonicalArtifactPath(root, issuePackage.manifestLocatorValue);
    const artifactKind = await artifactPathKind(artifactPath);
    const manifestKind = await artifactPathKind(manifestPath);

    // Package-level manifest identity.
    const manifest = await this.readManifest(manifestPath);
    const packageStatus = this.deriveStatus(
      issuePackage.packageId,
      manifest,
      artifactKind,
      manifestKind,
    );

    // Per-deliverable checks.
    const deliverables: DeliverableVerificationResult[] = [];
    const canonicalFolder = issuePackage.artifactLocatorValue.toLowerCase().endsWith('.zip')
      ? null
      : artifactPath;
    if (manifest) {
      for (const member of manifest.deliverables) {
        deliverables.push(await this.verifyDeliverable(root, canonicalFolder, member));
      }
    }

    const allStatuses = [packageStatus, ...deliverables.map((d) => d.status)];
    return {
      packageId: issuePackage.packageId,
      status: worstStatus(allStatuses),
      checkedAt: this.now().toISOString(),
      deliverables,
    };
  }

  private async readManifest(manifestPath: string): Promise<CanonicalPackageManifest | null> {
    if ((await artifactPathKind(manifestPath)) !== 'FILE') return null;
    try {
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: number };
      if (raw.version === 2) return canonicalPackageManifestSchema.parse(raw);
      return null;
    } catch {
      return null;
    }
  }

  private deriveStatus(
    packageId: string,
    manifest: CanonicalPackageManifest | null,
    artifactKind: ArtifactPathKind,
    manifestKind: ArtifactPathKind,
  ): PackageVerificationStatus {
    if (!manifest) return manifestKind === 'FILE' ? 'MISMATCH' : 'MISSING';
    if (manifest.packageId !== packageId) return 'MISMATCH';
    if (manifestKind !== 'FILE') return 'MISSING';
    const expectedArtifactKind: ArtifactPathKind =
      manifest.outputMode === 'Folder' ? 'DIRECTORY' : 'FILE';
    if (artifactKind !== expectedArtifactKind) return 'MISSING';
    return 'VERIFIED';
  }

  private async verifyDeliverable(
    root: string,
    canonicalFolder: string | null,
    member: CanonicalPackageManifest['deliverables'][number],
  ): Promise<DeliverableVerificationResult> {
    const sourceType: PackageDeliverableSourceType = member.sourceType;
    const sourceId =
      member.sourceType === 'GeneratedOutput' ? member.outputId : member.deliverableId;
    const expectedHash = member.contentHash;

    // Stored canonical artifact bytes (the immutable source of truth).
    let storedStatus: PackageVerificationStatus;
    let storedActualHash: string | undefined;
    let storedReason: string | undefined;
    try {
      const storedPath = resolveCanonicalArtifactPath(root, member.storedRelativeLocator);
      const storedKind = await artifactPathKind(storedPath);
      if (storedKind === 'MISSING') {
        storedStatus = 'MISSING';
        storedReason = 'Stored canonical artifact is missing.';
      } else if (storedKind !== 'FILE') {
        storedStatus = 'UNAVAILABLE';
        storedReason = 'Stored canonical artifact is not a regular file.';
      } else {
        storedActualHash = await sha256File(storedPath);
        storedStatus = verifiedStatus(expectedHash, storedActualHash);
        if (storedStatus === 'MISMATCH')
          storedReason = 'Stored canonical artifact bytes differ from the immutable hash.';
      }
    } catch {
      storedStatus = 'UNAVAILABLE';
      storedReason = 'Stored canonical artifact could not be read.';
    }

    // Packaged copy (Folder output mode only).
    let packagedStatus: PackageVerificationStatus | null = null;
    let packagedActualHash: string | undefined;
    let packagedReason: string | undefined;
    if (canonicalFolder) {
      try {
        const packagedPath = resolveCanonicalArtifactPath(
          canonicalFolder,
          member.packageRelativePath,
        );
        const packagedKind = await artifactPathKind(packagedPath);
        if (packagedKind === 'MISSING') {
          packagedStatus = 'MISSING';
          packagedReason = 'Packaged copy is missing.';
        } else if (packagedKind !== 'FILE') {
          packagedStatus = 'UNAVAILABLE';
          packagedReason = 'Packaged copy is not a regular file.';
        } else {
          packagedActualHash = await sha256File(packagedPath);
          packagedStatus = verifiedStatus(expectedHash, packagedActualHash);
          if (packagedStatus === 'MISMATCH') {
            packagedReason = 'Packaged copy bytes differ from the immutable hash.';
          }
        }
      } catch {
        packagedStatus = 'UNAVAILABLE';
        packagedReason = 'Packaged copy could not be read.';
      }
    }

    const status =
      packagedStatus === null ? storedStatus : worstStatus([storedStatus, packagedStatus]);
    const reason = status === 'VERIFIED' ? undefined : (packagedReason ?? storedReason);

    // Report the bytes of the artifact that actually failed. When the packaged
    // copy differs that is the misleading truth; otherwise report the stored
    // canonical artifact bytes.
    const failingHash = packagedStatus === 'MISMATCH' ? packagedActualHash : storedActualHash;

    return {
      sourceType,
      sourceId,
      status,
      expectedHash,
      ...(failingHash !== undefined ? { actualHash: failingHash } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  private unavailableProject(packageId: string): PackageVerificationResult {
    return {
      packageId,
      status: 'UNAVAILABLE',
      checkedAt: this.now().toISOString(),
      deliverables: [],
    };
  }
}
