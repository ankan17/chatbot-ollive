/**
 * E2E test helpers — black-box HTTP client utilities for the running compose stack.
 * Does NOT import any app code; talks only over HTTP and Postgres (read-only assertions).
 */

export const API_URL = process.env.OLLIVE_E2E_API_URL ?? 'http://localhost:4000';
export const WEB_URL = process.env.OLLIVE_E2E_WEB_URL ?? 'http://localhost:8080';
export const DB_URL =
  process.env.OLLIVE_E2E_DB_URL ??
  process.env.DATABASE_URL ??
  'postgres://ollive:ollive@localhost:5432/ollive';
export const INGESTION_API_KEY =
  process.env.INGESTION_API_KEY ?? 'dev-ingestion-key';

/** Thin fetch wrapper that carries a session cookie across calls. */
export class ApiClient {
  private cookie = '';

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('Cookie', this.cookie);

    const res = await fetch(`${API_URL}${path}`, { ...init, headers, redirect: 'manual' });

    // Accumulate Set-Cookie headers
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      // Extract name=value pairs and merge into the cookie jar
      const newPairs = setCookie
        .split(',')
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean);
      const existing = new Map(
        this.cookie.split(';').map((p) => {
          const [k, ...rest] = p.trim().split('=');
          return [k, rest.join('=')] as [string, string];
        }),
      );
      for (const pair of newPairs) {
        const eq = pair.indexOf('=');
        if (eq > 0) existing.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      this.cookie = Array.from(existing.entries())
        .filter(([k]) => k)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
    return res;
  }

  /** Complete the dev-mode OAuth flow and return an authenticated client. */
  async devLogin(): Promise<void> {
    // Step 1: GET /auth/google — gets the oauth_state cookie + redirect URL
    const initRes = await this.fetch('/auth/google');
    // initRes is a redirect (302); we already stored the oauth_state cookie above.
    // The Location header points to /auth/google/callback?code=dev&state=<state>
    const location = initRes.headers.get('location') ?? '';

    // Step 2: Follow the redirect to /auth/google/callback
    // Extract the path+query from the location (it may be an absolute URL)
    let callbackPath: string;
    try {
      const url = new URL(location);
      callbackPath = url.pathname + url.search;
    } catch {
      callbackPath = location;
    }
    await this.fetch(callbackPath);
    // The callback sets a session cookie which is now stored in this.cookie
  }
}

/**
 * Poll fn() every intervalMs until it returns a truthy value or timeoutMs elapses.
 * Returns the truthy value, or throws on timeout.
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result as T;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}
