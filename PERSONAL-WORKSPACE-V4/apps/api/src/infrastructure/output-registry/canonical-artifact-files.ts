import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
  stat,
  realpath,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { DomainError, type CanonicalOutputRecord } from '@scli/domain';

export type ArtifactPathKind = 'MISSING' | 'FILE' | 'DIRECTORY' | 'OTHER';
const canonicalArtifactIdentity =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function artifactIdentity(value: string, label: string): string {
  if (!canonicalArtifactIdentity.test(value)) {
    throw new DomainError('VALIDATION_ERROR', `${label} requires a canonical UUID.`, 400);
  }
  return value.toLowerCase();
}

export async function artifactPathKind(candidate: string): Promise<ArtifactPathKind> {
  try {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) return 'OTHER';
    if (stats.isFile()) return 'FILE';
    if (stats.isDirectory()) return 'DIRECTORY';
    return 'OTHER';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'MISSING';
    throw error;
  }
}

export function resolveCanonicalArtifactPath(projectRoot: string, locator: string): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...locator.split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'A canonical artifact locator resolved outside its Project root.',
      400,
    );
  }
  return target;
}

/** Read immutable, server-owned bytes only inside the verified project root. */
export async function readVerifiedCanonicalArtifact(
  projectRoot: string,
  locator: string,
  hash: string | null,
) {
  const target = resolveCanonicalArtifactPath(projectRoot, locator);
  const [root, canonical, info] = await Promise.all([
    realpath(projectRoot),
    realpath(target),
    lstat(target),
  ]);
  const relative = path.relative(root, canonical);
  if (
    !hash ||
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 50_000_000
  ) {
    throw new DomainError(
      'CONFLICT',
      'The registered artifact is outside its verified storage or unavailable.',
      409,
    );
  }
  const bytes = await readFile(canonical);
  if (bytes.length > 50_000_000 || createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new DomainError('CONFLICT', 'The file no longer matches its registered snapshot.', 409);
  return { root, canonical, bytes };
}

export interface CanonicalArtifactPresence {
  /** Authoritative physical-artifact truth derived from the filesystem. */
  presence: 'Present' | 'Missing' | 'Unavailable';
  /**
   * Safe project-scoped open path. Present ONLY when presence === 'Present'.
   * Never exposes raw filesystem internals for a missing/unavailable artifact.
   */
  openPath: string | null;
}

/**
 * The single canonical artifact-presence authority. Reused by the Revisions &
 * Outputs read projection AND the Schedule/BOQ read authority so a FINALIZED
 * output is only ever labelled Present when its physical file truly exists.
 *
 * - Present: safe project-scoped locator + physical FILE exists.
 * - Missing: safe project-scoped locator + physical file does NOT exist.
 * - Unavailable: no safe/usable artifact locator authority (e.g. legacy
 *   absolute/unknown locator that cannot be scoped to the project root).
 *
 * FAILED_RECOVERABLE must remain lifecycle truth and is never inferred Present
 * here — presence is computed purely from locator + filesystem; callers that
 * need lifecycle-sensitive semantics combine this with lifecycle themselves.
 */
export async function resolveCanonicalArtifactPresence(
  projectRoot: string | null,
  output: Pick<CanonicalOutputRecord, 'locatorKind' | 'locatorValue'>,
): Promise<CanonicalArtifactPresence> {
  if (!projectRoot || output.locatorKind !== 'PROJECT_RELATIVE' || !output.locatorValue) {
    return { presence: 'Unavailable', openPath: null };
  }
  let artifact: string;
  try {
    artifact = resolveCanonicalArtifactPath(projectRoot, output.locatorValue);
  } catch {
    // Unsafe / escaping locator — treat as unavailable, never open it.
    return { presence: 'Unavailable', openPath: null };
  }
  let kind: ArtifactPathKind;
  try {
    kind = await artifactPathKind(artifact);
  } catch {
    return { presence: 'Unavailable', openPath: null };
  }
  if (kind === 'FILE') return { presence: 'Present', openPath: artifact };
  if (kind === 'MISSING') return { presence: 'Missing', openPath: null };
  return { presence: 'Unavailable', openPath: null };
}

export function outputTemporaryPath(finalPath: string, outputId: string): string {
  return path.join(
    path.dirname(finalPath),
    `.${path.basename(finalPath)}.${artifactIdentity(outputId, 'Output identity')}.scli-tmp`,
  );
}

export function revisionRenderTemporaryPath(projectRoot: string, revisionId: string): string {
  return path.join(
    path.resolve(projectRoot),
    `.scli-render-${artifactIdentity(revisionId, 'Revision identity')}.tmp`,
  );
}

export function packageStagingPath(finalFolder: string, packageId: string): string {
  return path.join(
    path.dirname(finalFolder),
    `.scli-package-${artifactIdentity(packageId, 'Package identity')}.tmp`,
  );
}

export function packageArtifactTemporaryPath(finalPath: string, packageId: string): string {
  return `${finalPath}.${artifactIdentity(packageId, 'Package identity')}.scli-tmp`;
}

export async function ensureArtifactParent(targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
}

export async function assertReadableFile(filePath: string, label: string): Promise<void> {
  if ((await artifactPathKind(filePath)) !== 'FILE') {
    throw new DomainError('CONFLICT', `${label} is missing or is not a regular file.`, 409);
  }
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new DomainError('CONFLICT', `${label} cannot be read.`, 409);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  await assertReadableFile(filePath, 'Artifact');
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function copyArtifactExclusive(source: string, temporaryPath: string): Promise<void> {
  await assertReadableFile(source, 'Rendered artifact');
  await ensureArtifactParent(temporaryPath);
  try {
    await copyFile(source, temporaryPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DomainError(
        'CONFLICT',
        'An owned temporary artifact already exists and requires recovery attention.',
        409,
      );
    }
    throw error;
  }
}

/** Same-volume rename with an explicit preflight collision shield for the Windows target runtime. */
export async function moveArtifactNoReplace(
  temporaryPath: string,
  finalPath: string,
): Promise<void> {
  if ((await artifactPathKind(finalPath)) !== 'MISSING') {
    throw new DomainError(
      'CONFLICT',
      'The canonical final artifact path is already occupied.',
      409,
    );
  }
  try {
    await rename(temporaryPath, finalPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EPERM' || code === 'ENOTEMPTY') {
      throw new DomainError(
        'CONFLICT',
        'The canonical final artifact path became occupied during finalisation.',
        409,
      );
    }
    throw error;
  }
}

export function boundedArtifactFailure(error: unknown, fallback: string): string {
  const raw =
    error instanceof DomainError
      ? error.message
      : error instanceof Error
        ? error.message
        : fallback;
  const printable = [...raw]
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
  const normalized = printable.replaceAll(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 1_000);
}

export function documentSnapshotTemporaryPath(finalPath: string, deliverableId: string): string {
  return path.join(
    path.dirname(finalPath),
    `.${path.basename(finalPath)}.${artifactIdentity(deliverableId, 'Deliverable identity')}.scli-snap-tmp`,
  );
}

/**
 * Copies an immutable Document Snapshot artifact from an authorized project-local
 * source into a hidden temporary path, then verifies the copied bytes against the
 * pre-computed SHA-256 before moving it to its final project-relative location.
 * Uses exclusive copy + no-overwrite move so a snapshot never silently replaces
 * an existing artifact.
 *
 * Failure cleanup: once the temporary copy exists, any later failure (hash, stat,
 * or move/conflict) removes the temporary file before rethrowing the ORIGINAL
 * authoritative error. The original Project Document and any existing final
 * snapshot are never touched.
 */
export async function snapshotFileExclusive(
  sourcePath: string,
  finalPath: string,
  deliverableId: string,
): Promise<{ contentHash: string; sizeBytes: number }> {
  const temporaryPath = documentSnapshotTemporaryPath(finalPath, deliverableId);
  await copyArtifactExclusive(sourcePath, temporaryPath);
  try {
    const contentHash = await sha256File(temporaryPath);
    const stats = await statFile(temporaryPath);
    await moveArtifactNoReplace(temporaryPath, finalPath);
    return { contentHash, sizeBytes: stats.size };
  } catch (error) {
    // Do not mask the primary failure; clean the owned temp artifact, then rethrow.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function statFile(filePath: string): Promise<{ size: number }> {
  const stats = await stat(filePath);
  return { size: stats.size };
}
