// SPDX-License-Identifier: Apache-2.0
/**
 * Desktop terminal shell (behind ?ui=ladder): a 52px header over a three
 * column grid, 340 | 1fr | 340 at 1440 (280px side columns below 1200), with
 * 1px hairline gaps. The depth ladder is the fixed centre. The side columns
 * temporarily hold the existing panels, passed in by the page.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ClusterState, ExtendedConnectionStatus, Market, MarketStats, OrderBook, UserOrder } from '../types/market';
import type { LevelChange } from '../hooks/useOrderBook';
import type { Theme } from '../hooks/useTheme';
import { MarketSelector } from '../components/MarketSelector/MarketSelector';
import { Header, SIDE_COLUMNS } from './Header';
import { Ladder } from './ladder/Ladder';

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
  onSignIn: () => void;
  onOpenAccount: () => void;
  /** Left column content (interim: existing panels). */
  left: ReactNode;
  /** Right column content (interim: existing panels). */
  right: ReactNode;
}

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
        <aside aria-label="Left panels" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
          {props.left}
        </aside>
        <section aria-label="Depth ladder" className="flex min-h-0 min-w-0 flex-col bg-surface">
          <Ladder
            market={market}
            orderBook={orderBook}
            levelChanges={props.levelChanges}
            openOrders={props.openOrders}
            lastPrice={stats ? stats.lastPrice : null}
          />
        </section>
        <aside aria-label="Right panels" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
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
