import { inferenceLogs } from '@ollive/db';
import type { Db } from '@ollive/db';
import type { InferenceLogRow } from './extract.js';

/**
 * Idempotent upsert: inserts a new row into inference_logs, or updates all mutable
 * columns on a request_id conflict. created_at is left to its DB default and is NOT
 * overwritten on conflict — only the mutable telemetry fields are.
 *
 * This is the at-least-once dedup anchor (IN4/AC8): re-delivering the same
 * request_id must not create a duplicate row.
 */
export async function upsertInferenceLog(db: Db, row: InferenceLogRow): Promise<void> {
  const values = {
    requestId: row.requestId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    userId: row.userId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    latencyMs: row.latencyMs,
    timeToFirstTokenMs: row.timeToFirstTokenMs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    inputPreview: row.inputPreview,
    outputPreview: row.outputPreview,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    estimatedCostUsd: row.estimatedCostUsd,
    errorCategory: row.errorCategory,
    metadata: row.metadata,
  };

  await db
    .insert(inferenceLogs)
    .values(values)
    .onConflictDoUpdate({
      target: inferenceLogs.requestId,
      set: {
        conversationId: values.conversationId,
        messageId: values.messageId,
        userId: values.userId,
        provider: values.provider,
        model: values.model,
        status: values.status,
        latencyMs: values.latencyMs,
        timeToFirstTokenMs: values.timeToFirstTokenMs,
        promptTokens: values.promptTokens,
        completionTokens: values.completionTokens,
        totalTokens: values.totalTokens,
        inputPreview: values.inputPreview,
        outputPreview: values.outputPreview,
        errorCode: values.errorCode,
        errorMessage: values.errorMessage,
        startedAt: values.startedAt,
        completedAt: values.completedAt,
        estimatedCostUsd: values.estimatedCostUsd,
        errorCategory: values.errorCategory,
        metadata: values.metadata,
        // NOTE: requestId and createdAt are NOT in the conflict set
        // requestId is the conflict target; createdAt keeps its original value
      },
    });
}
