import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DomainError } from '@scli/domain';
import { IMPORT_SOURCE_LIMITS } from './ImportAdapterRegistry.js';

export const IMPORT_SOURCE_EXTENSIONS = Object.freeze(['.csv', '.tsv', '.xlsx'] as const);
const EXPLICITLY_REJECTED_EXTENSIONS = new Set(['.xls', '.xlsb', '.xlsm', '.ods', '.pdf', '.zip']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdmittedImportSource {
  displayFileName: string;
  extension: '.csv' | '.tsv' | '.xlsx';
  sha256: string;
  sizeBytes: number;
  buffer: Buffer;
  stagedPath: string;
}

function safeFileName(fileName: string): string {
  const normalized = path
    .basename(fileName)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*]/g, '_');
  const base = Array.from(normalized)
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .trim();
  if (!base || base === '.' || base === '..') return `import-${randomUUID()}.csv`;
  return base.slice(0, 220);
}

function extensionFor(fileName: string): '.csv' | '.tsv' | '.xlsx' {
  const extension = path.extname(fileName).toLocaleLowerCase('en');
  if (
    EXPLICITLY_REJECTED_EXTENSIONS.has(extension) ||
    !IMPORT_SOURCE_EXTENSIONS.includes(extension as never)
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Smart Import accepts only CSV, TSV, or XLSX sources.',
      400,
      {
        reasonCode: 'IMPORT_SOURCE_TYPE_UNSUPPORTED',
      },
    );
  }
  return extension as '.csv' | '.tsv' | '.xlsx';
}

function sourceLimit(extension: '.csv' | '.tsv' | '.xlsx'): number {
  return extension === '.xlsx' ? IMPORT_SOURCE_LIMITS.xlsxBytes : IMPORT_SOURCE_LIMITS.csvBytes;
}

function ensureSize(extension: '.csv' | '.tsv' | '.xlsx', sizeBytes: number): void {
  if (sizeBytes <= 0)
    throw new DomainError('VALIDATION_ERROR', 'The selected import source is empty.', 400);
  if (sizeBytes > sourceLimit(extension)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `The ${extension.slice(1).toUpperCase()} source exceeds its size limit.`,
      400,
      {
        reasonCode: 'IMPORT_SOURCE_OVERSIZE',
        maximumBytes: sourceLimit(extension),
      },
    );
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export class ImportSourceAdmission {
  public readonly stageRoot: string;
  private readonly canonicalStageRoot: string;

  public constructor(dataRoot: string) {
    this.stageRoot = path.join(dataRoot, 'import-stage');
    mkdirSync(this.stageRoot, { recursive: true });
    this.canonicalStageRoot = realpathSync.native(this.stageRoot);
  }

  public cleanupOrphans(now = new Date()): number {
    let removed = 0;
    for (const entry of readdirSync(this.stageRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const candidate = path.join(this.stageRoot, entry.name);
      const metadata = lstatSync(candidate);
      if (metadata.isSymbolicLink() || now.getTime() - metadata.mtimeMs < 24 * 60 * 60 * 1_000)
        continue;
      rmSync(candidate, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  public prepareDesktopInbox(importSessionId: string): string {
    if (!UUID.test(importSessionId))
      throw new DomainError('VALIDATION_ERROR', 'A valid Import Session is required.', 400);
    const inbox = path.join(this.stageRoot, importSessionId, 'desktop-inbox');
    mkdirSync(inbox, { recursive: true });
    const metadata = lstatSync(inbox);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DomainError('CONFLICT', 'The Import Session staging area is unavailable.', 409);
    }
    if (readdirSync(inbox).length > 0) {
      throw new DomainError('CONFLICT', 'This Import Session already has a staged source.', 409);
    }
    return inbox;
  }

  public stageBuffer(
    importSessionId: string,
    fileName: string,
    buffer: Buffer,
  ): AdmittedImportSource {
    const displayFileName = safeFileName(fileName);
    const extension = extensionFor(displayFileName);
    ensureSize(extension, buffer.byteLength);
    const directory = path.join(this.stageRoot, importSessionId);
    mkdirSync(directory, { recursive: true });
    const stagedPath = path.join(directory, `source-${randomUUID()}${extension}`);
    writeFileSync(stagedPath, buffer, { flag: 'wx', mode: 0o600 });
    return this.readAndValidate(stagedPath, displayFileName);
  }

  public admitDesktopSelection(importSessionId: string): AdmittedImportSource {
    const inbox = path.join(this.stageRoot, importSessionId, 'desktop-inbox');
    if (!existsSync(inbox))
      throw new DomainError('CONFLICT', 'No Desktop import source is ready.', 409);
    const entries = readdirSync(inbox, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]!.isFile()) {
      throw new DomainError(
        'CONFLICT',
        'Desktop source selection must contain exactly one regular file.',
        409,
      );
    }
    return this.readAndValidate(path.join(inbox, entries[0]!.name), entries[0]!.name);
  }

  public copyEligibleDesktopSource(sourcePath: string, inboxPath: string): void {
    const displayFileName = safeFileName(sourcePath);
    const extension = extensionFor(displayFileName);
    const metadata = lstatSync(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      realpathSync.native(sourcePath).toLowerCase() !== path.resolve(sourcePath).toLowerCase()
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected import source is not an eligible regular file.',
        400,
      );
    }
    ensureSize(extension, metadata.size);
    copyFileSync(sourcePath, path.join(inboxPath, displayFileName));
  }

  public removeStagedSource(source: AdmittedImportSource): void {
    const sessionDirectory = path.dirname(
      path.basename(path.dirname(source.stagedPath)) === 'desktop-inbox'
        ? path.dirname(source.stagedPath)
        : source.stagedPath,
    );
    const resolved = path.resolve(sessionDirectory);
    if (!inside(path.resolve(this.stageRoot), resolved)) {
      throw new DomainError('CONFLICT', 'Import staging cleanup was refused.', 409);
    }
    rmSync(resolved, { recursive: true, force: true });
  }

  private readAndValidate(candidate: string, displayFileName: string): AdmittedImportSource {
    const requested = path.resolve(candidate);
    if (!inside(path.resolve(this.stageRoot), requested))
      throw new DomainError('VALIDATION_ERROR', 'The staged source is invalid.', 400);
    const metadata = lstatSync(requested);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected file could not be prepared for import.',
        400,
        { reasonCode: 'IMPORT_STAGED_SOURCE_NOT_REGULAR' },
      );
    }
    const canonicalCandidate = realpathSync.native(requested);
    if (!inside(this.canonicalStageRoot, canonicalCandidate))
      throw new DomainError('VALIDATION_ERROR', 'The staged source is invalid.', 400);
    const extension = extensionFor(displayFileName);
    ensureSize(extension, metadata.size);
    const buffer = readFileSync(requested);
    if (buffer.byteLength !== statSync(requested).size)
      throw new DomainError('CONFLICT', 'The source changed during admission.', 409);
    return {
      displayFileName: safeFileName(displayFileName),
      extension,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.byteLength,
      buffer,
      stagedPath: requested,
    };
  }
}
