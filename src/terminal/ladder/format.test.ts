// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { formatFixed, sharedPrefixLength, splitBigFigure } from './format';

const fmt = (prices: number[], d: number) => prices.map(p => formatFixed(p, d));

describe('sharedPrefixLength (the big figure)', () => {
  it('splits rungs that share their leading digits: "106,6" quiet, "01.5" strong', () => {
    const texts = fmt([106_612.0, 106_607.5, 106_601.5], 1);
    const n = sharedPrefixLength(texts);
    expect(n).toBe(5);
    expect(splitBigFigure('106,601.5', n)).toEqual({ quiet: '106,6', strong: '01.5' });
  });

  it('keeps the thousands separator with the quiet part when the digits differ after it', () => {
    const texts = fmt([97_412, 97_388, 97_301], 0);
    expect(texts).toEqual(['97,412', '97,388', '97,301']);
    expect(sharedPrefixLength(texts)).toBe(3); // "97,"
  });

  it('works with decimals only differing (small-price markets)', () => {
    const texts = fmt([0.3812, 0.3809, 0.3801], 4);
    expect(sharedPrefixLength(texts)).toBe(4); // "0.38"
  });

  it('prints nothing quiet when every rung is the same string', () => {
    expect(sharedPrefixLength(['106,601.5', '106,601.5', '106,601.5'])).toBe(0);
  });

  it('prints nothing quiet for a single rung or none', () => {
    expect(sharedPrefixLength(['106,601.5'])).toBe(0);
    expect(sharedPrefixLength([])).toBe(0);
  });

  it('prints nothing quiet across a decade boundary (99,999 to 100,001)', () => {
    const texts = fmt([100_001, 100_000, 99_999], 0);
    expect(texts).toEqual(['100,001', '100,000', '99,999']);
    expect(sharedPrefixLength(texts)).toBe(0);
  });

  it('does not line up characters across lengths even when they match by accident', () => {
    // "1,234" and "12,345" share a leading "1" that is not the same place value.
    expect(sharedPrefixLength(['1,234', '12,345'])).toBe(0);
  });

  it('handles coarser grouping: the window strings are what counts', () => {
    // Grouped by 10: 106,610 / 106,600 / 106,590.
    const texts = fmt([106_610, 106_600, 106_590], 0);
    expect(sharedPrefixLength(texts)).toBe(4); // "106,"
    // Grouped by 100 across a thousand: 107,000 / 106,900.
    expect(sharedPrefixLength(fmt([107_000, 106_900], 0))).toBe(2); // "10"
  });

  it('the split always reproduces the same string, with a non-empty strong tail', () => {
    for (const [text, n] of [['106,601.5', 5], ['106,601.5', 0], ['5', 1], ['42', 9]] as const) {
      const { quiet, strong } = splitBigFigure(text, n);
      expect(quiet + strong).toBe(text);
      expect(strong.length).toBeGreaterThan(0);
    }
  });
});
