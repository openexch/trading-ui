// SPDX-License-Identifier: Apache-2.0
/**
 * One ladder rung: Mine | Bids | Price | Asks | Mine (52 / 1fr / 112 / 1fr / 52).
 *
 * - Depth is cumulative: the bar is the volume from the side's best price
 *   out to this rung, inset 3px top and bottom and growing out from the
 *   price column. The scale is the largest cumulative the window shows, the
 *   same for both sides (ladderWindow). The cell prints the level quantity
 *   next to the price (--text-strong) and the cumulative on the outer side,
 *   smaller and in --text (--muted is not AA on a bar; on a cell with an own
 *   slice, --text-strong, since --text is not AA on the slice). A known rung with no
 *   level (a gap) carries the bar and the cumulative but no quantity.
 * - An own order shows three ways: a faint side-coloured row tint, its share
 *   of the level drawn as a slice anchored at the price edge, width own /
 *   the bar scale (a fill at --own-slice-alpha plus a 1px side-coloured
 *   outline; the numbers stay readable on top), and a Mine chip with filled
 *   / original (OwnOrderChip: a menu with Cancel and, for limit orders,
 *   Move).
 * - Cells beyond the known depth are dimmed and hatched, with no quantity,
 *   no cumulative and no bar, never shown as empty liquidity (DESIGN.md rule
 *   9). The deepest known rung, when part of its group lies beyond the known
 *   depth, prints its quantity and cumulative as lower bounds.
 * - Every in-range rung offers both actions: the bid cell stages a buy at the
 *   rung's price and the ask cell a sell, on either side of the spread (a
 *   buy above the best ask crosses, and the strip warns). The cells are
 *   buttons out of the tab order: the grid is one tab stop (DESIGN.md rule
 *   11), so a click stages and Enter places from the staging strip.
 *   Right-click or the Menu key opens the rung menu with the other order
 *   types at that price.
 * - Phone density (`density="phone"`): 44px rungs, Bids | Price | Asks
 *   (1fr / 96 / 1fr) with 40px tap cells. There is no room for Mine chips,
 *   so an own order is a side-coloured dot in its cell next to the tint and
 *   the depth slice; own orders are managed from the Orders tab. A tap
 *   stages, a long-press opens the rung menu, and nothing previews on hover
 *   (a touch leaves hover stuck).
 * - The price cell is the rung's keyboard focus target. Exactly one rung's
 *   price cell holds tabindex 0 (`focusable`); its label reads the rung as
 *   a whole: price, depth each side and your orders on it.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import type { LadderRow, LadderSide, SideCell } from './ladderModel';
import type { TickDirection } from '../../ui/useTickDirection';
import type { Anchor } from '../../ui';
import { formatCompactSize, formatFixed } from './format';
import { OwnOrderChip } from './OwnOrderChip';
import type { OwnOrderActions } from './OwnOrderChip';

export const LADDER_COLUMNS = 'grid-cols-[52px_minmax(0,1fr)_112px_minmax(0,1fr)_52px]';

/** Phone columns: Bids | Price | Asks. */
export const PHONE_LADDER_COLUMNS = 'grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)]';

export type RungDensity = 'desktop' | 'phone';

/** How long a finger rests on a cell before the rung menu opens. */
export const LONG_PRESS_MS = 500;
/** Movement that turns a press into a drag (no menu). */
const PRESS_SLOP_PX = 8;

export type PriceTone = 'buy' | 'sell' | 'muted';

export interface RungProps {
  row: LadderRow;
  priceText: string;
  tone: PriceTone;
  /** Direction of the last trade move, shown on the last-trade rung only. */
  lastDir: TickDirection | null;
  flashBid: boolean;
  flashAsk: boolean;
  sizeDecimals: number;
  baseAsset: string;
  /** The order size text for the cell labels ("0.25"), or null when the
   *  size field holds no valid size. */
  sizeText: string | null;
  /** Which cell of this rung holds the staged order, if any. */
  stagedSide: LadderSide | null;
  onStage?: (side: LadderSide, price: number) => void;
  /** Open the rung menu (right-click, the Menu key or Shift+F10 on a cell). */
  onMenu?: (price: number, anchor: Anchor) => void;
  /** Cancel / Move on the Mine chips; without it the chips are labels. */
  ownActions?: OwnOrderActions;
  /** This rung's price cell is the grid's tab stop (roving tabindex). */
  focusable?: boolean;
  density?: RungDensity;
}

const HATCH: CSSProperties = {
  background: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--hairline-strong) 4px 5px)',
};

function pct(f: number): string {
  return `${Math.max(0, Math.min(1, f)) * 100}%`;
}

/** Right-click opens at the pointer; the Menu key (which also fires
 *  contextmenu, at 0,0 or the element) opens at the cell. */
function menuHandlers(price: number, onMenu?: (price: number, anchor: Anchor) => void) {
  if (!onMenu) return {};
  return {
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      const pointer = e.clientX !== 0 || e.clientY !== 0;
      onMenu(price, pointer ? { x: e.clientX, y: e.clientY } : { current: el });
    },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        onMenu(price, { current: e.currentTarget });
      }
    },
  };
}

/**
 * Long-press on a touch cell opens the rung menu at the finger. The click
 * that follows the press is swallowed so the press does not also stage. A
 * press that moves (a drag of the ladder) or ends early is a plain tap.
 * Android also fires contextmenu on a long-press: it is swallowed so the
 * menu opens once.
 */
function useLongPress(price: number, onMenu?: (price: number, anchor: Anchor) => void) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const fired = useRef(false);
  const stop = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  // A press in progress never outlives the cell.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );
  if (!onMenu) return { handlers: {}, consumeClick: () => false };
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      stop();
      const x = e.clientX;
      const y = e.clientY;
      press.current = {
        x,
        y,
        timer: window.setTimeout(() => {
          press.current = null;
          fired.current = true;
          onMenu(price, { x, y });
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP_PX) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      // The long-press already opened the menu (or is about to): no second one.
      e.preventDefault();
      if (fired.current || press.current) return;
      onMenu(price, e.clientX !== 0 || e.clientY !== 0 ? { x: e.clientX, y: e.clientY } : { current: e.currentTarget });
    },
  };
  /** True once, for the click that ends a long-press. */
  const consumeClick = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };
  return { handlers, consumeClick };
}

function depthWords(cell: SideCell, sizeDecimals: number): string {
  if (cell.state === 'level' && cell.quantity !== null) {
    const q = formatFixed(cell.quantity, sizeDecimals);
    return cell.partial ? `at least ${q}` : q;
  }
  return cell.state === 'unknown' ? 'unknown' : 'none';
}

/** The focused rung read as one line: "97,400, last trade, bids 1.0000,
 *  asks none, your buy 0.50". */
function rungLabel(row: LadderRow, priceText: string, sizeDecimals: number): string {
  const parts = [priceText];
  if (row.isLastTrade) parts.push('last trade');
  parts.push(`bids ${depthWords(row.bid, sizeDecimals)}`, `asks ${depthWords(row.ask, sizeDecimals)}`);
  const own = (word: string, o: SideCell['own']) => {
    if (!o) return;
    const n = o.orders.length;
    parts.push(`your ${word}${n > 1 ? ` (${n} orders)` : ''} ${formatCompactSize(o.quantity, sizeDecimals)}`);
  };
  own('buy', row.bid.own);
  own('sell', row.ask.own);
  return parts.join(', ');
}

function DepthCell({ side, cell, flash, price, priceText, sizeDecimals, baseAsset, sizeText, staged, onStage, onMenu, density }: {
  side: LadderSide;
  cell: SideCell;
  flash: boolean;
  price: number;
  priceText: string;
  sizeDecimals: number;
  baseAsset: string;
  sizeText: string | null;
  staged: boolean;
  onStage?: (side: LadderSide, price: number) => void;
  onMenu?: (price: number, anchor: Anchor) => void;
  density: RungDensity;
}) {
  const phone = density === 'phone';
  const longPress = useLongPress(price, phone ? onMenu : undefined);
  const isBid = side === 'BID';
  const edge: CSSProperties = isBid ? { right: 0 } : { left: 0 };
  const sideCls = isBid ? 'pl-2 pr-3' : 'pl-3 pr-2';
  const flashCls = flash ? (isBid ? 'animate-flash-buy' : 'animate-flash-sell') : '';
  const verb = isBid ? 'Buy' : 'Sell';

  let text = '';
  let cumText = '';
  let depth = '';
  const atLeast = cell.partial ? 'at least ' : '';
  if (cell.state === 'level' && cell.quantity !== null) {
    const q = formatFixed(cell.quantity, sizeDecimals);
    text = cell.partial ? `≥${q}` : q;
    depth = `, ${atLeast}${q} on book`;
  } else if (cell.state === 'unknown') {
    depth = ', depth unknown';
  }
  if (cell.cumulative !== null && cell.cumulative > 0) {
    const c = formatCompactSize(cell.cumulative, sizeDecimals);
    cumText = cell.partial ? `≥${c}` : c;
    depth += `, ${atLeast}${c} cumulative`;
  }
  const what = sizeText !== null ? `${verb} ${sizeText} ${baseAsset}` : `${verb} ${baseAsset}`;
  const own = cell.own;
  const ownWords = own ? `, you have a ${isBid ? 'buy' : 'sell'} order here` : '';
  const label = `${what} at ${priceText}${depth}${phone ? ownWords : ''}`;
  const sliceW = own && own.slice > 0 ? pct(own.sliceFraction) : null;
  // Literal class names: Tailwind only generates what it can read.
  const ring = isBid ? 'outline-buy' : 'outline-sell';
  // 3px clear of the rung's top and bottom: the desktop cell is the full
  // 22px rung, the phone cell 40px inside a 44px rung.
  const barInset = phone ? 'top-px bottom-px rounded' : 'bottom-[3px] top-[3px] rounded-[3px]';
  const hasBar = cell.cumulative !== null && cell.bar > 0;
  // Level quantity next to the price, cumulative on the outer side.
  const qtyEl = (cls: string) => (
    <span aria-hidden data-qty className={`relative min-w-0 truncate ${cls}`}>
      {text}
    </span>
  );
  // --text is AA on the bar but not on an own slice, which a wide own order
  // can stretch under the cumulative: that cell prints it in --text-strong.
  const cumTone = sliceW ? 'text-text-strong' : 'text-text';
  const cumEl = (cls: string) => (
    <span aria-hidden data-cum className={`relative min-w-0 truncate ${cumTone} ${cls}`}>
      {cumText}
    </span>
  );
  const pair = (qtyCls: string, cumCls: string) =>
    isBid ? (
      <>
        {cumEl(cumCls)}
        {qtyEl(qtyCls)}
      </>
    ) : (
      <>
        {qtyEl(qtyCls)}
        {cumEl(cumCls)}
      </>
    );
  const hoverRing = isBid ? 'hover:outline-buy' : 'hover:outline-sell';

  return (
    <button
      type="button"
      role="gridcell"
      tabIndex={-1}
      aria-label={label}
      data-staged={staged ? 'true' : undefined}
      title={cell.partial ? 'Part of this group lies beyond the known depth' : undefined}
      onClick={() => {
        if (longPress.consumeClick()) return;
        onStage?.(side, price);
      }}
      {...(phone ? longPress.handlers : menuHandlers(price, onMenu))}
      className={
        phone
          ? `relative flex h-10 cursor-pointer select-none items-center justify-between gap-1.5 overflow-hidden rounded-md border-0 p-0 font-[inherit] text-[14px] leading-10 text-text-strong outline-offset-[-2px] [-webkit-touch-callout:none] ${
              staged ? `bg-chip outline outline-2 ${ring}` : 'bg-transparent'
            } ${isBid ? 'pl-4 pr-2.5' : 'pl-2.5 pr-4'} ${flashCls}`
          : `group relative flex h-full cursor-pointer items-center justify-between gap-2 overflow-hidden rounded border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-[22px] text-text-strong outline-offset-[-1px] hover:bg-chip hover:outline hover:outline-1 ${
              staged ? `outline outline-1 ${ring}` : ''
            } ${hoverRing} ${sideCls} ${flashCls}`
      }
    >
      {hasBar && (
        <span
          aria-hidden
          data-depth-bar
          className={`absolute ${barInset} ${isBid ? 'bg-buy-soft' : 'bg-sell-soft'}`}
          style={{ ...edge, width: pct(cell.bar) }}
        />
      )}
      {sliceW && (
        <>
          <span
            aria-hidden
            data-own-slice
            className={`absolute ${barInset} ${isBid ? 'bg-buy' : 'bg-sell'}`}
            style={{ ...edge, width: sliceW, opacity: 'var(--own-slice-alpha)' }}
          />
          <span
            aria-hidden
            className={`absolute ${barInset}`}
            style={{ ...edge, width: sliceW, boxShadow: `inset 0 0 0 1px var(${isBid ? '--buy' : '--sell'})` }}
          />
        </>
      )}
      {cell.state === 'unknown' && (
        <span
          aria-hidden
          data-unknown
          className={`absolute inset-x-0 opacity-60 ${phone ? 'inset-y-px rounded' : 'inset-y-[3px] rounded-[3px]'}`}
          style={HATCH}
        />
      )}
      {phone ? (
        <>
          {own && (
            <span
              aria-hidden
              data-own-dot
              className={`absolute top-1/2 -mt-1 h-2 w-2 rounded-full ${isBid ? 'left-1.5 bg-buy' : 'right-1.5 bg-sell'}`}
            />
          )}
          {pair('', 'text-[12px]')}
        </>
      ) : (
        <>
          {/* On hover the cell previews what a click stages ("Buy 0.25") at
              the price edge, in --text-strong: it sits on the depth bar,
              where the side colours are not AA; the side-coloured outline
              carries the side. */}
          {pair('group-hover:hidden', 'text-[11px] group-hover:hidden')}
          <span
            aria-hidden
            data-stage-preview
            className={`relative hidden font-semibold text-text-strong group-hover:inline ${isBid ? 'ml-auto' : 'mr-auto'}`}
          >
            {sizeText !== null ? `${verb} ${sizeText}` : verb}
          </span>
        </>
      )}
    </button>
  );
}

export function Rung({
  row,
  priceText,
  tone,
  lastDir,
  flashBid,
  flashAsk,
  sizeDecimals,
  baseAsset,
  sizeText,
  stagedSide,
  onStage,
  onMenu,
  ownActions,
  focusable = false,
  density = 'desktop',
}: RungProps) {
  const phone = density === 'phone';
  const cols = phone ? PHONE_LADDER_COLUMNS : LADDER_COLUMNS;
  const rowH = phone ? 'h-[44px]' : 'h-[22px]';
  const ownBid = row.bid.own;
  const ownAsk = row.ask.own;
  const tint =
    ownBid && ownAsk
      ? 'linear-gradient(90deg, var(--buy-faint) 50%, var(--sell-faint) 50%)'
      : ownBid
        ? 'var(--buy-faint)'
        : ownAsk
          ? 'var(--sell-faint)'
          : undefined;

  if (!row.inRange) {
    return <div role="row" aria-hidden data-rung-price="" className={`grid ${rowH} ${cols}`} />;
  }

  const toneCls = tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : 'text-muted';

  return (
    <div
      role="row"
      data-rung-price={row.price}
      className={`grid ${rowH} ${cols} items-center ${phone ? 'rounded-md' : 'rounded'} has-[[data-focus-cell]:focus-visible]:ring-1 has-[[data-focus-cell]:focus-visible]:ring-inset has-[[data-focus-cell]:focus-visible]:ring-accent/50`}
      style={tint ? { background: tint } : undefined}
    >
      {!phone && (
      <span role="gridcell" className="flex items-center">
        {ownBid && (
          <OwnOrderChip side="BID" own={ownBid} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} actions={ownActions} />
        )}
      </span>
      )}
      <DepthCell
        side="BID"
        cell={row.bid}
        flash={flashBid}
        price={row.price}
        priceText={priceText}
        sizeDecimals={sizeDecimals}
        baseAsset={baseAsset}
        sizeText={sizeText}
        staged={stagedSide === 'BID'}
        onStage={onStage}
        onMenu={onMenu}
        density={density}
      />
      <span
        role="gridcell"
        tabIndex={focusable ? 0 : -1}
        data-focus-cell
        aria-label={rungLabel(row, priceText, sizeDecimals)}
        className={`flex h-full items-center justify-center rounded ${phone ? 'text-[14px]' : 'text-[13px]'} outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent`}
      >
        {row.isLastTrade ? (
          <span
            data-last-trade
            aria-label={`${priceText}, last trade${lastDir ? (lastDir === 'up' ? ', up' : ', down') : ''}`}
            className="inline-flex items-center gap-1 rounded-[5px] bg-mid px-2 py-px font-semibold leading-[18px] text-text-strong outline outline-1 outline-accent"
          >
            {priceText}
            {/* Fixed-width slot: the arrow never appears or disappears and
                shifts the price (DESIGN.md rule 3). */}
            <span
              aria-hidden
              className={`w-[10px] text-center text-[10px] leading-none ${
                lastDir ? (lastDir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'
              }`}
            >
              {lastDir === 'down' ? '▼' : '▲'}
            </span>
          </span>
        ) : (
          <span className={`font-medium ${toneCls}`}>{priceText}</span>
        )}
      </span>
      <DepthCell
        side="ASK"
        cell={row.ask}
        flash={flashAsk}
        price={row.price}
        priceText={priceText}
        sizeDecimals={sizeDecimals}
        baseAsset={baseAsset}
        sizeText={sizeText}
        staged={stagedSide === 'ASK'}
        onStage={onStage}
        onMenu={onMenu}
        density={density}
      />
      {!phone && (
      <span role="gridcell" className="flex items-center justify-end">
        {ownAsk && (
          <OwnOrderChip side="ASK" own={ownAsk} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} actions={ownActions} />
        )}
      </span>
      )}
    </div>
  );
}

// Skeleton widths (%) cycled per row: organic, not a flat block.
const SKELETON_WIDTHS = [55, 70, 45, 65, 50, 75, 60, 40];

/** Placeholder rungs while a market's first snapshot is in flight. */
export function SkeletonRung({ index, density = 'desktop' }: { index: number; density?: RungDensity }) {
  const w = (k: number) => `${SKELETON_WIDTHS[(index + k) % SKELETON_WIDTHS.length]}%`;
  const phone = density === 'phone';
  return (
    <div
      aria-hidden
      data-skeleton-rung
      className={`grid ${phone ? `h-[44px] ${PHONE_LADDER_COLUMNS}` : `h-[22px] ${LADDER_COLUMNS}`} items-center animate-pulse`}
    >
      {!phone && <span />}
      <span className="flex justify-end pr-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(0) }} />
      </span>
      <span className="flex justify-center">
        <span className="h-3 w-14 rounded-sm bg-surface-2" />
      </span>
      <span className="flex justify-start pl-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(3) }} />
      </span>
      {!phone && <span />}
    </div>
  );
}
