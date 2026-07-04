import { useState, useCallback } from 'react';
import type { OrderRequest } from '../types/market';
import { MARKETS } from '../types/market';
import { AUTH_HEADERS } from '../config';
import { parseJsonSafeIds } from '../utils/safeJson';

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
  // No userId: the OMS derives it from the auth token (oms#36).
  const req: Record<string, unknown> = {
    marketId: market?.id ?? 1,
    side: SIDE_MAP[order.orderSide] ?? order.orderSide,
    orderType: order.orderType,
    timeInForce: order.timeInForce ?? 'GTC',
    price: order.price,
    quantity: order.quantity,
  };
  if (order.stopPrice) req.stopPrice = order.stopPrice;
  if (order.trailingDelta) req.trailingDelta = order.trailingDelta;
  if (order.displayQuantity) req.displayQuantity = order.displayQuantity;
  return req;
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
          ...AUTH_HEADERS,
        },
        body: JSON.stringify(toOmsRequest(order)),
      });

      const data = parseJsonSafeIds(await response.text()) as Record<string, any>;

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

  const replaceOrder = useCallback(async (omsOrderId: string, price?: number, quantity?: number): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    const body: Record<string, number> = {};
    if (price !== undefined && price > 0) body.price = price;
    if (quantity !== undefined && quantity > 0) body.quantity = quantity;

    try {
      const response = await fetch(`${API_BASE}/api/v1/orders/${omsOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.accepted) {
        setState({ loading: false, error: null });
        return { success: true, message: 'Order updated' };
      } else {
        const error = data.error || data.message || `Error: ${response.status}`;
        setState({ loading: false, error });
        return { success: false, message: error };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  const cancelOrder = useCallback(async (omsOrderId: string): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/v1/orders/${omsOrderId}`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      });

      const data = await response.json();

      if (data.accepted) {
        setState({ loading: false, error: null });
        return { success: true, message: data.message || 'Order cancelled' };
      } else {
        const error = data.message || `Error: ${response.status}`;
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
    replaceOrder,
    cancelOrder,
  };
}
