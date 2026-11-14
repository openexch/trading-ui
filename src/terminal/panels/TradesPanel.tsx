// SPDX-License-Identifier: Apache-2.0
/**
 * Trades: the market tape in 24 px rows, a B / S tag, price in the side's
 * colour, size and time. The side rule is TradeList's (taker side, else a
 * tick test); rows keep the ingest `seq` as their key and have no mount
 * animation (DESIGN.md rule 4). Skeleton rows until the first batch.
 */
import type { Market, TapeTrade } from '../../types/market';
import { isBuyAt } from '../../components/Trades/TradeList';
import { marketUi } from '../../trading/marketUi';
import { tickDecimals } from '../../utils/ticks';
import { formatFixed } from '../ladder/format';
import type { SlotChrome } from '../layout/SideColumn';
import { PanelFrame } from './PanelFrame';

export interface TradesPanelProps {
  chrome: SlotChrome;
  market: Market;
  trades: TapeTrade[];
}

/** "14:03:59", local time, 24 hour. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const ROW = 'grid h-6 grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_64px] items-center gap-1.5 pl-3 pr-4 text-[12px]';

export function TradesPanel({ chrome, market, trades }: TradesPanelProps) {
  const priceDecimals = tickDecimals(market.tickSize);
  const sizeDecimals = marketUi(market).sizeDecimals;
  return (
    <PanelFrame label="Trades" position={chrome.position} header={chrome.picker()}>
      {trades.length === 0 ? (
        <div aria-hidden data-trades-skeleton className="animate-pulse">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className={ROW}>
              <span className="h-2.5 w-2.5 rounded-sm bg-surface-2" />
              <span className="h-3 rounded-sm bg-surface-2" style={{ width: `${[60, 45, 70, 50, 65][i % 5]}%` }} />
              <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${[50, 65, 40, 70, 45][i % 5]}%` }} />
              <span className="h-3 w-full rounded-sm bg-surface-2" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="m-0 list-none p-0" aria-label={`Recent ${market.symbol} trades`}>
          {trades.map((t, i) => {
            const buy = isBuyAt(trades, i);
            return (
              <li key={t.seq} data-trade-row className={ROW}>
                <span className={`text-[10px] font-bold ${buy ? 'text-buy' : 'text-sell'}`}>
                  <span aria-hidden>{buy ? 'B' : 'S'}</span>
                  <span className="sr-only">{buy ? 'Buy' : 'Sell'}</span>
                </span>
                <span className={`truncate ${buy ? 'text-buy' : 'text-sell'}`}>{formatFixed(t.price, priceDecimals)}</span>
                <span className="flex items-center justify-end gap-1 truncate text-right text-text">
                  {formatFixed(t.quantity, sizeDecimals)}
                  {t.tradeCount > 1 && <span className="text-[10px] text-muted">×{t.tradeCount}</span>}
                </span>
                <span className="text-right text-muted">{clockTime(t.timestamp)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </PanelFrame>
  );
}
