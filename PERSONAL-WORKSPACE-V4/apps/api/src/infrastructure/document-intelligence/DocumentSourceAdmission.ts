import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DOCUMENT_INTELLIGENCE_LIMITS, DomainError } from '@scli/domain';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdmittedDocumentBytes {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalFileName: string;
  readonly managedLocator: string;
  readonly absolutePath: string;
  readonly reusedExistingBytes: boolean;
}

function safePdfName(input: string): string {
  const base = path
    .basename(input)
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .trim();
  if (!base || path.extname(base).toLocaleLowerCase('en') !== '.pdf') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Document Intelligence accepts PDF files only.',
      400,
      {
        reasonCode: 'DOCUMENT_SOURCE_TYPE_UNSUPPORTED',
      },
    );
  }
  return base.slice(0, 260);
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

function validatePdfBytes(buffer: Buffer): void {
  if (buffer.byteLength === 0 || buffer.byteLength > DOCUMENT_INTELLIGENCE_LIMITS.pdfBytes) {
    throw new DomainError('VALIDATION_ERROR', 'The selected PDF is empty or exceeds 50 MiB.', 400, {
      reasonCode: 'DOCUMENT_TOO_LARGE',
      maximumBytes: DOCUMENT_INTELLIGENCE_LIMITS.pdfBytes,
    });
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The selected file does not have a valid PDF signature.',
      400,
      { reasonCode: 'PDF_SIGNATURE_MISMATCH' },
    );
  }
}

export class DocumentSourceAdmission {
  public readonly root: string;
  private readonly stagingRoot: string;
  private readonly objectRoot: string;

  public constructor(dataRoot: string) {
    this.root = path.join(dataRoot, 'document-store');
    this.stagingRoot = path.join(this.root, 'staging');
    this.objectRoot = path.join(this.root, 'objects');
    mkdirSync(this.stagingRoot, { recursive: true });
    mkdirSync(this.objectRoot, { recursive: true });
  }

  public prepareDesktopInbox(admissionId: string): string {
    if (!UUID.test(admissionId)) {
      throw new DomainError('VALIDATION_ERROR', 'A valid admission is required.', 400);
    }
    const inbox = path.join(this.stagingRoot, admissionId, 'desktop-inbox');
    mkdirSync(inbox, { recursive: true });
    const metadata = lstatSync(inbox);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || readdirSync(inbox).length > 0) {
      throw new DomainError('CONFLICT', 'The document selection inbox is unavailable.', 409);
    }
    return inbox;
  }

  public copyEligibleDesktopSource(sourcePath: string, inboxPath: string): void {
    const originalFileName = safePdfName(sourcePath);
    if (!path.isAbsolute(sourcePath)) {
      throw new DomainError('VALIDATION_ERROR', 'The selected PDF is invalid.', 400);
    }
    const metadata = lstatSync(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      realpathSync.native(sourcePath).toLowerCase() !== path.resolve(sourcePath).toLowerCase()
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected PDF must be a regular local file.',
        400,
      );
    }
    if (metadata.size > DOCUMENT_INTELLIGENCE_LIMITS.pdfBytes) {
      throw new DomainError('VALIDATION_ERROR', 'The selected PDF exceeds 50 MiB.', 400, {
        reasonCode: 'DOCUMENT_TOO_LARGE',
      });
    }
    copyFileSync(sourcePath, path.join(inboxPath, originalFileName), 1);
  }

  public admitDesktopSelection(admissionId: string): AdmittedDocumentBytes {
    const inbox = path.join(this.stagingRoot, admissionId, 'desktop-inbox');
    if (!existsSync(inbox)) {
      throw new DomainError('CONFLICT', 'No selected PDF is ready.', 409);
    }
    const entries = readdirSync(inbox, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]!.isFile()) {
      throw new DomainError(
        'CONFLICT',
        'Document selection must contain exactly one regular PDF.',
        409,
      );
    }
    return this.admitFile(path.join(inbox, entries[0]!.name), entries[0]!.name, admissionId);
  }

  public admitBuffer(
    buffer: Buffer,
    originalFileName: string,
    admissionId = randomUUID(),
  ): AdmittedDocumentBytes {
    const safeName = safePdfName(originalFileName);
    validatePdfBytes(buffer);
    const directory = path.join(this.stagingRoot, admissionId);
    mkdirSync(directory, { recursive: true });
    const staged = path.join(directory, `source-${randomUUID()}.pdf`);
    const descriptor = openSync(staged, 'wx', 0o600);
    try {
      writeFileSync(descriptor, buffer);
    } finally {
      closeSync(descriptor);
    }
    return this.finalize(staged, safeName, admissionId, buffer);
  }

  public resolveManagedLocator(locator: string): string {
    if (path.isAbsolute(locator) || locator.includes('\0')) {
      throw new DomainError('CONFLICT', 'Document source locator is invalid.', 409);
    }
    const candidate = path.resolve(this.root, locator);
    if (!inside(path.resolve(this.root), candidate) || !existsSync(candidate)) {
      throw new DomainError('NOT_FOUND', 'Document source bytes are unavailable.', 404);
    }
    const metadata = lstatSync(candidate);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !inside(realpathSync.native(this.root), realpathSync.native(candidate))
    ) {
      throw new DomainError('CONFLICT', 'Document source integrity check failed.', 409);
    }
    return candidate;
  }

  public reconcileStaging(knownAdmissionIds: ReadonlySet<string>, now = new Date()): number {
    let removed = 0;
    for (const entry of readdirSync(this.stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !UUID.test(entry.name) || knownAdmissionIds.has(entry.name)) {
        continue;
      }
      const candidate = path.join(this.stagingRoot, entry.name);
      const metadata = lstatSync(candidate);
      if (metadata.isSymbolicLink() || now.getTime() - metadata.mtimeMs < 24 * 60 * 60 * 1_000) {
        continue;
      }
      rmSync(candidate, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  private admitFile(
    candidate: string,
    displayName: string,
    admissionId: string,
  ): AdmittedDocumentBytes {
    const requested = path.resolve(candidate);
    const canonicalStaging = realpathSync.native(this.stagingRoot);
    const metadata = lstatSync(requested);
    if (
      !inside(path.resolve(this.stagingRoot), requested) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      !inside(canonicalStaging, realpathSync.native(requested))
    ) {
      throw new DomainError('VALIDATION_ERROR', 'The selected PDF staging entry is invalid.', 400);
    }
    const before = metadata.size;
    const buffer = readFileSync(requested);
    if (before !== statSync(requested).size || before !== buffer.byteLength) {
      throw new DomainError('CONFLICT', 'The selected PDF changed during admission.', 409);
    }
    validatePdfBytes(buffer);
    return this.finalize(requested, safePdfName(displayName), admissionId, buffer);
  }

  private finalize(
    stagedPath: string,
    originalFileName: string,
    admissionId: string,
    buffer: Buffer,
  ): AdmittedDocumentBytes {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const directory = path.join(this.objectRoot, sha256.slice(0, 2));
    mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${sha256}.pdf`);
    let reusedExistingBytes = existsSync(target);
    if (!reusedExistingBytes) {
      try {
        // COPYFILE_EXCL is the cross-platform no-replace boundary. A concurrent
        // admission may win this race, in which case its immutable object is
        // verified below before the task-owned staging file is removed.
        copyFileSync(stagedPath, target, 1);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        reusedExistingBytes = true;
      }
    }
    if (reusedExistingBytes) {
      const existing = readFileSync(target);
      if (
        existing.byteLength !== buffer.byteLength ||
        createHash('sha256').update(existing).digest('hex') !== sha256
      ) {
        throw new DomainError('CONFLICT', 'Managed document hash collision was refused.', 409);
      }
    }
    rmSync(stagedPath, { force: true });
    const admissionRoot = path.join(this.stagingRoot, admissionId);
    if (inside(path.resolve(this.stagingRoot), path.resolve(admissionRoot))) {
      rmSync(admissionRoot, { recursive: true, force: true });
    }
    return {
      sha256,
      sizeBytes: buffer.byteLength,
      originalFileName,
      managedLocator: path.relative(this.root, target).replaceAll('\\', '/'),
      absolutePath: target,
      reusedExistingBytes,
    };
  }
}
