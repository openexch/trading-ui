// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { EV, track } from '../analytics';
import type { ReactNode } from 'react';
import { API_BASE } from '../config';
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
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** POST /api/v1/auth/{login,register} (oms#72). Success stores the session;
 *  the token ROTATES on login (single active session per user). */
async function authCall(path: 'login' | 'register', username: string, password: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof data.token === 'string') {
      setSession({
        token: data.token,
        userId: typeof data.userId === 'number' ? data.userId : Number(data.userId),
        username: typeof data.username === 'string' ? data.username : username,
      });
      return { ok: true };
    }
    return { ok: false, error: typeof data.error === 'string' ? data.error : `Error ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [ready, setReady] = useState(false);

  // Validate the stored session once on mount. Dev tokens skip /me; a network
  // error keeps the session (the OMS may just be briefly down); only a
  // definitive 401 drops it.
  useEffect(() => {
    const stored = loadSession();
    if (!stored || isDevToken(stored.token)) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${stored.token}` },
        });
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
  const logout = useCallback(() => {
    track(EV.sign_out, {});
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
