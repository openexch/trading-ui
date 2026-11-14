// SPDX-License-Identifier: Apache-2.0
// Number formatting for the ladder and the header ticker. Prices print at the
// market tick's precision ("97,412" for BTC, "0.3812" for DOGE); sizes at the
// market's size precision from marketUi.

export function formatFixed(value: number, decimals: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A size for a chip or marker: trailing zeros trimmed, at least two
 *  decimals when the market has them ("0.30", "1.25", "5,000"). */
export function formatCompactSize(value: number, sizeDecimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, sizeDecimals),
    maximumFractionDigits: sizeDecimals,
  });
}

/** A spread or ratio label: at most two decimals, none when whole. */
export function formatSmall(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
