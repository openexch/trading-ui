// SPDX-License-Identifier: Apache-2.0
/**
 * The POST /api/v2/orders body per order type, against the gateway's order
 * rules (docs/api.md 4.5: price only on LIMIT, LIMIT_MAKER, STOP_LIMIT and
 * ICEBERG; stopPrice on STOP_LOSS and STOP_LIMIT; trailingDelta on
 * TRAILING_STOP; displayQuantity on ICEBERG; timeInForce required) and the
 * core's time-in-force admission (IOC on LIMIT and MARKET, FOK on LIMIT
 * only, GTC and GTD on every type but MARKET).
 */
import { describe, it, expect } from 'vitest';
import { OrderShapeError, timeInForceFor, toOrderBody } from './useApi';
import type { OrderRequest, OrderType, TimeInForce } from '../types/market';
import '../test/markets';

const order = (orderType: OrderType, over: Partial<OrderRequest> = {}): OrderRequest => ({
  market: 'BTC-USD',
  orderType,
  orderSide: 'BID',
  price: 65000,
  quantity: 0.5,
  stopPrice: 64000,
  trailingDelta: 100,
  displayQuantity: 0.1,
  timestamp: 0,
  ...over,
});

const base = { marketId: '1', side: 'BUY', quantity: '0.50000000' };

describe('order body per type (form default time in force GTC)', () => {
  const cases: [OrderType, Record<string, string>][] = [
    ['LIMIT', { type: 'LIMIT', timeInForce: 'GTC', price: '65000.00000000' }],
    ['MARKET', { type: 'MARKET', timeInForce: 'IOC' }],
    ['LIMIT_MAKER', { type: 'LIMIT_MAKER', timeInForce: 'GTC', price: '65000.00000000' }],
    ['STOP_LOSS', { type: 'STOP_LOSS', timeInForce: 'GTC', stopPrice: '64000.00000000' }],
    ['STOP_LIMIT', { type: 'STOP_LIMIT', timeInForce: 'GTC', price: '65000.00000000', stopPrice: '64000.00000000' }],
    ['TRAILING_STOP', { type: 'TRAILING_STOP', timeInForce: 'GTC', trailingDelta: '100.00000000' }],
    ['ICEBERG', { type: 'ICEBERG', timeInForce: 'GTC', price: '65000.00000000', displayQuantity: '0.10000000' }],
  ];
  for (const [type, fields] of cases) {
    it(`${type}: ${Object.keys(fields).join(', ')}`, () => {
      expect(toOrderBody(order(type))).toEqual({ ...base, ...fields });
    });
  }
});

describe('time in force per type', () => {
  const ALL: TimeInForce[] = ['GTC', 'IOC', 'FOK', 'GTD'];
  const accepted: Record<OrderType, Partial<Record<TimeInForce, TimeInForce>>> = {
    LIMIT: { GTC: 'GTC', IOC: 'IOC', FOK: 'FOK', GTD: 'GTD' },
    MARKET: { GTC: 'IOC', IOC: 'IOC' },
    LIMIT_MAKER: { GTC: 'GTC', GTD: 'GTD' },
    STOP_LOSS: { GTC: 'GTC', GTD: 'GTD' },
    STOP_LIMIT: { GTC: 'GTC', GTD: 'GTD' },
    TRAILING_STOP: { GTC: 'GTC', GTD: 'GTD' },
    ICEBERG: { GTC: 'GTC', GTD: 'GTD' },
  };
  for (const type of Object.keys(accepted) as OrderType[]) {
    it(`${type}: sends ${JSON.stringify(accepted[type])}, refuses the rest before sending`, () => {
      for (const tif of ALL) {
        const want = accepted[type][tif];
        if (want) expect(timeInForceFor(type, tif), `${type} ${tif}`).toBe(want);
        else expect(() => timeInForceFor(type, tif), `${type} ${tif}`).toThrow(OrderShapeError);
      }
    });
  }

  it('a refused cell names the rule', () => {
    expect(() => toOrderBody(order('MARKET', { timeInForce: 'FOK' }))).toThrow(
      'this time in force is not available for this order type',
    );
  });
});
