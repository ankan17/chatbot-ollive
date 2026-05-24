import { describe, it, expect, vi } from 'vitest';
import { createRoutingProvider } from '../src/providers/router.js';
import type { LLMProvider, StreamChunk } from '../src/types.js';

// ---------------------------------------------------------------------------
// Minimal fake provider factory
// ---------------------------------------------------------------------------
function makeFake(name: string, chunks: StreamChunk[]): LLMProvider {
  return {
    name,
    async *streamChat() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createRoutingProvider', () => {
  it('routes to the provider returned by resolve based on model', async () => {
    const fakeA = makeFake('a', [{ delta: 'from-a' }]);
    const fakeB = makeFake('b', [{ delta: 'from-b' }]);

    const router = createRoutingProvider((model) => {
      if (model === 'a') return fakeA;
      if (model === 'b') return fakeB;
      return undefined;
    });

    const chunksA: StreamChunk[] = [];
    for await (const chunk of router.streamChat({ model: 'a', messages: [] })) {
      chunksA.push(chunk);
    }
    expect(chunksA).toEqual([{ delta: 'from-a' }]);

    const chunksB: StreamChunk[] = [];
    for await (const chunk of router.streamChat({ model: 'b', messages: [] })) {
      chunksB.push(chunk);
    }
    expect(chunksB).toEqual([{ delta: 'from-b' }]);
  });

  it('throws when resolve returns undefined', async () => {
    const router = createRoutingProvider(() => undefined);

    await expect(
      (async () => {
        for await (const _ of router.streamChat({ model: 'x', messages: [] })) {
          // consume
        }
      })(),
    ).rejects.toThrow("No provider for model 'x'");
  });

  it('calls resolve with the request model value', async () => {
    const resolve = vi.fn((model: string): LLMProvider | undefined =>
      makeFake(model, [{ delta: 'ok' }]),
    );

    const router = createRoutingProvider(resolve);
    // consume the stream so the generator body executes
    for await (const _ of router.streamChat({ model: 'gpt-test', messages: [] })) {
      // consume
    }

    expect(resolve).toHaveBeenCalledWith('gpt-test');
  });

  it('has name "router"', () => {
    const router = createRoutingProvider(() => undefined);
    expect(router.name).toBe('router');
  });
});
