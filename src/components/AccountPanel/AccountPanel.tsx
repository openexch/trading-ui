// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useCallback } from 'react';
import { formatPrice } from '../../utils/formatters';
import { API_BASE, getAuthHeaders } from '../../config';
import { useAuth } from '../../auth/AuthContext';

interface AssetBalance {
  asset: string;
  assetId: number;
  available: number;
  locked: number;
  total: number;
}

interface AccountData {
  userId: number;
  assets: AssetBalance[];
}

export function AccountPanel() {
  // Path segment only — identity is enforced from the auth token (oms#36/#72).
  const userId = useAuth().session?.userId ?? null;
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [depositAsset, setDepositAsset] = useState(1); // USD
  const [depositAmount, setDepositAmount] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const fetchAccount = useCallback(async () => {
    if (userId === null) return; // signed out: nothing to fetch
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${userId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        // Balances cross as exact decimal strings (oms#39)
        if (Array.isArray(data?.assets)) {
          data.assets = data.assets.map((a: any) => ({
            ...a,
            available: Number(a.available),
            locked: Number(a.locked),
            total: Number(a.total),
          }));
        }
        setAccount(data);
      }
    } catch (e) {
      console.error('Failed to fetch account:', e);
    }
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      setAccount(null);
      return;
    }
    fetchAccount();
    const interval = setInterval(fetchAccount, 5000);
    return () => clearInterval(interval);
  }, [fetchAccount, userId]);

  const handleDeposit = useCallback(async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0 || userId === null) return;

    setLoading(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${userId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ assetId: depositAsset, amount: amount.toFixed(8) }),
      });
      if (res.ok) {
        setActionMsg('Deposit successful');
        setDepositAmount('');
        fetchAccount();
      } else {
        const data = await res.json();
        setActionMsg(data.error || 'Deposit failed');
      }
    } catch {
      setActionMsg('Network error');
    }
    setLoading(false);
  }, [depositAsset, depositAmount, fetchAccount, userId]);

  const handleWithdraw = useCallback(async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0 || userId === null) return;

    setLoading(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${userId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ assetId: depositAsset, amount: amount.toFixed(8) }),
      });
      if (res.ok) {
        setActionMsg('Withdrawal successful');
        setDepositAmount('');
        fetchAccount();
      } else {
        const data = await res.json();
        setActionMsg(data.error || 'Insufficient balance');
      }
    } catch {
      setActionMsg('Network error');
    }
    setLoading(false);
  }, [depositAsset, depositAmount, fetchAccount, userId]);

  const ASSETS = [
    { id: 1, name: 'USD' },
    { id: 2, name: 'BTC' },
    { id: 3, name: 'ETH' },
    { id: 4, name: 'SOL' },
    { id: 5, name: 'XRP' },
    { id: 6, name: 'DOGE' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-hairline px-4 py-3.5">
        <h3 className="text-[13px] font-medium tracking-tight text-text-strong">Account</h3>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {account && account.assets.length > 0 ? (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-hairline px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted">
                  Asset
                </th>
                <th className="border-b border-hairline px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted">
                  Available
                </th>
                <th className="border-b border-hairline px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted">
                  Locked
                </th>
                <th className="border-b border-hairline px-4 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {account.assets.map(a => (
                <tr key={a.assetId} className="hover:bg-surface-2">
                  <td className="border-b border-hairline px-4 py-1.5 font-mono text-xs font-semibold text-text-strong">
                    {a.asset}
                  </td>
                  <td className="border-b border-hairline px-4 py-1.5 font-mono text-xs tabular-nums text-buy">
                    {formatPrice(a.available)}
                  </td>
                  <td className="border-b border-hairline px-4 py-1.5 font-mono text-xs tabular-nums text-warn">
                    {a.locked > 0 ? formatPrice(a.locked) : <span className="text-faint">-</span>}
                  </td>
                  <td className="border-b border-hairline px-4 py-1.5 font-mono text-xs tabular-nums text-text">
                    {formatPrice(a.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-5 text-center text-xs italic text-muted">No balances</div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
        <select
          value={depositAsset}
          onChange={e => setDepositAsset(Number(e.target.value))}
          className="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs text-text outline-none focus:border-accent"
        >
          {ASSETS.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
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
            onClick={handleDeposit}
            disabled={loading}
            className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
          >
            Deposit
          </button>
          <button
            onClick={handleWithdraw}
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
    </div>
  );
}
