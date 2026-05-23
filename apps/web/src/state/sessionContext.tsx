import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getSession, logout } from '../api/session.js';
import type { SessionResponse, SessionUser } from '../api/types.js';

interface SessionState {
  status: 'loading' | 'ready' | 'error';
  session?: SessionResponse;
  user?: SessionUser;
  isAuthenticated: boolean;
  guest?: { remaining: number; limit: number };
}

interface SessionContextValue extends SessionState {
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function deriveState(session: SessionResponse): Pick<SessionState, 'user' | 'isAuthenticated' | 'guest'> {
  if (session.authenticated) {
    return { user: session.user, isAuthenticated: true, guest: undefined };
  }
  return { user: undefined, isAuthenticated: false, guest: session.guest };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    isAuthenticated: false,
  });

  const refresh = useCallback(async () => {
    try {
      const session = await getSession();
      setState({
        status: 'ready',
        session,
        ...deriveState(session),
      });
    } catch {
      setState({ status: 'error', isAuthenticated: false });
    }
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, refresh, signOut }),
    [state, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
