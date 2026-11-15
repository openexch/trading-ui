// SPDX-License-Identifier: Apache-2.0
/**
 * The depth ladder: the engine's book levels as fixed 22px rungs (only
 * prices the book has a level at; never a gap or filler row), with the
 * spread marker in the middle (it carries the last trade price, with its
 * tick arrow, and the spread), the ask levels above it and the bid levels
 * below, own orders and cumulative depth. A click on a
 * bid cell stages a buy at that rung's price, on an ask cell a sell
 * (`onStage`); the staging strip above places it.
 *
 * Layout, top to bottom, filling the centre column up to a 1200px frame
 * (960px in wide mode; LADDER_FRAME, shared with the defaults bar and the
 * strip):
 *   jump-above slot (fixed height, Re-centre on the left)
 *   column header with the grouping select
 *   rung area (measured: its height, less the spread row, sets the even
 *   slot count; where the book runs out of levels the slots stay empty, so
 *   the marker stays in the middle)
 *   jump-below slot (fixed height)
 * The marker slots are always reserved, so a marker appearing never resizes
 * the rung area or moves a rung. The spread row is a row of its own between
 * the best ask and the best bid rungs; its height is set aside before rungs
 * are counted, so it never overlaps a rung and the area never overflows.
 *
 * Re-centre shows whenever the window is not the centred one (a pin held it
 * while the book moved, or the user scrolled away).
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
import { buildLadder, ladderWindow } from './ladderModel';
import type { LadderModel, LadderSide } from './ladderModel';
import { PHONE_RUNG_PX, PHONE_SPREAD_ROW_PX, RUNG_PX, SPREAD_ROW_PX, useLadderWindow } from './useLadderWindow';
import { LADDER_FRAME } from '../layoutColumns';
import { LADDER_COLUMNS, PHONE_LADDER_COLUMNS, Rung, SkeletonRung } from './Rung';
import type { PriceTone, RungDensity } from './Rung';
import { JumpMarker } from './JumpMarker';
import type { OwnOrderActions } from './OwnOrderChip';
import type { Anchor } from '../../ui';
import { formatFixed, formatSmall, sharedPrefixLength } from './format';
import { useLadderKeys } from './useLadderKeys';
import type { LadderHandle, LadderReveal, PassedCommand } from './useLadderKeys';

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
  /** Pin the window (one-click armed, an order staged, or a menu or popover
   *  open); its end re-centres the window. */
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
  /** An own order to bring into view and focus (Show on ladder). */
  reveal?: LadderReveal | null;
}

function toneOf(model: LadderModel, rung: number): PriceTone {
  if (model.bestAskRung !== null && rung >= model.bestAskRung) return 'sell';
  if (model.bestBidRung !== null && rung <= model.bestBidRung) return 'buy';
  return 'muted';
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
  reveal = null,
}: LadderProps) {
  const ui = marketUi(market);
  const phone = density === 'phone';
  const rungPx = phone ? PHONE_RUNG_PX : RUNG_PX;
  const spreadPx = phone ? PHONE_SPREAD_ROW_PX : SPREAD_ROW_PX;
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

  const awaitingBook = orderBook.bids.length === 0 && orderBook.asks.length === 0;
  const win = useLadderWindow({
    model,
    hold,
    resetKey: market.id,
    groupTicks,
    rungPx,
    reservePx: spreadPx,
    touchDrag: phone,
  });
  const { dir } = useTickDirection(live);

  const view =
    !awaitingBook && win.rowCount > 0 ? ladderWindow(model, win.pos, win.rowCount) : null;

  const decimals = model.grid.decimals;
  // The big figure: the leading characters every visible rung's price
  // shares, once per window from the strings the column prints.
  const priceTexts = view ? view.rows.map(r => formatFixed(r.price, decimals)) : [];
  const bigFigure = sharedPrefixLength(priceTexts);
  const spread = model.spread;
  const spreadText = spread && spread.state === 'open' ? formatSmall(spread.groups) : null;
  const spreadLabel =
    spreadText !== null
      ? `Spread ${spreadText}`
      : spread
        ? spread.state === 'locked'
          ? 'Locked'
          : 'Crossed'
        : model.bestBidRung === null
          ? 'No bids'
          : 'No asks';
  // The last trade is an engine price even with no level at it: it lives in
  // the centred spread row, never on a level row.
  const lastText = live !== null ? formatFixed(live, decimals) : null;
  const lastWords = lastText !== null ? `last ${lastText}${dir ? (dir === 'up' ? ', up' : ', down') : ''}` : null;
  const gridLabel =
    `Price ladder, grouped by ${groupLabel}` +
    (lastWords !== null ? `, ${lastWords}` : '') +
    (spreadText !== null ? `, spread ${spreadText}` : spread ? `, book ${spread.state}` : '');

  const keys = useLadderKeys({
    market,
    model,
    view,
    pinTo: win.pinTo,
    scrollBy: win.scrollBy,
    recentre: win.recentre,
    ownActions,
    onStage,
    onCommand,
    onAnnounce,
    handleRef,
    reveal,
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

  // The spread row: a row of its own between the best ask and the best bid
  // rows (its height is set aside in the row count), the rule fading from
  // buy to sell, with the last trade price (and its tick arrow) and the
  // spread in the middle. In a centred window it is the middle of the
  // ladder, so the last price stays fixed there. Aria-hidden: the grid label
  // carries the same words.
  const spreadRow = (
    <div
      key="spread"
      aria-hidden
      data-spread-row
      className={`pointer-events-none grid flex-none ${columns} items-center`}
      style={{ height: spreadPx }}
    >
      {!phone && <span />}
      <span className="col-span-3 flex min-w-0 items-center gap-2">
        <span className="h-px min-w-3 flex-1" style={{ background: 'linear-gradient(90deg, transparent, var(--buy))' }} />
        {lastText !== null && (
          <span
            data-last-trade
            className={`inline-flex flex-none items-center gap-1 rounded-[5px] bg-mid px-2 py-px font-semibold text-text-strong outline outline-1 outline-accent ${
              phone ? 'text-[14px] leading-[20px]' : 'text-[13px] leading-[18px]'
            }`}
          >
            {lastText}
            {/* Fixed-width slot: the arrow never appears or disappears and
                shifts the price (DESIGN.md rule 3). */}
            <span
              data-last-dir
              className={`w-[10px] text-center text-[10px] leading-none ${
                dir ? (dir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'
              }`}
            >
              {dir === 'down' ? '▼' : '▲'}
            </span>
          </span>
        )}
        <span
          data-spread-label
          className={`flex-none whitespace-nowrap font-medium uppercase tracking-[0.06em] text-muted ${
            phone ? 'text-[11px] leading-[20px]' : 'text-[10px] leading-[12px]'
          }`}
        >
          {spreadLabel}
        </span>
        <span className="h-px min-w-3 flex-1" style={{ background: 'linear-gradient(90deg, var(--sell), transparent)' }} />
      </span>
      {!phone && <span />}
    </div>
  );

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
          : view && [
              view.padTop > 0 && <div key="pad-top" aria-hidden data-ladder-pad style={{ height: view.padTop * rungPx }} />,
              ...view.rows.flatMap((row, i) => [
              ...(view.spreadAt === i ? [spreadRow] : []),
              <Rung
                key={row.price}
                row={row}
                priceText={priceTexts[i]}
                bigFigure={bigFigure}
                tone={toneOf(model, row.rung)}
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
              />,
              ]),
              view.spreadAt === view.rows.length && spreadRow,
              view.padBottom > 0 && (
                <div key="pad-bottom" aria-hidden data-ladder-pad style={{ height: view.padBottom * rungPx }} />
              ),
            ]}
      </div>
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
        {view && !view.centred && (
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
      className={`flex h-full min-h-0 w-full flex-col ${LADDER_FRAME}`}
    >
      {/* Above: Re-centre (while not centred) and the jump marker. */}
      <div className="flex h-[34px] flex-none items-end justify-between gap-2">
        {view && !view.centred ? (
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
