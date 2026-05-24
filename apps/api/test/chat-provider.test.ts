/**
 * Unit tests for buildChatProvider — routing + key-gating.
 *
 * Mocking strategy: vi.mock('@ollive/llm-sdk', ...) with importActual so
 * withLogging and createRoutingProvider stay REAL (they're tested for real
 * behaviour) but googleProviderFactory / anthropicProviderFactory are replaced
 * with fakes whose streamChat yields a marker delta.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { LLMProvider, ChatRequest, StreamChunk, CallContext, LogSink } from '@ollive/llm-sdk';

// ---------------------------------------------------------------------------
// Fake providers — each yields a unique marker delta so tests can assert routing
// ---------------------------------------------------------------------------

function makeMarkerProvider(marker: string): LLMProvider {
  return {
    name: marker.toLowerCase(),
    async *streamChat(
      _req: ChatRequest,
      _opts?: { signal?: AbortSignal; context?: CallContext },
    ): AsyncIterable<StreamChunk> {
      yield { delta: marker };
      yield { usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: 'stop' };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock @ollive/llm-sdk — keep withLogging + createRoutingProvider real,
// replace factory functions with fakes.
// ---------------------------------------------------------------------------

vi.mock('@ollive/llm-sdk', async (importActual) => {
  const actual = await importActual<typeof import('@ollive/llm-sdk')>();
  return {
    ...actual,
    googleProviderFactory: vi.fn(() => makeMarkerProvider('GOOGLE')),
    anthropicProviderFactory: vi.fn(() => makeMarkerProvider('ANTHROPIC')),
  };
});

// Import AFTER the mock is registered
const { buildChatProvider } = await import('../src/chat/provider.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
} as const;

const stubSink: LogSink = { enqueue() {} };

async function collectDeltas(provider: LLMProvider, model: string): Promise<string[]> {
  const deltas: string[] = [];
  for await (const chunk of provider.streamChat({ model, messages: [] })) {
    if (chunk.delta !== undefined) deltas.push(chunk.delta);
  }
  return deltas;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildChatProvider — routing', () => {
  it('routes gemini-2.5-flash to GOOGLE when ANTHROPIC_API_KEY is set', async () => {
    const config = loadConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'dummy-anthropic-key' });
    const provider = buildChatProvider(config, stubSink);

    const deltas = await collectDeltas(provider, 'gemini-2.5-flash');

    expect(deltas).toContain('GOOGLE');
    expect(deltas).not.toContain('ANTHROPIC');
  });

  it('routes claude-sonnet-4-6 to ANTHROPIC when ANTHROPIC_API_KEY is set', async () => {
    const config = loadConfig({ ...baseEnv, ANTHROPIC_API_KEY: 'dummy-anthropic-key' });
    const provider = buildChatProvider(config, stubSink);

    const deltas = await collectDeltas(provider, 'claude-sonnet-4-6');

    expect(deltas).toContain('ANTHROPIC');
    expect(deltas).not.toContain('GOOGLE');
  });

  it('throws "No provider for model" when ANTHROPIC_API_KEY is not set and model is claude-sonnet-4-6', async () => {
    const config = loadConfig(baseEnv); // no ANTHROPIC_API_KEY
    const provider = buildChatProvider(config, stubSink);

    await expect(
      (async () => {
        for await (const _ of provider.streamChat({ model: 'claude-sonnet-4-6', messages: [] })) {
          // consume
        }
      })(),
    ).rejects.toThrow(/No provider for model/);
  });
});
