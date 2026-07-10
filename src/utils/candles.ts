import type { CandleData } from '../types/market';

/**
 * Merge a live CANDLE_UPDATE into the history array so the array itself is always
 * authoritative for the live bucket.
 *
 * The chart renders the history array with the live candle overlaid on the current
 * bucket. That overlay only covers the CURRENT bucket, so if same-bucket updates are
 * not written back into history, a candle reverts to its first-tick value the instant
 * a newer bucket arrives and the overlay moves on — the "live candle settles to a
 * different number" bug. Keeping the last element in sync on every tick fixes it: when
 * the next bucket appends, the prior element already holds its final value.
 *
 * Rules:
 *  - empty history            → [update]
 *  - update.time  >  last.time → append (bounded to maxLen from the tail)
 *  - update.time === last.time → replace the last element in place (final value wins)
 *  - update.time  <  last.time → ignore (out-of-order / replayed tick)
 */
export function mergeLiveCandle(
  prev: CandleData[],
  update: CandleData,
  maxLen: number,
): CandleData[] {
  if (prev.length === 0) return [update];
  const last = prev[prev.length - 1];

  if (update.time > last.time) {
    const next = [...prev, update];
    return next.length > maxLen ? next.slice(next.length - maxLen) : next;
  }

  if (update.time === last.time) {
    const next = prev.slice();
    next[next.length - 1] = update;
    return next;
  }

  return prev;
}
