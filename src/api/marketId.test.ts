// SPDX-License-Identifier: Apache-2.0
/** The one marketId mapping: API decimal string <-> market-frame number. */
import { describe, it, expect } from 'vitest';
import { marketIdFromApi, marketIdToApi } from './marketId';

describe('marketId mapping', () => {
  it('maps the API string to the frame number and back', () => {
    expect(marketIdFromApi('3')).toBe(3);
    expect(marketIdToApi(3)).toBe('3');
    expect(marketIdFromApi(marketIdToApi(2147483647))).toBe(2147483647);
  });

  it('refuses a JSON number where the API sends a string', () => {
    expect(() => marketIdFromApi(3)).toThrow('marketId is not a decimal id string');
  });

  it('refuses non-canonical and out-of-range ids', () => {
    for (const bad of ['', '0', '03', '-1', '1.0', ' 1', '1e3', 'abc']) {
      expect(() => marketIdFromApi(bad), bad).toThrow();
    }
    expect(() => marketIdFromApi('2147483648')).toThrow('out of range');
    for (const bad of [0, -1, 1.5, 2147483648, Number.NaN]) {
      expect(() => marketIdToApi(bad), String(bad)).toThrow();
    }
  });
});
