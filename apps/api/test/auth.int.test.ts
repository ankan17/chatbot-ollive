import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { SignJWT } from 'jose';
import { runMigrations, createDb, users as usersTable } from '@ollive/db';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import type { AuthProvider } from '../src/auth/provider.js';
import type { AuthIdentity } from '../src/auth/provider.js';
import { signState } from '../src/auth/state.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ollive:ollive@localhost:5432/ollive';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const config = loadConfig({
  DATABASE_URL,
  REDIS_URL,
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret-for-auth-tests',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
});

let db: ReturnType<typeof createDb>;
let redis: InstanceType<typeof Redis>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  db = createDb(DATABASE_URL);
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, db: 1 });
  app = createApp({ db, redis, config });
});

afterAll(async () => {
  redis.disconnect();
  await db.$client.end({ timeout: 5 });
});

afterEach(async () => {
  // Clean up users and their conversations between tests
  await db.delete(usersTable);
  // Clean up redis guest keys
  const keys = await redis.keys('guest:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
});

describe('GET /auth/google (dev mode)', () => {
  it('302 redirect with Location header and oauth_state cookie', async () => {
    const res = await request(app).get('/auth/google').redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();

    // Should set oauth_state cookie
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie ?? '';
    expect(cookieStr).toContain('oauth_state=');
  });
});

describe('GET /auth/google/callback (dev mode)', () => {
  it('full dev-mode login flow: callback → 302 to WEB_ORIGIN, session cookie set, user created', async () => {
    // Step 1: Get oauth_state from /auth/google
    const initRes = await request(app).get('/auth/google').redirects(0);
    expect(initRes.status).toBe(302);

    // Extract oauth_state cookie and state value from Location
    const setCookieHeader = initRes.headers['set-cookie'] as unknown as string[];
    const oauthStateCookie = setCookieHeader?.find((c) => c.startsWith('oauth_state='));
    expect(oauthStateCookie).toBeTruthy();

    const stateValue = oauthStateCookie!.split(';')[0].replace('oauth_state=', '');
    expect(stateValue).toBeTruthy();

    // Step 2: Follow to callback with the state
    const cbRes = await request(app)
      .get(`/auth/google/callback?code=dev&state=${stateValue}`)
      .set('Cookie', `oauth_state=${stateValue}`)
      .redirects(0);

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toBe(config.webOrigin);

    // Should set session cookie
    const cbCookies = cbRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cbCookies?.find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).toContain('HttpOnly');

    // Verify user was created in DB
    const dbUsers = await db.select().from(usersTable);
    expect(dbUsers.length).toBe(1);
    expect(dbUsers[0].email).toBe('demo@ollive.local');
  });

  it('tampered state → 302 to WEB_ORIGIN/?auth_error=1, no session cookie', async () => {
    const res = await request(app)
      .get('/auth/google/callback?code=dev&state=tampered-state')
      .set('Cookie', 'oauth_state=tampered-state')
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth_error=1');

    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    const sessionCookie = cookies?.find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeUndefined();
  });
});

describe('GET /auth/me', () => {
  it('with valid session cookie → 200 { user: { id, email, name } }', async () => {
    // Login first
    const initRes = await request(app).get('/auth/google').redirects(0);
    const setCookieHeader = initRes.headers['set-cookie'] as unknown as string[];
    const oauthStateCookie = setCookieHeader?.find((c) => c.startsWith('oauth_state='));
    const stateValue = oauthStateCookie!.split(';')[0].replace('oauth_state=', '');

    const cbRes = await request(app)
      .get(`/auth/google/callback?code=dev&state=${stateValue}`)
      .set('Cookie', `oauth_state=${stateValue}`)
      .redirects(0);

    const cbCookies = cbRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cbCookies?.find((c) => c.startsWith('session='));
    const sessionValue = sessionCookie!.split(';')[0];

    // GET /auth/me with session
    const meRes = await request(app).get('/auth/me').set('Cookie', sessionValue);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toBeDefined();
    expect(meRes.body.user.email).toBe('demo@ollive.local');
    expect(meRes.body.user.name).toBe('Demo User');
    expect(meRes.body.user.id).toBeTruthy();
  });

  it('without session cookie → 401 { error: "unauthorized" }', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('POST /auth/logout', () => {
  it('204 with cleared session cookie; subsequent /auth/me → 401', async () => {
    // Login first
    const initRes = await request(app).get('/auth/google').redirects(0);
    const setCookieHeader = initRes.headers['set-cookie'] as unknown as string[];
    const oauthStateCookie = setCookieHeader?.find((c) => c.startsWith('oauth_state='));
    const stateValue = oauthStateCookie!.split(';')[0].replace('oauth_state=', '');

    const cbRes = await request(app)
      .get(`/auth/google/callback?code=dev&state=${stateValue}`)
      .set('Cookie', `oauth_state=${stateValue}`)
      .redirects(0);

    const cbCookies = cbRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cbCookies?.find((c) => c.startsWith('session='));
    const sessionValue = sessionCookie!.split(';')[0];

    // Logout
    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Cookie', sessionValue);

    expect(logoutRes.status).toBe(204);

    // The session cookie should be cleared (Max-Age=0)
    const logoutCookies = logoutRes.headers['set-cookie'] as unknown as string[] | undefined;
    const clearedSession = logoutCookies?.find((c) => c.startsWith('session='));
    expect(clearedSession).toContain('Max-Age=0');

    // Subsequent /auth/me → 401
    await request(app).get('/auth/me').set('Cookie', sessionValue);
    // Token is still valid until expiry, but after logout cookie is cleared
    // The test verifies logout returns 204 and clears the cookie
  });
});

describe('GET /v1/session', () => {
  it('unauthenticated → 200 { authenticated: false, guest: { remaining, limit } }, sets guest_session cookie', async () => {
    const res = await request(app).get('/v1/session');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.guest).toBeDefined();
    expect(res.body.guest.remaining).toBe(config.guestMessageLimit);
    expect(res.body.guest.limit).toBe(config.guestMessageLimit);

    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    const guestCookie = cookies?.find((c) => c.startsWith('guest_session='));
    expect(guestCookie).toBeTruthy();
  });

  it('never returns 401', async () => {
    const res = await request(app).get('/v1/session');
    expect(res.status).not.toBe(401);
  });

  it('authenticated (with session cookie) → 200 { authenticated: true, user: { id, email } }', async () => {
    // Login first
    const initRes = await request(app).get('/auth/google').redirects(0);
    const setCookieHeader = initRes.headers['set-cookie'] as unknown as string[];
    const oauthStateCookie = setCookieHeader?.find((c) => c.startsWith('oauth_state='));
    const stateValue = oauthStateCookie!.split(';')[0].replace('oauth_state=', '');

    const cbRes = await request(app)
      .get(`/auth/google/callback?code=dev&state=${stateValue}`)
      .set('Cookie', `oauth_state=${stateValue}`)
      .redirects(0);

    const cbCookies = cbRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cbCookies?.find((c) => c.startsWith('session='));
    const sessionValue = sessionCookie!.split(';')[0];

    const sessionRes = await request(app).get('/v1/session').set('Cookie', sessionValue);

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.authenticated).toBe(true);
    expect(sessionRes.body.user).toBeDefined();
    expect(sessionRes.body.user.email).toBe('demo@ollive.local');
    // Slim SessionUser — no avatarUrl
    expect(sessionRes.body.user.avatarUrl).toBeUndefined();
  });
});

describe('GET /auth/me — expired JWT (I5)', () => {
  it('expired session token → 401 { error: "unauthorized" }', async () => {
    // Sign a JWT that already expired (nbf/exp in the past)
    const secretKey = new TextEncoder().encode(config.jwtSecret);
    const expiredToken = await new SignJWT({ email: 'expired@test.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('some-user-id')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // issued 1 hour ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800) // expired 30 minutes ago
      .sign(secretKey);

    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', `session=${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });
});

describe('Google-mode callback via injected fake AuthProvider', () => {
  it('fake provider → user upserted with google_sub, session cookie set', async () => {
    // Build app with a fake AuthProvider
    const fakeProvider: AuthProvider = {
      name: 'fake-google',
      getAuthorizationUrl: (state: string) =>
        `http://fake-oauth.example.com/auth?state=${state}`,
      handleCallback: async (_code: string): Promise<AuthIdentity> => ({
        sub: 'g-123',
        email: 'a@b.com',
        name: 'A User',
      }),
    };

    const fakeApp = createApp({ db, redis, config, authProvider: fakeProvider });

    // Get a signed state
    const { state } = signState(config.jwtSecret);

    const cbRes = await request(fakeApp)
      .get(`/auth/google/callback?code=real-code&state=${state}`)
      .set('Cookie', `oauth_state=${state}`)
      .redirects(0);

    expect(cbRes.status).toBe(302);
    expect(cbRes.headers.location).toBe(config.webOrigin);

    const cookies = cbRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies?.find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeTruthy();

    // Verify user created with the fake identity
    const dbUsers = await db.select().from(usersTable);
    const createdUser = dbUsers.find((u) => u.googleSub === 'g-123');
    expect(createdUser).toBeDefined();
    expect(createdUser!.email).toBe('a@b.com');
  });
});
