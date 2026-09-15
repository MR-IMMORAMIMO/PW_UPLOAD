export type DomainErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'CONFIGURATION_REQUIRED'
  | 'EXPORT_FAILED'
  | 'INTEGRATION_UNAVAILABLE'
  | 'IMPORT_PREVIEW_STALE'
  | 'IMPORT_PLAN_STALE'
  | 'IMPORT_DESTINATION_CHANGED'
  | 'IMPORT_PROJECT_TAG_CONFLICT'
  | 'IMPORT_TARGET_CHANGED'
  | 'IMPORT_LIBRARY_VERSION_UNAVAILABLE'
  | 'IMPORT_ACTION_INVALID'
  | 'IMPORT_APPLY_ALREADY_RUNNING'
  | 'IMPORT_BACKUP_FAILED'
  | 'IMPORT_APPLY_PARTIAL'
  | 'IMPORT_APPLY_FAILED'
  | 'IMPORT_PARTIAL_CONFIRMATION_REQUIRED'
  | 'MICROSOFT_GRAPH_ERROR';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: DomainErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function requireFound<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new DomainError('NOT_FOUND', message, 404);
  }
  return value;
}
