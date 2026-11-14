// SPDX-License-Identifier: Apache-2.0
// Interim orders panel for the ladder shell: the existing Open orders and
// History views under two tabs, until the compact Orders panel replaces it.
import { useState } from 'react';
import type { Market, UserOrder } from '../../types/market';
import { OpenOrders } from '../../components/OpenOrders/OpenOrders';
import { OrderHistory } from '../../components/OrderHistory/OrderHistory';

export interface LegacyOrdersPanelProps {
  signedIn: boolean;
  onSignIn: () => void;
  market: Market;
  openOrders: UserOrder[];
  onCancelOrder: (order: UserOrder) => void;
  onReplaceOrder: (order: UserOrder, price?: number, quantity?: number) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
}

export function LegacyOrdersPanel(props: LegacyOrdersPanelProps) {
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const tabCls = (active: boolean) =>
    `flex h-[38px] items-center border-b-2 text-[12px] ${
      active ? 'border-accent font-semibold text-text-strong' : 'border-transparent text-muted hover:text-text'
    }`;
  return (
    <section aria-label="Orders" className="flex h-full min-h-0 flex-col">
      <div role="tablist" className="flex h-10 flex-none items-center gap-3 border-b border-hairline px-4">
        <button type="button" role="tab" aria-selected={tab === 'open'} className={tabCls(tab === 'open')} onClick={() => setTab('open')}>
          Open · {props.openOrders.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tabCls(tab === 'history')} onClick={() => setTab('history')}>
          History
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!props.signedIn ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8">
            <span className="text-[12px] text-muted">Sign in to see your orders</span>
            <button
              type="button"
              onClick={props.onSignIn}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-hover"
            >
              Sign in
            </button>
          </div>
        ) : tab === 'open' ? (
          <OpenOrders
            orders={props.openOrders}
            onCancelOrder={props.onCancelOrder}
            onReplaceOrder={props.onReplaceOrder}
            loading={props.loading}
          />
        ) : (
          <OrderHistory market={props.market} />
        )}
      </div>
    </section>
  );
}
