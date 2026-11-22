// SPDX-License-Identifier: Apache-2.0
/**
 * Trades: the market tape in 24 px rows, a B / S tag, price in the side's
 * colour, size, the trade's matching-engine journal sequence and time. The
 * side rule is TradeList's (taker side, else a tick test); rows keep the
 * ingest `seq` as their key and have no mount animation (DESIGN.md rule 4).
 * Skeleton rows until the first batch.
 *
 * - The journal sequence is labelled as one (the column head and each
 *   cell's title): it is the matching engine's journal, not a log position.
 *   A trade the service sends without one prints a dash.
 * - Elections are ledger rows: a leader election's start and end, from the
 *   user stream's election frames, are written into the tape in time order
 *   (signed in only: the frames ride the user's stream).
 */
import type { Market, TapeTrade } from '../../types/market';
import type { ElectionEvent } from '../../ledger/engine';
import { CLUSTER_NAME } from '../../ledger/engine';
import { useElections } from '../../ledger/engineStore';
import { formatDuration, formatId, formatSeq, LOG_INK } from '../../ledger/format';
import { HEADER_RULE } from '../ladder/Rung';
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
  /** Tests: fixed election rows instead of the engine store's. */
  elections?: readonly ElectionEvent[];
}

/** An election row's words. */
export function electionText(e: ElectionEvent): string {
  const name = CLUSTER_NAME[e.cluster];
  if (e.phase === 'start') {
    return `${name} election started · leader ${formatId(e.previousLeaderId)} lost · term ${formatId(e.previousTerm)}`;
  }
  const gap = e.observedGapMs !== null ? ` · ${formatDuration(e.observedGapMs)}` : '';
  return `${name} election ended · leader ${formatId(e.leaderId)} · term ${formatId(e.term)}${gap}`;
}

type TapeRow = { kind: 'trade'; t: TapeTrade; i: number } | { kind: 'election'; e: ElectionEvent };

/** Trades and election rows, newest first. An election row sits above the
 *  trades older than it. */
export function tapeRows(trades: readonly TapeTrade[], elections: readonly ElectionEvent[]): TapeRow[] {
  const rows: TapeRow[] = [];
  const es = [...elections].sort((a, b) => b.atMs - a.atMs);
  let j = 0;
  trades.forEach((t, i) => {
    while (j < es.length && es[j].atMs >= t.timestamp) rows.push({ kind: 'election', e: es[j++] });
    rows.push({ kind: 'trade', t, i });
  });
  while (j < es.length) rows.push({ kind: 'election', e: es[j++] });
  return rows;
}

/** "14:03:59", local time, 24 hour. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const COLS = 'grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_56px] items-center gap-1.5 pl-3 pr-4';
const ROW = `${COLS} h-6 border-b border-hairline text-[12px]`;
const HEAD = `${COLS} h-7 text-[11px] text-muted`;

export function TradesPanel({ chrome, market, trades, elections: fixed }: TradesPanelProps) {
  const priceDecimals = tickDecimals(market.tickSize);
  const sizeDecimals = marketUi(market).sizeDecimals;
  const live = useElections();
  const elections = fixed ?? live;
  return (
    <PanelFrame label="Trades" position={chrome.position} header={chrome.picker()}>
      {trades.length === 0 ? (
        <div aria-hidden data-trades-skeleton className="animate-pulse">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className={ROW}>
              <span className="h-2.5 w-2.5 rounded-sm bg-surface-2" />
              <span className="h-3 rounded-sm bg-surface-2" style={{ width: `${[60, 45, 70, 50, 65][i % 5]}%` }} />
              <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${[50, 65, 40, 70, 45][i % 5]}%` }} />
              <span className="h-3 justify-self-end rounded-sm bg-surface-2" style={{ width: `${[70, 55, 60, 45, 65][i % 5]}%` }} />
              <span className="h-3 w-full rounded-sm bg-surface-2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div aria-hidden className={`${HEAD} ${HEADER_RULE}`}>
            <span />
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Journal seq</span>
            <span className="text-right">Time</span>
          </div>
          <ul className="m-0 list-none p-0" aria-label={`Recent ${market.symbol} trades`}>
            {tapeRows(trades, elections).map(r => {
              if (r.kind === 'election') {
                const e = r.e;
                const start = e.phase === 'start';
                return (
                  <li
                    key={`el-${e.cluster}-${e.phase}-${e.atMs}`}
                    data-election-row={e.phase}
                    className={`grid h-6 grid-cols-[minmax(0,1fr)_56px] items-center gap-1.5 border-b border-hairline pl-3 pr-4 text-[12px] ${
                      start ? 'bg-warn-soft' : ''
                    }`}
                  >
                    <span className={`truncate font-medium ${start ? 'text-warn' : 'text-text-strong'}`} title={electionText(e)}>
                      {electionText(e)}
                    </span>
                    <span className="text-right text-muted">{clockTime(e.atMs)}</span>
                  </li>
                );
              }
              const t = r.t;
              const buy = isBuyAt(trades, r.i);
              const seq = t.journalSeq ?? null;
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
                  <span
                    data-journal-seq
                    title={seq === null ? 'Journal seq not supplied' : `ME journal seq ${seq}`}
                    className={`truncate text-right ${seq === null ? 'text-muted' : LOG_INK}`}
                  >
                    <span className="sr-only">journal seq </span>
                    {formatSeq(seq)}
                  </span>
                  <span className="text-right text-muted">{clockTime(t.timestamp)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PanelFrame>
  );
}
