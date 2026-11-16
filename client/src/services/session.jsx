import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from './api';
import { Alert, Button, LoadingState } from '../components/ui';

const Session = createContext(null);
export function useSession() {
  return useContext(Session);
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
}

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const restore = useCallback(async signal => {
    setStatus('loading');
    try {
      const current = await api('/auth/session', { signal });
      if (!signal?.aborted) {
        setUser(current);
        setStatus('ready');
      }
    } catch (error) {
      if (!signal?.aborted) {
        setUser(null);
        setStatus(error.status === 401 ? 'ready' : 'error');
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const expire = () => {
      setUser(null);
      setStatus('ready');
    };
    window.addEventListener('planner-session-expired', expire);
    void restore(controller.signal);
    return () => {
      controller.abort();
      window.removeEventListener('planner-session-expired', expire);
    };
  }, [restore]);

  return <Session.Provider value={{ user, setUser, status, restore }}>{children}</Session.Provider>;
}

export function RequireSession() {
  const { user, status, restore } = useSession();
  const { pathname, search } = useLocation();
  if (!user && status === 'loading') return <main className="auth-shell"><LoadingState label="Restoring your session" /></main>;
  if (!user && status === 'error') return <main className="auth-shell"><div className="auth-panel">
    <Alert error>Account services are unavailable. Try again in a moment.</Alert>
    <Button className="retry-session" onClick={() => restore()}>Retry</Button>
  </div></main>;
  if (!user) return <Navigate to="/login" state={{ from: pathname + search }} replace />;
  return <Outlet />;
}
