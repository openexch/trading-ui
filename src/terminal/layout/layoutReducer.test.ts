// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { SPLIT_MAX, SPLIT_MIN, hiddenPanels, layoutReducer, slotsValid } from './layoutReducer';
import type { LayoutState, SlotIndex } from './layoutReducer';
import { PANEL_IDS } from './registry';
import type { PanelId } from './registry';
import { PRESETS, PRESET_IDS, defaultLayout, matchingPreset, presetLayout } from './presets';

/** Small seeded PRNG (mulberry32) so a failing fuzz run can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function invariantHolds(s: LayoutState) {
  expect(s.slots).toHaveLength(4);
  expect(new Set(s.slots).size).toBe(4);
  for (const p of s.slots) expect(PANEL_IDS).toContain(p);
}

describe('layoutReducer: pick', () => {
  const base = defaultLayout(); // markets, trades | chart, orders

  it('picking the panel already in the slot changes nothing', () => {
    expect(layoutReducer(base, { type: 'pick', slot: 0, panel: 'markets' })).toBe(base);
  });

  it('picking a panel open in another slot swaps the two', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 1, panel: 'chart' });
    expect(s.slots).toEqual(['markets', 'chart', 'trades', 'orders']);
    // Within one column too.
    const t = layoutReducer(base, { type: 'pick', slot: 0, panel: 'trades' });
    expect(t.slots).toEqual(['trades', 'markets', 'chart', 'orders']);
  });

  it('picking a hidden panel replaces the current one, which becomes hidden', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 3, panel: 'fills' });
    expect(s.slots).toEqual(['markets', 'trades', 'chart', 'fills']);
    expect(hiddenPanels(s.slots)).toEqual(['orders', 'balances']);
  });

  it('a pick never changes the split (sizes move only by handle, preset or reset)', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 2, panel: 'balances' });
    expect(s.split).toEqual(base.split);
  });

  it('ignores unknown panels and slots', () => {
    expect(layoutReducer(base, { type: 'pick', slot: 0, panel: 'ladder' as PanelId })).toBe(base);
    expect(layoutReducer(base, { type: 'pick', slot: 7 as SlotIndex, panel: 'fills' })).toBe(base);
  });

  it('fuzz: every panel at most once and no empty slot over random picks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      let s: LayoutState = presetLayout(PRESET_IDS[seed % PRESET_IDS.length]);
      for (let i = 0; i < 500; i++) {
        const slot = Math.floor(r() * 4) as SlotIndex;
        const panel = PANEL_IDS[Math.floor(r() * PANEL_IDS.length)];
        const before = s;
        s = layoutReducer(s, { type: 'pick', slot, panel });
        invariantHolds(s);
        // The picked panel is now in the slot.
        expect(s.slots[slot]).toBe(panel);
        // Exactly the expected change: a swap keeps the set, a replace
        // trades one hidden panel for the old one.
        const was = before.slots.indexOf(panel);
        if (was >= 0 && was !== slot) {
          expect(s.slots[was]).toBe(before.slots[slot]);
          expect(new Set(s.slots)).toEqual(new Set(before.slots));
        } else if (was < 0) {
          expect(hiddenPanels(s.slots)).toContain(before.slots[slot]);
        }
      }
    }
  });
});

describe('layoutReducer: split', () => {
  const base = defaultLayout();

  it('sets one column and clamps into bounds', () => {
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: 0.5 }).split).toEqual({ left: 0.5, right: base.split.right });
    expect(layoutReducer(base, { type: 'split', column: 'right', ratio: 2 }).split.right).toBe(SPLIT_MAX);
    expect(layoutReducer(base, { type: 'split', column: 'right', ratio: -1 }).split.right).toBe(SPLIT_MIN);
  });

  it('ignores a non-finite ratio', () => {
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: Number.NaN })).toBe(base);
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: Number.POSITIVE_INFINITY })).toBe(base);
  });
});

describe('presets and reset', () => {
  it('every preset satisfies the invariant and has ratios in bounds', () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id].layout;
      expect(slotsValid(p.slots)).toBe(true);
      for (const r of [p.split.left, p.split.right]) {
        expect(r).toBeGreaterThanOrEqual(SPLIT_MIN);
        expect(r).toBeLessThanOrEqual(SPLIT_MAX);
      }
    }
  });

  it('Default is Markets / Trades | Chart / Orders', () => {
    expect(defaultLayout().slots).toEqual(['markets', 'trades', 'chart', 'orders']);
  });

  it('Scalper puts Trades and Orders on top and tall', () => {
    const s = PRESETS.scalper.layout;
    expect(s.slots[0]).toBe('trades');
    expect(s.slots[2]).toBe('orders');
    expect(s.split.left).toBeGreaterThan(0.5);
    expect(s.split.right).toBeGreaterThan(0.5);
  });

  it('Chart-heavy gives the chart most of its column', () => {
    const s = PRESETS['chart-heavy'].layout;
    const at = s.slots.indexOf('chart');
    const share = at === 0 ? s.split.left : at === 1 ? 1 - s.split.left : at === 2 ? s.split.right : 1 - s.split.right;
    expect(share).toBeGreaterThan(0.7);
  });

  it('applying a preset, then reset, returns exactly to Default', () => {
    let s = defaultLayout();
    s = layoutReducer(s, { type: 'pick', slot: 0, panel: 'balances' });
    s = layoutReducer(s, { type: 'split', column: 'left', ratio: 0.8 });
    s = layoutReducer(s, { type: 'apply', layout: presetLayout('scalper') });
    expect(matchingPreset(s)).toBe('scalper');
    s = layoutReducer(s, { type: 'apply', layout: defaultLayout() });
    expect(s).toEqual(defaultLayout());
    expect(matchingPreset(s)).toBe('default');
  });

  it('presets hand out copies: changing the state never edits a preset', () => {
    const s = presetLayout('default');
    (s.slots as unknown as PanelId[])[0] = 'fills';
    s.split.left = 0.9;
    expect(PRESETS.default.layout.slots[0]).toBe('markets');
    expect(PRESETS.default.layout.split.left).toBe(0.36);
  });

  it('apply refuses an invalid layout', () => {
    const base = defaultLayout();
    const dup = { slots: ['chart', 'chart', 'trades', 'orders'], split: { left: 0.5, right: 0.5 } } as unknown as LayoutState;
    expect(layoutReducer(base, { type: 'apply', layout: dup })).toBe(base);
    const badRatio = { slots: ['markets', 'trades', 'chart', 'orders'], split: { left: 5, right: 0.5 } } as unknown as LayoutState;
    expect(layoutReducer(base, { type: 'apply', layout: badRatio })).toBe(base);
  });
});
