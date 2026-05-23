import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://ollive:ollive@localhost:5432/ollive',
  REDIS_URL: 'redis://localhost:6379',
  INGESTION_API_KEY: 'test-key',
  PORT: '4001',
  INGESTION_STREAM_MAXLEN: '50000',
  JWT_SECRET: 'super-secret-key-for-testing',
  GEMINI_API_KEY: 'dummy-gemini-key-for-tests',
};

describe('loadConfig', () => {
  it('valid env → maps all fields correctly', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.port).toBe(4001);
    expect(cfg.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(cfg.redisUrl).toBe(validEnv.REDIS_URL);
    expect(cfg.ingestionApiKey).toBe('test-key');
    expect(cfg.ingestionStreamMaxLen).toBe(50000);
    expect(cfg.jwtSecret).toBe('super-secret-key-for-testing');
  });

  it('missing PORT and INGESTION_STREAM_MAXLEN → defaults 4000 and 100000', () => {
    const { PORT: _p, INGESTION_STREAM_MAXLEN: _m, ...env } = validEnv;
    const cfg = loadConfig(env);
    expect(cfg.port).toBe(4000);
    expect(cfg.ingestionStreamMaxLen).toBe(100000);
  });

  it('INGESTION_STREAM_MAXLEN="5000" → 5000', () => {
    const cfg = loadConfig({ ...validEnv, INGESTION_STREAM_MAXLEN: '5000' });
    expect(cfg.ingestionStreamMaxLen).toBe(5000);
  });

  it('missing DATABASE_URL → throws with DATABASE_URL in message', () => {
    const { DATABASE_URL: _d, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrowError(/DATABASE_URL/);
  });

  it('empty INGESTION_API_KEY → throws with INGESTION_API_KEY in message', () => {
    expect(() => loadConfig({ ...validEnv, INGESTION_API_KEY: '' })).toThrowError(
      /INGESTION_API_KEY/,
    );
  });

  // --- New auth/guest/CORS/config tests (Task 1) ---

  it('valid dev env (no Google creds) → authMode dev, correct defaults', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.authMode).toBe('dev');
    expect(cfg.guestMessageLimit).toBe(2);
    expect(cfg.guestSessionTtl).toBe(86400);
    expect(cfg.webOrigin).toBe('http://localhost:5173');
    expect(cfg.defaultModel).toBe('gemini-2.5-flash');
  });

  it('DEFAULT_MODEL override is honored', () => {
    const cfg = loadConfig({ ...validEnv, DEFAULT_MODEL: 'gemini-2.5-pro' });
    expect(cfg.defaultModel).toBe('gemini-2.5-pro');
  });

  it('AUTH_MODE=google WITHOUT Google creds → throws mentioning both vars', () => {
    expect(() =>
      loadConfig({ ...validEnv, AUTH_MODE: 'google' }),
    ).toThrowError(/GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_SECRET.*GOOGLE_CLIENT_ID/);
  });

  it('AUTH_MODE=google WITH both Google vars → parses successfully', () => {
    const cfg = loadConfig({
      ...validEnv,
      AUTH_MODE: 'google',
      GOOGLE_CLIENT_ID: 'my-client-id',
      GOOGLE_CLIENT_SECRET: 'my-client-secret',
    });
    expect(cfg.authMode).toBe('google');
    expect(cfg.googleClientId).toBe('my-client-id');
    expect(cfg.googleClientSecret).toBe('my-client-secret');
    expect(cfg.googleRedirectUri).toMatch(/\/auth\/google\/callback$/);
  });

  it('missing JWT_SECRET → throws mentioning JWT_SECRET', () => {
    const { JWT_SECRET: _s, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrowError(/JWT_SECRET/);
  });

  it('GUEST_MESSAGE_LIMIT and GUEST_SESSION_TTL coerced to numbers', () => {
    const cfg = loadConfig({
      ...validEnv,
      GUEST_MESSAGE_LIMIT: '5',
      GUEST_SESSION_TTL: '3600',
    });
    expect(cfg.guestMessageLimit).toBe(5);
    expect(cfg.guestSessionTtl).toBe(3600);
  });

  it('invalid WEB_ORIGIN → throws mentioning WEB_ORIGIN', () => {
    expect(() =>
      loadConfig({ ...validEnv, WEB_ORIGIN: 'not-a-url' }),
    ).toThrowError(/WEB_ORIGIN/);
  });

  // --- Plan 5: chat config keys ---

  it('valid env including chat keys → geminiApiKey, contextTokenBudget, piiRedaction mapped', () => {
    const cfg = loadConfig({
      ...validEnv,
      GEMINI_API_KEY: 'my-gemini-key',
      CONTEXT_TOKEN_BUDGET: '8000',
      PII_REDACTION: 'llm',
    });
    expect(cfg.geminiApiKey).toBe('my-gemini-key');
    expect(cfg.contextTokenBudget).toBe(8000);
    expect(cfg.piiRedaction).toBe('llm');
  });

  it('missing CONTEXT_TOKEN_BUDGET and PII_REDACTION → defaults 4000 and "pattern"', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.contextTokenBudget).toBe(4000);
    expect(cfg.piiRedaction).toBe('pattern');
  });

  it('CONTEXT_TOKEN_BUDGET="8000" → coerced to number 8000', () => {
    const cfg = loadConfig({ ...validEnv, CONTEXT_TOKEN_BUDGET: '8000' });
    expect(cfg.contextTokenBudget).toBe(8000);
  });

  it('missing GEMINI_API_KEY → throws mentioning GEMINI_API_KEY', () => {
    const { GEMINI_API_KEY: _k, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrowError(/GEMINI_API_KEY/);
  });

  it('PII_REDACTION="bogus" → throws (enum violation)', () => {
    expect(() =>
      loadConfig({ ...validEnv, PII_REDACTION: 'bogus' }),
    ).toThrowError(/PII_REDACTION/);
  });
});
