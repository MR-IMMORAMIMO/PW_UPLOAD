/**
 * ProductionPendingRestoreGate: production adapter for the PendingRestoreGate port (P1.8I).
 *
 * Replaces the legacy personal-server raw pending-restore file copy with a verified
 * RestoreManager restore. The coordinator holds the database startup lock before this gate
 * runs, and no provider, store, Fastify listener, or migration step starts until the gate
 * resolves.
 *
 * Contract:
 *
 * 1. Inspect the production pending-restore request file (restore-pending.json beside the
 *    database). Absence is a no-op.
 * 2. Validate the request without leaking paths: JSON object { version: 1, backupId } with a
 *    single-segment, NUL-free backup id.
 * 3. Invoke the real RestoreManager against the target database.
 * 4. Verify RestoreManager reports success.
 * 5. Finalize (remove) the request file only after verified success.
 *
 * The legacy raw marker (restore-pending.sqlite) is never copied over the database: its
 * presence is an invalid request that fails closed (PendingRestoreGateError) and is preserved
 * for safe manual resolution. Every public error in this module is bounded and path-free.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { RestoreManager } from '../backup/RestoreManager';
import {
  PendingRestoreGateError,
  type PendingRestoreGate,
  type PendingRestoreOutcome,
} from './startup-types';

/** Immutable pending-restore request format (version 1). */
export interface ProductionPendingRestoreRequest {
  readonly version: 1;
  readonly backupId: string;
}

export interface ProductionPendingRestoreGateDeps {
  /** Absolute target database path restored by RestoreManager. */
  readonly targetDatabasePath: string;
  /** Production pending-restore request file (restore-pending.json). */
  readonly requestPath: string;
  /** Legacy raw pending-restore marker (restore-pending.sqlite); fails closed when present. */
  readonly legacyRequestPath: string;
  readonly restoreManager: RestoreManager;
}

export type ProductionPendingRestoreInspection =
  'NO_PENDING_RESTORE' | 'PENDING_RESTORE_REQUEST' | 'LEGACY_PENDING_RESTORE_MARKER';

/**
 * Read-only pending-restore inspection for migration-only tooling. Normal startup still owns
 * restore execution through ProductionPendingRestoreGate.run(); callers that must block rather
 * than restore can reuse the same path authority without creating, deleting, or parsing files.
 */
export function inspectProductionPendingRestore(
  requestPath: string,
  legacyRequestPath: string,
): ProductionPendingRestoreInspection {
  if (existsSync(legacyRequestPath)) return 'LEGACY_PENDING_RESTORE_MARKER';
  if (existsSync(requestPath)) return 'PENDING_RESTORE_REQUEST';
  return 'NO_PENDING_RESTORE';
}

const PRODUCTION_REQUEST_VERSION = 1 as const;
const LEGACY_RAW_MARKER_MESSAGE =
  'A legacy pending-restore marker requires manual resolution before startup.';

function isSingleSegmentBackupId(backupId: string): boolean {
  return (
    backupId.length > 0 &&
    !backupId.includes('\0') &&
    backupId !== '.' &&
    backupId !== '..' &&
    !backupId.includes('/') &&
    !backupId.includes('\\')
  );
}

function parsePendingRestoreRequest(raw: string): ProductionPendingRestoreRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PendingRestoreGateError('The pending restore request is invalid.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PendingRestoreGateError('The pending restore request is invalid.');
  }
  const candidate = parsed as { version?: unknown; backupId?: unknown };
  if (candidate.version !== PRODUCTION_REQUEST_VERSION) {
    throw new PendingRestoreGateError('The pending restore request is invalid.');
  }
  if (typeof candidate.backupId !== 'string' || !isSingleSegmentBackupId(candidate.backupId)) {
    throw new PendingRestoreGateError('The pending restore request is invalid.');
  }
  return { version: PRODUCTION_REQUEST_VERSION, backupId: candidate.backupId };
}

/**
 * Production pending-restore gate. Reads a bounded JSON request, restores through
 * RestoreManager, and finalizes the request only after verified success. The legacy raw
 * marker is never copied, renamed, or ignored: it fails closed so an unsafe legacy restore
 * cannot start the application.
 */
export class ProductionPendingRestoreGate implements PendingRestoreGate {
  private readonly targetDatabasePath: string;
  private readonly requestPath: string;
  private readonly legacyRequestPath: string;
  private readonly restoreManager: RestoreManager;

  public constructor(deps: ProductionPendingRestoreGateDeps) {
    this.targetDatabasePath = deps.targetDatabasePath;
    this.requestPath = deps.requestPath;
    this.legacyRequestPath = deps.legacyRequestPath;
    this.restoreManager = deps.restoreManager;
  }

  public async run(): Promise<PendingRestoreOutcome> {
    const inspection = inspectProductionPendingRestore(this.requestPath, this.legacyRequestPath);
    if (inspection === 'LEGACY_PENDING_RESTORE_MARKER') {
      throw new PendingRestoreGateError(LEGACY_RAW_MARKER_MESSAGE);
    }
    if (inspection === 'NO_PENDING_RESTORE') {
      return 'NO_PENDING_RESTORE';
    }

    let raw: string;
    try {
      raw = readFileSync(this.requestPath, 'utf8');
    } catch (error) {
      if (isEnoent(error)) return 'NO_PENDING_RESTORE';
      throw new PendingRestoreGateError('The pending restore request could not be read.');
    }

    const request = parsePendingRestoreRequest(raw);

    let result;
    try {
      result = await this.restoreManager.restore({
        targetDatabasePath: this.targetDatabasePath,
        backupId: request.backupId,
      });
    } catch {
      // RestoreManager failures are bounded typed errors; the pending request stays in place
      // so a later startup can retry it safely.
      throw new PendingRestoreGateError('The pending restore could not be completed safely.');
    }

    if (result.status !== 'RESTORED' || result.verificationPassed !== true) {
      throw new PendingRestoreGateError('The pending restore did not complete verification.');
    }

    try {
      unlinkSync(this.requestPath);
    } catch (error) {
      if (isEnoent(error)) return 'RESTORED';
      throw new PendingRestoreGateError(
        'The pending restore completed but could not be finalized.',
      );
    }
    return 'RESTORED';
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}
