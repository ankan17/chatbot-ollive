import { describe, it, expect } from 'vitest';
import { mapProviderError } from '../src/chat/run-chat.js';

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
});
