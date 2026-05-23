import type { ChatRequest } from '@ollive/llm-sdk';

export type ChatMessage = ChatRequest['messages'][number];

// Token headroom reserved for the model's response, subtracted from CONTEXT_TOKEN_BUDGET — A3/BE5
export const RESPONSE_RESERVE_TOKENS = 1024;

/**
 * Deterministic heuristic: ~4 chars per token (the standard approximation).
 * A 0-length string returns 0.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BuildContextResult {
  /** Chronological order, ready for ChatRequest.messages */
  messages: ChatMessage[];
  /** Sum of estimateTokens over the selected messages */
  contextTokens: number;
  /** messages.length — mirrors §16.1 metadata.contextMessages */
  contextMessageCount: number;
  /** How many older messages were trimmed */
  droppedCount: number;
}

/**
 * Build a context window for a chat request.
 *
 * Selects the most-recent messages from `history` whose cumulative token
 * estimate fits within `budget - reserveForResponse`, **always** including
 * the latest user turn (the last element) even if it alone exceeds the budget.
 *
 * @param history  Full chronological history including the latest user turn as the last element.
 * @param budget   CONTEXT_TOKEN_BUDGET config value.
 * @param reserveForResponse  Headroom to subtract from budget for the model's reply.
 */
export function buildContext(
  history: ChatMessage[],
  budget: number,
  reserveForResponse: number,
): BuildContextResult {
  if (history.length === 0) {
    return { messages: [], contextTokens: 0, contextMessageCount: 0, droppedCount: 0 };
  }

  const available = Math.max(budget - reserveForResponse, 0);

  // Walk from most-recent backwards, accumulating token estimates.
  const selected: ChatMessage[] = [];
  let running = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const tokens = estimateTokens(msg.content);

    if (selected.length === 0) {
      // Always include the latest (last) message regardless of budget.
      selected.push(msg);
      running += tokens;
    } else if (running + tokens <= available) {
      selected.push(msg);
      running += tokens;
    } else {
      // Would overflow — stop collecting older messages.
      break;
    }
  }

  // Restore chronological order.
  selected.reverse();

  return {
    messages: selected,
    contextTokens: running,
    contextMessageCount: selected.length,
    droppedCount: history.length - selected.length,
  };
}
