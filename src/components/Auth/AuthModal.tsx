// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { EV, track } from '../../analytics';

interface AuthModalProps {
  onClose: () => void;
}

const inputClass =
  'w-full rounded-md border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent';

/** Login | Register modal against the OMS demo auth endpoints (oms#72).
 *  Server error messages (validation / username taken / bad credentials)
 *  are shown inline; success stores the session and closes the modal. */
export function AuthModal({ onClose }: AuthModalProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError(null);
  };

  // Fired here rather than at each button that opens the modal: there are
  // four of them (header, two sign-in prompts, the order form) and they would
  // drift apart.
  useEffect(() => {
    track(EV.auth_modal_open, {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || !password) {
      setError('Enter a username and password');
      return;
    }
    setBusy(true);
    setError(null);
    // Never the username and obviously never the password: only which flow
    // this was, and whether it worked.
    track(EV.auth_submit, { mode });
    const startedAt = Date.now();
    const result = mode === 'login' ? await login(name, password) : await register(name, password);
    setBusy(false);
    if (result.ok) {
      track(EV.auth_success, { mode, round_trip_ms: Date.now() - startedAt });
      onClose();
    } else {
      // The error string comes from a fixed set the OMS returns (taken name,
      // bad credentials, unreachable); it carries no user input back.
      track(EV.auth_failure, { mode, reason: (result.error ?? 'unknown').slice(0, 120) });
      setError(result.error ?? 'Something went wrong');
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 border-b-2 py-2.5 text-[13px] font-medium transition-colors ${
      active ? 'border-accent text-text-strong' : 'border-transparent text-faint hover:text-muted'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-overlay-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-hairline bg-surface shadow-lg animate-fade-in">
        <div className="flex border-b border-hairline">
          <button type="button" className={tabClass(mode === 'login')} onClick={() => switchMode('login')}>
            Sign in
          </button>
          <button type="button" className={tabClass(mode === 'register')} onClick={() => switchMode('register')}>
            Register
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="username"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              className={inputClass}
            />
          </label>
          {error && (
            <div className="animate-fade-in rounded-md bg-sell-soft px-2.5 py-1.5 text-[11px] font-medium text-sell">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
