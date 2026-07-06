// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { snapPrice, isInPriceRange, tickDecimals, tickLabel, priceRangeLabel } from './ticks';
import { MARKETS } from '../types/market';

const BTC = MARKETS[0];   // tick 1,      50k-150k
const SOL = MARKETS[2];   // tick 0.05,   50-500
const DOGE = MARKETS[4];  // tick 0.0001, 0.05-1

describe('tickDecimals', () => {
  it('derives decimals from the tick', () => {
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(0.5)).toBe(1);
    expect(tickDecimals(0.05)).toBe(2);
    expect(tickDecimals(0.0001)).toBe(4);
  });
});

describe('snapPrice', () => {
  it('snaps off-tick prices to the nearest tick', () => {
    expect(snapPrice(BTC, 101500.55)).toBe(101501);
    expect(snapPrice(BTC, 101500.49)).toBe(101500);
    expect(snapPrice(SOL, 123.4567)).toBe(123.45);
    expect(snapPrice(SOL, 123.48)).toBe(123.5);
  });

  it('leaves on-tick prices unchanged', () => {
    expect(snapPrice(BTC, 104250)).toBe(104250);
    expect(snapPrice(SOL, 123.45)).toBe(123.45);
    expect(snapPrice(DOGE, 0.1234)).toBe(0.1234);
  });

  it('produces no float artifacts at small ticks', () => {
    const snapped = snapPrice(DOGE, 0.123456);
    expect(snapped.toString()).toBe('0.1235');
  });

  it('clamps into the engine price range', () => {
    expect(snapPrice(BTC, 10)).toBe(50_000);
    expect(snapPrice(BTC, 9_999_999)).toBe(150_000);
  });
});

describe('isInPriceRange', () => {
  it('checks engine bounds inclusively', () => {
    expect(isInPriceRange(BTC, 50_000)).toBe(true);
    expect(isInPriceRange(BTC, 150_000)).toBe(true);
    expect(isInPriceRange(BTC, 49_999.99)).toBe(false);
    expect(isInPriceRange(BTC, 150_000.01)).toBe(false);
  });
});

describe('labels', () => {
  it('formats tick and range for form hints', () => {
    expect(tickLabel(BTC)).toBe('$1');
    expect(tickLabel(DOGE)).toBe('$0.0001');
    expect(priceRangeLabel(BTC)).toBe('$50,000 – $150,000');
    expect(priceRangeLabel(SOL)).toBe('$50 – $500');
  });
});
