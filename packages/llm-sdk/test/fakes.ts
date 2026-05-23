import * as http from 'node:http';
import type { LLMProvider, ChatRequest, StreamChunk, CallContext } from '../src/types.js';

// ---------------------------------------------------------------------------
// FakeProvider — scripted async-generator LLM provider for testing
// ---------------------------------------------------------------------------

export interface FakeProviderOptions {
  name?: string;
  /** Delay in ms before yielding the first chunk (makes TTFT measurable). */
  delayMs?: number;
  /** Throw this error after `throwAfter` chunks. */
  throwError?: Error;
  throwAfter?: number;
  /** Throw an AbortError after this many chunks (when signal is present). */
  abortAfter?: number;
}

export class FakeProvider implements LLMProvider {
  readonly name: string;
  private readonly chunks: StreamChunk[];
  private readonly opts: FakeProviderOptions;

  constructor(chunks: StreamChunk[], opts: FakeProviderOptions = {}) {
    this.chunks = chunks;
    this.opts = opts;
    this.name = opts.name ?? 'fake';
  }

  async *streamChat(
    _req: ChatRequest,
    callOpts?: { signal?: AbortSignal; context?: CallContext },
  ): AsyncIterable<StreamChunk> {
    const { delayMs, throwError, throwAfter, abortAfter } = this.opts;

    // Optional delay before first chunk (for TTFT measurement)
    if (delayMs && delayMs > 0) {
      await new Promise<void>((res) => setTimeout(res, delayMs));
    }

    for (let i = 0; i < this.chunks.length; i++) {
      // Check abort signal
      if (callOpts?.signal?.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }

      yield this.chunks[i]!;

      // Throw after N chunks have been yielded (i.e., after yielding chunk index throwAfter-1)
      if (throwError !== undefined && throwAfter !== undefined && i + 1 >= throwAfter) {
        throw throwError;
      }

      // Throw AbortError after N chunks have been yielded
      if (abortAfter !== undefined && i + 1 >= abortAfter && callOpts?.signal) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// makeMockIngestionServer — local HTTP server for transport tests
// ---------------------------------------------------------------------------

export interface MockIngestionServer {
  url: string;
  received: { auth?: string; body: unknown }[];
  close(): Promise<void>;
}

export function makeMockIngestionServer(
  opts: { failTimes?: number } = {},
): Promise<MockIngestionServer> {
  const received: { auth?: string; body: unknown }[] = [];
  let failCount = opts.failTimes ?? 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      received.push({ auth: req.headers['authorization'] as string | undefined, body: parsed });

      if (failCount > 0) {
        failCount--;
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
      } else {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        received,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}
