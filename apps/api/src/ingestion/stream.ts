import { INGESTION_STREAM, PAYLOAD_FIELD } from '@ollive/shared';
import type { Redis } from '../redis.js';
import type { InferenceLog } from '@ollive/shared';

/**
 * Enqueues an InferenceLog onto the capped inference-logs Redis stream.
 * Uses approximate MAXLEN so Redis can trim in macro-node batches (cheap).
 * Returns the stream entry id.
 */
export async function xaddInferenceLog(
  redis: Redis,
  log: InferenceLog,
  maxLen: number,
): Promise<string> {
  const id = await redis.xadd(
    INGESTION_STREAM,
    'MAXLEN',
    '~',
    String(maxLen),
    '*',
    PAYLOAD_FIELD,
    JSON.stringify(log),
  );
  // With '*' as the id argument ioredis returns a non-null string.
  return id as string;
}
