// SPDX-License-Identifier: Apache-2.0
/**
 * The depth ladder: the book as fixed 22px rungs around the last trade, with
 * own orders, the spread line and the last-trade rung. A click on a bid cell
 * stages a buy at that rung's price, on an ask cell a sell (`onStage`); the
 * staging strip above places it.
 *
 * Layout, top to bottom, inside a column 640px wide up to about 1600px of
 * viewport, growing to 760px on wide screens (LADDER_MAX_WIDTH):
 *   jump-above slot (fixed height, Re-centre on the left)
 *   column header with the grouping select
 *   rung area (measured: its height sets the odd row count)
 *   jump-below slot (fixed height)
 * The marker slots are always reserved, so a marker appearing never resizes
 * the rung area or moves a rung.
 *
 * Phone (`density="phone"`): 44px rungs in Bids | Price | Asks, a vertical
 * finger drag moves the window (useLadderWindow `touchDrag`), and the
 * marker slots give way to floating buttons over the rungs (Re-centre at the
 * top right, the jump markers at the left), so the rung area keeps its
 * height whatever appears. The grouping select lives in the caller's
 * settings row (`grouping`).
 *
 * Keyboard (useLadderKeys, DESIGN.md rule 11): the rung area is the grid and
 * one tab stop; the column header with the grouping select sits outside it,
 * so the select is its own stop and never sees a ladder key.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Ref } from 'react';
import type { Market, OrderBook, UserOrder } from '../../types/market';
import type { LevelChange } from '../../hooks/useOrderBook';
import { marketUi, groupingOptions } from '../../trading/marketUi';
import { useTickDirection } from '../../ui/useTickDirection';
import { buildLadder, defaultCentre, ladderWindow } from './ladderModel';
import type { LadderModel, LadderRow, LadderSide } from './ladderModel';
import { PHONE_RUNG_PX, RUNG_PX, useLadderWindow } from './useLadderWindow';
import { LADDER_MAX_WIDTH } from '../layoutColumns';
import { LADDER_COLUMNS, PHONE_LADDER_COLUMNS, Rung, SkeletonRung } from './Rung';
import type { PriceTone, RungDensity } from './Rung';
import { JumpMarker } from './JumpMarker';
import type { OwnOrderActions } from './OwnOrderChip';
import type { Anchor } from '../../ui';
import { formatFixed, formatSmall } from './format';
import { useLadderKeys } from './useLadderKeys';
import type { LadderHandle, PassedCommand } from './useLadderKeys';

export interface LadderProps {
  market: Market;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  /** The user-scoped open orders (all markets); the model keeps this market's. */
  openOrders: UserOrder[];
  /** Last trade price; null while a market switch is in flight. */
  lastPrice: number | null;
  /** The order size as label text ("0.25"), or null when none is set. */
  sizeText?: string | null;
  /** Stage an order at a rung: side of the clicked cell, the rung's price.
   *  From the keyboard (B / S) `anchor` is the focused cell. */
  onStage?: (side: LadderSide, price: number, anchor?: HTMLElement) => void;
  /** The staged order's cell, drawn outlined. */
  staged?: { side: LadderSide; price: number } | null;
  /** Pin the window (an order is staged, or a menu or popover is open). */
  hold?: boolean;
  /** Open the rung menu at a rung (right-click or the Menu key). */
  onRungMenu?: (price: number, anchor: Anchor) => void;
  /** Cancel / Move on the Mine chips, and Del / Alt+arrows on the keyboard. */
  ownActions?: OwnOrderActions;
  /** Ladder keys the caller handles (market stage, sizes, type, TIF,
   *  one-click, Cancel all). */
  onCommand?: (cmd: PassedCommand) => void;
  /** Say something through the staging strip (the one live region). */
  onAnnounce?: (text: string) => void;
  /** Lets the page focus the ladder (the L key). */
  handleRef?: Ref<LadderHandle>;
  /** 22px desktop rungs, or 44px phone rungs with touch gestures. */
  density?: RungDensity;
  /** Grouping held by the caller (the phone settings row); without it the
   *  ladder keeps its own and shows the select in its column header. */
  grouping?: { value: number; onChange: (multiplier: number) => void };
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

/** The middle of the touch, once the book has both sides. */
function settleRung(model: LadderModel): number | null {
  if (model.bestBidRung === null || model.bestAskRung === null) return null;
  return Math.floor((model.bestBidRung + model.bestAskRung) / 2);
}

export function Ladder({
  market,
  orderBook,
  levelChanges,
  openOrders,
  lastPrice,
  sizeText = null,
  onStage,
  staged = null,
  hold = false,
  onRungMenu,
  ownActions,
  onCommand,
  onAnnounce,
  handleRef,
  density = 'desktop',
  grouping,
}: LadderProps) {
  const ui = marketUi(market);
  const phone = density === 'phone';
  const rungPx = phone ? PHONE_RUNG_PX : RUNG_PX;
  const columns = phone ? PHONE_LADDER_COLUMNS : LADDER_COLUMNS;
  // Grouping belongs to the market it was chosen on; a switch starts from the
  // next market's default.
  const [groupSel, setGroupSel] = useState<{ marketId: number; mult: number } | null>(null);
  const ownGroup = groupSel && groupSel.marketId === market.id ? groupSel.mult : ui.defaultGrouping;
  const groupTicks = grouping ? grouping.value : ownGroup;
  const options = useMemo(() => groupingOptions(market), [market]);
  const groupLabel = options.find(o => o.multiplier === groupTicks)?.label ?? String(groupTicks);

  const live = lastPrice !== null && lastPrice > 0 ? lastPrice : null;
  const model = useMemo(
    () => buildLadder({ market, groupTicks, bids: orderBook.bids, asks: orderBook.asks, openOrders, lastPrice: live }),
    [market, groupTicks, orderBook.bids, orderBook.asks, openOrders, live],
  );
  const anchor = anchorOf(model);

  const awaitingBook = orderBook.bids.length === 0 && orderBook.asks.length === 0;
  const win = useLadderWindow({
    anchor,
    settleAt: settleRung(model),
    empty: awaitingBook,
    hold,
    resetKey: market.id,
    groupTicks,
    minRung: model.minRung,
    maxRung: model.maxRung,
    rungPx,
    touchDrag: phone,
  });
  const { dir } = useTickDirection(live);

  const view =
    !awaitingBook && win.centre !== null && win.rowCount > 0 ? ladderWindow(model, win.centre, win.rowCount) : null;

  const decimals = model.grid.decimals;
  const spread = model.spread;
  const spreadText = spread && spread.state === 'open' ? formatSmall(spread.groups) : null;
  const gridLabel =
    `Price ladder, grouped by ${groupLabel}` +
    (spreadText !== null ? `, spread ${spreadText}` : spread ? `, book ${spread.state}` : '');

  const keys = useLadderKeys({
    market,
    model,
    view,
    centre: win.centre,
    pinTo: win.pinTo,
    recentre: win.recentre,
    ownActions,
    onStage,
    onCommand,
    onAnnounce,
    handleRef,
  });
  const { measureRef } = win;
  const { gridRef: keysGridRef } = keys;
  // One element is both measured (row count) and the grid (focus, keys).
  const gridRef = useCallback(
    (el: HTMLElement | null) => {
      measureRef(el);
      keysGridRef(el);
    },
    [measureRef, keysGridRef],
  );

  const flashed = (priceKeys: string[]) => priceKeys.some(k => levelChanges.has(k));
  const spreadIndex = view ? view.rows.findIndex((r: LadderRow) => r.spreadBelow) : -1;

  const rungGrid = (
    <div
      ref={gridRef}
      role="grid"
      aria-label={gridLabel}
      aria-keyshortcuts="L"
      tabIndex={keys.gridTabIndex}
      onKeyDown={keys.onKeyDown}
      onFocus={keys.onFocus}
      onBlur={keys.onBlur}
      data-ladder-rungs
      className={`relative min-h-0 flex-1 overflow-hidden rounded outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${
        phone ? 'touch-none' : ''
      }`}
    >
      <div role="row" className="sr-only">
        {!phone && <span role="columnheader">Mine</span>}
        <span role="columnheader">Bids</span>
        <span role="columnheader">Price</span>
        <span role="columnheader">Asks</span>
        {!phone && <span role="columnheader">Mine</span>}
      </div>
      <div role="rowgroup">
        {awaitingBook
          ? Array.from({ length: win.rowCount }, (_, i) => <SkeletonRung key={i} index={i} density={density} />)
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
                sizeText={sizeText}
                stagedSide={staged && Math.abs(staged.price - row.price) < market.tickSize / 2 ? staged.side : null}
                onStage={onStage}
                onMenu={onRungMenu}
                ownActions={ownActions}
                focusable={row.rung === keys.tabStopRung}
                density={density}
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
          className={`pointer-events-none absolute inset-x-0 grid h-[10px] ${columns} items-center`}
          style={{ top: (spreadIndex + 1) * rungPx - 5 }}
        >
          {!phone && <span />}
          <span className="h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--buy))' }} />
          <span className="justify-self-center rounded-sm bg-surface px-1 text-[9px] font-medium uppercase leading-[10px] tracking-[0.06em] text-muted">
            Spread {spreadText}
          </span>
          <span className="h-px" style={{ background: 'linear-gradient(90deg, var(--sell), transparent)' }} />
          {!phone && <span />}
        </div>
      )}
    </div>
  );

  if (phone) {
    // Floating controls: 36px to the eye, 44px to the finger (the ::before
    // reaches 4px past each edge).
    const floatBtn =
      "absolute z-10 flex h-9 items-center rounded-full border border-ctl bg-surface px-3 text-[12px] text-text-strong shadow-[var(--shadow-pop)] before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']";
    return (
      <div
        ref={win.regionRef}
        data-ladder-region
        data-pinned={win.pinned ? 'true' : 'false'}
        className="relative flex h-full min-h-0 w-full flex-col px-3"
      >
        <div aria-hidden className={`grid h-7 flex-none ${columns} items-center text-[11px] text-muted`}>
          <span className="truncate pr-2.5 text-right">Bids · tap to buy</span>
          <span className="text-center">Price</span>
          <span className="truncate pl-2.5">Asks · tap to sell</span>
        </div>
        {rungGrid}
        {win.held && (
          <button type="button" onClick={win.recentre} className={`${floatBtn} right-4 top-9`}>
            Re-centre
          </button>
        )}
        {view && (
          <div className="absolute left-4 top-9 z-10 max-w-[calc(100%-140px)]">
            <JumpMarker
              direction="above"
              outside={view.above}
              priceDecimals={decimals}
              sizeDecimals={ui.sizeDecimals}
              onJump={win.pinTo}
              compact
            />
          </div>
        )}
        {view && (
          <div className="absolute bottom-2 left-4 z-10 max-w-[calc(100%-32px)]">
            <JumpMarker
              direction="below"
              outside={view.below}
              priceDecimals={decimals}
              sizeDecimals={ui.sizeDecimals}
              onJump={win.pinTo}
              compact
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={win.regionRef}
      data-ladder-region
      data-pinned={win.pinned ? 'true' : 'false'}
      className={`mx-auto flex h-full min-h-0 w-full ${LADDER_MAX_WIDTH} flex-col px-4`}
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

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Column header: visual only, outside the grid (the grid's own
            header row is for assistive technology), so the grouping select
            is a tab stop of its own. */}
        <div className={`grid h-7 flex-none ${LADDER_COLUMNS} items-center text-[11px] text-muted`}>
          <span aria-hidden>Mine</span>
          <span aria-hidden className="pr-3 text-right">Bids</span>
          <span className="flex justify-center">
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
          <span aria-hidden className="pl-3">Asks</span>
          <span aria-hidden className="text-right">Mine</span>
        </div>

        {rungGrid}
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
