import type { StreamChunk } from '../types.js';

export interface AnyUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalTokens?: number | undefined;
}

/**
 * Normalizes provider/SDK-version token-usage differences.
 * ai@5.x uses inputTokens/outputTokens; ai@4.x used promptTokens/completionTokens.
 * Reads both spellings defensively; missing values coerce to 0.
 */
export function normalizeUsage(u: AnyUsage): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const promptTokens = u.inputTokens ?? u.promptTokens ?? 0;
  const completionTokens = u.outputTokens ?? u.completionTokens ?? 0;
  const totalTokens = u.totalTokens ?? (promptTokens + completionTokens);
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Normalizes finish reasons from the provider into our StreamChunk union.
 */
export function normalizeFinishReason(r: string | undefined): StreamChunk['finishReason'] {
  switch (r) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content-filter':
    case 'content_filter': return 'content_filter';
    case 'error': return 'error';
    case 'cancelled': return 'cancelled';
    default: return 'stop';
  }
}
