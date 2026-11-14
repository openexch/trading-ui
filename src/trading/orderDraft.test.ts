// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { MARKETS } from '../types/market';
import type { OrderSide, OrderType } from '../types/market';
import {
  sizeForPercent,
  buildOrderRequest,
  snapPriceText,
  draftTotal,
  orderSubmitProps,
  needsPrice,
  type OrderDraft,
} from './orderDraft';

const BTC = MARKETS[0];
const ETH = MARKETS[1];

describe('sizeForPercent (ported from the OrderForm % sizing cases)', () => {
  // Balances as the OrderForm test mocks them: 10,000 USD and 2 BTC.
  const cases: Array<[string, OrderSide, number, number, string, number | null, string]> = [
    ['buy: pct of quote at the last trade price when the price is empty', 'BID', 10000, 50, '', 100000, '0.05000000'],
    ['buy: the typed price wins over the last trade price', 'BID', 10000, 25, '50000', 100000, '0.05000000'],
    ['sell: pct of the base balance, no price involved', 'ASK', 2, 50, '', 100000, '1.00000000'],
    ['buy: 100% (the Avbl quick-fill)', 'BID', 10000, 100, '', 100000, '0.10000000'],
    ['sell: no balance floors at 0', 'ASK', 0, 75, '', 2000, '0.00000000'],
    ['buy: no price at all floors at 0', 'BID', 10000, 50, '', null, '0.00000000'],
    ['buy: a zero typed price falls back to the last trade price', 'BID', 10000, 50, '0', 100000, '0.05000000'],
    ['buy: unparsable price falls back to the last trade price', 'BID', 10000, 50, 'abc', 100000, '0.05000000'],
    ['sell: a negative balance floors at 0', 'ASK', -5, 50, '', null, '0.00000000'],
  ];
  it.each(cases)('%s', (_name, side, available, percent, price, lastPrice, expected) => {
    expect(sizeForPercent({ side, available, percent, price, lastPrice })).toBe(expected);
  });
});

describe('draftTotal', () => {
  it.each([
    ['100', '2', 200],
    ['', '2', 0],
    ['100', '', 0],
    ['abc', 'def', 0],
  ])('%s x %s = %s', (p, q, t) => {
    expect(draftTotal(p, q)).toBe(t);
  });
});

describe('snapPriceText', () => {
  it.each([
    [BTC, '97412.4', '97412'],
    [ETH, '3641.3', '3641.5'],
    [MARKETS[4], '0.38123', '0.3812'],
    [BTC, '40000', null], // out of range stays as typed
    [BTC, '', null],
    [BTC, '-1', null],
  ] as const)('%s %s -> %s', (market, input, expected) => {
    expect(snapPriceText(market, input)).toBe(expected);
  });
});

function draft(over: Partial<OrderDraft> = {}): OrderDraft {
  return {
    market: BTC,
    side: 'BID',
    orderType: 'LIMIT',
    timeInForce: 'GTC',
    price: '97000',
    quantity: '0.5',
    stopPrice: '',
    trailingDelta: '',
    displayQuantity: '',
    ...over,
  };
}

describe('buildOrderRequest', () => {
  const NOW = 1_700_000_000_000;

  it('builds a plain limit order', () => {
    const r = buildOrderRequest(draft(), NOW);
    expect(r).toEqual({
      ok: true,
      order: {
        market: 'BTC-USD',
        orderType: 'LIMIT',
        orderSide: 'BID',
        price: 97000,
        quantity: 0.5,
        totalPrice: undefined,
        timeInForce: 'GTC',
        stopPrice: undefined,
        trailingDelta: undefined,
        displayQuantity: undefined,
        timestamp: NOW,
      },
    });
  });

  it('snaps an off-tick price and reports the snapped value', () => {
    const r = buildOrderRequest(draft({ market: ETH, price: '3641.3' }), NOW);
    expect(r.ok && r.order.price).toBe(3641.5);
    expect(r.ok && r.snappedPrice).toBe(3641.5);
  });

  it('an on-tick price reports no snap', () => {
    const r = buildOrderRequest(draft(), NOW);
    expect(r.ok && 'snappedPrice' in r).toBe(false);
  });

  const errors: Array<[string, Partial<OrderDraft>, string]> = [
    ['empty price', { price: '' }, 'Enter a valid price'],
    ['zero price', { price: '0' }, 'Enter a valid price'],
    ['negative price', { price: '-5' }, 'Enter a valid price'],
    ['empty amount', { quantity: '' }, 'Enter a valid amount'],
    ['zero amount', { quantity: '0' }, 'Enter a valid amount'],
    ['below range', { price: '40000' }, 'Price must be within $50,000 – $150,000 for BTC-USD'],
    ['above range', { price: '150001' }, 'Price must be within $50,000 – $150,000 for BTC-USD'],
    // Matches the form today: STOP_LOSS sends price 0 but still requires the
    // price field to hold a positive value.
    ['stop loss with no price', { orderType: 'STOP_LOSS', price: '', stopPrice: '96000' }, 'Enter a valid price'],
  ];
  it.each(errors)('rejects %s', (_name, over, message) => {
    expect(buildOrderRequest(draft(over), NOW)).toEqual({ ok: false, error: message });
  });

  it('market buy sends price 0 and the price x quantity total', () => {
    const r = buildOrderRequest(draft({ orderType: 'MARKET', price: '97000', quantity: '0.5' }), NOW);
    expect(r.ok && r.order.price).toBe(0);
    expect(r.ok && r.order.totalPrice).toBe(48500);
  });

  it('market buy with an empty price field sends total 0 (as the form does)', () => {
    const r = buildOrderRequest(draft({ orderType: 'MARKET', price: '' }), NOW);
    expect(r.ok && r.order.totalPrice).toBe(0);
  });

  it('market sell carries no total', () => {
    const r = buildOrderRequest(draft({ orderType: 'MARKET', side: 'ASK' }), NOW);
    expect(r.ok && r.order.totalPrice).toBeUndefined();
  });

  it('market order skips the range check', () => {
    const r = buildOrderRequest(draft({ orderType: 'MARKET', price: '1' }), NOW);
    expect(r.ok).toBe(true);
  });

  it('stop limit snaps both price and stop price', () => {
    const r = buildOrderRequest(
      draft({ market: ETH, orderType: 'STOP_LIMIT', price: '3600.2', stopPrice: '3610.3' }),
      NOW
    );
    expect(r.ok && [r.order.price, r.order.stopPrice]).toEqual([3600, 3610.5]);
  });

  it('stop loss sends price 0 and the snapped stop', () => {
    const r = buildOrderRequest(draft({ orderType: 'STOP_LOSS', price: '97000', stopPrice: '96000.4' }), NOW);
    expect(r.ok && [r.order.price, r.order.stopPrice]).toEqual([0, 96000]);
  });

  it('a stop price is dropped for types that do not use it', () => {
    const r = buildOrderRequest(draft({ stopPrice: '96000' }), NOW);
    expect(r.ok && r.order.stopPrice).toBeUndefined();
  });

  it('trailing stop carries the delta; iceberg carries the display quantity', () => {
    const t = buildOrderRequest(draft({ orderType: 'TRAILING_STOP', trailingDelta: '50' }), NOW);
    expect(t.ok && t.order.trailingDelta).toBe(50);
    const i = buildOrderRequest(draft({ orderType: 'ICEBERG', displayQuantity: '0.1' }), NOW);
    expect(i.ok && i.order.displayQuantity).toBe(0.1);
    const none = buildOrderRequest(draft({ orderType: 'TRAILING_STOP', trailingDelta: '' }), NOW);
    expect(none.ok && none.order.trailingDelta).toBeUndefined();
  });
});

describe('orderSubmitProps', () => {
  it('carries the order shape and no money', () => {
    const props = orderSubmitProps({
      market: BTC,
      orderType: 'LIMIT',
      side: 'BID',
      timeInForce: 'IOC',
      fromBookClick: true,
      usedSlider: false,
    });
    expect(props).toEqual({
      market: 'BTC-USD',
      order_type: 'LIMIT',
      side: 'BID',
      time_in_force: 'IOC',
      priced: true,
      from_book_click: true,
      used_slider: false,
    });
  });

  it.each<[OrderType, boolean]>([
    ['LIMIT', true],
    ['LIMIT_MAKER', true],
    ['MARKET', false],
    ['STOP_LOSS', false],
    ['STOP_LIMIT', true],
    ['TRAILING_STOP', true],
    ['ICEBERG', true],
  ])('%s priced = %s', (t, priced) => {
    expect(needsPrice(t)).toBe(priced);
  });
});
