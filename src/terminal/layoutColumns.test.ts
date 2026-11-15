// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  AFTER_CENTRE,
  GAP_PX,
  LADDER,
  LADDER_FRAME,
  SIDE,
  SIDE_COLUMNS,
  WIDE,
  WIDE_QUERY,
  modeAt,
  resolveColumns,
} from './layoutColumns';

describe('desktop columns: standard mode', () => {
  it('keeps 340 | 1fr | 340 at 1440, the ladder filling the centre', () => {
    expect(resolveColumns(1440)).toEqual({
      mode: 'standard',
      left: 340,
      centre: 758,
      right: 340,
      farRight: 0,
      ladder: 718,
      gutter: 0,
    });
  });

  it('1920 is unchanged: 422.4 | 1073.2 | 422.4, no gutter', () => {
    const c = resolveColumns(1920);
    expect(c.mode).toBe('standard');
    expect(c.left).toBeCloseTo(422.4);
    expect(c.centre).toBeCloseTo(1073.2);
    expect(c.gutter).toBe(0);
  });

  it('narrows to 280 below 1200 and grows smoothly in between', () => {
    expect(resolveColumns(1100).left).toBe(280);
    expect(resolveColumns(1200).left).toBe(340);
    expect(resolveColumns(1800).left).toBeCloseTo(396);
    expect(resolveColumns(1800).ladder).toBeCloseTo(1800 - 2 * 396 - 2 - 40);
  });
});

describe('desktop columns: the wide breakpoint', () => {
  it('the standard centre outgrows the 1200 frame only above 1202 / 0.56 = 2146.4', () => {
    const edge = (LADDER.max + 2 * GAP_PX) / (1 - (2 * SIDE.vw) / 100);
    expect(edge).toBeCloseTo(2146.43, 2);
    // Wide mode starts at or below it, so no width ever has a gutter.
    expect(WIDE.min).toBeLessThanOrEqual(edge);
  });

  it('no gutter on either side of the breakpoint, nor anywhere from 1000 to 5120', () => {
    for (let w = 1000; w <= 5120; w += 1) {
      expect(resolveColumns(w).gutter, `at ${w}`).toBeLessThanOrEqual(0);
    }
    expect(resolveColumns(WIDE.min - 1).mode).toBe('standard');
    expect(resolveColumns(WIDE.min - 1).gutter).toBe(0);
    expect(resolveColumns(WIDE.min).mode).toBe('wide');
  });

  it('wide: four columns, the ladder column is the 960 frame, the sides share the rest', () => {
    const at = resolveColumns(2140);
    expect(at).toEqual({ mode: 'wide', left: (2140 - 963) / 3, centre: 960, right: at.left, farRight: at.left, ladder: 920, gutter: 0 });
    expect(at.left).toBeCloseTo(392.33);
    expect(at.left).toBeGreaterThan(SIDE.min);
    const c = resolveColumns(2560);
    expect(c.centre).toBe(960);
    expect(c.left).toBeCloseTo(532.33);
    expect(c.left + c.centre + c.right + c.farRight + 3 * GAP_PX).toBeCloseTo(2560);
    expect(c.ladder).toBe(LADDER.wideMax - 2 * LADDER.pad);
    expect(resolveColumns(2200).left).toBeCloseTo(412.33);
  });

  it('modeAt matches the media query boundary', () => {
    expect(modeAt(WIDE.min - 1)).toBe('standard');
    expect(modeAt(WIDE.min - 0.5)).toBe('standard');
    expect(modeAt(WIDE.min)).toBe('wide');
    expect(WIDE_QUERY).toBe(`(min-width: ${WIDE.min}px)`);
  });
});

describe('the Tailwind classes carry the same numbers', () => {
  it('SIDE_COLUMNS', () => {
    const side = `clamp(${SIDE.min}px,${SIDE.vw}vw,${SIDE.max}px)`;
    expect(SIDE_COLUMNS).toContain(`grid-cols-[${side}_minmax(0,1fr)_${side}]`);
    expect(SIDE_COLUMNS).toContain(
      `max-[${SIDE.narrowBelow - 1}px]:grid-cols-[${SIDE.narrow}px_minmax(0,1fr)_${SIDE.narrow}px]`,
    );
    expect(SIDE_COLUMNS).toContain(
      `min-[${WIDE.min}px]:grid-cols-[minmax(0,1fr)_${LADDER.wideMax}px_minmax(0,1fr)_minmax(0,1fr)]`,
    );
  });

  it('LADDER_FRAME', () => {
    const frame = (max: number) => `px-[max(${LADDER.pad}px,calc((100%_-_${max}px)_/_2_+_${LADDER.pad}px))]`;
    expect(LADDER_FRAME).toBe(`${frame(LADDER.max)} min-[${WIDE.min}px]:${frame(LADDER.wideMax)}`);
  });

  it('the header right cell covers every column after the centre', () => {
    expect(AFTER_CENTRE).toBe('col-[3/-1]');
  });
});
