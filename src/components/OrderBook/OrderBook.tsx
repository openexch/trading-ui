// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrderBook as OrderBookType } from '../../types/market';
import { type LevelChange, priceKey } from '../../hooks/useOrderBook';
import { formatPrice, formatQuantity } from '../../utils/formatters';

type ViewMode = 'vertical' | 'horizontal' | 'bids-only' | 'asks-only';

interface OrderBookProps {
  orderBook: OrderBookType;
  levelChanges: Map<string, LevelChange>;
  onPriceClick?: (price: number) => void;
}

// Rows rendered per side; the book state retains more (64) so deletes
// backfill from below instead of shrinking the display.
const RENDER_DEPTH = 20;

// A row may never be shorter than the text inside it. The 20-slot grid
// divides the side's height by 20 whatever that height is, so on a laptop
// (1470x712 viewport => 10.6px slots for 12px type) consecutive rows
// overlapped. Below the height that fits all 20, drop levels rather than
// shrink rows: the top of the book is the part that matters, and scrolling
// is ruled out (see DESIGN.md).
const MIN_ROW_PX = 14;
const MIN_DEPTH = 6;

/** Levels per side that fit at a readable row height, observed from the
 *  rendered side itself. Both sides are equal-height siblings, so one
 *  measurement drives both. */
function useFittedDepth() {
  const [depth, setDepth] = useState(RENDER_DEPTH);
  // The observed side is held in state, not a ref: the effect's cleanup then
  // disconnects exactly the observer it created. A ref callback paired with a
  // mount-scoped cleanup tore down the live observer under StrictMode's
  // double-invoke, so the depth was measured once and never again.
  const [sideEl, setSideEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sideEl) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h <= 0) return;
      setDepth(Math.min(RENDER_DEPTH, Math.max(MIN_DEPTH, Math.floor(h / MIN_ROW_PX))));
    });
    ro.observe(sideEl);
    return () => ro.disconnect();
  }, [sideEl]);

  return [depth, setSideEl] as const;
}

// Skeleton widths (%) cycled per row — organic, not a flat block.
const SKELETON_WIDTHS = [55, 70, 45, 65, 50, 75, 60, 40];

/** Pulsing placeholder rows for the awaiting-snapshot window (market switch /
 *  reconnect) — the book resets, but a shimmer reads as "loading", not empty. */
function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-3 gap-1 px-4 py-[5px]">
          <span className="h-3 rounded-sm bg-surface-2" style={{ width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%` }} />
          <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${SKELETON_WIDTHS[(i + 3) % SKELETON_WIDTHS.length]}%` }} />
          <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${SKELETON_WIDTHS[(i + 5) % SKELETON_WIDTHS.length]}%` }} />
        </div>
      ))}
    </div>
  );
}

export function OrderBook({ orderBook, levelChanges, onPriceClick }: OrderBookProps) {
  const { bids, asks } = orderBook;
  const [viewMode, setViewMode] = useState<ViewMode>('vertical');
  const [fittedDepth, fitRef] = useFittedDepth();

  const { askLevels, bidLevels, maxCumulative } = useMemo(() => {
    let askCum = 0;
    let bidCum = 0;

    // Asks: lowest price first, cumulative from lowest
    const askLevels = asks.slice(0, RENDER_DEPTH).map(level => {
      askCum += level.quantity;
      return { ...level, cumulative: askCum };
    });

    // Bids: highest price first, cumulative from highest
    const bidLevels = bids.slice(0, RENDER_DEPTH).map(level => {
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

  // For vertical mode, reverse asks so lowest price is at bottom (near spread).
  // Depth bars keep scaling to the full 20-level cumulative so they do not
  // rescale as the viewport changes how many rows fit.
  const displayAsks = isVertical ? [...askLevels.slice(0, fittedDepth)].reverse() : askLevels;
  const displayBids = isVertical ? bidLevels.slice(0, fittedDepth) : bidLevels;
  const sideRows = { gridTemplateRows: `repeat(${fittedDepth}, minmax(0, 1fr))` };

  // Directional tick on the mid price — the spread row is where the two
  // sides of the market meet, so it carries the same live pulse as the rail.
  const prevMidRef = useRef(0);
  const [midTick, setMidTick] = useState<'up' | 'down' | null>(null);
  const [midDir, setMidDir] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (midPrice > 0 && prevMidRef.current > 0) {
      if (midPrice > prevMidRef.current) { setMidTick('up'); setMidDir('up'); }
      else if (midPrice < prevMidRef.current) { setMidTick('down'); setMidDir('down'); }
    }
    prevMidRef.current = midPrice;
    const id = window.setTimeout(() => setMidTick(null), 500);
    return () => window.clearTimeout(id);
  }, [midPrice]);

  const colHead = 'text-[10px] font-medium uppercase tracking-wider text-muted';
  const cellNum = 'relative z-[1] overflow-hidden text-ellipsis whitespace-nowrap font-mono tabular-nums';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-4 py-2">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M18 9l-5 5-4-4-3 3" />
          </svg>
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Order Book</h3>
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
          <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-1.5 ${colHead}`}>
            <span className="text-left">Price</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks section (reversed — lowest at bottom). An N-slot grid sized
              to what fits at a readable row height: every rendered level is
              always fully visible, rows share the side's height equally, and
              nothing scrolls. (The old justify-end scroll container could not
              scroll: flex-end overflow is unreachable in CSS, which is why
              deep asks were clipped.) */}
          {showAsks && (
            <div ref={fitRef} className="grid min-h-0 flex-1 overflow-hidden" style={sideRows}>
              {Array.from({ length: Math.max(0, fittedDepth - displayAsks.length) }).map((_, i) => (
                <div key={`pad-${i}`} aria-hidden />
              ))}
              {displayAsks.map((level) => (
                <div
                  key={level.price}
                  className={`relative grid cursor-pointer grid-cols-3 items-center gap-1 px-4 text-[12px] leading-none hover:bg-surface-2 ${getAnimationClass(level.price, 'ask')}`}
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
              {displayAsks.length === 0 && <SkeletonRows />}
            </div>
          )}

          {/* Spread row — the signature: sell pressure bleeds in from the ask
              side above, buy pressure from the bid side below, and the mid
              price ticks with the market. */}
          <div
            className="relative flex flex-shrink-0 items-center justify-between border-y border-hairline px-4 py-1.5"
            style={{ background: 'linear-gradient(180deg, var(--sell-soft), transparent 42%, transparent 58%, var(--buy-soft))' }}
          >
            <span
              className={`flex items-baseline gap-1 font-mono text-[15px] font-bold tabular-nums tracking-tight transition-colors ${
                midTick === 'up' ? 'text-buy' : midTick === 'down' ? 'text-sell' : 'text-text-strong'
              }`}
            >
              <span
                aria-hidden
                className={`w-[9px] text-[9px] leading-none ${
                  midDir ? (midDir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'
                }`}
              >
                {midDir === 'down' ? '\u25bc' : '\u25b2'}
              </span>
              ${formatPrice(midPrice)}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted">
              Spread ${formatPrice(spread)} ({spreadPercent.toFixed(3)}%)
            </span>
          </div>

          {/* Bids section (highest at top) */}
          {showBids && (
            <div ref={showAsks ? undefined : fitRef} className="grid min-h-0 flex-1 overflow-hidden" style={sideRows}>
              {displayBids.map((level) => (
                <div
                  key={level.price}
                  className={`relative grid cursor-pointer grid-cols-3 items-center gap-1 px-4 text-[12px] leading-none hover:bg-surface-2 ${getAnimationClass(level.price, 'bid')}`}
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
              {displayBids.length === 0 && <SkeletonRows />}
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
              <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-1.5 ${colHead}`}>
                <span className="text-left">Total</span>
                <span className="text-center">Amount</span>
                <span className="text-right">Bid Price</span>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {bidLevels.map((level) => (
                  <div
                    key={level.price}
                    className={`relative grid cursor-pointer grid-cols-3 items-center gap-1 px-4 text-[12px] leading-none hover:bg-surface-2 ${getAnimationClass(level.price, 'bid')}`}
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
                {bidLevels.length === 0 && <SkeletonRows />}
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className={`grid flex-shrink-0 grid-cols-3 gap-1 border-b border-hairline px-4 py-1.5 ${colHead}`}>
                <span className="text-left">Ask Price</span>
                <span className="text-center">Amount</span>
                <span className="text-right">Total</span>
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {askLevels.map((level) => (
                  <div
                    key={level.price}
                    className={`relative grid cursor-pointer grid-cols-3 items-center gap-1 px-4 text-[12px] leading-none hover:bg-surface-2 ${getAnimationClass(level.price, 'ask')}`}
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
                {askLevels.length === 0 && <SkeletonRows />}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
