// SPDX-License-Identifier: Apache-2.0
// Pure rules for the ladder's order actions: which sides the rung menu
// offers, which own orders can be moved, when an armed one-click click may
// place at once, and how a Cancel all run reads in the strip.
import type { Market, OrderSide, OrderType, UserOrder } from '../types/market';
import { crossing, extraField } from './staging';
import { tickDecimals } from '../utils/ticks';

/** Move is an amend (engine cancel-and-replace): the backend allows it for
 *  limit orders only (DESIGN.md rule 13). Stops and icebergs offer Cancel
 *  only. */
export function canMove(order: Pick<UserOrder, 'type'>): boolean {
  return order.type === 'LIMIT' || order.type === 'LIMIT_MAKER';
}

/** The menu label says what Move does to queue priority. */
export const MOVE_LABEL = 'Move (re-queues)';

/** The price the rung menu compares a rung against: the last trade, else the
 *  middle of the touch, else none. */
export function menuReference(lastPrice: number | null, bestBid: number | null, bestAsk: number | null): number | null {
  if (lastPrice !== null && lastPrice > 0) return lastPrice;
  if (bestBid !== null && bestAsk !== null) return (bestBid + bestAsk) / 2;
  return bestBid ?? bestAsk ?? null;
}

export interface RungMenuSides {
  /** The resting limit (and iceberg) side: buy below the reference, sell above. */
  limit: OrderSide;
  /** The stop side: the opposite one (a sell stop below, a buy stop above). */
  stop: OrderSide;
}

/**
 * Sides for the rung menu. A rung below the reference (or at it, or with no
 * reference at all) offers Buy limit and Sell stops; a rung above it offers
 * Sell limit and Buy stops.
 */
export function rungMenuSides(price: number, reference: number | null): RungMenuSides {
  const above = reference !== null && price > reference;
  return above ? { limit: 'ASK', stop: 'BID' } : { limit: 'BID', stop: 'ASK' };
}

/**
 * Whether an armed one-click click may place without staging. Only an order
 * that rests at the clicked price and needs nothing more: market orders
 * always take a second confirmation, types with a second value go through
 * their popover, and a click that crosses the spread still stages so the
 * warning is seen (DESIGN.md rule 10).
 */
export function oneClickPlaces(
  type: OrderType,
  side: OrderSide,
  price: number,
  bestBid: number | null,
  bestAsk: number | null,
): boolean {
  if (type === 'MARKET') return false;
  if (extraField(type) !== null) return false;
  return crossing(type, side, price, bestBid, bestAsk) === null;
}

export interface CancelResult {
  order: UserOrder;
  success: boolean;
  message: string;
}

/** One line for the strip after a Cancel all (or Cancel selected) run;
 *  `label` names the run in the failure line. */
export function cancelAllSummary(results: CancelResult[], label = 'Cancel all'): { ok: boolean; text: string } {
  const failed = results.filter(r => !r.success);
  const done = results.length - failed.length;
  if (failed.length === 0) {
    return { ok: true, text: `Cancelled ${done} order${done === 1 ? '' : 's'}` };
  }
  const first = failed[0].message;
  return {
    ok: false,
    text: `${label}: ${done} cancelled, ${failed.length} failed${first ? ` (${first})` : ''}`,
  };
}

/**
 * A price moved by whole price groups (Alt+Up / Alt+Down on an own order):
 * `groups` x `groupTicks` ticks up (positive) or down. Computed in integer
 * ticks so DOGE and XRP pick up no float tail. Null when the result leaves
 * the market's price range.
 */
export function stepPrice(
  market: Pick<Market, 'tickSize' | 'minPrice' | 'maxPrice'>,
  price: number,
  groupTicks: number,
  groups: number,
): number | null {
  const d = tickDecimals(market.tickSize);
  const scale = 10 ** d;
  const unit = Math.round(market.tickSize * scale);
  const ticks = Math.round(Math.round(price * scale) / unit);
  const next = ticks + groups * Math.max(1, Math.floor(groupTicks));
  const p = Number(((next * unit) / scale).toFixed(d));
  if (p < market.minPrice || p > market.maxPrice) return null;
  return p;
}
