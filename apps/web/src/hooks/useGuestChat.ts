import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  guestReducer,
  createInitialGuestState,
  loadGuestState,
  saveGuestState,
  clearGuestState,
  splitForImport,
  IMPORT_DRAFT_KEY,
} from '../state/guestMachine.js';
import type { GuestState } from '../state/guestMachine.js';
import { streamChat } from '../api/stream.js';
import { buildUrl } from '../api/config.js';
import { googleSignInUrl } from '../api/session.js';
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
  send: (content: string) => void;
  stop: () => void;
  beginSignIn: () => void;
  importOnLogin: () => Promise<ConversationWithMessages | null>;
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

  // The initializer above rehydrates in-memory state from the sign-in handoff
  // buffer when we've just returned from an OAuth redirect. Consume it once:
  // clear the buffer on mount so a later plain refresh (or tab close) starts
  // fresh — guest chat is never persisted during normal use.
  useEffect(() => {
    clearGuestState();
  }, []);

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

  // Buffer the current guest conversation so it survives the full-page OAuth
  // redirect, then navigate to Google sign-in. This is the only path that writes
  // the handoff buffer — normal chatting never persists.
  const beginSignIn = useCallback(() => {
    saveGuestState(stateRef.current);
    window.location.assign(googleSignInUrl());
  }, []);

  const importOnLogin = useCallback(async (): Promise<ConversationWithMessages | null> => {
    const { request, pendingDraft } = splitForImport(state.conversation);
    // A capped guest's unanswered message is excluded from the import and instead
    // pre-filled into the composer so the now-authed user can send it.
    if (pendingDraft) sessionStorage.setItem(IMPORT_DRAFT_KEY, pendingDraft);
    clearGuestState();
    // Orphan-only conversation (the very first message was capped): nothing to import.
    if (request.messages.length === 0) return null;
    return importConversation(request);
  }, [state.conversation]);

  const isStreaming = state.phase === 'sending' || state.phase === 'streaming';
  const isCapped = state.phase === 'capped';
  const remaining = Math.max(0, guest?.remaining ?? 0);
  const limit = guest?.limit ?? 0;

  return { state, remaining, limit, isStreaming, isCapped, send, stop, beginSignIn, importOnLogin };
}
