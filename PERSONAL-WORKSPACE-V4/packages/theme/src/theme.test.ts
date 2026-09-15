/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isResolvedTheme,
  isThemePreference,
  prefersReducedMotion,
  readStoredThemePreference,
  resolveInitialTheme,
  resolveTheme,
  subscribeReducedMotion,
  THEME_STORAGE_KEY,
} from './index';

/**
 * Focused tests for the shared NON-VISUAL V4 theme mechanics.
 *
 *   H. Light preference applies expected theme state.
 *   I. Dark preference applies expected theme state.
 *   J. System preference resolves from the system authority.
 *   K. Stored theme preference can be restored.
 *   L. reduced-motion foundation is respected structurally.
 */

function stubMatchMedia(dark: boolean, reduced = false): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === '(prefers-color-scheme: dark)'
          ? dark
          : query === '(prefers-reduced-motion: reduce)'
            ? reduced
            : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function stubMatchMediaThrow(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => {
      throw new Error('matchMedia unavailable');
    }),
  );
}

describe('resolveTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('explicit light preference resolves to light', () => {
    stubMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
  });

  it('explicit dark preference resolves to dark', () => {
    stubMatchMedia(false);
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('system preference resolves from the system authority (dark)', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('system preference resolves from the system authority (light)', () => {
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('null preference (none stored) resolves from the system authority', () => {
    stubMatchMedia(true);
    expect(resolveTheme(null)).toBe('dark');
  });

  it('falls back to light when matchMedia is unavailable', () => {
    stubMatchMediaThrow();
    expect(resolveTheme('system')).toBe('light');
  });

  it('readStoredThemePreference returns null for absent/invalid/unreadable values', () => {
    window.localStorage.clear();
    expect(readStoredThemePreference()).toBeNull();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-purple');
    expect(readStoredThemePreference()).toBeNull();
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredThemePreference()).toBeNull();
    getItem.mockRestore();
  });

  it('stored theme preference can be restored', () => {
    stubMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredThemePreference()).toBe('dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('isThemePreference accepts light|dark|system only', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('Light')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });

  it('isResolvedTheme accepts light|dark only', () => {
    expect(isResolvedTheme('light')).toBe(true);
    expect(isResolvedTheme('dark')).toBe(true);
    expect(isResolvedTheme('system')).toBe(false);
  });
});

describe('reduced-motion foundation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefersReducedMotion reflects the system request', () => {
    stubMatchMedia(false, true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('prefersReducedMotion returns false when not requested or unavailable', () => {
    stubMatchMedia(false, false);
    expect(prefersReducedMotion()).toBe(false);
    stubMatchMediaThrow();
    expect(prefersReducedMotion()).toBe(false);
  });

  it('subscribeReducedMotion invokes the callback with the current value', () => {
    stubMatchMedia(false, true);
    const onChange = vi.fn();
    subscribeReducedMotion(onChange);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('subscribeReducedMotion returns an unsubscribe that stops updates', () => {
    stubMatchMedia(false, false);
    const onChange = vi.fn();
    const unsubscribe = subscribeReducedMotion(onChange);
    expect(onChange).toHaveBeenCalledWith(false);
    unsubscribe();
    // Calling unsubscribe must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });
});
