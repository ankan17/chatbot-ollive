import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { checkAndIncrementGuest, readGuestRemaining, guestKey } from '../src/guest/counter.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
let redis: InstanceType<typeof Redis>;

const LIMIT = 2;
const TTL = 60;

beforeAll(() => {
  // Use Redis db 1 for test isolation
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
});

afterAll(async () => {
  redis.disconnect();
});

afterEach(async () => {
  // Clean up any remaining test keys (pattern-based for safety)
  // We track keys per test and delete them individually
});

describe('checkAndIncrementGuest', () => {
  it('first call → allowed: true, remaining: 1; key has positive TTL', async () => {
    const id = randomUUID();
    try {
      const result = await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
      const ttl = await redis.ttl(guestKey(id));
      expect(ttl).toBeGreaterThan(0);
    } finally {
      await redis.del(guestKey(id));
    }
  });

  it('second call → allowed: true, remaining: 0', async () => {
    const id = randomUUID();
    try {
      await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      const result = await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    } finally {
      await redis.del(guestKey(id));
    }
  });

  it('third call (over cap) → allowed: false, remaining: 0', async () => {
    const id = randomUUID();
    try {
      await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      const result = await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    } finally {
      await redis.del(guestKey(id));
    }
  });
});

describe('readGuestRemaining', () => {
  it('after two increments → { remaining: 0, limit: 2 }', async () => {
    const id = randomUUID();
    try {
      await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      await checkAndIncrementGuest(redis, id, LIMIT, TTL);
      const result = await readGuestRemaining(redis, id, LIMIT);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(LIMIT);
    } finally {
      await redis.del(guestKey(id));
    }
  });

  it('after zero increments → { remaining: 2, limit: 2 } and does NOT create/mutate the key', async () => {
    const id = randomUUID();
    // Ensure key doesn't exist
    await redis.del(guestKey(id));
    const result = await readGuestRemaining(redis, id, LIMIT);
    expect(result.remaining).toBe(LIMIT);
    expect(result.limit).toBe(LIMIT);
    // Key should NOT exist (readGuestRemaining must not create it)
    const exists = await redis.exists(guestKey(id));
    expect(exists).toBe(0);
  });

  it('does not consume the trial (read-only)', async () => {
    const id = randomUUID();
    try {
      // Read several times, should not burn the trial
      await readGuestRemaining(redis, id, LIMIT);
      await readGuestRemaining(redis, id, LIMIT);
      await readGuestRemaining(redis, id, LIMIT);
      // Still has full remaining
      const result = await readGuestRemaining(redis, id, LIMIT);
      expect(result.remaining).toBe(LIMIT);
    } finally {
      await redis.del(guestKey(id));
    }
  });

  it('TTL: key has positive expiry close to ttlSeconds after first increment', async () => {
    const id = randomUUID();
    const ttlSeconds = 300;
    try {
      await checkAndIncrementGuest(redis, id, LIMIT, ttlSeconds);
      const ttl = await redis.ttl(guestKey(id));
      // TTL should be within 5 seconds of what we set
      expect(ttl).toBeGreaterThan(ttlSeconds - 5);
      expect(ttl).toBeLessThanOrEqual(ttlSeconds);
    } finally {
      await redis.del(guestKey(id));
    }
  });
});
