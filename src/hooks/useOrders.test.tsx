// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * useOrders against the user-scoped OMS surfaces (oms#72): OrderResponse
 * events keyed/upserted by omsOrderId, terminal statuses remove, money
 * strings parsed, BUY/SELL mapped to the UI's BID/ASK, and the REST seed
 * never overwrites a live WS entry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrders } from './useOrders';
import type { OmsOrderEvent } from '../types/market';

function event(over: Partial<OmsOrderEvent> = {}): OmsOrderEvent {
  return {
    omsOrderId: '331900000000000001',
    clusterOrderId: '42',
    userId: 1,
    marketId: 1,
    side: 'BUY',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    price: '100000.00000000',
    quantity: '0.50000000',
    filledQty: '0.00000000',
    remainingQty: '0.50000000',
    stopPrice: null,
    status: 'NEW',
    rejectReason: null,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...over,
  };
}

function stubFetch(body: unknown) {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('useOrders (OMS-scoped)', () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch([]);
  });

  it('maps a wire OrderResponse to UserOrder state', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event()));

    expect(result.current.orders).toHaveLength(1);
    const o = result.current.orders[0];
    expect(o.omsOrderId).toBe('331900000000000001');
    expect(o.orderId).toBe(42); // Number(clusterOrderId)
    expect(o.side).toBe('BID'); // BUY → BID
    expect(o.price).toBe(100000); // '100000.00000000' parsed
    expect(o.originalQuantity).toBe(0.5);
    expect(o.remainingQuantity).toBe(0.5);
    expect(o.filledQuantity).toBe(0);
    expect(o.market).toBe('BTC-USD');
    expect(o.timestamp).toBe(1000);
    expect(result.current.openOrders).toHaveLength(1);
  });

  it('maps SELL to ASK', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event({ side: 'SELL' })));
    expect(result.current.orders[0].side).toBe('ASK');
  });

  it('upserts by omsOrderId', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event()));
    act(() =>
      result.current.handleOrderEvent(
        event({
          clusterOrderId: '42',
          status: 'PARTIALLY_FILLED',
          filledQty: '0.20000000',
          remainingQty: '0.30000000',
          updatedAtMs: 2000,
        })
      )
    );

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0].status).toBe('PARTIALLY_FILLED');
    expect(result.current.orders[0].filledQuantity).toBe(0.2);
  });

  it('keeps PENDING_* orders in the list but out of openOrders', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event({ status: 'PENDING_NEW', clusterOrderId: '0' })));
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.openOrders).toHaveLength(0);
  });

  it('removes the entry on terminal status', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event()));
    act(() =>
      result.current.handleOrderEvent(
        event({ status: 'FILLED', filledQty: '0.50000000', remainingQty: '0.00000000' })
      )
    );
    expect(result.current.orders).toHaveLength(0);

    // CANCELLED and REJECTED behave the same
    act(() => result.current.handleOrderEvent(event({ omsOrderId: 'a1' })));
    act(() => result.current.handleOrderEvent(event({ omsOrderId: 'a1', status: 'CANCELLED' })));
    expect(result.current.orders).toHaveLength(0);
  });

  it('seed merges REST rows but the WS entry wins on conflict', async () => {
    const wsUpdated = event({
      omsOrderId: 'seed-1',
      status: 'PARTIALLY_FILLED',
      filledQty: '0.10000000',
      remainingQty: '0.40000000',
    });
    // The REST snapshot is staler for seed-1 and also knows about seed-2
    stubFetch([
      event({ omsOrderId: 'seed-1', status: 'NEW', filledQty: '0.00000000' }),
      event({ omsOrderId: 'seed-2', clusterOrderId: '43', createdAtMs: 900 }),
    ]);

    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(wsUpdated));
    await act(async () => {
      await result.current.seedOpenOrders();
    });

    expect(result.current.orders).toHaveLength(2);
    const seed1 = result.current.orders.find((o) => o.omsOrderId === 'seed-1')!;
    expect(seed1.status).toBe('PARTIALLY_FILLED'); // WS state preserved
    expect(seed1.filledQuantity).toBe(0.1);
    expect(result.current.orders.some((o) => o.omsOrderId === 'seed-2')).toBe(true);
  });

  it('removeOrder keys on omsOrderId; resetOrders clears', () => {
    const { result } = renderHook(() => useOrders());
    act(() => result.current.handleOrderEvent(event({ omsOrderId: 'x1' })));
    act(() => result.current.handleOrderEvent(event({ omsOrderId: 'x2' })));
    act(() => result.current.removeOrder('x1'));
    expect(result.current.orders.map((o) => o.omsOrderId)).toEqual(['x2']);
    act(() => result.current.resetOrders());
    expect(result.current.orders).toHaveLength(0);
  });
});
