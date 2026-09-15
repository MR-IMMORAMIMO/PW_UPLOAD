/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { createV4QueryClient } from './query-client';

/**
 * Dedicated V4 QueryClient tests.
 *
 *   D. V4 QueryClient/provider exists and query execution is supported.
 */
describe('V4 QueryClient', () => {
  it('creates a dedicated QueryClient with conservative defaults', () => {
    const client = createV4QueryClient();
    expect(client).toBeDefined();
    expect(client.getDefaultOptions().queries?.retry).toBe(1);
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('produces an independent client instance (not a shared singleton)', () => {
    const first = createV4QueryClient();
    const second = createV4QueryClient();
    expect(first).not.toBe(second);
  });
});
