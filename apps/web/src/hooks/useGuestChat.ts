import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  guestReducer,
  createInitialGuestState,
  loadGuestState,
  saveGuestState,
  clearGuestState,
  toImportRequest,
} from '../state/guestMachine.js';
import type { GuestState } from '../state/guestMachine.js';
import { streamChat } from '../api/stream.js';
import { buildUrl } from '../api/config.js';
import { importConversation } from '../api/conversations.js';
import { ApiError } from '../api/errors.js';
import { useSession } from '../state/sessionContext.js';
import type { ConversationWithMessages } from '../api/types.js';

export interface UseGuestChatResult {
  state: GuestState;
  remaining: number;
  limit: number;
  isStreaming: boolean;
  isCapped: boolean;
  send(content: string): void;
  stop(): void;
  importOnLogin(): Promise<ConversationWithMessages>;
}

export function useGuestChat(): UseGuestChatResult {
  const { guest, refresh } = useSession();
  const [state, dispatch] = useReducer(guestReducer, undefined, () => {
    const saved = loadGuestState();
    return saved ?? createInitialGuestState();
  });

  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Hydrate from localStorage on mount if a saved state exists
  // (The initializer already handles this via useReducer's init function)

  // Persist on every state change
  useEffect(() => {
    saveGuestState(state);
  }, [state]);

  const send = useCallback(
    (content: string) => {
      const id = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      dispatch({ type: 'sendUser', content, id });

      const ac = new AbortController();
      abortRef.current = ac;

      // Build the message history for context (include the user message we just added)
      const allMessages = [
        ...stateRef.current.conversation.messages,
        { role: 'user' as const, content },
      ];

      const body = {
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        content,
      };

      streamChat(buildUrl('/v1/guest/messages'), body, {
        signal: ac.signal,
        onStart() {
          dispatch({ type: 'streamStart', assistantId });
        },
        onToken(d) {
          dispatch({ type: 'token', delta: d.delta });
        },
        onDone() {
          dispatch({ type: 'streamDone' });
          void refresh();
        },
        onError(d) {
          dispatch({ type: 'streamError', code: d.code, message: d.message });
        },
      }).catch((err: unknown) => {
        const isApiError = err instanceof ApiError;
        if (isApiError && err.code === 'login_required') {
          dispatch({ type: 'capped' });
          return;
        }
        const name = (err as { name?: string })?.name;
        if (name === 'AbortError') {
          dispatch({ type: 'cancelled' });
          return;
        }
        const msg = err instanceof Error ? err.message : 'An error occurred';
        dispatch({ type: 'streamError', code: 'provider_error', message: msg });
      });
    },
    [refresh],
  );

  // Abort in-flight stream on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const importOnLogin = useCallback(async (): Promise<ConversationWithMessages> => {
    const req = toImportRequest(state.conversation);
    const result = await importConversation(req);
    clearGuestState();
    return result;
  }, [state.conversation]);

  const isStreaming = state.phase === 'sending' || state.phase === 'streaming';
  const isCapped = state.phase === 'capped';
  const remaining = Math.max(0, guest?.remaining ?? 0);
  const limit = guest?.limit ?? 0;

  return { state, remaining, limit, isStreaming, isCapped, send, stop, importOnLogin };
}
