// SPDX-License-Identifier: Apache-2.0
/**
 * Markets: every market in `MARKETS` as a 50 px row (symbol and name, price
 * and change). Only the selected market has a live price: the gateway
 * broadcasts per subscribed market, so the others print a dash rather than
 * a stale or invented number (DESIGN.md rule 14). A row click switches the
 * market.
 */
import type { Market, MarketStats } from '../../types/market';
import { tickDecimals } from '../../utils/ticks';
import { formatFixed } from '../ladder/format';
import type { SlotChrome } from '../layout/SideColumn';
import { NONE, PanelFrame } from './PanelFrame';

export interface MarketsPanelProps {
  chrome: SlotChrome;
  markets: Market[];
  market: Market;
  stats: MarketStats | null;
  onSelectMarket: (market: Market) => void;
}

export function MarketsPanel({ chrome, markets, market, stats, onSelectMarket }: MarketsPanelProps) {
  return (
    <PanelFrame label="Markets" position={chrome.position} header={chrome.picker()}>
      <ul className="m-0 list-none p-0">
        {markets.map(m => {
          const selected = m.id === market.id;
          const live = selected && stats !== null && stats.lastPrice > 0 ? stats : null;
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
                  className="flex flex-none flex-col items-end tabular-nums"
                  title={selected ? undefined : 'Live price shows for the selected market only'}
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
