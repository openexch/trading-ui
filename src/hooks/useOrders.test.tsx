// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * useOrders against the v2 surfaces: Order objects from the user stream
 * keyed and upserted by orderId, terminal statuses remove, money strings
 * parsed, BUY/SELL mapped to the UI's BID/ASK, the stream snapshot replaces
 * the list, and the REST seed (GET /api/v2/orders) never overwrites a live
 * entry nor brings back one the stream closed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrders } from './useOrders';
import type { ApiOrder } from '../types/market';
import '../test/markets';

function order(over: Partial<ApiOrder> = {}): ApiOrder {
  return {
    orderId: '1042',
    clientOrderId: null,
    marketId: '1',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    price: '100000',
    stopPrice: null,
    quantity: '0.5',
    filledQuantity: '0',
    remainingQuantity: '0.5',
    status: 'NEW',
    reason: null,
    meReason: null,
    meOrderId: '42',
    hold: { assetId: '0', amount: '50000' },
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

const calls: string[] = [];
function stubFetch(orders: ApiOrder[]) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const body = { asOf: { logPosition: 1 }, orders };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('useOrders (v2)', () => {
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    stubFetch([]);
  });

  it('maps a v2 Order to UserOrder state', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order()));

    expect(result.current.orders).toHaveLength(1);
    const o = result.current.orders[0];
    expect(o.omsOrderId).toBe('1042');
    expect(o.orderId).toBe(42); // meOrderId, display only
    expect(o.marketId).toBe(1); // "1" through the one marketId mapping
    expect(o.side).toBe('BID');
    expect(o.price).toBe(100000);
    expect(o.originalQuantity).toBe(0.5);
    expect(o.remainingQuantity).toBe(0.5);
    expect(o.filledQuantity).toBe(0);
    expect(o.market).toBe('BTC-USD');
    expect(o.timestamp).toBe(1000);
    expect(result.current.openOrders).toHaveLength(1);
  });

  it('maps SELL to ASK and a priceless MARKET order to 0', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order({ side: 'SELL', type: 'MARKET', price: null })));
    expect(result.current.orders[0].side).toBe('ASK');
    expect(result.current.orders[0].price).toBe(0);
  });

  it('upserts by orderId', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order()));
    act(() =>
      result.current.handleOrderEvent(
        order({ status: 'PARTIALLY_FILLED', filledQuantity: '0.2', remainingQuantity: '0.3', updatedAt: 2000 })
      )
    );
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].status).toBe('PARTIALLY_FILLED');
    expect(result.current.orders[0].filledQuantity).toBe(0.2);
  });

  it('keeps PENDING_NEW out of openOrders; PENDING_REPLACE and PENDING_CANCEL stay in', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order({ status: 'PENDING_NEW', meOrderId: null })));
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.openOrders).toHaveLength(0);
    act(() => result.current.handleOrderEvent(order({ status: 'PENDING_REPLACE' })));
    expect(result.current.openOrders.map(o => o.status)).toEqual(['PENDING_REPLACE']);
    act(() => result.current.handleOrderEvent(order({ status: 'PENDING_CANCEL' })));
    expect(result.current.openOrders.map(o => o.status)).toEqual(['PENDING_CANCEL']);
  });

  it('removes the entry on every terminal status, EXPIRED included', () => {
    const { result } = renderHook(() => useOrders());
    for (const status of ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED']) {
      act(() => result.current.handleOrderEvent(order({ orderId: status })));
      act(() => result.current.handleOrderEvent(order({ orderId: status, status })));
      expect(result.current.orders, status).toHaveLength(0);
    }
  });

  it('reports a REJECTED order with its reason before dropping it', () => {
    const onRejected = vi.fn();
    const { result } = renderHook(() => useOrders(onRejected));
    act(() => result.current.handleOrderEvent(order({ status: 'REJECTED', reason: 'ME_PRICE_OFF_TICK' })));
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: 'ME_PRICE_OFF_TICK' }));
  });

  it('seed reads GET /api/v2/orders, merges, and the stream entry wins on conflict', async () => {
    stubFetch([
      order({ orderId: 'seed-1', status: 'NEW', filledQuantity: '0' }),
      order({ orderId: 'seed-2', meOrderId: '43', createdAt: 900 }),
    ]);
    const { result } = renderHook(() => useOrders());
    act(() =>
      result.current.handleOrderEvent(
        order({ orderId: 'seed-1', status: 'PARTIALLY_FILLED', filledQuantity: '0.1', remainingQuantity: '0.4' })
      )
    );
    await act(async () => {
      await result.current.seedOpenOrders();
    });
    expect(calls[0]).toMatch(/\/api\/v2\/orders$/);
    expect(result.current.orders).toHaveLength(2);
    const seed1 = result.current.orders.find(o => o.omsOrderId === 'seed-1')!;
    expect(seed1.status).toBe('PARTIALLY_FILLED');
    expect(seed1.filledQuantity).toBe(0.1);
  });

  it('a late seed does not bring back an order the stream closed', async () => {
    stubFetch([order({ orderId: 'gone' })]);
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order({ orderId: 'gone', status: 'CANCELLED' })));
    await act(async () => {
      await result.current.seedOpenOrders();
    });
    expect(result.current.orders).toHaveLength(0);
  });

  it('a stream snapshot replaces the list', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order({ orderId: 'old' })));
    act(() => result.current.applySnapshot([order({ orderId: 'a' }), order({ orderId: 'b', status: 'FILLED' })]));
    expect(result.current.orders.map(o => o.omsOrderId)).toEqual(['a']);
  });

  it('removeOrder keys on orderId; resetOrders clears', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(order({ orderId: 'x1' })));
    act(() => result.current.handleOrderEvent(order({ orderId: 'x2' })));
    act(() => result.current.removeOrder('x1'));
    expect(result.current.orders.map(o => o.omsOrderId)).toEqual(['x2']);
    act(() => result.current.resetOrders());
    expect(result.current.orders).toHaveLength(0);
  });
});
