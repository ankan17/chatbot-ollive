import type { ErrorCategory } from '@ollive/shared';

export interface RawError {
  code: string;
  message: string;
  providerCode?: string;
}

/**
 * Normalizes a raw provider error into a canonical error category.
 * Returns null for success/cancelled logs (no error present).
 *
 * Priority order: rate_limit → timeout → auth → content_filter → other.
 */
export function categorizeError(error: RawError | null | undefined): ErrorCategory | null {
  if (!error) return null;

  // Build a lowercased haystack combining all signals
  const haystack = [
    error.code,
    error.message,
    error.providerCode ?? '',
  ]
    .join(' ')
    .toLowerCase();

  // rate_limit: check first — covers 429, quota signals
  if (
    haystack.includes('429') ||
    haystack.includes('rate limit') ||
    haystack.includes('rate_limit') ||
    haystack.includes('ratelimit') ||
    haystack.includes('resource exhausted') ||
    haystack.includes('too many requests') ||
    haystack.includes('quota')
  ) {
    return 'rate_limit';
  }

  // timeout: 504/408, various timeout strings
  if (
    haystack.includes('504') ||
    haystack.includes('408') ||
    haystack.includes('timed out') ||
    haystack.includes('timeout') ||
    haystack.includes('deadline') ||
    haystack.includes('etimedout')
  ) {
    return 'timeout';
  }

  // auth: 401/403, key/permission signals
  if (
    haystack.includes('401') ||
    haystack.includes('403') ||
    haystack.includes('unauthorized') ||
    haystack.includes('unauthenticated') ||
    haystack.includes('permission denied') ||
    haystack.includes('permission_denied') ||
    haystack.includes('api key') ||
    haystack.includes('api_key') ||
    haystack.includes('invalid api') ||
    haystack.includes('forbidden')
  ) {
    return 'auth';
  }

  // content_filter: safety/moderation signals
  if (
    haystack.includes('content filter') ||
    haystack.includes('content_filter') ||
    haystack.includes('safety') ||
    haystack.includes('blocked') ||
    haystack.includes('moderation')
  ) {
    return 'content_filter';
  }

  // fallback
  return 'other';
}
