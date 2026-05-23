import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ChatRequest, LLMProvider, StreamChunk, CallContext } from '../types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AnyUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
};

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
    const result = streamText({
      model: googleAI(req.model),
      messages: req.messages as NonNullable<Parameters<typeof streamText>[0]['messages']>,
      abortSignal: opts?.signal,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
    });

    // Yield delta chunks immediately — zero added latency (SDK10/NFR1)
    for await (const delta of result.textStream) {
      yield { delta };
    }

    // After stream ends, emit the final usage+finishReason chunk
    const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
    yield {
      usage: normalizeUsage(usage as AnyUsage),
      finishReason: normalizeFinishReason(finishReason as string | undefined),
    };
  }
}

/** Factory function — used by ProviderRegistry.register('google', googleProviderFactory). */
export function googleProviderFactory(): GoogleProvider {
  return new GoogleProvider();
}
