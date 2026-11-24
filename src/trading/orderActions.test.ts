// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { UserOrder } from '../types/market';
import { TEST_MARKETS as MARKETS } from '../test/markets';
import { cancelAllSummary, canMove, menuReference, oneClickPlaces, rungMenuSides, stepPrice, MOVE_LABEL } from './orderActions';
import { snapDeltaText } from './orderDraft';
import { buildStaged, describeStaged } from './staging';
import type { OrderDefaults, Staged } from './staging';

const BTC = MARKETS[0];
const ETH = MARKETS.find(m => m.symbol === 'ETH-USD')!;
const DOGE = MARKETS.find(m => m.symbol === 'DOGE-USD')!;

function order(type: UserOrder['type'], id = '1'): UserOrder {
  return {
    orderId: 1, omsOrderId: id, marketId: 1, market: 'BTC-USD', side: 'BID', type,
    price: 97_400, originalQuantity: 0.5, remainingQuantity: 0.5, filledQuantity: 0, status: 'NEW', timestamp: 1,
  };
}

describe('canMove', () => {
  it('only limit and post-only orders can move; the label says it re-queues', () => {
    expect(canMove(order('LIMIT'))).toBe(true);
    expect(canMove(order('LIMIT_MAKER'))).toBe(true);
    for (const t of ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG', 'MARKET'] as const) {
      expect(canMove(order(t))).toBe(false);
    }
    expect(MOVE_LABEL).toBe('Move (re-queues)');
  });
});

describe('rung menu sides', () => {
  it('below the reference: buy limit, sell stops; above: flipped', () => {
    expect(rungMenuSides(99, 100)).toEqual({ limit: 'BID', stop: 'ASK' });
    expect(rungMenuSides(101, 100)).toEqual({ limit: 'ASK', stop: 'BID' });
    expect(rungMenuSides(100, 100)).toEqual({ limit: 'BID', stop: 'ASK' });
    expect(rungMenuSides(100, null)).toEqual({ limit: 'BID', stop: 'ASK' });
  });

  it('the reference is the last trade, else the middle of the touch, else one side', () => {
    expect(menuReference(100, 98, 102)).toBe(100);
    expect(menuReference(null, 98, 102)).toBe(100);
    expect(menuReference(0, 98, 102)).toBe(100);
    expect(menuReference(null, 98, null)).toBe(98);
    expect(menuReference(null, null, null)).toBeNull();
  });
});

describe('oneClickPlaces', () => {
  it('a resting limit places; market, second-value types and crossing clicks stage', () => {
    expect(oneClickPlaces('LIMIT', 'BID', 99, 99, 101)).toBe(true);
    expect(oneClickPlaces('LIMIT_MAKER', 'ASK', 102, 99, 101)).toBe(true);
    expect(oneClickPlaces('STOP_LOSS', 'ASK', 95, 99, 101)).toBe(true);
    expect(oneClickPlaces('MARKET', 'BID', 99, 99, 101)).toBe(false);
    expect(oneClickPlaces('STOP_LIMIT', 'ASK', 95, 99, 101)).toBe(false);
    expect(oneClickPlaces('TRAILING_STOP', 'ASK', 95, 99, 101)).toBe(false);
    expect(oneClickPlaces('ICEBERG', 'BID', 95, 99, 101)).toBe(false);
    expect(oneClickPlaces('LIMIT', 'BID', 101, 99, 101)).toBe(false);
    expect(oneClickPlaces('LIMIT', 'ASK', 99, 99, 101)).toBe(false);
    expect(oneClickPlaces('LIMIT_MAKER', 'BID', 105, 99, 101)).toBe(false);
  });
});

describe('cancelAllSummary', () => {
  it('counts cancelled and failed, quoting the first failure', () => {
    expect(cancelAllSummary([
      { order: order('LIMIT', '1'), success: true, message: 'ok' },
      { order: order('LIMIT', '2'), success: true, message: 'ok' },
    ])).toEqual({ ok: true, text: 'Cancelled 2 orders' });
    expect(cancelAllSummary([{ order: order('LIMIT'), success: true, message: '' }]).text).toBe('Cancelled 1 order');
    expect(cancelAllSummary([
      { order: order('LIMIT', '1'), success: true, message: 'ok' },
      { order: order('LIMIT', '2'), success: false, message: 'ORDER_NOT_FOUND' },
    ])).toEqual({ ok: false, text: 'Cancel all: 1 cancelled, 1 failed (ORDER_NOT_FOUND)' });
  });
});

describe('snapDeltaText', () => {
  it('rounds a distance onto the tick and refuses zero or junk', () => {
    expect(snapDeltaText(BTC, '50.4')).toBe('50');
    expect(snapDeltaText(ETH, '12.3')).toBe('12.5');
    expect(snapDeltaText(DOGE, '0.00123')).toBe('0.0012');
    expect(snapDeltaText(BTC, '0.2')).toBeNull();
    expect(snapDeltaText(BTC, '')).toBeNull();
    expect(snapDeltaText(BTC, '-5')).toBeNull();
  });
});

describe('order tickets on a staged order', () => {
  const bar: OrderDefaults = { size: '0.25', type: 'LIMIT', tif: 'GTC' };

  it('a ticket wins over the defaults bar for that order only', () => {
    const s: Staged = { marketId: BTC.id, side: 'ASK', price: 97_390, ticket: { type: 'STOP_LIMIT', tif: 'IOC', size: '1', extra: '97384' } };
    const r = buildStaged(BTC, s, bar, '', 1);
    expect(r.ok && r.order).toMatchObject({
      orderType: 'STOP_LIMIT', orderSide: 'ASK', stopPrice: 97_390, price: 97_384, quantity: 1, timeInForce: 'IOC',
    });
    expect(describeStaged(BTC, s, bar)).toBe('Sell 1 BTC, stop 97,390, limit 97,384');
  });

  it('a stop-limit ticket snaps both prices onto the tick', () => {
    const s: Staged = { marketId: ETH.id, side: 'ASK', price: 3_640.2, ticket: { type: 'STOP_LIMIT', extra: '3638.3' } };
    const r = buildStaged(ETH, s, bar, '', 1);
    expect(r.ok && r.order).toMatchObject({ stopPrice: 3_640, price: 3_638.5 });
  });

  it('trailing and iceberg tickets read with their second value', () => {
    const t: Staged = { marketId: BTC.id, side: 'ASK', price: 97_380, ticket: { type: 'TRAILING_STOP', extra: '50' } };
    expect(describeStaged(BTC, t, bar)).toBe('Sell 0.25 BTC @ 97,380, trail 50');
    const i: Staged = { marketId: BTC.id, side: 'BID', price: 97_380, ticket: { type: 'ICEBERG', size: '1', extra: '0.1' } };
    expect(describeStaged(BTC, i, bar)).toBe('Buy 1 BTC @ 97,380, show 0.1');
    const b = buildStaged(BTC, i, bar, '', 1);
    expect(b.ok && b.order).toMatchObject({ orderType: 'ICEBERG', quantity: 1, displayQuantity: 0.1 });
  });

  it('a limit ticket from the rung menu ignores a stop type on the bar', () => {
    const s: Staged = { marketId: BTC.id, side: 'BID', price: 97_390, ticket: { type: 'LIMIT' } };
    const r = buildStaged(BTC, s, { ...bar, type: 'STOP_LIMIT' }, '', 1);
    expect(r.ok && r.order).toMatchObject({ orderType: 'LIMIT', price: 97_390, quantity: 0.25 });
  });
});

describe('stepPrice (Alt+Up / Alt+Down)', () => {
  it('moves by whole groups in integer ticks', () => {
    expect(stepPrice(BTC, 97_390, 5, 1)).toBe(97_395);
    expect(stepPrice(BTC, 97_392, 5, -1)).toBe(97_387);
    expect(stepPrice(ETH, 3000, 5, 1)).toBe(3002.5);
  });
  it('picks up no float tail on DOGE', () => {
    expect(stepPrice(DOGE, 0.3812, 1, 1)).toBe(0.3813);
    expect(stepPrice(DOGE, 0.3, 1, -1)).toBe(0.2999);
  });
  it('refuses to leave the price range', () => {
    expect(stepPrice(BTC, BTC.maxPrice, 1, 1)).toBeNull();
    expect(stepPrice(BTC, BTC.minPrice, 1, -1)).toBeNull();
  });
});
