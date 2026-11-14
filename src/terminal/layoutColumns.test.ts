// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { LADDER, LADDER_MAX_WIDTH, SIDE, SIDE_COLUMNS, resolveColumns } from './layoutColumns';

describe('desktop columns', () => {
  it('keeps 340 | 1fr | 340 and a 640px ladder at 1440', () => {
    expect(resolveColumns(1440)).toEqual({ left: 340, centre: 758, right: 340, ladder: 640 });
  });

  it('grows the side columns and the ladder on a 2560px screen', () => {
    expect(resolveColumns(2560)).toEqual({ left: 480, centre: 1598, right: 480, ladder: 760 });
    // The window from the report: 2522 wide no longer gives 340 | 1840 | 340.
    const wide = resolveColumns(2522);
    expect(wide.left).toBe(480);
    expect(wide.centre).toBe(1560);
  });

  it('narrows to 280 below 1200 and grows smoothly in between', () => {
    expect(resolveColumns(1100).left).toBe(280);
    expect(resolveColumns(1200).left).toBe(340);
    expect(resolveColumns(1800).left).toBeCloseTo(396);
    expect(resolveColumns(1800).ladder).toBe(720);
  });

  it('the Tailwind classes carry the same numbers', () => {
    const side = `clamp(${SIDE.min}px,${SIDE.vw}vw,${SIDE.max}px)`;
    expect(SIDE_COLUMNS).toContain(`grid-cols-[${side}_minmax(0,1fr)_${side}]`);
    expect(SIDE_COLUMNS).toContain(
      `max-[${SIDE.narrowBelow - 1}px]:grid-cols-[${SIDE.narrow}px_minmax(0,1fr)_${SIDE.narrow}px]`,
    );
    expect(LADDER_MAX_WIDTH).toBe(`max-w-[clamp(${LADDER.min}px,${LADDER.vw}vw,${LADDER.max}px)]`);
  });
});
