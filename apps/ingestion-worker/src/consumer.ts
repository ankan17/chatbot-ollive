import Redis from 'ioredis';
import { inferenceLogSchema, INGESTION_STREAM, INGESTION_DLQ, INGESTION_GROUP, PAYLOAD_FIELD } from '@ollive/shared';
import type { Db } from '@ollive/db';
import type { Logger } from './logger.js';
import type { Counters } from './counters.js';
import { extractMetadata } from './extract.js';
import { upsertInferenceLog } from './upsert.js';

/** ioredis flat field/value pair array for a single stream entry */
type StreamEntry = [id: string, fields: string[]];

export interface ConsumerDeps {
  redis: Redis;
  db: Db;
  logger: Logger;
  counters: Counters;
  consumerName: string;
  batchSize: number;
  blockMs: number;
  maxDeliveries: number;
  claimIdleMs: number;
}

/**
 * Reads the `payload` field from the flat ioredis field/value array.
 * ioredis returns stream entry fields as [field1, value1, field2, value2, ...].
 */
function readPayload(fields: string[]): string | null {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === PAYLOAD_FIELD) {
      return fields[i + 1] ?? null;
    }
  }
  return null;
}

/**
 * Routes a problem entry to the DLQ stream, then ACKs it from the main PEL
 * so the pipeline never wedges (§18 / IN5).
 */
async function routeToDlq(
  deps: ConsumerDeps,
  id: string,
  rawPayload: string | null,
  reason: string,
  deliveries: number,
): Promise<void> {
  try {
    await deps.redis.xadd(
      INGESTION_DLQ,
      '*',
      'payload', rawPayload ?? '',
      'reason', reason,
      'deliveries', String(deliveries),
      'sourceId', id,
    );
  } catch (err) {
    deps.logger.error({ err, id, reason }, 'Failed to route entry to DLQ');
  }
  // Always ack so the entry leaves the PEL
  await deps.redis.xack(INGESTION_STREAM, INGESTION_GROUP, id);
  deps.counters.dlq++;
}

/**
 * Processes a single stream entry.
 * - Dead-on-arrival (parse/schema error) → DLQ immediately
 * - Transient DB error → leave unacked (stays in PEL for reclaimStale) unless deliveries >= maxDeliveries
 * - Success → upsert → XACK → counters.processed++
 */
async function processEntry(
  deps: ConsumerDeps,
  entry: StreamEntry,
  deliveries: number,
): Promise<void> {
  const [id, fields] = entry;
  const rawPayload = readPayload(fields);

  // --- dead-on-arrival: missing payload field ---
  if (rawPayload == null) {
    deps.logger.warn({ id }, 'Stream entry missing payload field; routing to DLQ');
    await routeToDlq(deps, id, null, 'missing_payload_field', deliveries);
    return;
  }

  // --- dead-on-arrival: unparseable JSON ---
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    deps.logger.warn({ id }, 'Stream entry payload is not valid JSON; routing to DLQ');
    await routeToDlq(deps, id, rawPayload, 'invalid_json', deliveries);
    return;
  }

  // --- dead-on-arrival: schema validation failure ---
  const result = inferenceLogSchema.safeParse(parsed);
  if (!result.success) {
    deps.logger.warn({ id, issues: result.error.issues }, 'Payload fails schema validation; routing to DLQ');
    await routeToDlq(deps, id, rawPayload, 'schema_validation_failed', deliveries);
    return;
  }

  // --- happy path ---
  try {
    const row = extractMetadata(result.data);
    await upsertInferenceLog(deps.db, row);
    await deps.redis.xack(INGESTION_STREAM, INGESTION_GROUP, id);
    deps.counters.processed++;
  } catch (err) {
    deps.counters.failed++;
    deps.logger.error({ err, id }, 'Transient error processing stream entry');
    if (deliveries >= deps.maxDeliveries) {
      deps.logger.warn({ id, deliveries }, 'Max deliveries exceeded; routing to DLQ');
      await routeToDlq(deps, id, rawPayload, 'exhausted_retries', deliveries);
    }
    // Otherwise leave unacked — stays in PEL for reclaimStale to retry
  }
}

/**
 * Creates the consumer group `ingestion-workers` on the `inference-logs` stream.
 * Uses MKSTREAM so the stream is created if it does not yet exist.
 * Swallows BUSYGROUP (group already exists); rethrows anything else.
 * Safe to call on every boot (idempotent).
 */
export async function ensureGroup(redis: Redis, logger: Logger): Promise<void> {
  try {
    await redis.xgroup('CREATE', INGESTION_STREAM, INGESTION_GROUP, '$', 'MKSTREAM');
    logger.info({ stream: INGESTION_STREAM, group: INGESTION_GROUP }, 'Consumer group created');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('BUSYGROUP')) {
      logger.debug({ stream: INGESTION_STREAM, group: INGESTION_GROUP }, 'Consumer group already exists');
      return;
    }
    throw err;
  }
}

/**
 * Reads a batch of new entries from the stream via XREADGROUP and processes each.
 * Returns the number of entries read (0 = block timed out with no new entries).
 */
export async function processBatch(deps: ConsumerDeps): Promise<number> {
  // XREADGROUP GROUP <group> <consumer> COUNT <n> BLOCK <ms> STREAMS <stream> '>'
  const response = await deps.redis.xreadgroup(
    'GROUP', INGESTION_GROUP, deps.consumerName,
    'COUNT', String(deps.batchSize),
    'BLOCK', String(deps.blockMs),
    'STREAMS', INGESTION_STREAM,
    '>',
  ) as Array<[stream: string, entries: StreamEntry[]]> | null;

  if (!response || response.length === 0) return 0;

  const streamData = response[0];
  if (!streamData) return 0;
  const [, entries] = streamData;
  if (!entries || entries.length === 0) return 0;

  for (const entry of entries) {
    await processEntry(deps, entry, 1);
  }

  return entries.length;
}

/**
 * Uses XAUTOCLAIM to reclaim entries that have been idle (unacked) beyond claimIdleMs.
 * These belong to crashed or stalled consumers. Processes reclaimed entries with
 * deliveries=maxDeliveries so a still-failing entry is immediately routed to the DLQ.
 * Returns the number of entries reclaimed.
 */
export async function reclaimStale(deps: ConsumerDeps): Promise<number> {
  // XAUTOCLAIM <stream> <group> <consumer> <min-idle-ms> <start-id> COUNT <n>
  const response = await deps.redis.xautoclaim(
    INGESTION_STREAM,
    INGESTION_GROUP,
    deps.consumerName,
    deps.claimIdleMs,
    '0-0',
    'COUNT', String(deps.batchSize),
  ) as [nextId: string, entries: StreamEntry[], deletedIds: string[]] | null;

  if (!response) return 0;

  const entries = response[1];
  if (!entries || entries.length === 0) return 0;

  for (const entry of entries) {
    await processEntry(deps, entry, deps.maxDeliveries);
  }

  return entries.length;
}
