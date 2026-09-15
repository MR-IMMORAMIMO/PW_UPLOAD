/**
 * Environment / auth seam for the shared canonical API client.
 *
 * The shared package is intentionally environment-agnostic: it never imports
 * `@microsoft/teams-js`, `apps/web`, React, browser storage globals, or
 * window session events. Everything browser/tenant-specific is provided by the
 * caller through this injected seam (the legacy `apps/web` compatibility
 * facade today; the future `apps/web-v4` binding later).
 */

/**
 * Minimal storage abstraction used by a binding when it needs to persist
 * client state (e.g. a standalone session token). Only the members a binding
 * actually needs are required; all are optional beyond `getItem`.
 */
export interface ApiClientStorage {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * Injected environment services the canonical client needs to operate.
 *
 * - `getAuthHeaders` resolves the per-request authentication headers (Bearer
 *   token for standalone/m365, `x-mock-user-id` for mock mode). It is NOT
 *   called at client construction — only when a request is made.
 * - `onSessionExpired` is invoked when an authenticated request returns 401.
 *   The binding decides the exact semantics (e.g. only standalone mode clears
 *   the session token and dispatches `scli:session-expired`).
 * - `downloadBlob` triggers a client-side binary download. It is only used by
 *   the download helpers; the binding provides the browser DOM implementation.
 */
export interface ApiClientEnvironment {
  getAuthHeaders(): Promise<Record<string, string>>;
  onSessionExpired?: () => void;
  downloadBlob?(blob: Blob, filename: string): void;
}
