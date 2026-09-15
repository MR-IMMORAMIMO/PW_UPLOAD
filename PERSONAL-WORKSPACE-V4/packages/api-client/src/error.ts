/**
 * Canonical typed error thrown by the API client for any failed request.
 *
 * Carries the server error code, HTTP status, correlation id, and optional
 * details so callers (UI layers) can branch on semantics (e.g. a 409
 * optimistic-concurrency conflict) without string matching.
 */
export class ApiError extends Error {
  public override readonly name = 'ApiError';

  public constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly correlationId: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
