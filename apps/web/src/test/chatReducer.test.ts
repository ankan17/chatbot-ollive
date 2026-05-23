import { describe, it, expect } from 'vitest';
import { chatReducer, initialChatState } from '../state/chatReducer.js';
import type { ChatState, ChatAction } from '../state/chatReducer.js';
import type { SseStartData, SseDoneData, SseErrorData, ChatMessage } from '../api/types.js';

const FIXED_DATE = '2026-05-23T00:00:00.000Z';

function makeUserMsg(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    status: 'complete',
    sequence: 0,
    createdAt: FIXED_DATE,
  };
}

describe('chatReducer', () => {
  it('initial state is idle with empty messages', () => {
    expect(initialChatState.phase).toBe('idle');
    expect(initialChatState.messages).toHaveLength(0);
  });

  it('sendUser appends optimistic user message + phase sending', () => {
    const action: ChatAction = {
      type: 'sendUser',
      content: 'hello',
      tempUserId: 'tmp-1',
    };
    const next = chatReducer(initialChatState, action);
    expect(next.phase).toBe('sending');
    expect(next.messages).toHaveLength(1);
    const msg = next.messages[0];
    expect(msg.id).toBe('tmp-1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(msg.status).toBe('complete');
  });

  it('streamStart appends empty assistant message + currentAssistantId + phase streaming', () => {
    const afterSend = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'hello',
      tempUserId: 'tmp-1',
    });

    const startData: SseStartData = { messageId: 'msg-1', requestId: 'req-1' };
    const next = chatReducer(afterSend, { type: 'streamStart', data: startData });

    expect(next.phase).toBe('streaming');
    expect(next.currentAssistantId).toBe('msg-1');
    expect(next.messages).toHaveLength(2);

    const assistant = next.messages[1];
    expect(assistant.id).toBe('msg-1');
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('');
    expect(assistant.status).toBe('partial');
  });

  it('token×3 appends deltas in order', () => {
    let state = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'q',
      tempUserId: 'tmp-1',
    });
    state = chatReducer(state, {
      type: 'streamStart',
      data: { messageId: 'msg-1', requestId: 'req-1' },
    });
    state = chatReducer(state, { type: 'token', delta: 'Hello' });
    state = chatReducer(state, { type: 'token', delta: ' world' });
    state = chatReducer(state, { type: 'token', delta: '!' });

    const assistant = state.messages.find((m) => m.id === 'msg-1')!;
    expect(assistant.content).toBe('Hello world!');
  });

  it('streamDone marks complete + phase done + clears currentAssistantId + sets tokenCount', () => {
    let state = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'q',
      tempUserId: 'tmp-1',
    });
    state = chatReducer(state, {
      type: 'streamStart',
      data: { messageId: 'msg-1', requestId: 'req-1' },
    });
    state = chatReducer(state, { type: 'token', delta: 'Done!' });

    const doneData: SseDoneData = {
      messageId: 'msg-1',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
    state = chatReducer(state, { type: 'streamDone', data: doneData });

    expect(state.phase).toBe('done');
    expect(state.currentAssistantId).toBeUndefined();
    const assistant = state.messages.find((m) => m.id === 'msg-1')!;
    expect(assistant.status).toBe('complete');
    expect(assistant.tokenCount).toBe(5); // completionTokens
  });

  it('streamError marks assistant status error + stores error + phase error', () => {
    let state = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'q',
      tempUserId: 'tmp-1',
    });
    state = chatReducer(state, {
      type: 'streamStart',
      data: { messageId: 'msg-1', requestId: 'req-1' },
    });
    state = chatReducer(state, { type: 'token', delta: 'partial' });

    const errorData: SseErrorData = { code: 'provider_error', message: 'oops' };
    state = chatReducer(state, { type: 'streamError', data: errorData });

    expect(state.phase).toBe('error');
    expect(state.error).toEqual(errorData);
    const assistant = state.messages.find((m) => m.id === 'msg-1')!;
    expect(assistant.status).toBe('error');
  });

  it('cancelled keeps partial content + status partial + phase cancelled', () => {
    let state = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'q',
      tempUserId: 'tmp-1',
    });
    state = chatReducer(state, {
      type: 'streamStart',
      data: { messageId: 'msg-1', requestId: 'req-1' },
    });
    state = chatReducer(state, { type: 'token', delta: 'partial content' });
    state = chatReducer(state, { type: 'cancelled' });

    expect(state.phase).toBe('cancelled');
    const assistant = state.messages.find((m) => m.id === 'msg-1')!;
    expect(assistant.status).toBe('partial');
    expect(assistant.content).toBe('partial content');
  });

  it('token with no currentAssistantId is a no-op', () => {
    // State where no assistant message is being built
    const state: ChatState = {
      ...initialChatState,
      messages: [makeUserMsg('u1', 'hi')],
      phase: 'sending',
      currentAssistantId: undefined,
    };
    const next = chatReducer(state, { type: 'token', delta: 'should-be-ignored' });
    expect(next).toBe(state); // reference equality — same object (no mutation)
  });

  it('reset replaces messages + phase idle', () => {
    let state = chatReducer(initialChatState, {
      type: 'sendUser',
      content: 'q',
      tempUserId: 'tmp-1',
    });
    const newMessages: ChatMessage[] = [makeUserMsg('a', 'previous')];
    state = chatReducer(state, { type: 'reset', messages: newMessages });

    expect(state.phase).toBe('idle');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe('a');
    expect(state.currentAssistantId).toBeUndefined();
    expect(state.error).toBeUndefined();
  });
});
