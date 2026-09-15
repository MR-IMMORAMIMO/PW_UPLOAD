import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export interface ManagedAssetRoot {
  key: string;
  absolutePath: string;
}

export interface ManagedAssetManifestEntry {
  rootKey: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ManagedAssetManifest {
  version: 1;
  roots: string[];
  files: ManagedAssetManifestEntry[];
}

export interface ManagedAssetSnapshotMetadata {
  directory: 'managed-assets';
  manifestFilename: 'managed-assets-manifest.json';
  manifestSha256: string;
  fileCount: number;
  totalSizeBytes: number;
}

export interface PreparedManagedAssetRestore {
  commit(): void;
  rollback(): void;
  cleanup(): void;
}

const MANAGED_DIRECTORY = 'managed-assets';
const MANIFEST_FILENAME = 'managed-assets-manifest.json';

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertRootKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) {
    throw new Error('Managed asset root key is invalid.');
  }
}

function forwardSlash(value: string): string {
  return value.split(path.sep).join('/');
}

function contained(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root).toLocaleLowerCase('en');
  const normalized = path.resolve(candidate).toLocaleLowerCase('en');
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}${path.sep}`);
}

function collectFiles(root: ManagedAssetRoot, current: string, output: string[]): void {
  if (!existsSync(current)) return;
  const info = lstatSync(current);
  if (info.isSymbolicLink()) throw new Error('Managed asset snapshots do not follow links.');
  if (info.isFile()) {
    output.push(current);
    return;
  }
  if (!info.isDirectory()) throw new Error('Managed asset roots may contain only regular files.');
  const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const child = path.join(current, entry.name);
    if (!contained(root.absolutePath, child))
      throw new Error('Managed asset path escaped its root.');
    collectFiles(root, child, output);
  }
}

export function createManagedAssetSnapshot(
  stagingDirectory: string,
  roots: readonly ManagedAssetRoot[],
): ManagedAssetSnapshotMetadata {
  const managedDirectory = path.join(stagingDirectory, MANAGED_DIRECTORY);
  mkdirSync(managedDirectory, { recursive: false });
  const manifest: ManagedAssetManifest = { version: 1, roots: [], files: [] };
  for (const root of roots) {
    assertRootKey(root.key);
    if (manifest.roots.includes(root.key))
      throw new Error('Managed asset root keys must be unique.');
    manifest.roots.push(root.key);
    const destinationRoot = path.join(managedDirectory, root.key);
    mkdirSync(destinationRoot, { recursive: false });
    const files: string[] = [];
    collectFiles(root, root.absolutePath, files);
    for (const source of files) {
      const relativePath = path.relative(root.absolutePath, source);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error('Managed asset relative path is invalid.');
      }
      const destination = path.join(destinationRoot, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      const sourceSize = statSync(source).size;
      const destinationSize = statSync(destination).size;
      if (sourceSize !== destinationSize)
        throw new Error('Managed asset size changed during backup.');
      manifest.files.push({
        rootKey: root.key,
        relativePath: forwardSlash(relativePath),
        sizeBytes: destinationSize,
        sha256: hashFile(destination),
      });
    }
  }
  manifest.roots.sort();
  manifest.files.sort((left, right) =>
    `${left.rootKey}/${left.relativePath}`.localeCompare(`${right.rootKey}/${right.relativePath}`),
  );
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(stagingDirectory, MANIFEST_FILENAME);
  writeFileSync(manifestPath, manifestText, { flag: 'wx' });
  return {
    directory: MANAGED_DIRECTORY,
    manifestFilename: MANIFEST_FILENAME,
    manifestSha256: hashText(manifestText),
    fileCount: manifest.files.length,
    totalSizeBytes: manifest.files.reduce((sum, item) => sum + item.sizeBytes, 0),
  };
}

function readManifest(
  backupDirectory: string,
  metadata: ManagedAssetSnapshotMetadata,
): ManagedAssetManifest {
  const manifestPath = path.join(backupDirectory, metadata.manifestFilename);
  const text = readFileSync(manifestPath, 'utf8');
  if (hashText(text) !== metadata.manifestSha256) {
    throw new Error('Managed asset manifest hash does not match backup metadata.');
  }
  const value = JSON.parse(text) as ManagedAssetManifest;
  if (value.version !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.files)) {
    throw new Error('Managed asset manifest is invalid.');
  }
  return value;
}

export function verifyManagedAssetSnapshot(
  backupDirectory: string,
  metadata: ManagedAssetSnapshotMetadata,
): ManagedAssetManifest {
  const manifest = readManifest(backupDirectory, metadata);
  if (manifest.files.length !== metadata.fileCount) {
    throw new Error('Managed asset file count does not match backup metadata.');
  }
  let total = 0;
  for (const entry of manifest.files) {
    assertRootKey(entry.rootKey);
    if (!manifest.roots.includes(entry.rootKey))
      throw new Error('Managed asset root is undeclared.');
    const root = path.join(backupDirectory, metadata.directory, entry.rootKey);
    const candidate = path.resolve(root, ...entry.relativePath.split('/'));
    if (!contained(root, candidate))
      throw new Error('Managed asset manifest path escapes its root.');
    const info = lstatSync(candidate);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('Managed asset backup entry is not a regular file.');
    }
    if (info.size !== entry.sizeBytes || hashFile(candidate) !== entry.sha256) {
      throw new Error('Managed asset backup entry failed SHA-256 verification.');
    }
    total += info.size;
  }
  if (total !== metadata.totalSizeBytes) {
    throw new Error('Managed asset byte total does not match backup metadata.');
  }
  return manifest;
}

export function prepareManagedAssetRestore(input: {
  backupDirectory: string;
  metadata: ManagedAssetSnapshotMetadata;
  roots: readonly ManagedAssetRoot[];
  restoreId: string;
}): PreparedManagedAssetRestore {
  const manifest = verifyManagedAssetSnapshot(input.backupDirectory, input.metadata);
  const rootsByKey = new Map(input.roots.map((root) => [root.key, root]));
  if (
    manifest.roots.some((key) => !rootsByKey.has(key)) ||
    rootsByKey.size !== manifest.roots.length
  ) {
    throw new Error('Configured managed asset roots do not match the backup manifest.');
  }
  const prepared = input.roots.map((root) => {
    const parent = path.dirname(root.absolutePath);
    mkdirSync(parent, { recursive: true });
    const staging = path.join(
      parent,
      `.${path.basename(root.absolutePath)}.${input.restoreId}.staging`,
    );
    const rollback = path.join(
      parent,
      `.${path.basename(root.absolutePath)}.${input.restoreId}.rollback`,
    );
    if (existsSync(staging) || existsSync(rollback))
      throw new Error('Managed asset restore path collision.');
    mkdirSync(staging);
    return { root, staging, rollback, hadOriginal: existsSync(root.absolutePath), swapped: false };
  });
  try {
    for (const item of prepared) {
      const sourceRoot = path.join(input.backupDirectory, input.metadata.directory, item.root.key);
      const entries = manifest.files.filter((entry) => entry.rootKey === item.root.key);
      for (const entry of entries) {
        const source = path.resolve(sourceRoot, ...entry.relativePath.split('/'));
        const destination = path.resolve(item.staging, ...entry.relativePath.split('/'));
        if (!contained(sourceRoot, source) || !contained(item.staging, destination)) {
          throw new Error('Managed asset restore path escaped its root.');
        }
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(source, destination, constants.COPYFILE_EXCL);
        if (
          statSync(destination).size !== entry.sizeBytes ||
          hashFile(destination) !== entry.sha256
        ) {
          throw new Error('Managed asset restore staging verification failed.');
        }
      }
    }
  } catch (error) {
    for (const item of prepared) rmSync(item.staging, { recursive: true, force: true });
    throw error;
  }

  const rollback = (): void => {
    for (const item of [...prepared].reverse()) {
      if (item.swapped && existsSync(item.root.absolutePath)) {
        rmSync(item.root.absolutePath, { recursive: true, force: true });
      }
      if (item.hadOriginal && existsSync(item.rollback))
        renameSync(item.rollback, item.root.absolutePath);
      item.swapped = false;
      rmSync(item.staging, { recursive: true, force: true });
    }
  };
  return {
    commit(): void {
      try {
        for (const item of prepared) {
          if (item.hadOriginal) renameSync(item.root.absolutePath, item.rollback);
          renameSync(item.staging, item.root.absolutePath);
          item.swapped = true;
        }
      } catch (error) {
        rollback();
        throw error;
      }
    },
    rollback,
    cleanup(): void {
      for (const item of prepared) {
        rmSync(item.rollback, { recursive: true, force: true });
        rmSync(item.staging, { recursive: true, force: true });
      }
    },
  };
}
