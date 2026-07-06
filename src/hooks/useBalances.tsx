// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE, getAuthHeaders } from '../config';
import { useAuth } from '../auth/AuthContext';

export interface AssetBalance {
  asset: string;
  assetId: number;
  available: number;
  locked: number;
  total: number;
}

interface BalancesContextValue {
  /** The signed-in user's balances; empty when signed out / not yet loaded. */
  assets: AssetBalance[];
  /** Force an immediate re-fetch (after deposit/withdraw/order submit). */
  refresh: () => Promise<void>;
}

const BalancesContext = createContext<BalancesContextValue | null>(null);

const POLL_MS = 5000;

/**
 * App-wide account balances (GET /api/v1/accounts/{userId}, oms#72 scoped
 * read). Polls every 5s while a session exists; consumers are the order
 * form (Avbl + % sizing) and the account drawer. Identity is enforced from
 * the bearer token — the path segment is display-plumbing only.
 */
export function BalancesProvider({ children }: { children: ReactNode }) {
  const userId = useAuth().session?.userId ?? null;
  const [assets, setAssets] = useState<AssetBalance[]>([]);

  const refresh = useCallback(async () => {
    if (userId === null) return; // signed out: nothing to fetch
    try {
      const res = await fetch(`${API_BASE}/api/v1/accounts/${userId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        // Balances cross as exact decimal strings (oms#39)
        if (Array.isArray(data?.assets)) {
          setAssets(
            data.assets.map((a: Record<string, unknown>) => ({
              ...a,
              available: Number(a.available),
              locked: Number(a.locked),
              total: Number(a.total),
            }) as AssetBalance)
          );
        }
      }
    } catch (e) {
      console.error('Failed to fetch balances:', e);
    }
  }, [userId]);

  useEffect(() => {
    if (userId === null) {
      setAssets([]);
      return;
    }
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh, userId]);

  return (
    <BalancesContext.Provider value={{ assets, refresh }}>
      {children}
    </BalancesContext.Provider>
  );
}

export function useBalances(): BalancesContextValue {
  const ctx = useContext(BalancesContext);
  if (!ctx) throw new Error('useBalances must be used within <BalancesProvider>');
  return ctx;
}
