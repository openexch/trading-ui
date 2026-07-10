import { describe, it, expect } from 'vitest';
import { mergeLiveCandle } from './candles';
import type { CandleData } from '../types/market';

const c = (time: number, close: number, extra: Partial<CandleData> = {}): CandleData => ({
  time,
  open: extra.open ?? close,
  high: extra.high ?? close,
  low: extra.low ?? close,
  close,
  volume: extra.volume ?? 1,
  tradeCount: extra.tradeCount ?? 1,
});

describe('mergeLiveCandle', () => {
  it('seeds from empty history', () => {
    expect(mergeLiveCandle([], c(60, 100), 10)).toEqual([c(60, 100)]);
  });

  it('appends a new bucket', () => {
    const prev = [c(60, 100)];
    expect(mergeLiveCandle(prev, c(120, 200), 10)).toEqual([c(60, 100), c(120, 200)]);
  });

  it('updates the current bucket IN PLACE so its final value persists', () => {
    // The bug: same-bucket ticks used to be dropped, so the candle kept its
    // first-tick value and "changed" when it settled. It must track the latest.
    let hist = [c(60, 100)];
    hist = mergeLiveCandle(hist, c(120, 200, { open: 200 }), 10); // new bucket, first tick
    hist = mergeLiveCandle(hist, c(120, 250, { open: 200, high: 260 }), 10); // same bucket
    hist = mergeLiveCandle(hist, c(120, 210, { open: 200, high: 260, low: 190 }), 10); // final tick
    expect(hist[hist.length - 1]).toEqual(c(120, 210, { open: 200, high: 260, low: 190 }));
  });

  it('settled candle keeps its final value after the next bucket opens (the reported bug)', () => {
    let hist = [c(60, 100)];
    hist = mergeLiveCandle(hist, c(120, 200), 10); // bucket B opens at 200
    hist = mergeLiveCandle(hist, c(120, 205), 10); // B ticks to 205
    hist = mergeLiveCandle(hist, c(120, 198), 10); // B's FINAL close = 198
    hist = mergeLiveCandle(hist, c(180, 300), 10); // bucket C opens -> B settles
    const settledB = hist.find(x => x.time === 120)!;
    expect(settledB.close).toBe(198); // NOT 200 (the old first-tick value)
  });

  it('ignores an out-of-order (older) tick', () => {
    const prev = [c(60, 100), c(120, 200)];
    expect(mergeLiveCandle(prev, c(60, 999), 10)).toBe(prev);
  });

  it('caps the array to maxLen from the tail on append', () => {
    let hist: CandleData[] = [c(0, 1)];
    for (let t = 1; t <= 5; t++) hist = mergeLiveCandle(hist, c(t * 60, t), 3);
    expect(hist).toHaveLength(3);
    expect(hist.map(x => x.close)).toEqual([3, 4, 5]);
  });
});
