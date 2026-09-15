/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';

/**
 * Prepaint bootstrap tests (see P2-UX-01-H1 requirements 10-12).
 *
 * These evaluate the ACTUAL `public/theme-prepaint.js` file that is loaded
 * synchronously from <head> before the app bundle. We read the real bytes and
 * execute the IIFE in the jsdom global scope — this is not a duplicated helper,
 * it is the exact script the browser runs.
 */
const PREPAINT_PATH = 'apps/web/public/theme-prepaint.js';

function runPrepaintScript(): void {
  const source = readFileSync(PREPAINT_PATH, 'utf8');
  // The file is a self-contained IIFE referencing the jsdom globals
  // (window.localStorage, window.matchMedia, document.documentElement).
  const fn = new Function(source);
  fn();
}

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

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('prepaint theme bootstrap', () => {
  it('saved dark sets documentElement.dataset.theme to dark', () => {
    stubMatchMedia(false); // system is Light — saved Dark must still win
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runPrepaintScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('saved light sets documentElement.dataset.theme to light', () => {
    stubMatchMedia(true); // system is Dark — saved Light must still win
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runPrepaintScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('no saved preference + system Dark sets dark', () => {
    stubMatchMedia(true);
    runPrepaintScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('no saved preference + system Light sets light', () => {
    stubMatchMedia(false);
    runPrepaintScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('invalid saved value is ignored and falls back to the system preference', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-purple');
    runPrepaintScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('storage access failure does not throw and falls back to the system preference', () => {
    stubMatchMedia(true);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => runPrepaintScript()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('storage + matchMedia both failing does not throw and falls back to light', () => {
    stubMatchMediaThrow();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => runPrepaintScript()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
