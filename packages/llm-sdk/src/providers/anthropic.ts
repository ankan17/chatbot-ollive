import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ChatRequest, LLMProvider, StreamChunk, CallContext } from '../types.js';
import { normalizeUsage, normalizeFinishReason } from './normalize.js';

// ---------------------------------------------------------------------------
// AnthropicProvider — Vercel AI SDK adapter (ai@5.x + @ai-sdk/anthropic@2.x)
// ---------------------------------------------------------------------------

// We create a module-level anthropic model factory using createAnthropic
// so the module mock in tests can intercept it cleanly.
const anthropic = createAnthropic();

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;

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
      model: anthropic(req.model),
      messages: req.messages,
      abortSignal: opts?.signal,
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      onError: ({ error }) => {
        capturedError = error;
      },
    });

    try {
      // Yield delta chunks immediately — zero added latency
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

/** Factory function — used by ProviderRegistry.register('anthropic', anthropicProviderFactory). */
export function anthropicProviderFactory(): AnthropicProvider {
  return new AnthropicProvider();
}
