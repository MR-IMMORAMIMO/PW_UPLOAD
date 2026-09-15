import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DomainError, type LuminaireAssetVersion } from '@scli/domain';

/** Resolve only a server-owned version beneath its verified storage root. */
export async function readLuminaireAsset(
  version: LuminaireAssetVersion,
  root: string,
  candidate: string,
) {
  const [canonicalRoot, canonical, stat] = await Promise.all([
    realpath(root),
    realpath(candidate),
    lstat(candidate),
  ]);
  const relative = path.relative(canonicalRoot, canonical);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 50_000_000
  ) {
    throw new DomainError(
      'CONFLICT',
      'The asset is outside its verified storage or unavailable.',
      409,
    );
  }
  const bytes = await readFile(canonical);
  if (version.fileHash && createHash('sha256').update(bytes).digest('hex') !== version.fileHash) {
    throw new DomainError('CONFLICT', 'The stored file no longer matches this asset version.', 409);
  }
  return { bytes, canonical, root: canonicalRoot };
}
