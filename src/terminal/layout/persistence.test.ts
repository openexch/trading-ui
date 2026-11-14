// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_KEY, loadLayout, parseLayout, saveLayout } from './persistence';
import { defaultLayout, presetLayout } from './presets';

const valid = { v: 1, slots: ['trades', 'fills', 'orders', 'chart'], split: { left: 0.6, right: 0.4 } };

function store(value: unknown) {
  localStorage.setItem(LAYOUT_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('layout persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('nothing stored: Default', () => {
    expect(loadLayout()).toEqual(defaultLayout());
  });

  it('round-trips a valid layout under the versioned key', () => {
    const s = presetLayout('scalper');
    expect(saveLayout(s)).toBe(true);
    expect(JSON.parse(localStorage.getItem('oe.tui.layout.v1')!)).toEqual({ v: 1, ...s });
    expect(loadLayout()).toEqual(s);
  });

  it('reads a valid stored layout', () => {
    store(valid);
    expect(loadLayout()).toEqual({ slots: valid.slots, split: valid.split });
  });

  it.each([
    ['corrupt JSON', '{"v":1,"slots":['],
    ['not an object', '"default"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['version 0', { ...valid, v: 0 }],
    ['version 2', { ...valid, v: 2 }],
    ['no version', { slots: valid.slots, split: valid.split }],
    ['an unknown panel id', { ...valid, slots: ['trades', 'ladder', 'orders', 'chart'] }],
    ['a duplicate panel id', { ...valid, slots: ['trades', 'trades', 'orders', 'chart'] }],
    ['three slots', { ...valid, slots: ['trades', 'fills', 'orders'] }],
    ['five slots', { ...valid, slots: ['trades', 'fills', 'orders', 'chart', 'markets'] }],
    ['a missing split', { v: 1, slots: valid.slots }],
    ['a ratio out of range', { ...valid, split: { left: 1.5, right: 0.4 } }],
    ['a zero ratio', { ...valid, split: { left: 0, right: 0.4 } }],
    ['a string ratio', { ...valid, split: { left: '0.5', right: 0.4 } }],
    ['a null ratio (NaN serialised)', { ...valid, split: { left: Number.NaN, right: 0.4 } }],
  ])('falls back to Default on %s', (_name, value) => {
    store(value);
    expect(loadLayout()).toEqual(defaultLayout());
  });

  it('a storage whose getter throws: load gives Default, save reports false', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => loadLayout()).not.toThrow();
    expect(loadLayout()).toEqual(defaultLayout());
    expect(saveLayout(presetLayout('scalper'))).toBe(false);
  });

  it('a storage whose getItem and setItem throw: never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(loadLayout()).toEqual(defaultLayout());
    expect(() => saveLayout(defaultLayout())).not.toThrow();
    expect(saveLayout(defaultLayout())).toBe(false);
  });

  it('parseLayout (another tab) accepts only valid values', () => {
    expect(parseLayout(JSON.stringify(valid))).toEqual({ slots: valid.slots, split: valid.split });
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{')).toBeNull();
    expect(parseLayout(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
  });
});
