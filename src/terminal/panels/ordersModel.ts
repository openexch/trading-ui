// SPDX-License-Identifier: Apache-2.0
/**
 * What the Orders panel lists. The source is the user-scoped order feed
 * (`orders` from useOrders); filtering it by market is allowed, filtering a
 * shared feed by user is not (DESIGN.md rule 7).
 *
 * - Working orders: NEW and PARTIALLY_FILLED, and a working order whose
 *   cancel or amend is on its way (PENDING_CANCEL, PENDING_REPLACE).
 * - Stops awaiting their trigger: PENDING_TRIGGER. They are not in the book,
 *   so they are listed here and never on the ladder. The UI order model
 *   carries no trigger price, so none is shown (rule 14).
 * - Other PENDING_* states are transient and stay out, as in openOrders.
 */
import type { UserOrder } from '../../types/market';

export interface PanelOrders {
  /** This market's rows, newest first. */
  here: UserOrder[];
  /** Listed orders on every other market. */
  elsewhere: number;
}

export function isListed(o: UserOrder): boolean {
  return (
    o.status === 'NEW' ||
    o.status === 'PARTIALLY_FILLED' ||
    o.status === 'PENDING_CANCEL' ||
    o.status === 'PENDING_REPLACE' ||
    o.status === 'PENDING_TRIGGER'
  );
}

export function isAwaitingTrigger(o: UserOrder): boolean {
  return o.status === 'PENDING_TRIGGER';
}

export function panelOrders(orders: readonly UserOrder[], marketId: number): PanelOrders {
  const here: UserOrder[] = [];
  let elsewhere = 0;
  for (const o of orders) {
    if (!isListed(o)) continue;
    if (o.marketId === marketId) here.push(o);
    else elsewhere += 1;
  }
  here.sort((a, b) => b.timestamp - a.timestamp);
  return { here, elsewhere };
}

/** Filled share of the original quantity, whole percent (0 when unknown). */
export function fillPercent(o: Pick<UserOrder, 'filledQuantity' | 'originalQuantity'>): number {
  if (!(o.originalQuantity > 0)) return 0;
  const p = Math.floor((o.filledQuantity / o.originalQuantity) * 100);
  return Math.max(0, Math.min(100, p));
}

/**
 * A key that changes when the Fills list may be stale: total filled quantity
 * moved, or an order left the list (filled, cancelled, rejected).
 */
export function fillsSignal(prev: { filled: number; ids: ReadonlySet<string> } | null, orders: readonly UserOrder[]) {
  let filled = 0;
  const ids = new Set<string>();
  for (const o of orders) {
    filled += o.filledQuantity;
    if (o.omsOrderId) ids.add(o.omsOrderId);
  }
  // Rounded so float noise in the sum never reads as a fill.
  filled = Math.round(filled * 1e8) / 1e8;
  const next = { filled, ids };
  if (prev === null) return { next, stale: false };
  let left = false;
  for (const id of prev.ids) {
    if (!ids.has(id)) {
      left = true;
      break;
    }
  }
  return { next, stale: left || filled !== prev.filled };
}
