import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSseParser } from '../api/stream.js';
import { ApiError } from '../api/errors.js';
import type { SseStartData, SseDoneData } from '../api/types.js';

// ─── Parser tests ────────────────────────────────────────────────────────────

describe('createSseParser', () => {
  it('(1) parses a single complete frame', () => {
    const parser = createSseParser();
    const events = parser.push('event: token\ndata: {"delta":"hi"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'token', data: { delta: 'hi' } });
  });

  it('(2) handles a frame split across two pushes', () => {
    const parser = createSseParser();
    const first = parser.push('event: token\ndata: {"del');
    expect(first).toHaveLength(0); // incomplete frame
    const second = parser.push('ta":"world"}\n\n');
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({ event: 'token', data: { delta: 'world' } });
  });

  it('(3) parses multiple frames in one push (start + 2 tokens → 3 events in order)', () => {
    const parser = createSseParser();
    const chunk = [
      'event: start\ndata: {"messageId":"msg1","requestId":"req1"}\n\n',
      'event: token\ndata: {"delta":"a"}\n\n',
      'event: token\ndata: {"delta":"b"}\n\n',
    ].join('');
    const events = parser.push(chunk);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('start');
    expect(events[1]).toEqual({ event: 'token', data: { delta: 'a' } });
    expect(events[2]).toEqual({ event: 'token', data: { delta: 'b' } });
  });

  it('(4) ignores comment lines (heartbeats) and unknown event names', () => {
    const parser = createSseParser();
    const events = parser.push(
      ': ping\n\nevent: unknown\ndata: {}\n\nevent: token\ndata: {"delta":"ok"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'token', data: { delta: 'ok' } });
  });

  it('(5) flush returns trailing unterminated frame', () => {
    const parser = createSseParser();
    parser.push('event: token\ndata: {"delta":"x"}'); // no trailing \n\n
    const flushed = parser.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual({ event: 'token', data: { delta: 'x' } });
  });

  it('(5b) parses a title event', () => {
    const parser = createSseParser();
    const events = parser.push(
      'event: title\ndata: {"conversationId":"c1","title":"Market sizing tips"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: 'title',
      data: { conversationId: 'c1', title: 'Market sizing tips' },
    });
  });
});

// ─── streamChat helpers ───────────────────────────────────────────────────────

function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(enc.encode(chunks[idx++]));
      } else {
        controller.close();
      }
    },
  });
}

function sseChunks(frames: string[]): string[] {
  return frames; // each frame already is a chunk
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── streamChat integration tests ────────────────────────────────────────────

describe('streamChat', () => {
  it('(6) happy path: start → token×3 → done; callbacks fire in order; promise resolves', async () => {
    const body = makeReadableStream(
      sseChunks([
        'event: start\ndata: {"messageId":"m1","requestId":"r1"}\n\n',
        'event: token\ndata: {"delta":"Hello"}\n\n',
        'event: token\ndata: {"delta":" world"}\n\n',
        'event: token\ndata: {"delta":"!"}\n\n',
        'event: done\ndata: {"messageId":"m1","finishReason":"stop","usage":{"promptTokens":10,"completionTokens":3,"totalTokens":13}}\n\n',
      ]),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const order: string[] = [];
    const onStart = vi.fn((d: SseStartData) => { order.push('start:' + d.messageId); });
    const onToken = vi.fn((d: { delta: string }) => { order.push('token:' + d.delta); });
    const onDone = vi.fn((d: SseDoneData) => { order.push('done:' + d.finishReason); });
    const onError = vi.fn();

    const { streamChat } = await import('../api/stream.js');
    await streamChat('http://api/v1/conversations/c1/messages', { content: 'hi' }, {
      onStart,
      onToken,
      onDone,
      onError,
    });

    expect(onStart).toHaveBeenCalledOnce();
    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0][0].usage.totalTokens).toBe(13);
    expect(onError).not.toHaveBeenCalled();
    expect(order).toEqual(['start:m1', 'token:Hello', 'token: world', 'token:!', 'done:stop']);
  });

  it('(6b) title event after done dispatches onTitle (stream keeps reading past done)', async () => {
    const body = makeReadableStream([
      'event: start\ndata: {"messageId":"m1","requestId":"r1"}\n\n',
      'event: token\ndata: {"delta":"Hi"}\n\n',
      'event: done\ndata: {"messageId":"m1","finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2}}\n\n',
      'event: title\ndata: {"conversationId":"c1","title":"Market sizing tips"}\n\n',
    ]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const order: string[] = [];
    const onDone = vi.fn((d: SseDoneData) => { order.push('done:' + d.finishReason); });
    const onTitle = vi.fn((d: { conversationId: string; title: string }) => { order.push('title:' + d.title); });

    const { streamChat } = await import('../api/stream.js');
    await streamChat('http://api/v1/conversations/c1/messages', { content: 'hi' }, {
      onDone,
      onTitle,
    });

    expect(onDone).toHaveBeenCalledOnce();
    expect(onTitle).toHaveBeenCalledOnce();
    expect(onTitle.mock.calls[0][0]).toEqual({ conversationId: 'c1', title: 'Market sizing tips' });
    // title must arrive AFTER done (done re-enables the composer; title trails it)
    expect(order).toEqual(['done:stop', 'title:Market sizing tips']);
  });

  it('(7) server error event: start→error → onError fires, promise RESOLVES', async () => {
    const body = makeReadableStream([
      'event: start\ndata: {"messageId":null,"requestId":"r2"}\n\n',
      'event: error\ndata: {"code":"provider_error","message":"boom"}\n\n',
    ]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const onDone = vi.fn();
    const onError = vi.fn();

    const { streamChat } = await import('../api/stream.js');
    await expect(
      streamChat('http://api/test', {}, { onDone, onError }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'provider_error', message: 'boom' });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('(8) cancel: abort after first token → no done/error, promise REJECTS with AbortError', async () => {
    const ac = new AbortController();

    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode('event: token\ndata: {"delta":"hi"}\n\n'));
        // Abort mid-stream
        ac.abort();
        // Send more data that should NOT be processed
        controller.enqueue(enc.encode('event: done\ndata: {"messageId":null,"finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1,"totalTokens":2}}\n\n'));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const onDone = vi.fn();
    const onError = vi.fn();

    const { streamChat } = await import('../api/stream.js');
    await expect(
      streamChat('http://api/test', {}, { signal: ac.signal, onDone, onError }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('(9) guest cap 403: promise rejects with ApiError login_required, no callbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'login_required', remaining: 0 }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const onStart = vi.fn();
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { streamChat } = await import('../api/stream.js');
    await expect(
      streamChat('http://api/test', {}, { onStart, onToken, onDone, onError }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === 'login_required');

    expect(onStart).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
