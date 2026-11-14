// SPDX-License-Identifier: Apache-2.0
// Pure logic for the ladder's staging strip: the Type and TIF choices of the
// order defaults bar, what a staged order turns into on the wire (through
// orderDraft, the same rules as the order form), how it reads in the strip,
// and whether a staged limit would execute immediately.
import type { Market, OrderSide, OrderType, TimeInForce } from '../types/market';
import { buildOrderRequest, needsDisplayQty, needsStopPrice, needsTrailingDelta } from './orderDraft';
import type { BuildOrderResult, OrderDraft } from './orderDraft';
import { tickDecimals } from '../utils/ticks';

export interface TypeChoice {
  type: OrderType;
  label: string;
}

/** The order types the defaults picker offers, in menu order. */
export const TYPE_CHOICES: TypeChoice[] = [
  { type: 'LIMIT', label: 'Limit' },
  { type: 'LIMIT_MAKER', label: 'Post only' },
  { type: 'MARKET', label: 'Market' },
  { type: 'STOP_LOSS', label: 'Stop loss' },
  { type: 'STOP_LIMIT', label: 'Stop limit' },
  { type: 'TRAILING_STOP', label: 'Trailing stop' },
  { type: 'ICEBERG', label: 'Iceberg' },
];

export interface TifChoice {
  tif: TimeInForce;
  label: string;
  /** Spoken form, for the picker's accessible name. */
  long: string;
}

/** GTD is left out: the API has no expiry field yet (DESIGN.md rule 14). */
export const TIF_CHOICES: TifChoice[] = [
  { tif: 'GTC', label: 'GTC', long: 'good till cancelled' },
  { tif: 'IOC', label: 'IOC', long: 'immediate or cancel' },
  { tif: 'FOK', label: 'FOK', long: 'fill or kill' },
];

export function typeLabel(type: OrderType): string {
  return TYPE_CHOICES.find(c => c.type === type)?.label ?? type;
}

export function tifChoice(tif: TimeInForce): TifChoice {
  return TIF_CHOICES.find(c => c.tif === tif) ?? TIF_CHOICES[0];
}

/** The second value a type needs beyond the clicked price, if any. The rung
 *  click gives the price (the trigger for stops); this one is typed in the
 *  strip. */
export interface ExtraField {
  label: string;
  /** Unit shown after the field. */
  unit: 'quote' | 'base';
}

export function extraField(type: OrderType): ExtraField | null {
  if (type === 'STOP_LIMIT') return { label: 'Limit price', unit: 'quote' };
  if (needsTrailingDelta(type)) return { label: 'Trail by', unit: 'quote' };
  if (needsDisplayQty(type)) return { label: 'Show', unit: 'base' };
  return null;
}

/** The values an order ticket (the rung menu or an order popover) set for
 *  one staged order. They win over the order defaults bar for that order
 *  only; the bar itself is unchanged. */
export interface Ticket {
  type: OrderType;
  tif?: TimeInForce;
  /** Size text, as typed in the popover. */
  size?: string;
  /** The type's second value (limit price, trail, shown size), as text. */
  extra?: string;
}

/** An order staged from the ladder or from Buy / Sell market. */
export interface Staged {
  marketId: number;
  side: OrderSide;
  /** The clicked rung's price (the trigger for stop types); null for a
   *  market order staged from the Buy / Sell market buttons. */
  price: number | null;
  /** Set when staged from the rung menu or an order popover. */
  ticket?: Ticket;
}

export interface OrderDefaults {
  /** The size field's text, as typed. */
  size: string;
  type: OrderType;
  tif: TimeInForce;
}

/** The defaults a staged order is built from: the bar's, with the order's
 *  own ticket values on top. */
export function effectiveDefaults(staged: Staged, defaults: OrderDefaults): OrderDefaults {
  const t = staged.ticket;
  if (!t) return defaults;
  return { size: t.size ?? defaults.size, type: t.type, tif: t.tif ?? defaults.tif };
}

/** The type a staged order is placed as: market when staged as market. */
export function stagedType(staged: Staged, defaults: OrderDefaults): OrderType {
  return staged.price === null ? 'MARKET' : effectiveDefaults(staged, defaults).type;
}

/** The second value of a staged order: its ticket's, else the given text. */
function extraOf(staged: Staged, extra: string): string {
  return staged.ticket?.extra ?? extra;
}

/** A positive size, or null. */
export function parseSize(text: string): number | null {
  const t = text.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && isFinite(n) ? n : null;
}

/** The staged order as an OrderDraft for orderDraft.buildOrderRequest. */
export function stagedDraft(market: Market, staged: Staged, bar: OrderDefaults, extraText: string): OrderDraft {
  const defaults = effectiveDefaults(staged, bar);
  const extra = extraOf(staged, extraText);
  const type = stagedType(staged, defaults);
  const rung = staged.price === null ? '' : String(staged.price);
  const draft: OrderDraft = {
    market,
    side: staged.side,
    orderType: type,
    timeInForce: defaults.tif,
    price: rung,
    quantity: defaults.size.trim(),
    stopPrice: '',
    trailingDelta: '',
    displayQuantity: '',
  };
  if (needsStopPrice(type)) draft.stopPrice = rung;
  if (type === 'STOP_LIMIT') draft.price = extra.trim();
  if (needsTrailingDelta(type)) draft.trailingDelta = extra.trim();
  if (needsDisplayQty(type)) draft.displayQuantity = extra.trim();
  return draft;
}

/**
 * Validate and build the wire request for a staged order. Adds the checks
 * the order form leaves to its visible fields: a size, and the type's second
 * value.
 */
export function buildStaged(
  market: Market,
  staged: Staged,
  bar: OrderDefaults,
  extraText: string,
  now: number,
): BuildOrderResult {
  const defaults = effectiveDefaults(staged, bar);
  const extra = extraOf(staged, extraText);
  if (parseSize(defaults.size) === null) return { ok: false, error: 'Enter a size' };
  const type = stagedType(staged, defaults);
  const field = extraField(type);
  if (field) {
    const v = parseSize(extra);
    if (v === null) return { ok: false, error: `Enter ${field.label.toLowerCase()}` };
    if (needsDisplayQty(type) && v > (parseSize(defaults.size) ?? 0)) {
      return { ok: false, error: 'Show must not exceed the size' };
    }
  }
  return buildOrderRequest(stagedDraft(market, staged, bar, extra), now);
}

/**
 * Whether a staged order would execute on arrival: a buy limit at or above
 * the best ask, a sell at or below the best bid. Only resting limit types
 * cross; a post-only order that crosses is refused by the engine.
 */
export function crossing(
  type: OrderType,
  side: OrderSide,
  price: number | null,
  bestBid: number | null,
  bestAsk: number | null,
): 'executes' | 'post-only-rejects' | null {
  if (price === null) return null;
  if (type !== 'LIMIT' && type !== 'LIMIT_MAKER' && type !== 'ICEBERG') return null;
  const crosses =
    side === 'BID' ? bestAsk !== null && price >= bestAsk : bestBid !== null && price <= bestBid;
  if (!crosses) return null;
  return type === 'LIMIT_MAKER' ? 'post-only-rejects' : 'executes';
}

export function formatPriceText(market: Pick<Market, 'tickSize'>, price: number): string {
  const d = tickDecimals(market.tickSize);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** "Buy 0.25 BTC @ 97,395", "Sell 0.25 BTC at market",
 *  "Sell 0.25 BTC, stop 97,300", and with a ticket's second value
 *  "Sell 0.25 BTC, stop 97,380, limit 97,375", "Sell 0.25 BTC @ 97,380,
 *  trail 50", "Buy 1 BTC @ 97,380, show 0.1". */
export function describeStaged(market: Market, staged: Staged, bar: OrderDefaults): string {
  const defaults = effectiveDefaults(staged, bar);
  const type = stagedType(staged, defaults);
  const verb = staged.side === 'BID' ? 'Buy' : 'Sell';
  const size = parseSize(defaults.size) !== null ? `${defaults.size.trim()} ` : '';
  const head = `${verb} ${size}${market.baseAsset}`;
  if (type === 'MARKET' || staged.price === null) return `${head} at market`;
  const p = formatPriceText(market, staged.price);
  const x = staged.ticket?.extra?.trim() ?? '';
  const xNum = parseSize(x);
  if (type === 'STOP_LIMIT' && xNum !== null) return `${head}, stop ${p}, limit ${formatPriceText(market, xNum)}`;
  if (needsStopPrice(type)) return `${head}, stop ${p}`;
  if (needsTrailingDelta(type) && xNum !== null) return `${head} @ ${p}, trail ${x}`;
  if (needsDisplayQty(type) && xNum !== null) return `${head} @ ${p}, show ${x}`;
  return `${head} @ ${p}`;
}

/** Price times size for an order that rests at the clicked price, else null
 *  (market and stop orders have no known execution price). */
export function stagedTotal(type: OrderType, price: number | null, size: string): number | null {
  const q = parseSize(size);
  if (price === null || q === null) return null;
  if (type !== 'LIMIT' && type !== 'LIMIT_MAKER' && type !== 'ICEBERG') return null;
  return price * q;
}
