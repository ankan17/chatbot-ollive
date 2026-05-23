import type { Usage } from '@ollive/shared';

export interface CallContext {
  conversationId?: string;
  messageId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface StreamChunk {
  delta?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error' | 'cancelled';
}

export interface LLMProvider {
  readonly name: string; // "google" | "openai" | "anthropic"
  streamChat: (
    req: ChatRequest,
    opts?: { signal?: AbortSignal; context?: CallContext },
  ) => AsyncIterable<StreamChunk>;
}

/** Returns redacted text + counts of each PII type found (no values). */
export interface Redactor {
  redact: (text: string) => { text: string; counts: Record<string, number> };
}

export interface InferenceLoggerConfig {
  ingestionUrl: string;
  apiKey: string;
  previewMaxChars?: number; // default 500 (PREVIEW_MAX_CHARS from @ollive/shared)
  flushIntervalMs?: number; // default 1000
  maxBufferSize?: number;   // default 500
  maxRetries?: number;      // default 3
  redaction?: 'off' | 'pattern' | 'llm'; // default 'pattern'
  redactor?: Redactor;      // override the default implementation
}

export type { Usage };
