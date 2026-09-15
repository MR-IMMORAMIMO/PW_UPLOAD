/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V4Router } from '../../router/V4Router';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { V4RouteErrorState } from './V4RouteErrorState';

describe('V4RouteErrorState', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });
  it('renders a keyboard-reachable Retry that invokes the failed read authority once', () => {
    const onRetry = vi.fn();
    render(
      <V4RouteErrorState
        title="Unable to load revisions"
        message="Revision data could not be loaded."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load revisions');
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.keyDown(retry, { key: 'Enter' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prevents repeated retry while the refetch is pending', () => {
    render(
      <V4RouteErrorState
        title="Unable to load packages"
        message="Package data could not be loaded."
        retrying
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it.each([
    ['Summary', 'summary', 'workspace'],
    ['Timeline', 'workflow-timeline', 'workspace'],
    ['Actions', 'actions', 'workspace'],
    ['Scope', 'scope', 'workspace'],
    ['Meetings', 'meetings', 'meetings'],
    ['Revisions', 'revisions', 'revisions'],
    ['Packages', 'packages', 'workspace'],
    ['Technical Check', 'technical-check', 'workspace'],
  ])(
    '%s retries its failed canonical reads through the production route',
    async (_family, route, resource) => {
      const fetch = vi.fn((url: string) => {
        void url;
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: () => Promise.resolve({ error: { message: 'Read unavailable' } }),
        });
      });
      vi.stubGlobal('fetch', fetch);
      stubMatchMedia();
      renderV4(<V4Router />, [`/projects/p1/${route}`]);
      const retry = await screen.findByRole('button', { name: 'Retry' });
      const calls = () =>
        fetch.mock.calls.filter(([url]) => url.endsWith(`/api/projects/p1/${resource}`)).length;
      const before = calls();
      expect(before).toBeGreaterThan(0);
      fireEvent.click(retry);
      await waitFor(() => expect(calls()).toBeGreaterThan(before));
    },
  );
});
