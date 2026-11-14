// SPDX-License-Identifier: Apache-2.0
// Pure order-draft logic: which fields a type needs, % sizing, price snapping,
// validation and the OrderRequest the API receives. No React, no I/O: the
// order form and the ladder build the same wire request from the same rules.
import type { Market, OrderRequest, OrderSide, OrderType, TimeInForce } from '../types/market';
import { snapPrice, isInPriceRange, priceRangeLabel, tickDecimals } from '../utils/ticks';

export const SYNTHETIC_TYPES: OrderType[] = ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG'];
export const needsStopPrice = (t: OrderType) => t === 'STOP_LOSS' || t === 'STOP_LIMIT';
export const needsTrailingDelta = (t: OrderType) => t === 'TRAILING_STOP';
export const needsDisplayQty = (t: OrderType) => t === 'ICEBERG';
export const needsPrice = (t: OrderType) => t !== 'MARKET' && t !== 'STOP_LOSS';

/** Price x quantity from the raw field text; an unparsable field counts as 0. */
export function draftTotal(price: string, quantity: string): number {
  const p = parseFloat(price) || 0;
  const q = parseFloat(quantity) || 0;
  return p * q;
}

/**
 * pct% of the real balance: buy = quote balance / price (the draft price,
 * else the last trade price), sell = base balance. 8 dp, floored at 0 when
 * there is no balance or no usable price.
 */
export function sizeForPercent(args: {
  side: OrderSide;
  /** Available balance of the asset this side spends (quote for buy, base for sell). */
  available: number;
  percent: number;
  /** The draft's price field text ('' when empty). */
  price: string;
  lastPrice?: number | null;
}): string {
  const { side, available, percent, price, lastPrice } = args;
  let qty: number;
  if (side === 'BID') {
    const formPrice = parseFloat(price);
    const p = formPrice > 0 ? formPrice : (lastPrice ?? 0);
    qty = p > 0 ? (available * percent / 100) / p : 0;
  } else {
    qty = available * percent / 100;
  }
  if (!isFinite(qty) || qty < 0) qty = 0;
  return qty.toFixed(8);
}

/** Snap a typed price onto the engine grid (on blur). Returns the new field
 *  text, or null when the value is not a positive in-range price and must
 *  stay as typed (the range error is raised on submit). */
export function snapPriceText(market: Market, price: string): string | null {
  const p = parseFloat(price);
  if (p > 0 && isInPriceRange(market, p)) return snapPrice(market, p).toString();
  return null;
}

export interface OrderDraft {
  market: Market;
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  /** Raw field text, exactly as typed. */
  price: string;
  quantity: string;
  stopPrice: string;
  trailingDelta: string;
  displayQuantity: string;
}

export type BuildOrderResult =
  | {
      ok: true;
      order: OrderRequest;
      /** Set when the submitted price was snapped onto the tick, so the
       *  caller can show the price that was actually sent. */
      snappedPrice?: number;
    }
  | { ok: false; error: string };

/**
 * Validate a draft and build the OrderRequest. Out-of-range prices are a hard
 * error; anything else is snapped to the tick so the engine can never reject
 * on PRICE_OFF_TICK.
 */
export function buildOrderRequest(draft: OrderDraft, now: number): BuildOrderResult {
  const { market, side, orderType, timeInForce } = draft;
  const priceNum = parseFloat(draft.price);
  const quantityNum = parseFloat(draft.quantity);

  if (orderType !== 'MARKET' && (!priceNum || priceNum <= 0)) {
    return { ok: false, error: 'Enter a valid price' };
  }
  if (!quantityNum || quantityNum <= 0) {
    return { ok: false, error: 'Enter a valid amount' };
  }

  let submitPrice = priceNum;
  let snappedPrice: number | undefined;
  if (needsPrice(orderType)) {
    if (!isInPriceRange(market, priceNum)) {
      return { ok: false, error: `Price must be within ${priceRangeLabel(market)} for ${market.symbol}` };
    }
    submitPrice = snapPrice(market, priceNum);
    if (submitPrice !== priceNum) snappedPrice = submitPrice;
  }
  const stopNum = parseFloat(draft.stopPrice);
  const submitStop = needsStopPrice(orderType) && stopNum > 0 ? snapPrice(market, stopNum) : undefined;

  const order: OrderRequest = {
    market: market.symbol,
    orderType,
    orderSide: side,
    price: !needsPrice(orderType) ? 0 : submitPrice,
    quantity: quantityNum,
    totalPrice: orderType === 'MARKET' && side === 'BID' ? draftTotal(draft.price, draft.quantity) : undefined,
    timeInForce,
    stopPrice: submitStop,
    trailingDelta: needsTrailingDelta(orderType) ? parseFloat(draft.trailingDelta) || undefined : undefined,
    displayQuantity: needsDisplayQty(orderType) ? parseFloat(draft.displayQuantity) || undefined : undefined,
    timestamp: now,
  };
  return snappedPrice !== undefined ? { ok: true, order, snappedPrice } : { ok: true, order };
}

/**
 * Analytics props for an order submit. Shape only: no price, no quantity, no
 * total. scrubMoney would strip them anyway; not collecting them is the
 * actual policy.
 */
export function orderSubmitProps(args: {
  market: Market;
  orderType: OrderType;
  side: OrderSide;
  timeInForce: TimeInForce;
  fromBookClick: boolean;
  usedSlider: boolean;
}) {
  return {
    market: args.market.symbol,
    order_type: args.orderType,
    side: args.side,
    time_in_force: args.timeInForce,
    priced: needsPrice(args.orderType),
    from_book_click: args.fromBookClick,
    used_slider: args.usedSlider,
  };
}

/** Snap a typed price distance (a trailing stop's trail) onto the tick.
 *  Returns the new field text, or null when it is not a positive number or
 *  rounds to zero. Unlike a price it has no range: it is a distance. */
export function snapDeltaText(market: Market, delta: string): string | null {
  const d = parseFloat(delta);
  if (!(d > 0) || !isFinite(d)) return null;
  const decimals = tickDecimals(market.tickSize);
  const snapped = Number((Math.round(d / market.tickSize) * market.tickSize).toFixed(decimals));
  return snapped > 0 ? snapped.toString() : null;
}
