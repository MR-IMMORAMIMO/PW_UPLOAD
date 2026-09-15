/**
 * V4 API client environment binding.
 *
 * This is the V4-owned binding that wires the shared `@scli/api-client` to the
 * V4 renderer's environment. It MUST NOT import `apps/web/src/api.ts` or any
 * Teams binding. All canonical request machinery lives in `@scli/api-client`.
 *
 * Authentication mode selection (V4-local, non-duplicative):
 *
 *   - DEV / mock (Vite dev server): Personal auto-login resolves the owner by
 *     default. An `x-mock-user-id` header is sent only after an actor is
 *     explicitly selected in local storage.
 *   - PRODUCTION (built bundle served by the personal production server): the
 *     personal runtime runs with `PERSONAL_AUTO_LOGIN=true`, so the server
 *     auto-resolves the active local owner and NO auth header is required.
 *     Sending the mock header is unnecessary in production; the binding sends
 *     none so the request matches the same auto-login behavior as legacy.
 *
 * The mode is derived from `import.meta.env.PROD` (true only in a production
 * build), which is the smallest V4-local runtime switch — no Teams SDK, no
 * `apps/web` import, no duplicate request logic.
 */
import { createApiClient, type ApiClientEnvironment } from '@scli/api-client';

const MOCK_USER_ID_KEY = 'scli.mockUserId';

const IS_PRODUCTION = Boolean(import.meta.env.PROD);

function readExplicitMockUserId(): string | null {
  try {
    return window.localStorage.getItem(MOCK_USER_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * V4 environment binding.
 *
 * In production (personal auto-login) no auth header is attached. Dev/mock uses
 * the same default and preserves explicit actor selection for test scenarios.
 */
export function createV4ApiEnvironment(): ApiClientEnvironment {
  return {
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async getAuthHeaders() {
      if (IS_PRODUCTION) return {};
      const userId = readExplicitMockUserId();
      return userId ? { 'x-mock-user-id': userId } : {};
    },
  };
}

export const v4ApiClient = createApiClient(createV4ApiEnvironment());
export const api = v4ApiClient.api;
export const apiRequest = v4ApiClient.apiRequest;
