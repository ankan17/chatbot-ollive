import type { LLMProvider, ChatRequest, StreamChunk, CallContext } from '@ollive/llm-sdk';
import type { Usage } from '@ollive/shared';

export interface FakeChatProviderOptions {
  /** Provider name (default: 'fake') */
  name?: string;
  /** Scripted delta strings to yield */
  deltas: string[];
  /** Usage object to emit in the final chunk (omit to test zero-usage path) */
  usage?: Usage;
  /** Finish reason in the final chunk (default: 'stop') */
  finishReason?: string;
  /** Delay in ms before yielding the first delta (measurable TTFT) */
  delayMs?: number;
  /** Throw `throwError` after this many deltas (0 = before first delta) */
  throwAfter?: number;
  /** Error to throw — if omitted and throwAfter is set, throws a generic provider error */
  throwError?: Error;
  /** Throw an AbortError after this many deltas (simulates provider honoring abort) */
  abortAfter?: number;
  /** If true, the provider records each CallContext it is invoked with */
  recordContext?: boolean;
}

/**
 * FakeChatProvider — a scripted LLMProvider implementation for tests.
 *
 * Yields configurable deltas then a final usage/finishReason chunk.
 * Never calls a real model. Mirrors the Plan 2 SDK fake pattern.
 */
export class FakeChatProvider implements LLMProvider {
  readonly name: string;
  private readonly opts: FakeChatProviderOptions;
  /** Contexts recorded from each streamChat call (when recordContext=true) */
  readonly recordedContexts: CallContext[] = [];

  constructor(opts: FakeChatProviderOptions) {
    this.opts = opts;
    this.name = opts.name ?? 'fake';
  }

  async *streamChat(
    _req: ChatRequest,
    callOpts?: { signal?: AbortSignal; context?: CallContext },
  ): AsyncIterable<StreamChunk> {
    const { deltas, usage, finishReason, delayMs, throwAfter, throwError, abortAfter } = this.opts;

    if (this.opts.recordContext && callOpts?.context) {
      this.recordedContexts.push(callOpts.context);
    }

    // Optional delay before first delta (measurable TTFT)
    if (delayMs && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    // Check if already aborted before we start
    if (callOpts?.signal?.aborted) {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }

    for (let i = 0; i < deltas.length; i++) {
      // Throw mid-stream if requested
      if (throwAfter !== undefined && i === throwAfter) {
        throw throwError ?? new Error('provider_error: generation failed');
      }

      // Honor abort signal (simulates provider checking the signal)
      if (abortAfter !== undefined && i === abortAfter) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }

      // Also check signal on each iteration
      if (callOpts?.signal?.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }

      yield { delta: deltas[i] };
    }

    // Check throw after all deltas
    if (throwAfter !== undefined && throwAfter === deltas.length) {
      throw throwError ?? new Error('provider_error: generation failed');
    }

    // Final chunk with usage + finishReason
    const finalChunk: StreamChunk = {};
    if (usage !== undefined) {
      finalChunk.usage = usage;
    }
    finalChunk.finishReason = (finishReason as StreamChunk['finishReason']) ?? 'stop';
    yield finalChunk;
  }
}
