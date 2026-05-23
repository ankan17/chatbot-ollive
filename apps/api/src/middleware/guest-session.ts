import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Request } from 'express';
import type { AppConfig } from '../config.js';

export const GUEST_COOKIE = 'guest_session';

export interface GuestMiddlewareDeps {
  config: AppConfig;
}

/**
 * Sign a guest id: `${id}.${HMAC-SHA256}`.
 */
export function signGuestId(guestId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(guestId).digest('base64url');
  return `${guestId}.${mac}`;
}

/**
 * Verify a signed guest cookie value. Returns the guestId or null on tamper/invalid.
 */
export function verifyGuestCookie(value: string, secret: string): string | null {
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex < 0) return null;

  const guestId = value.slice(0, dotIndex);
  const receivedMac = value.slice(dotIndex + 1);

  if (!guestId || !receivedMac) return null;

  // Basic UUID format check
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(guestId)) return null;

  const expectedMac = createHmac('sha256', secret).update(guestId).digest('base64url');

  try {
    const valid = timingSafeEqual(Buffer.from(receivedMac), Buffer.from(expectedMac));
    return valid ? guestId : null;
  } catch {
    return null;
  }
}

/**
 * Guest session middleware — ensures a signed httpOnly `guest_session` cookie.
 * Sets req.guest = { id: guestSessionId }.
 * Pinned contract: Plan 5 imports this exact signature.
 */
export function guestSession(deps: GuestMiddlewareDeps): RequestHandler {
  return (req, res, next) => {
    const { config } = deps;
    const rawCookie = req.cookies?.[GUEST_COOKIE] as string | undefined;

    let guestId: string | null = null;
    let needsIssuance = false;

    if (rawCookie) {
      guestId = verifyGuestCookie(rawCookie, config.jwtSecret);
      if (!guestId) {
        // Tampered — re-issue
        needsIssuance = true;
      }
    } else {
      needsIssuance = true;
    }

    if (needsIssuance) {
      guestId = randomUUID();
    }

    // Issue or re-issue the cookie when needed
    if (needsIssuance) {
      res.cookie(GUEST_COOKIE, signGuestId(guestId!, config.jwtSecret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
        path: '/',
        maxAge: config.guestSessionTtl * 1000,
      });
    }

    req.guest = { id: guestId! };
    next();
  };
}
