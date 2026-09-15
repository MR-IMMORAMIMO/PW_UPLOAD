/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { V4ThemeProvider } from '../theme/ThemeProvider';
import { FoundationScreen } from './FoundationScreen';

/**
 * Foundation screen tests.
 *
 *   F. Foundation read-only query handles success.
 *   G. Foundation query handles API failure without crashing.
 *   A. V4 root (Foundation screen) renders independently.
 */
function renderFoundation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <FoundationScreen />
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
};

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'corr-1' },
    json: () => Promise.resolve(body),
  };
}

describe('FoundationScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('v4-reduced-motion');
  });

  it('renders the diagnostic screen independently (A)', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderFoundation();
    expect(screen.getByTestId('v4-foundation')).toBeInTheDocument();
    expect(screen.getByText('Clean Renderer Foundation')).toBeInTheDocument();
  });

  it('reports API Connected on a successful read-only query (F)', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderFoundation();
    await waitFor(() => expect(screen.getByTestId('v4-api-state')).toHaveTextContent('Connected'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }];
    expect(url).toMatch(/^\/api\/projects/);
    expect(init?.method).toBe('GET');
  });

  it('reports API Unavailable on a failed read-only query without crashing (G)', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'REQUEST_FAILED', message: 'down', correlationId: 'c' } },
            500,
          ),
        ),
    );
    renderFoundation();
    await waitFor(() =>
      expect(screen.getByTestId('v4-api-state')).toHaveTextContent('Unavailable'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable/i);
    // The diagnostic shell still renders (no crash).
    expect(screen.getByTestId('v4-foundation')).toBeInTheDocument();
  });
});
