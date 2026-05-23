import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the api/session module
vi.mock('../api/session.js', () => ({
  getSession: vi.fn(),
  logout: vi.fn(),
  googleSignInUrl: vi.fn(() => 'http://api/auth/google'),
}));

import { SessionProvider, useSession } from '../state/sessionContext.js';
import * as sessionApi from '../api/session.js';
import { ApiError } from '../api/errors.js';
import type { SessionResponse } from '../api/types.js';

// Probe component to read session state
function SessionProbe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="auth">{String(s.isAuthenticated)}</span>
      <span data-testid="email">{s.user?.email ?? ''}</span>
      <span data-testid="remaining">{s.guest?.remaining ?? ''}</span>
      <span data-testid="limit">{s.guest?.limit ?? ''}</span>
      <button onClick={() => void s.signOut()}>sign-out</button>
      <button onClick={() => void s.refresh()}>refresh</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <SessionProvider>
      <SessionProbe />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSession', () => {
  it('(1) guest session → isAuthenticated false, guest.remaining, status ready', async () => {
    const guestResponse: SessionResponse = {
      authenticated: false,
      guest: { remaining: 1, limit: 2 },
    };
    vi.mocked(sessionApi.getSession).mockResolvedValue(guestResponse);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('remaining').textContent).toBe('1');
    expect(screen.getByTestId('limit').textContent).toBe('2');
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  it('(2) authed session → isAuthenticated true, user.email set, guest undefined', async () => {
    const authedResponse: SessionResponse = {
      authenticated: true,
      user: { id: 'u1', email: 'test@example.com', name: 'Test' },
    };
    vi.mocked(sessionApi.getSession).mockResolvedValue(authedResponse);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('email').textContent).toBe('test@example.com');
    expect(screen.getByTestId('remaining').textContent).toBe('');
  });

  it('(3) getSession rejects with network_error → status error', async () => {
    vi.mocked(sessionApi.getSession).mockRejectedValue(
      new ApiError('network_error', 0, 'Failed to fetch'),
    );

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  it('(4) signOut calls logout then getSession again → isAuthenticated false', async () => {
    const guestResponse: SessionResponse = {
      authenticated: false,
      guest: { remaining: 1, limit: 2 },
    };
    // First call: authed
    vi.mocked(sessionApi.getSession)
      .mockResolvedValueOnce({
        authenticated: true,
        user: { id: 'u1', email: 'test@example.com' },
      })
      // Second call (after signOut): guest
      .mockResolvedValue(guestResponse);
    vi.mocked(sessionApi.logout).mockResolvedValue(undefined);

    const { getByText } = renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('true');
    });

    await act(async () => {
      getByText('sign-out').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('false');
    });

    expect(sessionApi.logout).toHaveBeenCalledOnce();
    expect(sessionApi.getSession).toHaveBeenCalledTimes(2);
  });

  it('(5) refresh picks up updated remaining (0)', async () => {
    vi.mocked(sessionApi.getSession)
      .mockResolvedValueOnce({
        authenticated: false,
        guest: { remaining: 1, limit: 2 },
      })
      .mockResolvedValueOnce({
        authenticated: false,
        guest: { remaining: 0, limit: 2 },
      });

    const { getByText } = renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId('remaining').textContent).toBe('1');
    });

    await act(async () => {
      getByText('refresh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('remaining').textContent).toBe('0');
    });
  });
});
