// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useCallback } from 'react';
import { formatPrice } from '../../utils/formatters';
import { API_BASE, getAuthHeaders } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { useBalances } from '../../hooks/useBalances';

interface AccountDrawerProps {
  onClose: () => void;
}

const ASSETS = [
  { id: 1, name: 'USD' },
  { id: 2, name: 'BTC' },
  { id: 3, name: 'ETH' },
  { id: 4, name: 'SOL' },
  { id: 5, name: 'XRP' },
  { id: 6, name: 'DOGE' },
];

const th =
  'border-b border-hairline px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted';
const td = 'border-b border-hairline px-4 py-1.5 font-mono text-xs tabular-nums';

/**
 * Account slide-over (opened from the header username pill): balances,
 * deposit/withdraw, sign out. Replaces the old bottom-strip Account tab —
 * the 3-column table reads far better at 360px than stretched full-width.
 */
export function AccountDrawer({ onClose }: AccountDrawerProps) {
  // Path segment only — identity is enforced from the auth token (oms#36/#72).
  const { session, logout } = useAuth();
  const userId = session?.userId ?? null;
  const { assets, refresh } = useBalances();

  const [loading, setLoading] = useState(false);
  const [depositAsset, setDepositAsset] = useState(1); // USD
  const [depositAmount, setDepositAmount] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // Fresh balances the moment the drawer opens (the poll may be mid-cycle)
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const transfer = useCallback(async (kind: 'deposit' | 'withdraw') => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0 || userId === null) return;

    setLoading(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${userId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ assetId: depositAsset, amount: amount.toFixed(8) }),
      });
      if (res.ok) {
        setActionMsg(kind === 'deposit' ? 'Deposit successful' : 'Withdrawal successful');
        setDepositAmount('');
        refresh();
      } else {
        const data = await res.json();
        setActionMsg(data.error || (kind === 'deposit' ? 'Deposit failed' : 'Insufficient balance'));
      }
    } catch {
      setActionMsg('Network error');
    }
    setLoading(false);
  }, [depositAsset, depositAmount, refresh, userId]);

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/65 backdrop-blur-[2px] animate-overlay-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ml-auto flex h-full w-[360px] max-w-[90vw] flex-col border-l border-hairline bg-surface animate-slide-in-right">
        {/* ── Header ── */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-[13px] font-bold uppercase text-accent">
              {(session?.username ?? '?').slice(0, 1)}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-text-strong" title={session?.username}>
                {session?.username}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Account</span>
            </div>
          </div>
          <button
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Balances ── */}
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {assets.length > 0 ? (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={th}>Available</th>
                  <th className={th}>Locked</th>
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.assetId} className="hover:bg-surface-2">
                    <td className={`${td} font-semibold text-text-strong`}>{a.asset}</td>
                    <td className={`${td} text-buy`}>{formatPrice(a.available)}</td>
                    <td className={`${td} text-warn`}>
                      {a.locked > 0 ? formatPrice(a.locked) : <span className="text-faint">-</span>}
                    </td>
                    <td className={`${td} text-text`}>{formatPrice(a.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-5 text-center text-xs italic text-muted">No balances</div>
          )}
        </div>

        {/* ── Deposit / Withdraw ── */}
        <div className="flex flex-shrink-0 flex-col gap-2 border-t border-hairline px-4 py-3">
          <div className="relative">
            <select
              value={depositAsset}
              onChange={e => setDepositAsset(Number(e.target.value))}
              className="w-full appearance-none rounded-md border border-hairline bg-surface-2 px-3 py-2 pr-8 text-xs text-text outline-none focus:border-accent"
            >
              {ASSETS.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <svg
              viewBox="0 0 12 12"
              className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-faint"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 4.5L6 8l3.5-3.5" />
            </svg>
          </div>
          <input
            type="number"
            onWheel={(e) => e.currentTarget.blur()}
            placeholder="Amount"
            value={depositAmount}
            onChange={e => setDepositAmount(e.target.value)}
            min="0"
            step="any"
            className="rounded-md border border-hairline bg-surface-2 px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => transfer('deposit')}
              disabled={loading}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
            >
              Deposit
            </button>
            <button
              onClick={() => transfer('withdraw')}
              disabled={loading}
              className="flex-1 rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs font-semibold text-sell transition-colors hover:border-hairline-strong hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Withdraw
            </button>
          </div>
          {actionMsg && (
            <div className="animate-fade-in rounded-md px-2 py-1.5 text-center text-[11px] font-medium text-muted">
              {actionMsg}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 border-t border-hairline px-4 py-3">
          <button
            onClick={() => {
              logout();
              onClose();
            }}
            className="w-full rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-hairline-strong hover:bg-surface-3 hover:text-text"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
