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

/**
 * The "big figure": how many leading characters every price string in a
 * window shares, so the ladder can print them quietly and keep the differing
 * tail strong, as FX ladders do ("106,6" quiet, "01.5" strong).
 *
 * Computed once per visible window from the rendered strings, so grouping,
 * decimals and thousands separators are whatever the column prints. The
 * prefix is 0 (nothing quiet) when:
 * - there are fewer than two distinct strings (one rung, or every rung the
 *   same): nothing differs, so the whole price stays strong;
 * - the strings differ in length, as across a decade boundary
 *   ("99,999" / "100,001"): their characters do not line up by place value.
 * Otherwise the tail starts on the first character that differs, so it is
 * never empty.
 */
export function sharedPrefixLength(texts: readonly string[]): number {
  if (texts.length < 2) return 0;
  const first = texts[0];
  let distinct = false;
  for (const t of texts) {
    if (t.length !== first.length) return 0;
    if (t !== first) distinct = true;
  }
  if (!distinct) return 0;
  let n = 0;
  while (n < first.length && texts.every(t => t[n] === first[n])) n++;
  return n;
}

/** Split a price string at the shared prefix length (clamped to the string). */
export function splitBigFigure(text: string, prefix: number): { quiet: string; strong: string } {
  const n = Math.max(0, Math.min(prefix, text.length - 1));
  return { quiet: text.slice(0, n), strong: text.slice(n) };
}
