import { DomainError } from './errors';

const unsafeProjectCharacters = /[^A-Z0-9]+/g;

/**
 * Canonical company/project prefix used for every NEW project reference.
 * Historical projects keep their legacy SCLI prefix and are never rewritten.
 */
export const CURRENT_PROJECT_PREFIX = 'SCT';

/** Legacy prefix accepted by parsers for historical projects. */
export const LEGACY_PROJECT_PREFIX = 'SCLI';

const currentReferenceFormat = /^(\d{3,4})_(SCT)(\d{6})_([A-Z0-9_]+)$/;
const reservedWindowsDeviceNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])([._]|$)/i;

function isValidDateCode(value: string): boolean {
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validate a user-supplied target reference for the controlled project-reference update.
 *
 * The target must follow the current supported convention
 * NNN_SCTYYMMDD_PROJECT_NAME. SCLI targets are intentionally rejected because the
 * current convention is SCT; historical SCLI projects are never rewritten
 * automatically and may only be converted through an explicit controlled update.
 *
 * Returns the canonical uppercase form of the reference.
 */
export function validateProjectReferenceInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DomainError('VALIDATION_ERROR', 'A project reference is required.', 400);
  }
  if (trimmed.length > 80) {
    throw new DomainError('VALIDATION_ERROR', 'The project reference is too long.', 400);
  }
  if ([...trimmed].some((character) => character.charCodeAt(0) < 32)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project reference contains invalid characters.',
      400,
    );
  }
  if (trimmed.includes('\\') || trimmed.includes('/') || trimmed.includes('..')) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project reference cannot contain path separators or traversal.',
      400,
    );
  }
  const code = trimmed.toUpperCase();
  const match = currentReferenceFormat.exec(code);
  if (!match) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project reference must use the NNN_SCTYYMMDD_PROJECT_NAME format, for example 019_SCT251204_GEVI_SHARJAH.',
      400,
    );
  }
  const sequence = Number(match[1]);
  if (sequence < 1) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project sequence must be a positive number.',
      400,
    );
  }
  if (!isValidDateCode(match[3]!)) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project reference contains an invalid date code.',
      400,
    );
  }
  const nameSegment = match[4]!;
  if (
    nameSegment.startsWith('_') ||
    nameSegment.endsWith('_') ||
    nameSegment.includes('__') ||
    reservedWindowsDeviceNames.test(nameSegment)
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'The project name segment contains characters or spacing that are not allowed.',
      400,
    );
  }
  return code;
}

export function sanitizeProjectName(projectName: string): string {
  const normalized = projectName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(unsafeProjectCharacters, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || 'PROJECT';
}

function datePartsInTimezone(date: Date, timezone: string): { yy: string; mm: string; dd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { yy: value('year'), mm: value('month'), dd: value('day') };
}

export function formatProjectCode(
  sequence: number,
  createdAt: Date,
  projectName: string,
  timezone = 'Asia/Dubai',
  maxLength = 80,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('Project sequence must be a positive safe integer.');
  }
  const number = String(sequence).padStart(3, '0');
  const { yy, mm, dd } = datePartsInTimezone(createdAt, timezone);
  const prefix = `${number}_${CURRENT_PROJECT_PREFIX}${yy}${mm}${dd}_`;
  const safeName = sanitizeProjectName(projectName);
  const availableNameLength = Math.max(maxLength - prefix.length, 8);
  const trimmedName = safeName.slice(0, availableNameLength).replace(/_+$/g, '') || 'PROJECT';
  return `${prefix}${trimmedName}`;
}
