import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './state/sessionContext.js';
import { useSession } from './state/sessionContext.js';
import ChatView from './components/ChatView.js';
import Dashboards from './components/Dashboards.js';
import SignInScreen from './components/SignInScreen.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import Spinner from './components/states/Spinner.js';
import { googleSignInUrl } from './api/session.js';

// ─── Route guard: redirects unauthenticated users to /sign-in ─────────────────
// Pages render their own AppShell, so the guard only gates access.

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, isAuthenticated, user } = useSession();

  if (status === 'loading') {
    return <Spinner />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
}

// ─── Root app ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </ErrorBoundary>
  );
}

function AppRoutes() {
  const { status } = useSession();

  if (status === 'loading') {
    return <Spinner />;
  }

  return (
    <Routes>
      {/* "/" — ChatView renders the full shell when authed, a guest layout otherwise */}
      <Route path="/" element={<ChatView />} />

      {/* "/c/:id" — requires auth */}
      <Route
        path="/c/:id"
        element={
          <RequireAuth>
            <ChatView />
          </RequireAuth>
        }
      />

      {/* "/dashboards" — requires auth */}
      <Route
        path="/dashboards"
        element={
          <RequireAuth>
            <Dashboards />
          </RequireAuth>
        }
      />

      <Route
        path="/sign-in"
        element={
          <SignInScreen
            onSignIn={() => window.location.assign(googleSignInUrl())}
          />
        }
      />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
