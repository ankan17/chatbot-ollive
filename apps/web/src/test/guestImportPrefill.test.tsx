import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ChatMessage, SessionUser } from '../api/types.js';

// ── Mock the session as authenticated (simulating a return from OAuth sign-in) ──
vi.mock('../state/sessionContext.js', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => mockSession,
}));

const mockSession = {
  status: 'ready' as const,
  isAuthenticated: true,
  user: { id: 'u1', email: 'a@b.c', name: 'A' } as SessionUser,
  guest: undefined as { remaining: number; limit: number } | undefined,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('../api/conversations.js', () => ({
  listConversations: vi.fn(() => Promise.resolve({ items: [] })),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  patchConversation: vi.fn(),
  importConversation: vi.fn(),
}));

vi.mock('../api/models.js', () => ({
  fetchModels: vi.fn(() => Promise.resolve([])),
  getStoredModel: vi.fn(() => 'gemini-2.5-flash'),
  setStoredModel: vi.fn(),
}));

vi.mock('../api/stream.js', () => ({ streamChat: vi.fn(() => new Promise(() => {})) }));

import ChatView from '../components/ChatView.js';
import { ThemeProvider } from '../state/themeContext.js';
import * as conversationsApi from '../api/conversations.js';
import { GUEST_STORAGE_KEY } from '../state/guestMachine.js';

const userMsg = (id: string, content: string): ChatMessage =>
  ({ id, role: 'user', content, status: 'complete', sequence: 0, createdAt: '2026-05-23T00:00:00.000Z' });
const asstMsg = (id: string, content: string): ChatMessage =>
  ({ id, role: 'assistant', content, status: 'complete', sequence: 1, createdAt: '2026-05-23T00:00:01.000Z' });

function conv(id: string, messages: ChatMessage[]) {
  return {
    id, title: 'New conversation', status: 'active' as const, model: 'gemini-2.5-flash',
    provider: 'google' as const, createdAt: '2026-05-23T00:00:00.000Z', updatedAt: '2026-05-23T00:00:00.000Z',
    messages,
  };
}

function bufferGuest(messages: ChatMessage[]) {
  return JSON.stringify({
    conversation: { clientConversationId: 'c-1', createdAt: '2026-05-23T00:00:00.000Z', messages },
    phase: 'capped',
    sentUserCount: messages.length,
  });
}

function renderApp() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ChatView />} />
          <Route path="/c/:id" element={<ChatView />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  // jsdom doesn't implement scrollIntoView (MessageList calls it on mount)
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => sessionStorage.clear());

describe('capped guest message is restored to the composer after sign-in', () => {
  it('orphan-only (quota already exhausted, single capped message)', async () => {
    sessionStorage.setItem(GUEST_STORAGE_KEY, bufferGuest([userMsg('u1', 'my capped question')]));

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Message Ollive/i)).toHaveValue('my capped question');
    });
  });

  it('with prior answered exchanges', async () => {
    const imported = conv('conv-1', [userMsg('u1', 'q1'), asstMsg('a1', 'r1')]);
    vi.mocked(conversationsApi.importConversation).mockResolvedValue(imported);
    vi.mocked(conversationsApi.getConversation).mockResolvedValue(imported);
    sessionStorage.setItem(
      GUEST_STORAGE_KEY,
      bufferGuest([userMsg('u1', 'q1'), asstMsg('a1', 'r1'), userMsg('u2', 'capped q2')]),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Message Ollive/i)).toHaveValue('capped q2');
    });
  });
});
