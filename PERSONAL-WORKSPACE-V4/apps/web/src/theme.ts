/**
 * Single authority for resolving the initial theme before the first paint.
 *
 * Rules (must be kept in lock-step with `public/theme-prepaint.js`, which is
 * the synchronous pre-bundle bootstrap that cannot import this module):
 *
 *   1. A saved explicit `scli.theme` preference (light|dark) wins.
 *   2. Otherwise fall back to the OS/browser preferred color scheme.
 *   3. Final fallback is `light` if the system API is unavailable.
 *
 * An invalid saved value is ignored and treated as "no preference".
 * Any localStorage/security exception must never break application startup.
 */

export type ThemePreference = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'scli.theme';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

/** Reads the persisted explicit preference, or null when absent/invalid/unreadable. */
export function readStoredThemePreference(): ThemePreference | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : null;
  } catch {
    // localStorage unavailable (privacy mode, storage partition, security error).
    return null;
  }
}

/** Reads the OS/browser preferred color scheme, defaulting to `light` when unavailable. */
export function readSystemThemePreference(): ThemePreference {
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Resolves the initial theme using the single authority rules above.
 * Used by AppContext so React initializes consistently with the theme the
 * prepaint script already applied (or would apply in a non-bundled context).
 */
export function resolveInitialTheme(): ThemePreference {
  return readStoredThemePreference() ?? readSystemThemePreference();
}
