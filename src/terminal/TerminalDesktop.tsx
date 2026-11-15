// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop terminal shell (behind ?ui=ladder): a 52px header over a three
 * column grid, 340 | 1fr | 340 at 1440 (280px side columns below 1200,
 * growing to 480px on wider screens), and from 2140px a four column grid,
 * left | 960 | right | far right (see layoutColumns), with 1px hairline
 * gaps. The centre is order entry: the defaults bar, the staging
 * strip and the depth ladder. The side columns are the layout slots (two
 * per column, a height handle between them: four slots, six in wide mode);
 * each slot's title picks its panel (layout/, DESIGN.md rules 15 and 16).
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import type {
  ClusterState,
  ExtendedConnectionStatus,
  Market,
  MarketStats,
  OrderBook,
  OrderRequest,
  TapeTrade,
  UserOrder,
} from '../types/market';
import type { LevelChange } from '../hooks/useOrderBook';
import type { Theme } from '../hooks/useTheme';
import { MarketSelector } from '../components/MarketSelector/MarketSelector';
import { Header } from './Header';
import { SIDE_COLUMNS } from './layoutColumns';
import { TradingLadder } from './ladder/TradingLadder';
import type { LadderOrderActions } from './ladder/TradingLadder';
import type { LadderReveal } from './ladder/useLadderKeys';
import { SideColumn } from './layout/SideColumn';
import type { SlotChrome } from './layout/SideColumn';
import { useLayout } from './layout/useLayout';
import type { PanelId } from './layout/registry';
import { MarketsPanel } from './panels/MarketsPanel';
import type { TickerMap } from '../utils/tickers';
import { TradesPanel } from './panels/TradesPanel';
import { ChartPanel } from './panels/ChartPanel';
import type { ChartData } from './panels/ChartPanel';
import { OrdersPanel } from './panels/OrdersPanel';
import type { OrdersPanelProps } from './panels/OrdersPanel';
import { FillsPanel } from './panels/FillsPanel';
import { BalancesPanel } from './panels/BalancesPanel';

export interface TerminalDesktopProps {
  market: Market;
  markets: Market[];
  onSelectMarket: (market: Market) => void;
  stats: MarketStats | null;
  /** Other markets' tickers from the all-market TICKERS frame (empty until
   *  the backend sends one: those markets then print a dash). */
  tickers: TickerMap;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  openOrders: UserOrder[];
  /** Every order in the user's feed (useOrders `orders`), including stops
   *  awaiting their trigger; the Orders and Fills panels read it. */
  orders: UserOrder[];
  trades: TapeTrade[];
  chart: ChartData;
  status: ExtendedConnectionStatus;
  clusterState?: ClusterState;
  onReconnect: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  username: string | null;
  signedIn: boolean;
  onSignIn: () => void;
  onOpenAccount: () => void;
  /** The page's order submit handler (the same one the order form uses). */
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  /** Async reject of an accepted order, from the user's order stream. */
  rejectNotice: { text: string; code: string | null } | null;
  /** The page's cancel handler (keyed on omsOrderId). */
  onCancelOrder: (order: UserOrder) => Promise<{ success: boolean; message: string }>;
  /** The page's replace handler; the ladder's Move sends the price only. */
  onReplaceOrder: (order: UserOrder, price?: number, quantity?: number) => Promise<{ success: boolean; message: string }>;
}

export interface ActionsStore {
  get: () => LadderOrderActions | null;
  set: (actions: LadderOrderActions | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createActionsStore(): ActionsStore {
  let value: LadderOrderActions | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: next => {
      if (next === value) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function ConnectedOrdersPanel({ store, ...rest }: Omit<OrdersPanelProps, 'actions'> & { store: ActionsStore }) {
  const actions = useSyncExternalStore(store.subscribe, store.get, store.get);
  return <OrdersPanel {...rest} actions={actions} />;
}

export function TerminalDesktop(props: TerminalDesktopProps) {
  const [marketsOpen, setMarketsOpen] = useState(false);
  const { market, stats, orderBook } = props;
  const layout = useLayout();
  // The ladder's own-order actions, for the Orders panel (cancel, Cancel
  // all). Held in a small store, not in this component's state: a change
  // (a cancel going pending) re-renders the Orders panel only, never the
  // shell and the ladder around it.
  const [actionsStore] = useState(createActionsStore);

  // Show on ladder (the all-orders dialog): switch to the order's market if
  // needed; the ladder brings the order's rung into view once its book is in.
  const [reveal, setReveal] = useState<LadderReveal | null>(null);
  const { markets, onSelectMarket } = props;
  const showOnLadder = useCallback(
    (order: UserOrder) => {
      if (order.marketId !== market.id) {
        const next = markets.find(m => m.id === order.marketId);
        if (!next) return;
        onSelectMarket(next);
      }
      setReveal(prev => ({ seq: (prev?.seq ?? 0) + 1, order }));
    },
    [market.id, markets, onSelectMarket],
  );

  const renderPanel = (panel: PanelId, chrome: SlotChrome) => {
    switch (panel) {
      case 'markets':
        return (
          <MarketsPanel
            chrome={chrome}
            markets={props.markets}
            market={market}
            stats={stats}
            tickers={props.tickers}
            onSelectMarket={props.onSelectMarket}
          />
        );
      case 'trades':
        return <TradesPanel chrome={chrome} market={market} trades={props.trades} />;
      case 'chart':
        return <ChartPanel chrome={chrome} symbol={market.symbol} theme={props.theme} chart={props.chart} />;
      case 'orders':
        return (
          <ConnectedOrdersPanel
            store={actionsStore}
            chrome={chrome}
            market={market}
            orders={props.orders}
            signedIn={props.signedIn}
            onSignIn={props.onSignIn}
            onShowOnLadder={showOnLadder}
          />
        );
      case 'fills':
        return <FillsPanel chrome={chrome} signedIn={props.signedIn} onSignIn={props.onSignIn} orders={props.orders} />;
      case 'balances':
        return <BalancesPanel chrome={chrome} signedIn={props.signedIn} onSignIn={props.onSignIn} />;
    }
  };

  return (
    <div data-terminal="desktop" className="flex h-screen flex-col bg-bg text-[13px] text-text tabular-nums">
      <Header
        market={market}
        onOpenMarkets={() => setMarketsOpen(true)}
        marketsOpen={marketsOpen}
        stats={stats}
        bestBid={orderBook.bids[0]?.price ?? null}
        status={props.status}
        clusterState={props.clusterState}
        onReconnect={props.onReconnect}
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        username={props.username}
        onSignIn={props.onSignIn}
        onOpenAccount={props.onOpenAccount}
      />

      <main className={`grid min-h-0 flex-1 gap-px bg-hairline ${SIDE_COLUMNS}`}>
        <SideColumn column="left" api={layout} renderPanel={renderPanel} />
        <section aria-label="Depth ladder" className="flex min-h-0 min-w-0 flex-col bg-surface">
          <TradingLadder
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
            reveal={reveal}
          />
        </section>
        <SideColumn column="right" api={layout} renderPanel={renderPanel} />
        {layout.mode === 'wide' && <SideColumn column="farRight" api={layout} renderPanel={renderPanel} />}
      </main>

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
