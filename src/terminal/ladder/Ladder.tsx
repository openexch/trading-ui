// SPDX-License-Identifier: Apache-2.0
/**
 * The depth ladder (read-only view). Order entry arrives later; this renders
 * the book as fixed 22px rungs around the last trade, with own orders, the
 * spread line and the last-trade rung.
 *
 * Layout, top to bottom, inside a 640px column:
 *   jump-above slot (fixed height, Re-centre on the left)
 *   column header with the grouping select
 *   rung area (measured: its height sets the odd row count)
 *   jump-below slot (fixed height)
 * The marker slots are always reserved, so a marker appearing never resizes
 * the rung area or moves a rung.
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Market, OrderBook, UserOrder } from '../../types/market';
import type { LevelChange } from '../../hooks/useOrderBook';
import { marketUi, groupingOptions } from '../../trading/marketUi';
import { useTickDirection } from '../../ui/useTickDirection';
import { buildLadder, defaultCentre, ladderWindow } from './ladderModel';
import type { LadderModel, LadderRow } from './ladderModel';
import { RUNG_PX, useLadderWindow } from './useLadderWindow';
import { LADDER_COLUMNS, Rung, SkeletonRung } from './Rung';
import type { PriceTone } from './Rung';
import { JumpMarker } from './JumpMarker';
import { formatFixed, formatSmall } from './format';

export interface LadderProps {
  market: Market;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  /** The user-scoped open orders (all markets); the model keeps this market's. */
  openOrders: UserOrder[];
  /** Last trade price; null while a market switch is in flight. */
  lastPrice: number | null;
}

/** The rung the window follows, or null when the model has nothing yet. */
function anchorOf(model: LadderModel): number | null {
  if (model.lastTradeRung === null && model.bestBidRung === null && model.bestAskRung === null) return null;
  return defaultCentre(model);
}

function toneOf(model: LadderModel, rung: number): PriceTone {
  if (model.bestAskRung !== null && rung >= model.bestAskRung) return 'sell';
  if (model.bestBidRung !== null && rung <= model.bestBidRung) return 'buy';
  return 'muted';
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
}

export function Ladder({ market, orderBook, levelChanges, openOrders, lastPrice }: LadderProps) {
  const ui = marketUi(market);
  // Grouping belongs to the market it was chosen on; a switch starts from the
  // next market's default.
  const [groupSel, setGroupSel] = useState<{ marketId: number; mult: number } | null>(null);
  const groupTicks = groupSel && groupSel.marketId === market.id ? groupSel.mult : ui.defaultGrouping;
  const options = useMemo(() => groupingOptions(market), [market]);
  const groupLabel = options.find(o => o.multiplier === groupTicks)?.label ?? String(groupTicks);

  const live = lastPrice !== null && lastPrice > 0 ? lastPrice : null;
  const model = useMemo(
    () => buildLadder({ market, groupTicks, bids: orderBook.bids, asks: orderBook.asks, openOrders, lastPrice: live }),
    [market, groupTicks, orderBook.bids, orderBook.asks, openOrders, live],
  );
  const anchor = anchorOf(model);

  const win = useLadderWindow({
    anchor,
    resetKey: market.id,
    groupTicks,
    minRung: model.minRung,
    maxRung: model.maxRung,
  });
  const { dir } = useTickDirection(live);

  const awaitingBook = orderBook.bids.length === 0 && orderBook.asks.length === 0;
  const view =
    !awaitingBook && win.centre !== null && win.rowCount > 0 ? ladderWindow(model, win.centre, win.rowCount) : null;

  const decimals = model.grid.decimals;
  const spread = model.spread;
  const spreadText = spread && spread.state === 'open' ? formatSmall(spread.groups) : null;
  const gridLabel =
    `Price ladder, grouped by ${groupLabel}` +
    (spreadText !== null ? `, spread ${spreadText}` : spread ? `, book ${spread.state}` : '');

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      win.recentre();
    }
  };

  const flashed = (keys: string[]) => keys.some(k => levelChanges.has(k));
  const spreadIndex = view ? view.rows.findIndex((r: LadderRow) => r.spreadBelow) : -1;

  return (
    <div
      ref={win.regionRef}
      data-ladder-region
      data-pinned={win.pinned ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      className="mx-auto flex h-full min-h-0 w-full max-w-[640px] flex-col px-4"
    >
      {/* Above: Re-centre (while held) and the jump marker. */}
      <div className="flex h-[34px] flex-none items-end justify-between gap-2">
        {win.held ? (
          <button
            type="button"
            onClick={win.recentre}
            aria-keyshortcuts="C"
            className="flex h-7 items-center gap-1.5 rounded-md border border-ctl px-2.5 text-[12px] text-text hover:bg-chip"
          >
            Re-centre
            <kbd className="rounded border border-hairline-strong px-1 font-sans text-[10px] leading-[14px] text-muted">C</kbd>
          </button>
        ) : (
          <span />
        )}
        {view && (
          <JumpMarker
            direction="above"
            outside={view.above}
            priceDecimals={decimals}
            sizeDecimals={ui.sizeDecimals}
            onJump={win.pinTo}
          />
        )}
      </div>

      <div role="grid" aria-label={gridLabel} aria-readonly="true" tabIndex={0} className="flex min-h-0 flex-1 flex-col rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <div role="row" className={`grid h-7 flex-none ${LADDER_COLUMNS} items-center text-[11px] text-muted`}>
          <span role="columnheader">Mine</span>
          <span role="columnheader" className="pr-3 text-right">Bids</span>
          <span role="columnheader" className="flex justify-center">
            <select
              aria-label="Price grouping"
              value={groupTicks}
              onChange={e => setGroupSel({ marketId: market.id, mult: Number(e.target.value) })}
              className="h-6 rounded-[5px] border border-ctl bg-surface-2 px-1 text-[11px] text-text"
            >
              {options.map(o => (
                <option key={o.multiplier} value={o.multiplier}>
                  Price · {o.label}
                </option>
              ))}
            </select>
          </span>
          <span role="columnheader" className="pl-3">Asks</span>
          <span role="columnheader" className="text-right">Mine</span>
        </div>

        <div ref={win.measureRef} data-ladder-rungs className="relative min-h-0 flex-1 overflow-hidden">
          <div role="rowgroup">
            {awaitingBook
              ? Array.from({ length: win.rowCount }, (_, i) => <SkeletonRung key={i} index={i} />)
              : view?.rows.map(row => (
                  <Rung
                    key={row.price}
                    row={row}
                    priceText={formatFixed(row.price, decimals)}
                    tone={toneOf(model, row.rung)}
                    lastDir={dir}
                    flashBid={flashed(row.bid.priceKeys)}
                    flashAsk={flashed(row.ask.priceKeys)}
                    sizeDecimals={ui.sizeDecimals}
                    baseAsset={market.baseAsset}
                  />
                ))}
          </div>
          {/* Spread line: drawn ON the boundary between the two rungs that
              straddle the spread, taking no height, so rungs never shift when
              the touch moves (DESIGN.md rule 8). The label sits in the
              price column's gap between the two prices. */}
          {spreadIndex >= 0 && (
            <div
              aria-hidden
              data-spread-line
              className={`pointer-events-none absolute inset-x-0 grid h-[10px] ${LADDER_COLUMNS} items-center`}
              style={{ top: (spreadIndex + 1) * RUNG_PX - 5 }}
            >
              <span />
              <span className="h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--buy))' }} />
              <span className="justify-self-center rounded-sm bg-surface px-1 text-[9px] font-medium uppercase leading-[10px] tracking-[0.06em] text-muted">
                Spread {spreadText}
              </span>
              <span className="h-px" style={{ background: 'linear-gradient(90deg, var(--sell), transparent)' }} />
              <span />
            </div>
          )}
        </div>
      </div>

      {/* Below: the jump marker. */}
      <div className="flex h-[34px] flex-none items-start">
        {view && (
          <JumpMarker
            direction="below"
            outside={view.below}
            priceDecimals={decimals}
            sizeDecimals={ui.sizeDecimals}
            onJump={win.pinTo}
          />
        )}
      </div>
    </div>
  );
}
