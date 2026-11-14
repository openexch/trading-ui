// SPDX-License-Identifier: Apache-2.0
/**
 * The height handle between the two slots of a column (role=separator).
 *
 * - Pointer drag moves it; the pointer is captured, so a fast drag does not
 *   lose the handle.
 * - Keyboard: ArrowUp / ArrowDown move it 16 px (Shift: 64 px), Home and End
 *   go to the limits.
 * - Every position is clamped so both panels keep their minimum height
 *   (split.ts). The handle reports the top panel's share of the column as
 *   aria-valuenow, in percent.
 * - It is the only way a panel's height changes besides a preset or Reset
 *   (DESIGN.md rule 15).
 */
import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { KEY_STEP_LARGE_PX, KEY_STEP_PX, clampTop, topRange } from './split';
import type { SplitBounds } from './split';

export interface SplitHandleProps {
  /** "Resize left panels". */
  label: string;
  /** The current top height, px (already clamped). */
  top: number;
  bounds: SplitBounds;
  /** Titles of the two panels, for the spoken value. */
  topTitle: string;
  bottomTitle: string;
  /** A new top height, px, already clamped. */
  onChange: (top: number) => void;
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export function SplitHandle({ label, top, bounds, topTitle, bottomTitle, onChange }: SplitHandleProps) {
  const drag = useRef<{ startY: number; startTop: number; pointerId: number } | null>(null);
  const { min, max } = topRange(bounds);

  const move = (next: number) => {
    const clamped = clampTop(next, bounds);
    if (clamped !== top) onChange(clamped);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
    let next: number | null = null;
    if (e.key === 'ArrowUp') next = top - step;
    else if (e.key === 'ArrowDown') next = top + step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    move(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startY: e.clientY, startTop: top, pointerId: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; the drag still works without it */
    }
    e.currentTarget.focus();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    move(d.startTop + (e.clientY - d.startY));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const bottom = Math.max(0, bounds.total - top);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={pct(top, bounds.total)}
      aria-valuemin={pct(min, bounds.total)}
      aria-valuemax={pct(max, bounds.total)}
      aria-valuetext={`${topTitle} ${Math.round(top)} px, ${bottomTitle} ${Math.round(bottom)} px`}
      tabIndex={0}
      data-split-handle
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="group relative z-10 -my-1 grid h-2 flex-none cursor-row-resize touch-none place-items-center outline-none"
    >
      <span
        aria-hidden
        className="h-[3px] w-9 rounded-sm bg-ctl transition-colors group-hover:bg-muted group-focus-visible:bg-accent"
      />
    </div>
  );
}
