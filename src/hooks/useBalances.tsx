// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiRequest } from '../api/gateway';
import { parseDecimal } from '../api/decimal';
import { useAuth } from '../auth/AuthContext';

export interface AssetBalance {
  asset: string;
  /** API form, a decimal string. */
  assetId: string;
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

/** Map GET /api/v2/balances to UI state. Exported for tests. */
export function mapBalances(raw: unknown): AssetBalance[] | null {
  const assets = (raw as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return null;
  return assets.map((a: Record<string, unknown>) => ({
    asset: String(a.asset),
    assetId: String(a.assetId),
    available: parseDecimal(a.available, 'available'),
    locked: parseDecimal(a.locked, 'locked'),
    total: parseDecimal(a.total, 'total'),
  }));
}

/**
 * App-wide account balances (GET /api/v2/balances, every asset of the core
 * config, zero balances included). Polls every 5s while a session exists;
 * consumers are the order form (Avbl + % sizing) and the account drawer.
 * The caller is the credential's user; no id is sent.
 */
export function BalancesProvider({ children }: { children: ReactNode }) {
  const token = useAuth().session?.token ?? null;
  const [assets, setAssets] = useState<AssetBalance[]>([]);

  const refresh = useCallback(async () => {
    if (token === null) return; // signed out: nothing to fetch
    try {
      const res = await apiRequest('/balances', { token });
      if (res.ok) {
        const mapped = mapBalances(res.body);
        if (mapped) setAssets(mapped);
      }
    } catch (e) {
      console.error('Failed to fetch balances:', e);
    }
  }, [token]);

  useEffect(() => {
    if (token === null) {
      setAssets([]);
      return;
    }
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh, token]);

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
