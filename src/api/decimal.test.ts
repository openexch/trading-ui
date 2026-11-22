// SPDX-License-Identifier: Apache-2.0
/** Decimal strings of the wire: at most 8 fraction digits, no sign, no exponent. */
import { describe, it, expect } from 'vitest';
import { isDecimalString, parseDecimal, parseOptionalDecimal } from './decimal';

describe('decimal-string parse', () => {
  it('parses the gateway forms', () => {
    expect(parseDecimal('65000.5', 'price')).toBe(65000.5);
    expect(parseDecimal('0.00000001', 'quantity')).toBe(0.00000001);
    expect(parseDecimal('1', 'x')).toBe(1);
    expect(parseDecimal('0', 'x')).toBe(0);
    expect(parseOptionalDecimal(null, 'price')).toBeNull();
  });

  it('refuses a JSON number, a sign, an exponent and a 9th fraction digit, naming the field', () => {
    expect(() => parseDecimal(65000.5, 'price')).toThrow('price is not a decimal string');
    for (const bad of ['-1', '+1', '1e3', '1.000000001', '.5', '5.', '01', '', ' 1']) {
      expect(isDecimalString(bad), bad).toBe(false);
    }
  });
});
