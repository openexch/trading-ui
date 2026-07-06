// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, getAuthHeaders } from '../config';
import { fromWireMoney } from '../utils/money';

/** GET /api/v1/executions entries (the caller's fills, oms#72); wire money
 *  strings parsed to numbers for display. */
export interface ExecutionEntry {
  /** JSON string on the wire — Snowflake ids overflow JS numbers (oms#39). */
  tradeId: string;
  omsOrderId: string;
  userId: number;
  marketId: number;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  /** True when the caller's order was resting (maker) in this fill. */
  maker: boolean;
  executedAtMs: number;
}

interface State {
  executions: ExecutionEntry[];
  loading: boolean;
  error: string | null;
}

/** Fetches the authenticated user's executions from the OMS REST API. */
export function useExecutions() {
  const [state, setState] = useState<State>({ executions: [], loading: false, error: null });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      // No userId param: the OMS scopes the query to the token's principal.
      const res = await fetch(`${API_BASE}/api/v1/executions?limit=100&offset=0`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        // 503 = the OMS is running without persistence (code UNAVAILABLE)
        if (res.status === 503) {
          throw new Error('Trade history unavailable: OMS persistence is disabled');
        }
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof body.error === 'string' ? body.error : `Error ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
      const executions: ExecutionEntry[] = (Array.isArray(raw) ? raw : []).map(e => ({
        ...e,
        // Money crosses as exact decimal strings (oms#39); numbers for display
        price: fromWireMoney(e.price),
        quantity: fromWireMoney(e.quantity),
      }));
      executions.sort((a, b) => b.executedAtMs - a.executedAtMs);
      setState({ executions, loading: false, error: null });
    } catch (err) {
      setState({
        executions: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load trades',
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
