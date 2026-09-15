/**
 * Due-date semantic state derivation tests (pure).
 *
 *   M. Due-soon/overdue semantic state derivation is correct.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DUE_SOON_DAYS, deriveDueState } from './dueState';

describe('deriveDueState', () => {
  // Fixed "now" for deterministic assertions (UTC noon).
  const now = new Date('2026-08-13T12:00:00Z');

  it('returns neutral for a missing or null due date', () => {
    expect(deriveDueState(null, now)).toBe('neutral');
    expect(deriveDueState(undefined, now)).toBe('neutral');
    expect(deriveDueState('', now)).toBe('neutral');
  });

  it('returns neutral for an invalid date string', () => {
    expect(deriveDueState('not-a-date', now)).toBe('neutral');
  });

  it('returns neutral for a far-future due date', () => {
    expect(deriveDueState('2026-10-01T00:00:00Z', now)).toBe('neutral');
  });

  it('returns soon when due within the default window', () => {
    // 2026-08-16 is 3 days after 2026-08-13.
    expect(deriveDueState('2026-08-16T00:00:00Z', now)).toBe('soon');
  });

  it('treats today as soon, not overdue', () => {
    expect(deriveDueState('2026-08-13T23:59:00Z', now)).toBe('soon');
  });

  it('returns overdue for a date before today', () => {
    expect(deriveDueState('2026-08-12T00:00:00Z', now)).toBe('overdue');
    expect(deriveDueState('2026-08-01T00:00:00Z', now)).toBe('overdue');
  });

  it('respects a custom soon window', () => {
    expect(deriveDueState('2026-08-22T00:00:00Z', now, 10)).toBe('soon');
    // 2026-08-24 is 11 days out, beyond the 10-day window.
    expect(deriveDueState('2026-08-24T00:00:00Z', now, 10)).toBe('neutral');
    expect(DEFAULT_DUE_SOON_DAYS).toBe(7);
  });
});
