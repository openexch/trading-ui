// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Ticker rail during a market switch: stats are null until the new market's
 * TICKER_STATS lands — every value renders a pulsing placeholder, and a
 * misleading $0.00 must never appear.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MarketStats } from './MarketStats';
import { MARKETS } from '../../types/market';
import type { OrderBook } from '../../types/market';

const emptyBook: OrderBook = { bids: [], asks: [], lastUpdate: 0 };

describe('MarketStats null-stats placeholders', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders dashes, not $0.00, while stats are null', () => {
    const { container } = render(
      <MarketStats market={MARKETS[0]} stats={null} orderBook={emptyBook} />
    );
    expect(container.textContent).not.toContain('$0.00');
    expect(container.textContent).toContain('—');
    // Symbol/name still swap instantly
    expect(container.textContent).toContain('BTC-USD');
  });

  it('shows dashes even when the book still has (stale) levels', () => {
    const staleBook: OrderBook = {
      bids: [{ price: 97000, quantity: 1, orderCount: 1 }],
      asks: [{ price: 97010, quantity: 1, orderCount: 1 }],
      lastUpdate: 1,
    };
    const { container } = render(
      <MarketStats market={MARKETS[0]} stats={null} orderBook={staleBook} />
    );
    // Null stats win over the book fallback for the headline price
    expect(container.textContent).not.toContain('$97,000.00');
    expect(container.textContent).toContain('—');
  });

  it('renders real values once stats arrive', () => {
    const { container } = render(
      <MarketStats
        market={MARKETS[0]}
        stats={{
          lastPrice: 97000,
          priceChange: 1200,
          priceChangePercent: 1.25,
          high24h: 98000,
          low24h: 95000,
          volume24h: 1234567,
        }}
        orderBook={emptyBook}
      />
    );
    expect(container.textContent).toContain('$97,000.00');
    expect(container.textContent).toContain('(+1.25%)');
    expect(container.textContent).toContain('$98,000.00');
  });
});
