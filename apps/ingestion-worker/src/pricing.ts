import type { Usage } from '@ollive/shared';

/** USD per 1M tokens (public list prices, 2026-05 — NOT a billing source of truth, NG5). */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Per-model price table.
 * Prices are public list prices as of 2026-05 and are used only for approximate cost
 * estimation in the telemetry pipeline — this is informational only (NG5).
 * Extend by adding a row; unknown models → 0 cost.
 */
export const PRICE_TABLE: Record<string, ModelPrice> = {
  // Google Gemini
  'gemini-2.5-flash': { inputPerMillion: 0.30, outputPerMillion: 2.50 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  // OpenAI
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.0 },
};

/**
 * Estimates the cost in USD for a given model and usage.
 * Returns 0 if usage is null/undefined or the model is not in the price table.
 */
export function estimateCostUsd(model: string, usage: Usage | null | undefined): number {
  if (!usage) return 0;
  const price = PRICE_TABLE[model];
  if (!price) return 0;
  const cost =
    (usage.promptTokens / 1_000_000) * price.inputPerMillion +
    (usage.completionTokens / 1_000_000) * price.outputPerMillion;
  return cost;
}
