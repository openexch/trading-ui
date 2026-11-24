// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiOrder } from '../types/market';
import { marketIdFromApi } from '../api/marketId';
import { parseDecimal, parseOptionalDecimal } from '../api/decimal';
import { readHistoryPage } from './historyPage';
import { TERMINAL } from './useOrders';

/** One row of GET /api/v2/orders/history, money parsed to numbers for display. */
export interface OrderHistoryEntry {
  /** The gateway's order id, a decimal string. */
  omsOrderId: string;
  clientOrderId: string | null;
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
  /** The core's reject reason name, or null. */
  rejectReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

/** Map one history row. Exported for tests. */
export function mapHistoryOrder(o: ApiOrder): OrderHistoryEntry {
  return {
    omsOrderId: o.orderId,
    clientOrderId: o.clientOrderId,
    marketId: marketIdFromApi(o.marketId),
    side: o.side,
    orderType: o.type,
    timeInForce: o.timeInForce,
    price: parseOptionalDecimal(o.price, 'price') ?? 0,
    quantity: parseDecimal(o.quantity, 'quantity'),
    filledQty: parseDecimal(o.filledQuantity, 'filledQuantity'),
    remainingQty: parseDecimal(o.remainingQuantity, 'remainingQuantity'),
    stopPrice: parseOptionalDecimal(o.stopPrice, 'stopPrice') ?? 0,
    status: o.status,
    rejectReason: o.reason,
    createdAtMs: o.createdAt,
    updatedAtMs: o.updatedAt,
  };
}

interface State {
  orders: OrderHistoryEntry[];
  loading: boolean;
  error: string | null;
  /** True while the read has another page (nextCursor not null). */
  hasMore: boolean;
}

const UNAVAILABLE = 'Order history unavailable: the history service is not answering';

/** The v2 history lists every order by its last update, open ones included;
 *  this panel lists closed orders (open ones are in the Open Orders list). */
function closedRows(items: ApiOrder[]): OrderHistoryEntry[] {
  return items.filter(o => TERMINAL.has(o.status)).map(mapHistoryOrder);
}

/** The caller's closed orders, newest first by last update. `refresh`
 *  reads the first page; `loadMore` follows the cursor. */
export function useOrderHistory() {
  const [state, setState] = useState<State>({ orders: [], loading: false, error: null, hasMore: false });
  const cursorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const page = await readHistoryPage<ApiOrder>('/orders/history', null, UNAVAILABLE);
      cursorRef.current = page.nextCursor;
      setState({ orders: closedRows(page.items), loading: false, error: null, hasMore: page.nextCursor !== null });
    } catch (err) {
      cursorRef.current = null;
      setState({ orders: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load orders', hasMore: false });
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (cursor === null) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const page = await readHistoryPage<ApiOrder>('/orders/history', cursor, UNAVAILABLE);
      cursorRef.current = page.nextCursor;
      setState(s => ({
        orders: [...s.orders, ...closedRows(page.items)],
        loading: false,
        error: null,
        hasMore: page.nextCursor !== null,
      }));
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Failed to load orders' }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh, loadMore };
}
