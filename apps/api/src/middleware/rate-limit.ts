import type { RequestHandler, Request } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window IP rate limiter (SE9/S4).
 * On limit → writes { error: 'rate_limited' } (429) directly (not via AppError).
 *
 * Memory management: one setInterval per limiter instance prunes stale entries
 * every windowMs. The timer is unref()'d so it never holds the process open.
 * A soft-cap lazy prune is kept as a secondary safeguard.
 */
export function ipRateLimit(opts: RateLimitOptions): RequestHandler {
  const store = new Map<string, WindowEntry>();
  const SOFT_CAP = 10_000;

  // Periodic prune: sweep stale entries every window, one timer per instance.
  // unref() ensures this timer never prevents the process from exiting.
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (entry.resetAt < now) {
        store.delete(k);
      }
    }
  }, opts.windowMs);
  pruneTimer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip ?? 'unknown');

    // Lazy pruning when the map grows large (secondary safeguard)
    if (store.size > SOFT_CAP) {
      for (const [k, entry] of store) {
        if (entry.resetAt < now) {
          store.delete(k);
        }
      }
    }

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > opts.max) {
      // Emit directly per contract §7 — not via AppError
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    next();
  };
}
