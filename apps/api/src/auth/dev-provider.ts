import type { AuthProvider, AuthIdentity } from './provider.js';

const DEFAULT_DEMO_EMAIL = 'demo@ollive.local';
const DEFAULT_DEMO_NAME = 'Demo User';
const DEMO_GOOGLE_SUB = 'dev-google-sub';

export class DevAuthProvider implements AuthProvider {
  readonly name = 'dev';
  private readonly demoEmail: string;
  private readonly demoName: string;
  private readonly callbackBase: string;

  constructor(opts?: { demoEmail?: string; demoName?: string; callbackBase?: string }) {
    this.demoEmail = opts?.demoEmail ?? DEFAULT_DEMO_EMAIL;
    this.demoName = opts?.demoName ?? DEFAULT_DEMO_NAME;
    // In dev mode, redirect to the API's own callback with a canned code
    this.callbackBase = opts?.callbackBase ?? 'http://localhost:4000/auth/google/callback';
  }

  getAuthorizationUrl(state: string): string {
    // Redirect to our own callback with a canned code — no external network call
    const url = new URL(this.callbackBase);
    url.searchParams.set('code', 'dev');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async handleCallback(_code: string): Promise<AuthIdentity> {
    // Ignore the code; always return the seeded demo identity
    return {
      sub: DEMO_GOOGLE_SUB,
      email: this.demoEmail,
      name: this.demoName,
    };
  }
}
