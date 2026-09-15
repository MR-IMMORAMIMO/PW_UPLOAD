import './components/interaction/V4Decisions';
/**
 * V4 app entry.
 *
 * Composes the V4 providers (theme, query) and the router. The router base
 * path is applied once here via `V4_ROUTER_BASENAME`.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { createV4QueryClient } from './query/query-client';
import { V4Router } from './router/V4Router';
import { V4_ROUTER_BASENAME } from './router/base-path';
import { V4ThemeProvider } from './theme/ThemeProvider';
import { V4AccentProvider } from './theme/V4AccentProvider';
import { V4OverlayProvider } from './components/interaction/V4OverlayProvider';
import { V4DirtyGuardProvider } from './components/interaction/V4DirtyGuard';

const queryClient = createV4QueryClient();
const router = createBrowserRouter(
  [
    {
      path: '*',
      element: (
        <V4DirtyGuardProvider>
          <V4Router />
        </V4DirtyGuardProvider>
      ),
    },
  ],
  { basename: V4_ROUTER_BASENAME },
);

export function AppV4() {
  return (
    <QueryClientProvider client={queryClient}>
      <V4ThemeProvider>
        <V4AccentProvider>
          <V4OverlayProvider>
            <RouterProvider router={router} />
          </V4OverlayProvider>
        </V4AccentProvider>
      </V4ThemeProvider>
    </QueryClientProvider>
  );
}
