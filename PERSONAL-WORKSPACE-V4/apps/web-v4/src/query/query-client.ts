/**
 * Dedicated V4 QueryClient.
 *
 * V4 owns its own QueryClient — it does NOT reuse a singleton from `apps/web`.
 * Conservative defaults appropriate for a desktop professional app.
 */
import { QueryClient } from '@tanstack/react-query';

export function createV4QueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
