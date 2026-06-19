import { useCallback, useEffect, useState } from 'react';
import { DEMO_USER_ID } from '../config';

const API_BASE = import.meta.env.VITE_ORDER_API_URL || '';

/** Shape returned by GET /api/v1/orders (OMS OrderResponse — decimal doubles). */
export interface OrderHistoryEntry {
  omsOrderId: number;
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

/** Fetches the user's full order history from the OMS REST API. */
export function useOrderHistory(userId: number = DEMO_USER_ID) {
  const [state, setState] = useState<State>({ orders: [], loading: false, error: null });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/api/v1/orders?userId=${userId}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      const orders: OrderHistoryEntry[] = Array.isArray(data) ? data : data.orders ?? [];
      orders.sort((a, b) => b.createdAtMs - a.createdAtMs);
      setState({ orders, loading: false, error: null });
    } catch (err) {
      setState({ orders: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load orders' });
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
