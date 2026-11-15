// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_KEY, LAYOUT_KEY_V1, loadLayout, parseLayout, saveLayout } from './persistence';
import { defaultLayout, presetLayout } from './presets';

const valid = {
  v: 2,
  slots: ['trades', 'fills', 'orders', 'chart', 'balances', 'markets'],
  split: { left: 0.6, right: 0.4, farRight: 0.3 },
};
const v1 = { v: 1, slots: ['trades', 'fills', 'orders', 'chart'], split: { left: 0.6, right: 0.4 } };

function store(value: unknown, key = LAYOUT_KEY) {
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
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
    expect(LAYOUT_KEY).toBe('oe.tui.layout.v2');
    expect(JSON.parse(localStorage.getItem('oe.tui.layout.v2')!)).toEqual({ v: 2, ...s });
    expect(loadLayout()).toEqual(s);
  });

  it('reads a valid stored layout, keeping no extra fields', () => {
    store({ ...valid, extra: 1, split: { ...valid.split, middle: 0.5 } });
    expect(loadLayout()).toEqual({ slots: valid.slots, split: valid.split });
  });

  it.each([
    ['corrupt JSON', '{"v":2,"slots":['],
    ['not an object', '"default"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['version 0', { ...valid, v: 0 }],
    ['version 1 under the version 2 key', v1],
    ['version 3', { ...valid, v: 3 }],
    ['no version', { slots: valid.slots, split: valid.split }],
    ['an unknown panel id', { ...valid, slots: ['trades', 'ladder', 'orders', 'chart', 'balances', 'markets'] }],
    ['a duplicate panel id', { ...valid, slots: ['trades', 'trades', 'orders', 'chart', 'balances', 'markets'] }],
    ['four slots', { ...valid, slots: ['trades', 'fills', 'orders', 'chart'] }],
    ['five slots', { ...valid, slots: ['trades', 'fills', 'orders', 'chart', 'markets'] }],
    ['seven slots', { ...valid, slots: [...valid.slots, 'markets'] }],
    ['a missing split', { v: 2, slots: valid.slots }],
    ['a missing far-right ratio', { ...valid, split: { left: 0.6, right: 0.4 } }],
    ['a ratio out of range', { ...valid, split: { ...valid.split, left: 1.5 } }],
    ['a zero ratio', { ...valid, split: { ...valid.split, farRight: 0 } }],
    ['a string ratio', { ...valid, split: { ...valid.split, left: '0.5' } }],
    ['a null ratio (NaN serialised)', { ...valid, split: { ...valid.split, farRight: Number.NaN } }],
    ['an array split', { ...valid, split: [0.5, 0.5, 0.5] }],
  ])('falls back to Default on %s', (_name, value) => {
    store(value);
    expect(loadLayout()).toEqual(defaultLayout());
  });

  it('a corrupt version 2 value falls back to Default even when a valid version 1 one is there', () => {
    store('{', LAYOUT_KEY);
    store(v1, LAYOUT_KEY_V1);
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

  it('parseLayout (another tab) accepts only valid version 2 values', () => {
    expect(parseLayout(JSON.stringify(valid))).toEqual({ slots: valid.slots, split: valid.split });
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{')).toBeNull();
    expect(parseLayout(JSON.stringify(v1))).toBeNull();
    expect(parseLayout(JSON.stringify({ ...valid, v: 3 }))).toBeNull();
  });
});

describe('migration from version 1', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the four slots and splits; the two hidden panels fill the far-right column in registry order', () => {
    store(v1, LAYOUT_KEY_V1);
    expect(loadLayout()).toEqual({
      slots: ['trades', 'fills', 'orders', 'chart', 'markets', 'balances'],
      split: { left: 0.6, right: 0.4, farRight: defaultLayout().split.farRight },
    });
  });

  it('every version 1 preset migrates to the matching version 2 preset', () => {
    const presets = {
      default: { v: 1, slots: ['markets', 'trades', 'chart', 'orders'], split: { left: 0.36, right: 0.58 } },
      scalper: { v: 1, slots: ['trades', 'markets', 'orders', 'chart'], split: { left: 0.7, right: 0.66 } },
      'chart-heavy': { v: 1, slots: ['markets', 'trades', 'chart', 'orders'], split: { left: 0.36, right: 0.78 } },
    } as const;
    for (const [id, stored] of Object.entries(presets)) {
      localStorage.clear();
      store(stored, LAYOUT_KEY_V1);
      const loaded = loadLayout();
      const expected = presetLayout(id as keyof typeof presets);
      expect(loaded).toEqual(expected);
    }
  });

  it('the first save writes version 2 and leaves the version 1 key alone', () => {
    store(v1, LAYOUT_KEY_V1);
    const loaded = loadLayout();
    expect(saveLayout(loaded)).toBe(true);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!)).toEqual({ v: 2, ...loaded });
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY_V1)!)).toEqual(v1);
    expect(loadLayout()).toEqual(loaded);
  });

  it.each([
    ['corrupt JSON', '{"v":1,'],
    ['an unknown panel id', { ...v1, slots: ['trades', 'ladder', 'orders', 'chart'] }],
    ['a duplicate panel id', { ...v1, slots: ['trades', 'trades', 'orders', 'chart'] }],
    ['six slots under version 1', { ...v1, slots: ['trades', 'fills', 'orders', 'chart', 'markets', 'balances'] }],
    ['a ratio out of range', { ...v1, split: { left: 1.5, right: 0.4 } }],
    ['a wrong version', { ...v1, v: 0 }],
  ])('an invalid version 1 value (%s) falls back to Default', (_name, value) => {
    store(value, LAYOUT_KEY_V1);
    expect(loadLayout()).toEqual(defaultLayout());
  });
});
