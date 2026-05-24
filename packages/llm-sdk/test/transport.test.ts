import { describe, it, expect, afterEach } from 'vitest';
import { inferenceLogSchema } from '@ollive/shared';
import { BufferedHttpTransport } from '../src/transport/transport.js';
import { makeMockIngestionServer } from './fakes.js';

// Build a minimal valid InferenceLog via schema
const NOW = new Date().toISOString();
const baseLog = inferenceLogSchema.parse({
  requestId: crypto.randomUUID(),
  timestamp: NOW,
  provider: 'fake',
  model: 'test-model',
  status: 'success',
  context: {},
  timing: {
    startedAt: NOW,
    completedAt: NOW,
    latencyMs: 42,
  },
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  preview: { input: 'hi', output: 'hello' },
  error: null,
  metadata: { stream: true },
});

describe('BufferedHttpTransport', () => {
  afterEach(async () => {
    // Nothing special — each test closes its server inline
  });

  it('size-triggered flush: sends 2 logs when buffer fills, auth header correct, body valid', async () => {
    const server = await makeMockIngestionServer();

    const transport = new BufferedHttpTransport({
      ingestionUrl: server.url,
      apiKey: 'secret-key',
      maxBufferSize: 2,
      flushIntervalMs: 60_000, // won't trigger in test
      autoFlushOnFull: false,  // test explicit flush
    });

    transport.enqueue(baseLog);
    transport.enqueue(baseLog);
    await transport.flush();
    await transport.close();
    await server.close();

    expect(server.received).toHaveLength(2);
    expect(server.received[0].auth).toBe('Bearer secret-key');
    expect(() => inferenceLogSchema.parse(server.received[0].body)).not.toThrow();
  });

  it('interval flush: enqueue 1 log, wait ~80ms, server received it', async () => {
    const server = await makeMockIngestionServer();

    const transport = new BufferedHttpTransport({
      ingestionUrl: server.url,
      apiKey: 'key',
      maxBufferSize: 1000,
      flushIntervalMs: 20,
    });

    transport.enqueue(baseLog);

    // Wait for the interval to fire (≥2 intervals)
    await new Promise<void>((res) => setTimeout(res, 80));
    await transport.close();
    await server.close();

    expect(server.received).toHaveLength(1);
  });

  it('still drains after an initial empty flush (re-entrancy guard not permanently jammed)', async () => {
    const server = await makeMockIngestionServer();

    const transport = new BufferedHttpTransport({
      ingestionUrl: server.url,
      apiKey: 'key',
      maxBufferSize: 100,
      flushIntervalMs: 60_000, // keep the background timer out of the test
      autoFlushOnFull: false,
    });

    // Mimic the first background-timer tick firing while the buffer is empty.
    await transport.flush();

    // A log arrives afterward — flushing must actually ship it.
    transport.enqueue(baseLog);
    await transport.flush();

    await transport.close();
    await server.close();

    expect(server.received).toHaveLength(1);
  });

  it('retry on 5xx then succeed: 2 failures + 1 success = 3 server requests for 1 log', async () => {
    const server = await makeMockIngestionServer({ failTimes: 2 });

    const transport = new BufferedHttpTransport({
      ingestionUrl: server.url,
      apiKey: 'key',
      maxBufferSize: 100,
      flushIntervalMs: 60_000,
      maxRetries: 3,
      baseBackoffMs: 5,
      autoFlushOnFull: false,
    });

    transport.enqueue(baseLog);
    await transport.flush();
    await transport.close();
    await server.close();

    expect(server.received).toHaveLength(3); // 2 failures + 1 success
  });

  it('overflow drops oldest and emits warning', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      // Use a fetchImpl that always rejects quickly so close() won't hang
      const quickFailFetch = async () => {
        throw new Error('connection refused');
      };

      const transport = new BufferedHttpTransport({
        ingestionUrl: 'http://127.0.0.1:1', // unroutable
        apiKey: 'key',
        maxBufferSize: 2,
        flushIntervalMs: 60_000,
        autoFlushOnFull: false,
        maxRetries: 0,
        fetchImpl: quickFailFetch,
      });

      const log1 = { ...baseLog, requestId: crypto.randomUUID() };
      const log2 = { ...baseLog, requestId: crypto.randomUUID() };
      const log3 = { ...baseLog, requestId: crypto.randomUUID() };

      transport.enqueue(log1);
      transport.enqueue(log2);
      transport.enqueue(log3); // triggers overflow

      expect(transport.bufferSize()).toBe(2);
      expect(warnings.some((w) => w.includes('overflow'))).toBe(true);

      await transport.close();
    } finally {
      console.warn = origWarn;
    }
  });

  it('retry exhaustion: drops log after maxRetries+1 attempts, no throw, warns', async () => {
    const server = await makeMockIngestionServer({ failTimes: 100 }); // always 503
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

    try {
      const transport = new BufferedHttpTransport({
        ingestionUrl: server.url,
        apiKey: 'key',
        maxBufferSize: 100,
        flushIntervalMs: 60_000,
        maxRetries: 2,
        baseBackoffMs: 2,
        autoFlushOnFull: false,
      });

      transport.enqueue(baseLog);
      // Should NOT throw
      await expect(transport.flush()).resolves.toBeUndefined();
      await transport.close();
      await server.close();

      // 1 initial + 2 retries = 3 total
      expect(server.received).toHaveLength(3);
      expect(warnings.some((w) => w.includes('dropping'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});
