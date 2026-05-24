import type { LLMProvider, ChatRequest, StreamChunk, CallContext } from '../types.js';

export function createRoutingProvider(
  resolve: (model: string) => LLMProvider | undefined,
): LLMProvider {
  return {
    name: 'router',
    async *streamChat(
      req: ChatRequest,
      opts?: { signal?: AbortSignal; context?: CallContext },
    ): AsyncIterable<StreamChunk> {
      const p = resolve(req.model);
      if (!p) throw new Error(`No provider for model '${req.model}'`);
      yield* p.streamChat(req, opts);
    },
  };
}
