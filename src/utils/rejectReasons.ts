// SPDX-License-Identifier: Apache-2.0
/**
 * Friendly text for engine/OMS reject reason codes (trading-ui#61).
 *
 * rejectReason arrives as a raw enum code on every reject path: sync REST
 * submit (OMS risk checks), async WS REJECTED events (engine order-book
 * admission rejects, SBE v6 / match#75), and terminal order history rows.
 * This is the single place that turns those codes into short, factual
 * sentences — no exclamation, no apology, matching the app's tone
 * (DESIGN.md). Unknown codes pass through as-is so a reject is never blank
 * and never silently swallowed.
 *
 * Sources of truth for the codes covered below:
 * - Engine: match-cluster OrderRejectReason.java (order-book admission)
 * - OMS risk: order-management oms-common RiskRejectReason.java
 */

const REASON_TEXT: Record<string, string> = {
  // --- Engine reject reasons (match-cluster OrderRejectReason) ---
  PRICE_OFF_TICK: 'price is not a multiple of the market tick',
  PRICE_OUT_OF_RANGE: "price is outside the market's allowed range",
  LEVEL_FULL: 'that price level is full',
  BOOK_FULL: 'the order book is at capacity',
  OVERFLOW: 'order value is too large to compute safely',
  INVALID_QUANTITY: 'quantity must be greater than zero',
  MATCH_LIMIT: 'order hit the per-order match limit and was stopped early',
  WOULD_CROSS: "a post-only order can't cross the book",
  NO_LIQUIDITY: 'no liquidity was available to match this order',
  ORDER_NOT_FOUND: 'order was not found on the book (already filled or cancelled)',

  // --- OMS risk reject reasons (RiskRejectReason) ---
  RATE_LIMIT_EXCEEDED: 'too many orders submitted too quickly',
  CIRCUIT_BREAKER_OPEN: 'order submission is temporarily paused',
  ORDER_SIZE_TOO_SMALL: 'order quantity is below the market minimum',
  ORDER_SIZE_TOO_LARGE: 'order quantity is above the market maximum',
  NOTIONAL_TOO_SMALL: 'order value is below the minimum',
  NOTIONAL_TOO_LARGE: 'order value is above the maximum',
  PRICE_COLLAR_BREACH: "price is too far from the market's current price",
  OPEN_ORDER_LIMIT: 'open order limit reached',
  INSUFFICIENT_BALANCE: 'insufficient balance for this order',
  POSITION_LIMIT_EXCEEDED: 'this order would exceed a position limit',
  HOLD_FAILED: 'the balance hold could not be placed',
  CLUSTER_REJECT: 'the matching engine rejected this order',
  INVALID_ORDER: 'order failed validation',
  MARKET_HALTED: 'trading is halted for this market',
};

/**
 * Maps a raw rejectReason code to a short human sentence. Never returns
 * blank: an unmapped code passes through verbatim (still inspectable), and
 * a missing code (null/undefined/empty, e.g. a pre-match#75 engine reject)
 * falls back to a generic notice.
 */
export function formatRejectReason(code: string | null | undefined): string {
  if (!code) return 'order rejected for an unspecified reason';
  return REASON_TEXT[code] ?? code;
}
