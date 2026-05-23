import { describe, it, expect, vi, afterEach } from 'vitest';
import { openSse } from '../src/chat/sse.js';
import type { Response } from 'express';

/** Create a minimal fake Express Response that records written chunks. */
function makeFakeResponse() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};

  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    flushHeaders() {
      // no-op in tests
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      // no-op in tests
    },
    get writableEnded() {
      return false;
    },
  } as unknown as Response;

  return { res, chunks, headers };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('openSse — headers', () => {
  it('sets Content-Type, Cache-Control, Connection headers', () => {
    const { res, headers } = makeFakeResponse();
    openSse(res, { heartbeatMs: 0 });
    expect(headers['content-type']).toBe('text/event-stream');
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers.connection).toBe('keep-alive');
  });
});

describe('openSse — start frame', () => {
  it('writes exact event: start frame', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.start({ messageId: 'm4', requestId: 'r1' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('event: start\ndata: {"messageId":"m4","requestId":"r1"}\n\n');
  });

  it('start with null messageId', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.start({ messageId: null, requestId: 'r2' });
    expect(chunks[0]).toBe('event: start\ndata: {"messageId":null,"requestId":"r2"}\n\n');
  });
});

describe('openSse — token frame', () => {
  it('writes a token frame with delta JSON-encoded', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.token({ delta: 'Day ' });
    expect(chunks[0]).toBe('event: token\ndata: {"delta":"Day "}\n\n');
  });

  it('delta containing a newline stays on a single data: line (escaped)', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.token({ delta: 'line1\nline2' });
    // The frame must be a single data: line (JSON.stringify escapes \n as \\n)
    const lines = chunks[0].split('\n');
    // lines: ["event: token", "data: {\"delta\":\"line1\\nline2\"}", "", ""]
    const dataLine = lines.find((l) => l.startsWith('data:'));
    expect(dataLine).toBeDefined();
    // Only one data: line
    const dataLines = lines.filter((l) => l.startsWith('data:'));
    expect(dataLines).toHaveLength(1);
    // Content correctly escaped
    expect(dataLine).toContain('\\n');
  });
});

describe('openSse — done frame', () => {
  it('writes a done frame with usage object', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.done({
      messageId: 'm4',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
    expect(chunks[0]).toBe(
      'event: done\ndata: {"messageId":"m4","finishReason":"stop","usage":{"promptTokens":1,"completionTokens":2,"totalTokens":3}}\n\n',
    );
  });
});

describe('openSse — error frame', () => {
  it('writes an error frame with code and message', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.error({ code: 'rate_limited', message: 'Too many requests' });
    expect(chunks[0]).toBe(
      'event: error\ndata: {"code":"rate_limited","message":"Too many requests"}\n\n',
    );
  });
});

describe('openSse — heartbeat', () => {
  it('sends : ping comment after heartbeatMs and stops after close()', async () => {
    vi.useFakeTimers();
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 10 });

    // Advance time to trigger at least one ping
    vi.advanceTimersByTime(25);

    const pingsBefore = chunks.filter((c) => c === ': ping\n\n').length;
    expect(pingsBefore).toBeGreaterThan(0);

    sse.close();

    const pingsAfterClose = chunks.filter((c) => c === ': ping\n\n').length;
    // Advance time more — no new pings should appear
    vi.advanceTimersByTime(50);
    const pingsAfterAdvance = chunks.filter((c) => c === ': ping\n\n').length;
    expect(pingsAfterAdvance).toBe(pingsAfterClose);

    vi.useRealTimers();
  });
});

describe('openSse — ended guard', () => {
  it('ended is true after close()', () => {
    const { res } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    expect(sse.ended).toBe(false);
    sse.close();
    expect(sse.ended).toBe(true);
  });

  it('subsequent token()/done() after close() write nothing', () => {
    const { res, chunks } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.close();
    sse.token({ delta: 'late delta' });
    sse.done({ messageId: null, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    expect(chunks).toHaveLength(0);
  });

  it('double close() is harmless', () => {
    const { res } = makeFakeResponse();
    const sse = openSse(res, { heartbeatMs: 0 });
    sse.close();
    expect(() => sse.close()).not.toThrow();
    expect(sse.ended).toBe(true);
  });
});
