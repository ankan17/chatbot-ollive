/**
 * Model catalog DTOs (GET /v1/models) + the per-provider catalogs the API
 * exposes for providers that are actually configured. Adding a provider =
 * adding its catalog here + wiring its key/adapter; the switcher then lists
 * it automatically with no UI change.
 */

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  description?: string;
}

/** GET /v1/models response. */
export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string;
}

/** Models the Google provider can serve (selected via ChatRequest.model). */
export const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Fast — great for everyday chat',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Most capable — best for hard problems',
  },
];
