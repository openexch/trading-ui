// SPDX-License-Identifier: Apache-2.0
/**
 * Which rungs the ladder shows, and when that set is allowed to move.
 *
 * - Row count: fixed-height rungs, as many as fit in the measured element,
 *   always odd so the centre rung is the middle row. The element is held in
 *   state (not a ref) so the effect cleanup disconnects the observer it
 *   created (DESIGN.md rule 1).
 * - First centre: the window is provisional (it follows the anchor exactly,
 *   ignoring pins and the dead band) until the book has both sides. Then it
 *   settles once on `settleAt` (the middle of the touch), so a value computed
 *   before data (a stale last price, a one-sided first update) never stays
 *   on screen because the pointer happened to rest on the ladder at load.
 *   An empty book (reconnect) makes it provisional again.
 * - Dead band: once settled, the window follows the anchor (last trade, else
 *   the middle of the spread) only when the anchor leaves
 *   +-max(2, floor(N/4)) rungs of the centre, never per tick.
 * - Pinning (DESIGN.md rule 8): the window never moves while the pointer is
 *   over the ladder, while it has focus, while the caller holds it (an order
 *   staged, a menu or popover open), or after a wheel or jump. A wheel or jump
 *   pin lasts until `recentre()` (the Re-centre button or the C key).
 * - The ladder never scrolls as a container: the wheel moves a virtual centre.
 *   With `touchDrag` (the phone), a vertical finger drag moves it the same
 *   way and holds it like a wheel; the tap that ends a drag stages nothing.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Desktop rung height. */
export const RUNG_PX = 22;

/** Phone rung height: a whole rung is a 44px touch target. */
export const PHONE_RUNG_PX = 44;

/** How far a finger travels before a touch counts as a drag, not a tap. */
export const DRAG_SLOP_PX = 8;

/** Rungs that fit in `height`, rounded down to an odd count. */
export function rowsForHeight(height: number, rungPx: number = RUNG_PX): number {
  if (!(height > 0) || !(rungPx > 0)) return 0;
  const n = Math.floor(height / rungPx);
  if (n <= 0) return 0;
  return n % 2 === 1 ? n : n - 1;
}

/** How far (in rungs) the anchor may drift from the centre before the
 *  window re-centres. */
export function deadBand(rowCount: number): number {
  return Math.max(2, Math.floor(rowCount / 4));
}

export interface LadderWindowOptions {
  /** The rung the window follows; null while there is nothing to follow
   *  (market switch in flight). */
  anchor: number | null;
  /** The rung to settle the first centre on: the middle of the touch once
   *  the book has both sides, else null (the window stays provisional). */
  settleAt?: number | null;
  /** True while the book is empty (market switch, reconnect): the next
   *  centre is provisional again. */
  empty?: boolean;
  /** Changing this starts over: new centre at the anchor, pins dropped. The
   *  market id. */
  resetKey: string | number;
  /** Grouping in ticks. A change converts the centre to the new rung units
   *  so a pinned price stays in view. */
  groupTicks: number;
  /** The market's rung range; the wheel never moves the centre outside it. */
  minRung: number;
  maxRung: number;
  /** Pin reasons owned by the caller (an order staged, a menu open). */
  hold?: boolean;
  rungPx?: number;
  /** A vertical touch drag moves the window (the phone). */
  touchDrag?: boolean;
}

export interface LadderWindowState {
  rowCount: number;
  /** Rung shown in the middle row; null until there is an anchor. */
  centre: number | null;
  /** True while anything pins the window. */
  pinned: boolean;
  /** True after a wheel or jump, until `recentre()`. */
  held: boolean;
  /** Attach to the element whose height sets the row count. */
  measureRef: (el: HTMLElement | null) => void;
  /** Attach to the region whose hover, focus and wheel pin the window. */
  regionRef: (el: HTMLElement | null) => void;
  /** Drop the wheel or jump pin and centre on the anchor now. */
  recentre: () => void;
  /** Centre on a rung and hold it there (jump markers). */
  pinTo: (rung: number) => void;
}

interface CentreState {
  key: string | number;
  group: number;
  centre: number | null;
  held: boolean;
  /** False until the first centre is taken from a two-sided book. */
  settled: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function useLadderWindow(opts: LadderWindowOptions): LadderWindowState {
  const { anchor, settleAt = null, empty = false, resetKey, groupTicks, minRung, maxRung, hold = false, rungPx = RUNG_PX, touchDrag = false } =
    opts;

  const [measureEl, setMeasureEl] = useState<HTMLElement | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [s, setS] = useState<CentreState>(() => ({
    key: resetKey,
    group: groupTicks,
    centre: settleAt ?? anchor,
    held: false,
    settled: settleAt !== null,
  }));

  // Row count from the rendered element.
  useLayoutEffect(() => {
    if (!measureEl) return;
    const h0 = measureEl.getBoundingClientRect().height;
    if (h0 > 0) setRowCount(rowsForHeight(h0, rungPx));
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h <= 0) return; // hidden or unpainted: keep the last count
      setRowCount(rowsForHeight(h, rungPx));
    });
    ro.observe(measureEl);
    return () => ro.disconnect();
  }, [measureEl, rungPx]);

  // Latest values for the native wheel listener.
  const live = useRef({ minRung, maxRung, rowCount });
  useEffect(() => {
    live.current = { minRung, maxRung, rowCount };
  }, [minRung, maxRung, rowCount]);

  // Hover, focus and wheel on the region. Native listeners: the wheel one
  // must be non-passive so the page never scrolls under the ladder.
  useEffect(() => {
    if (!region) return;
    let acc = 0;
    const onEnter = () => setHovered(true);
    const onLeave = () => setHovered(false);
    const onFocusIn = () => setFocused(true);
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !region.contains(next)) setFocused(false);
    };
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
    region.addEventListener('pointerenter', onEnter);
    region.addEventListener('pointerleave', onLeave);
    region.addEventListener('focusin', onFocusIn);
    region.addEventListener('focusout', onFocusOut);
    region.addEventListener('wheel', onWheel, { passive: false });
    if (touchDrag) {
      region.addEventListener('pointerdown', onPointerDown);
      region.addEventListener('pointermove', onPointerMove);
      region.addEventListener('pointerup', onPointerEnd);
      region.addEventListener('pointercancel', onPointerEnd);
      region.addEventListener('click', onClickCapture, true);
    }
    return () => {
      region.removeEventListener('pointerenter', onEnter);
      region.removeEventListener('pointerleave', onLeave);
      region.removeEventListener('focusin', onFocusIn);
      region.removeEventListener('focusout', onFocusOut);
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
    next = { key: resetKey, group: groupTicks, centre: null, held: false, settled: false };
  } else if (s.group !== groupTicks) {
    next = {
      ...s,
      group: groupTicks,
      centre: s.centre === null ? anchor : Math.round((s.centre * s.group) / groupTicks),
    };
  }
  // A reconnect empties the book: start provisional again, unless the user
  // holds the window (an order staged, a wheel or jump pin).
  if (empty && next.settled && !hold && !next.held) next = { ...next, settled: false };
  if (!next.settled) {
    // Provisional: no pin or dead band applies before the first real centre.
    if (settleAt !== null) {
      next = { ...next, centre: settleAt, settled: true, held: false };
    } else if (anchor !== null && next.centre !== anchor && !next.held) {
      next = { ...next, centre: anchor };
    }
  }
  const pinned = hovered || focused || hold || next.held;
  if (
    next.settled &&
    !pinned &&
    anchor !== null &&
    next.centre !== null &&
    rowCount > 0 &&
    Math.abs(anchor - next.centre) > deadBand(rowCount)
  ) {
    next = { ...next, centre: anchor };
  }
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
    measureRef: setMeasureEl,
    regionRef: setRegion,
    recentre,
    pinTo,
  };
}
