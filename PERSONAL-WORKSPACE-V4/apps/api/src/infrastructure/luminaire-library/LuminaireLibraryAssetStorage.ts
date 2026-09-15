import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import type { LuminaireLibraryAssetType } from '@scli/domain';
import { DomainError } from '@scli/domain';

const admission: Readonly<
  Record<
    LuminaireLibraryAssetType,
    {
      extensions: readonly string[];
      mime: Readonly<Record<string, string>>;
      maxBytes: number;
    }
  >
> = {
  ProductImage: {
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    mime: {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    },
    maxBytes: 25 * 1024 * 1024,
  },
  Datasheet: {
    extensions: ['.pdf'],
    mime: { '.pdf': 'application/pdf' },
    maxBytes: 50 * 1024 * 1024,
  },
  IES: { extensions: ['.ies'], mime: { '.ies': 'application/ies' }, maxBytes: 25 * 1024 * 1024 },
  LDT: { extensions: ['.ldt'], mime: { '.ldt': 'application/ldt' }, maxBytes: 25 * 1024 * 1024 },
};

export interface ManagedAssetWrite {
  assetVersionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  locatorValue: string;
  absolutePath: string;
  cleanup(): Promise<void>;
}

export interface LegacyProjectDatasheetInspection {
  sourcePath: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  contentHash: string;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLocaleLowerCase('en') === path.resolve(right).toLocaleLowerCase('en');
}

function safeFileName(value: string): string {
  const normalized = path
    .basename(value)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*]/g, '_');
  const name = Array.from(normalized, (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  )
    .join('')
    .replace(/[ .]+$/g, '')
    .slice(0, 180);
  if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new DomainError('VALIDATION_ERROR', 'The selected asset filename is not safe.', 400);
  }
  return name;
}

async function sha256(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let bytesRead: number;
    do {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, position));
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function relativeLocator(...parts: string[]): string {
  return parts.join('/');
}

export class LuminaireLibraryAssetStorage {
  private readonly libraryRoot: string;
  private readonly projectRoot: string;
  private readonly stagingRoot: string;

  public constructor(private readonly dataRoot: string) {
    this.libraryRoot = path.join(dataRoot, 'luminaire-library', 'assets');
    this.projectRoot = path.join(dataRoot, 'project-luminaire-assets');
    this.stagingRoot = path.join(dataRoot, '.luminaire-asset-staging');
  }

  public async admitLibraryAsset(
    sourcePath: string,
    type: LuminaireLibraryAssetType,
    assetVersionId: string = randomUUID(),
  ): Promise<ManagedAssetWrite> {
    return this.admitAsset(
      sourcePath,
      type,
      ['luminaire-library', 'assets', assetVersionId],
      assetVersionId,
    );
  }

  public async admitProjectAsset(input: {
    sourcePath: string;
    assetType: LuminaireLibraryAssetType;
    projectId: string;
    luminaireId: string;
    projectAssetVersionId?: string | undefined;
  }): Promise<ManagedAssetWrite> {
    const id = input.projectAssetVersionId ?? randomUUID();
    return this.admitAsset(
      input.sourcePath,
      input.assetType,
      ['project-luminaire-assets', input.projectId, input.luminaireId, id],
      id,
    );
  }

  private async admitAsset(
    sourcePath: string,
    type: LuminaireLibraryAssetType,
    locatorParts: string[],
    assetVersionId: string,
  ): Promise<ManagedAssetWrite> {
    const resolved = await realpath(sourcePath);
    const sourceStat = await stat(resolved);
    if (!sourceStat.isFile())
      throw new DomainError('VALIDATION_ERROR', 'Asset source must be a regular file.', 400);
    const fileName = safeFileName(resolved);
    const extension = path.extname(fileName).toLocaleLowerCase('en');
    const rule = admission[type];
    if (!rule.extensions.includes(extension))
      throw new DomainError('VALIDATION_ERROR', `${type} file type is not supported.`, 400);
    if (sourceStat.size > rule.maxBytes)
      throw new DomainError('VALIDATION_ERROR', `${type} exceeds the managed size limit.`, 400);
    return this.copyManaged(
      resolved,
      fileName,
      rule.mime[extension]!,
      sourceStat.size,
      locatorParts,
      assetVersionId,
    );
  }

  public async copyLibraryAssetToProject(input: {
    locatorValue: string;
    projectId: string;
    luminaireId: string;
    projectAssetVersionId?: string | undefined;
  }): Promise<ManagedAssetWrite> {
    const source = this.resolveLocator(input.locatorValue);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile())
      throw new DomainError('CONFLICT', 'Published Library asset bytes are unavailable.', 409);
    const fileName = safeFileName(source);
    const extension = path.extname(fileName).toLocaleLowerCase('en');
    const mimeType = Object.values(admission)
      .map((item) => item.mime[extension])
      .find(Boolean);
    if (!mimeType)
      throw new DomainError(
        'CONFLICT',
        'Published Library asset type is no longer admissible.',
        409,
      );
    const id = input.projectAssetVersionId ?? randomUUID();
    return this.copyManaged(
      source,
      fileName,
      mimeType,
      sourceStat.size,
      ['project-luminaire-assets', input.projectId, input.luminaireId, id],
      id,
    );
  }

  /**
   * Read-only validation of the exact legacy path already owned by a persisted
   * Luminaire AssetVersion. Callers must never populate sourcePath from a request.
   */
  public async inspectLegacyProjectDatasheet(input: {
    sourcePath: string;
    storedHash: string | null;
  }): Promise<LegacyProjectDatasheetInspection> {
    const resolved = path.resolve(input.sourcePath);
    let metadata;
    try {
      metadata = await lstat(resolved);
    } catch {
      throw new DomainError('NOT_FOUND', 'SOURCE_FILE_MISSING', 404);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new DomainError('VALIDATION_ERROR', 'PDF_VALIDATION_FAILED', 400);
    }
    const canonical = await realpath(resolved);
    if (!samePath(canonical, resolved)) {
      throw new DomainError('VALIDATION_ERROR', 'PDF_VALIDATION_FAILED', 400);
    }
    const fileName = safeFileName(canonical);
    if (path.extname(fileName).toLocaleLowerCase('en') !== '.pdf') {
      throw new DomainError('VALIDATION_ERROR', 'PDF_VALIDATION_FAILED', 400);
    }
    const rule = admission.Datasheet;
    if (metadata.size <= 0 || metadata.size > rule.maxBytes) {
      throw new DomainError('VALIDATION_ERROR', 'PDF_VALIDATION_FAILED', 400);
    }
    const magic = (await readFile(canonical)).subarray(0, 5).toString('ascii');
    if (magic !== '%PDF-') {
      throw new DomainError('VALIDATION_ERROR', 'PDF_VALIDATION_FAILED', 400);
    }
    const contentHash = await sha256(canonical);
    if (input.storedHash && contentHash !== input.storedHash.toLocaleLowerCase('en')) {
      throw new DomainError('CONFLICT', 'SOURCE_HASH_MISMATCH', 409);
    }
    return {
      sourcePath: canonical,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: metadata.size,
      contentHash,
    };
  }

  public async adoptLegacyProjectDatasheet(input: {
    sourcePath: string;
    storedHash: string | null;
    projectId: string;
    luminaireId: string;
    projectAssetVersionId: string;
  }): Promise<ManagedAssetWrite> {
    const before = await this.inspectLegacyProjectDatasheet(input);
    const managed = await this.copyManaged(
      before.sourcePath,
      before.fileName,
      before.mimeType,
      before.sizeBytes,
      ['project-luminaire-assets', input.projectId, input.luminaireId, input.projectAssetVersionId],
      input.projectAssetVersionId,
    );
    try {
      const after = await this.inspectLegacyProjectDatasheet(input);
      if (
        after.sizeBytes !== before.sizeBytes ||
        after.contentHash !== before.contentHash ||
        managed.sizeBytes !== before.sizeBytes ||
        managed.contentHash !== before.contentHash
      ) {
        throw new DomainError('CONFLICT', 'SOURCE_HASH_MISMATCH', 409);
      }
      return managed;
    } catch (error) {
      await managed.cleanup();
      throw error;
    }
  }

  public async promoteProjectAsset(input: {
    locatorKind: 'LEGACY_PATH' | 'DATA_ROOT_RELATIVE';
    locatorValue: string;
    storedHash: string | null;
    assetType: LuminaireLibraryAssetType;
    libraryAssetVersionId?: string | undefined;
  }): Promise<ManagedAssetWrite> {
    let source: string;
    let beforeHash: string;
    try {
      source =
        input.locatorKind === 'DATA_ROOT_RELATIVE'
          ? this.resolveLocator(input.locatorValue)
          : await realpath(input.locatorValue);
      // Metadata can exist for a cloud placeholder whose bytes cannot be read.
      beforeHash = await sha256(source);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (!(error instanceof Error) || !('code' in error)) throw error;
      const label = input.assetType === 'ProductImage' ? 'Product image' : input.assetType;
      throw new DomainError(
        'CONFLICT',
        `${label} could not be read. Make the attached file available on this device (for OneDrive, choose "Always keep on this device"), or reattach it in Datasheets & Images, then retry Create Draft. No Library Draft was created.`,
        409,
      );
    }
    if (input.storedHash && beforeHash !== input.storedHash.toLocaleLowerCase('en')) {
      throw new DomainError(
        'CONFLICT',
        `${input.assetType} source bytes do not match the stored Project asset hash.`,
        409,
      );
    }
    const managed = await this.admitLibraryAsset(
      source,
      input.assetType,
      input.libraryAssetVersionId,
    );
    try {
      const afterHash = await sha256(source);
      if (beforeHash !== managed.contentHash || beforeHash !== afterHash) {
        throw new DomainError(
          'CONFLICT',
          `${input.assetType} source bytes changed while creating the Library Draft.`,
          409,
        );
      }
      return managed;
    } catch (error) {
      await managed.cleanup();
      throw error;
    }
  }

  public resolveLocator(locatorValue: string): string {
    const candidate = path.resolve(this.dataRoot, ...locatorValue.split('/'));
    const root = path.resolve(this.dataRoot);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Managed asset locator escapes the data root.',
        400,
      );
    }
    return candidate;
  }

  public roots(): readonly string[] {
    return [this.libraryRoot, this.projectRoot];
  }

  public async reconcileOrphans(
    knownLibraryAssetVersionIds: ReadonlySet<string>,
  ): Promise<string[]> {
    await mkdir(this.libraryRoot, { recursive: true });
    const entries = await readdir(this.libraryRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !knownLibraryAssetVersionIds.has(entry.name))
      .map((entry) => path.join(this.libraryRoot, entry.name));
  }

  private async copyManaged(
    source: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    locatorParts: string[],
    id: string,
  ): Promise<ManagedAssetWrite> {
    const stagingDirectory = path.join(this.stagingRoot, `${id}-${randomUUID()}`);
    const stagingFile = path.join(stagingDirectory, fileName);
    const finalDirectory = path.resolve(this.dataRoot, ...locatorParts);
    const finalFile = path.join(finalDirectory, fileName);
    await mkdir(this.stagingRoot, { recursive: true });
    await mkdir(stagingDirectory, { recursive: false });
    try {
      await copyFile(source, stagingFile, constants.COPYFILE_EXCL);
      const copiedStat = await stat(stagingFile);
      if (copiedStat.size !== sizeBytes)
        throw new DomainError('CONFLICT', 'Asset size changed while copying.', 409);
      const contentHash = await sha256(stagingFile);
      await mkdir(path.dirname(finalDirectory), { recursive: true });
      await mkdir(finalDirectory, { recursive: false });
      try {
        await rename(stagingFile, finalFile);
      } catch (error) {
        await rm(finalDirectory, { recursive: true, force: true });
        throw error;
      }
      await rm(stagingDirectory, { recursive: true, force: true });
      return {
        assetVersionId: id,
        fileName,
        mimeType,
        sizeBytes,
        contentHash,
        locatorValue: relativeLocator(...locatorParts, fileName),
        absolutePath: finalFile,
        cleanup: async () => rm(finalDirectory, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  }
}
