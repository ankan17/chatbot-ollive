import { z } from 'zod';

/** Codes that appear as the `error` field of an HTTP error body. */
export const appErrorCode = z.enum([
  'validation_error', // 400
  'unauthorized',     // 401
  'login_required',   // 403 (guest cap; body also carries `remaining`)
  'not_found',        // 404
  'rate_limited',     // 429 (IP limiter)
  'internal_error',   // 500
]);
export type AppErrorCode = z.infer<typeof appErrorCode>;

/** Codes that appear in an SSE `error` event payload (transport = text/event-stream). */
export const sseErrorCode = z.enum([
  'rate_limited',
  'provider_timeout',
  'provider_error',
  'internal_error',
]);
export type SseErrorCode = z.infer<typeof sseErrorCode>;

/** Standard HTTP error body shape: { error, details? }. */
export interface ApiErrorBody {
  error: AppErrorCode;
  details?: unknown;
}

/** Guest-cap 403 body (the one HTTP error with an extra field). */
export interface LoginRequiredBody {
  error: 'login_required';
  remaining: number;
}
