import type { Request, Response } from 'express';
import type { LLMProvider, ChatRequest, CallContext } from '@ollive/llm-sdk';
import type { Usage } from '@ollive/shared';
import type { SseErrorCode } from '@ollive/shared/api';
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
}

/**
 * Map a provider-thrown error to the SSE error catalog (contract §7).
 *
 * - 429 / "rate limit" / "resource exhausted" → rate_limited
 * - timeout / deadline / ETIMEDOUT            → provider_timeout
 * - other provider error                       → provider_error
 * - non-provider / internal failure            → internal_error
 */
export function mapProviderError(err: unknown): { code: SseErrorCode; message: string } {
  if (!(err instanceof Error)) {
    return { code: 'internal_error', message: 'An unexpected error occurred' };
  }

  const msg = err.message.toLowerCase();
  const name = err.name.toLowerCase();

  // Rate limit
  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('resource exhausted') ||
    msg.includes('quota') ||
    name.includes('ratelimit')
  ) {
    return { code: 'rate_limited', message: 'Rate limit reached. Please try again shortly.' };
  }

  // Timeout
  if (
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('deadline') ||
    name.includes('timeout')
  ) {
    return { code: 'provider_timeout', message: 'The provider took too long to respond.' };
  }

  // Anything else from a provider-shaped error (has a name suggesting provider)
  if (
    name.includes('provider') ||
    msg.includes('provider') ||
    msg.includes('api error') ||
    msg.includes('model error') ||
    msg.includes('generation failed')
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
