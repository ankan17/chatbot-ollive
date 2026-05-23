import type { AppConfig } from '../config.js';
import { GoogleAuthProvider } from './google-provider.js';
import { DevAuthProvider } from './dev-provider.js';

export interface AuthIdentity {
  sub: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface AuthProvider {
  name: string;
  /** Returns the redirect URL for the OAuth consent screen. */
  getAuthorizationUrl(state: string): string;
  /** Exchanges the OAuth code for an identity. Throws on failure. */
  handleCallback(code: string): Promise<AuthIdentity>;
}

/**
 * Factory that selects the appropriate AuthProvider based on AUTH_MODE.
 */
export function createAuthProvider(config: AppConfig): AuthProvider {
  if (config.authMode === 'google') {
    return new GoogleAuthProvider({
      clientId: config.googleClientId!,
      clientSecret: config.googleClientSecret!,
      redirectUri: config.googleRedirectUri,
    });
  }
  return new DevAuthProvider();
}
