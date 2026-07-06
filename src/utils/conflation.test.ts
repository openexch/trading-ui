// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { MessageConflator } from './conflation';
import type {
  BookDeltaMessage,
  BookSnapshotMessage,
  CandleUpdateMessage,
  TickerStatsMessage,
  TradesBatchMessage,
  WebSocketMessage,
} from '../types/market';

const ticker = (marketId: number, lastPrice: number): TickerStatsMessage => ({
  type: 'TICKER_STATS',
  marketId,
  market: 'BTC-USD',
  lastPrice,
  priceChange: 0,
  priceChangePercent: 0,
  high24h: 0,
  low24h: 0,
  volume24h: 0,
  timestamp: lastPrice,
});

const delta = (marketId: number, price: number): BookDeltaMessage => ({
  type: 'BOOK_DELTA',
  marketId,
  market: 'BTC-USD',
  changes: [{ price, quantity: 1, orderCount: 1, side: 'BID', updateType: 'UPDATE_LEVEL' }],
  bidVersion: 0,
  askVersion: 0,
  timestamp: price,
});

const snapshot = (marketId: number): BookSnapshotMessage => ({
  type: 'BOOK_SNAPSHOT',
  marketId,
  market: 'BTC-USD',
  bids: [],
  asks: [],
  timestamp: 1,
});

const tradesBatch = (marketId: number, prices: number[]): TradesBatchMessage => ({
  type: 'TRADES_BATCH',
  marketId,
  market: 'BTC-USD',
  trades: prices.map((p) => ({
    price: p,
    quantity: 1,
    tradeCount: 1,
    side: 'BUY' as const,
    timestamp: p,
  })),
  timestamp: 1,
});

const candleUpdate = (marketId: number, time: number, close: number): CandleUpdateMessage => ({
  type: 'CANDLE_UPDATE',
  marketId,
  market: 'BTC-USD',
  interval: '1m',
  candle: { time, open: 0, high: 0, low: 0, close, volume: 0, tradeCount: 0 },
});

const drainMessages = (c: MessageConflator): WebSocketMessage[] => c.drain(0).messages;

describe('MessageConflator', () => {
  it('keeps only the latest ticker per market, in place', () => {
    const c = new MessageConflator();
    c.push(ticker(1, 100));
    c.push(ticker(2, 555));
    c.push(ticker(1, 101));
    c.push(ticker(1, 102));
    const out = drainMessages(c);
    expect(out).toHaveLength(2);
    expect((out[0] as TickerStatsMessage).lastPrice).toBe(102);
    expect((out[1] as TickerStatsMessage).lastPrice).toBe(555);
  });

  it('passes book deltas through in arrival order, never collapsed', () => {
    const c = new MessageConflator();
    c.push(delta(1, 10));
    c.push(ticker(1, 1));
    c.push(delta(1, 11));
    c.push(delta(1, 10)); // same level again — must NOT collapse
    const out = drainMessages(c);
    const deltas = out.filter((m) => m.type === 'BOOK_DELTA') as BookDeltaMessage[];
    expect(deltas.map((d) => d.changes[0].price)).toEqual([10, 11, 10]);
  });

  it('snapshot supersedes queued book messages for its market only', () => {
    const c = new MessageConflator();
    c.push(delta(1, 10));
    c.push(delta(2, 20));
    c.push(snapshot(1));
    c.push(delta(1, 11)); // after the snapshot — must survive, in order
    const out = drainMessages(c);
    expect(out.map((m) => m.type)).toEqual(['BOOK_DELTA', 'BOOK_SNAPSHOT', 'BOOK_DELTA']);
    expect((out[0] as BookDeltaMessage).marketId).toBe(2);
    expect((out[2] as BookDeltaMessage).changes[0].price).toBe(11);
  });

  it('merges trades batches per market, keeping the newest on overflow', () => {
    const c = new MessageConflator();
    c.push(tradesBatch(1, [1, 2]));
    c.push(tradesBatch(1, [3]));
    c.push(tradesBatch(2, [9]));
    const out = drainMessages(c);
    const m1 = out.find((m) => m.type === 'TRADES_BATCH' && m.marketId === 1) as TradesBatchMessage;
    expect(m1.trades.map((t) => t.price)).toEqual([1, 2, 3]);
    expect(out.filter((m) => m.type === 'TRADES_BATCH')).toHaveLength(2);
  });

  it('does not mutate the original trades message when merging', () => {
    const c = new MessageConflator();
    const original = tradesBatch(1, [1]);
    c.push(original);
    c.push(tradesBatch(1, [2]));
    expect(original.trades).toHaveLength(1);
  });

  it('keeps latest candle update per bucket, distinct buckets survive', () => {
    const c = new MessageConflator();
    c.push(candleUpdate(1, 60, 100));
    c.push(candleUpdate(1, 60, 101));
    c.push(candleUpdate(1, 120, 200)); // new bucket — must be a separate slot
    const out = drainMessages(c);
    const candles = out.filter((m) => m.type === 'CANDLE_UPDATE') as CandleUpdateMessage[];
    expect(candles).toHaveLength(2);
    expect(candles[0].candle.close).toBe(101);
    expect(candles[1].candle.close).toBe(200);
  });

  it('drops the book backlog on overflow and requests a refresh once per interval', () => {
    const c = new MessageConflator();
    for (let i = 0; i < 3005; i++) {
      c.push(delta(1, i));
    }
    const first = c.drain(1000);
    // Backlog dropped entirely — none of the 3005 deltas survive
    expect(first.messages.filter((m) => m.type === 'BOOK_DELTA')).toHaveLength(0);
    expect(first.refreshMarketIds).toEqual([1]);

    // Still awaiting the snapshot: new deltas are swallowed, refresh not
    // re-reported inside the retry interval...
    c.push(delta(1, 1));
    const second = c.drain(1500);
    expect(second.messages).toHaveLength(0);
    expect(second.refreshMarketIds).toEqual([]);

    // ...but IS re-reported after it.
    const third = c.drain(4000);
    expect(third.refreshMarketIds).toEqual([1]);

    // The snapshot ends the episode: deltas flow again.
    c.push(snapshot(1));
    c.push(delta(1, 2));
    const fourth = c.drain(5000);
    expect(fourth.messages.map((m) => m.type)).toEqual(['BOOK_SNAPSHOT', 'BOOK_DELTA']);
    expect(fourth.refreshMarketIds).toEqual([]);
  });

  it('drain resets the buffer; clear drops refresh state too', () => {
    const c = new MessageConflator();
    c.push(ticker(1, 1));
    expect(drainMessages(c)).toHaveLength(1);
    expect(drainMessages(c)).toHaveLength(0);

    for (let i = 0; i < 3001; i++) c.push(delta(1, i));
    c.clear();
    const out = c.drain(0);
    expect(out.messages).toHaveLength(0);
    expect(out.refreshMarketIds).toEqual([]);
  });

  it('passes unknown/append-only types through in order', () => {
    const c = new MessageConflator();
    c.push({ type: 'PONG', timestamp: 1 });
    c.push(ticker(1, 1));
    c.push({ type: 'ERROR', message: 'x' });
    const out = drainMessages(c);
    expect(out.map((m) => m.type)).toEqual(['PONG', 'TICKER_STATS', 'ERROR']);
  });
});
