// SPDX-License-Identifier: Apache-2.0
/**
 * Decimal strings on the wire, numbers in UI state.
 *
 * The v2 API and the market-data service send prices, quantities and volumes
 * as decimal strings with at most 8 fraction digits, no sign and no exponent
 * ("65000.5", "0.00000001"). UI state holds JS numbers for display; the
 * server never trusts client arithmetic. A JSON number, a signed value or an
 * exponent is refused: it means the wire contract changed.
 */

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;

/** True for a well-formed wire decimal string. */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value);
}

/** Parse one wire decimal. Throws `<field> is not a decimal string`. */
export function parseDecimal(value: unknown, field: string): number {
  if (!isDecimalString(value)) throw new Error(`${field} is not a decimal string`);
  return Number(value);
}

/** Same, with `null` passed through (optional money fields of an Order). */
export function parseOptionalDecimal(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : parseDecimal(value, field);
}
