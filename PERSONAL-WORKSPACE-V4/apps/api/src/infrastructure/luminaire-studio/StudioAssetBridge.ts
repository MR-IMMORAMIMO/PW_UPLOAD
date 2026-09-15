import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StudioDocument } from '@scli/contracts';
import { DomainError } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage.js';

type Managed = Awaited<ReturnType<LuminaireLibraryAssetStorage['admitProjectAsset']>>;
export type StudioPreparedAsset = {
  clientId: string;
  type: 'ProductImage' | 'Datasheet';
  managed: Managed;
};

export class StudioAssetBridge {
  constructor(
    private readonly personal: PersonalWorkspaceStore,
    private readonly storage: LuminaireLibraryAssetStorage,
    private readonly dataRoot: string,
  ) {}

  public async hydrate(
    document: StudioDocument,
    verifiedProjectRoot: string | null,
  ): Promise<void> {
    for (const row of document.luminaires) {
      const versions = this.personal.listLuminaireAssetVersions(
        document.id,
        row.id,
        'ProductImage',
      );
      const latest = versions[0];
      if (!latest || !['image/png', 'image/jpeg'].includes(latest.mimeType)) continue;
      try {
        const approved =
          latest.locatorKind === 'DATA_ROOT_RELATIVE' ? this.dataRoot : verifiedProjectRoot;
        if (!approved) continue;
        const file =
          latest.locatorKind === 'DATA_ROOT_RELATIVE'
            ? this.storage.resolveLocator(latest.locatorValue ?? '')
            : latest.filePath;
        const [root, canonical, stat] = await Promise.all([
          realpath(approved),
          realpath(file),
          lstat(file),
        ]);
        if (
          !canonical.startsWith(root + path.sep) ||
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > 5_000_000
        )
          continue;
        const bytes = await readFile(canonical);
        if (latest.fileHash && createHash('sha256').update(bytes).digest('hex') !== latest.fileHash)
          continue;
        row.image = `data:${latest.mimeType};base64,${bytes.toString('base64')}`;
      } catch {
        /* An unavailable historical image must not erase its reference. */
      }
    }
  }

  public async prepare(
    document: Pick<StudioDocument, 'id' | 'luminaires'>,
  ): Promise<StudioPreparedAsset[]> {
    const prepared: StudioPreparedAsset[] = [];
    const scratch = await mkdtemp(path.join(tmpdir(), 'scli-studio-assets-'));
    try {
      const existing = new Set(
        this.personal.getWorkspace(document.id).luminaires.map((row) => row.id),
      );
      for (const row of document.luminaires) {
        const attachment =
          row.attachment && typeof row.attachment === 'object' && !Array.isArray(row.attachment)
            ? row.attachment
            : null;
        for (const [type, raw] of [
          ['ProductImage', row.image],
          ['Datasheet', attachment?.data],
        ] as const) {
          if (typeof raw !== 'string' || !raw) continue;
          const match = raw.match(
            /^data:(image\/(?:png|jpeg)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/,
          );
          if (!match || (type === 'ProductImage') !== match[1]!.startsWith('image/'))
            throw new DomainError(
              'VALIDATION_ERROR',
              'Studio attachments must be uploaded PNG, JPEG or PDF files.',
              400,
            );
          const bytes = Buffer.from(match[2]!, 'base64');
          if (bytes.length > 25_000_000)
            throw new DomainError('VALIDATION_ERROR', 'Studio attachment exceeds 25 MB.', 400);
          const signature =
            match[1] === 'image/png'
              ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : match[1] === 'image/jpeg'
                ? bytes[0] === 255 && bytes[1] === 216
                : bytes.subarray(0, 5).toString() === '%PDF-';
          if (!signature)
            throw new DomainError(
              'VALIDATION_ERROR',
              'Studio attachment content does not match its file type.',
              400,
            );
          const current = existing.has(row.id)
            ? this.personal.listLuminaireAssetVersions(document.id, row.id, type)[0]
            : null;
          if (current?.fileHash === createHash('sha256').update(bytes).digest('hex')) continue;
          const sourcePath = path.join(
            scratch,
            `${row.id}-${type}.${match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'pdf'}`,
          );
          await writeFile(sourcePath, bytes, { flag: 'wx' });
          prepared.push({
            clientId: row.id,
            type,
            managed: await this.storage.admitProjectAsset({
              projectId: document.id,
              luminaireId: row.id,
              assetType: type,
              sourcePath,
            }),
          });
        }
      }
      return prepared;
    } catch (error) {
      await Promise.all(prepared.map((item) => item.managed.cleanup()));
      throw error;
    } finally {
      if (
        path.resolve(scratch).startsWith(path.resolve(tmpdir()) + path.sep + 'scli-studio-assets-')
      )
        await rm(scratch, { recursive: true, force: true });
    }
  }
}
