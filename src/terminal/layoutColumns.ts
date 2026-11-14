// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop column widths. The side columns are 340px at 1440 and grow with
 * the viewport on wide screens (22vw, up to 480px), so a 2560px window does
 * not leave the ladder floating in a huge empty centre. Below 1200px they
 * narrow to 280px.
 *
 * The ladder fills the centre column, up to a 1200px frame centred in it so
 * the depth columns never become absurdly wide. The order defaults bar and
 * the staging strip use the same frame (LADDER_FRAME), so their content
 * lines up with the ladder's edges while their background and hairline span
 * the whole column. Inside the frame there is a 20px side padding.
 *
 * The class strings are literal so Tailwind can read them; `resolveColumns`
 * mirrors them in numbers and a test keeps the two in step.
 */

export const SIDE = { min: 340, vw: 22, max: 480, narrow: 280, narrowBelow: 1200 } as const;
/** The centred frame the ladder, the defaults bar and the strip share:
 *  at most `max` wide, with `pad` on each side inside it. */
export const LADDER = { max: 1200, pad: 20 } as const;
/** The 1px hairline gaps between the three columns. */
export const GAP_PX = 1;

export const SIDE_COLUMNS =
  'grid-cols-[clamp(340px,22vw,480px)_minmax(0,1fr)_clamp(340px,22vw,480px)] max-[1199px]:grid-cols-[280px_minmax(0,1fr)_280px]';

/** Side padding that centres a 1200px frame (20px inside it) in the full
 *  width of the centre column: 20px until the column passes 1200px, then
 *  half the excess more. */
export const LADDER_FRAME = 'px-[max(20px,calc((100%_-_1200px)_/_2_+_20px))]';

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

/** The computed widths (px) at a viewport width: the three columns and the
 *  ladder's content box (the rung grid, inside the frame's padding). */
export function resolveColumns(viewportWidth: number): { left: number; centre: number; right: number; ladder: number } {
  const side =
    viewportWidth < SIDE.narrowBelow ? SIDE.narrow : clamp(SIDE.min, (viewportWidth * SIDE.vw) / 100, SIDE.max);
  const centre = Math.max(0, viewportWidth - 2 * side - 2 * GAP_PX);
  const ladder = Math.max(0, Math.min(centre, LADDER.max) - 2 * LADDER.pad);
  return { left: side, centre, right: side, ladder };
}
