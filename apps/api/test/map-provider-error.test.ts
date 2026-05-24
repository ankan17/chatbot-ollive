import { describe, it, expect } from 'vitest';
import { mapProviderError } from '../src/chat/run-chat.js';

/** Shape of the Vercel AI SDK's APICallError (the real thing the provider throws). */
function apiCallError(statusCode: number | undefined, message: string, data?: unknown): Error {
  return Object.assign(new Error(message), { name: 'AI_APICallError', statusCode, data });
}

/** AI SDK RetryError — what streamText throws after retrying a 429, wrapping the last error. */
function retryError(lastError: Error): Error {
  return Object.assign(new Error('Failed after 3 attempts.'), { name: 'AI_RetryError', lastError });
}

describe('mapProviderError', () => {
  it('429 message → rate_limited', () => {
    expect(mapProviderError(new Error('429 rate limit exceeded'))).toMatchObject({ code: 'rate_limited' });
  });

  it('"rate limit" message → rate_limited', () => {
    expect(mapProviderError(new Error('rate limit reached'))).toMatchObject({ code: 'rate_limited' });
  });

  it('"resource exhausted" message → rate_limited', () => {
    expect(mapProviderError(new Error('resource exhausted'))).toMatchObject({ code: 'rate_limited' });
  });

  it('"quota" message → rate_limited', () => {
    expect(mapProviderError(new Error('quota exceeded'))).toMatchObject({ code: 'rate_limited' });
  });

  it('"timeout" message → provider_timeout', () => {
    expect(mapProviderError(new Error('request timeout'))).toMatchObject({ code: 'provider_timeout' });
  });

  it('"ETIMEDOUT" message → provider_timeout', () => {
    expect(mapProviderError(new Error('connect ETIMEDOUT'))).toMatchObject({ code: 'provider_timeout' });
  });

  it('"deadline" message → provider_timeout', () => {
    expect(mapProviderError(new Error('deadline exceeded'))).toMatchObject({ code: 'provider_timeout' });
  });

  it('"generation failed" message → provider_error', () => {
    expect(mapProviderError(new Error('provider_error: generation failed'))).toMatchObject({ code: 'provider_error' });
  });

  it('"provider" in message → provider_error', () => {
    expect(mapProviderError(new Error('provider returned 500'))).toMatchObject({ code: 'provider_error' });
  });

  it('"api error" in message → provider_error', () => {
    expect(mapProviderError(new Error('api error from model'))).toMatchObject({ code: 'provider_error' });
  });

  it('plain TypeError with no provider/timeout/ratelimit keywords → internal_error', () => {
    expect(mapProviderError(new TypeError('cannot read property x of undefined'))).toMatchObject({ code: 'internal_error' });
  });

  it('non-Error string value → internal_error', () => {
    expect(mapProviderError('something went wrong')).toMatchObject({ code: 'internal_error' });
  });

  it('non-Error null value → internal_error', () => {
    expect(mapProviderError(null)).toMatchObject({ code: 'internal_error' });
  });

  // ── Structured provider errors (what the AI SDK actually throws) ──────────────

  it('APICallError statusCode 429 with an unparsed/generic message → rate_limited', () => {
    // When the error body fails schema parsing, the SDK uses a generic message but
    // still sets statusCode. The HTTP status is the authoritative signal.
    expect(
      mapProviderError(apiCallError(429, 'Failed to process error response')),
    ).toMatchObject({ code: 'rate_limited' });
  });

  it('APICallError statusCode 429 with "Too Many Requests" status text → rate_limited', () => {
    expect(mapProviderError(apiCallError(429, 'Too Many Requests'))).toMatchObject({ code: 'rate_limited' });
  });

  it('RetryError wrapping a 429 APICallError → rate_limited (must unwrap)', () => {
    expect(
      mapProviderError(retryError(apiCallError(429, 'Failed to process error response'))),
    ).toMatchObject({ code: 'rate_limited' });
  });

  it('Gemini RESOURCE_EXHAUSTED in the response body → rate_limited', () => {
    expect(
      mapProviderError(apiCallError(undefined, 'generation failed', { error: { status: 'RESOURCE_EXHAUSTED' } })),
    ).toMatchObject({ code: 'rate_limited' });
  });

  it('APICallError statusCode 504 → provider_timeout', () => {
    expect(mapProviderError(apiCallError(504, 'Gateway Timeout'))).toMatchObject({ code: 'provider_timeout' });
  });

  it('APICallError statusCode 503 with generic message → provider_error (not internal)', () => {
    expect(mapProviderError(apiCallError(503, 'Service Unavailable'))).toMatchObject({ code: 'provider_error' });
  });
});
