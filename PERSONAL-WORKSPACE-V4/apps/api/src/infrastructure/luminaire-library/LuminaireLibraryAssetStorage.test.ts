import { mkdtemp, rm } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { LuminaireLibraryAssetStorage } from './LuminaireLibraryAssetStorage';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('explains unreadable cloud bytes without leaking a filesystem path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'library-cloud-read-'));
  roots.push(root);
  const storage = new LuminaireLibraryAssetStorage(root);
  vi.mocked(filesystem.open).mockRejectedValueOnce(
    Object.assign(new Error('cloud operation failed at private path'), { code: 'UNKNOWN' }),
  );
  await expect(
    storage.promoteProjectAsset({
      locatorKind: 'DATA_ROOT_RELATIVE',
      locatorValue: 'project/image.png',
      storedHash: null,
      assetType: 'ProductImage',
    }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    message: expect.stringContaining('Product image could not be read.'),
  });
  expect(await filesystem.readdir(root)).toEqual([]);
});
