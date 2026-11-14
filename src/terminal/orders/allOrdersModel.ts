// SPDX-License-Identifier: Apache-2.0
/**
 * What the all-orders dialog's Open tab lists, and how its filters and
 * search narrow it. The source is the user-scoped order feed (useOrders
 * `orders`); narrowing that feed by market, side or type is presentation,
 * never ownership filtering (DESIGN.md rule 7).
 *
 * - Within a filter group the chips are alternatives (Buy or Sell); across
 *   groups they all apply (Buy and Stops). An empty group means "any".
 * - Search matches the order id, or the price as the table prints it
 *   (thousands separators ignored). A stop awaiting its trigger has no price
 *   to match (the order model carries no trigger price).
 */
import type { Market, OrderSide, OrderType, UserOrder } from '../../types/market';
import { tickDecimals } from '../../utils/ticks';
import { isAwaitingTrigger, isListed } from '../panels/ordersModel';

export type OrderKind = 'limit' | 'stops' | 'iceberg';

export const KIND_LABEL: Record<OrderKind, string> = { limit: 'Limit', stops: 'Stops', iceberg: 'Iceberg' };

export function kindOf(type: OrderType): OrderKind | null {
  switch (type) {
    case 'LIMIT':
    case 'LIMIT_MAKER':
      return 'limit';
    case 'STOP_LOSS':
    case 'STOP_LIMIT':
    case 'TRAILING_STOP':
      return 'stops';
    case 'ICEBERG':
      return 'iceberg';
    default:
      return null;
  }
}

export interface OrderFilters {
  /** Market ids; empty means all markets. */
  markets: ReadonlySet<number>;
  sides: ReadonlySet<OrderSide>;
  kinds: ReadonlySet<OrderKind>;
  search: string;
}

export const NO_FILTERS: OrderFilters = { markets: new Set(), sides: new Set(), kinds: new Set(), search: '' };

/** A set with `value` added or removed. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** The price as the table prints it, or null for a stop awaiting its trigger. */
export function priceText(o: UserOrder, market: Market | undefined): string | null {
  if (isAwaitingTrigger(o)) return null;
  const d = market ? tickDecimals(market.tickSize) : 8;
  return o.price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function matchesSearch(o: UserOrder, market: Market | undefined, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (q === '') return true;
  if (o.omsOrderId !== '' && o.omsOrderId.toLowerCase().includes(q)) return true;
  const qNum = q.replace(/,/g, '');
  if (qNum === '' || !/^[0-9.]+$/.test(qNum)) return false;
  const p = priceText(o, market);
  return p !== null && p.replace(/,/g, '').includes(qNum);
}

export function matchesFilters(o: UserOrder, market: Market | undefined, f: OrderFilters): boolean {
  if (f.markets.size > 0 && !f.markets.has(o.marketId)) return false;
  if (f.sides.size > 0 && !f.sides.has(o.side)) return false;
  if (f.kinds.size > 0) {
    const k = kindOf(o.type);
    if (k === null || !f.kinds.has(k)) return false;
  }
  return matchesSearch(o, market, f.search);
}

/** Every listed order (working, or a stop awaiting its trigger), all markets. */
export function openOrdersAll(orders: readonly UserOrder[]): UserOrder[] {
  return orders.filter(isListed);
}

export function sortByTime(orders: readonly UserOrder[], newestFirst: boolean): UserOrder[] {
  const dir = newestFirst ? -1 : 1;
  return [...orders].sort((a, b) => dir * (a.timestamp - b.timestamp) || a.orderId - b.orderId);
}

/** The markets the listed orders are on, in the order `markets` lists them. */
export function marketsWithOrders(markets: readonly Market[], orders: readonly UserOrder[]): Market[] {
  const ids = new Set(orders.map(o => o.marketId));
  return markets.filter(m => ids.has(m.id));
}

/** Key for selection and rows: the OMS id, else the engine id. */
export function rowKey(o: UserOrder): string {
  return o.omsOrderId !== '' ? o.omsOrderId : `#${o.orderId}`;
}

export type SelectAllState = 'none' | 'some' | 'all';

/** The select-all box over the selectable rows. */
export function selectAllState(selectable: readonly string[], selected: ReadonlySet<string>): SelectAllState {
  if (selectable.length === 0) return 'none';
  let n = 0;
  for (const k of selectable) if (selected.has(k)) n += 1;
  return n === 0 ? 'none' : n === selectable.length ? 'all' : 'some';
}
