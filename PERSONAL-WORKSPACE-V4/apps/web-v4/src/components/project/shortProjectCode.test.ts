/** @vitest-environment node */
/**
 * H12 short project-code display helper tests (pure).
 *
 * Derives a compact presentation-only short code from a canonical Project.code
 * WITHOUT mutating the canonical value.
 */
import { describe, expect, it } from 'vitest';
import { deriveShortProjectCode } from './shortProjectCode';

describe('deriveShortProjectCode', () => {
  it('maps the current canonical example 001_SCT260809_TEST -> 001', () => {
    expect(deriveShortProjectCode('001_SCT260809_TEST')).toBe('001');
  });

  it('returns the leading token before the first underscore when present', () => {
    expect(deriveShortProjectCode('042_SCT270101_WAREHOUSE')).toBe('042');
  });

  it('returns the full code when it has no underscore segment', () => {
    expect(deriveShortProjectCode('ABC')).toBe('ABC');
  });

  it('returns null for empty / null / whitespace-leading input', () => {
    expect(deriveShortProjectCode('')).toBeNull();
    expect(deriveShortProjectCode(null)).toBeNull();
    expect(deriveShortProjectCode(undefined)).toBeNull();
    expect(deriveShortProjectCode('_only')).toBeNull();
  });
});
