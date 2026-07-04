// SPDX-License-Identifier: Apache-2.0
import type { AggregatedTrade } from '../../types/market';
import { formatPrice, formatQuantity, formatTime } from '../../utils/formatters';

interface TradeListProps {
  trades: AggregatedTrade[];
}

export function TradeList({ trades }: TradeListProps) {
  return (
    <div className="flex h-full flex-col font-sans">
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-3.5">
        <h3 className="font-display text-[13px] font-medium tracking-tight text-text-strong">
          Recent Trades
        </h3>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-muted">
          {trades.length}
        </span>
      </div>

      <div className="grid flex-shrink-0 grid-cols-[1fr_1fr_70px] gap-1.5 border-b border-hairline px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
        <span>Price (USD)</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-muted">
            <svg
              className="h-9 w-9 opacity-25"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 14l4-4 4 4 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs italic">Waiting for trades...</span>
          </div>
        ) : (
          trades.map((trade, index) => {
            const isBuyDominant = trade.buyCount > trade.sellCount;
            return (
              <div
                key={`${trade.timestamp}-${index}`}
                className="grid animate-fade-in grid-cols-[1fr_1fr_70px] gap-1.5 px-4 py-1 font-mono text-[11.5px] leading-[1.9] tabular-nums transition-colors hover:bg-surface-2"
              >
                <span
                  className={`font-medium ${isBuyDominant ? 'text-buy' : 'text-sell'}`}
                >
                  ${formatPrice(trade.price)}
                </span>
                <span className="flex items-center justify-end gap-1 text-text">
                  {formatQuantity(trade.quantity)}
                  {trade.tradeCount > 1 && (
                    <span className="rounded-sm bg-surface-2 px-1 py-px text-[9px] font-medium text-faint">
                      ×{trade.tradeCount}
                    </span>
                  )}
                </span>
                <span className="text-right text-[10px] font-normal text-muted">
                  {formatTime(trade.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
