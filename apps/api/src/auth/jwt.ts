import { SignJWT, jwtVerify } from 'jose';
import type { Response } from 'express';
import type { AuthUser } from '../types.js';

export interface SessionClaims {
  sub: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export const SESSION_COOKIE = 'session';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Sign a JWT session token (HS256) with the given claims and secret.
 * Default TTL is 7 days.
 */
export async function signSession(
  claims: SessionClaims,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const jwt = new SignJWT({
    email: claims.email,
    ...(claims.name !== undefined ? { name: claims.name } : {}),
    ...(claims.avatarUrl !== undefined ? { avatarUrl: claims.avatarUrl } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`);

  return jwt.sign(secretKey(secret));
}

/**
 * Verify and decode a session JWT. Throws on bad/expired token.
 */
export async function verifySession(token: string, secret: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret));

  if (!payload.sub || typeof payload['email'] !== 'string') {
    throw new Error('Invalid JWT payload: missing required claims');
  }

  return {
    sub: payload.sub,
    email: payload['email'] as string,
    name: typeof payload['name'] === 'string' ? payload['name'] : undefined,
    avatarUrl: typeof payload['avatarUrl'] === 'string' ? payload['avatarUrl'] : undefined,
  };
}

/**
 * Set the session cookie on the response.
 */
export function setSessionCookie(
  res: Response,
  token: string,
  opts: { secure: boolean; maxAgeSeconds?: number },
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: (opts.maxAgeSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  });
}

/**
 * Clear the session cookie (Max-Age=0).
 */
export function clearSessionCookie(res: Response, opts: { secure: boolean }): void {
  res.cookie(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: 0,
  });
}

/**
 * Map session claims to the AuthUser interface (sub → id).
 */
export function sessionClaimsToUser(claims: SessionClaims): AuthUser {
  return {
    id: claims.sub,
    email: claims.email,
    ...(claims.name !== undefined ? { name: claims.name } : {}),
    ...(claims.avatarUrl !== undefined ? { avatarUrl: claims.avatarUrl } : {}),
  };
}
