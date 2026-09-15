/**
 * V4 base-path resolution (pure, framework-agnostic).
 *
 * Single source of truth for the V4 renderer's base path so that:
 *
 *   - the React Router basename (`/v4` during parallel development) and
 *   - the Vite asset base (the URL prefix baked into built JS/CSS/public URLs)
 *
 * stay ALIGNED. Both read the same environment value (`VITE_V4_BASE_PATH`,
 * default `/v4`) and both are normalized through this one function. Importing
 * this module MUST NOT touch `import.meta.env` or `process.env` at module
 * scope so that both the browser bundle (base-path.ts) and the Vite config
 * (vite.config.ts) can import it safely.
 *
 *   - Parallel base: `/v4`
 *   - After cutover: `/`
 */
export function normalizeBasePath(base: string): string {
  const trimmed = base.trim();
  if (!trimmed) return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : '/';
}

/**
 * Resolve the normalized base from a raw environment value (possibly unset),
 * defaulting to the temporary migration namespace `/v4`.
 */
export function resolveV4Base(raw: string | undefined, fallback = '/v4'): string {
  return normalizeBasePath(raw ?? fallback);
}
