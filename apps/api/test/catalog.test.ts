import { describe, it, expect } from 'vitest';
import { availableModels, availableModelIds } from '../src/models/catalog.js';
import type { AppConfig } from '../src/config.js';

function cfg(geminiApiKey: string): AppConfig {
  return { geminiApiKey, defaultModel: 'gemini-2.5-flash' } as unknown as AppConfig;
}

describe('model catalog', () => {
  it('exposes Gemini models when the key is configured', () => {
    const models = availableModels(cfg('a-key'));
    expect(models.length).toBeGreaterThanOrEqual(2);
    expect(models.every((m) => m.provider === 'google')).toBe(true);
    expect(models.map((m) => m.id)).toContain('gemini-2.5-flash');
  });

  it('returns no models when no provider key is set', () => {
    expect(availableModels(cfg('')).length).toBe(0);
  });

  it('availableModelIds is the set of model ids', () => {
    const ids = availableModelIds(cfg('a-key'));
    expect(ids.has('gemini-2.5-pro')).toBe(true);
    expect(ids.has('gpt-4o')).toBe(false);
  });
});
