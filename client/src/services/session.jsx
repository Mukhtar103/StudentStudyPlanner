import { t, useLanguage, setLanguage, isDari, languageLocale } from './language';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from './api';
import { Alert, Button, LoadingState } from '../components/ui';

const Session = createContext(null);
export function useSession() {
  const session = useContext(Session);
  const language = useLanguage();
  return { ...session, user: session.user ? { ...session.user,
    locale: language === 'fa-AF' ? languageLocale(language) : (isDari(session.user.locale) ? 'en-US' : session.user.locale),
  } : null };
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
}

export function SessionProvider({ children }) {
  useLanguage();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    if (user) setLanguage(isDari(user.locale) ? 'fa-AF' : 'en');
  }, [user?.locale]);
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

  return <Session.Provider value={{ user, setUser, status, restore }}>{t(children)}</Session.Provider>;
}

export function RequireSession() {
  useLanguage();
  const { user, status, restore } = useSession();
  const { pathname, search } = useLocation();
  if (!user && status === 'loading') return <main className="auth-shell"><LoadingState label={t("Restoring your session")} /></main>;
  if (!user && status === 'error') return <main className="auth-shell"><div className="auth-panel">
    <Alert error>{t("Account services are unavailable. Try again in a moment.")}</Alert>
    <Button className="retry-session" onClick={() => restore()}>{t("Retry")}</Button>
  </div></main>;
  if (!user) return <Navigate to="/login" state={{ from: pathname + search }} replace />;
  return <Outlet />;
}
