// SPDX-License-Identifier: Apache-2.0
/**
 * Module-level auth session store (oms#72 demo auth).
 *
 * Holds the current `{token, userId, username}` session, persisted in
 * localStorage (same pattern as useTheme's `oe-theme` key) with a
 * subscribe/notify surface so React can re-render on changes;
 * AuthContext bridges it via useSyncExternalStore.
 *
 * Dev/test fallback: when VITE_AUTH_TOKEN is set (it is NOT set in
 * production builds) and no session is stored, a session is synthesized
 * from it so local dev keeps the old auto-authenticated behavior.
 */

export interface Session {
  token: string;
  userId: number;
  username: string;
}

const STORAGE_KEY = 'oe.session';

let current: Session | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (
      parsed &&
      typeof parsed.token === 'string' &&
      typeof parsed.userId === 'number' &&
      typeof parsed.username === 'string'
    ) {
      return { token: parsed.token, userId: parsed.userId, username: parsed.username };
    }
    return null;
  } catch {
    return null;
  }
}

/** Dev-only token (e.g. 'dev:1'); the OMS dev auth provider maps it directly. */
function envFallback(): Session | null {
  const token: string | undefined = import.meta.env.VITE_AUTH_TOKEN;
  if (!token) return null;
  const m = /^dev:(\d+)$/.exec(token);
  return { token, userId: m ? Number(m[1]) : 1, username: 'dev' };
}

function compute(): Session | null {
  return readStored() ?? envFallback();
}

/** Current session; lazily initialized from storage / the dev env fallback. */
export function getSession(): Session | null {
  if (!loaded) {
    current = compute();
    loaded = true;
  }
  return current;
}

/** Re-read the session from storage (or the dev env fallback), notifying
 *  subscribers if it changed. Called by AuthProvider on mount. */
export function loadSession(): Session | null {
  const next = compute();
  const changed =
    !loaded ||
    next?.token !== current?.token ||
    next?.userId !== current?.userId ||
    next?.username !== current?.username;
  loaded = true;
  if (changed) {
    current = next;
    notify();
  }
  return current;
}

/** Dev tokens skip /auth/me validation; the OMS dev provider accepts them as-is. */
export function isDevToken(token: string): boolean {
  return token.startsWith('dev:');
}

export function setSession(next: Session | null): void {
  loaded = true;
  current = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}
