import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ai module — must be declared before any import of AnthropicProvider
// Use vi.hoisted so the spy is available when the factory is hoisted
// ---------------------------------------------------------------------------
const { streamTextSpy } = vi.hoisted(() => {
  return { streamTextSpy: vi.fn() };
});

vi.mock('ai', () => ({
  streamText: streamTextSpy,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({ modelId })),
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { AnthropicProvider } from '../src/providers/anthropic.js';
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

describe('AnthropicProvider', () => {
  beforeEach(() => {
    streamTextSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('has name "anthropic"', () => {
    expect(new AnthropicProvider().name).toBe('anthropic');
  });

  it('yields delta chunks then a final usage+finishReason chunk', async () => {
    const deltas = ['Hello ', 'world', '!'];
    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      }),
    );

    const provider = new AnthropicProvider();
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.streamChat({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      chunks.push(chunk);
    }

    // First three should be delta chunks
    expect(chunks[0]).toEqual({ delta: 'Hello ' });
    expect(chunks[1]).toEqual({ delta: 'world' });
    expect(chunks[2]).toEqual({ delta: '!' });

    // Last chunk: normalized usage + finishReason
    const last = chunks[chunks.length - 1];
    expect(last.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(last.finishReason).toBe('stop');
  });

  it('forwards opts.signal (abortSignal) into streamText', async () => {
    const signal = new AbortController().signal;
    const messages = [{ role: 'user' as const, content: 'test' }];

    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      }),
    );

    const provider = new AnthropicProvider();
    for await (const _ of provider.streamChat(
      { model: 'claude-3-5-sonnet-20241022', messages, temperature: 0.5, maxOutputTokens: 512 },
      { signal },
    )) {
      // drain
    }

    expect(streamTextSpy).toHaveBeenCalledTimes(1);
    const callArg = streamTextSpy.mock.calls[0][0];
    expect(callArg.abortSignal).toBe(signal);
    expect(callArg.temperature).toBe(0.5);
    expect(callArg.maxOutputTokens).toBe(512);
    expect(callArg.messages).toBe(messages);
  });

  it('normalizes usage defensively when inputTokens is undefined', async () => {
    streamTextSpy.mockReturnValue(
      fakeStreamResult({
        deltas: [],
        usage: { inputTokens: undefined, outputTokens: 7, totalTokens: undefined },
        finishReason: 'stop',
      }),
    );

    const provider = new AnthropicProvider();
    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.streamChat({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk);
    }

    const last = chunks[chunks.length - 1];
    expect(last.usage).toEqual({
      promptTokens: 0,
      completionTokens: 7,
      totalTokens: 7,
    });
  });
});
