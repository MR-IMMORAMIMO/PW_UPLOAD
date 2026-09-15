/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isThemePreference,
  readStoredThemePreference,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
} from './theme';

/**
 * Focused theme-resolution tests for the single theme authority used to
 * initialize React state (see P2-UX-01-H1 requirements 1-6).
 *
 * Rules under test:
 *   1. a saved explicit preference (light|dark) wins;
 *   2. otherwise the OS/browser preferred color scheme;
 *   3. final fallback `light` if the system API is unavailable;
 *   an invalid saved value is ignored and falls back to the system preference.
 */

function stubMatchMedia(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? dark : false,
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

describe('resolveInitialTheme (single authority)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('no saved preference + system Dark resolves to Dark', () => {
    stubMatchMedia(true);
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('no saved preference + system Light resolves to Light', () => {
    stubMatchMedia(false);
    expect(resolveInitialTheme()).toBe('light');
  });

  it('saved dark + system Light keeps saved Dark', () => {
    stubMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('saved light + system Dark keeps saved Light', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('invalid saved value + system Dark falls back to Dark', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-purple');
    expect(resolveInitialTheme()).toBe('dark');
  });

  it('invalid saved value + system Light falls back to Light', () => {
    stubMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-purple');
    expect(resolveInitialTheme()).toBe('light');
  });

  it('falls back to Light when both storage and matchMedia are unavailable', () => {
    stubMatchMediaThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(resolveInitialTheme()).toBe('light');
  });

  it('readStoredThemePreference returns null for absent/invalid/unreadable values', () => {
    window.localStorage.clear();
    expect(readStoredThemePreference()).toBeNull();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'high-contrast');
    expect(readStoredThemePreference()).toBeNull();
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStoredThemePreference()).toBeNull();
    getItem.mockRestore();
  });

  it('isThemePreference only accepts light|dark', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('Light')).toBe(false);
    expect(isThemePreference('system')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});
