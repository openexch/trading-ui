// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  SPLIT_MAX,
  SPLIT_MIN,
  columnOf,
  hiddenPanels,
  layoutReducer,
  slotsValid,
  visibleColumns,
  visibleSlots,
} from './layoutReducer';
import type { LayoutMode, LayoutState, SlotIndex } from './layoutReducer';
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
  expect(s.slots).toHaveLength(6);
  // Six distinct known panels; the registry's others are closed.
  expect(new Set(s.slots).size).toBe(6);
  for (const p of s.slots) expect(PANEL_IDS).toContain(p);
}

/** What a mode shows: the visible slots' panels, in slot order. */
const shown = (s: LayoutState, mode: LayoutMode) => visibleSlots(mode).map(i => s.slots[i]);

describe('slots and modes', () => {
  it('standard shows slots 0-3 (left, right); wide shows all six (left, right, far right)', () => {
    expect(visibleSlots('standard')).toEqual([0, 1, 2, 3]);
    expect(visibleSlots('wide')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visibleColumns('standard')).toEqual(['left', 'right']);
    expect(visibleColumns('wide')).toEqual(['left', 'right', 'farRight']);
    expect(([0, 1, 2, 3, 4, 5] as SlotIndex[]).map(columnOf)).toEqual(['left', 'left', 'right', 'right', 'farRight', 'farRight']);
  });

  it('standard mode hides the far-right column; wide hides nothing', () => {
    const d = defaultLayout();
    expect(shown(d, 'standard')).toEqual(['markets', 'trades', 'chart', 'orders']);
    expect(hiddenPanels(d.slots, 'standard')).toEqual(['fills', 'balances']);
    expect(hiddenPanels(d.slots, 'wide')).toEqual([]);
  });
});

describe('layoutReducer: pick', () => {
  const base = defaultLayout(); // markets, trades | chart, orders | fills, balances

  it('picking the panel already in the slot changes nothing', () => {
    expect(layoutReducer(base, { type: 'pick', slot: 0, panel: 'markets' })).toBe(base);
    expect(layoutReducer(base, { type: 'pick', slot: 5, panel: 'balances' })).toBe(base);
  });

  it('picking a panel open in another slot swaps the two', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 1, panel: 'chart' });
    expect(s.slots).toEqual(['markets', 'chart', 'trades', 'orders', 'fills', 'balances']);
    // Within one column too.
    const t = layoutReducer(base, { type: 'pick', slot: 0, panel: 'trades' });
    expect(t.slots).toEqual(['trades', 'markets', 'chart', 'orders', 'fills', 'balances']);
    // Wide: across into the far-right column.
    const u = layoutReducer(base, { type: 'pick', slot: 4, panel: 'markets' });
    expect(u.slots).toEqual(['fills', 'trades', 'chart', 'orders', 'markets', 'balances']);
  });

  it('standard: picking a hidden panel replaces the current one, which becomes hidden in its place', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 3, panel: 'fills' });
    expect(s.slots).toEqual(['markets', 'trades', 'chart', 'fills', 'orders', 'balances']);
    // As before wide mode: the view shows the picked panel, the old one is hidden.
    expect(shown(s, 'standard')).toEqual(['markets', 'trades', 'chart', 'fills']);
    expect(hiddenPanels(s.slots, 'standard')).toEqual(['orders', 'balances']);
    // Picking the old one back restores the exact layout (hidden places too).
    expect(layoutReducer(s, { type: 'pick', slot: 3, panel: 'orders' })).toEqual(base);
  });

  it('a pick never changes the split (sizes move only by handle, preset or reset)', () => {
    const s = layoutReducer(base, { type: 'pick', slot: 2, panel: 'balances' });
    expect(s.split).toEqual(base.split);
  });

  it('ignores unknown panels and slots', () => {
    expect(layoutReducer(base, { type: 'pick', slot: 0, panel: 'ladder' as PanelId })).toBe(base);
    expect(layoutReducer(base, { type: 'pick', slot: 7 as SlotIndex, panel: 'fills' })).toBe(base);
    expect(layoutReducer(base, { type: 'pick', slot: -1 as SlotIndex, panel: 'fills' })).toBe(base);
    expect(layoutReducer(base, { type: 'pick', slot: 1.5 as SlotIndex, panel: 'fills' })).toBe(base);
  });

  it.each<[LayoutMode, number]>([
    ['standard', 4],
    ['wide', 6],
  ])('fuzz (%s, picks from %i slots): every panel at most once, picks swap or replace', (mode, count) => {
    const slotsOfMode = visibleSlots(mode);
    expect(slotsOfMode).toHaveLength(count);
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      let s: LayoutState = presetLayout(PRESET_IDS[seed % PRESET_IDS.length]);
      for (let i = 0; i < 500; i++) {
        const slot = slotsOfMode[Math.floor(r() * slotsOfMode.length)];
        const panel = PANEL_IDS[Math.floor(r() * PANEL_IDS.length)];
        const before = s;
        s = layoutReducer(s, { type: 'pick', slot, panel });
        invariantHolds(s);
        expect(s.slots[slot]).toBe(panel);
        const was = before.slots.indexOf(panel);
        if (was < 0) {
          // A closed panel replaces the slot's panel, which closes.
          expect(s.slots).not.toContain(before.slots[slot]);
          s.slots.forEach((p, j) => {
            if (j !== slot) expect(p).toBe(before.slots[j]);
          });
        } else if (was !== slot) {
          // Exactly a swap: the old panel took the picked one's place.
          expect(s.slots[was]).toBe(before.slots[slot]);
          s.slots.forEach((p, j) => {
            if (j !== slot && j !== was) expect(p).toBe(before.slots[j]);
          });
          // Seen from the mode: visible-to-visible keeps the shown set; a
          // hidden pick trades the picked panel for the old one.
          if (!slotsOfMode.includes(was as SlotIndex)) {
            expect(hiddenPanels(s.slots, mode)).toContain(before.slots[slot]);
          }
        }
      }
    }
  });
});

describe('crossing the breakpoint', () => {
  it('a six-slot layout survives standard mode and comes back when the window widens', () => {
    // Set up a wide layout.
    let s = defaultLayout();
    s = layoutReducer(s, { type: 'pick', slot: 4, panel: 'chart' }); // chart far right top
    s = layoutReducer(s, { type: 'split', column: 'farRight', ratio: 0.8 });
    const wide = s;
    expect(wide.slots).toEqual(['markets', 'trades', 'fills', 'orders', 'chart', 'balances']);

    // Narrow: the first four show; the far-right pair is kept, not lost.
    expect(shown(wide, 'standard')).toEqual(['markets', 'trades', 'fills', 'orders']);
    expect(hiddenPanels(wide.slots, 'standard')).toEqual(['chart', 'balances']);

    // Widen again with no change in between: identical.
    expect(shown(wide, 'wide')).toEqual(wide.slots);

    // A change in standard mode that does not touch the hidden pair keeps it.
    const t = layoutReducer(wide, { type: 'pick', slot: 0, panel: 'trades' });
    expect(t.slots.slice(4)).toEqual(['chart', 'balances']);
    expect(t.split.farRight).toBe(0.8);
    // Picking a hidden panel in standard mode swaps with its hidden slot.
    const u = layoutReducer(t, { type: 'pick', slot: 2, panel: 'chart' });
    expect(u.slots).toEqual(['trades', 'markets', 'chart', 'orders', 'fills', 'balances']);
    invariantHolds(u);
  });
});

describe('closed panels', () => {
  it('Default leaves Engines closed; picking it replaces the slot panel, and picking that back swaps nothing else', () => {
    const s = defaultLayout();
    expect(s.slots).not.toContain('engines');
    const t = layoutReducer(s, { type: 'pick', slot: 3, panel: 'engines' });
    expect(t.slots).toEqual(['markets', 'trades', 'chart', 'engines', 'fills', 'balances']);
    invariantHolds(t);
    const u = layoutReducer(t, { type: 'pick', slot: 3, panel: 'orders' });
    expect(u.slots).toEqual(s.slots);
  });
});

describe('layoutReducer: split', () => {
  const base = defaultLayout();

  it('sets one column and clamps into bounds', () => {
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: 0.5 }).split).toEqual({ ...base.split, left: 0.5 });
    expect(layoutReducer(base, { type: 'split', column: 'farRight', ratio: 0.3 }).split).toEqual({ ...base.split, farRight: 0.3 });
    expect(layoutReducer(base, { type: 'split', column: 'right', ratio: 2 }).split.right).toBe(SPLIT_MAX);
    expect(layoutReducer(base, { type: 'split', column: 'right', ratio: -1 }).split.right).toBe(SPLIT_MIN);
  });

  it('ignores a non-finite ratio and an unknown column', () => {
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: Number.NaN })).toBe(base);
    expect(layoutReducer(base, { type: 'split', column: 'left', ratio: Number.POSITIVE_INFINITY })).toBe(base);
    expect(layoutReducer(base, { type: 'split', column: 'middle' as 'left', ratio: 0.5 })).toBe(base);
  });
});

describe('presets and reset', () => {
  it('every preset satisfies the invariant and has ratios in bounds', () => {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id].layout;
      expect(slotsValid(p.slots)).toBe(true);
      for (const r of [p.split.left, p.split.right, p.split.farRight]) {
        expect(r).toBeGreaterThanOrEqual(SPLIT_MIN);
        expect(r).toBeLessThanOrEqual(SPLIT_MAX);
      }
    }
  });

  it('standard mode shows exactly the four-slot presets from before wide mode', () => {
    const before: Record<string, { slots: PanelId[]; left: number; right: number }> = {
      default: { slots: ['markets', 'trades', 'chart', 'orders'], left: 0.36, right: 0.58 },
      scalper: { slots: ['trades', 'markets', 'orders', 'chart'], left: 0.7, right: 0.66 },
      'chart-heavy': { slots: ['markets', 'trades', 'chart', 'orders'], left: 0.36, right: 0.78 },
    };
    for (const id of PRESET_IDS) {
      const p = presetLayout(id);
      expect(shown(p, 'standard')).toEqual(before[id].slots);
      expect([p.split.left, p.split.right]).toEqual([before[id].left, before[id].right]);
    }
  });

  it('Default is Markets / Trades | Chart / Orders | Fills / Balances', () => {
    expect(defaultLayout().slots).toEqual(['markets', 'trades', 'chart', 'orders', 'fills', 'balances']);
  });

  it('Scalper puts Trades and Orders on top and tall, and Fills tall', () => {
    const s = PRESETS.scalper.layout;
    expect(s.slots[0]).toBe('trades');
    expect(s.slots[2]).toBe('orders');
    expect(s.slots[4]).toBe('fills');
    expect(s.split.left).toBeGreaterThan(0.5);
    expect(s.split.right).toBeGreaterThan(0.5);
    expect(s.split.farRight).toBeGreaterThan(0.5);
  });

  it('Chart-heavy gives the chart most of its column', () => {
    const s = PRESETS['chart-heavy'].layout;
    const at = s.slots.indexOf('chart') as SlotIndex;
    const col = columnOf(at);
    const share = at % 2 === 0 ? s.split[col] : 1 - s.split[col];
    expect(share).toBeGreaterThan(0.7);
  });

  it('applying a preset, then reset, returns exactly to Default', () => {
    let s = defaultLayout();
    s = layoutReducer(s, { type: 'pick', slot: 0, panel: 'balances' });
    s = layoutReducer(s, { type: 'split', column: 'left', ratio: 0.8 });
    s = layoutReducer(s, { type: 'apply', layout: presetLayout('scalper') });
    expect(matchingPreset(s, 'wide')).toBe('scalper');
    s = layoutReducer(s, { type: 'apply', layout: defaultLayout() });
    expect(s).toEqual(defaultLayout());
    expect(matchingPreset(s, 'wide')).toBe('default');
  });

  it('matching counts only what the mode shows', () => {
    // The hidden pair swapped: standard still looks like Default, wide does not.
    const s = layoutReducer(defaultLayout(), { type: 'pick', slot: 4, panel: 'balances' });
    expect(matchingPreset(s, 'standard')).toBe('default');
    expect(matchingPreset(s, 'wide')).toBeNull();
    const t = layoutReducer(defaultLayout(), { type: 'split', column: 'farRight', ratio: 0.2 });
    expect(matchingPreset(t, 'standard')).toBe('default');
    expect(matchingPreset(t, 'wide')).toBeNull();
  });

  it('presets hand out copies: changing the state never edits a preset', () => {
    const s = presetLayout('default');
    (s.slots as unknown as PanelId[])[0] = 'fills';
    s.split.left = 0.9;
    s.split.farRight = 0.1;
    expect(PRESETS.default.layout.slots[0]).toBe('markets');
    expect(PRESETS.default.layout.split.left).toBe(0.36);
    expect(PRESETS.default.layout.split.farRight).toBe(0.6);
  });

  it('apply refuses an invalid layout', () => {
    const base = defaultLayout();
    const bad = (layout: unknown) => layoutReducer(base, { type: 'apply', layout: layout as LayoutState });
    const split = { left: 0.5, right: 0.5, farRight: 0.5 };
    expect(bad({ slots: ['chart', 'chart', 'trades', 'orders', 'fills', 'balances'], split })).toBe(base);
    expect(bad({ slots: ['markets', 'trades', 'chart', 'orders'], split })).toBe(base);
    expect(bad({ slots: base.slots, split: { left: 5, right: 0.5, farRight: 0.5 } })).toBe(base);
    expect(bad({ slots: base.slots, split: { left: 0.5, right: 0.5 } })).toBe(base);
    expect(bad(null)).toBe(base);
  });
});
