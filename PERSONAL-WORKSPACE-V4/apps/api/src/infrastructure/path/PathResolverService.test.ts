import { describe, expect, it } from 'vitest';
import { PathResolverError, PathResolverService, type StoredPath } from './PathResolverService';

const DATA_ROOT = 'C:\\Projects';

function makeService(dataRoot = DATA_ROOT): PathResolverService {
  return new PathResolverService(dataRoot);
}

/** Assert that `fn` throws a PathResolverError with the exact expected code. */
function expectErrorCode(fn: () => unknown, code: PathResolverError['code']): void {
  try {
    fn();
    throw new Error('expected PathResolverError to be thrown');
  } catch (error) {
    if (!(error instanceof PathResolverError)) {
      throw error;
    }
    expect(error.code).toBe(code);
  }
}

describe('PathResolverService', () => {
  it('normalizes an absolute path inside the data root', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('C:\\Projects\\Villa\\01_DRAWINGS')).toBe(
      'C:/Projects/Villa/01_DRAWINGS',
    );
  });

  it('treats the data root itself as inside the data root', () => {
    const service = makeService();
    expect(service.isWithinDataRoot('C:\\Projects')).toBe(true);
    expect(service.isWithinDataRoot('C:\\Projects\\')).toBe(true);
  });

  it('classifies a deeply nested path as inside the data root', () => {
    const service = makeService();
    expect(service.isWithinDataRoot('C:\\Projects\\Alpha\\Beta\\Gamma\\Delta')).toBe(true);
  });

  it('normalizes mixed forward and backward separators', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('C:\\Projects/Villa\\Sub/Deep')).toBe(
      'C:/Projects/Villa/Sub/Deep',
    );
  });

  it('compares Windows paths case-insensitively for equality', () => {
    const service = makeService();
    expect(service.canonicalizeForComparison('C:\\projects\\VILLA\\Sub')).toBe(
      service.canonicalizeForComparison('c:/PROJECTS/villa/sub'),
    );
  });

  it('stores an inside-root path as a forward-slash relative path', () => {
    const service = makeService();
    const stored = service.toStoredPath('C:\\Projects\\Villa\\01_DRAWINGS');
    expect(stored).toEqual({ kind: 'relative', value: 'Villa/01_DRAWINGS' });
  });

  it('resolves the same relative stored path after the data root moves', () => {
    const first = makeService('C:\\Projects');
    const stored = first.toStoredPath('C:\\Projects\\Villa\\01_DRAWINGS');
    expect(stored).toEqual({ kind: 'relative', value: 'Villa/01_DRAWINGS' });

    const moved = makeService('D:\\Moved\\Projects');
    expect(moved.resolveStoredPath(stored)).toBe('D:/Moved/Projects/Villa/01_DRAWINGS');
  });

  it('classifies a path outside the data root as external', () => {
    const service = makeService();
    const stored = service.toStoredPath('C:\\Archive\\Villa');
    expect(stored).toEqual({ kind: 'external', value: 'C:/Archive/Villa' });
    expect(service.resolveStoredPath(stored)).toBe('C:/Archive/Villa');
  });

  it('classifies a path on a different drive as external', () => {
    const service = makeService('C:\\Projects');
    const stored = service.toStoredPath('D:\\Exports\\Villa');
    expect(stored.kind).toBe('external');
    expect(service.resolveStoredPath(stored)).toBe('D:/Exports/Villa');
  });

  it('classifies an external UNC path as external', () => {
    const service = makeService();
    const stored = service.toStoredPath('\\\\nas\\share\\Projects\\Villa');
    expect(stored.kind).toBe('external');
    expect(service.resolveStoredPath(stored)).toBe('//nas/share/Projects/Villa');
  });

  it('rejects relative traversal that would escape the data root on resolve', () => {
    const service = makeService();
    const stored: StoredPath = { kind: 'relative', value: 'Villa/../../Escape' };
    expectErrorCode(() => service.resolveStoredPath(stored), 'TRAVERSAL_ESCAPE');
  });

  it('rejects an absolute value supplied as a relative StoredPath', () => {
    const service = makeService();
    const stored: StoredPath = { kind: 'relative', value: 'C:/Projects/Villa' };
    expectErrorCode(() => service.resolveStoredPath(stored), 'RELATIVE_STORED_PATH_IS_ABSOLUTE');
  });

  it('rejects an empty path input', () => {
    const service = makeService();
    expectErrorCode(() => service.normalizeAbsolutePath(''), 'EMPTY_PATH');
    expectErrorCode(() => service.toStoredPath(''), 'EMPTY_PATH');
  });

  it('rejects NUL characters', () => {
    const service = makeService();
    expectErrorCode(() => service.normalizeAbsolutePath('C:\\Projects\\Vil\0la'), 'NUL_CHARACTER');
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'relative', value: 'Vil\0la' }),
      'NUL_CHARACTER',
    );
  });

  it('normalizes trailing separators consistently', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('C:\\Projects\\Villa\\\\')).toBe('C:/Projects/Villa');
    expect(service.isWithinDataRoot('C:\\Projects\\Villa\\')).toBe(true);
  });

  it('does not treat a similar-prefix sibling as a child of the data root', () => {
    const service = makeService('C:\\Projects');
    expect(service.isWithinDataRoot('C:\\Projects-Archive\\Villa')).toBe(false);
    const stored = service.toStoredPath('C:\\Projects-Archive\\Villa');
    expect(stored.kind).toBe('external');
  });

  it('reports path-length diagnostics below the legacy 260 limit', () => {
    const service = makeService();
    const report = service.inspectWindowsPathLength('C:\\Projects\\Villa');
    expect(report.legacyLimit).toBe(260);
    expect(report.exceedsLegacyLimit).toBe(false);
    expect(report.warnings).toEqual([]);
    expect(report.resolvedPath).toBe('C:/Projects/Villa');
  });

  it('reports path-length diagnostics above the legacy 260 limit without rejecting', () => {
    const service = makeService();
    const longSegment = 'A'.repeat(300);
    const report = service.inspectWindowsPathLength(`C:\\Projects\\${longSegment}`);
    expect(report.exceedsLegacyLimit).toBe(true);
    expect(report.length).toBeGreaterThan(260);
    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain('exceeds the legacy Windows MAX_PATH limit');
  });

  it('rejects malformed StoredPath input with exact codes', () => {
    const service = makeService();
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'bogus', value: 'x' } as unknown as StoredPath),
      'MALFORMED_STORED_PATH',
    );
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'relative' } as unknown as StoredPath),
      'MALFORMED_STORED_PATH',
    );
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'external', value: '' } as unknown as StoredPath),
      'MALFORMED_STORED_PATH',
    );
  });

  it('rejects constructing the service with a relative data root', () => {
    expectErrorCode(() => makeService('relative/path'), 'EXTERNAL_PATH_REQUIRED');
  });

  it('resolves a relative stored path representing the data root itself', () => {
    const service = makeService();
    const stored = service.toStoredPath('C:\\Projects');
    expect(stored).toEqual({ kind: 'relative', value: '' });
    expect(service.resolveStoredPath(stored)).toBe('C:/Projects');
  });

  it('rejects an empty data root on construction', () => {
    expectErrorCode(() => new PathResolverService(''), 'EMPTY_PATH');
  });

  it('rejects NUL characters in the data root on construction', () => {
    expectErrorCode(() => new PathResolverService('C:\\Pro\0jects'), 'NUL_CHARACTER');
  });

  it('supports a drive root such as C:\\ as the data root', () => {
    const service = makeService('C:\\');
    expect(service.dataRoot).toBe('C:/');
    expect(service.isWithinDataRoot('C:\\Projects\\Villa')).toBe(true);
    expect(service.toStoredPath('C:\\Projects\\Villa')).toEqual({
      kind: 'relative',
      value: 'Projects/Villa',
    });
  });

  it('supports a UNC root such as \\\\server\\share as the data root', () => {
    const service = makeService('\\\\server\\share');
    expect(service.dataRoot).toBe('//server/share');
    expect(service.isWithinDataRoot('\\\\server\\share\\Projects\\Villa')).toBe(true);
    expect(service.toStoredPath('\\\\server\\share\\Projects\\Villa')).toEqual({
      kind: 'relative',
      value: 'Projects/Villa',
    });
  });

  it('classifies a sibling directory outside the data root as external', () => {
    const service = makeService();
    expect(service.isWithinDataRoot('C:\\Sibling\\Villa')).toBe(false);
    expect(service.toStoredPath('C:\\Sibling\\Villa').kind).toBe('external');
  });

  it('classifies a different UNC share as external', () => {
    const service = makeService('\\\\nas\\share');
    const stored = service.toStoredPath('\\\\other\\share\\foo');
    expect(stored).toEqual({ kind: 'external', value: '//other/share/foo' });
    expect(service.resolveStoredPath(stored)).toBe('//other/share/foo');
  });

  it('does not treat a drive-relative path such as C:folder as absolute', () => {
    const service = makeService();
    expect(service.isWithinDataRoot('C:folder')).toBe(false);
    expectErrorCode(() => service.toStoredPath('C:folder'), 'EXTERNAL_PATH_REQUIRED');
    expect(service.normalizeAbsolutePath('C:folder')).toBe('C:folder');
  });

  it('handles a rooted-without-drive path such as \\folder safely as external', () => {
    const service = makeService('C:\\Projects');
    expect(service.isWithinDataRoot('\\folder')).toBe(false);
    const stored = service.toStoredPath('\\folder');
    expect(stored.kind).toBe('external');
    expect(service.resolveStoredPath(stored)).toBe('/folder');
  });

  it('normalizes a forward-slash drive path', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('C:/Projects/Villa')).toBe('C:/Projects/Villa');
  });

  it('preserves UNC server and share boundaries during normalization', () => {
    const service = makeService();
    const stored = service.toStoredPath('\\\\nas\\share\\Deep\\Sub\\File.pdf');
    expect(stored).toEqual({ kind: 'external', value: '//nas/share/Deep/Sub/File.pdf' });
  });

  it('supports the \\\\?\\C:\\ extended-length prefix', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('\\\\?\\C:\\Projects\\Villa')).toBe('C:/Projects/Villa');
    const stored = service.toStoredPath('\\\\?\\C:\\Projects\\Villa');
    expect(stored).toEqual({ kind: 'relative', value: 'Villa' });
    expect(service.resolveStoredPath(stored)).toBe('C:/Projects/Villa');
  });

  it('supports the \\\\?\\UNC\\server\\share extended-length prefix', () => {
    const service = makeService('\\\\nas\\share');
    expect(service.normalizeAbsolutePath('\\\\?\\UNC\\nas\\share\\Projects\\Villa')).toBe(
      '//nas/share/Projects/Villa',
    );
    const stored = service.toStoredPath('\\\\?\\UNC\\nas\\share\\Projects\\Villa');
    expect(stored).toEqual({ kind: 'relative', value: 'Projects/Villa' });
  });

  it('does not let repeated separators alter containment', () => {
    const service = makeService();
    expect(service.isWithinDataRoot('C:\\Projects\\\\Villa\\')).toBe(true);
    expect(service.isWithinDataRoot('C:\\Projects\\\\..\\\\Villa')).toBe(false);
  });

  it('normalizes dot segments safely', () => {
    const service = makeService();
    expect(service.normalizeAbsolutePath('C:\\Projects\\.\\Villa\\..')).toBe('C:/Projects');
  });

  it('rejects a relative stored value that begins with a separator', () => {
    const service = makeService();
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'relative', value: '\\folder' }),
      'RELATIVE_STORED_PATH_IS_ABSOLUTE',
    );
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'relative', value: '/folder' }),
      'RELATIVE_STORED_PATH_IS_ABSOLUTE',
    );
  });

  it('rejects a relative stored value that disguises a UNC path', () => {
    const service = makeService();
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'relative', value: '//server/share/foo' }),
      'RELATIVE_STORED_PATH_IS_ABSOLUTE',
    );
  });

  it('rejects an external stored value that is relative with an exact code', () => {
    const service = makeService();
    expectErrorCode(
      () => service.resolveStoredPath({ kind: 'external', value: 'relative/path' }),
      'EXTERNAL_PATH_REQUIRED',
    );
  });

  it('normalizes external value separators without converting to relative', () => {
    const service = makeService();
    const stored: StoredPath = { kind: 'external', value: 'C:\\Archive\\Villa/Sub' };
    expect(service.resolveStoredPath(stored)).toBe('C:/Archive/Villa/Sub');
  });

  it('measures length from the resolved Windows path and ignores the extended-length prefix', () => {
    const service = makeService();
    const report = service.inspectWindowsPathLength('\\\\?\\C:\\Projects');
    expect(report.resolvedPath).toBe('C:/Projects');
    expect(report.length).toBe('C:/Projects'.length);
    expect(report.exceedsLegacyLimit).toBe(false);
  });

  it('reports a deterministic near-limit warning between 240 and 260 characters', () => {
    const service = makeService();
    const segment = 'A'.repeat(240);
    const report = service.inspectWindowsPathLength(`C:\\Projects\\${segment}`);
    expect(report.length).toBeGreaterThan(240);
    expect(report.length).toBeLessThanOrEqual(260);
    expect(report.exceedsLegacyLimit).toBe(false);
    expect(report.warnings.length).toBe(1);
    expect(report.warnings[0]).toContain('near the legacy');
  });
});
