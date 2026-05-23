import { describe, it, expect } from 'vitest';
import { categorizeError } from '../src/error-category.js';

describe('categorizeError', () => {
  it('null → null', () => {
    expect(categorizeError(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(categorizeError(undefined)).toBeNull();
  });

  it('code "429" → rate_limit', () => {
    expect(categorizeError({ code: '429', message: 'Too many requests' })).toBe('rate_limit');
  });

  it('"Resource exhausted" in message → rate_limit', () => {
    expect(categorizeError({ code: 'resource_exhausted', message: 'Resource exhausted' })).toBe('rate_limit');
  });

  it('"rate_limit_exceeded" in code → rate_limit', () => {
    expect(categorizeError({ code: 'rate_limit_exceeded', message: 'You have exceeded your rate limit' })).toBe('rate_limit');
  });

  it('"quota" in message → rate_limit', () => {
    expect(categorizeError({ code: 'quota_exceeded', message: 'Quota exceeded for model' })).toBe('rate_limit');
  });

  it('"provider_timeout" code → timeout', () => {
    expect(categorizeError({ code: 'provider_timeout', message: 'Request timed out' })).toBe('timeout');
  });

  it('"504" providerCode → timeout', () => {
    expect(categorizeError({ code: 'upstream_error', message: 'Gateway error', providerCode: '504' })).toBe('timeout');
  });

  it('"etimedout" message → timeout', () => {
    expect(categorizeError({ code: 'network_error', message: 'connect etimedout' })).toBe('timeout');
  });

  it('"401" providerCode → auth', () => {
    expect(categorizeError({ code: 'auth_error', message: 'Authentication failed', providerCode: '401' })).toBe('auth');
  });

  it('"invalid API key" in message → auth', () => {
    expect(categorizeError({ code: 'invalid_key', message: 'Invalid API key provided' })).toBe('auth');
  });

  it('"403" + "permission_denied" → auth', () => {
    expect(categorizeError({ code: 'permission_denied', message: 'Forbidden', providerCode: '403' })).toBe('auth');
  });

  it('"content_filter" code → content_filter', () => {
    expect(categorizeError({ code: 'content_filter', message: 'Request blocked by content policy' })).toBe('content_filter');
  });

  it('"blocked by safety settings" in message → content_filter', () => {
    expect(categorizeError({ code: 'safety_block', message: 'Blocked by safety settings' })).toBe('content_filter');
  });

  it('unrecognized "weird" / "500" → other', () => {
    expect(categorizeError({ code: 'weird', message: 'something completely unknown', providerCode: '500' })).toBe('other');
  });
});
