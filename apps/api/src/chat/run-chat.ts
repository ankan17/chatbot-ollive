import type { Request, Response } from 'express';
import type { LLMProvider, ChatRequest, CallContext } from '@ollive/llm-sdk';
import type { Usage } from '@ollive/shared';
import type { SseErrorCode, SseTitleData } from '@ollive/shared/api';
import { openSse } from './sse.js';

export interface RunChatArgs {
  req: Request;
  res: Response;
  /** Injected provider (real instrumented OR FakeChatProvider in tests) */
  provider: LLMProvider;
  /** Model + budgeted messages (from buildContext) */
  chatRequest: ChatRequest;
  /** SDK log context: conversationId/messageId/userId + metadata */
  context: CallContext;
  /** Assistant messageId for SSE start/done — null for guest */
  messageId: string | null;
  /** Surfaced in SSE start; SDK generates its OWN id for the log */
  requestId: string;
  /** Optional progress hook (unused by guest) */
  onDelta?: (accumulated: string) => void;
  onComplete: (result: { content: string; usage: Usage; finishReason: string }) => Promise<void>;
  onCancel: (result: { content: string }) => Promise<void>;
  onError: (result: { content: string; code: SseErrorCode; message: string }) => Promise<void>;
  /**
   * Optional hook run AFTER a successful `done` (never on cancel/error), while the
   * SSE stream is still open — used to push trailing events such as the auto title.
   * Errors are swallowed so a trailing-event failure never prevents the stream from
   * closing. The provided `emit.title` is a no-op if the client has disconnected.
   */
  onAfterDone?: (emit: { title: (data: SseTitleData) => void }) => Promise<void>;
}

/**
 * Walk the error chain. The AI SDK retries failures and rethrows a `RetryError`
 * that wraps the real cause in `.lastError`; other layers use `.cause`. We must
 * inspect the whole chain, not just the outermost error.
 */
function errorChain(err: Error): Error[] {
  const chain: Error[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = (cur as { lastError?: unknown }).lastError ?? (cur as { cause?: unknown }).cause;
  }
  return chain;
}

/** Authoritative HTTP status from an AI SDK `APICallError` (or a nested body code). */
function httpStatusOf(err: Error): number | undefined {
  const e = err as { statusCode?: unknown; status?: unknown; data?: { error?: { code?: unknown } } };
  for (const c of [e.statusCode, e.status, e.data?.error?.code]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

/** Provider status string (e.g. Gemini's `RESOURCE_EXHAUSTED`) from the response body. */
function providerStatusOf(err: Error): string {
  const s = (err as { data?: { error?: { status?: unknown } } }).data?.error?.status;
  return typeof s === 'string' ? s : '';
}

/**
 * Map a provider-thrown error to the SSE error catalog (contract §7).
 *
 * Prefers the authoritative HTTP status code (the AI SDK's `APICallError.statusCode`,
 * which survives even when the error body can't be parsed into a keyword-bearing
 * message) and unwraps the `RetryError` the SDK throws after retrying. Falls back to
 * string matching for providers/transports that only surface a message.
 *
 * - 429 / "rate limit" / "quota" / RESOURCE_EXHAUSTED → rate_limited
 * - 408 / 504 / "timeout" / "deadline"                → provider_timeout
 * - any other provider HTTP status / provider error   → provider_error
 * - non-provider / internal failure                   → internal_error
 */
export function mapProviderError(err: unknown): { code: SseErrorCode; message: string } {
  if (!(err instanceof Error)) {
    return { code: 'internal_error', message: 'An unexpected error occurred' };
  }

  const chain = errorChain(err);
  const status = chain.map(httpStatusOf).find((s) => s !== undefined);
  // All messages + names + provider statuses across the chain, lowercased.
  const text = chain
    .map((e) => `${e.message} ${e.name} ${providerStatusOf(e)}`)
    .join(' ')
    .toLowerCase();

  // Rate limit — authoritative 429, or any rate/quota indicator in the chain.
  if (
    status === 429 ||
    text.includes('429') ||
    text.includes('rate limit') ||
    text.includes('rate_limit') ||
    text.includes('ratelimit') ||
    text.includes('too many requests') ||
    text.includes('resource exhausted') ||
    text.includes('resource_exhausted') ||
    text.includes('quota')
  ) {
    return { code: 'rate_limited', message: 'Rate limit reached. Please try again shortly.' };
  }

  // Timeout
  if (
    status === 408 ||
    status === 504 ||
    text.includes('timeout') ||
    text.includes('etimedout') ||
    text.includes('deadline')
  ) {
    return { code: 'provider_timeout', message: 'The provider took too long to respond.' };
  }

  // Any provider HTTP status (even unparsed) or provider-shaped error.
  if (
    status !== undefined ||
    text.includes('provider') ||
    text.includes('apicallerror') ||
    text.includes('api error') ||
    text.includes('model error') ||
    text.includes('generation failed')
  ) {
    return { code: 'provider_error', message: 'The provider returned an error.' };
  }

  // Default: no provider indicators → internal_error (e.g. TypeError, DB error)
  return { code: 'internal_error', message: 'An unexpected error occurred' };
}

/**
 * Shared SSE streaming engine used by both chat and guest routes.
 *
 * - Opens an SSE stream, emits start/token/done events.
 * - Abort: fires onCancel (status='partial'), stream closes — NO done/error event.
 * - Error: maps to SSE error catalog, fires onError, emits error event.
 * - onComplete runs BEFORE sse.done so the DB is consistent when the client sees done.
 * - done.usage is ALWAYS present (zeroed if provider emits none — contract §3).
 */
export async function runChatStream(args: RunChatArgs): Promise<void> {
  const {
    req,
    res,
    provider,
    chatRequest,
    context,
    messageId,
    requestId,
    onDelta,
    onComplete,
    onCancel,
    onError,
    onAfterDone,
  } = args;

  const sse = openSse(res);
  const ac = new AbortController();
  let cancelled = false;

  // ST4: client closes connection → abort the provider stream
  const onClose = () => {
    if (!sse.ended) {
      cancelled = true;
      ac.abort();
    }
  };
  req.on('close', onClose);

  sse.start({ messageId, requestId });

  let content = '';

  try {
    let usage: Usage | null = null;
    let finishReason = 'stop';

    for await (const chunk of provider.streamChat(chatRequest, {
      signal: ac.signal,
      context,
    })) {
      if (chunk.delta) {
        content += chunk.delta;
        sse.token({ delta: chunk.delta });
        onDelta?.(content);
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
      if (chunk.finishReason) {
        finishReason = chunk.finishReason;
      }
    }

    // contract §3: done.usage is ALWAYS present — normalize missing to zeroed Usage
    const finalUsage: Usage = usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Persist BEFORE emitting done so a client acting on done sees consistent DB.
    // Trade-off: if onComplete (the DB write) throws after all tokens are streamed,
    // the client receives a complete token stream followed by an SSE error event
    // (no done), and the message row is finalized as 'error'. This is intentional —
    // a failed persistence must not signal success to the client.
    await onComplete({ content, usage: finalUsage, finishReason });
    sse.done({ messageId, finishReason, usage: finalUsage });

    // Trailing events (e.g. auto title) — after done, before close. Best-effort:
    // a failure here must not turn a successful response into an error, and the
    // emit is skipped if the client has since disconnected.
    if (onAfterDone) {
      try {
        await onAfterDone({ title: (data) => { if (!cancelled) sse.title(data); } });
      } catch {
        // swallow — the message already succeeded; stream must still close cleanly
      }
    }
  } catch (err) {
    // CANCEL: contract §3 / RESOLUTION 4 — stream simply closes, NO done/error event
    if (cancelled || (err instanceof Error && err.name === 'AbortError') || ac.signal.aborted) {
      try {
        await onCancel({ content });
      } catch {
        // swallow — stream must always close
      }
    } else {
      const { code, message } = mapProviderError(err);
      try {
        await onError({ content, code, message });
      } catch {
        // swallow — stream must always close
      }
      if (!sse.ended) {
        sse.error({ code, message });
      }
    }
  } finally {
    req.removeListener('close', onClose);
    sse.close();
  }
}
