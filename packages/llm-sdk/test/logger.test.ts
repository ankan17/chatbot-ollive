import { describe, it, expect } from 'vitest';
import { inferenceLogSchema, PREVIEW_MAX_CHARS } from '@ollive/shared';
import { FakeProvider } from './fakes.js';
import { withLogging, withLoggingTransport } from '../src/logging/logger.js';
import type { LogSink } from '../src/logging/logger.js';
import type { InferenceLog } from '@ollive/shared';
import type { StreamChunk } from '../src/types.js';
import { BufferedHttpTransport } from '../src/transport/transport.js';

// Shared base config
const BASE_CONFIG = {
  ingestionUrl: 'http://unused.local/v1/logs',
  apiKey: 'k',
  redaction: 'pattern' as const,
};

// A fake sink that collects logs
function makeSink(): { sink: LogSink; logs: InferenceLog[] } {
  const logs: InferenceLog[] = [];
  return {
    sink: { enqueue: (log) => logs.push(log) },
    logs,
  };
}

// UUID regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('withLogging', () => {
  it('success path: yields deltas, enqueues one valid log, correct fields', async () => {
    const conversationId = crypto.randomUUID();
    const chunks: StreamChunk[] = [
      { delta: 'Day ' },
      { delta: '2 we head to Arashiyama.' },
      { usage: { promptTokens: 420, completionTokens: 188, totalTokens: 608 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks);
    const { sink, logs } = makeSink();

    const provider = withLogging(fake, BASE_CONFIG, sink);

    const collectedDeltas: string[] = [];
    for await (const chunk of provider.streamChat(
      { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'Go to Arashiyama?' }] },
      { context: { conversationId } },
    )) {
      if (chunk.delta) collectedDeltas.push(chunk.delta);
    }

    // Caller sees deltas immediately
    expect(collectedDeltas).toEqual(['Day ', '2 we head to Arashiyama.']);

    // Exactly one log enqueued
    expect(logs).toHaveLength(1);
    const log = logs[0];

    // Log passes schema validation
    expect(() => inferenceLogSchema.parse(log)).not.toThrow();

    // Correct fields
    expect(log.status).toBe('success');
    expect(log.provider).toBe('fake');
    expect(log.model).toBe('gemini-2.5-flash');
    expect(log.usage).toEqual({ promptTokens: 420, completionTokens: 188, totalTokens: 608 });
    expect(log.preview?.output).toBe('Day 2 we head to Arashiyama.');
    expect(log.preview?.input).toContain('Arashiyama'); // no PII in input
    expect(log.context?.conversationId).toBe(conversationId);
    expect(log.requestId).toMatch(UUID_RE);
  });

  it('timing: TTFT is ≥15ms and ≤latencyMs when delayMs=20', async () => {
    const chunks: StreamChunk[] = [
      { delta: 'hello' },
      { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks, { delayMs: 20 });
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    for await (const _ of provider.streamChat(
      { model: 'test', messages: [{ role: 'user', content: 'hi' }] },
    )) { /* drain */ }

    const log = logs[0];
    expect(log.timing.timeToFirstTokenMs).toBeGreaterThanOrEqual(15);
    expect(log.timing.timeToFirstTokenMs!).toBeLessThanOrEqual(log.timing.latencyMs);
    expect(new Date(log.timing.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(log.timing.startedAt).getTime(),
    );
  }, 2000);

  it('status: error — consumer iteration rejects, log has status=error, usage=null', async () => {
    const throwError = new Error('provider blew up');
    const fake = new FakeProvider(
      [{ delta: 'partial' }],
      { throwError, throwAfter: 1 },
    );
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    await expect(async () => {
      for await (const _ of provider.streamChat(
        { model: 'test', messages: [{ role: 'user', content: 'hi' }] },
      )) { /* drain */ }
    }).rejects.toThrow('provider blew up');

    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.status).toBe('error');
    expect(log.error?.message).toBe('provider blew up');
    expect(log.usage).toBeNull();
    expect(() => inferenceLogSchema.parse(log)).not.toThrow();
  });

  it('status: cancelled — consumer sees rejection, log has status=cancelled with partial output', async () => {
    const chunks: StreamChunk[] = [
      { delta: 'first' },
      { delta: 'second' },
    ];
    // Note: controller.signal is passed so withLogging can check signal.aborted, but the actual
    // cancellation is driven by FakeProvider throwing an AbortError after 1 chunk (abortAfter: 1).
    // controller.abort() is never called here; the AbortError is synthesized by FakeProvider.
    const controller = new AbortController();
    const fake = new FakeProvider(chunks, { abortAfter: 1 });
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    await expect(async () => {
      for await (const _ of provider.streamChat(
        { model: 'test', messages: [{ role: 'user', content: 'hello' }] },
        { signal: controller.signal },
      )) { /* drain */ }
    }).rejects.toThrow();

    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.status).toBe('cancelled');
    expect(log.preview?.output).toContain('first');
    expect(() => inferenceLogSchema.parse(log)).not.toThrow();
  });

  it('redaction counts: SSN in input, email in output', async () => {
    const chunks: StreamChunk[] = [
      { delta: 'mail me at ankan@hyperverge.co' },
      { usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks);
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    for await (const _ of provider.streamChat(
      { model: 'test', messages: [{ role: 'user', content: 'my ssn is 123-45-6789' }] },
    )) { /* drain */ }

    const log = logs[0];
    expect(log.preview?.output).toContain('[EMAIL]');
    expect(log.preview?.output).not.toContain('ankan@hyperverge.co');
    expect(log.preview?.input).toContain('[SSN]');
    expect(log.preview?.input).not.toContain('123-45-6789');
    expect((log.metadata).redactions).toMatchObject({
      email: 1,
      ssn: 1,
    });
  });

  it('redact-then-truncate boundary: email straddling PREVIEW_MAX_CHARS cut is not fragmented', async () => {
    // Build an output where an email sits right at the PREVIEW_MAX_CHARS boundary
    const padding = 'x'.repeat(PREVIEW_MAX_CHARS - 10); // 490 chars of padding
    const email = 'secret-person@example.com'; // starts at index 490, straddles cut
    const fullOutput = padding + email + ' more text';

    const chunks: StreamChunk[] = [
      { delta: fullOutput },
      { usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks);
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    for await (const _ of provider.streamChat(
      { model: 'test', messages: [{ role: 'user', content: 'hello' }] },
    )) { /* drain */ }

    const log = logs[0];
    const output = log.preview?.output ?? '';
    // Must be truncated to max chars
    expect(output.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARS);
    // Must NOT contain email fragments
    expect(output).not.toContain('example.com');
    expect(output).not.toContain('secret-person');
  });

  it('fail-closed: redactor throws → previews are undefined, raw PII absent, log still valid', async () => {
    const throwingRedactor = {
      redact: (_text: string): { text: string; counts: Record<string, number> } => {
        throw new Error('redactor failed');
      },
    };
    const chunks: StreamChunk[] = [
      { delta: 'hello ankan@hyperverge.co' },
      { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks);
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, { ...BASE_CONFIG, redactor: throwingRedactor }, sink);

    for await (const _ of provider.streamChat(
      { model: 'test', messages: [{ role: 'user', content: 'my ssn is 123-45-6789' }] },
    )) { /* drain */ }

    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.preview?.input).toBeUndefined();
    expect(log.preview?.output).toBeUndefined();
    expect(JSON.stringify(log)).not.toContain('ankan@hyperverge.co');
    expect(JSON.stringify(log)).not.toContain('123-45-6789');
    expect(() => inferenceLogSchema.parse(log)).not.toThrow();
  });

  it('metadata and context merge: temperature, maxOutputTokens, userId, caller metadata, stream=true', async () => {
    const userId = crypto.randomUUID();
    const chunks: StreamChunk[] = [
      { delta: 'ok' },
      { usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 }, finishReason: 'stop' },
    ];
    const fake = new FakeProvider(chunks);
    const { sink, logs } = makeSink();
    const provider = withLogging(fake, BASE_CONFIG, sink);

    for await (const _ of provider.streamChat(
      {
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
      { context: { userId, metadata: { kind: 'title_generation', appName: 'ollive-web' } } },
    )) { /* drain */ }

    const log = logs[0];
    const meta = log.metadata;
    expect(log.context?.userId).toBe(userId);
    expect(meta.kind).toBe('title_generation');
    expect(meta.appName).toBe('ollive-web');
    expect(meta.temperature).toBe(0.7);
    expect(meta.maxOutputTokens).toBe(1024);
    expect(meta.stream).toBe(true);
  });
});

describe('withLoggingTransport', () => {
  it('smoke: returned provider.name matches wrapped provider, transport is BufferedHttpTransport', async () => {
    const fake = new FakeProvider([]);
    const { provider, transport } = withLoggingTransport(fake, {
      ...BASE_CONFIG,
      ingestionUrl: 'http://unused.local/v1/logs',
      apiKey: 'test-key',
    });

    // Provider name is preserved from the wrapped provider
    expect(provider.name).toBe(fake.name);

    // Transport is a BufferedHttpTransport instance
    expect(transport).toBeInstanceOf(BufferedHttpTransport);

    // Close the transport so the background timer does not leak across tests
    await transport.close();
  });
});
