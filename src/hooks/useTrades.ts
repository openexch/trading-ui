// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useRef } from 'react';
import type { TapeTrade, TradesBatchMessage } from '../types/market';

const MAX_TRADES = 50;

export function useTrades() {
  const [trades, setTrades] = useState<TapeTrade[]>([]);
  // Monotonic counter for stable row keys; the wire payload has no trade id.
  const seqRef = useRef(0);

  const handleTradesBatch = useCallback((message: TradesBatchMessage) => {
    // The batch is oldest-first: tag in order so newer trades get higher seq,
    // then reverse to newest-first and prepend. Existing rows keep their seq,
    // so keys are stable across batches (no remount).
    const tagged: TapeTrade[] = message.trades.map((t) => ({ ...t, seq: seqRef.current++ }));
    setTrades((prev) => [...tagged.reverse(), ...prev].slice(0, MAX_TRADES));
  }, []);

  const resetTrades = useCallback(() => {
    setTrades([]);
  }, []);

  return { trades, handleTradesBatch, resetTrades };
}
