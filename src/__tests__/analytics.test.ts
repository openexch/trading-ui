// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { scrubMoney, EV, analyticsConfigured, track, updateContext } from '../analytics';

// scrubMoney is the only thing standing between an instrumented order form and
// an analytics pipeline holding customer position sizes, so it is tested
// directly rather than through a component.
describe('scrubMoney', () => {
  it('drops the obvious money properties', () => {
    const out = scrubMoney({
      price: 42000,
      quantity: 1.5,
      total: 63000,
      balance: 100,
      available: 90,
      locked: 10,
      notional: 5,
      fee: 0.1,
      pnl: -3,
      market: 'BTC-USD',
      side: 'BID',
    });
    expect(out).toEqual({ market: 'BTC-USD', side: 'BID' });
  });

  it('drops money properties whatever the casing or affixes', () => {
    const out = scrubMoney({
      avgPrice: 1,
      stopPrice: 2,
      filled_qty: 3,
      displayQuantity: 4,
      remainingSize: 5,
      TOTAL_VALUE: 6,
      order_type: 'LIMIT',
    });
    expect(out).toEqual({ order_type: 'LIMIT' });
  });

  it('keeps booleans, which carry no amount', () => {
    expect(scrubMoney({ filled: true, priced: false })).toEqual({ filled: true, priced: false });
  });

  it('keeps the properties the events actually rely on', () => {
    const props = {
      market: 'ETH-USD',
      order_type: 'MARKET',
      side: 'ASK',
      time_in_force: 'IOC',
      round_trip_ms: 12,
      reason: 'Insufficient funds',
      attempts: 2,
      code: 1006,
      mode: 'login',
    };
    expect(scrubMoney(props)).toEqual(props);
  });

  it('does not mutate its input', () => {
    const input = { price: 1, market: 'BTC-USD' };
    scrubMoney(input);
    expect(input).toEqual({ price: 1, market: 'BTC-USD' });
  });
});

describe('event names', () => {
  it('are unique', () => {
    const names = Object.values(EV);
    expect(new Set(names).size).toBe(names.length);
  });

  it('are snake_case, so PostHog groups them predictably', () => {
    for (const name of Object.values(EV)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('without a key', () => {
  // The test environment sets no VITE_POSTHOG_KEY, which is also what a clone
  // of this repository builds with.
  it('reports itself as unconfigured', () => {
    expect(analyticsConfigured).toBe(false);
  });

  it('swallows track() and updateContext() instead of throwing', () => {
    expect(() => track(EV.order_submit, { market: 'BTC-USD' })).not.toThrow();
    expect(() => updateContext({ market: 'BTC-USD' })).not.toThrow();
  });
});
