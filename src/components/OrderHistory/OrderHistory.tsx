// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { Market } from '../../types/market';
import { MARKETS } from '../../types/market';
import { formatPrice, formatQuantity, formatTime } from '../../utils/formatters';
import { useOrderHistory } from '../../hooks/useOrderHistory';
import { useExecutions } from '../../hooks/useExecutions';

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

/** History panel: terminal order history (Orders) and the user's fills
 *  (Trades), both from the principal-scoped OMS REST reads (oms#72). */
export function OrderHistory({ market }: OrderHistoryProps) {
  const [subTab, setSubTab] = useState<'orders' | 'trades'>('orders');
  const ordersState = useOrderHistory();
  const execState = useExecutions();
  const [thisMarketOnly, setThisMarketOnly] = useState(false);

  const loading = subTab === 'orders' ? ordersState.loading : execState.loading;
  const error = subTab === 'orders' ? ordersState.error : execState.error;
  const refresh = subTab === 'orders' ? ordersState.refresh : execState.refresh;

  const orderRows = thisMarketOnly
    ? ordersState.orders.filter(o => o.marketId === market.id)
    : ordersState.orders;
  const tradeRows = thisMarketOnly
    ? execState.executions.filter(t => t.marketId === market.id)
    : execState.executions;
  const isEmpty = subTab === 'orders' ? orderRows.length === 0 : tradeRows.length === 0;

  const th = 'px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-faint';
  const td = 'px-2 py-1.5 align-middle';

  const subTabClass = (active: boolean) =>
    `relative px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      active ? 'text-text' : 'text-faint hover:text-muted'
    }`;

  return (
    <div className="flex h-full flex-col font-sans">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-hairline px-3 py-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <button className={subTabClass(subTab === 'orders')} onClick={() => setSubTab('orders')}>
              Orders
              {subTab === 'orders' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-accent" />}
            </button>
            <button className={subTabClass(subTab === 'trades')} onClick={() => setSubTab('trades')}>
              Trades
              {subTab === 'trades' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-accent" />}
            </button>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={thisMarketOnly}
              onChange={e => setThisMarketOnly(e.target.checked)}
              className="accent-accent"
            />
            {market.symbol} only
          </label>
        </div>
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
      ) : isEmpty ? (
        <div className="flex flex-1 items-center justify-center py-8 text-[12px] text-muted">
          {loading
            ? 'Loading…'
            : subTab === 'orders'
              ? 'Your completed orders will appear here'
              : 'Your fills will appear here'}
        </div>
      ) : subTab === 'orders' ? (
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
              {orderRows.map(o => (
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
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-hairline">
                <th className={th}>Time</th>
                <th className={th}>Market</th>
                <th className={th}>Side</th>
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Total</th>
                <th className={th}>Role</th>
              </tr>
            </thead>
            <tbody>
              {tradeRows.map(t => (
                <tr key={t.tradeId} className="border-b border-hairline/60 hover:bg-surface-2">
                  <td className={`${td} font-mono tabular-nums text-faint`}>{formatTime(t.executedAtMs)}</td>
                  <td className={`${td} font-mono text-muted`}>{symbolFor(t.marketId)}</td>
                  <td className={`${td} font-medium ${t.side === 'BUY' ? 'text-buy' : 'text-sell'}`}>{t.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-text`}>${formatPrice(t.price)}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-text`}>{formatQuantity(t.quantity)}</td>
                  <td className={`${td} text-right font-mono tabular-nums text-text`}>${formatPrice(t.price * t.quantity)}</td>
                  <td className={`${td} text-muted`}>{t.maker ? 'Maker' : 'Taker'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
