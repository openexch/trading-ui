// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTickDirection } from './useTickDirection';

describe('useTickDirection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts with no direction and does not treat the first value as a move', () => {
    const { result } = renderHook(({ v }) => useTickDirection(v), { initialProps: { v: 100 as number | null } });
    expect(result.current).toEqual({ tick: null, dir: null });
  });

  it('flashes on a move, clears the flash, and keeps the arrow', () => {
    const { result, rerender } = renderHook(({ v }) => useTickDirection(v), { initialProps: { v: 100 as number | null } });
    rerender({ v: 101 });
    expect(result.current).toEqual({ tick: 'up', dir: 'up' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toEqual({ tick: null, dir: 'up' });
    rerender({ v: 99 });
    expect(result.current).toEqual({ tick: 'down', dir: 'down' });
  });

  it('leaves the direction alone when the value repeats', () => {
    const { result, rerender } = renderHook(({ v }) => useTickDirection(v), { initialProps: { v: 100 as number | null } });
    rerender({ v: 99 });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ v: 99 });
    expect(result.current).toEqual({ tick: null, dir: 'down' });
  });

  it('resets the baseline on null, so the next market is not a move', () => {
    const { result, rerender } = renderHook(({ v }) => useTickDirection(v), { initialProps: { v: 97000 as number | null } });
    rerender({ v: null });
    rerender({ v: 0.12 });
    expect(result.current.tick).toBeNull();
  });
});
