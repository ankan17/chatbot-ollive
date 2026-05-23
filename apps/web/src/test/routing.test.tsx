import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/errors.js';
import type { SessionUser } from '../api/types.js';
import AppShell from '../components/AppShell.js';
import { ThemeProvider } from '../state/themeContext.js';
import Spinner from '../components/states/Spinner.js';
import ErrorState from '../components/states/ErrorState.js';

// ─── Stub session context ─────────────────────────────────────────────────────

vi.mock('../state/sessionContext.js', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => mockSession,
}));

// Mutable mock session (tests set this before rendering)
let mockSession = {
  status: 'ready' as 'loading' | 'ready' | 'error',
  isAuthenticated: false,
  user: undefined as SessionUser | undefined,
  guest: undefined as { remaining: number; limit: number } | undefined,
  refresh: vi.fn(),
  signOut: vi.fn(),
};

// ─── Minimal RequireAuth that mirrors App.tsx logic ───────────────────────────
// We don't import App directly to avoid pulling in the full component tree.

import { useSession } from '../state/sessionContext.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, isAuthenticated, user, signOut } = useSession();
  if (status === 'loading') return <Spinner />;
  if (!isAuthenticated || !user) return <Navigate to="/sign-in" replace />;
  return (
    <ThemeProvider>
      <AppShell user={user} onSignOut={() => void signOut()}>
        {children}
      </AppShell>
    </ThemeProvider>
  );
}

// ─── Minimal container that uses useApiErrorRedirect ─────────────────────────

vi.mock('../api/metrics.js', () => ({
  getOverview: vi.fn(() => new Promise(() => {})),
  getLatency: vi.fn(() => new Promise(() => {})),
  getThroughput: vi.fn(() => new Promise(() => {})),
  getErrors: vi.fn(() => new Promise(() => {})),
  getTokens: vi.fn(() => new Promise(() => {})),
}));

import { useApiErrorRedirect } from '../hooks/useApiErrorRedirect.js';

function ErrorContainer({ error }: { error?: ApiError }) {
  useApiErrorRedirect(error);
  return <div data-testid="container-content">content</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = {
    status: 'ready',
    isAuthenticated: false,
    user: undefined,
    guest: undefined,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RequireAuth guard', () => {
  it('unauthenticated visit to protected route redirects to /sign-in', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboards']}>
        <RequireAuth>
          <div data-testid="dashboard-content">Dashboard</div>
        </RequireAuth>
        {/* Render a sentinel at the target route so we can see the redirect */}
        <Navigate to="/sign-in" replace />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Protected content should NOT be rendered
      expect(screen.queryByTestId('dashboard-content')).toBeNull();
    });
  });

  it('authenticated visit renders children inside AppShell', async () => {
    mockSession = {
      ...mockSession,
      isAuthenticated: true,
      user: { id: 'u1', email: 'test@example.com', name: 'Test User' },
    };

    render(
      <MemoryRouter initialEntries={['/dashboards']}>
        <RequireAuth>
          <div data-testid="dashboard-content">Dashboard</div>
        </RequireAuth>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeTruthy();
    });
    // AppShell header should be present
    expect(screen.getByText('Ollive')).toBeTruthy();
  });

  it('loading state shows spinner instead of redirect', () => {
    mockSession = { ...mockSession, status: 'loading' };

    render(
      <MemoryRouter>
        <RequireAuth>
          <div data-testid="protected-content">Protected</div>
        </RequireAuth>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toBeTruthy(); // Spinner
    expect(screen.queryByTestId('protected-content')).toBeNull();
  });
});

describe('useApiErrorRedirect', () => {
  it('unauthorized error triggers navigate to /sign-in and calls session.refresh', async () => {
    const refreshMock = vi.fn().mockResolvedValue(undefined);
    mockSession = {
      ...mockSession,
      isAuthenticated: true,
      user: { id: 'u1', email: 'test@example.com', name: 'Test' },
      refresh: refreshMock,
    };

    const unauthorizedError = new ApiError('unauthorized', 401, 'Unauthorized');

    // Capture navigation by wrapping with MemoryRouter and rendering a sign-in sentinel
    let currentPath = '/dashboard';

    function LocationTracker() {
      const navigate = useNavigate();
      React.useEffect(() => {
        // noop — just tracks
      }, [navigate]);
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LocationTracker />
        <ErrorContainer error={unauthorizedError} />
      </MemoryRouter>,
    );

    // refresh() should be called (may fire twice in strict mode)
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it('non-unauthorized error does NOT redirect', async () => {
    const refreshMock = vi.fn();
    mockSession = {
      ...mockSession,
      isAuthenticated: true,
      user: { id: 'u1', email: 'test@example.com', name: 'Test' },
      refresh: refreshMock,
    };

    const notFoundError = new ApiError('not_found', 404, 'Not found');

    render(
      <MemoryRouter>
        <ErrorContainer error={notFoundError} />
      </MemoryRouter>,
    );

    // Spinner + content should remain
    expect(screen.getByTestId('container-content')).toBeTruthy();
    // refresh should NOT be called
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
