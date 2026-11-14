// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop column widths. The side columns are 340px at 1440 and grow with
 * the viewport on wide screens (22vw, up to 480px), so a 2560px window does
 * not leave the ladder floating in a huge empty centre. Below 1200px they
 * narrow to 280px. The ladder grows modestly too: 640px up to a 1600px
 * viewport, then 40vw, up to 760px.
 *
 * The class strings are literal so Tailwind can read them; `resolveColumns`
 * mirrors them in numbers and a test keeps the two in step.
 */

export const SIDE = { min: 340, vw: 22, max: 480, narrow: 280, narrowBelow: 1200 } as const;
export const LADDER = { min: 640, vw: 40, max: 760 } as const;
/** The 1px hairline gaps between the three columns. */
export const GAP_PX = 1;

export const SIDE_COLUMNS =
  'grid-cols-[clamp(340px,22vw,480px)_minmax(0,1fr)_clamp(340px,22vw,480px)] max-[1199px]:grid-cols-[280px_minmax(0,1fr)_280px]';

export const LADDER_MAX_WIDTH = 'max-w-[clamp(640px,40vw,760px)]';

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

/** The computed column widths (px) the grid resolves to at a viewport width. */
export function resolveColumns(viewportWidth: number): { left: number; centre: number; right: number; ladder: number } {
  const side =
    viewportWidth < SIDE.narrowBelow ? SIDE.narrow : clamp(SIDE.min, (viewportWidth * SIDE.vw) / 100, SIDE.max);
  const centre = Math.max(0, viewportWidth - 2 * side - 2 * GAP_PX);
  const ladder = Math.min(centre, clamp(LADDER.min, (viewportWidth * LADDER.vw) / 100, LADDER.max));
  return { left: side, centre, right: side, ladder };
}
