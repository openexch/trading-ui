// SPDX-License-Identifier: Apache-2.0
/**
 * One ladder rung: Mine | Bids | Price | Asks | Mine (52 / 1fr / 112 / 1fr / 52).
 *
 * - Depth bars are inset 3px and grow out from the price column. Their scale
 *   is the model's maxQuantity over ALL known levels, so bars do not rescale
 *   when the row count changes.
 * - An own order shows three ways: a faint side-coloured row tint, its share
 *   of the level drawn inside the bar (a fill at --own-slice-alpha plus a 1px
 *   side-coloured outline; the quantity stays in --text-strong so it reads on
 *   top), and a Mine chip with filled / original (OwnOrderChip: a menu with
 *   Cancel and, for limit orders, Move).
 * - Cells beyond the known depth are dimmed and hatched, never shown as empty
 *   liquidity (DESIGN.md rule 9). The deepest known rung, when part of its
 *   group lies beyond the known depth, prints its quantity as a lower bound.
 * - Every in-range rung offers both actions: the bid cell stages a buy at the
 *   rung's price and the ask cell a sell, on either side of the spread (a
 *   buy above the best ask crosses, and the strip warns). The cells are
 *   buttons out of the tab order: the grid is one tab stop (DESIGN.md rule
 *   11), so a click stages and Enter places from the staging strip.
 *   Right-click or the Menu key opens the rung menu with the other order
 *   types at that price.
 * - The price cell is the rung's keyboard focus target. Exactly one rung's
 *   price cell holds tabindex 0 (`focusable`); its label reads the rung as
 *   a whole: price, depth each side and your orders on it.
 */
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import type { LadderRow, LadderSide, SideCell } from './ladderModel';
import type { TickDirection } from '../../ui/useTickDirection';
import type { Anchor } from '../../ui';
import { formatCompactSize, formatFixed } from './format';
import { OwnOrderChip } from './OwnOrderChip';
import type { OwnOrderActions } from './OwnOrderChip';

export const LADDER_COLUMNS = 'grid-cols-[52px_minmax(0,1fr)_112px_minmax(0,1fr)_52px]';

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

function DepthCell({ side, cell, flash, price, priceText, sizeDecimals, baseAsset, sizeText, staged, onStage, onMenu }: {
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
}) {
  const isBid = side === 'BID';
  const edge: CSSProperties = isBid ? { right: 0 } : { left: 0 };
  const sideCls = isBid ? 'pr-3 text-right' : 'pl-3 text-left';
  const flashCls = flash ? (isBid ? 'animate-flash-buy' : 'animate-flash-sell') : '';
  const verb = isBid ? 'Buy' : 'Sell';

  let text = '';
  let depth = '';
  if (cell.state === 'level' && cell.quantity !== null) {
    const q = formatFixed(cell.quantity, sizeDecimals);
    text = cell.partial ? `≥${q}` : q;
    depth = `, ${cell.partial ? 'at least ' : ''}${q} on book`;
  } else if (cell.state === 'unknown') {
    depth = ', depth unknown';
  }
  const what = sizeText !== null ? `${verb} ${sizeText} ${baseAsset}` : `${verb} ${baseAsset}`;
  const label = `${what} at ${priceText}${depth}`;
  const own = cell.own;
  const sliceW = own && own.slice > 0 ? pct(own.sliceFraction) : null;
  // Literal class names: Tailwind only generates what it can read.
  const ring = isBid ? 'outline-buy' : 'outline-sell';
  const hoverRing = isBid ? 'hover:outline-buy' : 'hover:outline-sell';

  return (
    <button
      type="button"
      role="gridcell"
      tabIndex={-1}
      aria-label={label}
      data-staged={staged ? 'true' : undefined}
      title={cell.partial ? 'Part of this group lies beyond the known depth' : undefined}
      onClick={() => onStage?.(side, price)}
      {...menuHandlers(price, onMenu)}
      className={`group relative h-full cursor-pointer overflow-hidden rounded border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-[22px] text-text-strong outline-offset-[-1px] hover:bg-chip hover:outline hover:outline-1 ${
        staged ? `outline outline-1 ${ring}` : ''
      } ${hoverRing} ${sideCls} ${flashCls}`}
    >
      {cell.state === 'level' && (
        <span
          aria-hidden
          className={`absolute bottom-[3px] top-[3px] rounded-[3px] ${isBid ? 'bg-buy-soft' : 'bg-sell-soft'}`}
          style={{ ...edge, width: pct(cell.bar) }}
        />
      )}
      {sliceW && (
        <>
          <span
            aria-hidden
            data-own-slice
            className={`absolute bottom-[3px] top-[3px] rounded-[3px] ${isBid ? 'bg-buy' : 'bg-sell'}`}
            style={{ ...edge, width: sliceW, opacity: 'var(--own-slice-alpha)' }}
          />
          <span
            aria-hidden
            className="absolute bottom-[3px] top-[3px] rounded-[3px]"
            style={{ ...edge, width: sliceW, boxShadow: `inset 0 0 0 1px var(${isBid ? '--buy' : '--sell'})` }}
          />
        </>
      )}
      {cell.state === 'unknown' && (
        <span aria-hidden data-unknown className="absolute inset-y-[3px] inset-x-0 rounded-[3px] opacity-60" style={HATCH} />
      )}
      {/* On hover the cell previews what a click stages ("Buy 0.25"). */}
      <span aria-hidden className="relative group-hover:hidden">{text}</span>
      <span aria-hidden className={`relative hidden font-semibold group-hover:inline ${isBid ? 'text-buy' : 'text-sell'}`}>
        {sizeText !== null ? `${verb} ${sizeText}` : verb}
      </span>
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
}: RungProps) {
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
    return <div role="row" aria-hidden data-rung-price="" className={`grid h-[22px] ${LADDER_COLUMNS}`} />;
  }

  const toneCls = tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : 'text-muted';

  return (
    <div
      role="row"
      data-rung-price={row.price}
      className={`grid h-[22px] ${LADDER_COLUMNS} items-center rounded has-[[data-focus-cell]:focus-visible]:ring-1 has-[[data-focus-cell]:focus-visible]:ring-inset has-[[data-focus-cell]:focus-visible]:ring-accent/50`}
      style={tint ? { background: tint } : undefined}
    >
      <span role="gridcell" className="flex items-center">
        {ownBid && (
          <OwnOrderChip side="BID" own={ownBid} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} actions={ownActions} />
        )}
      </span>
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
      />
      <span
        role="gridcell"
        tabIndex={focusable ? 0 : -1}
        data-focus-cell
        aria-label={rungLabel(row, priceText, sizeDecimals)}
        className="flex h-full items-center justify-center rounded text-[13px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
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
      />
      <span role="gridcell" className="flex items-center justify-end">
        {ownAsk && (
          <OwnOrderChip side="ASK" own={ownAsk} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} actions={ownActions} />
        )}
      </span>
    </div>
  );
}

// Skeleton widths (%) cycled per row: organic, not a flat block.
const SKELETON_WIDTHS = [55, 70, 45, 65, 50, 75, 60, 40];

/** Placeholder rungs while a market's first snapshot is in flight. */
export function SkeletonRung({ index }: { index: number }) {
  const w = (k: number) => `${SKELETON_WIDTHS[(index + k) % SKELETON_WIDTHS.length]}%`;
  return (
    <div aria-hidden data-skeleton-rung className={`grid h-[22px] ${LADDER_COLUMNS} items-center animate-pulse`}>
      <span />
      <span className="flex justify-end pr-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(0) }} />
      </span>
      <span className="flex justify-center">
        <span className="h-3 w-14 rounded-sm bg-surface-2" />
      </span>
      <span className="flex justify-start pl-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(3) }} />
      </span>
      <span />
    </div>
  );
}
