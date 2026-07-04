// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'oe-theme';

/** A stored value means the user explicitly overrode the OS preference. */
function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

/** Resolve the initial theme: an explicit stored override wins, otherwise follow
 *  the OS color-scheme preference. The shared `oe-theme` key is also honored by
 *  the marketing website. */
export function initialTheme(): Theme {
  return readStored() ?? systemTheme();
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * Global light/dark theme. Defaults to the OS preference and tracks it live
 * until the user explicitly overrides via the toggle — only then is the choice
 * persisted to localStorage. Toggles the `.dark` class on <html> so the Tailwind
 * token layer flips, and stays in sync across tabs.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  // Reflect the current theme on <html>. Persistence is intentionally NOT here —
  // it happens only on an explicit user override (setTheme/toggle below).
  useEffect(() => {
    apply(theme);
  }, [theme]);

  // While there's no explicit override, follow live OS preference changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (readStored() === null) setThemeState(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Cross-tab sync: an override set elsewhere applies here; a cleared override
  // falls back to the OS preference.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark') setThemeState(e.newValue);
      else setThemeState(systemTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Explicit user choice — persist it as the override. */
  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
