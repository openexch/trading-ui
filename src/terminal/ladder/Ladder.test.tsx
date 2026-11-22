// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BookLevel, Market, OrderBook, UserOrder } from '../../types/market';
import { Ladder } from './Ladder';
import { PHONE_RUNG_PX, PHONE_SPREAD_ROW_PX, SPREAD_ROW_PX, rowsForHeight } from './useLadderWindow';
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

/** The row right below the spread marker (the best bid's row), or null
 *  when the marker is not in the window. */
function belowMarker(container: HTMLElement): number | null {
  const next = container.querySelector('[data-spread-row]')?.nextElementSibling as HTMLElement | null | undefined;
  return next?.dataset.rungPrice ? Number(next.dataset.rungPrice) : null;
}

/** Slots (rows and empty padding) above and below the spread marker. */
function slotsAround(container: HTMLElement): [number, number] {
  const marker = container.querySelector('[data-spread-row]')!;
  const kids = Array.from(marker.parentElement!.children) as HTMLElement[];
  const at = kids.indexOf(marker as HTMLElement);
  const slots = (els: HTMLElement[]) =>
    els.reduce((n, el) => n + (el.dataset.ladderPad !== undefined ? parseFloat(el.style.height) / 22 : 1), 0);
  return [slots(kids.slice(0, at)), slots(kids.slice(at + 1))];
}

const top = (container: HTMLElement) => rungPrices(container)[0];

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

describe('rowsForHeight', () => {
  it('fits whole 22px rungs and keeps the count even (as many slots above the marker as below)', () => {
    expect(rowsForHeight(0)).toBe(0);
    expect(rowsForHeight(21)).toBe(0);
    expect(rowsForHeight(22)).toBe(0);
    expect(rowsForHeight(44)).toBe(2);
    expect(rowsForHeight(66)).toBe(2);
    expect(rowsForHeight(220)).toBe(10);
    expect(rowsForHeight(242)).toBe(10); // 11 fit, even -> 10
    expect(rowsForHeight(500)).toBe(22);
  });

  it('sets the spread row aside before counting rungs', () => {
    // 8 rungs + the 12px spread row = 188px: fits in 188, not in 187.
    expect(rowsForHeight(8 * 22 + SPREAD_ROW_PX, 22, SPREAD_ROW_PX)).toBe(8);
    expect(rowsForHeight(8 * 22 + SPREAD_ROW_PX - 1, 22, SPREAD_ROW_PX)).toBe(6);
    expect(rowsForHeight(220, 22, SPREAD_ROW_PX)).toBe(8);
    expect(rowsForHeight(2 * 22 + SPREAD_ROW_PX, 22, SPREAD_ROW_PX)).toBe(2);
    // Phone: 44px rungs and a 20px spread row.
    expect(rowsForHeight(4 * 44 + PHONE_SPREAD_ROW_PX, PHONE_RUNG_PX, PHONE_SPREAD_ROW_PX)).toBe(4);
    expect(rowsForHeight(4 * 44, PHONE_RUNG_PX, PHONE_SPREAD_ROW_PX)).toBe(2);
  });
});

// ---- row count -------------------------------------------------------------

describe('Ladder row count', () => {
  it('renders the even slot count the ResizeObserver reports, at fixed 22px rungs, less the spread row', () => {
    const { container } = setup();
    expect(rungPrices(container)).toHaveLength(0); // not measured yet
    resize(220);
    expect(rungPrices(container)).toHaveLength(8);
    resize(500);
    expect(rungPrices(container)).toHaveLength(20); // 476 / 22 = 21, even: 20
    resize(78); // 54 for rungs after the 24px spread row
    expect(rungPrices(container)).toHaveLength(2);
    // Every rung is the same fixed height class (never shrunk to fit).
    for (const r of container.querySelectorAll('[data-rung-price]')) {
      expect(r.className).toContain('h-[22px]');
    }
  });

  it('centres the spread marker: asks above (best ask nearest), bids below (best bid nearest)', () => {
    const { container } = setup();
    resize(220);
    // The touch is 999 | 1001; 1000 has no level, so it has no row.
    expect(rungPrices(container)).toEqual([1004, 1003, 1002, 1001, 999, 998, 997, 996]);
    expect(belowMarker(container)).toBe(999);
    expect(slotsAround(container)).toEqual([4, 4]);
    // The last trade (1000) is not a book level: it has no row, and it sits
    // in the centred spread row with the spread.
    const pill = container.querySelector('[data-spread-row] [data-last-trade]')!;
    expect(pill.textContent).toContain('1,000');
    expect(container.querySelector('[data-spread-row]')!.textContent).toBe('1,000▲Spread 2');
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('Price ladder, grouped by 1, last 1,000, spread 2');
  });

  it('a sparse book whose last trade is not a level still shows the last price in the centre row', () => {
    const book: OrderBook = {
      bids: [
        { price: 995, quantity: 1, orderCount: 1 },
        { price: 990, quantity: 1, orderCount: 1 },
      ],
      asks: [{ price: 1010, quantity: 1, orderCount: 1 }],
      lastUpdate: 1,
    };
    const { container, update } = setup({ book, last: 1003 });
    resize(220);
    expect(rungPrices(container)).toEqual([1010, 995, 990]);
    expect(slotsAround(container)).toEqual([4, 4]);
    const row = container.querySelector<HTMLElement>('[data-spread-row]')!;
    expect(row.querySelector('[data-last-trade]')!.textContent).toContain('1,003');
    expect(row.querySelector('[data-spread-label]')!.textContent).toBe('Spread 15');
    expect(row.style.height).toBe(`${SPREAD_ROW_PX}px`);
    // A new trade moves the price in the centre and its arrow; nothing else.
    update({ last: 1001 });
    expect(row.querySelector('[data-last-trade]')!.textContent).toContain('1,001');
    expect(row.querySelector('[data-last-dir]')!.className).toContain('text-sell');
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('last 1,001, down');
    expect(slotsAround(container)).toEqual([4, 4]);
  });

  it('a level at the last price is a plain row: the price shows once, in the centre row', () => {
    const book = bookAround(1000);
    book.bids.unshift({ price: 1000, quantity: 1, orderCount: 1 });
    const { container } = setup({ book });
    resize(220);
    expect(belowMarker(container)).toBe(1000);
    expect(container.querySelectorAll('[data-last-trade]')).toHaveLength(1);
    expect(container.querySelector('[data-rung-price="1000"] [data-last-trade]')).toBeNull();
  });

  it('before any trade the centre row shows only the spread', () => {
    const { container } = setup({ last: null });
    resize(220);
    expect(container.querySelector('[data-last-trade]')).toBeNull();
    expect(container.querySelector('[data-spread-row]')!.textContent).toBe('Spread 2');
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('Price ladder, grouped by 1, spread 2');
  });

  it('shows skeleton rungs while the book is empty (market switch)', () => {
    const { container } = setup({ book: { bids: [], asks: [], lastUpdate: 0 }, last: null });
    resize(220);
    expect(container.querySelectorAll('[data-skeleton-rung]')).toHaveLength(8);
    expect(rungPrices(container)).toHaveLength(0);
  });
});

// ---- centring and pinning (DESIGN.md rule 8) ----------------------------------

describe('Ladder centring', () => {
  it('keeps the spread marker in the middle on every move, with the pointer over the ladder', () => {
    const { container, update, region } = setup();
    resize(220);
    fireEvent.pointerEnter(region);
    fireEvent.pointerMove(region);
    for (const p of [1001, 1002, 999, 1050, 1049]) {
      update({ book: bookAround(p), last: p });
      expect(belowMarker(container)).toBe(p - 1);
      expect(slotsAround(container)).toEqual([4, 4]);
    }
    expect(region.dataset.pinned).toBe('false');
    expect(screen.queryByRole('button', { name: /re-centre/i })).toBeNull();
  });

  it('re-centres while the ladder has focus', () => {
    const { container, update, region } = setup();
    resize(220);
    const grid = screen.getByRole('grid');
    act(() => grid.focus());
    update({ book: bookAround(1050), last: 1050 });
    expect(belowMarker(container)).toBe(1049);
    expect(region.dataset.pinned).toBe('false');
    expect(grid.contains(document.activeElement)).toBe(true);
  });

  it('a hold (staged order, one-click armed, open menu) pins on its prices; its end re-centres', () => {
    const { container, update, region } = setup();
    resize(220);
    update({ hold: true });
    // The book moves up three ticks: the window keeps its top price.
    update({ book: bookAround(1003), last: 1003 });
    expect(top(container)).toBe(1004);
    expect(rungPrices(container)).toEqual([1004, 1002, 1001, 1000, 999, 998, 997, 996]);
    expect(region.dataset.pinned).toBe('true');
    // Not centred: Re-centre is offered even while held.
    expect(screen.getByRole('button', { name: /re-centre/i })).toBeTruthy();
    update({ hold: false });
    expect(belowMarker(container)).toBe(1002);
    expect(region.dataset.pinned).toBe('false');
    expect(screen.queryByRole('button', { name: /re-centre/i })).toBeNull();
  });

  it('Re-centre during a hold centres once; the hold keeps it there', () => {
    const { container, update } = setup({ hold: true });
    resize(220);
    update({ book: bookAround(1050), last: 1050 });
    fireEvent.click(screen.getByRole('button', { name: /re-centre/i }));
    expect(belowMarker(container)).toBe(1049);
    expect(top(container)).toBe(1054);
    update({ book: bookAround(1060), last: 1060 });
    expect(top(container)).toBe(1054);
  });

  it('wheel moves the window by levels and holds it until Re-centre or C', () => {
    const { container, update, region } = setup();
    resize(220);
    fireEvent.wheel(region, { deltaY: 66 }); // three levels down
    expect(top(container)).toBe(1001);
    fireEvent.wheel(region, { deltaY: -22 });
    expect(top(container)).toBe(1002);
    expect(region.dataset.pinned).toBe('true');
    update({ book: bookAround(1003), last: 1003 });
    expect(top(container)).toBe(1002); // held

    fireEvent.click(screen.getByRole('button', { name: /re-centre/i }));
    expect(belowMarker(container)).toBe(1002);
    expect(screen.queryByRole('button', { name: /re-centre/i })).toBeNull();

    fireEvent.wheel(region, { deltaY: 22 });
    expect(slotsAround(container)).toEqual([3, 5]); // the marker moved up a row
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'c' });
    expect(slotsAround(container)).toEqual([4, 4]);
    update({ book: bookAround(1005), last: 1005 });
    expect(belowMarker(container)).toBe(1004); // following again
  });

  it('a scroll pin ends with the hold it was made under', () => {
    const { container, update, region } = setup({ hold: true });
    resize(220);
    fireEvent.wheel(region, { deltaY: 88 });
    expect(top(container)).toBe(999);
    update({ book: bookAround(1003), last: 1003 });
    expect(top(container)).toBe(999);
    update({ hold: false });
    expect(belowMarker(container)).toBe(1002);
  });

  it('PageDown and PageUp scroll a page of levels and hold', () => {
    const { container, update } = setup();
    resize(220); // 8 slots: a page is 7 levels
    const grid = focusLadder();
    expect(focusedPrice()).toBe(999);
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    expect(top(container)).toBe(996);
    expect(focusedPrice()).toBe(992);
    update({ book: bookAround(1003), last: 1003 });
    expect(top(container)).toBe(996);
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    expect(top(container)).toBe(1011);
    expect(grid.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /re-centre/i }));
    expect(belowMarker(container)).toBe(1002);
  });

  it('C typed into the grouping select does not re-centre', () => {
    const { container, region } = setup();
    resize(220);
    fireEvent.wheel(region, { deltaY: 44 });
    expect(top(container)).toBe(1002);
    fireEvent.keyDown(screen.getByRole('combobox', { name: /price grouping/i }), { key: 'c' });
    expect(top(container)).toBe(1002);
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
    const { container } = setup({ open, book: bookAround(1000, 40) });
    resize(220); // rows 1004..1001 | 999..996

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
    expect(rungPrices(container)).toContain(1010);
    expect(screen.getByRole('img', { name: /your sell order at 1,010/i })).toBeTruthy();
    // Held there: a re-centre control appears, and the bids are now below.
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

// ---- depth and the spread marker ---------------------------------------------

describe('Ladder depth', () => {
  it('a sparse book draws only its levels: no gap, unknown or filler rows', () => {
    const book: OrderBook = {
      bids: [
        { price: 999, quantity: 1, orderCount: 1 },
        { price: 995, quantity: 2, orderCount: 1 },
        { price: 990, quantity: 3, orderCount: 1 },
      ],
      asks: [
        { price: 1001, quantity: 1, orderCount: 1 },
        { price: 1007, quantity: 2, orderCount: 1 },
      ],
      lastUpdate: 1,
    };
    const { container } = setup({ book });
    resize(220); // 8 slots, 5 levels
    expect(rungPrices(container)).toEqual([1007, 1001, 999, 995, 990]);
    expect(container.querySelector('[data-unknown]')).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /at 1,000\b/i })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /at 1,004\b/i })).toBeNull();
    // The marker stays in the middle: the missing slots are empty space.
    expect(belowMarker(container)).toBe(999);
    expect(slotsAround(container)).toEqual([4, 4]);
    const pads = Array.from(container.querySelectorAll<HTMLElement>('[data-ladder-pad]'));
    expect(pads.map(p => p.style.height)).toEqual(['44px', '22px']);
    for (const p of pads) {
      expect(p.getAttribute('aria-hidden')).toBe('true');
      expect(p.getAttribute('role')).toBeNull();
    }
    // Every row carries a level on one side; the other side is empty.
    expect(screen.getByRole('gridcell', { name: /^sell 0.5 tst at 1,007, 2.00000000 on book, 3.00000000 cumulative$/i })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 990, 3.00000000 on book, 6.00000000 cumulative$/i })).toBeTruthy();
  });

  it('prints the level quantity by the price and the cumulative on the outer side', () => {
    const { container } = setup({ book: bookAround(1000, 3) });
    resize(220);
    const ask = container.querySelector('[data-rung-price="1003"]')!.querySelectorAll('button[role="gridcell"]')[1];
    // Ask cell: quantity first (next to the price), cumulative after it.
    const askSpans = Array.from(ask.querySelectorAll('[data-qty],[data-cum]')).map(e => e.textContent);
    expect(askSpans).toEqual(['1.30000000', '3.60000000']);
    const bid = container.querySelector('[data-rung-price="997"]')!.querySelectorAll('button[role="gridcell"]')[0];
    // Bid cell: cumulative first (outer side), quantity next to the price.
    const bidSpans = Array.from(bid.querySelectorAll('[data-cum],[data-qty]')).map(e => e.textContent);
    expect(bidSpans).toEqual(['3.60000000', '1.30000000']);
  });

  it('cumulative bars share one scale: the largest cumulative in the window', () => {
    const book: OrderBook = {
      bids: [
        { price: 999, quantity: 1, orderCount: 1 },
        { price: 998, quantity: 3, orderCount: 1 },
      ],
      asks: [
        { price: 1001, quantity: 2, orderCount: 1 },
        { price: 1003, quantity: 6, orderCount: 1 },
      ],
      lastUpdate: 1,
    };
    const { container } = setup({ book });
    resize(220); // 1003, 1001 | 999, 998; ask cum 2, 8; bid cum 1, 4; scale 8
    expect(rungPrices(container)).toEqual([1003, 1001, 999, 998]);
    const width = (price: number, i: 0 | 1) =>
      container
        .querySelector(`[data-rung-price="${price}"]`)!
        .querySelectorAll('button[role="gridcell"]')
        [i].querySelector<HTMLElement>('[data-depth-bar]')?.style.width ?? null;
    expect(width(1001, 1)).toBe('25%');
    expect(width(1003, 1)).toBe('100%');
    expect(width(999, 0)).toBe('12.5%');
    expect(width(998, 0)).toBe('50%');
    expect(width(1001, 0)).toBeNull(); // the bid side of an ask row: none
  });

  it('draws the own slice from the price edge at own / the bar scale', () => {
    const book: OrderBook = {
      bids: [{ price: 999, quantity: 2, orderCount: 1 }],
      asks: [{ price: 1001, quantity: 8, orderCount: 1 }],
      lastUpdate: 1,
    };
    const { container } = setup({ book, open: [order('BID', 999, 1)] });
    resize(220);
    const slice = container.querySelector<HTMLElement>('[data-rung-price="999"] [data-own-slice]')!;
    expect(slice.style.width).toBe('12.5%');
    expect(slice.style.right).toBe('0px');
  });

  it('keeps every number on a bar in an AA colour (tokens.test.ts measures the pairs)', () => {
    const book: OrderBook = {
      bids: [{ price: 999, quantity: 2, orderCount: 1 }],
      asks: [{ price: 1001, quantity: 8, orderCount: 1 }],
      lastUpdate: 1,
    };
    const { container } = setup({ book, open: [order('BID', 999, 2)] });
    resize(220);
    const cells = (p: number) => container.querySelector(`[data-rung-price="${p}"]`)!.querySelectorAll('button[role="gridcell"]');
    const ask = cells(1001)[1];
    expect(ask.querySelector('[data-qty]')!.className).not.toMatch(/text-(muted|buy|sell)\b/);
    expect(ask.querySelector('[data-cum]')!.className).toContain('text-text');
    expect(ask.querySelector('[data-cum]')!.className).not.toContain('text-muted');
    // The hover preview sits on the bar: --text-strong, never a side colour.
    const preview = ask.querySelector('[data-stage-preview]')!;
    expect(preview.className).toContain('text-text-strong');
    expect(preview.className).not.toMatch(/text-(buy|sell)\b/);
    // A cell with an own slice prints its cumulative in --text-strong.
    expect(cells(999)[0].querySelector('[data-cum]')!.className).toContain('text-text-strong');
  });

  it('prints the big figure quiet: the prefix every visible rung shares, once per window', () => {
    const { container } = setup({ book: bookAround(5050), last: 5050 });
    resize(220); // 5046 .. 5054 without 5050: "5,04x" / "5,05x"
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-rung-price]'));
    expect(rows.length).toBe(8);
    for (const row of rows) {
      const price = row.querySelector<HTMLElement>('[data-price]')!;
      const quiet = price.querySelector<HTMLElement>('[data-big-figure]')!;
      // One prefix for the whole window, in --muted (AA on the price column,
      // tokens.test.ts); the tail keeps the side tone.
      expect(quiet.textContent).toBe('5,0');
      expect(quiet.className).toContain('text-muted');
      expect(price.className).toMatch(/text-(buy|sell)\b/);
      // The same total string as an unsplit price.
      const text = Number(row.dataset.rungPrice).toLocaleString('en-US');
      expect(price.textContent).toBe(text);
      // Screen readers get the whole number from the cell's label; the
      // visual split is hidden from them.
      expect(price.getAttribute('aria-hidden')).toBe('true');
      const cell = row.querySelector<HTMLElement>('[data-focus-cell]')!;
      expect(cell.getAttribute('aria-label')!.startsWith(`${text},`)).toBe(true);
    }
  });

  it('prints no big figure when the window crosses a decade boundary', () => {
    const { container } = setup();
    resize(220); // 996 .. 1,004
    expect(container.querySelector('[data-big-figure]')).toBeNull();
    // The last price in the spread row is never split.
    expect(container.querySelector('[data-last-trade] [data-big-figure]')).toBeNull();
  });

  it('gives the spread its own row between the best ask and the best bid rows', () => {
    const { container } = setup();
    resize(220);
    const row = container.querySelector<HTMLElement>('[data-spread-row]')!;
    expect(row).toBeTruthy();
    // Two ticks between the touch, though no row stands for 1000.
    expect(row.querySelector('[data-spread-label]')!.textContent).toBe('Spread 2');
    expect(row.style.height).toBe(`${SPREAD_ROW_PX}px`);
    // A sibling of the rungs, never inside or on top of one.
    expect(row.closest('[data-rung-price]')).toBeNull();
    expect(row.className).not.toContain('absolute');
    const prev = row.previousElementSibling as HTMLElement;
    const next = row.nextElementSibling as HTMLElement;
    expect(Number(prev.dataset.rungPrice)).toBe(1001);
    expect(Number(next.dataset.rungPrice)).toBe(999);
    // Rungs plus the spread row fit the measured height: nothing overflows.
    expect(rungPrices(container).length * 22 + SPREAD_ROW_PX).toBeLessThanOrEqual(220);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('spread 2');
  });

  it('a one-tick spread puts the row straight between the two touch rungs', () => {
    const book: OrderBook = {
      bids: [{ price: 1000, quantity: 1, orderCount: 1 }],
      asks: [{ price: 1001, quantity: 1, orderCount: 1 }],
      lastUpdate: 1,
    };
    const { container } = setup({ book, last: 1000 });
    resize(220);
    const row = container.querySelector<HTMLElement>('[data-spread-row]')!;
    expect((row.previousElementSibling as HTMLElement).dataset.rungPrice).toBe('1001');
    expect((row.nextElementSibling as HTMLElement).dataset.rungPrice).toBe('1000');
    expect(row.querySelector('[data-spread-label]')!.textContent).toBe('Spread 1');
  });

  it('regroups from the price column select: only buckets with a level', () => {
    const { container } = setup();
    resize(220);
    fireEvent.change(screen.getByRole('combobox', { name: /price grouping/i }), { target: { value: '5' } });
    const prices = rungPrices(container);
    expect(prices).toEqual([1020, 1015, 1010, 1005, 995, 990, 985, 980]);
    expect(belowMarker(container)).toBe(995);
  });
});

// ---- first centre ---------------------------------------------------------------

describe('Ladder first centre', () => {
  it('before the first trade, the marker is the middle all the same', () => {
    const { container } = setup({ book: bookAround(2000), last: null });
    resize(500);
    expect(belowMarker(container)).toBe(1999);
    expect(slotsAround(container)).toEqual([10, 10]);
  });

  it('a one-sided book keeps the marker in the middle, the other half empty', () => {
    const asksOnly: OrderBook = { bids: [], asks: bookAround(1040).asks, lastUpdate: 1 };
    const { container, update } = setup({ book: asksOnly, last: null });
    resize(220);
    expect(rungPrices(container)).toEqual([1044, 1043, 1042, 1041]);
    expect(slotsAround(container)).toEqual([4, 4]);
    expect(container.querySelector('[data-spread-label]')!.textContent).toBe('No bids');
    update({ book: bookAround(1000), last: null });
    expect(belowMarker(container)).toBe(999);
  });

  it('a trade alone does not move the window; a reconnect centres again', () => {
    const { container, update } = setup({ book: bookAround(1000), last: null });
    resize(220);
    update({ last: 1003 });
    expect(belowMarker(container)).toBe(999);
    update({ book: { bids: [], asks: [], lastUpdate: 2 }, last: null });
    update({ book: bookAround(1100), last: null });
    expect(belowMarker(container)).toBe(1099);
  });
});

// ---- staging -----------------------------------------------------------------

describe('Ladder staging clicks', () => {
  it('a bid cell stages a buy and an ask cell a sell at the rung price, on either side of the spread', () => {
    const onStage = vi.fn();
    setup({ onStage });
    resize(220);
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.5 tst at 998, 1.20000000 on book, 2.30000000 cumulative$/i }));
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
    expect(cells.length).toBe(16);
    for (const c of cells) expect(c.tabIndex).toBe(-1);
  });

  it('holds the window while an order is staged', () => {
    const { container, update } = setup({ hold: true });
    resize(220);
    update({ book: bookAround(1003), last: 1003 });
    expect(top(container)).toBe(1004);
    update({ hold: false });
    expect(belowMarker(container)).toBe(1002);
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
  it('the grid is exactly one tab stop: the best bid row, and the grid itself before rows exist', () => {
    const { container, update } = setup({ book: { bids: [], asks: [], lastUpdate: 0 }, last: null });
    resize(220);
    const grid = screen.getByRole('grid');
    expect(tabStops(grid)).toEqual([grid]);
    update({ book: bookAround(1000), last: 1000 });
    const stops = tabStops(grid);
    expect(stops).toHaveLength(1);
    expect(stops[0].closest<HTMLElement>('[data-rung-price]')!.dataset.rungPrice).toBe('999');
    expect(stops[0].getAttribute('aria-label')).toBe('999, bids 1.10000000, asks none');
    // The grouping select is outside the grid: its own stop.
    expect(grid.contains(screen.getByRole('combobox', { name: /price grouping/i }))).toBe(false);
    void container;
  });

  it('arrows move one level (never onto a price without one), Shift ten; past the edge the window follows and holds', () => {
    const { container } = setup();
    resize(220); // 1004..1001 | 999..996
    const grid = focusLadder();
    expect(focusedPrice()).toBe(999);
    // 1000 has no level: up from the best bid is the best ask.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(focusedPrice()).toBe(1001);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focusedPrice()).toBe(998);
    expect(belowMarker(container)).toBe(999); // inside the window: no move
    // Still one tab stop, now on the focused rung.
    expect(tabStops(grid)).toEqual([document.activeElement]);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', shiftKey: true });
    expect(focusedPrice()).toBe(1009);
    expect(top(container)).toBe(1009); // the window followed, focus at its top edge
    expect(screen.getByRole('button', { name: /re-centre/i })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', shiftKey: true });
    expect(focusedPrice()).toBe(998);
  });

  it('focus follows the price, not the row, when the ladder re-centres under it', () => {
    const { container, update } = setup();
    resize(220); // 1004..1001 | 999..996
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    const el = document.activeElement;
    expect(focusedPrice()).toBe(998);
    // Re-centred around 1002 (1006..1003 | 1001..998): 998 is still visible, on another row.
    update({ book: bookAround(1002), last: 1002 });
    expect(belowMarker(container)).toBe(1001);
    expect(document.activeElement).toBe(el);
    expect(focusedPrice()).toBe(998);
    // Re-centred around 1050 (1054..1051 | 1049..1046): 998 left; the nearest visible price.
    update({ book: bookAround(1050), last: 1050 });
    expect(belowMarker(container)).toBe(1049);
    expect(focusedPrice()).toBe(1046);
    expect(screen.getByRole('grid').contains(document.activeElement)).toBe(true);
    // Re-centred far below (904..896): the nearest visible price is the top row.
    update({ book: bookAround(900), last: 900 });
    expect(focusedPrice()).toBe(904);
    // Keys continue from the new focus.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focusedPrice()).toBe(903);
  });

  it('C re-centres and takes focus next to the marker (the best bid; the last trade has no level here)', () => {
    const { container, update } = setup();
    resize(220);
    focusLadder();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', shiftKey: true }); // window held at 1009..
    update({ book: bookAround(1050), last: 1050 });
    expect(belowMarker(container)).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'c' });
    expect(belowMarker(container)).toBe(1049);
    expect(focusedPrice()).toBe(1049);
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
    expect(onStage).toHaveBeenLastCalledWith('BID', 998, document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'S' }); // Caps Lock: still a plain S
    expect(onStage).toHaveBeenLastCalledWith('ASK', 998, document.activeElement);
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
    // Own orders rest at book levels: a 40-level book carries them all.
    const { container } = setup({ open, onAnnounce, ownActions: actions(), book: bookAround(1000, 40) });
    resize(220); // 1004..1001 | 999..996
    focusLadder(); // at 999
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(998); // first own order at or below the focus
    expect(onAnnounce).toHaveBeenLastCalledWith('Order 3 of 4: Buy 1.00 TST @ 998');
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(990);
    expect(rungPrices(container)).toContain(990); // outside: pinned there
    expect(belowMarker(container)).toBeNull();
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
    // x5: rows are the buckets with a level. ] lands on the limit (995 rung, price 998).
    fireEvent.keyDown(document.activeElement!, { key: ']' });
    expect(focusedPrice()).toBe(995);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp', altKey: true });
    expect(own.onMove).toHaveBeenCalledWith(lim, 1003);
    // Focus goes with the order to the 1000 bucket, which has no level until
    // the book shows the moved order: the nearest row holds the tab stop.
    expect(focusedPrice()).toBe(1005);

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

describe('Ladder keyboard focus across an extra render', () => {
  // A key that moves focus must land even when another render of the
  // ladder commits between the key and the render that carries the new
  // focus (a parent re-render whose effects have not run yet when the key
  // arrives). Here the key is dispatched from a layout effect of such a
  // render, so the ladder's passive effect for it is still pending.
  it('an arrow key pressed while another render is committing still moves focus', () => {
    const book = bookAround(1000);
    const open: UserOrder[] = [];
    const levelChanges = new Map();
    let bump = () => {};
    let onCommit: (() => void) | null = null;
    function Probe({ tick }: { tick: number }) {
      useLayoutEffect(() => {
        const f = onCommit;
        onCommit = null;
        f?.();
      }, [tick]);
      return null;
    }
    function Harness() {
      const [tick, setTick] = useState(0);
      bump = () => setTick(t => t + 1);
      return (
        <>
          <Ladder market={TEST} orderBook={book} levelChanges={levelChanges} openOrders={open} lastPrice={1000} />
          <Probe tick={tick} />
        </>
      );
    }
    render(<Harness />);
    resize(220);
    focusLadder();
    expect(focusedPrice()).toBe(999);
    act(() => {
      onCommit = () =>
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      bump();
    });
    expect(focusedPrice()).toBe(1001);
  });
});
