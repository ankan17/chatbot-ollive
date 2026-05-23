import { normalizeError, ApiError } from './errors.js';
import type {
  SseEvent,
  SseStartData,
  SseTokenData,
  SseDoneData,
  SseErrorData,
} from './types.js';

// ─── SSE frame parser ─────────────────────────────────────────────────────────

export interface SseFrameParser {
  push: (textChunk: string) => SseEvent[];
  flush: () => SseEvent[];
}

const KNOWN_EVENTS = new Set(['start', 'token', 'done', 'error']);

function parseFrame(frame: string): SseEvent | null {
  const lines = frame.split('\n');
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) continue; // comment / heartbeat — skip
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  if (!eventName || !KNOWN_EVENTS.has(eventName)) return null;
  if (dataLines.length === 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }

  return { event: eventName, data } as SseEvent;
}

export function createSseParser(): SseFrameParser {
  let buffer = '';

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const events: SseEvent[] = [];

      // Split on blank-line delimiters (\n\n or \r\n\r\n)
      const parts = buffer.split(/\r?\n\r?\n/);
      // Last part is either empty (ended with \n\n) or an incomplete frame
      buffer = parts.pop() ?? '';

      for (const frame of parts) {
        const trimmed = frame.trim();
        if (!trimmed) continue;
        const event = parseFrame(trimmed);
        if (event) events.push(event);
      }

      return events;
    },

    flush(): SseEvent[] {
      const remaining = buffer.trim();
      buffer = '';
      if (!remaining) return [];
      const event = parseFrame(remaining);
      return event ? [event] : [];
    },
  };
}

// ─── streamChat ───────────────────────────────────────────────────────────────

export interface StreamChatCallbacks {
  onStart?: (d: SseStartData) => void;
  onToken?: (d: SseTokenData) => void;
  onDone?: (d: SseDoneData) => void;
  onError?: (d: SseErrorData) => void;
}

export interface StreamChatOptions extends StreamChatCallbacks {
  signal?: AbortSignal;
}

function dispatchEvent(event: SseEvent, callbacks: StreamChatCallbacks): void {
  switch (event.event) {
    case 'start':
      callbacks.onStart?.(event.data);
      break;
    case 'token':
      callbacks.onToken?.(event.data);
      break;
    case 'done':
      callbacks.onDone?.(event.data);
      break;
    case 'error':
      callbacks.onError?.(event.data);
      break;
  }
}

export async function streamChat(
  url: string,
  body: unknown,
  opts: StreamChatOptions,
): Promise<void> {
  const { signal, ...callbacks } = opts;

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let parsedBody: unknown;
    try {
      parsedBody = await res.json();
    } catch {
      parsedBody = undefined;
    }
    throw normalizeError(res.status, parsedBody);
  }

  if (!res.body) throw new ApiError('network_error', 0, 'No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  function checkAbort() {
    if (signal?.aborted) {
      reader.cancel().catch(() => undefined);
      throw new DOMException('Aborted', 'AbortError');
    }
  }

  try {
    while (true) {
      checkAbort();

      const result = await reader.read();

      // Check again right after read returns — signal may have fired during await
      if (signal?.aborted) {
        reader.cancel().catch(() => undefined);
        throw new DOMException('Aborted', 'AbortError');
      }

      if (result.done) {
        // Drain any buffered multibyte bytes from the decoder
        const tail = decoder.decode();
        if (tail) parser.push(tail);
        // Stream ended — flush any trailing frame
        const trailing = parser.flush();
        for (const event of trailing) {
          dispatchEvent(event, callbacks);
        }
        break;
      }

      const text = decoder.decode(result.value, { stream: true });
      const events = parser.push(text);
      for (const event of events) {
        checkAbort();
        dispatchEvent(event, callbacks);
      }

      // Check abort after dispatching this batch
      checkAbort();
    }
  } catch (err) {
    // DOMException is not instanceof Error in jsdom — check name directly
    const name = (err as { name?: string })?.name;
    if (name === 'AbortError') {
      throw err;
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      'network_error',
      0,
      err instanceof Error ? err.message : 'Stream error',
    );
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
