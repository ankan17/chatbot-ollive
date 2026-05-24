import { describe, it, expect } from 'vitest';
import { normalizeUsage, normalizeFinishReason } from '../src/providers/normalize.js';

describe('normalizeUsage', () => {
  it('maps inputTokens/outputTokens to promptTokens/completionTokens', () => {
    expect(normalizeUsage({ inputTokens: 100, outputTokens: 50 })).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('falls back to promptTokens/completionTokens spelling', () => {
    expect(normalizeUsage({ promptTokens: 200, completionTokens: 80 })).toEqual({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
    });
  });

  it('coerces missing values to 0', () => {
    expect(normalizeUsage({})).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('coerces undefined values to 0', () => {
    expect(normalizeUsage({ inputTokens: undefined, outputTokens: undefined })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('derives totalTokens as prompt+completion when not provided', () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 5 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('uses totalTokens directly when provided', () => {
    expect(normalizeUsage({ inputTokens: 420, outputTokens: 188, totalTokens: 608 })).toEqual({
      promptTokens: 420,
      completionTokens: 188,
      totalTokens: 608,
    });
  });
});

describe('normalizeFinishReason', () => {
  it('"stop" → "stop"', () => expect(normalizeFinishReason('stop')).toBe('stop'));
  it('"length" → "length"', () => expect(normalizeFinishReason('length')).toBe('length'));
  it('"content-filter" → "content_filter"', () => expect(normalizeFinishReason('content-filter')).toBe('content_filter'));
  it('"content_filter" → "content_filter"', () => expect(normalizeFinishReason('content_filter')).toBe('content_filter'));
  it('"error" → "error"', () => expect(normalizeFinishReason('error')).toBe('error'));
  it('"cancelled" → "cancelled"', () => expect(normalizeFinishReason('cancelled')).toBe('cancelled'));
  it('unknown string → "stop"', () => expect(normalizeFinishReason('something-else')).toBe('stop'));
  it('undefined → "stop"', () => expect(normalizeFinishReason(undefined)).toBe('stop'));
});
