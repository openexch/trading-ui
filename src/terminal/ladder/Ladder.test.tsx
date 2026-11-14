// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BookLevel, Market, OrderBook, UserOrder } from '../../types/market';
import { Ladder } from './Ladder';
import { deadBand, rowsForHeight } from './useLadderWindow';

// ---- ResizeObserver mock: tests set the observed height ------------------

type RoCallback = (entries: { contentRect: { height: number } }[]) => void;
let observers: { cb: RoCallback; el: Element | null }[] = [];

class MockResizeObserver {
  cb: RoCallback;
  el: Element | null = null;
  constructor(cb: RoCallback) {
    this.cb = cb;
    observers.push(this);
  }
  observe(el: Element) {
    this.el = el;
  }
  unobserve() {}
  disconnect() {
    observers = observers.filter(o => o !== this);
  }
}

function resize(height: number) {
  act(() => {
    for (const o of observers) if (o.el) o.cb([{ contentRect: { height } }]);
  });
}

// ---- fixtures --------------------------------------------------------------

// Tick 1, no marketUi entry: grouping defaults to x1, sizes print 8 decimals.
const TEST: Market = {
  id: 9,
  symbol: 'TST-USD',
  baseAsset: 'TST',
  quoteAsset: 'USD',
  name: 'Test',
  tickSize: 1,
  minPrice: 1,
  maxPrice: 100_000,
};

/** A book with levels at every tick: bids mid-1 down, asks mid+1 up. */
function bookAround(mid: number, depth = 20): OrderBook {
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  for (let i = 1; i <= depth; i++) {
    bids.push({ price: mid - i, quantity: 1 + i / 10, orderCount: 1 });
    asks.push({ price: mid + i, quantity: 1 + i / 10, orderCount: 1 });
  }
  return { bids, asks, lastUpdate: 1 };
}

let nextId = 1;
function order(side: 'BID' | 'ASK', price: number, qty = 1, filled = 0): UserOrder {
  const id = nextId++;
  return {
    orderId: id,
    omsOrderId: String(1000 + id),
    marketId: TEST.id,
    market: TEST.symbol,
    userId: 1,
    side,
    type: 'LIMIT',
    price,
    originalQuantity: qty,
    remainingQuantity: qty - filled,
    filledQuantity: filled,
    status: filled > 0 ? 'PARTIALLY_FILLED' : 'NEW',
    timestamp: id,
  };
}

function rungPrices(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-rung-price]')).map(el =>
    Number(el.dataset.rungPrice),
  );
}

function middle(container: HTMLElement): number {
  const p = rungPrices(container);
  return p[(p.length - 1) / 2];
}

interface Props {
  book?: OrderBook;
  last?: number | null;
  open?: UserOrder[];
}

function setup(initial: Props = {}) {
  const state = { book: bookAround(1000), last: 1000 as number | null, open: [] as UserOrder[], ...initial };
  const el = (p: typeof state) => (
    <Ladder market={TEST} orderBook={p.book} levelChanges={new Map()} openOrders={p.open} lastPrice={p.last} />
  );
  const utils = render(el(state));
  const update = (patch: Props) => {
    Object.assign(state, patch);
    utils.rerender(el(state));
  };
  const region = utils.container.querySelector<HTMLElement>('[data-ladder-region]')!;
  return { ...utils, update, region };
}

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});
afterEach(() => cleanup());

// ---- pure helpers ----------------------------------------------------------

describe('rowsForHeight / deadBand', () => {
  it('fits whole 22px rungs and keeps the count odd', () => {
    expect(rowsForHeight(0)).toBe(0);
    expect(rowsForHeight(21)).toBe(0);
    expect(rowsForHeight(22)).toBe(1);
    expect(rowsForHeight(44)).toBe(1);
    expect(rowsForHeight(66)).toBe(3);
    expect(rowsForHeight(220)).toBe(9); // 10 fit, odd -> 9
    expect(rowsForHeight(242)).toBe(11);
    expect(rowsForHeight(500)).toBe(21); // 22 fit -> 21
  });

  it('re-centres outside max(2, floor(N/4))', () => {
    expect(deadBand(3)).toBe(2);
    expect(deadBand(9)).toBe(2);
    expect(deadBand(21)).toBe(5);
  });
});

// ---- row count -------------------------------------------------------------

describe('Ladder row count', () => {
  it('renders the odd row count the ResizeObserver reports, at fixed 22px rungs', () => {
    const { container } = setup();
    expect(rungPrices(container)).toHaveLength(0); // not measured yet
    resize(220);
    expect(rungPrices(container)).toHaveLength(9);
    resize(500);
    expect(rungPrices(container)).toHaveLength(21);
    resize(66);
    expect(rungPrices(container)).toHaveLength(3);
    // Every rung is the same fixed height class (never shrunk to fit).
    for (const r of container.querySelectorAll('[data-rung-price]')) {
      expect(r.className).toContain('h-[22px]');
    }
  });

  it('centres the window on the last trade, highest price first', () => {
    const { container } = setup();
    resize(220);
    expect(rungPrices(container)).toEqual([1004, 1003, 1002, 1001, 1000, 999, 998, 997, 996]);
    expect(container.querySelector('[data-last-trade]')!.textContent).toContain('1,000');
  });

  it('shows skeleton rungs while the book is empty (market switch)', () => {
    const { container } = setup({ book: { bids: [], asks: [], lastUpdate: 0 }, last: null });
    resize(220);
    expect(container.querySelectorAll('[data-skeleton-rung]')).toHaveLength(9);
    expect(rungPrices(container)).toHaveLength(0);
  });
});

// ---- dead band and pinning -------------------------------------------------

describe('Ladder re-centring', () => {
  it('stays put inside the dead band and re-centres once the mid leaves it', () => {
    const { container, update } = setup();
    resize(220); // 9 rows, band = 2
    expect(middle(container)).toBe(1000);
    update({ book: bookAround(1002), last: 1002 });
    expect(middle(container)).toBe(1000); // |2| <= band: no move
    update({ book: bookAround(1003), last: 1003 });
    expect(middle(container)).toBe(1003); // left the band: re-centred
  });

  it('never re-centres while the pointer is over the ladder', () => {
    const { container, update, region } = setup();
    resize(220);
    fireEvent.pointerEnter(region);
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).toBe(1000);
    expect(region.dataset.pinned).toBe('true');
    fireEvent.pointerLeave(region);
    expect(middle(container)).toBe(1050);
  });

  it('never re-centres while the ladder has focus', () => {
    const { container, update, region } = setup();
    resize(220);
    const grid = screen.getByRole('grid');
    act(() => grid.focus());
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).toBe(1000);
    act(() => grid.blur());
    expect(region.dataset.pinned).toBe('false');
    expect(middle(container)).toBe(1050);
  });

  it('wheel moves the window and holds it until Re-centre or C', () => {
    const { container, update, region } = setup();
    resize(220);
    fireEvent.wheel(region, { deltaY: 66 }); // three rungs down
    expect(middle(container)).toBe(997);
    fireEvent.wheel(region, { deltaY: -22 });
    expect(middle(container)).toBe(998);
    fireEvent.pointerLeave(region);
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).toBe(998); // held

    fireEvent.click(screen.getByRole('button', { name: /re-centre/i }));
    expect(middle(container)).toBe(1050);
    expect(screen.queryByRole('button', { name: /re-centre/i })).toBeNull();

    fireEvent.wheel(region, { deltaY: 22 });
    expect(middle(container)).toBe(1049);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'c' });
    expect(middle(container)).toBe(1050);
  });

  it('C typed into the grouping select does not re-centre', () => {
    const { container, region } = setup();
    resize(220);
    fireEvent.wheel(region, { deltaY: 44 });
    expect(middle(container)).toBe(998);
    fireEvent.keyDown(screen.getByRole('combobox', { name: /price grouping/i }), { key: 'c' });
    expect(middle(container)).toBe(998);
  });
});

// ---- own orders --------------------------------------------------------------

describe('Ladder own orders', () => {
  it('counts own orders above and below the window and jumps to the nearest', () => {
    const open = [
      order('ASK', 1010, 0.5),
      order('ASK', 1020, 0.25),
      order('ASK', 1030, 1),
      order('BID', 990, 2, 0.7),
      order('BID', 999, 1), // inside the window
      { ...order('BID', 950, 1), marketId: 2 }, // other market: not on this ladder
    ];
    const { container } = setup({ open });
    resize(220); // rows 1004..996

    const above = screen.getByRole('button', { name: /3 own orders above the ladder/i });
    expect(above.textContent).toContain('▲ 3 above');
    expect(above.textContent).toContain('nearest Sell 0.50 @ 1,010');
    const below = screen.getByRole('button', { name: /1 own order below the ladder/i });
    expect(below.textContent).toContain('▼ 1 below');
    expect(below.textContent).toContain('35% filled');

    // The order inside the window shows its chip, slice and row tint.
    expect(screen.getByRole('img', { name: /your buy order at 999/i })).toBeTruthy();
    expect(container.querySelector('[data-rung-price="999"] [data-own-slice]')).toBeTruthy();

    fireEvent.click(above);
    expect(middle(container)).toBe(1010);
    expect(screen.getByRole('img', { name: /your sell order at 1,010/i })).toBeTruthy();
    // Held there: a re-centre control appears, and the ask at 999 is now below.
    expect(screen.getByRole('button', { name: /re-centre/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2 own orders below the ladder/i })).toBeTruthy();
  });

  it('shows filled / original on a partly filled chip', () => {
    setup({ open: [order('BID', 998, 0.5, 0.3)] });
    resize(220);
    const chip = screen.getByRole('img', { name: /your buy order at 998/i });
    expect(chip.textContent).toBe('0.30/0.50');
  });
});

// ---- depth states and spread line --------------------------------------------

describe('Ladder depth', () => {
  it('marks rungs beyond the known depth as unknown, never empty', () => {
    const { container } = setup({ book: bookAround(1000, 2) });
    resize(220); // 1004..996; known asks 1001..1002, bids 999..998
    const unknownAsk = container.querySelector('[data-rung-price="1004"]')!;
    expect(unknownAsk.querySelector('[data-unknown]')).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /asks at 1,004: depth unknown/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /bids at 996: depth unknown/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /asks at 1,002: 1.20000000 TST/i })).toBeTruthy();
  });

  it('draws the spread line between the touch rungs without taking a row', () => {
    const { container } = setup();
    resize(220);
    const line = container.querySelector<HTMLElement>('[data-spread-line]')!;
    expect(line).toBeTruthy();
    expect(line.textContent).toContain('Spread 2');
    // The touch is 999 | 1001 and the line goes between the 1001 and 1000
    // rungs: on the boundary under the 4th row (1004, 1003, 1002, 1001),
    // centred on it, taking no height of its own.
    expect(line.style.top).toBe(`${4 * 22 - 5}px`);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('spread 2');
  });

  it('regroups from the price column select', () => {
    const { container } = setup();
    resize(220);
    fireEvent.change(screen.getByRole('combobox', { name: /price grouping/i }), { target: { value: '5' } });
    const prices = rungPrices(container);
    expect(prices).toHaveLength(9);
    expect(prices.every(p => p % 5 === 0)).toBe(true);
    expect(prices).toContain(1000);
  });
});
