// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { LADDER, LADDER_FRAME, SIDE, SIDE_COLUMNS, resolveColumns } from './layoutColumns';

describe('desktop columns', () => {
  it('keeps 340 | 1fr | 340 at 1440, the ladder filling the centre', () => {
    expect(resolveColumns(1440)).toEqual({ left: 340, centre: 758, right: 340, ladder: 718 });
  });

  it('fills the centre column on wide screens up to the 1200px frame', () => {
    expect(resolveColumns(2560)).toEqual({ left: 480, centre: 1598, right: 480, ladder: 1160 });
    // The window from the report: 2522 wide, a 1560px centre column. The
    // ladder was 728px there; now the frame is 1200 (1160 of rungs), with
    // 180px either side.
    const wide = resolveColumns(2522);
    expect(wide.left).toBe(480);
    expect(wide.centre).toBe(1560);
    expect(wide.ladder).toBe(1160);
    expect((wide.centre - LADDER.max) / 2).toBe(180);
  });

  it('narrows to 280 below 1200 and grows smoothly in between', () => {
    expect(resolveColumns(1100).left).toBe(280);
    expect(resolveColumns(1200).left).toBe(340);
    expect(resolveColumns(1800).left).toBeCloseTo(396);
    expect(resolveColumns(1800).ladder).toBeCloseTo(1800 - 2 * 396 - 2 - 40);
  });

  it('the Tailwind classes carry the same numbers', () => {
    const side = `clamp(${SIDE.min}px,${SIDE.vw}vw,${SIDE.max}px)`;
    expect(SIDE_COLUMNS).toContain(`grid-cols-[${side}_minmax(0,1fr)_${side}]`);
    expect(SIDE_COLUMNS).toContain(
      `max-[${SIDE.narrowBelow - 1}px]:grid-cols-[${SIDE.narrow}px_minmax(0,1fr)_${SIDE.narrow}px]`,
    );
    expect(LADDER_FRAME).toBe(
      `px-[max(${LADDER.pad}px,calc((100%_-_${LADDER.max}px)_/_2_+_${LADDER.pad}px))]`,
    );
  });
});
