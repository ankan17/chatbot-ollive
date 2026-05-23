import { describe, it, expect } from 'vitest';
import { redactInferenceLog } from '../src/ingestion/redaction.js';
import type { InferenceLog } from '@ollive/shared';
import { randomUUID } from 'node:crypto';

function makeLog(overrides?: Partial<InferenceLog>): InferenceLog {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    provider: 'google',
    model: 'gemini-2.5-flash',
    status: 'success',
    context: {},
    timing: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      latencyMs: 500,
    },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    preview: {},
    error: null,
    metadata: {},
    ...overrides,
  };
}

describe('redactInferenceLog', () => {
  it('redacts PII in preview.input and preview.output', () => {
    const log = makeLog({
      preview: {
        input: 'My email is user@example.com and SSN 123-45-6789',
        output: 'Response from assistant@test.org',
      },
    });
    const result = redactInferenceLog(log);
    expect(result.preview.input).toContain('[EMAIL]');
    expect(result.preview.input).toContain('[SSN]');
    expect(result.preview.input).not.toContain('user@example.com');
    expect(result.preview.input).not.toContain('123-45-6789');
    expect(result.preview.output).toContain('[EMAIL]');
    expect(result.preview.output).not.toContain('assistant@test.org');
  });

  it('redacts credit card in string metadata, leaves numeric and nested untouched', () => {
    const log = makeLog({
      metadata: {
        paymentInfo: '4111 1111 1111 1111',
        temperature: 0.7,
        contextMessages: 3,
        nested: { key: 'value' },
      },
    });
    const result = redactInferenceLog(log);
    expect(result.metadata.paymentInfo).toContain('[CREDIT_CARD]');
    expect(result.metadata.temperature).toBe(0.7);
    expect(result.metadata.contextMessages).toBe(3);
    // Nested objects left as-is (shallow redaction only)
    expect(result.metadata.nested).toEqual({ key: 'value' });
  });

  it('clean log → previews and metadata unchanged, result is schema-valid', () => {
    const log = makeLog({
      preview: { input: 'Hello world', output: 'Hi there' },
      metadata: { sdkVersion: '1.0.0', appName: 'testapp' },
    });
    const result = redactInferenceLog(log);
    expect(result.preview.input).toBe('Hello world');
    expect(result.preview.output).toBe('Hi there');
    expect(result.metadata.sdkVersion).toBe('1.0.0');
    expect(result.metadata.appName).toBe('testapp');
  });

  it('log with empty preview and empty metadata → no throw, result schema-valid', () => {
    const log = makeLog({ preview: {}, metadata: {} });
    expect(() => redactInferenceLog(log)).not.toThrow();
    const result = redactInferenceLog(log);
    expect(result.preview).toEqual({});
    expect(result.metadata).toEqual({});
  });

  it('input log object is not mutated', () => {
    const log = makeLog({
      preview: { input: 'email: foo@bar.com', output: 'ok' },
      metadata: { info: 'test@example.com' },
    });
    const originalInput = log.preview.input;
    const originalMeta = log.metadata.info;
    redactInferenceLog(log);
    expect(log.preview.input).toBe(originalInput);
    expect(log.metadata.info).toBe(originalMeta);
  });
});
