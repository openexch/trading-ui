// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { MARKETS } from '../../types/market';
import type { BookLevel, Market, OrderStatus, UserOrder } from '../../types/market';
import { priceKey } from '../../hooks/useOrderBook';
import {
  buildLadder,
  cumulativeAt,
  defaultCentre,
  ladderWindow,
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
    userId: 7,
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
        expect(m.spread!.lowerRung).not.toBeNull();
        expect(m.spread!.lowerRung!).toBeGreaterThanOrEqual(m.bestBidRung!);
        expect(m.spread!.lowerRung!).toBeLessThan(m.bestAskRung!);
      }
    }
  });
});

describe('spread', () => {
  // [name, bid, ask, multiplier, state, ticks, groups, lowerRung price or null]
  const cases: Array<[string, number, number, number, string, number, number, number | null]> = [
    ['one tick, x1', 97410, 97411, 1, 'open', 1, 1, 97410],
    ['one group, x5 (the design mock)', 97410, 97415, 5, 'open', 5, 1, 97410],
    ['wide, line sits at the mid', 97400, 97420, 1, 'open', 20, 20, 97410],
    ['wide under x5', 97400, 97430, 5, 'open', 30, 6, 97415],
    ['locked on a boundary', 97410, 97410, 5, 'locked', 0, 0, null],
    ['locked inside a group', 97412, 97412, 5, 'locked', 0, 0, 97410],
    ['crossed', 97411, 97410, 1, 'crossed', -1, -1, null],
  ];
  it.each(cases)('%s', (_n, bid, ask, g, state, ticks, groups, lower) => {
    const m = model({ groupTicks: g, bids: [lvl(bid, 1)], asks: [lvl(ask, 1)] });
    expect(m.spread).toMatchObject({ state, ticks, groups });
    expect(m.spread!.lowerRung === null ? null : rungPrice(m.grid, g, m.spread!.lowerRung)).toBe(lower);
  });

  it('the window flags the row directly above the line', () => {
    const m = model({ bids: [lvl(97410, 1)], asks: [lvl(97415, 1)] });
    const w = ladderWindow(m, 97412, 9);
    const flagged = w.rows.filter(r => r.spreadBelow).map(r => r.price);
    expect(flagged).toEqual([97413]);
    // In-spread rungs are empty on both sides, never unknown.
    const inSpread = w.rows.filter(r => r.price > 97410 && r.price < 97415);
    expect(inSpread.map(r => [r.bid.state, r.ask.state])).toEqual(Array(4).fill(['none', 'none']));
  });

  it('no line when the line would fall outside the window', () => {
    const m = model({ bids: [lvl(97410, 1)], asks: [lvl(97411, 1)] });
    const w = ladderWindow(m, 97500, 5);
    expect(w.rows.some(r => r.spreadBelow)).toBe(false);
  });

  it('locked on one rung shows both sides on that rung', () => {
    const m = model({ bids: [lvl(97410, 2)], asks: [lvl(97410, 3)] });
    const row = ladderWindow(m, 97410, 1).rows[0];
    expect([row.bid.quantity, row.ask.quantity]).toEqual([2, 3]);
  });

  it('crossed book shows each level on its own side', () => {
    const m = model({ bids: [lvl(97411, 2), lvl(97409, 1)], asks: [lvl(97410, 3), lvl(97412, 1)] });
    const w = ladderWindow(m, 97410, 3);
    const byPrice = Object.fromEntries(w.rows.map(r => [r.price, [r.bid.state, r.ask.state]]));
    expect(byPrice[97411]).toEqual(['level', 'gap']);
    expect(byPrice[97410]).toEqual(['gap', 'level']);
  });
});

describe('one side empty', () => {
  it('no asks: no spread, every ask cell unknown, bids unaffected', () => {
    const m = model({ bids: [lvl(97410, 1), lvl(97408, 2)] });
    expect(m.spread).toBeNull();
    const w = ladderWindow(m, 97410, 7);
    expect(w.rows.every(r => r.ask.state === 'unknown' && r.ask.quantity === null)).toBe(true);
    expect(w.rows.map(r => r.bid.state)).toEqual(['none', 'none', 'none', 'level', 'gap', 'level', 'unknown']);
    expect(defaultCentre(m)).toBe(97410);
  });

  it('no bids: centres on the best ask', () => {
    const m = model({ asks: [lvl(97420, 1)] });
    expect(defaultCentre(m)).toBe(97420);
  });

  it('empty book: centres mid-range and everything is unknown', () => {
    const m = model();
    expect(defaultCentre(m)).toBe(100000);
    const w = ladderWindow(m, defaultCentre(m), 3);
    expect(w.rows.every(r => r.bid.state === 'unknown' && r.ask.state === 'unknown')).toBe(true);
    expect(m.maxCumulative).toBe(0);
    expect(w.scale).toBe(0);
    expect(w.rows.every(r => r.bid.bar === 0 && r.ask.bar === 0 && r.bid.cumulative === null)).toBe(true);
  });
});

describe('known-depth boundary', () => {
  it('x1: gaps inside known depth are empty, beyond the deepest level is unknown', () => {
    const m = model({
      bids: [lvl(60000, 1), lvl(59998, 1), lvl(59997, 1)],
      asks: [lvl(60001, 1), lvl(60003, 1)],
    });
    const w = ladderWindow(m, 60000, 9);
    const states = Object.fromEntries(w.rows.map(r => [r.price, `${r.bid.state}/${r.ask.state}`]));
    expect(states).toEqual({
      60004: 'none/unknown',
      60003: 'none/level',
      60002: 'none/gap',
      60001: 'none/level',
      60000: 'level/none',
      59999: 'gap/none',
      59998: 'level/none',
      59997: 'level/none',
      59996: 'unknown/none',
    });
    expect(w.rows.every(r => !r.bid.partial && !r.ask.partial)).toBe(true);
    expect(w.rows.find(r => r.price === 59996)!.bid.quantity).toBeNull();
    expect(w.rows.find(r => r.price === 59999)!.bid.quantity).toBe(0);
  });

  it('a 20-level book under x100 grouping: two rungs of data, the rest unknown', () => {
    const bids = Array.from({ length: 20 }, (_, i) => lvl(97400 - i, 1));
    const asks = Array.from({ length: 20 }, (_, i) => lvl(97401 + i, 1));
    const m = model({ groupTicks: 100, bids, asks, lastPrice: 97400 });
    const w = ladderWindow(m, defaultCentre(m), 9);
    expect(w.rows.map(r => r.price)).toEqual([97800, 97700, 97600, 97500, 97400, 97300, 97200, 97100, 97000]);
    const cells = w.rows.map(r => [r.bid.state, r.bid.quantity, r.bid.partial, r.ask.state, r.ask.quantity, r.ask.partial]);
    expect(cells).toEqual([
      ['none', null, false, 'unknown', null, false],
      ['none', null, false, 'unknown', null, false],
      ['none', null, false, 'unknown', null, false],
      // 97401..97420 ceil into the 97500 rung; 97421..97500 are not known.
      ['none', null, false, 'level', 20, true],
      // 97400 alone floors into the 97400 rung (the touch, fully known).
      ['level', 1, false, 'none', null, false],
      // 97381..97399 floor into 97300; 97300..97380 are not known.
      ['level', 19, true, 'none', null, false],
      ['unknown', null, false, 'none', null, false],
      ['unknown', null, false, 'none', null, false],
      ['unknown', null, false, 'none', null, false],
    ]);
    expect(w.rows.find(r => r.isLastTrade)!.price).toBe(97400);
    expect(w.rows.find(r => r.spreadBelow)!.price).toBe(97500);
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

  it('cells carry the level quantity and the cumulative; unknown and none carry neither', () => {
    const m = book();
    const w = ladderWindow(m, 97411, 11); // 97416..97406
    const cells = Object.fromEntries(
      w.rows.map(r => [r.price, [r.bid.quantity, r.bid.cumulative, r.ask.quantity, r.ask.cumulative]]),
    );
    expect(cells).toEqual({
      97416: [null, null, null, null], // ask unknown, bid none
      97415: [null, null, null, null],
      97414: [null, null, 1, 6],
      97413: [null, null, 3, 5],
      97412: [null, null, 0, 2], // gap
      97411: [null, null, 2, 2],
      97410: [1, 1, null, null],
      97409: [4, 5, null, null],
      97408: [0, 5, null, null], // gap
      97407: [2, 7, null, null],
      97406: [null, null, null, null], // bid unknown
    });
    for (const r of w.rows) {
      for (const c of [r.bid, r.ask]) {
        if (c.state === 'unknown' || c.state === 'none') expect([c.bar, c.cumulative]).toEqual([0, null]);
      }
    }
  });

  it('scales both sides to the largest cumulative in the window', () => {
    const m = book();
    const all = ladderWindow(m, 97411, 11);
    expect(all.scale).toBe(7);
    const bar = (w: typeof all, p: number, side: 'bid' | 'ask') => w.rows.find(r => r.price === p)![side].bar;
    expect(bar(all, 97407, 'bid')).toBe(1);
    expect(bar(all, 97414, 'ask')).toBeCloseTo(6 / 7);
    expect(bar(all, 97411, 'ask')).toBeCloseTo(2 / 7);
    expect(bar(all, 97410, 'bid')).toBeCloseTo(1 / 7);
    // A tighter window (97412..97408) shows less: its own largest is the
    // bid cumulative 5 at 97409 (and the gap at 97408).
    const tight = ladderWindow(m, 97410, 5);
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
  const above1 = order({ side: 'ASK', price: 98000, originalQuantity: 0.1 });
  const above2 = order({ side: 'ASK', price: 98500 });
  const above3 = order({ side: 'ASK', price: 98000 }); // same price, newer than above1
  const inside = order({ side: 'BID', price: 97400 });
  const below1 = order({ side: 'BID', price: 97050, originalQuantity: 2 });
  const below2 = order({ side: 'BID', price: 96000 });
  const m = model({ openOrders: [above2, above3, above1, inside, below2, below1] });

  it('counts and the nearest each way (closest price, then oldest)', () => {
    const w = ladderWindow(m, 97400, 21);
    expect(w.above.count).toBe(3);
    expect(w.above.nearest!.order).toBe(above1);
    expect(w.below.count).toBe(2);
    expect(w.below.nearest!.order).toBe(below1);
  });

  it('none outside when the window covers everything', () => {
    const w = ladderWindow(m, 97250, 2601);
    expect([w.above.count, w.below.count]).toEqual([0, 0]);
    expect([w.above.nearest, w.below.nearest]).toEqual([null, null]);
  });

  it('an order on the edge rung is inside', () => {
    const w = ladderWindow(m, 97500, 1001); // top 98000
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

  it('flags exactly one row and drives the default centre', () => {
    const m = model({ lastPrice: 97412, bids: [lvl(97000, 1)], asks: [lvl(98000, 1)] });
    expect(defaultCentre(m)).toBe(97412);
    const w = ladderWindow(m, defaultCentre(m), 11);
    expect(w.rows.filter(r => r.isLastTrade).map(r => r.price)).toEqual([97412]);
  });

  it('is float-safe on DOGE', () => {
    const m = model({ market: DOGE, groupTicks: 5, lastPrice: 0.3812 });
    expect(rungPrice(m.grid, 5, m.lastTradeRung!)).toBe(0.381);
  });
});

describe('rung window', () => {
  it.each([
    [5, 97412, 97410],
    [4, 97411, 97410],
    [1, 97410, 97410],
  ])('count %s centred on 97410 spans down from %s to %s', (count, top, bottom) => {
    const w = ladderWindow(model(), 97410, count);
    expect([w.top, w.bottom, w.rows.length]).toEqual([top, top - count + 1, count]);
    expect(w.rows[0].price).toBe(top);
    expect(w.rows.some(r => r.price === bottom)).toBe(true);
  });

  it('zero rows is an empty window', () => {
    expect(ladderWindow(model(), 97410, 0).rows).toEqual([]);
  });

  it('stays inside the market range', () => {
    const top = ladderWindow(model(), 149999, 10);
    expect(top.top).toBe(150000);
    const bottom = ladderWindow(model(), 50001, 10);
    expect(bottom.bottom).toBe(50000);
    expect([...top.rows, ...bottom.rows].every(r => r.inRange)).toBe(true);
  });

  it('a window taller than the whole range marks the extra rows out of range', () => {
    // DOGE x100: 0.05..1 in 0.01 steps = 96 rungs.
    const m = model({ market: DOGE, groupTicks: 100 });
    const w = ladderWindow(m, defaultCentre(m), 100);
    expect(w.rows[0].price).toBe(1);
    expect(w.rows.filter(r => r.inRange).length).toBe(96);
    expect(w.rows.filter(r => !r.inRange).length).toBe(4);
  });

  it('rows are strictly descending in price, at the group step', () => {
    const m = model({ market: ETH, groupTicks: 5 });
    const w = ladderWindow(m, rungOf(m.grid, 5, 3642.5, 'BID'), 5);
    expect(w.rows.map(r => r.price)).toEqual([3647.5, 3645, 3642.5, 3640, 3637.5]);
  });
});
