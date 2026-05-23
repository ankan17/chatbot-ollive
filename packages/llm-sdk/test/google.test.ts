import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ai module — must be declared before any import of GoogleProvider
// Use vi.hoisted so the spy is available when the factory is hoisted
// ---------------------------------------------------------------------------
const { streamTextSpy } = vi.hoisted(() => {
  return { streamTextSpy: vi.fn() };
});

vi.mock('ai', () => ({
  streamText: streamTextSpy,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({ modelId })),
  google: (modelId: string) => ({ modelId }),
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { GoogleProvider } from '../src/providers/google.js';
import { ProviderRegistry } from '../src/registry.js';
import type { StreamChunk } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helper: builds a fake streamText result
// ---------------------------------------------------------------------------
function fakeStreamResult(options: {
  deltas: string[];
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason: string;
}) {
  async function* textStream() {
    for (const delta of options.deltas) {
      yield delta;
    }
  }
  return {
    textStream: textStream(),
    usage: Promise.resolve(options.usage),
    finishReason: Promise.resolve(options.finishReason),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GoogleProvider', () => {
  beforeEach(() => {
    streamTextSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('has name "google"', () => {
    expect(new GoogleProvider().name).toBe('google');
  });

  it('yields delta chunks then a final usage+finishReason chunk', async () => {
    const deltas = ['Day ', '2 we ', 'head out.'];
    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas,
        usage: { inputTokens: 420, outputTokens: 188, totalTokens: 608 },
        finishReason: 'stop',
      }),
    );

    const provider = new GoogleProvider();
    const chunks: StreamChunk[] = [];

    // collect all chunks
    for await (const chunk of provider.streamChat({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      chunks.push(chunk);
    }

    // First three should be delta chunks
    expect(chunks[0]).toEqual({ delta: 'Day ' });
    expect(chunks[1]).toEqual({ delta: '2 we ' });
    expect(chunks[2]).toEqual({ delta: 'head out.' });

    // Last chunk: normalized usage + finishReason
    const last = chunks[chunks.length - 1]!;
    expect(last.usage).toEqual({
      promptTokens: 420,
      completionTokens: 188,
      totalTokens: 608,
    });
    expect(last.finishReason).toBe('stop');
  });

  it('forwards args to streamText: model, messages, temperature, maxOutputTokens, abortSignal', async () => {
    const signal = new AbortController().signal;
    const messages = [{ role: 'user' as const, content: 'test' }];

    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      }),
    );

    const provider = new GoogleProvider();
    // consume the stream
    for await (const _ of provider.streamChat(
      { model: 'gemini-2.5-flash', messages, temperature: 0.7, maxOutputTokens: 1024 },
      { signal },
    )) {
      // drain
    }

    expect(streamTextSpy).toHaveBeenCalledTimes(1);
    const callArg = streamTextSpy.mock.calls[0]![0];
    expect(callArg.abortSignal).toBe(signal);
    expect(callArg.temperature).toBe(0.7);
    expect(callArg.maxOutputTokens).toBe(1024);
    expect(callArg.messages).toBe(messages);
  });

  it('normalizes usage defensively when inputTokens is undefined', async () => {
    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas: [],
        usage: { inputTokens: undefined, outputTokens: 5, totalTokens: undefined },
        finishReason: 'stop',
      }),
    );

    const provider = new GoogleProvider();
    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.streamChat({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    const last = chunks[chunks.length - 1]!;
    expect(last.usage).toEqual({
      promptTokens: 0,
      completionTokens: 5,
      totalTokens: 5,
    });
  });
});

describe('ProviderRegistry', () => {
  it('registers and creates a provider', () => {
    const reg = new ProviderRegistry();
    const provider = new GoogleProvider();
    reg.register('google', () => provider);
    expect(reg.has('google')).toBe(true);
    expect(reg.create('google')).toBe(provider);
  });

  it('has() returns false for unregistered name', () => {
    const reg = new ProviderRegistry();
    expect(reg.has('nonexistent')).toBe(false);
  });

  it('create() throws for unregistered name', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.create('missing')).toThrow(
      'No LLM provider registered for "missing"',
    );
  });

  it('names() returns all registered names', () => {
    const reg = new ProviderRegistry();
    reg.register('a', () => new GoogleProvider()).register('b', () => new GoogleProvider());
    expect(reg.names()).toEqual(['a', 'b']);
  });

  it('register is chainable', () => {
    const reg = new ProviderRegistry();
    expect(reg.register('x', () => new GoogleProvider())).toBe(reg);
  });
});
