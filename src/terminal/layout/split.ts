// SPDX-License-Identifier: Apache-2.0
/**
 * Height math for a column's two slots. The stored ratio is the user's
 * choice; the rendered top height is that ratio clamped so both panels keep
 * their minimum height. When the column is too short for both minimums the
 * height is shared in proportion to them.
 */

export interface SplitBounds {
  /** Column height available to the two slots, px. */
  total: number;
  minTop: number;
  minBottom: number;
}

/** The smallest and largest top height the handle allows. */
export function topRange({ total, minTop, minBottom }: SplitBounds): { min: number; max: number } {
  if (total <= 0) return { min: 0, max: 0 };
  if (minTop + minBottom >= total) {
    const fixed = (total * minTop) / Math.max(1, minTop + minBottom);
    return { min: fixed, max: fixed };
  }
  return { min: minTop, max: total - minBottom };
}

/** A top height clamped into the allowed range. */
export function clampTop(top: number, bounds: SplitBounds): number {
  const { min, max } = topRange(bounds);
  if (!Number.isFinite(top)) return min;
  return Math.min(max, Math.max(min, top));
}

/** The rendered top height for a stored ratio. */
export function topForRatio(ratio: number, bounds: SplitBounds): number {
  return clampTop(ratio * bounds.total, bounds);
}

/** Arrow keys move the handle this far; Shift moves it further. */
export const KEY_STEP_PX = 16;
export const KEY_STEP_LARGE_PX = 64;
