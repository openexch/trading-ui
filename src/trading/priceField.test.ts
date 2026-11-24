// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { TEST_MARKETS as MARKETS } from '../test/markets';
import { parsePriceField, priceFieldText, stepPriceField } from './priceField';

const [BTC, ETH, , XRP, DOGE] = MARKETS;

describe('parsePriceField', () => {
  it('accepts a price on the tick inside the range', () => {
    expect(parsePriceField(BTC, '97400')).toEqual({ ok: true, price: 97400 });
    expect(parsePriceField(BTC, ' 97400 ')).toEqual({ ok: true, price: 97400 });
    expect(parsePriceField(ETH, '3642.5')).toEqual({ ok: true, price: 3642.5 });
    expect(parsePriceField(DOGE, '0.3812')).toEqual({ ok: true, price: 0.3812 });
    expect(parsePriceField(XRP, '2.418')).toEqual({ ok: true, price: 2.418 });
    // The range ends are inside.
    expect(parsePriceField(BTC, '50000')).toEqual({ ok: true, price: 50000 });
    expect(parsePriceField(BTC, '150000')).toEqual({ ok: true, price: 150000 });
  });

  it('empty is not placeable but has nothing to say', () => {
    expect(parsePriceField(BTC, '')).toEqual({ ok: false, error: null });
    expect(parsePriceField(BTC, '   ')).toEqual({ ok: false, error: null });
  });

  it('off the tick is refused with the tick, never snapped', () => {
    expect(parsePriceField(BTC, '97400.5')).toEqual({ ok: false, error: 'Price must be on the 1 tick' });
    expect(parsePriceField(ETH, '3642.3')).toEqual({ ok: false, error: 'Price must be on the 0.5 tick' });
    expect(parsePriceField(DOGE, '0.38125')).toEqual({ ok: false, error: 'Price must be on the 0.0001 tick' });
  });

  it('out of range is refused with the range', () => {
    expect(parsePriceField(BTC, '49999')).toEqual({ ok: false, error: 'Price must be between 50,000 and 150,000' });
    expect(parsePriceField(BTC, '150001')).toEqual({ ok: false, error: 'Price must be between 50,000 and 150,000' });
    expect(parsePriceField(BTC, '0').ok).toBe(false);
  });

  it('text that is not a number is refused', () => {
    for (const t of ['abc', '1e5', '-97400', '97,400', '1.2.3']) {
      expect(parsePriceField(BTC, t)).toEqual({ ok: false, error: 'Price must be a number' });
    }
  });
});

describe('stepPriceField', () => {
  it('moves one tick, float-exact', () => {
    expect(stepPriceField(BTC, '97400', 1, null)).toBe('97401');
    expect(stepPriceField(ETH, '3642.5', -1, null)).toBe('3642.0');
    expect(stepPriceField(DOGE, '0.3812', 1, null)).toBe('0.3813');
    expect(stepPriceField(XRP, '0.999', 1, null)).toBe('1.000');
  });

  it('an off-tick price goes to the next tick in that direction', () => {
    expect(stepPriceField(ETH, '3642.3', 1, null)).toBe('3642.5');
    expect(stepPriceField(ETH, '3642.3', -1, null)).toBe('3642.0');
  });

  it('empty starts from the given price, else the minimum; the range clamps', () => {
    expect(stepPriceField(BTC, '', 1, 97400)).toBe('97400');
    expect(stepPriceField(BTC, '', 1, null)).toBe('50000');
    expect(stepPriceField(BTC, '150000', 1, null)).toBe('150000');
    expect(stepPriceField(BTC, '50000', -1, null)).toBe('50000');
  });

  it('formats without grouping separators, at the tick precision', () => {
    expect(priceFieldText(BTC, 97400)).toBe('97400');
    expect(priceFieldText(ETH, 3642)).toBe('3642.0');
  });
});
