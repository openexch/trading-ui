// SPDX-License-Identifier: Apache-2.0
/**
 * Markets: every market in `MARKETS` as a 50 px row (symbol and name, price
 * and change). The selected market shows its own live ticker; the others
 * show their entry from the all-market TICKERS frame. A market with no entry
 * (a gateway that does not send TICKERS yet, or a market with no price)
 * prints a dash rather than a stale or invented number (DESIGN.md rule 14).
 * Dash and value sit in a fixed-width tabular column, so a price arriving
 * never shifts the row. A row click switches the market.
 */
import type { Market, MarketStats } from '../../types/market';
import { EMPTY_TICKERS, marketRowStats } from '../../utils/tickers';
import type { TickerMap } from '../../utils/tickers';
import { tickDecimals } from '../../utils/ticks';
import { formatFixed } from '../ladder/format';
import type { SlotChrome } from '../layout/SideColumn';
import { NONE, PanelFrame } from './PanelFrame';

export interface MarketsPanelProps {
  chrome: SlotChrome;
  markets: Market[];
  market: Market;
  stats: MarketStats | null;
  /** Other markets' tickers (utils/tickers); empty means dashes. */
  tickers?: TickerMap;
  onSelectMarket: (market: Market) => void;
}

export function MarketsPanel({ chrome, markets, market, stats, tickers = EMPTY_TICKERS, onSelectMarket }: MarketsPanelProps) {
  return (
    <PanelFrame label="Markets" position={chrome.position} header={chrome.picker()}>
      <ul className="m-0 list-none p-0">
        {markets.map(m => {
          const selected = m.id === market.id;
          const live = marketRowStats(m.id, market.id, stats, tickers);
          const up = live ? live.priceChange >= 0 : true;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  if (!selected) onSelectMarket(m);
                }}
                data-market-row={m.symbol}
                className={`flex h-[50px] w-full items-center justify-between gap-3 border-b border-hairline px-4 text-left font-[inherit] ${
                  selected ? 'bg-chip' : 'bg-transparent hover:bg-surface-2'
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-text-strong">{m.symbol}</span>
                  <span className="truncate text-[12px] text-muted">{m.name}</span>
                </span>
                <span
                  className="flex min-w-[9ch] flex-none flex-col items-end text-right tabular-nums"
                  title={live ? undefined : 'No live price for this market yet'}
                >
                  <span className={live ? 'text-text-strong' : 'text-muted'}>
                    {live ? formatFixed(live.lastPrice, tickDecimals(m.tickSize)) : NONE}
                  </span>
                  <span className={`text-[12px] ${live ? (up ? 'text-buy' : 'text-sell') : 'text-muted'}`}>
                    {live ? `${up ? '+' : ''}${live.priceChangePercent.toFixed(2)}%` : NONE}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
