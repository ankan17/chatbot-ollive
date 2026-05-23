import { z } from 'zod';

/** Full profile (GET /auth/me). */
export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

/** Slim user echoed inside GET /v1/session (no avatarUrl). */
export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

/** GET /auth/me → 200 */
export interface MeResponse {
  user: AuthUser;
}

/** GET /v1/session → 200 (discriminated union; never 401). */
export type SessionResponse =
  | { authenticated: false; guest: { remaining: number; limit: number } }
  | { authenticated: true; user: SessionUser };

/** GET /auth/google/callback query (CSRF state round-trip). */
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OauthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
