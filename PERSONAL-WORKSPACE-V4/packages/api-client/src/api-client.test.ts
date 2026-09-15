import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, queryString, type ApiClientEnvironment } from './index';

/**
 * Contract tests for the shared canonical API client.
 *
 * These prove the client is environment-agnostic and driven entirely through
 * the injected seam:
 *   A. requests use the injected auth token provider
 *   B. no Teams-specific behavior exists (no import, no callback)
 *   C. session-expired condition calls the injected onSessionExpired
 *   D. no direct window event dispatch by the shared client
 *   E. query-string helper behavior is stable
 *   F. ApiError semantics are stable
 *   G. JSON request/response behavior is stable
 *   I. no environment callback runs merely by creating the client
 */

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
  blob: () => Promise<Blob>;
};

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'corr-1' },
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob([])),
  };
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  correlationId = 'corr-1',
): FetchResponse {
  return {
    ok: false,
    status,
    headers: { get: () => correlationId },
    json: () =>
      Promise.resolve({
        error: { code, message, correlationId, details: undefined },
      }),
    blob: () => Promise.resolve(new Blob([])),
  };
}

const fetchSpy = vi.fn<(...args: unknown[]) => Promise<FetchResponse>>();
vi.stubGlobal('fetch', fetchSpy);

const noopEnv = (overrides: Partial<ApiClientEnvironment> = {}): ApiClientEnvironment => ({
  getAuthHeaders: () => Promise.resolve({}),
  ...overrides,
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('createApiClient environment seam', () => {
  it('does not call any environment callback merely by creating the client', () => {
    const getAuthHeaders = vi.fn();
    const onSessionExpired = vi.fn();
    createApiClient(noopEnv({ getAuthHeaders, onSessionExpired }));
    expect(getAuthHeaders).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('uses the injected auth headers on a request', async () => {
    const getAuthHeaders = vi.fn().mockResolvedValue({ authorization: 'Bearer test-token' });
    const { apiRequest } = createApiClient(noopEnv({ getAuthHeaders }));
    fetchSpy.mockResolvedValue(jsonResponse({ data: { ok: true } }));
    await apiRequest<{ ok: boolean }>('/api/me');
    expect(getAuthHeaders).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ headers: { authorization: 'Bearer test-token' } }),
    );
  });

  it('sends a JSON body and content-type when a body is provided', async () => {
    const { apiRequest } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: { saved: true } }));
    await apiRequest<{ saved: boolean }>('/api/projects', {
      method: 'POST',
      body: { name: 'X' },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ name: 'X' }),
      }),
    );
  });

  it('does not add content-type or JSON body when no body is provided', async () => {
    const { apiRequest } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: [] }));
    await apiRequest<unknown[]>('/api/projects');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ method: 'GET' }),
    );
    const [, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toEqual(
      expect.objectContaining({ 'content-type': 'application/json' }),
    );
  });

  it('returns response data on a successful request', async () => {
    const { apiRequest } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: { id: 'a' } }));
    const result = await apiRequest<{ id: string }>('/api/projects/a');
    expect(result).toEqual({ id: 'a' });
  });
});

describe('ApiError semantics', () => {
  it('throws an ApiError carrying code/status/correlationId/details', async () => {
    const { apiRequest } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(
      errorResponse('CONFLICT', 'This project changed after you opened it.', 409, 'corr-x'),
    );
    const error = await apiRequest<unknown>('/api/projects/a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('CONFLICT');
    expect(apiError.status).toBe(409);
    expect(apiError.correlationId).toBe('corr-x');
    expect(apiError.name).toBe('ApiError');
  });

  it('falls back to default message/code when the body has no error', async () => {
    const { apiRequest } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'corr-z' },
      json: () => Promise.resolve({ data: 'unexpected' }),
      blob: () => Promise.resolve(new Blob([])),
    });
    const error = await apiRequest<unknown>('/api/projects').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('REQUEST_FAILED');
    expect((error as ApiError).message).toBe('The request could not be completed.');
    expect((error as ApiError).status).toBe(500);
  });
});

describe('session-expired injection', () => {
  it('calls the injected onSessionExpired callback on a 401 with an auth header', async () => {
    const onSessionExpired = vi.fn();
    const { apiRequest } = createApiClient(
      noopEnv({
        getAuthHeaders: () => Promise.resolve({ authorization: 'Bearer token' }),
        onSessionExpired,
      }),
    );
    fetchSpy.mockResolvedValue(errorResponse('UNAUTHORIZED', 'expired', 401));
    await apiRequest<unknown>('/api/me').catch(() => undefined);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onSessionExpired for a 401 without an auth header', async () => {
    const onSessionExpired = vi.fn();
    const { apiRequest } = createApiClient(noopEnv({ onSessionExpired }));
    fetchSpy.mockResolvedValue(errorResponse('UNAUTHORIZED', 'expired', 401));
    await apiRequest<unknown>('/api/me').catch(() => undefined);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not call onSessionExpired for a non-401 authenticated failure', async () => {
    const onSessionExpired = vi.fn();
    const { apiRequest } = createApiClient(
      noopEnv({
        getAuthHeaders: () => Promise.resolve({ authorization: 'Bearer token' }),
        onSessionExpired,
      }),
    );
    fetchSpy.mockResolvedValue(errorResponse('CONFLICT', 'conflict', 409));
    await apiRequest<unknown>('/api/projects').catch(() => undefined);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('queryString helper', () => {
  it('omits empty/undefined values', () => {
    expect(queryString({ from: 'a', to: 'b', salesOwnerId: undefined, empty: '' })).toBe(
      '?from=a&to=b',
    );
  });

  it('returns an empty string when no values are present', () => {
    expect(queryString({ a: undefined, b: '' })).toBe('');
    expect(queryString({})).toBe('');
  });
});

describe('Phase 4A automation context client', () => {
  it('binds only the Project-scoped open/list and exact lifecycle routes', async () => {
    const { api } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: {} }));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const contextId = '20000000-0000-4000-8000-000000000001';
    const revisionId = '30000000-0000-4000-8000-000000000001';

    await api.automationContexts(projectId);
    await api.openAutomationContext(projectId, {
      application: 'DIALUX',
      expectedArtifactType: 'DIALUX_REPORT',
      targetRevisionId: revisionId,
    });
    await api.expireAutomationContext(contextId);
    await api.rebindAutomationContext(contextId);
    await api.closeAutomationContext(contextId);

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `/api/personal/projects/${projectId}/automation-contexts`,
      `/api/personal/projects/${projectId}/automation-contexts`,
      `/api/personal/automation-contexts/${contextId}/expire`,
      `/api/personal/automation-contexts/${contextId}/rebind`,
      `/api/personal/automation-contexts/${contextId}/close`,
    ]);
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          application: 'DIALUX',
          expectedArtifactType: 'DIALUX_REPORT',
          targetRevisionId: revisionId,
        }),
      }),
    );
  });
});

describe('Luminaire Schedule canonical output client', () => {
  it('binds the cohesive read, config, and format-aware generation routes', async () => {
    const { api } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: {} }));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const revisionId = '20000000-0000-4000-8000-000000000001';

    await api.luminaireScheduleWorkspace(projectId, revisionId);
    await api.updateLuminaireScheduleConfig(projectId, {
      columns: [{ columnId: 'model', visible: false, order: 5, width: 220 }],
      paperSize: 'A4',
    });
    await api.generateLuminaireSchedule(projectId, {
      format: 'Both',
      issueStatus: 'For Review',
      issueDate: '2026-08-17',
    });
    await api.generateLuminaireSchedule(projectId, {
      recoveryRevisionId: revisionId,
      issueStatus: 'Ignored during recovery',
      issueDate: '2026-08-18',
    });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${projectId}/luminaire-schedule?revisionId=${revisionId}`,
      `/api/projects/${projectId}/luminaire-schedule/config`,
      `/api/projects/${projectId}/luminaire-schedule/generate`,
      `/api/projects/${projectId}/luminaire-schedule/generate`,
    ]);
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'PATCH', headers: { 'content-type': 'application/json' } }),
    );
    expect(fetchSpy.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          format: 'Both',
          issueStatus: 'For Review',
          issueDate: '2026-08-17',
        }),
      }),
    );
    expect(fetchSpy.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          recoveryRevisionId: revisionId,
          issueStatus: 'Ignored during recovery',
          issueDate: '2026-08-18',
        }),
      }),
    );
  });
});

describe('Technical BOQ canonical output client', () => {
  it('binds the cohesive read, narrow config/reset, and generation/recovery routes', async () => {
    const { api } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: {} }));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const revisionId = '20000000-0000-4000-8000-000000000001';

    await api.technicalBoqWorkspace(projectId, revisionId);
    await api.updateTechnicalBoqConfig(projectId, {
      columns: [{ columnId: 'category', visible: false, order: 9, width: 220 }],
      paperSize: 'A4',
    });
    await api.updateTechnicalBoqConfig(projectId, { reset: true });
    await api.generateTechnicalBoq(projectId, {
      format: 'Both',
      issueStatus: 'For Review',
      issueDate: '2026-08-17',
    });
    await api.generateTechnicalBoq(projectId, {
      recoveryRevisionId: revisionId,
      issueStatus: 'Ignored during recovery',
      issueDate: '2026-08-18',
    });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${projectId}/technical-boq?revisionId=${revisionId}`,
      `/api/projects/${projectId}/technical-boq/config`,
      `/api/projects/${projectId}/technical-boq/config`,
      `/api/projects/${projectId}/technical-boq/generate`,
      `/api/projects/${projectId}/technical-boq/generate`,
    ]);
    expect(fetchSpy.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reset: true }) }),
    );
    expect(fetchSpy.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          format: 'Both',
          issueStatus: 'For Review',
          issueDate: '2026-08-17',
        }),
      }),
    );
  });
});

describe('Comments thread foundation client', () => {
  it('uses the focused project-scoped routes and sends only typed mutation bodies', async () => {
    const { api } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(jsonResponse({ data: {} }));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const reviewItemId = '20000000-0000-4000-8000-000000000001';
    const replyId = '30000000-0000-4000-8000-000000000001';
    const documentId = '40000000-0000-4000-8000-000000000001';
    await api.createReviewThread(projectId, {
      reference: '',
      title: 'Thread',
      description: '',
      area: '',
      luminaireTag: '',
      drawingReference: '',
      sourceType: 'Manual',
      sourceId: null,
      status: 'Open',
      response: '',
      revisionId: null,
      luminaireId: null,
      receivedAt: '2026-08-16',
      dueDate: null,
      origin: 'Internal',
    });
    await api.listReviewThreadContext(projectId);
    await api.createReviewReply(projectId, reviewItemId, {
      body: 'Reply',
      origin: 'Client',
      authorName: 'Sarah',
      authorRole: 'Client',
    });
    await api.createReviewReply(projectId, reviewItemId, {
      body: 'Reply from existing participant',
      origin: 'Client',
      existingClientAuthorId: '50000000-0000-4000-8000-000000000001',
    });
    await api.linkReviewItemDocument(projectId, reviewItemId, { documentId });
    await api.linkReviewReplyDocument(projectId, reviewItemId, replyId, { documentId });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${projectId}/review-threads`,
      `/api/projects/${projectId}/review-thread-context`,
      `/api/projects/${projectId}/review-items/${reviewItemId}/replies`,
      `/api/projects/${projectId}/review-items/${reviewItemId}/replies`,
      `/api/projects/${projectId}/review-items/${reviewItemId}/attachments`,
      `/api/projects/${projectId}/review-items/${reviewItemId}/replies/${replyId}/attachments`,
    ]);
  });
});

describe('download helpers', () => {
  it('downloadCsv uses the injected downloadBlob binding', async () => {
    const downloadBlob = vi.fn();
    const { downloadCsv } = createApiClient(noopEnv({ downloadBlob }));
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'corr-1' },
      json: () => Promise.resolve({}),
      blob: () => Promise.resolve(new Blob(['a,b'])),
    });
    await downloadCsv();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'sct-projects.csv');
  });

  it('downloadPeriodActivityExcel uses the injected downloadBlob binding with a derived filename', async () => {
    const downloadBlob = vi.fn();
    const { downloadPeriodActivityExcel } = createApiClient(noopEnv({ downloadBlob }));
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'corr-1' },
      json: () => Promise.resolve({}),
      blob: () => Promise.resolve(new Blob(['x'])),
    });
    await downloadPeriodActivityExcel({ from: '2026-08-01', to: '2026-08-31' });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'SCT_Activity_2026-08-01_2026-08-31.xlsx',
    );
  });

  it('throws a typed ApiError when a download request fails', async () => {
    const { downloadCsv } = createApiClient(noopEnv());
    fetchSpy.mockResolvedValue(errorResponse('EXPORT_FAILED', 'CSV export failed.', 500));
    const error = await downloadCsv().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('EXPORT_FAILED');
    expect((error as ApiError).status).toBe(500);
  });
});
