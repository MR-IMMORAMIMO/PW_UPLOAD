/**
 * DatabaseStartupLock: a database-scoped cross-process startup lock.
 *
 * The lock protects one canonical standalone database identity across the Electron API child
 * process, a development API process, another application installation, and any other process
 * using this same lock implementation. Ownership is OS/SQLite-held, never PID-marker trust:
 * the lock is a live BEGIN EXCLUSIVE transaction on a dedicated sibling SQLite lock database,
 * so a crashed owner releases the lock automatically when the OS closes its handles.
 *
 * Lock identity is derived from the canonical real parent directory plus the Windows-normalized
 * database filename, hashed with SHA-256. Path casing, `.`/`..` segments, separator variants,
 * and parent-directory junction aliases therefore map to one lock, while an atomic restore
 * replacement of the target database file does not change the lock path.
 *
 * The persistent lock database file may remain after release; its existence is not proof that
 * the lock is held. The lock database is never deleted merely because it exists.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { win32 as winPath } from 'node:path';

// Keep the specifier dynamic so the bundler does not rewrite `node:sqlite` to `sqlite`.
// Top-level await is avoided here because the cross-process lock tests load this module
// through a CommonJS tsx child process, which cannot transform top-level await.
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = createRequire(import.meta.url)(
  nodeSqliteSpecifier,
) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

import {
  DatabaseStartupLockError,
  type DatabaseStartupLease,
  type DatabaseStartupLockPort,
} from './startup-types';

const LOCK_FILE_PREFIX = '.scli-startup-';
const LOCK_FILE_SUFFIX = '.lock.sqlite';
const DEFAULT_BUSY_TIMEOUT_MS = 1000;
const MAX_BUSY_TIMEOUT_MS = 5000;
const SQLITE_BUSY_ERRCODE = 5;

/** Resolved, path-free lock identity for one canonical database. */
interface LockIdentity {
  readonly identityHash: string;
  readonly lockPath: string;
}

function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { errcode?: unknown; message?: unknown };
  if (candidate.errcode === SQLITE_BUSY_ERRCODE) return true;
  return typeof candidate.message === 'string' && /database is locked/i.test(candidate.message);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Database-scoped startup lock. One instance is not a global singleton; each acquire() call
 * returns an independent lease for the requested database identity.
 */
export class DatabaseStartupLock implements DatabaseStartupLockPort {
  private readonly busyTimeoutMs: number;

  public constructor(deps: { readonly busyTimeoutMs?: number } = {}) {
    const raw = deps.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isInteger(raw) || raw < 1) {
      throw new DatabaseStartupLockError(
        'INVALID_CONFIGURATION',
        'busyTimeoutMs must be a positive integer.',
      );
    }
    this.busyTimeoutMs = Math.min(raw, MAX_BUSY_TIMEOUT_MS);
  }

  /**
   * Acquires the startup lock for one canonical database identity. Synchronous because the
   * underlying SQLite handle and transaction are synchronous; the returned lease remains valid
   * across asynchronous coordinator work and must be released by the owner.
   */
  public acquire(databasePath: string): DatabaseStartupLease {
    const identity = this.resolveIdentity(databasePath);
    this.validateLockDatabaseEntry(identity.lockPath);

    let db: DatabaseSyncInstance | undefined;
    try {
      db = new DatabaseSync(identity.lockPath);
      // Rollback-journal mode (never WAL) so the lock transaction is released by the OS when
      // the owning process exits or crashes.
      db.exec('PRAGMA journal_mode = DELETE');
      db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
      db.exec('CREATE TABLE IF NOT EXISTS startup_lock (id INTEGER PRIMARY KEY CHECK (id = 1))');
      // BEGIN EXCLUSIVE acquires the SQLite write lock immediately and holds it until release()
      // or process exit. A second owner fails with SQLITE_BUSY after the bounded busy timeout.
      db.exec('BEGIN EXCLUSIVE');
    } catch (error) {
      if (db !== undefined) {
        try {
          db.close();
        } catch {
          // Best-effort close on the failure path; the original error is preserved below.
        }
      }
      if (isBusyError(error)) {
        throw new DatabaseStartupLockError(
          'LOCK_ALREADY_HELD',
          'The database startup lock is already held by another process.',
          { cause: error },
        );
      }
      throw new DatabaseStartupLockError(
        'LOCK_ACQUISITION_FAILED',
        'The database startup lock could not be acquired.',
        { cause: error },
      );
    }

    let released = false;
    const release = (): void => {
      if (released) return;
      let rollbackError: unknown;
      let closeError: unknown;
      try {
        db?.exec('ROLLBACK');
      } catch (error) {
        rollbackError = error;
      }
      try {
        db?.close();
      } catch (error) {
        closeError = error;
      }
      if (closeError === undefined) {
        // The OS/SQLite ownership is released once the handle is closed, even if the explicit
        // ROLLBACK failed; the failure is still reported so it remains visible.
        released = true;
      }
      if (rollbackError !== undefined || closeError !== undefined) {
        throw new DatabaseStartupLockError(
          'LOCK_RELEASE_FAILED',
          'The database startup lock could not be released.',
          { cause: closeError ?? rollbackError },
        );
      }
    };

    return Object.freeze<DatabaseStartupLease>({
      databaseIdentityHash: identity.identityHash,
      release,
    });
  }

  /**
   * Resolve a target database path to a canonical, path-free lock identity.
   *
   * The real parent directory is canonicalized (resolving junction/symlink ancestors), the
   * filename is normalized per Windows case behavior, and the identity basis is hashed with
   * SHA-256. The lock path is a fixed sibling of the target, so it stays stable when restore
   * atomically replaces the target file.
   */
  private resolveIdentity(databasePath: string): LockIdentity {
    if (typeof databasePath !== 'string' || databasePath.length === 0) {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database path must be a non-empty string.',
      );
    }
    if (databasePath.includes('\0')) {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database path must not contain NUL characters.',
      );
    }
    const normalized = winPath.normalize(databasePath);
    if (!winPath.isAbsolute(normalized)) {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database path must be absolute.',
      );
    }
    if (normalized.toLowerCase() === ':memory:') {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database path must not be :memory:.',
      );
    }

    const parent = winPath.dirname(normalized);
    let realParent: string;
    try {
      realParent = realpathSync(parent);
    } catch (error) {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database parent directory could not be resolved.',
        { cause: error },
      );
    }
    try {
      const parentStat = lstatSync(realParent);
      if (!parentStat.isDirectory()) {
        throw new DatabaseStartupLockError(
          'INVALID_DATABASE_PATH',
          'The database parent must be a directory.',
        );
      }
    } catch (error) {
      if (error instanceof DatabaseStartupLockError) throw error;
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database parent directory could not be inspected.',
        { cause: error },
      );
    }

    const fileName = winPath.basename(normalized);
    if (fileName.length === 0 || fileName === '.' || fileName === '..') {
      throw new DatabaseStartupLockError(
        'INVALID_DATABASE_PATH',
        'The database path must name a file.',
      );
    }

    // Validate the target itself when it exists: regular file only, no symlink/junction, and
    // no ambiguous multiple-hard-link state. A missing target is allowed (fresh database).
    let targetExists = false;
    try {
      const targetStat = lstatSync(normalized);
      targetExists = true;
      if (targetStat.isSymbolicLink()) {
        throw new DatabaseStartupLockError(
          'UNSAFE_DATABASE_PATH',
          'The database path must not be a symlink or junction.',
        );
      }
      if (!targetStat.isFile()) {
        throw new DatabaseStartupLockError(
          'UNSAFE_DATABASE_PATH',
          'The database path must be a regular file.',
        );
      }
    } catch (error) {
      if (error instanceof DatabaseStartupLockError) throw error;
      if (!isEnoent(error)) {
        throw new DatabaseStartupLockError(
          'UNSAFE_DATABASE_PATH',
          'The database path could not be inspected safely.',
          { cause: error },
        );
      }
    }
    if (targetExists) {
      try {
        const targetStat = statSync(normalized);
        if (targetStat.nlink > 1) {
          throw new DatabaseStartupLockError(
            'UNSAFE_DATABASE_PATH',
            'The database path has multiple hard links and is ambiguous.',
          );
        }
      } catch (error) {
        if (error instanceof DatabaseStartupLockError) throw error;
        throw new DatabaseStartupLockError(
          'UNSAFE_DATABASE_PATH',
          'The database hard-link state could not be verified.',
          { cause: error },
        );
      }
    }

    // Windows path identity is case-insensitive; lowercase the canonical parent and filename.
    const canonicalParent = realParent.toLowerCase();
    const canonicalFileName = fileName.toLowerCase();
    const identityBasis = canonicalParent + '\\' + canonicalFileName;
    const identityHash = createHash('sha256')
      .update('scli-startup-lock:' + identityBasis, 'utf8')
      .digest('hex');
    const lockPath = winPath.join(realParent, LOCK_FILE_PREFIX + identityHash + LOCK_FILE_SUFFIX);
    return Object.freeze({ identityHash, lockPath });
  }

  /**
   * Validate an existing lock-database entry: regular file only, no symlink/junction, no
   * directory or special entry. A missing entry is fine; DatabaseSync will create it.
   */
  private validateLockDatabaseEntry(lockPath: string): void {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(lockPath);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new DatabaseStartupLockError(
        'LOCK_DATABASE_UNSAFE',
        'The lock database path must not be a symlink or junction.',
      );
    }
    if (!stat.isFile()) {
      throw new DatabaseStartupLockError(
        'LOCK_DATABASE_UNSAFE',
        'The lock database path must be a regular file.',
      );
    }
  }
}
