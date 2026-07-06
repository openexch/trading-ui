// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback } from 'react';
import type { MarketStats, AggregatedTrade, BookLevel } from '../types/market';

/**
 * Hook for managing market ticker stats.
 * Stats are primarily received from the server via TICKER_STATS messages.
 * handleTrades and handleBookUpdate provide fallback updates for last price.
 *
 * `stats` is null until the first TICKER_STATS for the current market lands
 * (and again after resetStats on a market switch) — the ticker rail renders
 * placeholders for null instead of a misleading $0.00.
 */
export function useMarketStats() {
  const [stats, setStats] = useState<MarketStats | null>(null);

  // Fallback: update lastPrice from trades if TICKER_STATS hasn't arrived yet.
  // A null baseline stays null — partial stats would render as fake zeros.
  const handleTrades = useCallback((trades: AggregatedTrade[]) => {
    if (trades.length === 0) return;
    const lastTrade = trades[trades.length - 1];
    setStats(prev => (prev ? { ...prev, lastPrice: lastTrade.price } : prev));
  }, []);

  // Fallback: update lastPrice from mid-market if no trades yet
  const handleBookUpdate = useCallback((bids: BookLevel[], asks: BookLevel[]) => {
    if (bids.length > 0 && asks.length > 0) {
      setStats(prev => {
        // Only update if we have stats but no price yet
        if (prev && prev.lastPrice === 0) {
          const midPrice = (bids[0].price + asks[0].price) / 2;
          return { ...prev, lastPrice: midPrice };
        }
        return prev;
      });
    }
  }, []);

  const resetStats = useCallback(() => {
    setStats(null);
  }, []);

  return {
    stats,
    setStats,  // Exposed for direct updates from TICKER_STATS messages
    handleTrades,
    handleBookUpdate,
    resetStats,
  };
}
