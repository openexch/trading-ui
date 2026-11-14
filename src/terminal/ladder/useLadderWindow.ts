// SPDX-License-Identifier: Apache-2.0
/**
 * Which rungs the ladder shows, and when that set is allowed to move.
 *
 * - Row count: fixed-height rungs, as many as fit in the measured element
 *   after the spread row's height is set aside, always odd so the centre
 *   rung is the middle row. The element is held in state (not a ref) so the
 *   effect cleanup disconnects the observer it created (DESIGN.md rule 1).
 * - Centred (DESIGN.md rule 8): the middle row is the anchor (the last
 *   trade, else the middle of the touch), re-centred on every change,
 *   whether or not the pointer is over the ladder or it has focus.
 * - Pinned: the window stays where it is only while the caller holds it
 *   (one-click armed, an order staged, a menu or popover open) or after an
 *   explicit scroll (the wheel, a finger drag, PageUp / PageDown, a jump
 *   marker). An explicit scroll holds until `recentre()` (the Re-centre
 *   button, C or Esc) or until the caller's hold ends; when the hold ends
 *   the window re-centres.
 * - The ladder never scrolls as a container: the wheel moves a virtual centre.
 *   With `touchDrag` (the phone), a vertical finger drag moves it the same
 *   way and holds it like a wheel; the tap that ends a drag stages nothing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Desktop rung height. */
export const RUNG_PX = 22;

/** Phone rung height: a whole rung is a 44px touch target. */
export const PHONE_RUNG_PX = 44;

/** Desktop spread row: its own row between the best ask and the best bid
 *  (10px label on a 12px line). */
export const SPREAD_ROW_PX = 12;

/** Phone spread row (11px label). */
export const PHONE_SPREAD_ROW_PX = 20;

/** How far a finger travels before a touch counts as a drag, not a tap. */
export const DRAG_SLOP_PX = 8;

/** Rungs that fit in `height` once `reservePx` (the spread row) is set
 *  aside, rounded down to an odd count. */
export function rowsForHeight(height: number, rungPx: number = RUNG_PX, reservePx = 0): number {
  if (!(height > 0) || !(rungPx > 0)) return 0;
  const n = Math.floor((height - Math.max(0, reservePx)) / rungPx);
  if (n <= 0) return 0;
  return n % 2 === 1 ? n : n - 1;
}

export interface LadderWindowOptions {
  /** The rung the window follows (the last trade, else the middle of the
   *  touch); null while there is nothing to follow (market switch in
   *  flight). */
  anchor: number | null;
  /** Changing this starts over: new centre at the anchor, pins dropped. The
   *  market id. */
  resetKey: string | number;
  /** Grouping in ticks. A change converts the centre to the new rung units
   *  so a pinned price stays in view. */
  groupTicks: number;
  /** The market's rung range; the wheel never moves the centre outside it. */
  minRung: number;
  maxRung: number;
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
  /** Rung shown in the middle row; null until there is an anchor. */
  centre: number | null;
  /** True while anything pins the window (the caller's hold or a scroll). */
  pinned: boolean;
  /** True after an explicit scroll (wheel, drag, page keys, jump), until
   *  `recentre()` or the end of the caller's hold. */
  held: boolean;
  /** True while the middle row is the anchor. */
  centred: boolean;
  /** Attach to the element whose height sets the row count. */
  measureRef: (el: HTMLElement | null) => void;
  /** Attach to the region whose wheel (and finger drag) scrolls the window. */
  regionRef: (el: HTMLElement | null) => void;
  /** Drop the scroll pin and centre on the anchor now. */
  recentre: () => void;
  /** Centre on a rung and hold it there (jump markers, page keys). */
  pinTo: (rung: number) => void;
}

interface CentreState {
  key: string | number;
  group: number;
  centre: number | null;
  held: boolean;
  /** The caller's hold as of the last render, to see it end. */
  hold: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function useLadderWindow(opts: LadderWindowOptions): LadderWindowState {
  const {
    anchor,
    resetKey,
    groupTicks,
    minRung,
    maxRung,
    hold = false,
    rungPx = RUNG_PX,
    reservePx = 0,
    touchDrag = false,
  } = opts;

  const [measureEl, setMeasureEl] = useState<HTMLElement | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [s, setS] = useState<CentreState>(() => ({
    key: resetKey,
    group: groupTicks,
    centre: anchor,
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

  // Latest values for the native wheel listener.
  const live = useRef({ minRung, maxRung, rowCount });
  useEffect(() => {
    live.current = { minRung, maxRung, rowCount };
  }, [minRung, maxRung, rowCount]);

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
      setS(prev => {
        if (prev.centre === null) return prev;
        const { minRung: lo, maxRung: hi } = live.current;
        // Wheel down = lower prices, as in any list read top to bottom.
        return { ...prev, centre: clamp(prev.centre - steps, lo, hi), held: true };
      });
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
      setS(prev => {
        if (prev.centre === null) return prev;
        const { minRung: lo, maxRung: hi } = live.current;
        return { ...prev, centre: clamp(prev.centre + steps, lo, hi), held: true };
      });
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

  // Derive the centre for this render. Adjusting state during render (not in
  // an effect) means a re-centre never paints one stale frame first.
  let next = s;
  if (s.key !== resetKey) {
    next = { key: resetKey, group: groupTicks, centre: anchor, held: false, hold };
  } else if (s.group !== groupTicks) {
    next = {
      ...s,
      group: groupTicks,
      centre: s.centre === null ? anchor : Math.round((s.centre * s.group) / groupTicks),
    };
  }
  // The end of the caller's hold (one-click off, the stage cleared, the menu
  // closed) also ends a scroll pin: the window goes back to the centre.
  if (next.hold !== hold) next = { ...next, hold, held: hold ? next.held : false };
  const pinned = hold || next.held;
  // Not pinned: the anchor is the middle row, on every change.
  if (!pinned && anchor !== null && next.centre !== anchor) next = { ...next, centre: anchor };
  // Nothing shown yet (the first anchor arrives while pinned): take it.
  if (next.centre === null && anchor !== null) next = { ...next, centre: anchor };
  if (next !== s) setS(next);

  const recentre = useCallback(() => {
    setS(prev => ({ ...prev, centre: anchor ?? prev.centre, held: false }));
  }, [anchor]);

  const pinTo = useCallback((rung: number) => {
    setS(prev => ({ ...prev, centre: rung, held: true }));
  }, []);

  return {
    rowCount,
    centre: next.centre,
    pinned,
    held: next.held,
    centred: anchor === null || next.centre === anchor,
    measureRef: setMeasureEl,
    regionRef: setRegion,
    recentre,
    pinTo,
  };
}
