import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { availableModels, availableModelIds, providerForModel } from '../src/models/catalog.js';

const baseEnv = {
  DATABASE_URL: 'postgres://ollive:ollive@localhost:5432/ollive',
  REDIS_URL: 'redis://localhost:6379',
  PORT: '4000',
  INGESTION_API_KEY: 'test-key',
  JWT_SECRET: 'test-jwt-secret',
  AUTH_MODE: 'dev',
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test',
  GEMINI_API_KEY: 'dummy-gemini-key',
};

describe('availableModels — without ANTHROPIC_API_KEY', () => {
  const cfg = loadConfig(baseEnv);

  it('includes gemini-2.5-flash', () => {
    const ids = availableModels(cfg).map((m) => m.id);
    expect(ids).toContain('gemini-2.5-flash');
  });

  it('excludes claude-sonnet-4-6', () => {
    const ids = availableModels(cfg).map((m) => m.id);
    expect(ids).not.toContain('claude-sonnet-4-6');
  });
});

describe('availableModelIds — without ANTHROPIC_API_KEY', () => {
  const cfg = loadConfig(baseEnv);

  it('excludes claude-sonnet-4-6', () => {
    expect(availableModelIds(cfg).has('claude-sonnet-4-6')).toBe(false);
  });
});

describe('providerForModel — without ANTHROPIC_API_KEY', () => {
  const cfg = loadConfig(baseEnv);

  it('returns undefined for claude-sonnet-4-6', () => {
    expect(providerForModel('claude-sonnet-4-6', cfg)).toBeUndefined();
  });

  it('returns "google" for gemini-2.5-flash', () => {
    expect(providerForModel('gemini-2.5-flash', cfg)).toBe('google');
  });

  it('returns undefined for a nonexistent model', () => {
    expect(providerForModel('nonexistent-model', cfg)).toBeUndefined();
  });
});

describe('availableModels — with ANTHROPIC_API_KEY', () => {
  const cfg = loadConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'dummy-anthropic-key' });

  it('includes claude-sonnet-4-6', () => {
    const ids = availableModels(cfg).map((m) => m.id);
    expect(ids).toContain('claude-sonnet-4-6');
  });
});

describe('providerForModel — with ANTHROPIC_API_KEY', () => {
  const cfg = loadConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'dummy-anthropic-key' });

  it('returns "anthropic" for claude-sonnet-4-6', () => {
    expect(providerForModel('claude-sonnet-4-6', cfg)).toBe('anthropic');
  });
});
