// Re-export all DTO types from @ollive/shared/api
// The SPA imports from here — never redefines contract shapes.
export type {
  SessionResponse,
  SessionUser,
  AuthUser,
  MeResponse,
  ConversationSummary,
  Conversation,
  ConversationDetail,
  Message,
  ConversationListPage,
  SseEvent,
  SseStartData,
  SseTokenData,
  SseDoneData,
  SseErrorData,
  SseTitleData,
  Usage,
  OverviewMetrics,
  MetricsRange,
  MetricsBucket,
  LatencyPoint,
  ThroughputPoint,
  ErrorPoint,
  TokenPoint,
  LatencySeries,
  ThroughputSeries,
  ErrorSeries,
  TokenSeries,
  AppErrorCode,
  ApiErrorBody,
  LoginRequiredBody,
  ModelInfo,
  ModelsResponse,
} from '@ollive/shared/api';

// Convenience aliases
export type { Message as ChatMessage, ConversationDetail as ConversationWithMessages } from '@ollive/shared/api';

// Client-only shapes (no contract equivalent)
export interface GuestMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

import type { MetricsBucket } from '@ollive/shared/api';
export interface MetricFilters {
  from: string;
  to: string;
  provider?: string;
  model?: string;
  bucket?: MetricsBucket;
}
