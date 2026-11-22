// SPDX-License-Identifier: Apache-2.0
/**
 * Test doubles that speak the real wire: the v2 gateway's REST answers (the
 * shapes of the gateway's docs/api.md) and the market-data frames (decimal
 * strings, the field set of the golden frames).
 */
import { GATEWAY_MARKETS_BODY } from './gatewayMarkets';
import type { ApiOrder } from '../types/market';

/** A number as a wire decimal string (at most 8 fraction digits, no
 *  trailing zeros). */
export function dec(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}

export interface Reply {
  status: number;
  body?: unknown;
}

export function asResponse(reply: Reply): Response {
  const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => (text ? JSON.parse(text) : null),
    text: async () => text,
  } as Response;
}

/** The error body of every gateway refusal. */
export function apiError(code: string, error: string, reason: string | null = null, detail: string | null = null) {
  return { error, code, reason, detail, keyFinal: false };
}

const HISTORY_EMPTY = { items: [], nextCursor: null, asOf: { ageMs: 0, stale: false, eventSeq: 1 } };

/** The default answer of a v2 gateway (and the candles route) for a request. */
export function gatewayReply(url: string, method = 'GET'): Reply {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/api/candles')) {
    const q = new URLSearchParams(path.split('?')[1] ?? '');
    return { status: 200, body: { marketId: Number(q.get('marketId')), interval: q.get('interval'), candles: [] } };
  }
  if (path === '/api/v2/markets') return { status: 200, body: GATEWAY_MARKETS_BODY };
  if (path === '/api/v2/auth/me') return { status: 200, body: { userId: '1', username: 'dev' } };
  if (path === '/api/v2/auth/logout') return { status: 204 };
  if (path.startsWith('/api/v2/orders/history') || path.startsWith('/api/v2/fills')) return { status: 200, body: HISTORY_EMPTY };
  const one = /^\/api\/v2\/orders\/([0-9A-Za-z-]+)$/.exec(path);
  if (one && method === 'PUT') return { status: 200, body: { orderId: one[1], status: 'PENDING_REPLACE', duplicate: false } };
  if (one && method === 'DELETE') return { status: 200, body: { orderId: one[1], status: 'PENDING_CANCEL', duplicate: false } };
  if (path === '/api/v2/orders' && method === 'POST') {
    return {
      status: 201,
      body: {
        orderId: '1042', status: 'PENDING_NEW', duplicate: false, marketId: '1',
        hold: { assetId: '0', amount: '1' }, acceptedAt: 1, eventSeq: 1,
      },
    };
  }
  if (path.startsWith('/api/v2/orders')) return { status: 200, body: { asOf: { logPosition: 1 }, orders: [] } };
  if (path === '/api/v2/balances') return { status: 200, body: { asOf: { logPosition: 1 }, assets: [] } };
  const transfer = /^\/api\/v2\/balances\/(deposit|withdraw)$/.exec(path);
  if (transfer) return { status: 200, body: { assetId: '0', amount: '1', available: '1', duplicate: false } };
  return { status: 404, body: apiError('NOT_FOUND', 'no such route') };
}

/** A v2 Order object with overrides. */
export function apiOrder(over: Partial<ApiOrder> = {}): ApiOrder {
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
    meOrderId: '7',
    hold: { assetId: '0', amount: '1' },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

/** A user stream `order` frame. */
export function orderFrame(order: ApiOrder, eventSeq: number, event = 'ACK_NEW'): string {
  return JSON.stringify({ type: 'order', eventSeq, event, order });
}

type Level = { price: number; quantity: number; orderCount: number };

const wireLevel = (l: Level) => ({ price: dec(l.price), quantity: dec(l.quantity), orderCount: l.orderCount });

/** A BOOK_SNAPSHOT frame as oe-marketdata sends it. */
export function bookSnapshotFrame(marketId: number, bids: Level[], asks: Level[], timestamp: number, bookVersion = 1): string {
  return JSON.stringify({
    type: 'BOOK_SNAPSHOT',
    marketId,
    bids: bids.map(wireLevel),
    asks: asks.map(wireLevel),
    bookVersion,
    timestamp,
  });
}

/** One ticker (TICKER_STATS fields without `type`) with numbers as wire decimals. */
export function tickerEntry(t: {
  marketId: number;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}) {
  const sdec = (n: number) => (n < 0 ? `-${dec(-n)}` : dec(n));
  return {
    marketId: t.marketId,
    lastPrice: dec(t.lastPrice),
    priceChange: sdec(t.priceChange),
    priceChangePercent: sdec(t.priceChangePercent),
    high24h: dec(t.high24h),
    low24h: dec(t.low24h),
    volume24h: dec(t.volume24h),
    timestamp: t.timestamp,
  };
}
