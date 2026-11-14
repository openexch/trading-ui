// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BookLevel, Market, OrderBook, UserOrder } from '../../types/market';
import { Ladder } from './Ladder';
import { deadBand, rowsForHeight } from './useLadderWindow';
import type { OwnOrderActions } from './OwnOrderChip';
import type { PassedCommand } from './useLadderKeys';

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
  hold?: boolean;
  onStage?: (side: 'BID' | 'ASK', price: number) => void;
  ownActions?: OwnOrderActions;
  onCommand?: (cmd: PassedCommand) => void;
  onAnnounce?: (text: string) => void;
}

function setup(initial: Props = {}) {
  const state = {
    book: bookAround(1000),
    last: 1000 as number | null,
    open: [] as UserOrder[],
    hold: false,
    onStage: undefined as Props['onStage'],
    ownActions: undefined as Props['ownActions'],
    onCommand: undefined as Props['onCommand'],
    onAnnounce: undefined as Props['onAnnounce'],
    ...initial,
  };
  const el = (p: typeof state) => (
    <Ladder
      market={TEST}
      orderBook={p.book}
      levelChanges={new Map()}
      openOrders={p.open}
      lastPrice={p.last}
      hold={p.hold}
      onStage={p.onStage}
      ownActions={p.ownActions}
      onCommand={p.onCommand}
      onAnnounce={p.onAnnounce}
      sizeText="0.5"
    />
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
    // Focus handed from the grid to its tab-stop cell; blur that.
    expect(grid.contains(document.activeElement)).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
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
    expect(screen.getByRole('gridcell', { name: /^sell 0.5 tst at 1,004, depth unknown$/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 996, depth unknown$/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /^sell 0.5 tst at 1,002, 1.20000000 on book$/i })).toBeTruthy();
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

// ---- first centre ---------------------------------------------------------------

describe('Ladder first centre', () => {
  it('settles on the first two-sided book even with the pointer resting on the ladder', () => {
    // Load: a stale last price and a one-sided first update arrive first,
    // and the pointer already rests over the ladder.
    const asksOnly: OrderBook = { bids: [], asks: bookAround(1040).asks, lastUpdate: 1 };
    const { container, update, region } = setup({ book: asksOnly, last: 1050 });
    resize(220);
    fireEvent.pointerEnter(region);
    // Provisional: follows the only value it has.
    expect(middle(container)).toBe(1050);
    update({ last: 1049 });
    expect(middle(container)).toBe(1049);

    // The real book arrives: the window takes the middle of the touch,
    // not the value computed before data, although the pointer pins.
    update({ book: bookAround(1000), last: 1049 });
    expect(middle(container)).toBe(1000);
    const prices = rungPrices(container);
    // Asks above, bids below, balanced around the spread line.
    expect(prices.filter(p => p > 1000)).toHaveLength(4);
    expect(prices.filter(p => p < 1000)).toHaveLength(4);

    // From here on the normal rules apply: pinned while hovered.
    update({ book: bookAround(1030), last: 1030 });
    expect(middle(container)).toBe(1000);
  });

  it('the first paint of a two-sided book is centred, whatever the row count arrives as', () => {
    const { container } = setup({ book: bookAround(2000), last: null });
    resize(500);
    expect(middle(container)).toBe(2000);
  });

  it('a reconnect (empty book) settles again on the next two-sided book', () => {
    const { container, update, region } = setup();
    resize(220);
    fireEvent.pointerEnter(region);
    update({ book: { bids: [], asks: [], lastUpdate: 2 }, last: null });
    update({ book: bookAround(1100), last: null });
    expect(middle(container)).toBe(1100);
  });
});

// ---- staging -----------------------------------------------------------------

describe('Ladder staging clicks', () => {
  it('a bid cell stages a buy and an ask cell a sell at the rung price, on either side of the spread', () => {
    const onStage = vi.fn();
    setup({ onStage });
    resize(220);
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 998, 1.20000000 on book$/i }));
    expect(onStage).toHaveBeenLastCalledWith('BID', 998);
    fireEvent.click(screen.getByRole('gridcell', { name: /^sell 0.5 tst at 1,003/i }));
    expect(onStage).toHaveBeenLastCalledWith('ASK', 1003);
    // A buy above the best ask is offered too (the strip warns it crosses).
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 1,003$/i }));
    expect(onStage).toHaveBeenLastCalledWith('BID', 1003);
  });

  it('a grouped rung stages at the rung price', () => {
    const onStage = vi.fn();
    setup({ onStage });
    resize(220);
    fireEvent.change(screen.getByRole('combobox', { name: /price grouping/i }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 995/i }));
    expect(onStage).toHaveBeenLastCalledWith('BID', 995);
  });

  it('cells are out of the tab order: the grid stays one tab stop', () => {
    const { container } = setup();
    resize(220);
    const cells = container.querySelectorAll<HTMLElement>('button[role="gridcell"]');
    expect(cells.length).toBe(18);
    for (const c of cells) expect(c.tabIndex).toBe(-1);
  });

  it('holds the window while an order is staged', () => {
    const { container, update } = setup({ hold: true });
    resize(220);
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).toBe(1000);
    update({ hold: false });
    expect(middle(container)).toBe(1050);
  });
});

// ---- keyboard -------------------------------------------------------------------

/** The rung price of the element that has focus, or null. */
function focusedPrice(): number | null {
  const el = document.activeElement as HTMLElement | null;
  const row = el?.closest<HTMLElement>('[data-rung-price]');
  return row ? Number(row.dataset.rungPrice) : null;
}

/** Elements Tab would stop on: `root` and everything inside it. */
function tabStops(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href],button,input,select,textarea,[tabindex]';
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>(sel))].filter(
    el => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
  );
}

function focusLadder() {
  const grid = screen.getByRole('grid');
  const stop = grid.querySelector<HTMLElement>('[tabindex="0"]')!;
  act(() => stop.focus());
  return grid;
}

function actions(over: Partial<OwnOrderActions> = {}): OwnOrderActions {
  return {
    market: TEST,
    pending: new Map(),
    onCancel: vi.fn(),
    onMove: vi.fn(),
    onOverlay: vi.fn(),
    ...over,
  };
}

describe('Ladder keyboard', () => {
  it('the grid is exactly one tab stop: the centre rung, and the grid itself before rows exist', () => {
    const { container, update } = setup({ book: { bids: [], asks: [], lastUpdate: 0 }, last: null });
    resize(220);
    const grid = screen.getByRole('grid');
    expect(tabStops(grid)).toEqual([grid]);
    update({ book: bookAround(1000), last: 1000 });
    const stops = tabStops(grid);
    expect(stops).toHaveLength(1);
    expect(stops[0].closest<HTMLElement>('[data-rung-price]')!.dataset.rungPrice).toBe('1000');
    expect(stops[0].getAttribute('aria-label')).toBe('1,000, last trade, bids none, asks none');
    // The grouping select is outside the grid: its own stop.
    expect(grid.contains(screen.getByRole('combobox', { name: /price grouping/i }))).toBe(false);
    void container;
  });

  it('arrows move one rung, Shift ten; past the edge the window follows and holds', () => {
    const { container } = setup();
    resize(220); // 1004..996
    const grid = focusLadder();
    expect(focusedPrice()).toBe(1000);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(focusedPrice()).toBe(1001);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focusedPrice()).toBe(999);
    expect(middle(container)).toBe(1000); // inside the window: no move
    // Still one tab stop, now on the focused rung.
    expect(tabStops(grid)).toEqual([document.activeElement]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', shiftKey: true });
    expect(focusedPrice()).toBe(1009);
    expect(rungPrices(container)[0]).toBe(1009); // the window followed, focus at its top edge
    expect(screen.getByRole('button', { name: /re-centre/i })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
    expect(focusedPrice()).toBe(999);
  });

  it('focus follows the price across live updates, and a focused ladder does not re-centre', () => {
    const { container, update } = setup();
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    const el = document.activeElement;
    update({ book: bookAround(1001), last: 1001 });
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).toBe(1000);
    expect(document.activeElement).toBe(el);
    expect(focusedPrice()).toBe(999);
  });

  it('C re-centres on the last price and takes focus there', () => {
    const { container, update } = setup();
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', shiftKey: true }); // window held at 1005..
    update({ book: bookAround(1050), last: 1050 });
    expect(middle(container)).not.toBe(1050);
    fireEvent.keyDown(document.activeElement!, { key: 'c' });
    expect(middle(container)).toBe(1050);
    expect(focusedPrice()).toBe(1050);
    expect(screen.queryByRole('button', { name: /re-centre/i })).toBeNull();
  });

  it('B and S stage at the focused rung; the other order keys go to the caller', () => {
    const onStage = vi.fn();
    const onCommand = vi.fn();
    setup({ onStage, onCommand });
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'b' });
    expect(onStage).toHaveBeenLastCalledWith('BID', 999, document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'S' }); // Caps Lock: still a plain S
    expect(onStage).toHaveBeenLastCalledWith('ASK', 999, document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'B', shiftKey: true });
    expect(onCommand).toHaveBeenLastCalledWith({ kind: 'stageMarket', side: 'BID' });
    fireEvent.keyDown(document.activeElement!, { key: '2' });
    expect(onCommand).toHaveBeenLastCalledWith({ kind: 'preset', index: 1 });
    fireEvent.keyDown(document.activeElement!, { key: 'X', ctrlKey: true, shiftKey: true });
    expect(onCommand).toHaveBeenLastCalledWith({ kind: 'cancelAll' });
    expect(onStage).toHaveBeenCalledTimes(2);
  });

  it('ladder keys in the grouping select do nothing', () => {
    const onStage = vi.fn();
    const onCommand = vi.fn();
    setup({ onStage, onCommand });
    resize(220);
    const select = screen.getByRole('combobox', { name: /price grouping/i });
    for (const key of ['b', 's', 't', '1', 'ArrowUp']) fireEvent.keyDown(select, { key });
    expect(onStage).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('[ and ] cycle own orders in ladder order (highest first) and wrap, pinning to orders outside', () => {
    const open = [order('BID', 998, 1), order('ASK', 1003, 1), order('ASK', 1030, 1), order('BID', 990, 1)];
    const onAnnounce = vi.fn();
    const { container } = setup({ open, onAnnounce, ownActions: actions() });
    resize(220); // 1004..996
    focusLadder(); // at 1000
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(998); // first own order at or below the focus
    expect(onAnnounce).toHaveBeenLastCalledWith('Order 3 of 4: Buy 1.00 TST @ 998');
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(990);
    expect(middle(container)).toBe(990); // outside: pinned there
    fireEvent.keyDown(document.activeElement!, { key: ']' }); // wraps to the top
    expect(focusedPrice()).toBe(1030);
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(1003);
    fireEvent.keyDown(document.activeElement!, { key: '[' });
    expect(focusedPrice()).toBe(1030);
    fireEvent.keyDown(document.activeElement!, { key: '[' }); // wraps to the bottom
    expect(focusedPrice()).toBe(990);
  });

  it('Del cancels the focused own order; with two on the rung, [ or ] picks one first', () => {
    const a = order('BID', 998, 1);
    const b = order('BID', 998, 0.5);
    const own = actions();
    const onAnnounce = vi.fn();
    setup({ open: [a, b], ownActions: own, onAnnounce });
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focusedPrice()).toBe(998);
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(own.onCancel).not.toHaveBeenCalled();
    expect(onAnnounce).toHaveBeenLastCalledWith('2 orders of yours at 998: press [ or ] to pick one');
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(own.onCancel).toHaveBeenCalledWith(b);
    // An empty rung says so.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(own.onCancel).toHaveBeenCalledTimes(1);
    expect(onAnnounce).toHaveBeenLastCalledWith('No order of yours at 999');
  });

  it('Alt+Up moves a limit order one group up and focus goes with it; a stop is refused', () => {
    const lim = order('BID', 998, 1);
    const stop = { ...order('ASK', 1002, 1), type: 'STOP_LIMIT' as const };
    const own = actions();
    const onAnnounce = vi.fn();
    setup({ open: [lim, stop], ownActions: own, onAnnounce });
    resize(220);
    fireEvent.change(screen.getByRole('combobox', { name: /price grouping/i }), { target: { value: '5' } });
    focusLadder();
    // x5: rungs are 5 apart. ] lands on the limit (995 rung, price 998).
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(995);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true });
    expect(own.onMove).toHaveBeenCalledWith(lim, 1003);
    expect(focusedPrice()).toBe(1000);

    fireEvent.keyDown(document.activeElement!, { key: '[' }); // the stop at 1002 (ask rung 1005)
    expect(focusedPrice()).toBe(1005);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', altKey: true });
    expect(own.onMove).toHaveBeenCalledTimes(1);
    expect(onAnnounce).toHaveBeenLastCalledWith('Stop limit orders cannot be moved: cancel instead');
  });

  it('own-order keys signed out (no actions) only explain', () => {
    const onAnnounce = vi.fn();
    setup({ open: [order('BID', 998, 1)], onAnnounce });
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(onAnnounce).toHaveBeenLastCalledWith('Sign in to manage your orders');
  });
});
