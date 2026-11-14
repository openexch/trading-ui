// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { MARKETS } from '../types/market';
import { marketUi, groupingOptions, groupSize, GROUPING_MULTIPLIERS, isGroupingMultiplier } from './marketUi';

describe('marketUi', () => {
  it('every listed market has presets, a valid default preset and a valid default grouping', () => {
    for (const m of MARKETS) {
      const ui = marketUi(m);
      expect(ui.sizePresets.length, m.symbol).toBeGreaterThan(0);
      expect(ui.defaultPresetIndex, m.symbol).not.toBeNull();
      expect(ui.sizePresets[ui.defaultPresetIndex!], m.symbol).toBeGreaterThan(0);
      expect([...ui.sizePresets].sort((a, b) => a - b), m.symbol).toEqual(ui.sizePresets);
      expect(GROUPING_MULTIPLIERS, m.symbol).toContain(ui.defaultGrouping);
    }
  });

  it('BTC presets match the approved design', () => {
    const ui = marketUi(MARKETS[0]);
    expect(ui.sizePresets).toEqual([0.1, 0.25, 1]);
    expect(ui.sizePresets[ui.defaultPresetIndex!]).toBe(0.25);
  });

  it('an unknown market gets no invented presets', () => {
    const ui = marketUi({ symbol: 'NEW-USD' });
    expect(ui.sizePresets).toEqual([]);
    expect(ui.defaultPresetIndex).toBeNull();
    expect(ui.defaultGrouping).toBe(1);
  });
});

describe('grouping', () => {
  const cases: Array<[string, number[], string[]]> = [
    ['BTC-USD', [1, 5, 10, 25, 100], ['1', '5', '10', '25', '100']],
    ['ETH-USD', [0.5, 2.5, 5, 12.5, 50], ['0.5', '2.5', '5', '12.5', '50']],
    ['SOL-USD', [0.05, 0.25, 0.5, 1.25, 5], ['0.05', '0.25', '0.5', '1.25', '5']],
    ['XRP-USD', [0.001, 0.005, 0.01, 0.025, 0.1], ['0.001', '0.005', '0.01', '0.025', '0.1']],
    ['DOGE-USD', [0.0001, 0.0005, 0.001, 0.0025, 0.01], ['0.0001', '0.0005', '0.001', '0.0025', '0.01']],
  ];
  it.each(cases)('%s group sizes are float-exact', (symbol, sizes, labels) => {
    const m = MARKETS.find(x => x.symbol === symbol)!;
    const opts = groupingOptions(m);
    expect(opts.map(o => o.multiplier)).toEqual([...GROUPING_MULTIPLIERS]);
    expect(opts.map(o => o.size)).toEqual(sizes);
    expect(opts.map(o => o.label)).toEqual(labels);
  });

  it('naive multiplication would drift; groupSize does not', () => {
    // 0.0001 * 3 is 0.00030000000000000003 in floating point.
    expect(groupSize({ tickSize: 0.0001 }, 3)).toBe(0.0003);
    expect(groupSize({ tickSize: 0.001 }, 7)).toBe(0.007);
  });

  it('isGroupingMultiplier', () => {
    expect(isGroupingMultiplier(25)).toBe(true);
    expect(isGroupingMultiplier(2)).toBe(false);
  });
});
