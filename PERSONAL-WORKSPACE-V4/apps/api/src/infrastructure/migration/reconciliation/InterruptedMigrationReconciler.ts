/**
 * InterruptedMigrationReconciler: read-only inspection and immutable planning for interrupted
 * migration attempts.
 *
 * The Reconciler determines what most likely happened after an interrupted migration without
 * modifying the database, the original attempt journal, the resolution sidecar, or any backup.
 * It produces a deeply immutable discriminated-union inspection result that either contains a
 * safe ReconciliationPlan (for P1.5B3B to apply) or a BLOCKED status with a bounded reason code.
 *
 * P1.5B3A is strictly read-only. It never calls appendResolution, never writes a sidecar, never
 * modifies createAttempt, never modifies SchemaMigrationRunner, and never performs startup
 * integration, restore, or repair.
 */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MigrationStateInspector } from '../MigrationStateInspector';
import type { HistoryRow } from '../MigrationStateInspector';
import type { PersistentMigrationJournal } from '../journal/PersistentMigrationJournal';
import {
  PersistentMigrationJournalError,
  type AttemptInspection,
  type ResolutionDisposition,
  type MigrationResolutionInput,
  type MigrationResolutionRecord,
} from '../journal/journal-types';

// ---------------------------------------------------------------------------
// Minimal ports (current-use only, defined here so no other file is modified)
// ---------------------------------------------------------------------------

/** Opens a read-only DatabaseSync handle. The Reconciler owns and closes it. */
export interface ReadOnlyDatabaseOpener {
  open(): DatabaseSync;
}

/** Minimal read-only backup-evidence verifier. */
export interface BackupEvidenceVerifier {
  verifyBackupEvidence(backupId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Public inspection statuses
// ---------------------------------------------------------------------------

export type ReconciliationInspectionStatus =
  'SAFE_PLAN' | 'ALREADY_RESOLVED' | 'NO_ACTION_REQUIRED' | 'BLOCKED';

// ---------------------------------------------------------------------------
// Reconciliation plan (SAFE_PLAN payload)
// ---------------------------------------------------------------------------

/** Immutable reconciliation plan compatible with MigrationResolutionInput. */
export interface ReconciliationPlan {
  readonly attemptId: string;
  readonly disposition: ResolutionDisposition;
  readonly planFingerprint: string;
  readonly attemptLatestChecksum: string;
  readonly observedUserVersion: number;
  readonly observedHistoryFingerprint: string;
  readonly observedCompletedMigrationIds: readonly string[];
  readonly observedCurrentMigrationId?: string | undefined;
  readonly backupId?: string | undefined;
  readonly backupVerified: boolean;
  readonly startupAllowed: boolean;
  readonly newAttemptAllowed: boolean;
  readonly manualActionRequired: boolean;
  readonly safeReasonCode: string;
}

// ---------------------------------------------------------------------------
// Discriminated union result
// ---------------------------------------------------------------------------

interface BaseInspection {
  readonly status: ReconciliationInspectionStatus;
  readonly attemptId: string;
}

export interface SafePlanInspection extends BaseInspection {
  readonly status: 'SAFE_PLAN';
  readonly plan: ReconciliationPlan;
}

export interface AlreadyResolvedInspection extends BaseInspection {
  readonly status: 'ALREADY_RESOLVED';
  readonly effectiveDisposition: ResolutionDisposition;
  readonly resolutionChecksum: string;
}

export interface NoActionRequiredInspection extends BaseInspection {
  readonly status: 'NO_ACTION_REQUIRED';
}

export interface BlockedInspection extends BaseInspection {
  readonly status: 'BLOCKED';
  readonly safeReasonCode: string;
  readonly manualActionRequired: true;
}

export type InterruptedMigrationReconciliationInspection =
  SafePlanInspection | AlreadyResolvedInspection | NoActionRequiredInspection | BlockedInspection;
// ---------------------------------------------------------------------------
// Application result types (P1.5B3B)
// ---------------------------------------------------------------------------

export type ReconciliationApplicationStatus =
  'APPLIED' | 'ALREADY_RESOLVED' | 'STALE_PLAN' | 'BLOCKED';

interface BaseApplicationResult {
  readonly status: ReconciliationApplicationStatus;
  readonly attemptId: string;
}

export interface AppliedReconciliationResult extends BaseApplicationResult {
  readonly status: 'APPLIED';
  readonly disposition: ResolutionDisposition;
  readonly planFingerprint: string;
  readonly resolutionChecksum: string;
}

export interface AlreadyResolvedReconciliationResult extends BaseApplicationResult {
  readonly status: 'ALREADY_RESOLVED';
  readonly disposition: ResolutionDisposition;
  readonly planFingerprint: string;
  readonly resolutionChecksum: string;
}

export interface StalePlanReconciliationResult extends BaseApplicationResult {
  readonly status: 'STALE_PLAN';
  readonly expectedPlanFingerprint: string;
  readonly currentInspectionStatus: ReconciliationInspectionStatus;
  readonly safeReasonCode: string;
  readonly manualActionRequired: false;
}

export interface BlockedReconciliationResult extends BaseApplicationResult {
  readonly status: 'BLOCKED';
  readonly safeReasonCode: string;
  readonly manualActionRequired: true;
}

export type ReconciliationApplicationResult =
  | AppliedReconciliationResult
  | AlreadyResolvedReconciliationResult
  | StalePlanReconciliationResult
  | BlockedReconciliationResult;

// ---------------------------------------------------------------------------
// Reason codes (bounded, path-free)
// ---------------------------------------------------------------------------

const BLOCKED_REASON = {
  STALE_EXISTING_RESOLUTION: 'STALE_EXISTING_RESOLUTION',
  CORRUPT_EXISTING_RESOLUTION: 'CORRUPT_EXISTING_RESOLUTION',
  DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS: 'DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS',
  DATABASE_FUTURE_SCHEMA: 'DATABASE_FUTURE_SCHEMA',
  DATABASE_HISTORY_INVALID: 'DATABASE_HISTORY_INVALID',
  DATABASE_CHECKSUM_MISMATCH: 'DATABASE_CHECKSUM_MISMATCH',
  LEGACY_DETECTION_REQUIRED: 'LEGACY_DETECTION_REQUIRED',
  DATABASE_STATE_AMBIGUOUS: 'DATABASE_STATE_AMBIGUOUS',
  ATTEMPT_DATABASE_RANGE_MISMATCH: 'ATTEMPT_DATABASE_RANGE_MISMATCH',
  BACKUP_EVIDENCE_UNAVAILABLE: 'BACKUP_EVIDENCE_UNAVAILABLE',
  ATTEMPT_CORRUPT: 'ATTEMPT_CORRUPT',
  ATTEMPT_NOT_FOUND: 'ATTEMPT_NOT_FOUND',
  UNEXPECTED_ATTEMPT_STATE: 'UNEXPECTED_ATTEMPT_STATE',
  SUCCEEDED_DATABASE_MISMATCH: 'SUCCEEDED_DATABASE_MISMATCH',
} as const;

const STALE_REASON = {
  PLAN_MISMATCH: 'PLAN_MISMATCH',
  NO_ACTION_REQUIRED_NOW: 'NO_ACTION_REQUIRED_NOW',
} as const;

// ---------------------------------------------------------------------------
// Input validation constants
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_STRING_MAX_LENGTH = 128;
const SAFE_REASON_MAX_LENGTH = 128;
const RESERVED_WINDOWS_NAMES = new Set([
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

const SUPPORTED_DISPOSITIONS: ReadonlySet<ResolutionDisposition> = new Set<ResolutionDisposition>([
  'SAFE_PRE_TRANSACTION_RETRY',
  'TRANSACTION_ROLLED_BACK',
  'COMMIT_CONFIRMED_FROM_DATABASE',
  'VALID_INTERMEDIATE_VERSION',
  'RESOLVED_SUCCESS',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Compute a deterministic history fingerprint from MigrationStateInspector history rows. */
function computeHistoryFingerprint(rows: readonly HistoryRow[]): string {
  const identities = rows.map((r) => ({
    migration_id: r.migration_id,
    from_version: r.from_version,
    to_version: r.to_version,
    checksum: r.checksum,
  }));
  return sha256(JSON.stringify(identities));
}

/** Compute a deterministic plan fingerprint from all safety-relevant plan fields. */
function computePlanFingerprint(plan: Omit<ReconciliationPlan, 'planFingerprint'>): string {
  const payload: Record<string, unknown> = {
    attemptId: plan.attemptId,
    disposition: plan.disposition,
    attemptLatestChecksum: plan.attemptLatestChecksum,
    observedUserVersion: plan.observedUserVersion,
    observedHistoryFingerprint: plan.observedHistoryFingerprint,
    observedCompletedMigrationIds: [...plan.observedCompletedMigrationIds],
    backupVerified: plan.backupVerified,
    startupAllowed: plan.startupAllowed,
    newAttemptAllowed: plan.newAttemptAllowed,
    manualActionRequired: plan.manualActionRequired,
    safeReasonCode: plan.safeReasonCode,
  };
  if (plan.observedCurrentMigrationId !== undefined) {
    payload.observedCurrentMigrationId = plan.observedCurrentMigrationId;
  }
  if (plan.backupId !== undefined) {
    payload.backupId = plan.backupId;
  }
  // Canonical key ordering via sorted keys in JSON.stringify is not guaranteed by default,
  // so we build an ordered object and use a replacer that sorts keys.
  const sorted = sortKeys(payload);
  return sha256(JSON.stringify(sorted));
}

/** Recursively sort object keys for deterministic serialization. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Deep-freeze a value and all nested objects/arrays. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function failValidation(message: string): never {
  throw new PersistentMigrationJournalError('INVALID_RESOLUTION', message);
}

function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    failValidation(field + ' must be a boolean.');
  }
  return value;
}

function validateNonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    failValidation(field + ' must be a finite non-negative integer.');
  }
  return value;
}

function validateHex64(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    failValidation(field + ' must be exactly 64 lowercase hexadecimal characters.');
  }
  return value;
}

function validateSafeString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    failValidation(field + ' must be a non-empty string.');
  }
  if (value.length > maxLength) {
    failValidation(field + ' exceeds the maximum length.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(value)) {
    failValidation(field + ' must not contain NUL or control characters.');
  }
  if (value.includes('/') || value.includes('\\') || value.includes(':')) {
    failValidation(field + ' must not contain path-like content.');
  }
  return value;
}

function validateAttemptIdForApply(value: unknown): string {
  const id = validateSafeString(value, 'attemptId', SAFE_STRING_MAX_LENGTH);
  if (id !== id.trim()) {
    failValidation('attemptId must not have leading or trailing whitespace.');
  }
  if (id.endsWith('.')) {
    failValidation('attemptId must not end with a dot.');
  }
  if (id.includes('*') || id.includes('?')) {
    failValidation('attemptId must not contain wildcard characters.');
  }
  const upperBase = id.toUpperCase().split('.')[0]!;
  if (RESERVED_WINDOWS_NAMES.has(upperBase)) {
    failValidation('attemptId must not be a reserved name.');
  }
  return id;
}

function validateDisposition(value: unknown): ResolutionDisposition {
  if (typeof value !== 'string' || !SUPPORTED_DISPOSITIONS.has(value as ResolutionDisposition)) {
    failValidation('Unsupported resolution disposition.');
  }
  return value as ResolutionDisposition;
}

function validateCompletedMigrationIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    failValidation('observedCompletedMigrationIds must be an array.');
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const id = validateSafeString(
      entry,
      'observedCompletedMigrationIds entry',
      SAFE_STRING_MAX_LENGTH,
    );
    if (seen.has(id)) {
      failValidation('observedCompletedMigrationIds must not contain duplicates.');
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function defensiveCopy(plan: ReconciliationPlan): ReconciliationPlan {
  const copy: ReconciliationPlan = {
    attemptId: plan.attemptId,
    disposition: plan.disposition,
    planFingerprint: plan.planFingerprint,
    attemptLatestChecksum: plan.attemptLatestChecksum,
    observedUserVersion: plan.observedUserVersion,
    observedHistoryFingerprint: plan.observedHistoryFingerprint,
    observedCompletedMigrationIds: Object.freeze([...plan.observedCompletedMigrationIds]),
    observedCurrentMigrationId: plan.observedCurrentMigrationId,
    backupId: plan.backupId,
    backupVerified: plan.backupVerified,
    startupAllowed: plan.startupAllowed,
    newAttemptAllowed: plan.newAttemptAllowed,
    manualActionRequired: plan.manualActionRequired,
    safeReasonCode: plan.safeReasonCode,
  };
  return deepFreeze(copy);
}

function validateAndCopyExpectedPlan(plan: unknown): ReconciliationPlan {
  if (plan === null || typeof plan !== 'object') {
    failValidation('Expected plan must be an object.');
  }
  const p = plan as Record<string, unknown>;

  const attemptId = validateAttemptIdForApply(p.attemptId);
  const disposition = validateDisposition(p.disposition);
  const planFingerprint = validateHex64(p.planFingerprint, 'planFingerprint');
  const attemptLatestChecksum = validateHex64(p.attemptLatestChecksum, 'attemptLatestChecksum');
  const observedHistoryFingerprint = validateHex64(
    p.observedHistoryFingerprint,
    'observedHistoryFingerprint',
  );
  const observedUserVersion = validateNonNegativeInteger(
    p.observedUserVersion,
    'observedUserVersion',
  );
  const observedCompletedMigrationIds = validateCompletedMigrationIds(
    p.observedCompletedMigrationIds,
  );
  const observedCurrentMigrationId =
    p.observedCurrentMigrationId === undefined
      ? undefined
      : validateSafeString(
          p.observedCurrentMigrationId,
          'observedCurrentMigrationId',
          SAFE_STRING_MAX_LENGTH,
        );
  const backupId =
    p.backupId === undefined
      ? undefined
      : validateSafeString(p.backupId, 'backupId', SAFE_STRING_MAX_LENGTH);
  const backupVerified = validateBoolean(p.backupVerified, 'backupVerified');
  const startupAllowed = validateBoolean(p.startupAllowed, 'startupAllowed');
  const newAttemptAllowed = validateBoolean(p.newAttemptAllowed, 'newAttemptAllowed');
  const manualActionRequired = validateBoolean(p.manualActionRequired, 'manualActionRequired');
  const safeReasonCode = validateSafeString(
    p.safeReasonCode,
    'safeReasonCode',
    SAFE_REASON_MAX_LENGTH,
  );

  if (manualActionRequired !== false) {
    failValidation('Expected plan must have manualActionRequired false.');
  }

  return defensiveCopy({
    attemptId,
    disposition,
    planFingerprint,
    attemptLatestChecksum,
    observedUserVersion,
    observedHistoryFingerprint,
    observedCompletedMigrationIds,
    observedCurrentMigrationId,
    backupId,
    backupVerified,
    startupAllowed,
    newAttemptAllowed,
    manualActionRequired,
    safeReasonCode,
  });
}

// ---------------------------------------------------------------------------
// Reconciler
// ---------------------------------------------------------------------------

export interface InterruptedMigrationReconcilerDeps {
  readonly journal: PersistentMigrationJournal;
  readonly inspector: MigrationStateInspector;
  readonly databaseOpener: ReadOnlyDatabaseOpener;
  readonly backupVerifier: BackupEvidenceVerifier;
}

export class InterruptedMigrationReconciler {
  private readonly journal: PersistentMigrationJournal;
  private readonly inspector: MigrationStateInspector;
  private readonly databaseOpener: ReadOnlyDatabaseOpener;
  private readonly backupVerifier: BackupEvidenceVerifier;
  private readonly queues = new Map<string, Promise<unknown>>();

  public constructor(deps: InterruptedMigrationReconcilerDeps) {
    this.journal = deps.journal;
    this.inspector = deps.inspector;
    this.databaseOpener = deps.databaseOpener;
    this.backupVerifier = deps.backupVerifier;
  }

  /**
   * Inspect an interrupted migration attempt and produce a read-only reconciliation result.
   * Never modifies the database, journal, sidecar, or any backup.
   */
  public async inspect(attemptId: string): Promise<InterruptedMigrationReconciliationInspection> {
    // 1. Inspect the original attempt. Only a missing attempt is mapped to BLOCKED;
    // programming errors (including an invalid attempt id) must propagate.
    let attemptInspection: AttemptInspection;
    try {
      attemptInspection = await this.journal.inspectAttempt(attemptId);
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError && error.code === 'ATTEMPT_NOT_FOUND') {
        return deepFreeze<BlockedInspection>({
          status: 'BLOCKED',
          attemptId,
          safeReasonCode: BLOCKED_REASON.ATTEMPT_NOT_FOUND,
          manualActionRequired: true,
        });
      }
      throw error;
    }

    if (attemptInspection.corrupt || attemptInspection.records.length === 0) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.ATTEMPT_CORRUPT,
        manualActionRequired: true,
      });
    }

    // 2. Inspect the resolution sidecar. The journal method itself classifies known
    // corruption and absent sidecars; unknown programming errors propagate.
    const resolutionInspection = await this.journal.inspectAttemptResolution(attemptId);

    // 3. Handle existing resolution.
    if (resolutionInspection.effectiveResolutionStatus === 'EFFECTIVE') {
      return deepFreeze<AlreadyResolvedInspection>({
        status: 'ALREADY_RESOLVED',
        attemptId,
        effectiveDisposition: resolutionInspection.effectiveDisposition!,
        resolutionChecksum: resolutionInspection.resolutionChecksum!,
      });
    }

    if (resolutionInspection.effectiveResolutionStatus === 'STALE') {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.STALE_EXISTING_RESOLUTION,
        manualActionRequired: true,
      });
    }

    if (resolutionInspection.effectiveResolutionStatus === 'CORRUPT') {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.CORRUPT_EXISTING_RESOLUTION,
        manualActionRequired: true,
      });
    }

    // 4. Open read-only database and inspect state.
    let db: DatabaseSync | undefined;
    let dbState;
    try {
      db = this.databaseOpener.open();
      // Set query_only for defense-in-depth.
      try {
        db.exec('PRAGMA query_only = ON');
      } catch {
        // If query_only is not supported, continue with readOnly mode from the opener.
      }
      dbState = this.inspector.inspect(db);
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Best-effort close.
        }
      }
    }

    // 5. Check database blockers.
    const blocker = this.checkDatabaseBlockers(attemptId, dbState, attemptInspection);
    if (blocker) return blocker;

    // 6. Determine disposition.
    return this.determineDisposition(attemptId, attemptInspection, dbState);
  }

  /**
   * Apply a previously returned ReconciliationPlan.
   *
   * This method always re-runs the read-only inspection before writing, compares every
   * safety-relevant field, and appends the resolution sidecar at most once. It returns a
   * deeply immutable, path-free application result.
   *
   * Cross-instance/process atomicity is intentionally not guaranteed: another process could
   * change the database or write a different resolution between reinspection and append. Those
   * races are reported honestly as STALE_PLAN or BLOCKED rather than claimed as APPLIED.
   */
  public async apply(expectedPlan: ReconciliationPlan): Promise<ReconciliationApplicationResult> {
    const plan = validateAndCopyExpectedPlan(expectedPlan);
    return this.enqueueApply(plan.attemptId, () => this.applyImpl(plan));
  }

  // -----------------------------------------------------------------------
  // Apply implementation
  // -----------------------------------------------------------------------

  private async applyImpl(plan: ReconciliationPlan): Promise<ReconciliationApplicationResult> {
    const freshInspection = await this.inspect(plan.attemptId);

    switch (freshInspection.status) {
      case 'SAFE_PLAN': {
        if (!this.plansEqual(freshInspection.plan, plan)) {
          return deepFreeze<StalePlanReconciliationResult>({
            status: 'STALE_PLAN',
            attemptId: plan.attemptId,
            expectedPlanFingerprint: plan.planFingerprint,
            currentInspectionStatus: 'SAFE_PLAN',
            safeReasonCode: STALE_REASON.PLAN_MISMATCH,
            manualActionRequired: false,
          });
        }

        const resolutionInput = this.planToResolutionInput(freshInspection.plan);
        let record: MigrationResolutionRecord;
        try {
          record = await this.journal.appendResolution(plan.attemptId, resolutionInput);
        } catch (error) {
          if (error instanceof PersistentMigrationJournalError) {
            switch (error.code) {
              case 'STALE_RESOLUTION_PLAN':
                return deepFreeze<StalePlanReconciliationResult>({
                  status: 'STALE_PLAN',
                  attemptId: plan.attemptId,
                  expectedPlanFingerprint: plan.planFingerprint,
                  currentInspectionStatus: 'SAFE_PLAN',
                  safeReasonCode: error.code,
                  manualActionRequired: false,
                });
              case 'RESOLUTION_ALREADY_EXISTS':
                return await this.handleExistingResolution(plan);
              case 'RESOLUTION_CORRUPT':
                return deepFreeze<BlockedReconciliationResult>({
                  status: 'BLOCKED',
                  attemptId: plan.attemptId,
                  safeReasonCode: BLOCKED_REASON.CORRUPT_EXISTING_RESOLUTION,
                  manualActionRequired: true,
                });
              case 'ATTEMPT_CORRUPT':
                return deepFreeze<BlockedReconciliationResult>({
                  status: 'BLOCKED',
                  attemptId: plan.attemptId,
                  safeReasonCode: BLOCKED_REASON.ATTEMPT_CORRUPT,
                  manualActionRequired: true,
                });
              default:
                break;
            }
          }
          throw error;
        }

        await this.verifyAppliedRecord(plan.attemptId, record, freshInspection.plan);

        return deepFreeze<AppliedReconciliationResult>({
          status: 'APPLIED',
          attemptId: plan.attemptId,
          disposition: freshInspection.plan.disposition,
          planFingerprint: freshInspection.plan.planFingerprint,
          resolutionChecksum: record.checksum,
        });
      }

      case 'ALREADY_RESOLVED': {
        return await this.handleExistingResolution(plan);
      }

      case 'NO_ACTION_REQUIRED': {
        return deepFreeze<StalePlanReconciliationResult>({
          status: 'STALE_PLAN',
          attemptId: plan.attemptId,
          expectedPlanFingerprint: plan.planFingerprint,
          currentInspectionStatus: 'NO_ACTION_REQUIRED',
          safeReasonCode: STALE_REASON.NO_ACTION_REQUIRED_NOW,
          manualActionRequired: false,
        });
      }

      case 'BLOCKED': {
        return deepFreeze<BlockedReconciliationResult>({
          status: 'BLOCKED',
          attemptId: plan.attemptId,
          safeReasonCode: freshInspection.safeReasonCode,
          manualActionRequired: true,
        });
      }

      default: {
        const _exhaustive: never = freshInspection;
        void _exhaustive;
        throw new Error('Unexpected inspection status.');
      }
    }
  }

  private async enqueueApply<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(attemptId) ?? Promise.resolve();
    const next = previous.then(
      () => fn(),
      () => fn(),
    );
    this.queues.set(attemptId, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(attemptId) === next) {
        this.queues.delete(attemptId);
      }
    }
  }

  private async handleExistingResolution(
    plan: ReconciliationPlan,
  ): Promise<ReconciliationApplicationResult> {
    let record: MigrationResolutionRecord | null;
    try {
      record = await this.journal.inspectResolution(plan.attemptId);
    } catch (error) {
      if (error instanceof PersistentMigrationJournalError && error.code === 'RESOLUTION_CORRUPT') {
        return deepFreeze<BlockedReconciliationResult>({
          status: 'BLOCKED',
          attemptId: plan.attemptId,
          safeReasonCode: BLOCKED_REASON.CORRUPT_EXISTING_RESOLUTION,
          manualActionRequired: true,
        });
      }
      throw error;
    }

    if (record === null) {
      throw new Error('Existing resolution sidecar disappeared during apply.');
    }

    // Compare every safety-relevant field against the trusted persisted record, not only the
    // planFingerprint. The caller-supplied planFingerprint is validated as 64-hex but never
    // recomputed from the caller's other fields, so accepting a sidecar merely because one
    // fingerprint string matches an unverified caller field would be unsafe. A different
    // disposition, flag, or observed value with a matching fingerprint must not be accepted.
    const recordPlan: ReconciliationPlan = {
      attemptId: record.attemptId,
      disposition: record.disposition,
      planFingerprint: record.planFingerprint,
      attemptLatestChecksum: record.attemptLatestChecksum,
      observedUserVersion: record.observedUserVersion,
      observedHistoryFingerprint: record.observedHistoryFingerprint,
      observedCompletedMigrationIds: record.observedCompletedMigrationIds,
      observedCurrentMigrationId: record.observedCurrentMigrationId,
      backupId: record.backupId,
      backupVerified: record.backupVerified,
      startupAllowed: record.startupAllowed,
      newAttemptAllowed: record.newAttemptAllowed,
      manualActionRequired: record.manualActionRequired,
      safeReasonCode: record.safeReasonCode,
    };

    if (this.plansEqual(recordPlan, plan)) {
      return deepFreeze<AlreadyResolvedReconciliationResult>({
        status: 'ALREADY_RESOLVED',
        attemptId: plan.attemptId,
        disposition: record.disposition,
        planFingerprint: record.planFingerprint,
        resolutionChecksum: record.checksum,
      });
    }

    // Distinguish a stale existing resolution (the attempt changed after the plan was
    // produced) from a genuinely different effective resolution (same attempt state but
    // different disposition, flags, or observed values).
    if (record.attemptLatestChecksum !== plan.attemptLatestChecksum) {
      return deepFreeze<BlockedReconciliationResult>({
        status: 'BLOCKED',
        attemptId: plan.attemptId,
        safeReasonCode: BLOCKED_REASON.STALE_EXISTING_RESOLUTION,
        manualActionRequired: true,
      });
    }

    return deepFreeze<BlockedReconciliationResult>({
      status: 'BLOCKED',
      attemptId: plan.attemptId,
      safeReasonCode: BLOCKED_REASON.DIFFERENT_EFFECTIVE_RESOLUTION_EXISTS,
      manualActionRequired: true,
    });
  }

  private async verifyAppliedRecord(
    attemptId: string,
    record: MigrationResolutionRecord,
    plan: ReconciliationPlan,
  ): Promise<void> {
    if (record.attemptId !== attemptId) {
      throw new Error('Resolution attemptId does not match after append.');
    }
    if (record.disposition !== plan.disposition) {
      throw new Error('Resolution disposition does not match the fresh plan.');
    }
    if (record.planFingerprint !== plan.planFingerprint) {
      throw new Error('Resolution planFingerprint does not match the fresh plan.');
    }
    if (record.attemptLatestChecksum !== plan.attemptLatestChecksum) {
      throw new Error('Resolution attemptLatestChecksum does not match the fresh plan.');
    }
    if (record.observedUserVersion !== plan.observedUserVersion) {
      throw new Error('Resolution observedUserVersion does not match the fresh plan.');
    }
    if (record.observedHistoryFingerprint !== plan.observedHistoryFingerprint) {
      throw new Error('Resolution observedHistoryFingerprint does not match the fresh plan.');
    }
    if (
      !this.arraysEqual(record.observedCompletedMigrationIds, plan.observedCompletedMigrationIds)
    ) {
      throw new Error('Resolution observedCompletedMigrationIds do not match the fresh plan.');
    }
    if (record.observedCurrentMigrationId !== plan.observedCurrentMigrationId) {
      throw new Error('Resolution observedCurrentMigrationId does not match the fresh plan.');
    }
    if (record.backupId !== plan.backupId) {
      throw new Error('Resolution backupId does not match the fresh plan.');
    }
    if (record.backupVerified !== plan.backupVerified) {
      throw new Error('Resolution backupVerified does not match the fresh plan.');
    }
    if (record.startupAllowed !== plan.startupAllowed) {
      throw new Error('Resolution startupAllowed does not match the fresh plan.');
    }
    if (record.newAttemptAllowed !== plan.newAttemptAllowed) {
      throw new Error('Resolution newAttemptAllowed does not match the fresh plan.');
    }
    if (record.manualActionRequired !== plan.manualActionRequired) {
      throw new Error('Resolution manualActionRequired does not match the fresh plan.');
    }
    if (record.safeReasonCode !== plan.safeReasonCode) {
      throw new Error('Resolution safeReasonCode does not match the fresh plan.');
    }
    if (!HEX64.test(record.checksum)) {
      throw new Error('Resolution checksum is not valid lowercase hex.');
    }

    const after = await this.journal.inspectAttemptResolution(attemptId);
    if (after.effectiveResolutionStatus !== 'EFFECTIVE') {
      throw new Error('Resolution sidecar is not effective after append.');
    }
    if (after.effectiveDisposition !== plan.disposition) {
      throw new Error('Effective resolution disposition does not match the fresh plan.');
    }
    if (after.newAttemptAllowed !== plan.newAttemptAllowed) {
      throw new Error('Effective newAttemptAllowed does not match the fresh plan.');
    }
    if (after.startupAllowed !== plan.startupAllowed) {
      throw new Error('Effective startupAllowed does not match the fresh plan.');
    }
    if (after.manualActionRequired !== plan.manualActionRequired) {
      throw new Error('Effective manualActionRequired does not match the fresh plan.');
    }
    if (after.resolutionChecksum !== record.checksum) {
      throw new Error('Effective resolution checksum does not match the appended record.');
    }
  }

  private planToResolutionInput(plan: ReconciliationPlan): MigrationResolutionInput {
    return {
      disposition: plan.disposition,
      planFingerprint: plan.planFingerprint,
      attemptLatestChecksum: plan.attemptLatestChecksum,
      observedUserVersion: plan.observedUserVersion,
      observedHistoryFingerprint: plan.observedHistoryFingerprint,
      observedCompletedMigrationIds: [...plan.observedCompletedMigrationIds],
      ...(plan.observedCurrentMigrationId !== undefined
        ? { observedCurrentMigrationId: plan.observedCurrentMigrationId }
        : {}),
      ...(plan.backupId !== undefined ? { backupId: plan.backupId } : {}),
      backupVerified: plan.backupVerified,
      startupAllowed: plan.startupAllowed,
      newAttemptAllowed: plan.newAttemptAllowed,
      manualActionRequired: plan.manualActionRequired,
      safeReasonCode: plan.safeReasonCode,
    };
  }

  private plansEqual(a: ReconciliationPlan, b: ReconciliationPlan): boolean {
    if (a.attemptId !== b.attemptId) return false;
    if (a.disposition !== b.disposition) return false;
    if (a.planFingerprint !== b.planFingerprint) return false;
    if (a.attemptLatestChecksum !== b.attemptLatestChecksum) return false;
    if (a.observedUserVersion !== b.observedUserVersion) return false;
    if (a.observedHistoryFingerprint !== b.observedHistoryFingerprint) return false;
    if (a.observedCurrentMigrationId !== b.observedCurrentMigrationId) return false;
    if (a.backupId !== b.backupId) return false;
    if (a.backupVerified !== b.backupVerified) return false;
    if (a.startupAllowed !== b.startupAllowed) return false;
    if (a.newAttemptAllowed !== b.newAttemptAllowed) return false;
    if (a.manualActionRequired !== b.manualActionRequired) return false;
    if (a.safeReasonCode !== b.safeReasonCode) return false;
    return this.arraysEqual(a.observedCompletedMigrationIds, b.observedCompletedMigrationIds);
  }

  private arraysEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Database blockers
  // -----------------------------------------------------------------------

  private checkDatabaseBlockers(
    attemptId: string,
    dbState: ReturnType<MigrationStateInspector['inspect']>,
    attemptInspection: AttemptInspection,
  ): BlockedInspection | null {
    // Future schema version.
    if (dbState.futureSchemaVersion) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.DATABASE_FUTURE_SCHEMA,
        manualActionRequired: true,
      });
    }

    // Populated version-zero requiring LegacyDetector.
    if (dbState.currentVersion === 0 && dbState.isPopulated) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.LEGACY_DETECTION_REQUIRED,
        manualActionRequired: true,
      });
    }

    // Version-zero with history table (ambiguous).
    if (dbState.currentVersion === 0 && dbState.historyTableExists) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.LEGACY_DETECTION_REQUIRED,
        manualActionRequired: true,
      });
    }

    // Invalid history.
    if (!dbState.historyValid) {
      if (dbState.checksumMismatches.length > 0) {
        return deepFreeze<BlockedInspection>({
          status: 'BLOCKED',
          attemptId,
          safeReasonCode: BLOCKED_REASON.DATABASE_CHECKSUM_MISMATCH,
          manualActionRequired: true,
        });
      }
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.DATABASE_HISTORY_INVALID,
        manualActionRequired: true,
      });
    }

    // Invalid intermediate version (non-zero, not matching any registered toVersion).
    if (dbState.currentVersion !== 0 && !dbState.validIntermediateVersion) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.DATABASE_STATE_AMBIGUOUS,
        manualActionRequired: true,
      });
    }

    // Attempt/database range compatibility.
    const header = attemptInspection.records[0]!;
    const attemptStartVersion = header.attempt.fromVersion;
    const attemptTargetVersion = header.attempt.targetVersion;

    if (dbState.currentVersion < attemptStartVersion) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.ATTEMPT_DATABASE_RANGE_MISMATCH,
        manualActionRequired: true,
      });
    }

    if (dbState.currentVersion > attemptTargetVersion) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.ATTEMPT_DATABASE_RANGE_MISMATCH,
        manualActionRequired: true,
      });
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Disposition determination
  // -----------------------------------------------------------------------

  private async determineDisposition(
    attemptId: string,
    attemptInspection: AttemptInspection,
    dbState: ReturnType<MigrationStateInspector['inspect']>,
  ): Promise<InterruptedMigrationReconciliationInspection> {
    const header = attemptInspection.records[0]!;
    const attemptStartVersion = header.attempt.fromVersion;
    const attemptTargetVersion = header.attempt.targetVersion;
    const latestState = attemptInspection.latestState;
    const latestValidChecksum =
      attemptInspection.records[attemptInspection.records.length - 1]!.checksum;

    // --- NO_ACTION_REQUIRED: healthy SUCCEEDED + matching target DB ---
    if (
      latestState === 'SUCCEEDED' &&
      dbState.currentVersion === attemptTargetVersion &&
      dbState.atTarget &&
      dbState.historyValid
    ) {
      return deepFreeze<NoActionRequiredInspection>({
        status: 'NO_ACTION_REQUIRED',
        attemptId,
      });
    }

    // A terminal-success claim that does not match the observed database is unsafe.
    if (latestState === 'SUCCEEDED' && !dbState.atTarget) {
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.SUCCEEDED_DATABASE_MISMATCH,
        manualActionRequired: true,
      });
    }

    // --- Check for pre-transaction states ---
    const hasCommittedMutation = attemptInspection.records.some((r) => r.state === 'COMMITTED');
    const hasUnmatchedTransaction = this.hasUnmatchedTransaction(attemptInspection);

    // --- SAFE_PRE_TRANSACTION_RETRY ---
    if (!hasCommittedMutation && !hasUnmatchedTransaction) {
      const preTransactionStates: ReadonlySet<string> = new Set([
        'CREATED',
        'PREFLIGHT_VALIDATED',
        'BACKUP_VERIFIED',
        'FAILED',
      ]);
      if (
        latestState !== null &&
        preTransactionStates.has(latestState) &&
        dbState.currentVersion === attemptStartVersion
      ) {
        const historyFingerprint = computeHistoryFingerprint(dbState.historyRows);
        const plan = this.buildPlan(attemptId, {
          disposition: 'SAFE_PRE_TRANSACTION_RETRY',
          attemptLatestChecksum: latestValidChecksum,
          observedUserVersion: dbState.currentVersion,
          observedHistoryFingerprint: historyFingerprint,
          observedCompletedMigrationIds: [],
          observedCurrentMigrationId: undefined,
          backupId: attemptInspection.backupId ?? undefined,
          backupVerified: false,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'SAFE_PRE_TRANSACTION_RETRY',
        });
        return deepFreeze<SafePlanInspection>({
          status: 'SAFE_PLAN',
          attemptId,
          plan,
        });
      }
    }

    // --- For states with unmatched transaction or committed mutations ---
    if (hasUnmatchedTransaction || hasCommittedMutation) {
      return this.determineTransactionDisposition(
        attemptId,
        attemptInspection,
        dbState,
        latestValidChecksum,
      );
    }

    // --- Fallback: unexpected state ---
    return deepFreeze<BlockedInspection>({
      status: 'BLOCKED',
      attemptId,
      safeReasonCode: BLOCKED_REASON.UNEXPECTED_ATTEMPT_STATE,
      manualActionRequired: true,
    });
  }

  private async determineTransactionDisposition(
    attemptId: string,
    attemptInspection: AttemptInspection,
    dbState: ReturnType<MigrationStateInspector['inspect']>,
    latestValidChecksum: string,
  ): Promise<InterruptedMigrationReconciliationInspection> {
    const header = attemptInspection.records[0]!;
    const attemptStartVersion = header.attempt.fromVersion;
    const attemptTargetVersion = header.attempt.targetVersion;

    // Find the unmatched TRANSACTION_STARTED and the committed prefix.
    const committedIds = attemptInspection.completedMigrationIds;
    const currentMigrationId = attemptInspection.currentMigrationId;
    const currentCommittedVersion = attemptInspection.currentCommittedVersion;

    // Build expected committed prefix from DB history.
    const dbCommittedIds = dbState.historyRows.map((r) => r.migration_id);
    const journalCommittedSet = new Set(committedIds);

    // --- TRANSACTION_ROLLED_BACK ---
    if (
      currentMigrationId !== null &&
      currentCommittedVersion !== null &&
      dbState.currentVersion === currentCommittedVersion
    ) {
      // DB is at the committed prefix version (no new migration committed).
      // Check that DB history exactly matches the journal committed prefix.
      if (
        dbCommittedIds.length === committedIds.length &&
        dbCommittedIds.every((id, i) => id === committedIds[i])
      ) {
        const backupVerified = await this.verifyBackupEvidence(attemptId, attemptInspection);
        if (!backupVerified) {
          return deepFreeze<BlockedInspection>({
            status: 'BLOCKED',
            attemptId,
            safeReasonCode: BLOCKED_REASON.BACKUP_EVIDENCE_UNAVAILABLE,
            manualActionRequired: true,
          });
        }

        const historyFingerprint = computeHistoryFingerprint(dbState.historyRows);
        const plan = this.buildPlan(attemptId, {
          disposition: 'TRANSACTION_ROLLED_BACK',
          attemptLatestChecksum: latestValidChecksum,
          observedUserVersion: dbState.currentVersion,
          observedHistoryFingerprint: historyFingerprint,
          observedCompletedMigrationIds: [...committedIds],
          observedCurrentMigrationId: currentMigrationId,
          backupId: attemptInspection.backupId ?? undefined,
          backupVerified: true,
          startupAllowed: false,
          newAttemptAllowed: true,
          manualActionRequired: false,
          safeReasonCode: 'TRANSACTION_ROLLED_BACK',
        });
        return deepFreeze<SafePlanInspection>({
          status: 'SAFE_PLAN',
          attemptId,
          plan,
        });
      }
    }

    // --- COMMIT_CONFIRMED_FROM_DATABASE ---
    if (
      currentMigrationId !== null &&
      dbState.currentVersion > (currentCommittedVersion ?? attemptStartVersion)
    ) {
      // DB has advanced beyond the journal committed prefix.
      // Check that the DB has exactly the committed prefix plus the current migration.
      const expectedDbIds = [...committedIds, currentMigrationId];
      if (
        dbCommittedIds.length === expectedDbIds.length &&
        dbCommittedIds.every((id, i) => id === expectedDbIds[i])
      ) {
        const backupVerified = await this.verifyBackupEvidence(attemptId, attemptInspection);
        if (!backupVerified) {
          return deepFreeze<BlockedInspection>({
            status: 'BLOCKED',
            attemptId,
            safeReasonCode: BLOCKED_REASON.BACKUP_EVIDENCE_UNAVAILABLE,
            manualActionRequired: true,
          });
        }

        const currentMigrationToVersion = dbState.currentVersion;
        const atTarget = currentMigrationToVersion === attemptTargetVersion;
        const historyFingerprint = computeHistoryFingerprint(dbState.historyRows);
        const plan = this.buildPlan(attemptId, {
          disposition: 'COMMIT_CONFIRMED_FROM_DATABASE',
          attemptLatestChecksum: latestValidChecksum,
          observedUserVersion: currentMigrationToVersion,
          observedHistoryFingerprint: historyFingerprint,
          observedCompletedMigrationIds: [...expectedDbIds],
          observedCurrentMigrationId: currentMigrationId,
          backupId: attemptInspection.backupId ?? undefined,
          backupVerified: true,
          startupAllowed: false,
          newAttemptAllowed: !atTarget,
          manualActionRequired: false,
          safeReasonCode: 'COMMIT_CONFIRMED_FROM_DATABASE',
        });
        return deepFreeze<SafePlanInspection>({
          status: 'SAFE_PLAN',
          attemptId,
          plan,
        });
      }

      // DB has extra migrations beyond what the journal records.
      return deepFreeze<BlockedInspection>({
        status: 'BLOCKED',
        attemptId,
        safeReasonCode: BLOCKED_REASON.DATABASE_STATE_AMBIGUOUS,
        manualActionRequired: true,
      });
    }

    // --- VALID_INTERMEDIATE_VERSION ---
    if (
      dbState.currentVersion > attemptStartVersion &&
      dbState.currentVersion < attemptTargetVersion &&
      dbState.validIntermediateVersion &&
      dbState.historyValid
    ) {
      // DB is at a valid intermediate version.
      // Check that DB history matches a valid contiguous committed prefix.
      if (dbCommittedIds.length > 0) {
        // Verify that all DB-committed IDs are in the journal committed prefix.
        const allInJournal = dbCommittedIds.every((id) => journalCommittedSet.has(id));
        if (allInJournal) {
          const backupVerified = await this.verifyBackupEvidence(attemptId, attemptInspection);
          if (!backupVerified) {
            return deepFreeze<BlockedInspection>({
              status: 'BLOCKED',
              attemptId,
              safeReasonCode: BLOCKED_REASON.BACKUP_EVIDENCE_UNAVAILABLE,
              manualActionRequired: true,
            });
          }

          const historyFingerprint = computeHistoryFingerprint(dbState.historyRows);
          const plan = this.buildPlan(attemptId, {
            disposition: 'VALID_INTERMEDIATE_VERSION',
            attemptLatestChecksum: latestValidChecksum,
            observedUserVersion: dbState.currentVersion,
            observedHistoryFingerprint: historyFingerprint,
            observedCompletedMigrationIds: [...dbCommittedIds],
            observedCurrentMigrationId: currentMigrationId ?? undefined,
            backupId: attemptInspection.backupId ?? undefined,
            backupVerified: true,
            startupAllowed: false,
            newAttemptAllowed: true,
            manualActionRequired: false,
            safeReasonCode: 'VALID_INTERMEDIATE_VERSION',
          });
          return deepFreeze<SafePlanInspection>({
            status: 'SAFE_PLAN',
            attemptId,
            plan,
          });
        }
      }
    }

    // --- RESOLVED_SUCCESS: full journal committed range + matching target DB ---
    if (
      currentMigrationId === null &&
      dbState.currentVersion === attemptTargetVersion &&
      dbState.atTarget &&
      dbState.historyValid &&
      dbCommittedIds.length === committedIds.length &&
      dbCommittedIds.every((id, i) => id === committedIds[i])
    ) {
      const backupVerified = await this.verifyBackupEvidence(attemptId, attemptInspection);
      if (!backupVerified) {
        return deepFreeze<BlockedInspection>({
          status: 'BLOCKED',
          attemptId,
          safeReasonCode: BLOCKED_REASON.BACKUP_EVIDENCE_UNAVAILABLE,
          manualActionRequired: true,
        });
      }

      const historyFingerprint = computeHistoryFingerprint(dbState.historyRows);
      const plan = this.buildPlan(attemptId, {
        disposition: 'RESOLVED_SUCCESS',
        attemptLatestChecksum: latestValidChecksum,
        observedUserVersion: dbState.currentVersion,
        observedHistoryFingerprint: historyFingerprint,
        observedCompletedMigrationIds: [...committedIds],
        observedCurrentMigrationId: undefined,
        backupId: attemptInspection.backupId ?? undefined,
        backupVerified: true,
        startupAllowed: true,
        newAttemptAllowed: false,
        manualActionRequired: false,
        safeReasonCode: 'RESOLVED_SUCCESS',
      });
      return deepFreeze<SafePlanInspection>({
        status: 'SAFE_PLAN',
        attemptId,
        plan,
      });
    }

    return deepFreeze<BlockedInspection>({
      status: 'BLOCKED',
      attemptId,
      safeReasonCode: BLOCKED_REASON.DATABASE_STATE_AMBIGUOUS,
      manualActionRequired: true,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private hasUnmatchedTransaction(inspection: AttemptInspection): boolean {
    const states = inspection.records.map((r) => r.state);
    let transactionCount = 0;
    let commitCount = 0;
    for (const state of states) {
      if (state === 'TRANSACTION_STARTED') transactionCount++;
      if (state === 'COMMITTED') commitCount++;
    }
    return transactionCount > commitCount;
  }

  private async verifyBackupEvidence(
    _attemptId: string,
    attemptInspection: AttemptInspection,
  ): Promise<boolean> {
    const backupId = attemptInspection.backupId;
    if (!backupId) {
      return false;
    }
    // The BackupEvidenceVerifier port returns false for unverifiable, missing, or mismatched
    // evidence. A thrown error is an unknown programming error and must propagate rather than
    // be silently downgraded to BLOCKED, so a safety decision is never made on a swallowed fault.
    return await this.backupVerifier.verifyBackupEvidence(backupId);
  }

  private buildPlan(
    attemptId: string,
    fields: Omit<ReconciliationPlan, 'attemptId' | 'planFingerprint'>,
  ): ReconciliationPlan {
    const base = { attemptId, ...fields };
    const planFingerprint = computePlanFingerprint(base);
    return deepFreeze<ReconciliationPlan>({ ...base, planFingerprint });
  }
}
