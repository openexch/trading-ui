// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { MarketStats, TickerStatsMessage } from '../types/market';
import { EMPTY_TICKERS, marketRowStats, mergeLiveTicker, mergeTickers, parseTickerEntry, recordLiveTicker } from './tickers';
import type { TickerSnapshot } from './tickers';

const entry = (marketId: number, lastPrice: number, timestamp: number, over: Record<string, unknown> = {}) => ({
  marketId,
  market: `M-${marketId}`,
  lastPrice,
  priceChange: 1,
  priceChangePercent: 0.5,
  high24h: lastPrice + 1,
  low24h: lastPrice - 1,
  volume24h: 10,
  timestamp,
  ...over,
});

const live = (marketId: number, lastPrice: number, timestamp: number): TickerStatsMessage => ({
  type: 'TICKER_STATS',
  ...entry(marketId, lastPrice, timestamp),
});

describe('parseTickerEntry', () => {
  it('keeps the TICKER_STATS fields', () => {
    expect(parseTickerEntry(entry(2, 3000, 5))).toEqual([
      2,
      { lastPrice: 3000, priceChange: 1, priceChangePercent: 0.5, high24h: 3001, low24h: 2999, volume24h: 10, timestamp: 5 },
    ]);
  });

  it('drops malformed or unpriced entries', () => {
    expect(parseTickerEntry(null)).toBeNull();
    expect(parseTickerEntry('x')).toBeNull();
    expect(parseTickerEntry(entry(0, 1, 1))).toBeNull();
    expect(parseTickerEntry(entry(1.5, 1, 1))).toBeNull();
    expect(parseTickerEntry(entry(1, 0, 1))).toBeNull(); // no price yet: stays a dash
    expect(parseTickerEntry(entry(1, -2, 1))).toBeNull();
    expect(parseTickerEntry(entry(1, 1, 1, { volume24h: 'lots' }))).toBeNull();
    expect(parseTickerEntry(entry(1, 1, 1, { high24h: Number.NaN }))).toBeNull();
    expect(parseTickerEntry(entry(1, 1, 1, { timestamp: undefined }))).toBeNull();
  });
});

describe('mergeTickers', () => {
  it('adds every valid entry and skips bad ones', () => {
    const m = mergeTickers(EMPTY_TICKERS, [entry(1, 100, 1), { bogus: true }, entry(7, 2, 1)]);
    expect([...m.keys()].sort()).toEqual([1, 7]);
    expect(m.get(7)!.lastPrice).toBe(2);
  });

  it('a newer entry replaces, an older one never does', () => {
    const a = mergeTickers(EMPTY_TICKERS, [entry(1, 100, 10)]);
    const b = mergeTickers(a, [entry(1, 90, 9)]);
    expect(b).toBe(a);
    expect(b.get(1)!.lastPrice).toBe(100);
    const c = mergeTickers(b, [entry(1, 110, 11)]);
    expect(c.get(1)!.lastPrice).toBe(110);
    // Same timestamp, refreshed 24h figures (the rolling baseline) still apply.
    const d = mergeTickers(c, [entry(1, 110, 11, { volume24h: 99 })]);
    expect(d.get(1)!.volume24h).toBe(99);
  });

  it('returns the same map when nothing changed (no re-render)', () => {
    const a = mergeTickers(EMPTY_TICKERS, [entry(1, 100, 10)]);
    expect(mergeTickers(a, [entry(1, 100, 10)])).toBe(a);
    expect(mergeTickers(a, [])).toBe(a);
    expect(mergeTickers(a, undefined)).toBe(a);
  });

  it('never mutates the previous map', () => {
    const a = mergeTickers(EMPTY_TICKERS, [entry(1, 100, 10)]);
    mergeTickers(a, [entry(1, 200, 20), entry(2, 5, 20)]);
    expect(a.get(1)!.lastPrice).toBe(100);
    expect(a.has(2)).toBe(false);
  });
});

describe('mergeLiveTicker', () => {
  it('ignores a market TICKERS has not introduced (no frozen price on a backend without TICKERS)', () => {
    expect(mergeLiveTicker(EMPTY_TICKERS, live(1, 100, 10))).toBe(EMPTY_TICKERS);
  });

  it('refreshes a covered market forward in time only', () => {
    const a = mergeTickers(EMPTY_TICKERS, [entry(1, 100, 10)]);
    expect(mergeLiveTicker(a, live(1, 105, 12)).get(1)!.lastPrice).toBe(105);
    expect(mergeLiveTicker(a, live(1, 95, 8))).toBe(a);
  });
});

describe('live ticker seen before TICKERS', () => {
  it('an older TICKERS entry yields to the live value already seen; a newer one wins', () => {
    const seen = new Map<number, TickerSnapshot>();
    recordLiveTicker(seen, live(1, 97_412, 5));
    recordLiveTicker(seen, live(1, 1, 3)); // older live frame ignored
    expect(mergeTickers(EMPTY_TICKERS, [entry(1, 90_000, 4)], seen).get(1)!.lastPrice).toBe(97_412);
    expect(mergeTickers(EMPTY_TICKERS, [entry(1, 98_000, 6)], seen).get(1)!.lastPrice).toBe(98_000);
  });

  it('does not introduce a market TICKERS does not carry', () => {
    const seen = new Map<number, TickerSnapshot>();
    recordLiveTicker(seen, live(3, 150, 5));
    expect(mergeTickers(EMPTY_TICKERS, [entry(1, 90_000, 4)], seen).has(3)).toBe(false);
  });
});

describe('marketRowStats', () => {
  const liveStats: MarketStats = {
    lastPrice: 97_412, priceChange: -1, priceChangePercent: -0.12, high24h: 0, low24h: 0, volume24h: 0,
  };
  const tickers = mergeTickers(EMPTY_TICKERS, [entry(1, 90_000, 99_999_999), entry(2, 3000, 1)]);

  it('the selected market keeps its own live ticker, even against a newer-stamped TICKERS entry', () => {
    expect(marketRowStats(1, 1, liveStats, tickers)).toBe(liveStats);
  });

  it('the selected market falls back to its TICKERS entry until its live ticker lands', () => {
    expect(marketRowStats(1, 1, null, tickers)!.lastPrice).toBe(90_000);
  });

  it('other markets use TICKERS, or null (a dash) without an entry', () => {
    expect(marketRowStats(2, 1, liveStats, tickers)!.lastPrice).toBe(3000);
    expect(marketRowStats(3, 1, liveStats, tickers)).toBeNull();
    expect(marketRowStats(2, 1, liveStats, EMPTY_TICKERS)).toBeNull();
  });
});
