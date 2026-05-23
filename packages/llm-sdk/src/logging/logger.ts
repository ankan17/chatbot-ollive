import { randomUUID } from 'node:crypto';
import { inferenceLogSchema, PREVIEW_MAX_CHARS } from '@ollive/shared';
import type { InferenceLog } from '@ollive/shared';
import type { LLMProvider, ChatRequest, StreamChunk, CallContext, InferenceLoggerConfig } from '../types.js';
import { createRedactor } from '../redaction/redactor.js';
import { BufferedHttpTransport } from '../transport/transport.js';

// ---------------------------------------------------------------------------
// LogSink — injectable seam; Task 5's BufferedHttpTransport implements this
// ---------------------------------------------------------------------------

/** Minimal seam withLogging ships validated InferenceLogs to. */
export interface LogSink {
  enqueue(log: InferenceLog): void;
}

// ---------------------------------------------------------------------------
// withLogging — decorator (PRD §13 SDK1)
// ---------------------------------------------------------------------------

/**
 * Wraps `provider` with an instrumentation layer that:
 *  - Captures latency, TTFT, token usage, finish reason, and text previews
 *  - Redacts PII (fail-closed) then truncates previews to previewMaxChars
 *  - Validates the assembled log against inferenceLogSchema and ships to sink
 *  - Yields chunks to the caller immediately — zero hot-path latency (SDK10/NFR1)
 */
export function withLogging(
  provider: LLMProvider,
  config: InferenceLoggerConfig,
  sink: LogSink,
): LLMProvider {
  const previewMaxChars = config.previewMaxChars ?? PREVIEW_MAX_CHARS;
  const redactor = createRedactor(config.redaction ?? 'pattern', config.redactor);

  return {
    name: provider.name,

    async *streamChat(
      req: ChatRequest,
      opts?: { signal?: AbortSignal; context?: CallContext },
    ): AsyncIterable<StreamChunk> {
      const requestId = randomUUID();
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();

      // Accumulators
      let ttftMs: number | undefined;
      let outputText = '';
      let usage: StreamChunk['usage'] | undefined;
      let finishReason: StreamChunk['finishReason'] | undefined;
      let status: 'success' | 'error' | 'cancelled' = 'success';
      let errorPayload: { code: string; message: string } | null = null;

      /** Build and ship the InferenceLog payload — runs after streaming completes. */
      function ship(): void {
        const completedAtMs = Date.now();
        const completedAt = new Date(completedAtMs).toISOString();
        const latencyMs = completedAtMs - startedAtMs;

        // Select input preview source: last user message, fallback to last message
        const userMsg = [...req.messages].reverse().find((m) => m.role === 'user');
        const inputRaw = userMsg?.content ?? req.messages[req.messages.length - 1]?.content ?? '';
        const outputRaw = outputText;

        // Redact-then-truncate (SDK10/SDK13). Fail-closed: drop preview on any error.
        let inputPreview: string | undefined;
        let outputPreview: string | undefined;
        const allCounts: Record<string, number> = {};

        try {
          const { text, counts } = redactor.redact(inputRaw);
          inputPreview = text.slice(0, previewMaxChars);
          for (const [k, v] of Object.entries(counts)) {
            allCounts[k] = (allCounts[k] ?? 0) + v;
          }
        } catch {
          inputPreview = undefined;
        }

        try {
          const { text, counts } = redactor.redact(outputRaw);
          outputPreview = text.slice(0, previewMaxChars);
          for (const [k, v] of Object.entries(counts)) {
            allCounts[k] = (allCounts[k] ?? 0) + v;
          }
        } catch {
          outputPreview = undefined;
        }

        // Build preview (only include defined keys)
        const preview: { input?: string; output?: string } = {};
        if (inputPreview !== undefined) preview.input = inputPreview;
        if (outputPreview !== undefined) preview.output = outputPreview;

        // Build context (include only present/valid values)
        const ctx = opts?.context ?? {};
        const context: {
          conversationId?: string;
          messageId?: string;
          userId?: string;
        } = {};
        if (ctx.conversationId) context.conversationId = ctx.conversationId;
        if (ctx.messageId) context.messageId = ctx.messageId;
        if (ctx.userId) context.userId = ctx.userId;

        // Build metadata (caller metadata + instrumentation fields)
        const callerMetadata = ctx.metadata ?? {};
        const metadata: Record<string, unknown> = {
          ...callerMetadata,
          stream: true,
          redactions: allCounts,
        };
        if (req.temperature !== undefined) metadata['temperature'] = req.temperature;
        if (req.maxOutputTokens !== undefined) metadata['maxOutputTokens'] = req.maxOutputTokens;
        if (finishReason !== undefined) metadata['finishReason'] = finishReason;

        // Build candidate
        const candidate = {
          requestId,
          timestamp: completedAt,
          provider: provider.name,
          model: req.model,
          status,
          context,
          timing: {
            startedAt,
            completedAt,
            latencyMs,
            ...(ttftMs !== undefined ? { timeToFirstTokenMs: ttftMs } : {}),
          },
          usage: status === 'success' ? (usage ?? null) : null,
          preview,
          error: errorPayload,
          metadata,
        };

        // Validate and enqueue (never throw on the logging path — NFR5)
        const result = inferenceLogSchema.safeParse(candidate);
        if (result.success) {
          sink.enqueue(result.data);
        } else {
          console.warn('[llm-sdk] InferenceLog schema validation failed — dropping log', result.error.flatten());
        }
      }

      try {
        for await (const chunk of provider.streamChat(req, opts)) {
          // Capture TTFT on first delta, accumulate all deltas
          if (chunk.delta !== undefined) {
            if (ttftMs === undefined) ttftMs = Date.now() - startedAtMs;
            outputText += chunk.delta;
          }

          // Capture usage and finishReason when present
          if (chunk.usage !== undefined) usage = chunk.usage;
          if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;

          // Yield immediately — zero added latency (SDK10/NFR1)
          yield chunk;
        }

        // Normal completion
        ship();
      } catch (err: unknown) {
        const aborted = (err instanceof Error && err.name === 'AbortError') || opts?.signal?.aborted;
        if (aborted) {
          status = 'cancelled';
          errorPayload = null;
        } else {
          status = 'error';
          errorPayload = {
            code: 'provider_error',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        ship();
        throw err; // re-throw so caller's stream surfaces the failure
      }
    },
  };
}

// ---------------------------------------------------------------------------
// withLoggingTransport — convenience factory (Task 5)
// ---------------------------------------------------------------------------

/**
 * Convenience factory: constructs a BufferedHttpTransport from config,
 * wraps the provider with withLogging, and returns both so the app can
 * await transport.close() on graceful shutdown.
 */
export function withLoggingTransport(
  provider: LLMProvider,
  config: InferenceLoggerConfig,
): { provider: LLMProvider; transport: BufferedHttpTransport } {
  const transport = new BufferedHttpTransport({
    ingestionUrl: config.ingestionUrl,
    apiKey: config.apiKey,
    maxBufferSize: config.maxBufferSize,
    flushIntervalMs: config.flushIntervalMs,
    maxRetries: config.maxRetries,
  });
  return {
    provider: withLogging(provider, config, transport),
    transport,
  };
}
