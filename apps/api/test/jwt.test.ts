import { describe, it, expect, vi } from 'vitest';
import {
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  sessionClaimsToUser,
} from '../src/auth/jwt.js';
import type { SessionClaims } from '../src/auth/jwt.js';

const TEST_SECRET = 'test-jwt-secret-at-least-32-chars!!';

const claims: SessionClaims = {
  sub: 'user-uuid-123',
  email: 'test@example.com',
  name: 'Test User',
};

describe('signSession / verifySession', () => {
  it('round-trip: sign then verify returns same sub/email/name', async () => {
    const token = await signSession(claims, TEST_SECRET);
    const result = await verifySession(token, TEST_SECRET);
    expect(result.sub).toBe(claims.sub);
    expect(result.email).toBe(claims.email);
    expect(result.name).toBe(claims.name);
  });

  it('wrong secret → verifySession rejects', async () => {
    const token = await signSession(claims, TEST_SECRET);
    await expect(verifySession(token, 'wrong-secret-also-needs-to-be-long')).rejects.toThrow();
  });

  it('tampered token (flip a payload char) → rejects', async () => {
    const token = await signSession(claims, TEST_SECRET);
    const parts = token.split('.');
    // Flip a character in the payload part
    const payloadPart = parts[1]!;
    const tamperedPayload = payloadPart.slice(0, -1) + (payloadPart.endsWith('a') ? 'b' : 'a');
    const tampered = [parts[0], tamperedPayload, parts[2]].join('.');
    await expect(verifySession(tampered, TEST_SECRET)).rejects.toThrow();
  });

  it('expired token (ttlSeconds: -1) → rejects', async () => {
    const token = await signSession(claims, TEST_SECRET, -1);
    await expect(verifySession(token, TEST_SECRET)).rejects.toThrow();
  });
});

describe('setSessionCookie / clearSessionCookie', () => {
  function makeRes() {
    const cookies: Record<string, { value: string; opts: Record<string, unknown> }> = {};
    return {
      cookie: vi.fn((name: string, value: string, opts: Record<string, unknown>) => {
        cookies[name] = { value, opts };
      }),
      _cookies: cookies,
    };
  }

  it('setSessionCookie with secure:false → HttpOnly, sameSite lax, no Secure', async () => {
    const res = makeRes();
    const token = await signSession(claims, TEST_SECRET);
    setSessionCookie(res as unknown as import('express').Response, token, { secure: false });
    expect(res.cookie).toHaveBeenCalledOnce();
    const [name, value, opts] = res.cookie.mock.calls[0]!;
    expect(name).toBe('session');
    expect(value).toBe(token);
    expect(opts.httpOnly).toBe(true);
    expect(String(opts.sameSite).toLowerCase()).toBe('lax');
    expect(opts.secure).toBe(false);
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBeGreaterThan(0);
  });

  it('setSessionCookie with secure:true → opts.secure is true', async () => {
    const res = makeRes();
    const token = await signSession(claims, TEST_SECRET);
    setSessionCookie(res as unknown as import('express').Response, token, { secure: true });
    const [, , opts] = res.cookie.mock.calls[0]!;
    expect(opts.secure).toBe(true);
  });

  it('clearSessionCookie → maxAge=0', () => {
    const res = makeRes();
    clearSessionCookie(res as unknown as import('express').Response, { secure: false });
    expect(res.cookie).toHaveBeenCalledOnce();
    const [name, , opts] = res.cookie.mock.calls[0]!;
    expect(name).toBe('session');
    expect(opts.maxAge).toBe(0);
  });
});

describe('sessionClaimsToUser', () => {
  it('maps sub to id', () => {
    const user = sessionClaimsToUser({ sub: 'u1', email: 'e@example.com' });
    expect(user.id).toBe('u1');
    expect(user.email).toBe('e@example.com');
    expect(user.name).toBeUndefined();
  });

  it('maps optional fields through', () => {
    const user = sessionClaimsToUser({
      sub: 'u1',
      email: 'e@example.com',
      name: 'Test',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(user.name).toBe('Test');
    expect(user.avatarUrl).toBe('https://example.com/avatar.png');
  });
});
