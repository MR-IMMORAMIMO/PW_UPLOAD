/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { normalizeBasePath, resolveV4Base } from './base-resolve';
import { V4_BASE_PATH, V4_ROUTER_BASENAME } from './router/base-path';

/**
 * F1C base-alignment contract.
 *
 * The React Router basename and the Vite asset base MUST resolve from the same
 * `VITE_V4_BASE_PATH` value so built JS/CSS/public URLs line up with the route
 * mount. Both are normalized through `normalizeBasePath`.
 */
describe('V4 router/vite base alignment', () => {
  it('defaults the base to /v4 during parallel development', () => {
    expect(resolveV4Base(undefined)).toBe('/v4');
    expect(V4_BASE_PATH).toBe('/v4');
  });

  it('router basename and Vite asset base normalize identically', () => {
    expect(V4_ROUTER_BASENAME).toBe(normalizeBasePath(V4_BASE_PATH));
    // Both must produce the same leading-slash, no-trailing-slash form.
    expect(V4_ROUTER_BASENAME).toBe('/v4');
  });

  it('cutover override (/ or custom base) normalizes consistently', () => {
    expect(resolveV4Base('/')).toBe('/');
    expect(resolveV4Base('/')).toBe(normalizeBasePath('/'));
    expect(resolveV4Base('/app/')).toBe('/app');
    expect(resolveV4Base('app')).toBe('/app');
  });
});
