import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the api/session module (useGuestChat → beginSignIn uses googleSignInUrl;
// SessionProvider uses getSession)
vi.mock('../api/session.js', () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  googleSignInUrl: vi.fn(() => 'http://api/auth/google'),
}));

vi.mock('../api/conversations.js', () => ({
  importConversation: vi.fn(),
}));

import { SessionProvider } from '../state/sessionContext.js';
import * as sessionApi from '../api/session.js';
import * as conversationsApi from '../api/conversations.js';
import { useGuestChat } from '../hooks/useGuestChat.js';
import { GUEST_STORAGE_KEY, IMPORT_DRAFT_KEY, createInitialGuestState } from '../state/guestMachine.js';
import type { GuestState } from '../state/guestMachine.js';
import type { ChatMessage, ConversationWithMessages, SessionResponse } from '../api/types.js';

const guestSession: SessionResponse = { authenticated: false, guest: { remaining: 1, limit: 2 } };

function bufferedState(): GuestState {
  const s = createInitialGuestState();
  return {
    ...s,
    phase: 'awaiting',
    sentUserCount: 1,
    conversation: {
      ...s.conversation,
      messages: [
        { id: 'u1', role: 'user', content: 'hello', status: 'complete', sequence: 0, createdAt: '2026-05-23T00:00:00.000Z' },
      ],
    },
  };
}

function msg(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return { id, role, content, status: 'complete', sequence: 0, createdAt: '2026-05-23T00:00:00.000Z' };
}

function bufferedWith(messages: ChatMessage[]): GuestState {
  const s = createInitialGuestState();
  return { ...s, phase: 'capped', sentUserCount: messages.length, conversation: { ...s.conversation, messages } };
}

function Probe() {
  const g = useGuestChat();
  return (
    <div>
      <span data-testid="msgcount">{g.state.conversation.messages.length}</span>
      <button onClick={g.beginSignIn}>signin</button>
    </div>
  );
}

function ImportProbe({ onResult }: { onResult: (r: ConversationWithMessages | null) => void }) {
  const g = useGuestChat();
  return <button onClick={() => void g.importOnLogin().then(onResult)}>import</button>;
}

function renderProbe() {
  return render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

const assignMock = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(sessionApi.getSession).mockResolvedValue(guestSession);
  // jsdom's location.assign is non-configurable; redefine the whole location
  // object so beginSignIn's navigation is observable and doesn't actually navigate.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign: assignMock },
  });
});

afterEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('useGuestChat sign-in handoff', () => {
  it('starts fresh when no buffer exists (no refresh persistence)', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('msgcount').textContent).toBe('0'));
    expect(sessionStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });

  it('rehydrates from the buffer on mount, then clears it (one-shot consume)', async () => {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(bufferedState()));
    renderProbe();
    // Initializer rehydrated the buffered conversation into in-memory state…
    expect(screen.getByTestId('msgcount').textContent).toBe('1');
    // …and the mount effect consumed (cleared) the buffer so a later refresh is fresh.
    await waitFor(() => expect(sessionStorage.getItem(GUEST_STORAGE_KEY)).toBeNull());
  });

  it('beginSignIn writes the current conversation to the buffer and navigates', async () => {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(bufferedState()));
    renderProbe();
    await waitFor(() => expect(sessionStorage.getItem(GUEST_STORAGE_KEY)).toBeNull());

    await act(async () => {
      screen.getByText('signin').click();
    });

    const saved = sessionStorage.getItem(GUEST_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).conversation.messages).toHaveLength(1);
    expect(assignMock).toHaveBeenCalledWith('http://api/auth/google');
  });
});

describe('useGuestChat importOnLogin (capped-orphan handling)', () => {
  it('strips the trailing unanswered message, imports the rest, and stashes it as a draft', async () => {
    const fakeConv = { id: 'conv-1', messages: [] } as unknown as ConversationWithMessages;
    vi.mocked(conversationsApi.importConversation).mockResolvedValue(fakeConv);
    sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      JSON.stringify(bufferedWith([msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'r1'), msg('u2', 'user', 'capped q')])),
    );

    let result: ConversationWithMessages | null | undefined;
    render(
      <SessionProvider>
        <ImportProbe onResult={(r) => { result = r; }} />
      </SessionProvider>,
    );

    await act(async () => {
      screen.getByText('import').click();
    });

    await waitFor(() => expect(result).toBe(fakeConv));
    // Imported only the answered exchange — the capped message was excluded…
    expect(vi.mocked(conversationsApi.importConversation)).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'r1' }],
      }),
    );
    // …and stashed for the composer pre-fill.
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBe('capped q');
  });

  it('imports nothing (returns null) when the only message was capped, but still stashes the draft', async () => {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(bufferedWith([msg('u1', 'user', 'only q')])));

    let result: ConversationWithMessages | null | undefined;
    render(
      <SessionProvider>
        <ImportProbe onResult={(r) => { result = r; }} />
      </SessionProvider>,
    );

    await act(async () => {
      screen.getByText('import').click();
    });

    await waitFor(() => expect(result).toBeNull());
    expect(vi.mocked(conversationsApi.importConversation)).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(IMPORT_DRAFT_KEY)).toBe('only q');
  });
});
