import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ChatRequest, LLMProvider, StreamChunk, CallContext } from '../types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AnyUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
}

/**
 * Normalizes provider/SDK-version token-usage differences.
 * ai@5.x uses inputTokens/outputTokens; ai@4.x used promptTokens/completionTokens.
 * Reads both spellings defensively; missing values coerce to 0.
 */
function normalizeUsage(u: AnyUsage): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const promptTokens = u.inputTokens ?? u.promptTokens ?? 0;
  const completionTokens = u.outputTokens ?? u.completionTokens ?? 0;
  const totalTokens = u.totalTokens ?? (promptTokens + completionTokens);
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Normalizes finish reasons from the provider into our StreamChunk union.
 */
function normalizeFinishReason(r: string | undefined): StreamChunk['finishReason'] {
  switch (r) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content-filter':
    case 'content_filter': return 'content_filter';
    case 'error': return 'error';
    case 'cancelled': return 'cancelled';
    default: return 'stop';
  }
}

// ---------------------------------------------------------------------------
// GoogleProvider — Vercel AI SDK adapter (ai@5.x + @ai-sdk/google@2.x)
// ---------------------------------------------------------------------------

// We create a module-level google model factory using createGoogleGenerativeAI
// so the module mock in tests can intercept it cleanly.
const googleAI = createGoogleGenerativeAI();

export class GoogleProvider implements LLMProvider {
  readonly name = 'google' as const;

  async *streamChat(
    req: ChatRequest,
    opts?: { signal?: AbortSignal; context?: CallContext },
  ): AsyncIterable<StreamChunk> {
    // ai@5 surfaces the real provider error (e.g. an APICallError carrying the HTTP
    // status) via onError, while the stream's own promises reject with a context-free
    // NoOutputGeneratedError. Capture it so we can re-throw the real cause below —
    // otherwise downstream error classification can't see the status code.
    let capturedError: unknown;
    const result = streamText({
      model: googleAI(req.model),
      messages: req.messages,
      abortSignal: opts?.signal,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      onError: ({ error }) => {
        capturedError = error;
      },
    });

    try {
      // Yield delta chunks immediately — zero added latency (SDK10/NFR1)
      for await (const delta of result.textStream) {
        yield { delta };
      }

      // After stream ends, emit the final usage+finishReason chunk
      const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
      yield {
        usage: normalizeUsage(usage),
        finishReason: normalizeFinishReason(finishReason),
      };
    } catch (err) {
      // Prefer the real provider error captured via onError over the SDK's
      // context-free NoOutputGeneratedError.
      throw capturedError ?? err;
    }
  }
}

/** Factory function — used by ProviderRegistry.register('google', googleProviderFactory). */
export function googleProviderFactory(): GoogleProvider {
  return new GoogleProvider();
}
