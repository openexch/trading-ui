// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { MarketStats as Stats, Market, OrderBook } from '../../types/market';
import { formatPrice, formatQuantity } from '../../utils/formatters';

interface MarketStatsProps {
  market: Market;
  /** Null until the first TICKER_STATS for the current market arrives —
   *  values render as pulsing placeholders, never a misleading $0.00. */
  stats: Stats | null;
  orderBook: OrderBook;
}

/** Pulsing placeholder for a value that hasn't arrived yet. */
function Pending() {
  return <span className="animate-pulse text-faint">—</span>;
}

/**
 * Ticker rail — the page's signature element. The symbol is set in the display
 * grotesk against a thin accent rule; the live price flashes on each tick.
 */
export function MarketStats({ market, stats, orderBook }: MarketStatsProps) {
  const hasBook = orderBook.bids.length > 0 && orderBook.asks.length > 0;
  const spread = hasBook ? orderBook.asks[0].price - orderBook.bids[0].price : 0;
  const spreadPercent = hasBook && spread > 0
    ? (spread / orderBook.asks[0].price) * 100
    : 0;

  const priceChange = stats?.priceChange ?? 0;
  const priceChangePercent = stats?.priceChangePercent ?? 0;
  const isPositive = priceChange >= 0;

  // Null stats = market switch in flight: show placeholders even if the book
  // briefly still carries data (the book is reset on switch too).
  const lastPrice = stats ? stats.lastPrice || orderBook.bids[0]?.price || 0 : null;

  // Directional tick flash on price change.
  const prevPrice = useRef(lastPrice);
  const [tick, setTick] = useState<'up' | 'down' | null>(null);
  // Direction of the LAST move — persistent, so the arrow never appears and
  // disappears (that made the whole price jitter sideways every tick).
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (lastPrice === null) {
      prevPrice.current = null;
      return;
    }
    if (prevPrice.current !== null) {
      if (lastPrice > prevPrice.current) { setTick('up'); setDir('up'); }
      else if (lastPrice < prevPrice.current) { setTick('down'); setDir('down'); }
    }
    prevPrice.current = lastPrice;
    const id = window.setTimeout(() => setTick(null), 500);
    return () => window.clearTimeout(id);
  }, [lastPrice]);

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto rounded-lg border border-hairline bg-surface">
      {/* Signature block: symbol + live price against an accent rule */}
      <div className="flex flex-shrink-0 items-center gap-4 border-l-2 border-accent px-4 py-2">
        <div className="flex flex-col">
          <span className="font-display text-base font-bold leading-tight tracking-tight text-text-strong">
            {market.symbol}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
            {market.name}
          </span>
        </div>
        <div className="flex flex-col">
          <span
            className={`flex items-baseline gap-1.5 font-display text-[26px] font-bold tabular-nums leading-none tracking-tight transition-colors ${
              tick === 'up' ? 'text-buy' : tick === 'down' ? 'text-sell' : 'text-text-strong'
            }`}
          >
            {lastPrice !== null ? (
              <>
                <span
                  aria-hidden
                  className={`w-[13px] text-[13px] leading-none transition-opacity ${
                    dir ? (dir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'
                  }`}
                >
                  {dir === 'down' ? '\u25bc' : '\u25b2'}
                </span>
                {`$${formatPrice(lastPrice)}`}
              </>
            ) : <Pending />}
          </span>
          {stats ? (
            <span className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${isPositive ? 'text-buy' : 'text-sell'}`}>
              {isPositive ? '▲ +' : '▼ '}{formatPrice(priceChange)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
            </span>
          ) : (
            <span className="mt-0.5 font-mono text-xs font-medium tabular-nums">
              <Pending />
            </span>
          )}
        </div>
      </div>

      {/* Supporting stats */}
      <div className="flex flex-1 items-center gap-6 border-l border-hairline px-5 py-2">
        <Stat label="24h High" value={stats ? `$${formatPrice(stats.high24h)}` : null} />
        <Stat label="24h Low" value={stats ? `$${formatPrice(stats.low24h)}` : null} />
        <Stat label="24h Volume" value={stats ? `$${formatQuantity(stats.volume24h)}` : null} />
        <Stat label="Spread" value={hasBook ? `$${formatPrice(spread)} (${spreadPercent.toFixed(3)}%)` : null} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-text">
        {value !== null ? value : <Pending />}
      </span>
    </div>
  );
}
