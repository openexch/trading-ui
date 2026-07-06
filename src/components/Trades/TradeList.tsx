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
          /* Awaiting-tape window (market switch / reconnect): pulsing
             placeholder rows instead of an empty-looking panel */
          <div aria-hidden className="animate-pulse">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_70px] gap-1.5 px-4 py-[7px]">
                <span className="h-3 rounded-sm bg-surface-2" style={{ width: `${[60, 45, 70, 50, 65, 40, 75, 55, 62][i]}%` }} />
                <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${[50, 65, 40, 70, 45, 60, 42, 68, 52][i]}%` }} />
                <span className="h-3 w-full justify-self-end rounded-sm bg-surface-2" />
              </div>
            ))}
          </div>
        ) : (
          trades.map((trade, index) => {
            // Taker side when the gateway provides it (market WS v5+);
            // otherwise a tick test against the previous trade IN TIME.
            // The tape is newest-first, so previous-in-time is the NEXT
            // element; oldest row and equal prices read as up-ticks.
            const prev = trades[index + 1];
            const isBuy = trade.side != null
              ? trade.side === 'BUY'
              : prev == null || trade.price >= prev.price;
            return (
              <div
                key={`${trade.timestamp}-${index}`}
                className="grid animate-fade-in grid-cols-[1fr_1fr_70px] gap-1.5 px-4 py-1 font-mono text-[11.5px] leading-[1.9] tabular-nums transition-colors hover:bg-surface-2"
              >
                <span
                  className={`font-medium ${isBuy ? 'text-buy' : 'text-sell'}`}
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
