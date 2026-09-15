/**
 * Legacy compatibility / binding facade for the shared canonical API client.
 *
 * This module is the thin browser/tenant binding layer. It wires the shared
 * `@scli/api-client` package to the legacy renderer's environment:
 *
 *   - mock / standalone / m365 authentication mode
 *   - browser storage for mock user id and standalone session token
 *   - Teams SSO token acquisition (only in m365 mode)
 *   - the `scli:session-expired` browser event (only standalone, token present)
 *   - browser DOM download for binary helpers
 *
 * It contains NO independent request-logic implementation — all canonical
 * request machinery lives in the shared package. The legacy public import
 * surface is preserved via re-export so existing consumers need no changes.
 */
import { ApiError, createApiClient } from '@scli/api-client';
import { getTeamsSsoToken } from './teams';

let mockUserId = localStorage.getItem('scli.mockUserId') ?? '66666666-6666-4666-8666-666666666666';
let appMode: 'mock' | 'standalone' | 'm365' = 'mock';
let standaloneToken = sessionStorage.getItem('scli.sessionToken');

export function setMockUserId(userId: string): void {
  mockUserId = userId;
  localStorage.setItem('scli.mockUserId', userId);
}

export function setApiMode(mode: 'mock' | 'standalone' | 'm365'): void {
  appMode = mode;
}

export function setStandaloneToken(token: string | null): void {
  standaloneToken = token;
  if (token) sessionStorage.setItem('scli.sessionToken', token);
  else sessionStorage.removeItem('scli.sessionToken');
}

const client = createApiClient({
  async getAuthHeaders() {
    if (appMode === 'mock') {
      return { 'x-mock-user-id': mockUserId };
    }
    if (appMode === 'standalone') {
      return standaloneToken ? { authorization: `Bearer ${standaloneToken}` } : {};
    }
    return { authorization: `Bearer ${await getTeamsSsoToken()}` };
  },
  onSessionExpired() {
    // Preserve the legacy behavior exactly: only standalone mode with a token
    // clears the session and dispatches the browser session-expired event.
    if (appMode === 'standalone' && standaloneToken) {
      setStandaloneToken(null);
      window.dispatchEvent(new Event('scli:session-expired'));
    }
  },
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
});

export { ApiError, client as apiClient };
export const api = client.api;
export const apiRequest = client.apiRequest;
export const downloadCsv = client.downloadCsv;
export const downloadPeriodActivityExcel = client.downloadPeriodActivityExcel;

export type {
  FolderProfileDefaultMatch,
  FolderProfileCatalogView,
  FolderProfileCatalogResponse,
  LuminaireImportCandidate,
  LuminaireImportPreviewRow,
} from '@scli/api-client';
