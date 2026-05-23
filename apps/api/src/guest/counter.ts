import type { Redis } from '../redis.js';

/**
 * Redis key for the guest counter.
 * Format: guest:{guestSessionId}:count
 * Pinned contract — Plan 5 uses this key directly.
 */
export const guestKey = (guestId: string): string => `guest:${guestId}:count`;

/**
 * Increment the guest message counter and check against the cap.
 * Uses an atomic pipeline (INCR + EXPIRE in one round-trip) so the TTL is always
 * set — a crash between INCR and EXPIRE can never leave a key without a TTL.
 * This makes the window a sliding window from each use, which is acceptable.
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

  // Atomic pipeline: INCR then EXPIRE always, so no TTL-less key can survive a crash
  const res = await redis.multi().incr(key).expire(key, ttlSeconds).exec();

  // res is an array of [error, value] pairs; first command is INCR → res[0][1]
  const n = (res?.[0]?.[1] as number) ?? 0;

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
