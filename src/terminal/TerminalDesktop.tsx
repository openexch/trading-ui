// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop terminal shell (behind ?ui=ladder): a 52px header over a three
 * column grid, 340 | 1fr | 340 at 1440 (280px side columns below 1200,
 * growing to 480px on wide screens; see layoutColumns), with 1px hairline
 * gaps. The centre is order entry: the defaults bar, the staging
 * strip and the depth ladder. The side columns temporarily hold the existing
 * panels, passed in by the page; every direct child of a side column is
 * stretched to the column's full width, whatever its own sizing.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ClusterState,
  ExtendedConnectionStatus,
  Market,
  MarketStats,
  OrderBook,
  OrderRequest,
  UserOrder,
} from '../types/market';
import type { LevelChange } from '../hooks/useOrderBook';
import type { Theme } from '../hooks/useTheme';
import { MarketSelector } from '../components/MarketSelector/MarketSelector';
import { Header } from './Header';
import { SIDE_COLUMNS } from './layoutColumns';
import { TradingLadder } from './ladder/TradingLadder';

export interface TerminalDesktopProps {
  market: Market;
  markets: Market[];
  onSelectMarket: (market: Market) => void;
  stats: MarketStats | null;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  openOrders: UserOrder[];
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
  /** Left column content (interim: existing panels). */
  left: ReactNode;
  /** Right column content (interim: existing panels). */
  right: ReactNode;
}

/** A side column: its panels fill the slot width (`w-full` on every direct
 *  child, `min-w-0` so long content truncates rather than widening it). */
const SIDE_PANEL =
  'flex min-h-0 w-full min-w-0 flex-col items-stretch overflow-hidden bg-surface [&>*]:w-full [&>*]:min-w-0';

export function TerminalDesktop(props: TerminalDesktopProps) {
  const [marketsOpen, setMarketsOpen] = useState(false);
  const { market, stats, orderBook } = props;

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
        <aside aria-label="Left panels" className={SIDE_PANEL}>
          {props.left}
        </aside>
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
          />
        </section>
        <aside aria-label="Right panels" className={SIDE_PANEL}>
          {props.right}
        </aside>
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
