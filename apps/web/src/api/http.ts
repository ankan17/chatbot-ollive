import { buildUrl } from './config.js';
import { ApiError, normalizeError } from './errors.js';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts?: RequestOptions): Promise<T> {
  const { method = 'GET', body, query, signal } = opts ?? {};

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Re-throw AbortError untouched so callers detect cancel
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError('network_error', 0, err instanceof Error ? err.message : 'Network error');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let parsed: unknown;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = await res.json();
  } else {
    const text = await res.text();
    parsed = text.length > 0 ? text : undefined;
  }

  if (!res.ok) {
    throw normalizeError(res.status, parsed);
  }

  return parsed as T;
}
