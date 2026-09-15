/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { normalizeBasePath, V4_ROUTER_BASENAME } from './base-path';
import { ROUTE_DIAGNOSTIC, ROUTE_FOUNDATION, ROUTE_NOT_FOUND } from './routes';

/**
 * Temporary migration base-path contract tests.
 *
 * Application routes are canonical relative routes; `/v4` is NOT repeated into
 * every route definition. The base is centralized and configurable.
 */
describe('V4 base-path contract', () => {
  it('exposes a configurable router basename (default /v4 during migration)', () => {
    expect(V4_ROUTER_BASENAME).toBe('/v4');
  });

  it('canonical routes do NOT embed the /v4 prefix', () => {
    expect(ROUTE_FOUNDATION).toBe('/');
    expect(ROUTE_DIAGNOSTIC).toBe('/diagnostic');
    expect(ROUTE_NOT_FOUND).toBe('*');
    expect(ROUTE_FOUNDATION).not.toContain('/v4');
    expect(ROUTE_DIAGNOSTIC).not.toContain('/v4');
  });

  it('normalizes a base path to leading-slash, no-trailing-slash form', () => {
    expect(normalizeBasePath('/v4/')).toBe('/v4');
    expect(normalizeBasePath('v4')).toBe('/v4');
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
  });
});
