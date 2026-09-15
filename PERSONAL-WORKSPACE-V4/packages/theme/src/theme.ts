/**
 * Shared NON-VISUAL theme mechanics for the Personal Workspace V4 renderer.
 *
 * This package deliberately contains NO visual styles, no React, and no
 * renderer-specific code. It owns only the *behavior* of theme resolution:
 * the stored preference, the system preference, the resolved light/dark value,
 * and reduced-motion detection. Each renderer (V4 today) supplies its own
 * visual token / style surface and its own prepaint bootstrap.
 *
 * Theme authority (kept in lock-step with `apps/web-v4/public/theme-prepaint.js`):
 *   1. A saved explicit `light` or `dark` preference wins.
 *   2. Otherwise (including an explicit `system` preference) fall back to the
 *      OS/browser preferred color scheme.
 *   3. Final fallback is `light` if the system API is unavailable.
 *
 * An invalid saved value is ignored and treated as "no preference".
 * Any localStorage/matchMedia exception must never break application startup.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Storage key for the V4 theme preference (namespaced to avoid legacy clash). */
export const THEME_STORAGE_KEY = 'scli.v4.theme';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
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
export function readSystemThemePreference(): ResolvedTheme {
  try {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Resolves a stored/system preference into a concrete light/dark value.
 * `system` (or null) resolves from the OS/browser authority.
 */
export function resolveTheme(preference: ThemePreference | null): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return readSystemThemePreference();
}

/**
 * Resolves the initial theme using the single authority rules above.
 * Used by the renderer so React initializes consistently with the theme the
 * prepaint script already applied (or would apply in a non-bundled context).
 */
export function resolveInitialTheme(): ResolvedTheme {
  return resolveTheme(readStoredThemePreference());
}

/** Reads whether the user has requested reduced motion, defaulting to false. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Subscribes to reduced-motion changes. Returns an unsubscribe function.
 * The callback is invoked immediately with the current value, then on change.
 */
export function subscribeReducedMotion(onChange: (reduced: boolean) => void): () => void {
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    onChange(false);
    return () => {};
  }
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  onChange(media.matches);
  media.addEventListener('change', handler);
  return () => media?.removeEventListener('change', handler);
}
