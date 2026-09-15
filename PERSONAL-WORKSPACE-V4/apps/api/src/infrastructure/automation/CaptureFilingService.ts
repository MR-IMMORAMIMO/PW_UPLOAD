import { constants, createReadStream } from 'node:fs';
import { access, copyFile, link, lstat, rm, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DomainError } from '@scli/domain';
import { CaptureNamingService } from './CaptureNamingService.js';
import type { CaptureDestinationPlan } from './CaptureDestinationResolver.js';
import type { P4bCapturePolicy } from './CapturePolicy.js';

export interface CaptureFilingInput {
  captureId: string;
  stagedPath: string;
  contentHash: string;
  sizeBytes: number;
  matchedExtension: string;
  policy: P4bCapturePolicy;
  initialPlan: CaptureDestinationPlan;
  revalidate: () => Promise<CaptureDestinationPlan>;
  beforeFinalMutation: (relativeLocator: string) => Promise<void> | void;
}

export interface CaptureFilingResult {
  relativeLocator: string;
  absolutePath: string;
  reusedExisting: boolean;
}

export class CaptureFilingService {
  public constructor(private readonly naming = new CaptureNamingService()) {}

  public async file(input: CaptureFilingInput): Promise<CaptureFilingResult> {
    await this.assertDestinationFolder(input.initialPlan.destinationAbsoluteFolder);
    const tempPath = path.join(
      input.initialPlan.destinationAbsoluteFolder,
      `.scli-capture-${input.captureId}.route-tmp`,
    );
    this.naming.assertReliableAbsolutePath(tempPath);
    const retainedTemp = await existingFileProof(tempPath);
    if (
      retainedTemp !== null &&
      (retainedTemp.size !== input.sizeBytes || retainedTemp.hash !== input.contentHash)
    ) {
      await rm(tempPath, { force: true });
    }
    if (
      retainedTemp === null ||
      retainedTemp.size !== input.sizeBytes ||
      retainedTemp.hash !== input.contentHash
    ) {
      await copyFile(input.stagedPath, tempPath, constants.COPYFILE_EXCL);
    }
    const tempStat = await stat(tempPath);
    const tempHash = await hashFile(tempPath);
    if (tempStat.size !== input.sizeBytes || tempHash !== input.contentHash) {
      await rm(tempPath, { force: true });
      throw new DomainError('CONFLICT', 'DESTINATION_COPY_HASH_MISMATCH', 409);
    }

    try {
      const refreshed = await input.revalidate();
      if (
        refreshed.verifiedRoot.toLowerCase() !== input.initialPlan.verifiedRoot.toLowerCase() ||
        refreshed.destinationFolderId !== input.initialPlan.destinationFolderId ||
        refreshed.destinationAbsoluteFolder.toLowerCase() !==
          input.initialPlan.destinationAbsoluteFolder.toLowerCase()
      ) {
        throw new DomainError('CONFLICT', 'PROJECT_ROOT_OR_MAPPING_CHANGED', 409);
      }

      for (let suffix = 1; suffix <= 999; suffix += 1) {
        const fileName = this.naming.canonicalFileName(
          {
            projectCode: refreshed.project.projectCode,
            revisionLabel: refreshed.revision?.revisionLabel ?? null,
            policy: input.policy,
            matchedExtension: input.matchedExtension,
          },
          suffix,
        );
        const absolutePath = path.join(refreshed.destinationAbsoluteFolder, fileName);
        this.naming.assertReliableAbsolutePath(absolutePath);
        const relativeLocator = path
          .join(refreshed.destinationRelativeFolder, fileName)
          .replaceAll('\\', '/');
        const existing = await existingFileHash(absolutePath);
        if (existing !== null) {
          if (existing === input.contentHash) {
            await input.beforeFinalMutation(relativeLocator);
            await rm(tempPath, { force: true });
            return { relativeLocator, absolutePath, reusedExisting: true };
          }
          continue;
        }

        await input.beforeFinalMutation(relativeLocator);
        try {
          // Atomic no-replace finalization. A hard link is used because Node's
          // POSIX rename may overwrite; link creation fails when the final name
          // already exists and is equivalent to Windows no-replace rename.
          await link(tempPath, absolutePath);
          await unlink(tempPath);
          return { relativeLocator, absolutePath, reusedExisting: false };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw error;
        }
      }
      throw new DomainError('CONFLICT', 'CAPTURE_NAME_COLLISION_LIMIT', 409);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async assertDestinationFolder(folder: string): Promise<void> {
    const metadata = await lstat(folder);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DomainError('CONFLICT', 'DESTINATION_FOLDER_UNAVAILABLE', 409);
    }
    await access(folder, constants.W_OK);
  }
}

async function existingFileProof(filePath: string): Promise<{ hash: string; size: number } | null> {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      await rm(filePath, { force: true });
      return null;
    }
    return { hash: await hashFile(filePath), size: metadata.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function existingFileHash(filePath: string): Promise<string | null> {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return '__COLLISION__';
    return hashFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
