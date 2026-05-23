import type { ChatMessage, SseStartData, SseDoneData, SseErrorData } from '../api/types.js';

export type StreamPhase = 'idle' | 'sending' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface ChatState {
  messages: ChatMessage[];
  phase: StreamPhase;
  currentAssistantId?: string;
  error?: SseErrorData;
}

export type ChatAction =
  | { type: 'reset'; messages: ChatMessage[] }
  | { type: 'sendUser'; content: string; tempUserId: string }
  | { type: 'streamStart'; data: SseStartData }
  | { type: 'token'; delta: string }
  | { type: 'streamDone'; data: SseDoneData }
  | { type: 'streamError'; data: SseErrorData }
  | { type: 'cancelled' };

export const initialChatState: ChatState = {
  messages: [],
  phase: 'idle',
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset': {
      return {
        messages: action.messages,
        phase: 'idle',
        currentAssistantId: undefined,
        error: undefined,
      };
    }

    case 'sendUser': {
      const userMsg: ChatMessage = {
        id: action.tempUserId,
        role: 'user',
        content: action.content,
        status: 'complete',
        sequence: state.messages.length,
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        messages: [...state.messages, userMsg],
        phase: 'sending',
        error: undefined,
      };
    }

    case 'streamStart': {
      const assistantMsg: ChatMessage = {
        id: action.data.messageId ?? `local-${Date.now()}`,
        role: 'assistant',
        content: '',
        status: 'partial',
        sequence: state.messages.length,
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        currentAssistantId: assistantMsg.id,
        phase: 'streaming',
      };
    }

    case 'token': {
      if (!state.currentAssistantId) return state; // no-op; return same reference
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.currentAssistantId
            ? { ...m, content: m.content + action.delta }
            : m,
        ),
      };
    }

    case 'streamDone': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.currentAssistantId
            ? { ...m, status: 'complete', tokenCount: action.data.usage.completionTokens }
            : m,
        ),
        phase: 'done',
        currentAssistantId: undefined,
      };
    }

    case 'streamError': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.currentAssistantId
            ? { ...m, status: 'error', errorReason: action.data.message }
            : m,
        ),
        phase: 'error',
        error: action.data,
      };
    }

    case 'cancelled': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.currentAssistantId ? { ...m, status: 'partial' } : m,
        ),
        phase: 'cancelled',
      };
    }
  }
}
