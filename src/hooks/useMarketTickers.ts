// SPDX-License-Identifier: Apache-2.0
import { useCallback, useRef, useState } from 'react';
import type { TickerStatsMessage, TickersMessage } from '../types/market';
import { EMPTY_TICKERS, mergeLiveTicker, mergeTickers, recordLiveTicker } from '../utils/tickers';
import type { TickerMap, TickerSnapshot } from '../utils/tickers';

/**
 * Per-market ticker map fed by the all-market TICKERS frame (see
 * utils/tickers.ts for the merge rules). Kept across market switches so the
 * market list never flickers back to dashes; cleared on reconnect, when every
 * other piece of market state is reset too.
 */
export function useMarketTickers() {
  const [tickers, setTickers] = useState<TickerMap>(EMPTY_TICKERS);
  // Latest live TICKER_STATS per market (bounded by the market count), so a
  // TICKERS entry older than what was already on screen never wins.
  const liveSeenRef = useRef(new Map<number, TickerSnapshot>());

  const handleTickers = useCallback((msg: TickersMessage) => {
    const liveSeen = liveSeenRef.current;
    setTickers(prev => mergeTickers(prev, msg.tickers, liveSeen));
  }, []);

  const handleTickerStats = useCallback((msg: TickerStatsMessage) => {
    recordLiveTicker(liveSeenRef.current, msg);
    setTickers(prev => mergeLiveTicker(prev, msg));
  }, []);

  const resetTickers = useCallback(() => {
    liveSeenRef.current = new Map();
    setTickers(EMPTY_TICKERS);
  }, []);

  return { tickers, handleTickers, handleTickerStats, resetTickers };
}
