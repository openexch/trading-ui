// SPDX-License-Identifier: Apache-2.0
/**
 * Market frames against the UI's types (the UI half of the frame and REST
 * shape check). The golden files under src/test/golden/marketdata are
 * byte-exact copies of the market-data service's golden frames (gateway
 * repository, tests/golden/marketdata, commit c74f1ef): every one must parse
 * with the UI's decoder, carry every field of its schema with its JSON type,
 * and give decimal strings for prices. The schema itself is tied to the wire
 * types at compile time (`satisfies` in marketFrames.ts) and checked here at
 * type level too.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  CANDLES_BODY_SCHEMA,
  FRAME_SCHEMA,
  decodeCandlesBody,
  decodeMarketFrame,
  validateFrame,
} from './marketFrames';
import type {
  BookChangeWire,
  BookDeltaWire,
  BookLevelWire,
  BookSnapshotWire,
  CandleWire,
  CandlesBodyWire,
  TickerStatsWire,
  TradeWire,
} from './marketFrames';
import type { BookDeltaMessage, BookSnapshotMessage, CandleData, TickerStatsMessage, TradesBatchMessage } from '../types/market';

const GOLDEN = import.meta.glob('../test/golden/marketdata/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const golden = (name: string): string => {
  const text = GOLDEN[`../test/golden/marketdata/${name}.json`];
  if (text === undefined) throw new Error(`golden frame missing: ${name}`);
  return text;
};

const FRAMES = Object.keys(GOLDEN)
  .map(p => p.replace(/^.*\//, '').replace(/\.json$/, ''))
  .filter(n => n !== 'candles_body_5m');

describe('market frames: golden files parse with the UI decoder', () => {
  it('has every golden frame of the service', () => {
    expect(FRAMES.sort()).toEqual([
      'book_delta_80',
      'book_snapshot_20x20',
      'book_snapshot_base',
      'book_snapshot_empty',
      'book_snapshot_no_snapshot',
      'candle_history_1m',
      'candle_update_new',
      'candle_update_open',
      'error_bad_request',
      'error_history_unavailable',
      'pong',
      'subscription_confirmed',
      'ticker_stats_flush',
      'ticker_stats_initial',
      'tickers_changed',
      'tickers_handshake',
      'trades_batch_flush',
      'trades_batch_initial',
    ]);
  });

  for (const name of FRAMES) {
    it(`${name} validates and decodes`, () => {
      const raw = JSON.parse(golden(name));
      expect(() => validateFrame(raw)).not.toThrow();
      const decoded = decodeMarketFrame(raw);
      expect(decoded.type).toBe(raw.type);
    });
  }

  it('every frame type of the public surface is covered by a golden frame', () => {
    const seen = new Set(FRAMES.map(n => JSON.parse(golden(n)).type));
    expect([...seen].sort()).toEqual(Object.keys(FRAME_SCHEMA).sort());
  });

  it('BOOK_SNAPSHOT: decimal-string levels become numbers; the chain version and stale flag carry over', () => {
    const snap = decodeMarketFrame(JSON.parse(golden('book_snapshot_base'))) as BookSnapshotMessage;
    expect(snap.marketId).toBe(3);
    expect(snap.bids[0]).toEqual({ price: 13.99, quantity: 5, orderCount: 2 });
    expect(snap.bids).toHaveLength(20);
    expect(snap.asks).toHaveLength(20);
    expect(snap.bookVersion).toBe(2199023255553);
    expect(snap.stale).toBeUndefined();
    const none = decodeMarketFrame(JSON.parse(golden('book_snapshot_no_snapshot'))) as BookSnapshotMessage;
    expect(none.stale).toBe(true);
  });

  it('BOOK_DELTA: every change keeps side and updateType; fromVersion -> bookVersion', () => {
    const d = decodeMarketFrame(JSON.parse(golden('book_delta_80'))) as BookDeltaMessage;
    expect(d.changes.length).toBe(80);
    expect(d.fromVersion).toBe(2199023255553);
    expect(d.bookVersion).toBe(2199023255632);
    expect(d.changes[1]).toEqual({ price: 14.01, quantity: 3.00000001, orderCount: 2, side: 'BID', updateType: 'NEW_LEVEL' });
  });

  it('TRADES_BATCH: one entry per trade, tradeId a decimal string, tradeCount 1', () => {
    const t = decodeMarketFrame(JSON.parse(golden('trades_batch_flush'))) as TradesBatchMessage;
    expect(t.trades).toEqual([
      { tradeId: '105', price: 15002, quantity: 0.05, tradeCount: 1, side: 'BUY', timestamp: 1700000140000, journalSeq: null },
      { tradeId: '106', price: 15003, quantity: 0.075, tradeCount: 1, side: 'SELL', timestamp: 1700000165000, journalSeq: null },
    ]);
  });

  it('TICKER_STATS: every 24 h field a decimal string', () => {
    const s = decodeMarketFrame(JSON.parse(golden('ticker_stats_initial'))) as TickerStatsMessage;
    expect(s).toEqual({
      type: 'TICKER_STATS', marketId: 3, lastPrice: 15000.5, priceChange: 0.5, priceChangePercent: 0.00333333,
      high24h: 15001, low24h: 14999, volume24h: 18750.35, timestamp: 1700000130000,
    });
  });

  it('a ticker with trades but none in 24 h ("0" fields) still parses and keeps its last price', () => {
    const raw = JSON.parse(golden('tickers_changed'));
    Object.assign(raw.tickers[0], { priceChange: '0', priceChangePercent: '0', high24h: '0', low24h: '0', volume24h: '0' });
    const d = decodeMarketFrame(raw);
    expect(d.type === 'TICKERS' && d.tickers[0].lastPrice).toBe(15003);
  });

  it('a negative 24 h change parses (the change fields are signed)', () => {
    const raw = JSON.parse(golden('ticker_stats_flush'));
    raw.priceChange = '-3';
    raw.priceChangePercent = '-0.02';
    const d = decodeMarketFrame(raw) as TickerStatsMessage;
    expect([d.priceChange, d.priceChangePercent]).toEqual([-3, -0.02]);
  });

  it('candles: time in epoch seconds, OHLC and volume decimal strings', () => {
    const h = decodeMarketFrame(JSON.parse(golden('candle_history_1m')));
    expect(h.type === 'CANDLE_HISTORY' && h.candles[0]).toEqual({
      time: 1700000040, open: 15000, high: 15001, low: 15000, close: 15001, volume: 0.75, tradeCount: 2,
    });
  });

  it('GET /api/candles body: marketId is a JSON number, candles decode', () => {
    const raw = JSON.parse(golden('candles_body_5m'));
    expect(typeof raw.marketId).toBe('number');
    const body = decodeCandlesBody(raw);
    expect(body.marketId).toBe(3);
    expect(body.interval).toBe('5m');
    expect(body.candles).toHaveLength(2);
  });

  it('ERROR HISTORY_UNAVAILABLE keeps its parts', () => {
    const e = decodeMarketFrame(JSON.parse(golden('error_history_unavailable')));
    expect(e.type === 'ERROR' && e.parts).toEqual(['tape', 'candles', 'ticker']);
  });
});

describe('market frames: the schema refuses a changed wire', () => {
  // Control: a level sent with a JSON number price must be refused.
  it('a level with a JSON number price -> price is not a decimal string', () => {
    const raw = JSON.parse(golden('book_snapshot_base'));
    raw.bids[0].price = 13.99;
    expect(() => decodeMarketFrame(raw)).toThrow('price is not a decimal string');
  });

  it('a renamed change field is refused (updateType renamed)', () => {
    const raw = JSON.parse(golden('book_delta_80'));
    raw.changes[0].kind = raw.changes[0].updateType;
    delete raw.changes[0].updateType;
    expect(() => decodeMarketFrame(raw)).toThrow('updateType is missing');
  });

  it('a dropped field (the old `market` name) is refused', () => {
    const raw = JSON.parse(golden('trades_batch_flush'));
    raw.market = 'SOL-USD';
    expect(() => decodeMarketFrame(raw)).toThrow('market is not a field of TRADES_BATCH');
  });

  it('the dropped frames are unknown types', () => {
    for (const type of ['CLUSTER_STATUS', 'CLUSTER_EVENT', 'REFRESH_PENDING']) {
      expect(() => decodeMarketFrame({ type })).toThrow(`unknown frame type "${type}"`);
    }
  });

  it('a candles body with a string marketId is refused', () => {
    const raw = JSON.parse(golden('candles_body_5m'));
    raw.marketId = '3';
    expect(() => decodeCandlesBody(raw)).toThrow('marketId is not a JSON number');
  });
});

describe('market frames: type level', () => {
  it('wire types carry decimal strings and JSON numbers where the schema table says', () => {
    expectTypeOf<BookLevelWire>().toEqualTypeOf<{ price: string; quantity: string; orderCount: number }>();
    expectTypeOf<keyof BookChangeWire>().toEqualTypeOf<'price' | 'quantity' | 'orderCount' | 'side' | 'updateType'>();
    expectTypeOf<BookChangeWire['updateType']>().toEqualTypeOf<'NEW_LEVEL' | 'UPDATE_LEVEL' | 'DELETE_LEVEL'>();
    expectTypeOf<keyof BookSnapshotWire>().toEqualTypeOf<'type' | 'marketId' | 'bids' | 'asks' | 'bookVersion' | 'timestamp' | 'stale'>();
    expectTypeOf<keyof BookDeltaWire>().toEqualTypeOf<
      'type' | 'marketId' | 'changes' | 'bidVersion' | 'askVersion' | 'bookVersion' | 'fromVersion' | 'timestamp'
    >();
    expectTypeOf<TradeWire>().toEqualTypeOf<{
      tradeId: string; price: string; quantity: string; tradeCount: number; side: 'BUY' | 'SELL'; timestamp: number;
      journalSeq?: number;
    }>();
    expectTypeOf<TickerStatsWire['lastPrice']>().toEqualTypeOf<string>();
    expectTypeOf<TickerStatsWire['marketId']>().toEqualTypeOf<number>();
    expectTypeOf<CandleWire['time']>().toEqualTypeOf<number>();
    expectTypeOf<CandleWire['volume']>().toEqualTypeOf<string>();
    expectTypeOf<CandlesBodyWire['marketId']>().toEqualTypeOf<number>();
  });

  it('decoded UI types are numeric where the wire is a decimal string', () => {
    expectTypeOf<BookSnapshotMessage['bids'][number]['price']>().toEqualTypeOf<number>();
    expectTypeOf<BookSnapshotMessage['bookVersion']>().toEqualTypeOf<number>();
    expectTypeOf<TickerStatsMessage['volume24h']>().toEqualTypeOf<number>();
    expectTypeOf<CandleData['close']>().toEqualTypeOf<number>();
  });

  it('the runtime schema names exactly the fields of the wire types', () => {
    const keys = (o: object) => Object.keys(o).map(k => k.replace(/\?$/, '')).sort();
    expect(keys(FRAME_SCHEMA.BOOK_SNAPSHOT)).toEqual(['asks', 'bids', 'bookVersion', 'marketId', 'stale', 'timestamp', 'type']);
    expect(keys(FRAME_SCHEMA.TICKER_STATS)).toEqual(
      ['high24h', 'lastPrice', 'low24h', 'marketId', 'priceChange', 'priceChangePercent', 'timestamp', 'type', 'volume24h'],
    );
    expect(keys(CANDLES_BODY_SCHEMA)).toEqual(['candles', 'interval', 'marketId']);
  });
});

describe('market frames: the trade journal sequence', () => {
  const batch = (extra: Record<string, unknown>) => ({
    type: 'TRADES_BATCH',
    marketId: 3,
    trades: [{ tradeId: '105', price: '15002', quantity: '0.05', tradeCount: 1, side: 'BUY', timestamp: 1, ...extra }],
    timestamp: 2,
  });

  it('carries journalSeq to the tape when the service sends it', () => {
    const m = decodeMarketFrame(batch({ journalSeq: 88123 }));
    expect(m.type === 'TRADES_BATCH' && m.trades[0].journalSeq).toBe(88123);
  });

  it('a trade without journalSeq still decodes, with null (the tape prints a dash)', () => {
    const m = decodeMarketFrame(batch({}));
    expect(m.type === 'TRADES_BATCH' && m.trades[0].journalSeq).toBeNull();
  });

  it('a journalSeq that is not a JSON number is refused (the contract changed)', () => {
    expect(() => decodeMarketFrame(batch({ journalSeq: '88123' }))).toThrow('journalSeq is not a JSON number');
  });
});
