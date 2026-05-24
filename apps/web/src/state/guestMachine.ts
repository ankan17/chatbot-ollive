import type { ChatMessage, GuestMessageInput } from '../api/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GuestConversation {
  clientConversationId: string;
  messages: ChatMessage[];
  createdAt: string;
}

export type GuestPhase = 'idle' | 'sending' | 'streaming' | 'awaiting' | 'capped' | 'error';

export interface GuestState {
  conversation: GuestConversation;
  phase: GuestPhase;
  sentUserCount: number;
  currentAssistantId?: string;
  error?: { code: string; message: string };
}

export type GuestAction =
  | { type: 'sendUser'; content: string; id: string }
  | { type: 'streamStart'; assistantId: string }
  | { type: 'token'; delta: string }
  | { type: 'streamDone' }
  | { type: 'streamError'; code: string; message: string }
  | { type: 'cancelled' }
  | { type: 'capped' }
  | { type: 'hydrate'; state: GuestState };

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function guestReducer(state: GuestState, action: GuestAction): GuestState {
  switch (action.type) {
    case 'sendUser': {
      const userMsg: ChatMessage = {
        id: action.id,
        role: 'user',
        content: action.content,
        status: 'complete',
        sequence: state.conversation.messages.length,
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: [...state.conversation.messages, userMsg],
        },
        phase: 'sending',
        sentUserCount: state.sentUserCount + 1,
        error: undefined,
      };
    }

    case 'streamStart': {
      const assistantMsg: ChatMessage = {
        id: action.assistantId,
        role: 'assistant',
        content: '',
        status: 'partial',
        sequence: state.conversation.messages.length,
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: [...state.conversation.messages, assistantMsg],
        },
        currentAssistantId: action.assistantId,
        phase: 'streaming',
      };
    }

    case 'token': {
      if (!state.currentAssistantId) return state;
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: state.conversation.messages.map((m) =>
            m.id === state.currentAssistantId
              ? { ...m, content: m.content + action.delta }
              : m,
          ),
        },
      };
    }

    case 'streamDone': {
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: state.conversation.messages.map((m) =>
            m.id === state.currentAssistantId ? { ...m, status: 'complete' } : m,
          ),
        },
        phase: 'awaiting',
        currentAssistantId: undefined,
      };
    }

    case 'streamError': {
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: state.conversation.messages.map((m) =>
            m.id === state.currentAssistantId
              ? { ...m, status: 'error', errorMessage: action.message }
              : m,
          ),
        },
        phase: 'error',
        error: { code: action.code, message: action.message },
      };
    }

    case 'cancelled': {
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: state.conversation.messages.map((m) =>
            m.id === state.currentAssistantId ? { ...m, status: 'partial' } : m,
          ),
        },
        phase: 'awaiting',
        // sentUserCount unchanged
      };
    }

    case 'capped': {
      // No assistant message added — just flip phase
      return { ...state, phase: 'capped' };
    }

    case 'hydrate': {
      return action.state;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createInitialGuestState(): GuestState {
  return {
    conversation: {
      clientConversationId: crypto.randomUUID(),
      messages: [],
      createdAt: new Date().toISOString(),
    },
    phase: 'idle',
    sentUserCount: 0,
  };
}

// ─── Sign-in handoff buffer ───────────────────────────────────────────────────
// Guest chat is NOT persisted during normal use — a plain refresh or tab close
// starts fresh. The one exception is signing in, which is a full-page OAuth
// redirect (window.location.assign) that destroys in-memory state. So the guest
// conversation is buffered to `sessionStorage` only at sign-in time, read back
// once on return, then cleared. `sessionStorage` survives the same-tab redirect
// round-trip but not a tab close, reinforcing the no-persistence intent.

export const GUEST_STORAGE_KEY = 'ollive.guest.v1';

export function loadGuestState(): GuestState | undefined {
  try {
    const raw = sessionStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GuestState;
    // Basic structural validation
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.conversation ||
      !Array.isArray(parsed.conversation.messages) ||
      typeof parsed.phase !== 'string'
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveGuestState(state: GuestState): void {
  try {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Swallow quota/serialization errors — a storage failure must not crash the caller
  }
}

export function clearGuestState(): void {
  sessionStorage.removeItem(GUEST_STORAGE_KEY);
}

// ─── Import mapping ───────────────────────────────────────────────────────────

export function toImportRequest(c: GuestConversation): {
  clientConversationId: string;
  messages: GuestMessageInput[];
} {
  return {
    clientConversationId: c.clientConversationId,
    messages: c.messages
      .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => ({ role: m.role, content: m.content })),
  };
}

/** sessionStorage key for a message pre-filled into the composer after import. */
export const IMPORT_DRAFT_KEY = 'ollive.importDraft.v1';

/**
 * Split a guest conversation for import-on-login.
 *
 * A conversation that ends with an unanswered user message means the guest hit
 * the free cap before a reply streamed (the cap is enforced before generation,
 * so the message was never processed). That message is excluded from the import
 * and returned as `pendingDraft` — the caller pre-fills it into the composer so
 * the now-authed user can send it. Any other conversation ends with an assistant
 * message and imports unchanged.
 */
export function splitForImport(c: GuestConversation): {
  request: { clientConversationId: string; messages: GuestMessageInput[] };
  pendingDraft: string | null;
} {
  const last = c.messages[c.messages.length - 1];
  const orphan = last?.role === 'user' ? last : null;
  const messages = orphan ? c.messages.slice(0, -1) : c.messages;
  return {
    request: toImportRequest({ ...c, messages }),
    pendingDraft: orphan ? orphan.content : null,
  };
}
