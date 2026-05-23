// Task 1: provider abstraction types
export type {
  CallContext,
  ChatRequest,
  StreamChunk,
  LLMProvider,
  Redactor,
  InferenceLoggerConfig,
  Usage,
} from './types.js';

// Task 2: PII redactors
export { PatternRedactor, NoopRedactor, LlmRedactor, createRedactor } from './redaction/redactor.js';

// Task 3: providers + registry
export { GoogleProvider, googleProviderFactory } from './providers/google.js';
export { ProviderRegistry } from './registry.js';
export type { ProviderFactory } from './registry.js';

// Task 4: withLogging decorator + LogSink seam
export { withLogging } from './logging/logger.js';
export type { LogSink } from './logging/logger.js';
