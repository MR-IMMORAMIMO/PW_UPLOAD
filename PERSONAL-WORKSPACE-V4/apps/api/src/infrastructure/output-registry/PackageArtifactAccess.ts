import { lstat, readFile, realpath, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { DomainError } from '@scli/domain';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { canonicalPackageManifestSchema } from './CanonicalIssuePackageService.js';
import {
  readVerifiedCanonicalArtifact,
  resolveCanonicalArtifactPath,
} from './canonical-artifact-files.js';

/** Opens persisted package bytes, never mutable project sources or a renderer path. */
export class PackageArtifactAccess {
  constructor(private readonly registry: CanonicalOutputRegistryStore) {}

  async prepareOpen(
    dataRoot: string,
    projectId: string,
    packageId: string,
    root: string,
    manifestHash: string,
    memberId: string,
  ) {
    const file = await this.read(projectId, packageId, root, manifestHash, memberId);
    const authorizedProjectRoot = await realpath(dataRoot);
    // A unique managed copy preserves the saved package even if its viewer edits the file.
    const previewRoot = await mkdtemp(path.join(authorizedProjectRoot, 'package-preview-'));
    const fileName = path.basename(file.fileName).replace(/[<>:"/\\|?*]/g, '_');
    const targetPath = path.join(previewRoot, fileName);
    await writeFile(targetPath, file.bytes, { flag: 'wx' });
    return {
      authorizedProjectRoot,
      targetPath,
      fileName,
      fileHash: createHash('sha256').update(file.bytes).digest('hex'),
    };
  }

  private async bounded(root: string, locator: string, limit = 50_000_000) {
    const target = resolveCanonicalArtifactPath(root, locator);
    const [base, resolved, info] = await Promise.all([
      realpath(root),
      realpath(target),
      lstat(target),
    ]);
    const relative = path.relative(base, resolved);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative) ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > limit
    )
      throw new DomainError(
        'CONFLICT',
        'The saved package file is unavailable or exceeds the supported size.',
        409,
      );
    const bytes = await readFile(resolved);
    if (bytes.length > limit)
      throw new DomainError('CONFLICT', 'The saved package exceeds the supported size.', 409);
    return bytes;
  }

  async read(
    projectId: string,
    packageId: string,
    root: string,
    manifestHash: string,
    memberId?: string,
  ) {
    const record = this.registry.getIssuePackage(packageId);
    if (
      record.projectId !== projectId ||
      record.lifecycleState !== 'FINALIZED' ||
      record.artifactLocatorKind !== 'PROJECT_RELATIVE' ||
      record.manifestLocatorKind !== 'PROJECT_RELATIVE' ||
      !record.artifactLocatorValue ||
      !record.manifestLocatorValue
    )
      throw new DomainError('NOT_FOUND', 'A completed saved package is not available.', 404);
    const manifestBytes = await this.bounded(root, record.manifestLocatorValue, 5_000_000);
    if (createHash('sha256').update(manifestBytes).digest('hex') !== manifestHash)
      throw new DomainError('CONFLICT', 'The saved package manifest has changed.', 409);
    const manifest = canonicalPackageManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8')),
    );
    if (
      manifest.packageId !== packageId ||
      manifest.projectId !== projectId ||
      manifest.revisionId !== record.revisionId
    )
      throw new DomainError(
        'CONFLICT',
        'The package manifest does not match the selected package.',
        409,
      );
    const members = this.registry.listPackageDeliverables(packageId);
    if (
      manifest.deliverables.length !== members.length ||
      manifest.deliverables.some(
        (item) =>
          !members.some(
            (member) =>
              member.sourceType === item.sourceType &&
              member.sourceId ===
                (item.sourceType === 'DocumentSnapshot' ? item.deliverableId : item.outputId),
          ),
      )
    )
      throw new DomainError(
        'CONFLICT',
        'The package membership no longer matches its saved record.',
        409,
      );
    const member = memberId
      ? manifest.deliverables.find(
          (item) =>
            (item.sourceType === 'DocumentSnapshot' ? item.deliverableId : item.outputId) ===
            memberId,
        )
      : undefined;
    if (memberId && !member)
      throw new DomainError('NOT_FOUND', 'The file is not in this package.', 404);
    if (manifest.outputMode === 'Folder') {
      if (!member)
        throw new DomainError(
          'CONFLICT',
          'This package was saved as a folder. No ZIP was generated; open its individual files from Details.',
          409,
        );
      const file = await readVerifiedCanonicalArtifact(
        root,
        path.posix.join(
          record.artifactLocatorValue.replaceAll('\\', '/'),
          member.packageRelativePath,
        ),
        member.contentHash,
      );
      return { bytes: file.bytes, fileName: path.basename(member.packageRelativePath) };
    }
    const bytes = await this.bounded(root, record.artifactLocatorValue);
    const zip = await JSZip.loadAsync(bytes);
    const allowed = new Set(
      manifest.deliverables.map((item) => item.packageRelativePath.replaceAll('\\', '/')),
    );
    if (Object.values(zip.files).some((file) => !file.dir && !allowed.has(file.name)))
      throw new DomainError(
        'CONFLICT',
        'The archive contains files outside the saved package membership.',
        409,
      );
    let selected: Buffer | undefined;
    let total = 0;
    for (const entry of manifest.deliverables) {
      const file = zip.file(entry.packageRelativePath.replaceAll('\\', '/'));
      if (!file || entry.sizeBytes > 50_000_000)
        throw new DomainError('CONFLICT', 'A saved package member is missing or too large.', 409);
      const chunks: Buffer[] = [];
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        const stream = file.nodeStream('nodebuffer');
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.on('data', (chunk: Buffer) => {
          const part = Buffer.from(chunk);
          size += part.length;
          total += part.length;
          if (size > entry.sizeBytes || total > 100_000_000) {
            stream.pause();
            reject(
              new DomainError('CONFLICT', 'Package content size does not match its manifest.', 409),
            );
          } else chunks.push(part);
        });
      });
      const content = Buffer.concat(chunks);
      if (
        size !== entry.sizeBytes ||
        createHash('sha256').update(content).digest('hex') !== entry.contentHash
      )
        throw new DomainError('CONFLICT', 'A saved package file has changed since creation.', 409);
      if (entry === member) selected = content;
    }
    return member
      ? { bytes: selected!, fileName: path.basename(member.packageRelativePath) }
      : { bytes, fileName: path.basename(record.artifactLocatorValue) };
  }
}
