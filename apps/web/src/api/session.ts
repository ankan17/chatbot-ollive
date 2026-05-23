import { request } from './http.js';
import { API_BASE_URL } from './config.js';
import type { SessionResponse, MeResponse } from './types.js';

export function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return request<SessionResponse>('/v1/session', { signal });
}

export function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', { signal });
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

export function googleSignInUrl(): string {
  return `${API_BASE_URL}/auth/google`;
}
