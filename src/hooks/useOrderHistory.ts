import { useCallback, useEffect, useState } from 'react';
import { AUTH_HEADERS } from '../config';
import { fromWireMoney } from '../utils/money';

const API_BASE = import.meta.env.VITE_ORDER_API_URL || '';

/** GET /api/v1/orders entries; wire money strings parsed to numbers for display. */
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
  rejectReason: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface State {
  orders: OrderHistoryEntry[];
  loading: boolean;
  error: string | null;
}

/** Fetches the authenticated user's full order history from the OMS REST API. */
export function useOrderHistory() {
  const [state, setState] = useState<State>({ orders: [], loading: false, error: null });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      // No userId param: the OMS scopes the query to the token's principal.
      const res = await fetch(`${API_BASE}/api/v1/orders`, { headers: AUTH_HEADERS });
      if (!res.ok) throw new Error(`Error ${res.status}`);
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
