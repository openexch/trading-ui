// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, getAuthHeaders } from '../config';
import { fromWireMoney } from '../utils/money';

/** GET /api/v1/orders/history entries; wire money strings parsed to numbers for display. */
export interface OrderHistoryEntry {
  /** JSON string on the wire — Snowflake ids overflow JS numbers (oms#39). */
  omsOrderId: string;
  clientOrderId: string;
  userId: number;
  marketId: number;
  side: 'BUY' | 'SELL';
  orderType: string;
  timeInForce: string;
  price: number;
  quantity: number;
  filledQty: number;
  remainingQty: number;
  stopPrice: number;
  status: string;
  rejectReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

interface State {
  orders: OrderHistoryEntry[];
  loading: boolean;
  error: string | null;
}

/** Fetches the authenticated user's terminal order history (newest first)
 *  from the OMS REST API (oms#72). */
export function useOrderHistory() {
  const [state, setState] = useState<State>({ orders: [], loading: false, error: null });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      // No userId param: the OMS scopes the query to the token's principal.
      const res = await fetch(`${API_BASE}/api/v1/orders/history?limit=100&offset=0`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        // 503 = the OMS is running without persistence (code UNAVAILABLE)
        if (res.status === 503) {
          throw new Error('Order history unavailable: OMS persistence is disabled');
        }
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof body.error === 'string' ? body.error : `Error ${res.status}`);
      }
      const data = await res.json() as any;
      const raw: any[] = Array.isArray(data) ? data : data.orders ?? [];
      // Money crosses as exact decimal strings (oms#39); numbers for display
      const orders: OrderHistoryEntry[] = raw.map(o => ({
        ...o,
        price: fromWireMoney(o.price),
        quantity: fromWireMoney(o.quantity),
        filledQty: fromWireMoney(o.filledQty),
        remainingQty: fromWireMoney(o.remainingQty),
        stopPrice: fromWireMoney(o.stopPrice),
      }));
      orders.sort((a, b) => b.createdAtMs - a.createdAtMs);
      setState({ orders, loading: false, error: null });
    } catch (err) {
      setState({ orders: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load orders' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
