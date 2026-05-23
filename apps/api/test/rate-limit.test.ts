/**
 * Unit tests for the in-memory rate limiter (middleware/rate-limit.ts).
 *
 * I6: verify that after the window elapses the limiter resets and allows requests again.
 * Uses fake timers so the test is instant and deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ipRateLimit } from '../src/middleware/rate-limit.js';

// Minimal mock helpers
function makeReq(ip = '1.2.3.4'): Request {
  return { ip } as unknown as Request;
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; _status?: number } {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  return res;
}

describe('ipRateLimit — window reset (I6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests over the limit receive 429; after the window resets they are allowed again', () => {
    const WINDOW_MS = 1000; // 1 second (fake)
    const MAX = 2;

    const middleware = ipRateLimit({ windowMs: WINDOW_MS, max: MAX });
    const req = makeReq();
    const next = vi.fn();

    // Consume the full allowance
    for (let i = 0; i < MAX; i++) {
      const res = makeRes();
      middleware(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(i + 1);
    }

    // Next request is over the limit → 429
    const blockedRes = makeRes();
    middleware(req, blockedRes as unknown as Response, next as NextFunction);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.json).toHaveBeenCalledWith({ error: 'rate_limited' });
    // next() should not have been called for the blocked request
    expect(next).toHaveBeenCalledTimes(MAX);

    // Advance fake time past one full window — this also fires the setInterval prune,
    // which removes the stale entry from the store.
    vi.advanceTimersByTime(WINDOW_MS + 1);

    // After the window, requests should be allowed again
    const afterRes = makeRes();
    middleware(req, afterRes as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(MAX + 1);
    expect(afterRes.status).not.toHaveBeenCalledWith(429);
  });
});
