import { useEffect, useRef, useState } from 'react';
import type { MarketStats as Stats, Market, OrderBook } from '../../types/market';
import { formatPrice, formatQuantity } from '../../utils/formatters';

interface MarketStatsProps {
  market: Market;
  stats: Stats;
  orderBook: OrderBook;
}

/**
 * Ticker rail — the page's signature element. The symbol is set in the display
 * grotesk against a thin tangerine rule; the live price flashes on each tick.
 */
export function MarketStats({ market, stats, orderBook }: MarketStatsProps) {
  const spread = orderBook.bids.length > 0 && orderBook.asks.length > 0
    ? orderBook.asks[0].price - orderBook.bids[0].price
    : 0;
  const spreadPercent = orderBook.asks.length > 0 && spread > 0
    ? (spread / orderBook.asks[0].price) * 100
    : 0;

  const priceChange = stats.priceChange ?? 0;
  const priceChangePercent = stats.priceChangePercent ?? 0;
  const isPositive = priceChange >= 0;

  const lastPrice = stats.lastPrice || orderBook.bids[0]?.price || 0;

  // Directional tick flash on price change.
  const prevPrice = useRef(lastPrice);
  const [tick, setTick] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (lastPrice > prevPrice.current) setTick('up');
    else if (lastPrice < prevPrice.current) setTick('down');
    prevPrice.current = lastPrice;
    const id = window.setTimeout(() => setTick(null), 500);
    return () => window.clearTimeout(id);
  }, [lastPrice]);

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto rounded-lg border border-hairline bg-surface">
      {/* Signature block: symbol + live price against a tangerine rule */}
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
            className={`font-mono text-xl font-semibold tabular-nums leading-none transition-colors ${
              tick === 'up' ? 'text-buy' : tick === 'down' ? 'text-sell' : 'text-text-strong'
            }`}
          >
            ${formatPrice(lastPrice)}
          </span>
          <span className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${isPositive ? 'text-buy' : 'text-sell'}`}>
            {isPositive ? '▲ +' : '▼ '}{formatPrice(priceChange)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Supporting stats */}
      <div className="flex flex-1 items-center gap-6 border-l border-hairline px-5 py-2">
        <Stat label="24h High" value={`$${formatPrice(stats.high24h)}`} />
        <Stat label="24h Low" value={`$${formatPrice(stats.low24h)}`} />
        <Stat label="24h Volume" value={`$${formatQuantity(stats.volume24h)}`} />
        <Stat label="Spread" value={`$${formatPrice(spread)} (${spreadPercent.toFixed(3)}%)`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-text">{value}</span>
    </div>
  );
}
