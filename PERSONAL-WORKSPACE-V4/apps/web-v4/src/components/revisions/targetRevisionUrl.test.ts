/**
 * C1 — the address is the ONLY authority for the composition target.
 *
 * These tests pin the parsing contract (what counts as a target, what counts as
 * malformed), the search string used to navigate onto an existing route, and the
 * local verdict used for an address that cannot name a Revision at all.
 */
/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  malformedTargetVerdict,
  readTargetRevisionParam,
  targetRevisionSearch,
  TARGET_REVISION_PARAM,
} from './targetRevisionUrl';

const TARGET_ID = '22222222-2222-4222-8222-222222222222';

describe('TARGET_REVISION_PARAM', () => {
  it('is the query parameter name, so no route pattern has to change', () => {
    expect(TARGET_REVISION_PARAM).toBe('targetRevisionId');
  });
});

describe('readTargetRevisionParam', () => {
  it('returns null when the address carries no target', () => {
    expect(readTargetRevisionParam(new URLSearchParams(''))).toBeNull();
    expect(readTargetRevisionParam(new URLSearchParams('revisionId=abc'))).toBeNull();
  });

  it('treats an empty or whitespace-only value as no target at all', () => {
    expect(readTargetRevisionParam(new URLSearchParams('targetRevisionId='))).toBeNull();
    expect(readTargetRevisionParam(new URLSearchParams('targetRevisionId=%20%20'))).toBeNull();
  });

  it('reports a well-formed target verbatim', () => {
    expect(readTargetRevisionParam(new URLSearchParams(`targetRevisionId=${TARGET_ID}`))).toEqual({
      raw: TARGET_ID,
      wellFormed: true,
    });
  });

  it('accepts an upper-case UUID without rewriting it', () => {
    const upper = TARGET_ID.toUpperCase();
    expect(readTargetRevisionParam(new URLSearchParams(`targetRevisionId=${upper}`))).toEqual({
      raw: upper,
      wellFormed: true,
    });
  });

  it('reports a malformed reference instead of discarding it silently', () => {
    for (const raw of ['not-a-uuid', TARGET_ID.slice(0, -1), 'REV_06']) {
      expect(readTargetRevisionParam(new URLSearchParams(`targetRevisionId=${raw}`))).toEqual({
        raw,
        wellFormed: false,
      });
    }
  });

  it('ignores the historical revision selector, which is a separate concern', () => {
    const params = new URLSearchParams(`revisionId=other&targetRevisionId=${TARGET_ID}`);
    expect(readTargetRevisionParam(params)).toEqual({ raw: TARGET_ID, wellFormed: true });
  });
});

describe('targetRevisionSearch', () => {
  it('builds a search string that carries only the target', () => {
    expect(targetRevisionSearch(TARGET_ID)).toBe(`?targetRevisionId=${TARGET_ID}`);
  });

  it('round-trips through the parser', () => {
    const params = new URLSearchParams(targetRevisionSearch(TARGET_ID));
    expect(readTargetRevisionParam(params)).toEqual({ raw: TARGET_ID, wellFormed: true });
  });
});

describe('malformedTargetVerdict', () => {
  it('is an ineligible verdict that names the raw address value', () => {
    const verdict = malformedTargetVerdict('not-a-uuid');
    expect(verdict.revisionId).toBe('not-a-uuid');
    expect(verdict.eligible).toBe(false);
    expect(verdict.target).toBeNull();
    expect(verdict.rejection).toBe('TARGET_NOT_FOUND');
    expect(verdict.message).toBe(
      'The target Revision reference in the address is not a valid Revision identifier.',
    );
  });
});
