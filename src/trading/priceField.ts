// SPDX-License-Identifier: Apache-2.0
// The order defaults bar's Price field (quote currency): what Buy limit and
// Sell limit place at. A price is valid only when it sits exactly on the
// market's tick inside [minPrice, maxPrice] (DESIGN.md rule 6); it is never
// snapped silently, so the user sees the reason instead. All checks run in
// integer tick units so DOGE (0.0001) and XRP (0.001) never drift.
import type { Market } from '../types/market';
import { tickDecimals } from '../utils/ticks';
import { formatPriceText } from './staging';

export type PriceFieldResult =
  | { ok: true; price: number }
  /** `error` is null for an empty field: nothing to place, nothing to say. */
  | { ok: false; error: string | null };

type TickMarket = Pick<Market, 'tickSize' | 'minPrice' | 'maxPrice'>;

function grid(market: Pick<Market, 'tickSize'>) {
  const decimals = tickDecimals(market.tickSize);
  const scale = 10 ** decimals;
  return { decimals, scale, unit: Math.round(market.tickSize * scale) };
}

const NUMBER = /^\d*\.?\d+$|^\d+\.$/;

/** The text as a price in whole ticks, or why it is not one. */
export function parsePriceField(market: TickMarket, text: string): PriceFieldResult {
  const t = text.trim();
  if (t === '') return { ok: false, error: null };
  if (!NUMBER.test(t)) return { ok: false, error: 'Price must be a number' };
  const { decimals, scale, unit } = grid(market);
  const scaled = Number(t) * scale;
  const n = Math.round(scaled);
  const tick = formatPriceText(market, market.tickSize);
  // More decimals than the tick has, or between two ticks.
  if (Math.abs(scaled - n) > 1e-6 || n % unit !== 0) {
    return { ok: false, error: `Price must be on the ${tick} tick` };
  }
  const lo = Math.round(market.minPrice * scale);
  const hi = Math.round(market.maxPrice * scale);
  if (n < lo || n > hi) {
    return {
      ok: false,
      error: `Price must be between ${formatPriceText(market, market.minPrice)} and ${formatPriceText(market, market.maxPrice)}`,
    };
  }
  return { ok: true, price: Number((n / scale).toFixed(decimals)) };
}

/** A price as the field shows it: plain digits at the tick's precision (no
 *  grouping separators, so it reads back as typed). */
export function priceFieldText(market: Pick<Market, 'tickSize'>, price: number): string {
  return price.toFixed(grid(market).decimals);
}

/**
 * The field's text one tick up or down (Up / Down arrow in the field). An
 * on-tick price moves one tick; an off-tick one moves to the next tick in
 * that direction. Empty or unreadable text starts from `from` (the last
 * price, else the market's minimum). Clamped to [minPrice, maxPrice].
 */
export function stepPriceField(market: TickMarket, text: string, dir: 1 | -1, from: number | null): string {
  const { scale, unit } = grid(market);
  const lo = Math.ceil(Math.round(market.minPrice * scale) / unit);
  const hi = Math.floor(Math.round(market.maxPrice * scale) / unit);
  const t = text.trim();
  let next: number;
  if (NUMBER.test(t)) {
    const ticks = (Number(t) * scale) / unit;
    const whole = Math.round(ticks);
    const onTick = Math.abs(ticks - whole) < 1e-6;
    next = onTick ? whole + dir : dir > 0 ? Math.ceil(ticks) : Math.floor(ticks);
  } else {
    const base = from !== null && from > 0 ? from : market.minPrice;
    next = Math.round((base * scale) / unit);
  }
  next = Math.min(hi, Math.max(lo, next));
  return priceFieldText(market, (next * unit) / scale);
}
