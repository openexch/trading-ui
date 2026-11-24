// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useRef } from 'react';
import { EV, track } from '../analytics';
import type { UserOrder, ApiOrder, OrderStatus, OrderType } from '../types/market';
import { apiRequest } from '../api/gateway';
import { marketIdFromApi } from '../api/marketId';
import { parseDecimal, parseOptionalDecimal } from '../api/decimal';
import { marketSymbol } from '../markets/marketStore';

const MAX_ORDERS = 100;
export const TERMINAL: ReadonlySet<string> = new Set(['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED']);
/** How many recently closed ids a late REST seed may not bring back. */
const MAX_CLOSED_IDS = 512;

/** Map a v2 Order (stream `order` frame, stream snapshot row or GET
 *  /api/v2/orders row) to UI state. Exported for tests. */
export function mapOrder(o: ApiOrder): UserOrder {
  const marketId = marketIdFromApi(o.marketId);
  return {
    // The matching engine's id: display only. REST cancel/amend key on the
    // gateway's orderId (omsOrderId here), never this.
    orderId: o.meOrderId ? Number(o.meOrderId) : 0,
    omsOrderId: o.orderId,
    marketId,
    market: marketSymbol(marketId),
    side: o.side === 'BUY' ? 'BID' : 'ASK',
    type: o.type as OrderType,
    // MARKET, STOP_LOSS and TRAILING_STOP orders carry no price.
    price: parseOptionalDecimal(o.price, 'price') ?? 0,
    originalQuantity: parseDecimal(o.quantity, 'quantity'),
    remainingQuantity: parseDecimal(o.remainingQuantity, 'remainingQuantity'),
    filledQuantity: parseDecimal(o.filledQuantity, 'filledQuantity'),
    status: o.status as OrderStatus,
    timestamp: o.createdAt,
  };
}

/**
 * The signed-in user's working orders: `order` frames of the user stream
 * (/ws/v2) keyed by orderId, the stream's orders snapshot, and the REST seed
 * GET /api/v2/orders on (re)connect and session change.
 */
export function useOrders(onRejected?: (order: ApiOrder) => void) {
  const [orders, setOrders] = useState<UserOrder[]>([]);
  // Ids the stream closed: a REST seed answered from an older core state
  // must not bring them back.
  const closedRef = useRef<Set<string>>(new Set());

  const markClosed = useCallback((id: string) => {
    const closed = closedRef.current;
    closed.add(id);
    if (closed.size > MAX_CLOSED_IDS) {
      const oldest = closed.values().next().value;
      if (oldest !== undefined) closed.delete(oldest);
    }
  }, []);

  // Stream event: terminal status removes the entry, anything else upserts.
  const handleOrderEvent = useCallback((order: ApiOrder) => {
    // An accepted-then-rejected order must never vanish silently: the
    // matching engine rejects after the core accepted it, and the only
    // signal is this event. Surface it before dropping the row.
    if (order.status === 'REJECTED') {
      onRejected?.(order);
    }
    if (order.status === 'FILLED') {
      track(EV.order_filled, { market_id: order.marketId, side: order.side, order_type: order.type });
    }
    if (TERMINAL.has(order.status)) markClosed(order.orderId);
    setOrders(prev => {
      if (TERMINAL.has(order.status)) {
        return prev.some(o => o.omsOrderId === order.orderId)
          ? prev.filter(o => o.omsOrderId !== order.orderId)
          : prev;
      }
      const mapped = mapOrder(order);
      const idx = prev.findIndex(o => o.omsOrderId === order.orderId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mapped;
        return next;
      }
      return [mapped, ...prev].slice(0, MAX_ORDERS);
    });
  }, [onRejected, markClosed]);

  // The stream's orders snapshot (on subscribe and after a resync) is the
  // full open set as of its eventSeq: it replaces the list.
  const applySnapshot = useCallback((rows: ApiOrder[]) => {
    const mapped = rows.filter(o => !TERMINAL.has(o.status)).map(mapOrder);
    mapped.sort((a, b) => b.timestamp - a.timestamp);
    setOrders(mapped.slice(0, MAX_ORDERS));
  }, []);

  // REST seed of the caller's open orders (all markets). Merge where the
  // stream wins: an entry already present is never overwritten, and an id
  // the stream closed is not brought back.
  const seedOpenOrders = useCallback(async () => {
    try {
      const res = await apiRequest<{ orders?: unknown }>('/orders');
      if (!res.ok) return;
      const raw = res.body?.orders;
      if (!Array.isArray(raw)) return;
      const closed = closedRef.current;
      const seeded = (raw as ApiOrder[])
        .filter(o => !TERMINAL.has(o.status) && !closed.has(o.orderId))
        .map(mapOrder);
      setOrders(prev => {
        const known = new Set(prev.map(o => o.omsOrderId));
        const additions = seeded.filter(o => !known.has(o.omsOrderId));
        if (additions.length === 0) return prev;
        const merged = [...prev, ...additions];
        merged.sort((a, b) => b.timestamp - a.timestamp);
        return merged.slice(0, MAX_ORDERS);
      });
    } catch {
      // Gateway briefly unreachable: the stream reconnect path retries the seed.
    }
  }, []);

  const resetOrders = useCallback(() => {
    closedRef.current = new Set();
    setOrders([]);
  }, []);

  const removeOrder = useCallback((omsOrderId: string) => {
    markClosed(omsOrderId);
    setOrders(prev => prev.filter(o => o.omsOrderId !== omsOrderId));
  }, [markClosed]);

  // Orders resting in the book, including an accepted cancel or amend on its
  // way (PENDING_CANCEL, PENDING_REPLACE); PENDING_NEW is transient and stays
  // out of the Open Orders panel.
  const openOrders = orders.filter(
    o =>
      o.status === 'NEW' ||
      o.status === 'PARTIALLY_FILLED' ||
      o.status === 'PENDING_REPLACE' ||
      o.status === 'PENDING_CANCEL'
  );

  return {
    orders,
    openOrders,
    handleOrderEvent,
    applySnapshot,
    seedOpenOrders,
    resetOrders,
    removeOrder,
  };
}
