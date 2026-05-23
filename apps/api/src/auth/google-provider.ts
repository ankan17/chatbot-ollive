import { OAuth2Client } from 'google-auth-library';
import type { AuthProvider, AuthIdentity } from './provider.js';

export class GoogleAuthProvider implements AuthProvider {
  readonly name = 'google';
  private client: OAuth2Client;

  constructor(opts: { clientId: string; clientSecret: string; redirectUri: string }) {
    this.client = new OAuth2Client({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      redirectUri: opts.redirectUri,
    });
  }

  getAuthorizationUrl(state: string): string {
    return this.client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
  }

  async handleCallback(code: string): Promise<AuthIdentity> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.id_token) {
      throw new Error('No id_token returned from Google');
    }

    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.client._clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid Google ID token payload');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture,
    };
  }
}
