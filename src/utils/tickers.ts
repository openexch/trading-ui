// SPDX-License-Identifier: Apache-2.0
import type { MarketStats, TickerStatsMessage } from '../types/market';

/**
 * Other markets' tickers, from the gateway's all-market TICKERS frame.
 *
 * The map holds only markets the backend has actually priced in a TICKERS
 * frame: a market with no entry renders a dash (DESIGN.md rule 14). Against a
 * gateway that never sends TICKERS the map stays empty forever, so the UI is
 * exactly what it was before.
 *
 * Merge rules:
 * - An entry replaces the held one only if its timestamp is not older (a
 *   stale frame never rolls a price back).
 * - The selected market's own TICKER_STATS stream is fresher and always wins
 *   for that market (see marketRowStats); its frames also refresh the map,
 *   but only for a market TICKERS has already introduced, so a market the
 *   backend does not cover never shows a frozen last-seen price after a
 *   switch.
 * - A live TICKER_STATS seen before TICKERS introduced its market is not
 *   lost: when the TICKERS entry arrives older than it, the live value is
 *   kept instead, so switching away never shows an older price than the one
 *   just on screen.
 */
export interface TickerSnapshot extends MarketStats {
  /** Gateway time of the ticker's last update (TICKER_STATS `timestamp`). */
  timestamp: number;
}

export type TickerMap = ReadonlyMap<number, TickerSnapshot>;

export const EMPTY_TICKERS: TickerMap = new Map();

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate one TICKERS entry; anything malformed or unpriced is dropped. */
export function parseTickerEntry(raw: unknown): [number, TickerSnapshot] | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const { marketId, lastPrice, priceChange, priceChangePercent, high24h, low24h, volume24h, timestamp } = o;
  if (!finite(marketId) || !Number.isInteger(marketId) || marketId <= 0) return null;
  if (!finite(lastPrice) || lastPrice <= 0) return null;
  if (!finite(priceChange) || !finite(priceChangePercent) || !finite(high24h) ||
      !finite(low24h) || !finite(volume24h) || !finite(timestamp)) {
    return null;
  }
  return [marketId, { lastPrice, priceChange, priceChangePercent, high24h, low24h, volume24h, timestamp }];
}

function sameSnapshot(a: TickerSnapshot, b: TickerSnapshot): boolean {
  return a.timestamp === b.timestamp && a.lastPrice === b.lastPrice && a.priceChange === b.priceChange &&
    a.priceChangePercent === b.priceChangePercent && a.high24h === b.high24h && a.low24h === b.low24h &&
    a.volume24h === b.volume24h;
}

function put(next: Map<number, TickerSnapshot> | null, prev: TickerMap, id: number, snap: TickerSnapshot) {
  const held = (next ?? prev).get(id);
  if (held && (snap.timestamp < held.timestamp || sameSnapshot(held, snap))) return next;
  const out = next ?? new Map(prev);
  out.set(id, snap);
  return out;
}

/** Merge a TICKERS frame's entries. `liveSeen` is the latest live
 *  TICKER_STATS per market; an entry older than it is replaced by it.
 *  Returns `prev` itself when nothing changed, so a repeated frame does not
 *  re-render. */
export function mergeTickers(prev: TickerMap, entries: unknown, liveSeen: TickerMap = EMPTY_TICKERS): TickerMap {
  if (!Array.isArray(entries)) return prev;
  let next: Map<number, TickerSnapshot> | null = null;
  for (const raw of entries) {
    const parsed = parseTickerEntry(raw);
    if (!parsed) continue;
    const [id, snap] = parsed;
    const seen = liveSeen.get(id);
    next = put(next, prev, id, seen && seen.timestamp > snap.timestamp ? seen : snap);
  }
  return next ?? prev;
}

/** Record a live TICKER_STATS in the `liveSeen` map (mutated in place:
 *  it is bookkeeping, never rendered). Forward in time only. */
export function recordLiveTicker(liveSeen: Map<number, TickerSnapshot>, msg: TickerStatsMessage): void {
  const parsed = parseTickerEntry(msg);
  if (!parsed) return;
  const held = liveSeen.get(parsed[0]);
  if (!held || parsed[1].timestamp >= held.timestamp) liveSeen.set(parsed[0], parsed[1]);
}

/** Fold a per-market TICKER_STATS into the map, only for a market TICKERS
 *  already covers, and never backwards in time. */
export function mergeLiveTicker(prev: TickerMap, msg: TickerStatsMessage): TickerMap {
  if (!prev.has(msg.marketId)) return prev;
  const parsed = parseTickerEntry(msg);
  if (!parsed) return prev;
  return put(null, prev, parsed[0], parsed[1]) ?? prev;
}

/**
 * The stats a market row shows. The selected market uses its own live
 * ticker whenever it has one (a TICKERS entry never overrides it); until that
 * arrives, e.g. just after a switch, its TICKERS entry fills in. Every other
 * market shows its TICKERS entry, or null (a dash) when it has none.
 */
export function marketRowStats(
  marketId: number,
  selectedId: number,
  liveStats: MarketStats | null,
  tickers: TickerMap,
): MarketStats | null {
  if (marketId === selectedId && liveStats !== null && liveStats.lastPrice > 0) return liveStats;
  return tickers.get(marketId) ?? null;
}
