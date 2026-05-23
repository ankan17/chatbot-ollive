import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  guestReducer,
  createInitialGuestState,
  loadGuestState,
  saveGuestState,
  clearGuestState,
  toImportRequest,
  GUEST_STORAGE_KEY,
} from '../state/guestMachine.js';
import type { GuestState, GuestAction } from '../state/guestMachine.js';
import type { ChatMessage } from '../api/types.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeUserMsg(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    status: 'complete',
    sequence: 0,
    createdAt: '2026-05-23T00:00:00.000Z',
  };
}

function makeAssistantMsg(id: string, content: string, status: ChatMessage['status'] = 'complete'): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    status,
    sequence: 1,
    createdAt: '2026-05-23T00:00:01.000Z',
  };
}

// ─── createInitialGuestState ──────────────────────────────────────────────────

describe('createInitialGuestState', () => {
  it('creates a UUID clientConversationId', () => {
    const s = createInitialGuestState();
    expect(s.conversation.clientConversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('starts with empty messages, phase idle, sentUserCount 0', () => {
    const s = createInitialGuestState();
    expect(s.conversation.messages).toHaveLength(0);
    expect(s.phase).toBe('idle');
    expect(s.sentUserCount).toBe(0);
  });

  it('two calls produce different clientConversationIds', () => {
    const a = createInitialGuestState();
    const b = createInitialGuestState();
    expect(a.conversation.clientConversationId).not.toBe(b.conversation.clientConversationId);
  });
});

// ─── guestReducer ─────────────────────────────────────────────────────────────

describe('guestReducer', () => {
  let initial: GuestState;

  beforeEach(() => {
    initial = createInitialGuestState();
  });

  it('sendUser: appends user message + increments sentUserCount + phase sending', () => {
    const next = guestReducer(initial, { type: 'sendUser', content: 'hello', id: 'u1' });
    expect(next.phase).toBe('sending');
    expect(next.sentUserCount).toBe(1);
    expect(next.conversation.messages).toHaveLength(1);
    const msg = next.conversation.messages[0];
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(msg.id).toBe('u1');
    expect(msg.status).toBe('complete');
  });

  it('streamStart: appends empty assistant message + sets currentAssistantId + phase streaming', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    s = guestReducer(s, { type: 'streamStart', assistantId: 'a1' });
    expect(s.phase).toBe('streaming');
    expect(s.currentAssistantId).toBe('a1');
    expect(s.conversation.messages).toHaveLength(2);
    const assistant = s.conversation.messages[1];
    expect(assistant.id).toBe('a1');
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('');
    expect(assistant.status).toBe('partial');
  });

  it('token×N: appends deltas in order to current assistant', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    s = guestReducer(s, { type: 'streamStart', assistantId: 'a1' });
    s = guestReducer(s, { type: 'token', delta: 'Hello' });
    s = guestReducer(s, { type: 'token', delta: ' world' });
    s = guestReducer(s, { type: 'token', delta: '!' });
    const assistant = s.conversation.messages.find((m) => m.id === 'a1')!;
    expect(assistant.content).toBe('Hello world!');
  });

  it('streamDone: marks assistant complete + phase awaiting + clears currentAssistantId', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    s = guestReducer(s, { type: 'streamStart', assistantId: 'a1' });
    s = guestReducer(s, { type: 'token', delta: 'Done!' });
    s = guestReducer(s, { type: 'streamDone' });
    expect(s.phase).toBe('awaiting');
    expect(s.currentAssistantId).toBeUndefined();
    const assistant = s.conversation.messages.find((m) => m.id === 'a1')!;
    expect(assistant.status).toBe('complete');
  });

  it('streamError: marks assistant error + stores error + phase error', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    s = guestReducer(s, { type: 'streamStart', assistantId: 'a1' });
    s = guestReducer(s, { type: 'streamError', code: 'provider_error', message: 'oops' });
    expect(s.phase).toBe('error');
    expect(s.error).toEqual({ code: 'provider_error', message: 'oops' });
    const assistant = s.conversation.messages.find((m) => m.id === 'a1')!;
    expect(assistant.status).toBe('error');
  });

  it('cancelled: marks assistant partial + phase awaiting + sentUserCount unchanged', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    const countBefore = s.sentUserCount;
    s = guestReducer(s, { type: 'streamStart', assistantId: 'a1' });
    s = guestReducer(s, { type: 'token', delta: 'partial' });
    s = guestReducer(s, { type: 'cancelled' });
    expect(s.phase).toBe('awaiting');
    expect(s.sentUserCount).toBe(countBefore);
    const assistant = s.conversation.messages.find((m) => m.id === 'a1')!;
    expect(assistant.status).toBe('partial');
  });

  it('capped before streamStart: phase capped, no assistant message added', () => {
    let s = guestReducer(initial, { type: 'sendUser', content: 'q', id: 'u1' });
    const msgCountBefore = s.conversation.messages.length;
    s = guestReducer(s, { type: 'capped' });
    expect(s.phase).toBe('capped');
    expect(s.conversation.messages).toHaveLength(msgCountBefore);
  });

  it('hydrate: replaces whole state', () => {
    const replacement: GuestState = {
      ...createInitialGuestState(),
      phase: 'awaiting',
      sentUserCount: 3,
      conversation: {
        clientConversationId: 'hydrated-id',
        messages: [makeUserMsg('u1', 'hi')],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const s = guestReducer(initial, { type: 'hydrate', state: replacement });
    expect(s).toEqual(replacement);
  });
});

// ─── localStorage round-trip ──────────────────────────────────────────────────

describe('localStorage round-trip', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('save then load deep-equals original state', () => {
    const state = createInitialGuestState();
    const modded: GuestState = {
      ...state,
      sentUserCount: 2,
      phase: 'awaiting',
      conversation: {
        ...state.conversation,
        messages: [makeUserMsg('u1', 'hello'), makeAssistantMsg('a1', 'world')],
      },
    };
    saveGuestState(modded);
    const loaded = loadGuestState();
    expect(loaded).toEqual(modded);
  });

  it('corrupt JSON → undefined', () => {
    localStorage.setItem(GUEST_STORAGE_KEY, '{not json}');
    expect(loadGuestState()).toBeUndefined();
  });

  it('absent key → undefined', () => {
    expect(loadGuestState()).toBeUndefined();
  });

  it('clearGuestState removes the key', () => {
    const state = createInitialGuestState();
    saveGuestState(state);
    clearGuestState();
    expect(localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });
});

// ─── toImportRequest ──────────────────────────────────────────────────────────

describe('toImportRequest', () => {
  it('maps 1 user + 1 assistant to ordered {role, content}[] — NO id/sequence/createdAt', () => {
    const conv = {
      clientConversationId: 'test-id',
      messages: [
        makeUserMsg('u1', 'hello'),
        makeAssistantMsg('a1', 'hi there'),
      ],
      createdAt: '2026-05-23T00:00:00.000Z',
    };
    const req = toImportRequest(conv);
    expect(req.clientConversationId).toBe('test-id');
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(req.messages[1]).toEqual({ role: 'assistant', content: 'hi there' });
    // Ensure NO extra fields leak through
    const m0 = req.messages[0] as unknown as Record<string, unknown>;
    expect(m0['id']).toBeUndefined();
    expect(m0['sequence']).toBeUndefined();
    expect(m0['createdAt']).toBeUndefined();
  });

  it('excludes system messages', () => {
    const systemMsg: ChatMessage = {
      id: 'sys1',
      role: 'system',
      content: 'You are a helpful assistant.',
      status: 'complete',
      sequence: -1,
      createdAt: '2026-05-23T00:00:00.000Z',
    };
    const conv = {
      clientConversationId: 'test-id',
      messages: [systemMsg, makeUserMsg('u1', 'hello')],
      createdAt: '2026-05-23T00:00:00.000Z',
    };
    const req = toImportRequest(conv);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
  });
});
