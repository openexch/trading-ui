// SPDX-License-Identifier: Apache-2.0
/**
 * formatRejectReason (trading-ui#61): maps engine (OrderRejectReason) and
 * OMS risk (RiskRejectReason) codes to short factual sentences, with a
 * passthrough fallback so a reject is never rendered blank.
 */
import { describe, it, expect } from 'vitest';
import { formatRejectReason } from './rejectReasons';

describe('formatRejectReason', () => {
  it('maps known engine reject codes to friendly text', () => {
    expect(formatRejectReason('PRICE_OFF_TICK')).toBe('price is not a multiple of the market tick');
    expect(formatRejectReason('PRICE_OUT_OF_RANGE')).toBe("price is outside the market's allowed range");
    expect(formatRejectReason('LEVEL_FULL')).toBe('that price level is full');
    expect(formatRejectReason('BOOK_FULL')).toBe('the order book is at capacity');
    expect(formatRejectReason('OVERFLOW')).toBe('order value is too large to compute safely');
    expect(formatRejectReason('INVALID_QUANTITY')).toBe('quantity must be greater than zero');
    expect(formatRejectReason('MATCH_LIMIT')).toBe('order hit the per-order match limit and was stopped early');
    expect(formatRejectReason('WOULD_CROSS')).toBe("a post-only order can't cross the book");
    expect(formatRejectReason('NO_LIQUIDITY')).toBe('no liquidity was available to match this order');
    expect(formatRejectReason('ORDER_NOT_FOUND')).toBe('order was not found on the book (already filled or cancelled)');
  });

  it('maps known OMS risk reject codes to friendly text', () => {
    expect(formatRejectReason('RATE_LIMIT_EXCEEDED')).toBe('too many orders submitted too quickly');
    expect(formatRejectReason('CIRCUIT_BREAKER_OPEN')).toBe('order submission is temporarily paused');
    expect(formatRejectReason('ORDER_SIZE_TOO_SMALL')).toBe('order quantity is below the market minimum');
    expect(formatRejectReason('ORDER_SIZE_TOO_LARGE')).toBe('order quantity is above the market maximum');
    expect(formatRejectReason('NOTIONAL_TOO_SMALL')).toBe('order value is below the minimum');
    expect(formatRejectReason('NOTIONAL_TOO_LARGE')).toBe('order value is above the maximum');
    expect(formatRejectReason('PRICE_COLLAR_BREACH')).toBe("price is too far from the market's current price");
    expect(formatRejectReason('OPEN_ORDER_LIMIT')).toBe('open order limit reached');
    expect(formatRejectReason('INSUFFICIENT_BALANCE')).toBe('insufficient balance for this order');
    expect(formatRejectReason('POSITION_LIMIT_EXCEEDED')).toBe('this order would exceed a position limit');
    expect(formatRejectReason('HOLD_FAILED')).toBe('the balance hold could not be placed');
    expect(formatRejectReason('CLUSTER_REJECT')).toBe('the matching engine rejected this order');
    expect(formatRejectReason('INVALID_ORDER')).toBe('order failed validation');
    expect(formatRejectReason('MARKET_HALTED')).toBe('trading is halted for this market');
  });

  it('falls back to a generic notice for null, undefined, or empty', () => {
    expect(formatRejectReason(null)).toBe('order rejected for an unspecified reason');
    expect(formatRejectReason(undefined)).toBe('order rejected for an unspecified reason');
    expect(formatRejectReason('')).toBe('order rejected for an unspecified reason');
  });

  it('passes an unknown code through verbatim — never blank', () => {
    expect(formatRejectReason('SOME_FUTURE_CODE')).toBe('SOME_FUTURE_CODE');
  });
});
