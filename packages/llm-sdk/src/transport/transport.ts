import type { InferenceLog } from '@ollive/shared';
import type { LogSink } from '../logging/logger.js';

// ---------------------------------------------------------------------------
// TransportConfig
// ---------------------------------------------------------------------------

export interface TransportConfig {
  ingestionUrl: string;
  apiKey: string;
  maxBufferSize?: number;    // default 500
  flushIntervalMs?: number;  // default 1000
  maxRetries?: number;       // default 3
  baseBackoffMs?: number;    // default 200
  autoFlushOnFull?: boolean; // default true
  /** Injectable for tests; defaults to globalThis.fetch */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// BufferedHttpTransport — implements LogSink
// ---------------------------------------------------------------------------

/**
 * Bounded in-memory buffer that ships InferenceLogs to an ingestion endpoint
 * over HTTP with exponential backoff + jitter retries, drop-on-overflow,
 * and a background flush interval that never keeps the process alive.
 *
 * Implements SDK4/SDK5. The `enqueue` method is fully non-blocking (NFR1).
 */
export class BufferedHttpTransport implements LogSink {
  private readonly ingestionUrl: string;
  private readonly apiKey: string;
  private readonly maxBufferSize: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly autoFlushOnFull: boolean;
  private readonly fetchFn: typeof fetch;

  private readonly buffer: InferenceLog[] = [];
  private flushPromise: Promise<void> | null = null;
  private closed = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(config: TransportConfig) {
    this.ingestionUrl = config.ingestionUrl;
    this.apiKey = config.apiKey;
    this.maxBufferSize = config.maxBufferSize ?? 500;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseBackoffMs = config.baseBackoffMs ?? 200;
    this.autoFlushOnFull = config.autoFlushOnFull ?? true;
    this.fetchFn = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

    const flushIntervalMs = config.flushIntervalMs ?? 1000;

    this.timer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);

    // Don't keep the process alive just because the timer is running
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer).unref();
    }
  }

  /**
   * Enqueues a log for delivery. Non-blocking — returns instantly.
   * Drops the oldest entry (shift) if buffer is at capacity.
   */
  enqueue(log: InferenceLog): void {
    if (this.closed) return;

    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift();
      console.warn('[llm-sdk] transport buffer overflow — dropping oldest log');
    }

    this.buffer.push(log);

    if (this.autoFlushOnFull && this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  /** Returns the current number of buffered logs. */
  bufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Drains the buffer, sending each log with retry. Never throws.
   * Re-entrancy guarded — concurrent calls return (and await) the in-progress flush.
   */
  flush(): Promise<void> {
    if (this.flushPromise !== null) return this.flushPromise;
    this.flushPromise = (async () => {
      try {
        while (this.buffer.length > 0) {
          const log = this.buffer.shift()!;
          await this.shipWithRetry(log);
        }
      } finally {
        this.flushPromise = null;
      }
    })();
    return this.flushPromise;
  }

  /** Stops the background timer and performs a final flush. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    // Await any in-progress flush started by the background timer, then drain remainder.
    await (this.flushPromise ?? Promise.resolve());
    await this.flush();
  }

  // ---------------------------------------------------------------------------
  // Private: ship with exponential backoff + jitter
  // ---------------------------------------------------------------------------

  private async shipWithRetry(log: InferenceLog): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(this.ingestionUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(log),
        });

        if (response.ok) {
          // Successfully delivered (2xx)
          return;
        }

        // 4xx (except 408 Request Timeout / 429 Too Many Requests) = non-retryable
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          console.warn(`[llm-sdk] dropping log: non-retryable status ${status}`);
          return;
        }

        // 5xx, 408, 429 = retryable — fall through to backoff
      } catch {
        // Network error = retryable — fall through to backoff
      }

      // If this was the last attempt, give up
      if (attempt === this.maxRetries) {
        console.warn(`[llm-sdk] dropping log after ${this.maxRetries} retries`);
        return;
      }

      // Exponential backoff + jitter: baseBackoffMs * 2^attempt + random * baseBackoffMs * 2^attempt
      const base = this.baseBackoffMs * Math.pow(2, attempt);
      const jitter = Math.random() * base;
      await sleep(base + jitter);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((res) => setTimeout(res, ms));
}
