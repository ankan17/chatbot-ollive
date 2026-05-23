/**
 * Smoke test: guest happy path — type "Hello", submit, see streamed reply,
 * confirm composer re-enables after done.
 *
 * No real network. Uses vi.mock for session and vi.stubGlobal('fetch') for SSE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ─── jsdom: scrollIntoView not implemented — stub it out ─────────────────────

window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ─── Mock session API (so no real fetch for /v1/session) ─────────────────────

vi.mock('../api/session.js', () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  googleSignInUrl: vi.fn(() => 'http://api/auth/google'),
}));

import * as sessionApi from '../api/session.js';
import type { SessionResponse } from '../api/types.js';

// ─── Helper: build a ReadableStream emitting SSE frames ───────────────────────

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < frames.length) {
        controller.enqueue(enc.encode(frames[idx++]));
      } else {
        controller.close();
      }
    },
  });
}

// ─── Import components after mocks ───────────────────────────────────────────

import { SessionProvider } from '../state/sessionContext.js';
import ChatView from '../components/ChatView.js';

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('smoke: guest happy path', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    // Session returns guest with 2 remaining
    const guestSession: SessionResponse = {
      authenticated: false,
      guest: { remaining: 2, limit: 2 },
    };
    vi.mocked(sessionApi.getSession).mockResolvedValue(guestSession);

    // Stub fetch only for the SSE guest messages endpoint
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, opts?: RequestInit) => {
        const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url).url;

        if (u.includes('/v1/guest/messages') && (opts?.method ?? 'GET') === 'POST') {
          const stream = sseStream([
            'event: start\ndata: {"messageId":"m1","requestId":"r1"}\n\n',
            'event: token\ndata: {"delta":"Hello"}\n\n',
            'event: token\ndata: {"delta":" there"}\n\n',
            'event: token\ndata: {"delta":"!"}\n\n',
            'event: done\ndata: {"messageId":"m1","finishReason":"stop","usage":{"promptTokens":5,"completionTokens":3,"totalTokens":8}}\n\n',
          ]);
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('type "Hello", submit → streamed assistant text appears, composer re-enables', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <SessionProvider>
          <ChatView />
        </SessionProvider>
      </MemoryRouter>,
    );

    // Wait for session to resolve (guest) — banner and composer should appear
    await waitFor(() => {
      expect(screen.getAllByText(/free trial/i).length).toBeGreaterThan(0);
    });

    // Find the textarea and type "Hello"
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    expect((textarea as HTMLTextAreaElement).value).toBe('Hello');

    // Submit via button click
    await user.click(screen.getByRole('button', { name: /send/i }));

    // Wait for the streamed assistant text to appear
    // The text "Hello there!" is assembled from 3 tokens and rendered via ReactMarkdown
    await waitFor(
      () => {
        // Use getAllByText with a broad matcher since ReactMarkdown may split into nodes
        const matches = screen.getAllByText((_, el) =>
          el?.textContent?.includes('Hello there!') === true,
        );
        expect(matches.length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    // After done, composer should re-enable (textarea no longer disabled)
    await waitFor(() => {
      const ta = screen.getByRole('textbox');
      expect((ta as HTMLTextAreaElement).disabled).toBe(false);
    });
  });
});
