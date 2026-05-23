import type { Response } from 'express';
import type {
  SseStartData,
  SseTokenData,
  SseDoneData,
  SseErrorData,
} from '@ollive/shared/api';

export interface SseStream {
  start(data: SseStartData): void;
  token(data: SseTokenData): void;
  /** usage is required by the type — never call with a null usage */
  done(data: SseDoneData): void;
  error(data: SseErrorData): void;
  /** Ends the response + clears the heartbeat timer. Idempotent. */
  close(): void;
  readonly ended: boolean;
}

/**
 * Format a single SSE frame.
 * Each frame is: `event: <name>\ndata: <json>\n\n`
 * JSON.stringify escapes embedded newlines so a multi-line delta stays on one data: line.
 */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Open an SSE stream on the given Express response.
 *
 * Writes the required headers, calls flushHeaders, and sets up an optional
 * heartbeat (`: ping\n\n`) to defeat idle-proxy timeouts.
 *
 * @param res          The Express Response to stream into.
 * @param opts.heartbeatMs  Interval in ms between `: ping` comments (default 15000). Pass 0 to disable.
 */
export function openSse(res: Response, opts?: { heartbeatMs?: number }): SseStream {
  const heartbeatMs = opts?.heartbeatMs ?? 15_000;

  // ST1 — required SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let _ended = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (!_ended) {
        res.write(': ping\n\n');
      }
    }, heartbeatMs);
    // Allow the process to exit even if the timer is still running
    heartbeatTimer.unref?.();
  }

  function write(eventName: string, data: unknown): void {
    if (_ended) return;
    res.write(frame(eventName, data));
  }

  return {
    start(data: SseStartData): void {
      write('start', data);
    },
    token(data: SseTokenData): void {
      write('token', data);
    },
    done(data: SseDoneData): void {
      write('done', data);
    },
    error(data: SseErrorData): void {
      write('error', data);
    },
    close(): void {
      if (_ended) return;
      _ended = true;
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      res.end();
    },
    get ended(): boolean {
      return _ended;
    },
  };
}
