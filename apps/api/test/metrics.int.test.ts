import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  runMigrations,
  createDb,
  users as usersTable,
  inferenceLogs as inferenceLogsTable,
} from '@ollive/db';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createUserRepository } from '../src/users/repository.js';
import { signSession } from '../src/auth/jwt.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-metrics-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;
let app: ReturnType<typeof createApp>;
let userId: string;
let cookie: string;

async function sessionCookieFor(uid: string, email: string): Promise<string> {
  const token = await signSession({ sub: uid, email }, config.jwtSecret);
  return `session=${token}`;
}

/**
 * Insert inference log rows with given created_at timestamps.
 */
async function seedLogs(
  rows: Array<{
    userId?: string;
    status?: 'success' | 'error' | 'cancelled';
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
    createdAt: Date;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db.insert(inferenceLogsTable).values({
      requestId: randomUUID(),
      userId: row.userId ?? userId,
      provider: row.provider ?? 'google',
      model: row.model ?? 'gemini-2.5-flash',
      status: row.status ?? 'success',
      latencyMs: row.latencyMs ?? null,
      promptTokens: row.promptTokens ?? null,
      completionTokens: row.completionTokens ?? null,
      totalTokens: row.totalTokens ?? null,
      createdAt: row.createdAt,
    });
  }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
  app = createApp({ db, redis, config });

  // Create a test user
  const userRepo = createUserRepository(db);
  const user = await userRepo.upsertByGoogleSub({ googleSub: 'metrics-test-sub', email: 'metrics-test@test.com' });
  userId = user.id;
  cookie = await sessionCookieFor(userId, 'metrics-test@test.com');
});

afterAll(async () => {
  await db.delete(usersTable);
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  await db.delete(inferenceLogsTable);
});

// Fixed time range for tests: 2026-01-01 00:00:00Z to 2026-01-01 01:00:00Z
const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-01-01T01:00:00.000Z';

describe('GET /v1/metrics/overview', () => {
  it('aggregates counts, error rate, tokens, latency, throughput for seeded rows', async () => {
    const t1 = new Date('2026-01-01T00:05:00.000Z');
    const t2 = new Date('2026-01-01T00:10:00.000Z');
    const t3 = new Date('2026-01-01T00:15:00.000Z');

    await seedLogs([
      { createdAt: t1, status: 'success', latencyMs: 100, promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { createdAt: t2, status: 'error', latencyMs: 200, promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      { createdAt: t3, status: 'success', latencyMs: 300, promptTokens: 300, completionTokens: 150, totalTokens: 450 },
    ]);

    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.requests).toBe(3);
    expect(res.body.errorRate).toBeCloseTo(1 / 3, 2);
    expect(res.body.latencyMs.p50).toBeGreaterThan(0);
    expect(res.body.latencyMs.p95).toBeGreaterThan(0);
    expect(res.body.tokens.prompt).toBe(600);
    expect(res.body.tokens.completion).toBe(300);
    expect(res.body.tokens.total).toBe(900);
    expect(res.body.throughputPerMin).toBeGreaterThan(0);
    expect(res.body.range.from).toBe(FROM);
    expect(res.body.range.to).toBe(TO);
  });

  it('user scoping (SE8): only returns rows for authenticated user', async () => {
    const userRepo = createUserRepository(db);
    const user2 = await userRepo.upsertByGoogleSub({ googleSub: 'metrics-other-sub', email: 'metrics-other@test.com' });

    const t1 = new Date('2026-01-01T00:05:00.000Z');
    await seedLogs([
      { createdAt: t1, status: 'success', latencyMs: 100, userId },
      { createdAt: t1, status: 'success', latencyMs: 200, userId: user2.id },
      { createdAt: t1, status: 'success', latencyMs: 300, userId: user2.id },
    ]);

    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    // Only 1 row belongs to the authed user
    expect(res.body.requests).toBe(1);
  });

  it('provider filter excludes other providers', async () => {
    const t1 = new Date('2026-01-01T00:05:00.000Z');
    await seedLogs([
      { createdAt: t1, status: 'success', provider: 'google' },
      { createdAt: t1, status: 'success', provider: 'openai' },
    ]);

    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, provider: 'google' });

    expect(res.status).toBe(200);
    expect(res.body.requests).toBe(1);
  });

  it('model filter excludes other models', async () => {
    const t1 = new Date('2026-01-01T00:05:00.000Z');
    await seedLogs([
      { createdAt: t1, status: 'success', model: 'gemini-2.5-flash' },
      { createdAt: t1, status: 'success', model: 'gpt-4' },
    ]);

    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, model: 'gemini-2.5-flash' });

    expect(res.status).toBe(200);
    expect(res.body.requests).toBe(1);
  });

  it('time-range filter excludes rows outside [from,to)', async () => {
    const inside = new Date('2026-01-01T00:30:00.000Z');
    const outside = new Date('2026-01-01T02:00:00.000Z'); // past TO

    await seedLogs([
      { createdAt: inside, status: 'success' },
      { createdAt: outside, status: 'success' },
    ]);

    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.requests).toBe(1);
  });

  it('empty range → requests:0, errorRate:0, latency:0, tokens:0', async () => {
    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.requests).toBe(0);
    expect(res.body.errorRate).toBe(0);
    expect(res.body.latencyMs.p50).toBe(0);
    expect(res.body.latencyMs.p95).toBe(0);
    expect(res.body.latencyMs.p99).toBe(0);
    expect(res.body.tokens.prompt).toBe(0);
    expect(res.body.tokens.completion).toBe(0);
    expect(res.body.tokens.total).toBe(0);
  });

  it('invalid query: from > to → 400 validation_error', async () => {
    const res = await request(app)
      .get('/v1/metrics/overview')
      .set('Cookie', cookie)
      .query({ from: TO, to: FROM }); // reversed

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('unauthenticated → 401 unauthorized', async () => {
    const res = await request(app)
      .get('/v1/metrics/overview')
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('GET /v1/metrics/latency', () => {
  it('returns per-bucket latency series with p50/p95/p99/count ordered by t asc', async () => {
    // Two rows in different minutes
    const t1 = new Date('2026-01-01T00:01:00.000Z');
    const t2 = new Date('2026-01-01T00:02:00.000Z');
    await seedLogs([
      { createdAt: t1, latencyMs: 100 },
      { createdAt: t2, latencyMs: 200 },
    ]);

    const res = await request(app)
      .get('/v1/metrics/latency')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, bucket: '1m' });

    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe('1m');
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(res.body.series.length).toBeGreaterThan(0);

    const point = res.body.series[0];
    expect(typeof point.t).toBe('string');
    expect(typeof point.p50).toBe('number');
    expect(typeof point.p95).toBe('number');
    expect(typeof point.p99).toBe('number');
    expect(typeof point.count).toBe('number');

    // Assert ordered by t asc
    const times = res.body.series.map((p: { t: string }) => new Date(p.t).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('empty range → empty series', async () => {
    const res = await request(app)
      .get('/v1/metrics/latency')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, bucket: '1m' });

    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });
});

describe('GET /v1/metrics/throughput', () => {
  it('returns per-bucket throughput with {t,count}', async () => {
    const t1 = new Date('2026-01-01T00:01:00.000Z');
    await seedLogs([
      { createdAt: t1 },
      { createdAt: t1 },
    ]);

    const res = await request(app)
      .get('/v1/metrics/throughput')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, bucket: '1m' });

    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe('1m');
    expect(Array.isArray(res.body.series)).toBe(true);

    const point = res.body.series[0];
    expect(typeof point.t).toBe('string');
    expect(typeof point.count).toBe('number');
    // Exactly the keys {t, count} present
    expect(Object.keys(point).sort()).toEqual(['count', 't']);
    expect(point.count).toBe(2);
  });

  it('empty range → empty series', async () => {
    const res = await request(app)
      .get('/v1/metrics/throughput')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });
});

describe('GET /v1/metrics/errors', () => {
  it('returns per-bucket error series with {t,count,errorCount,errorRate}', async () => {
    const t1 = new Date('2026-01-01T00:01:00.000Z');
    await seedLogs([
      { createdAt: t1, status: 'success' },
      { createdAt: t1, status: 'error' },
    ]);

    const res = await request(app)
      .get('/v1/metrics/errors')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, bucket: '1m' });

    expect(res.status).toBe(200);
    const point = res.body.series[0];
    expect(Object.keys(point).sort()).toEqual(['count', 'errorCount', 'errorRate', 't']);
    expect(point.count).toBe(2);
    expect(point.errorCount).toBe(1);
    expect(point.errorRate).toBeCloseTo(0.5, 5);
  });

  it('errorRate = 0 when count = 0 (empty bucket) — no divide-by-zero', async () => {
    const res = await request(app)
      .get('/v1/metrics/errors')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });
});

describe('GET /v1/metrics/tokens', () => {
  it('returns per-bucket token series with {t,promptTokens,completionTokens,totalTokens}', async () => {
    const t1 = new Date('2026-01-01T00:01:00.000Z');
    await seedLogs([
      { createdAt: t1, promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      { createdAt: t1, promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    ]);

    const res = await request(app)
      .get('/v1/metrics/tokens')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO, bucket: '1m' });

    expect(res.status).toBe(200);
    const point = res.body.series[0];
    expect(Object.keys(point).sort()).toEqual(['completionTokens', 'promptTokens', 't', 'totalTokens']);
    expect(point.promptTokens).toBe(300);
    expect(point.completionTokens).toBe(150);
    expect(point.totalTokens).toBe(450);
  });

  it('empty range → empty series', async () => {
    const res = await request(app)
      .get('/v1/metrics/tokens')
      .set('Cookie', cookie)
      .query({ from: FROM, to: TO });

    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });
});
