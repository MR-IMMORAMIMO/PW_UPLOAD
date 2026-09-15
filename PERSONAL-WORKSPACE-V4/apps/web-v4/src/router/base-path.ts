/**
 * V4 temporary migration base-path contract.
 *
 * During parallel development the V4 renderer is served under a TEMPORARY
 * `/v4` namespace. This module centralizes that base so `/v4` is NOT repeated
 * into every route definition. Application routes are internally canonical
 * relative routes; the renderer base/basename is configurable here.
 *
 *   - Development base: `/v4`
 *   - After cutover:     `/`
 *
 * The base is read once from `import.meta.env.VITE_V4_BASE_PATH` (default
 * `/v4`), so a deployment can override it without touching route code.
 */
import { normalizeBasePath, resolveV4Base } from '../base-resolve';

export { normalizeBasePath };

export const V4_BASE_PATH: string = resolveV4Base(
  import.meta.env.VITE_V4_BASE_PATH as string | undefined,
);

export const V4_ROUTER_BASENAME = normalizeBasePath(V4_BASE_PATH);
