import { useCallback, useReducer, useRef } from 'react';
import { chatReducer, initialChatState } from '../state/chatReducer.js';
import { streamChat } from '../api/stream.js';
import { buildUrl } from '../api/config.js';
import type { ChatMessage, SseDoneData, SseErrorData } from '../api/types.js';

export interface UseChatResult {
  state: ReturnType<typeof chatReducer>;
  isStreaming: boolean;
  send(content: string): void;
  stop(): void;
  reset(messages: ChatMessage[]): void;
}

export function useChat(
  conversationId: string,
  onFirstDone?: (d: SseDoneData) => void,
): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const abortRef = useRef<AbortController | null>(null);
  // Track whether we've already fired onFirstDone for the current stream
  const firedFirstDone = useRef(false);

  const send = useCallback(
    (content: string) => {
      const tempUserId = `tmp-${Date.now()}`;
      dispatch({ type: 'sendUser', content, tempUserId });

      const ac = new AbortController();
      abortRef.current = ac;
      firedFirstDone.current = false;

      const url = buildUrl(`/v1/conversations/${conversationId}/messages`);

      streamChat(url, { content }, {
        signal: ac.signal,
        onStart(data) {
          dispatch({ type: 'streamStart', data });
        },
        onToken(data) {
          dispatch({ type: 'token', delta: data.delta });
        },
        onDone(data) {
          dispatch({ type: 'streamDone', data });
          if (!firedFirstDone.current) {
            firedFirstDone.current = true;
            onFirstDone?.(data);
          }
        },
        onError(data: SseErrorData) {
          dispatch({ type: 'streamError', data });
        },
      }).catch((err: unknown) => {
        const name = (err as { name?: string })?.name;
        if (name === 'AbortError') {
          dispatch({ type: 'cancelled' });
        } else {
          const msg =
            err instanceof Error ? err.message : 'An error occurred';
          const errorData: SseErrorData = {
            code: 'provider_error',
            message: msg,
          };
          dispatch({ type: 'streamError', data: errorData });
        }
      });
    },
    [conversationId, onFirstDone],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback((messages: ChatMessage[]) => {
    dispatch({ type: 'reset', messages });
  }, []);

  const isStreaming = state.phase === 'sending' || state.phase === 'streaming';

  return { state, isStreaming, send, stop, reset };
}
