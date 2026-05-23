import type { RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import { verifySession, sessionClaimsToUser } from '../auth/jwt.js';
import { AppError } from '../errors.js';

export interface AuthMiddlewareDeps {
  config: AppConfig;
}

/**
 * Verify the JWT session cookie. Sets req.user on success, throws AppError('unauthorized') on failure.
 * Pinned contract: Plan 5 imports this exact signature.
 */
export function requireAuth(deps: AuthMiddlewareDeps): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.['session'] as string | undefined;
    if (!token) {
      return next(new AppError('unauthorized', 'Authentication required'));
    }
    try {
      const claims = await verifySession(token, deps.config.jwtSecret);
      req.user = sessionClaimsToUser(claims);
      next();
    } catch {
      next(new AppError('unauthorized', 'Invalid or expired session'));
    }
  };
}
