// SPDX-License-Identifier: Apache-2.0
/**
 * Which book levels the ladder shows, and when that set is allowed to move.
 *
 * - Row count: fixed-height rungs, as many as fit in the measured element
 *   after the spread row's height is set aside, always even so the spread
 *   marker sits in the middle with as many slots above as below. The element
 *   is held in state (not a ref) so the effect cleanup disconnects the
 *   observer it created (DESIGN.md rule 1).
 * - Rows are book levels only (ladderModel `levels`); the window is an index
 *   range over them. Centred (DESIGN.md rule 8): the spread marker is the
 *   middle, the ask levels above it and the bid levels below, re-centred on
 *   every change, whether or not the pointer is over the ladder or it has
 *   focus.
 * - Pinned: the window stays where it is only while the caller holds it
 *   (one-click armed, an order staged, a menu or popover open) or after an
 *   explicit scroll (the wheel, a finger drag, PageUp / PageDown, a jump
 *   marker). A pinned window is kept as a price (a level shown in a given
 *   slot), so it stays on its prices while levels come and go. An explicit
 *   scroll holds until `recentre()` (the Re-centre button, C or Esc) or
 *   until the caller's hold ends; when the hold ends the window re-centres.
 * - Scrolling moves by levels. The ladder never scrolls as a container: the
 *   wheel moves a virtual offset. With `touchDrag` (the phone), a vertical
 *   finger drag moves it the same way and holds it like a wheel; the tap
 *   that ends a drag stages nothing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { levelIndex, startBounds, windowStart } from './ladderModel';
import type { LadderModel, WindowPos } from './ladderModel';

/** Desktop rung height. */
export const RUNG_PX = 22;

/** Phone rung height: a whole rung is a 44px touch target. */
export const PHONE_RUNG_PX = 44;

/** Desktop spread row: its own row between the best ask and the best bid,
 *  carrying the last-trade pill (13px on an 18px line, 1px padding) next to
 *  the 10px spread label. */
export const SPREAD_ROW_PX = 24;

/** Phone spread row: the 14px last-trade pill and the 11px label. */
export const PHONE_SPREAD_ROW_PX = 32;

/** How far a finger travels before a touch counts as a drag, not a tap. */
export const DRAG_SLOP_PX = 8;

/** Rungs that fit in `height` once `reservePx` (the spread row) is set
 *  aside, rounded down to an even count (as many above the marker as below). */
export function rowsForHeight(height: number, rungPx: number = RUNG_PX, reservePx = 0): number {
  if (!(height > 0) || !(rungPx > 0)) return 0;
  const n = Math.floor((height - Math.max(0, reservePx)) / rungPx);
  if (n <= 0) return 0;
  return n % 2 === 0 ? n : n - 1;
}

type Levels = Pick<LadderModel, 'levels' | 'split'>;

export interface LadderWindowOptions {
  /** The book levels (highest first) and where the spread marker splits
   *  them. */
  model: Levels;
  /** Changing this starts over: centred, pins dropped. The market id. */
  resetKey: string | number;
  /** Grouping in ticks. A change converts a held position to the new rung
   *  units so a pinned price stays in view. */
  groupTicks: number;
  /** Pin reasons owned by the caller (one-click armed, an order staged, a
   *  menu or popover open). Its end re-centres the window. */
  hold?: boolean;
  rungPx?: number;
  /** Height set aside for the spread row before rungs are counted. */
  reservePx?: number;
  /** A vertical touch drag moves the window (the phone). */
  touchDrag?: boolean;
}

export interface LadderWindowState {
  rowCount: number;
  /** The held position; null while the window is centred. */
  pos: WindowPos | null;
  /** True while anything pins the window (the caller's hold or a scroll). */
  pinned: boolean;
  /** True after an explicit scroll (wheel, drag, page keys, jump), until
   *  `recentre()` or the end of the caller's hold. */
  held: boolean;
  /** Attach to the element whose height sets the row count. */
  measureRef: (el: HTMLElement | null) => void;
  /** Attach to the region whose wheel (and finger drag) scrolls the window. */
  regionRef: (el: HTMLElement | null) => void;
  /** Drop the scroll pin and centre now. */
  recentre: () => void;
  /** Show a rung in the middle slot and hold it there (jump markers, a
   *  revealed order). */
  pinTo: (rung: number) => void;
  /** Move the window by `levels` (positive: lower prices) and hold it. */
  scrollBy: (levels: number) => void;
}

interface PosState {
  key: string | number;
  group: number;
  pos: WindowPos | null;
  held: boolean;
  /** The caller's hold as of the last render, to see it end. */
  hold: boolean;
}

/** The current window as a held position: the first level it shows, in its
 *  slot. Null when it shows no level. */
function capture(model: Levels, pos: WindowPos | null, count: number): WindowPos | null {
  const start = windowStart(model, pos, count);
  const first = Math.max(0, start);
  if (count <= 0 || first >= model.levels.length || first >= start + count) return null;
  return { rung: model.levels[first], slot: first - start };
}

/** `pos` moved by `levels` (positive: lower prices), clamped to the bounds,
 *  and re-anchored on the first level the moved window shows (so the top
 *  row is what stays put while the book changes). */
function shift(model: Levels, pos: WindowPos, count: number, levels: number): WindowPos {
  const L = model.levels.length;
  if (L === 0) return pos;
  const idx = levelIndex(model, pos.rung);
  const { lo, hi } = startBounds(model, count);
  const start = Math.min(hi, Math.max(lo, idx - pos.slot + levels));
  const first = Math.min(L - 1, Math.max(0, start));
  return { rung: model.levels[first], slot: first - start };
}

export function useLadderWindow(opts: LadderWindowOptions): LadderWindowState {
  const {
    model,
    resetKey,
    groupTicks,
    hold = false,
    rungPx = RUNG_PX,
    reservePx = 0,
    touchDrag = false,
  } = opts;

  const [measureEl, setMeasureEl] = useState<HTMLElement | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [s, setS] = useState<PosState>(() => ({
    key: resetKey,
    group: groupTicks,
    pos: null,
    held: false,
    hold,
  }));

  // Row count from the rendered element.
  useLayoutEffect(() => {
    if (!measureEl) return;
    const h0 = measureEl.getBoundingClientRect().height;
    if (h0 > 0) setRowCount(rowsForHeight(h0, rungPx, reservePx));
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h <= 0) return; // hidden or unpainted: keep the last count
      setRowCount(rowsForHeight(h, rungPx, reservePx));
    });
    ro.observe(measureEl);
    return () => ro.disconnect();
  }, [measureEl, rungPx, reservePx]);

  // Latest values for the native listeners and the callbacks.
  const live = useRef({ model, rowCount });
  useEffect(() => {
    live.current = { model, rowCount };
  }, [model, rowCount]);

  /** Move by `levels` from wherever the window is now, and hold. */
  const move = useCallback((levels: number) => {
    setS(prev => {
      const { model: m, rowCount: n } = live.current;
      const from = prev.pos ?? capture(m, null, n);
      if (from === null) return prev;
      return { ...prev, pos: shift(m, from, n, levels), held: true };
    });
  }, []);

  // Wheel (and finger drag) on the region. Native listeners: the wheel one
  // must be non-passive so the page never scrolls under the ladder.
  useEffect(() => {
    if (!region) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch zoom
      e.preventDefault();
      const unit = e.deltaMode === 1 ? rungPx : e.deltaMode === 2 ? rungPx * Math.max(1, live.current.rowCount) : 1;
      acc += e.deltaY * unit;
      const steps = Math.trunc(acc / rungPx);
      if (steps === 0) return;
      acc -= steps * rungPx;
      // Wheel down = lower prices, as in any list read top to bottom.
      move(steps);
    };
    // Touch drag (phone): the finger carries the rungs, so dragging down
    // shows higher prices. Past the slop the touch is a drag, and the click
    // that the browser fires when it ends is swallowed before a cell sees it.
    let drag: { id: number; startY: number; lastY: number; acc: number; moved: boolean } | null = null;
    let swallowClick = false;
    const onPointerDown = (e: PointerEvent) => {
      if (!touchDrag || e.pointerType === 'mouse') return;
      drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, acc: 0, moved: false };
      swallowClick = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientY - drag.startY) < DRAG_SLOP_PX) return;
      drag.moved = true;
      drag.acc += e.clientY - drag.lastY;
      drag.lastY = e.clientY;
      const steps = Math.trunc(drag.acc / rungPx);
      if (steps === 0) return;
      drag.acc -= steps * rungPx;
      move(-steps);
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      swallowClick = drag.moved;
      drag = null;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    region.addEventListener('wheel', onWheel, { passive: false });
    if (touchDrag) {
      region.addEventListener('pointerdown', onPointerDown);
      region.addEventListener('pointermove', onPointerMove);
      region.addEventListener('pointerup', onPointerEnd);
      region.addEventListener('pointercancel', onPointerEnd);
      region.addEventListener('click', onClickCapture, true);
    }
    return () => {
      region.removeEventListener('wheel', onWheel);
      region.removeEventListener('pointerdown', onPointerDown);
      region.removeEventListener('pointermove', onPointerMove);
      region.removeEventListener('pointerup', onPointerEnd);
      region.removeEventListener('pointercancel', onPointerEnd);
      region.removeEventListener('click', onClickCapture, true);
    };
  }, [region, rungPx, touchDrag]);

  // Derive the position for this render. Adjusting state during render (not
  // in an effect) means a re-centre never paints one stale frame first.
  let next = s;
  if (s.key !== resetKey) {
    next = { key: resetKey, group: groupTicks, pos: null, held: false, hold };
  } else if (s.group !== groupTicks) {
    next = {
      ...s,
      group: groupTicks,
      pos: s.pos === null ? null : { ...s.pos, rung: Math.round((s.pos.rung * s.group) / groupTicks) },
    };
  }
  // The end of the caller's hold (one-click off, the stage cleared, the menu
  // closed) also ends a scroll pin: the window goes back to the centre.
  if (next.hold !== hold) next = { ...next, hold, held: hold ? next.held : false };
  const pinned = hold || next.held;
  // Not pinned: centred, on every change.
  if (!pinned && next.pos !== null) next = { ...next, pos: null };
  // Pinned while centred: freeze the window on the prices it shows now.
  if (pinned && next.pos === null) {
    const at = capture(model, null, rowCount);
    if (at !== null) next = { ...next, pos: at };
  }
  if (next !== s) setS(next);

  const recentre = useCallback(() => {
    setS(prev => ({ ...prev, pos: null, held: false }));
  }, []);

  const pinTo = useCallback((rung: number) => {
    setS(prev => {
      const { model: m, rowCount: n } = live.current;
      // The rung in the middle slot, clamped like any scroll.
      const slot = Math.floor(n / 2);
      const pos = shift(m, { rung, slot }, n, 0);
      return { ...prev, pos, held: true };
    });
  }, []);

  return {
    rowCount,
    pos: next.pos,
    pinned,
    held: next.held,
    measureRef: setMeasureEl,
    regionRef: setRegion,
    recentre,
    pinTo,
    scrollBy: move,
  };
}
