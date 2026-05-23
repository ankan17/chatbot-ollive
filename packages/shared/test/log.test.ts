import { describe, it, expect } from 'vitest';
import { inferenceLogSchema } from '../src/log';

const validLog = {
  requestId: '11111111-1111-1111-1111-111111111111',
  timestamp: '2026-05-23T10:01:12.001Z',
  provider: 'google',
  model: 'gemini-2.5-flash',
  status: 'success',
  context: { conversationId: '22222222-2222-2222-2222-222222222222' },
  timing: {
    startedAt: '2026-05-23T10:01:11.793Z',
    completedAt: '2026-05-23T10:01:12.001Z',
    latencyMs: 1208,
    timeToFirstTokenMs: 210,
  },
  usage: { promptTokens: 420, completionTokens: 188, totalTokens: 608 },
  preview: { input: 'What about day 2?', output: 'Day 2 we head to Arashiyama.' },
  error: null,
  metadata: { temperature: 0.7 },
};

describe('inferenceLogSchema', () => {
  it('parses a valid log and infers types', () => {
    const parsed = inferenceLogSchema.parse(validLog);
    expect(parsed.requestId).toBe(validLog.requestId);
    expect(parsed.usage?.totalTokens).toBe(608);
  });

  it('rejects a missing requestId', () => {
    const { requestId, ...rest } = validLog;
    expect(() => inferenceLogSchema.parse(rest)).toThrow();
  });

  it('rejects an invalid status', () => {
    expect(() => inferenceLogSchema.parse({ ...validLog, status: 'bogus' })).toThrow();
  });

  it('allows usage to be null for an error log', () => {
    const parsed = inferenceLogSchema.parse({
      ...validLog,
      status: 'error',
      usage: null,
      error: { code: 'rate_limited', message: 'Resource exhausted', providerCode: '429' },
    });
    expect(parsed.usage).toBeNull();
    expect(parsed.error?.code).toBe('rate_limited');
  });

  it('applies defaults for optional containers', () => {
    const minimal = {
      requestId: '33333333-3333-3333-3333-333333333333',
      timestamp: '2026-05-23T10:01:12.001Z',
      provider: 'google',
      model: 'gemini-2.5-flash',
      status: 'cancelled',
      timing: {
        startedAt: '2026-05-23T10:01:11.793Z',
        completedAt: '2026-05-23T10:01:12.001Z',
        latencyMs: 50,
      },
    };
    const parsed = inferenceLogSchema.parse(minimal);
    expect(parsed.context).toEqual({});
    expect(parsed.metadata).toEqual({});
    expect(parsed.error).toBeNull();
  });
});
