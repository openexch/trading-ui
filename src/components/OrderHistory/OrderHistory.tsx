// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { Market } from '../../types/market';
import { MARKETS } from '../../types/market';
import { formatPrice, formatQuantity, formatTime } from '../../utils/formatters';
import { useOrderHistory } from '../../hooks/useOrderHistory';

interface OrderHistoryProps {
  market: Market;
}

const STATUS_STYLES: Record<string, string> = {
  NEW: 'text-accent bg-accent-soft',
  PARTIALLY_FILLED: 'text-warn bg-warn-soft',
  FILLED: 'text-buy bg-buy-soft',
  CANCELLED: 'text-faint bg-surface-2',
  REJECTED: 'text-sell bg-sell-soft',
};

function symbolFor(marketId: number): string {
  return MARKETS.find(m => m.id === marketId)?.symbol ?? `#${marketId}`;
}

export function OrderHistory({ market }: OrderHistoryProps) {
  const { orders, loading, error, refresh } = useOrderHistory();
  const [thisMarketOnly, setThisMarketOnly] = useState(false);

  const rows = thisMarketOnly ? orders.filter(o => o.marketId === market.id) : orders;

  const th = 'px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-faint';
  const td = 'px-2 py-1.5 align-middle';

  return (
    <div className="flex h-full flex-col font-sans">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-3 py-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={thisMarketOnly}
            onChange={e => setThisMarketOnly(e.target.checked)}
            className="accent-accent"
          />
          {market.symbol} only
        </label>
        <button
          onClick={refresh}
          disabled={loading}
          className="rounded-sm border border-hairline px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center py-8 text-[12px] text-sell">{error}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-8 text-[12px] text-muted">
          {loading ? 'Loading…' : 'No order history'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-hairline">
                <th className={th}>Time</th>
                <th className={th}>Market</th>
                <th className={th}>Side</th>
                <th className={th}>Type</th>
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Filled</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(o => (
                <tr key={o.omsOrderId} className="border-b border-hairline/60 hover:bg-surface-2">
                  <td className={`${td} font-mono tabular-nums text-faint`}>{formatTime(o.createdAtMs)}</td>
                  <td className={`${td} font-mono text-muted`}>{symbolFor(o.marketId)}</td>
                  <td className={`${td} font-medium ${o.side === 'BUY' ? 'text-buy' : 'text-sell'}`}>{o.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td className={`${td} text-muted`}>{o.orderType}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-text`}>${formatPrice(o.price)}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-text`}>{formatQuantity(o.quantity)}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-muted`}>{formatQuantity(o.filledQty)}</td>
                  <td className={td}>
                    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[o.status] ?? 'text-muted bg-surface-2'}`}>
                      {o.status === 'PARTIALLY_FILLED' ? 'Partial' : o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
