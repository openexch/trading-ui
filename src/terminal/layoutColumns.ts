// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop column widths, in two modes.
 *
 * Standard (below WIDE.min): three columns. The side columns are 340px at
 * 1440 and grow with the viewport (22vw, up to 480px). Below 1200px they
 * narrow to 280px. The ladder fills the centre column, up to a 1200px frame
 * centred in it so the depth columns never become absurdly wide.
 *
 * Wide (WIDE.min and up): four columns, left | ladder | right | far right.
 * The ladder column is exactly the 960px frame and the three side columns
 * share the rest equally, so the ladder fills its column at every width and
 * no gutter opens beside it. The far-right column is the third two-slot side
 * column (layout/: six slots show all six panels at once).
 *
 * Why WIDE.min is 2140: in standard mode the centre column is
 * W - 2 * 22vw - 2 = 0.56W - 2 (between 1545 and 2182, where the side
 * columns are 22vw), so the 1200px frame stops filling it above
 * W = 1202 / 0.56 = 2146.4. Wide mode must start at or below that width, so
 * no window gets a gutter; 2140 is the round value under it. Wide mode never
 * has one (the ladder column is the frame). At 2140 the wide side columns
 * are (2140 - 960 - 3) / 3 = 392px, above the 340px they have at 1440.
 *
 * The order defaults bar and the staging strip use the same frame
 * (LADDER_FRAME), so their content lines up with the ladder's edges while
 * their background and hairline span the whole column. Inside the frame
 * there is a 20px side padding.
 *
 * The class strings are literal so Tailwind can read them; `resolveColumns`
 * mirrors them in numbers and a test keeps the two in step. The JS side
 * (useLayoutMode) reads WIDE_QUERY, the same breakpoint.
 */

export const SIDE = { min: 340, vw: 22, max: 480, narrow: 280, narrowBelow: 1200 } as const;
/** The centred frame the ladder, the defaults bar and the strip share:
 *  at most `max` wide (`wideMax` in wide mode), with `pad` on each side
 *  inside it. */
export const LADDER = { max: 1200, wideMax: 960, pad: 20 } as const;
/** Wide mode: from this viewport width (px) up, four columns. */
export const WIDE = { min: 2140 } as const;
/** The media query that matches wide mode (the CSS `min-[2140px]:` variant
 *  compiles to `width >= 2140px`, the same set of widths). */
export const WIDE_QUERY = `(min-width: ${WIDE.min}px)`;
/** The 1px hairline gaps between the columns. */
export const GAP_PX = 1;

export const SIDE_COLUMNS =
  'grid-cols-[clamp(340px,22vw,480px)_minmax(0,1fr)_clamp(340px,22vw,480px)] max-[1199px]:grid-cols-[280px_minmax(0,1fr)_280px] min-[2140px]:grid-cols-[minmax(0,1fr)_960px_minmax(0,1fr)_minmax(0,1fr)]';

/** A header cell that covers every column after the centre one: the right
 *  column in standard mode, the right and far-right columns in wide mode. */
export const AFTER_CENTRE = 'col-[3/-1]';

/** Side padding that centres the frame (20px inside it) in the full width of
 *  the centre column: 20px until the column passes the frame, then half the
 *  excess more. In wide mode the column is the 960px frame, so 20px. */
export const LADDER_FRAME =
  'px-[max(20px,calc((100%_-_1200px)_/_2_+_20px))] min-[2140px]:px-[max(20px,calc((100%_-_960px)_/_2_+_20px))]';

export type LayoutMode = 'standard' | 'wide';

export function modeAt(viewportWidth: number): LayoutMode {
  return viewportWidth >= WIDE.min ? 'wide' : 'standard';
}

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

export interface ResolvedColumns {
  mode: LayoutMode;
  left: number;
  centre: number;
  right: number;
  /** The far-right column; 0 in standard mode (it is not rendered). */
  farRight: number;
  /** The ladder's content box (the rung grid, inside the frame's padding). */
  ladder: number;
  /** Empty space on each side of the frame inside the centre column. */
  gutter: number;
}

/** The computed widths (px) at a viewport width. */
export function resolveColumns(viewportWidth: number): ResolvedColumns {
  const mode = modeAt(viewportWidth);
  if (mode === 'wide') {
    const centre = LADDER.wideMax;
    const side = Math.max(0, (viewportWidth - centre - 3 * GAP_PX) / 3);
    return { mode, left: side, centre, right: side, farRight: side, ladder: centre - 2 * LADDER.pad, gutter: 0 };
  }
  const side =
    viewportWidth < SIDE.narrowBelow ? SIDE.narrow : clamp(SIDE.min, (viewportWidth * SIDE.vw) / 100, SIDE.max);
  const centre = Math.max(0, viewportWidth - 2 * side - 2 * GAP_PX);
  const frame = Math.min(centre, LADDER.max);
  const ladder = Math.max(0, frame - 2 * LADDER.pad);
  return { mode, left: side, centre, right: side, farRight: 0, ladder, gutter: (centre - frame) / 2 };
}
