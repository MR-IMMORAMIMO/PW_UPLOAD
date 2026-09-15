/**
 * Theme prepaint bootstrap — runs synchronously in <head>, BEFORE the app
 * bundle, to set document.documentElement.dataset.theme on the first frame.
 *
 * Rules (single theme authority — kept in lock-step with src/theme.ts):
 *   1. A saved explicit `scli.theme` preference (light|dark) wins.
 *   2. Otherwise fall back to the OS/browser preferred color scheme.
 *   3. Final fallback is `light` if the system API is unavailable.
 *
 * This file MUST remain self-contained:
 *   - no imports / no bundler processing (served verbatim from /public)
 *   - synchronous
 *   - no DB access, no network access
 *   - must never throw a startup-fatal error
 *
 * It is served as `'self'` from /public and is therefore CSP-compliant under
 * the production policy (scriptSrc: ['self'], no 'unsafe-inline').
 */
(function () {
  var THEME_KEY = 'scli.theme';
  var SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
  var root = document.documentElement;

  function applyTheme(theme) {
    root.dataset.theme = theme;
  }

  try {
    var saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved);
      return;
    }
  } catch {
    // localStorage unavailable (privacy mode, storage partition, security
    // error). Fall through to the system preference below.
  }

  var systemDark = false;
  try {
    systemDark = window.matchMedia(SYSTEM_DARK_QUERY).matches;
  } catch {
    // matchMedia unavailable — final fallback to light.
  }

  applyTheme(systemDark ? 'dark' : 'light');
})();
