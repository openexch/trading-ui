// SPDX-License-Identifier: Apache-2.0
/**
 * Fills: the user's executions (GET /api/v1/executions, latest 100). There
 * is no fills stream yet, so the list refreshes on mount (useExecutions),
 * whenever the total filled quantity across the user's orders changes or an
 * order leaves the list, and from the refresh button. Signed out, the hook
 * is not mounted at all.
 */
import { useEffect, useRef } from 'react';
import type { UserOrder } from '../../types/market';
import { MARKETS } from '../../types/market';
import { useExecutions } from '../../hooks/useExecutions';
import type { ExecutionEntry } from '../../hooks/useExecutions';
import { marketUi } from '../../trading/marketUi';
import { tickDecimals } from '../../utils/ticks';
import { formatFixed } from '../ladder/format';
import type { SlotChrome } from '../layout/SideColumn';
import { NONE, PanelFrame, PanelNote, PanelSignIn } from './PanelFrame';
import { fillsSignal } from './ordersModel';
import { clockTime } from './TradesPanel';

export interface FillsPanelProps {
  chrome: SlotChrome;
  signedIn: boolean;
  onSignIn: () => void;
  /** The user's orders (useOrders `orders`): their fills drive refreshes. */
  orders: readonly UserOrder[];
}

export function FillsPanel({ chrome, signedIn, onSignIn, orders }: FillsPanelProps) {
  return (
    <PanelFrame label="Fills" position={chrome.position} header={chrome.picker()} scroll={false}>
      {signedIn ? <FillsList orders={orders} /> : <PanelSignIn what="your fills" onSignIn={onSignIn} />}
    </PanelFrame>
  );
}

/** Calls `refresh` when the orders say the fills may be stale. */
export function useFillsRefresh(orders: readonly UserOrder[], refresh: () => void) {
  const prev = useRef<ReturnType<typeof fillsSignal>['next'] | null>(null);
  useEffect(() => {
    const { next, stale } = fillsSignal(prev.current, orders);
    prev.current = next;
    if (stale) refresh();
  }, [orders, refresh]);
}

function FillRow({ e }: { e: ExecutionEntry }) {
  const market = MARKETS.find(m => m.id === e.marketId);
  const buy = e.side === 'BUY';
  const price = market ? formatFixed(e.price, tickDecimals(market.tickSize)) : String(e.price);
  const size = market ? formatFixed(e.quantity, marketUi(market).sizeDecimals) : String(e.quantity);
  return (
    <li
      data-fill-row
      className="grid h-[30px] grid-cols-[3px_minmax(0,1fr)_minmax(0,1fr)_64px] items-center gap-2 border-b border-hairline pr-3 text-[12px]"
    >
      <span aria-hidden className={`self-stretch ${buy ? 'bg-buy' : 'bg-sell'}`} />
      <span className="truncate">
        <span className={`font-semibold ${buy ? 'text-buy' : 'text-sell'}`}>
          {buy ? 'Buy' : 'Sell'} {size}
        </span>{' '}
        <span className="text-muted">{market?.symbol ?? `#${e.marketId}`}</span>
      </span>
      <span className="truncate text-right text-text-strong">
        {price}
        <span className="ml-1.5 text-[11px] text-muted" title={e.maker ? 'Your order was resting' : 'Your order took liquidity'}>
          {e.maker ? 'M' : 'T'}
        </span>
      </span>
      <span className="text-right text-muted">{clockTime(e.executedAtMs)}</span>
    </li>
  );
}

/** The fills list with its refresh row; used by this panel and the Orders
 *  panel's Fills tab. Mount it only when signed in. */
export function FillsList({ orders }: { orders: readonly UserOrder[] }) {
  const { executions, loading, error, refresh } = useExecutions();
  useFillsRefresh(orders, refresh);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 flex-none items-center justify-between gap-2 border-b border-hairline pl-4 pr-2.5 text-[11px] text-muted">
        <span>Latest 100{loading ? ' · loading' : ''}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh fills"
          title="Refresh fills"
          className="grid h-6 w-6 place-items-center rounded-[5px] text-muted hover:bg-chip hover:text-text-strong disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M12.5 1.8v2.8H9.7" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {error ? (
          <PanelNote>
            <span role="alert">{error}</span>
          </PanelNote>
        ) : executions.length === 0 ? (
          <PanelNote>{loading ? NONE : 'No fills yet'}</PanelNote>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="Your fills">
            {executions.map(e => (
              <FillRow key={e.tradeId} e={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
