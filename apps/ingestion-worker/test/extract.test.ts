import { describe, it, expect } from 'vitest';
import { extractMetadata } from '../src/extract.js';
import type { InferenceLog } from '@ollive/shared';

function makeSuccessLog(overrides: Partial<InferenceLog> = {}): InferenceLog {
  return {
    requestId: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-05-23T10:00:00.000Z',
    provider: 'google',
    model: 'gemini-2.5-flash',
    status: 'success',
    context: {
      conversationId: '00000000-0000-0000-0000-000000000010',
      messageId: '00000000-0000-0000-0000-000000000020',
      userId: '00000000-0000-0000-0000-000000000030',
    },
    timing: {
      startedAt: '2026-05-23T10:00:00.000Z',
      completedAt: '2026-05-23T10:00:01.000Z',
      latencyMs: 1000,
      timeToFirstTokenMs: 200,
    },
    usage: {
      promptTokens: 420,
      completionTokens: 188,
      totalTokens: 608,
    },
    preview: {
      input: 'Hello, world!',
      output: 'Hi there!',
    },
    error: null,
    metadata: {
      sdkVersion: '1.2.3',
      appName: 'test-app',
      contextMessages: 5,
      redactions: 0,
    },
    ...overrides,
  };
}

describe('extractMetadata', () => {
  it('success path: all base columns mapped correctly', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);

    expect(row.requestId).toBe('00000000-0000-0000-0000-000000000001');
    expect(row.conversationId).toBe('00000000-0000-0000-0000-000000000010');
    expect(row.messageId).toBe('00000000-0000-0000-0000-000000000020');
    expect(row.userId).toBe('00000000-0000-0000-0000-000000000030');
    expect(row.provider).toBe('google');
    expect(row.model).toBe('gemini-2.5-flash');
    expect(row.status).toBe('success');
    expect(row.latencyMs).toBe(1000);
    expect(row.timeToFirstTokenMs).toBe(200);
    expect(row.promptTokens).toBe(420);
    expect(row.completionTokens).toBe(188);
    expect(row.totalTokens).toBe(608);
    expect(row.inputPreview).toBe('Hello, world!');
    expect(row.outputPreview).toBe('Hi there!');
    expect(row.errorCode).toBeNull();
    expect(row.errorMessage).toBeNull();
    expect(row.errorCategory).toBeNull();
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  it('estimatedCostUsd formatted to 6dp: 420 prompt + 188 completion on gemini-2.5-flash → "0.000596"', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);
    // 420/1e6 * 0.30 + 188/1e6 * 2.50 = 0.000126 + 0.000470 = 0.000596
    expect(row.estimatedCostUsd).toBe('0.000596');
  });

  it('derived metadata: tokensPerSecond ≈ completionTokens/(latencyMs/1000)', () => {
    const log = makeSuccessLog(); // 188 tokens / 1.0s = 188
    const row = extractMetadata(log);
    expect(row.metadata['tokensPerSecond']).toBeCloseTo(188, 0);
  });

  it('derived metadata: promptChars / outputChars = preview lengths', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);
    expect(row.metadata['promptChars']).toBe('Hello, world!'.length);
    expect(row.metadata['outputChars']).toBe('Hi there!'.length);
  });

  it('derived metadata: contextMessageCount from contextMessages field', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);
    expect(row.metadata['contextMessageCount']).toBe(5);
  });

  it('derived metadata: redactions, sdkVersion, appName passed through', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);
    expect(row.metadata['redactions']).toBe(0);
    expect(row.metadata['sdkVersion']).toBe('1.2.3');
    expect(row.metadata['appName']).toBe('test-app');
  });

  it('derived metadata: guestSessionId null when absent', () => {
    const log = makeSuccessLog();
    const row = extractMetadata(log);
    expect(row.metadata['guestSessionId']).toBeNull();
  });

  it('error log: errorCategory=rate_limit, errorCode/errorMessage set, estimatedCostUsd=0.000000, token columns null', () => {
    const log = makeSuccessLog({
      status: 'error',
      usage: null,
      error: { code: 'rate_limited', message: 'rate_limit_exceeded', providerCode: '429' },
    });
    const row = extractMetadata(log);
    expect(row.status).toBe('error');
    expect(row.errorCategory).toBe('rate_limit');
    expect(row.errorCode).toBe('rate_limited');
    expect(row.errorMessage).toBe('rate_limit_exceeded');
    expect(row.estimatedCostUsd).toBe('0.000000');
    expect(row.promptTokens).toBeNull();
    expect(row.completionTokens).toBeNull();
    expect(row.totalTokens).toBeNull();
  });

  it('guest log: conversationId/userId/messageId null, guestSessionId carried in metadata', () => {
    const log = makeSuccessLog({
      context: {},
      metadata: { guestSessionId: 'guest-abc-123', sdkVersion: '1.0.0', appName: 'chatbot' },
    });
    const row = extractMetadata(log);
    expect(row.conversationId).toBeNull();
    expect(row.userId).toBeNull();
    expect(row.messageId).toBeNull();
    expect(row.metadata['guestSessionId']).toBe('guest-abc-123');
  });

  it('zero latency → tokensPerSecond === 0 (no NaN/Infinity)', () => {
    const log = makeSuccessLog({
      timing: {
        startedAt: '2026-05-23T10:00:00.000Z',
        completedAt: '2026-05-23T10:00:00.000Z',
        latencyMs: 0,
      },
    });
    const row = extractMetadata(log);
    expect(row.metadata['tokensPerSecond']).toBe(0);
    expect(Number.isFinite(row.metadata['tokensPerSecond'] as number)).toBe(true);
  });
});
