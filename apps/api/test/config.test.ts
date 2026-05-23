import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnv = {
  DATABASE_URL: 'postgres://ollive:ollive@localhost:5432/ollive',
  REDIS_URL: 'redis://localhost:6379',
  INGESTION_API_KEY: 'test-key',
  PORT: '4001',
  INGESTION_STREAM_MAXLEN: '50000',
};

describe('loadConfig', () => {
  it('valid env → maps all fields correctly', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.port).toBe(4001);
    expect(cfg.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(cfg.redisUrl).toBe(validEnv.REDIS_URL);
    expect(cfg.ingestionApiKey).toBe('test-key');
    expect(cfg.ingestionStreamMaxLen).toBe(50000);
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
});
