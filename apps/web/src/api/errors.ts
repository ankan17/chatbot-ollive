import type { AppErrorCode } from '@ollive/shared/api';

type ClientErrorCode = 'network_error';
export type ApiErrorCode = AppErrorCode | ClientErrorCode;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly remaining?: number;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    details?: unknown,
    remaining?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.remaining = remaining;
  }
}

export function normalizeError(status: number, body: unknown): ApiError {
  const b = body as Record<string, unknown> | null | undefined;
  const bodyMessage = (b?.message ?? b?.error) as string | undefined;
  const msg = bodyMessage ?? `HTTP ${status}`;

  if (status === 400) {
    return new ApiError('validation_error', status, msg, b?.details);
  }
  if (status === 401) {
    return new ApiError('unauthorized', status, msg);
  }
  if (status === 403 && b?.error === 'login_required') {
    const remaining = typeof b.remaining === 'number' ? b.remaining : undefined;
    return new ApiError('login_required', status, msg, undefined, remaining);
  }
  if (status === 403) {
    return new ApiError('unauthorized', status, msg);
  }
  if (status === 404) {
    return new ApiError('not_found', status, msg);
  }
  if (status === 429) {
    return new ApiError('rate_limited', status, msg);
  }
  if (status >= 500) {
    return new ApiError('internal_error', status, msg);
  }

  // Prefer a recognized body.error code for other statuses
  const knownCodes: AppErrorCode[] = [
    'validation_error',
    'unauthorized',
    'login_required',
    'not_found',
    'rate_limited',
    'internal_error',
  ];
  const bodyCode = b?.error as string | undefined;
  if (bodyCode && knownCodes.includes(bodyCode as AppErrorCode)) {
    return new ApiError(bodyCode as AppErrorCode, status, msg);
  }

  return new ApiError('internal_error', status, msg);
}
