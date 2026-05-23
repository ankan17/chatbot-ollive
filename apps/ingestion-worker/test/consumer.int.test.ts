import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Redis from 'ioredis';
import { createDb, runMigrations, inferenceLogs } from '@ollive/db';
import { eq } from 'drizzle-orm';
import type { InferenceLog } from '@ollive/shared';
import { INGESTION_STREAM, INGESTION_DLQ, INGESTION_GROUP, PAYLOAD_FIELD } from '@ollive/shared';
import { ensureGroup, processBatch, reclaimStale } from '../src/consumer.js';
import { createCounters } from '../src/counters.js';
import type { Counters } from '../src/counters.js';
import type { ConsumerDeps } from '../src/consumer.js';
import { createLogger } from '../src/logger.js';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

let db: ReturnType<typeof createDb>;
let redis: Redis;

beforeAll(async () => {
  await runMigrations(databaseUrl);
  db = createDb(databaseUrl);
  // DB 0 = production; ingestion-worker integration tests use DB 2 to avoid cross-project
  // key collisions under Vitest parallelism (api tests use DB 1).
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null, db: 2 });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  // Clean up streams and DB table between tests
  await redis.del(INGESTION_STREAM);
  await redis.del(INGESTION_DLQ);
  await db.delete(inferenceLogs);
});

/** Builds a valid InferenceLog for testing. */
function makeLog(overrides: Partial<InferenceLog> = {}): InferenceLog {
  return {
    requestId: '10000000-0000-0000-0000-000000000001',
    timestamp: '2026-05-23T10:00:00.000Z',
    provider: 'google',
    model: 'gemini-2.5-flash',
    status: 'success',
    context: {
      conversationId: undefined,
      messageId: undefined,
      userId: undefined,
    },
    timing: {
      startedAt: '2026-05-23T10:00:00.000Z',
      completedAt: '2026-05-23T10:00:01.000Z',
      latencyMs: 1000,
      timeToFirstTokenMs: 200,
    },
    usage: {
      promptTokens: 420,
      completionTokens: 188,
      totalTokens: 608,
    },
    preview: {
      input: 'Hello world',
      output: 'Hi there',
    },
    error: null,
    metadata: {
      sdkVersion: '1.0.0',
      appName: 'test-suite',
      contextMessages: 2,
      redactions: 0,
    },
    ...overrides,
  };
}

/** Enqueues a log directly onto the stream (simulates the API receiver). */
async function enqueue(log: InferenceLog): Promise<string> {
  const id = await redis.xadd(INGESTION_STREAM, '*', PAYLOAD_FIELD, JSON.stringify(log));
  return id as string;
}

/** Builds a ConsumerDeps with fresh counters and a unique consumer name. */
function makeDeps(consumerName: string, counters: Counters): ConsumerDeps {
  return {
    redis,
    db,
    logger: createLogger(),
    counters,
    consumerName,
    batchSize: 10,
    blockMs: 100, // short block for tests
    maxDeliveries: 3,
    claimIdleMs: 30000,
  };
}

describe('consumer integration', () => {
  it('valid payload: processBatch returns 1, row written with correct fields, XPENDING=0', async () => {
    const log = makeLog();
    const counters = createCounters();
    const deps = makeDeps('test-consumer-1', counters);
    // ensureGroup must run BEFORE enqueue so the group sees the new entry
    await ensureGroup(redis, deps.logger);
    await enqueue(log);

    const count = await processBatch(deps);

    expect(count).toBe(1);
    expect(counters.processed).toBe(1);
    expect(counters.failed).toBe(0);
    expect(counters.dlq).toBe(0);

    // Row exists with correct fields
    const rows = await db.select().from(inferenceLogs).where(eq(inferenceLogs.requestId, log.requestId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.provider).toBe('google');
    expect(row.model).toBe('gemini-2.5-flash');
    expect(row.totalTokens).toBe(608);
    // estimatedCostUsd: 420/1e6*0.30 + 188/1e6*2.50 = 0.000596
    expect(row.estimatedCostUsd).toBe('0.000596');
    expect(row.errorCategory).toBeNull();
    // tokensPerSecond: 188 tokens / 1.0s = 188
    const meta = row.metadata as Record<string, unknown>;
    expect(meta['appName']).toBe('test-suite');
    expect(typeof meta['tokensPerSecond']).toBe('number');
    expect(meta['tokensPerSecond'] as number).toBeCloseTo(188, 0);

    // Entry was XACK'd — XPENDING count should be 0
    const pending = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pending).toHaveLength(0);
  });

  it('idempotency: same request_id processed twice → exactly one row', async () => {
    const log = makeLog({ requestId: '10000000-0000-0000-0000-000000000002' });

    const counters = createCounters();
    const deps = makeDeps('test-consumer-2', counters);
    await ensureGroup(redis, deps.logger);

    // First delivery (enqueue AFTER ensureGroup so group sees the entry)
    await enqueue(log);
    await processBatch(deps);

    // Second delivery (simulating at-least-once re-delivery)
    await enqueue(log);
    await processBatch(deps);

    const rows = await db.select().from(inferenceLogs).where(eq(inferenceLogs.requestId, log.requestId));
    expect(rows).toHaveLength(1); // exactly one row, not two
    expect(counters.processed).toBe(2); // processed twice (idempotent update)
  });

  it('error log: status=error, error_category=rate_limit, error_code set', async () => {
    const log = makeLog({
      requestId: '10000000-0000-0000-0000-000000000003',
      status: 'error',
      usage: null,
      error: { code: 'rate_limited', message: 'rate_limit_exceeded', providerCode: '429' },
    });
    const counters = createCounters();
    const deps = makeDeps('test-consumer-3', counters);
    await ensureGroup(redis, deps.logger);
    await enqueue(log);
    await processBatch(deps);

    const rows = await db.select().from(inferenceLogs).where(eq(inferenceLogs.requestId, log.requestId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('error');
    expect(row.errorCategory).toBe('rate_limit');
    expect(row.errorCode).toBe('rate_limited');
  });

  it('guest log: conversationId/userId null, guestSessionId in metadata', async () => {
    const log = makeLog({
      requestId: '10000000-0000-0000-0000-000000000004',
      context: {},
      metadata: {
        guestSessionId: 'guest-session-xyz',
        sdkVersion: '1.0.0',
        appName: 'chatbot',
      },
    });
    const counters = createCounters();
    const deps = makeDeps('test-consumer-4', counters);
    await ensureGroup(redis, deps.logger);
    await enqueue(log);
    await processBatch(deps);

    const rows = await db.select().from(inferenceLogs).where(eq(inferenceLogs.requestId, log.requestId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.conversationId).toBeNull();
    expect(row.userId).toBeNull();
    const meta = row.metadata as Record<string, unknown>;
    expect(meta['guestSessionId']).toBe('guest-session-xyz');
  });

  it('poison unparseable payload → counters.dlq=1, no row written, DLQ has 1 entry, source XPENDING=0', async () => {
    const counters = createCounters();
    const deps = makeDeps('test-consumer-5', counters);
    await ensureGroup(redis, deps.logger);
    // XADD directly with a non-JSON payload (bypasses the schema), AFTER ensureGroup
    await redis.xadd(INGESTION_STREAM, '*', PAYLOAD_FIELD, 'this-is-not-json{');
    await processBatch(deps);

    expect(counters.dlq).toBe(1);
    expect(counters.processed).toBe(0);

    // No row written
    const rows = await db.select().from(inferenceLogs);
    expect(rows).toHaveLength(0);

    // DLQ has exactly 1 entry
    const dlqLen = await redis.xlen(INGESTION_DLQ);
    expect(dlqLen).toBe(1);

    // Source entry was XACK'd (left PEL)
    const pending = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pending).toHaveLength(0);
  });

  it('schema-invalid payload (valid JSON, wrong shape) → counters.dlq=1, DLQ length 1', async () => {
    const counters = createCounters();
    const deps = makeDeps('test-consumer-6', counters);
    await ensureGroup(redis, deps.logger);
    const invalidPayload = JSON.stringify({ this_is: 'not a valid InferenceLog', at_all: true });
    await redis.xadd(INGESTION_STREAM, '*', PAYLOAD_FIELD, invalidPayload);
    await processBatch(deps);

    expect(counters.dlq).toBe(1);
    expect(counters.processed).toBe(0);

    const dlqLen = await redis.xlen(INGESTION_DLQ);
    expect(dlqLen).toBe(1);
  });

  // IN5 — XAUTOCLAIM / reclaimStale: crashed-consumer recovery path.
  // Approach: XADD a valid entry; read it into the PEL with a DIFFERENT consumer name via
  // XREADGROUP (simulating a crash before ACK); then call reclaimStale with claimIdleMs=0
  // so all pending entries are immediately reclaimable. Assert the entry is processed,
  // the DB row exists, and the PEL is drained.
  it('reclaimStale: pending entry from a crashed consumer is reclaimed, processed, and PEL drained', async () => {
    const log = makeLog({ requestId: '10000000-0000-0000-0000-000000000007' });
    const counters = createCounters();
    const logger = createLogger();

    // ensureGroup before enqueue so the group sees the new entry
    await ensureGroup(redis, logger);

    // XADD a valid entry
    await enqueue(log);

    // Read it into the PEL under a DIFFERENT consumer ("crashed-consumer"), but do NOT ack it.
    // This simulates a consumer crash mid-processing.
    await redis.xreadgroup(
      'GROUP', INGESTION_GROUP, 'crashed-consumer',
      'COUNT', '1',
      'STREAMS', INGESTION_STREAM,
      '>',
    );

    // Verify it is now pending under 'crashed-consumer'
    const pendingBefore = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pendingBefore).toHaveLength(1);

    // Build deps for the reclaiming consumer with claimIdleMs=0 (all pending entries reclaimable)
    const reclaimDeps = {
      redis,
      db,
      logger,
      counters,
      consumerName: 'reclaim-consumer',
      batchSize: 10,
      blockMs: 100,
      maxDeliveries: 3,
      // claimIdleMs=0 forces all pending entries to be immediately reclaimable regardless of idle time
      claimIdleMs: 0,
    };

    const reclaimed = await reclaimStale(reclaimDeps);

    expect(reclaimed).toBe(1);
    expect(counters.processed).toBe(1);
    expect(counters.dlq).toBe(0);

    // Row should be written to the DB
    const rows = await db.select().from(inferenceLogs).where(eq(inferenceLogs.requestId, log.requestId));
    expect(rows).toHaveLength(1);

    // PEL should be fully drained (entry was ACKed after successful processing)
    const pendingAfter = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pendingAfter).toHaveLength(0);
  });

  // IN5 — reclaimStale poison path: a pending entry with an invalid payload passed to reclaimStale
  // (deliveries=maxDeliveries) is immediately routed to the DLQ without further retry.
  it('reclaimStale: pending poison payload is routed to DLQ and PEL drained', async () => {
    const logger = createLogger();
    await ensureGroup(redis, logger);

    // XADD a non-JSON entry directly
    await redis.xadd(INGESTION_STREAM, '*', PAYLOAD_FIELD, 'not-valid-json{');

    // Read it into the PEL under 'crashed-consumer-2' without ACKing
    await redis.xreadgroup(
      'GROUP', INGESTION_GROUP, 'crashed-consumer-2',
      'COUNT', '1',
      'STREAMS', INGESTION_STREAM,
      '>',
    );

    const pendingBefore = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pendingBefore).toHaveLength(1);

    const counters = createCounters();
    const reclaimDeps = {
      redis,
      db,
      logger,
      counters,
      consumerName: 'reclaim-consumer-2',
      batchSize: 10,
      blockMs: 100,
      maxDeliveries: 3,
      claimIdleMs: 0,
    };

    const reclaimed = await reclaimStale(reclaimDeps);

    expect(reclaimed).toBe(1);
    // poison payload → DLQ, not processed
    expect(counters.dlq).toBe(1);
    expect(counters.processed).toBe(0);

    // Entry is in the DLQ
    const dlqLen = await redis.xlen(INGESTION_DLQ);
    expect(dlqLen).toBe(1);

    // PEL is drained
    const pendingAfter = await redis.xpending(INGESTION_STREAM, INGESTION_GROUP, '-', '+', 10);
    expect(pendingAfter).toHaveLength(0);
  });
});
