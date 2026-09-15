/**
 * Lexical path resolution for the SCLI workspace data root.
 *
 * PathResolverService performs purely lexical (string-level) path handling. It never reads,
 * creates, moves, deletes, or inspects physical files, and it never resolves symlinks or calls
 * realpath. Containment is therefore lexical: two paths are considered the same location when
 * their normalized, case-insensitive forms compare equal after resolving `.`/`..` segments.
 *
 * Windows path parsing relies on the deterministic `node:path` win32 API (available on every
 * operating system, independent of the host path format). Custom logic is kept only where
 * `path.win32` cannot satisfy an approved requirement: forward-slash portable storage,
 * case-insensitive comparison, extended-length prefix handling, typed traversal rejection, and
 * advisory path-length diagnostics.
 *
 * The service is intentionally independent of business logic, database providers, Electron, the
 * filesystem, UI, contracts, and Teams modules.
 */

import { win32 as winPath } from 'node:path';

/**
 * A path persisted in a way that survives the data root moving to another drive or directory.
 *
 * - `relative`: the path lives inside the configured data root and is stored as a forward-slash
 *   relative path. Resolving it against the current data root reproduces the absolute location.
 * - `external`: the path lives outside the configured data root (another drive, another root, or a
 *   UNC share) and is stored as a normalized absolute path so it is never silently relativized.
 */
export type StoredPath = { kind: 'relative'; value: string } | { kind: 'external'; value: string };

/** Diagnostics returned by {@link PathResolverService.inspectWindowsPathLength}. */
export interface WindowsPathLengthReport {
  /** The resolved absolute path that was measured (forward-slash canonical form). */
  resolvedPath: string;
  /** Character length of {@link resolvedPath}. */
  length: number;
  /** The legacy Windows MAX_PATH threshold used for advisory diagnostics. */
  legacyLimit: number;
  /** Whether {@link length} exceeds {@link legacyLimit}. */
  exceedsLegacyLimit: boolean;
  /** Advisory messages. Empty when there is nothing to warn about. */
  warnings: string[];
}

/**
 * Error thrown by PathResolverService for invalid input or rejected traversal. Carries a stable
 * machine-readable `code` so callers can branch without parsing messages.
 */
export class PathResolverError extends Error {
  /** Stable machine-readable error code. */
  public readonly code:
    | 'EMPTY_PATH'
    | 'NUL_CHARACTER'
    | 'MALFORMED_STORED_PATH'
    | 'RELATIVE_STORED_PATH_IS_ABSOLUTE'
    | 'TRAVERSAL_ESCAPE'
    | 'EXTERNAL_PATH_REQUIRED';

  public constructor(code: PathResolverError['code'], message: string) {
    super(message);
    this.name = 'PathResolverError';
    this.code = code;
  }
}

const LEGACY_MAX_PATH = 260;

export class PathResolverService {
  /** Normalized absolute data root in Windows (backslash) form, no trailing separator. */
  private readonly dataRootWindows: string;

  /**
   * Construct a resolver bound to a configured data root.
   *
   * @param dataRoot Absolute path of the workspace data root (e.g. the portable app's project
   *   root). Must be a non-empty absolute path with no NUL characters. Extended-length prefixes
   *   such as `\\?\C:\...` and `\\?\UNC\server\share\...` are accepted and normalized.
   */
  public constructor(dataRoot: string) {
    assertNoNul(dataRoot, 'data root');
    assertNonEmpty(dataRoot, 'data root');
    const normalized = normalizeRaw(dataRoot);
    if (!winPath.isAbsolute(normalized)) {
      throw new PathResolverError(
        'EXTERNAL_PATH_REQUIRED',
        'The configured data root must be an absolute path.',
      );
    }
    this.dataRootWindows = normalized;
  }

  /** The normalized absolute form of the configured data root (forward slashes). */
  public get dataRoot(): string {
    return toForwardSlash(this.dataRootWindows);
  }

  /**
   * Normalize a path to a canonical forward-slash form: extended-length prefixes stripped,
   * repeated separators collapsed, `.`/`..` resolved lexically by `path.win32`, and trailing
   * separators removed. The original segment casing is preserved. Relative paths are normalized
   * but not resolved against the data root here.
   */
  public normalizeAbsolutePath(input: string): string {
    assertNoNul(input, 'path');
    assertNonEmpty(input, 'path');
    return toForwardSlash(normalizeRaw(input));
  }

  /**
   * Canonicalize a path for equality comparison. On Windows the path is case-insensitive, so the
   * drive letter, server, share, and every segment are lowercased and separators are normalized.
   * Two paths that point to the same location compare equal after this transform.
   */
  public canonicalizeForComparison(input: string): string {
    assertNoNul(input, 'path');
    assertNonEmpty(input, 'path');
    return toForwardSlash(normalizeRaw(input)).toLowerCase();
  }

  /**
   * Determine whether an absolute path is lexically inside the configured data root. The data
   * root itself counts as inside. Containment is decided by `path.win32.relative` (segment-aware,
   * not a naive string prefix), so a sibling like `C:\Projects-Archive` is not treated as a child
   * of `C:\Projects`. Relative or different-root paths are never inside.
   */
  public isWithinDataRoot(input: string): boolean {
    assertNoNul(input, 'path');
    assertNonEmpty(input, 'path');
    return this.isWithin(normalizeRaw(input));
  }

  /**
   * Convert an absolute path into a portable {@link StoredPath}. Paths inside the data root are
   * stored as forward-slash relative paths so they survive the data root moving to another drive
   * or directory. Paths outside the data root are stored as normalized absolute paths and never
   * silently relativized.
   */
  public toStoredPath(input: string): StoredPath {
    assertNoNul(input, 'path');
    assertNonEmpty(input, 'path');
    const normalized = normalizeRaw(input);
    if (!winPath.isAbsolute(normalized)) {
      throw new PathResolverError(
        'EXTERNAL_PATH_REQUIRED',
        'toStoredPath requires an absolute path.',
      );
    }
    if (this.isWithin(normalized)) {
      return {
        kind: 'relative',
        value: toForwardSlash(winPath.relative(this.dataRootWindows, normalized)),
      };
    }
    return { kind: 'external', value: toForwardSlash(normalized) };
  }

  /**
   * Resolve a {@link StoredPath} back to an absolute path using the configured data root. A
   * relative stored path is joined onto the data root; traversal that would escape the data root
   * is rejected. An external stored path is returned as its normalized absolute form without
   * being re-relativized.
   */
  public resolveStoredPath(stored: StoredPath): string {
    assertValidStoredPath(stored);
    if (stored.kind === 'external') {
      const normalized = normalizeRaw(stored.value);
      if (!winPath.isAbsolute(normalized)) {
        throw new PathResolverError(
          'EXTERNAL_PATH_REQUIRED',
          'An external StoredPath must be an absolute path.',
        );
      }
      return toForwardSlash(normalized);
    }
    const value = stored.value;
    if (looksAbsolute(value)) {
      throw new PathResolverError(
        'RELATIVE_STORED_PATH_IS_ABSOLUTE',
        'A relative StoredPath value must not be an absolute path.',
      );
    }
    const resolved = winPath.resolve(this.dataRootWindows, value);
    if (!this.isWithin(resolved)) {
      throw new PathResolverError(
        'TRAVERSAL_ESCAPE',
        'Relative stored path traversal escapes the configured data root.',
      );
    }
    return toForwardSlash(resolved);
  }

  /**
   * Measure the resolved absolute length of a path and return advisory diagnostics. Paths longer
   * than the legacy 260-character MAX_PATH limit are flagged but never rejected, because long
   * path support is an operating-system configuration rather than a hard universal limit.
   */
  public inspectWindowsPathLength(input: string): WindowsPathLengthReport {
    assertNoNul(input, 'path');
    assertNonEmpty(input, 'path');
    const normalized = normalizeRaw(input);
    const resolved = winPath.isAbsolute(normalized)
      ? normalized
      : winPath.resolve(this.dataRootWindows, normalized);
    const canonical = toForwardSlash(resolved);
    const length = canonical.length;
    const exceedsLegacyLimit = length > LEGACY_MAX_PATH;
    const warnings: string[] = [];
    if (exceedsLegacyLimit) {
      warnings.push(
        `Path length ${length} exceeds the legacy Windows MAX_PATH limit of ${LEGACY_MAX_PATH}; this is supported on long-path-aware configurations but may fail in legacy tooling.`,
      );
    } else if (length > LEGACY_MAX_PATH - 20) {
      warnings.push(
        `Path length ${length} is near the legacy ${LEGACY_MAX_PATH}-character Windows limit.`,
      );
    }
    return {
      resolvedPath: canonical,
      length,
      legacyLimit: LEGACY_MAX_PATH,
      exceedsLegacyLimit,
      warnings,
    };
  }

  /** Segment-aware lexical containment using `path.win32.relative`. */
  private isWithin(candidate: string): boolean {
    if (!winPath.isAbsolute(candidate)) return false;
    const rel = winPath.relative(this.dataRootWindows, candidate);
    if (rel === '') return true; // equal to the data root
    if (rel === '..') return false; // immediate parent
    if (rel.startsWith('..' + winPath.sep)) return false; // traversal above the data root
    if (winPath.isAbsolute(rel)) return false; // different drive or root
    return true; // a relative path that does not escape the data root
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertNonEmpty(value: string, context: string): void {
  if (value.length === 0) {
    throw new PathResolverError('EMPTY_PATH', `The ${context} must not be empty.`);
  }
}

function assertNoNul(value: string, context: string): void {
  if (value.includes('\0')) {
    throw new PathResolverError('NUL_CHARACTER', `The ${context} must not contain NUL characters.`);
  }
}

function assertValidStoredPath(stored: StoredPath): void {
  if (typeof stored !== 'object' || stored === null) {
    throw new PathResolverError('MALFORMED_STORED_PATH', 'StoredPath must be an object.');
  }
  const { kind, value } = stored as { kind?: unknown; value?: unknown };
  if (kind !== 'relative' && kind !== 'external') {
    throw new PathResolverError(
      'MALFORMED_STORED_PATH',
      'StoredPath.kind must be "relative" or "external".',
    );
  }
  if (typeof value !== 'string') {
    throw new PathResolverError('MALFORMED_STORED_PATH', 'StoredPath.value must be a string.');
  }
  if (value.includes('\0')) {
    throw new PathResolverError(
      'NUL_CHARACTER',
      'StoredPath.value must not contain NUL characters.',
    );
  }
  if (kind === 'external' && value.length === 0) {
    throw new PathResolverError(
      'MALFORMED_STORED_PATH',
      'An external StoredPath must not be empty.',
    );
  }
}

/**
 * Strip the Windows extended-length path prefixes `\\?\` and `\\?\UNC\` (and their forward-slash
 * variants) so the remainder can be parsed normally. `\\?\C:\Projects` becomes `C:\Projects` and
 * `\\?\UNC\server\share\foo` becomes `\\server\share\foo`.
 */
function stripExtendedPrefix(raw: string): string {
  const lowered = raw.toLowerCase();
  if (lowered.startsWith('\\\\?\\unc\\') || lowered.startsWith('//?/unc/')) {
    return '\\\\' + raw.slice(8).replace(/\//g, '\\');
  }
  if (lowered.startsWith('\\\\?\\') || lowered.startsWith('//?/')) {
    return raw.slice(4).replace(/\//g, '\\');
  }
  return raw;
}

/** Normalize a raw path: strip extended prefixes, resolve `.`/`..` lexically, drop trailing separators. */
function normalizeRaw(raw: string): string {
  return stripTrailingSeparator(winPath.normalize(stripExtendedPrefix(raw)));
}

/** Remove trailing path separators while preserving drive roots such as `C:\`. */
function stripTrailingSeparator(p: string): string {
  if (/^[a-zA-Z]:\\$/.test(p)) return p; // drive root C:\
  if (/^[a-zA-Z]:$/.test(p)) return p + '\\'; // bare drive C: -> C:\
  if (p.length <= 1) return p; // root slash or single char
  return p.replace(/[\\/]+$/, '');
}

/** Convert Windows backslashes to forward slashes for portable storage and comparison. */
function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Detect whether a stored relative value is lexically an absolute path (drive, UNC, or leading slash). */
function looksAbsolute(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes('\0')) return false;
  const forward = value.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(forward) || /^\/\//.test(forward) || /^\//.test(forward);
}
