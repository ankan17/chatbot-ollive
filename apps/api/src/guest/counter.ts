import type { Redis } from '../redis.js';

/**
 * Redis key for the guest counter.
 * Format: guest:{guestSessionId}:count
 * Pinned contract — Plan 5 uses this key directly.
 */
export const guestKey = (guestId: string): string => `guest:${guestId}:count`;

/**
 * Increment the guest message counter and check against the cap.
 * Uses atomic INCR; TTL is set only on first increment (sliding-from-first-use window).
 *
 * Pinned contract: Plan 5 calls this per guest turn.
 */
export async function checkAndIncrementGuest(
  redis: Redis,
  guestId: string,
  limit: number,
  ttlSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = guestKey(guestId);
  const n = await redis.incr(key);

  // Set TTL only on first increment so the window starts on first use
  if (n === 1) {
    await redis.expire(key, ttlSeconds);
  }

  const allowed = n <= limit;
  const remaining = Math.max(0, limit - n);

  return { allowed, remaining };
}

/**
 * Read-only variant: returns remaining messages without consuming the trial.
 * Used by GET /v1/session — polling this endpoint NEVER burns a message.
 *
 * Pinned contract: Plan 5 uses this for the session response.
 */
export async function readGuestRemaining(
  redis: Redis,
  guestId: string,
  limit: number,
): Promise<{ remaining: number; limit: number }> {
  const key = guestKey(guestId);
  const raw = await redis.get(key);
  const used = raw ? Number(raw) : 0;
  const remaining = Math.max(0, limit - used);
  return { remaining, limit };
}
