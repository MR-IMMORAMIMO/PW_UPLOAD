/**
 * PersistentMigrationJournal: an append-only JSONL migration journal that survives SQLite
 * transaction rollback and process termination.
 *
 * The journal records every migration attempt lifecycle in a per-attempt .jsonl file inside a
 * configured journal root. Each record carries a monotonically increasing sequence number, a
 * checksum of the previous record, and a checksum of its own canonical JSON. This chain detects
 * accidental corruption but is not authentication.
 *
 * The journal implements the existing MigrationJournalPort without changing its signatures.
 * Recovery states (INTERRUPTED, RECOVERED, RECONCILIATION_REQUIRED, ABANDONED) are deferred to
 * P1.5. No retention, reconciliation, restore, or startup integration is implemented here.
 *
 * Database identity: managed databases (inside the data root) are identified by a relative path
 * so the identity survives moving the data root. External databases are identified by a
 * normalized absolute path. No absolute database path is ever persisted in journal records.
 */

import { createHash } from 'node:crypto';
import { open, readFile, mkdir, readdir } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { win32 as winPath } from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { PathResolverService } from '../../path/PathResolverService';
import type {
  MigrationJournalPort,
  MigrationJournalState,
  MigrationJournalAttemptInput,
  MigrationJournalDetails,
  MigrationJournalFailure,
  MigrationClock,
} from '../types';
import {
  JOURNAL_FORMAT_VERSION,
  RESOLUTION_FORMAT_VERSION,
  RESOLUTION_RECORD_TYPE,
  PersistentMigrationJournalError,
  type PersistentMigrationJournalErrorCode,
  type PersistentMigrationJournalDeps,
  type DatabaseRef,
  type JournalRecord,
  type JournalRecordFormat,
  type JournalRecordDatabase,
  type JournalRecordAttempt,
  type JournalRecordStep,
  type JournalRecordBackup,
  type JournalRecordDuration,
  type JournalRecordFailure,
  type AttemptSummary,
  type AttemptInspection,
  type AttemptClassification,
  type ResolutionDisposition,
  type MigrationResolutionInput,
  type MigrationResolutionRecord,
  type MigrationResolutionInspection,
  type EffectiveResolutionStatus,
  type AttemptResolutionInspection,
} from './journal-types';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_MESSAGE_MAX_LENGTH = 256;
const ATTEMPT_ID_MAX_SEGMENT = 128;
const JSONL_EXTENSION = '.jsonl';
const RESOLUTION_EXTENSION = '.resolution.jsonl';
const PARTIAL_PREFIX = '.partial-';
const SAFE_REASON_CODE_MAX_LENGTH = 128;
const MIGRATION_ID_MAX_LENGTH = 128;

/** Allowed resolution dispositions. */
const RESOLUTION_DISPOSITIONS: ReadonlySet<ResolutionDisposition> = new Set<ResolutionDisposition>([
  'SAFE_PRE_TRANSACTION_RETRY',
  'TRANSACTION_ROLLED_BACK',
  'COMMIT_CONFIRMED_FROM_DATABASE',
  'VALID_INTERMEDIATE_VERSION',
  'RESOLVED_SUCCESS',
]);

/** Allowed top-level keys in a resolution sidecar record. */
const RESOLUTION_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'resolutionFormatVersion',
  'recordType',
  'attemptId',
  'sequence',
  'previousChecksum',
  'timestamp',
  'disposition',
  'planFingerprint',
  'attemptLatestChecksum',
  'observedUserVersion',
  'observedHistoryFingerprint',
  'observedCompletedMigrationIds',
  'observedCurrentMigrationId',
  'backupId',
  'backupVerified',
  'startupAllowed',
  'newAttemptAllowed',
  'manualActionRequired',
  'safeReasonCode',
  'checksum',
]);

/** Windows reserved device names (case-insensitive). */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'CLOCK$',
]);

/** Terminal states after which no further records may be appended. */
const TERMINAL_STATES: ReadonlySet<MigrationJournalState> = new Set(['SUCCEEDED', 'FAILED']);

/** Non-terminal states from which FAILED is a valid transition. */
const NON_TERMINAL_STATES: ReadonlySet<MigrationJournalState> = new Set([
  'CREATED',
  'PREFLIGHT_VALIDATED',
  'BACKUP_VERIFIED',
  'TRANSACTION_STARTED',
  'COMMITTED',
  'POST_VALIDATION_PASSED',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(
  code: PersistentMigrationJournalErrorCode,
  message: string,
  cause?: unknown,
): PersistentMigrationJournalError {
  return new PersistentMigrationJournalError(code, message, { cause });
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute the canonical JSON checksum of a record, excluding the checksum field itself.
 *
 * Canonicalization contract:
 * - The digest input is the UTF-8 encoding of JSON.stringify(rest), where rest is the record
 *   with the checksum field removed. Object keys are emitted in insertion order (the order
 *   the journal builds them), which is deterministic for journal-written records. Keys are
 *   intentionally NOT sorted: reordering keys changes the digest, so key reorder is detected
 *   as corruption (a desired tamper-detection property, not a bug).
 * - The checksum field is excluded from its own digest input; previousChecksum is included.
 * - Whitespace is insignificant because records are re-parsed via JSON.parse before digesting.
 * - Unsupported JSON values cannot enter canonicalization: the record builder only accepts
 *   validated primitives (strings and finite integers/numbers); undefined optional fields are
 *   omitted by JSON.stringify, and BigInt/Symbol/function/NaN/Infinity are rejected upstream by
 *   input validation rather than allowed into a record.
 * - No Unicode normalization is applied. User-visible text (e.g. migrationId) is checksummed
 *   byte-for-byte as supplied; normalization would change meaning and is intentionally avoided.
 * - Output is lowercase SHA-256 hex (64 chars).
 */
function computeChecksum(record: Omit<JournalRecord, 'checksum'>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { checksum: _c, ...rest } = record as JournalRecord & { checksum?: string };
  return sha256(JSON.stringify(rest));
}

/** Build a complete JournalRecord with computed checksum. */
function buildRecord(base: Omit<JournalRecord, 'checksum'>): JournalRecord {
  const checksum = computeChecksum(base);
  return { ...base, checksum } as JournalRecord;
}
// ---------------------------------------------------------------------------
// Database identity
// ---------------------------------------------------------------------------

/**
 * Derive a stable, path-free DatabaseRef from the database path and data root.
 *
 * Managed databases (inside the data root) use a relative path so the identity survives
 * moving the data root. External databases use a normalized absolute path. The identityHash
 * is a SHA-256 of the canonical path, never the raw path itself.
 */
function deriveDatabaseRef(databasePath: string, pathResolver: PathResolverService): DatabaseRef {
  // Use the case-insensitive canonical form so equivalent Windows spellings (differing only in
  // drive/segment casing or separators) produce the same identity hash. The raw absolute path is
  // never persisted; only the hash is stored.
  const normalized = pathResolver.canonicalizeForComparison(databasePath);
  const dataRoot = pathResolver.canonicalizeForComparison(pathResolver.dataRoot);

  // Check if the database is inside the data root (lexical containment, case-insensitive).
  const dataRootWindows = dataRoot.replace(/\//g, '\\');
  const normalizedWindows = normalized.replace(/\//g, '\\');
  const rel = winPath.relative(dataRootWindows, normalizedWindows);

  if (rel !== '' && !rel.startsWith('..' + winPath.sep) && !winPath.isAbsolute(rel)) {
    // Managed: inside the data root. Use the lowercased relative path as the identity basis so
    // the identity survives moving the data root and is stable across casing variants.
    const relativeForward = rel.replace(/\\/g, '/');
    return {
      identityHash: sha256('managed:' + relativeForward),
      managed: true,
    };
  }

  // External: outside the data root. Use the canonical (lowercased) absolute path.
  return {
    identityHash: sha256('external:' + normalized),
    managed: false,
  };
}

// ---------------------------------------------------------------------------
// Attempt ID validation
// ---------------------------------------------------------------------------

function validateAttemptId(attemptId: string): void {
  if (typeof attemptId !== 'string' || attemptId.length === 0) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must be a non-empty string.');
  }
  if (attemptId.includes('\0')) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not contain NUL characters.');
  }
  if (attemptId !== attemptId.trim()) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not have leading or trailing whitespace.');
  }
  if (attemptId.endsWith('.')) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not end with a dot.');
  }
  if (attemptId.includes('/') || attemptId.includes('\\')) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not contain path separators.');
  }
  if (attemptId.includes(':')) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not contain colons.');
  }
  if (attemptId.includes('*') || attemptId.includes('?')) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not contain wildcard characters.');
  }
  if (attemptId.startsWith(PARTIAL_PREFIX)) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not start with .partial-.');
  }

  // Check reserved Windows device names.
  const upper = attemptId.toUpperCase();
  const base = upper.split('.')[0]!;
  if (RESERVED_NAMES.has(base)) {
    throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not be a reserved name: ' + base + '.');
  }
  // Check reserved names with any extension.
  for (const reserved of RESERVED_NAMES) {
    if (upper === reserved || upper.startsWith(reserved + '.')) {
      throw fail('INVALID_ATTEMPT_ID', 'Attempt ID must not be a reserved name: ' + reserved + '.');
    }
  }

  // Segment length check.
  for (const segment of attemptId.split(/[/\\]/)) {
    if (segment.length > ATTEMPT_ID_MAX_SEGMENT) {
      throw fail('INVALID_ATTEMPT_ID', 'Attempt ID segment exceeds maximum length.');
    }
  }
}

/** Validate MigrationJournalAttemptInput at the trust boundary before a header is written. */
function validateAttemptInput(input: MigrationJournalAttemptInput): void {
  if (
    typeof input.fromVersion !== 'number' ||
    !Number.isInteger(input.fromVersion) ||
    input.fromVersion < 0
  ) {
    throw fail('INVALID_CONFIGURATION', 'Attempt fromVersion must be a non-negative integer.');
  }
  if (
    typeof input.targetVersion !== 'number' ||
    !Number.isInteger(input.targetVersion) ||
    input.targetVersion < 0
  ) {
    throw fail('INVALID_CONFIGURATION', 'Attempt targetVersion must be a non-negative integer.');
  }
  if (input.targetVersion < input.fromVersion) {
    throw fail('INVALID_CONFIGURATION', 'Attempt targetVersion must be >= fromVersion.');
  }
}
// ---------------------------------------------------------------------------
// Safe failure message
// ---------------------------------------------------------------------------

/**
 * Sanitize a failure message so it never contains absolute paths, stack traces, or secrets.
 *
 * Policy:
 * 1. Normalize to one line.
 * 2. Remove NUL and control characters.
 * 3. Replace path-like content (Windows drive paths, UNC, /Users/, /home/, file://).
 * 4. Remove stack-style "at ..." fragments.
 * 5. Enforce a short maximum length.
 * 6. If the result is empty or still suspicious, replace with a generic message.
 */
function sanitizeFailureMessage(code: string, raw: string): string {
  // Normalize to one line.
  let result = raw.replace(/\r?\n/g, ' ').replace(/\r/g, ' ');

  // Remove NUL and control characters (except space).
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Replace path-like content.
  // Windows drive paths: C:\..., D:\..., etc.
  result = result.replace(/[A-Za-z]:[\\/][^\s]*/g, '[path]');
  // UNC paths: \\server\share\...
  result = result.replace(/\\\\[^\s]+/g, '[path]');
  // Unix home paths.
  result = result.replace(/\/Users\/[^\s]*/g, '[path]');
  result = result.replace(/\/home\/[^\s]*/g, '[path]');
  // file:// URLs.
  result = result.replace(/file:\/\/[^\s]*/g, '[path]');

  // Remove stack-style fragments: lines starting with "at ".
  result = result.replace(/\bat\s+\S+/g, '');

  // Remove file-path fragments like file.ts:10:5.
  result = result.replace(/\([^)]*\.[a-z]{2,4}:\d+(:\d+)?\)/gi, '');

  // Collapse multiple spaces.
  result = result.replace(/\s+/g, ' ').trim();

  // If the result is just "[path]" or similar placeholder-only content, use a generic message.
  if (result.length === 0 || /^\[path\](\s+\[path\])*$/.test(result)) {
    result = 'Migration failed with code: ' + code;
  }

  // Enforce maximum length.
  if (result.length > SAFE_MESSAGE_MAX_LENGTH) {
    result = result.slice(0, SAFE_MESSAGE_MAX_LENGTH - 3) + '...';
  }

  return result;
}
// ---------------------------------------------------------------------------
// State machine: parse and validate JSONL content
// ---------------------------------------------------------------------------

interface ParsedAttempt {
  records: JournalRecord[];
  latestState: MigrationJournalState | null;
  terminal: boolean;
  corrupt: boolean;
  issues: string[];
  trailingPartialRecord: boolean;
  /** True when any record carried an unsupported journal format version. */
  unsupportedFormat: boolean;
}

/**
 * Parse and validate a complete JSONL attempt file content.
 * Returns the parsed records and any issues found.
 */
function parseAttemptContent(content: string, expectedAttemptId: string): ParsedAttempt {
  const issues: string[] = [];
  const records: JournalRecord[] = [];
  let trailingPartialRecord = false;
  let unsupportedFormat = false;

  const lines = content.split('\n');
  // The last element is empty if the content ends with newline.
  const hasTrailingNewline = content.endsWith('\n');
  const recordLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

  for (let i = 0; i < recordLines.length; i++) {
    const line = recordLines[i]!;
    if (line.length === 0) {
      // Empty line in the middle is suspicious.
      if (i < recordLines.length - 1 || hasTrailingNewline) {
        issues.push('Empty line at record index ' + i);
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      issues.push('Malformed JSON at record index ' + i);
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      issues.push('Record at index ' + i + ' is not a JSON object');
      continue;
    }

    const rec = parsed as Record<string, unknown>;

    // Validate required fields.
    if (typeof rec.sequence !== 'number' || !Number.isInteger(rec.sequence) || rec.sequence < 0) {
      issues.push('Invalid or missing sequence at record index ' + i);
      continue;
    }
    if (rec.previousChecksum !== null && typeof rec.previousChecksum !== 'string') {
      issues.push('Invalid previousChecksum at record index ' + i);
      continue;
    }
    if (typeof rec.checksum !== 'string' || !CHECKSUM_PATTERN.test(rec.checksum)) {
      issues.push('Invalid or missing checksum at record index ' + i);
      continue;
    }
    if (typeof rec.timestamp !== 'string') {
      issues.push('Invalid or missing timestamp at record index ' + i);
      continue;
    }
    if (typeof rec.state !== 'string') {
      issues.push('Invalid or missing state at record index ' + i);
      continue;
    }

    // Validate the record format object and version. An unsupported version is recorded
    // separately so callers can distinguish UNSUPPORTED_FORMAT from generic corruption.
    if (
      typeof rec.format !== 'object' ||
      rec.format === null ||
      (rec.format as { version?: unknown }).version !== JOURNAL_FORMAT_VERSION
    ) {
      issues.push('Unsupported or missing journal format version at record index ' + i);
      unsupportedFormat = true;
      continue;
    }

    const record = rec as unknown as JournalRecord;

    // Validate attemptId consistency.
    if (record.attempt?.attemptId !== expectedAttemptId) {
      issues.push('Attempt ID mismatch at record index ' + i);
    }

    records.push(record);
  }

  // Check for trailing partial record (last line not terminated by newline).
  if (
    !hasTrailingNewline &&
    recordLines.length > 0 &&
    recordLines[recordLines.length - 1]!.length > 0
  ) {
    trailingPartialRecord = true;
  }

  // Validate checksum chain.
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;

    // Verify own checksum.
    const computed = computeChecksum(rec);
    if (computed !== rec.checksum) {
      issues.push('Checksum mismatch at sequence ' + rec.sequence);
    }

    // Verify previousChecksum.
    if (i === 0) {
      if (rec.previousChecksum !== null) {
        issues.push('Header previousChecksum must be null');
      }
      if (rec.sequence !== 0) {
        issues.push('Header sequence must be 0');
      }
    } else {
      const prev = records[i - 1]!;
      if (rec.previousChecksum !== prev.checksum) {
        issues.push('Previous checksum mismatch at sequence ' + rec.sequence);
      }
      if (rec.sequence !== prev.sequence + 1) {
        issues.push('Sequence gap or duplicate at sequence ' + rec.sequence);
      }
    }
  }

  // Check for terminal state followed by more records.
  let foundTerminal = false;
  for (const rec of records) {
    if (foundTerminal) {
      issues.push('Record after terminal state at sequence ' + rec.sequence);
    }
    if (TERMINAL_STATES.has(rec.state as MigrationJournalState)) {
      foundTerminal = true;
    }
  }

  const latestState =
    records.length > 0 ? (records[records.length - 1]!.state as MigrationJournalState) : null;
  const terminal = latestState !== null && TERMINAL_STATES.has(latestState);
  const corrupt = issues.length > 0 || trailingPartialRecord;

  return {
    records,
    latestState,
    terminal,
    corrupt,
    issues,
    trailingPartialRecord,
    unsupportedFormat,
  };
}
// ---------------------------------------------------------------------------
// State transition validation
// ---------------------------------------------------------------------------

function validateTransition(
  parsed: ParsedAttempt,
  nextState: MigrationJournalState,
  details: MigrationJournalDetails | undefined,
  failure: MigrationJournalFailure | undefined,
): void {
  const { records, latestState, terminal, corrupt, unsupportedFormat } = parsed;

  // An unsupported journal format version is a distinct, unrecoverable condition for this file.
  if (unsupportedFormat) {
    throw fail(
      'UNSUPPORTED_FORMAT',
      'Attempt file uses an unsupported journal format version and cannot be extended.',
    );
  }

  // Cannot append to a corrupt attempt.
  if (corrupt) {
    throw fail('ATTEMPT_CORRUPT', 'Cannot append to a corrupt or partial attempt.');
  }

  // Cannot append after a terminal state.
  if (terminal) {
    throw fail('TERMINAL_ATTEMPT', 'Cannot transition a terminal attempt.');
  }

  // FAILED can be appended from any non-terminal state.
  if (nextState === 'FAILED') {
    if (latestState !== null && !NON_TERMINAL_STATES.has(latestState)) {
      throw fail(
        'INVALID_STATE_TRANSITION',
        'Cannot transition to FAILED from ' + (latestState ?? 'null') + '.',
      );
    }
    if (
      !failure ||
      typeof failure.code !== 'string' ||
      failure.code.length === 0 ||
      failure.code.length > 128 ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1F\x7F]/.test(failure.code)
    ) {
      throw fail(
        'INVALID_STATE_TRANSITION',
        'FAILED requires a non-empty, bounded, control-free failure code.',
      );
    }
    return;
  }

  // Validate the normal progression.
  const validNext = validNextState(latestState);
  if (validNext === null || !validNext.has(nextState)) {
    throw fail(
      'INVALID_STATE_TRANSITION',
      'Invalid transition from ' + (latestState ?? 'null') + ' to ' + nextState + '.',
    );
  }

  // State-specific detail validation.
  validateStateDetails(records, nextState, details);
}

function validNextState(
  current: MigrationJournalState | null,
): ReadonlySet<MigrationJournalState> | null {
  switch (current) {
    case null:
      return new Set(['CREATED']);
    case 'CREATED':
      return new Set(['PREFLIGHT_VALIDATED']);
    case 'PREFLIGHT_VALIDATED':
      return new Set(['BACKUP_VERIFIED']);
    case 'BACKUP_VERIFIED':
      return new Set(['TRANSACTION_STARTED']);
    case 'TRANSACTION_STARTED':
      return new Set(['COMMITTED']);
    case 'COMMITTED':
      // Can go to TRANSACTION_STARTED (next migration) or POST_VALIDATION_PASSED.
      return new Set(['TRANSACTION_STARTED', 'POST_VALIDATION_PASSED']);
    case 'POST_VALIDATION_PASSED':
      return new Set(['SUCCEEDED']);
    default:
      return null;
  }
}

function validateStateDetails(
  records: readonly JournalRecord[],
  nextState: MigrationJournalState,
  details: MigrationJournalDetails | undefined,
): void {
  // Extract attempt info from the header.
  const header = records[0];
  if (!header) {
    throw fail('ATTEMPT_CORRUPT', 'No header record found.');
  }
  const targetVersion = header.attempt.targetVersion;
  const fromVersion = header.attempt.fromVersion;

  switch (nextState) {
    case 'BACKUP_VERIFIED': {
      if (!details?.backupId || details.backupId.length === 0) {
        throw fail('INVALID_STATE_TRANSITION', 'BACKUP_VERIFIED requires a backupId.');
      }
      break;
    }
    case 'TRANSACTION_STARTED': {
      if (!details?.migrationId || details.migrationId.length === 0) {
        throw fail('INVALID_STATE_TRANSITION', 'TRANSACTION_STARTED requires a migrationId.');
      }
      if (
        details.fromVersion === undefined ||
        details.toVersion === undefined ||
        !Number.isInteger(details.fromVersion) ||
        !Number.isInteger(details.toVersion) ||
        details.fromVersion < 0 ||
        details.toVersion < 0
      ) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'TRANSACTION_STARTED requires non-negative integer fromVersion and toVersion.',
        );
      }
      if (details.toVersion !== details.fromVersion + 1) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'TRANSACTION_STARTED toVersion must equal fromVersion + 1.',
        );
      }

      // First TRANSACTION_STARTED must start from attempt.fromVersion.
      const committedCount = countCommitted(records);
      if (committedCount === 0) {
        if (details.fromVersion !== fromVersion) {
          throw fail(
            'INVALID_STATE_TRANSITION',
            'First migration must start from attempt fromVersion ' + fromVersion + '.',
          );
        }
      } else {
        // Subsequent migrations must start from the last committed toVersion.
        const lastCommitted = findLastCommitted(records);
        if (lastCommitted && details.fromVersion !== lastCommitted.step!.toVersion) {
          throw fail(
            'INVALID_STATE_TRANSITION',
            'Migration fromVersion must match the previous committed toVersion.',
          );
        }
      }

      // Must not exceed targetVersion.
      if (details.toVersion > targetVersion) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'Migration toVersion must not exceed targetVersion.',
        );
      }

      // No duplicate TRANSACTION_STARTED for the same migration step.
      for (const rec of records) {
        if (rec.state === 'TRANSACTION_STARTED' && rec.step?.migrationId === details.migrationId) {
          throw fail(
            'INVALID_STATE_TRANSITION',
            'Duplicate TRANSACTION_STARTED for migration ' + details.migrationId + '.',
          );
        }
      }
      break;
    }
    case 'COMMITTED': {
      if (!details?.migrationId || details.migrationId.length === 0) {
        throw fail('INVALID_STATE_TRANSITION', 'COMMITTED requires a migrationId.');
      }
      if (
        details.fromVersion === undefined ||
        details.toVersion === undefined ||
        !Number.isInteger(details.fromVersion) ||
        !Number.isInteger(details.toVersion) ||
        details.fromVersion < 0 ||
        details.toVersion < 0
      ) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'COMMITTED requires non-negative integer fromVersion and toVersion.',
        );
      }
      if (
        details.durationMs === undefined ||
        typeof details.durationMs !== 'number' ||
        !Number.isFinite(details.durationMs) ||
        details.durationMs < 0
      ) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'COMMITTED requires a finite, non-negative durationMs.',
        );
      }

      // Must match the immediately preceding unmatched TRANSACTION_STARTED.
      const lastStarted = findLastUnmatchedStarted(records);
      if (!lastStarted) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'COMMITTED requires a preceding unmatched TRANSACTION_STARTED.',
        );
      }
      if (
        lastStarted.step!.migrationId !== details.migrationId ||
        lastStarted.step!.fromVersion !== details.fromVersion ||
        lastStarted.step!.toVersion !== details.toVersion
      ) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'COMMITTED details must match the preceding TRANSACTION_STARTED.',
        );
      }

      // No duplicate COMMITTED migrationId.
      for (const rec of records) {
        if (rec.state === 'COMMITTED' && rec.step?.migrationId === details.migrationId) {
          throw fail(
            'INVALID_STATE_TRANSITION',
            'Duplicate COMMITTED for migration ' + details.migrationId + '.',
          );
        }
      }
      break;
    }
    case 'POST_VALIDATION_PASSED': {
      // No unmatched TRANSACTION_STARTED may remain.
      if (hasUnmatchedStarted(records)) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'POST_VALIDATION_PASSED requires all migrations to be committed.',
        );
      }
      // Committed current version must equal targetVersion.
      const lastCommitted = findLastCommitted(records);
      const currentVersion = lastCommitted?.step?.toVersion ?? fromVersion;
      if (currentVersion !== targetVersion) {
        throw fail(
          'INVALID_STATE_TRANSITION',
          'Committed version ' +
            currentVersion +
            ' does not match targetVersion ' +
            targetVersion +
            '.',
        );
      }
      break;
    }
    case 'SUCCEEDED': {
      // Must be after POST_VALIDATION_PASSED (enforced by validNextState).
      break;
    }
  }
}

function countCommitted(records: readonly JournalRecord[]): number {
  return records.filter((r) => r.state === 'COMMITTED').length;
}

function findLastCommitted(records: readonly JournalRecord[]): JournalRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.state === 'COMMITTED') return records[i];
  }
  return undefined;
}

function findLastUnmatchedStarted(records: readonly JournalRecord[]): JournalRecord | undefined {
  const committedIds = new Set<string>();
  for (const rec of records) {
    if (rec.state === 'COMMITTED' && rec.step?.migrationId) {
      committedIds.add(rec.step.migrationId);
    }
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i]!;
    if (
      rec.state === 'TRANSACTION_STARTED' &&
      rec.step?.migrationId &&
      !committedIds.has(rec.step.migrationId)
    ) {
      return rec;
    }
  }
  return undefined;
}

function hasUnmatchedStarted(records: readonly JournalRecord[]): boolean {
  return findLastUnmatchedStarted(records) !== undefined;
}

// ---------------------------------------------------------------------------
// Resolution sidecar helpers (P1.5B2A)
// ---------------------------------------------------------------------------

/** Reject a value that is not a 64-char lowercase hex fingerprint/checksum. */
function validateFingerprint(value: unknown, field: string): void {
  if (typeof value !== 'string' || !CHECKSUM_PATTERN.test(value)) {
    throw fail(
      'INVALID_RESOLUTION',
      field + ' must be exactly 64 lowercase hexadecimal characters.',
    );
  }
}

/**
 * Validate a bounded, non-empty, NUL-free, single-line, path-free string identifier.
 * Path-free means no forward/back slashes and no colon (Windows drive colon).
 */
function validateStringId(value: unknown, field: string, maxLength: number): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw fail('INVALID_RESOLUTION', field + ' must be a non-empty string.');
  }
  if (value.length > maxLength) {
    throw fail('INVALID_RESOLUTION', field + ' exceeds the maximum length.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\0-\x1F\x7F]/.test(value)) {
    throw fail('INVALID_RESOLUTION', field + ' must not contain NUL or control characters.');
  }
  if (value.includes('/') || value.includes('\\') || value.includes(':')) {
    throw fail('INVALID_RESOLUTION', field + ' must not contain path-like content.');
  }
}

/** Throw INVALID_RESOLUTION if cond is false. */
function requireInvariant(cond: boolean, message: string): void {
  if (!cond) {
    throw fail('INVALID_RESOLUTION', message);
  }
}

/**
 * Validate the full resolution input shape and disposition invariants against the original
 * attempt's start and target versions. The timestamp is never accepted from the caller.
 */
function validateResolutionInput(
  input: MigrationResolutionInput,
  attemptFromVersion: number,
  attemptTargetVersion: number,
): void {
  if (input === null || typeof input !== 'object') {
    throw fail('INVALID_RESOLUTION', 'Resolution input must be an object.');
  }
  if (
    typeof input.disposition !== 'string' ||
    !RESOLUTION_DISPOSITIONS.has(input.disposition as ResolutionDisposition)
  ) {
    throw fail('INVALID_RESOLUTION', 'Invalid or unsupported resolution disposition.');
  }
  validateFingerprint(input.planFingerprint, 'planFingerprint');
  validateFingerprint(input.attemptLatestChecksum, 'attemptLatestChecksum');
  validateFingerprint(input.observedHistoryFingerprint, 'observedHistoryFingerprint');

  if (
    typeof input.observedUserVersion !== 'number' ||
    !Number.isFinite(input.observedUserVersion) ||
    !Number.isInteger(input.observedUserVersion) ||
    input.observedUserVersion < 0
  ) {
    throw fail('INVALID_RESOLUTION', 'observedUserVersion must be a finite non-negative integer.');
  }

  if (!Array.isArray(input.observedCompletedMigrationIds)) {
    throw fail('INVALID_RESOLUTION', 'observedCompletedMigrationIds must be an array.');
  }
  const seenIds = new Set<string>();
  for (const id of input.observedCompletedMigrationIds) {
    validateStringId(id, 'observedCompletedMigrationIds entry', MIGRATION_ID_MAX_LENGTH);
    if (seenIds.has(id)) {
      throw fail(
        'INVALID_RESOLUTION',
        'observedCompletedMigrationIds must not contain duplicates.',
      );
    }
    seenIds.add(id);
  }

  if (input.observedCurrentMigrationId !== undefined) {
    validateStringId(
      input.observedCurrentMigrationId,
      'observedCurrentMigrationId',
      MIGRATION_ID_MAX_LENGTH,
    );
  }
  if (input.backupId !== undefined) {
    validateStringId(input.backupId, 'backupId', MIGRATION_ID_MAX_LENGTH);
  }
  if (typeof input.backupVerified !== 'boolean') {
    throw fail('INVALID_RESOLUTION', 'backupVerified must be a boolean.');
  }
  if (typeof input.startupAllowed !== 'boolean') {
    throw fail('INVALID_RESOLUTION', 'startupAllowed must be a boolean.');
  }
  if (typeof input.newAttemptAllowed !== 'boolean') {
    throw fail('INVALID_RESOLUTION', 'newAttemptAllowed must be a boolean.');
  }
  if (typeof input.manualActionRequired !== 'boolean') {
    throw fail('INVALID_RESOLUTION', 'manualActionRequired must be a boolean.');
  }
  validateStringId(input.safeReasonCode, 'safeReasonCode', SAFE_REASON_CODE_MAX_LENGTH);

  // P1.5B2A never persists a manual-action-required resolution.
  requireInvariant(
    input.manualActionRequired === false,
    'manualActionRequired resolutions are not supported in this phase.',
  );

  switch (input.disposition) {
    case 'SAFE_PRE_TRANSACTION_RETRY':
      requireInvariant(
        input.startupAllowed === false,
        'SAFE_PRE_TRANSACTION_RETRY requires startupAllowed false.',
      );
      requireInvariant(
        input.newAttemptAllowed === true,
        'SAFE_PRE_TRANSACTION_RETRY requires newAttemptAllowed true.',
      );
      requireInvariant(
        input.observedUserVersion === attemptFromVersion,
        'SAFE_PRE_TRANSACTION_RETRY observedUserVersion must equal the attempt start version.',
      );
      break;
    case 'TRANSACTION_ROLLED_BACK':
      requireInvariant(
        input.startupAllowed === false,
        'TRANSACTION_ROLLED_BACK requires startupAllowed false.',
      );
      requireInvariant(
        input.newAttemptAllowed === true,
        'TRANSACTION_ROLLED_BACK requires newAttemptAllowed true.',
      );
      requireInvariant(
        input.backupVerified === true,
        'TRANSACTION_ROLLED_BACK requires backupVerified true.',
      );
      // observedUserVersion is validated against the recorded committed prefix in
      // validateResolutionAgainstAttempt, since a rollback may follow earlier committed steps.
      break;
    case 'COMMIT_CONFIRMED_FROM_DATABASE':
      requireInvariant(
        input.startupAllowed === false,
        'COMMIT_CONFIRMED_FROM_DATABASE requires startupAllowed false.',
      );
      requireInvariant(
        input.backupVerified === true,
        'COMMIT_CONFIRMED_FROM_DATABASE requires backupVerified true.',
      );
      requireInvariant(
        input.observedCurrentMigrationId !== undefined &&
          input.observedCurrentMigrationId.length > 0,
        'COMMIT_CONFIRMED_FROM_DATABASE requires observedCurrentMigrationId.',
      );
      requireInvariant(
        input.observedCompletedMigrationIds.length >= 1,
        'COMMIT_CONFIRMED_FROM_DATABASE requires at least one completed migration ID.',
      );
      if (input.observedUserVersion === attemptTargetVersion) {
        requireInvariant(
          input.newAttemptAllowed === false,
          'COMMIT_CONFIRMED_FROM_DATABASE at target requires newAttemptAllowed false.',
        );
      } else if (input.observedUserVersion < attemptTargetVersion) {
        requireInvariant(
          input.newAttemptAllowed === true,
          'COMMIT_CONFIRMED_FROM_DATABASE below target requires newAttemptAllowed true.',
        );
      } else {
        throw fail(
          'INVALID_RESOLUTION',
          'COMMIT_CONFIRMED_FROM_DATABASE observedUserVersion must not exceed the attempt target version.',
        );
      }
      break;
    case 'VALID_INTERMEDIATE_VERSION':
      requireInvariant(
        input.startupAllowed === false,
        'VALID_INTERMEDIATE_VERSION requires startupAllowed false.',
      );
      requireInvariant(
        input.newAttemptAllowed === true,
        'VALID_INTERMEDIATE_VERSION requires newAttemptAllowed true.',
      );
      requireInvariant(
        input.backupVerified === true,
        'VALID_INTERMEDIATE_VERSION requires backupVerified true.',
      );
      requireInvariant(
        input.observedUserVersion > attemptFromVersion,
        'VALID_INTERMEDIATE_VERSION observedUserVersion must exceed the attempt start version.',
      );
      requireInvariant(
        input.observedUserVersion < attemptTargetVersion,
        'VALID_INTERMEDIATE_VERSION observedUserVersion must be below the attempt target version.',
      );
      requireInvariant(
        input.observedCompletedMigrationIds.length >= 1,
        'VALID_INTERMEDIATE_VERSION requires at least one completed migration ID.',
      );
      break;
    case 'RESOLVED_SUCCESS':
      requireInvariant(
        input.startupAllowed === true,
        'RESOLVED_SUCCESS requires startupAllowed true.',
      );
      requireInvariant(
        input.newAttemptAllowed === false,
        'RESOLVED_SUCCESS requires newAttemptAllowed false.',
      );
      requireInvariant(
        input.backupVerified === true,
        'RESOLVED_SUCCESS requires backupVerified true.',
      );
      requireInvariant(
        input.observedUserVersion === attemptTargetVersion,
        'RESOLVED_SUCCESS observedUserVersion must equal the attempt target version.',
      );
      break;
  }
}

/**
 * Validate the resolution against the immutable original attempt history. Storage must not
 * invent database truth, but it must reject combinations that contradict the recorded journal.
 * Only the journal records are used; registry checksums and real database state are the
 * Reconciler's responsibility.
 */
function validateResolutionAgainstAttempt(
  input: MigrationResolutionInput,
  inspection: AttemptInspection,
  fromVersion: number,
  targetVersion: number,
): void {
  const committedIds = inspection.completedMigrationIds;
  const committedVersion = inspection.currentCommittedVersion ?? fromVersion;
  const attemptBackupId = inspection.backupId;
  const records = inspection.records;
  const unmatchedStarted = findLastUnmatchedStarted(records);
  const unmatchedStartedId = unmatchedStarted?.step?.migrationId ?? null;
  const unmatchedStartedToVersion = unmatchedStarted?.step?.toVersion ?? null;
  const latestState = inspection.latestState;
  const preFailureState =
    records.length >= 2 ? (records[records.length - 2]!.state as MigrationJournalState) : null;
  const meaningfulState = latestState === 'FAILED' ? preFailureState : latestState;

  const idsEqual = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]!);

  // --- Backup consistency (uniform across dispositions) ---
  if (input.backupVerified) {
    if (input.backupId === undefined) {
      throw fail('INVALID_RESOLUTION', 'backupVerified true requires a backupId.');
    }
    if (attemptBackupId === null || attemptBackupId !== input.backupId) {
      throw fail(
        'INVALID_RESOLUTION',
        'backupId must match the backup ID recorded in the original attempt.',
      );
    }
  } else if (input.backupId !== undefined) {
    // A false backupVerified with a backupId is contradictory and may substitute an unverified ID.
    throw fail('INVALID_RESOLUTION', 'backupVerified false must not supply a backupId.');
  }

  switch (input.disposition) {
    case 'SAFE_PRE_TRANSACTION_RETRY': {
      if (committedIds.length > 0) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY requires no committed migration in the attempt.',
        );
      }
      if (unmatchedStartedId !== null) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY requires no unmatched transaction in the attempt.',
        );
      }
      if (
        meaningfulState !== 'CREATED' &&
        meaningfulState !== 'PREFLIGHT_VALIDATED' &&
        meaningfulState !== 'BACKUP_VERIFIED'
      ) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY requires a pre-mutation attempt state.',
        );
      }
      if (input.observedCompletedMigrationIds.length > 0) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY requires empty observedCompletedMigrationIds.',
        );
      }
      if (input.observedCurrentMigrationId !== undefined) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY must not supply observedCurrentMigrationId.',
        );
      }
      if (input.observedUserVersion !== fromVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'SAFE_PRE_TRANSACTION_RETRY observedUserVersion must equal the attempt start version.',
        );
      }
      break;
    }
    case 'TRANSACTION_ROLLED_BACK': {
      if (unmatchedStartedId === null) {
        throw fail(
          'INVALID_RESOLUTION',
          'TRANSACTION_ROLLED_BACK requires an unmatched transaction in the attempt.',
        );
      }
      if (input.observedCurrentMigrationId !== unmatchedStartedId) {
        throw fail(
          'INVALID_RESOLUTION',
          'TRANSACTION_ROLLED_BACK observedCurrentMigrationId must identify the unmatched step.',
        );
      }
      if (!idsEqual(input.observedCompletedMigrationIds, committedIds)) {
        throw fail(
          'INVALID_RESOLUTION',
          'TRANSACTION_ROLLED_BACK observedCompletedMigrationIds must equal the committed prefix.',
        );
      }
      if (input.observedUserVersion !== committedVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'TRANSACTION_ROLLED_BACK observedUserVersion must equal the latest committed version.',
        );
      }
      break;
    }
    case 'COMMIT_CONFIRMED_FROM_DATABASE': {
      if (unmatchedStartedId === null || unmatchedStartedToVersion === null) {
        throw fail(
          'INVALID_RESOLUTION',
          'COMMIT_CONFIRMED_FROM_DATABASE requires an unmatched transaction in the attempt.',
        );
      }
      if (input.observedCurrentMigrationId !== unmatchedStartedId) {
        throw fail(
          'INVALID_RESOLUTION',
          'COMMIT_CONFIRMED_FROM_DATABASE observedCurrentMigrationId must identify the unmatched step.',
        );
      }
      const expectedCompleted = [...committedIds, unmatchedStartedId];
      if (!idsEqual(input.observedCompletedMigrationIds, expectedCompleted)) {
        throw fail(
          'INVALID_RESOLUTION',
          'COMMIT_CONFIRMED_FROM_DATABASE observedCompletedMigrationIds must equal the committed prefix plus the confirmed migration.',
        );
      }
      if (input.observedUserVersion !== unmatchedStartedToVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'COMMIT_CONFIRMED_FROM_DATABASE observedUserVersion must equal the confirmed migration toVersion.',
        );
      }
      break;
    }
    case 'VALID_INTERMEDIATE_VERSION': {
      if (committedIds.length === 0 && unmatchedStartedId === null) {
        throw fail(
          'INVALID_RESOLUTION',
          'VALID_INTERMEDIATE_VERSION requires a recorded mutation in the attempt.',
        );
      }
      const optionA = committedIds;
      const optionB = unmatchedStartedId !== null ? [...committedIds, unmatchedStartedId] : null;
      const matchesA = idsEqual(input.observedCompletedMigrationIds, optionA);
      const matchesB = optionB !== null && idsEqual(input.observedCompletedMigrationIds, optionB);
      if (!matchesA && !matchesB) {
        throw fail(
          'INVALID_RESOLUTION',
          'VALID_INTERMEDIATE_VERSION observedCompletedMigrationIds must match the recorded committed prefix.',
        );
      }
      const expectedVersion = matchesA ? committedVersion : unmatchedStartedToVersion;
      if (input.observedUserVersion !== expectedVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'VALID_INTERMEDIATE_VERSION observedUserVersion must match the completed migration version.',
        );
      }
      if (
        input.observedCurrentMigrationId !== undefined &&
        input.observedCurrentMigrationId !== unmatchedStartedId
      ) {
        throw fail(
          'INVALID_RESOLUTION',
          'VALID_INTERMEDIATE_VERSION observedCurrentMigrationId must identify the unmatched step when supplied.',
        );
      }
      break;
    }
    case 'RESOLVED_SUCCESS': {
      if (committedVersion !== targetVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'RESOLVED_SUCCESS requires every migration committed in the attempt.',
        );
      }
      if (!idsEqual(input.observedCompletedMigrationIds, committedIds)) {
        throw fail(
          'INVALID_RESOLUTION',
          'RESOLVED_SUCCESS observedCompletedMigrationIds must equal the committed prefix.',
        );
      }
      if (input.observedCurrentMigrationId !== undefined) {
        throw fail(
          'INVALID_RESOLUTION',
          'RESOLVED_SUCCESS must not supply observedCurrentMigrationId.',
        );
      }
      if (input.observedUserVersion !== targetVersion) {
        throw fail(
          'INVALID_RESOLUTION',
          'RESOLVED_SUCCESS observedUserVersion must equal the attempt target version.',
        );
      }
      break;
    }
  }
}

/**
 * Validate disposition invariants that do not depend on the original attempt's version bounds.
 * Used during sidecar inspection so a self-contradictory or tampered record is rejected even
 * without reading the original attempt.
 */
function validateResolutionDispositionSelf(record: MigrationResolutionRecord): void {
  requireInvariant(
    record.manualActionRequired === false,
    'Resolution record manualActionRequired must be false in this phase.',
  );
  switch (record.disposition) {
    case 'SAFE_PRE_TRANSACTION_RETRY':
      requireInvariant(
        record.startupAllowed === false,
        'SAFE_PRE_TRANSACTION_RETRY requires startupAllowed false.',
      );
      requireInvariant(
        record.newAttemptAllowed === true,
        'SAFE_PRE_TRANSACTION_RETRY requires newAttemptAllowed true.',
      );
      break;
    case 'TRANSACTION_ROLLED_BACK':
      requireInvariant(
        record.startupAllowed === false,
        'TRANSACTION_ROLLED_BACK requires startupAllowed false.',
      );
      requireInvariant(
        record.newAttemptAllowed === true,
        'TRANSACTION_ROLLED_BACK requires newAttemptAllowed true.',
      );
      requireInvariant(
        record.backupVerified === true,
        'TRANSACTION_ROLLED_BACK requires backupVerified true.',
      );
      break;
    case 'COMMIT_CONFIRMED_FROM_DATABASE':
      requireInvariant(
        record.startupAllowed === false,
        'COMMIT_CONFIRMED_FROM_DATABASE requires startupAllowed false.',
      );
      requireInvariant(
        record.backupVerified === true,
        'COMMIT_CONFIRMED_FROM_DATABASE requires backupVerified true.',
      );
      requireInvariant(
        record.observedCurrentMigrationId !== undefined &&
          record.observedCurrentMigrationId.length > 0,
        'COMMIT_CONFIRMED_FROM_DATABASE requires observedCurrentMigrationId.',
      );
      requireInvariant(
        record.observedCompletedMigrationIds.length >= 1,
        'COMMIT_CONFIRMED_FROM_DATABASE requires at least one completed migration ID.',
      );
      break;
    case 'VALID_INTERMEDIATE_VERSION':
      requireInvariant(
        record.startupAllowed === false,
        'VALID_INTERMEDIATE_VERSION requires startupAllowed false.',
      );
      requireInvariant(
        record.newAttemptAllowed === true,
        'VALID_INTERMEDIATE_VERSION requires newAttemptAllowed true.',
      );
      requireInvariant(
        record.backupVerified === true,
        'VALID_INTERMEDIATE_VERSION requires backupVerified true.',
      );
      requireInvariant(
        record.observedCompletedMigrationIds.length >= 1,
        'VALID_INTERMEDIATE_VERSION requires at least one completed migration ID.',
      );
      break;
    case 'RESOLVED_SUCCESS':
      requireInvariant(
        record.startupAllowed === true,
        'RESOLVED_SUCCESS requires startupAllowed true.',
      );
      requireInvariant(
        record.newAttemptAllowed === false,
        'RESOLVED_SUCCESS requires newAttemptAllowed false.',
      );
      requireInvariant(
        record.backupVerified === true,
        'RESOLVED_SUCCESS requires backupVerified true.',
      );
      break;
  }
}

/** Compute the SHA-256 checksum of a resolution record, excluding the checksum field itself. */
function computeResolutionChecksum(record: Omit<MigrationResolutionRecord, 'checksum'>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { checksum: _c, ...rest } = record as MigrationResolutionRecord & { checksum?: string };
  return sha256(JSON.stringify(rest));
}

/** Build a complete immutable resolution record with a computed checksum. */
function buildResolutionRecord(
  attemptId: string,
  input: MigrationResolutionInput,
  timestamp: string,
): MigrationResolutionRecord {
  const base: Omit<MigrationResolutionRecord, 'checksum'> = {
    resolutionFormatVersion: RESOLUTION_FORMAT_VERSION,
    recordType: RESOLUTION_RECORD_TYPE,
    attemptId,
    sequence: 0,
    previousChecksum: null,
    timestamp,
    disposition: input.disposition,
    planFingerprint: input.planFingerprint,
    attemptLatestChecksum: input.attemptLatestChecksum,
    observedUserVersion: input.observedUserVersion,
    observedHistoryFingerprint: input.observedHistoryFingerprint,
    observedCompletedMigrationIds: [...input.observedCompletedMigrationIds],
    ...(input.observedCurrentMigrationId !== undefined
      ? { observedCurrentMigrationId: input.observedCurrentMigrationId }
      : {}),
    ...(input.backupId !== undefined ? { backupId: input.backupId } : {}),
    backupVerified: input.backupVerified,
    startupAllowed: input.startupAllowed,
    newAttemptAllowed: input.newAttemptAllowed,
    manualActionRequired: input.manualActionRequired,
    safeReasonCode: input.safeReasonCode,
  };
  const checksum = computeResolutionChecksum(base);
  return { ...base, checksum } as MigrationResolutionRecord;
}

/** Return a deeply frozen, defensive copy of a resolution record for public consumption. */
function deepFreezeResolution(record: MigrationResolutionRecord): MigrationResolutionRecord {
  return Object.freeze({
    ...record,
    observedCompletedMigrationIds: Object.freeze([...record.observedCompletedMigrationIds]),
  }) as MigrationResolutionRecord;
}
// ---------------------------------------------------------------------------
// Effective resolution result builders (P1.5B2B1)
// ---------------------------------------------------------------------------

function buildAbsentResolutionResult(
  attemptId: string,
  classification: AttemptClassification,
): AttemptResolutionInspection {
  // ABSENT means no effective resolution sidecar applies. It does NOT by itself imply a human must
  // act: a clean terminal-success or safe terminal-failure attempt has no sidecar and needs no
  // manual action. Only non-terminal, reconciliation-required, or corrupt attempts need attention.
  const manualActionRequired =
    classification !== 'terminal-success' && classification !== 'terminal-failure';
  return Object.freeze({
    attemptId,
    classification,
    effectiveResolutionStatus: 'ABSENT' as EffectiveResolutionStatus,
    effectiveDisposition: undefined,
    newAttemptAllowed: false,
    startupAllowed: false,
    manualActionRequired,
    attemptLatestChecksum: undefined,
    resolutionChecksum: undefined,
  });
}

function buildCorruptResolutionResult(
  attemptId: string,
  classification: AttemptClassification,
): AttemptResolutionInspection {
  return Object.freeze({
    attemptId,
    classification,
    effectiveResolutionStatus: 'CORRUPT' as EffectiveResolutionStatus,
    effectiveDisposition: undefined,
    newAttemptAllowed: false,
    startupAllowed: false,
    manualActionRequired: true,
    attemptLatestChecksum: undefined,
    resolutionChecksum: undefined,
  });
}

function buildStaleResolutionResult(
  attemptId: string,
  classification: AttemptClassification,
  record: MigrationResolutionRecord,
): AttemptResolutionInspection {
  return Object.freeze({
    attemptId,
    classification,
    effectiveResolutionStatus: 'STALE' as EffectiveResolutionStatus,
    effectiveDisposition: undefined,
    newAttemptAllowed: false,
    startupAllowed: false,
    manualActionRequired: true,
    attemptLatestChecksum: record.attemptLatestChecksum,
    resolutionChecksum: record.checksum,
  });
}

function buildEffectiveResolutionResult(
  attemptId: string,
  classification: AttemptClassification,
  record: MigrationResolutionRecord,
): AttemptResolutionInspection {
  return Object.freeze({
    attemptId,
    classification,
    effectiveResolutionStatus: 'EFFECTIVE' as EffectiveResolutionStatus,
    effectiveDisposition: record.disposition,
    newAttemptAllowed: record.newAttemptAllowed,
    startupAllowed: record.startupAllowed,
    manualActionRequired: record.manualActionRequired,
    attemptLatestChecksum: record.attemptLatestChecksum,
    resolutionChecksum: record.checksum,
  });
}

/**
 * Parse and strictly validate a resolution sidecar file. The content must be exactly one
 * complete newline-terminated JSON record that matches the schema, checksum, attempt id, and
 * disposition self-consistency. Any violation throws RESOLUTION_CORRUPT.
 */
function parseResolutionContent(
  content: string,
  expectedAttemptId: string,
): MigrationResolutionRecord {
  if (content === '') {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar is empty.');
  }
  if (!content.endsWith('\n')) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar is missing a trailing newline.');
  }
  const lines = content.split('\n');
  // A trailing newline produces a final empty element; the remaining lines are records.
  const recordLines = lines.slice(0, -1);
  if (recordLines.length !== 1) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar must contain exactly one record.');
  }
  const line = recordLines[0]!;
  if (line.length === 0) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar record is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar record is malformed JSON.');
  }
  return validateResolutionRecord(parsed, expectedAttemptId);
}

/** Strictly validate a parsed resolution record object and return it with a verified checksum. */
function validateResolutionRecord(
  parsed: unknown,
  expectedAttemptId: string,
): MigrationResolutionRecord {
  if (typeof parsed !== 'object' || parsed === null) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution record is not a JSON object.');
  }
  const rec = parsed as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!RESOLUTION_ALLOWED_KEYS.has(key)) {
      throw fail('RESOLUTION_CORRUPT', 'Unknown field in resolution record: ' + key + '.');
    }
  }
  if (rec.resolutionFormatVersion !== RESOLUTION_FORMAT_VERSION) {
    throw fail('RESOLUTION_CORRUPT', 'Unsupported resolution format version.');
  }
  if (rec.recordType !== RESOLUTION_RECORD_TYPE) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid resolution record type.');
  }
  if (typeof rec.attemptId !== 'string' || rec.attemptId !== expectedAttemptId) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution attempt ID mismatch.');
  }
  if (rec.sequence !== 0) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution sequence must be 0.');
  }
  if (rec.previousChecksum !== null) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution previousChecksum must be null.');
  }
  if (typeof rec.timestamp !== 'string' || rec.timestamp.length === 0) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid resolution timestamp.');
  }
  if (
    typeof rec.disposition !== 'string' ||
    !RESOLUTION_DISPOSITIONS.has(rec.disposition as ResolutionDisposition)
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid resolution disposition.');
  }
  if (typeof rec.planFingerprint !== 'string' || !CHECKSUM_PATTERN.test(rec.planFingerprint)) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid planFingerprint.');
  }
  if (
    typeof rec.attemptLatestChecksum !== 'string' ||
    !CHECKSUM_PATTERN.test(rec.attemptLatestChecksum)
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid attemptLatestChecksum.');
  }
  if (
    typeof rec.observedUserVersion !== 'number' ||
    !Number.isInteger(rec.observedUserVersion) ||
    rec.observedUserVersion < 0
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid observedUserVersion.');
  }
  if (
    typeof rec.observedHistoryFingerprint !== 'string' ||
    !CHECKSUM_PATTERN.test(rec.observedHistoryFingerprint)
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid observedHistoryFingerprint.');
  }
  if (
    !Array.isArray(rec.observedCompletedMigrationIds) ||
    rec.observedCompletedMigrationIds.some((id) => typeof id !== 'string')
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid observedCompletedMigrationIds.');
  }
  if (
    rec.observedCurrentMigrationId !== undefined &&
    typeof rec.observedCurrentMigrationId !== 'string'
  ) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid observedCurrentMigrationId.');
  }
  if (rec.backupId !== undefined && typeof rec.backupId !== 'string') {
    throw fail('RESOLUTION_CORRUPT', 'Invalid backupId.');
  }
  if (typeof rec.backupVerified !== 'boolean') {
    throw fail('RESOLUTION_CORRUPT', 'Invalid backupVerified.');
  }
  if (typeof rec.startupAllowed !== 'boolean') {
    throw fail('RESOLUTION_CORRUPT', 'Invalid startupAllowed.');
  }
  if (typeof rec.newAttemptAllowed !== 'boolean') {
    throw fail('RESOLUTION_CORRUPT', 'Invalid newAttemptAllowed.');
  }
  if (typeof rec.manualActionRequired !== 'boolean') {
    throw fail('RESOLUTION_CORRUPT', 'Invalid manualActionRequired.');
  }
  if (typeof rec.safeReasonCode !== 'string' || rec.safeReasonCode.length === 0) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid safeReasonCode.');
  }
  if (typeof rec.checksum !== 'string' || !CHECKSUM_PATTERN.test(rec.checksum)) {
    throw fail('RESOLUTION_CORRUPT', 'Invalid resolution checksum.');
  }

  const record: MigrationResolutionRecord = {
    resolutionFormatVersion: rec.resolutionFormatVersion as 1,
    recordType: rec.recordType as 'migration-resolution',
    attemptId: rec.attemptId as string,
    sequence: rec.sequence as number,
    previousChecksum: null,
    timestamp: rec.timestamp as string,
    disposition: rec.disposition as ResolutionDisposition,
    planFingerprint: rec.planFingerprint as string,
    attemptLatestChecksum: rec.attemptLatestChecksum as string,
    observedUserVersion: rec.observedUserVersion as number,
    observedHistoryFingerprint: rec.observedHistoryFingerprint as string,
    observedCompletedMigrationIds: rec.observedCompletedMigrationIds as string[],
    observedCurrentMigrationId: rec.observedCurrentMigrationId as string | undefined,
    backupId: rec.backupId as string | undefined,
    backupVerified: rec.backupVerified as boolean,
    startupAllowed: rec.startupAllowed as boolean,
    newAttemptAllowed: rec.newAttemptAllowed as boolean,
    manualActionRequired: rec.manualActionRequired as boolean,
    safeReasonCode: rec.safeReasonCode as string,
    checksum: rec.checksum as string,
  };

  const computed = computeResolutionChecksum(record);
  if (computed !== record.checksum) {
    throw fail('RESOLUTION_CORRUPT', 'Resolution checksum mismatch.');
  }
  validateResolutionDispositionSelf(record);
  return record;
}

// ---------------------------------------------------------------------------
// PersistentMigrationJournal
// ---------------------------------------------------------------------------

export class PersistentMigrationJournal implements MigrationJournalPort {
  private readonly journalRoot: string;
  private readonly databaseRef: DatabaseRef;
  private readonly clock: MigrationClock;
  private readonly idGenerator: { generate(): string };
  private readonly appVersion: string;
  private readonly writeHooks: import('./journal-types').JournalWriteHooks | undefined;

  /** Per-attemptId serialization queues. */
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Per-instance chain that serializes createAttempt calls. Distinct journal instances are
   * intentionally uncoordinated; cross-instance / cross-process coordination is out of scope.
   */
  private createChain: Promise<unknown> = Promise.resolve();

  public constructor(deps: PersistentMigrationJournalDeps) {
    // Validate journalFormatVersion.
    if (deps.journalFormatVersion !== JOURNAL_FORMAT_VERSION) {
      throw fail(
        'INVALID_CONFIGURATION',
        'journalFormatVersion must be ' + JOURNAL_FORMAT_VERSION + '.',
      );
    }

    // Validate appVersion.
    if (typeof deps.appVersion !== 'string' || deps.appVersion.length === 0) {
      throw fail('INVALID_CONFIGURATION', 'appVersion must be a non-empty string.');
    }

    // Validate clock and idGenerator.
    if (!deps.clock || typeof deps.clock.now !== 'function') {
      throw fail('INVALID_CONFIGURATION', 'clock must have a now() method.');
    }
    if (!deps.idGenerator || typeof deps.idGenerator.generate !== 'function') {
      throw fail('INVALID_CONFIGURATION', 'idGenerator must have a generate() method.');
    }

    // Validate journalRoot.
    const journalRoot = deps.pathResolver.normalizeAbsolutePath(deps.journalRoot);
    if (!winPath.isAbsolute(journalRoot.replace(/\//g, '\\'))) {
      throw fail('INVALID_CONFIGURATION', 'journalRoot must be an absolute path.');
    }
    if (!deps.pathResolver.isWithinDataRoot(journalRoot)) {
      throw fail(
        'JOURNAL_ROOT_OUTSIDE_DATA_ROOT',
        'journalRoot must be inside the configured data root.',
      );
    }

    // Validate databasePath.
    const databasePath = deps.pathResolver.normalizeAbsolutePath(deps.databasePath);
    if (!winPath.isAbsolute(databasePath.replace(/\//g, '\\'))) {
      throw fail('INVALID_DATABASE_REFERENCE', 'databasePath must be an absolute path.');
    }
    if (databasePath === ':memory:' || databasePath.toLowerCase() === ':memory:') {
      throw fail('INVALID_DATABASE_REFERENCE', 'databasePath must not be :memory:.');
    }

    // Database must not be inside journalRoot.
    const jrWin = journalRoot.replace(/\//g, '\\');
    const dbWin = databasePath.replace(/\//g, '\\');
    // Case-insensitive comparison so casing-only differences are not treated as containment.
    const dbRelToJr = winPath.relative(jrWin.toLowerCase(), dbWin.toLowerCase());
    if (
      dbRelToJr !== '' &&
      !dbRelToJr.startsWith('..' + winPath.sep) &&
      !winPath.isAbsolute(dbRelToJr)
    ) {
      throw fail('INVALID_DATABASE_REFERENCE', 'databasePath must not be inside journalRoot.');
    }

    // Journal root must not be a file or a symlink/junction at the leaf (check before
    // ensureJournalRoot). Residual limitation: only the leaf is inspected with lstatSync; an
    // ancestor directory of journalRoot that is itself a symlink, junction, or reparse point is
    // NOT detected without native reparse-point APIs, and hard links to attempt files are not
    // prevented. This is acceptable for a trusted local data directory and is documented here
    // rather than claimed as complete protection.
    try {
      const jrStat = lstatSync(jrWin);
      if (jrStat.isFile()) {
        throw fail('UNSAFE_FILESYSTEM_ENTRY', 'journalRoot must not be a file.');
      }
      if (jrStat.isSymbolicLink()) {
        throw fail('UNSAFE_FILESYSTEM_ENTRY', 'journalRoot must not be a symlink or junction.');
      }
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError) throw error;
      // Path does not exist yet — that is fine, ensureJournalRoot will create it.
    }

    // Journal root must not be the database file.
    if (jrWin.toLowerCase() === dbWin.toLowerCase()) {
      throw fail('INVALID_CONFIGURATION', 'journalRoot must not be the database file.');
    }

    this.journalRoot = journalRoot;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.appVersion = deps.appVersion;
    this.writeHooks = deps.writeHooks;
    this.databaseRef = deriveDatabaseRef(deps.databasePath, deps.pathResolver);
  }

  // ---------------------------------------------------------------------------
  // MigrationJournalPort implementation
  // ---------------------------------------------------------------------------

  public async createAttempt(input: MigrationJournalAttemptInput): Promise<{ attemptId: string }> {
    // Validate attempt input at the trust boundary before any filesystem work.
    validateAttemptInput(input);

    // Serialize attempt creation for this journal instance (one bound database identity) so two
    // concurrent createAttempt calls cannot both pass the active-attempt scan and create two active
    // attempts. Cross-instance / cross-process coordination is intentionally NOT provided: two
    // distinct journal instances bound to the same database are an unsupported concurrent
    // configuration that must rely on external locking.
    const run = this.createChain.then(
      () => this.createAttemptImpl(input),
      () => this.createAttemptImpl(input),
    );
    this.createChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---------------------------------------------------------------------------
  // Request-aware create-attempt permission (P1.5B2B2)
  // ---------------------------------------------------------------------------

  /**
   * Hold the per-attempt queues for every matching attempt while fn runs. This prevents a
   * concurrent transition, markFailed, or appendResolution from changing a relevant attempt
   * after the permission scan and before the new attempt file is created. Re-scan after the
   * holds are active to catch concurrent changes. Cross-instance / cross-process coordination
   * is intentionally not provided.
   */
  private async withMatchingAttemptQueues<T>(
    fn: (ids: readonly string[]) => Promise<T>,
  ): Promise<T> {
    const initialIds = await this.scanRelevantAttemptIds();

    const releases = new Map<string, () => void>();
    const startedPromises: Promise<void>[] = [];
    try {
      for (const attemptId of initialIds) {
        const started = new Promise<void>((resolve) => {
          let resolved = false;
          const startResolve = () => {
            if (resolved) return;
            resolved = true;
            resolve();
          };
          void this.enqueueTask(attemptId, async () => {
            startResolve();
            await new Promise<void>((r) => {
              releases.set(attemptId, r);
            });
          });
        });
        startedPromises.push(started);
      }

      // Wait until every hold task has started. At that point any in-flight operation on a
      // relevant attempt has completed.
      await Promise.all(startedPromises);

      const currentIds = await this.scanRelevantAttemptIds();
      for (const id of currentIds) {
        if (!releases.has(id)) {
          throw fail(
            'ACTIVE_ATTEMPT_EXISTS',
            'A concurrent attempt changed journal state during permission evaluation.',
          );
        }
      }

      return await fn(currentIds);
    } finally {
      for (const release of releases.values()) release();
    }
  }

  /**
   * Scan the journal root for attempt files whose database identity matches this journal's
   * bound database. Unreadable or corrupt attempts with no trustworthy identity are included so
   * the caller can fail closed.
   */
  private async scanRelevantAttemptIds(): Promise<string[]> {
    const ids: string[] = [];
    let entries: { name: string; isFile(): boolean; isSymbolicLink(): boolean }[];
    try {
      const entriesResult = await readdir(this.journalRootWindows(), { withFileTypes: true });
      entries = entriesResult;
    } catch {
      return ids;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith(JSONL_EXTENSION) || entry.name.endsWith(RESOLUTION_EXTENSION)) {
        continue;
      }

      const attemptId = entry.name.slice(0, -JSONL_EXTENSION.length);
      const filePath = this.attemptFilePath(attemptId);

      let stat: ReturnType<typeof lstatSync> | undefined;
      try {
        stat = lstatSync(filePath);
      } catch {
        ids.push(attemptId);
        continue;
      }

      if (!stat.isFile() || stat.isSymbolicLink()) {
        ids.push(attemptId);
        continue;
      }

      const identityHash = await this.readAttemptHeaderIdentity(attemptId);
      if (identityHash === null || identityHash === this.databaseRef.identityHash) {
        ids.push(attemptId);
      }
    }

    return ids.sort((a, b) => (a < b ? -1 : 1));
  }

  private async readAttemptHeaderIdentity(attemptId: string): Promise<string | null> {
    const filePath = this.attemptFilePath(attemptId);
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      return null;
    }

    const lineEnd = content.indexOf('\n');
    const line = lineEnd >= 0 ? content.slice(0, lineEnd) : content;
    if (line.length === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const format = rec.format as { version?: unknown } | undefined;
    if (!format || format.version !== JOURNAL_FORMAT_VERSION) return null;
    const database = rec.database as { identityHash?: unknown } | undefined;
    if (!database || typeof database.identityHash !== 'string') return null;
    return database.identityHash;
  }

  /**
   * Evaluate whether a new attempt is permitted given the current matching attempts and their
   * effective resolutions. Throws a typed error when blocked; returns when permitted. Unknown
   * programming errors propagate.
   */
  private async assertCreateAttemptPermission(
    input: MigrationJournalAttemptInput,
    matchingAttemptIds: readonly string[],
  ): Promise<void> {
    for (const attemptId of matchingAttemptIds) {
      let inspection: AttemptInspection;
      try {
        inspection = await this.inspectAttemptImpl(attemptId);
      } catch (error) {
        if (
          error instanceof PersistentMigrationJournalError &&
          error.code === 'ATTEMPT_NOT_FOUND'
        ) {
          continue;
        }
        if (
          error instanceof PersistentMigrationJournalError &&
          (error.code === 'ATTEMPT_CORRUPT' || error.code === 'UNSAFE_FILESYSTEM_ENTRY')
        ) {
          throw fail(
            'ATTEMPT_CORRUPT',
            'A corrupt or unsafe attempt exists and requires reconciliation before a new attempt.',
            error,
          );
        }
        throw error;
      }

      if (inspection.records.length === 0 || inspection.corrupt) {
        throw fail(
          'ATTEMPT_CORRUPT',
          'A corrupt or partial attempt exists and requires reconciliation before a new attempt.',
        );
      }

      const classification = inspection.recoveryClassification;
      if (classification === 'terminal-success' || classification === 'terminal-failure') {
        // A no-op or lower-target request is never a legitimate new plan.
        if (input.targetVersion <= input.fromVersion) {
          throw fail(
            'ACTIVE_ATTEMPT_EXISTS',
            'New attempt target must exceed the starting version.',
          );
        }
        // A terminal-success attempt with an effective RESOLVED_SUCCESS sidecar remains
        // historical evidence and must still satisfy the future-upgrade rule.
        if (classification === 'terminal-success') {
          const resolution = await this.inspectAttemptResolutionImpl(attemptId);
          if (
            resolution.effectiveResolutionStatus === 'EFFECTIVE' &&
            resolution.effectiveDisposition === 'RESOLVED_SUCCESS'
          ) {
            const record = await this.inspectResolutionImpl(attemptId);
            if (
              record &&
              (!record.startupAllowed || input.fromVersion < record.observedUserVersion)
            ) {
              throw fail(
                'ACTIVE_ATTEMPT_EXISTS',
                'A resolved-success attempt does not authorize the requested migration plan.',
              );
            }
          }
        }
        continue;
      }

      const resolution = await this.inspectAttemptResolutionImpl(attemptId);
      if (resolution.effectiveResolutionStatus === 'CORRUPT') {
        throw fail(
          'ATTEMPT_CORRUPT',
          'A corrupt resolution sidecar exists and requires reconciliation before a new attempt.',
        );
      }
      if (
        resolution.effectiveResolutionStatus === 'ABSENT' ||
        resolution.effectiveResolutionStatus === 'STALE'
      ) {
        throw fail(
          'ACTIVE_ATTEMPT_EXISTS',
          'An unresolved or stale migration attempt blocks a new attempt.',
        );
      }

      if (resolution.manualActionRequired) {
        throw fail(
          'ACTIVE_ATTEMPT_EXISTS',
          'The effective resolution requires manual action before a new attempt.',
        );
      }

      const record = await this.inspectResolutionImpl(attemptId);
      if (record === null) {
        throw fail(
          'ACTIVE_ATTEMPT_EXISTS',
          'An unresolved migration attempt blocks a new attempt.',
        );
      }

      const observedVersion = record.observedUserVersion;
      const attemptTargetVersion = inspection.records[0]!.attempt.targetVersion;

      if (record.disposition === 'RESOLVED_SUCCESS') {
        if (
          !record.startupAllowed ||
          input.fromVersion < observedVersion ||
          input.targetVersion <= input.fromVersion
        ) {
          throw fail(
            'ACTIVE_ATTEMPT_EXISTS',
            'A resolved-success attempt does not authorize the requested migration plan.',
          );
        }
        continue;
      }

      if (!record.newAttemptAllowed) {
        throw fail(
          'ACTIVE_ATTEMPT_EXISTS',
          'The effective resolution does not authorize a new attempt.',
        );
      }

      if (
        input.fromVersion !== observedVersion ||
        input.targetVersion <= input.fromVersion ||
        input.targetVersion < attemptTargetVersion
      ) {
        throw fail(
          'ACTIVE_ATTEMPT_EXISTS',
          'The effective resolution does not match the requested migration plan.',
        );
      }
    }
  }

  private async createAttemptImpl(
    input: MigrationJournalAttemptInput,
  ): Promise<{ attemptId: string }> {
    // Request-aware permission evaluation, coordinated with concurrent same-instance attempt
    // operations. All matching attempt queues are held during scan, evaluation, and creation
    // so the observed state cannot change between the permission decision and the exclusive
    // attempt-file creation.
    return this.withMatchingAttemptQueues(async (matchingAttemptIds) => {
      await this.assertCreateAttemptPermission(input, matchingAttemptIds);

      // Generate and validate attemptId.
      const attemptId = this.idGenerator.generate();
      validateAttemptId(attemptId);

      // Ensure journal root exists.
      await this.ensureJournalRoot();

      // Build header record.
      const header = this.buildHeaderRecord(attemptId, input);

      // Write the attempt file.
      const filePath = this.attemptFilePath(attemptId);
      await this.writeNewAttempt(filePath, attemptId, header);

      return { attemptId };
    });
  }

  public async transition(
    attemptId: string,
    state: MigrationJournalState,
    details?: MigrationJournalDetails,
  ): Promise<void> {
    return this.enqueueTask(attemptId, () =>
      this.transitionImpl(attemptId, state, details, undefined),
    );
  }

  public async markFailed(attemptId: string, failure: MigrationJournalFailure): Promise<void> {
    return this.enqueueTask(attemptId, () =>
      this.transitionImpl(attemptId, 'FAILED', undefined, failure),
    );
  }

  // ---------------------------------------------------------------------------
  // Inspection and scanner API (additive, not on the port)
  // ---------------------------------------------------------------------------

  public async listAttempts(): Promise<AttemptSummary[]> {
    const results: AttemptSummary[] = [];

    let entries: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[];
    try {
      const { readdir } = await import('node:fs/promises');
      const dirents = await readdir(this.journalRootWindows(), { withFileTypes: true });
      entries = dirents;
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith(JSONL_EXTENSION)) continue;
      // Resolution sidecars share the .jsonl suffix but are not attempt files.
      if (entry.name.endsWith(RESOLUTION_EXTENSION)) continue;
      if (entry.isDirectory()) continue;

      const attemptId = entry.name.slice(0, -JSONL_EXTENSION.length);

      // Skip symlinks.
      if (entry.isSymbolicLink()) {
        results.push({
          attemptId,
          classification: 'corrupt',
          identityHash: '',
          latestState: null,
          terminal: false,
          corrupt: true,
          issue: 'Symlink entry is unsafe.',
        });
        continue;
      }

      try {
        const inspection = await this.inspectAttempt(attemptId);
        results.push({
          attemptId,
          classification: inspection.recoveryClassification,
          identityHash: inspection.identityHash,
          latestState: inspection.latestState,
          terminal: inspection.terminal,
          corrupt: inspection.corrupt,
          issue: inspection.issues.length > 0 ? inspection.issues.join('; ') : undefined,
        });
      } catch {
        results.push({
          attemptId,
          classification: 'corrupt',
          identityHash: '',
          latestState: null,
          terminal: false,
          corrupt: true,
          issue: 'Failed to inspect attempt.',
        });
      }
    }

    return results;
  }

  public async listNonTerminalAttempts(): Promise<AttemptSummary[]> {
    const all = await this.listAttempts();
    // Returns attempts that must block a new attempt for this database identity:
    //   - valid non-terminal attempts
    //   - reconciliation-required attempts (FAILED with a possible committed mutation, or a
    //     non-terminal attempt that already has committed steps)
    //   - corrupt / partial matching attempts (a corrupt attempt whose identity is unreadable is
    //     conservatively treated as matching, since it cannot be proven to belong elsewhere)
    // Clean SUCCEEDED and safe pre-transaction FAILED attempts are excluded so a later attempt
    // is allowed after a successful upgrade or a failure that provably preceded any transaction.
    return all.filter((a) => {
      if (a.classification === 'terminal-success' || a.classification === 'terminal-failure') {
        return false;
      }
      if (a.identityHash === this.databaseRef.identityHash) {
        return true;
      }
      // A corrupt attempt whose database identity cannot be read may belong to this database;
      // conservatively surface it so the caller blocks and reconciles.
      if (a.classification === 'corrupt' && a.identityHash === '') {
        return true;
      }
      return false;
    });
  }

  public async inspectAttempt(attemptId: string): Promise<AttemptInspection> {
    validateAttemptId(attemptId);
    // Serialize the read with same-attempt writes so a concurrent transition cannot expose a
    // transient half-write to this reader within the same journal instance.
    return this.enqueueTask(attemptId, () => this.inspectAttemptImpl(attemptId));
  }

  private async inspectAttemptImpl(attemptId: string): Promise<AttemptInspection> {
    const filePath = this.attemptFilePath(attemptId);

    // lstat to check it is a regular file.
    let stat: { isFile(): boolean; isSymbolicLink(): boolean };
    try {
      stat = lstatSync(filePath);
    } catch {
      throw fail('ATTEMPT_NOT_FOUND', 'Attempt file not found.');
    }

    if (stat.isSymbolicLink()) {
      throw fail('UNSAFE_FILESYSTEM_ENTRY', 'Attempt file is a symlink.');
    }
    if (!stat.isFile()) {
      throw fail('ATTEMPT_NOT_FOUND', 'Attempt path is not a regular file.');
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail('ATTEMPT_CORRUPT', 'Failed to read attempt file.', error);
    }

    const parsed = parseAttemptContent(content, attemptId);

    // Derive inspection fields.
    const completedMigrationIds: string[] = [];
    let currentMigrationId: string | null = null;
    let currentCommittedVersion: number | null = null;
    let backupId: string | null = null;

    for (const rec of parsed.records) {
      if (rec.state === 'COMMITTED' && rec.step?.migrationId) {
        completedMigrationIds.push(rec.step.migrationId);
      }
      if (rec.backup?.backupId) {
        backupId = rec.backup.backupId;
      }
    }

    // Current migration: last unmatched TRANSACTION_STARTED.
    const lastStarted = findLastUnmatchedStarted(parsed.records);
    if (lastStarted?.step) {
      currentMigrationId = lastStarted.step.migrationId;
    }

    // Current committed version.
    const lastCommitted = findLastCommitted(parsed.records);
    if (lastCommitted?.step) {
      currentCommittedVersion = lastCommitted.step.toVersion;
    } else if (parsed.records.length > 0) {
      currentCommittedVersion = parsed.records[0]!.attempt.fromVersion;
    }

    const recoveryClassification = classifyAttemptFromParsed(parsed);

    return {
      attemptId,
      identityHash: parsed.records.length > 0 ? parsed.records[0]!.database.identityHash : '',
      records: parsed.records,
      latestState: parsed.latestState,
      terminal: parsed.terminal,
      completedMigrationIds,
      currentMigrationId,
      currentCommittedVersion,
      backupId,
      corrupt: parsed.corrupt,
      issues: parsed.issues,
      trailingPartialRecord: parsed.trailingPartialRecord,
      recoveryClassification,
    };
  }

  public async classifyAttempt(attemptId: string): Promise<AttemptClassification> {
    const inspection = await this.inspectAttempt(attemptId);
    return inspection.recoveryClassification;
  }
  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private journalRootWindows(): string {
    return this.journalRoot.replace(/\//g, '\\');
  }

  private attemptFilePath(attemptId: string): string {
    return winPath.join(this.journalRootWindows(), attemptId + JSONL_EXTENSION);
  }

  private async ensureJournalRoot(): Promise<void> {
    const rootWin = this.journalRootWindows();

    // Check existing path.
    let existingStat: ReturnType<typeof lstatSync> | undefined;
    try {
      existingStat = lstatSync(rootWin);
    } catch {
      // Does not exist, will create below.
    }

    if (existingStat) {
      if (existingStat.isSymbolicLink()) {
        throw fail('UNSAFE_FILESYSTEM_ENTRY', 'journalRoot must not be a symlink or junction.');
      }
      if (existingStat.isFile()) {
        throw fail('UNSAFE_FILESYSTEM_ENTRY', 'journalRoot must not be a file.');
      }
      if (!existingStat.isDirectory()) {
        throw fail('UNSAFE_FILESYSTEM_ENTRY', 'journalRoot must be a directory.');
      }
      return;
    }

    try {
      await mkdir(rootWin, { recursive: true });
    } catch (error) {
      throw fail('WRITE_FAILED', 'Failed to create journal root directory.', error);
    }
  }

  private buildHeaderRecord(attemptId: string, input: MigrationJournalAttemptInput): JournalRecord {
    const format: JournalRecordFormat = {
      version: JOURNAL_FORMAT_VERSION,
      appVersion: this.appVersion,
    };
    const database: JournalRecordDatabase = {
      identityHash: this.databaseRef.identityHash,
      managed: this.databaseRef.managed,
    };
    const attempt: JournalRecordAttempt = {
      attemptId,
      fromVersion: input.fromVersion,
      targetVersion: input.targetVersion,
    };

    return buildRecord({
      sequence: 0,
      previousChecksum: null,
      timestamp: this.clock.now().toISOString(),
      state: 'CREATED',
      format,
      database,
      attempt,
    });
  }

  private buildTransitionRecord(
    attemptId: string,
    state: MigrationJournalState,
    previousRecord: JournalRecord,
    details: MigrationJournalDetails | undefined,
    failure: MigrationJournalFailure | undefined,
  ): JournalRecord {
    const format: JournalRecordFormat = {
      version: JOURNAL_FORMAT_VERSION,
      appVersion: this.appVersion,
    };
    const database: JournalRecordDatabase = {
      identityHash: this.databaseRef.identityHash,
      managed: this.databaseRef.managed,
    };
    const attempt: JournalRecordAttempt = {
      attemptId,
      fromVersion: previousRecord.attempt.fromVersion,
      targetVersion: previousRecord.attempt.targetVersion,
    };

    const step: JournalRecordStep | undefined =
      details?.migrationId !== undefined ||
      details?.fromVersion !== undefined ||
      details?.toVersion !== undefined
        ? ({
            migrationId: details.migrationId ?? '',
            fromVersion: details.fromVersion ?? 0,
            toVersion: details.toVersion ?? 0,
          } as JournalRecordStep)
        : undefined;

    const backup: JournalRecordBackup | undefined =
      details?.backupId !== undefined
        ? ({ backupId: details.backupId } as JournalRecordBackup)
        : undefined;

    const duration: JournalRecordDuration | undefined =
      details?.durationMs !== undefined
        ? ({ durationMs: details.durationMs } as JournalRecordDuration)
        : undefined;

    const failureRecord: JournalRecordFailure | undefined = failure
      ? ({
          code: failure.code,
          safeMessage: sanitizeFailureMessage(failure.code, failure.message),
        } as JournalRecordFailure)
      : undefined;

    return buildRecord({
      sequence: previousRecord.sequence + 1,
      previousChecksum: previousRecord.checksum,
      timestamp: this.clock.now().toISOString(),
      state,
      format,
      database,
      attempt,
      step,
      backup,
      duration,
      failure: failureRecord,
    });
  }

  private async writeNewAttempt(
    filePath: string,
    attemptId: string,
    header: JournalRecord,
  ): Promise<void> {
    let handle: FileHandle | undefined;
    let phase: 'open' | 'write' | 'sync' | 'close' = 'open';
    try {
      // Call beforeFirstWrite hook.
      await this.writeHooks?.beforeFirstWrite?.(attemptId);

      // Open with exclusive creation.
      phase = 'open';
      handle = await open(filePath, 'wx');

      const line = JSON.stringify(header) + '\n';
      phase = 'write';
      await handle.writeFile(line, 'utf8');

      // Call afterWriteBeforeSync hook. Entering the sync window: a failure here means the record
      // may be buffered but not durably synced.
      phase = 'sync';
      await this.writeHooks?.afterWriteBeforeSync?.(attemptId);

      // Sync.
      await handle.sync();

      // Call afterSyncBeforeClose hook. The record is synced; a failure here only affects close.
      phase = 'close';
      await this.writeHooks?.afterSyncBeforeClose?.(attemptId);

      // Close.
      await handle.close();
      handle = undefined;
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      // Check for collision (EEXIST).
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        throw fail('ATTEMPT_COLLISION', 'Attempt file already exists.', error);
      }
      if (phase === 'sync') {
        throw fail('SYNC_FAILED', 'Failed to sync the new attempt file to disk.', error);
      }
      throw fail('WRITE_FAILED', 'Failed to write new attempt file.', error);
    }

    // Verify the written file.
    await this.verifyWrittenFile(filePath, attemptId, header);
  }

  private async verifyWrittenFile(
    filePath: string,
    attemptId: string,
    expectedHeader: JournalRecord,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail('READ_VERIFICATION_FAILED', 'Failed to read back written attempt file.', error);
    }

    const parsed = parseAttemptContent(content, attemptId);
    if (parsed.corrupt || parsed.records.length !== 1) {
      throw fail('READ_VERIFICATION_FAILED', 'Written attempt file failed verification.');
    }

    const written = parsed.records[0]!;
    if (written.checksum !== expectedHeader.checksum) {
      throw fail('READ_VERIFICATION_FAILED', 'Written header checksum does not match expected.');
    }
    if (written.sequence !== 0) {
      throw fail('READ_VERIFICATION_FAILED', 'Written header sequence is not 0.');
    }
  }

  private async transitionImpl(
    attemptId: string,
    state: MigrationJournalState,
    details: MigrationJournalDetails | undefined,
    failure: MigrationJournalFailure | undefined,
  ): Promise<void> {
    validateAttemptId(attemptId);
    const filePath = this.attemptFilePath(attemptId);

    // lstat to check it is a regular file.
    let stat: { isFile(): boolean; isSymbolicLink(): boolean };
    try {
      stat = lstatSync(filePath);
    } catch {
      throw fail('ATTEMPT_NOT_FOUND', 'Attempt file not found.');
    }

    if (stat.isSymbolicLink()) {
      throw fail('UNSAFE_FILESYSTEM_ENTRY', 'Attempt file is a symlink.');
    }
    if (!stat.isFile()) {
      throw fail('ATTEMPT_NOT_FOUND', 'Attempt path is not a regular file.');
    }

    // Read and parse current content.
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail('ATTEMPT_CORRUPT', 'Failed to read attempt file.', error);
    }

    const parsed = parseAttemptContent(content, attemptId);

    // Validate the transition.
    validateTransition(parsed, state, details, failure);

    // Build the next record.
    const previousRecord = parsed.records[parsed.records.length - 1]!;
    const nextRecord = this.buildTransitionRecord(
      attemptId,
      state,
      previousRecord,
      details,
      failure,
    );

    // Call beforeAppend hook.
    await this.writeHooks?.beforeAppend?.(attemptId);

    // Append the record.
    await this.appendRecord(filePath, attemptId, nextRecord);
  }

  private async appendRecord(
    filePath: string,
    attemptId: string,
    record: JournalRecord,
  ): Promise<void> {
    let handle: FileHandle | undefined;
    let phase: 'open' | 'write' | 'sync' | 'close' = 'open';
    try {
      phase = 'open';
      handle = await open(filePath, 'a');

      const line = JSON.stringify(record) + '\n';
      phase = 'write';
      await handle.writeFile(line, 'utf8');

      // Call afterWriteBeforeSync hook. Entering the sync window.
      phase = 'sync';
      await this.writeHooks?.afterWriteBeforeSync?.(attemptId);

      // Sync.
      await handle.sync();

      // Call afterSyncBeforeClose hook. The record is synced.
      phase = 'close';
      await this.writeHooks?.afterSyncBeforeClose?.(attemptId);

      await handle.close();
      handle = undefined;
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      if (phase === 'sync') {
        throw fail('SYNC_FAILED', 'Failed to sync the appended record to disk.', error);
      }
      throw fail('WRITE_FAILED', 'Failed to append record to attempt file.', error);
    }

    // Read back and verify the appended record. This distinguishes a read-verification failure
    // from a write/sync failure and never deletes a possibly-valid written record.
    await this.verifyAppendedRecord(filePath, record);
  }

  private async verifyAppendedRecord(filePath: string, expected: JournalRecord): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail(
        'READ_VERIFICATION_FAILED',
        'Failed to read back attempt file after append.',
        error,
      );
    }
    const parsed = parseAttemptContent(content, expected.attempt.attemptId);
    const last = parsed.records[parsed.records.length - 1];
    if (
      !last ||
      last.sequence !== expected.sequence ||
      last.checksum !== expected.checksum ||
      last.state !== expected.state
    ) {
      throw fail('READ_VERIFICATION_FAILED', 'Appended record failed read-back verification.');
    }
  }

  // ---------------------------------------------------------------------------
  // Resolution sidecar API (P1.5B2A, additive, not on MigrationJournalPort)
  // ---------------------------------------------------------------------------

  /**
   * Append exactly one immutable resolution sidecar record for an attempt. The original attempt
   * journal file is never modified. The sidecar is exclusively created, synced, and read-verified
   * before this method returns. A second append for the same attempt always fails without
   * overwriting, truncating, or repairing the existing sidecar.
   */
  public async appendResolution(
    attemptId: string,
    input: MigrationResolutionInput,
  ): Promise<MigrationResolutionRecord> {
    validateAttemptId(attemptId);
    if (input === null || typeof input !== 'object') {
      throw fail('INVALID_RESOLUTION', 'Resolution input must be an object.');
    }
    return this.enqueueTask(attemptId, () => this.appendResolutionImpl(attemptId, input));
  }

  /**
   * Inspect a resolution sidecar. Returns null when no sidecar exists. Rejects symlinks,
   * junctions, non-regular files, and any malformed, multi-record, partial, checksum-mismatched,
   * or self-inconsistent sidecar. Never modifies any file or the database. Returns a deeply
   * immutable defensive copy.
   */
  public async inspectResolution(attemptId: string): Promise<MigrationResolutionInspection | null> {
    validateAttemptId(attemptId);
    return this.enqueueTask(attemptId, () => this.inspectResolutionImpl(attemptId));
  }
  /**
   * Inspect and classify an attempt's resolution sidecar. Returns a read-only classification
   * result that communicates whether the resolution is absent, effective, stale, or corrupt.
   *
   * This method is additive and does not modify any file. It does not change the observable
   * behavior of createAttempt, listNonTerminalAttempts, classifyAttempt, or any other method.
   */
  public async inspectAttemptResolution(attemptId: string): Promise<AttemptResolutionInspection> {
    validateAttemptId(attemptId);
    return this.enqueueTask(attemptId, () => this.inspectAttemptResolutionImpl(attemptId));
  }

  private async inspectAttemptResolutionImpl(
    attemptId: string,
  ): Promise<AttemptResolutionInspection> {
    // 1. Inspect the original attempt using the existing shared implementation.
    // ATTEMPT_NOT_FOUND and UNSAFE_FILESYSTEM_ENTRY propagate naturally; unknown errors must not
    // be silently converted into a CORRUPT classification.
    const attemptInspection = await this.inspectAttemptImpl(attemptId);

    // 2. Preserve the existing journal-only classification.
    const classification = attemptInspection.recoveryClassification;

    // 3. If the original attempt itself is corrupt, partial, unsupported, link-backed, or
    //    non-regular, do not report an Effective Resolution. The resolution sidecar cannot
    //    override a corrupt original attempt.
    if (attemptInspection.corrupt || attemptInspection.records.length === 0) {
      return buildAbsentResolutionResult(attemptId, classification);
    }

    // 4. Inspect the resolution sidecar. Catch known corruption errors and convert them to
    //    the fail-closed CORRUPT classification.
    let resolutionRecord: MigrationResolutionRecord | null;
    try {
      resolutionRecord = await this.inspectResolutionImpl(attemptId);
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError && error.code === 'RESOLUTION_CORRUPT') {
        return buildCorruptResolutionResult(attemptId, classification);
      }
      // Unknown programming errors must not be silently converted into CORRUPT.
      throw error;
    }

    // 5. No sidecar exists.
    if (resolutionRecord === null) {
      return buildAbsentResolutionResult(attemptId, classification);
    }

    // 6. Compare attemptLatestChecksum with the original attempt's current latest checksum.
    const latestValidChecksum =
      attemptInspection.records[attemptInspection.records.length - 1]!.checksum;
    if (resolutionRecord.attemptLatestChecksum !== latestValidChecksum) {
      return buildStaleResolutionResult(attemptId, classification, resolutionRecord);
    }

    // 7. Reconstruct the resolution input from the persisted record.
    const resolutionInput: MigrationResolutionInput = {
      disposition: resolutionRecord.disposition,
      planFingerprint: resolutionRecord.planFingerprint,
      attemptLatestChecksum: resolutionRecord.attemptLatestChecksum,
      observedUserVersion: resolutionRecord.observedUserVersion,
      observedHistoryFingerprint: resolutionRecord.observedHistoryFingerprint,
      observedCompletedMigrationIds: [...resolutionRecord.observedCompletedMigrationIds],
      observedCurrentMigrationId: resolutionRecord.observedCurrentMigrationId,
      backupId: resolutionRecord.backupId,
      backupVerified: resolutionRecord.backupVerified,
      startupAllowed: resolutionRecord.startupAllowed,
      newAttemptAllowed: resolutionRecord.newAttemptAllowed,
      manualActionRequired: resolutionRecord.manualActionRequired,
      safeReasonCode: resolutionRecord.safeReasonCode,
    };

    // 8. Reuse validateResolutionAgainstAttempt. Return STALE if compatibility validation fails.
    try {
      validateResolutionAgainstAttempt(
        resolutionInput,
        attemptInspection,
        attemptInspection.records[0]!.attempt.fromVersion,
        attemptInspection.records[0]!.attempt.targetVersion,
      );
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError && error.code === 'INVALID_RESOLUTION') {
        return buildStaleResolutionResult(attemptId, classification, resolutionRecord);
      }
      throw error;
    }

    // 9. Return EFFECTIVE only after all checks pass.
    return buildEffectiveResolutionResult(attemptId, classification, resolutionRecord);
  }

  private resolutionFilePath(attemptId: string): string {
    return winPath.join(this.journalRootWindows(), attemptId + RESOLUTION_EXTENSION);
  }

  private async appendResolutionImpl(
    attemptId: string,
    input: MigrationResolutionInput,
  ): Promise<MigrationResolutionRecord> {
    const resolutionPath = this.resolutionFilePath(attemptId);

    // Pre-check: a sidecar must not already exist. Exclusive creation below is the hard guard.
    try {
      lstatSync(resolutionPath);
      throw fail(
        'RESOLUTION_ALREADY_EXISTS',
        'A resolution sidecar already exists for this attempt.',
      );
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError) throw error;
      // ENOENT is expected; proceed.
    }

    // Require a structurally healthy original attempt (no corruption, no partial trailing
    // record, supported format). inspectAttemptImpl throws ATTEMPT_NOT_FOUND when missing.
    const inspection = await this.inspectAttemptImpl(attemptId);
    if (inspection.corrupt || inspection.records.length === 0) {
      throw fail('ATTEMPT_CORRUPT', 'Cannot append a resolution to a corrupt or partial attempt.');
    }
    const header = inspection.records[0]!;
    const attemptFromVersion = header.attempt.fromVersion;
    const attemptTargetVersion = header.attempt.targetVersion;
    const latestValidChecksum = inspection.records[inspection.records.length - 1]!.checksum;

    // Stale-plan protection: the attempt must not have changed after the plan was produced.
    if (input.attemptLatestChecksum !== latestValidChecksum) {
      throw fail(
        'STALE_RESOLUTION_PLAN',
        'The attempt changed after the resolution plan was produced.',
      );
    }

    // Full input validation against the original attempt header.
    validateResolutionInput(input, attemptFromVersion, attemptTargetVersion);
    // Validate the disposition against the immutable recorded attempt history so a resolution
    // cannot contradict the journal (substituted backup IDs, invented committed IDs, impossible
    // state combinations, etc.).
    validateResolutionAgainstAttempt(input, inspection, attemptFromVersion, attemptTargetVersion);

    const timestamp = this.clock.now().toISOString();
    const record = buildResolutionRecord(attemptId, input, timestamp);

    await this.writeResolutionFile(resolutionPath, attemptId, record);
    return deepFreezeResolution(record);
  }

  private async inspectResolutionImpl(
    attemptId: string,
  ): Promise<MigrationResolutionInspection | null> {
    const filePath = this.resolutionFilePath(attemptId);

    let stat: { isFile(): boolean; isSymbolicLink(): boolean };
    try {
      stat = lstatSync(filePath);
    } catch {
      // No sidecar exists.
      return null;
    }

    if (stat.isSymbolicLink()) {
      throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar is a symlink or junction.');
    }
    if (!stat.isFile()) {
      throw fail('RESOLUTION_CORRUPT', 'Resolution sidecar is not a regular file.');
    }

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail('RESOLUTION_CORRUPT', 'Failed to read resolution sidecar.', error);
    }

    const record = parseResolutionContent(content, attemptId);
    return deepFreezeResolution(record);
  }

  /** Exclusively create, write, fsync, close, and read-verify the resolution sidecar. */
  private async writeResolutionFile(
    filePath: string,
    attemptId: string,
    record: MigrationResolutionRecord,
  ): Promise<void> {
    let handle: FileHandle | undefined;
    let phase: 'open' | 'write' | 'sync' | 'close' = 'open';
    try {
      await this.writeHooks?.beforeResolutionFirstWrite?.(attemptId);

      phase = 'open';
      handle = await open(filePath, 'wx');

      const line = JSON.stringify(record) + '\n';
      phase = 'write';
      await handle.writeFile(line, 'utf8');

      phase = 'sync';
      await this.writeHooks?.afterResolutionWriteBeforeSync?.(attemptId);
      await handle.sync();

      phase = 'close';
      await this.writeHooks?.afterResolutionSyncBeforeClose?.(attemptId);
      await handle.close();
      handle = undefined;
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
      if (error instanceof PersistentMigrationJournalError) throw error;
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        throw fail('RESOLUTION_ALREADY_EXISTS', 'A resolution sidecar already exists.', error);
      }
      if (phase === 'sync') {
        throw fail(
          'RESOLUTION_SYNC_FAILED',
          'Failed to sync the resolution sidecar to disk.',
          error,
        );
      }
      throw fail('RESOLUTION_WRITE_FAILED', 'Failed to write the resolution sidecar.', error);
    }

    // The record is closed and synced. The hook below runs before read-back verification so a
    // test can corrupt the on-disk file to simulate a read-verification failure.
    await this.writeHooks?.afterResolutionCloseBeforeVerify?.(attemptId);

    await this.verifyWrittenResolution(filePath, attemptId, record);
  }

  private async verifyWrittenResolution(
    filePath: string,
    attemptId: string,
    expected: MigrationResolutionRecord,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      throw fail(
        'RESOLUTION_READ_VERIFICATION_FAILED',
        'Failed to read back the resolution sidecar.',
        error,
      );
    }
    let parsed: MigrationResolutionRecord;
    try {
      parsed = parseResolutionContent(content, attemptId);
    } catch (error) {
      // During write verification, any read-back parse failure (including one that would be
      // RESOLUTION_CORRUPT during inspection) is reported as a read-verification failure so the
      // caller never mistakes a failed verify for a clean write.
      throw fail(
        'RESOLUTION_READ_VERIFICATION_FAILED',
        'Written resolution sidecar failed read-back verification.',
        error,
      );
    }
    if (parsed.checksum !== expected.checksum) {
      throw fail(
        'RESOLUTION_READ_VERIFICATION_FAILED',
        'Written resolution checksum does not match the expected checksum.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Concurrency: per-attemptId serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize operations for a single attemptId so that, within one journal instance, a read
   * (inspectAttempt) never observes a transient half-write from a concurrent transition/markFailed
   * and concurrent writes for the same attempt are ordered. Unrelated attempt files proceed
   * independently. Rejected operations do not poison the queue. This does NOT coordinate across
   * separate journal instances or processes.
   */
  private async enqueueTask<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(attemptId) ?? Promise.resolve();
    const next = prev.then(
      () => fn(),
      () => fn(), // Previous rejection does not poison the queue.
    );
    this.queues.set(attemptId, next);
    try {
      return await next;
    } finally {
      // Clean up the queue entry if it is still this one.
      if (this.queues.get(attemptId) === next) {
        this.queues.delete(attemptId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

function classifyAttemptFromParsed(parsed: ParsedAttempt): AttemptClassification {
  if (parsed.corrupt) return 'corrupt';
  if (parsed.terminal) {
    if (parsed.latestState === 'SUCCEEDED') return 'terminal-success';
    if (parsed.latestState === 'FAILED') {
      // Conservative FAILED classification. The journal alone cannot prove the database state
      // once a transaction has started, so a FAILED attempt is reconciliation-required whenever
      // any committed mutation exists OR the latest pre-failure state is TRANSACTION_STARTED,
      // COMMITTED, or POST_VALIDATION_PASSED. A FAILED attempt is only safe-to-retry (and thus
      // terminal-failure) when every recorded state proves the failure preceded any transaction:
      // the latest pre-failure state is CREATED, PREFLIGHT_VALIDATED, or BACKUP_VERIFIED and no
      // COMMITTED record exists. No formal MigrationJournalState values are added.
      const hasCommitted = parsed.records.some((r) => r.state === 'COMMITTED');
      const preFailureState =
        parsed.records.length >= 2
          ? (parsed.records[parsed.records.length - 2]!.state as MigrationJournalState)
          : null;
      const safePreMutation =
        preFailureState === 'CREATED' ||
        preFailureState === 'PREFLIGHT_VALIDATED' ||
        preFailureState === 'BACKUP_VERIFIED';
      if (hasCommitted || !safePreMutation) {
        return 'reconciliation-required';
      }
      return 'terminal-failure';
    }
  }
  // Non-terminal: reconciliation-required if any committed step exists, else still in progress.
  if (!parsed.terminal && parsed.records.some((r) => r.state === 'COMMITTED')) {
    return 'reconciliation-required';
  }
  return 'non-terminal';
}
