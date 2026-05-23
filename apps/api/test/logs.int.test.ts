import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import Redis from 'ioredis';
import { loadConfig } from '../src/config.js';
import { createDb } from '@ollive/db';
import { INGESTION_STREAM } from '@ollive/shared';

const TEST_API_KEY = 'test-ingestion-key';

const env = {
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  INGESTION_API_KEY: TEST_API_KEY,
};

const config = loadConfig(env);
let app: Express;
// DB 0 = production; api integration tests use DB 1 to avoid cross-project key collisions
// under Vitest parallelism (ingestion-worker uses DB 2).
let redis: InstanceType<typeof Redis>;

function makeValidLog() {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    provider: 'google',
    model: 'gemini-2.5-flash',
    status: 'success',
    context: {},
    timing: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      latencyMs: 500,
    },
    usage: { promptTokens: 420, completionTokens: 188, totalTokens: 608 },
    preview: {
      input: 'My email is pii@example.com',
      output: 'Hello world',
    },
    error: null,
    metadata: { appName: 'testapp', sdkVersion: '1.0.0' },
  };
}

beforeAll(() => {
  const db = createDb(env.DATABASE_URL);
  redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
  app = createApp({ db, redis, config });
});

afterAll(async () => {
  redis.disconnect();
});

afterEach(async () => {
  // Clean up the stream after each test
  try {
    await redis.del(INGESTION_STREAM);
  } catch {
    // ignore
  }
});

describe('POST /v1/logs', () => {
  it('no auth → 401 unauthorized, nothing enqueued', async () => {
    const res = await request(app).post('/v1/logs').send(makeValidLog());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
    const len = await redis.xlen(INGESTION_STREAM);
    expect(len).toBe(0);
  });

  it('wrong Bearer key → 401 unauthorized, nothing enqueued', async () => {
    const res = await request(app)
      .post('/v1/logs')
      .set('Authorization', 'Bearer wrong-key')
      .send(makeValidLog());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
    const len = await redis.xlen(INGESTION_STREAM);
    expect(len).toBe(0);
  });

  it('valid key but malformed body → 400 validation_error with details array, nothing enqueued', async () => {
    const res = await request(app)
      .post('/v1/logs')
      .set('Authorization', `Bearer ${TEST_API_KEY}`)
      .send({ notALog: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(Array.isArray(res.body.details)).toBe(true);
    const len = await redis.xlen(INGESTION_STREAM);
    expect(len).toBe(0);
  });

  it('valid key + valid log → 202, one entry on stream with right payload and redacted preview', async () => {
    const log = makeValidLog();
    const res = await request(app)
      .post('/v1/logs')
      .set('Authorization', `Bearer ${TEST_API_KEY}`)
      .send(log);

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(typeof res.body.requestId).toBe('string');

    // Exactly one entry on the stream
    const len = await redis.xlen(INGESTION_STREAM);
    expect(len).toBe(1);

    // Read the entry and verify payload
    const entries = await redis.xrange(INGESTION_STREAM, '-', '+');
    expect(entries).toHaveLength(1);
    const fields = entries[0]![1];
    // fields are [field, value, ...]
    const payloadIndex = fields.indexOf('payload');
    expect(payloadIndex).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(fields[payloadIndex + 1]!);

    // Correct requestId
    expect(payload.requestId).toBe(log.requestId);

    // IN9: email redacted before enqueue
    expect(payload.preview.input).toContain('[EMAIL]');
    expect(payload.preview.input).not.toContain('pii@example.com');
  });
});

describe('unknown route', () => {
  it('returns 404 { error: "not_found" }', async () => {
    const res = await request(app).get('/unknown/route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'not_found' });
  });
});
