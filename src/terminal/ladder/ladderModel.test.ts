// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { TEST_MARKETS as MARKETS } from '../../test/markets';
import type { BookLevel, Market, OrderStatus, UserOrder } from '../../types/market';
import { priceKey } from '../../hooks/useOrderBook';
import {
  buildLadder,
  centredStart,
  cumulativeAt,
  ladderWindow,
  levelIndex,
  rungOf,
  rungPrice,
  sideCell,
  tickGrid,
  toTicks,
  type LadderInput,
  type LadderSide,
} from './ladderModel';

const [BTC, ETH, , XRP, DOGE] = MARKETS;

const lvl = (price: number, quantity: number, orderCount = 1): BookLevel => ({ price, quantity, orderCount });

let nextId = 1;
function order(over: Partial<UserOrder> & Pick<UserOrder, 'side' | 'price'>): UserOrder {
  const id = nextId++;
  const original = over.originalQuantity ?? 1;
  const filled = over.filledQuantity ?? 0;
  return {
    orderId: id,
    omsOrderId: String(id),
    marketId: 1,
    market: 'BTC-USD',
    type: 'LIMIT',
    originalQuantity: original,
    filledQuantity: filled,
    remainingQuantity: original - filled,
    status: 'NEW',
    timestamp: id,
    ...over,
  };
}

function model(over: Partial<LadderInput> = {}) {
  return buildLadder({
    market: BTC,
    groupTicks: 1,
    bids: [],
    asks: [],
    openOrders: [],
    lastPrice: null,
    ...over,
  });
}

describe('integer-tick bucketing', () => {
  // [market, price, side, multiplier, expected rung price]
  const cases: Array<[Market, number, LadderSide, number, number]> = [
    [DOGE, 0.3812, 'BID', 1, 0.3812],
    [DOGE, 0.3812, 'ASK', 1, 0.3812],
    [DOGE, 0.3812, 'BID', 5, 0.381],
    [DOGE, 0.3812, 'ASK', 5, 0.3815],
    [DOGE, 0.3819, 'BID', 10, 0.381],
    [DOGE, 0.3811, 'ASK', 10, 0.382],
    [DOGE, 0.3, 'BID', 100, 0.3],
    [DOGE, 0.3, 'ASK', 100, 0.3],
    [XRP, 2.418, 'BID', 1, 2.418],
    [XRP, 2.418, 'BID', 5, 2.415],
    [XRP, 2.418, 'ASK', 5, 2.42],
    [XRP, 2.418, 'BID', 25, 2.4],
    [XRP, 2.418, 'ASK', 25, 2.425],
    [XRP, 0.7, 'ASK', 100, 0.7],
    // ETH x5 groups are 2.5 wide.
    [ETH, 3641, 'BID', 5, 3640],
    [ETH, 3641, 'ASK', 5, 3642.5],
    [ETH, 3642.5, 'BID', 5, 3642.5],
    [ETH, 3642.5, 'ASK', 5, 3642.5],
    [ETH, 3643, 'BID', 5, 3642.5],
    [ETH, 3643, 'ASK', 5, 3645],
    [BTC, 97412, 'BID', 5, 97410],
    [BTC, 97412, 'ASK', 5, 97415],
    [BTC, 97412, 'BID', 100, 97400],
    [BTC, 97412, 'ASK', 100, 97500],
  ];
  it.each(cases)('%# %s %s %s x%s', (market, price, side, mult, expected) => {
    const g = tickGrid(market);
    expect(rungPrice(g, mult, rungOf(g, mult, price, side))).toBe(expected);
  });

  it.each([[DOGE], [XRP]])('every rung price of %s is exact and round-trips', (market) => {
    const g = tickGrid(market);
    const lo = toTicks(g, market.minPrice);
    const hi = toTicks(g, market.maxPrice);
    for (let t = lo; t <= hi; t++) {
      const p = rungPrice(g, 1, t);
      const decimals = (String(p).split('.')[1] ?? '').length;
      expect(decimals).toBeLessThanOrEqual(g.decimals);
      expect(toTicks(g, p)).toBe(t);
    }
  });

  it('prices that are not exact in binary still land on their own tick', () => {
    const g = tickGrid(DOGE);
    // 0.0001 * 3 and 0.1 + 0.2 style artefacts
    expect(toTicks(g, 0.0001 * 3)).toBe(3);
    expect(toTicks(g, 0.38119999999)).toBe(3812);
    expect(toTicks(tickGrid(XRP), 0.1 + 0.2)).toBe(300);
  });

  it('folds levels into one rung with summed quantity, order count and price keys', () => {
    const m = model({ groupTicks: 5, bids: [lvl(97414, 1, 2), lvl(97411, 0.5, 1), lvl(97409, 3, 4)] });
    const c = sideCell(m, 'BID', rungOf(m.grid, 5, 97410, 'BID'));
    expect(c.state).toBe('level');
    expect(c.quantity).toBe(1.5);
    expect(c.orderCount).toBe(3);
    expect(c.priceKeys).toEqual([priceKey(97414), priceKey(97411)]);
  });

  it('ignores zero-quantity levels', () => {
    const m = model({ bids: [lvl(97400, 0), lvl(97399, 1)] });
    expect(m.bestBidRung).toBe(97399);
  });
});

describe('bid floor and ask ceil: a group never straddles the spread', () => {
  it('holds for every open book at every grouping', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const bid = 60000 + Math.floor(rand() * 1000);
      const ask = bid + 1 + Math.floor(rand() * 30);
      for (const g of [1, 5, 10, 25, 100]) {
        const m = model({ groupTicks: g, bids: [lvl(bid, 1)], asks: [lvl(ask, 1)] });
        expect(m.bestAskRung!).toBeGreaterThan(m.bestBidRung!);
        // Two rows, the marker between them.
        expect(m.levels).toEqual([m.bestAskRung, m.bestBidRung]);
        expect(m.split).toBe(1);
      }
    }
  });
});

describe('spread', () => {
  // [name, bid, ask, multiplier, state, ticks, groups]
  const cases: Array<[string, number, number, number, string, number, number]> = [
    ['one tick, x1', 97410, 97411, 1, 'open', 1, 1],
    ['one group, x5 (the design mock)', 97410, 97415, 5, 'open', 5, 1],
    ['wide', 97400, 97420, 1, 'open', 20, 20],
    ['wide under x5', 97400, 97430, 5, 'open', 30, 6],
    ['locked on a boundary', 97410, 97410, 5, 'locked', 0, 0],
    ['locked inside a group', 97412, 97412, 5, 'locked', 0, 0],
    ['crossed', 97411, 97410, 1, 'crossed', -1, -1],
  ];
  it.each(cases)('%s', (_n, bid, ask, g, state, ticks, groups) => {
    const m = model({ groupTicks: g, bids: [lvl(bid, 1)], asks: [lvl(ask, 1)] });
    expect(m.spread).toMatchObject({ state, ticks, groups });
  });

  it('a wide spread draws no rows inside it: the marker sits between the touch levels', () => {
    const m = model({ bids: [lvl(97410, 1), lvl(97400, 1)], asks: [lvl(97415, 1), lvl(97430, 1)] });
    const w = ladderWindow(m, null, 8);
    expect(w.rows.map(r => r.price)).toEqual([97430, 97415, 97410, 97400]);
    expect(w.rows[w.spreadAt!].price).toBe(97410);
    expect(w.rows[w.spreadAt! - 1].price).toBe(97415);
    // The label still counts ticks between the touch, not rows.
    expect(m.spread).toMatchObject({ ticks: 5, groups: 5 });
  });

  it('no marker when it is scrolled out of the window', () => {
    const asks = Array.from({ length: 10 }, (_, i) => lvl(97411 + i, 1));
    const m = model({ bids: [lvl(97410, 1)], asks });
    // Held with the top ask in the top slot: the marker is 10 rows down.
    const w = ladderWindow(m, { rung: 97420, slot: 0 }, 4);
    expect(w.rows.map(r => r.price)).toEqual([97420, 97419, 97418, 97417]);
    expect(w.spreadAt).toBeNull();
  });

  it('locked on one rung shows both sides on that rung', () => {
    const m = model({ bids: [lvl(97410, 2)], asks: [lvl(97410, 3)] });
    expect(m.levels).toEqual([97410]);
    const row = ladderWindow(m, null, 2).rows[0];
    expect([row.bid.quantity, row.ask.quantity]).toEqual([2, 3]);
  });

  it('crossed book shows each level on its own side', () => {
    const m = model({ bids: [lvl(97411, 2), lvl(97409, 1)], asks: [lvl(97410, 3), lvl(97412, 1)] });
    const w = ladderWindow(m, null, 6);
    expect(w.rows.map(r => r.price)).toEqual([97412, 97411, 97410, 97409]);
    const byPrice = Object.fromEntries(w.rows.map(r => [r.price, [r.bid.state, r.ask.state]]));
    expect(byPrice[97411]).toEqual(['level', 'gap']);
    expect(byPrice[97410]).toEqual(['gap', 'level']);
  });
});

describe('rows are book levels only', () => {
  it('a sparse book draws no gap, unknown or out-of-range rows', () => {
    const m = model({
      bids: [lvl(60000, 1), lvl(59998, 1), lvl(59990, 1)],
      asks: [lvl(60001, 1), lvl(60003, 1), lvl(60050, 1)],
    });
    expect(m.levels).toEqual([60050, 60003, 60001, 60000, 59998, 59990]);
    expect(m.split).toBe(3);
    const w = ladderWindow(m, null, 20);
    expect(w.rows.map(r => r.price)).toEqual([60050, 60003, 60001, 60000, 59998, 59990]);
    for (const r of w.rows) {
      // Every row has a level on at least one side; the other side is 'none'.
      expect([r.bid.state, r.ask.state]).toContain('level');
      expect([r.bid.state, r.ask.state].some(st => st === 'gap' || st === 'unknown')).toBe(false);
    }
  });

  it('the centred window: asks above the marker (best ask nearest), bids below (best bid nearest)', () => {
    const m = model({
      bids: [lvl(60000, 1), lvl(59998, 1), lvl(59990, 1)],
      asks: [lvl(60001, 1), lvl(60003, 1), lvl(60050, 1)],
    });
    const w = ladderWindow(m, null, 4);
    expect(w.centred).toBe(true);
    expect([w.padTop, w.padBottom]).toEqual([0, 0]);
    expect(w.rows.map(r => r.price)).toEqual([60003, 60001, 60000, 59998]);
    expect(w.spreadAt).toBe(2);
  });

  it('a short side leaves empty slots, so the marker stays in the middle', () => {
    const m = model({ bids: Array.from({ length: 6 }, (_, i) => lvl(60000 - i * 3, 1)), asks: [lvl(60010, 1)] });
    const w = ladderWindow(m, null, 8);
    expect([w.padTop, w.rows.length, w.padBottom]).toEqual([3, 5, 0]);
    expect(w.padTop + w.spreadAt!).toBe(4); // half the slots above the marker
    expect(w.rows[0].price).toBe(60010);
  });

  it('no asks: every slot above the marker is empty, bids below', () => {
    const m = model({ bids: [lvl(97410, 1), lvl(97408, 2)] });
    expect(m.spread).toBeNull();
    expect(m.split).toBe(0);
    const w = ladderWindow(m, null, 6);
    expect([w.padTop, w.spreadAt, w.rows.length, w.padBottom]).toEqual([3, 0, 2, 1]);
    expect(w.rows.map(r => r.bid.state)).toEqual(['level', 'level']);
    expect(w.rows.every(r => r.ask.state === 'unknown')).toBe(true);
  });

  it('no bids: asks above, the marker after the last row', () => {
    const m = model({ asks: [lvl(97420, 1), lvl(97425, 1)] });
    expect(m.split).toBe(2);
    const w = ladderWindow(m, null, 6);
    expect([w.padTop, w.rows.length, w.spreadAt, w.padBottom]).toEqual([1, 2, 2, 3]);
  });

  it('empty book: no rows at all', () => {
    const m = model();
    const w = ladderWindow(m, null, 6);
    expect(w.rows).toEqual([]);
    expect([w.spreadAt, w.scale, w.top, w.bottom]).toEqual([null, 0, null, null]);
    expect(m.maxCumulative).toBe(0);
  });

  it('a 20-level book under x100 grouping: two rows, both partial at the deep end', () => {
    const bids = Array.from({ length: 20 }, (_, i) => lvl(97400 - i, 1));
    const asks = Array.from({ length: 20 }, (_, i) => lvl(97401 + i, 1));
    const m = model({ groupTicks: 100, bids, asks, lastPrice: 97400 });
    const w = ladderWindow(m, null, 8);
    // The bucket label is acceptable under grouping: 97401..97420 ceil into
    // 97500, 97400 floors into 97400, 97381..97399 into 97300.
    expect(w.rows.map(r => r.price)).toEqual([97500, 97400, 97300]);
    const cells = w.rows.map(r => [r.bid.state, r.bid.quantity, r.bid.partial, r.ask.state, r.ask.quantity, r.ask.partial]);
    expect(cells).toEqual([
      ['none', null, false, 'level', 20, true],
      ['level', 1, false, 'none', null, false],
      ['level', 19, true, 'none', null, false],
    ]);
    expect(w.rows[w.spreadAt!].price).toBe(97400);
    expect(m.spread).toMatchObject({ ticks: 1, groups: 0.01 });
  });
});

describe('cumulative depth', () => {
  // Asks 97411: 2, 97413: 3, 97414: 1; bids 97410: 1, 97409: 4, 97407: 2.
  const book = () =>
    model({
      bids: [lvl(97410, 1), lvl(97409, 4), lvl(97407, 2)],
      asks: [lvl(97411, 2), lvl(97413, 3), lvl(97414, 1)],
    });

  it('accumulates from the best price outward on each side', () => {
    const m = book();
    expect(m.askCum).toEqual([
      { rung: 97411, cum: 2 },
      { rung: 97413, cum: 5 },
      { rung: 97414, cum: 6 },
    ]);
    expect(m.bidCum).toEqual([
      { rung: 97410, cum: 1 },
      { rung: 97409, cum: 5 },
      { rung: 97407, cum: 7 },
    ]);
    expect(m.maxCumulative).toBe(7);
    // A gap carries the total of the rungs before it.
    expect(cumulativeAt(m, 'ASK', 97412)).toBe(2);
    expect(cumulativeAt(m, 'BID', 97408)).toBe(5);
  });

  it('cells carry the level quantity and the cumulative; none carries neither', () => {
    const m = book();
    const w = ladderWindow(m, null, 6);
    const cells = Object.fromEntries(
      w.rows.map(r => [r.price, [r.bid.quantity, r.bid.cumulative, r.ask.quantity, r.ask.cumulative]]),
    );
    expect(cells).toEqual({
      97414: [null, null, 1, 6],
      97413: [null, null, 3, 5],
      97411: [null, null, 2, 2],
      97410: [1, 1, null, null],
      97409: [4, 5, null, null],
      97407: [2, 7, null, null],
    });
    for (const r of w.rows) {
      for (const c of [r.bid, r.ask]) {
        if (c.state === 'none') expect([c.bar, c.cumulative]).toEqual([0, null]);
      }
    }
  });

  it('scales both sides to the largest cumulative in the window', () => {
    const m = book();
    const all = ladderWindow(m, null, 6);
    expect(all.scale).toBe(7);
    const bar = (w: typeof all, p: number, side: 'bid' | 'ask') => w.rows.find(r => r.price === p)![side].bar;
    expect(bar(all, 97407, 'bid')).toBe(1);
    expect(bar(all, 97414, 'ask')).toBeCloseTo(6 / 7);
    expect(bar(all, 97411, 'ask')).toBeCloseTo(2 / 7);
    expect(bar(all, 97410, 'bid')).toBeCloseTo(1 / 7);
    // A tighter window (97413..97409) shows less: its own largest is the
    // bid cumulative 5 at 97409 (the ask side reaches 5 at 97413 too).
    const tight = ladderWindow(m, null, 4);
    expect(tight.rows.map(r => r.price)).toEqual([97413, 97411, 97410, 97409]);
    expect(tight.scale).toBe(5);
    expect(bar(tight, 97409, 'bid')).toBe(1);
    expect(bar(tight, 97411, 'ask')).toBeCloseTo(2 / 5);
  });

  it('is measured after grouping', () => {
    const m = model({ groupTicks: 5, bids: [lvl(97414, 3), lvl(97412, 3), lvl(97400, 4)] });
    expect(m.bidCum).toEqual([
      { rung: rungOf(m.grid, 5, 97414, 'BID'), cum: 6 },
      { rung: rungOf(m.grid, 5, 97400, 'BID'), cum: 10 },
    ]);
    expect(m.maxCumulative).toBe(10);
  });

  it('the deepest partial rung is a lower bound on both numbers', () => {
    const bids = Array.from({ length: 20 }, (_, i) => lvl(97400 - i, 1));
    const m = model({ groupTicks: 100, bids, asks: [lvl(97401, 1)] });
    const cell = sideCell(m, 'BID', rungOf(m.grid, 100, 97300, 'BID'));
    expect([cell.quantity, cell.cumulative, cell.partial]).toEqual([19, 20, true]);
  });
});

describe('own orders', () => {
  it('aggregates by rung and side, clamped to the level', () => {
    const a = order({ side: 'BID', price: 97405, originalQuantity: 0.5, filledQuantity: 0.3 });
    const b = order({ side: 'BID', price: 97406, originalQuantity: 1 });
    const m = model({ groupTicks: 5, bids: [lvl(97405, 0.8)], asks: [lvl(97420, 1)], openOrders: [b, a] });
    const own = sideCell(m, 'BID', rungOf(m.grid, 5, 97405, 'BID')).own!;
    expect(own.quantity).toBeCloseTo(1.2);
    expect(own.slice).toBe(0.8); // clamp: own 1.2 > level 0.8
    // Default scale: the larger side's whole volume (asks 1 vs bids 0.8).
    expect(own.sliceFraction).toBe(0.8);
    expect(own.filled).toBeCloseTo(0.3);
    expect(own.original).toBe(1.5);
    expect(own.orders).toEqual([a, b]); // oldest first
  });

  it('own quantity smaller than the level is not clamped', () => {
    const o = order({ side: 'ASK', price: 97420, originalQuantity: 0.2 });
    const m = model({ asks: [lvl(97420, 1)], bids: [lvl(97400, 4)], openOrders: [o] });
    const own = sideCell(m, 'ASK', 97420).own!;
    // Scale: the larger total, 4 (bids).
    expect([own.quantity, own.slice, own.sliceFraction]).toEqual([0.2, 0.2, 0.05]);
  });

  it('an own order the book does not show yet keeps its quantity with a zero slice', () => {
    const o = order({ side: 'BID', price: 97399, originalQuantity: 1 });
    const m = model({ bids: [lvl(97400, 1)], asks: [lvl(97401, 1)], openOrders: [o] });
    const own = sideCell(m, 'BID', 97399).own!;
    expect([own.quantity, own.slice]).toEqual([1, 0]);
  });

  it('own asks ceil and own bids floor like the book', () => {
    const bid = order({ side: 'BID', price: 97412 });
    const ask = order({ side: 'ASK', price: 97412 });
    const m = model({ groupTicks: 5, openOrders: [bid, ask] });
    expect(m.own.map(p => [p.side, rungPrice(m.grid, 5, p.rung)])).toEqual([['BID', 97410], ['ASK', 97415]]);
  });

  const statuses: Array<[OrderStatus, boolean]> = [
    ['NEW', true],
    ['PARTIALLY_FILLED', true],
    ['PENDING_TRIGGER', false],
    ['PENDING_NEW', false],
    ['FILLED', false],
    ['CANCELLED', false],
    ['REJECTED', false],
  ];
  it.each(statuses)('status %s on the ladder: %s', (status, shown) => {
    const m = model({ openOrders: [order({ side: 'BID', price: 97400, status })] });
    expect(m.own.length).toBe(shown ? 1 : 0);
  });

  it('keeps only this market, and only priced orders with quantity left', () => {
    const m = model({
      openOrders: [
        order({ side: 'BID', price: 97400 }),
        order({ side: 'BID', price: 3600, marketId: 2, market: 'ETH-USD' }),
        order({ side: 'BID', price: 0, type: 'MARKET' }),
        order({ side: 'BID', price: 97400, originalQuantity: 1, filledQuantity: 1 }),
      ],
    });
    expect(m.own.length).toBe(1);
  });
});

describe('own orders outside the window', () => {
  // Own orders rest at engine levels, so the book carries every one of them.
  const above1 = order({ side: 'ASK', price: 98000, originalQuantity: 0.1 });
  const above2 = order({ side: 'ASK', price: 98500 });
  const above3 = order({ side: 'ASK', price: 98000 }); // same price, newer than above1
  const inside = order({ side: 'BID', price: 97400 });
  const below1 = order({ side: 'BID', price: 97050, originalQuantity: 2 });
  const below2 = order({ side: 'BID', price: 96000 });
  const m = model({
    asks: [lvl(97401, 1), lvl(97402, 1), lvl(98000, 2), lvl(98500, 1)],
    bids: [lvl(97400, 1), lvl(97399, 1), lvl(97050, 2), lvl(96000, 1)],
    openOrders: [above2, above3, above1, inside, below2, below1],
  });

  it('counts and the nearest each way (closest price, then oldest)', () => {
    const w = ladderWindow(m, null, 4); // 97402..97399
    expect(w.above.count).toBe(3);
    expect(w.above.nearest!.order).toBe(above1);
    expect(w.below.count).toBe(2);
    expect(w.below.nearest!.order).toBe(below1);
  });

  it('none outside when the window covers everything', () => {
    const w = ladderWindow(m, null, 20);
    expect([w.above.count, w.below.count]).toEqual([0, 0]);
    expect([w.above.nearest, w.below.nearest]).toEqual([null, null]);
  });

  it('an order on the edge row is inside', () => {
    const w = ladderWindow(m, null, 6); // 98000..97050
    expect(w.top).toBe(98000);
    expect(w.above.count).toBe(1);
    expect(w.above.nearest!.order).toBe(above2);
  });
});

describe('last-trade rung', () => {
  const cases: Array<[number, number | null, number | null]> = [
    [1, 97412, 97412],
    [5, 97412, 97410],
    [5, 97415, 97415],
    [100, 97499, 97400],
    [1, null, null],
    [1, 0, null],
  ];
  it.each(cases)('x%s last %s -> rung %s', (g, last, expected) => {
    const m = model({ groupTicks: g, lastPrice: last });
    expect(m.lastTradeRung === null ? null : rungPrice(m.grid, g, m.lastTradeRung)).toBe(expected);
  });

  it('a last trade with no level draws no row of its own (the spread row carries it)', () => {
    const m = model({ lastPrice: 97412, bids: [lvl(97000, 1)], asks: [lvl(98000, 1)] });
    const w = ladderWindow(m, null, 10);
    expect(w.rows.map(r => r.price)).toEqual([98000, 97000]);
  });

  it('is float-safe on DOGE', () => {
    const m = model({ market: DOGE, groupTicks: 5, lastPrice: 0.3812 });
    expect(rungPrice(m.grid, 5, m.lastTradeRung!)).toBe(0.381);
  });
});

describe('level window', () => {
  // 10 asks 97411..97420, 10 bids 97410..97401.
  const deep = () =>
    model({
      bids: Array.from({ length: 10 }, (_, i) => lvl(97410 - i, 1)),
      asks: Array.from({ length: 10 }, (_, i) => lvl(97411 + i, 1)),
    });

  it('levelIndex finds a level, or where it would be', () => {
    const m = deep();
    expect(levelIndex(m, 97420)).toBe(0);
    expect(levelIndex(m, 97410)).toBe(10);
    expect(levelIndex(m, 99999)).toBe(0);
    expect(levelIndex(m, 1)).toBe(20);
    const sparse = model({ bids: [lvl(97400, 1)], asks: [lvl(97410, 1)] });
    expect(levelIndex(sparse, 97405)).toBe(1); // the first level at or below
  });

  it('the centred window is half the slots either side of the marker', () => {
    const m = deep();
    expect(centredStart(m, 6)).toBe(7);
    const w = ladderWindow(m, null, 6);
    expect(w.rows.map(r => r.price)).toEqual([97413, 97412, 97411, 97410, 97409, 97408]);
    expect([w.start, w.spreadAt, w.centred]).toEqual([7, 3, true]);
  });

  it('a held position keeps its level in its slot as levels come and go', () => {
    const m = deep();
    const pos = { rung: 97415, slot: 0 };
    expect(ladderWindow(m, pos, 4).rows.map(r => r.price)).toEqual([97415, 97414, 97413, 97412]);
    expect(ladderWindow(m, pos, 4).centred).toBe(false);
    // 97414 leaves the book: 97415 stays on top, the next level moves up.
    const m2 = model({
      bids: Array.from({ length: 10 }, (_, i) => lvl(97410 - i, 1)),
      asks: Array.from({ length: 10 }, (_, i) => lvl(97411 + i, 1)).filter(l => l.price !== 97414),
    });
    expect(ladderWindow(m2, pos, 4).rows.map(r => r.price)).toEqual([97415, 97413, 97412, 97411]);
  });

  it('a held position never scrolls further past the ends than the centred window', () => {
    const m = deep();
    // Far above the top: clamped to the top level in the top slot.
    expect(ladderWindow(m, { rung: 97420, slot: 5 }, 4).start).toBe(0);
    // Far below the bottom: the last four levels.
    expect(ladderWindow(m, { rung: 97401, slot: -10 }, 4).rows.map(r => r.price)).toEqual([97404, 97403, 97402, 97401]);
    // A short book: the centred window itself (with empty slots) is the limit.
    const thin = model({ bids: [lvl(97400, 1)], asks: [lvl(97401, 1)] });
    expect(ladderWindow(thin, { rung: 97401, slot: 0 }, 6).start).toBe(-2);
    expect(ladderWindow(thin, { rung: 97401, slot: 0 }, 6).centred).toBe(true);
  });

  it('zero slots is an empty window', () => {
    expect(ladderWindow(deep(), null, 0).rows).toEqual([]);
  });

  it('rows are strictly descending in price, at the group step', () => {
    const m = model({
      market: ETH,
      groupTicks: 5,
      bids: [lvl(3642.5, 1), lvl(3640, 1), lvl(3637.5, 1)],
      asks: [lvl(3645, 1), lvl(3647.5, 1)],
    });
    const w = ladderWindow(m, null, 6);
    expect(w.rows.map(r => r.price)).toEqual([3647.5, 3645, 3642.5, 3640, 3637.5]);
  });
});
