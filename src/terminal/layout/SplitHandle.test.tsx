// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { SplitHandle } from './SplitHandle';
import { KEY_STEP_LARGE_PX, KEY_STEP_PX, clampTop, topForRatio, topRange } from './split';
import type { SplitBounds } from './split';

const BOUNDS: SplitBounds = { total: 800, minTop: 140, minBottom: 220 };

function Harness({ initial, bounds = BOUNDS }: { initial: number; bounds?: SplitBounds }) {
  const [top, setTop] = useState(initial);
  return (
    <SplitHandle label="Resize left panels" top={top} bounds={bounds} topTitle="Markets" bottomTitle="Chart" onChange={setTop} />
  );
}

const handle = () => screen.getByRole('separator', { name: 'Resize left panels' });
const now = () => Number(handle().getAttribute('aria-valuenow'));
const px = () => Number(/Markets (\d+) px/.exec(handle().getAttribute('aria-valuetext')!)![1]);

describe('split math', () => {
  it('clamps so both panels keep their minimum height', () => {
    expect(topRange(BOUNDS)).toEqual({ min: 140, max: 580 });
    expect(clampTop(10, BOUNDS)).toBe(140);
    expect(clampTop(790, BOUNDS)).toBe(580);
    expect(clampTop(300, BOUNDS)).toBe(300);
    expect(clampTop(Number.NaN, BOUNDS)).toBe(140);
    expect(topForRatio(0.5, BOUNDS)).toBe(400);
    expect(topForRatio(0.05, BOUNDS)).toBe(140);
  });

  it('a column too short for both minimums shares in proportion to them', () => {
    const tight = { total: 180, minTop: 140, minBottom: 220 };
    const r = topRange(tight);
    expect(r.min).toBeCloseTo(70);
    expect(r.max).toBeCloseTo(70);
    expect(clampTop(0, tight)).toBeCloseTo(70);
  });

  it('an unmeasured column (0 px) gives 0', () => {
    expect(topRange({ total: 0, minTop: 140, minBottom: 220 })).toEqual({ min: 0, max: 0 });
  });
});

describe('SplitHandle', () => {
  afterEach(cleanup);

  it('is a focusable horizontal separator with its value in percent', () => {
    render(<Harness initial={400} />);
    const h = handle();
    expect(h.getAttribute('aria-orientation')).toBe('horizontal');
    expect(h.tabIndex).toBe(0);
    expect(now()).toBe(50);
    expect(h.getAttribute('aria-valuemin')).toBe(String(Math.round((140 / 800) * 100)));
    expect(h.getAttribute('aria-valuemax')).toBe(String(Math.round((580 / 800) * 100)));
    expect(h.getAttribute('aria-valuetext')).toBe('Markets 400 px, Chart 400 px');
  });

  it('arrow keys step 16 px, Shift steps 64 px', () => {
    render(<Harness initial={400} />);
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(px()).toBe(400 + KEY_STEP_PX);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(px()).toBe(400 - KEY_STEP_PX);
    fireEvent.keyDown(handle(), { key: 'ArrowDown', shiftKey: true });
    expect(px()).toBe(400 - KEY_STEP_PX + KEY_STEP_LARGE_PX);
  });

  it('keys clamp at the minimum heights; Home and End jump to them', () => {
    render(<Harness initial={150} />);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(px()).toBe(140);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(px()).toBe(140);
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(px()).toBe(580);
    fireEvent.keyDown(handle(), { key: 'ArrowDown', shiftKey: true });
    expect(px()).toBe(580);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(px()).toBe(140);
  });

  it('other keys pass through untouched', () => {
    render(<Harness initial={400} />);
    const ev = fireEvent.keyDown(handle(), { key: 'b' });
    expect(ev).toBe(true); // not prevented
    expect(px()).toBe(400);
  });

  it('pointer drag moves it and clamps', () => {
    render(<Harness initial={400} />);
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 560 });
    expect(px()).toBe(460);
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 2000 });
    expect(px()).toBe(580);
    fireEvent.pointerUp(handle(), { pointerId: 1, clientY: 2000 });
    // After release, moves do nothing.
    fireEvent.pointerMove(handle(), { pointerId: 1, clientY: 100 });
    expect(px()).toBe(580);
  });
});
