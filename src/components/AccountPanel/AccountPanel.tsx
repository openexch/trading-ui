import { useState, useEffect, useCallback } from 'react';
import { formatPrice } from '../../utils/formatters';
import './AccountPanel.css';

const API_BASE = import.meta.env.VITE_ORDER_API_URL || '';
const USER_ID = 1;

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
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [depositAsset, setDepositAsset] = useState(1); // USD
  const [depositAmount, setDepositAmount] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${USER_ID}`);
      if (res.ok) {
        setAccount(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch account:', e);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
    const interval = setInterval(fetchAccount, 5000);
    return () => clearInterval(interval);
  }, [fetchAccount]);

  const handleDeposit = useCallback(async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    setLoading(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${USER_ID}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: depositAsset, amount }),
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
  }, [depositAsset, depositAmount, fetchAccount]);

  const handleWithdraw = useCallback(async () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    setLoading(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${USER_ID}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: depositAsset, amount }),
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
  }, [depositAsset, depositAmount, fetchAccount]);

  const ASSETS = [
    { id: 1, name: 'USD' },
    { id: 2, name: 'BTC' },
    { id: 3, name: 'ETH' },
    { id: 4, name: 'SOL' },
    { id: 5, name: 'XRP' },
    { id: 6, name: 'DOGE' },
  ];

  return (
    <div className="account-panel">
      <div className="account-header">
        <h3>Account</h3>
      </div>

      <div className="account-balances">
        {account && account.assets.length > 0 ? (
          <table className="balance-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Available</th>
                <th>Locked</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {account.assets.map(a => (
                <tr key={a.assetId}>
                  <td className="asset-name">{a.asset}</td>
                  <td>{formatPrice(a.available)}</td>
                  <td className="locked">{a.locked > 0 ? formatPrice(a.locked) : '-'}</td>
                  <td>{formatPrice(a.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No balances</div>
        )}
      </div>

      <div className="account-actions">
        <select value={depositAsset} onChange={e => setDepositAsset(Number(e.target.value))}>
          {ASSETS.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={depositAmount}
          onChange={e => setDepositAmount(e.target.value)}
          min="0"
          step="any"
        />
        <div className="action-buttons">
          <button className="deposit-btn" onClick={handleDeposit} disabled={loading}>
            Deposit
          </button>
          <button className="withdraw-btn" onClick={handleWithdraw} disabled={loading}>
            Withdraw
          </button>
        </div>
        {actionMsg && <div className="action-msg">{actionMsg}</div>}
      </div>
    </div>
  );
}
