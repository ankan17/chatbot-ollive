import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { runMigrations, createDb } from '@ollive/db';
import { createRedis } from '../src/redis.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import type { Redis } from 'ioredis';

const env = {
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://ollive:ollive@localhost:5432/ollive',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  INGESTION_API_KEY: 'test-key-health',
};

const config = loadConfig(env);
let app: Express;
let redis: Redis;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  await runMigrations(env.DATABASE_URL);
  db = createDb(env.DATABASE_URL);
  redis = createRedis(env.REDIS_URL);
  app = createApp({ db, redis, config });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

describe('GET /healthz', () => {
  it('returns 200 { status: "ok" }', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('returns 200 { db: "ok", redis: "ok" } when both deps reachable', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: 'ok', redis: 'ok' });
  });
});
