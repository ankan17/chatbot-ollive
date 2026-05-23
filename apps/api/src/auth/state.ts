import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes

interface StatePayload {
  nonce: string;
  exp: number; // Unix timestamp seconds
}

/**
 * Sign a CSRF state token. Returns a `base64url(payload).hmac` string.
 * Default TTL is 10 minutes.
 */
export function signState(
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): { state: string } {
  const payload: StatePayload = {
    nonce: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return { state: `${encodedPayload}.${mac}` };
}

/**
 * Verify a signed state token. Returns false on tamper, wrong secret, or expiry.
 */
export function verifyState(state: string, secret: string): boolean {
  const dotIndex = state.lastIndexOf('.');
  if (dotIndex < 0) return false;

  const encodedPayload = state.slice(0, dotIndex);
  const receivedMac = state.slice(dotIndex + 1);

  if (!encodedPayload || !receivedMac) return false;

  // Recompute HMAC and compare with timing-safe equal
  const expectedMac = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  let macValid: boolean;
  try {
    macValid = timingSafeEqual(Buffer.from(receivedMac), Buffer.from(expectedMac));
  } catch {
    return false;
  }

  if (!macValid) return false;

  // Decode and check expiry
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()) as StatePayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;
  } catch {
    return false;
  }

  return true;
}
