import type { InferenceLog } from '@ollive/shared';
import type { ErrorCategory } from '@ollive/shared';
import { estimateCostUsd } from './pricing.js';
import { categorizeError } from './error-category.js';

export interface InferenceLogRow {
  requestId: string;
  conversationId: string | null;
  messageId: string | null;
  userId: string | null;
  provider: string;
  model: string;
  status: InferenceLog['status'];
  latencyMs: number | null;
  timeToFirstTokenMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  inputPreview: string | null;
  outputPreview: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** 6-dp string for NUMERIC(12,6) — postgres.js sends NUMERIC as text */
  estimatedCostUsd: string;
  errorCategory: ErrorCategory | null;
  /** Derived-signal JSONB per §16.1 */
  metadata: Record<string, unknown>;
}

/**
 * Extracts and derives all inference_logs column values from a validated InferenceLog.
 * Pure function: same input → same output, no I/O.
 */
export function extractMetadata(log: InferenceLog): InferenceLogRow {
  const usage = log.usage ?? null;
  const meta = log.metadata ?? {};

  // --- token columns ---
  const promptTokens = usage?.promptTokens ?? null;
  const completionTokens = usage?.completionTokens ?? null;
  const totalTokens = usage?.totalTokens ?? null;

  // --- timing ---
  const latencyMs = log.timing.latencyMs ?? null;
  const timeToFirstTokenMs = log.timing.timeToFirstTokenMs ?? null;
  const startedAt = log.timing.startedAt ? new Date(log.timing.startedAt) : null;
  const completedAt = log.timing.completedAt ? new Date(log.timing.completedAt) : null;

  // --- previews ---
  const inputPreview = log.preview?.input ?? null;
  const outputPreview = log.preview?.output ?? null;

  // --- error fields ---
  const errorCode = log.error?.code ?? null;
  const errorMessage = log.error?.message ?? null;
  const errorCategory = categorizeError(log.error ?? null);

  // --- cost ---
  const estimatedCostUsd = estimateCostUsd(log.model, usage).toFixed(6);

  // --- derived metadata JSONB ---
  // tokensPerSecond: guard zero latency (no NaN/Infinity)
  const tokensPerSecond =
    latencyMs != null && latencyMs > 0 && completionTokens != null
      ? completionTokens / (latencyMs / 1000)
      : 0;

  const promptChars = inputPreview != null ? inputPreview.length : null;
  const outputChars = outputPreview != null ? outputPreview.length : null;

  // contextMessageCount from various metadata key names
  const contextMessageCount =
    (meta['contextMessages'] as number | undefined) ??
    (meta['contextMessageCount'] as number | undefined) ??
    0;

  const derivedMetadata: Record<string, unknown> = {
    tokensPerSecond,
    promptChars,
    outputChars,
    contextMessageCount,
    redactions: meta['redactions'] ?? null,
    sdkVersion: meta['sdkVersion'] ?? null,
    appName: meta['appName'] ?? null,
    guestSessionId: meta['guestSessionId'] ?? null,
  };

  return {
    requestId: log.requestId,
    conversationId: log.context?.conversationId ?? null,
    messageId: log.context?.messageId ?? null,
    userId: log.context?.userId ?? null,
    provider: log.provider,
    model: log.model,
    status: log.status,
    latencyMs,
    timeToFirstTokenMs,
    promptTokens,
    completionTokens,
    totalTokens,
    inputPreview,
    outputPreview,
    errorCode,
    errorMessage,
    startedAt,
    completedAt,
    estimatedCostUsd,
    errorCategory,
    metadata: derivedMetadata,
  };
}
