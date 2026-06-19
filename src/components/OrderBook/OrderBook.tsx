import { useMemo, useState } from 'react';
import type { OrderBook as OrderBookType } from '../../types/market';
import { type LevelChange, priceKey } from '../../hooks/useOrderBook';
import { formatPrice, formatQuantity } from '../../utils/formatters';

type ViewMode = 'vertical' | 'horizontal' | 'bids-only' | 'asks-only';

interface OrderBookProps {
  orderBook: OrderBookType;
  levelChanges: Map<string, LevelChange>;
  onPriceClick?: (price: number) => void;
}

export function OrderBook({ orderBook, levelChanges, onPriceClick }: OrderBookProps) {
  const { bids, asks } = orderBook;
  const [viewMode, setViewMode] = useState<ViewMode>('vertical');

  const { askLevels, bidLevels, maxCumulative } = useMemo(() => {
    let askCum = 0;
    let bidCum = 0;

    // Asks: lowest price first, cumulative from lowest
    const askLevels = asks.map(level => {
      askCum += level.quantity;
      return { ...level, cumulative: askCum };
    });

    // Bids: highest price first, cumulative from highest
    const bidLevels = bids.map(level => {
      bidCum += level.quantity;
      return { ...level, cumulative: bidCum };
    });

    const maxCum = Math.max(
      askLevels.length > 0 ? askLevels[askLevels.length - 1].cumulative : 0,
      bidLevels.length > 0 ? bidLevels[bidLevels.length - 1].cumulative : 0,
      1
    );

    return { askLevels, bidLevels, maxCumulative: maxCum };
  }, [asks, bids]);

  const spread = bids.length > 0 && asks.length > 0
    ? asks[0].price - bids[0].price
    : 0;
  const spreadPercent = asks.length > 0 && spread > 0
    ? (spread / asks[0].price) * 100
    : 0;

  const midPrice = bids.length > 0 && asks.length > 0
    ? (asks[0].price + bids[0].price) / 2
    : 0;

  // Map level changes to the design-system flash animations. The flash
  // animates the row's text color (buy/sell) once on new/updated levels.
  const getAnimationClass = (price: number, side: 'bid' | 'ask'): string => {
    const change = levelChanges.get(priceKey(price));
    if (!change) return '';
    return side === 'bid' ? 'animate-flash-buy' : 'animate-flash-sell';
  };

  const handlePriceClick = (price: number) => {
    if (onPriceClick) {
      onPriceClick(price);
    }
  };

  const showAsks = viewMode === 'vertical' || viewMode === 'horizontal' || viewMode === 'asks-only';
  const showBids = viewMode === 'vertical' || viewMode === 'horizontal' || viewMode === 'bids-only';
  const isVertical = viewMode !== 'horizontal';

  // For vertical mode, reverse asks so lowest price is at bottom (near spread)
  const displayAsks = isVertical ? [...askLevels].reverse() : askLevels;

  const colHead = 'text-[10px] font-medium uppercase tracking-wider text-muted';
  const cellNum = 'relative z-[1] overflow-hidden text-ellipsis whitespace-nowrap font-mono tabular-nums';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-4 py-3.5">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M18 9l-5 5-4-4-3 3" />
          </svg>
          <h3 className="m-0 font-display text-[13px] font-medium tracking-tight text-text-strong">Order Book</h3>
        </div>
        <div className="flex gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5">
          <button
            className={`flex items-center justify-center rounded-sm px-1.5 py-1 transition-colors ${
              viewMode === 'vertical' ? 'bg-surface-3 text-text-strong' : 'text-muted hover:text-text'
            }`}
            onClick={() => setViewMode('vertical')}
            title="Vertical view"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="1" width="12" height="3" rx="0.5" opacity="0.4" />
              <rect x="2" y="6" width="12" height="3" rx="0.5" opacity="0.7" />
              <rect x="2" y="11" width="12" height="3" rx="0.5" />
            </svg>
          </button>
          <button
            className={`flex items-center justify-center rounded-sm px-1.5 py-1 transition-colors ${
              viewMode === 'horizontal' ? 'bg-surface-3 text-text-strong' : 'text-muted hover:text-text'
            }`}
            onClick={() => setViewMode('horizontal')}
            title="Horizontal view"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="6" height="12" rx="0.5" />
              <rect x="9" y="2" width="6" height="12" rx="0.5" opacity="0.4" />
            </svg>
          </button>
          <button
            className={`flex items-center justify-center rounded-sm px-1.5 py-1 transition-colors ${
              viewMode === 'bids-only' ? 'bg-buy-soft text-buy' : 'text-buy/40 hover:text-buy'
            }`}
            onClick={() => setViewMode('bids-only')}
            title="Bids only"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="1" />
            </svg>
          </button>
          <button
            className={`flex items-center justify-center rounded-sm px-1.5 py-1 transition-colors ${
              viewMode === 'asks-only' ? 'bg-sell-soft text-sell' : 'text-sell/40 hover:text-sell'
            }`}
            onClick={() => setViewMode('asks-only')}
            title="Asks only"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {isVertical ? (
        /* ═══ VERTICAL LAYOUT ═══ */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Column headers */}
          <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-2 ${colHead}`}>
            <span className="text-left">Price</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks section (reversed — lowest at bottom) */}
          {showAsks && (
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto overflow-x-hidden">
              {displayAsks.map((level) => (
                <div
                  key={level.price}
                  className={`relative grid cursor-pointer grid-cols-3 gap-1 px-4 py-[3px] text-[11.5px] leading-[1.9] hover:bg-surface-2 ${getAnimationClass(level.price, 'ask')}`}
                  onClick={() => handlePriceClick(level.price)}
                  title="Click to set price"
                >
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 bg-sell-soft transition-[width] duration-200"
                    style={{ width: `${(level.cumulative / maxCumulative) * 100}%` }}
                  />
                  <span className={`${cellNum} text-left font-medium text-sell`}>${formatPrice(level.price)}</span>
                  <span className={`${cellNum} text-right text-text`}>{formatQuantity(level.quantity)}</span>
                  <span className={`${cellNum} text-right text-muted`}>{formatQuantity(level.cumulative)}</span>
                </div>
              ))}
              {displayAsks.length === 0 && (
                <div className="p-5 text-center text-[11px] italic text-muted">No asks</div>
              )}
            </div>
          )}

          {/* Spread indicator */}
          <div className="flex flex-shrink-0 items-center justify-between border-y border-hairline px-4 py-2">
            <span className="font-mono text-sm font-semibold tabular-nums tracking-tight text-text-strong">${formatPrice(midPrice)}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted">
              Spread: ${formatPrice(spread)} ({spreadPercent.toFixed(3)}%)
            </span>
          </div>

          {/* Bids section (highest at top) */}
          {showBids && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
              {bidLevels.map((level) => (
                <div
                  key={level.price}
                  className={`relative grid cursor-pointer grid-cols-3 gap-1 px-4 py-[3px] text-[11.5px] leading-[1.9] hover:bg-surface-2 ${getAnimationClass(level.price, 'bid')}`}
                  onClick={() => handlePriceClick(level.price)}
                  title="Click to set price"
                >
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 bg-buy-soft transition-[width] duration-200"
                    style={{ width: `${(level.cumulative / maxCumulative) * 100}%` }}
                  />
                  <span className={`${cellNum} text-left font-medium text-buy`}>${formatPrice(level.price)}</span>
                  <span className={`${cellNum} text-right text-text`}>{formatQuantity(level.quantity)}</span>
                  <span className={`${cellNum} text-right text-muted`}>{formatQuantity(level.cumulative)}</span>
                </div>
              ))}
              {bidLevels.length === 0 && (
                <div className="p-5 text-center text-[11px] italic text-muted">No bids</div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ═══ HORIZONTAL LAYOUT (original side-by-side) ═══ */
        <>
          <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline bg-bg px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Mid</span>
              <span className="font-mono text-[15px] font-bold tabular-nums text-text-strong">${formatPrice(midPrice)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Spread</span>
              <span className="font-mono text-[10px] tabular-nums text-text">${formatPrice(spread)} ({spreadPercent.toFixed(3)}%)</span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
            <div className="flex min-h-0 flex-col overflow-hidden border-r border-hairline">
              <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-2 ${colHead}`}>
                <span className="text-left">Total</span>
                <span className="text-center">Amount</span>
                <span className="text-right">Bid Price</span>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {bidLevels.map((level) => (
                  <div
                    key={level.price}
                    className={`relative grid cursor-pointer grid-cols-3 gap-1 px-4 py-[3px] text-[11.5px] leading-[1.9] hover:bg-surface-2 ${getAnimationClass(level.price, 'bid')}`}
                    onClick={() => handlePriceClick(level.price)}
                    title="Click to set price"
                  >
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 border-r-2 border-buy/20 bg-buy-soft transition-[width] duration-200"
                      style={{ width: `${(level.cumulative / maxCumulative) * 100}%` }}
                    />
                    <span className={`${cellNum} text-left text-muted`}>{formatQuantity(level.cumulative)}</span>
                    <span className={`${cellNum} text-center text-text`}>{formatQuantity(level.quantity)}</span>
                    <span className={`${cellNum} text-right font-medium text-buy`}>${formatPrice(level.price)}</span>
                  </div>
                ))}
                {bidLevels.length === 0 && <div className="p-5 text-center text-[11px] italic text-muted">No bids</div>}
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-2 ${colHead}`}>
                <span className="text-left">Ask Price</span>
                <span className="text-center">Amount</span>
                <span className="text-right">Total</span>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {askLevels.map((level) => (
                  <div
                    key={level.price}
                    className={`relative grid cursor-pointer grid-cols-3 gap-1 px-4 py-[3px] text-[11.5px] leading-[1.9] hover:bg-surface-2 ${getAnimationClass(level.price, 'ask')}`}
                    onClick={() => handlePriceClick(level.price)}
                    title="Click to set price"
                  >
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 border-l-2 border-sell/20 bg-sell-soft transition-[width] duration-200"
                      style={{ width: `${(level.cumulative / maxCumulative) * 100}%` }}
                    />
                    <span className={`${cellNum} text-left font-medium text-sell`}>${formatPrice(level.price)}</span>
                    <span className={`${cellNum} text-center text-text`}>{formatQuantity(level.quantity)}</span>
                    <span className={`${cellNum} text-right text-muted`}>{formatQuantity(level.cumulative)}</span>
                  </div>
                ))}
                {askLevels.length === 0 && <div className="p-5 text-center text-[11px] italic text-muted">No asks</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
