// SPDX-License-Identifier: Apache-2.0
/**
 * Pure model behind the price ladder. No React, no DOM.
 *
 * Prices are bucketed into rungs in integer tick units so DOGE (0.0001) and
 * XRP (0.001) never drift. A rung is identified by its integer group index
 * `rung`; its price is rung x groupTicks x tickSize. Bids floor into a rung
 * and asks ceil into one, so a group never straddles the spread: with any
 * ask above any bid, the best ask rung is strictly above the best bid rung.
 *
 * Per side and rung, a cell is one of:
 * - 'level':   known resting quantity
 * - 'gap':     inside the known depth, no level at that price
 * - 'unknown': beyond the deepest level the client knows (the gateway
 *              publishes a bounded depth), never shown as empty liquidity
 * - 'none':    the other side of the touch (a bid cell above the best bid)
 *
 * Rows are only the rungs the engine's book has a level on, on either side
 * (`levels`); a price with no level is never drawn. The window is index-based
 * over that sparse list: the spread marker sits in the middle, the ask
 * levels above it (best ask nearest) and the bid levels below it (best bid
 * nearest), and scrolling moves by levels, not ticks. The 'gap', 'unknown'
 * and 'none' cell states remain for the other side of a level row (an ask
 * row's bid cell is 'none'; a crossed book can put a gap there).
 *
 * Depth is cumulative (DESIGN.md, the depth ladder): each known cell carries
 * the volume from its side's best price out to and including that rung (best
 * ask upwards, best bid downwards). A window scales its bars to the largest
 * cumulative value it shows, one scale for both sides, so their volumes
 * compare.
 */
import type { BookLevel, Market, UserOrder } from '../../types/market';
import { priceKey } from '../../hooks/useOrderBook';
import { tickDecimals } from '../../utils/ticks';

export type LadderSide = 'BID' | 'ASK';
export type CellState = 'level' | 'gap' | 'unknown' | 'none';

/** Integer tick grid for a market. */
export interface TickGrid {
  decimals: number;
  /** 10^decimals */
  scale: number;
  /** tickSize x scale, an integer */
  unit: number;
}

export function tickGrid(market: Pick<Market, 'tickSize'>): TickGrid {
  const decimals = tickDecimals(market.tickSize);
  const scale = 10 ** decimals;
  return { decimals, scale, unit: Math.round(market.tickSize * scale) };
}

/** Price to integer ticks (nearest tick; book prices are on-tick already). */
export function toTicks(grid: TickGrid, price: number): number {
  return Math.round(Math.round(price * grid.scale) / grid.unit);
}

/** The rung a price belongs to on a given side: bids floor, asks ceil. */
export function rungOf(grid: TickGrid, groupTicks: number, price: number, side: LadderSide): number {
  const t = toTicks(grid, price);
  return side === 'BID' ? Math.floor(t / groupTicks) : Math.ceil(t / groupTicks);
}

/** The price a rung stands for, exact to the tick's precision. */
export function rungPrice(grid: TickGrid, groupTicks: number, rung: number): number {
  return Number(((rung * groupTicks * grid.unit) / grid.scale).toFixed(grid.decimals));
}

interface SideBucket {
  quantity: number;
  orderCount: number;
  /** priceKey of every book level folded into this rung (for the level-change flash). */
  priceKeys: string[];
}

export interface OwnAggregate {
  /** Sum of remaining quantity of own orders on this side of this rung. */
  quantity: number;
  /** Own quantity drawn inside the depth bar, clamped to the level quantity
   *  (own orders can briefly exceed the book while updates race). */
  slice: number;
  /** slice / the bar scale (the largest visible cumulative), in the same
   *  units as the cell's bar, anchored at the price edge. */
  sliceFraction: number;
  filled: number;
  original: number;
  /** Oldest first. */
  orders: UserOrder[];
}

export interface SideCell {
  state: CellState;
  /** Known quantity at this rung; null when the cell is 'unknown' or 'none'. */
  quantity: number | null;
  /** Volume from this side's best rung out to and including this one; null
   *  when the cell is 'unknown' or 'none'. A lower bound when `partial`. */
  cumulative: number | null;
  orderCount: number;
  /** cumulative / the bar scale, 0..1 (0 for 'unknown' and 'none'). */
  bar: number;
  priceKeys: string[];
  /** True on the deepest known rung when part of its price group lies beyond
   *  the known depth, so its quantity and cumulative are lower bounds. */
  partial: boolean;
  own: OwnAggregate | null;
}

export interface SpreadInfo {
  /** Best ask minus best bid, in ticks (0 locked, negative crossed). */
  ticks: number;
  /** The same spread in group units (the label the spread row carries). */
  groups: number;
  state: 'open' | 'locked' | 'crossed';
}

export interface OwnPlacement {
  order: UserOrder;
  side: LadderSide;
  rung: number;
}

export interface LadderModel {
  grid: TickGrid;
  groupTicks: number;
  marketId: number;
  /** Every rung with a book level on either side, highest price first: the
   *  only rows the ladder draws. */
  levels: number[];
  /** Index into `levels` of the first row below the spread marker (the best
   *  bid's row); `levels.length` when there are no bids. */
  split: number;
  bestBidRung: number | null;
  bestAskRung: number | null;
  deepestBidRung: number | null;
  deepestAskRung: number | null;
  bidPartial: boolean;
  askPartial: boolean;
  /** Cumulative depth per side, best rung first: bids by falling rung, asks
   *  by rising rung. `cum` includes the rung's own quantity. */
  bidCum: CumStep[];
  askCum: CumStep[];
  /** The larger side's total known volume: the default bar scale. */
  maxCumulative: number;
  lastTradeRung: number | null;
  spread: SpreadInfo | null;
  /** Own resting orders for this market, each with its rung. */
  own: OwnPlacement[];
  bids: Map<number, SideBucket>;
  asks: Map<number, SideBucket>;
  ownBids: Map<number, UserOrder[]>;
  ownAsks: Map<number, UserOrder[]>;
}

export interface CumStep {
  rung: number;
  cum: number;
}

export interface LadderInput {
  market: Market;
  /** Grouping multiplier: rung width in ticks (1, 5, 10, 25, 100). */
  groupTicks: number;
  bids: BookLevel[];
  asks: BookLevel[];
  /** The user-scoped open orders (any market). Filtered here by market only. */
  openOrders: UserOrder[];
  lastPrice: number | null | undefined;
}

function bucket(grid: TickGrid, groupTicks: number, levels: BookLevel[], side: LadderSide) {
  const out = new Map<number, SideBucket>();
  let best: number | null = null;
  let deepest: number | null = null;
  let bestTicks: number | null = null;
  let deepestTicks: number | null = null;
  for (const l of levels) {
    if (!(l.quantity > 0) || !(l.price > 0)) continue;
    const t = toTicks(grid, l.price);
    const r = side === 'BID' ? Math.floor(t / groupTicks) : Math.ceil(t / groupTicks);
    let b = out.get(r);
    if (!b) {
      b = { quantity: 0, orderCount: 0, priceKeys: [] };
      out.set(r, b);
    }
    b.quantity += l.quantity;
    b.orderCount += l.orderCount ?? 0;
    b.priceKeys.push(priceKey(l.price));
    if (side === 'BID') {
      if (best === null || r > best) best = r;
      if (bestTicks === null || t > bestTicks) bestTicks = t;
      if (deepestTicks === null || t < deepestTicks) deepestTicks = t;
    } else {
      if (best === null || r < best) best = r;
      if (bestTicks === null || t < bestTicks) bestTicks = t;
      if (deepestTicks === null || t > deepestTicks) deepestTicks = t;
    }
  }
  let partial = false;
  if (deepestTicks !== null) {
    if (side === 'BID') {
      deepest = Math.floor(deepestTicks / groupTicks);
      // The bid group covers ticks [rung*G, rung*G + G - 1].
      partial = deepestTicks > deepest * groupTicks;
    } else {
      deepest = Math.ceil(deepestTicks / groupTicks);
      // The ask group covers ticks [(rung-1)*G + 1, rung*G].
      partial = deepestTicks < deepest * groupTicks;
    }
  }
  return { out, best, bestTicks, deepest, partial };
}

/** Running totals from the best rung outward. */
function cumulate(levels: Map<number, SideBucket>, side: LadderSide): CumStep[] {
  const rungs = [...levels.keys()].sort((x, y) => (side === 'BID' ? y - x : x - y));
  const out: CumStep[] = [];
  let cum = 0;
  for (const r of rungs) {
    cum += levels.get(r)!.quantity;
    out.push({ rung: r, cum });
  }
  return out;
}

/** Cumulative volume at a known rung: everything from the best rung out to
 *  and including `rung` (a gap carries the total of the rungs before it). */
export function cumulativeAt(model: LadderModel, side: LadderSide, rung: number): number {
  const steps = side === 'BID' ? model.bidCum : model.askCum;
  let cum = 0;
  for (const st of steps) {
    if (side === 'BID' ? st.rung < rung : st.rung > rung) break;
    cum = st.cum;
  }
  return cum;
}

/** Own orders that rest in the book: this market, live, priced, with quantity left.
 *  Stops awaiting their trigger are not in `openOrders` and not in the book. */
function isRestingOwn(o: UserOrder, marketId: number): boolean {
  return (
    o.marketId === marketId &&
    (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') &&
    o.remainingQuantity > 0 &&
    o.price > 0
  );
}

export function buildLadder(input: LadderInput): LadderModel {
  const { market } = input;
  const groupTicks = Math.max(1, Math.floor(input.groupTicks));
  const grid = tickGrid(market);

  const b = bucket(grid, groupTicks, input.bids, 'BID');
  const a = bucket(grid, groupTicks, input.asks, 'ASK');

  const bidCum = cumulate(b.out, 'BID');
  const askCum = cumulate(a.out, 'ASK');
  const total = (steps: CumStep[]) => (steps.length > 0 ? steps[steps.length - 1].cum : 0);
  const maxCumulative = Math.max(total(bidCum), total(askCum));

  const own: OwnPlacement[] = [];
  const ownBids = new Map<number, UserOrder[]>();
  const ownAsks = new Map<number, UserOrder[]>();
  for (const o of input.openOrders) {
    if (!isRestingOwn(o, market.id)) continue;
    const side: LadderSide = o.side === 'BID' ? 'BID' : 'ASK';
    const rung = rungOf(grid, groupTicks, o.price, side);
    own.push({ order: o, side, rung });
    const m = side === 'BID' ? ownBids : ownAsks;
    const list = m.get(rung);
    if (list) list.push(o);
    else m.set(rung, [o]);
  }
  for (const list of [...ownBids.values(), ...ownAsks.values()]) {
    list.sort((x, y) => x.timestamp - y.timestamp);
  }

  const lastTradeRung =
    input.lastPrice != null && input.lastPrice > 0
      ? // A trade price on a group boundary sits on that rung; inside a group
        // it is shown on the rung at or below it.
        Math.floor(toTicks(grid, input.lastPrice) / groupTicks)
      : null;

  let spread: SpreadInfo | null = null;
  if (b.best !== null && a.best !== null && b.bestTicks !== null && a.bestTicks !== null) {
    const bestBidTicks = b.bestTicks;
    const bestAskTicks = a.bestTicks;
    const ticks = bestAskTicks - bestBidTicks;
    spread = {
      ticks,
      groups: ticks / groupTicks,
      state: ticks > 0 ? 'open' : ticks === 0 ? 'locked' : 'crossed',
    };
  }

  const levels = [...new Set([...b.out.keys(), ...a.out.keys()])].sort((x, y) => y - x);
  // Everything above the best bid sits above the marker (the asks, in an
  // open book nothing else); with no bids every level is an ask.
  const split = b.best === null ? levels.length : levels.filter(r => r > b.best!).length;

  return {
    grid,
    groupTicks,
    marketId: market.id,
    levels,
    split,
    bestBidRung: b.best,
    bestAskRung: a.best,
    deepestBidRung: b.deepest,
    deepestAskRung: a.deepest,
    bidPartial: b.partial,
    askPartial: a.partial,
    bidCum,
    askCum,
    maxCumulative,
    lastTradeRung,
    spread,
    own,
    bids: b.out,
    asks: a.out,
    ownBids,
    ownAsks,
  };
}

function cellState(model: LadderModel, side: LadderSide, rung: number, hasLevel: boolean): CellState {
  const best = side === 'BID' ? model.bestBidRung : model.bestAskRung;
  const deepest = side === 'BID' ? model.deepestBidRung : model.deepestAskRung;
  if (best === null || deepest === null) return 'unknown';
  if (side === 'BID' ? rung > best : rung < best) return 'none';
  if (side === 'BID' ? rung < deepest : rung > deepest) return 'unknown';
  return hasLevel ? 'level' : 'gap';
}

function aggregateOwn(orders: UserOrder[] | undefined, levelQty: number, scale: number): OwnAggregate | null {
  if (!orders || orders.length === 0) return null;
  let quantity = 0;
  let filled = 0;
  let original = 0;
  for (const o of orders) {
    quantity += o.remainingQuantity;
    filled += o.filledQuantity;
    original += o.originalQuantity;
  }
  const slice = Math.max(0, Math.min(quantity, levelQty));
  return {
    quantity,
    slice,
    sliceFraction: scale > 0 ? slice / scale : 0,
    filled,
    original,
    orders,
  };
}

/** One side of one rung. `scale` is the cumulative that fills a bar; by
 *  default the larger side's whole known volume (a window passes the
 *  largest cumulative it shows). */
export function sideCell(model: LadderModel, side: LadderSide, rung: number, scale: number = model.maxCumulative): SideCell {
  const bucketMap = side === 'BID' ? model.bids : model.asks;
  const lvl = bucketMap.get(rung);
  const state = cellState(model, side, rung, lvl !== undefined);
  const quantity = state === 'level' ? lvl!.quantity : state === 'gap' ? 0 : null;
  const known = state === 'level' || state === 'gap';
  const cumulative = known ? cumulativeAt(model, side, rung) : null;
  const deepest = side === 'BID' ? model.deepestBidRung : model.deepestAskRung;
  const partialSide = side === 'BID' ? model.bidPartial : model.askPartial;
  const ownMap = side === 'BID' ? model.ownBids : model.ownAsks;
  return {
    state,
    quantity,
    cumulative,
    orderCount: state === 'level' ? lvl!.orderCount : 0,
    bar: cumulative !== null && scale > 0 ? Math.min(1, cumulative / scale) : 0,
    priceKeys: lvl ? lvl.priceKeys : [],
    partial: partialSide && rung === deepest,
    own: aggregateOwn(ownMap.get(rung), quantity ?? 0, scale),
  };
}

export interface LadderRow {
  rung: number;
  price: number;
  bid: SideCell;
  ask: SideCell;
}

export interface OwnOutside {
  count: number;
  /** The own order closest to the window on that side, or null. */
  nearest: OwnPlacement | null;
}

/**
 * Where a held window sits: the level `rung` is shown in slot `slot` (0 is
 * the top row). A price, not an index, so a held window stays on its prices
 * while levels come and go around them. Null is the centred window.
 */
export interface WindowPos {
  rung: number;
  slot: number;
}

export interface LadderWindow {
  /** Index into `model.levels` shown in the top slot; negative when the
   *  window reaches above the highest level (empty slots on top). */
  start: number;
  /** Slots in the window (the row count it was built for). */
  count: number;
  /** Empty slots above the first row and below the last (the book ran out
   *  of levels on that side). Never drawn as rows. */
  padTop: number;
  padBottom: number;
  /** Highest rung shown (first row); null without rows. */
  top: number | null;
  /** Lowest rung shown (last row); null without rows. */
  bottom: number | null;
  /** Rows from the highest price down: book levels only. */
  rows: LadderRow[];
  /** The spread marker goes before `rows[spreadAt]` (`rows.length`: after
   *  the last row); null when it is scrolled out of the window. */
  spreadAt: number | null;
  /** True while the window is the centred one (the marker in the middle). */
  centred: boolean;
  /** The bar scale: the largest cumulative shown on either side. */
  scale: number;
  above: OwnOutside;
  below: OwnOutside;
}

/** The index in `levels` (highest first) where `rung` is, or where it would
 *  be: the first level at or below it. */
export function levelIndex(model: Pick<LadderModel, 'levels'>, rung: number): number {
  const lv = model.levels;
  let lo = 0;
  let hi = lv.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lv[mid] > rung) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The centred window's start: half the slots above the marker. */
export function centredStart(model: Pick<LadderModel, 'split'>, count: number): number {
  return model.split - Math.floor(Math.max(0, count) / 2);
}

/** The range a window's start may take: never further past either end of
 *  the levels than the centred window already is. */
export function startBounds(model: Pick<LadderModel, 'levels' | 'split'>, count: number): { lo: number; hi: number } {
  const c = centredStart(model, count);
  return { lo: Math.min(0, c), hi: Math.max(model.levels.length - count, c) };
}

/** The start index a position resolves to, clamped. */
export function windowStart(model: Pick<LadderModel, 'levels' | 'split'>, pos: WindowPos | null, count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (pos === null) return centredStart(model, n);
  const { lo, hi } = startBounds(model, n);
  return Math.min(hi, Math.max(lo, levelIndex(model, pos.rung) - pos.slot));
}

/**
 * The window of `count` slots at `pos` (null: centred). Slots hold book
 * levels only; where the book runs out the slots stay empty (`padTop`,
 * `padBottom`), so the marker stays in the middle of a centred window.
 */
export function ladderWindow(model: LadderModel, pos: WindowPos | null, count: number): LadderWindow {
  const n = Math.max(0, Math.floor(count));
  const start = windowStart(model, pos, n);
  const L = model.levels.length;
  const first = Math.max(0, start);
  const last = Math.min(L, start + n); // exclusive
  const rungs = last > first ? model.levels.slice(first, last) : [];
  const top = rungs.length > 0 ? rungs[0] : null;
  const bottom = rungs.length > 0 ? rungs[rungs.length - 1] : null;
  const scale = top !== null && bottom !== null ? windowScale(model, top, bottom) : 0;
  const rows: LadderRow[] = rungs.map(rung => ({
    rung,
    price: rungPrice(model.grid, model.groupTicks, rung),
    bid: sideCell(model, 'BID', rung, scale),
    ask: sideCell(model, 'ASK', rung, scale),
  }));
  const padTop = first - start;
  const marker = model.split - first;
  const spreadAt = n > 0 && L > 0 && model.split >= start && model.split <= start + n ? marker : null;
  const own =
    top !== null && bottom !== null
      ? ownOutside(model, top, bottom)
      : { above: { count: 0, nearest: null }, below: { count: 0, nearest: null } };
  return {
    start,
    count: n,
    padTop,
    padBottom: n - padTop - rows.length,
    top,
    bottom,
    rows,
    spreadAt,
    centred: start === centredStart(model, n),
    scale,
    ...own,
  };
}

/** The largest cumulative a window [bottom, top] shows on either side.
 *  Cumulative grows outward, so on each side it is the value at the
 *  outermost known rung inside the window. */
export function windowScale(model: LadderModel, top: number, bottom: number): number {
  let scale = 0;
  if (model.bestBidRung !== null && model.deepestBidRung !== null) {
    const hi = Math.min(top, model.bestBidRung);
    const outer = Math.max(bottom, model.deepestBidRung);
    if (outer <= hi) scale = Math.max(scale, cumulativeAt(model, 'BID', outer));
  }
  if (model.bestAskRung !== null && model.deepestAskRung !== null) {
    const lo = Math.max(bottom, model.bestAskRung);
    const outer = Math.min(top, model.deepestAskRung);
    if (outer >= lo) scale = Math.max(scale, cumulativeAt(model, 'ASK', outer));
  }
  return scale;
}

/** Own orders above and below a window, and the nearest one each way
 *  (closest price first, then the oldest order). */
export function ownOutside(model: LadderModel, top: number, bottom: number): { above: OwnOutside; below: OwnOutside } {
  const above: OwnOutside = { count: 0, nearest: null };
  const below: OwnOutside = { count: 0, nearest: null };
  for (const p of model.own) {
    if (p.rung > top) {
      above.count++;
      const n = above.nearest;
      if (!n || p.order.price < n.order.price || (p.order.price === n.order.price && p.order.timestamp < n.order.timestamp)) {
        above.nearest = p;
      }
    } else if (p.rung < bottom) {
      below.count++;
      const n = below.nearest;
      if (!n || p.order.price > n.order.price || (p.order.price === n.order.price && p.order.timestamp < n.order.timestamp)) {
        below.nearest = p;
      }
    }
  }
  return { above, below };
}
