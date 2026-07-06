// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback } from 'react';
import type { UserOrder, OmsOrderEvent, OrderStatus, OrderType } from '../types/market';
import { MARKETS } from '../types/market';
import { API_BASE, getAuthHeaders } from '../config';
import { fromWireMoney } from '../utils/money';

const MAX_ORDERS = 100;
const TERMINAL: ReadonlySet<string> = new Set(['FILLED', 'CANCELLED', 'REJECTED']);

/** Map a wire OrderResponse (OMS /ws/v1 event or GET /api/v1/orders row) to
 *  UI state. Exported for tests. */
export function mapOrderEvent(event: OmsOrderEvent): UserOrder {
  return {
    // Engine ids are small sequential longs — safe as a JS number. Display
    // only: REST cancel/replace keys on omsOrderId, never this (#25).
    orderId: Number(event.clusterOrderId),
    omsOrderId: event.omsOrderId,
    marketId: event.marketId,
    market: MARKETS.find(m => m.id === event.marketId)?.symbol ?? `#${event.marketId}`,
    userId: event.userId,
    side: event.side === 'BUY' ? 'BID' : 'ASK',
    type: event.orderType as OrderType,
    price: fromWireMoney(event.price),
    originalQuantity: fromWireMoney(event.quantity),
    remainingQuantity: fromWireMoney(event.remainingQty),
    filledQuantity: fromWireMoney(event.filledQty),
    status: event.status as OrderStatus,
    timestamp: event.createdAtMs,
  };
}

/**
 * The signed-in user's working orders, fed by the user-scoped OMS surfaces
 * (oms#72): OrderResponse events from /ws/v1 keyed by omsOrderId, seeded from
 * GET /api/v1/orders on (re)connect and session change. Replaces the old
 * market-plane ORDER_STATUS_BATCH path (global broadcast, being removed from
 * the gateway).
 */
export function useOrders(onRejected?: (event: OmsOrderEvent) => void) {
  const [orders, setOrders] = useState<UserOrder[]>([]);

  // WS event: terminal status removes the entry, anything else upserts.
  const handleOrderEvent = useCallback((event: OmsOrderEvent) => {
    // An accepted-then-rejected order must never vanish silently: the engine
    // rejects async (off-tick/out-of-range prices, full book) and the only
    // signal is this event. Surface it before dropping the row.
    if (event.status === 'REJECTED') {
      onRejected?.(event);
    }
    setOrders(prev => {
      if (TERMINAL.has(event.status)) {
        return prev.some(o => o.omsOrderId === event.omsOrderId)
          ? prev.filter(o => o.omsOrderId !== event.omsOrderId)
          : prev;
      }
      const mapped = mapOrderEvent(event);
      const idx = prev.findIndex(o => o.omsOrderId === event.omsOrderId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mapped;
        return next;
      }
      return [mapped, ...prev].slice(0, MAX_ORDERS);
    });
  }, [onRejected]);

  // REST seed of the caller's ACTIVE orders. Merge where the WS wins: an
  // entry already present (live-updated) is never overwritten by the
  // possibly-staler snapshot.
  const seedOpenOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/orders`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const raw = (await res.json()) as unknown;
      if (!Array.isArray(raw)) return;
      const seeded = (raw as OmsOrderEvent[])
        .filter(e => !TERMINAL.has(e.status))
        .map(mapOrderEvent);
      setOrders(prev => {
        const known = new Set(prev.map(o => o.omsOrderId));
        const additions = seeded.filter(o => !known.has(o.omsOrderId));
        if (additions.length === 0) return prev;
        const merged = [...prev, ...additions];
        merged.sort((a, b) => b.timestamp - a.timestamp);
        return merged.slice(0, MAX_ORDERS);
      });
    } catch {
      // OMS briefly unreachable: the WS reconnect path retries the seed.
    }
  }, []);

  const resetOrders = useCallback(() => {
    setOrders([]);
  }, []);

  const removeOrder = useCallback((omsOrderId: string) => {
    setOrders(prev => prev.filter(o => o.omsOrderId !== omsOrderId));
  }, []);

  // Only engine-acked working orders; PENDING_* states are transient and
  // stay out of the Open Orders panel (same selector semantics as before).
  const openOrders = orders.filter(
    o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED'
  );

  return {
    orders,
    openOrders,
    handleOrderEvent,
    seedOpenOrders,
    resetOrders,
    removeOrder,
  };
}
