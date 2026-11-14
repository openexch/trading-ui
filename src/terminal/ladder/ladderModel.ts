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
  /** slice / maxQuantity, in the same units as the cell's bar. */
  sliceFraction: number;
  filled: number;
  original: number;
  /** Oldest first. */
  orders: UserOrder[];
}

export interface SideCell {
  state: CellState;
  /** Known quantity; null when the cell is 'unknown' or 'none'. */
  quantity: number | null;
  orderCount: number;
  /** quantity / maxQuantity over all known rungs, 0..1. */
  bar: number;
  priceKeys: string[];
  /** True on the deepest known rung when part of its price group lies beyond
   *  the known depth, so its quantity is a lower bound. */
  partial: boolean;
  own: OwnAggregate | null;
}

export interface SpreadInfo {
  /** Best ask minus best bid, in ticks (0 locked, negative crossed). */
  ticks: number;
  /** The same spread in group units (the label the spread line carries). */
  groups: number;
  /** The spread line sits between `lowerRung` and `lowerRung + 1`. Null when
   *  the book is locked or crossed into one rung, so there is no gap to draw
   *  the line in. */
  lowerRung: number | null;
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
  /** Rung range covering [minPrice, maxPrice]. */
  minRung: number;
  maxRung: number;
  bestBidRung: number | null;
  bestAskRung: number | null;
  deepestBidRung: number | null;
  deepestAskRung: number | null;
  bidPartial: boolean;
  askPartial: boolean;
  /** Largest rung quantity over ALL known levels on both sides, so bars do
   *  not rescale when the visible row count changes. */
  maxQuantity: number;
  lastTradeRung: number | null;
  spread: SpreadInfo | null;
  /** Own resting orders for this market, each with its rung. */
  own: OwnPlacement[];
  bids: Map<number, SideBucket>;
  asks: Map<number, SideBucket>;
  ownBids: Map<number, UserOrder[]>;
  ownAsks: Map<number, UserOrder[]>;
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

  let maxQuantity = 0;
  for (const v of b.out.values()) maxQuantity = Math.max(maxQuantity, v.quantity);
  for (const v of a.out.values()) maxQuantity = Math.max(maxQuantity, v.quantity);

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
    let lowerRung: number | null = null;
    if (a.best > b.best) {
      const midGroup = (bestBidTicks + bestAskTicks) / 2 / groupTicks;
      lowerRung = Math.min(a.best - 1, Math.max(b.best, Math.floor(midGroup)));
    }
    spread = {
      ticks,
      groups: ticks / groupTicks,
      lowerRung,
      state: ticks > 0 ? 'open' : ticks === 0 ? 'locked' : 'crossed',
    };
  }

  return {
    grid,
    groupTicks,
    marketId: market.id,
    minRung: Math.floor(toTicks(grid, market.minPrice) / groupTicks),
    maxRung: Math.ceil(toTicks(grid, market.maxPrice) / groupTicks),
    bestBidRung: b.best,
    bestAskRung: a.best,
    deepestBidRung: b.deepest,
    deepestAskRung: a.deepest,
    bidPartial: b.partial,
    askPartial: a.partial,
    maxQuantity,
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

function aggregateOwn(orders: UserOrder[] | undefined, levelQty: number, maxQuantity: number): OwnAggregate | null {
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
    sliceFraction: maxQuantity > 0 ? slice / maxQuantity : 0,
    filled,
    original,
    orders,
  };
}

/** One side of one rung. */
export function sideCell(model: LadderModel, side: LadderSide, rung: number): SideCell {
  const bucketMap = side === 'BID' ? model.bids : model.asks;
  const lvl = bucketMap.get(rung);
  const state = cellState(model, side, rung, lvl !== undefined);
  const quantity = state === 'level' ? lvl!.quantity : state === 'gap' ? 0 : null;
  const deepest = side === 'BID' ? model.deepestBidRung : model.deepestAskRung;
  const partialSide = side === 'BID' ? model.bidPartial : model.askPartial;
  const ownMap = side === 'BID' ? model.ownBids : model.ownAsks;
  return {
    state,
    quantity,
    orderCount: state === 'level' ? lvl!.orderCount : 0,
    bar: state === 'level' && model.maxQuantity > 0 ? lvl!.quantity / model.maxQuantity : 0,
    priceKeys: lvl ? lvl.priceKeys : [],
    partial: partialSide && rung === deepest,
    own: aggregateOwn(ownMap.get(rung), quantity ?? 0, model.maxQuantity),
  };
}

export interface LadderRow {
  rung: number;
  price: number;
  /** False for rungs outside the market's [minPrice, maxPrice]. */
  inRange: boolean;
  bid: SideCell;
  ask: SideCell;
  isLastTrade: boolean;
  /** The spread line is drawn directly below this row. */
  spreadBelow: boolean;
}

export interface OwnOutside {
  count: number;
  /** The own order closest to the window on that side, or null. */
  nearest: OwnPlacement | null;
}

export interface LadderWindow {
  /** Highest rung shown (first row). */
  top: number;
  /** Lowest rung shown (last row). */
  bottom: number;
  /** Rows from the highest price down. */
  rows: LadderRow[];
  above: OwnOutside;
  below: OwnOutside;
}

/**
 * The `count` rungs around `centre`, highest price first. The window is kept
 * inside the market's rung range when it fits; when it is taller than the
 * whole range, the extra rows are marked out of range.
 */
export function ladderWindow(model: LadderModel, centre: number, count: number): LadderWindow {
  const n = Math.max(0, Math.floor(count));
  let top = Math.round(centre) + Math.floor((n - 1) / 2);
  const span = model.maxRung - model.minRung + 1;
  if (n >= span) {
    top = model.maxRung;
  } else {
    if (top > model.maxRung) top = model.maxRung;
    if (top - n + 1 < model.minRung) top = model.minRung + n - 1;
  }
  const bottom = top - n + 1;
  const spreadLower = model.spread?.lowerRung ?? null;
  const rows: LadderRow[] = [];
  for (let rung = top; rung >= bottom; rung--) {
    rows.push({
      rung,
      price: rungPrice(model.grid, model.groupTicks, rung),
      inRange: rung >= model.minRung && rung <= model.maxRung,
      bid: sideCell(model, 'BID', rung),
      ask: sideCell(model, 'ASK', rung),
      isLastTrade: model.lastTradeRung === rung,
      spreadBelow: spreadLower !== null && rung === spreadLower + 1 && spreadLower >= bottom,
    });
  }
  return { top, bottom, rows, ...ownOutside(model, top, bottom) };
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

/** Where a fresh ladder centres: the last trade, else the middle of the
 *  spread, else whichever side is known, else the middle of the price range. */
export function defaultCentre(model: LadderModel): number {
  if (model.lastTradeRung !== null) return model.lastTradeRung;
  if (model.bestBidRung !== null && model.bestAskRung !== null) {
    return Math.floor((model.bestBidRung + model.bestAskRung) / 2);
  }
  if (model.bestBidRung !== null) return model.bestBidRung;
  if (model.bestAskRung !== null) return model.bestAskRung;
  return Math.floor((model.minRung + model.maxRung) / 2);
}
