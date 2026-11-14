// SPDX-License-Identifier: Apache-2.0
/**
 * All orders, opened from the Orders panel's ⤢: tabs Open, History, Fills.
 *
 * Open lists every working order and every stop awaiting its trigger, on
 * every market, from the user-scoped order feed (latest 100).
 * - Filter chips (markets, Buy, Sell, Limit, Stops, Iceberg) and a search
 *   by price or order id narrow the list (allOrdersModel).
 * - Checkboxes select rows; the select-all box covers the rows on screen
 *   and shows the mixed state over a partial selection. Rows with a request
 *   in flight, or with no OMS id yet, cannot be selected.
 * - "Cancel selected…" asks inside the dialog first (Esc or Keep backs out),
 *   then cancels the selected orders one by one through the ladder's
 *   own-order actions: the same per-order pending state and the same strip
 *   result as a cancel made on the ladder. The run's summary is also shown
 *   here and takes focus, since the strip is behind the dialog.
 * - × cancels one row the same way. "Show on ladder" switches market if
 *   needed, closes the dialog and brings the order's rung into view, focused.
 *   A stop awaiting its trigger is not in the book, so it has no ladder rung
 *   and no price (DESIGN.md rule 14), only Cancel.
 * - There is no time-in-force column: the UI order model does not carry it.
 *
 * History reuses OrderHistory (its orders list); Fills reuses the panels'
 * fills list. Rows keep stable keys and have no mount animation (rule 4).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { Market, OrderSide, UserOrder } from '../../types/market';
import { MARKETS } from '../../types/market';
import { Checkbox, Dialog } from '../../ui';
import { marketUi } from '../../trading/marketUi';
import { typeLabel } from '../../trading/staging';
import { cancelAllSummary } from '../../trading/orderActions';
import { OrderHistory } from '../../components/OrderHistory/OrderHistory';
import { formatCompactSize } from '../ladder/format';
import type { LadderOrderActions } from '../ladder/TradingLadder';
import { FillsList } from '../panels/FillsPanel';
import { NONE } from '../panels/PanelFrame';
import { clockTime } from '../panels/TradesPanel';
import { fillPercent, isAwaitingTrigger } from '../panels/ordersModel';
import {
  KIND_LABEL,
  NO_FILTERS,
  marketsWithOrders,
  matchesFilters,
  openOrdersAll,
  priceText,
  rowKey,
  selectAllState,
  sortByTime,
  toggled,
} from './allOrdersModel';
import type { OrderFilters, OrderKind } from './allOrdersModel';

export type AllOrdersTab = 'open' | 'history' | 'fills';

export interface AllOrdersDialogProps {
  open: boolean;
  onClose: () => void;
  /** The ladder's market: History's "only" filter starts from it. */
  market: Market;
  /** The user's orders (useOrders `orders`, user-scoped). */
  orders: readonly UserOrder[];
  /** The ladder's own-order actions; null while there are none. */
  actions: LadderOrderActions | null;
  /** Switch market if needed and bring the order's rung into view. The
   *  dialog closes itself first. */
  onShowOnLadder?: (order: UserOrder) => void;
  /** The tab it opens on. */
  initialTab?: AllOrdersTab;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function AllOrdersDialog(props: AllOrdersDialogProps) {
  if (!props.open) return null;
  return <OpenAllOrders {...props} />;
}

const TABS: { id: AllOrdersTab; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'history', label: 'History' },
  { id: 'fills', label: 'Fills' },
];

function marketOf(id: number): Market | undefined {
  return MARKETS.find(m => m.id === id);
}

function OpenAllOrders({
  onClose,
  market,
  orders,
  actions,
  onShowOnLadder,
  initialTab = 'open',
  returnFocusRef,
}: AllOrdersDialogProps) {
  const [tab, setTab] = useState<AllOrdersTab>(initialTab);
  const [filters, setFilters] = useState<OrderFilters>(NO_FILTERS);
  const uid = useId();
  const tabRefs = useRef<Record<AllOrdersTab, HTMLButtonElement | null>>({ open: null, history: null, fills: null });
  const initialFocus = useRef<HTMLButtonElement | null>(null);

  const listed = useMemo(() => openOrdersAll(orders), [orders]);
  const marketCount = useMemo(() => new Set(listed.map(o => o.marketId)).size, [listed]);

  const description =
    tab === 'open'
      ? `${listed.length} order${listed.length === 1 ? '' : 's'} · ${marketCount} market${marketCount === 1 ? '' : 's'}`
      : 'Latest 100';

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex(t => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const search =
    tab === 'open' ? (
      <label className="flex h-9 w-[220px] flex-none items-center gap-2 rounded-lg border border-ctl bg-surface-2 px-2.5 text-muted max-sm:w-[140px]">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <input
          type="search"
          aria-label="Search orders by price or id"
          placeholder="Price or order id"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-text-strong outline-none placeholder:text-muted"
        />
      </label>
    ) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Your orders"
      description={description}
      headerExtra={search}
      initialFocusRef={initialFocus}
      returnFocusRef={returnFocusRef}
      widthClass="max-w-[1200px]"
      className="h-[min(720px,calc(100dvh-32px))]"
    >
      <div className="flex h-full min-h-0 flex-col text-[13px] tabular-nums">
        <div role="tablist" aria-label="Orders" className="flex h-10 flex-none items-stretch gap-5 border-b border-hairline px-5">
          {TABS.map(t => (
            <button
              key={t.id}
              ref={el => {
                tabRefs.current[t.id] = el;
                if (t.id === tab) initialFocus.current = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
              className={`flex items-center border-b-2 text-[13px] ${
                tab === t.id ? 'border-accent font-semibold text-text-strong' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.id === 'open' ? `${t.label} · ${listed.length}` : t.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${uid}-panel`}
          aria-labelledby={`${uid}-${tab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === 'open' ? (
            <OpenTab
              listed={listed}
              filters={filters}
              setFilters={setFilters}
              actions={actions}
              onShowOnLadder={
                onShowOnLadder
                  ? o => {
                      onClose();
                      onShowOnLadder(o);
                    }
                  : undefined
              }
            />
          ) : tab === 'history' ? (
            <OrderHistory market={market} only="orders" />
          ) : (
            <FillsList orders={orders} />
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---- Open tab ----------------------------------------------------------------

const CHIP =
  'h-[30px] flex-none rounded-full border px-3 text-[12px] aria-pressed:border-accent aria-pressed:bg-mid aria-pressed:text-text-strong';
const CHIP_OFF = 'border-ctl bg-transparent text-text hover:border-accent';

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={`${CHIP} ${pressed ? '' : CHIP_OFF}`}>
      {children}
    </button>
  );
}

interface Notice {
  ok: boolean;
  text: string;
  detail?: string;
}

function OpenTab({
  listed,
  filters,
  setFilters,
  actions,
  onShowOnLadder,
}: {
  listed: UserOrder[];
  filters: OrderFilters;
  setFilters: (f: OrderFilters | ((f: OrderFilters) => OrderFilters)) => void;
  actions: LadderOrderActions | null;
  onShowOnLadder?: (order: UserOrder) => void;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [phase, setPhase] = useState<'idle' | 'asking' | 'running'>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  const focusAsk = useRef(false);

  const chipMarkets = useMemo(() => marketsWithOrders(MARKETS, listed), [listed]);
  const rows = useMemo(
    () => sortByTime(listed.filter(o => matchesFilters(o, marketOf(o.marketId), filters)), newestFirst),
    [listed, filters, newestFirst],
  );
  const pending = actions?.pending;
  const selectable = (o: UserOrder) => actions !== null && o.omsOrderId !== '' && !pending?.has(o.omsOrderId);
  const selectableKeys = rows.filter(selectable).map(rowKey);
  const chosen = rows.filter(o => selected.has(rowKey(o)) && selectable(o));
  const all = selectAllState(selectableKeys, selected);

  // The selection never holds a row that is not on screen (filtered out,
  // cancelled, filled): what is selected is what Cancel selected sends.
  const visibleKeys = rows.map(rowKey).join('|');
  useEffect(() => {
    const keys = new Set(visibleKeys === '' ? [] : visibleKeys.split('|'));
    setSelected(prev => {
      let drop = false;
      for (const k of prev) if (!keys.has(k)) drop = true;
      return drop ? new Set([...prev].filter(k => keys.has(k))) : prev;
    });
  }, [visibleKeys]);

  // The question replaced the bar: its confirm button takes focus. A summary
  // takes focus when a run ends, so it is read out (the strip that also
  // reports it is behind the dialog).
  useEffect(() => {
    if (phase === 'asking') confirmRef.current?.focus();
    else if (phase === 'idle' && focusAsk.current) {
      focusAsk.current = false;
      askRef.current?.focus();
    }
  }, [phase]);
  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  const setAll = (on: boolean) => setSelected(on ? new Set(selectableKeys) : new Set());
  const setOne = (key: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const keep = () => {
    // Back on the button that asked.
    focusAsk.current = true;
    setPhase('idle');
  };

  const confirm = async () => {
    if (!actions || chosen.length === 0) {
      setPhase('idle');
      return;
    }
    setPhase('running');
    setNotice(null);
    const results = await actions.cancelMany(chosen);
    const done = new Set(results.filter(r => r.success).map(r => rowKey(r.order)));
    setSelected(prev => new Set([...prev].filter(k => !done.has(k))));
    const sum = cancelAllSummary(results, 'Cancel selected');
    const detail = results
      .filter(r => !r.success)
      .map(r => `${describe(r.order)}: ${r.message}`)
      .join('\n');
    focusNotice.current = true;
    setNotice({ ok: sum.ok, text: sum.text, detail: detail || undefined });
    setPhase('idle');
  };

  const cancelOne = async (o: UserOrder) => {
    if (!actions) return;
    const r = await actions.cancel(o);
    if (r) {
      setNotice(
        r.success
          ? { ok: true, text: `Cancelled: ${describe(o)}` }
          : { ok: false, text: `Cancel failed: ${describe(o)}: ${r.message}` },
      );
    }
  };

  const toggleSet = <T,>(key: 'markets' | 'sides' | 'kinds', value: T) =>
    setFilters(f => ({ ...f, [key]: toggled(f[key] as ReadonlySet<T>, value) }));

  const filtered =
    filters.markets.size + filters.sides.size + filters.kinds.size > 0 || filters.search.trim() !== '';

  const onBarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phase === 'asking' && e.key === 'Escape') {
      // Esc answers the question (Keep); the dialog stays open.
      e.preventDefault();
      e.stopPropagation();
      keep();
    }
  };

  const th = 'h-8 px-2 text-[12px] font-medium text-muted';

  return (
    <>
      <div
        role="group"
        aria-label="Filter orders"
        className="flex h-[52px] flex-none items-center gap-2 overflow-x-auto border-b border-hairline px-5"
      >
        <Chip pressed={filters.markets.size === 0} onClick={() => setFilters(f => ({ ...f, markets: new Set() }))}>
          All markets
        </Chip>
        {chipMarkets.map(m => (
          <Chip key={m.id} pressed={filters.markets.has(m.id)} onClick={() => toggleSet('markets', m.id)}>
            {m.symbol}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px flex-none bg-hairline" />
        {(['BID', 'ASK'] as OrderSide[]).map(s => (
          <Chip key={s} pressed={filters.sides.has(s)} onClick={() => toggleSet('sides', s)}>
            {s === 'BID' ? 'Buy' : 'Sell'}
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px flex-none bg-hairline" />
        {(['limit', 'stops', 'iceberg'] as OrderKind[]).map(k => (
          <Chip key={k} pressed={filters.kinds.has(k)} onClick={() => toggleSet('kinds', k)}>
            {KIND_LABEL[k]}
          </Chip>
        ))}
      </div>

      <div
        data-selection-bar
        onKeyDown={onBarKey}
        className={`flex h-11 flex-none items-center gap-3 border-b border-hairline px-5 ${
          chosen.length > 0 || phase !== 'idle' ? 'bg-mid' : ''
        }`}
      >
        {phase === 'asking' ? (
          <>
            <span className="font-semibold text-text-strong">
              Cancel {chosen.length} selected order{chosen.length === 1 ? '' : 's'}?
            </span>
            <button
              ref={confirmRef}
              type="button"
              data-cancel-selected-confirm
              onClick={() => void confirm()}
              className="h-[30px] rounded-[7px] border-0 bg-sell px-3 font-semibold text-bg hover:opacity-90"
            >
              Cancel {chosen.length}
            </button>
            <button
              type="button"
              onClick={keep}
              className="h-[30px] rounded-[7px] border border-ctl bg-transparent px-3 text-text hover:border-accent"
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <span className={chosen.length > 0 ? 'font-semibold text-text-strong' : 'text-muted'}>
              {phase === 'running' ? 'Cancelling…' : chosen.length > 0 ? `${chosen.length} selected` : 'None selected'}
            </span>
            <button
              ref={askRef}
              type="button"
              disabled={chosen.length === 0 || phase === 'running'}
              onClick={() => {
                setNotice(null);
                setPhase('asking');
              }}
              className="h-[30px] rounded-[7px] border border-sell bg-transparent px-3 font-semibold text-sell hover:bg-sell-faint disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              Cancel selected…
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || phase === 'running'}
              onClick={() => setSelected(new Set())}
              className="h-[30px] rounded-[7px] border-0 bg-transparent px-3 text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear selection
            </button>
          </>
        )}
        <span className="flex-1" />
        {notice && phase !== 'asking' && (
          <p
            ref={noticeRef}
            tabIndex={-1}
            data-cancel-notice={notice.ok ? 'ok' : 'failed'}
            title={notice.detail}
            className={`m-0 min-w-0 truncate text-[12px] outline-none ${notice.ok ? 'text-text' : 'text-sell'}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        {listed.length === 0 || rows.length === 0 ? (
          <p className="m-0 px-5 py-8 text-center text-[12px] text-muted">
            {listed.length === 0 ? 'No open orders' : filtered ? 'No orders match these filters' : 'No open orders'}
          </p>
        ) : (
          <table className="w-full border-collapse" aria-label="Open orders">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-left">
                <th className="w-11 py-0 pl-3.5 pr-0" scope="col">
                  <Checkbox
                    checked={all === 'all'}
                    indeterminate={all === 'some'}
                    disabled={selectableKeys.length === 0 || phase !== 'idle'}
                    onChange={on => setAll(all === 'some' ? true : on)}
                    aria-label={`Select all, ${chosen.length} of ${selectableKeys.length} selected`}
                  />
                </th>
                <th className={th} scope="col" aria-sort={newestFirst ? 'descending' : 'ascending'}>
                  <button
                    type="button"
                    onClick={() => setNewestFirst(v => !v)}
                    className="flex items-center gap-1 hover:text-text"
                    aria-label={`Time, ${newestFirst ? 'newest' : 'oldest'} first. Reverse`}
                  >
                    Time <span aria-hidden>{newestFirst ? '▾' : '▴'}</span>
                  </button>
                </th>
                <th className={th} scope="col">Market</th>
                <th className={th} scope="col">Side</th>
                <th className={th} scope="col">Type</th>
                <th className={`${th} text-right`} scope="col">Price</th>
                <th className={`${th} text-right`} scope="col">Amount</th>
                <th className={`${th} text-right`} scope="col">Filled</th>
                <th className={`${th} pr-5 text-right`} scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(o => (
                <OrderRow
                  key={rowKey(o)}
                  order={o}
                  selected={selected.has(rowKey(o)) && selectable(o)}
                  selectable={selectable(o) && phase === 'idle'}
                  pending={pending?.get(o.omsOrderId) ?? null}
                  canCancel={actions !== null && o.omsOrderId !== ''}
                  onSelect={on => setOne(rowKey(o), on)}
                  onCancel={() => void cancelOne(o)}
                  onShow={onShowOnLadder && !isAwaitingTrigger(o) ? () => onShowOnLadder(o) : undefined}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** "Buy 0.50 BTC-USD at 97,405", or "... stop loss, awaiting trigger". */
function describe(o: UserOrder): string {
  const m = marketOf(o.marketId);
  const side = o.side === 'BID' ? 'Buy' : 'Sell';
  const amount = formatCompactSize(o.originalQuantity, m ? marketUi(m).sizeDecimals : 8);
  const symbol = m?.symbol ?? o.market;
  if (isAwaitingTrigger(o)) return `${side} ${amount} ${symbol} ${typeLabel(o.type).toLowerCase()}, awaiting trigger`;
  return `${side} ${amount} ${symbol} at ${priceText(o, m)}`;
}

function OrderRow({
  order,
  selected,
  selectable,
  pending,
  canCancel,
  onSelect,
  onCancel,
  onShow,
}: {
  order: UserOrder;
  selected: boolean;
  selectable: boolean;
  pending: string | null;
  canCancel: boolean;
  onSelect: (on: boolean) => void;
  onCancel: () => void;
  onShow?: () => void;
}) {
  const m = marketOf(order.marketId);
  const buy = order.side === 'BID';
  const stop = isAwaitingTrigger(order);
  const amount = formatCompactSize(order.originalQuantity, m ? marketUi(m).sizeDecimals : 8);
  const price = priceText(order, m) ?? NONE;
  const pct = fillPercent(order);
  const what = describe(order);
  const td = 'h-10 px-2 text-[13px]';

  return (
    <tr
      data-all-orders-row={order.omsOrderId}
      data-pending={pending ?? undefined}
      className={`border-t border-hairline ${selected ? 'bg-mid' : ''} ${pending ? 'opacity-60' : ''}`}
    >
      <td className="h-10 py-0 pl-3.5 pr-0">
        <Checkbox
          checked={selected}
          disabled={!selectable}
          onChange={on => onSelect(on)}
          aria-label={`Select ${what}`}
        />
      </td>
      <td className={`${td} text-muted`}>{clockTime(order.timestamp)}</td>
      <td className={`${td} text-text-strong`}>{m?.symbol ?? order.market}</td>
      <td className={`${td} font-semibold ${buy ? 'text-buy' : 'text-sell'}`}>{buy ? 'Buy' : 'Sell'}</td>
      <td className={td}>{stop ? `${typeLabel(order.type)}, awaiting trigger` : typeLabel(order.type)}</td>
      <td
        className={`${td} text-right ${stop ? 'text-muted' : 'text-text-strong'}`}
        title={stop ? 'Trigger price is not available yet' : undefined}
      >
        {price}
      </td>
      <td className={`${td} text-right`}>{amount}</td>
      <td className={`${td} text-right`}>
        <span className="inline-flex items-center gap-2">
          {pct}%
          <span aria-hidden className="h-1 w-12 overflow-hidden rounded-sm bg-chip">
            <span className="block h-1 bg-accent" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </td>
      <td className={`${td} pr-5 text-right`}>
        <span className="inline-flex gap-1.5">
          {onShow && (
            <button
              type="button"
              onClick={onShow}
              aria-label={`Show ${what} on the ladder`}
              className="h-[26px] rounded-md border border-ctl bg-transparent px-2 text-[12px] text-text hover:border-accent"
            >
              Show on ladder
            </button>
          )}
          <button
            type="button"
            disabled={!canCancel || pending !== null}
            onClick={onCancel}
            aria-label={pending === 'cancel' ? `Cancelling ${what}` : `Cancel ${what}`}
            className="grid h-[26px] w-[26px] place-items-center rounded-md border border-ctl bg-transparent text-muted hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '…' : '×'}
          </button>
        </span>
      </td>
    </tr>
  );
}
