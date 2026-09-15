import path from 'node:path';
import { DomainError } from '@scli/domain';
import type { P4bCapturePolicy } from './CapturePolicy.js';

const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_UNSAFE = /[<>:"/\\|?*]/g;

export interface CaptureNameInput {
  projectCode: string;
  revisionLabel: string | null;
  policy: P4bCapturePolicy;
  matchedExtension: string;
}

export class CaptureNamingService {
  public canonicalFileName(input: CaptureNameInput, suffix = 1): string {
    const projectCode = this.safeSegment(input.projectCode);
    const revision =
      input.policy.level === 'REVISION' ? this.safeSegment(input.revisionLabel ?? '') : '';
    if (input.policy.level === 'REVISION' && !revision) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Revision-bound capture naming requires a label.',
        400,
      );
    }
    const extension = input.matchedExtension.toLowerCase();
    if (!input.policy.extensions.includes(extension)) {
      throw new DomainError('VALIDATION_ERROR', 'Capture extension is not allowed by policy.', 400);
    }
    const suffixToken = suffix <= 1 ? '' : `_A${String(suffix).padStart(2, '0')}`;
    const stem =
      input.policy.level === 'REVISION'
        ? `${projectCode}_${input.policy.namingToken}_${revision}${suffixToken}`
        : `${projectCode}_${input.policy.namingToken}${suffixToken}`;
    const fileName = `${stem}${extension}`;
    if (fileName.length > 120) {
      throw new DomainError(
        'CONFLICT',
        'DESTINATION_PATH_TOO_LONG: the canonical capture file segment exceeds 120 characters.',
        409,
      );
    }
    return fileName;
  }

  public safeSegment(value: string): string {
    let normalized = value
      .normalize('NFC')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(WINDOWS_UNSAFE, '_')
      .replace(/[\s_]+/g, '_')
      .replace(/[. ]+$/g, '')
      .replace(/^[_ ]+|[_ ]+$/g, '');
    if (normalized === '.' || normalized === '..') normalized = '';
    if (RESERVED_DEVICE.test(normalized)) normalized = `_${normalized}`;
    return normalized;
  }

  public assertReliableAbsolutePath(filePath: string): void {
    if (!path.isAbsolute(filePath) || filePath.includes('\0') || filePath.length > 240) {
      throw new DomainError(
        'CONFLICT',
        'DESTINATION_PATH_TOO_LONG: the capture destination is outside the reliable Windows/tool path envelope.',
        409,
      );
    }
  }
}
