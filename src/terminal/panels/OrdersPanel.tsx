// SPDX-License-Identifier: Apache-2.0
/**
 * Open orders, compact: Open · N | Fills tabs, a ⋯ menu with Cancel all and
 * a ⤢ button for the full table (View all: the all-orders dialog, with every
 * market, selection, History and Fills).
 *
 * - Rows are this market's orders, 30 px: a side rule, "Buy 0.50", type,
 *   price, fill % and × cancel. Orders on other markets are counted in a
 *   "+N on other markets" line, so the panel's scope is clear.
 * - Stops awaiting their trigger are listed from the order feed as "Stop,
 *   awaiting trigger" with no price: the UI order model carries no trigger
 *   price (DESIGN.md rule 14). They are cancelled one by one.
 * - Cancel (×) and Cancel all go through the ladder's own-order actions:
 *   the same per-order pending state, the same Cancel all question in the
 *   strip (nothing is sent before it is confirmed), the same results.
 * - Rows keep omsOrderId keys and have no mount animation (rule 4).
 * - The order's side and size is a button that opens its trail under the
 *   row (OrderTrail: gateway, core accepted, ME booked, matched, settled,
 *   each with time, delta and position). One trail is open at a time.
 */
import { useId, useMemo, useRef, useState } from 'react';
import type { Market, UserOrder } from '../../types/market';
import { Menu, MenuItem, useMenuTrigger } from '../../ui';
import { marketUi } from '../../trading/marketUi';
import { typeLabel } from '../../trading/staging';
import { tickDecimals } from '../../utils/ticks';
import { formatCompactSize, formatFixed } from '../ladder/format';
import type { LadderOrderActions } from '../ladder/TradingLadder';
import type { SlotChrome } from '../layout/SideColumn';
import { NONE, PanelFrame, PanelNote, PanelSignIn } from './PanelFrame';
import { FillsList } from './FillsPanel';
import { fillPercent, isAwaitingTrigger, panelOrders } from './ordersModel';
import { AllOrdersDialog } from '../orders/AllOrdersDialog';
import { OrderTrail } from '../orders/OrderTrail';

export interface OrdersPanelProps {
  chrome: SlotChrome;
  market: Market;
  /** The user's orders (useOrders `orders`, user-scoped). */
  orders: readonly UserOrder[];
  signedIn: boolean;
  onSignIn: () => void;
  /** The ladder's own-order actions; null while there are none. */
  actions: LadderOrderActions | null;
  /** Show on ladder from the all-orders dialog: switch market if needed and
   *  bring the order's rung into view. */
  onShowOnLadder?: (order: UserOrder) => void;
}

const ICON_BTN =
  'grid h-7 w-7 flex-none place-items-center rounded-md text-muted hover:bg-chip hover:text-text-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';

export function OrdersPanel({ chrome, market, orders, signedIn, onSignIn, actions, onShowOnLadder }: OrdersPanelProps) {
  const [tab, setTab] = useState<'open' | 'fills'>('open');
  const [viewAll, setViewAll] = useState(false);
  const [trailOf, setTrailOf] = useState<string | null>(null);
  const viewAllRef = useRef<HTMLButtonElement>(null);
  const { here, elsewhere } = useMemo(() => panelOrders(orders, market.id), [orders, market.id]);
  const more = useMenuTrigger();
  const uid = useId();
  const ids = { open: `${uid}-open`, fills: `${uid}-fills`, panel: `${uid}-panel` };

  const tabCls = (active: boolean) =>
    `flex h-full items-center border-b-2 text-[12px] ${
      active ? 'border-accent font-semibold text-text-strong' : 'border-transparent text-muted hover:text-text'
    }`;

  const count = actions?.cancelAllCount ?? 0;
  const running = actions?.cancelAllRunning ?? false;

  const header = (
    <>
      {chrome.picker('icon')}
      <div role="tablist" aria-label="Orders" className="flex h-full items-stretch gap-3 self-stretch">
        <button
          type="button"
          role="tab"
          id={ids.open}
          aria-selected={tab === 'open'}
          aria-controls={ids.panel}
          onClick={() => setTab('open')}
          className={tabCls(tab === 'open')}
        >
          Open · {signedIn ? here.length : NONE}
        </button>
        <button
          type="button"
          role="tab"
          id={ids.fills}
          aria-selected={tab === 'fills'}
          aria-controls={ids.panel}
          onClick={() => setTab('fills')}
          className={tabCls(tab === 'fills')}
        >
          Fills
        </button>
      </div>
    </>
  );

  const toolbar = (
    <>
      <button
        type="button"
        {...more.triggerProps}
        aria-label="More order actions"
        title="More"
        className={`${ICON_BTN} text-[16px] leading-none`}
      >
        ⋯
      </button>
      <Menu {...more.menuProps} label="More order actions" placement="bottom-end">
        <MenuItem
          tone="sell"
          disabled={!actions || count === 0 || running}
          hint={running ? 'Running' : String(count)}
          onSelect={() => actions?.askCancelAll()}
        >
          Cancel all on {market.symbol}…
        </MenuItem>
      </Menu>
      <button
        ref={viewAllRef}
        type="button"
        aria-disabled={signedIn ? undefined : 'true'}
        aria-haspopup="dialog"
        aria-label={signedIn ? 'View all orders' : 'View all orders (sign in first)'}
        title="View all"
        onClick={e => {
          if (!signedIn) {
            e.preventDefault();
            return;
          }
          setViewAll(true);
        }}
        className={`${ICON_BTN} border border-ctl text-[13px] text-text`}
      >
        ⤢
      </button>
      <AllOrdersDialog
        open={viewAll && signedIn}
        onClose={() => setViewAll(false)}
        market={market}
        orders={orders}
        actions={actions}
        onShowOnLadder={onShowOnLadder}
        initialTab={tab === 'fills' ? 'fills' : 'open'}
        returnFocusRef={viewAllRef}
      />
    </>
  );

  return (
    <PanelFrame label="Orders and fills" position={chrome.position} header={header} actions={toolbar} scroll={false}>
      <div
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={tab === 'open' ? ids.open : ids.fills}
        className="flex min-h-0 flex-1 flex-col"
      >
        {!signedIn ? (
          <PanelSignIn what={tab === 'open' ? 'your orders' : 'your fills'} onSignIn={onSignIn} />
        ) : tab === 'fills' ? (
          <FillsList orders={orders} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              {here.length === 0 ? (
                <PanelNote>No open orders on {market.symbol}</PanelNote>
              ) : (
                <ul className="m-0 list-none p-0" aria-label={`Open orders on ${market.symbol}`}>
                  {here.map(o => (
                    <OrderRow
                      key={o.omsOrderId || `#${o.orderId}`}
                      order={o}
                      market={market}
                      actions={actions}
                      trailOpen={trailOf !== null && trailOf === o.omsOrderId}
                      onToggleTrail={() => setTrailOf(t => (t === o.omsOrderId ? null : o.omsOrderId))}
                    />
                  ))}
                </ul>
              )}
            </div>
            {elsewhere > 0 && (
              <div data-orders-elsewhere className="flex h-8 flex-none items-center border-t border-hairline px-4 text-[12px] text-muted">
                +{elsewhere} on other markets
              </div>
            )}
          </>
        )}
      </div>
    </PanelFrame>
  );
}

interface OrderRowProps {
  order: UserOrder;
  market: Market;
  actions: LadderOrderActions | null;
  trailOpen: boolean;
  onToggleTrail: () => void;
}

function OrderRow({ order, market, actions, trailOpen, onToggleTrail }: OrderRowProps) {
  const buy = order.side === 'BID';
  const side = buy ? 'Buy' : 'Sell';
  const amount = formatCompactSize(order.originalQuantity, marketUi(market).sizeDecimals);
  const stop = isAwaitingTrigger(order);
  const price = stop ? NONE : formatFixed(order.price, tickDecimals(market.tickSize));
  const type = stop ? 'Stop, awaiting trigger' : typeLabel(order.type);
  const pending = actions?.pending.get(order.omsOrderId) ?? null;
  const canCancel = actions !== null && order.omsOrderId !== '' && pending === null;
  const what = stop ? `${side} ${amount} ${typeLabel(order.type).toLowerCase()}, awaiting trigger` : `${side} ${amount} at ${price}`;

  const hasTrail = order.omsOrderId !== '';
  return (
    <>
    <li
      data-order-row={order.omsOrderId}
      data-pending={pending ?? undefined}
      className={`grid h-[30px] grid-cols-[3px_64px_minmax(0,1fr)_64px_36px_22px] items-center gap-2 border-b border-hairline pr-3 text-[12px] ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <span aria-hidden className={`self-stretch ${buy ? 'bg-buy' : 'bg-sell'}`} />
      <button
        type="button"
        disabled={!hasTrail}
        aria-expanded={trailOpen}
        aria-label={`${trailOpen ? 'Hide' : 'Show'} the trail of ${what}`}
        onClick={onToggleTrail}
        className={`truncate text-left font-semibold ${buy ? 'text-buy' : 'text-sell'} underline decoration-transparent underline-offset-2 hover:decoration-current disabled:no-underline`}
      >
        {side} {amount}
      </button>
      <span className="truncate text-muted" title={stop ? `${typeLabel(order.type)}, awaiting trigger` : undefined}>
        {type}
      </span>
      <span
        className={`truncate text-right ${stop ? 'text-muted' : 'text-text-strong'}`}
        title={stop ? 'Trigger price is not available yet' : undefined}
      >
        {price}
      </span>
      <span className="text-right text-muted">{fillPercent(order)}%</span>
      <button
        type="button"
        aria-label={pending === 'cancel' ? `Cancelling ${what}` : `Cancel ${what}`}
        disabled={!canCancel}
        onClick={() => actions?.cancel(order)}
        className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ctl text-[12px] leading-none text-muted hover:bg-chip hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? '…' : '×'}
      </button>
    </li>
    {trailOpen && hasTrail && (
      <li data-order-trail-row={order.omsOrderId}>
        <OrderTrail orderId={order.omsOrderId} />
      </li>
    )}
    </>
  );
}
