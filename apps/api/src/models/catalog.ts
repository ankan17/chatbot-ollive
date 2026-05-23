import { GOOGLE_MODELS, type ModelInfo } from '@ollive/shared/api';
import type { AppConfig } from '../config.js';

/**
 * Models that are actually available given the configured providers.
 * Google is included whenever its API key is set. New providers light up
 * here once their key + catalog exist — no other code changes needed.
 */
export function availableModels(config: AppConfig): ModelInfo[] {
  const models: ModelInfo[] = [];
  if (config.geminiApiKey) {
    models.push(...GOOGLE_MODELS);
  }
  return models;
}

/** Set of valid model ids for validating create/patch requests. */
export function availableModelIds(config: AppConfig): Set<string> {
  return new Set(availableModels(config).map((m) => m.id));
}
