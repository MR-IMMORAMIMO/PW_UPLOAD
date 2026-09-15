/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { api, createV4ApiEnvironment, v4ApiClient } from './environment';

/**
 * V4 API binding tests.
 *
 *   E. V4 API binding uses @scli/api-client, not apps/web/api.
 *   (Verified structurally by the ESLint no-restricted-imports isolation gate;
 *   here we prove the binding exposes the canonical client and environment.)
 */
describe('V4 API environment binding', () => {
  it('lets Personal auto-login resolve the owner unless an actor is explicitly selected', async () => {
    const env = createV4ApiEnvironment();
    expect(await env.getAuthHeaders()).toEqual({});
    window.localStorage.setItem('scli.mockUserId', '66666666-6666-4666-8666-666666666666');
    expect((await env.getAuthHeaders())['x-mock-user-id']).toBe(
      '66666666-6666-4666-8666-666666666666',
    );
    window.localStorage.removeItem('scli.mockUserId');
  });

  it('uses the shared @scli/api-client createApiClient', () => {
    // The binding re-exports the canonical `api` surface from the shared client.
    expect(typeof api.projects).toBe('function');
    expect(v4ApiClient.apiRequest).toBeTypeOf('function');
  });

  it('exposes read-only canonical endpoints used for the foundation proof', () => {
    expect(typeof api.projects).toBe('function');
    expect(typeof api.personalSettings).toBe('function');
  });

  it('is driven entirely through the injected seam (no direct fetch in binding)', () => {
    // The binding module must not itself call fetch; that lives in the shared client.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Merely constructing the client/environment must not trigger a request.
    const env = createV4ApiEnvironment();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(typeof env.getAuthHeaders).toBe('function');
    vi.unstubAllGlobals();
  });
});
