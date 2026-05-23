import { request } from './http.js';
import type { ModelsResponse } from './types.js';

const STORAGE_KEY = 'ollive-model';

/** GET /v1/models — available models from configured providers. */
export function fetchModels(signal?: AbortSignal): Promise<ModelsResponse> {
  return request<ModelsResponse>('/v1/models', { signal });
}

/** The user's last-picked model id (used for the next new conversation). */
export function getStoredModel(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredModel(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore persistence failures */
  }
}
