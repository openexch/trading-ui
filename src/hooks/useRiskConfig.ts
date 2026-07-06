// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, getAuthHeaders } from '../config';

/** Risk config for one market (OMS /api/v1/admin/risk/config).
 *  NOTE: minQuantity/maxQuantity/minNotional/maxNotional/maxPositionPerMarket
 *  are raw 10^8 fixed-point longs. The rest are plain ints / ms. */
export interface RiskConfig {
  marketId: number;
  minQuantity: number;
  maxQuantity: number;
  minNotional: number;
  maxNotional: number;
  maxPositionPerMarket: number;
  priceCollarPercent: number;
  circuitBreakerPercent: number;
  circuitBreakerWindowMs: number;
  maxOrdersPerSec: number;
  maxOrdersPerMin: number;
  maxOpenOrders: number;
}

export const FP_SCALE = 100_000_000; // 10^8
/** Fields stored as 10^8 fixed-point longs. */
export const FP_FIELDS: (keyof RiskConfig)[] = [
  'minQuantity', 'maxQuantity', 'minNotional', 'maxNotional', 'maxPositionPerMarket',
];

interface State {
  configs: Record<string, RiskConfig>;
  loading: boolean;
  error: string | null;
}

export function useRiskConfig() {
  const [state, setState] = useState<State>({ configs: {}, loading: false, error: null });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/risk/config`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const configs = (await res.json()) as Record<string, RiskConfig>;
      setState({ configs, loading: false, error: null });
    } catch (err) {
      setState({ configs: {}, loading: false, error: err instanceof Error ? err.message : 'Failed to load risk config' });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const updateConfig = useCallback(async (marketId: number, patch: Partial<RiskConfig>): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/risk/config/${marketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.success) {
        await refresh();
        return { success: true, message: 'Risk config updated' };
      }
      return { success: false, message: data.error || `Error ${res.status}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, [refresh]);

  const circuitBreaker = useCallback(async (marketId: number, action: 'trip' | 'reset'): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/risk/circuit-breaker/${marketId}/${action}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) return { success: true, message: `Circuit breaker ${action === 'trip' ? 'tripped' : 'reset'}` };
      return { success: false, message: data.error || `Error ${res.status}` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, []);

  return { ...state, refresh, updateConfig, circuitBreaker };
}
