// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { EV, track } from '../analytics';
import type { ReactNode } from 'react';
import { apiErrorText, apiRequest } from '../api/gateway';
import { getSession, isDevToken, loadSession, setSession, subscribeSession } from './session';
import type { Session } from './session';

export interface AuthResult {
  ok: boolean;
  /** Server error text (register 400/409 messages are user-friendly). */
  error?: string;
}

interface AuthContextValue {
  session: Session | null;
  /** False until the stored session has been validated against /auth/me. */
  ready: boolean;
  login: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, password: string) => Promise<AuthResult>;
  /** Revokes the token (POST /api/v2/auth/logout), then clears the local
   *  session. A failed call still clears locally. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The userId of an auth answer: a decimal id string in v2. */
function userIdOf(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  return Number(raw);
}

/** POST /api/v2/auth/{login,register}. Success stores the session; the token
 *  rotates on login (one token per user). */
async function authCall(path: 'login' | 'register', username: string, password: string): Promise<AuthResult> {
  try {
    const res = await apiRequest<Record<string, unknown>>(`/auth/${path}`, {
      method: 'POST',
      auth: false,
      body: { username, password },
    });
    if (!res.ok) return { ok: false, error: apiErrorText(res.error, res.status) };
    const data = res.body ?? {};
    const userId = userIdOf(data.userId);
    if (typeof data.token !== 'string' || userId === null) {
      return { ok: false, error: `Error ${res.status}: unexpected answer` };
    }
    setSession({
      token: data.token,
      userId,
      username: typeof data.username === 'string' ? data.username : username,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [ready, setReady] = useState(false);

  // Validate the stored session once on mount (GET /api/v2/auth/me). Dev
  // tokens skip it; a network error or a 503 keeps the session (the gateway
  // may be briefly down); only a definitive 401 drops it.
  useEffect(() => {
    const stored = loadSession();
    if (!stored || isDevToken(stored.token)) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('/auth/me', { token: stored.token });
        if (!cancelled && res.status === 401) setSession(null);
      } catch {
        /* network error: keep the session */
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    (username: string, password: string) => authCall('login', username, password),
    []
  );
  const register = useCallback(
    (username: string, password: string) => authCall('register', username, password),
    []
  );
  const logout = useCallback(async () => {
    track(EV.sign_out, {});
    const token = getSession()?.token;
    if (token) {
      try {
        // 204 revokes the token. A refusal (a dev token is 404
        // FEATURE_DISABLED) or a network error changes nothing here: the
        // local session is cleared either way.
        const res = await apiRequest('/auth/logout', { method: 'POST', token });
        if (!res.ok) console.warn('[auth] logout refused:', res.status, res.error.code);
      } catch (e) {
        console.warn('[auth] logout failed:', e);
      }
    }
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, ready, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
