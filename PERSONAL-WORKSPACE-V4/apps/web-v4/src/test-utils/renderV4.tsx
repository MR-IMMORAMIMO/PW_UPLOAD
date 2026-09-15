/**
 * Shared F2 test render helpers.
 *
 * Provides a full provider harness (QueryClient + V4ThemeProvider + MemoryRouter)
 * so focused shell/sidebar/header/diagnostic tests render with real context.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { V4ThemeProvider } from '../theme/ThemeProvider';
import { V4OverlayProvider } from '../components/interaction/V4OverlayProvider';
import { V4DirtyGuardProvider } from '../components/interaction/V4DirtyGuard';

/** Stub matchMedia for jsdom (theme provider reads it on mount). */
export function stubMatchMedia(options?: { dark?: boolean; reduced?: boolean }): void {
  const { dark = false, reduced = false } = options ?? {};
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === '(prefers-color-scheme: dark)'
          ? dark
          : query === '(prefers-reduced-motion: reduce)'
            ? reduced
            : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** Render an element inside the full V4 provider harness. */
export function renderV4(ui: ReactElement, initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: '*', element: <V4DirtyGuardProvider>{ui}</V4DirtyGuardProvider> }],
    { initialEntries },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <V4OverlayProvider>
          <RouterProvider router={router} />
        </V4OverlayProvider>
      </V4ThemeProvider>
    </QueryClientProvider>,
  );
}

export function cleanupV4(): void {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove('v4-reduced-motion');
  delete document.documentElement.dataset.theme;
}
