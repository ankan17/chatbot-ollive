import { Router } from 'express';
import type { Redis } from '../redis.js';
import type { AppConfig } from '../config.js';
import type { AuthProvider } from '../auth/provider.js';
import type { UserRepository } from '../users/repository.js';
import { signState, verifyState } from '../auth/state.js';
import { signSession, setSessionCookie, clearSessionCookie, verifySession, sessionClaimsToUser } from '../auth/jwt.js';
import { requireAuth } from '../middleware/require-auth.js';
import { guestSession, verifyGuestCookie, signGuestId, GUEST_COOKIE } from '../middleware/guest-session.js';
import { readGuestRemaining } from '../guest/counter.js';
import { oauthCallbackQuerySchema } from '@ollive/shared/api';
import type { MeResponse, SessionResponse } from '@ollive/shared/api';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL = 10 * 60; // 10 minutes

export interface AuthRouterDeps {
  config: AppConfig;
  redis: Redis;
  users: UserRepository;
  authProvider: AuthProvider;
}

export function authRouter(deps: AuthRouterDeps): Router {
  const { config, redis, users, authProvider } = deps;
  const router = Router();
  const secure = config.nodeEnv === 'production';

  // GET /auth/google — redirect to OAuth consent, set oauth_state cookie
  router.get('/auth/google', (_req, res) => {
    const { state } = signState(config.jwtSecret, OAUTH_STATE_TTL);
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: OAUTH_STATE_TTL * 1000,
    });
    const url = authProvider.getAuthorizationUrl(state);
    res.redirect(302, url);
  });

  // GET /auth/google/callback?code=&state=
  router.get('/auth/google/callback', async (req, res) => {
    const { webOrigin, jwtSecret } = config;
    try {
      // Validate query params
      const parseResult = oauthCallbackQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new Error('Invalid query params');
      }
      const { code, state } = parseResult.data;

      // Verify state signature
      if (!verifyState(state, jwtSecret)) {
        throw new Error('State signature invalid or expired');
      }

      // Verify state matches the cookie (double-submit CSRF check)
      const cookieState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
      if (!cookieState || cookieState !== state) {
        throw new Error('State cookie mismatch');
      }

      // Exchange code for identity
      const identity = await authProvider.handleCallback(code);

      // Upsert user
      const user = await users.upsertByGoogleSub({
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      });

      // Sign and set session cookie
      const token = await signSession(
        { sub: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
        jwtSecret,
      );
      setSessionCookie(res, token, { secure });

      // Clear the oauth_state cookie (single-use)
      res.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });

      res.redirect(302, webOrigin);
    } catch {
      // On any failure, redirect to web origin with auth_error flag — never leak provider detail
      res.redirect(302, `${webOrigin}/?auth_error=1`);
    }
  });

  // POST /auth/logout — clear session cookie, 204
  router.post('/auth/logout', (req, res) => {
    clearSessionCookie(res, { secure });
    res.status(204).end();
  });

  // GET /auth/me — requires auth; returns full AuthUser
  router.get('/auth/me', requireAuth({ config }), (req, res) => {
    const body: MeResponse = { user: req.user! };
    res.json(body);
  });

  // GET /v1/session — NEVER 401; returns SessionResponse discriminated union
  router.get('/v1/session', async (req, res) => {
    const token = req.cookies?.['session'] as string | undefined;

    // Try authenticated branch
    if (token) {
      try {
        const claims = await verifySession(token, config.jwtSecret);
        const user = sessionClaimsToUser(claims);
        const body: SessionResponse = {
          authenticated: true,
          user: { id: user.id, email: user.email, ...(user.name ? { name: user.name } : {}) },
        };
        return res.json(body);
      } catch {
        // Fall through to guest branch
      }
    }

    // Guest branch — ensure guest cookie and read remaining
    let guestId: string | null = null;
    const rawCookie = req.cookies?.[GUEST_COOKIE] as string | undefined;

    if (rawCookie) {
      guestId = verifyGuestCookie(rawCookie, config.jwtSecret);
    }

    if (!guestId) {
      const { randomUUID } = await import('node:crypto');
      guestId = randomUUID();
      res.cookie(GUEST_COOKIE, signGuestId(guestId, config.jwtSecret), {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: config.guestSessionTtl * 1000,
      });
    }

    const { remaining, limit } = await readGuestRemaining(redis, guestId, config.guestMessageLimit);
    const body: SessionResponse = {
      authenticated: false,
      guest: { remaining, limit },
    };
    return res.json(body);
  });

  return router;
}
