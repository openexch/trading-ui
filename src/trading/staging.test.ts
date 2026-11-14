// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { MARKETS } from '../types/market';
import {
  TIF_CHOICES,
  TYPE_CHOICES,
  buildStaged,
  crossing,
  describeStaged,
  parseSize,
  stagedTotal,
  stagedType,
} from './staging';
import type { OrderDefaults, Staged } from './staging';

const BTC = MARKETS[0];
const DOGE = MARKETS.find(m => m.symbol === 'DOGE-USD')!;
const limit: OrderDefaults = { size: '0.25', type: 'LIMIT', tif: 'GTC' };
const buyAt = (price: number | null): Staged => ({ marketId: BTC.id, side: 'BID', price });

describe('picker choices', () => {
  it('offers the seven types and no GTD', () => {
    expect(TYPE_CHOICES.map(c => c.label)).toEqual([
      'Limit', 'Post only', 'Market', 'Stop loss', 'Stop limit', 'Trailing stop', 'Iceberg',
    ]);
    expect(TIF_CHOICES.map(c => c.tif)).toEqual(['GTC', 'IOC', 'FOK']);
  });
});

describe('parseSize', () => {
  it.each([
    ['0.25', 0.25], ['1', 1], ['.5', 0.5], ['2.', 2], [' 3 ', 3],
    ['', null], ['0', null], ['-1', null], ['1e3', null], ['abc', null],
  ])('%j -> %j', (t, v) => expect(parseSize(t)).toBe(v));
});

describe('buildStaged', () => {
  it('a limit at the rung price, snapped and in range', () => {
    const r = buildStaged(BTC, buyAt(97_400), limit, '', 1);
    expect(r.ok && r.order).toMatchObject({ orderType: 'LIMIT', orderSide: 'BID', price: 97_400, quantity: 0.25, timeInForce: 'GTC' });
  });

  it('DOGE float safety: a tick price stays on the grid', () => {
    const r = buildStaged(DOGE, { marketId: DOGE.id, side: 'ASK', price: 0.3813 }, { ...limit, size: '1000' }, '', 1);
    expect(r.ok && r.order.price).toBe(0.3813);
  });

  it('a market order from the buttons ignores the picker type and has no price', () => {
    expect(stagedType(buyAt(null), limit)).toBe('MARKET');
    const r = buildStaged(BTC, buyAt(null), limit, '', 1);
    expect(r.ok && r.order).toMatchObject({ orderType: 'MARKET', price: 0, quantity: 0.25 });
  });

  it('stop loss: the rung is the trigger', () => {
    const r = buildStaged(BTC, { ...buyAt(97_500), side: 'ASK' }, { ...limit, type: 'STOP_LOSS' }, '', 1);
    expect(r.ok && r.order).toMatchObject({ orderType: 'STOP_LOSS', stopPrice: 97_500, price: 0 });
  });

  it('stop limit: rung is the trigger, the typed value the limit', () => {
    const d = { ...limit, type: 'STOP_LIMIT' as const };
    expect(buildStaged(BTC, buyAt(97_500), d, '', 1)).toEqual({ ok: false, error: 'Enter limit price' });
    const r = buildStaged(BTC, buyAt(97_500), d, '97510', 1);
    expect(r.ok && r.order).toMatchObject({ stopPrice: 97_500, price: 97_510 });
  });

  it('trailing stop and iceberg need their value; iceberg show <= size', () => {
    expect(buildStaged(BTC, buyAt(97_400), { ...limit, type: 'TRAILING_STOP' }, '', 1).ok).toBe(false);
    const t = buildStaged(BTC, buyAt(97_400), { ...limit, type: 'TRAILING_STOP' }, '50', 1);
    expect(t.ok && t.order.trailingDelta).toBe(50);
    const ice = { ...limit, type: 'ICEBERG' as const };
    expect(buildStaged(BTC, buyAt(97_400), ice, '0.5', 1)).toEqual({ ok: false, error: 'Show must not exceed the size' });
    const i = buildStaged(BTC, buyAt(97_400), ice, '0.05', 1);
    expect(i.ok && i.order.displayQuantity).toBe(0.05);
  });

  it('refuses a missing size and an out-of-range price', () => {
    expect(buildStaged(BTC, buyAt(97_400), { ...limit, size: '' }, '', 1)).toEqual({ ok: false, error: 'Enter a size' });
    expect(buildStaged(BTC, buyAt(10), limit, '', 1).ok).toBe(false);
  });
});

describe('crossing', () => {
  it('a buy at or above the best ask and a sell at or below the best bid execute now', () => {
    expect(crossing('LIMIT', 'BID', 101, 99, 101)).toBe('executes');
    expect(crossing('LIMIT', 'BID', 100, 99, 101)).toBeNull();
    expect(crossing('LIMIT', 'ASK', 99, 99, 101)).toBe('executes');
    expect(crossing('ICEBERG', 'ASK', 98, 99, 101)).toBe('executes');
    expect(crossing('LIMIT_MAKER', 'BID', 105, 99, 101)).toBe('post-only-rejects');
  });

  it('market, stops and an empty side never warn', () => {
    expect(crossing('MARKET', 'BID', null, 99, 101)).toBeNull();
    expect(crossing('STOP_LOSS', 'BID', 105, 99, 101)).toBeNull();
    expect(crossing('LIMIT', 'BID', 105, 99, null)).toBeNull();
  });
});

describe('describeStaged / stagedTotal', () => {
  it('reads as the order that Enter sends', () => {
    expect(describeStaged(BTC, buyAt(97_395), limit)).toBe('Buy 0.25 BTC @ 97,395');
    expect(describeStaged(BTC, { ...buyAt(null), side: 'ASK' }, limit)).toBe('Sell 0.25 BTC at market');
    expect(describeStaged(BTC, buyAt(97_300), { ...limit, type: 'STOP_LOSS' })).toBe('Buy 0.25 BTC, stop 97,300');
    expect(describeStaged(DOGE, { marketId: DOGE.id, side: 'BID', price: 0.38 }, { ...limit, size: '1000' })).toBe(
      'Buy 1000 DOGE @ 0.3800',
    );
  });

  it('totals only orders that rest at the clicked price', () => {
    expect(stagedTotal('LIMIT', 97_395, '0.25')).toBe(24_348.75);
    expect(stagedTotal('MARKET', 97_395, '0.25')).toBeNull();
    expect(stagedTotal('STOP_LIMIT', 97_395, '0.25')).toBeNull();
    expect(stagedTotal('LIMIT', 97_395, '')).toBeNull();
  });
});
