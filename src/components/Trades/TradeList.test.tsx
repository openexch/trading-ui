// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Trade tape coloring: explicit taker side (market WS v5+) wins; without it
 * the tick fallback compares against the previous trade in time (the tape is
 * newest-first, so previous-in-time is the NEXT element). Equal prices and
 * the oldest row read as up-ticks (green).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TradeList } from './TradeList';
import type { TapeTrade } from '../../types/market';

let nextSeq = 0;
function trade(over: Partial<TapeTrade>): TapeTrade {
  return { price: 100, quantity: 1, tradeCount: 1, timestamp: 1000, seq: nextSeq++, ...over };
}

/** Price-cell color per row, top (newest) first. */
function rowColors(container: HTMLElement): ('buy' | 'sell' | 'none')[] {
  const priceSpans = [...container.querySelectorAll('span')].filter((s) =>
    s.textContent?.startsWith('$')
  );
  return priceSpans.map((s) =>
    s.className.includes('text-buy') ? 'buy' : s.className.includes('text-sell') ? 'sell' : 'none'
  );
}

describe('TradeList coloring', () => {
  beforeEach(() => {
    cleanup();
  });

  it('colors by explicit taker side when present', () => {
    const trades = [
      trade({ price: 99, side: 'BUY', timestamp: 3 }), // down-tick, but side wins
      trade({ price: 100, side: 'SELL', timestamp: 2 }),
      trade({ price: 90, side: 'BUY', timestamp: 1 }),
    ];
    const { container } = render(<TradeList trades={trades} />);
    expect(rowColors(container)).toEqual(['buy', 'sell', 'buy']);
  });

  it('falls back to the tick test when side is absent', () => {
    // Newest-first: 99 (vs 100 = down), 100 (vs 100 = equal → green),
    // 100 (vs 98 = up), 98 (oldest → green)
    const trades = [
      trade({ price: 99, timestamp: 4 }),
      trade({ price: 100, timestamp: 3 }),
      trade({ price: 100, timestamp: 2 }),
      trade({ price: 98, timestamp: 1 }),
    ];
    const { container } = render(<TradeList trades={trades} />);
    expect(rowColors(container)).toEqual(['sell', 'buy', 'buy', 'buy']);
  });

  it('treats a single (oldest) trade as an up-tick', () => {
    const { container } = render(<TradeList trades={[trade({ price: 123.45 })]} />);
    expect(rowColors(container)).toEqual(['buy']);
  });

  it('uses the tick fallback for null side (old gateway data)', () => {
    const trades = [
      trade({ price: 97, side: null, timestamp: 2 }),
      trade({ price: 98, side: null, timestamp: 1 }),
    ];
    const { container } = render(<TradeList trades={trades} />);
    expect(rowColors(container)).toEqual(['sell', 'buy']);
  });
});
