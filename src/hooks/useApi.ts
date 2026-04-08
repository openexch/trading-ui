import { useState, useCallback } from 'react';
import type { OrderRequest } from '../types/market';
import { MARKETS } from '../types/market';

const API_BASE = import.meta.env.VITE_ORDER_API_URL || '';

interface ApiState {
  loading: boolean;
  error: string | null;
}

interface ApiResponse {
  success: boolean;
  message: string;
}

const SIDE_MAP: Record<string, string> = { BID: 'BUY', ASK: 'SELL' };

function toOmsRequest(order: OrderRequest) {
  const market = MARKETS.find(m => m.symbol === order.market);
  return {
    userId: Number(order.userId),
    marketId: market?.id ?? 1,
    side: SIDE_MAP[order.orderSide] ?? order.orderSide,
    orderType: order.orderType,
    timeInForce: 'GTC',
    price: order.price,
    quantity: order.quantity,
  };
}

export function useApi() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  const submitOrder = useCallback(async (order: OrderRequest): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toOmsRequest(order)),
      });

      const data = await response.json();

      if (data.accepted) {
        setState({ loading: false, error: null });
        return { success: true, message: `Order accepted (${data.omsOrderId})` };
      } else {
        const error = data.rejectReason || `Error: ${response.status}`;
        setState({ loading: false, error });
        return { success: false, message: error };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  const cancelOrder = useCallback(async (orderId: number, _userId: string, _market: string): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/v1/orders/${orderId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setState({ loading: false, error: null });
        return { success: true, message: data.status || 'Order cancelled' };
      } else {
        const error = data.error || data.rejectReason || `Error: ${response.status}`;
        setState({ loading: false, error });
        return { success: false, message: error };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  return {
    ...state,
    submitOrder,
    cancelOrder,
  };
}
