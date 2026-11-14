// SPDX-License-Identifier: Apache-2.0
/**
 * Phone terminal shell (behind ?ui=ladder, 768px wide and below): a 56px
 * header (market button, price hero, live dot, menu), the tab body and a
 * bottom nav: Ladder, Chart, Orders N, Trades.
 *
 * - The ladder is the main tab: the settings row, 44px rungs and the
 *   staging sheet (TradingLadder `variant="phone"`). It stays mounted while
 *   another tab is open, so a staged order and the per-order pending state
 *   survive a tab switch, and the Orders tab's cancels go through the same
 *   own-order actions as the ladder.
 * - The staging sheet renders into a host above the nav, outside the tab
 *   panels: a Cancel all asked from the Orders tab is answered on that tab.
 * - Chart, Orders and Trades reuse the desktop panels.
 * - No one-click control exists on the phone (DESIGN.md rule 10).
 * - Safe-area insets: the page opts into `viewport-fit=cover` while this
 *   shell is mounted (restored on unmount, so the default screen is
 *   unchanged), and the header, nav and sides pad by the insets.
 * - Every control is a 44px touch target; nothing scrolls sideways at 390px.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ExtendedConnectionStatus } from '../types/market';
import { EV, track, updateContext } from '../analytics';
import { MarketSelector } from '../components/MarketSelector/MarketSelector';
import { Menu, MenuItem, useMenuTrigger } from '../ui';
import { useTickDirection } from '../ui/useTickDirection';
import { tickDecimals } from '../utils/ticks';
import { formatFixed } from './ladder/format';
import { TradingLadder } from './ladder/TradingLadder';
import type { SlotChrome } from './layout/SideColumn';
import { ChartPanel } from './panels/ChartPanel';
import { TradesPanel } from './panels/TradesPanel';
import { panelOrders } from './panels/ordersModel';
import { ConnectedOrdersPanel, createActionsStore } from './TerminalDesktop';
import type { TerminalDesktopProps } from './TerminalDesktop';

/** The phone takes the same values and callbacks as the desktop shell. */
export type TerminalPhoneProps = TerminalDesktopProps;

export type PhoneTab = 'ladder' | 'chart' | 'orders' | 'trades';

/** Placeholder for a value that has not arrived (en dash, not a zero). */
const NONE = '–';

const STATUS_WORDS: Record<ExtendedConnectionStatus, string> = {
  connected: 'live',
  connecting: 'connecting',
  'cluster-electing': 'electing a leader',
  'cluster-updating': 'updating',
  'cluster-reconnecting': 'reconnecting',
  disconnected: 'offline',
  error: 'error',
};

function statusDot(status: ExtendedConnectionStatus): string {
  if (status === 'connected') return 'bg-buy';
  if (status === 'disconnected' || status === 'error') return 'bg-sell';
  return 'bg-warn animate-pulse-soft';
}

/** Let the page draw under the notch and home indicator while mounted; the
 *  shell pads by the safe-area insets instead. */
function useViewportFitCover() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const before = meta.content;
    if (!/viewport-fit\s*=/.test(before)) meta.content = `${before}, viewport-fit=cover`;
    return () => {
      meta.content = before;
    };
  }, []);
}

/** A panel title in place of the desktop slot picker. */
function phoneChrome(title: string): SlotChrome {
  return {
    slot: 0,
    position: 'top',
    picker: (variant = 'title') =>
      variant === 'icon' ? null : (
        <h2 className="m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{title}</h2>
      ),
  };
}

function PhoneHeader(props: TerminalPhoneProps & { onOpenMarkets: () => void; marketsOpen: boolean }) {
  const { market, stats, status } = props;
  const d = tickDecimals(market.tickSize);
  const raw = stats ? stats.lastPrice || props.orderBook.bids[0]?.price || 0 : null;
  const price = raw !== null && raw > 0 ? raw : null;
  const { tick, dir } = useTickDirection(price);
  const pct = stats?.priceChangePercent ?? null;
  const up = (stats?.priceChange ?? 0) >= 0;
  const menu = useMenuTrigger();
  const down = status === 'disconnected' || status === 'error';
  const isDark = props.theme === 'dark';

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    props.onToggleTheme();
    track(EV.theme_change, { from: props.theme, to: next });
    updateContext({ color_scheme: next });
  };

  return (
    <header className="box-content flex h-14 flex-none items-center gap-2.5 border-b border-hairline bg-surface pl-4 pr-2 pt-[env(safe-area-inset-top)]">
      <button
        type="button"
        onClick={props.onOpenMarkets}
        aria-haspopup="dialog"
        aria-expanded={props.marketsOpen}
        aria-label={`Market ${market.symbol}. Change market`}
        className="flex h-11 flex-none items-center gap-1.5 font-semibold text-text-strong"
      >
        {market.symbol}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-muted">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <span
        data-ticker-price
        className={`flex min-w-0 items-baseline gap-0.5 font-display text-[20px] font-bold tabular-nums leading-none transition-colors ${
          price === null
            ? 'text-muted'
            : tick === 'up'
              ? 'text-buy'
              : tick === 'down'
                ? 'text-sell'
                : dir === 'down'
                  ? 'text-sell'
                  : dir === 'up'
                    ? 'text-buy'
                    : 'text-text-strong'
        }`}
      >
        <span className="truncate">{price !== null ? formatFixed(price, d) : NONE}</span>
        {/* Fixed-width slot, invisible before the first move (DESIGN.md rule 3). */}
        <span
          aria-label={dir ? `last move ${dir}` : undefined}
          className={`w-3 flex-none text-center text-[11px] ${dir ? '' : 'opacity-0'}`}
        >
          {dir === 'down' ? '▼' : '▲'}
        </span>
      </span>
      <span className={`flex-none text-[12px] tabular-nums ${pct === null ? 'text-muted' : up ? 'text-buy' : 'text-sell'}`}>
        {pct === null ? NONE : `${up ? '+' : ''}${pct.toFixed(2)}%`}
      </span>
      <div className="min-w-0 flex-1" />
      {down ? (
        <button
          type="button"
          onClick={props.onReconnect}
          aria-label={`Connection ${STATUS_WORDS[status]}. Reconnect`}
          className="flex h-11 flex-none items-center gap-1.5 rounded-full px-2 text-[12px] text-sell"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-sell" />
          Reconnect
        </button>
      ) : (
        <span
          role="img"
          data-status={status}
          aria-label={`Connection ${STATUS_WORDS[status]}`}
          title={`Connection ${STATUS_WORDS[status]}`}
          className={`h-2 w-2 flex-none rounded-full ${statusDot(status)}`}
        />
      )}
      <button
        type="button"
        {...menu.triggerProps}
        aria-label={props.username ? `Menu, signed in as ${props.username}` : 'Menu'}
        className="grid h-11 w-11 flex-none place-items-center rounded-full text-text-strong"
      >
        {props.username ? (
          <span className="grid h-8 w-8 place-items-center rounded-full border border-ctl text-[13px] font-semibold uppercase">
            {props.username.slice(0, 1)}
          </span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <Menu {...menu.menuProps} label="Menu" placement="bottom-end" className="[&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-[14px]">
        {props.username ? (
          <MenuItem onSelect={props.onOpenAccount}>Account and balances</MenuItem>
        ) : (
          <MenuItem onSelect={props.onSignIn}>Sign in</MenuItem>
        )}
        <MenuItem onSelect={toggleTheme}>{isDark ? 'Switch to light theme' : 'Switch to dark theme'}</MenuItem>
      </Menu>
    </header>
  );
}

function NavTab({ tab, active, onSelect, children }: { tab: PhoneTab; active: boolean; onSelect: (t: PhoneTab) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-tab={tab}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(tab)}
      className={`relative grid min-h-12 place-items-center text-[13px] ${active ? 'font-semibold text-text-strong' : 'text-muted'}`}
    >
      {active && <span aria-hidden className="absolute inset-x-[30%] top-0 h-0.5 rounded-sm bg-accent" />}
      {children}
    </button>
  );
}

export function TerminalPhone(props: TerminalPhoneProps) {
  const { market, stats, orderBook } = props;
  const [tab, setTab] = useState<PhoneTab>('ladder');
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [sheetHost, setSheetHost] = useState<HTMLElement | null>(null);
  const [actionsStore] = useState(createActionsStore);
  useViewportFitCover();

  const openHere = useMemo(() => panelOrders(props.orders, market.id).here.length, [props.orders, market.id]);
  const ordersLabel = props.signedIn ? `Orders ${openHere}` : 'Orders';

  return (
    <div
      data-terminal="phone"
      className="flex h-screen w-full flex-col overflow-hidden bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-[14px] text-text tabular-nums supports-[height:100dvh]:h-dvh"
    >
      <PhoneHeader {...props} onOpenMarkets={() => setMarketsOpen(true)} marketsOpen={marketsOpen} />

      <main className="relative flex min-h-0 flex-1 flex-col">
        <section
          aria-label="Depth ladder"
          hidden={tab !== 'ladder'}
          className="flex min-h-0 flex-1 flex-col bg-surface"
        >
          <TradingLadder
            variant="phone"
            active={tab === 'ladder'}
            sheetHost={sheetHost}
            market={market}
            orderBook={orderBook}
            levelChanges={props.levelChanges}
            openOrders={props.openOrders}
            lastPrice={stats ? stats.lastPrice : null}
            signedIn={props.signedIn}
            onSubmitOrder={props.onSubmitOrder}
            onRequestSignIn={props.onSignIn}
            rejectNotice={props.rejectNotice}
            status={props.status}
            onCancelOrder={props.onCancelOrder}
            onReplaceOrder={props.onReplaceOrder}
            onOrderActions={actionsStore.set}
          />
        </section>
        {tab === 'chart' && (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <ChartPanel chrome={phoneChrome('Chart')} symbol={market.symbol} theme={props.theme} chart={props.chart} />
          </div>
        )}
        {tab === 'orders' && (
          // The compact list is the desktop panel; on the phone its rows and
          // buttons grow to 44px touch targets from here.
          <div
            className="flex min-h-0 flex-1 flex-col bg-surface [&_[data-order-row]]:h-11 [&_[data-order-row]]:grid-cols-[3px_72px_minmax(0,1fr)_72px_40px_44px] [&_[data-order-row]_button]:h-11 [&_[data-order-row]_button]:w-11 [&_[data-order-row]_button]:border-0 [&_[data-panel]>div:first-child_button[aria-label]]:h-11 [&_[data-panel]>div:first-child_button[aria-label]]:w-11"
          >
            <ConnectedOrdersPanel
              store={actionsStore}
              chrome={phoneChrome('Orders')}
              market={market}
              orders={props.orders}
              signedIn={props.signedIn}
              onSignIn={props.onSignIn}
            />
          </div>
        )}
        {tab === 'trades' && (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <TradesPanel chrome={phoneChrome('Trades')} market={market} trades={props.trades} />
          </div>
        )}
        {/* The staging sheet and results, above every tab. */}
        <div ref={setSheetHost} data-sheet-host className="pointer-events-none absolute inset-x-0 bottom-0 z-20" />
      </main>

      <nav
        aria-label="Sections"
        className="relative z-30 box-content grid h-16 flex-none grid-cols-4 border-t border-hairline bg-surface pb-[max(8px,env(safe-area-inset-bottom))]"
      >
        <NavTab tab="ladder" active={tab === 'ladder'} onSelect={setTab}>
          Ladder
        </NavTab>
        <NavTab tab="chart" active={tab === 'chart'} onSelect={setTab}>
          Chart
        </NavTab>
        <NavTab tab="orders" active={tab === 'orders'} onSelect={setTab}>
          {ordersLabel}
        </NavTab>
        <NavTab tab="trades" active={tab === 'trades'} onSelect={setTab}>
          Trades
        </NavTab>
      </nav>

      {marketsOpen && (
        <MarketSelector
          markets={props.markets}
          selectedMarket={market}
          onSelectMarket={props.onSelectMarket}
          isOverlay
          onClose={() => setMarketsOpen(false)}
        />
      )}
    </div>
  );
}
