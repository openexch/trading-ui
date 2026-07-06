// SPDX-License-Identifier: Apache-2.0
// Engine price-grid helpers. The matching engine only accepts limit prices
// that sit exactly on a market's tick inside [minPrice, maxPrice] (match
// MarketConfig / PriceRules) — anything else is rejected AFTER acceptance,
// which used to look like a silently vanishing order. The form snaps and
// validates up front instead.
import type { Market } from '../types/market';

/** Decimal places implied by a tick (1 -> 0, 0.05 -> 2, 0.0001 -> 4). */
export function tickDecimals(tickSize: number): number {
  const s = tickSize.toString();
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Snap a price onto the market's grid: nearest tick, clamped into range. */
export function snapPrice(market: Market, price: number): number {
  const ticks = Math.round((price - market.minPrice) / market.tickSize);
  const snapped = market.minPrice + ticks * market.tickSize;
  const clamped = Math.min(market.maxPrice, Math.max(market.minPrice, snapped));
  // Fix float artifacts (e.g. 0.1 + 0.2) by re-rounding to the tick's decimals
  return Number(clamped.toFixed(tickDecimals(market.tickSize)));
}

export function isInPriceRange(market: Market, price: number): boolean {
  return price >= market.minPrice && price <= market.maxPrice;
}

/** Human tick label for form hints, e.g. "$1" or "$0.0001". */
export function tickLabel(market: Market): string {
  return `$${market.tickSize.toFixed(tickDecimals(market.tickSize))}`;
}

/** Human range label, e.g. "$50,000 – $150,000". */
export function priceRangeLabel(market: Market): string {
  const fmt = (v: number) =>
    '$' + v.toLocaleString('en-US', { maximumFractionDigits: tickDecimals(market.tickSize) });
  return `${fmt(market.minPrice)} – ${fmt(market.maxPrice)}`;
}
